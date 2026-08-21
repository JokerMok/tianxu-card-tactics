import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(toolRoot, '../../..');
const repoRoot = path.resolve(clientRoot, '..');
const sceneRoot = path.join(clientRoot, 'assets/resources/art/battle/scenes/E104');
const effectsRoot = path.join(clientRoot, 'assets/resources/art/battle/effects');
const audioRoot = path.join(clientRoot, 'assets/resources/art/battle/audio');

const manifestPath = path.join(clientRoot, 'assets/a0-manifest.json');
const performanceSourcePath = path.join(clientRoot, 'assets/scripts/battle/performance/production-performance.ts');
const sceneContractPath = path.join(sceneRoot, 'scene-contract.json');
const effectsContractPath = path.join(effectsRoot, 'battle-effects-audio-contract.json');
const runtimeArtifactPath = path.join(clientRoot, 'test-artifacts/BattleA0-performance.json');
const passSamplePath = path.join(toolRoot, 'samples/pass-raw-frame-times.json');

function fail(message) {
  throw new Error(message);
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  return value;
}

function readRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    fail(`${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular file`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath, label) {
  const text = readRegularFile(filePath, label);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expectFailure(label, action, expectedMessage) {
  try {
    action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, expectedMessage, `${label} returned an unexpected rejection`);
    console.log(`  negative PASS: ${label}`);
    return;
  }
  fail(`${label} was accepted unexpectedly`);
}

function scenarioFields(scenario) {
  return {
    renderer: scenario.renderer,
    width: scenario.resolution[0],
    height: scenario.resolution[1],
    units: scenario.units,
    sceneLayers: scenario.sceneLayers,
    basicEffects: scenario.basicEffects,
    audioFeedbacks: scenario.audioFeedbacks,
    sceneContractVersion: scenario.sceneContractVersion,
    effectsAudioContractVersion: scenario.effectsAudioContractVersion,
  };
}

function calculateFrameMetrics(frameTimesMs, label) {
  if (!Array.isArray(frameTimesMs) || frameTimesMs.length < 120) {
    fail(`${label}.frameTimesMs must contain at least 120 raw samples`);
  }
  const values = frameTimesMs.map((value, index) => {
    const frameTimeMs = requireFiniteNumber(value, `${label}.frameTimesMs[${index}]`);
    if (frameTimeMs <= 0) fail(`${label}.frameTimesMs[${index}] must be greater than zero`);
    return frameTimeMs;
  });
  const sorted = [...values].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const averageFrameTimeMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    fps: 1000 / averageFrameTimeMs,
    p95FrameTimeMs: sorted[p95Index],
    sampleCount: values.length,
  };
}

function validatePassSample(sample, scenario, performance) {
  const value = requireRecord(sample, 'pass sample');
  if (value.kind !== 'raw-frame-time-sample') fail('pass sample kind is invalid');
  if (value.evidenceClass !== 'contract-rehearsal-fixture') fail('pass sample evidence class must be explicit');
  const expectedFields = scenarioFields(scenario);
  Object.entries(expectedFields).forEach(([field, expected]) => {
    if (value[field] !== expected) fail(`pass sample ${field} does not match the production scenario`);
  });
  const gate = requireRecord(value.gate, 'pass sample gate');
  if (gate.minimumFps !== performance.PERFORMANCE_LIMITS.minFps || gate.maximumP95FrameTimeMs !== performance.PERFORMANCE_LIMITS.maxP95FrameTimeMs) {
    fail('pass sample gate does not match the production thresholds');
  }
  const metrics = calculateFrameMetrics(value.frameTimesMs, 'pass sample');
  performance.validatePerformanceSample(metrics);
  return metrics;
}

function validateReleaseArtifact(artifact, scenario, performance) {
  const value = requireRecord(artifact, 'runtime performance artifact');
  if (value.headless !== false) fail('runtime performance artifact must be a headful run');
  const canvas = requireRecord(value.canvas, 'runtime performance artifact canvas');
  if (canvas.width !== scenario.resolution[0] || canvas.height !== scenario.resolution[1] || canvas.bufferWidth !== scenario.resolution[0] || canvas.bufferHeight !== scenario.resolution[1]) {
    fail('runtime performance artifact canvas must be 1920x1080 at device resolution');
  }
  const final = requireRecord(value.final, 'runtime performance artifact final state');
  if (final.stressMode !== true || final.activeUnits !== scenario.units) fail('runtime performance artifact does not contain the 24-unit stress state');
  if (final.artMode !== 'formal-runtime' || final.previewPoseAssets !== 0 || final.artIntegrationComplete !== true) {
    fail('runtime performance artifact must use formal runtime assets, not preview poses');
  }
  if (value.absolutePerformancePass !== true) fail('runtime performance artifact absolute performance gate is not passing');
  const stressSample = requireRecord(value.stressFrameSample, 'runtime performance artifact stress sample');
  performance.validatePerformanceSample(stressSample);
  return stressSample;
}

function assertExpectedFailureArtifact(artifact, performance) {
  const value = requireRecord(artifact, 'real failure artifact');
  const final = requireRecord(value.final, 'real failure artifact final state');
  const stressSample = requireRecord(value.stressFrameSample, 'real failure artifact stress sample');
  const reasons = [];
  if (value.headless === true) reasons.push('headless');
  if (final.artMode === 'preview-pose' || final.previewPoseAssets > 0 || final.artIntegrationComplete !== true) reasons.push('preview assets');
  if (stressSample.fps < performance.PERFORMANCE_LIMITS.minFps || stressSample.p95FrameTimeMs > performance.PERFORMANCE_LIMITS.maxP95FrameTimeMs) reasons.push('absolute performance budget');
  if (value.absolutePerformancePass !== true) reasons.push('absolutePerformancePass=false');
  if (reasons.length === 0) fail('real failure artifact no longer contains a failing release condition');
  return { reasons, stressSample };
}

async function main() {
  const performance = await import(pathToFileURL(performanceSourcePath).href);
  const sourceText = readRegularFile(performanceSourcePath, 'production performance source');
  assert.match(sourceText, /PERFORMANCE_LIMITS/, 'production performance source must define the formal limits');

  const config = readJson(manifestPath, 'A0 production manifest');
  const sceneContract = readJson(sceneContractPath, 'E104 scene contract');
  const effectsContract = readJson(effectsContractPath, 'T251 effects/audio contract');
  performance.validateProductionConfiguration(config);
  const scene = performance.validateE104SceneContract(sceneContract, sceneRoot, repoRoot);
  const effects = performance.validateT251EffectsAudioContract(effectsContract, path.join(clientRoot, 'assets/resources'), effectsRoot, audioRoot);
  const scenario = performance.buildProductionScenario(config, scene, effects);
  performance.validateScenario(scenario);
  const model = performance.createDeterministicPerformanceModel(scenario);
  performance.validatePerformanceSample(model);

  const passSample = readJson(passSamplePath, 'T327 pass sample');
  const passMetrics = validatePassSample(passSample, scenario, performance);
  console.log(`T327 production contract: PASS (E104 ${scene.layerCount} layers; T251 ${effects.effectCount} effects/${effects.audioCount} audio)`);
  console.log(`T327 scenario: GPU ${scenario.resolution[0]}x${scenario.resolution[1]}, ${scenario.units} units, ${scenario.sceneLayers} layers, ${scenario.basicEffects} effects/${scenario.audioFeedbacks} audio`);
  console.log(`T327 deterministic contract model: FPS ${model.fps}; P95 ${model.p95FrameTimeMs}ms`);
  console.log(`T327 pass sample: ${passMetrics.sampleCount} raw frames; FPS ${passMetrics.fps.toFixed(3)}; P95 ${passMetrics.p95FrameTimeMs.toFixed(3)}ms PASS`);

  const runtimeArtifact = readJson(runtimeArtifactPath, 'real BattleA0 performance artifact');
  const expectedFailure = assertExpectedFailureArtifact(runtimeArtifact, performance);
  expectFailure('real BattleA0 headless/preview artifact', () => validateReleaseArtifact(runtimeArtifact, scenario, performance), /headful|formal runtime|absolute performance/);
  console.log(`T327 failure sample: ${expectedFailure.stressSample.fps.toFixed(3)} FPS; P95 ${expectedFailure.stressSample.p95FrameTimeMs.toFixed(3)}ms; rejected (${expectedFailure.reasons.join(', ')})`);

  expectFailure('missing pass sample file', () => readJson(path.join(toolRoot, 'samples/does-not-exist.json'), 'missing pass sample'), /cannot be read|ENOENT/);
  const missingThreshold = structuredClone(config);
  delete missingThreshold.stress.maximumP95FrameTimeMs;
  expectFailure('missing production P95 threshold', () => performance.validateProductionConfiguration(missingThreshold), /maximum P95 frame time/);
  const illegalRenderer = { ...scenario, renderer: 'software' };
  expectFailure('illegal software renderer', () => performance.validateScenario(illegalRenderer), /GPU rendering/);
  expectFailure('FPS below release threshold', () => performance.validatePerformanceSample({ fps: performance.PERFORMANCE_LIMITS.minFps - 0.01, p95FrameTimeMs: 18 }), /below 55/);
  expectFailure('P95 above release threshold', () => performance.validatePerformanceSample({ fps: 60, p95FrameTimeMs: performance.PERFORMANCE_LIMITS.maxP95FrameTimeMs + 0.01 }), /exceeds 22/);
  expectFailure('short raw frame sample', () => validatePassSample({ ...passSample, frameTimesMs: passSample.frameTimesMs.slice(0, 119) }, scenario, performance), /at least 120 raw samples/);

  console.log('T327 counterexamples: PASS (missing file, missing field, illegal renderer, FPS/P95 bounds, short raw sample)');
  console.log('T327 verifier: PASS (the release decision remains BLOCKED by the real failing artifact)');
}

main().catch((error) => {
  console.error(`T327 verifier: FAIL (${error instanceof Error ? error.message : String(error)})`);
  process.exitCode = 1;
});
