import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('../../web-prototype/node_modules/playwright');
const url = new URL(process.env.UI_EVIDENCE_URL ?? 'http://127.0.0.1:4193/web/');
url.searchParams.set('battleReview', 'two-lanes');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

const viewState = () => page.evaluate(() => {
  const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
  return { round: view.state.round, side: view.state.activeSide, busy: view.busy,
    seed: view.session.record.seed, laneCount: view.state.laneCount,
    ready: view.state.hands.player.filter(card => card.remainingPreparation === 0).map(card => card.cardId),
    units: view.state.units.map(unit => ({ id: unit.id, cardId: unit.cardId, side: unit.side, lane: unit.lane, cell: unit.cell })) };
});
const center = name => page.evaluate(name => {
  const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
  const node = view.ui.children.find(child => child.name.startsWith('Card-') && child.name === name) ??
    view.boardLayer.getChildByName(name);
  if (!node) throw new Error(`Missing clickable node ${name}`);
  const box = node.getComponent('cc.UITransform').getBoundingBoxToWorld();
  return { x: box.x + box.width / 2, y: 1080 - box.y - box.height / 2 };
}, name);
const cardName = id => page.evaluate(id => {
  const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
  const card = view.state.hands.player.find(card => card.cardId === id && card.remainingPreparation === 0);
  if (!card) throw new Error(`${id} not ready in real hand`);
  return `Card-${card.instanceId}`;
}, id);
const endTurn = async round => {
  await page.mouse.click(960, 65);
  await page.waitForFunction(oldRound => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return view.state.round > oldRound && view.state.activeSide === 'player' && !view.busy;
  }, round, { timeout: 20000 });
};

try {
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__META_TEST__?.snapshot().page === 'home');
  await page.evaluate(() => globalThis.__META_TEST__.enterBattle(1));
  await page.waitForTimeout(500);
  await page.mouse.click(1085, 770); // briefing
  let state = await viewState();
  assert.equal(state.seed, 1104, 'Explicit review URL must have deterministic cards');
  await endTurn(state.round);
  state = await viewState();
  assert(state.ready.includes('U002'), 'U002 must be ready for upper row');
  await page.mouse.click(...Object.values(await center(await cardName('U002'))));
  await page.mouse.click(...Object.values(await center('Target-0-2')));
  await page.waitForFunction(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return !view.busy && view.state.laneCount === 2 && view.state.units.some(unit => unit.side === 'player' && unit.lane === 0);
  });
  state = await viewState();
  await endTurn(state.round);
  state = await viewState();
  assert(state.ready.includes('U001'), 'U001 must be ready for lower row');
  await page.mouse.click(...Object.values(await center(await cardName('U001'))));
  const cues = await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return view.boardLayer.children.filter(node => node.name.startsWith('DeployCue-')).map(node => node.name);
  });
  assert(cues.some(name => name.startsWith('DeployCue-0-')) && cues.some(name => name.startsWith('DeployCue-1-')),
    `Both rows need legal placement cues: ${cues.join(', ')}`);
  if (process.env.TWO_LANE_CUES_SCREENSHOT) await page.screenshot({ path: process.env.TWO_LANE_CUES_SCREENSHOT });
  await page.mouse.click(...Object.values(await center('Target-1-2')));
  await page.waitForFunction(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return !view.busy && [0, 1].every(lane => view.state.units.some(unit => unit.side === 'player' && unit.lane === lane));
  });
  state = await viewState();
  const geometry = await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    const rows = [0, 1].map(lane => {
      const unit = view.state.units.find(unit => unit.side === 'player' && unit.lane === lane);
      const display = view.unitDisplays.get(unit.id);
      return { lane, cardId: unit.cardId, groundScreenY: 540 - display.node.position.y,
        visual: display.visual.name };
    });
    const arena = view.staticLayer.getChildByName('TwoLaneArena');
    return { rows, scene: view.staticLayer.children.map(node => node.name),
      arenaLoaded: arena?.getComponent('cc.Sprite')?.spriteFrame === view.frames.get('art/battle/background/E104-TWO-LANE-MERGED'),
      cardCount: view.ui.children.filter(node => node.name.startsWith('Card-')).length };
  });
  assert.deepEqual(geometry.rows.map(row => row.cardId), ['U002', 'U001']);
  assert.deepEqual(geometry.rows.map(row => row.groundScreenY), [510, 730]);
  assert(geometry.scene.includes('TwoLaneArena') && !geometry.scene.includes('MountainTerrace'), 'The clean two-row scene was not loaded');
  assert(geometry.arenaLoaded, 'The merged stone floor was not preloaded into its live sprite');
  assert(geometry.cardCount > 0, 'Bottom hand disappeared during two-row deployment');
  assert.deepEqual(errors, []);
  if (process.env.TWO_LANE_SCREENSHOT) await page.screenshot({ path: process.env.TWO_LANE_SCREENSHOT });
  if (process.env.TWO_LANE_COMPACT_SCREENSHOT) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: process.env.TWO_LANE_COMPACT_SCREENSHOT });
    assert.deepEqual(errors, []);
  }
  console.log(`Two-row deployment PASS: ${JSON.stringify({ round: state.round, rows: geometry.rows, cues: cues.length, cardCount: geometry.cardCount })}`);
} finally {
  await browser.close();
}
