import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const clientRoot = resolve(process.cwd());
const unitRoot = resolve(clientRoot, 'assets/resources/art/battle/units/U003');
const skeletonPath = resolve(unitRoot, 'skeleton.json');
const cardsPath = resolve(clientRoot, 'assets/resources/config/cards.json');
const unitsPath = resolve(clientRoot, 'assets/resources/config/units.json');

const REQUIRED_ACTIONS = ['Idle', 'Move', 'Attack', 'Hit', 'Death'];
const REQUIRED_MOUNTS = ['attackOrigin', 'effect', 'healthBar', 'shadow', 'cardAnchor'];
const TRACK_PROPERTIES = new Set(['translateX', 'translateY', 'rotate', 'scaleX', 'scaleY', 'opacity']);
const EXPECTED_BINDING = Object.freeze({
  unitName: '晨誓医师',
  cardId: 'U003',
  unitId: 'U003',
  prepare: 4,
  rarity: 3,
  copyLimit: 3,
  tags: Object.freeze(['unit', 'healer']),
  race: '人族',
  politicalFaction: '朔垣军府',
  role: 'HEALER',
  attackChannel: 'SPELL',
  offenseType: 'SPELL',
  defenseType: 'LIGHT',
  element: 'WOOD',
  range: 2,
  maxHp: 5,
  attack: 1,
  armor: 0,
  move: 1,
  abilityIds: Object.freeze(['A003']),
  visualArchetype: 'HUMANOID_SUPPORT',
});
const EXPECTED_VISUAL = Object.freeze({
  silhouetteTags: Object.freeze(['medicineStaff', 'longCoat', 'satchel']),
  battleProjectionHeightPx: Object.freeze([120, 180]),
  mustReadAs: Object.freeze(['rearline-healer', 'human-support', 'shuoyuan-field-medic']),
  guardrails: Object.freeze([
    'treatment silhouette must remain distinct from attack casting',
    'attack pose must read as ranged spell release, not melee staff swing',
    'side-view silhouette must preserve medicine staff and long-coat profile',
  ]),
});
const EXPECTED_FILES = Object.freeze(['U003-ANIMATION-POSES.png', 'U003-CUTOUT-SHEET.png', 'skeleton.json']);
const EXPECTED_POSE_GRID = Object.freeze([
  Object.freeze({ state: 'Idle', rect: Object.freeze({ x: 0, y: 0, width: 396, height: 792 }) }),
  Object.freeze({ state: 'Move', rect: Object.freeze({ x: 396, y: 0, width: 396, height: 792 }) }),
  Object.freeze({ state: 'Attack', rect: Object.freeze({ x: 792, y: 0, width: 396, height: 792 }) }),
  Object.freeze({ state: 'Hit', rect: Object.freeze({ x: 1188, y: 0, width: 396, height: 792 }) }),
  Object.freeze({ state: 'Death', rect: Object.freeze({ x: 1584, y: 0, width: 396, height: 792 }) }),
]);
const EXPECTED_ATTACHMENTS = Object.freeze({
  frontPose: Object.freeze({ x: 0, y: 0, width: 384, height: 512 }),
  sidePose: Object.freeze({ x: 384, y: 0, width: 384, height: 512 }),
  rearPose: Object.freeze({ x: 768, y: 0, width: 384, height: 512 }),
  rigPose: Object.freeze({ x: 384, y: 512, width: 384, height: 512 }),
});
const MOUNT_CONTRACT = Object.freeze({
  attackOrigin: Object.freeze({ bones: Object.freeze(['focus']), x: Object.freeze([72, 140]), y: Object.freeze([-24, 32]) }),
  effect: Object.freeze({ bones: Object.freeze(['torso']), x: Object.freeze([-24, 48]), y: Object.freeze([48, 128]) }),
  healthBar: Object.freeze({ bones: Object.freeze(['root']), x: Object.freeze([-24, 24]), y: Object.freeze([160, 256]) }),
  shadow: Object.freeze({ bones: Object.freeze(['root']), x: Object.freeze([-32, 32]), y: Object.freeze([-24, 24]) }),
  cardAnchor: Object.freeze({ bones: Object.freeze(['root']), x: Object.freeze([-24, 24]), y: Object.freeze([72, 144]) }),
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : readFileSync(value);
  return createHash('sha256').update(bytes).digest('hex');
}

function assertExactKeys(record, expectedKeys, label) {
  assert.deepEqual(Object.keys(record).sort(), [...expectedKeys].sort(), `${label} keys must match the approved set`);
}

function assertRelativeUnitPath(relativePath, label) {
  assert.equal(typeof relativePath, 'string', `${label} must be a string`);
  assert.equal(relativePath.startsWith('assets/resources/art/battle/units/U003/'), true, `${label} must stay inside the U003 asset directory`);
  assert.equal(relativePath.includes('..'), false, `${label} must not contain traversal`);
  assert.equal(/[\\\0]/.test(relativePath), false, `${label} must not contain invalid separators`);
  assert.equal(/placeholder|dummy|stub|card/i.test(relativePath), false, `${label} cannot point to placeholder/card content`);
  const resolved = resolve(clientRoot, relativePath);
  assert.equal(resolved.startsWith(`${unitRoot}/`), true, `${label} escapes the U003 asset root`);
  assert.equal(existsSync(resolved), true, `${label} is missing: ${relativePath}`);
  return resolved;
}

function parsePng(file) {
  const buffer = readFileSync(file);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${basename(file)} must be a PNG`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compression = 0;
  let filter = 0;
  let interlace = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.equal(dataEnd + 4 <= buffer.length, true, `${basename(file)} has a truncated ${type} chunk`);
    const data = buffer.subarray(dataStart, dataEnd);
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
  assert.equal(bitDepth, 8, `${basename(file)} must use 8-bit channels`);
  assert.equal(colorType, 6, `${basename(file)} must use RGBA pixels`);
  assert.equal(compression, 0, `${basename(file)} compression must be PNG default`);
  assert.equal(filter, 0, `${basename(file)} filter method must be PNG default`);
  assert.equal(interlace, 0, `${basename(file)} must be non-interlaced`);
  const stride = width * 4;
  const filtered = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filterType = filtered[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset + x];
      const left = x >= 4 ? row[x - 4] : 0;
      const above = previous[x];
      const upperLeft = x >= 4 ? previous[x - 4] : 0;
      if (filterType === 0) row[x] = raw;
      else if (filterType === 1) row[x] = (raw + left) & 255;
      else if (filterType === 2) row[x] = (raw + above) & 255;
      else if (filterType === 3) row[x] = (raw + Math.floor((left + above) / 2)) & 255;
      else if (filterType === 4) {
        const predictor = left + above - upperLeft;
        const pa = Math.abs(predictor - left);
        const pb = Math.abs(predictor - above);
        const pc = Math.abs(predictor - upperLeft);
        const prior = pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
        row[x] = (raw + prior) & 255;
      } else {
        assert.fail(`${basename(file)} uses unsupported PNG filter ${filterType}`);
      }
    }
    row.copy(rgba, y * stride);
    previous = row;
    sourceOffset += stride;
  }
  return { width, height, rgba };
}

function cropMetrics(image, rect, label) {
  for (const axis of ['x', 'y', 'width', 'height']) {
    assert.equal(Number.isInteger(rect[axis]), true, `${label}.${axis} must be an integer`);
  }
  assert.equal(rect.x >= 0 && rect.y >= 0, true, `${label} must start inside the source`);
  assert.equal(rect.width > 0 && rect.height > 0, true, `${label} dimensions must be positive`);
  assert.equal(rect.x + rect.width <= image.width, true, `${label} exceeds source width`);
  assert.equal(rect.y + rect.height <= image.height, true, `${label} exceeds source height`);
  const slice = Buffer.alloc(rect.width * rect.height * 4);
  const rowBytes = rect.width * 4;
  let alphaPixels = 0;
  let minX = rect.width;
  let minY = rect.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = ((rect.y + y) * image.width + rect.x) * 4;
    const targetStart = y * rowBytes;
    image.rgba.copy(slice, targetStart, sourceStart, sourceStart + rowBytes);
    for (let x = 0; x < rect.width; x += 1) {
      const alpha = slice[targetStart + x * 4 + 3];
      if (alpha > 0) {
        alphaPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  assert.equal(alphaPixels > 0, true, `${label} must contain visible artwork`);
  return {
    alphaPixels,
    alphaCoverage: alphaPixels / (rect.width * rect.height),
    visibleBounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    rgbaSha256: sha256(slice),
  };
}

function hasChangingTrack(animation, property) {
  return animation.tracks.some((track) => track.property === property
    && new Set(track.frames.map((frame) => frame.value)).size > 1);
}

function loadTable(file, key) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(Array.isArray(parsed[key]), true, `${basename(file)} must expose ${key}`);
  return parsed[key];
}

function validateConfigBinding(binding, card, unit) {
  assert.deepEqual(binding, EXPECTED_BINDING, 'U003 configBinding must freeze the approved unit truth');
  assert.equal(card.id, EXPECTED_BINDING.cardId, 'cards.json U003 id changed');
  assert.equal(card.cardType, 'UNIT', 'U003 cardType must remain UNIT');
  assert.equal(card.unitId, EXPECTED_BINDING.unitId, 'cards.json U003 unit binding changed');
  assert.equal(card.prepare, EXPECTED_BINDING.prepare, 'cards.json U003 prepare changed');
  assert.equal(card.rarity, EXPECTED_BINDING.rarity, 'cards.json U003 rarity changed');
  assert.equal(card.copyLimit, EXPECTED_BINDING.copyLimit, 'cards.json U003 copyLimit changed');
  assert.deepEqual(card.tags, [...EXPECTED_BINDING.tags], 'cards.json U003 tags changed');
  assert.equal(card.race, EXPECTED_BINDING.race, 'cards.json U003 race changed');
  assert.equal(card.politicalFaction, EXPECTED_BINDING.politicalFaction, 'cards.json U003 political faction changed');

  for (const key of ['id', 'race', 'politicalFaction', 'role', 'attackChannel', 'offenseType', 'defenseType', 'element', 'range', 'maxHp', 'attack', 'armor', 'move', 'visualArchetype']) {
    const sourceKey = key === 'id' ? 'unitId' : key;
    assert.equal(unit[key], EXPECTED_BINDING[sourceKey], `units.json U003 ${key} changed`);
  }
  assert.deepEqual(unit.abilityIds, [...EXPECTED_BINDING.abilityIds], 'units.json U003 abilityIds changed');
}

function validateVisualContract(contract) {
  assert.deepEqual(contract, EXPECTED_VISUAL, 'U003 visualContract must freeze the approved silhouette and guardrails');
}

function validateSources(skeleton) {
  assert.equal(isRecord(skeleton.sources), true, 'U003 must declare sources');
  const poseSheet = skeleton.sources.poseSheet;
  const cutoutSheet = skeleton.sources.cutoutSheet;

  assert.equal(poseSheet.id, 'U003-ANIMATION-POSES', 'pose sheet id must match U003');
  assert.equal(cutoutSheet.id, 'U003-CUTOUT-SHEET', 'cutout sheet id must match U003');
  assert.equal(poseSheet.kind, 'approved-runtime-pose-sheet', 'U003 pose sheet kind changed');
  assert.equal(cutoutSheet.kind, 'approved-runtime-cutout-sheet', 'U003 cutout sheet kind changed');
  assert.equal(poseSheet.status, 'production-approved', 'U003 pose sheet status changed');
  assert.equal(cutoutSheet.status, 'production-approved', 'U003 cutout sheet status changed');

  const poseFile = assertRelativeUnitPath(poseSheet.path, 'poseSheet.path');
  const poseReference = assertRelativeUnitPath(poseSheet.referencePath, 'poseSheet.referencePath');
  const cutoutFile = assertRelativeUnitPath(cutoutSheet.path, 'cutoutSheet.path');
  const cutoutReference = assertRelativeUnitPath(cutoutSheet.referencePath, 'cutoutSheet.referencePath');
  assert.equal(basename(poseFile), 'U003-ANIMATION-POSES.png', 'poseSheet.path file name changed');
  assert.equal(basename(cutoutFile), 'U003-CUTOUT-SHEET.png', 'cutoutSheet.path file name changed');
  assert.equal(sha256(poseFile), poseSheet.sha256, 'poseSheet.sha256 does not match the real file');
  assert.equal(sha256(poseReference), poseSheet.sha256, 'poseSheet.referencePath does not match the real file');
  assert.equal(sha256(cutoutFile), cutoutSheet.sha256, 'cutoutSheet.sha256 does not match the real file');
  assert.equal(sha256(cutoutReference), cutoutSheet.sha256, 'cutoutSheet.referencePath does not match the real file');

  const poseImage = parsePng(poseFile);
  const cutoutImage = parsePng(cutoutFile);
  assert.deepEqual(poseSheet.size, { width: poseImage.width, height: poseImage.height }, 'poseSheet.size changed');
  assert.deepEqual(cutoutSheet.size, { width: cutoutImage.width, height: cutoutImage.height }, 'cutoutSheet.size changed');
  assert.equal(Array.isArray(poseSheet.poseGrid), true, 'poseSheet.poseGrid must exist');
  assert.equal(poseSheet.poseGrid.length, EXPECTED_POSE_GRID.length, 'U003 pose grid must expose exactly five actions');
  let endX = 0;
  const poseHashes = new Set();
  for (const [index, entry] of poseSheet.poseGrid.entries()) {
    assert.equal(entry.index, index, `poseGrid[${index}] index must stay contiguous`);
    assert.deepEqual(entry.state, EXPECTED_POSE_GRID[index].state, `poseGrid[${index}] state changed`);
    assert.deepEqual(entry.rect, EXPECTED_POSE_GRID[index].rect, `poseGrid[${index}] rect changed`);
    assert.equal(entry.rect.x, endX, `poseGrid[${index}] must remain contiguous`);
    endX = entry.rect.x + entry.rect.width;
    const metrics = cropMetrics(poseImage, entry.rect, `poseGrid[${index}]`);
    assert.equal(metrics.alphaCoverage >= 0.08, true, `poseGrid[${index}] cannot be visually empty`);
    assert.equal(metrics.visibleBounds.height >= 320, true, `poseGrid[${index}] silhouette height is too small for readability`);
    poseHashes.add(metrics.rgbaSha256);
  }
  assert.equal(endX, poseImage.width, 'poseGrid must cover the full pose sheet width');
  assert.equal(poseHashes.size, REQUIRED_ACTIONS.length, 'all five U003 pose slices must be visually distinct');

  return { poseImage, cutoutImage };
}

function validateBones(skeleton) {
  assert.equal(Array.isArray(skeleton.bones) && skeleton.bones.length >= 8, true, 'U003 must provide a full support-unit bone hierarchy');
  const names = new Set();
  for (const [index, bone] of skeleton.bones.entries()) {
    assert.match(bone.name ?? '', /^[a-z][a-zA-Z0-9]*$/, 'bone names must be stable identifiers');
    assert.equal(names.has(bone.name), false, `duplicate bone name: ${bone.name}`);
    if (index === 0) {
      assert.equal(bone.name, 'root', 'the first U003 bone must be root');
      assert.equal('parent' in bone, false, 'root must not declare a parent');
    } else {
      assert.equal(names.has(bone.parent), true, `${bone.name} must reference an earlier parent`);
    }
    assert.equal(isFiniteNumber(bone.x) && isFiniteNumber(bone.y), true, `${bone.name} must have finite coordinates`);
    names.add(bone.name);
  }
  return names;
}

function validateAttachments(skeleton, cutoutImage, boneNames) {
  assert.equal(Array.isArray(skeleton.attachments) && skeleton.attachments.length === 4, true, 'U003 must provide four cutout attachments');
  const attachmentHashes = new Set();
  const attachmentNames = new Set();
  for (const attachment of skeleton.attachments) {
    assert.equal(attachmentNames.has(attachment.name), false, `duplicate attachment name: ${attachment.name}`);
    attachmentNames.add(attachment.name);
    assert.equal(boneNames.has(attachment.bone), true, `${attachment.name} targets an unknown bone`);
    assert.equal(attachment.source, 'cutoutSheet', `${attachment.name} must use the cutout sheet`);
    assert.deepEqual(attachment.sourceRect, EXPECTED_ATTACHMENTS[attachment.name], `${attachment.name} sourceRect changed`);
    assert.equal(attachment.width, attachment.sourceRect.width, `${attachment.name} width must match its source rect`);
    assert.equal(attachment.height, attachment.sourceRect.height, `${attachment.name} height must match its source rect`);
    const metrics = cropMetrics(cutoutImage, attachment.sourceRect, `attachment ${attachment.name}`);
    assert.equal(metrics.alphaCoverage >= 0.06, true, `${attachment.name} cannot be visually empty`);
    assert.equal(metrics.visibleBounds.height >= 220, true, `${attachment.name} must keep a readable full-body silhouette`);
    attachmentHashes.add(metrics.rgbaSha256);
  }
  assert.equal(attachmentHashes.size, 4, 'front/side/rear/rig cutouts must all remain distinct');
}

function validateMounts(skeleton, boneNames) {
  assert.deepEqual({ width: skeleton.canvas.width, height: skeleton.canvas.height }, { width: 512, height: 512 }, 'U003 canvas must stay 512x512');
  const mounts = new Map(skeleton.mountPoints.map((mount) => [mount.name, mount]));
  assert.equal(mounts.size, skeleton.mountPoints.length, 'U003 mount point names must be unique');
  assert.deepEqual([...mounts.keys()].sort(), [...REQUIRED_MOUNTS].sort(), 'U003 mount points changed');
  for (const mountName of REQUIRED_MOUNTS) {
    const mount = mounts.get(mountName);
    const contract = MOUNT_CONTRACT[mountName];
    assert.equal(boneNames.has(mount.bone), true, `${mountName} targets an unknown bone`);
    assert.equal(contract.bones.includes(mount.bone), true, `${mountName} must target one of ${contract.bones.join(', ')}`);
    for (const axis of ['x', 'y']) {
      assert.equal(Number.isInteger(mount[axis]), true, `${mountName}.${axis} must be an integer`);
      assert.equal(mount[axis] >= contract[axis][0] && mount[axis] <= contract[axis][1], true, `${mountName}.${axis} left the approved semantic range`);
      assert.equal(mount[axis] >= -256 && mount[axis] <= 256, true, `${mountName}.${axis} must stay inside the 512x512 canvas`);
    }
  }
}

function validateAnimations(skeleton, poseImage) {
  assert.equal(skeleton.assetStage, 'formal-runtime-unit', 'U003 assetStage must stay formal-runtime-unit');
  assert.equal(skeleton.runtimeMode, 'pose-sheet-unit-skeleton', 'U003 runtimeMode must stay pose-sheet-unit-skeleton');
  assert.equal(skeleton.framePolicy, 'five-approved-pose-columns; transform-assisted-motion; no-fabricated-frames', 'U003 framePolicy changed');
  assert.deepEqual(skeleton.orientations, {
    player: { direction: -1, scaleX: -1 },
    enemy: { direction: 1, scaleX: 1 },
  }, 'U003 orientations must stay mirrored across player/enemy');
  assertExactKeys(skeleton.stateMap, REQUIRED_ACTIONS, 'U003 stateMap');
  assertExactKeys(skeleton.animations, REQUIRED_ACTIONS, 'U003 animations');
  const poseHashes = new Map();
  for (const entry of EXPECTED_POSE_GRID) {
    poseHashes.set(entry.state, cropMetrics(poseImage, entry.rect, `pose ${entry.state}`).rgbaSha256);
  }
  for (const [index, action] of REQUIRED_ACTIONS.entries()) {
    assert.deepEqual(skeleton.stateMap[action], { source: 'poseSheet', poseIndex: index }, `${action} stateMap changed`);
    const animation = skeleton.animations[action];
    assert.equal(isRecord(animation), true, `${action} must be an object`);
    assert.equal(isFiniteNumber(animation.duration) && animation.duration > 0 && animation.duration <= 2, true, `${action} duration is outside the approved range`);
    assert.equal(typeof animation.loop, 'boolean', `${action} must declare loop behavior`);
    assert.deepEqual(animation.sourcePose, skeleton.stateMap[action], `${action} sourcePose must match stateMap`);
    assert.deepEqual(animation.sourceFrames, [{ time: 0, source: 'poseSheet', poseIndex: index }], `${action} sourceFrames must contain exactly the approved pose`);
    assert.equal(Array.isArray(animation.tracks) && animation.tracks.length > 0, true, `${action} must contain transform tracks`);
    assert.equal(Array.isArray(animation.events), true, `${action} must expose events`);
    for (const track of animation.tracks) {
      assert.equal(TRACK_PROPERTIES.has(track.property), true, `${action} uses an unsupported track property`);
      assert.equal(Array.isArray(track.frames) && track.frames.length >= 2, true, `${action} track must contain at least two keyframes`);
      let previous = -1;
      for (const frame of track.frames) {
        assert.equal(isFiniteNumber(frame.time) && isFiniteNumber(frame.value), true, `${action} keyframes must be finite`);
        assert.equal(frame.time > previous, true, `${action} keyframes must be strictly ordered`);
        assert.equal(frame.time >= 0 && frame.time <= animation.duration, true, `${action} keyframes must remain inside the animation duration`);
        previous = frame.time;
      }
      assert.equal(track.frames[0].time, 0, `${action} tracks must start at 0`);
      assert.equal(track.frames.at(-1).time, animation.duration, `${action} tracks must end at duration`);
    }
    assert.equal(poseHashes.has(action), true, `${action} must map to a real pose crop`);
  }
  assert.equal(skeleton.animations.Idle.loop, true, 'Idle must loop');
  assert.equal(skeleton.animations.Move.loop, true, 'Move must loop');
  for (const action of ['Attack', 'Hit', 'Death']) assert.equal(skeleton.animations[action].loop, false, `${action} must not loop`);
  assert.equal(skeleton.animations.Move.tracks.some((track) => track.bone === 'root' && ['translateX', 'translateY'].includes(track.property)), false, 'Move must leave root translation to battle logic');
  assert.equal(hasChangingTrack(skeleton.animations.Idle, 'scaleY') || hasChangingTrack(skeleton.animations.Idle, 'rotate'), true, 'Idle must contain visible support-unit breathing motion');
  assert.equal(hasChangingTrack(skeleton.animations.Move, 'translateY') || hasChangingTrack(skeleton.animations.Move, 'rotate'), true, 'Move must contain a readable step cycle');
  assert.equal(hasChangingTrack(skeleton.animations.Attack, 'rotate') || hasChangingTrack(skeleton.animations.Attack, 'translateX'), true, 'Attack must contain a readable cast release');
  assert.equal(hasChangingTrack(skeleton.animations.Hit, 'translateX') || hasChangingTrack(skeleton.animations.Hit, 'rotate'), true, 'Hit must contain a readable recoil');
  assert.equal(hasChangingTrack(skeleton.animations.Death, 'rotate') || hasChangingTrack(skeleton.animations.Death, 'opacity'), true, 'Death must contain a readable collapse');
  const attackEvents = skeleton.animations.Attack.events.map((event) => event.name);
  assert.deepEqual(attackEvents, ['windup', 'impact'], 'Attack must expose windup and impact events');
  assert.equal(skeleton.animations.Attack.events[1].time > skeleton.animations.Attack.events[0].time, true, 'Attack impact must occur after windup');
  assert.equal(Boolean(skeleton.animations.Hit.events.find((event) => event.name === 'hit')), true, 'Hit must expose a hit event');
  const despawn = skeleton.animations.Death.events.find((event) => event.name === 'despawn');
  assert.equal(Boolean(despawn), true, 'Death must expose a despawn event');
  assert.equal(despawn.time, skeleton.animations.Death.duration, 'Death despawn must occur at the final keyframe');
}

function validateSkeleton(skeleton) {
  assert.equal(skeleton.schema, 'battle-unit-skeleton/v1', 'U003 schema changed');
  assert.equal(skeleton.contractVersion, '2.2', 'U003 contractVersion changed');
  assert.equal(skeleton.productionTask, 'T280', 'U003 productionTask changed');
  assert.equal(skeleton.unitId, 'U003', 'U003 unitId changed');
  assert.deepEqual(skeleton.canvas.pivot, { x: 0.5, y: 0.11 }, 'U003 canvas pivot changed');

  const cards = loadTable(cardsPath, 'cards');
  const units = loadTable(unitsPath, 'units');
  const card = cards.find((entry) => entry.id === 'U003');
  const unit = units.find((entry) => entry.id === 'U003');
  assert.equal(Boolean(card), true, 'cards.json must contain U003');
  assert.equal(Boolean(unit), true, 'units.json must contain U003');
  validateConfigBinding(skeleton.configBinding, card, unit);
  validateVisualContract(skeleton.visualContract);
  const { poseImage, cutoutImage } = validateSources(skeleton);
  const boneNames = validateBones(skeleton);
  validateAttachments(skeleton, cutoutImage, boneNames);
  validateMounts(skeleton, boneNames);
  validateAnimations(skeleton, poseImage);
}

function runCounterexamples(base) {
  const missingAttack = structuredClone(base);
  delete missingAttack.animations.Attack;
  assert.throws(() => validateSkeleton(missingAttack), /animations keys must match/);

  const wrongFaction = structuredClone(base);
  wrongFaction.configBinding.politicalFaction = '山海诸庭';
  assert.throws(() => validateSkeleton(wrongFaction), /configBinding must freeze the approved unit truth/);

  const wrongMountBone = structuredClone(base);
  wrongMountBone.mountPoints.find((mount) => mount.name === 'attackOrigin').bone = 'root';
  assert.throws(() => validateSkeleton(wrongMountBone), /attackOrigin must target one of focus/);

  const wrongPoseSlice = structuredClone(base);
  wrongPoseSlice.sources.poseSheet.poseGrid[2].rect.x = 793;
  assert.throws(() => validateSkeleton(wrongPoseSlice), /rect changed|must remain contiguous/);

  const wrongStateMap = structuredClone(base);
  wrongStateMap.stateMap.Attack.poseIndex = 1;
  assert.throws(() => validateSkeleton(wrongStateMap), /Attack stateMap changed/);

  const missingSource = structuredClone(base);
  missingSource.sources.poseSheet.path = 'assets/resources/art/battle/units/U003/POSE-MISSING.png';
  assert.throws(() => validateSkeleton(missingSource), /poseSheet.path is missing/);

  const invalidMoveRoot = structuredClone(base);
  invalidMoveRoot.animations.Move.tracks.push({
    bone: 'root',
    property: 'translateX',
    frames: [{ time: 0, value: 0 }, { time: 0.41, value: 18 }, { time: invalidMoveRoot.animations.Move.duration, value: 0 }],
  });
  assert.throws(() => validateSkeleton(invalidMoveRoot), /Move must leave root translation to battle logic/);
}

assert.equal(existsSync(skeletonPath), true, 'U003 must provide skeleton.json');
assert.deepEqual(readdirSync(unitRoot).sort(), [...EXPECTED_FILES].sort(), 'U003 asset directory must contain the formal pose sheet, cutout sheet, and skeleton only');
const skeleton = JSON.parse(readFileSync(skeletonPath, 'utf8'));
validateSkeleton(skeleton);
runCounterexamples(skeleton);

console.log('U003 production contract PASS: config binding, formal pose/cutout PNGs, mount semantics, animation contract, and 7 counterexamples verified');
