import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(process.cwd());
const unitRoot = path.join(projectRoot, 'assets/resources/art/battle/units/U002');
const contractPath = path.join(unitRoot, 'production-contract.json');
const skeletonPath = path.join(unitRoot, 'skeleton.json');
const unitsConfigPath = path.join(projectRoot, 'assets/resources/config/units.json');
const cardsConfigPath = path.join(projectRoot, 'assets/resources/config/cards.json');

const EXPECTED = Object.freeze({
  approvedAt: '2026-08-21',
  productionTask: 'T279',
  unitId: 'U002',
  displayName: '折锋枪兵',
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
    referencePath: '../美术素材/A0/动画关键姿势/U002-ANIMATION-POSES.png',
    sha256: '9507ca351922a5fe6302cbcdaeab4c9711869e40ec1950afd4959caa14f7f81f',
    size: Object.freeze({ width: 1983, height: 793 })
  }),
  cutoutSheet: Object.freeze({
    file: 'U002-CUTOUT-SHEET.png',
    metaFile: 'U002-CUTOUT-SHEET.png.meta',
    resourcePath: 'art/battle/units/U002/U002-CUTOUT-SHEET/spriteFrame',
    referencePath: '../美术素材/A0/单位切片参考/U002-CUTOUT-SHEET.png',
    sha256: '99e057143f1edbdb95235f0ac39057fe5efc3ea2ef3c872b1d3c509e09c7535b',
    size: Object.freeze({ width: 1536, height: 1024 })
  })
});

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
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

function readPngSize(filePath) {
  const bytes = readFileSync(filePath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${filePath} must be a PNG file`);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${filePath} must contain an IHDR chunk`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function assertLocalFile(rootDir, fileName, label) {
  assert.equal(typeof fileName, 'string', `${label} file must be a string`);
  assert.equal(fileName.includes('/'), false, `${label} file must stay in the U002 directory`);
  const filePath = path.join(rootDir, fileName);
  assert.equal(existsSync(filePath), true, `${label} file is missing: ${fileName}`);
  return filePath;
}

function assertRelativeResourcePath(value, expected, label) {
  assert.equal(typeof value, 'string', `${label} resourcePath must be a string`);
  assert.equal(value, expected, `${label} resourcePath must stay frozen`);
  assert.equal(value.startsWith('art/battle/units/U002/'), true, `${label} resourcePath must stay under art/battle/units/U002`);
  assert.equal(value.includes('/a0/'), false, `${label} resourcePath must not reference preview assets`);
  assert.equal(value.includes('..'), false, `${label} resourcePath must not escape its resource root`);
}

function assertReferencePath(value, expected, label) {
  assert.equal(value, expected, `${label} referencePath must preserve its approved upstream source`);
  assert.equal(value.startsWith('../美术素材/A0/'), true, `${label} referencePath must point to the approved A0 upstream art source`);
}

function validatePoseGrid(resource, label) {
  assert.equal(Array.isArray(resource.poseGrid), true, `${label} poseGrid must be an array`);
  assert.equal(resource.poseGrid.length, EXPECTED.requiredActions.length, `${label} poseGrid must expose exactly five actions`);
  let previousEnd = 0;
  for (const [index, pose] of resource.poseGrid.entries()) {
    assert.equal(pose.index, index, `${label} pose index ${index} must remain contiguous`);
    assert.equal(pose.state, EXPECTED.requiredActions[index], `${label} pose order must match Idle/Move/Attack/Hit/Death`);
    assertRecord(pose.rect, `${label} pose rect ${pose.state}`);
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.equal(Number.isInteger(pose.rect[key]), true, `${label} pose rect ${pose.state}.${key} must be an integer`);
    }
    assert.equal(pose.rect.x, previousEnd, `${label} pose rect ${pose.state} must be contiguous`);
    assert.equal(pose.rect.y, 0, `${label} pose rect ${pose.state} must start at y=0`);
    assert.equal(pose.rect.width > 0 && pose.rect.height > 0, true, `${label} pose rect ${pose.state} must stay positive`);
    assert.equal(pose.rect.x + pose.rect.width <= resource.size.width, true, `${label} pose rect ${pose.state} exceeds source width`);
    assert.equal(pose.rect.y + pose.rect.height <= resource.size.height, true, `${label} pose rect ${pose.state} exceeds source height`);
    assert.equal(pose.rect.height, resource.size.height, `${label} pose rect ${pose.state} must cover the full source height`);
    previousEnd = pose.rect.x + pose.rect.width;
  }
  assert.equal(previousEnd, resource.size.width, `${label} poseGrid must cover the full frozen sheet width`);
}

function assertPngAsset(contractResource, expectedResource, skeletonResource, rootDir, label) {
  assertRecord(contractResource, `${label} contract`);
  assertExactKeys(contractResource, ['file', 'kind', 'metaFile', 'referencePath', 'resourcePath', 'sha256', 'size', ...(label === 'poseSheet' ? ['poseGrid'] : [])], `${label} contract`);
  assert.equal(contractResource.file, expectedResource.file, `${label} file name must stay frozen`);
  assert.equal(contractResource.metaFile, expectedResource.metaFile, `${label} metaFile must stay frozen`);
  assertRelativeResourcePath(contractResource.resourcePath, expectedResource.resourcePath, label);
  assertReferencePath(contractResource.referencePath, expectedResource.referencePath, label);
  assert.equal(contractResource.sha256, expectedResource.sha256, `${label} hash must stay frozen`);
  assert.deepEqual(contractResource.size, expectedResource.size, `${label} image size must stay frozen`);

  const localFile = assertLocalFile(rootDir, contractResource.file, label);
  const metaFile = assertLocalFile(rootDir, contractResource.metaFile, `${label} meta`);
  const referenceFile = path.resolve(projectRoot, contractResource.referencePath);
  assert.equal(existsSync(referenceFile), true, `${label} upstream reference file is missing`);
  assert.deepEqual(readPngSize(localFile), expectedResource.size, `${label} local PNG dimensions changed`);
  assert.deepEqual(readPngSize(referenceFile), expectedResource.size, `${label} reference PNG dimensions changed`);
  assert.equal(sha256(localFile), contractResource.sha256, `${label} local PNG hash must match the contract`);
  assert.equal(sha256(referenceFile), contractResource.sha256, `${label} upstream PNG hash must match the contract`);
  assert.equal(metaFile.endsWith('.meta'), true, `${label} meta must end with .meta`);

  assertRecord(skeletonResource, `${label} skeleton source`);
  assert.equal(skeletonResource.sha256, contractResource.sha256, `${label} skeleton source hash must match the production contract`);
  assert.deepEqual(skeletonResource.size, contractResource.size, `${label} skeleton source size must match the production contract`);
  if (label === 'poseSheet') {
    validatePoseGrid(contractResource, label);
    assert.deepEqual(skeletonResource.poseGrid, contractResource.poseGrid, `${label} production pose grid must match the approved skeleton slices`);
  }
}

function validateSkeletalSemantics(contract, skeleton) {
  assert.equal(skeleton.schema, 'battle-unit-skeleton/v1', 'skeleton schema must remain battle-unit-skeleton/v1');
  assert.equal(skeleton.contractVersion, '2.2', 'skeleton contractVersion must remain 2.2');
  assert.equal(skeleton.unitId, EXPECTED.unitId, 'skeleton unitId must remain U002');
  assert.deepEqual(contract.runtime.requiredActions, EXPECTED.requiredActions, 'production contract actions must stay frozen');
  assert.deepEqual(Object.keys(skeleton.stateMap), EXPECTED.requiredActions, 'skeleton stateMap keys must stay frozen');
  assert.deepEqual(Object.keys(skeleton.animations), EXPECTED.requiredActions, 'skeleton animations keys must stay frozen');

  for (const action of EXPECTED.requiredActions) {
    assert.equal(skeleton.stateMap[action].source, 'poseSheet', `${action} stateMap must still reference poseSheet`);
    assert.equal(
      skeleton.stateMap[action].poseIndex,
      contract.resources.poseSheet.poseGrid.find((pose) => pose.state === action).index,
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
}

function validateProductionContract(filePath) {
  const rootDir = unitRoot;
  const contract = readJson(filePath);
  assertRecord(contract, 'production contract');
  assert.equal(contract.schema, 'battle-unit-production-contract/v1', 'contract schema mismatch');
  assert.equal(contract.contractVersion, '2.2', 'contractVersion mismatch');
  assert.equal(contract.unitId, EXPECTED.unitId, 'unitId mismatch');
  assert.equal(contract.resourceRoot, 'assets/resources/art/battle/units/U002', 'resourceRoot must stay frozen');

  const skeletonFile = assertLocalFile(rootDir, contract.runtime?.skeletonFile, 'runtime skeleton');
  const skeleton = readJson(skeletonFile);

  assertPngAsset(contract.resources.poseSheet, EXPECTED.poseSheet, skeleton.sources.poseSheet, rootDir, 'poseSheet');
  assertPngAsset(contract.resources.cutoutSheet, EXPECTED.cutoutSheet, skeleton.sources.cutoutSheet, rootDir, 'cutoutSheet');
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

function runNegativeProbe(name, mutate, pattern) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), `t279-${name}-`));
  try {
    const mutatedPath = path.join(tempDir, 'production-contract.json');
    const contract = readJson(contractPath);
    mutate(contract);
    writeFileSync(mutatedPath, JSON.stringify(contract, null, 2));
    assert.throws(() => validateProductionContract(mutatedPath), pattern, `${name} counterexample must fail`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

validateProductionContract(contractPath);

runNegativeProbe(
  'preview-resource-path',
  (contract) => {
    contract.resources.poseSheet.resourcePath = 'a0/units/U002-ANIMATION-POSES/spriteFrame';
  },
  /resourcePath must stay frozen|must stay under art\/battle\/units\/U002|must not reference preview assets/
);

runNegativeProbe(
  'missing-attack-action',
  (contract) => {
    contract.runtime.requiredActions = ['Idle', 'Move', 'Hit', 'Death'];
  },
  /actions must stay frozen|stateMap keys must stay frozen|animations keys must stay frozen/
);

runNegativeProbe(
  'out-of-bounds-pose',
  (contract) => {
    contract.resources.poseSheet.poseGrid[4].rect.width = 500;
  },
  /exceeds source width|must cover the full frozen sheet width/
);

console.log('T279 PASS: U002 production contract, local PNG resources, skeletal semantics, and negative probes verified.');
