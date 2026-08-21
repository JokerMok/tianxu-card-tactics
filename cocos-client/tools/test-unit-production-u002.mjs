import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

const clientRoot = path.resolve(process.cwd());
const projectRoot = path.resolve(clientRoot, '..');
const unitRoot = path.join(clientRoot, 'assets/resources/art/battle/units/U002');
const contractPath = path.join(unitRoot, 'production-contract.json');
const skeletonPath = path.join(unitRoot, 'skeleton.json');
const skeletonMetaPath = path.join(unitRoot, 'skeleton.json.meta');
const unitsConfigPath = path.join(clientRoot, 'assets/resources/config/units.json');
const cardsConfigPath = path.join(clientRoot, 'assets/resources/config/cards.json');

const EXPECTED = Object.freeze({
  approvedAt: '2026-08-21',
  productionTask: 'T279',
  unitId: 'U002',
  displayName: '折锋枪兵',
  assetStage: 'formal-runtime-unit',
  runtimeMode: 'pose-sheet-unit-skeleton',
  framePolicy: 'five-approved-pose-columns; transform-assisted-motion; no-fabricated-frames',
  race: '人族',
  politicalFaction: '朔垣军府',
  role: 'STRIKER',
  offenseType: 'PIERCE',
  defenseType: 'LIGHT',
  element: 'METAL',
  visualArchetype: 'HUMANOID_INFANTRY',
  abilityHint: '对快速单位增伤',
  combatPurpose: '中速反制',
  silhouette: '长枪、窄盾',
  readabilityRequirement: '枪尖和腿部推进动作在 120 像素下清晰',
  readabilityPx: 120,
  stats: Object.freeze({
    prepare: 2,
    maxHp: 5,
    attack: 3,
    armor: 1,
    move: 1,
    range: 1,
    copyLimit: 4,
    rarity: 4
  }),
  tags: Object.freeze(['unit', 'striker']),
  requiredActions: Object.freeze(['Idle', 'Move', 'Attack', 'Hit', 'Death']),
  requiredMountPoints: Object.freeze(['attackOrigin', 'effect', 'healthBar', 'shadow', 'cardAnchor']),
  runtimeOrientation: Object.freeze({
    player: Object.freeze({ direction: -1, scaleX: -1 }),
    enemy: Object.freeze({ direction: 1, scaleX: 1 })
  }),
  requiredEvents: Object.freeze({
    Move: Object.freeze(['footstep']),
    Attack: Object.freeze(['windup', 'impact']),
    Hit: Object.freeze(['hit']),
    Death: Object.freeze(['despawn'])
  }),
  poseSheet: Object.freeze({
    file: 'U002-ANIMATION-POSES.png',
    metaFile: 'U002-ANIMATION-POSES.png.meta',
    resourcePath: 'art/battle/units/U002/U002-ANIMATION-POSES/spriteFrame',
    referencePath: 'assets/resources/art/battle/units/U002/U002-ANIMATION-POSES.png',
    upstreamReferencePath: '../美术素材/A0/动画关键姿势/U002-ANIMATION-POSES.png',
    previewRuntimePath: 'assets/resources/a0/units/U002-ANIMATION-POSES.png',
    kind: 'approved-runtime-pose-sheet',
    status: 'production-approved',
    sha256: '11520617fe6add46c8a22a012d1dfc0e6b839308c70d75a6b80e275203edb33e',
    previewSha256: '9507ca351922a5fe6302cbcdaeab4c9711869e40ec1950afd4959caa14f7f81f',
    size: Object.freeze({ width: 1983, height: 793 }),
    alphaBounds: Object.freeze({ x: 11, y: 182, width: 1958, height: 448 }),
    opaquePixels: 264553,
    poseGrid: Object.freeze([
      Object.freeze({ index: 0, state: 'Idle', rect: Object.freeze({ x: 0, y: 0, width: 409, height: 793 }) }),
      Object.freeze({ index: 1, state: 'Move', rect: Object.freeze({ x: 409, y: 0, width: 384, height: 793 }) }),
      Object.freeze({ index: 2, state: 'Attack', rect: Object.freeze({ x: 793, y: 0, width: 398, height: 793 }) }),
      Object.freeze({ index: 3, state: 'Hit', rect: Object.freeze({ x: 1191, y: 0, width: 383, height: 793 }) }),
      Object.freeze({ index: 4, state: 'Death', rect: Object.freeze({ x: 1574, y: 0, width: 409, height: 793 }) })
    ]),
    slices: Object.freeze([
      Object.freeze({ state: 'Idle', opaquePixels: 57017, alphaBounds: Object.freeze({ x: 11, y: 246, width: 368, height: 378 }) }),
      Object.freeze({ state: 'Move', opaquePixels: 46314, alphaBounds: Object.freeze({ x: 1, y: 295, width: 372, height: 323 }) }),
      Object.freeze({ state: 'Attack', opaquePixels: 62149, alphaBounds: Object.freeze({ x: 0, y: 296, width: 397, height: 321 }) }),
      Object.freeze({ state: 'Hit', opaquePixels: 47532, alphaBounds: Object.freeze({ x: 43, y: 182, width: 313, height: 436 }) }),
      Object.freeze({ state: 'Death', opaquePixels: 51541, alphaBounds: Object.freeze({ x: 6, y: 190, width: 389, height: 440 }) })
    ])
  }),
  cutoutSheet: Object.freeze({
    file: 'U002-CUTOUT-SHEET.png',
    metaFile: 'U002-CUTOUT-SHEET.png.meta',
    resourcePath: 'art/battle/units/U002/U002-CUTOUT-SHEET/spriteFrame',
    referencePath: 'assets/resources/art/battle/units/U002/U002-CUTOUT-SHEET.png',
    upstreamReferencePath: '../美术素材/A0/单位切片参考/U002-CUTOUT-SHEET.png',
    kind: 'approved-runtime-cutout-sheet',
    status: 'production-approved',
    sha256: 'dc6b26dce75a65c8686ddb4666bdf38f3c860ef71b1c6e6b4ad93320b72a44a6',
    previewSha256: '99e057143f1edbdb95235f0ac39057fe5efc3ea2ef3c872b1d3c509e09c7535b',
    size: Object.freeze({ width: 1536, height: 1024 }),
    alphaBounds: Object.freeze({ x: 38, y: 21, width: 1457, height: 978 }),
    opaquePixels: 456133
  }),
  attachments: Object.freeze({
    frontPose: Object.freeze({ rect: Object.freeze({ x: 0, y: 0, width: 457, height: 558 }), opaquePixels: 94502, alphaBounds: Object.freeze({ x: 38, y: 21, width: 358, height: 496 }) }),
    sidePose: Object.freeze({ rect: Object.freeze({ x: 457, y: 0, width: 617, height: 558 }), opaquePixels: 89982, alphaBounds: Object.freeze({ x: 10, y: 128, width: 584, height: 389 }) }),
    rearPose: Object.freeze({ rect: Object.freeze({ x: 1074, y: 0, width: 462, height: 558 }), opaquePixels: 82152, alphaBounds: Object.freeze({ x: 57, y: 22, width: 341, height: 495 }) }),
    rigPose: Object.freeze({ rect: Object.freeze({ x: 601, y: 558, width: 472, height: 466 }), opaquePixels: 60387, alphaBounds: Object.freeze({ x: 34, y: 14, width: 318, height: 383 }) })
  })
});

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256(input) {
  const bytes = Buffer.isBuffer(input) ? input : readFileSync(input);
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value, label) {
  assert.equal(isRecord(value), true, `${label} must be an object`);
}

function assertExactKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys must match the frozen contract`);
}

function assertUuid(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a UUID string`);
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, `${label} must be a valid UUID`);
}

function validateJsonMeta(meta, label) {
  assertRecord(meta, label);
  assertExactKeys(meta, ['files', 'imported', 'importer', 'subMetas', 'userData', 'uuid', 'ver'], label);
  assert.equal(meta.ver, '2.0.1', `${label}.ver must be Cocos JSON metadata version 2.0.1`);
  assert.equal(meta.importer, 'json', `${label}.importer must be json`);
  assert.equal(meta.imported, true, `${label}.imported must be true`);
  assertUuid(meta.uuid, `${label}.uuid`);
  assert.deepEqual(meta.files, ['.json'], `${label}.files must include the imported JSON asset`);
  assert.deepEqual(meta.subMetas, {}, `${label}.subMetas must be empty for a JSON asset`);
  assertRecord(meta.userData, `${label}.userData`);
  assertExactKeys(meta.userData, [], `${label}.userData`);
}

function validatePngMeta(meta, image, label) {
  assertRecord(meta, label);
  assertExactKeys(meta, ['files', 'imported', 'importer', 'subMetas', 'userData', 'uuid', 'ver'], label);
  assert.equal(meta.ver, '1.0.27', `${label}.ver must be Cocos image metadata version 1.0.27`);
  assert.equal(meta.importer, 'image', `${label}.importer must be image`);
  assert.equal(meta.imported, true, `${label}.imported must be true`);
  assertUuid(meta.uuid, `${label}.uuid`);
  assert.deepEqual(meta.files, ['.json', '.png'], `${label}.files must include image importer outputs`);
  assertRecord(meta.subMetas, `${label}.subMetas`);
  assertExactKeys(meta.subMetas, ['6c48a', 'f9941'], `${label}.subMetas`);
  for (const [id, subMeta] of Object.entries(meta.subMetas)) {
    assertRecord(subMeta, `${label}.subMetas.${id}`);
    assert.equal(subMeta.uuid, `${meta.uuid}@${id}`, `${label}.subMetas.${id}.uuid must link to the root UUID`);
    assert.equal(subMeta.imported, true, `${label}.subMetas.${id}.imported must be true`);
    assert.deepEqual(subMeta.files, ['.json'], `${label}.subMetas.${id}.files must include the imported sub-asset`);
    assert.deepEqual(subMeta.subMetas, {}, `${label}.subMetas.${id}.subMetas must be empty`);
  }
  assert.equal(meta.subMetas['f9941'].importer, 'sprite-frame', `${label} sprite-frame sub-meta importer drifted`);
  assertRecord(meta.userData, `${label}.userData`);
  assertExactKeys(meta.userData, ['fixAlphaTransparencyArtifacts', 'hasAlpha', 'redirect', 'type'], `${label}.userData`);
  assert.equal(meta.userData.type, 'sprite-frame', `${label}.userData.type must be sprite-frame`);
  assert.equal(typeof meta.userData.hasAlpha, 'boolean', `${label}.userData.hasAlpha must be boolean`);
  assert.equal(meta.userData.hasAlpha, image.hasAlpha, `${label}.userData.hasAlpha must match decoded RGBA alpha`);
  assert.equal(meta.userData.hasAlpha, true, `${label}.userData.hasAlpha must be true for the formal RGBA asset`);
  assert.equal(meta.userData.redirect, `${meta.uuid}@6c48a`, `${label}.userData.redirect must target the texture sub-meta`);
}

function assertLocalFile(rootDir, fileName, label) {
  assert.equal(typeof fileName, 'string', `${label} file must be a string`);
  assert.equal(fileName.includes('/'), false, `${label} file must stay in the U002 directory`);
  const filePath = path.join(rootDir, fileName);
  assert.equal(existsSync(filePath), true, `${label} file is missing: ${fileName}`);
  return filePath;
}

function assertResourcePath(value, expected, label) {
  assert.equal(typeof value, 'string', `${label} resourcePath must be a string`);
  assert.equal(value, expected, `${label} resourcePath must stay frozen`);
  assert.equal(value.startsWith('art/battle/units/U002/'), true, `${label} resourcePath must stay under art/battle/units/U002`);
  assert.equal(value.includes('/a0/'), false, `${label} resourcePath must not reference preview assets`);
  assert.equal(value.includes('..'), false, `${label} resourcePath must not escape its resource root`);
}

function assertRuntimeAssetPath(value, expected, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.equal(value, expected, `${label} must stay frozen to the formal runtime asset`);
  assert.equal(value.startsWith('assets/resources/art/battle/units/U002/'), true, `${label} must stay in the U002 formal runtime directory`);
  assert.equal(value.includes('/a0/'), false, `${label} must not reference preview runtime assets`);
  assert.equal(value.includes('美术素材/A0'), false, `${label} must not reference A0 source art`);
  assert.equal(value.includes('..'), false, `${label} must not contain traversal`);
  const resolved = path.resolve(clientRoot, value);
  assert.equal(resolved.startsWith(`${unitRoot}/`), true, `${label} escapes the U002 unit root`);
  assert.equal(existsSync(resolved), true, `${label} is missing: ${value}`);
  return resolved;
}

function assertUpstreamReferencePath(value, expected, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.equal(value, expected, `${label} must preserve the approved upstream source trace`);
  assert.equal(value.startsWith('../美术素材/A0/'), true, `${label} must point to the approved A0 provenance root`);
  const resolved = path.resolve(clientRoot, value);
  assert.equal(resolved.startsWith(`${projectRoot}/美术素材/A0/`), true, `${label} must resolve inside the approved A0 source directory`);
  assert.equal(existsSync(resolved), true, `${label} upstream source is missing: ${value}`);
  return resolved;
}

function parsePng(filePath) {
  const bytes = readFileSync(filePath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${filePath} must be a PNG file`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compression = 0;
  let filter = 0;
  let interlace = 0;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = bytes.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      compression = data[10];
      filter = data[11];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  assert.equal(bitDepth, 8, `${filePath} must use 8-bit channels`);
  assert.equal(colorType, 6, `${filePath} must use RGBA, not a flattened RGB preview`);
  assert.equal(compression, 0, `${filePath} compression must be PNG default`);
  assert.equal(filter, 0, `${filePath} filter method must be PNG default`);
  assert.equal(interlace, 0, `${filePath} must be non-interlaced`);

  const rowBytes = width * 4;
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, (rowBytes + 1) * height, `${filePath} decoded PNG row data mismatch`);
  const rgba = Buffer.alloc(width * height * 4);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const rowFilter = raw[rawOffset];
    rawOffset += 1;
    assert.equal(rowFilter, 0, `${filePath} must use deterministic filter 0 rows`);
    raw.copy(rgba, y * rowBytes, rawOffset, rawOffset + rowBytes);
    rawOffset += rowBytes;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let opaquePixels = 0;
  let minAlpha = 255;
  let maxAlpha = 0;
  let transparentPixels = 0;
  let nonOpaquePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3];
      minAlpha = Math.min(minAlpha, alpha);
      maxAlpha = Math.max(maxAlpha, alpha);
      if (alpha === 0) transparentPixels += 1;
      if (alpha < 255) nonOpaquePixels += 1;
      if (alpha > 0) {
        opaquePixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  assert.equal(opaquePixels > 0, true, `${filePath} must contain visible artwork`);
  assert.equal(nonOpaquePixels > 0, true, `${filePath} decoded RGBA must contain transparent pixels`);
  return {
    width,
    height,
    rgba,
    hasAlpha: nonOpaquePixels > 0,
    minAlpha,
    maxAlpha,
    transparentPixels,
    nonOpaquePixels,
    opaquePixels,
    alphaBounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  };
}

function cropStats(image, rect, label) {
  for (const axis of ['x', 'y', 'width', 'height']) {
    assert.equal(Number.isInteger(rect[axis]), true, `${label}.${axis} must be an integer`);
  }
  assert.equal(rect.x >= 0 && rect.y >= 0, true, `${label} must start inside the source`);
  assert.equal(rect.width > 0 && rect.height > 0, true, `${label} dimensions must be positive`);
  assert.equal(rect.x + rect.width <= image.width, true, `${label} exceeds source width`);
  assert.equal(rect.y + rect.height <= image.height, true, `${label} exceeds source height`);
  let minX = rect.width;
  let minY = rect.height;
  let maxX = -1;
  let maxY = -1;
  let opaquePixels = 0;
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const alpha = image.rgba[((rect.y + y) * image.width + rect.x + x) * 4 + 3];
      if (alpha > 0) {
        opaquePixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  assert.equal(opaquePixels > 0, true, `${label} must contain visible artwork`);
  return {
    opaquePixels,
    alphaBounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  };
}

function validatePoseGrid(resource, expected, label) {
  assert.equal(Array.isArray(resource.poseGrid), true, `${label} poseGrid must be an array`);
  assert.deepEqual(resource.poseGrid, expected.poseGrid, `${label} poseGrid must stay frozen`);
  let previousEnd = 0;
  for (const [index, pose] of resource.poseGrid.entries()) {
    assert.equal(pose.index, index, `${label} pose index ${index} must remain contiguous`);
    assert.equal(pose.state, EXPECTED.requiredActions[index], `${label} pose order must match Idle/Move/Attack/Hit/Death`);
    assert.equal(pose.rect.x, previousEnd, `${label} pose rect ${pose.state} must be contiguous`);
    assert.equal(pose.rect.y, 0, `${label} pose rect ${pose.state} must start at y=0`);
    assert.equal(pose.rect.height, expected.size.height, `${label} pose rect ${pose.state} must cover full source height`);
    previousEnd = pose.rect.x + pose.rect.width;
  }
  assert.equal(previousEnd, expected.size.width, `${label} poseGrid must cover the full frozen sheet width`);
}

function validatePoseSlices(image, expected) {
  for (const slice of expected.slices) {
    const rect = expected.poseGrid.find((pose) => pose.state === slice.state).rect;
    assert(rect, `missing pose grid rect for ${slice.state}`);
    assert.deepEqual(
      cropStats(image, rect, `poseSheet.${slice.state}`),
      { opaquePixels: slice.opaquePixels, alphaBounds: slice.alphaBounds },
      `${slice.state} slice alpha footprint changed`
    );
  }
}

function validateAttachmentSlices(image, skeleton) {
  const attachmentMap = new Map(skeleton.attachments.map((attachment) => [attachment.name, attachment]));
  for (const [name, expected] of Object.entries(EXPECTED.attachments)) {
    const attachment = attachmentMap.get(name);
    assertRecord(attachment, `${name} attachment`);
    assert.equal(attachment.source, 'cutoutSheet', `${name} must source from cutoutSheet`);
    assert.deepEqual(attachment.sourceRect, expected.rect, `${name} sourceRect drifted`);
    assert.deepEqual(
      cropStats(image, expected.rect, `cutoutSheet.${name}`),
      { opaquePixels: expected.opaquePixels, alphaBounds: expected.alphaBounds },
      `${name} alpha footprint changed`
    );
  }
}

function assertPngAsset(contractResource, expectedResource, skeletonResource, rootDir, label) {
  assertRecord(contractResource, `${label} contract`);
  assertExactKeys(
    contractResource,
    ['file', 'kind', 'metaFile', 'referencePath', 'resourcePath', 'sha256', 'size', 'upstreamReferencePath', ...(label === 'poseSheet' ? ['poseGrid'] : [])],
    `${label} contract`
  );
  assert.equal(contractResource.file, expectedResource.file, `${label} file name must stay frozen`);
  assert.equal(contractResource.metaFile, expectedResource.metaFile, `${label} metaFile must stay frozen`);
  assert.equal(contractResource.kind, expectedResource.kind, `${label} kind must stay formal-runtime`);
  assertResourcePath(contractResource.resourcePath, expectedResource.resourcePath, label);
  const contractReference = assertRuntimeAssetPath(contractResource.referencePath, expectedResource.referencePath, `${label} contract referencePath`);
  assert.equal(contractReference, path.join(rootDir, contractResource.file), `${label} contract referencePath must resolve to the local runtime PNG`);
  const upstreamFile = assertUpstreamReferencePath(contractResource.upstreamReferencePath, expectedResource.upstreamReferencePath, `${label} contract upstreamReferencePath`);
  assert.equal(contractResource.sha256, expectedResource.sha256, `${label} contract hash drifted`);
  assert.deepEqual(contractResource.size, expectedResource.size, `${label} contract size drifted`);

  const localFile = assertLocalFile(rootDir, contractResource.file, label);
  const metaFile = assertLocalFile(rootDir, contractResource.metaFile, `${label} meta`);
  assert.equal(metaFile.endsWith('.meta'), true, `${label} meta must end with .meta`);
  if (expectedResource.previewRuntimePath) {
    const previewRuntimeFile = path.resolve(clientRoot, expectedResource.previewRuntimePath);
    assert.equal(existsSync(previewRuntimeFile), true, `${label} preview runtime file is missing`);
    assert.equal(sha256(previewRuntimeFile), expectedResource.previewSha256, `${label} preview runtime hash drifted`);
  }
  assert.equal(sha256(upstreamFile), expectedResource.previewSha256, `${label} preview source hash drifted`);
  assert.notEqual(expectedResource.sha256, expectedResource.previewSha256, `${label} must not be a byte-identical A0 copy`);
  assert.notEqual(sha256(localFile), sha256(upstreamFile), `${label} local PNG must differ from the A0 source bytes`);

  const image = parsePng(localFile);
  validatePngMeta(readJson(metaFile), image, `${label} meta`);
  assert.deepEqual(
    { width: image.width, height: image.height, alphaBounds: image.alphaBounds, opaquePixels: image.opaquePixels },
    {
      width: expectedResource.size.width,
      height: expectedResource.size.height,
      alphaBounds: expectedResource.alphaBounds,
      opaquePixels: expectedResource.opaquePixels
    },
    `${label} dimensions or alpha footprint changed`
  );
  assert.equal(sha256(localFile), expectedResource.sha256, `${label} local PNG hash must match the production contract`);

  assertRecord(skeletonResource, `${label} skeleton source`);
  assertExactKeys(
    skeletonResource,
    ['id', 'kind', 'path', 'referencePath', 'sha256', 'size', 'status', 'upstreamReferencePath', ...(label === 'poseSheet' ? ['poseGrid'] : [])],
    `${label} skeleton source`
  );
  assert.equal(skeletonResource.kind, expectedResource.kind, `${label} skeleton kind drifted`);
  assert.equal(skeletonResource.status, expectedResource.status, `${label} skeleton status drifted`);
  assert.equal(skeletonResource.sha256, expectedResource.sha256, `${label} skeleton hash drifted`);
  assert.deepEqual(skeletonResource.size, expectedResource.size, `${label} skeleton size drifted`);
  assert.equal(
    assertRuntimeAssetPath(skeletonResource.path, expectedResource.referencePath, `${label} skeleton path`),
    localFile,
    `${label} skeleton path must resolve to the local runtime PNG`
  );
  assert.equal(
    assertRuntimeAssetPath(skeletonResource.referencePath, expectedResource.referencePath, `${label} skeleton referencePath`),
    localFile,
    `${label} skeleton referencePath must resolve to the local runtime PNG`
  );
  assert.equal(
    assertUpstreamReferencePath(skeletonResource.upstreamReferencePath, expectedResource.upstreamReferencePath, `${label} skeleton upstreamReferencePath`),
    upstreamFile,
    `${label} skeleton upstreamReferencePath must resolve to the approved A0 provenance file`
  );
  if (label === 'poseSheet') {
    validatePoseGrid(contractResource, expectedResource, `${label} contract`);
    validatePoseGrid(skeletonResource, expectedResource, `${label} skeleton`);
    assert.deepEqual(skeletonResource.poseGrid, contractResource.poseGrid, `${label} skeleton poseGrid must match the production contract`);
    validatePoseSlices(image, expectedResource);
  }
  return image;
}

function validateSkeletalSemantics(contract, skeleton) {
  assert.equal(skeleton.schema, 'battle-unit-skeleton/v1', 'skeleton schema must remain battle-unit-skeleton/v1');
  assert.equal(skeleton.contractVersion, '2.2', 'skeleton contractVersion must remain 2.2');
  assert.equal(skeleton.productionTask, EXPECTED.productionTask, 'skeleton productionTask drifted');
  assert.equal(skeleton.unitId, EXPECTED.unitId, 'skeleton unitId must remain U002');
  assert.equal(skeleton.assetStage, EXPECTED.assetStage, 'skeleton assetStage must remain formal-runtime-unit');
  assert.equal(skeleton.runtimeMode, EXPECTED.runtimeMode, 'skeleton runtimeMode must remain pose-sheet-unit-skeleton');
  assert.equal(skeleton.framePolicy, EXPECTED.framePolicy, 'skeleton framePolicy drifted');
  assert.deepEqual(contract.runtime.requiredActions, EXPECTED.requiredActions, 'production contract actions must stay frozen');
  assert.deepEqual(Object.keys(skeleton.stateMap), EXPECTED.requiredActions, 'skeleton stateMap keys must stay frozen');
  assert.deepEqual(Object.keys(skeleton.animations), EXPECTED.requiredActions, 'skeleton animations keys must stay frozen');

  for (const action of EXPECTED.requiredActions) {
    assert.equal(skeleton.stateMap[action].source, 'poseSheet', `${action} stateMap must still reference poseSheet`);
    assert.equal(
      skeleton.stateMap[action].poseIndex,
      EXPECTED.poseSheet.poseGrid.find((pose) => pose.state === action).index,
      `${action} pose index drifted`
    );
    const animation = skeleton.animations[action];
    assert.equal(Array.isArray(animation.tracks) && animation.tracks.length > 0, true, `${action} animation must define transform tracks`);
    assert.equal(typeof animation.duration, 'number', `${action} animation duration must be numeric`);
    assert.equal(animation.duration > 0, true, `${action} animation duration must stay positive`);
  }

  const move = skeleton.animations.Move;
  assert.equal(move.loop, true, 'Move must loop');
  assert.equal(move.tracks.some((track) => track.bone === 'torso' && track.property === 'translateY'), true, 'Move must keep the torso push motion');
  assert.equal(move.tracks.some((track) => track.bone === 'root' && track.property === 'translateX'), false, 'Move must not encode board travel on root translateX');

  const attack = skeleton.animations.Attack;
  assert.equal(attack.loop, false, 'Attack must not loop');
  assert.equal(attack.tracks.some((track) => track.bone === 'spear' && track.property === 'rotate'), true, 'Attack must keep the spear strike motion');
  assert.equal(attack.events.some((event) => event.name === 'impact'), true, 'Attack must expose an impact event');

  const hit = skeleton.animations.Hit;
  assert.equal(hit.events.some((event) => event.name === 'hit'), true, 'Hit must expose a hit event');
  assert.equal(hit.tracks.some((track) => track.property === 'translateX'), true, 'Hit must keep a recoil motion');

  const death = skeleton.animations.Death;
  assert.equal(death.events.some((event) => event.name === 'despawn'), true, 'Death must expose a despawn event');
  assert.equal(death.tracks.some((track) => track.property === 'opacity'), true, 'Death must keep a fade-out track');

  const mountNames = skeleton.mountPoints.map((mount) => mount.name).sort();
  assert.deepEqual(mountNames, [...EXPECTED.requiredMountPoints].sort(), 'mount point set drifted from the approved combat contract');
  const attackOrigin = skeleton.mountPoints.find((mount) => mount.name === 'attackOrigin');
  assert.equal(attackOrigin.bone, 'spear', 'attackOrigin must stay on the spear tip');

  assert.deepEqual(
    {
      player: { direction: skeleton.orientations.player.direction, scaleX: skeleton.orientations.player.scaleX },
      enemy: { direction: skeleton.orientations.enemy.direction, scaleX: skeleton.orientations.enemy.scaleX }
    },
    EXPECTED.runtimeOrientation,
    'bidirectional orientation contract drifted'
  );
}

function validateConfigAlignment(contract, skeleton) {
  const units = readJson(unitsConfigPath).units;
  const cards = readJson(cardsConfigPath).cards;
  const unit = units.find((entry) => entry.id === EXPECTED.unitId);
  const card = cards.find((entry) => entry.id === EXPECTED.unitId);
  assertRecord(unit, 'U002 unit config');
  assertRecord(card, 'U002 card config');

  assert.equal(contract.displayName, EXPECTED.displayName, 'displayName drifted');
  assert.equal(contract.combatIdentity.race, unit.race, 'combatIdentity.race must match units.json');
  assert.equal(contract.combatIdentity.politicalFaction, unit.politicalFaction, 'combatIdentity.politicalFaction must match units.json');
  assert.equal(contract.combatIdentity.role, unit.role, 'combatIdentity.role must match units.json');
  assert.equal(contract.combatIdentity.offenseType, unit.offenseType, 'combatIdentity.offenseType must match units.json');
  assert.equal(contract.combatIdentity.defenseType, unit.defenseType, 'combatIdentity.defenseType must match units.json');
  assert.equal(contract.combatIdentity.element, unit.element, 'combatIdentity.element must match units.json');
  assert.equal(contract.combatIdentity.visualArchetype, unit.visualArchetype, 'combatIdentity.visualArchetype must match units.json');
  assert.deepEqual(contract.combatIdentity.tags, card.tags, 'combatIdentity.tags must match cards.json');
  assert.equal(contract.combatIdentity.stats.prepare, card.prepare, 'prepare must match cards.json');
  assert.equal(contract.combatIdentity.stats.copyLimit, card.copyLimit, 'copyLimit must match cards.json');
  assert.equal(contract.combatIdentity.stats.rarity, card.rarity, 'rarity must match cards.json');
  assert.equal(contract.combatIdentity.stats.maxHp, unit.maxHp, 'maxHp must match units.json');
  assert.equal(contract.combatIdentity.stats.attack, unit.attack, 'attack must match units.json');
  assert.equal(contract.combatIdentity.stats.armor, unit.armor, 'armor must match units.json');
  assert.equal(contract.combatIdentity.stats.move, unit.move, 'move must match units.json');
  assert.equal(contract.combatIdentity.stats.range, unit.range, 'range must match units.json');
  assert.deepEqual(unit.abilityIds, ['A002'], 'U002 abilityIds must remain frozen to A002');

  assert.equal(contract.combatIdentity.abilityHint, EXPECTED.abilityHint, 'abilityHint must keep the approved design intent');
  assert.equal(contract.combatIdentity.combatPurpose, EXPECTED.combatPurpose, 'combatPurpose must keep the approved design intent');
  assert.equal(contract.designIntent.silhouette, EXPECTED.silhouette, 'silhouette requirement drifted');
  assert.equal(contract.designIntent.readabilityPx, EXPECTED.readabilityPx, 'readabilityPx drifted');
  assert.equal(contract.designIntent.readabilityRequirement, EXPECTED.readabilityRequirement, 'readabilityRequirement drifted');
  assert.equal(contract.approvedAt, EXPECTED.approvedAt, 'approvedAt must stay bound to the approved plan date');
  assert.equal(contract.productionTask, EXPECTED.productionTask, 'productionTask must stay bound to T279');
  assert.equal(contract.runtime.skeletonFile, path.basename(skeletonPath), 'runtime.skeletonFile must target skeleton.json');
  assert.deepEqual(contract.resources.poseSheet.poseGrid, skeleton.sources.poseSheet.poseGrid, 'poseSheet poseGrid must stay aligned between contract and skeleton');
}

function validateUnit(contract, skeleton) {
  assertRecord(contract, 'production contract');
  assertRecord(skeleton, 'skeleton');
  const skeletonMetaFile = assertLocalFile(unitRoot, path.basename(skeletonMetaPath), 'skeleton meta');
  assert.equal(skeletonMetaFile, skeletonMetaPath, 'skeleton meta must sit beside skeleton.json');
  validateJsonMeta(readJson(skeletonMetaFile), 'skeleton.json.meta');
  assert.equal(contract.schema, 'battle-unit-production-contract/v1', 'contract schema mismatch');
  assert.equal(contract.contractVersion, '2.2', 'contractVersion mismatch');
  assert.equal(contract.unitId, EXPECTED.unitId, 'unitId mismatch');
  assert.equal(contract.resourceRoot, 'assets/resources/art/battle/units/U002', 'resourceRoot must stay frozen');

  assertPngAsset(contract.resources.poseSheet, EXPECTED.poseSheet, skeleton.sources.poseSheet, unitRoot, 'poseSheet');
  const cutoutImage = assertPngAsset(contract.resources.cutoutSheet, EXPECTED.cutoutSheet, skeleton.sources.cutoutSheet, unitRoot, 'cutoutSheet');
  validateAttachmentSlices(cutoutImage, skeleton);
  validateConfigAlignment(contract, skeleton);
  validateSkeletalSemantics(contract, skeleton);

  assert.deepEqual(contract.runtime.requiredMountPoints, EXPECTED.requiredMountPoints, 'runtime.requiredMountPoints drifted');
  assert.deepEqual(contract.runtime.orientationPair, EXPECTED.runtimeOrientation, 'runtime.orientationPair drifted');
  assert.deepEqual(contract.runtime.requiredEvents, EXPECTED.requiredEvents, 'runtime.requiredEvents drifted');
  assert.deepEqual(contract.provenance.designEvidence, [
    '第一批卡牌设计表.md',
    '角色兵种体系-v1.1.md',
    '首批美术素材清单-v2.2.md'
  ], 'designEvidence drifted');
  assert.equal(contract.provenance.sourceSkeleton, 'assets/resources/art/battle/units/U002/skeleton.json', 'sourceSkeleton drifted');
}

function validateProductionContract(filePath) {
  validateUnit(readJson(filePath), readJson(skeletonPath));
}

function runContractProbe(name, mutate, pattern) {
  const contract = readJson(contractPath);
  mutate(contract);
  assert.throws(() => validateUnit(contract, readJson(skeletonPath)), pattern, `${name} counterexample must fail`);
}

function runSkeletonProbe(name, mutate, pattern) {
  const skeleton = readJson(skeletonPath);
  mutate(skeleton);
  assert.throws(() => validateUnit(readJson(contractPath), skeleton), pattern, `${name} counterexample must fail`);
}

function runJsonMetaProbe(name, mutate, pattern) {
  const meta = readJson(skeletonMetaPath);
  mutate(meta);
  assert.throws(() => validateJsonMeta(meta, 'skeleton.json.meta'), pattern, `${name} counterexample must fail`);
}

function runPngMetaProbe(name, resource, mutate, pattern) {
  const metaPath = path.join(unitRoot, resource.metaFile);
  const image = parsePng(path.join(unitRoot, resource.file));
  const meta = readJson(metaPath);
  mutate(meta);
  assert.throws(() => validatePngMeta(meta, image, `${resource.file}.meta`), pattern, `${name} counterexample must fail`);
}

validateProductionContract(contractPath);

runJsonMetaProbe(
  'skeleton-meta-missing-importer',
  (meta) => {
    delete meta.importer;
  },
  /keys must match the frozen contract/
);

runPngMetaProbe(
  'pose-meta-alpha-drift',
  EXPECTED.poseSheet,
  (meta) => {
    meta.userData.hasAlpha = false;
  },
  /hasAlpha must match decoded RGBA alpha|hasAlpha must be true/
);

runPngMetaProbe(
  'cutout-meta-alpha-drift',
  EXPECTED.cutoutSheet,
  (meta) => {
    meta.userData.hasAlpha = false;
  },
  /hasAlpha must match decoded RGBA alpha|hasAlpha must be true/
);

runContractProbe(
  'preview-resource-path',
  (contract) => {
    contract.resources.poseSheet.referencePath = 'assets/resources/a0/units/U002-ANIMATION-POSES.png';
  },
  /must stay frozen to the formal runtime asset|must stay in the U002 formal runtime directory|must not reference preview runtime assets/
);

runContractProbe(
  'runtime-path-back-to-a0-source',
  (contract) => {
    contract.resources.cutoutSheet.referencePath = contract.resources.cutoutSheet.upstreamReferencePath;
  },
  /must stay frozen to the formal runtime asset|must stay in the U002 formal runtime directory|must not reference A0 source art/
);

runSkeletonProbe(
  'preview-stage-and-path',
  (skeleton) => {
    skeleton.assetStage = 'A0-reference';
    skeleton.runtimeMode = 'reference-pose-skeleton';
    skeleton.sources.poseSheet.path = 'assets/resources/a0/units/U002-ANIMATION-POSES.png';
    skeleton.sources.poseSheet.referencePath = 'assets/resources/a0/units/U002-ANIMATION-POSES.png';
    skeleton.sources.poseSheet.sha256 = EXPECTED.poseSheet.previewSha256;
  },
  /assetStage must remain formal-runtime-unit|runtimeMode must remain pose-sheet-unit-skeleton|must stay frozen to the formal runtime asset|must not reference preview runtime assets|skeleton hash drifted/
);

runContractProbe(
  'cutout-hash-drift',
  (contract) => {
    contract.resources.cutoutSheet.sha256 = EXPECTED.cutoutSheet.previewSha256;
  },
  /contract hash drifted|local PNG hash must match the production contract/
);

runContractProbe(
  'cutout-size-drift',
  (contract) => {
    contract.resources.cutoutSheet.size.width = 1535;
  },
  /contract size drifted|dimensions or alpha footprint changed/
);

runContractProbe(
  'missing-attack-action',
  (contract) => {
    contract.runtime.requiredActions = ['Idle', 'Move', 'Hit', 'Death'];
  },
  /actions must stay frozen|stateMap keys must stay frozen|animations keys must stay frozen/
);

runContractProbe(
  'out-of-bounds-pose',
  (contract) => {
    contract.resources.poseSheet.poseGrid[4].rect.width = 500;
  },
  /must stay frozen|must cover the full frozen sheet width|must match the frozen contract/
);

assert.throws(
  () => parsePng(path.resolve(clientRoot, EXPECTED.poseSheet.previewRuntimePath)),
  /must use RGBA, not a flattened RGB preview/,
  'preview poseSheet PNG without alpha must fail the runtime PNG parser'
);

assert.throws(
  () => parsePng(path.resolve(clientRoot, EXPECTED.cutoutSheet.upstreamReferencePath)),
  /must use RGBA, not a flattened RGB preview/,
  'preview cutout PNG without alpha must fail the runtime PNG parser'
);

console.log('T279 PASS: U002 formal runtime assets, local production paths, alpha-preserving PNGs, skeletal semantics, and negative probes verified.');
