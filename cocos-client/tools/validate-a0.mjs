import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/a0-manifest.json'), 'utf8'));
const scene = JSON.parse(fs.readFileSync(path.join(root, 'assets/scenes/BattleA0.scene'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'assets/scripts/a0/BattleA0Bootstrap.ts'), 'utf8');

assert.equal(manifest.engine, 'Cocos Creator 3.8.8');
assert.deepEqual(manifest.designResolution, [1920, 1080]);
assert.equal(manifest.board.lanes * manifest.board.cellsPerLane, 24);
assert.equal(manifest.board.summonDepth * manifest.board.lanes, 6);
assert.equal(manifest.board.cellOccupancyLimit, 1);
assert.equal(manifest.commanders.count, 2);
assert.equal(manifest.commanders.fixedOutsideGrid, true);
assert.equal(manifest.commanders.preserveSourceAspectRatio, true);
assert.equal(manifest.stress.units, 24);
assert.equal(manifest.stress.minimumFps, 55);
assert.equal(manifest.stress.maximumP95FrameTimeMs, 22);
assert.deepEqual(manifest.commanders.animationContract, ['Idle', 'HitLight', 'HitHeavy', 'Command', 'Critical', 'Defeat']);
assert.equal(manifest.runtimeArt.mode, 'preview-pose');
assert.equal(manifest.runtimeArt.integrated.length, 9);
assert.equal(manifest.runtimeArt.spineAssets, 0);
assert.equal(manifest.runtimeArt.finalAnimationReady, false);
assert.equal(manifest.metaGame.status, 'playable-shell');
assert.equal(manifest.metaGame.modules.length, 9);
assert.deepEqual(manifest.metaGame.battleContexts, ['campaign', 'dungeon', 'tower', 'boss']);
assert.equal(manifest.metaGame.rewardIdempotency, true);
for (const file of [
  'assets/resources/a0/background/E104-PARALLAX-BOARD.png',
  'assets/resources/a0/units/U002-ANIMATION-POSES.png',
  'assets/resources/a0/units/U008-ANIMATION-POSES.png',
  'assets/resources/a0/cards/U001-CARD-THUMB.webp',
  'assets/resources/a0/cards/U002-CARD-THUMB.webp',
  'assets/resources/a0/cards/U004-CARD-THUMB.webp',
  'assets/resources/a0/cards/U008-CARD-THUMB.webp',
  'assets/resources/a0/commanders/C001-CARD-LARGE.webp',
  'assets/resources/a0/commanders/C009-CARD-LARGE.webp',
  'assets/resources/a0/commanders/C001-BATTLE-SIDESLOT.png',
  'assets/resources/a0/commanders/C009-BATTLE-SIDESLOT.png',
]) assert(fs.existsSync(path.join(root, file)), `missing runtime art: ${file}`);
assert(scene.some((entry) => entry.__type__ === '98dcdQl8GhEYLJRG8ap+Eh+'), 'BattleA0Bootstrap is not attached to the scene');
assert(source.includes('CELLS_PER_LANE = 12'));
assert(source.includes('SUMMON_DEPTH = 3'));
assert(source.includes('STRESS_UNIT_COUNT = 24'));
assert(source.includes("C009-BATTLE-SIDESLOT/spriteFrame"));
assert(source.includes("C001-BATTLE-SIDESLOT/spriteFrame"));
assert(source.includes('displayWidth = displayHeight * source.texture.width / source.texture.height'));
assert(source.includes('new GameShell(this.node, this.root,this.campaignView)'));
assert(source.includes('await this.campaignView.load()'));
assert(!source.includes('this.enemyHp - 300'));
assert(!source.includes('__META_BATTLE_COMPLETE__?.(true)'));

console.log('Legacy A0 assets retained; scene uses campaign entry: PASS');
