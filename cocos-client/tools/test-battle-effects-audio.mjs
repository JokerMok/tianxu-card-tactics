import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolsDir, '..');
const resourceRoot = path.join(projectRoot, 'assets', 'resources');
const effectsRoot = path.join(resourceRoot, 'art', 'battle', 'effects');
const audioRoot = path.join(resourceRoot, 'art', 'battle', 'audio');
const contractPath = path.join(effectsRoot, 'battle-effects-audio-contract.json');

const REQUIRED_CATEGORIES = Object.freeze([
  'attack',
  'spell',
  'heal',
  'hit',
  'death',
  'button',
  'settlement',
]);
const EVENT_BY_CATEGORY = Object.freeze({
  attack: 'attack.impact',
  spell: 'spell.resolve',
  heal: 'heal.pulse',
  hit: 'hit.impact',
  death: 'death.release',
  button: 'ui.button.activate',
  settlement: 'battle.settlement.reveal',
});
const EFFECT_MIN_BYTES = 1024;
const EFFECT_DIMENSION = 256;
const EFFECT_DURATION_MIN_MS = 80;
const EFFECT_DURATION_MAX_MS = 1200;
const AUDIO_MIN_BYTES = 1000;
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 1;
const AUDIO_BIT_DEPTH = 16;
const AUDIO_DURATION_MIN_MS = 80;
const AUDIO_DURATION_MAX_MS = 1000;

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  return value;
}

function requireNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  return value;
}

function requireOneOf(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} must be one of ${allowed.join(', ')}`);
  return value;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePng(buffer, label) {
  const signature = Buffer.from('\x89PNG\r\n\x1a\n', 'binary');
  if (!buffer.subarray(0, signature.length).equals(signature)) fail(`${label} is not a PNG`);
  let offset = signature.length;
  let header = null;
  const idat = [];
  let sawEnd = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (crcOffset + 4 > buffer.length) fail(`${label} has a truncated ${type} chunk`);
    const data = buffer.subarray(dataStart, dataEnd);
    const expectedCrc = buffer.readUInt32BE(crcOffset);
    const actualCrc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
    if (expectedCrc !== actualCrc) fail(`${label} has an invalid ${type} CRC`);
    if (type === 'IHDR') {
      if (length !== 13) fail(`${label} has an invalid IHDR length`);
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      sawEnd = true;
      break;
    }
    offset = crcOffset + 4;
  }
  if (!header || idat.length === 0 || !sawEnd) fail(`${label} is missing required PNG chunks`);
  if (header.bitDepth !== 8 || header.colorType !== 6 || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    fail(`${label} must be a non-interlaced 8-bit RGBA PNG`);
  }
  const rowLength = header.width * 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length !== (rowLength + 1) * header.height) fail(`${label} has invalid RGBA scanline length`);
  const rgba = Buffer.alloc(rowLength * header.height);
  let sourceOffset = 0;
  let previous = Buffer.alloc(rowLength);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    const current = Buffer.alloc(rowLength);
    for (let x = 0; x < rowLength; x += 1) {
      const rawValue = raw[sourceOffset + x];
      const left = x >= 4 ? current[x - 4] : 0;
      const above = previous[x];
      const upperLeft = x >= 4 ? previous[x - 4] : 0;
      if (filter === 0) current[x] = rawValue;
      else if (filter === 1) current[x] = (rawValue + left) & 0xff;
      else if (filter === 2) current[x] = (rawValue + above) & 0xff;
      else if (filter === 3) current[x] = (rawValue + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - upperLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
        current[x] = (rawValue + predictor) & 0xff;
      } else fail(`${label} uses unsupported PNG filter ${filter}`);
    }
    current.copy(rgba, y * rowLength);
    previous = current;
    sourceOffset += rowLength;
  }
  let alphaPixels = 0;
  let coloredPixels = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0) alphaPixels += 1;
    if (rgba[i] > 0 || rgba[i + 1] > 0 || rgba[i + 2] > 0) coloredPixels += 1;
  }
  if (alphaPixels === 0 || coloredPixels === 0) fail(`${label} must contain visible non-empty artwork`);
  return { ...header, alphaPixels, coloredPixels };
}

function parseWav(buffer, label) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') fail(`${label} must be RIFF/WAVE`);
  if (buffer.readUInt32LE(4) !== buffer.length - 8) fail(`${label} RIFF size does not match file size`);
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) fail(`${label} has a truncated ${type} chunk`);
    if (type === 'fmt ') {
      if (length < 16) fail(`${label} fmt chunk is too short`);
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitDepth: buffer.readUInt16LE(start + 14),
      };
    } else if (type === 'data') {
      data = buffer.subarray(start, end);
    }
    offset = end + (length % 2);
  }
  if (!format || !data) fail(`${label} is missing fmt or data chunk`);
  if (format.audioFormat !== 1 || format.channels !== AUDIO_CHANNELS || format.sampleRate !== AUDIO_SAMPLE_RATE || format.bitDepth !== AUDIO_BIT_DEPTH) {
    fail(`${label} must be PCM ${AUDIO_SAMPLE_RATE}Hz/${AUDIO_CHANNELS}ch/${AUDIO_BIT_DEPTH}bit`);
  }
  if (format.blockAlign !== 2 || format.byteRate !== AUDIO_SAMPLE_RATE * 2 || data.length === 0 || data.length % 2 !== 0) {
    fail(`${label} has invalid PCM block alignment`);
  }
  let peak = 0;
  for (let i = 0; i < data.length; i += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
  if (peak === 0) fail(`${label} must contain non-silent audio`);
  return {
    ...format,
    dataBytes: data.length,
    durationMs: data.length / 2 / AUDIO_SAMPLE_RATE * 1000,
    peak,
  };
}

function validatePath(asset, label) {
  const resourcePath = requireString(asset.resourcePath, `${label}.resourcePath`);
  if (resourcePath.includes('\\') || resourcePath.includes('\0') || path.posix.isAbsolute(resourcePath)) fail(`${label}.resourcePath is not a safe relative path`);
  if (resourcePath !== path.posix.normalize(resourcePath) || resourcePath.split('/').includes('..')) fail(`${label}.resourcePath must not contain traversal`);
  if (/(?:preview|pose|placeholder|dummy|stub)/i.test(resourcePath)) fail(`${label}.resourcePath cannot point to a placeholder asset`);
  const expectedPrefix = asset.kind === 'effect' ? 'art/battle/effects/' : 'art/battle/audio/';
  if (!resourcePath.startsWith(expectedPrefix)) fail(`${label}.resourcePath must stay under ${expectedPrefix}`);
  if (path.posix.basename(resourcePath) !== asset.fileName) fail(`${label}.fileName must match resourcePath basename`);
  const root = asset.kind === 'effect' ? effectsRoot : audioRoot;
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resourceRoot, ...resourcePath.split('/'));
  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) fail(`${label}.resourcePath escapes its asset root`);
  if (!fs.existsSync(resolvedPath)) fail(`${label}.resourcePath does not exist: ${resourcePath}`);
  const stat = fs.lstatSync(resolvedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label}.resourcePath must be a regular file`);
  return resolvedPath;
}

function validateAsset(asset, index, validation) {
  const label = `assets[${index}]`;
  requireRecord(asset, label);
  const id = requireString(asset.id, `${label}.id`);
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(id)) fail(`${label}.id has invalid format`);
  const category = requireOneOf(asset.category, REQUIRED_CATEGORIES, `${label}.category`);
  const kind = requireOneOf(asset.kind, ['effect', 'audio'], `${label}.kind`);
  const expectedFormat = kind === 'effect' ? 'png' : 'wav';
  if (asset.format !== expectedFormat) fail(`${label}.format must be ${expectedFormat}`);
  const fileName = requireString(asset.fileName, `${label}.fileName`);
  if (!fileName.endsWith(`.${expectedFormat}`)) fail(`${label}.fileName must use .${expectedFormat}`);
  const filePath = validatePath(asset, label);
  const stat = fs.statSync(filePath);
  const minimumBytes = kind === 'effect' ? validation.effect.minBytes : validation.audio.minBytes;
  if (stat.size < minimumBytes) fail(`${label} is below the non-empty asset size threshold`);
  if (stat.size !== asset.bytes) fail(`${label}.bytes does not match the source file`);
  if (sha256(filePath) !== asset.sha256) fail(`${label}.sha256 does not match the source file`);
  const durationMs = requireNumber(asset.durationMs, `${label}.durationMs`);
  const durationLimits = kind === 'effect' ? validation.effect.durationMs : validation.audio.durationMs;
  if (durationMs < durationLimits.min || durationMs > durationLimits.max) fail(`${label}.durationMs is outside the allowed range`);
  requireRecord(asset.event, `${label}.event`);
  if (asset.event.type !== EVENT_BY_CATEGORY[category]) fail(`${label}.event.type does not match category event`);
  const eventAtMs = requireInteger(asset.event.atMs, `${label}.event.atMs`);
  if (eventAtMs <= 0 || eventAtMs >= durationMs) fail(`${label}.event.atMs must be inside the asset duration`);
  requireRecord(asset.runtime, `${label}.runtime`);
  requireString(asset.usage, `${label}.usage`);
  if (asset.productionTask !== 'T251') fail(`${label}.productionTask must be T251`);

  if (kind === 'effect') {
    requireRecord(asset.dimensions, `${label}.dimensions`);
    if (asset.dimensions.width !== validation.effect.width || asset.dimensions.height !== validation.effect.height) fail(`${label}.dimensions must be ${validation.effect.width}x${validation.effect.height}`);
    requireString(asset.runtime.anchor, `${label}.runtime.anchor`);
    requireString(asset.runtime.direction, `${label}.runtime.direction`);
    requireString(asset.runtime.coverage, `${label}.runtime.coverage`);
    requireOneOf(asset.runtime.blend, ['alpha', 'additive'], `${label}.runtime.blend`);
    const maxAlpha = requireNumber(asset.runtime.maxAlpha, `${label}.runtime.maxAlpha`);
    if (maxAlpha <= 0 || maxAlpha > 1) fail(`${label}.runtime.maxAlpha must be in (0, 1]`);
    const png = parsePng(fs.readFileSync(filePath), label);
    if (png.width !== validation.effect.width || png.height !== validation.effect.height) fail(`${label} PNG dimensions do not match contract`);
    return { ...asset, actualDurationMs: durationMs };
  }

  requireString(asset.runtime.mixGroup, `${label}.runtime.mixGroup`);
  if (typeof asset.runtime.spatial !== 'boolean') fail(`${label}.runtime.spatial must be boolean`);
  const priority = requireInteger(asset.runtime.priority, `${label}.runtime.priority`);
  if (priority < 0 || priority > 100) fail(`${label}.runtime.priority must be between 0 and 100`);
  const wav = parseWav(fs.readFileSync(filePath), label);
  if (Math.abs(wav.durationMs - durationMs) > 0.001) fail(`${label}.durationMs does not match WAV data duration`);
  if (wav.durationMs < validation.audio.durationMs.min || wav.durationMs > validation.audio.durationMs.max) fail(`${label} WAV data duration is outside the allowed range`);
  return { ...asset, actualDurationMs: wav.durationMs };
}

function validateThresholds(validation) {
  requireRecord(validation, 'validation');
  if (!Array.isArray(validation.requiredCategories) || validation.requiredCategories.join('|') !== REQUIRED_CATEGORIES.join('|')) fail('validation.requiredCategories must cover all seven feedback categories in order');
  requireRecord(validation.effect, 'validation.effect');
  requireRecord(validation.audio, 'validation.audio');
  if (validation.effect.format !== 'png' || validation.effect.minBytes < EFFECT_MIN_BYTES || validation.effect.width !== EFFECT_DIMENSION || validation.effect.height !== EFFECT_DIMENSION) fail('validation.effect weakens the required PNG contract');
  if (validation.effect.durationMs.min < EFFECT_DURATION_MIN_MS || validation.effect.durationMs.max > EFFECT_DURATION_MAX_MS) fail('validation.effect duration range is weaker than the required gate');
  if (validation.audio.format !== 'wav' || validation.audio.minBytes < AUDIO_MIN_BYTES || validation.audio.sampleRate !== AUDIO_SAMPLE_RATE || validation.audio.channels !== AUDIO_CHANNELS || validation.audio.bitDepth !== AUDIO_BIT_DEPTH) fail('validation.audio weakens the required WAV contract');
  if (validation.audio.durationMs.min < AUDIO_DURATION_MIN_MS || validation.audio.durationMs.max > AUDIO_DURATION_MAX_MS) fail('validation.audio duration range is weaker than the required gate');
}

function validateContract(contract) {
  requireRecord(contract, 'contract');
  if (contract.schemaVersion !== 1) fail('contract.schemaVersion must be 1');
  if (contract.contractId !== 'T251-BATTLE-FEEDBACK') fail('contract.contractId is invalid');
  requireString(contract.contractVersion, 'contract.contractVersion');
  if (contract.engine !== 'Cocos Creator 3.8.8') fail('contract.engine is invalid');
  if (contract.resourceRoot !== 'assets/resources') fail('contract.resourceRoot is invalid');
  if (contract.productionTask !== 'T251') fail('contract.productionTask must be T251');
  validateThresholds(contract.validation);
  if (!Array.isArray(contract.assets) || contract.assets.length !== REQUIRED_CATEGORIES.length * 2) fail('contract.assets must contain exactly one effect and one audio asset for each category');
  const ids = new Set();
  const byCategory = new Map(REQUIRED_CATEGORIES.map((category) => [category, []]));
  for (let index = 0; index < contract.assets.length; index += 1) {
    const asset = validateAsset(contract.assets[index], index, contract.validation);
    if (ids.has(asset.id)) fail(`duplicate asset id: ${asset.id}`);
    ids.add(asset.id);
    byCategory.get(asset.category).push(asset);
  }
  for (const category of REQUIRED_CATEGORIES) {
    const assets = byCategory.get(category);
    if (assets.length !== 2 || assets.filter((asset) => asset.kind === 'effect').length !== 1 || assets.filter((asset) => asset.kind === 'audio').length !== 1) fail(`${category} must have exactly one effect and one audio asset`);
  }
  if (!Array.isArray(contract.samples) || contract.samples.length !== REQUIRED_CATEGORIES.length) fail('contract.samples must contain one executable sample per category');
  const sampleIds = new Set();
  for (let index = 0; index < contract.samples.length; index += 1) {
    const sample = requireRecord(contract.samples[index], `samples[${index}]`);
    const sampleId = requireString(sample.id, `samples[${index}].id`);
    if (!/^SAMPLE-[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(sampleId) || sampleIds.has(sampleId)) fail(`samples[${index}].id is invalid or duplicated`);
    sampleIds.add(sampleId);
    const category = requireOneOf(sample.category, REQUIRED_CATEGORIES, `samples[${index}].category`);
    if (sample.trigger !== EVENT_BY_CATEGORY[category]) fail(`samples[${index}].trigger does not match category event`);
    requireString(sample.target, `samples[${index}].target`);
    const categoryAssets = byCategory.get(category);
    const effect = categoryAssets.find((asset) => asset.kind === 'effect');
    const audio = categoryAssets.find((asset) => asset.kind === 'audio');
    if (sample.effectId !== effect.id || sample.audioId !== audio.id) fail(`samples[${index}] does not reference the category's effect and audio`);
    if (effect.event.type !== sample.trigger || audio.event.type !== sample.trigger) fail(`samples[${index}] event references are inconsistent`);
  }
  return { assetCount: contract.assets.length, sampleCount: contract.samples.length };
}

function clone(value) {
  return structuredClone(value);
}

function expectFailure(label, mutate, pattern) {
  const candidate = clone(contract);
  mutate(candidate);
  assert.throws(() => validateContract(candidate), pattern, `${label} must be rejected`);
  console.log(`  negative PASS: ${label}`);
}

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const summary = validateContract(contract);
console.log(`Battle effects/audio contract: ${summary.assetCount} real assets, ${summary.sampleCount} executable samples PASS`);

expectFailure('missing asset entry', (candidate) => {
  candidate.assets = candidate.assets.filter((asset) => asset.category !== 'death' || asset.kind !== 'effect');
}, /exactly one effect and one audio asset|exactly one effect and one audio/);
expectFailure('missing resource path', (candidate) => {
  const asset = candidate.assets.find((entry) => entry.kind === 'effect');
  asset.resourcePath = 'art/battle/effects/missing.png';
  asset.fileName = 'missing.png';
}, /does not exist/);
expectFailure('illegal traversal path', (candidate) => {
  candidate.assets.find((asset) => asset.kind === 'audio').resourcePath = 'art/battle/audio/../effects/vfx_attack_slash_v001.png';
}, /traversal|safe relative path/);
expectFailure('illegal format', (candidate) => {
  candidate.assets.find((asset) => asset.kind === 'effect').format = 'svg';
}, /format must be png/);
expectFailure('duration too short', (candidate) => {
  candidate.assets.find((asset) => asset.kind === 'audio').durationMs = 40;
}, /durationMs is outside/);
expectFailure('event type mismatch', (candidate) => {
  candidate.assets.find((asset) => asset.category === 'heal' && asset.kind === 'effect').event.type = 'hit.impact';
}, /event.type does not match/);
expectFailure('event outside duration', (candidate) => {
  const asset = candidate.assets.find((entry) => entry.category === 'death' && entry.kind === 'audio');
  asset.event.atMs = asset.durationMs;
}, /event.atMs must be inside/);
expectFailure('hash mismatch', (candidate) => {
  candidate.assets.find((asset) => asset.category === 'button' && asset.kind === 'audio').sha256 = '0'.repeat(64);
}, /sha256 does not match/);

console.log('Battle effects/audio contract negatives: missing, path, format, duration, event and hash rejection PASS');
