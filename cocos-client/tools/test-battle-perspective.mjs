import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('../../web-prototype/node_modules/playwright');
const url = new URL(process.env.UI_EVIDENCE_URL ?? 'http://127.0.0.1:4193/web/');
url.searchParams.set('animationPilot', 'U002');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

try {
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__META_TEST__?.snapshot().page === 'home');
  await page.evaluate(() => globalThis.__META_TEST__.enterBattle(1));
  await page.waitForTimeout(500);
  await page.mouse.click(1085, 770); // Battle briefing
  await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    view.submit({ type: 'END_TURN' });
  });
  await page.waitForFunction(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return view.state.round > 1 && view.state.activeSide === 'player' && !view.busy;
  }, null, { timeout: 15000 });
  await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    view.submit({ type: 'DEPLOY_UNIT', cardId: 'U002', side: 'player', lane: 0, cell: 0 });
  });
  await page.waitForFunction(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return view.state.units.some(unit => unit.cardId === 'U002' && unit.side === 'player') && !view.busy;
  });
  for (let turn = 0; turn < 10; turn++) {
    const seen = await page.evaluate(() => {
      const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
      return view.state.units.some(unit => unit.cardId === 'U001' && unit.side === 'enemy');
    });
    if (seen) break;
    await page.evaluate(() => {
      const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
      if (view.state.status === 'playing' && view.state.activeSide === 'player' && !view.busy)
        view.submit({ type: 'END_TURN' });
    });
    await page.waitForTimeout(1300);
  }
  await page.waitForFunction(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return view.state.activeSide === 'player' && !view.busy;
  }, null, { timeout: 15000 });
  const scene = await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    const playerCommander = view.staticLayer.getChildByName('playerCommander');
    const enemyCommander = view.staticLayer.getChildByName('enemyCommander');
    const unit = side => {
      const state = view.state.units.find(candidate => candidate.side === side && candidate.cardId === (side === 'enemy' ? 'U001' : 'U002'));
      const visual = state && view.unitDisplays.get(state.id)?.visual;
      const size = visual?.getComponent('cc.UITransform')?.contentSize;
      return { name: visual?.name, width: size?.width, height: size?.height, facing: visual?.scale.x,
        sameFrame: side === 'enemy' ? visual?.getComponent('cc.Sprite')?.spriteFrame === view.previewFrames.get('U001') : undefined };
    };
    const commander = (node, id) => {
      const size = node.getComponent('cc.UITransform').contentSize;
      return { width: size.width, height: size.height, x: node.position.x, y: node.position.y,
        sameFrame: node.getComponent('cc.Sprite').spriteFrame === view.frames.get(`art/battle/heroes/${id}/${id}-SIDE-READY`),
        unitTexture: node.getComponent('cc.Sprite').spriteFrame.texture === view.previewFrames.get('U001').texture };
    };
    const card = view.ui.children.find(node => node.name.startsWith('Card-')).getComponent('cc.UITransform').contentSize;
    return { playerCommander: commander(playerCommander, 'C009'), enemyCommander: commander(enemyCommander, 'C001'),
      playerUnit: unit('player'), enemyUnit: unit('enemy'), card: { width: card.width, height: card.height } };
  });
  assert(scene.playerCommander.sameFrame && scene.enemyCommander.sameFrame, 'Commanders must use their own side-view art');
  assert(!scene.enemyCommander.unitTexture, 'Enemy commander must not reuse the U001 unit texture');
  for (const commander of [scene.playerCommander, scene.enemyCommander]) {
    assert.equal(commander.width, 270);
    assert.equal(commander.height, 270);
    assert.equal(commander.y, 34);
  }
  assert.equal(scene.playerCommander.x, -830);
  assert.equal(scene.enemyCommander.x, 830);
  assert.deepEqual(scene.card, { width: 146, height: 219 }, 'Battle cards keep their independent UI ratio');
  assert.deepEqual([scene.enemyUnit.name, scene.enemyUnit.width, scene.enemyUnit.height, scene.enemyUnit.sameFrame],
    ['U001SidePose', 195, 195, true], 'U001 must use the side-view battle sprite at unit scale');
  assert.equal(scene.playerUnit.name, 'U002SidePose');
  assert.deepEqual([scene.playerUnit.width, scene.playerUnit.height], [220, 220]);
  assert(scene.enemyUnit.facing > 0 && scene.playerUnit.facing > 0, 'Both units must face inward');
  assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
  if (process.env.PERSPECTIVE_SCREENSHOT) await page.screenshot({ path: process.env.PERSPECTIVE_SCREENSHOT });
  console.log(`Battle perspective PASS: U001 195, U002 220, commanders 270, card 146x219, C001 identity, facing inward`);
} finally {
  await browser.close();
}
