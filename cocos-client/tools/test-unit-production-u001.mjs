import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(process.cwd());
const unitRoot = resolve(projectRoot, 'assets/resources/art/battle/units/U001');
const skeletonFile = resolve(unitRoot, 'skeleton.json');
const unitsFile = resolve(projectRoot, 'assets/resources/config/units.json');
const cardsFile = resolve(projectRoot, 'assets/resources/config/cards.json');

const REQUIRED_ACTIONS = ['Idle', 'Move', 'Attack', 'Hit', 'Death'];
const REQUIRED_MOUNTS = ['attackOrigin', 'effect', 'healthBar', 'shadow', 'cardAnchor'];
const TRACK_PROPERTIES = new Set(['translateX', 'translateY', 'rotate', 'scaleX', 'scaleY', 'opacity']);
const EXPECTED_POSE_STATES = new Map(REQUIRED_ACTIONS.map((state, index) => [state, index]));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXPECTED_GAMEPLAY = Object.freeze({
  unit: Object.freeze({
    id: 'U001',
    maxHp: 8,
    attack: 2,
    armor: 2,
    spellResist: 0,
    move: 1,
    range: 1,
    attackChannel: 'PHYSICAL',
    offenseType: 'SLASH',
    defenseType: 'HEAVY',
    element: 'EARTH',
    role: 'GUARD',
    abilityIds: Object.freeze(['A001']),
    visualArchetype: 'HUMANOID_INFANTRY',
    size: 'NORMAL',
    footprintCells: 1,
    race: '人族',
    politicalFaction: '朔垣军府',
    evidenceLevel: 'C',
    version: 1,
    enabled: true
  }),
  card: Object.freeze({
    id: 'U001',
    nameKey: 'unit.U001.name',
    descriptionKey: 'unit.U001.description',
    cardType: 'UNIT',
    race: '人族',
    politicalFaction: '朔垣军府',
    profession: 'NONE',
    rarity: 4,
    prepare: 3,
    copyLimit: 4,
    unitId: 'U001',
    tags: Object.freeze(['unit', 'guard']),
    evidenceLevel: 'C',
    version: 1,
    enabled: true
  })
});
const EXPECTED_CANVAS = Object.freeze({ width: 512, height: 512 });
const EXPECTED_SOURCES = Object.freeze({
  poseSheet: Object.freeze({
    id: 'U001-ANIMATION-POSES',
    path: 'assets/resources/art/battle/units/U001/U001-ANIMATION-POSES.png',
    referencePath: 'assets/resources/art/battle/units/U001/U001-ANIMATION-POSES.png',
    status: 'production-approved',
    kind: 'production-pose-sheet',
    size: Object.freeze({ width: 2000, height: 800 }),
    sha256: 'af901a19646f02532e855133c9e8f1b492c5eb73b5b426d7b58ed53ad7d96fea'
  }),
  poseAtlas: Object.freeze({
    id: 'U001-POSE-ATLAS',
    path: 'assets/resources/art/battle/units/U001/U001-POSE-ATLAS.png',
    referencePath: 'assets/resources/art/battle/units/U001/U001-POSE-ATLAS.png',
    status: 'production-derived-frozen',
    kind: 'production-derived-pose-atlas',
    derivedFrom: 'poseSheet',
    size: Object.freeze({ width: 1760, height: 640 }),
    sha256: '2b7427a2e3c489da49aace061104beced9aabb804f38797711ff3b4cfd487138'
  }),
  cutoutSheet: Object.freeze({
    id: 'U001-CUTOUT-SHEET',
    path: 'assets/resources/art/battle/units/U001/U001-CUTOUT-SHEET.png',
    referencePath: 'assets/resources/art/battle/units/U001/U001-CUTOUT-SHEET.png',
    status: 'production-approved',
    kind: 'production-cutout-sheet',
    size: Object.freeze({ width: 1536, height: 1024 }),
    sha256: '35d0b6b232caf1e06633d5d0f772603810a4aa8936b3ccb7a86aa8a9d812717e'
  }),
  cutoutAtlas: Object.freeze({
    id: 'U001-CUTOUT-ATLAS',
    path: 'assets/resources/art/battle/units/U001/U001-CUTOUT-ATLAS.png',
    referencePath: 'assets/resources/art/battle/units/U001/U001-CUTOUT-ATLAS.png',
    status: 'production-derived-frozen',
    kind: 'production-derived-cutout-atlas',
    derivedFrom: 'cutoutSheet',
    size: Object.freeze({ width: 1536, height: 1024 }),
    sha256: '5e3530093a4316b60814dc562631f505a2a983e658aa1786801d82470a0b7d16'
  })
});
const EXPECTED_SOURCE_KEYS = Object.freeze(['poseSheet', 'poseAtlas', 'cutoutSheet', 'cutoutAtlas']);
const MOUNT_CONTRACT = Object.freeze({
  expectedNames: Object.freeze(REQUIRED_MOUNTS),
  canvasBounds: Object.freeze({ x: Object.freeze([-256, 256]), y: Object.freeze([-256, 256]) }),
  points: Object.freeze({
    attackOrigin: Object.freeze({ bones: Object.freeze(['spear']), x: Object.freeze([160, 256]), y: Object.freeze([-32, 32]) }),
    effect: Object.freeze({ bones: Object.freeze(['torso']), x: Object.freeze([-64, 64]), y: Object.freeze([32, 128]) }),
    healthBar: Object.freeze({ bones: Object.freeze(['root']), x: Object.freeze([-32, 32]), y: Object.freeze([128, 256]) }),
    shadow: Object.freeze({ bones: Object.freeze(['root']), x: Object.freeze([-32, 32]), y: Object.freeze([-32, 32]) }),
    cardAnchor: Object.freeze({ bones: Object.freeze(['root']), x: Object.freeze([-32, 32]), y: Object.freeze([64, 160]) })
  })
});

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(record, expectedKeys, label) {
  assert.deepEqual(Object.keys(record).sort(), [...expectedKeys].sort(), `${label} keys must match the approved set`);
}

function assertUuid(value, label) {
  assert.match(value ?? '', UUID_PATTERN, `${label} must be a UUID`);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function loadJson(file) {
  assert.equal(existsSync(file), true, `missing required file: ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readProductionContext() {
  const units = loadJson(unitsFile);
  const cards = loadJson(cardsFile);
  const unit = units.units.find((entry) => entry.id === 'U001');
  const card = cards.cards.find((entry) => entry.id === 'U001');
  assert.deepEqual(unit, EXPECTED_GAMEPLAY.unit, 'U001 unit production config drifted');
  assert.deepEqual(card, EXPECTED_GAMEPLAY.card, 'U001 card production config drifted');
  return { unit, card };
}

function sourceFile(source, field) {
  assert.equal(typeof source?.[field], 'string', `source must declare ${field}`);
  assert.equal(source[field].startsWith('/'), false, `${field} must stay relative`);
  const file = resolve(projectRoot, source[field]);
  assert.equal(file.startsWith(`${projectRoot}/`), true, `${field} escapes the cocos-client project`);
  assert.equal(existsSync(file), true, `${field} is missing: ${source[field]}`);
  return file;
}

function validatePngSource(label, source, expected) {
  const file = sourceFile(source, 'path');
  const reference = sourceFile(source, 'referencePath');
  const bytes = readFileSync(file);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${label} must be PNG`);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${label} PNG must contain IHDR`);
  assert.equal(bytes[24], 8, `${label} PNG must use 8-bit channels`);
  assert.equal(bytes[25], 6, `${label} PNG must use RGBA pixels`);
  const actualSize = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  assert.deepEqual(actualSize, expected.size, `${label} dimensions drifted`);
  assert.deepEqual(source.size, expected.size, `${label} manifest size drifted`);
  assert.equal(sha256(file), expected.sha256, `${label} source hash drifted`);
  assert.equal(sha256(reference), expected.sha256, `${label} reference hash drifted`);
  assert.equal(source.id, expected.id, `${label} id must stay frozen`);
  assert.equal(source.path, expected.path, `${label} path must stay frozen`);
  assert.equal(source.referencePath, expected.referencePath, `${label} referencePath must stay frozen`);
  assert.equal(source.kind, expected.kind, `${label} kind must stay frozen`);
  assert.equal(source.status, expected.status, `${label} status must stay frozen`);
  assert.equal(source.sha256, expected.sha256, `${label} manifest hash must stay frozen`);
  return actualSize;
}

function validateImageMeta(label, file, expected) {
  const meta = loadJson(`${file}.meta`);
  assert.equal(meta.ver, '1.0.27', `${label} meta version must stay frozen`);
  assert.equal(meta.importer, 'image', `${label} meta importer must stay image`);
  assert.equal(meta.imported, true, `${label} meta must stay imported`);
  assertUuid(meta.uuid, `${label} meta uuid`);
  assert.deepEqual(meta.files, ['.json', '.png'], `${label} meta files must stay frozen`);
  assert.equal(isRecord(meta.subMetas), true, `${label} meta must contain subMetas`);
  const textureMeta = meta.subMetas['6c48a'];
  const spriteMeta = meta.subMetas.f9941;
  assert.equal(isRecord(textureMeta), true, `${label} texture subMeta is required`);
  assert.equal(isRecord(spriteMeta), true, `${label} spriteFrame subMeta is required`);
  assert.equal(textureMeta.importer, 'texture', `${label} texture importer must stay frozen`);
  assert.equal(spriteMeta.importer, 'sprite-frame', `${label} spriteFrame importer must stay frozen`);
  assert.equal(textureMeta.displayName, expected.id, `${label} texture displayName drifted`);
  assert.equal(spriteMeta.displayName, expected.id, `${label} spriteFrame displayName drifted`);
  assert.equal(textureMeta.uuid, `${meta.uuid}@6c48a`, `${label} texture uuid must stay derived from root uuid`);
  assert.equal(spriteMeta.uuid, `${meta.uuid}@f9941`, `${label} spriteFrame uuid must stay derived from root uuid`);
  assert.equal(textureMeta.userData?.imageUuidOrDatabaseUri, meta.uuid, `${label} texture source uuid drifted`);
  assert.equal(textureMeta.userData?.isUuid, true, `${label} texture source must stay uuid-backed`);
  assert.equal(spriteMeta.userData?.imageUuidOrDatabaseUri, textureMeta.uuid, `${label} spriteFrame must target the texture subMeta`);
  assert.equal(spriteMeta.userData?.isUuid, true, `${label} spriteFrame source must stay uuid-backed`);
  assert.equal(spriteMeta.userData?.atlasUuid, '', `${label} atlasUuid must stay empty`);
  assert.equal(spriteMeta.userData?.width, expected.size.width, `${label} spriteFrame width drifted`);
  assert.equal(spriteMeta.userData?.height, expected.size.height, `${label} spriteFrame height drifted`);
  assert.equal(spriteMeta.userData?.rawWidth, expected.size.width, `${label} spriteFrame rawWidth drifted`);
  assert.equal(spriteMeta.userData?.rawHeight, expected.size.height, `${label} spriteFrame rawHeight drifted`);
  assert.equal(meta.userData?.type, 'sprite-frame', `${label} meta type must stay sprite-frame`);
  assert.equal(meta.userData?.fixAlphaTransparencyArtifacts, false, `${label} alpha artifact fix flag must stay false`);
  assert.equal(meta.userData?.hasAlpha, true, `${label} meta must preserve alpha`);
  assert.equal(meta.userData?.redirect, textureMeta.uuid, `${label} redirect must stay pinned to the texture uuid`);
}

function validateRect(label, rect, sourceSize) {
  assert.equal(isRecord(rect), true, `${label} must declare a source rectangle`);
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.equal(Number.isInteger(rect[key]), true, `${label}.${key} must be an integer`);
  }
  assert.equal(rect.x >= 0 && rect.y >= 0, true, `${label} rectangle must start inside its source`);
  assert.equal(rect.width > 0 && rect.height > 0, true, `${label} rectangle must be positive`);
  assert.equal(rect.x + rect.width <= sourceSize.width, true, `${label} rectangle exceeds source width`);
  assert.equal(rect.y + rect.height <= sourceSize.height, true, `${label} rectangle exceeds source height`);
}

function validateSources(skeleton) {
  assert.equal(isRecord(skeleton.sources), true, 'skeleton must declare source assets');
  assertExactKeys(skeleton.sources, EXPECTED_SOURCE_KEYS, 'sources');
  const poseSheet = skeleton.sources.poseSheet;
  const poseAtlas = skeleton.sources.poseAtlas;
  const cutoutSheet = skeleton.sources.cutoutSheet;
  const cutoutAtlas = skeleton.sources.cutoutAtlas;
  const poseSize = validatePngSource('poseSheet', poseSheet, EXPECTED_SOURCES.poseSheet);
  validateImageMeta('poseSheet', sourceFile(poseSheet, 'path'), EXPECTED_SOURCES.poseSheet);
  const poseAtlasSize = validatePngSource('poseAtlas', poseAtlas, EXPECTED_SOURCES.poseAtlas);
  validateImageMeta('poseAtlas', sourceFile(poseAtlas, 'path'), EXPECTED_SOURCES.poseAtlas);
  const cutoutSize = validatePngSource('cutoutSheet', cutoutSheet, EXPECTED_SOURCES.cutoutSheet);
  validateImageMeta('cutoutSheet', sourceFile(cutoutSheet, 'path'), EXPECTED_SOURCES.cutoutSheet);
  const cutoutAtlasSize = validatePngSource('cutoutAtlas', cutoutAtlas, EXPECTED_SOURCES.cutoutAtlas);
  validateImageMeta('cutoutAtlas', sourceFile(cutoutAtlas, 'path'), EXPECTED_SOURCES.cutoutAtlas);
  assert.equal(poseAtlas.derivedFrom, EXPECTED_SOURCES.poseAtlas.derivedFrom, 'poseAtlas must stay derived from poseSheet');
  assert.equal(cutoutAtlas.derivedFrom, EXPECTED_SOURCES.cutoutAtlas.derivedFrom, 'cutoutAtlas must stay derived from cutoutSheet');
  assert.deepEqual(poseAtlas.size, poseAtlasSize, 'poseAtlas manifest size drifted');
  assert.deepEqual(cutoutAtlas.size, cutoutAtlasSize, 'cutoutAtlas manifest size drifted');

  assert.equal(Array.isArray(poseSheet.poseGrid), true, 'poseSheet must declare a pose grid');
  assert.equal(poseSheet.poseGrid.length, REQUIRED_ACTIONS.length, 'poseSheet must expose exactly five approved key poses');
  let previousPoseEnd = 0;
  for (const [index, pose] of poseSheet.poseGrid.entries()) {
    assert.equal(pose.index, index, 'pose grid indices must be contiguous');
    assert.equal(pose.state, REQUIRED_ACTIONS[index], 'pose grid order must stay Idle, Move, Attack, Hit, Death');
    validateRect(`poseGrid[${index}]`, pose.rect, poseSize);
    assert.equal(pose.rect.y, 0, `poseGrid[${index}] must start at y=0`);
    assert.equal(pose.rect.height, poseSize.height, `poseGrid[${index}] must cover the source height`);
    assert.equal(pose.rect.x, previousPoseEnd, `poseGrid[${index}] must remain contiguous`);
    previousPoseEnd = pose.rect.x + pose.rect.width;
  }
  assert.equal(previousPoseEnd, poseSize.width, 'poseSheet must cover the full width');
  return { poseGrid: poseSheet.poseGrid, cutoutSize };
}

function validatePoseReference(label, reference, actionName, poseGrid) {
  assert.equal(isRecord(reference), true, `${label} must declare a pose reference`);
  assert.equal(reference.source, 'poseSheet', `${label} must use the frozen pose sheet`);
  assert.equal(Number.isSafeInteger(reference.poseIndex), true, `${label} poseIndex must be an integer`);
  assert.equal(reference.poseIndex >= 0 && reference.poseIndex < poseGrid.length, true, `${label} poseIndex must remain inside the pose grid`);
  assert.equal(poseGrid[reference.poseIndex].state, actionName, `${label} must reference the ${actionName} slice`);
}

function validateFrames(actionName, track, duration, boneNames) {
  assert.equal(typeof track.bone, 'string', `${actionName} track must target a bone`);
  assert.equal(boneNames.has(track.bone), true, `${actionName} track targets an unknown bone`);
  assert.equal(TRACK_PROPERTIES.has(track.property), true, `${actionName} track property is unsupported`);
  assert.equal(Array.isArray(track.frames) && track.frames.length >= 2, true, `${actionName} track must contain at least two keyframes`);
  let previousTime = -1;
  for (const frame of track.frames) {
    assert.equal(isFiniteNumber(frame.time), true, `${actionName} keyframe time must be finite`);
    assert.equal(isFiniteNumber(frame.value), true, `${actionName} keyframe value must be finite`);
    assert.equal(frame.time > previousTime, true, `${actionName} keyframes must be strictly ordered`);
    assert.equal(frame.time >= 0 && frame.time <= duration, true, `${actionName} keyframe must stay inside its duration`);
    previousTime = frame.time;
  }
  assert.equal(track.frames[0].time, 0, `${actionName} tracks must start at time zero`);
}

function hasChangingTrack(animation, property) {
  return animation.tracks.some((track) => track.property === property
    && new Set(track.frames.map((frame) => frame.value)).size > 1);
}

function validateActionSemantics(animations) {
  assert.equal(animations.Idle.loop, true, 'Idle must loop');
  assert.equal(animations.Move.loop, true, 'Move must loop');
  assert.equal(animations.Move.tracks.some((track) => track.bone === 'root'
    && ['translateX', 'translateY'].includes(track.property)), false, 'Move must leave root translation to battle logic');
  assert.equal(hasChangingTrack(animations.Idle, 'scaleY') || hasChangingTrack(animations.Idle, 'rotate'), true, 'Idle must contain visible motion');
  assert.equal(hasChangingTrack(animations.Move, 'translateY') || hasChangingTrack(animations.Move, 'rotate'), true, 'Move must contain an in-place gait');
  assert.equal(hasChangingTrack(animations.Attack, 'rotate') || hasChangingTrack(animations.Attack, 'translateX'), true, 'Attack must animate a strike');
  assert.equal(hasChangingTrack(animations.Hit, 'translateX') || hasChangingTrack(animations.Hit, 'rotate'), true, 'Hit must animate a reaction');
  assert.equal(hasChangingTrack(animations.Death, 'rotate') || hasChangingTrack(animations.Death, 'opacity'), true, 'Death must animate removal');
  for (const action of ['Attack', 'Hit', 'Death']) {
    assert.equal(animations[action].loop, false, `${action} must not loop`);
  }
  const impact = animations.Attack.events.find((event) => event.name === 'impact');
  assert.equal(Boolean(impact), true, 'Attack must expose an impact event');
  assert.equal(impact.time > 0 && impact.time < animations.Attack.duration, true, 'Attack impact must occur inside its animation');
  assert.equal(Boolean(animations.Hit.events.find((event) => event.name === 'hit')), true, 'Hit must expose a hit event');
  const despawn = animations.Death.events.find((event) => event.name === 'despawn');
  assert.equal(Boolean(despawn), true, 'Death must expose a despawn event');
  assert.equal(despawn.time, animations.Death.duration, 'Death despawn must occur at the final keyframe');
  assert.equal(animations.Death.tracks.some((track) => track.property === 'opacity' && track.frames.at(-1).value === 0), true, 'Death must end transparent');
}

function validateMountContract(skeleton, boneNames) {
  assert.deepEqual({ width: skeleton.canvas.width, height: skeleton.canvas.height }, EXPECTED_CANVAS, 'canvas size must remain 512x512');
  assert.equal(Array.isArray(skeleton.mountPoints), true, 'mountPoints must be an array');
  const mounts = new Map(skeleton.mountPoints.map((mount) => [mount.name, mount]));
  assert.equal(mounts.size, skeleton.mountPoints.length, 'mount point names must be unique');
  assert.deepEqual([...mounts.keys()].sort(), [...MOUNT_CONTRACT.expectedNames].sort(), 'mount point keys must match the approved set');
  for (const mountName of REQUIRED_MOUNTS) {
    const mount = mounts.get(mountName);
    const semantics = MOUNT_CONTRACT.points[mountName];
    assert.equal(Boolean(mount), true, `${mountName} mount is required`);
    assert.equal(boneNames.has(mount.bone), true, `${mountName} mount must reference a valid bone`);
    assert.equal(semantics.bones.includes(mount.bone), true, `${mountName} mount must target one of ${semantics.bones.join(', ')}`);
    for (const axis of ['x', 'y']) {
      assert.equal(Number.isSafeInteger(mount[axis]), true, `${mountName} mount ${axis} must be an integer`);
      assert.equal(mount[axis] >= MOUNT_CONTRACT.canvasBounds[axis][0] && mount[axis] <= MOUNT_CONTRACT.canvasBounds[axis][1], true, `${mountName} mount ${axis} must stay inside canvas bounds`);
      assert.equal(mount[axis] >= semantics[axis][0] && mount[axis] <= semantics[axis][1], true, `${mountName} mount ${axis} must stay within semantic bounds`);
    }
  }
}

function validateGameplayProfile(skeleton, unit, card) {
  assert.equal(isRecord(skeleton.gameplayProfile), true, 'skeleton must expose gameplayProfile');
  assert.deepEqual(skeleton.gameplayProfile, {
    role: unit.role,
    race: unit.race,
    politicalFaction: unit.politicalFaction,
    abilityIds: unit.abilityIds,
    stats: {
      maxHp: unit.maxHp,
      attack: unit.attack,
      armor: unit.armor,
      move: unit.move,
      range: unit.range
    },
    combat: {
      attackChannel: unit.attackChannel,
      offenseType: unit.offenseType,
      defenseType: unit.defenseType,
      element: unit.element
    },
    card: {
      cardId: card.id,
      prepare: card.prepare,
      copyLimit: card.copyLimit,
      tags: card.tags
    }
  }, 'gameplayProfile must match real unit and card production config');
}

function validateSkeleton(skeleton, context) {
  assert.equal(loadJson(skeletonFile).unitId, 'U001', 'skeleton file must remain readable as real JSON');
  assert.equal(skeleton.schema, 'battle-unit-skeleton/v1', 'schema must remain battle-unit-skeleton/v1');
  assert.equal(skeleton.contractVersion, '2.2', 'contractVersion must remain v2.2');
  assert.equal(skeleton.productionTask, 'T278', 'productionTask must point to T278');
  assert.equal(skeleton.unitId, 'U001', 'unitId must match U001');
  assert.equal(skeleton.assetStage, 'production-contract', 'assetStage must stay honest about production contract status');
  assert.equal(skeleton.runtimeMode, 'pose-sheet-skeleton', 'runtimeMode must stay pose-sheet-skeleton');
  assert.equal(skeleton.framePolicy, 'one-approved-key-pose-per-state; no-fabricated-frames', 'framePolicy must reject fabricated frames');
  assert.equal(Number.isSafeInteger(skeleton.canvas?.width) && skeleton.canvas.width > 0, true, 'canvas width must be a positive integer');
  assert.equal(Number.isSafeInteger(skeleton.canvas?.height) && skeleton.canvas.height > 0, true, 'canvas height must be a positive integer');
  assert.equal(isFiniteNumber(skeleton.canvas?.pivot?.x) && isFiniteNumber(skeleton.canvas?.pivot?.y), true, 'canvas pivot must be finite');
  assert.equal(skeleton.canvas.pivot.x >= 0 && skeleton.canvas.pivot.x <= 1, true, 'canvas pivot x must stay normalized');
  assert.equal(skeleton.canvas.pivot.y >= 0 && skeleton.canvas.pivot.y <= 1, true, 'canvas pivot y must stay normalized');

  validateGameplayProfile(skeleton, context.unit, context.card);
  const { poseGrid, cutoutSize } = validateSources(skeleton);

  assert.equal(Array.isArray(skeleton.bones) && skeleton.bones.length >= 6, true, 'skeleton must expose a non-trivial bone hierarchy');
  const boneNames = new Set();
  for (const [index, bone] of skeleton.bones.entries()) {
    assert.match(bone.name ?? '', /^[a-z][a-zA-Z0-9]*$/, 'bone names must be stable identifiers');
    assert.equal(boneNames.has(bone.name), false, `duplicate bone name: ${bone.name}`);
    if (index === 0) {
      assert.equal(bone.name, 'root', 'bone hierarchy must begin at root');
      assert.equal('parent' in bone, false, 'root must not declare a parent');
    } else {
      assert.equal(boneNames.has(bone.parent), true, `bone ${bone.name} must reference an earlier parent`);
    }
    assert.equal(isFiniteNumber(bone.x) && isFiniteNumber(bone.y), true, `bone ${bone.name} coordinates must be finite`);
    boneNames.add(bone.name);
  }

  assert.equal(Array.isArray(skeleton.attachments) && skeleton.attachments.length >= 4, true, 'skeleton must expose four or more attachments');
  const attachmentNames = new Set();
  for (const attachment of skeleton.attachments) {
    assert.match(attachment.name ?? '', /^[a-z][a-zA-Z0-9]*$/, 'attachment names must be stable identifiers');
    assert.equal(attachmentNames.has(attachment.name), false, `duplicate attachment name: ${attachment.name}`);
    assert.equal(boneNames.has(attachment.bone), true, `attachment ${attachment.name} must target a valid bone`);
    assert.equal(attachment.source, 'cutoutSheet', `attachment ${attachment.name} must use cutoutSheet`);
    validateRect(`attachment ${attachment.name}`, attachment.sourceRect, cutoutSize);
    assert.equal(attachment.width, attachment.sourceRect.width, `attachment ${attachment.name} width must match sourceRect.width`);
    assert.equal(attachment.height, attachment.sourceRect.height, `attachment ${attachment.name} height must match sourceRect.height`);
    attachmentNames.add(attachment.name);
  }

  validateMountContract(skeleton, boneNames);

  assert.deepEqual(skeleton.orientations, {
    player: { direction: -1, scaleX: -1 },
    enemy: { direction: 1, scaleX: 1 }
  }, 'player/enemy mirror mapping must remain frozen');

  assert.equal(isRecord(skeleton.stateMap), true, 'stateMap must be an object');
  assert.equal(isRecord(skeleton.animations), true, 'animations must be an object');
  assertExactKeys(skeleton.stateMap, REQUIRED_ACTIONS, 'stateMap');
  assertExactKeys(skeleton.animations, REQUIRED_ACTIONS, 'animations');
  for (const actionName of REQUIRED_ACTIONS) {
    const expectedPoseIndex = EXPECTED_POSE_STATES.get(actionName);
    const state = skeleton.stateMap[actionName];
    const animation = skeleton.animations[actionName];
    assert.deepEqual(state, { source: 'poseSheet', poseIndex: expectedPoseIndex }, `${actionName} must map to its approved pose column`);
    validatePoseReference(`${actionName} stateMap`, state, actionName, poseGrid);
    assert.equal(isRecord(animation), true, `${actionName} must define an animation`);
    assert.equal(isFiniteNumber(animation.duration) && animation.duration > 0 && animation.duration <= 3, true, `${actionName} duration must stay within 0–3 seconds`);
    assert.equal(typeof animation.loop === 'boolean', true, `${actionName} must declare loop behavior`);
    assert.deepEqual(animation.sourcePose, state, `${actionName} sourcePose must agree with stateMap`);
    validatePoseReference(`${actionName} sourcePose`, animation.sourcePose, actionName, poseGrid);
    assert.equal(Array.isArray(animation.sourceFrames) && animation.sourceFrames.length === 1, true, `${actionName} must reference exactly one real source frame`);
    assert.deepEqual(animation.sourceFrames[0], { time: 0, source: 'poseSheet', poseIndex: expectedPoseIndex }, `${actionName} sourceFrames must remain frozen`);
    validatePoseReference(`${actionName} sourceFrame`, animation.sourceFrames[0], actionName, poseGrid);
    assert.equal(Array.isArray(animation.tracks) && animation.tracks.length > 0, true, `${actionName} must contain transform tracks`);
    assert.equal(Array.isArray(animation.events), true, `${actionName} must contain an event list`);
    for (const track of animation.tracks) validateFrames(actionName, track, animation.duration, boneNames);
    for (const event of animation.events) {
      assert.match(event.name ?? '', /^[a-z][a-zA-Z0-9]*$/, `${actionName} event names must be stable identifiers`);
      assert.equal(isFiniteNumber(event.time) && event.time >= 0 && event.time <= animation.duration, true, `${actionName} event must stay inside the animation`);
    }
  }
  validateActionSemantics(skeleton.animations);
}

const context = readProductionContext();
const skeleton = loadJson(skeletonFile);
validateSkeleton(skeleton, context);

const missingAnimation = structuredClone(skeleton);
delete missingAnimation.animations.Attack;
assert.throws(() => validateSkeleton(missingAnimation, context), /animations keys must match|must define an animation/);

const missingConfigAbility = structuredClone(context);
missingConfigAbility.unit = { ...context.unit, abilityIds: ['A999'] };
assert.throws(() => validateSkeleton(skeleton, missingConfigAbility), /gameplayProfile must match/);

const wrongSourceHash = structuredClone(skeleton);
wrongSourceHash.sources.poseSheet.sha256 = '0'.repeat(64);
assert.throws(() => validateSkeleton(wrongSourceHash, context), /manifest hash must stay frozen/);

const wrongPoseAtlasHash = structuredClone(skeleton);
wrongPoseAtlasHash.sources.poseAtlas.sha256 = 'f'.repeat(64);
assert.throws(() => validateSkeleton(wrongPoseAtlasHash, context), /poseAtlas manifest hash must stay frozen/);

const wrongSourcePath = structuredClone(skeleton);
wrongSourcePath.sources.cutoutSheet.path = 'assets/resources/art/battle/units/U001/DOES-NOT-EXIST.png';
assert.throws(() => validateSkeleton(wrongSourcePath, context), /path is missing/);

const missingCutoutAtlas = structuredClone(skeleton);
delete missingCutoutAtlas.sources.cutoutAtlas;
assert.throws(() => validateSkeleton(missingCutoutAtlas, context), /sources keys must match the approved set/);

const wrongPoseRect = structuredClone(skeleton);
wrongPoseRect.sources.poseSheet.poseGrid[2].rect.width = 401;
assert.throws(() => validateSkeleton(wrongPoseRect, context), /poseSheet must cover the full width|must remain contiguous/);

const wrongMirror = structuredClone(skeleton);
wrongMirror.orientations.enemy.scaleX = -1;
assert.throws(() => validateSkeleton(wrongMirror, context), /mirror mapping/);

const wrongMountBone = structuredClone(skeleton);
wrongMountBone.mountPoints.find((mount) => mount.name === 'attackOrigin').bone = 'root';
assert.throws(() => validateSkeleton(wrongMountBone, context), /attackOrigin mount must target one of spear/);

const invalidMountBounds = structuredClone(skeleton);
invalidMountBounds.mountPoints.find((mount) => mount.name === 'healthBar').y = 999999;
assert.throws(() => validateSkeleton(invalidMountBounds, context), /healthBar mount y must stay inside canvas bounds/);

const invalidMountSemantic = structuredClone(skeleton);
invalidMountSemantic.mountPoints.find((mount) => mount.name === 'effect').x = 120;
assert.throws(() => validateSkeleton(invalidMountSemantic, context), /effect mount x must stay within semantic bounds/);

const invalidMountInteger = structuredClone(skeleton);
invalidMountInteger.mountPoints.find((mount) => mount.name === 'shadow').x = 0.5;
assert.throws(() => validateSkeleton(invalidMountInteger, context), /shadow mount x must be an integer/);

const wrongStateMapping = structuredClone(skeleton);
wrongStateMapping.stateMap.Death.poseIndex = 3;
assert.throws(() => validateSkeleton(wrongStateMapping, context), /Death must map to its approved pose column/);

const wrongSourceFrame = structuredClone(skeleton);
wrongSourceFrame.animations.Move.sourceFrames[0].poseIndex = 4;
assert.throws(() => validateSkeleton(wrongSourceFrame, context), /Move sourceFrames must remain frozen/);

const rootMotion = structuredClone(skeleton);
rootMotion.animations.Move.tracks.push({
  bone: 'root',
  property: 'translateX',
  frames: [{ time: 0, value: 0 }, { time: 0.38, value: 20 }, { time: 0.76, value: 0 }]
});
assert.throws(() => validateSkeleton(rootMotion, context), /Move must leave root translation to battle logic/);

const invalidDeathEvent = structuredClone(skeleton);
invalidDeathEvent.animations.Death.events.find((event) => event.name === 'despawn').time = 0.8;
assert.throws(() => validateSkeleton(invalidDeathEvent, context), /Death despawn must occur at the final keyframe/);

const wrongAssetStage = structuredClone(skeleton);
wrongAssetStage.assetStage = 'preview';
assert.throws(() => validateSkeleton(wrongAssetStage, context), /assetStage must stay honest/);

const wrongFactionSnapshot = structuredClone(skeleton);
wrongFactionSnapshot.gameplayProfile.politicalFaction = '山海诸庭';
assert.throws(() => validateSkeleton(wrongFactionSnapshot, context), /gameplayProfile must match/);

console.log('T278 U001 production contract PASS: config, faction, role, pose/cutout/atlas hashes, actions, mounts, mirror mapping; 18 counterexamples rejected');
