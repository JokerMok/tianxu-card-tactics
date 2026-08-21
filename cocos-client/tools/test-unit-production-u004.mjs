import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(process.cwd());
const repoRoot = resolve(projectRoot, '..');
const requiredStates = ['Idle', 'Move', 'Attack', 'Hit', 'Death'];
const requiredMounts = ['attackOrigin', 'effect', 'healthBar', 'shadow', 'cardAnchor'];
const allowedTrackProperties = new Set(['translateX', 'translateY', 'rotate', 'scaleX', 'scaleY', 'opacity']);

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readText(file) {
  return readFileSync(file, 'utf8');
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function pngSize(file) {
  const bytes = readFileSync(file);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${file} must be a PNG`);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${file} must expose an IHDR chunk`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    byteLength: bytes.length
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

  assert.deepEqual(skeleton.orientations, {
    player: { direction: -1, scaleX: -1 },
    enemy: { direction: 1, scaleX: 1 }
  }, 'U004 must support mirrored player/enemy facings');

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

  const sourceSize = pngSize(sourceArtPath);
  assert.deepEqual({ width: sourceSize.width, height: sourceSize.height }, skeleton.sourceArt.size, 'U004 source art dimensions changed unexpectedly');
  assert.equal(sha256(sourceArtPath), skeleton.sourceArt.sha256, 'U004 source art hash changed unexpectedly');
  assert.equal(sourceSize.byteLength > 500000, true, 'U004 source art looks too small to be the approved card art');

  const poseSize = pngSize(poseSheetPath);
  assert.deepEqual({ width: poseSize.width, height: poseSize.height }, skeleton.atlases.poseSheet.size, 'U004 pose-sheet dimensions changed unexpectedly');
  assert.equal(sha256(poseSheetPath), skeleton.atlases.poseSheet.sha256, 'U004 pose-sheet hash changed unexpectedly');
  assert.equal(poseSize.byteLength > 500000, true, 'U004 pose-sheet must be a real derived atlas, not a placeholder');

  const cutoutSize = pngSize(cutoutSheetPath);
  assert.deepEqual({ width: cutoutSize.width, height: cutoutSize.height }, skeleton.atlases.cutoutSheet.size, 'U004 cutout-sheet dimensions changed unexpectedly');
  assert.equal(sha256(cutoutSheetPath), skeleton.atlases.cutoutSheet.sha256, 'U004 cutout-sheet hash changed unexpectedly');
  assert.equal(cutoutSize.byteLength > 600000, true, 'U004 cutout-sheet must be a real derived atlas, not a placeholder');

  assert.equal(statSync(resolve(projectRoot, 'assets/resources/art/battle/units/U004/skeleton.json')).size > 5000, true, 'U004 skeleton contract is suspiciously small');
}

function expectFailure(label, fn, pattern) {
  assert.throws(fn, pattern, `${label} must fail`);
}

const skeletonPath = resolve(projectRoot, 'assets/resources/art/battle/units/U004/skeleton.json');
const skeleton = readJson(skeletonPath);

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

console.log('T281 U004: real source art, derived pose/cutout atlases, combat+faction+doc alignment, actions, mounts, dual facings, and failure counterexamples PASS');
