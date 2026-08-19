import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(process.cwd());
const workspaceRoot = resolve(projectRoot, '..');
const unitRoot = resolve(projectRoot, 'assets/resources/art/battle/units');
const REQUIRED_ACTIONS = ['Idle', 'Move', 'Attack', 'Hit', 'Death'];
const REQUIRED_MOUNTS = ['attackOrigin', 'effect', 'healthBar', 'shadow'];
const TRACK_PROPERTIES = new Set(['translateX', 'translateY', 'rotate', 'scaleX', 'scaleY', 'opacity']);
const EXPECTED_POSE_STATES = new Map(REQUIRED_ACTIONS.map((state, index) => [state, index]));

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sourceFile(unitId, sourceName, source, field) {
  assert.equal(typeof source?.[field], 'string', `${unitId} ${sourceName} must declare ${field}`);
  assert.equal(source[field].startsWith('/'), false, `${unitId} ${sourceName} ${field} must be relative`);
  const file = resolve(projectRoot, source[field]);
  const insideAllowedSourceRoots = file.startsWith(`${projectRoot}/`) || file.startsWith(`${workspaceRoot}/`);
  assert.equal(insideAllowedSourceRoots, true, `${unitId} ${sourceName} ${field} escapes the workspace`);
  assert.equal(existsSync(file), true, `${unitId} ${sourceName} ${field} is missing: ${source[field]}`);
  return file;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function validatePngSource(unitId, sourceName, source) {
  const file = sourceFile(unitId, sourceName, source, 'path');
  const reference = sourceFile(unitId, sourceName, source, 'referencePath');
  const bytes = readFileSync(file);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${unitId} ${sourceName} source must be PNG`);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${unitId} ${sourceName} PNG must contain IHDR`);
  const actualSize = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  assert.deepEqual(actualSize, source.size, `${unitId} ${sourceName} source dimensions changed`);
  assert.equal(sha256(file), source.sha256, `${unitId} ${sourceName} source hash does not match its manifest`);
  assert.equal(sha256(reference), source.sha256, `${unitId} ${sourceName} reference hash does not match its manifest`);
  assert.equal(source.status, 'reference-approved', `${unitId} ${sourceName} must be reference-approved`);
  return actualSize;
}

function validateRect(unitId, label, rect, sourceSize) {
  assert.equal(isRecord(rect), true, `${unitId} ${label} must declare a source rectangle`);
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.equal(Number.isInteger(rect[key]), true, `${unitId} ${label}.${key} must be an integer`);
  }
  assert.equal(rect.x >= 0 && rect.y >= 0, true, `${unitId} ${label} rectangle must start inside its source`);
  assert.equal(rect.width > 0 && rect.height > 0, true, `${unitId} ${label} rectangle must be positive`);
  assert.equal(rect.x + rect.width <= sourceSize.width, true, `${unitId} ${label} rectangle exceeds source width`);
  assert.equal(rect.y + rect.height <= sourceSize.height, true, `${unitId} ${label} rectangle exceeds source height`);
}

function validateSourceContract(unitId, skeleton) {
  assert.equal(isRecord(skeleton.sources), true, `${unitId} must declare source assets`);
  const poseSheet = skeleton.sources.poseSheet;
  const cutoutSheet = skeleton.sources.cutoutSheet;
  assert.equal(poseSheet?.id, `${unitId}-ANIMATION-POSES`, `${unitId} pose source id must match the unit`);
  assert.equal(cutoutSheet?.id, `${unitId}-CUTOUT-SHEET`, `${unitId} cutout source id must match the unit`);
  const poseSize = validatePngSource(unitId, 'poseSheet', poseSheet);
  const cutoutSize = validatePngSource(unitId, 'cutoutSheet', cutoutSheet);

  assert.equal(Array.isArray(poseSheet.poseGrid), true, `${unitId} poseSheet must declare its pose grid`);
  assert.equal(poseSheet.poseGrid.length, REQUIRED_ACTIONS.length, `${unitId} poseSheet must expose exactly five approved key poses`);
  let previousPoseEnd = 0;
  for (const [index, pose] of poseSheet.poseGrid.entries()) {
    assert.equal(pose.index, index, `${unitId} pose grid indices must be contiguous`);
    assert.equal(pose.state, REQUIRED_ACTIONS[index], `${unitId} pose grid order must be Idle, Move, Attack, Hit, Death`);
    validateRect(unitId, `poseGrid[${index}]`, pose.rect, poseSize);
    assert.equal(pose.rect.x, previousPoseEnd, `${unitId} pose grid columns must be contiguous without gaps or overlap`);
    previousPoseEnd = pose.rect.x + pose.rect.width;
  }
  assert.equal(previousPoseEnd, poseSize.width, `${unitId} pose grid must cover the full source width`);
  return { poseSize, cutoutSize };
}

function validateFrames(unitId, actionName, track, duration, boneNames) {
  assert.equal(typeof track.bone, 'string', `${unitId} ${actionName} track must target a bone`);
  assert.equal(boneNames.has(track.bone), true, `${unitId} ${actionName} track targets an unknown bone: ${track.bone}`);
  assert.equal(TRACK_PROPERTIES.has(track.property), true, `${unitId} ${actionName} track has an unsupported property: ${track.property}`);
  assert.equal(Array.isArray(track.frames) && track.frames.length >= 2, true, `${unitId} ${actionName} track must have at least two transform keyframes`);
  let previousTime = -1;
  for (const frame of track.frames) {
    assert.equal(isFiniteNumber(frame.time), true, `${unitId} ${actionName} keyframe time must be finite`);
    assert.equal(isFiniteNumber(frame.value), true, `${unitId} ${actionName} keyframe value must be finite`);
    assert.equal(frame.time > previousTime, true, `${unitId} ${actionName} keyframes must be strictly ordered`);
    assert.equal(frame.time >= 0 && frame.time <= duration, true, `${unitId} ${actionName} keyframe must stay inside its duration`);
    previousTime = frame.time;
  }
  assert.equal(track.frames[0].time, 0, `${unitId} ${actionName} tracks must start at time zero`);
}

function hasChangingTrack(animation, property) {
  return animation.tracks.some((track) => track.property === property
    && new Set(track.frames.map((frame) => frame.value)).size > 1);
}

function validateActionSemantics(unitId, animations) {
  assert.equal(animations.Idle.loop, true, `${unitId} Idle must loop`);
  assert.equal(animations.Move.loop, true, `${unitId} Move must loop`);
  for (const action of ['Attack', 'Hit', 'Death']) {
    assert.equal(animations[action].loop, false, `${unitId} ${action} must not loop`);
  }
  assert.equal(hasChangingTrack(animations.Idle, 'scaleY') || hasChangingTrack(animations.Idle, 'rotate'), true, `${unitId} Idle must contain visible transform motion`);
  assert.equal(hasChangingTrack(animations.Move, 'translateX'), true, `${unitId} Move must translate on the horizontal axis`);
  assert.equal(hasChangingTrack(animations.Attack, 'rotate') || hasChangingTrack(animations.Attack, 'translateX'), true, `${unitId} Attack must animate a strike`);
  assert.equal(hasChangingTrack(animations.Hit, 'translateX') || hasChangingTrack(animations.Hit, 'opacity'), true, `${unitId} Hit must animate a reaction`);
  assert.equal(hasChangingTrack(animations.Death, 'rotate') || hasChangingTrack(animations.Death, 'opacity'), true, `${unitId} Death must animate a removal pose`);

  const impact = animations.Attack.events.find((event) => event.name === 'impact');
  assert.equal(Boolean(impact), true, `${unitId} Attack must expose an impact event`);
  assert.equal(impact.time > 0 && impact.time < animations.Attack.duration, true, `${unitId} Attack impact must occur inside its animation`);
  assert.equal(Boolean(animations.Hit.events.find((event) => event.name === 'hit')), true, `${unitId} Hit must expose a hit event`);
  const despawn = animations.Death.events.find((event) => event.name === 'despawn');
  assert.equal(Boolean(despawn), true, `${unitId} Death must expose a despawn event`);
  assert.equal(despawn.time, animations.Death.duration, `${unitId} Death despawn must occur at the final keyframe`);
}

function validateSkeleton(unitId, skeleton) {
  assert.equal(skeleton.schema, 'battle-unit-skeleton/v1', `${unitId} must use the battle-unit-skeleton/v1 contract`);
  assert.equal(skeleton.contractVersion, '2.2', `${unitId} must declare the frozen v2.2 contract`);
  assert.equal(skeleton.unitId, unitId, `${unitId} skeleton unitId must match its directory`);
  assert.equal(skeleton.framePolicy, 'one-approved-key-pose-per-state; no-fabricated-frames', `${unitId} must reject fabricated frame claims`);
  assert.equal(isFiniteNumber(skeleton.canvas?.width) && skeleton.canvas.width > 0, true, `${unitId} must declare a positive canvas width`);
  assert.equal(isFiniteNumber(skeleton.canvas?.height) && skeleton.canvas.height > 0, true, `${unitId} must declare a positive canvas height`);
  assert.equal(isFiniteNumber(skeleton.canvas?.pivot?.x) && isFiniteNumber(skeleton.canvas?.pivot?.y), true, `${unitId} must declare a finite canvas pivot`);

  const { poseSize, cutoutSize } = validateSourceContract(unitId, skeleton);
  assert.equal(Array.isArray(skeleton.bones) && skeleton.bones.length >= 6, true, `${unitId} must provide a non-trivial bone hierarchy`);
  const boneNames = new Set();
  for (const [index, bone] of skeleton.bones.entries()) {
    assert.match(bone.name ?? '', /^[a-z][a-zA-Z0-9]*$/, `${unitId} bone names must be stable identifiers`);
    assert.equal(boneNames.has(bone.name), false, `${unitId} bone names must be unique`);
    if (index === 0) {
      assert.equal(bone.name, 'root', `${unitId} hierarchy must begin at root`);
      assert.equal('parent' in bone, false, `${unitId} root must not have a parent`);
    } else {
      assert.equal(boneNames.has(bone.parent), true, `${unitId} bone ${bone.name} must reference an earlier parent`);
    }
    assert.equal(isFiniteNumber(bone.x) && isFiniteNumber(bone.y), true, `${unitId} bone ${bone.name} must have finite coordinates`);
    boneNames.add(bone.name);
  }

  assert.equal(Array.isArray(skeleton.attachments) && skeleton.attachments.length >= 4, true, `${unitId} must provide four or more source-backed attachments`);
  const attachmentNames = new Set();
  for (const attachment of skeleton.attachments) {
    assert.match(attachment.name ?? '', /^[a-z][a-zA-Z0-9]*$/, `${unitId} attachment names must be stable identifiers`);
    assert.equal(attachmentNames.has(attachment.name), false, `${unitId} attachment names must be unique`);
    assert.equal(boneNames.has(attachment.bone), true, `${unitId} attachment ${attachment.name} targets an unknown bone`);
    assert.equal(attachment.source, 'cutoutSheet', `${unitId} attachment ${attachment.name} must use the approved cutout reference`);
    validateRect(unitId, `attachment ${attachment.name}`, attachment.sourceRect, cutoutSize);
    assert.equal(attachment.width, attachment.sourceRect.width, `${unitId} attachment ${attachment.name} width must match its source rectangle`);
    assert.equal(attachment.height, attachment.sourceRect.height, `${unitId} attachment ${attachment.name} height must match its source rectangle`);
    attachmentNames.add(attachment.name);
  }

  assert.equal(Array.isArray(skeleton.mountPoints), true, `${unitId} must declare mount points`);
  const mounts = new Map(skeleton.mountPoints.map((mount) => [mount.name, mount]));
  assert.equal(mounts.size, skeleton.mountPoints.length, `${unitId} mount point names must be unique`);
  for (const mountName of REQUIRED_MOUNTS) {
    const mount = mounts.get(mountName);
    assert.equal(Boolean(mount), true, `${unitId} must declare the ${mountName} mount point`);
    assert.equal(boneNames.has(mount?.bone), true, `${unitId} ${mountName} mount must reference a bone`);
    assert.equal(isFiniteNumber(mount?.x) && isFiniteNumber(mount?.y), true, `${unitId} ${mountName} mount must have finite coordinates`);
  }

  assert.deepEqual(skeleton.orientations, {
    player: { direction: -1, scaleX: -1 },
    enemy: { direction: 1, scaleX: 1 }
  }, `${unitId} must expose the runtime player/enemy mirror mapping`);

  assert.equal(isRecord(skeleton.stateMap), true, `${unitId} must define an explicit state map`);
  assert.equal(isRecord(skeleton.animations), true, `${unitId} must define animations`);
  for (const actionName of REQUIRED_ACTIONS) {
    const expectedPoseIndex = EXPECTED_POSE_STATES.get(actionName);
    const state = skeleton.stateMap[actionName];
    const animation = skeleton.animations[actionName];
    assert.deepEqual(state, { source: 'poseSheet', poseIndex: expectedPoseIndex }, `${unitId} ${actionName} must map to its approved pose column`);
    assert.equal(isRecord(animation), true, `${unitId} must define ${actionName}`);
    assert.equal(isFiniteNumber(animation.duration) && animation.duration > 0 && animation.duration <= 3, true, `${unitId} ${actionName} duration must be within 0–3 seconds`);
    assert.equal(typeof animation.loop, 'boolean', `${unitId} ${actionName} must declare loop behavior`);
    assert.deepEqual(animation.sourcePose, state, `${unitId} ${actionName} source pose must agree with stateMap`);
    assert.equal(Array.isArray(animation.sourceFrames) && animation.sourceFrames.length === 1, true, `${unitId} ${actionName} must reference exactly one real key pose, not invented image frames`);
    assert.deepEqual(animation.sourceFrames[0], { time: 0, source: 'poseSheet', poseIndex: expectedPoseIndex }, `${unitId} ${actionName} source frame must be its mapped key pose`);
    assert.equal(Array.isArray(animation.tracks) && animation.tracks.length > 0, true, `${unitId} ${actionName} must contain transform tracks`);
    assert.equal(Array.isArray(animation.events), true, `${unitId} ${actionName} must contain an event list`);
    for (const track of animation.tracks) validateFrames(unitId, actionName, track, animation.duration, boneNames);
    for (const event of animation.events) {
      assert.match(event.name ?? '', /^[a-z][a-zA-Z0-9]*$/, `${unitId} ${actionName} event names must be stable identifiers`);
      assert.equal(isFiniteNumber(event.time) && event.time >= 0 && event.time <= animation.duration, true, `${unitId} ${actionName} event must stay inside its animation`);
    }
  }
  validateActionSemantics(unitId, skeleton.animations);
}

function readUnitSkeleton(unitId) {
  const file = resolve(unitRoot, unitId, 'skeleton.json');
  assert.equal(existsSync(file), true, `${unitId} must provide the formal skeleton.json sample`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

const samples = ['U002', 'U008'].map((unitId) => ({ unitId, skeleton: readUnitSkeleton(unitId) }));
for (const sample of samples) validateSkeleton(sample.unitId, sample.skeleton);

const missingAction = structuredClone(samples[0].skeleton);
delete missingAction.animations.Attack;
assert.throws(() => validateSkeleton('U002', missingAction), /must define Attack/);

const invalidSourceRect = structuredClone(samples[0].skeleton);
invalidSourceRect.attachments[0].sourceRect.x = 1536;
assert.throws(() => validateSkeleton('U002', invalidSourceRect), /rectangle exceeds source width/);

const wrongDirection = structuredClone(samples[1].skeleton);
wrongDirection.orientations.enemy.scaleX = -1;
assert.throws(() => validateSkeleton('U008', wrongDirection), /runtime player\/enemy mirror mapping/);

const wrongStateMapping = structuredClone(samples[1].skeleton);
wrongStateMapping.stateMap.Death.poseIndex = 3;
assert.throws(() => validateSkeleton('U008', wrongStateMapping), /Death must map to its approved pose column/);

console.log(`unit skeleton samples validated: ${samples.map(({ unitId }) => unitId).join(', ')}; 4 contract counterexamples rejected`);
