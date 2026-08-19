import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const documentPath = fileURLToPath(new URL('./asset-layer-inventory.md', import.meta.url));
const repositoryRoot = path.resolve(path.dirname(documentPath), '../..');
const sourceRoot = path.join(repositoryRoot, '美术素材/UI全界面/Image2-v1-1920');
const canvas = { width: 1920, height: 1080 };
const layers = ['背景', '角色', '装饰', '九宫格', '图标', '文字', '状态'];
const layerCodes = { '背景': 'BG', '角色': 'CHR', '装饰': 'DEC', '九宫格': '9S', '图标': 'ICO', '文字': 'TXT', '状态': 'STA' };
const zByLayer = { '背景': 0, '角色': 1, '装饰': 2, '九宫格': 3, '图标': 4, '文字': 5, '状态': 6 };
const expectedSources = {
  UI01: 'UI01-主城.png', UI02: 'UI02-征战.png', UI03: 'UI03-卡库.png',
  UI04: 'UI04-编队.png', UI05: 'UI05-主将.png', UI06: 'UI06-历练.png',
  UI07: 'UI07-营造.png', UI08: 'UI08-任务.png', UI09: 'UI09-行囊.png',
};
const visualSourceRoot = '美术素材/UI全界面/Image2-v1-1920';

function inventoryFromMarkdown(markdown) {
  const start = '<!-- asset-layer-inventory:start -->';
  const end = '<!-- asset-layer-inventory:end -->';
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end);
  assert(startIndex !== -1 && endIndex > startIndex, 'inventory markers are missing or out of order');
  const payload = markdown.slice(startIndex + start.length, endIndex).trim();
  const match = payload.match(/^~~~json\s*\n([\s\S]+?)\n~~~$/);
  assert(match, 'inventory JSON fence is missing');
  return JSON.parse(match[1]);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

async function validateInventory(inventory) {
  const errors = [];
  if (!inventory || inventory.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Array.isArray(inventory?.screens)) errors.push('screens must be an array');
  if (errors.length) throw new Error(errors.join('; '));

  const screenIds = new Set();
  const recordIds = new Set();
  if (inventory.screens.length !== Object.keys(expectedSources).length) errors.push('screen count must be ' + Object.keys(expectedSources).length);
  for (const [id, source] of Object.entries(expectedSources)) {
    const screen = inventory.screens.find((candidate) => candidate.id === id);
    if (!screen) {
      errors.push('missing screen ' + id + ' for source ' + source);
    } else if (screen.source !== source) {
      errors.push('missing or incorrect source image for ' + id);
    } else {
      try {
        await fs.access(path.join(sourceRoot, source));
      } catch {
        errors.push('source image file is unavailable for ' + id);
      }
    }
  }

  for (const screen of inventory.screens) {
    if (screenIds.has(screen.id)) errors.push('duplicate screen ID ' + screen.id);
    screenIds.add(screen.id);
    if (!Object.hasOwn(expectedSources, screen.id)) {
      errors.push('unknown screen ID ' + screen.id);
      continue;
    }
    if (typeof screen.name !== 'string' || screen.name.length === 0) errors.push('screen name missing for ' + screen.id);
    if (!Array.isArray(screen.layers)) {
      errors.push('layers must be an array for ' + screen.id);
      continue;
    }
    if (screen.layers.length !== layers.length) errors.push('layer count must be ' + layers.length + ' for ' + screen.id);
    const seenLayers = new Set();
    const seenZ = new Set();
    for (const record of screen.layers) {
      if (!layers.includes(record.layer)) {
        errors.push('illegal layer ' + String(record.layer) + ' for ' + screen.id);
        continue;
      }
      if (seenLayers.has(record.layer)) errors.push('duplicate layer ' + record.layer + ' for ' + screen.id);
      seenLayers.add(record.layer);
      const expectedId = screen.id + '-' + layerCodes[record.layer] + '-01';
      if (record.id !== expectedId) errors.push('invalid record ID ' + String(record.id) + ' for ' + screen.id);
      if (recordIds.has(record.id)) errors.push('duplicate record ID ' + record.id);
      recordIds.add(record.id);
      if (record.source !== screen.source) errors.push('record source image missing or incorrect for ' + record.id);
      if (!['present', 'absent'].includes(record.availability)) errors.push('invalid availability for ' + record.id);
      if (typeof record.reusable !== 'boolean') errors.push('reusable must be boolean for ' + record.id);
      if (typeof record.verification !== 'string' || record.verification.trim().length === 0) errors.push('verification evidence missing for ' + record.id);
      if (record.availability === 'present' && (typeof record.asset !== 'string' || record.asset.trim().length === 0)) errors.push('present record lacks asset for ' + record.id);
      if (record.availability === 'absent' && (record.asset !== null || record.reusable !== false)) errors.push('absent record treated as an asset for ' + record.id);

      if (!(record.assetPath === null || typeof record.assetPath === 'string')) errors.push('assetPath must be a string or null for ' + record.id);
      if (!(record.assetId === null || typeof record.assetId === 'string')) errors.push('assetId must be a string or null for ' + record.id);
      if (record.availability === 'absent') {
        if (record.assetPath !== null || record.assetId !== null) errors.push('absent record has a structured asset source for ' + record.id);
      } else if (record.assetPath !== visualSourceRoot + '/' + screen.source || record.assetId !== null) {
        errors.push('present record must point to its visual source without a standalone asset ID for ' + record.id);
      }

      for (const field of ['x', 'y', 'width', 'height']) {
        if (!isFiniteNumber(record[field])) errors.push(field + ' must be a finite number for ' + record.id);
      }
      if (isFiniteNumber(record.x) && record.x < 0) errors.push('x must be non-negative for ' + record.id);
      if (isFiniteNumber(record.y) && record.y < 0) errors.push('y must be non-negative for ' + record.id);
      if (isFiniteNumber(record.width) && record.width <= 0) errors.push('width must be positive for ' + record.id);
      if (isFiniteNumber(record.height) && record.height <= 0) errors.push('height must be positive for ' + record.id);
      if (isFiniteNumber(record.x) && isFiniteNumber(record.width) && record.x + record.width > canvas.width) errors.push('x + width exceeds 1920 for ' + record.id);
      if (isFiniteNumber(record.y) && isFiniteNumber(record.height) && record.y + record.height > canvas.height) errors.push('y + height exceeds 1080 for ' + record.id);
      if (!Number.isInteger(record.z)) errors.push('z must be an integer for ' + record.id);
      if (Number.isInteger(record.z) && seenZ.has(record.z)) errors.push('z must be unique within ' + screen.id);
      if (Number.isInteger(record.z)) seenZ.add(record.z);
      if (record.z !== zByLayer[record.layer]) errors.push('z order does not match layer order for ' + record.id);
    }
    for (const layer of layers) {
      if (!seenLayers.has(layer)) errors.push('missing required layer ' + layer + ' for ' + screen.id);
    }
    if (seenZ.size !== Math.min(screen.layers.length, layers.length)) errors.push('each layer must have a unique z in ' + screen.id);
  }
  if (errors.length) throw new Error(errors.join('; '));
}

async function expectInvalid(label, mutate, expectedMessage) {
  const candidate = structuredClone(inventory);
  mutate(candidate);
  await assert.rejects(
    () => validateInventory(candidate),
    (error) => error instanceof Error && error.message.includes(expectedMessage),
    label + ' did not fail with ' + expectedMessage,
  );
}

const markdown = await fs.readFile(documentPath, 'utf8');
const inventory = inventoryFromMarkdown(markdown);
await validateInventory(inventory);

await expectInvalid('missing image', (candidate) => { candidate.screens[0].source = 'UI01-不存在.png'; }, 'missing or incorrect source image');
await expectInvalid('duplicate ID', (candidate) => { candidate.screens[0].layers[1].id = candidate.screens[0].layers[0].id; }, 'duplicate record ID');
await expectInvalid('illegal layer', (candidate) => { candidate.screens[0].layers[0].layer = '控件'; }, 'illegal layer');
await expectInvalid('missing state', (candidate) => { candidate.screens[0].layers = candidate.screens[0].layers.filter((record) => record.layer !== '状态'); }, 'missing required layer 状态');
await expectInvalid('absent treated as asset', (candidate) => { candidate.screens[1].layers.find((record) => record.layer === '角色').asset = '虚构角色立绘'; }, 'absent record treated as an asset');
await expectInvalid('missing record source', (candidate) => { candidate.screens[0].layers[0].source = null; }, 'record source image missing or incorrect');

await expectInvalid('illegal z', (candidate) => { candidate.screens[0].layers[1].z = 1.5; }, 'z must be an integer');
await expectInvalid('non-positive size', (candidate) => { candidate.screens[0].layers[0].width = 0; }, 'width must be positive');
await expectInvalid('out-of-bounds coordinates', (candidate) => { candidate.screens[0].layers[0].x = 1; candidate.screens[0].layers[0].width = 1920; }, 'x + width exceeds 1920');
await expectInvalid('missing structured source', (candidate) => { candidate.screens[0].layers[0].assetPath = null; }, 'present record must point to its visual source');

const layerCount = inventory.screens.reduce((count, screen) => count + screen.layers.length, 0);
console.log('Asset-layer inventory verification: PASS (' + inventory.screens.length + ' screens, ' + layerCount + ' layers, 10 negative cases rejected)');
