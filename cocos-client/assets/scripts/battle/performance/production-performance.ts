import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const PERFORMANCE_LIMITS = Object.freeze({
  width: 1920,
  height: 1080,
  units: 24,
  sceneLayers: 6,
  basicEffects: 7,
  minFps: 55,
  maxP95FrameTimeMs: 22,
});

export const E104_LAYER_IDS = Object.freeze(['sky', 'far', 'mid', 'road', 'foreground', 'dynamic']);
const E104_LAYER_SOURCES = Object.freeze([
  'env_E104_sky_01_v001.png',
  'env_E104_far_02_v001.png',
  'env_E104_mid_03_v001.png',
  'env_E104_road_04_v001.png',
  'env_E104_foreground_05_v001.png',
  'env_E104_dynamic_06_v001.png',
]);
export const T251_CATEGORIES = Object.freeze(['attack', 'spell', 'heal', 'hit', 'death', 'button', 'settlement']);
const T251_EVENT_BY_CATEGORY = Object.freeze({
  attack: 'attack.impact',
  spell: 'spell.resolve',
  heal: 'heal.pulse',
  hit: 'hit.impact',
  death: 'death.release',
  button: 'ui.button.activate',
  settlement: 'battle.settlement.reveal',
});

const E104_FROZEN_CONTRACT_RELATIVE_PATH = 'cocos-client/assets/resources/art/battle/scenes/E104/scene-contract.json';
const E104_FROZEN_CONTRACT_SHA256 = '17e7406bf3163e1a06b746c30a54bd57f87b00306bd8ae3611caa14a07770dbf';
const T251_FROZEN_CONTRACT_RELATIVE_PATH = 'art/battle/effects/battle-effects-audio-contract.json';
const T251_FROZEN_CONTRACT_SHA256 = '8752aff9b15de82e54fe9716693a8ad8e738c543f05c437e81453efe24464176';

const GPU_HARDWARE_KEYWORD_PATTERN = /\b(?:apple|amd|ati|nvidia|intel|qualcomm|arm|mali|adreno|powervr|imagination|radeon|geforce|quadro|tesla|arc|iris|uhd|xe|applegpu)\b/i;
// These tokens are intentionally unbounded: fakeGPU, unknownGPU, software_gpu,
// and SwiftShaderGPU must be rejected just like their space-delimited forms.
const GPU_PLACEHOLDER_PATTERN = /(?:fake|mock|unknown|software|swiftshader|llvmpipe|softpipe|virtual|test|dummy|placeholder|stub|synthetic|emulated|fallback|offscreen|headless|rasterizer|unsupported|n\/a|null)/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ProductionScenario {
  readonly renderer: 'gpu';
  readonly resolution: readonly [number, number];
  readonly units: number;
  readonly sceneLayers: number;
  readonly basicEffects: number;
  readonly audioFeedbacks: number;
  readonly sceneContractVersion: string;
  readonly effectsAudioContractVersion: string;
}

export interface PerformanceSample {
  readonly fps: number;
  readonly p95FrameTimeMs: number;
}

export interface DeterministicPerformanceModel extends PerformanceSample {
  readonly kind: 'deterministic-contract-model';
  readonly averageFrameTimeMs: number;
  readonly inputs: ProductionScenario;
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findForbiddenArtMetricValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return /(?:preview|pose|placeholder|dummy|stub|synthetic|emulated|fallback)/i.test(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenArtMetricValue(entry);
      if (found) return found;
    }
    return undefined;
  }
  if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      const found = findForbiddenArtMetricValue(entry);
      if (found) return found;
    }
  }
  return undefined;
}

function validateFormalA0Metrics(metrics: Record<string, any>, label: string): void {
  if (metrics.ready !== true || metrics.assetsReady !== true) fail(`${label} did not confirm a ready runtime with loaded assets`);
  if (metrics.artMode !== 'formal-runtime') {
    fail(`${label} formal runtime missing: artMode=${String(metrics.artMode)}; preview-pose and placeholder resources are rejected`);
  }
  if (metrics.previewPoseAssets !== 0) {
    fail(`${label} formal runtime missing: previewPoseAssets=${String(metrics.previewPoseAssets)}; expected 0`);
  }
  if (metrics.artIntegrationComplete !== true) fail(`${label} formal runtime missing: artIntegrationComplete must be true`);
  const forbiddenArtMetric = findForbiddenArtMetricValue(metrics);
  if (forbiddenArtMetric) fail(`${label} contains a preview/placeholder resource metric: ${forbiddenArtMetric}`);
}

function requireRecord(value: unknown, label: string): Record<string, any> {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  return value;
}

function requireInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  return value as number;
}

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function canonicalizeJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) fail('contract JSON must not contain circular references');
    seen.add(value);
    const canonical = value.map((entry) => canonicalizeJson(entry, seen));
    seen.delete(value);
    return canonical;
  }
  if (isRecord(value)) {
    if (seen.has(value)) fail('contract JSON must not contain circular references');
    seen.add(value);
    const canonical = Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeJson(value[key], seen)]));
    seen.delete(value);
    return canonical;
  }
  return value;
}

function readFrozenJsonContract(filePath: string, expectedSha256: string, label: string): unknown {
  regularFile(filePath, label);
  const actualSha256 = sha256(filePath);
  if (actualSha256 !== expectedSha256) fail(`${label} SHA-256 does not match the frozen contract`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertMatchesFrozenJson(contract: unknown, filePath: string, expectedSha256: string, label: string): void {
  const frozenContract = readFrozenJsonContract(filePath, expectedSha256, label);
  if (!isDeepStrictEqual(canonicalizeJson(contract), canonicalizeJson(frozenContract))) {
    fail(`${label} must exactly match the frozen JSON contract`);
  }
}

function containedPath(root: string, relativePath: string, label: string): string {
  if (relativePath.includes('\\') || relativePath.includes('\0') || path.posix.isAbsolute(relativePath)) {
    fail(`${label} must be a safe relative path`);
  }
  if (relativePath !== path.posix.normalize(relativePath) || relativePath.split('/').includes('..')) {
    fail(`${label} must not contain traversal`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, ...relativePath.split('/'));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) fail(`${label} escapes its root`);
  return resolved;
}

function regularFile(filePath: string, label: string): fs.Stats {
  if (!fs.existsSync(filePath)) fail(`${label} does not exist: ${filePath}`);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular file`);
  return stat;
}

function validateHashAndSize(filePath: string, expectedBytes: unknown, expectedSha: unknown, label: string): void {
  const stat = regularFile(filePath, label);
  if (stat.size !== expectedBytes) fail(`${label}.bytes does not match the source file`);
  if (sha256(filePath) !== expectedSha) fail(`${label}.sha256 does not match the source file`);
}

function pngDimensions(filePath: string, label: string): [number, number] {
  const buffer = fs.readFileSync(filePath);
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) fail(`${label} is not a PNG`);
  if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') fail(`${label} is missing a PNG IHDR`);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function wavInfo(filePath: string, label: string): { channels: number; sampleRate: number; bitDepth: number; dataBytes: number; durationMs: number } {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') fail(`${label} is not a RIFF/WAVE file`);
  let offset = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitDepth: number } | undefined;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) fail(`${label} contains a truncated WAV chunk`);
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitDepth: buffer.readUInt16LE(chunkStart + 14),
      };
    }
    if (chunkId === 'data') dataBytes = chunkSize;
    offset = chunkEnd + (chunkSize % 2);
  }
  if (!fmt || dataBytes === 0) fail(`${label} is missing fmt or data chunk`);
  if (fmt.audioFormat !== 1 || fmt.channels !== 1 || fmt.sampleRate !== 48000 || fmt.bitDepth !== 16) {
    fail(`${label} must be PCM 48000Hz/1ch/16bit`);
  }
  if (dataBytes % 2 !== 0) fail(`${label} has invalid 16-bit PCM data`);
  return { ...fmt, dataBytes, durationMs: dataBytes / 2 / 48000 * 1000 };
}

export function validateProductionConfiguration(manifest: unknown): void {
  const config = requireRecord(manifest, 'production config');
  if (config.engine !== 'Cocos Creator 3.8.8') fail('production config engine must be Cocos Creator 3.8.8');
  if (config.target !== 'web-desktop') fail('production config target must be web-desktop');
  if (JSON.stringify(config.designResolution) !== JSON.stringify([PERFORMANCE_LIMITS.width, PERFORMANCE_LIMITS.height])) {
    fail('production config design resolution must be 1920x1080');
  }

  const board = requireRecord(config.board, 'production config board');
  if (requireInteger(board.lanes, 'production config board.lanes') * requireInteger(board.cellsPerLane, 'production config board.cellsPerLane') !== PERFORMANCE_LIMITS.units) {
    fail('production config board must expose 24 unit cells');
  }
  if (requireInteger(board.summonDepth, 'production config board.summonDepth') * requireInteger(board.lanes, 'production config board.lanes') !== PERFORMANCE_LIMITS.sceneLayers) {
    fail('production config board must expose six scene layers');
  }
  if (board.cellOccupancyLimit !== 1) fail('production config must keep one unit per cell');

  const stress = requireRecord(config.stress, 'production config stress');
  if (stress.units !== PERFORMANCE_LIMITS.units) fail('production config stress.units must be 24');
  if (requireInteger(stress.targetFps, 'production config stress.targetFps') < 60) fail('production config target FPS cannot be lowered below 60');
  if (stress.minimumFps !== PERFORMANCE_LIMITS.minFps) fail('production config minimum FPS must remain 55');
  if (stress.maximumP95FrameTimeMs !== PERFORMANCE_LIMITS.maxP95FrameTimeMs) fail('production config maximum P95 frame time must remain 22ms');

  const runtimeArt = requireRecord(config.runtimeArt, 'production config runtimeArt');
  if (!Array.isArray(runtimeArt.integrated) || !runtimeArt.integrated.includes('E104')) fail('production config must reference E104');
  if (!Array.isArray(config.scope) || !config.scope.includes('E104')) fail('production config scope must reference E104');
  const serialized = JSON.stringify(config);
  if (/web-prototype|react/i.test(serialized)) fail('production performance cannot depend on a React prototype');
}

export function validateE104SceneContract(contract: unknown, sceneRoot: string, repoRoot: string): { layerCount: number; contractVersion: string } {
  const frozenContractPath = containedPath(repoRoot, E104_FROZEN_CONTRACT_RELATIVE_PATH, 'E104 frozen scene contract');
  assertMatchesFrozenJson(contract, frozenContractPath, E104_FROZEN_CONTRACT_SHA256, 'E104 frozen scene contract');
  const scene = requireRecord(contract, 'E104 scene contract');
  if (scene.contractVersion !== 'E104-scene-v1' || scene.sceneId !== 'E104' || scene.stage !== 'formal-runtime-scene') {
    fail('E104 scene contract identity is not the frozen formal contract');
  }
  const canvas = requireRecord(scene.canvas, 'E104 scene canvas');
  if (JSON.stringify(canvas.designResolution) !== JSON.stringify([PERFORMANCE_LIMITS.width, PERFORMANCE_LIMITS.height])) {
    fail('E104 scene canvas must be 1920x1080');
  }
  if (!Array.isArray(scene.layers) || scene.layers.length !== E104_LAYER_IDS.length) fail('E104 scene contract must contain exactly six layers');
  const seenSources = new Set<string>();
  scene.layers.forEach((layer: any, index: number) => {
    const label = `E104 layers[${index}]`;
    requireRecord(layer, label);
    if (layer.id !== E104_LAYER_IDS[index] || layer.order !== index || layer.source !== E104_LAYER_SOURCES[index]) fail(`${label} is not the frozen layer order or source`);
    const source = requireString(layer.source, `${label}.source`);
    if (source.includes('E104-PARALLAX-BOARD') || /(?:preview|pose|placeholder|dummy|stub)/i.test(source)) fail(`${label}.source cannot be a composite or placeholder`);
    if (seenSources.has(source)) fail(`${label}.source is duplicated`);
    seenSources.add(source);
    const filePath = containedPath(sceneRoot, source, `${label}.source`);
    validateHashAndSize(filePath, fs.statSync(filePath).size, layer.sha256, label);
    if (!Array.isArray(layer.sourceRect) && !isRecord(layer.sourceRect)) fail(`${label}.sourceRect is missing`);
    if (!Array.isArray(layer.outputSize) || layer.outputSize.length !== 2) fail(`${label}.outputSize is missing`);
    requireFiniteNumber(layer.parallax, `${label}.parallax`);
    if (!Array.isArray(layer.renderBounds) || layer.renderBounds.length !== 4) fail(`${label}.renderBounds is missing`);
  });

  const provenance = requireRecord(scene.provenance, 'E104 scene provenance');
  if (provenance.referenceAssetId !== 'E104-PARALLAX-BOARD') fail('E104 scene provenance reference asset is invalid');
  if (provenance.runtimeComposite !== 'cocos-client/assets/resources/a0/background/E104-PARALLAX-BOARD.png') fail('E104 scene runtime composite reference is invalid');
  const compositePath = containedPath(repoRoot, provenance.runtimeComposite, 'E104 scene runtimeComposite');
  validateHashAndSize(compositePath, fs.statSync(compositePath).size, provenance.runtimeCompositeSha256, 'E104 scene runtimeComposite');

  const road = requireRecord(scene.roadContract, 'E104 road contract');
  if (road.layerId !== 'road' || road.laneCount !== 2 || road.columnsPerLane !== 12 || road.sharedColumnGrid !== true) fail('E104 road contract does not expose the 24-cell two-lane grid');
  const readability = requireRecord(scene.unitReadability, 'E104 unit readability');
  if (readability.coordinateSpace !== '1920x1080-design-resolution' || !Array.isArray(readability.anchors) || readability.anchors.length < 2) fail('E104 unit readability contract is incomplete');
  return { layerCount: scene.layers.length, contractVersion: scene.contractVersion };
}

export function validateT251EffectsAudioContract(contract: unknown, resourceRoot: string, effectsRoot: string, audioRoot: string): { effectCount: number; audioCount: number; contractVersion: string } {
  const frozenContractPath = containedPath(resourceRoot, T251_FROZEN_CONTRACT_RELATIVE_PATH, 'T251 frozen effects/audio contract');
  assertMatchesFrozenJson(contract, frozenContractPath, T251_FROZEN_CONTRACT_SHA256, 'T251 frozen effects/audio contract');
  const feedback = requireRecord(contract, 'T251 effects/audio contract');
  if (feedback.schemaVersion !== 1 || feedback.contractId !== 'T251-BATTLE-FEEDBACK' || feedback.contractVersion !== '1.0.0') fail('T251 effects/audio contract identity is not frozen');
  if (feedback.engine !== 'Cocos Creator 3.8.8' || feedback.resourceRoot !== 'assets/resources' || feedback.productionTask !== 'T251') fail('T251 effects/audio contract provenance is invalid');

  const validation = requireRecord(feedback.validation, 'T251 validation');
  if (JSON.stringify(validation.requiredCategories) !== JSON.stringify(T251_CATEGORIES)) fail('T251 required effect/audio categories are incomplete or reordered');
  const effectValidation = requireRecord(validation.effect, 'T251 effect validation');
  const effectDuration = requireRecord(effectValidation.durationMs, 'T251 effect validation.durationMs');
  if (effectValidation.format !== 'png' || requireInteger(effectValidation.minBytes, 'T251 effect validation.minBytes') < 1024 || effectValidation.width !== 256 || effectValidation.height !== 256 || requireFiniteNumber(effectDuration.min, 'T251 effect validation.durationMs.min') < 80 || requireFiniteNumber(effectDuration.max, 'T251 effect validation.durationMs.max') > 1200) fail('T251 effect validation weakens the frozen gate');
  const audioValidation = requireRecord(validation.audio, 'T251 audio validation');
  const audioDuration = requireRecord(audioValidation.durationMs, 'T251 audio validation.durationMs');
  if (audioValidation.format !== 'wav' || requireInteger(audioValidation.minBytes, 'T251 audio validation.minBytes') < 1000 || audioValidation.sampleRate !== 48000 || audioValidation.channels !== 1 || audioValidation.bitDepth !== 16 || requireFiniteNumber(audioDuration.min, 'T251 audio validation.durationMs.min') < 80 || requireFiniteNumber(audioDuration.max, 'T251 audio validation.durationMs.max') > 1000) fail('T251 audio validation weakens the frozen gate');

  if (!Array.isArray(feedback.assets) || feedback.assets.length !== T251_CATEGORIES.length * 2) fail('T251 effects/audio contract must contain exactly fourteen assets');
  const ids = new Set<string>();
  const byCategory = new Map<string, any[]>();
  T251_CATEGORIES.forEach((category) => byCategory.set(category, []));
  feedback.assets.forEach((asset: any, index: number) => {
    const label = `T251 assets[${index}]`;
    requireRecord(asset, label);
    const id = requireString(asset.id, `${label}.id`);
    if (ids.has(id)) fail(`${label}.id is duplicated`);
    ids.add(id);
    if (!T251_CATEGORIES.includes(asset.category)) fail(`${label}.category is not frozen`);
    if (!['effect', 'audio'].includes(asset.kind)) fail(`${label}.kind is invalid`);
    const isEffect = asset.kind === 'effect';
    const expectedFormat = isEffect ? 'png' : 'wav';
    if (asset.format !== expectedFormat || asset.productionTask !== 'T251') fail(`${label} format or production task is invalid`);
    const resourcePath = requireString(asset.resourcePath, `${label}.resourcePath`);
    if (/(?:preview|pose|placeholder|dummy|stub)/i.test(resourcePath)) fail(`${label}.resourcePath cannot point to a placeholder`);
    const expectedPrefix = isEffect ? 'art/battle/effects/' : 'art/battle/audio/';
    if (!resourcePath.startsWith(expectedPrefix) || path.posix.basename(resourcePath) !== asset.fileName) fail(`${label}.resourcePath is not the frozen production reference`);
    const root = isEffect ? effectsRoot : audioRoot;
    const filePath = containedPath(resourceRoot, resourcePath, `${label}.resourcePath`);
    if (!filePath.startsWith(`${path.resolve(root)}${path.sep}`)) fail(`${label}.resourcePath escapes its production asset root`);
    validateHashAndSize(filePath, asset.bytes, asset.sha256, label);
    if (fs.statSync(filePath).size < (isEffect ? 1024 : 1000)) fail(`${label} is below the frozen minimum size`);
    if (!isRecord(asset.event) || asset.event.type !== T251_EVENT_BY_CATEGORY[asset.category]) fail(`${label}.event does not match category`);
    if (!isRecord(asset.runtime)) fail(`${label}.runtime is missing`);
    const durationMs = requireFiniteNumber(asset.durationMs, `${label}.durationMs`);
    const durationLimits = isEffect ? effectDuration : audioDuration;
    if (durationMs < durationLimits.min || durationMs > durationLimits.max) fail(`${label}.durationMs is outside the frozen range`);
    const eventAtMs = requireInteger(asset.event.atMs, `${label}.event.atMs`);
    if (eventAtMs <= 0 || eventAtMs >= durationMs) fail(`${label}.event.atMs must be inside the asset duration`);
    if (isEffect) {
      if (!isRecord(asset.dimensions) || asset.dimensions.width !== 256 || asset.dimensions.height !== 256) fail(`${label}.dimensions must be 256x256`);
      if (JSON.stringify(pngDimensions(filePath, label)) !== JSON.stringify([256, 256])) fail(`${label} PNG dimensions do not match the contract`);
    } else {
      const wav = wavInfo(filePath, label);
      if (Math.abs(wav.durationMs - asset.durationMs) > 0.001) fail(`${label}.durationMs does not match WAV data`);
    }
    byCategory.get(asset.category).push(asset);
  });
  T251_CATEGORIES.forEach((category) => {
    const entries = byCategory.get(category) ?? [];
    if (entries.length !== 2 || entries.filter((entry) => entry.kind === 'effect').length !== 1 || entries.filter((entry) => entry.kind === 'audio').length !== 1) fail(`T251 category ${category} must contain one effect and one audio asset`);
  });
  if (!Array.isArray(feedback.samples) || feedback.samples.length !== T251_CATEGORIES.length) fail('T251 samples must cover all seven categories');
  const sampleCategories = new Set<string>();
  feedback.samples.forEach((sample: any, index: number) => {
    const label = `T251 samples[${index}]`;
    requireRecord(sample, label);
    if (!T251_CATEGORIES.includes(sample.category) || sampleCategories.has(sample.category)) fail(`${label}.category must cover each frozen category exactly once`);
    sampleCategories.add(sample.category);
    const entries = byCategory.get(sample.category) ?? [];
    const effect = entries.find((entry) => entry.kind === 'effect');
    const audio = entries.find((entry) => entry.kind === 'audio');
    if (!effect || !audio || sample.trigger !== T251_EVENT_BY_CATEGORY[sample.category] || sample.effectId !== effect.id || sample.audioId !== audio.id) fail(`${label} does not bind the frozen effect/audio pair`);
  });
  return { effectCount: feedback.assets.filter((asset: any) => asset.kind === 'effect').length, audioCount: feedback.assets.filter((asset: any) => asset.kind === 'audio').length, contractVersion: feedback.contractVersion };
}

export function buildProductionScenario(config: any, scene: { layerCount: number; contractVersion: string }, effects: { effectCount: number; audioCount: number; contractVersion: string }): ProductionScenario {
  validateProductionConfiguration(config);
  if (scene.layerCount !== PERFORMANCE_LIMITS.sceneLayers || effects.effectCount !== PERFORMANCE_LIMITS.basicEffects || effects.audioCount !== PERFORMANCE_LIMITS.basicEffects) fail('formal asset contracts do not match the six-layer/seven-effect performance scenario');
  return {
    renderer: 'gpu',
    resolution: [PERFORMANCE_LIMITS.width, PERFORMANCE_LIMITS.height],
    units: PERFORMANCE_LIMITS.units,
    sceneLayers: scene.layerCount,
    basicEffects: effects.effectCount,
    audioFeedbacks: effects.audioCount,
    sceneContractVersion: scene.contractVersion,
    effectsAudioContractVersion: effects.contractVersion,
  };
}

export function validateScenario(scenario: ProductionScenario): void {
  if (scenario.renderer !== 'gpu') fail('performance scenario must use GPU rendering');
  if (JSON.stringify(scenario.resolution) !== JSON.stringify([PERFORMANCE_LIMITS.width, PERFORMANCE_LIMITS.height])) fail('performance scenario must use 1920x1080');
  if (scenario.units !== PERFORMANCE_LIMITS.units) fail('performance scenario must contain 24 units');
  if (scenario.sceneLayers !== PERFORMANCE_LIMITS.sceneLayers) fail('performance scenario must contain six scene layers');
  if (scenario.basicEffects > PERFORMANCE_LIMITS.basicEffects) fail('performance scenario basic effects exceed the production budget');
  if (scenario.basicEffects !== PERFORMANCE_LIMITS.basicEffects) fail('performance scenario must include all seven T251 effects');
  if (scenario.audioFeedbacks !== PERFORMANCE_LIMITS.basicEffects) fail('performance scenario must include all seven T251 audio feedbacks');
}

export function createDeterministicPerformanceModel(scenario: ProductionScenario): DeterministicPerformanceModel {
  validateScenario(scenario);
  const averageFrameTimeMs = 5.2 + scenario.sceneLayers * 0.55 + scenario.units * 0.22 + scenario.basicEffects * 0.32 + scenario.audioFeedbacks * 0.04;
  const p95FrameTimeMs = averageFrameTimeMs + 0.6 + scenario.sceneLayers * 0.12 + scenario.units * 0.03 + scenario.basicEffects * 0.08;
  return {
    kind: 'deterministic-contract-model',
    averageFrameTimeMs: Number(averageFrameTimeMs.toFixed(3)),
    fps: Number((1000 / averageFrameTimeMs).toFixed(3)),
    p95FrameTimeMs: Number(p95FrameTimeMs.toFixed(3)),
    inputs: scenario,
  };
}

export function validatePerformanceSample(sample: PerformanceSample, limits = PERFORMANCE_LIMITS): void {
  const fps = requireFiniteNumber(sample.fps, 'performance fps');
  const p95 = requireFiniteNumber(sample.p95FrameTimeMs, 'performance P95 frame time');
  if (fps < limits.minFps) fail(`performance FPS ${fps} is below ${limits.minFps}`);
  if (p95 > limits.maxP95FrameTimeMs) fail(`performance P95 frame time ${p95}ms exceeds ${limits.maxP95FrameTimeMs}ms`);
}

// Runner protocol: stdin is the scenario JSON; stdout is JSON containing runtimeAvailable,
// renderer, GPU identity, gpuDriverVersion, gpuContextId, actual canvas dimensions, the
// observed A0 metrics, every scenario contract field, and raw frameTimesMs samples. The
// verifier launches only an absolute, directly executable regular file; interpreter/script
// paths are rejected by verify-production-performance.mjs.
// gpuDriverVersion must be the observed driver/version string and include a numeric version;
// gpuContextId must identify the live GPU context and be at least eight characters. All four
// identity fields must be non-placeholder values.
export function validateGpuRunnerResult(result: unknown, scenario: ProductionScenario): PerformanceSample {
  validateScenario(scenario);
  const runner = requireRecord(result, 'GPU runner result');
  if (runner.runtimeAvailable !== true) fail('runtime availability is false; a deterministic model cannot replace a GPU run');
  const gpuVendor = requireString(runner.gpuVendor, 'GPU runner gpuVendor').trim();
  const gpuRenderer = requireString(runner.gpuRenderer, 'GPU runner gpuRenderer').trim();
  const gpuDriverVersion = requireString(runner.gpuDriverVersion, 'GPU runner gpuDriverVersion').trim();
  const gpuContextId = requireString(runner.gpuContextId, 'GPU runner gpuContextId').trim();
  const gpuFeatureStatus = requireRecord(runner.gpuFeatureStatus, 'GPU runner gpuFeatureStatus');
  const webglFeatureStatus = requireString(gpuFeatureStatus.webgl, 'GPU runner gpuFeatureStatus.webgl').trim();
  const webgl2FeatureStatus = requireString(gpuFeatureStatus.webgl2, 'GPU runner gpuFeatureStatus.webgl2').trim();
  const gpuContextType = requireString(runner.gpuContextType, 'GPU runner gpuContextType').trim();

  const identityFields = [
    ['gpuVendor', gpuVendor],
    ['gpuRenderer', gpuRenderer],
    ['gpuDriverVersion', gpuDriverVersion],
    ['gpuContextId', gpuContextId],
  ] as const;
  identityFields.forEach(([label, value]) => {
    if (value.length === 0 || GPU_PLACEHOLDER_PATTERN.test(value)) fail(`GPU runner ${label} must be a non-placeholder real field`);
  });
  if (runner.renderer !== 'gpu') fail('GPU runner did not report GPU rendering');
  if (!GPU_HARDWARE_KEYWORD_PATTERN.test(gpuVendor) || !GPU_HARDWARE_KEYWORD_PATTERN.test(gpuRenderer)) {
    fail('GPU runner must report recognized hardware GPU vendor and renderer fields');
  }
  if (!/\d/.test(gpuDriverVersion)) fail('GPU runner gpuDriverVersion must be a verifiable non-placeholder version');
  if (gpuContextId.length < 8 || !/[A-Za-z0-9]/.test(gpuContextId)) fail('GPU runner gpuContextId must be a verifiable non-placeholder context identifier');
  if (gpuContextType !== 'webgl2') fail('GPU runner must expose a live WebGL2 context');
  if (!/^(?:enabled|hardware[_ ]accelerated)$/i.test(webglFeatureStatus) || !/^(?:enabled|hardware[_ ]accelerated)$/i.test(webgl2FeatureStatus)) {
    fail('GPU runner WebGL and WebGL2 feature status must report an enabled hardware path');
  }

  const scenarioFields = [
    ['renderer', runner.renderer, scenario.renderer],
    ['width', runner.width, scenario.resolution[0]],
    ['height', runner.height, scenario.resolution[1]],
    ['units', runner.units, scenario.units],
    ['sceneLayers', runner.sceneLayers, scenario.sceneLayers],
    ['basicEffects', runner.basicEffects, scenario.basicEffects],
    ['audioFeedbacks', runner.audioFeedbacks, scenario.audioFeedbacks],
    ['sceneContractVersion', runner.sceneContractVersion, scenario.sceneContractVersion],
    ['effectsAudioContractVersion', runner.effectsAudioContractVersion, scenario.effectsAudioContractVersion],
  ] as const;
  const mismatchedField = scenarioFields.find(([, actual, expected]) => actual !== expected);
  if (mismatchedField) {
    fail(`GPU runner measured a scenario different from the production contract (${mismatchedField[0]} mismatch)`);
  }

  const canvasDimensions = [
    ['canvasCssWidth', runner.canvasCssWidth, PERFORMANCE_LIMITS.width],
    ['canvasCssHeight', runner.canvasCssHeight, PERFORMANCE_LIMITS.height],
    ['canvasBufferWidth', runner.canvasBufferWidth, PERFORMANCE_LIMITS.width],
    ['canvasBufferHeight', runner.canvasBufferHeight, PERFORMANCE_LIMITS.height],
  ] as const;
  canvasDimensions.forEach(([label, actual, expected]) => {
    const measured = requireFiniteNumber(actual, `GPU runner ${label}`);
    if (measured !== expected) fail(`GPU runner ${label} must be exactly ${expected}, received ${measured}`);
  });

  const a0Metrics = requireRecord(runner.a0Metrics, 'GPU runner a0Metrics');
  validateFormalA0Metrics(a0Metrics, 'GPU runner A0 metrics');
  const a0InitialMetrics = requireRecord(runner.a0InitialMetrics, 'GPU runner a0InitialMetrics');
  validateFormalA0Metrics(a0InitialMetrics, 'GPU runner initial A0 metrics');
  if (a0Metrics.stressMode !== true || a0Metrics.activeUnits !== scenario.units || a0Metrics.runtimeUnitSprites !== scenario.units) {
    fail('GPU runner A0 metrics did not confirm the required 24-unit stress runtime');
  }
  if (a0Metrics.hitCount !== 1) fail('GPU runner A0 metrics did not confirm the hit scenario');

  if (!Array.isArray(runner.frameTimesMs) || runner.frameTimesMs.length < 120) fail('GPU runner must provide at least 120 raw frame-time samples');
  const frameTimesMs = runner.frameTimesMs.map((value: unknown, index: number) => {
    const frameTimeMs = requireFiniteNumber(value, `GPU runner frameTimesMs[${index}]`);
    if (frameTimeMs <= 0) fail(`GPU runner frameTimesMs[${index}] must be greater than zero`);
    return frameTimeMs;
  });
  const sortedFrameTimesMs = [...frameTimesMs].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sortedFrameTimesMs.length * 0.95) - 1);
  const averageFrameTimeMs = frameTimesMs.reduce((total, frameTimeMs) => total + frameTimeMs, 0) / frameTimesMs.length;
  const sample = { fps: 1000 / averageFrameTimeMs, p95FrameTimeMs: sortedFrameTimesMs[p95Index] };
  validatePerformanceSample(sample);
  return sample;
}
