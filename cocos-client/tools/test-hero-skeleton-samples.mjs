import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const clientRoot = resolve(process.cwd());
const projectRoot = resolve(clientRoot, '..');
const heroRoot = resolve(clientRoot, 'assets/resources/art/battle/heroes');
const REQUIRED_STATES = ['Idle', 'HitLight', 'HitHeavy', 'Command', 'Critical', 'Defeat'];
const REQUIRED_MOUNTS = ['shadow', 'healthBar', 'hitCenter', 'commandOrigin', 'criticalFx', 'sideSlotCenter'];
const TRACK_PROPERTIES = new Set(['translateX', 'translateY', 'rotate', 'opacity']);
const STATE_REQUIREMENTS = Object.freeze({
  Idle: Object.freeze({ loop: true, changedProperties: ['rotate'], event: null }),
  HitLight: Object.freeze({ loop: false, changedProperties: ['translateX', 'rotate'], event: 'hitLight', duration: [0.18, 0.24] }),
  HitHeavy: Object.freeze({ loop: false, changedProperties: ['translateX', 'rotate'], event: 'hitHeavy', duration: [0.28, 0.42] }),
  Command: Object.freeze({ loop: false, changedProperties: ['translateY', 'rotate'], event: 'command' }),
  Critical: Object.freeze({ loop: false, changedProperties: ['rotate', 'opacity'], event: 'critical' }),
  Defeat: Object.freeze({ loop: false, changedProperties: ['rotate', 'opacity'], event: 'despawn', duration: [0.6, 1] }),
});
const EXPECTED = {
  C001: {
    rawSize: { width: 787, height: 1024 },
    aspectRatio: 787 / 1024,
    alphaBounds: { x: 16, y: 12, width: 755, height: 1012 },
    edgeAlphaPixels: 78,
    sha256: 'ec945edeac0ac612dafdacbae3248d71faf65c6dbfa739d1fe4fc109ae40fabd',
  },
  C009: {
    rawSize: { width: 905, height: 1024 },
    aspectRatio: 905 / 1024,
    alphaBounds: { x: 16, y: 13, width: 873, height: 1001 },
    edgeAlphaPixels: 0,
    sha256: '6de58467ff20f6cf451641d3f7e4590f21ee970171adb0b0d77943c67aafac05',
  },
};
const EXPECTED_MOUNTS = {
  C001: [
    { name: 'shadow', bone: 'root', x: 0, y: 0 },
    { name: 'healthBar', bone: 'root', x: 0, y: 1040 },
    { name: 'hitCenter', bone: 'root', x: 0, y: 520 },
    { name: 'commandOrigin', bone: 'root', x: 0, y: 680 },
    { name: 'criticalFx', bone: 'root', x: 0, y: 520 },
    { name: 'sideSlotCenter', bone: 'root', x: 0, y: 512 },
  ],
  C009: [
    { name: 'shadow', bone: 'root', x: 0, y: 0 },
    { name: 'healthBar', bone: 'root', x: 0, y: 1040 },
    { name: 'hitCenter', bone: 'root', x: 0, y: 520 },
    { name: 'commandOrigin', bone: 'root', x: 0, y: 680 },
    { name: 'criticalFx', bone: 'root', x: 0, y: 520 },
    { name: 'sideSlotCenter', bone: 'root', x: 0, y: 512 },
  ],
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertFinite(value, message) {
  assert.equal(isFiniteNumber(value), true, message);
}

function parseRgbaPng(file) {
  const buffer = readFileSync(file);
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, `${file} must be a PNG`);
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  assert.equal(bitDepth, 8, `${file} must use 8-bit channels`);
  assert.equal(colorType, 6, `${file} must use RGBA pixels, not a card/background image`);
  assert.equal(interlace, 0, `${file} must be a non-interlaced sample`);

  const stride = width * 4;
  const filtered = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset++];
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x += 1) {
      let value = filtered[sourceOffset++];
      const left = x >= 4 ? pixels[rowOffset + x - 4] : 0;
      const above = y > 0 ? pixels[rowOffset - stride + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[rowOffset - stride + x - 4] : 0;
      if (filter === 1) value = (value + left) & 255;
      else if (filter === 2) value = (value + above) & 255;
      else if (filter === 3) value = (value + Math.floor((left + above) / 2)) & 255;
      else if (filter === 4) {
        const predictor = left + above - upperLeft;
        const leftDistance = Math.abs(predictor - left);
        const aboveDistance = Math.abs(predictor - above);
        const upperLeftDistance = Math.abs(predictor - upperLeft);
        const prior = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
          ? left
          : aboveDistance <= upperLeftDistance ? above : upperLeft;
        value = (value + prior) & 255;
      } else assert.equal(filter, 0, `${file} contains an unsupported PNG filter`);
      pixels[rowOffset + x] = value;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let edgeAlphaPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[y * stride + x * 4 + 3];
      if (alpha > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edgeAlphaPixels += 1;
      }
    }
  }
  assert.equal(maxX >= minX && maxY >= minY, true, `${file} must contain visible pixels`);
  return {
    width,
    height,
    aspectRatio: width / height,
    alphaBounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    transparentBorder: {
      left: minX,
      top: minY,
      right: width - maxX - 1,
      bottom: height - maxY - 1,
    },
    edgeAlphaPixels,
  };
}

function readSample(heroId) {
  const directory = resolve(heroRoot, heroId);
  const file = resolve(directory, 'skeleton.json');
  assert.equal(existsSync(file), true, `${heroId} must provide formal skeleton.json`);
  return { directory, skeleton: JSON.parse(readFileSync(file, 'utf8')) };
}

function validateFrames(animation, stateName, boneNames) {
  let changing = false;
  for (const track of animation.tracks) {
    assert.equal(boneNames.has(track.bone), true, `${stateName} targets an unknown bone`);
    assert.equal(TRACK_PROPERTIES.has(track.property), true, `${stateName} has a non-contract track property`);
    assert.equal(Array.isArray(track.frames) && track.frames.length >= 2, true, `${stateName} needs keyframes`);
    let previousTime = -1;
    const values = new Set();
    for (const frame of track.frames) {
      assertFinite(frame.time, `${stateName} keyframe time must be finite`);
      assertFinite(frame.value, `${stateName} keyframe value must be finite`);
      assert.equal(frame.time > previousTime, true, `${stateName} keyframes must be strictly ordered`);
      assert.equal(frame.time >= 0 && frame.time <= animation.duration, true, `${stateName} keyframe is outside duration`);
      previousTime = frame.time;
      values.add(frame.value);
    }
    if (values.size > 1) changing = true;
    assert.equal(track.frames[0].time, 0, `${stateName} tracks must start at time zero`);
    assert.equal(track.frames.at(-1).time, animation.duration, `${stateName} tracks must end at duration`);
  }
  assert.equal(changing, true, `${stateName} must contain visible motion`);
}

function hasChangingTrack(animation, property) {
  return animation.tracks.some((track) => track.property === property
    && new Set(track.frames.map((frame) => frame.value)).size > 1);
}

function maxAbsoluteTrackValue(animation, property) {
  return Math.max(...animation.tracks
    .filter((track) => track.property === property)
    .flatMap((track) => track.frames.map((frame) => Math.abs(frame.value))), 0);
}

function validateSource(heroId, skeleton, directory) {
  const expected = EXPECTED[heroId];
  const source = skeleton.source;
  assert.equal(source.assetKind, 'battle-cutout-transparent', `${heroId} must use a transparent battle cutout`);
  assert.equal(source.backgroundless, true, `${heroId} must declare a backgroundless source`);
  assert.equal(typeof source.sourceFile, 'string', `${heroId} must record the original transparent source path`);
  assert.equal(/CARD|CHROMA|SIDESLOT|RAW|background/i.test(source.sourceFile), false, `${heroId} cannot use card, chroma, side-slot, raw, or background art`);
  assert.equal(source.sourceFile, `美术素材/A0/主将透明/${heroId}-BATTLE-CUTOUT.png`, `${heroId} source must be the approved battle cutout`);
  assert.equal(source.file, `${heroId}-BATTLE-CUTOUT.png`, `${heroId} formal attachment must use its battle cutout`);
  assert.equal(/CARD|CHROMA|SIDESLOT|RAW|background/i.test(source.file), false, `${heroId} formal attachment cannot be card/background art`);

  const sourceFile = resolve(projectRoot, source.sourceFile);
  const formalFile = resolve(directory, source.file);
  assert.equal(existsSync(sourceFile), true, `${heroId} original transparent source is missing`);
  assert.equal(existsSync(formalFile), true, `${heroId} formal cutout is missing`);
  const sourceBytes = readFileSync(sourceFile);
  const formalBytes = readFileSync(formalFile);
  assert.deepEqual(formalBytes, sourceBytes, `${heroId} formal cutout must preserve the approved source bytes`);
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), source.sha256, `${heroId} source SHA-256 is stale`);
  assert.deepEqual(source.rawSize, expected.rawSize, `${heroId} raw source dimensions changed`);
  assert.equal(source.aspectRatio, expected.aspectRatio, `${heroId} raw source aspect ratio changed`);

  const image = parseRgbaPng(formalFile);
  assert.deepEqual({
    width: image.width,
    height: image.height,
    aspectRatio: image.aspectRatio,
    alphaBounds: image.alphaBounds,
    edgeAlphaPixels: image.edgeAlphaPixels,
    transparentBorder: image.transparentBorder,
  }, {
    width: expected.rawSize.width,
    height: expected.rawSize.height,
    aspectRatio: expected.aspectRatio,
    alphaBounds: expected.alphaBounds,
    edgeAlphaPixels: expected.edgeAlphaPixels,
    transparentBorder: {
      left: expected.alphaBounds.x,
      top: expected.alphaBounds.y,
      right: expected.rawSize.width - expected.alphaBounds.x - expected.alphaBounds.width,
      bottom: expected.rawSize.height - expected.alphaBounds.y - expected.alphaBounds.height,
    },
  }, `${heroId} transparent alpha boundary or original ratio changed`);
  assert.deepEqual(source.alphaBounds, image.alphaBounds, `${heroId} alpha bounds must be recorded`);
  assert.deepEqual(source.transparentBorder, image.transparentBorder, `${heroId} transparent border must be recorded`);
  assert.equal(source.edgeAlphaPixels, image.edgeAlphaPixels, `${heroId} edge alpha contract must be recorded`);
  return { image, sourceBytes };
}

function validateSkeleton(heroId, skeleton, directory) {
  const { image, sourceBytes } = validateSource(heroId, skeleton, directory);
  assert.equal(skeleton.schema, 'battle-hero-skeleton/v1', `${heroId} schema is invalid`);
  assert.equal(skeleton.heroId, heroId, `${heroId} directory and skeleton ID must match`);
  assert.equal(skeleton.assetStage, 'A0-reference', `${heroId} asset stage must remain an approved A0 reference`);
  assert.equal(skeleton.runtimeMode, 'single-cutout-reference-skeleton', `${heroId} runtime mode must identify a real cutout-backed sample`);
  assert.equal(skeleton.framePolicy, 'one-approved-cutout-per-state; transform-only-motion', `${heroId} must not claim fabricated image frames`);
  assert.deepEqual(skeleton.placement, {
    role: 'commander',
    fixedOutsideGrid: true,
    preserveSourceAspectRatio: true,
  }, `${heroId} placement contract is invalid`);
  assert.deepEqual(skeleton.canvas?.width, image.width, `${heroId} canvas width must preserve raw width`);
  assert.deepEqual(skeleton.canvas?.height, image.height, `${heroId} canvas height must preserve raw height`);
  assert.deepEqual(skeleton.canvas?.baseScale, { x: 1, y: 1 }, `${heroId} base scale must preserve source ratio`);
  assert.equal(skeleton.canvas?.pivot?.x, 0.5, `${heroId} canvas pivot X must be centered`);
  assert.equal(skeleton.canvas?.pivot?.y, 0, `${heroId} canvas pivot Y must be grounded`);

  assert.equal(Array.isArray(skeleton.bones) && skeleton.bones.length >= 1, true, `${heroId} must provide a root bone`);
  const boneNames = new Set();
  for (const [index, bone] of skeleton.bones.entries()) {
    assert.match(bone.name ?? '', /^[a-z][a-zA-Z0-9]*$/, `${heroId} bone names must be stable identifiers`);
    assert.equal(boneNames.has(bone.name), false, `${heroId} bone names must be unique`);
    if (index === 0) {
      assert.equal(bone.name, 'root', `${heroId} hierarchy must begin at root`);
      assert.equal('parent' in bone, false, `${heroId} root must not have a parent`);
    }
    else assert.equal(boneNames.has(bone.parent), true, `${heroId} bones must reference an earlier parent`);
    assertFinite(bone.x, `${heroId} bone X must be finite`);
    assertFinite(bone.y, `${heroId} bone Y must be finite`);
    boneNames.add(bone.name);
  }

  assert.equal(Array.isArray(skeleton.attachments) && skeleton.attachments.length === 1, true, `${heroId} must provide exactly one approved visual attachment`);
  const attachment = skeleton.attachments[0];
  assert.equal(attachment.name, 'body', `${heroId} must expose a body attachment`);
  assert.equal(attachment.bone, 'root', `${heroId} body must attach to root`);
  assert.equal(typeof attachment.file, 'string', `${heroId} body attachment must provide a file`);
  assert.equal(attachment.file, skeleton.source.file, `${heroId} body attachment must match source.file`);
  const attachmentFile = resolve(directory, attachment.file);
  assert.equal(existsSync(attachmentFile), true, `${heroId} body attachment file is missing`);
  const attachmentBytes = readFileSync(attachmentFile);
  assert.deepEqual(attachmentBytes, sourceBytes, `${heroId} body attachment must preserve the approved source bytes`);
  assert.equal(createHash('sha256').update(attachmentBytes).digest('hex'), skeleton.source.sha256, `${heroId} body attachment SHA-256 is stale`);
  assert.deepEqual({ width: attachment.width, height: attachment.height }, { ...EXPECTED[heroId].rawSize }, `${heroId} attachment dimensions must preserve raw size`);
  assert.deepEqual({ rawWidth: attachment.rawWidth, rawHeight: attachment.rawHeight }, { rawWidth: image.width, rawHeight: image.height }, `${heroId} attachment raw size must be recorded`);
  assert.equal(attachment.preserveAspectRatio, true, `${heroId} body must preserve source ratio`);
  assert.equal(attachment.backgroundless, true, `${heroId} body must remain backgroundless`);

  assert.deepEqual(skeleton.mountPoints, EXPECTED_MOUNTS[heroId], `${heroId} mount point layout must match the approved sample`);
  const mounts = new Map((skeleton.mountPoints ?? []).map((mount) => [mount.name, mount]));
  assert.equal(mounts.size, skeleton.mountPoints.length, `${heroId} mount point names must be unique`);
  assert.deepEqual([...mounts.keys()], REQUIRED_MOUNTS, `${heroId} mount point contract is incomplete or reordered`);
  for (const mountName of REQUIRED_MOUNTS) {
    const mount = mounts.get(mountName);
    assert.equal(Boolean(mount), true, `${heroId} must declare ${mountName} mount point`);
    assert.equal(boneNames.has(mount?.bone), true, `${heroId} ${mountName} must reference a bone`);
    assertFinite(mount?.x, `${heroId} ${mountName} X must be finite`);
    assertFinite(mount?.y, `${heroId} ${mountName} Y must be finite`);
  }

  assert.deepEqual(skeleton.orientations, {
    player: { direction: 1, scaleX: 1, scaleY: 1 },
    enemy: { direction: -1, scaleX: -1, scaleY: 1 },
  }, `${heroId} must expose deterministic player/enemy mirroring without vertical distortion`);
  assert.deepEqual(skeleton.animationContract, REQUIRED_STATES, `${heroId} six-state contract is incomplete or reordered`);
  assert.deepEqual(Object.keys(skeleton.animations), REQUIRED_STATES, `${heroId} animations must match the six-state contract exactly`);
  for (const stateName of REQUIRED_STATES) {
    const animation = skeleton.animations[stateName];
    const semantics = STATE_REQUIREMENTS[stateName];
    assert.equal(typeof animation === 'object' && animation !== null, true, `${heroId} must define ${stateName}`);
    assert.equal(animation.duration > 0 && animation.duration <= 3, true, `${heroId} ${stateName} duration must be 0–3 seconds`);
    assert.equal(typeof animation.loop, 'boolean', `${heroId} ${stateName} must declare loop behavior`);
    assert.equal(animation.sourceAttachment, 'body', `${heroId} ${stateName} must use the approved body attachment`);
    assert.equal(animation.loop, semantics.loop, `${heroId} ${stateName} loop behavior is invalid`);
    if (semantics.duration) {
      assert.equal(animation.duration >= semantics.duration[0] && animation.duration <= semantics.duration[1], true, `${heroId} ${stateName} duration is outside its state threshold`);
    }
    assert.equal(Array.isArray(animation.tracks) && animation.tracks.length > 0, true, `${heroId} ${stateName} must contain tracks`);
    assert.equal(Array.isArray(animation.events), true, `${heroId} ${stateName} must contain events`);
    validateFrames(animation, stateName, boneNames);
    for (const event of animation.events) {
      assert.match(event.name ?? '', /^[a-z][a-zA-Z0-9]*$/, `${heroId} ${stateName} event names must be stable`);
      assertFinite(event.time, `${heroId} ${stateName} event time must be finite`);
      assert.equal(event.time >= 0 && event.time <= animation.duration, true, `${heroId} ${stateName} event is outside its duration`);
    }
    for (const property of semantics.changedProperties) {
      assert.equal(hasChangingTrack(animation, property), true, `${heroId} ${stateName} must animate ${property}`);
    }
    if (semantics.event === null) assert.equal(animation.events.length, 0, `${heroId} ${stateName} must not emit an action event`);
    else assert.equal(animation.events.some((event) => event.name === semantics.event), true, `${heroId} ${stateName} must expose ${semantics.event}`);
  }
  assert.equal(skeleton.animations.HitHeavy.duration > skeleton.animations.HitLight.duration, true, `${heroId} heavy hit must last longer than light hit`);
  assert.equal(maxAbsoluteTrackValue(skeleton.animations.HitHeavy, 'translateX') > maxAbsoluteTrackValue(skeleton.animations.HitLight, 'translateX'), true, `${heroId} heavy hit must recoil farther than light hit`);
  assert.equal(maxAbsoluteTrackValue(skeleton.animations.HitHeavy, 'rotate') > maxAbsoluteTrackValue(skeleton.animations.HitLight, 'rotate'), true, `${heroId} heavy hit must rotate farther than light hit`);
  const despawn = skeleton.animations.Defeat.events.find((event) => event.name === 'despawn');
  assert.equal(despawn.time, skeleton.animations.Defeat.duration, `${heroId} Defeat despawn must occur at the final keyframe`);
  assert.equal(skeleton.animations.Defeat.tracks.some((track) => track.property === 'opacity' && track.frames.at(-1).value === 0), true, `${heroId} Defeat must end transparent`);
  assert.equal(skeleton.animations.Attack, undefined, `${heroId} must not silently use the unit Attack state contract`);
}

const samples = Object.keys(EXPECTED).map((heroId) => ({ heroId, ...readSample(heroId) }));
for (const sample of samples) validateSkeleton(sample.heroId, sample.skeleton, sample.directory);

const missingState = structuredClone(samples[0].skeleton);
delete missingState.animations.Critical;
assert.throws(() => validateSkeleton('C001', missingState, samples[0].directory), /six-state contract is incomplete|animations must match/);

const cardSource = structuredClone(samples[0].skeleton);
cardSource.source.sourceFile = '美术素材/运行时/卡面/core/large/C001-CARD.webp';
assert.throws(() => validateSkeleton('C001', cardSource, samples[0].directory), /card, chroma, side-slot, raw, or background/);

const wrongAttachmentPath = structuredClone(samples[0].skeleton);
wrongAttachmentPath.attachments[0].file = '../C009/C009-BATTLE-CUTOUT.png';
assert.throws(() => validateSkeleton('C001', wrongAttachmentPath, samples[0].directory), /body attachment must match source\.file/);

const missingAttachment = structuredClone(samples[1].skeleton);
missingAttachment.attachments = [];
assert.throws(() => validateSkeleton('C009', missingAttachment, samples[1].directory), /must provide exactly one approved visual attachment/);

const wrongAlphaBoundary = structuredClone(samples[1].skeleton);
wrongAlphaBoundary.source.alphaBounds.width -= 1;
assert.throws(() => validateSkeleton('C009', wrongAlphaBoundary, samples[1].directory), /alpha bounds must be recorded/);

const wrongAspectRatio = structuredClone(samples[0].skeleton);
wrongAspectRatio.source.aspectRatio += 0.01;
assert.throws(() => validateSkeleton('C001', wrongAspectRatio, samples[0].directory), /raw source aspect ratio changed/);

const wrongSourceHash = structuredClone(samples[1].skeleton);
wrongSourceHash.source.sha256 = '0'.repeat(64);
assert.throws(() => validateSkeleton('C009', wrongSourceHash, samples[1].directory), /source SHA-256 is stale/);

const wrongDirection = structuredClone(samples[1].skeleton);
wrongDirection.orientations.enemy.scaleY = -1;
assert.throws(() => validateSkeleton('C009', wrongDirection, samples[1].directory), /deterministic player\/enemy mirroring/);

const wrongBackgroundFlag = structuredClone(samples[0].skeleton);
wrongBackgroundFlag.source.backgroundless = false;
assert.throws(() => validateSkeleton('C001', wrongBackgroundFlag, samples[0].directory), /backgroundless source/);

const wrongAttachmentBackgroundFlag = structuredClone(samples[1].skeleton);
wrongAttachmentBackgroundFlag.attachments[0].backgroundless = false;
assert.throws(() => validateSkeleton('C009', wrongAttachmentBackgroundFlag, samples[1].directory), /body must remain backgroundless/);

const wrongMountLayout = structuredClone(samples[0].skeleton);
wrongMountLayout.mountPoints.pop();
assert.throws(() => validateSkeleton('C001', wrongMountLayout, samples[0].directory), /mount point layout/);

const duplicateMount = structuredClone(samples[1].skeleton);
duplicateMount.mountPoints.push({ ...duplicateMount.mountPoints[0] });
assert.throws(() => validateSkeleton('C009', duplicateMount, samples[1].directory), /mount point layout/);

const wrongStateAttachment = structuredClone(samples[0].skeleton);
wrongStateAttachment.animations.Command.sourceAttachment = 'placeholder';
assert.throws(() => validateSkeleton('C001', wrongStateAttachment, samples[0].directory), /approved body attachment/);

const wrongLoop = structuredClone(samples[1].skeleton);
wrongLoop.animations.HitLight.loop = true;
assert.throws(() => validateSkeleton('C009', wrongLoop, samples[1].directory), /loop behavior is invalid/);

const wrongTrackStart = structuredClone(samples[0].skeleton);
wrongTrackStart.animations.Idle.tracks[0].frames[0].time = 0.1;
assert.throws(() => validateSkeleton('C001', wrongTrackStart, samples[0].directory), /tracks must start at time zero/);

const wrongTrackEnd = structuredClone(samples[1].skeleton);
wrongTrackEnd.animations.Defeat.tracks[0].frames.at(-1).time = 0.7;
assert.throws(() => validateSkeleton('C009', wrongTrackEnd, samples[1].directory), /tracks must end at duration/);

const wrongCommandMotion = structuredClone(samples[0].skeleton);
wrongCommandMotion.animations.Command.tracks[0].frames.forEach((frame) => { frame.value = 0; });
assert.throws(() => validateSkeleton('C001', wrongCommandMotion, samples[0].directory), /must animate translateY/);

const weakHeavyHit = structuredClone(samples[1].skeleton);
weakHeavyHit.animations.HitHeavy.tracks.find((track) => track.property === 'translateX').frames[1].value = -8;
assert.throws(() => validateSkeleton('C009', weakHeavyHit, samples[1].directory), /heavy hit must recoil farther/);

const loopingDefeat = structuredClone(samples[0].skeleton);
loopingDefeat.animations.Defeat.loop = true;
assert.throws(() => validateSkeleton('C001', loopingDefeat, samples[0].directory), /loop behavior is invalid/);

const persistentDefeat = structuredClone(samples[1].skeleton);
persistentDefeat.animations.Defeat.tracks.find((track) => track.property === 'opacity').frames.at(-1).value = 1;
assert.throws(() => validateSkeleton('C009', persistentDefeat, samples[1].directory), /Defeat must animate opacity|Defeat must end transparent/);

console.log(`hero skeleton samples validated: ${samples.map(({ heroId }) => heroId).join(', ')}; 20 contract counterexamples rejected`);
