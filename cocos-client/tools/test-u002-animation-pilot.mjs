import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('../../web-prototype/node_modules/playwright');
const url = process.env.UI_EVIDENCE_URL ?? 'http://127.0.0.1:4193/web/';
const pilotUrl = new URL(url);
pilotUrl.searchParams.set('animationPilot', 'U002');
const screenshot = process.env.U002_PILOT_SCREENSHOT;
const videoDir = process.env.U002_PILOT_VIDEO_DIR;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1920, height: 1080 } } } : {}) });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const viewState = () => page.evaluate(() => {
  const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
  const unit = view.state.units.find(candidate => candidate.cardId === 'U002' && candidate.side === 'player');
  const display = unit && view.unitDisplays.get(unit.id);
  return { round: view.state.round, side: view.state.activeSide, busy: view.busy, status: view.state.status,
    seed: view.session.record.seed, ready: view.state.hands.player.some(card => card.cardId === 'U002' && card.remainingPreparation === 0),
    unitId: unit?.id, visualUuid: display?.visual.uuid, hasPose: !!display?.pose,
    facing: display?.visual.scale.x, poseCount: view.u002Poses.size,
    actions: globalThis.__U002_PILOT_ACTIONS__ ?? [], impacts: globalThis.__U002_PILOT_IMPACTS__ ?? 0,
    impactPoseMatched: globalThis.__U002_PILOT_IMPACT_POSE__ ?? false };
});
try {
  await page.goto(pilotUrl.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__META_TEST__?.snapshot().page === 'home');
  await page.evaluate(() => globalThis.__META_TEST__.enterBattle(1));
  await page.waitForTimeout(500);
  await page.mouse.click(1085, 770); // close the battle briefing
  let state = await viewState();
  assert.equal(state.seed, 27);
  await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    view.submit({ type: 'END_TURN' });
  });
  await page.waitForFunction(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return view.state.round > 1 && view.state.activeSide === 'player' && !view.busy;
  }, null, { timeout: 15000 });
  state = await viewState();
  assert(state.ready, 'U002 did not become ready on the deterministic opening');
  await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    view.submit({ type: 'DEPLOY_UNIT', cardId: 'U002', side: 'player', lane: 0, cell: 0 });
  });
  await page.waitForFunction(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return !view.busy && view.state.units.some(unit => unit.cardId === 'U002' && unit.side === 'player');
  });
  state = await viewState();
  assert(state.hasPose, 'U002 fell back to the old frontal preview');
  assert.equal(state.poseCount, 8, 'U002 side-view poses and attack in-betweens did not all load');
  assert(state.facing > 0, 'Friendly U002 must face screen right');
  const afterRender = await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    view.render();
    const unit = view.state.units.find(unit => unit.cardId === 'U002' && unit.side === 'player');
    return view.unitDisplays.get(unit.id)?.visual.uuid;
  });
  assert.equal(afterRender, state.visualUuid, 'U002 visual was rebuilt on UI refresh');
  const poseSequence = await page.evaluate(async () => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    const unit = view.state.units.find(unit => unit.cardId === 'U002' && unit.side === 'player');
    const display = view.unitDisplays.get(unit.id);
    const frames = [...view.u002Poses.entries()];
    const seen = [];
    const sample = () => {
      const pose = frames.find(([, frame]) => display.pose.spriteFrame === frame)?.[0];
      if (pose && pose !== seen.at(-1)) seen.push(pose);
    };
    const timer = setInterval(sample, 10);
    view.playUnitAction(unit.id, 'Attack', .8);
    await new Promise(resolve => setTimeout(resolve, 850));
    clearInterval(timer);
    sample();
    return { seen, x: display.visual.position.x, y: display.visual.position.y };
  });
  assert(poseSequence.seen.join('>').includes('Windup>Release>Impact>Recover>Ready'),
    `U002 attack transition missed an in-between: ${JSON.stringify(poseSequence)}`);
  assert(Math.abs(poseSequence.x) < 1 && Math.abs(poseSequence.y - 106.25) < 1,
    `U002 did not recover to its idle anchor: ${JSON.stringify(poseSequence)}`);
  await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    const display = view.unitDisplays.get(view.state.units.find(unit => unit.cardId === 'U002' && unit.side === 'player').id);
    globalThis.__U002_PILOT_ACTIONS__ = [];
    globalThis.__U002_PILOT_IMPACTS__ = 0;
    globalThis.__U002_PILOT_IMPACT_POSE__ = false;
    const originalImpact = view.flushImpact.bind(view);
    view.flushImpact = id => {
      if (id === view.state.units.find(unit => unit.cardId === 'U002' && unit.side === 'player')?.id) {
        globalThis.__U002_PILOT_IMPACTS__++;
        globalThis.__U002_PILOT_IMPACT_POSE__ ||= display.pose.spriteFrame === view.u002Poses.get('Impact');
      }
      return originalImpact(id);
    };
    const original = view.playUnitAction.bind(view);
    view.playUnitAction = (id, name, duration) => {
      if (id === view.state.units.find(unit => unit.cardId === 'U002' && unit.side === 'player')?.id)
        globalThis.__U002_PILOT_ACTIONS__.push(name);
      return original(id, name, duration);
    };
    view.speed = 2;
  });
  for (let turn = 0; turn < 12; turn++) {
    state = await viewState();
    if (state.actions.includes('Attack') || !state.unitId || state.status !== 'playing')break;
    if (state.side === 'player' && !state.busy)await page.evaluate(() => {
      const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
      view.submit({ type: 'END_TURN' });
    });
    await page.waitForTimeout(1300);
  }
  state = await viewState();
  assert(state.actions.includes('Move'), `No real movement event: ${JSON.stringify(state)}`);
  assert(state.actions.includes('Attack'), `No real attack event: ${JSON.stringify(state)}`);
  assert(state.impacts > 0 && state.impactPoseMatched, `Attack impact did not align with side-view thrust pose: ${JSON.stringify(state)}`);
  assert.deepEqual(errors, []);
  if (screenshot)await page.screenshot({ path: screenshot });
  console.log(`U002 side-view animation pilot PASS: ${JSON.stringify({ seed: state.seed, round: state.round, visualUuid: state.visualUuid, poseSequence: poseSequence.seen, actions: state.actions, impacts: state.impacts, impactPoseMatched: state.impactPoseMatched })}`);
} finally {
  await context.close();
  await browser.close();
}
