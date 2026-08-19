import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const expectedRuntimeAssets = {
  UI01: { assetPath: 'cocos-client/assets/resources/ui/image2/UI01-home.png', resourcePath: 'ui/image2/UI01-home/spriteFrame', assetId: '1479317e-dbec-4396-ba9f-d4784797edf9', sourceSha256: '302460789161231daeed324b22dda5bd61bd0a9aa1a21854208ed81e113eb750' },
  UI02: { assetPath: 'cocos-client/assets/resources/ui/image2/UI02-campaign.png', resourcePath: 'ui/image2/UI02-campaign/spriteFrame', assetId: '8b74bf8c-6961-4dd0-b50f-492e928a3ae6', sourceSha256: 'b73a4af1ac2a917d4a89f7dddd197efb1cc040d4ad4ed2603901ef3aa48dfa0b' },
  UI03: { assetPath: 'cocos-client/assets/resources/ui/image2/UI03-cards.png', resourcePath: 'ui/image2/UI03-cards/spriteFrame', assetId: '49e0cd70-f507-4fa5-a36f-07d4da8a0325', sourceSha256: 'dcdf2ebab28c2a8d1198844b5424854c669ceb5753f0422d2a3e3f5ac64061ef' },
  UI04: { assetPath: 'cocos-client/assets/resources/ui/image2/UI04-deck.png', resourcePath: 'ui/image2/UI04-deck/spriteFrame', assetId: '12c50cfd-85ad-4f43-87be-5bf0361c913e', sourceSha256: '0b93ceacfac4e9d8bd982356353f630ade7e28a6e41d4f3522fa46bdc6dbb0aa' },
  UI05: { assetPath: 'cocos-client/assets/resources/ui/image2/UI05-hero.png', resourcePath: 'ui/image2/UI05-hero/spriteFrame', assetId: 'b6adff5d-ea92-4278-bed9-7ad78f3f7705', sourceSha256: 'f23cc606cfa88d18963bac1afe639b2cd1ffc2751473fb650b13eef504f371ee' },
  UI06: { assetPath: 'cocos-client/assets/resources/ui/image2/UI06-adventure.png', resourcePath: 'ui/image2/UI06-adventure/spriteFrame', assetId: '5ca7cb83-f69d-494e-a099-593767af3e0e', sourceSha256: '491ffc89f2b548e3805c8ea47e0a00cbd36441ffb66d9fdb7b60fb9d238d06cd' },
  UI07: { assetPath: 'cocos-client/assets/resources/ui/image2/UI07-city.png', resourcePath: 'ui/image2/UI07-city/spriteFrame', assetId: '0eab0bb0-f9d9-4283-96ad-8cbd6a83d292', sourceSha256: '4e52b600caff5cfd4abfdf629f84e6c8d829820e1f2ed02766dc4faa72d1a876' },
  UI08: { assetPath: 'cocos-client/assets/resources/ui/image2/UI08-tasks.png', resourcePath: 'ui/image2/UI08-tasks/spriteFrame', assetId: '4431439e-fb12-43b4-8c6c-85493fe5e557', sourceSha256: 'd02fdb49cf3d82dc3926186b113fcfcea4fd444a861110f2985e72e73d01cf6c' },
  UI09: { assetPath: 'cocos-client/assets/resources/ui/image2/UI09-inventory.png', resourcePath: 'ui/image2/UI09-inventory/spriteFrame', assetId: '103fc9ed-1b08-4c98-8ce9-a2fc49150d00', sourceSha256: 'fbb355a9b4aed6c12ef5068c36e2070c05150bbe4d25ce2b869fb0cbc6a37582' },
};
const expectedReactObservedAssets = [
  'web-prototype/public/assets/commanders/player.webp',
  'web-prototype/public/assets/commanders/enemy.webp',
];
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

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false;
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return false;
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isInsideRepository(relativePath) {
  const resolved = path.resolve(repositoryRoot, relativePath);
  return resolved === repositoryRoot || resolved.startsWith(repositoryRoot + path.sep);
}

async function validateFilePath(relativePath, label, errors, { png = false } = {}) {
  if (!isSafeRelativePath(relativePath) || !isInsideRepository(relativePath)) {
    errors.push('illegal asset path for ' + label);
    return;
  }
  const absolutePath = path.resolve(repositoryRoot, relativePath);
  let bytes;
  try {
    bytes = await fs.readFile(absolutePath);
  } catch {
    errors.push('asset file is unavailable for ' + label);
    return;
  }
  if (png) {
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const width = bytes.length >= 24 ? bytes.readUInt32BE(16) : null;
    const height = bytes.length >= 24 ? bytes.readUInt32BE(20) : null;
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature) || width !== canvas.width || height !== canvas.height) {
      errors.push('PNG asset must be 1920x1080 for ' + label);
    }
  }
}

async function validateMatchingFiles(leftPath, rightPath, label, errors) {
  if (!isSafeRelativePath(leftPath) || !isSafeRelativePath(rightPath) || !isInsideRepository(leftPath) || !isInsideRepository(rightPath)) {
    errors.push('illegal asset path for ' + label);
    return;
  }
  try {
    const [left, right] = await Promise.all([
      fs.readFile(path.resolve(repositoryRoot, leftPath)),
      fs.readFile(path.resolve(repositoryRoot, rightPath)),
    ]);
    const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    if (digest(left) !== digest(right)) errors.push('asset content mismatch for ' + label);
  } catch {
    errors.push('asset file is unavailable for ' + label);
  }
}

async function validateSha256(relativePath, expectedDigest, label, errors) {
  if (!isSafeRelativePath(relativePath) || !isInsideRepository(relativePath)) {
    errors.push('illegal asset path for ' + label);
    return;
  }
  try {
    const bytes = await fs.readFile(path.resolve(repositoryRoot, relativePath));
    const actualDigest = createHash('sha256').update(bytes).digest('hex');
    if (actualDigest !== expectedDigest) errors.push('source SHA-256 mismatch for ' + label);
  } catch {
    errors.push('asset file is unavailable for ' + label);
  }
}

async function validateMetaUuid(assetPath, expectedUuid, label, errors) {
  const metaPath = assetPath + '.meta';
  if (!isSafeRelativePath(metaPath) || !isInsideRepository(metaPath)) {
    errors.push('illegal asset path for ' + label);
    return;
  }
  try {
    const metadata = JSON.parse(await fs.readFile(path.resolve(repositoryRoot, metaPath), 'utf8'));
    if (metadata.uuid !== expectedUuid) errors.push('.meta UUID mismatch for ' + label);
  } catch {
    errors.push('.meta file is unavailable for ' + label);
  }
}

function validateRuntime(runtime, screenId, errors) {
  const expected = expectedRuntimeAssets[screenId];
  if (!runtime || typeof runtime !== 'object') {
    errors.push('runtime mapping missing for ' + screenId);
    return [];
  }
  const cocos = runtime.cocos;
  const hasCocosAssetPath = typeof cocos?.assetPath === 'string' && cocos.assetPath.length > 0;
  if (!cocos || cocos.availability !== 'present' || !hasCocosAssetPath) errors.push('Cocos runtime asset missing for ' + screenId);
  if (hasCocosAssetPath && cocos.assetPath !== expected.assetPath) errors.push('invalid Cocos runtime asset path for ' + screenId);
  if (hasCocosAssetPath && !isSafeRelativePath(cocos.assetPath)) errors.push('illegal asset path for Cocos runtime ' + screenId);
  if (cocos?.resourcePath !== expected.resourcePath) errors.push('invalid Cocos resource path for ' + screenId);
  if (!isSafeRelativePath(cocos?.resourcePath)) errors.push('illegal resource path for Cocos runtime ' + screenId);
  if (cocos?.assetId !== expected.assetId) errors.push('Cocos asset ID mismatch for ' + screenId);
  if (cocos?.sourceSha256 !== expected.sourceSha256) errors.push('source SHA-256 declaration mismatch for ' + screenId);

  const react = runtime.react;
  if (!react || react.availability !== 'absent') errors.push('React UI asset must be absent for ' + screenId);
  if (react?.assetPath !== null || react?.resourcePath !== null || react?.assetId !== null) errors.push('React UI asset path and ID must be null for ' + screenId);
  if (typeof react?.verification !== 'string' || react.verification.trim().length === 0) errors.push('React absence evidence missing for ' + screenId);
  return expected;
}

async function validateInventory(inventory) {
  const errors = [];
  if (!inventory || inventory.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Array.isArray(inventory?.screens)) errors.push('screens must be an array');
  if (errors.length) throw new Error(errors.join('; '));

  if (!Array.isArray(inventory.reactObservedAssets) || inventory.reactObservedAssets.length !== expectedReactObservedAssets.length) {
    errors.push('React observed asset inventory must contain exactly ' + expectedReactObservedAssets.length + ' files');
  } else {
    const observedPaths = new Set();
    for (const asset of inventory.reactObservedAssets) {
      if (!asset || typeof asset !== 'object') {
        errors.push('React observed asset record must be an object');
        continue;
      }
      if (observedPaths.has(asset.assetPath)) errors.push('duplicate React observed asset path ' + asset.assetPath);
      observedPaths.add(asset.assetPath);
      if (asset.screenAsset !== false) errors.push('React observed asset must not be classified as a screen asset ' + asset.assetPath);
      if (typeof asset.scope !== 'string' || asset.scope.trim().length === 0) errors.push('React observed asset scope missing for ' + asset.assetPath);
      if (!expectedReactObservedAssets.includes(asset.assetPath)) errors.push('unexpected React observed asset path ' + asset.assetPath);
      await validateFilePath(asset.assetPath, 'React observed asset ' + asset.assetPath, errors);
    }
    for (const expectedPath of expectedReactObservedAssets) {
      if (!observedPaths.has(expectedPath)) errors.push('missing React observed asset ' + expectedPath);
    }
  }

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
    const expectedRuntime = validateRuntime(screen.runtime, screen.id, errors);
    if (expectedRuntime && isSafeRelativePath(screen.runtime?.cocos?.assetPath)) {
      await validateFilePath(screen.runtime.cocos.assetPath, 'Cocos runtime ' + screen.id, errors, { png: true });
      await validateMetaUuid(screen.runtime.cocos.assetPath, expectedRuntime.assetId, 'Cocos runtime ' + screen.id, errors);
      await validateSha256(screen.runtime.cocos.assetPath, expectedRuntime.sourceSha256, 'Cocos runtime ' + screen.id, errors);
      await validateMatchingFiles(
        visualSourceRoot + '/' + expectedSources[screen.id],
        screen.runtime.cocos.assetPath,
        'Cocos/source mapping ' + screen.id,
        errors,
      );
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
      if (record.assetPath !== null && !isSafeRelativePath(record.assetPath)) errors.push('illegal asset path for ' + record.id);
      if (record.availability === 'absent') {
        if (record.assetPath !== null || record.assetId !== null) errors.push('absent record has a structured asset source for ' + record.id);
      } else if (record.assetPath !== visualSourceRoot + '/' + screen.source || record.assetId !== null) {
        errors.push('present record must point to its visual source without a standalone asset ID for ' + record.id);
      } else {
        await validateFilePath(record.assetPath, 'visual source for ' + record.id, errors, { png: true });
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
await expectInvalid('missing Cocos runtime asset', (candidate) => { candidate.screens[0].runtime.cocos.assetPath = null; }, 'Cocos runtime asset missing');
await expectInvalid('wrong Cocos asset ID', (candidate) => { candidate.screens[0].runtime.cocos.assetId = 'not-a-cocos-uuid'; }, 'Cocos asset ID mismatch');
await expectInvalid('wrong source SHA-256', (candidate) => { candidate.screens[0].runtime.cocos.sourceSha256 = '0'.repeat(64); }, 'source SHA-256 declaration mismatch');
await expectInvalid('illegal layer asset path', (candidate) => { candidate.screens[0].layers[0].assetPath = '../outside.png'; }, 'illegal asset path');
await expectInvalid('duplicate React observed asset', (candidate) => { candidate.reactObservedAssets[1].assetPath = candidate.reactObservedAssets[0].assetPath; }, 'duplicate React observed asset path');

await expectInvalid('illegal z', (candidate) => { candidate.screens[0].layers[1].z = 1.5; }, 'z must be an integer');
await expectInvalid('non-positive size', (candidate) => { candidate.screens[0].layers[0].width = 0; }, 'width must be positive');
await expectInvalid('out-of-bounds coordinates', (candidate) => { candidate.screens[0].layers[0].x = 1; candidate.screens[0].layers[0].width = 1920; }, 'x + width exceeds 1920');
await expectInvalid('missing structured source', (candidate) => { candidate.screens[0].layers[0].assetPath = null; }, 'present record must point to its visual source');

const layerCount = inventory.screens.reduce((count, screen) => count + screen.layers.length, 0);
console.log('Asset-layer inventory verification: PASS (' + inventory.screens.length + ' screens, ' + layerCount + ' layers, 16 negative cases rejected)');
