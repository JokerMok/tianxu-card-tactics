import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const documentPath = fileURLToPath(new URL('./asset-layer-inventory.md', import.meta.url));
const repositoryRoot = path.resolve(path.dirname(documentPath), '../..');
const sourceRoot = path.join(repositoryRoot, '美术素材/UI全界面/Image2-v1-1920');
const gameShellPath = path.join(repositoryRoot, 'cocos-client/assets/scripts/meta/GameShell.ts');
const reactRoot = path.join(repositoryRoot, 'web-prototype');
const reactEvidenceDirectories = ['src', 'public'];
const reactEvidencePrefixes = reactEvidenceDirectories.map((directory) => directory + '/');
const canvas = { width: 1920, height: 1080 };
const layers = ['背景', '角色', '装饰', '九宫格', '图标', '文字', '状态'];
const layerCodes = { '背景': 'BG', '角色': 'CHR', '装饰': 'DEC', '九宫格': '9S', '图标': 'ICO', '文字': 'TXT', '状态': 'STA' };
const zByLayer = { '背景': 0, '角色': 1, '装饰': 2, '九宫格': 3, '图标': 4, '文字': 5, '状态': 6 };
const expectedSources = {
  UI01: 'UI01-主城.png', UI02: 'UI02-征战.png', UI03: 'UI03-卡库.png',
  UI04: 'UI04-编队.png', UI05: 'UI05-主将.png', UI06: 'UI06-历练.png',
  UI07: 'UI07-营造.png', UI08: 'UI08-任务.png', UI09: 'UI09-行囊.png',
};
const expectedCocos = {
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
  { assetPath: 'web-prototype/public/assets/commanders/player.webp', scope: '战斗原型角色图', screenAsset: false },
  { assetPath: 'web-prototype/public/assets/commanders/enemy.webp', scope: '战斗原型角色图', screenAsset: false },
];
const visualSourceRoot = '美术素材/UI全界面/Image2-v1-1920';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeRepositoryPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.includes('\0') || value.includes('\\')) return false;
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

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

async function fileSha256(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function readPngDimensions(filePath) {
  const bytes = await fs.readFile(filePath);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function isReactEvidencePath(relativePath) {
  return reactEvidencePrefixes.some((prefix) => relativePath.startsWith(prefix));
}

async function findReactUiEvidence(scanRoot = reactRoot) {
  const evidence = [];
  const sourceMarker = /Image2-v1-1920|UI0[1-9]-(?:主城|征战|卡库|编队|主将|历练|营造|任务|行囊)\.png|ui\/image2\/UI0[1-9](?=$|[\/_-])|UI0[1-9](?:[-_][A-Za-z0-9][A-Za-z0-9_-]*)+\.(?:png|jpe?g|webp|svg)\b|(?:\b(?:const|let|var|function|class)\s+UI0[1-9]\b|\bUI0[1-9]\s*[:=]|\b(?:id|key|screen|screenId|asset|assetId|source|image|route)\s*[:=]\s*[\"'`]?UI0[1-9]\b)/i;
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(scanRoot, fullPath).split(path.sep).join('/');
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      const looksLikeUiAsset = /^UI0[1-9](?:[-_.]|$)/i.test(entry.name) || relativePath.includes('Image2-v1-1920');
      if (isReactEvidencePath(relativePath) && looksLikeUiAsset) evidence.push(relativePath);
      if (/\.(?:css|html|js|jsx|json|md|ts|tsx)$/.test(entry.name)) {
        const content = await fs.readFile(fullPath, 'utf8');
        if (isReactEvidencePath(relativePath) && sourceMarker.test(content)) evidence.push(relativePath + ' (reference)');
      }
    }
  }
  for (const directory of reactEvidenceDirectories) await walk(path.join(scanRoot, directory));
  return [...new Set(evidence)];
}

async function validateObservedReactAssets(inventory, errors) {
  if (!Array.isArray(inventory.reactObservedAssets)) {
    errors.push('reactObservedAssets must be an array');
    return;
  }
  if (inventory.reactObservedAssets.length !== expectedReactObservedAssets.length) {
    errors.push('reactObservedAssets count must be ' + expectedReactObservedAssets.length);
  }
  const seenPaths = new Set();
  for (const observed of inventory.reactObservedAssets) {
    if (!isRecord(observed)) {
      errors.push('React observed asset record must be an object');
      continue;
    }
    if (seenPaths.has(observed.assetPath)) errors.push('duplicate React observed asset path ' + observed.assetPath);
    seenPaths.add(observed.assetPath);
    if (!expectedReactObservedAssets.some((expected) => expected.assetPath === observed.assetPath)) {
      errors.push('unexpected React observed asset path ' + observed.assetPath);
    }
    if (!isSafeRepositoryPath(observed.assetPath)) errors.push('React asset path must be repository-relative: ' + String(observed.assetPath));
    try {
      await fs.access(path.join(repositoryRoot, observed.assetPath));
    } catch {
      errors.push('observed React asset file is unavailable: ' + String(observed.assetPath));
    }
  }
  for (const expected of expectedReactObservedAssets) {
    const observed = inventory.reactObservedAssets.find((candidate) => candidate?.assetPath === expected.assetPath);
    if (!observed) {
      errors.push('missing observed React asset ' + expected.assetPath);
      continue;
    }
    if (observed.scope !== expected.scope) errors.push('incorrect React asset scope for ' + expected.assetPath);
    if (observed.screenAsset !== expected.screenAsset) errors.push('React commander asset cannot be a screen asset: ' + expected.assetPath);
  }
}

async function validateCocosRuntime(screen, expectedSource, gameShellSource, usedCocosPaths, usedCocosIds, errors) {
  const runtime = screen.runtime;
  if (!isRecord(runtime) || !isRecord(runtime.cocos)) {
    errors.push('Cocos runtime record is missing for ' + screen.id);
    return;
  }
  const cocos = runtime.cocos;
  const expected = expectedCocos[screen.id];
  if (cocos.availability !== 'present') errors.push('Cocos runtime must be present for ' + screen.id);
  const hasCocosAssetPath = typeof cocos.assetPath === 'string' && cocos.assetPath.length > 0;
  if (!hasCocosAssetPath) {
    errors.push('Cocos runtime asset missing for ' + screen.id);
  } else if (!isSafeRepositoryPath(cocos.assetPath)) {
    errors.push('Cocos assetPath must be a safe repository-relative path for ' + screen.id);
  } else {
    if (usedCocosPaths.has(cocos.assetPath)) errors.push('duplicate Cocos runtime asset path ' + cocos.assetPath);
    usedCocosPaths.add(cocos.assetPath);
  }
  if (cocos.assetPath !== expected.assetPath) errors.push('Cocos assetPath mismatch for ' + screen.id);
  if (cocos.resourcePath !== expected.resourcePath) errors.push('Cocos resourcePath mismatch for ' + screen.id);
  if (!isSafeRepositoryPath(cocos.resourcePath)) errors.push('Cocos resourcePath must be a safe repository-relative path for ' + screen.id);
  if (!uuidPattern.test(String(cocos.assetId))) errors.push('Cocos assetId must be a UUID for ' + screen.id);
  if (usedCocosIds.has(cocos.assetId)) errors.push('duplicate Cocos assetId ' + String(cocos.assetId));
  usedCocosIds.add(cocos.assetId);
  if (cocos.assetId !== expected.assetId) errors.push('Cocos assetId mismatch for ' + screen.id);
  if (!sha256Pattern.test(String(cocos.sourceSha256))) errors.push('Cocos sourceSha256 must be SHA-256 for ' + screen.id);
  if (cocos.sourceSha256 !== expected.sourceSha256) errors.push('source SHA-256 declaration mismatch for ' + screen.id);
  if (!gameShellSource.includes("'" + expected.resourcePath + "'")) errors.push('GameShell resource mapping missing for ' + screen.id);

  if (!hasCocosAssetPath || !isSafeRepositoryPath(cocos.assetPath)) return;
  const cocosAssetFile = path.join(repositoryRoot, cocos.assetPath);
  try {
    const [cocosHash, sourceHash, cocosSize, sourceSize, meta] = await Promise.all([
      fileSha256(cocosAssetFile),
      fileSha256(path.join(sourceRoot, expectedSource)),
      readPngDimensions(cocosAssetFile),
      readPngDimensions(path.join(sourceRoot, expectedSource)),
      fs.readFile(cocosAssetFile + '.meta', 'utf8').then((value) => JSON.parse(value)),
    ]);
    if (cocosHash !== sourceHash) errors.push('Cocos UI image differs from its visual source for ' + screen.id);
    if (sourceHash !== expected.sourceSha256) errors.push('source SHA-256 mismatch for ' + screen.id);
    if (cocos.sourceSha256 !== sourceHash) errors.push('Cocos sourceSha256 mismatch for ' + screen.id);
    for (const [label, size] of [['Cocos', cocosSize], ['source', sourceSize]]) {
      if (size.width !== canvas.width || size.height !== canvas.height) errors.push(label + ' UI image must be 1920x1080 for ' + screen.id);
    }
    if (!isRecord(meta) || meta.uuid !== expected.assetId) errors.push('Cocos .meta UUID mismatch for ' + screen.id);
  } catch {
    errors.push('Cocos UI image, source, or .meta file is unavailable for ' + screen.id);
  }
}

async function validateReactRuntime(screen, reactUiEvidence, errors) {
  const runtime = screen.runtime;
  if (!isRecord(runtime) || !isRecord(runtime.react)) {
    errors.push('React runtime record is missing for ' + screen.id);
    return;
  }
  const react = runtime.react;
  if (react.availability !== 'absent') errors.push('React runtime UI asset must be absent for ' + screen.id);
  for (const field of ['assetPath', 'resourcePath', 'assetId']) {
    if (react[field] !== null) errors.push('React runtime ' + field + ' must be null for absent ' + screen.id);
  }
  if (typeof react.verification !== 'string' || react.verification.trim().length === 0) {
    errors.push('React missing-asset evidence is required for ' + screen.id);
  }
  if (reactUiEvidence.length) {
    errors.push('React UI asset/reference found while inventory says absent: ' + reactUiEvidence.join(', '));
  }
}

async function validateInventory(inventory, gameShellSource, reactUiEvidence) {
  const errors = [];
  if (!inventory || inventory.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Array.isArray(inventory?.screens)) errors.push('screens must be an array');
  if (errors.length) throw new Error(errors.join('; '));

  await validateObservedReactAssets(inventory, errors);
  const screenIds = new Set();
  const recordIds = new Set();
  const usedCocosPaths = new Set();
  const usedCocosIds = new Set();
  if (inventory.screens.length !== Object.keys(expectedSources).length) errors.push('screen count must be ' + Object.keys(expectedSources).length);

  for (const [id, source] of Object.entries(expectedSources)) {
    const screen = inventory.screens.find((candidate) => candidate?.id === id);
    if (!screen) {
      errors.push('missing screen ' + id + ' for source ' + source);
      continue;
    }
    if (screen.source !== source) errors.push('missing or incorrect source image for ' + id);
    try {
      const sourceSize = await readPngDimensions(path.join(sourceRoot, source));
      if (sourceSize.width !== canvas.width || sourceSize.height !== canvas.height) errors.push('source image must be 1920x1080 for ' + id);
    } catch {
      errors.push('source image file is unavailable for ' + id);
    }
  }

  for (const screen of inventory.screens) {
    if (!isRecord(screen)) {
      errors.push('screen must be an object');
      continue;
    }
    if (screenIds.has(screen.id)) errors.push('duplicate screen ID ' + screen.id);
    screenIds.add(screen.id);
    if (!Object.hasOwn(expectedSources, screen.id)) {
      errors.push('unknown screen ID ' + screen.id);
      continue;
    }
    if (typeof screen.name !== 'string' || screen.name.length === 0) errors.push('screen name missing for ' + screen.id);
    await validateCocosRuntime(screen, expectedSources[screen.id], gameShellSource, usedCocosPaths, usedCocosIds, errors);
    await validateReactRuntime(screen, reactUiEvidence, errors);
    if (!Array.isArray(screen.layers)) {
      errors.push('layers must be an array for ' + screen.id);
      continue;
    }
    if (screen.layers.length !== layers.length) errors.push('layer count must be ' + layers.length + ' for ' + screen.id);
    const seenLayers = new Set();
    const seenZ = new Set();
    for (const record of screen.layers) {
      if (!isRecord(record)) {
        errors.push('layer record must be an object for ' + screen.id);
        continue;
      }
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
      if (typeof record.assetPath === 'string' && !isSafeRepositoryPath(record.assetPath)) errors.push('assetPath must be repository-relative for ' + record.id);
      if (!(record.assetId === null || typeof record.assetId === 'string')) errors.push('assetId must be a string or null for ' + record.id);
      if (record.availability === 'absent') {
        if (record.assetPath !== null || record.assetId !== null) errors.push('absent record has a structured asset source for ' + record.id);
      } else if (record.assetPath !== visualSourceRoot + '/' + screen.source || record.assetId !== null) {
        errors.push('present record must point to its visual source without a standalone asset ID for ' + record.id);
      } else {
        try {
          const size = await readPngDimensions(path.join(repositoryRoot, record.assetPath));
          if (size.width !== canvas.width || size.height !== canvas.height) errors.push('PNG asset must be 1920x1080 for ' + record.id);
        } catch {
          errors.push('asset file is unavailable for ' + record.id);
        }
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
    if (seenZ.size !== layers.length) errors.push('each required layer must have a unique z in ' + screen.id);
  }
  if (errors.length) throw new Error(errors.join('; '));
}

async function expectInvalid(label, mutate, expectedMessage, inventory, gameShellSource, reactUiEvidence) {
  const candidate = structuredClone(inventory);
  mutate(candidate);
  await assert.rejects(
    () => validateInventory(candidate, gameShellSource, reactUiEvidence),
    (error) => error instanceof Error && error.message.includes(expectedMessage),
    label + ' did not fail with ' + expectedMessage,
  );
}

const markdown = await fs.readFile(documentPath, 'utf8');
const inventory = inventoryFromMarkdown(markdown);
const gameShellSource = await fs.readFile(gameShellPath, 'utf8');
const reactUiEvidence = await findReactUiEvidence();
assert.equal(isReactEvidencePath('src/components/BattleLayout.tsx'), true, 'React source UI references must remain in scan scope');
assert.equal(isReactEvidencePath('public/assets/UI01-runtime.png'), true, 'React public runtime assets must remain in scan scope');
await validateInventory(inventory, gameShellSource, reactUiEvidence);

const negativeCases = [
  ['missing screen', (candidate) => { candidate.screens = candidate.screens.slice(1); }, 'missing screen UI01'],
  ['missing image', (candidate) => { candidate.screens[0].source = 'UI01-不存在.png'; }, 'missing or incorrect source image'],
  ['duplicate screen ID', (candidate) => { candidate.screens[1].id = candidate.screens[0].id; }, 'duplicate screen ID'],
  ['duplicate ID', (candidate) => { candidate.screens[0].layers[1].id = candidate.screens[0].layers[0].id; }, 'duplicate record ID'],
  ['illegal layer', (candidate) => { candidate.screens[0].layers[0].layer = '控件'; }, 'illegal layer'],
  ['missing state', (candidate) => { candidate.screens[0].layers = candidate.screens[0].layers.filter((record) => record.layer !== '状态'); }, 'missing required layer 状态'],
  ['absent treated as asset', (candidate) => { candidate.screens[1].layers.find((record) => record.layer === '角色').asset = '虚构角色立绘'; }, 'absent record treated as an asset'],
  ['missing record source', (candidate) => { candidate.screens[0].layers[0].source = null; }, 'record source image missing or incorrect'],
  ['illegal z', (candidate) => { candidate.screens[0].layers[1].z = 1.5; }, 'z must be an integer'],
  ['non-positive size', (candidate) => { candidate.screens[0].layers[0].width = 0; }, 'width must be positive'],
  ['out-of-bounds coordinates', (candidate) => { candidate.screens[0].layers[0].x = 1; candidate.screens[0].layers[0].width = 1920; }, 'x + width exceeds 1920'],
  ['missing structured source', (candidate) => { candidate.screens[0].layers[0].assetPath = null; }, 'present record must point to its visual source'],
  ['illegal layer path', (candidate) => { candidate.screens[0].layers[0].assetPath = '/tmp/UI01.png'; }, 'assetPath must be repository-relative'],
  ['traversal layer path', (candidate) => { candidate.screens[0].layers[0].assetPath = '../outside.png'; }, 'assetPath must be repository-relative'],
  ['duplicate Cocos path', (candidate) => { candidate.screens[1].runtime.cocos.assetPath = candidate.screens[0].runtime.cocos.assetPath; }, 'duplicate Cocos runtime asset path'],
  ['missing Cocos asset', (candidate) => { candidate.screens[0].runtime.cocos.assetPath = null; }, 'Cocos runtime asset missing'],
  ['illegal Cocos path', (candidate) => { candidate.screens[0].runtime.cocos.assetPath = '../outside.png'; }, 'Cocos assetPath must be a safe repository-relative path'],
  ['illegal Cocos resource path', (candidate) => { candidate.screens[0].runtime.cocos.resourcePath = '../outside/spriteFrame'; }, 'Cocos resourcePath must be a safe repository-relative path'],
  ['missing Cocos ID', (candidate) => { candidate.screens[0].runtime.cocos.assetId = null; }, 'Cocos assetId mismatch'],
  ['wrong Cocos ID', (candidate) => { candidate.screens[0].runtime.cocos.assetId = 'not-a-cocos-uuid'; }, 'Cocos assetId mismatch'],
  ['React path on absent asset', (candidate) => { candidate.screens[0].runtime.react.assetPath = 'web-prototype/public/assets/UI01.png'; }, 'React runtime assetPath must be null'],
  ['React falsely present', (candidate) => { candidate.screens[0].runtime.react.availability = 'present'; }, 'React runtime UI asset must be absent'],
  ['duplicate React observed asset', (candidate) => { candidate.reactObservedAssets[1].assetPath = candidate.reactObservedAssets[0].assetPath; }, 'duplicate React observed asset path'],
  ['missing source hash declaration', (candidate) => { candidate.screens[0].runtime.cocos.sourceSha256 = '0'.repeat(64); }, 'source SHA-256 declaration mismatch'],
  ['Cocos hash mismatch', (candidate) => { candidate.screens[0].runtime.cocos.sourceSha256 = '0'.repeat(64); }, 'Cocos sourceSha256 mismatch'],
];
for (const [label, mutate, expectedMessage] of negativeCases) {
  await expectInvalid(label, mutate, expectedMessage, inventory, gameShellSource, reactUiEvidence);
}

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-layer-inventory-'));
try {
  await fs.mkdir(path.join(fixtureRoot, 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
  await fs.mkdir(path.join(fixtureRoot, 'public'), { recursive: true });
  await fs.writeFile(path.join(fixtureRoot, 'artifacts/UI01-BATTLE-LAYOUT-REFERENCE.png'), 'offline battle reference');
  await fs.writeFile(path.join(fixtureRoot, 'artifacts/UI01-SURRENDER-CONFIRM.png'), 'offline surrender reference');
  await fs.writeFile(path.join(fixtureRoot, 'src/App.jsx'), "const battleReference = 'UI01-BATTLE-LAYOUT-REFERENCE.png';\n");
  await fs.writeFile(path.join(fixtureRoot, 'public/ui-state.js'), "export const screenId = 'UI01';\n");
  await fs.writeFile(path.join(fixtureRoot, 'src/unrelated.md'), 'UI01 is an ordinary label, not a source reference.\n');

  const fixtureEvidence = await findReactUiEvidence(fixtureRoot);
  assert.equal(fixtureEvidence.some((entry) => entry.startsWith('artifacts/')), false, 'offline artifacts must not be scanned');
  assert.equal(fixtureEvidence.includes('src/App.jsx (reference)'), true, 'UI01 filename reference must be captured');
  assert.equal(fixtureEvidence.includes('public/ui-state.js (reference)'), true, 'UI01 identifier reference must be captured');
  assert.equal(fixtureEvidence.includes('src/unrelated.md (reference)'), false, 'ordinary UI01 text must not be evidence');
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}

const layerCount = inventory.screens.reduce((count, screen) => count + screen.layers.length, 0);
console.log('Asset-layer inventory verification: PASS (' + inventory.screens.length + ' screens, ' + layerCount + ' layers, ' + negativeCases.length + ' negative cases rejected)');
