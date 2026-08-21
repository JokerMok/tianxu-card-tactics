import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve } from 'node:path';

const projectRoot = resolve(process.cwd());
const repoRoot = resolve(projectRoot, '..');
const requiredStates = ['Idle', 'Move', 'Attack', 'Hit', 'Death'];
const requiredMounts = ['attackOrigin', 'effect', 'healthBar', 'shadow', 'cardAnchor'];
const allowedTrackProperties = new Set(['translateX', 'translateY', 'rotate', 'scaleX', 'scaleY', 'opacity']);
const requiredLandmarks = ['wingTip', 'wingRoot', 'drawHand', 'bowGrip', 'arrowHead'];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readText(file) {
  return readFileSync(file, 'utf8');
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readPng(file) {
  const bytes = readFileSync(file);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${file} must be a PNG`);
  let cursor = 8;
  let header;
  let hasTransparencyChunk = false;
  const imageData = [];
  while (cursor < bytes.length) {
    assert.equal(cursor + 12 <= bytes.length, true, `${file} has a truncated PNG chunk`);
    const length = bytes.readUInt32BE(cursor);
    const type = bytes.toString('ascii', cursor + 4, cursor + 8);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    assert.equal(dataEnd + 4 <= bytes.length, true, `${file} has a truncated ${type} chunk`);
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlaceMethod: data[12]
      };
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'tRNS') {
      hasTransparencyChunk = true;
    }
    cursor = dataEnd + 4;
  }

  assert.equal(isRecord(header), true, `${file} must expose an IHDR chunk`);
  assert.equal(header.bitDepth, 8, `${file} must use 8-bit PNG channels`);
  assert.equal(header.interlaceMethod, 0, `${file} must use a non-interlaced PNG`);
  assert.equal([2, 6].includes(header.colorType), true, `${file} must use RGB or RGBA color data`);
  assert.equal(imageData.length > 0, true, `${file} must contain IDAT data`);

  const channels = header.colorType === 6 ? 4 : 3;
  const rowBytes = header.width * channels;
  const decoded = inflateSync(Buffer.concat(imageData));
  assert.equal(decoded.length, header.height * (rowBytes + 1), `${file} decoded pixel data length changed unexpectedly`);
  const pixels = Buffer.alloc(header.width * header.height * 4);
  let decodedOffset = 0;
  let previousRow = Buffer.alloc(rowBytes);
  const paeth = (left, above, upperLeft) => {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
    if (aboveDistance <= upperLeftDistance) return above;
    return upperLeft;
  };

  for (let y = 0; y < header.height; y += 1) {
    const filter = decoded[decodedOffset++];
    const row = Buffer.from(decoded.subarray(decodedOffset, decodedOffset + rowBytes));
    decodedOffset += rowBytes;
    for (let index = 0; index < row.length; index += 1) {
      const left = index >= channels ? row[index - channels] : 0;
      const above = previousRow[index] ?? 0;
      const upperLeft = index >= channels ? previousRow[index - channels] ?? 0 : 0;
      if (filter === 1) row[index] = (row[index] + left) & 0xff;
      else if (filter === 2) row[index] = (row[index] + above) & 0xff;
      else if (filter === 3) row[index] = (row[index] + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) row[index] = (row[index] + paeth(left, above, upperLeft)) & 0xff;
      else assert.equal(filter, 0, `${file} uses an unsupported PNG filter`);
    }
    for (let x = 0; x < header.width; x += 1) {
      const sourceOffset = x * channels;
      const targetOffset = (y * header.width + x) * 4;
      pixels[targetOffset] = row[sourceOffset];
      pixels[targetOffset + 1] = row[sourceOffset + 1];
      pixels[targetOffset + 2] = row[sourceOffset + 2];
      pixels[targetOffset + 3] = header.colorType === 6 ? row[sourceOffset + 3] : 0xff;
    }
    previousRow = row;
  }

  let alphaMin = 0xff;
  let alphaMax = 0;
  let transparentPixels = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset];
    alphaMin = Math.min(alphaMin, alpha);
    alphaMax = Math.max(alphaMax, alpha);
    if (alpha === 0) transparentPixels += 1;
  }
  return {
    width: header.width,
    height: header.height,
    byteLength: bytes.length,
    colorType: header.colorType,
    hasAlpha: header.colorType === 6 || hasTransparencyChunk,
    alpha: { min: alphaMin, max: alphaMax, transparentPixels },
    pixels
  };
}

function assertRect(rect, bounds, label) {
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.equal(Number.isInteger(rect?.[key]), true, `${label}.${key} must be an integer`);
  }
  assert.equal(rect.x >= 0 && rect.y >= 0, true, `${label} must begin inside the atlas`);
  assert.equal(rect.width > 0 && rect.height > 0, true, `${label} must be positive`);
  assert.equal(rect.x + rect.width <= bounds.width, true, `${label} exceeds atlas width`);
  assert.equal(rect.y + rect.height <= bounds.height, true, `${label} exceeds atlas height`);
}

function assertSameKeys(record, keys, label) {
  assert.deepEqual(Object.keys(record).sort(), [...keys].sort(), `${label} keys must match the approved set`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPoint(point, bounds, label) {
  assert.equal(Number.isInteger(point?.x), true, `${label}.x must be an integer`);
  assert.equal(Number.isInteger(point?.y), true, `${label}.y must be an integer`);
  assert.equal(point.x >= 0 && point.x < bounds.width, true, `${label}.x must stay inside the preview`);
  assert.equal(point.y >= 0 && point.y < bounds.height, true, `${label}.y must stay inside the preview`);
}

function validateCocosImageMeta(file, png, meta) {
  const label = file.split('/').at(-1);
  const extension = `.${label.split('.').at(-1)}`;
  const displayName = label.slice(0, -extension.length);
  assert.equal(meta.ver, '1.0.27', `${label}.meta must use the Cocos image importer version`);
  assert.equal(meta.importer, 'image', `${label}.meta must use the image importer`);
  assert.equal(meta.imported, true, `${label}.meta must be imported`);
  assert.match(meta.uuid ?? '', /^[0-9a-f-]{36}$/, `${label}.meta must declare a UUID`);
  assert.deepEqual(meta.files, ['.json', extension], `${label}.meta must declare texture and sprite-frame sub-assets`);
  assertSameKeys(meta.subMetas, ['6c48a', 'f9941'], `${label}.meta subMetas`);

  const texture = meta.subMetas['6c48a'];
  const spriteFrame = meta.subMetas['f9941'];
  assert.deepEqual(
    { importer: texture.importer, id: texture.id, name: texture.name },
    { importer: 'texture', id: '6c48a', name: 'texture' },
    `${label}.meta texture subMeta is incomplete`
  );
  assert.deepEqual(
    { importer: spriteFrame.importer, id: spriteFrame.id, name: spriteFrame.name },
    { importer: 'sprite-frame', id: 'f9941', name: 'spriteFrame' },
    `${label}.meta sprite-frame subMeta is incomplete`
  );
  assert.equal(texture.uuid, `${meta.uuid}@6c48a`, `${label}.meta texture UUID must derive from the image UUID`);
  assert.equal(spriteFrame.uuid, `${meta.uuid}@f9941`, `${label}.meta sprite-frame UUID must derive from the image UUID`);
  assert.equal(texture.displayName, displayName, `${label}.meta texture displayName drifted`);
  assert.equal(spriteFrame.displayName, displayName, `${label}.meta sprite-frame displayName drifted`);
  assert.equal(texture.userData.imageUuidOrDatabaseUri, meta.uuid, `${label}.meta texture must reference its image UUID`);
  assert.equal(spriteFrame.userData.imageUuidOrDatabaseUri, `${meta.uuid}@6c48a`, `${label}.meta sprite-frame must reference its texture UUID`);
  assert.equal(spriteFrame.userData.rawWidth, png.width, `${label}.meta rawWidth must match decoded PNG`);
  assert.equal(spriteFrame.userData.rawHeight, png.height, `${label}.meta rawHeight must match decoded PNG`);
  assert.equal(spriteFrame.userData.width, png.width, `${label}.meta width must match decoded PNG`);
  assert.equal(spriteFrame.userData.height, png.height, `${label}.meta height must match decoded PNG`);
  assert.equal(spriteFrame.userData.trimX, 0, `${label}.meta trimX must remain zero for a full-image preview/atlas`);
  assert.equal(spriteFrame.userData.trimY, 0, `${label}.meta trimY must remain zero for a full-image preview/atlas`);
  assert.equal(spriteFrame.userData.trimType, 'auto', `${label}.meta trimType must remain auto`);
  assert.equal(meta.userData.type, 'sprite-frame', `${label}.meta userData.type must be sprite-frame`);
  assert.equal(meta.userData.fixAlphaTransparencyArtifacts, false, `${label}.meta alpha artifact policy drifted`);
  assert.equal(meta.userData.hasAlpha, png.hasAlpha, `${label}.meta hasAlpha must match decoded PNG alpha channels`);
  assert.equal(meta.userData.redirect, `${meta.uuid}@6c48a`, `${label}.meta redirect must target the texture sub-asset`);
}

function validateU004PngMetaContracts() {
  const pngNames = [
    'U004-CUTOUT-SHEET.png',
    'U004-ENEMY-LEFT-PREVIEW.png',
    'U004-PLAYER-RIGHT-PREVIEW.png',
    'U004-POSE-SHEET.png'
  ];
  const assetRoot = resolve(projectRoot, 'assets/resources/art/battle/units/U004');
  assert.deepEqual(
    readdirSync(assetRoot).filter((name) => name.endsWith('.png')).sort(),
    [...pngNames].sort(),
    'every U004 PNG must be enumerated by the meta contract'
  );
  const pngAssets = new Map();
  for (const pngName of pngNames) {
    const pngPath = resolve(assetRoot, pngName);
    const png = readPng(pngPath);
    const meta = readJson(`${pngPath}.meta`);
    validateCocosImageMeta(pngPath, png, meta);
    pngAssets.set(pngName, { path: pngPath, png, meta });
  }
  return pngAssets;
}

function compareHorizontalMirror(playerPng, enemyPng, correctionRegion) {
  assert.deepEqual(
    { width: enemyPng.width, height: enemyPng.height },
    { width: playerPng.width, height: playerPng.height },
    'player-right and enemy-left previews must share a canvas'
  );
  let changedPixels = 0;
  let outsideCorrection = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < enemyPng.height; y += 1) {
    for (let x = 0; x < enemyPng.width; x += 1) {
      const enemyOffset = (y * enemyPng.width + x) * 4;
      const playerOffset = (y * playerPng.width + (playerPng.width - 1 - x)) * 4;
      let changed = false;
      for (let channel = 0; channel < 4; channel += 1) {
        if (enemyPng.pixels[enemyOffset + channel] !== playerPng.pixels[playerOffset + channel]) {
          changed = true;
          break;
        }
      }
      if (!changed) continue;
      changedPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (
        x < correctionRegion.x ||
        y < correctionRegion.y ||
        x >= correctionRegion.x + correctionRegion.width ||
        y >= correctionRegion.y + correctionRegion.height
      ) {
        outsideCorrection += 1;
      }
    }
  }
  return {
    changedPixels,
    outsideCorrection,
    bounds: changedPixels === 0
      ? null
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  };
}

function validatePreviewSemantics(label, preview, facing) {
  assert.equal(isRecord(preview), true, `${label} preview contract must be an object`);
  assert.equal(typeof preview.path, 'string', `${label} preview path must be a string`);
  assert.equal(preview.path.startsWith('cocos-client/assets/resources/art/battle/units/U004/'), true, `${label} preview path escaped the approved U004 directory`);
  const previewPath = resolve(repoRoot, preview.path);
  const approvedPreviewRoot = resolve(repoRoot, 'cocos-client/assets/resources/art/battle/units/U004');
  assert.equal(previewPath.startsWith(`${approvedPreviewRoot}/`), true, `${label} preview path resolved outside the approved U004 directory`);
  const previewPng = readPng(previewPath);
  assert.deepEqual({ width: previewPng.width, height: previewPng.height }, preview.size, `${label} preview dimensions changed unexpectedly`);
  assert.equal(sha256(previewPath), preview.sha256, `${label} preview hash changed unexpectedly`);
  assert.equal(previewPng.byteLength > 500000, true, `${label} preview is too small to count as review evidence`);
  assert.equal(preview.pngColorType, previewPng.colorType, `${label} preview PNG color type changed unexpectedly`);
  assert.equal(preview.hasAlpha, previewPng.hasAlpha, `${label} preview alpha contract changed unexpectedly`);
  assert.equal(isRecord(preview.landmarks), true, `${label} landmarks must be an object`);
  assertSameKeys(preview.landmarks, requiredLandmarks, `${label} landmarks`);
  for (const landmark of requiredLandmarks) {
    assertPoint(preview.landmarks[landmark], preview.size, `${label}.${landmark}`);
  }
  const { wingTip, wingRoot, drawHand, bowGrip, arrowHead } = preview.landmarks;
  assert.equal(Math.abs(drawHand.y - bowGrip.y) <= 32, true, `${label} drawHand and bowGrip must stay on the same shot lane`);
  assert.equal(Math.abs(arrowHead.y - bowGrip.y) <= 32, true, `${label} arrowHead must stay aligned with the bow grip`);
  if (facing === 'RIGHT') {
    assert.equal(wingTip.x < wingRoot.x, true, `${label} wing tip must remain behind the wing root`);
    assert.equal(wingRoot.x < drawHand.x, true, `${label} wing root must stay behind the draw hand`);
    assert.equal(drawHand.x < bowGrip.x, true, `${label} draw hand must stay behind the bow grip`);
    assert.equal(bowGrip.x < arrowHead.x, true, `${label} bow grip must stay behind the arrow head`);
  } else {
    assert.equal(wingTip.x > wingRoot.x, true, `${label} wing tip must remain behind the wing root after mirroring`);
    assert.equal(wingRoot.x > drawHand.x, true, `${label} wing root must stay behind the draw hand after mirroring`);
    assert.equal(drawHand.x > bowGrip.x, true, `${label} draw hand must stay behind the bow grip after mirroring`);
    assert.equal(bowGrip.x > arrowHead.x, true, `${label} bow grip must stay behind the arrow head after mirroring`);
  }
  return previewPng;
}

function validateDirectionContract(skeleton) {
  assert.deepEqual(skeleton.orientations, {
    player: { direction: 1, scaleX: 1 },
    enemy: { direction: -1, scaleX: -1 }
  }, 'U004 must lock the player-right/enemy-left runtime facing contract');
  assert.equal(isRecord(skeleton.directionContract), true, 'U004 must declare a directionContract');
  assert.equal(skeleton.directionContract.canonicalFacing, 'player-right', 'U004 canonicalFacing must remain player-right');
  assert.equal(
    skeleton.directionContract.runtimeMirrorMode,
    'validated-horizontal-mirror-with-independent-enemy-correction',
    'U004 runtimeMirrorMode must preserve the independent enemy correction'
  );
  assert.equal(skeleton.directionContract.playerFacing, 'RIGHT', 'U004 playerFacing must remain RIGHT');
  assert.equal(skeleton.directionContract.enemyFacing, 'LEFT', 'U004 enemyFacing must remain LEFT');
  assert.deepEqual(skeleton.directionContract.safeMirrorJustification, [
    'canonical player-right source art has no text, heraldry, or single-side props that would invert gameplay meaning after horizontal mirror',
    'the base draw-hand, bow grip, and arrow head remain ordered along the shot lane after horizontal mirror',
    'the independent enemy control sigil stays in its declared wing region outside the shot lane while wing root visibility remains intact'
  ], 'U004 safeMirrorJustification drifted from the approved mirror rationale');
  assert.deepEqual(skeleton.directionContract.failureCounterexamples, [
    'single-side insignia, text, or prop in the canonical source would invalidate the base horizontal relationship',
    'if the enemy correction enters the shot lane or the draw hand crosses beyond bow grip, the left-facing attack is rejected',
    'if wing root disappears or wing arc overlaps the arrow lane, mirrored enemy facing is rejected'
  ], 'U004 failureCounterexamples drifted from the approved mirror guardrails');
  assert.equal(isRecord(skeleton.directionContract.previewEvidence), true, 'U004 previewEvidence must be an object');
  assertSameKeys(skeleton.directionContract.previewEvidence, ['enemyLeft', 'playerRight'], 'U004 previewEvidence');
  const playerRight = skeleton.directionContract.previewEvidence.playerRight;
  const enemyLeft = skeleton.directionContract.previewEvidence.enemyLeft;
  const playerPng = validatePreviewSemantics('playerRight', playerRight, 'RIGHT');
  const enemyPng = validatePreviewSemantics('enemyLeft', enemyLeft, 'LEFT');
  assert.equal(enemyLeft.derivedFrom, 'playerRight', 'enemyLeft preview must declare playerRight as its source');
  assert.equal(enemyLeft.transform, 'horizontal-flip-plus-independent-correction', 'enemyLeft preview must declare a horizontal-flip plus independent correction');
  assert.equal(enemyLeft.sourceRelationship, 'playerRight-reference-with-independent-enemy-correction', 'enemyLeft preview must declare its independent source relationship');
  assert.equal(isRecord(enemyLeft.nonMirrorCorrection), true, 'enemyLeft preview must declare a non-mirror correction');
  assert.equal(enemyLeft.nonMirrorCorrection.kind, 'enemy-control-sigil', 'enemyLeft correction must identify the enemy control sigil');
  assert.equal(enemyLeft.nonMirrorCorrection.purpose, 'distinguish-enemy-left-control-state-without-changing-shot-lane', 'enemyLeft correction purpose drifted');
  assertRect(enemyLeft.nonMirrorCorrection.region, enemyLeft.size, 'enemyLeft nonMirrorCorrection.region');
  assert.equal(Number.isInteger(enemyLeft.nonMirrorCorrection.minimumChangedPixels), true, 'enemyLeft correction pixel floor must be an integer');
  assert.equal(enemyLeft.nonMirrorCorrection.minimumChangedPixels > 0, true, 'enemyLeft correction pixel floor must be positive');
  assert.equal(enemyLeft.nonMirrorCorrection.verification, 'decoded-rgba-difference-from-exact-horizontal-flip', 'enemyLeft correction must require decoded pixel verification');
  assert.deepEqual(enemyLeft.nonMirrorCorrection.mustPreserve, ['player-right/enemy-left semantics', 'wing root visibility', 'clear shot lane'], 'enemyLeft correction guardrails drifted');
  const mirrorDifference = compareHorizontalMirror(playerPng, enemyPng, enemyLeft.nonMirrorCorrection.region);
  assert.equal(mirrorDifference.changedPixels >= enemyLeft.nonMirrorCorrection.minimumChangedPixels, true, 'enemy-left preview must contain a measurable non-mirror correction');
  assert.equal(mirrorDifference.outsideCorrection, 0, 'enemy-left preview non-mirror correction must stay inside its declared region');
  assert.deepEqual(mirrorDifference.bounds, enemyLeft.nonMirrorCorrection.region, 'enemy-left preview correction bounds must match the declared region');
  assert.deepEqual(enemyLeft.size, playerRight.size, 'enemyLeft preview must keep the same canvas size as playerRight');
  for (const landmark of requiredLandmarks) {
    assert.equal(
      enemyLeft.landmarks[landmark].x,
      playerRight.size.width - 1 - playerRight.landmarks[landmark].x,
      `${landmark} x must stay horizontally mirrored`
    );
    assert.equal(enemyLeft.landmarks[landmark].y, playerRight.landmarks[landmark].y, `${landmark} y must stay vertically aligned`);
  }
}

function validateSkeleton(skeleton) {
  assert.equal(skeleton.schema, 'battle-unit-production/v1', 'U004 must use the battle-unit-production/v1 contract');
  assert.equal(skeleton.contractVersion, '2.2', 'U004 must target the v2.2 contract');
  assert.equal(skeleton.unitId, 'U004', 'U004 skeleton must identify itself correctly');
  assert.equal(skeleton.assetStage, 'A2-derived-battle-reference', 'U004 must be marked as a derived battle reference');
  assert.equal(skeleton.runtimeMode, 'pose-sheet-skeleton', 'U004 must remain a pose-sheet skeleton');
  assert.equal(skeleton.derivationPolicy, 'derived-from-approved-card-art; no-synthetic-anatomy-outside-source-silhouette', 'U004 derivation policy changed unexpectedly');

  assert.deepEqual(skeleton.designTruth, {
    name: '岚羽游射手',
    race: '羽民',
    politicalFaction: '山海诸庭',
    battleRole: '远射',
    coreAbility: '射程三',
    visualArchetype: 'WINGED_HUMANOID'
  }, 'U004 design truth must stay aligned with the approved docs');

  assert.deepEqual(skeleton.combatProfile, {
    maxHp: 4,
    attack: 3,
    armor: 0,
    spellResist: 0,
    move: 1,
    range: 3,
    attackChannel: 'PHYSICAL',
    offenseType: 'PIERCE',
    defenseType: 'LIGHT',
    element: 'WOOD',
    role: 'RANGED',
    prepare: 3,
    copyLimit: 4,
    abilityId: 'A004'
  }, 'U004 combat profile drifted from the approved config');

  assert.equal(skeleton.artConstraints.weaponType, 'LONG_BOW', 'U004 must keep the long-bow weapon silhouette');
  assert.equal(skeleton.artConstraints.wingRootVisible, true, 'U004 must expose the wing root');
  assert.equal(skeleton.artConstraints.shotLaneClear, true, 'U004 must preserve a clear shot lane');
  assert.deepEqual(skeleton.artConstraints.requiredNotes, ['长弓', '翼根', '翼片不得遮挡射击方向'], 'U004 art notes must remain frozen');

  assert.deepEqual({ width: skeleton.canvas.width, height: skeleton.canvas.height }, { width: 512, height: 512 }, 'U004 canvas must stay at 512x512');
  assert.equal(typeof skeleton.canvas.pivot.x, 'number', 'U004 pivot.x must be numeric');
  assert.equal(typeof skeleton.canvas.pivot.y, 'number', 'U004 pivot.y must be numeric');
  assert.equal(skeleton.canvas.pivot.x >= 0 && skeleton.canvas.pivot.x <= 1, true, 'U004 pivot.x must stay normalized');
  assert.equal(skeleton.canvas.pivot.y >= 0 && skeleton.canvas.pivot.y <= 1, true, 'U004 pivot.y must stay normalized');

  const posePanels = skeleton.atlases.poseSheet.statePanels;
  assert.equal(Array.isArray(posePanels), true, 'U004 pose sheet must declare state panels');
  assert.equal(posePanels.length, requiredStates.length, 'U004 pose sheet must contain exactly five state panels');
  let poseCursor = 0;
  for (const [index, panel] of posePanels.entries()) {
    assert.equal(panel.index, index, 'U004 pose panel indices must be contiguous');
    assert.equal(panel.state, requiredStates[index], 'U004 pose panels must remain ordered Idle->Death');
    assertRect(panel.rect, skeleton.atlases.poseSheet.size, `pose panel ${panel.state}`);
    assert.equal(panel.rect.x, poseCursor, `U004 ${panel.state} panel must start where the previous panel ends`);
    assert.equal(panel.rect.y, 0, `U004 ${panel.state} panel must start at y=0`);
    assert.equal(panel.rect.height, skeleton.atlases.poseSheet.size.height, `U004 ${panel.state} panel must span the full pose-sheet height`);
    poseCursor += panel.rect.width;
  }
  assert.equal(poseCursor, skeleton.atlases.poseSheet.size.width, 'U004 pose sheet panels must cover the full width');

  const cutoutSlices = new Map(skeleton.atlases.cutoutSheet.slices.map((slice) => [slice.name, slice]));
  assert.equal(cutoutSlices.size, 5, 'U004 cutout sheet must expose five named reference slices');
  for (const slice of skeleton.atlases.cutoutSheet.slices) {
    assertRect(slice.rect, skeleton.atlases.cutoutSheet.size, `cutout slice ${slice.name}`);
  }

  assert.equal(Array.isArray(skeleton.bones) && skeleton.bones.length >= 7, true, 'U004 must define a non-trivial bone hierarchy');
  const boneNames = new Set();
  for (const [index, bone] of skeleton.bones.entries()) {
    assert.match(bone.name ?? '', /^[a-z][a-zA-Z0-9]*$/, `U004 bone ${index} name must be stable`);
    assert.equal(boneNames.has(bone.name), false, `U004 bone ${bone.name} is duplicated`);
    if (index === 0) {
      assert.equal(bone.name, 'root', 'U004 hierarchy must start at root');
      assert.equal('parent' in bone, false, 'U004 root must not declare a parent');
    } else {
      assert.equal(boneNames.has(bone.parent), true, `U004 bone ${bone.name} must reference an earlier parent`);
    }
    boneNames.add(bone.name);
  }

  assert.equal(Array.isArray(skeleton.attachments) && skeleton.attachments.length >= 5, true, 'U004 must expose source-backed attachments');
  const attachmentNames = new Set();
  for (const attachment of skeleton.attachments) {
    assert.match(attachment.name ?? '', /^[a-z][a-zA-Z0-9]*$/, `U004 attachment ${attachment.name} must be stable`);
    assert.equal(attachmentNames.has(attachment.name), false, `U004 attachment ${attachment.name} is duplicated`);
    assert.equal(boneNames.has(attachment.bone), true, `U004 attachment ${attachment.name} targets an unknown bone`);
    assert.equal(attachment.source, 'cutoutSheet', `U004 attachment ${attachment.name} must use cutoutSheet`);
    assertRect(attachment.sourceRect, skeleton.atlases.cutoutSheet.size, `U004 attachment ${attachment.name}`);
    assert.equal(attachment.width, attachment.sourceRect.width, `U004 attachment ${attachment.name} width must match sourceRect.width`);
    assert.equal(attachment.height, attachment.sourceRect.height, `U004 attachment ${attachment.name} height must match sourceRect.height`);
    attachmentNames.add(attachment.name);
  }

  assert.equal(Array.isArray(skeleton.mountPoints), true, 'U004 must define mount points');
  const mounts = new Map(skeleton.mountPoints.map((mount) => [mount.name, mount]));
  assert.deepEqual([...mounts.keys()].sort(), [...requiredMounts].sort(), 'U004 mount point keys changed unexpectedly');
  assert.equal(mounts.get('attackOrigin').bone, 'bow', 'U004 attackOrigin must sit on the bow');
  assert.equal(mounts.get('attackOrigin').x >= 160 && mounts.get('attackOrigin').x <= 240, true, 'U004 attackOrigin.x must remain in the forward shot lane');
  assert.equal(Math.abs(mounts.get('attackOrigin').y) <= 24, true, 'U004 attackOrigin.y must stay near the arrow trajectory');
  assert.equal(mounts.get('effect').bone, 'torso', 'U004 effect mount must stay on the torso');
  assert.equal(mounts.get('healthBar').bone, 'root', 'U004 healthBar mount must stay on root');
  assert.equal(mounts.get('healthBar').y >= 180 && mounts.get('healthBar').y <= 256, true, 'U004 healthBar must remain above the silhouette');
  assert.equal(mounts.get('shadow').bone, 'root', 'U004 shadow must stay on root');
  assert.equal(mounts.get('shadow').y >= -32 && mounts.get('shadow').y <= 8, true, 'U004 shadow must remain close to ground contact');
  assert.equal(mounts.get('cardAnchor').bone, 'root', 'U004 cardAnchor must stay on root');

  validateDirectionContract(skeleton);

  assertSameKeys(skeleton.stateMap, requiredStates, 'U004 stateMap');
  for (const [index, state] of requiredStates.entries()) {
    assert.deepEqual(skeleton.stateMap[state], { source: 'poseSheet', panelIndex: index }, `U004 ${state} must point at its matching pose panel`);
  }

  assertSameKeys(skeleton.animations, requiredStates, 'U004 animations');
  for (const state of requiredStates) {
    const animation = skeleton.animations[state];
    assert.equal(typeof animation.duration, 'number', `U004 ${state} duration must be numeric`);
    assert.equal(animation.duration > 0, true, `U004 ${state} duration must be positive`);
    assert.deepEqual(animation.sourcePose, skeleton.stateMap[state], `U004 ${state} source pose must match stateMap`);
    assert.equal(Array.isArray(animation.tracks) && animation.tracks.length >= 1, true, `U004 ${state} must define transform tracks`);
    let hasChangingTrack = false;
    for (const track of animation.tracks) {
      assert.equal(boneNames.has(track.bone), true, `U004 ${state} track targets an unknown bone`);
      assert.equal(allowedTrackProperties.has(track.property), true, `U004 ${state} uses an unsupported property`);
      assert.equal(Array.isArray(track.frames) && track.frames.length >= 2, true, `U004 ${state} track must contain two or more keyframes`);
      let lastTime = -1;
      const values = new Set();
      for (const frame of track.frames) {
        assert.equal(typeof frame.time === 'number' && Number.isFinite(frame.time), true, `U004 ${state} frame time must be finite`);
        assert.equal(typeof frame.value === 'number' && Number.isFinite(frame.value), true, `U004 ${state} frame value must be finite`);
        assert.equal(frame.time >= 0 && frame.time <= animation.duration, true, `U004 ${state} frame time must stay within its duration`);
        assert.equal(frame.time > lastTime, true, `U004 ${state} frame times must be strictly ordered`);
        lastTime = frame.time;
        values.add(frame.value);
      }
      assert.equal(track.frames[0].time, 0, `U004 ${state} tracks must start at t=0`);
      if (values.size > 1) {
        hasChangingTrack = true;
      }
    }
    assert.equal(hasChangingTrack, true, `U004 ${state} must contain visible transform change`);
  }

  assert.equal(skeleton.animations.Idle.loop, true, 'U004 Idle must loop');
  assert.equal(skeleton.animations.Move.loop, true, 'U004 Move must loop');
  for (const state of ['Attack', 'Hit', 'Death']) {
    assert.equal(skeleton.animations[state].loop, false, `U004 ${state} must not loop`);
  }
  const attackImpact = skeleton.animations.Attack.events.find((event) => event.name === 'impact');
  assert.equal(Boolean(attackImpact), true, 'U004 Attack must expose an impact event');
  assert.equal(attackImpact.time > 0 && attackImpact.time < skeleton.animations.Attack.duration, true, 'U004 Attack impact must occur inside the animation');
  const hitEvent = skeleton.animations.Hit.events.find((event) => event.name === 'hit');
  assert.equal(Boolean(hitEvent), true, 'U004 Hit must expose a hit event');
  const despawn = skeleton.animations.Death.events.find((event) => event.name === 'despawn');
  assert.equal(Boolean(despawn), true, 'U004 Death must expose a despawn event');
  assert.equal(despawn.time, skeleton.animations.Death.duration, 'U004 Death despawn must align with the final keyframe');
}

function validateAgainstConfigAndDocs(skeleton) {
  const units = readJson(resolve(projectRoot, 'assets/resources/config/units.json')).units;
  const cards = readJson(resolve(projectRoot, 'assets/resources/config/cards.json')).cards;
  const unit = units.find((entry) => entry.id === 'U004');
  const card = cards.find((entry) => entry.id === 'U004');
  assert(unit, 'real units.json must contain U004');
  assert(card, 'real cards.json must contain U004');

  assert.equal(skeleton.designTruth.race, unit.race, 'U004 race must match units.json');
  assert.equal(skeleton.designTruth.politicalFaction, unit.politicalFaction, 'U004 politicalFaction must match units.json');
  assert.equal(skeleton.designTruth.visualArchetype, unit.visualArchetype, 'U004 visual archetype must match units.json');
  assert.equal(skeleton.combatProfile.maxHp, unit.maxHp, 'U004 maxHp must match units.json');
  assert.equal(skeleton.combatProfile.attack, unit.attack, 'U004 attack must match units.json');
  assert.equal(skeleton.combatProfile.armor, unit.armor, 'U004 armor must match units.json');
  assert.equal(skeleton.combatProfile.move, unit.move, 'U004 move must match units.json');
  assert.equal(skeleton.combatProfile.range, unit.range, 'U004 range must match units.json');
  assert.equal(skeleton.combatProfile.attackChannel, unit.attackChannel, 'U004 attackChannel must match units.json');
  assert.equal(skeleton.combatProfile.offenseType, unit.offenseType, 'U004 offenseType must match units.json');
  assert.equal(skeleton.combatProfile.defenseType, unit.defenseType, 'U004 defenseType must match units.json');
  assert.equal(skeleton.combatProfile.element, unit.element, 'U004 element must match units.json');
  assert.equal(skeleton.combatProfile.role, unit.role, 'U004 role must match units.json');
  assert.equal(skeleton.combatProfile.abilityId, unit.abilityIds[0], 'U004 abilityId must match units.json');
  assert.equal(skeleton.combatProfile.prepare, card.prepare, 'U004 prepare must match cards.json');
  assert.equal(skeleton.combatProfile.copyLimit, card.copyLimit, 'U004 copyLimit must match cards.json');

  const roleDoc = readText(resolve(repoRoot, '角色兵种体系-v1.1.md'));
  const factionDoc = readText(resolve(repoRoot, '阵营与种族设定-v1.1.md'));
  const cardDoc = readText(resolve(repoRoot, '第一批卡牌设计表.md'));
  const artDoc = readText(resolve(repoRoot, '首批美术素材清单-v2.2.md'));

  assert.match(roleDoc, /\|\s*U004\s*\|\s*岚羽游射手\s*\|\s*远射\s*\|\s*3\s*\|\s*射程三\s*\|/, '角色兵种体系 must freeze U004 as a range-3 羽民远射单位');
  assert.match(roleDoc, /\|\s*U004\s*\|\s*穿刺\s*\|\s*轻装\s*\|\s*木\s*\|\s*远射巨躯，惧怕快速近逼与金术\s*\|/, '角色兵种体系 must freeze the U004 offense/defense/element tuple');
  assert.equal(factionDoc.includes('### 3.6 山海诸庭'), true, '阵营与种族设定 must retain 山海诸庭');
  assert.equal(factionDoc.includes('### 5.2 羽民'), true, '阵营与种族设定 must retain 羽民');
  assert.match(cardDoc, /\|\s*U004\s*\|\s*岚羽游射手\s*\|\s*羽民\s*\|\s*4\s*\|\s*3\s*\|\s*4\s*\|\s*3\s*\|\s*0\s*\|\s*1\s*\|\s*3\s*\|\s*远程\s*\|\s*前后排结构\s*\|/, '第一批卡牌设计表 must retain the U004 statline');
  assert.match(artDoc, /\|\s*U004 岚羽游射手\s*\|\s*长弓、翼根\s*\|\s*翼片不得遮挡射击方向\s*\|/, '首批美术素材清单 must retain the U004 art constraint');
}

function validateFileBackedAssets(skeleton) {
  const sourceArtPath = resolve(repoRoot, skeleton.sourceArt.path);
  const poseSheetPath = resolve(repoRoot, skeleton.atlases.poseSheet.path);
  const cutoutSheetPath = resolve(repoRoot, skeleton.atlases.cutoutSheet.path);

  const sourceSize = readPng(sourceArtPath);
  assert.deepEqual({ width: sourceSize.width, height: sourceSize.height }, skeleton.sourceArt.size, 'U004 source art dimensions changed unexpectedly');
  assert.equal(sha256(sourceArtPath), skeleton.sourceArt.sha256, 'U004 source art hash changed unexpectedly');
  assert.equal(sourceSize.byteLength > 500000, true, 'U004 source art looks too small to be the approved card art');

  const poseSize = readPng(poseSheetPath);
  assert.deepEqual({ width: poseSize.width, height: poseSize.height }, skeleton.atlases.poseSheet.size, 'U004 pose-sheet dimensions changed unexpectedly');
  assert.equal(sha256(poseSheetPath), skeleton.atlases.poseSheet.sha256, 'U004 pose-sheet hash changed unexpectedly');
  assert.equal(poseSize.byteLength > 500000, true, 'U004 pose-sheet must be a real derived atlas, not a placeholder');

  const cutoutSize = readPng(cutoutSheetPath);
  assert.deepEqual({ width: cutoutSize.width, height: cutoutSize.height }, skeleton.atlases.cutoutSheet.size, 'U004 cutout-sheet dimensions changed unexpectedly');
  assert.equal(sha256(cutoutSheetPath), skeleton.atlases.cutoutSheet.sha256, 'U004 cutout-sheet hash changed unexpectedly');
  assert.equal(cutoutSize.byteLength > 600000, true, 'U004 cutout-sheet must be a real derived atlas, not a placeholder');

  const playerPreviewPath = resolve(repoRoot, skeleton.directionContract.previewEvidence.playerRight.path);
  const enemyPreviewPath = resolve(repoRoot, skeleton.directionContract.previewEvidence.enemyLeft.path);
  assert.equal(statSync(playerPreviewPath).size > 500000, true, 'U004 player-right preview must be a real review artifact');
  assert.equal(statSync(enemyPreviewPath).size > 500000, true, 'U004 enemy-left preview must be a real review artifact');
  assert.equal(statSync(resolve(projectRoot, 'assets/resources/art/battle/units/U004/skeleton.json')).size > 7000, true, 'U004 skeleton contract is suspiciously small');
}

function expectFailure(label, fn, pattern) {
  assert.throws(fn, pattern, `${label} must fail`);
}

const skeletonPath = resolve(projectRoot, 'assets/resources/art/battle/units/U004/skeleton.json');
const skeleton = readJson(skeletonPath);

const pngAssets = validateU004PngMetaContracts();
assert.equal(pngAssets.size, 4, 'U004 must validate every PNG in its approved asset directory');
validateFileBackedAssets(skeleton);
validateSkeleton(skeleton);
validateAgainstConfigAndDocs(skeleton);

expectFailure('missing Attack state', () => validateSkeleton({
  ...skeleton,
  stateMap: { Idle: skeleton.stateMap.Idle, Move: skeleton.stateMap.Move, Hit: skeleton.stateMap.Hit, Death: skeleton.stateMap.Death },
  animations: { Idle: skeleton.animations.Idle, Move: skeleton.animations.Move, Hit: skeleton.animations.Hit, Death: skeleton.animations.Death }
}), /Attack/);

expectFailure('out-of-lane attackOrigin', () => validateSkeleton({
  ...skeleton,
  mountPoints: skeleton.mountPoints.map((mount) => (mount.name === 'attackOrigin' ? { ...mount, x: 48 } : mount))
}), /attackOrigin/);

expectFailure('range drift from real config', () => validateAgainstConfigAndDocs({
  ...skeleton,
  combatProfile: { ...skeleton.combatProfile, range: 2 }
}), /range/);

expectFailure('pose panel overflow', () => validateSkeleton({
  ...skeleton,
  atlases: {
    ...skeleton.atlases,
    poseSheet: {
      ...skeleton.atlases.poseSheet,
      statePanels: skeleton.atlases.poseSheet.statePanels.map((panel) => (
        panel.state === 'Death'
          ? { ...panel, rect: { ...panel.rect, width: panel.rect.width + 40 } }
          : panel
      ))
    }
  }
}), /pose panel Death|full width/);

expectFailure('reversed player/enemy mapping', () => validateSkeleton({
  ...skeleton,
  orientations: {
    player: { direction: -1, scaleX: -1 },
    enemy: { direction: 1, scaleX: 1 }
  }
}), /player-right\/enemy-left/);

expectFailure('missing enemy-left preview evidence', () => validateSkeleton({
  ...skeleton,
  directionContract: {
    ...skeleton.directionContract,
    previewEvidence: {
      ...skeleton.directionContract.previewEvidence,
      enemyLeft: {
        ...skeleton.directionContract.previewEvidence.enemyLeft,
        path: 'cocos-client/assets/resources/art/battle/units/U004/U004-ENEMY-LEFT-MISSING.png'
      }
    }
  }
}), /ENOENT|enemyLeft preview/);

expectFailure('enemy-left exact horizontal mirror', () => {
  const exactMirror = structuredClone(skeleton);
  exactMirror.directionContract.previewEvidence.enemyLeft.path = exactMirror.directionContract.previewEvidence.playerRight.path;
  exactMirror.directionContract.previewEvidence.enemyLeft.sha256 = exactMirror.directionContract.previewEvidence.playerRight.sha256;
  validateSkeleton(exactMirror);
}, /correction|outside|measurable|bounds/);

expectFailure('incomplete Cocos image meta', () => {
  const image = pngAssets.get('U004-PLAYER-RIGHT-PREVIEW.png');
  const incompleteMeta = structuredClone(image.meta);
  delete incompleteMeta.subMetas['f9941'];
  validateCocosImageMeta(image.path, image.png, incompleteMeta);
}, /subMetas/);

expectFailure('PNG alpha metadata drift', () => {
  const image = pngAssets.get('U004-CUTOUT-SHEET.png');
  const driftedMeta = structuredClone(image.meta);
  driftedMeta.userData.hasAlpha = false;
  validateCocosImageMeta(image.path, image.png, driftedMeta);
}, /hasAlpha/);

expectFailure('mirrored shot-lane semantics drift', () => validateSkeleton({
  ...skeleton,
  directionContract: {
    ...skeleton.directionContract,
    previewEvidence: {
      ...skeleton.directionContract.previewEvidence,
      enemyLeft: {
        ...skeleton.directionContract.previewEvidence.enemyLeft,
        landmarks: {
          ...skeleton.directionContract.previewEvidence.enemyLeft.landmarks,
          bowGrip: { ...skeleton.directionContract.previewEvidence.enemyLeft.landmarks.bowGrip, x: 736 }
        }
      }
    }
  }
}), /bow grip|horizontally mirrored/);

console.log('T281 U004: player-right/enemy-left contract, preview-backed mirror evidence, combat+faction+doc alignment, actions, mounts, and failure counterexamples PASS');
