import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const clientRoot = resolve(process.cwd());
const projectRoot = resolve(clientRoot, '..');
const unitDir = resolve(clientRoot, 'assets/resources/art/battle/units/U001');
const skeletonFile = resolve(unitDir, 'skeleton.json');
const REQUIRED_ACTIONS = ['Idle', 'Move', 'Attack', 'Hit', 'Death'];
const TRACK_PROPERTIES = new Set(['translateX', 'translateY', 'rotate', 'scaleX', 'scaleY', 'opacity']);
const EXPECTED_MOUNTS = Object.freeze({
  attackOrigin: Object.freeze({ bone: 'blade', x: [72, 128], y: [-16, 24] }),
  effect: Object.freeze({ bone: 'torso', x: [-32, 32], y: [48, 96] }),
  healthBar: Object.freeze({ bone: 'root', x: [-16, 16], y: [208, 256] }),
  shadow: Object.freeze({ bone: 'root', x: [-16, 16], y: [-16, 16] }),
  cardAnchor: Object.freeze({ bone: 'root', x: [-16, 16], y: [96, 144] })
});
const EXPECTED_HASHES = Object.freeze({
  poseSheet: 'af901a19646f02532e855133c9e8f1b492c5eb73b5b426d7b58ed53ad7d96fea',
  cutoutSheet: '35d0b6b232caf1e06633d5d0f772603810a4aa8936b3ccb7a86aa8a9d812717e'
});
const EXPECTED_IMAGE_STATS = Object.freeze({
  poseSheet: Object.freeze({
    width: 2000,
    height: 800,
    alphaBounds: Object.freeze({ x: 0, y: 376, width: 1981, height: 353 }),
    opaquePixels: 200913,
    slices: Object.freeze([
      Object.freeze({ state: 'Idle', alphaBounds: Object.freeze({ x: 0, y: 384, width: 400, height: 319 }), opaquePixels: 39178 }),
      Object.freeze({ state: 'Move', alphaBounds: Object.freeze({ x: 0, y: 380, width: 400, height: 323 }), opaquePixels: 37953 }),
      Object.freeze({ state: 'Attack', alphaBounds: Object.freeze({ x: 0, y: 376, width: 400, height: 327 }), opaquePixels: 48788 }),
      Object.freeze({ state: 'Hit', alphaBounds: Object.freeze({ x: 0, y: 388, width: 271, height: 315 }), opaquePixels: 32108 }),
      Object.freeze({ state: 'Death', alphaBounds: Object.freeze({ x: 16, y: 464, width: 365, height: 265 }), opaquePixels: 42886 })
    ])
  }),
  cutoutSheet: Object.freeze({
    width: 1536,
    height: 1024,
    alphaBounds: Object.freeze({ x: 0, y: 154, width: 1536, height: 839 }),
    opaquePixels: 150749
  })
});

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function parsePng(file) {
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
  assert.equal(colorType, 6, `${file} must use RGBA, not a flattened mockup`);
  assert.equal(interlace, 0, `${file} must be a non-interlaced runtime asset`);

  const stride = width * 4;
  const filtered = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset++];
    assert.equal(filter, 0, `${file} must use deterministic filter 0 rows`);
    filtered.copy(pixels, y * stride, sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let opaquePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[y * stride + x * 4 + 3];
      if (alpha > 0) {
        opaquePixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  assert.equal(maxX >= minX && maxY >= minY, true, `${file} must contain visible pixels`);
  return {
    width,
    height,
    pixels,
    alphaBounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    opaquePixels
  };
}

function sliceStats(image, startX, width) {
  const minInitial = { x: width, y: image.height, maxX: -1, maxY: -1, opaquePixels: 0 };
  const result = { ...minInitial };
  const stride = image.width * 4;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = startX; x < startX + width; x += 1) {
      const alpha = image.pixels[y * stride + x * 4 + 3];
      if (alpha > 0) {
        result.opaquePixels += 1;
        result.x = Math.min(result.x, x - startX);
        result.y = Math.min(result.y, y);
        result.maxX = Math.max(result.maxX, x - startX);
        result.maxY = Math.max(result.maxY, y);
      }
    }
  }
  return {
    opaquePixels: result.opaquePixels,
    alphaBounds: { x: result.x, y: result.y, width: result.maxX - result.x + 1, height: result.maxY - result.y + 1 }
  };
}

function readSkeleton() {
  assert.equal(existsSync(skeletonFile), true, 'U001 must provide formal skeleton.json');
  return JSON.parse(readFileSync(skeletonFile, 'utf8'));
}

function readUnitIdentity() {
  const unitTable = JSON.parse(readFileSync(resolve(clientRoot, 'assets/resources/config/units.json'), 'utf8'));
  const cardTable = JSON.parse(readFileSync(resolve(clientRoot, 'assets/resources/config/cards.json'), 'utf8'));
  const unit = unitTable.units.find((entry) => entry.id === 'U001');
  const card = cardTable.cards.find((entry) => entry.id === 'U001');
  assert(unit, 'units.json must contain real U001 config');
  assert(card, 'cards.json must contain real U001 card config');
  return { unit, card };
}

function validateIdentity(unit, card) {
  assert.deepEqual(
    {
      id: unit.id,
      maxHp: unit.maxHp,
      attack: unit.attack,
      armor: unit.armor,
      move: unit.move,
      range: unit.range,
      role: unit.role,
      abilityIds: unit.abilityIds,
      race: unit.race,
      politicalFaction: unit.politicalFaction,
      visualArchetype: unit.visualArchetype
    },
    {
      id: 'U001',
      maxHp: 8,
      attack: 2,
      armor: 2,
      move: 1,
      range: 1,
      role: 'GUARD',
      abilityIds: ['A001'],
      race: '人族',
      politicalFaction: '朔垣军府',
      visualArchetype: 'HUMANOID_INFANTRY'
    },
    'U001 runtime identity must stay aligned with the approved guard baseline'
  );
  assert.equal(card.unitId, 'U001', 'card metadata must point at U001');
  assert.equal(card.race, '人族', 'card-facing race copy must remain 人族');
  assert.equal(card.politicalFaction, '朔垣军府', 'card metadata must preserve the real political faction');
  assert.equal(card.prepare, 3, 'card prepare must stay aligned with the approved baseline');
  assert.equal(card.copyLimit, 4, 'card copy limit drift');
}

function validateImages(skeleton) {
  for (const [sourceName, expectedHash] of Object.entries(EXPECTED_HASHES)) {
    const source = skeleton.sources[sourceName];
    assert(source, `skeleton must declare ${sourceName}`);
    for (const field of ['path', 'referencePath']) {
      assert.equal(typeof source[field], 'string', true, `${sourceName}.${field} must be a string`);
      assert.equal(source[field].startsWith('/'), false, `${sourceName}.${field} must stay inside the workspace`);
      assert.equal(source[field].includes('CARD'), false, `${sourceName}.${field} cannot point at card art`);
      assert.equal(existsSync(resolve(clientRoot, source[field])), true, `${sourceName}.${field} must exist`);
    }
    const pathFile = resolve(clientRoot, source.path);
    const referenceFile = resolve(clientRoot, source.referencePath);
    assert.equal(sha256(pathFile), expectedHash, `${sourceName} path hash drift`);
    assert.equal(sha256(referenceFile), expectedHash, `${sourceName} reference hash drift`);
    assert.equal(source.sha256, expectedHash, `${sourceName} manifest hash drift`);
    const image = parsePng(pathFile);
    const expected = EXPECTED_IMAGE_STATS[sourceName];
    assert.deepEqual(
      { width: image.width, height: image.height, alphaBounds: image.alphaBounds, opaquePixels: image.opaquePixels },
      { width: expected.width, height: expected.height, alphaBounds: expected.alphaBounds, opaquePixels: expected.opaquePixels },
      `${sourceName} dimensions or alpha footprint changed`
    );
    assert.deepEqual(source.size, { width: expected.width, height: expected.height }, `${sourceName} size manifest drift`);
    if (sourceName === 'poseSheet') {
      assert.equal(Array.isArray(source.poseGrid), true, 'poseSheet must declare a five-state grid');
      assert.equal(source.poseGrid.length, REQUIRED_ACTIONS.length, 'poseSheet must expose exactly five slices');
      let cursor = 0;
      for (const [index, slice] of source.poseGrid.entries()) {
        const expectedSlice = expected.slices[index];
        assert.deepEqual(
          slice,
          { index, state: REQUIRED_ACTIONS[index], rect: { x: cursor, y: 0, width: 400, height: 800 } },
          `${slice.state} pose grid must remain contiguous and cover one approved state`
        );
        const stats = sliceStats(image, slice.rect.x, slice.rect.width);
        assert.deepEqual(
          { opaquePixels: stats.opaquePixels, alphaBounds: stats.alphaBounds },
          { opaquePixels: expectedSlice.opaquePixels, alphaBounds: expectedSlice.alphaBounds },
          `${slice.state} pose slice footprint changed`
        );
        cursor += 400;
      }
      const attackSlice = sliceStats(image, 800, 400);
      const idleSlice = sliceStats(image, 0, 400);
      const deathSlice = sliceStats(image, 1600, 400);
      assert.equal(attackSlice.opaquePixels > idleSlice.opaquePixels, true, 'Attack must widen the silhouette beyond Idle');
      assert.equal(deathSlice.alphaBounds.y > idleSlice.alphaBounds.y, true, 'Death must collapse lower than Idle');
    }
  }
}

function validateAnimation(actionName, animation, boneNames) {
  assert.equal(typeof animation.duration, 'number', true, `${actionName} must declare duration`);
  assert.equal(animation.duration > 0 && animation.duration <= 3, true, `${actionName} duration must stay within 0-3 seconds`);
  assert.equal(typeof animation.loop, 'boolean', true, `${actionName} must declare loop`);
  assert.deepEqual(animation.sourcePose, { source: 'poseSheet', poseIndex: REQUIRED_ACTIONS.indexOf(actionName) }, `${actionName} source pose drift`);
  assert.equal(Array.isArray(animation.sourceFrames) && animation.sourceFrames.length === 1, true, `${actionName} must bind exactly one approved source pose`);
  assert.deepEqual(animation.sourceFrames[0], { time: 0, source: 'poseSheet', poseIndex: REQUIRED_ACTIONS.indexOf(actionName) }, `${actionName} source frame drift`);
  assert.equal(Array.isArray(animation.tracks) && animation.tracks.length >= 1, true, `${actionName} needs transform tracks`);
  let changedProperty = false;
  for (const track of animation.tracks) {
    assert.equal(boneNames.has(track.bone), true, `${actionName} track bone must exist`);
    assert.equal(TRACK_PROPERTIES.has(track.property), true, `${actionName} track property must stay inside the runtime contract`);
    assert.equal(Array.isArray(track.frames) && track.frames.length >= 2, true, `${actionName} track must contain at least two keyframes`);
    let previousTime = -1;
    const values = new Set();
    for (const frame of track.frames) {
      assert.equal(Number.isFinite(frame.time) && Number.isFinite(frame.value), true, `${actionName} keyframes must be finite`);
      assert.equal(frame.time > previousTime, true, `${actionName} keyframes must be strictly ordered`);
      assert.equal(frame.time >= 0 && frame.time <= animation.duration, true, `${actionName} keyframes must stay inside duration`);
      previousTime = frame.time;
      values.add(frame.value);
    }
    assert.equal(track.frames[0].time, 0, `${actionName} tracks must start at time zero`);
    assert.equal(track.frames.at(-1).time, animation.duration, `${actionName} tracks must end at duration`);
    if (values.size > 1) changedProperty = true;
  }
  assert.equal(changedProperty, true, `${actionName} must contain visible motion`);
}

function validateSkeleton(skeleton) {
  assert.equal(skeleton.schema, 'battle-unit-skeleton/v1', 'U001 must use the unit skeleton contract');
  assert.equal(skeleton.contractVersion, '2.2', 'U001 must stay on the approved v2.2 contract');
  assert.equal(skeleton.unitId, 'U001', 'unitId must match the directory');
  assert.equal(skeleton.assetStage, 'A0-reference', 'U001 must match the current reference-pose production lane');
  assert.equal(skeleton.runtimeMode, 'reference-pose-skeleton', 'U001 runtime mode drift');
  assert.equal(skeleton.framePolicy, 'one-approved-key-pose-per-state; no-fabricated-frames', 'U001 must reject fabricated pose claims');
  assert.deepEqual(skeleton.canvas, { width: 512, height: 512, pivot: { x: 0.5, y: 0.12 } }, 'U001 canvas contract drift');

  const boneNames = new Set();
  assert.equal(Array.isArray(skeleton.bones) && skeleton.bones.length === 9, true, 'U001 must ship the approved nine-bone hierarchy');
  skeleton.bones.forEach((bone, index) => {
    assert.match(bone.name, /^[a-z][a-zA-Z0-9]*$/, `bone ${index} name must be stable`);
    assert.equal(boneNames.has(bone.name), false, `bone ${bone.name} must be unique`);
    if (index === 0) {
      assert.equal(bone.name, 'root', 'root must be first');
      assert.equal('parent' in bone, false, 'root must not declare a parent');
    } else {
      assert.equal(boneNames.has(bone.parent), true, `${bone.name} must point at an earlier parent`);
    }
    boneNames.add(bone.name);
  });
  assert.equal(boneNames.has('shield') && boneNames.has('blade'), true, 'U001 must keep dedicated shield and blade bones');

  assert.deepEqual(
    skeleton.attachments,
    [
      { name: 'frontPose', bone: 'root', source: 'cutoutSheet', sourceRect: { x: 0, y: 0, width: 384, height: 512 }, width: 384, height: 512 },
      { name: 'sidePose', bone: 'torso', source: 'cutoutSheet', sourceRect: { x: 384, y: 0, width: 768, height: 512 }, width: 768, height: 512 },
      { name: 'rearPose', bone: 'root', source: 'cutoutSheet', sourceRect: { x: 1152, y: 0, width: 384, height: 512 }, width: 384, height: 512 },
      { name: 'rigPose', bone: 'torso', source: 'cutoutSheet', sourceRect: { x: 384, y: 512, width: 768, height: 512 }, width: 768, height: 512 }
    ],
    'U001 attachments must keep the approved front/side/rear/rig atlas layout'
  );

  const mountMap = new Map(skeleton.mountPoints.map((mount) => [mount.name, mount]));
  assert.deepEqual([...mountMap.keys()].sort(), Object.keys(EXPECTED_MOUNTS).sort(), 'mount names drift');
  for (const [name, semantics] of Object.entries(EXPECTED_MOUNTS)) {
    const mount = mountMap.get(name);
    assert.equal(mount.bone, semantics.bone, `${name} must stay on the approved bone`);
    assert.equal(Number.isInteger(mount.x) && mount.x >= semantics.x[0] && mount.x <= semantics.x[1], true, `${name}.x semantic bounds drift`);
    assert.equal(Number.isInteger(mount.y) && mount.y >= semantics.y[0] && mount.y <= semantics.y[1], true, `${name}.y semantic bounds drift`);
  }

  assert.deepEqual(skeleton.orientations, {
    player: { direction: -1, scaleX: -1 },
    enemy: { direction: 1, scaleX: 1 }
  }, 'player/enemy mirror mapping drift');

  assert.deepEqual(Object.keys(skeleton.stateMap), REQUIRED_ACTIONS, 'stateMap keys drift');
  assert.deepEqual(Object.keys(skeleton.animations), REQUIRED_ACTIONS, 'animation keys drift');
  for (const actionName of REQUIRED_ACTIONS) {
    assert.deepEqual(skeleton.stateMap[actionName], { source: 'poseSheet', poseIndex: REQUIRED_ACTIONS.indexOf(actionName) }, `${actionName} state map drift`);
    validateAnimation(actionName, skeleton.animations[actionName], boneNames);
  }

  assert.equal(skeleton.animations.Idle.loop, true, 'Idle must loop');
  assert.equal(skeleton.animations.Move.loop, true, 'Move must loop');
  for (const actionName of ['Attack', 'Hit', 'Death']) {
    assert.equal(skeleton.animations[actionName].loop, false, `${actionName} must not loop`);
  }
  assert.equal(skeleton.animations.Move.tracks.some((track) => track.bone === 'root' && ['translateX', 'translateY'].includes(track.property)), false, 'Move must leave root translation to runtime battle logic');
  assert.equal(skeleton.animations.Attack.events.some((event) => event.name === 'impact' && event.time > 0 && event.time < skeleton.animations.Attack.duration), true, 'Attack must emit an in-window impact event');
  assert.equal(skeleton.animations.Hit.events.some((event) => event.name === 'hit'), true, 'Hit must expose a hit event');
  assert.equal(skeleton.animations.Death.events.some((event) => event.name === 'despawn' && event.time === skeleton.animations.Death.duration), true, 'Death must despawn on its final frame');
}

function expectFailure(label, mutator, pattern) {
  const broken = structuredClone(readSkeleton());
  mutator(broken);
  assert.throws(() => {
    validateSkeleton(broken);
    validateImages(broken);
  }, pattern, label);
}

function expectAssertion(label, fn, pattern) {
  assert.throws(fn, pattern, label);
}

const { unit, card } = readUnitIdentity();
validateIdentity(unit, card);
const skeleton = readSkeleton();
validateSkeleton(skeleton);
validateImages(skeleton);

expectFailure('missing Hit animation', (broken) => { delete broken.animations.Hit; }, /animation keys drift|must define/);
expectFailure('attack origin outside semantic range', (broken) => { broken.mountPoints.find((mount) => mount.name === 'attackOrigin').x = 160; }, /attackOrigin\.x semantic bounds drift/);
expectFailure('pose sheet hash drift', (broken) => { broken.sources.poseSheet.sha256 = 'deadbeef'; }, /poseSheet manifest hash drift/);
expectAssertion('political faction regression', () => {
  const tamperedUnits = structuredClone(JSON.parse(readFileSync(resolve(clientRoot, 'assets/resources/config/units.json'), 'utf8')));
  tamperedUnits.units.find((entry) => entry.id === 'U001').politicalFaction = 'NONE';
  const fake = tamperedUnits.units.find((entry) => entry.id === 'U001');
  validateIdentity(fake, card);
}, /approved guard baseline/);

console.log('T278 PASS: U001 guard production contract validated against real config, skeleton, PNG bytes, and failure counterexamples');
