import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('../../web-prototype/node_modules/playwright');
const url = process.env.UI_EVIDENCE_URL ?? 'http://127.0.0.1:4193/web/';
const evidenceDir = path.resolve(process.env.UI_EVIDENCE_DIR ?? path.resolve(import.meta.dirname, '../../交付/系统界面设计对照版-20260927/actual'));
mkdirSync(evidenceDir, { recursive: true });
const output = path.join(evidenceDir, 'battle-deployed.png');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const inspect = () => page.evaluate(() => {
  const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
  const state = view.state;
  return {
    status: state.status, round: state.round, side: state.activeSide, busy: view.busy,
    hand: state.hands.player.map(card => ({ id: card.cardId, instance: card.instanceId, prepare: card.remainingPreparation })),
    selected: view.selectedInstance, units: state.units.length, lanes: state.laneCount,
    paused: view.paused, muted: view.muted, dialog: view.modal.children.map(child => child.name),
  };
});
const checkTextLayout = async () => {
  const problems = await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    const ui = view.ui;
    const issues = [];
    const rect = node => {
      const bounds = node.components.find(component => component.constructor.name === 'UITransform')?.getBoundingBoxToWorld();
      if (!bounds) throw new Error(`Missing UITransform: ${node.name}`);
      return { left: bounds.x, right: bounds.x + bounds.width, top: 1080 - bounds.y - bounds.height, bottom: 1080 - bounds.y };
    };
    const within = (node, zone) => {
      const box = rect(node);
      if (box.left < zone.left || box.right > zone.right || box.top < zone.top || box.bottom > zone.bottom)
        issues.push(`${node.name} outside safe zone: ${JSON.stringify(box)}`);
      const text = node.getComponent('cc.Label');
      if (text?.enableWrapText) issues.push(`${node.name} unexpectedly allows wrapping`);
      return box;
    };
    const centeredAt = (node, x, y, tolerance = 2) => {
      const box = rect(node);
      if (Math.abs((box.left + box.right) / 2 - x) > tolerance || Math.abs((box.top + box.bottom) / 2 - y) > tolerance)
        issues.push(`${node.name} not centered on artwork: ${JSON.stringify(box)}`);
      if (node.getComponent('cc.Label')?.enableWrapText) issues.push(`${node.name} unexpectedly allows wrapping`);
    };
    within(ui.getChildByName('Phase'), { left: 805, right: 1115, top: 12, bottom: 50 });
    within(ui.getChildByName('Auto').getChildByName('Caption'), { left: 830, right: 906, top: 44, bottom: 82 });
    within(ui.getChildByName('EndTurn').getChildByName('Caption'), { left: 905, right: 1015, top: 44, bottom: 82 });
    within(ui.getChildByName('Speed').getChildByName('Caption'), { left: 1030, right: 1080, top: 44, bottom: 82 });
    within(ui.getChildByName('playerHero'), { left: 135, right: 335, top: 24, bottom: 65 });
    within(ui.getChildByName('enemyHero'), { left: 1360, right: 1585, top: 24, bottom: 65 });
    // The unframed footer places the deck count beside its enlarged icon.
    centeredAt(ui.getChildByName('DeckCount'), 178, 952);
    centeredAt(ui.getChildByName('DeckValue'), 178, 984);
    centeredAt(ui.getChildByName('Graveyard').getChildByName('Caption'), 178, 1016);
    if (!ui.getChildByName('DeckIcon')?.getComponent('cc.Sprite') ||
        !ui.getChildByName('CombatLog')?.getChildByName('Icon')?.getComponent('cc.Sprite') ||
        !ui.getChildByName('Pause')?.getChildByName('Icon')?.getComponent('cc.Sprite'))
      issues.push('Lower HUD icon sprites missing');
    if (rect(ui.getChildByName('DeckIcon')).right - rect(ui.getChildByName('DeckIcon')).left < 65 ||
        rect(ui.getChildByName('CombatLog').getChildByName('Icon')).right - rect(ui.getChildByName('CombatLog').getChildByName('Icon')).left < 60 ||
        rect(ui.getChildByName('Pause').getChildByName('Icon')).right - rect(ui.getChildByName('Pause').getChildByName('Icon')).left < 65)
      issues.push('Lower HUD icons were not enlarged');
    within(ui.getChildByName('CombatLog').getChildByName('Caption'), { left: 1605, right: 1740, top: 1000, bottom: 1040 });
    within(ui.getChildByName('Pause').getChildByName('Caption'), { left: 1750, right: 1889, top: 1000, bottom: 1040 });
    const hint = within(ui.getChildByName('SelectionHint'), { left: 420, right: 1500, top: 770, bottom: 809 });
    for (const card of ui.children.filter(node => node.name.startsWith('Card-'))) {
      const frame = rect(card.getChildByName('CardFrame'));
      const title = rect(card.getChildByName('CardTitle'));
      const stats = rect(card.getChildByName('Stats'));
      const badge = rect(card.getChildByName('Preparation'));
      for (const name of ['CardTitle', 'Stats', 'Preparation', 'Selected']) {
        const node = card.getChildByName(name);
        if (node?.getComponent('cc.Label')?.enableWrapText) issues.push(`${card.name}/${name} unexpectedly allows wrapping`);
      }
      if (frame.top - hint.bottom < 9) issues.push(`${card.name} crowds selection hint`);
      const inFrame = box => ({ top: (box.top - frame.top) / (frame.bottom - frame.top), bottom: (box.bottom - frame.top) / (frame.bottom - frame.top) });
      const titleBand = inFrame(title), statsBand = inFrame(stats);
      if (titleBand.top < 146 / 219 || titleBand.bottom > 181 / 219 ||
          statsBand.top < 182 / 219 || statsBand.bottom > 204 / 219 || stats.top - title.bottom < 0.9)
        issues.push(`${card.name} title or stats outside card text panels`);
      const badgeCenterX = ((badge.left + badge.right) / 2 - frame.left) / (frame.right - frame.left);
      const badgeCenterY = ((badge.top + badge.bottom) / 2 - frame.top) / (frame.bottom - frame.top);
      if (Math.abs(badgeCenterX - 113 / 971) > 0.02 || Math.abs(badgeCenterY - 115 / 1513) > 0.02)
        issues.push(`${card.name} preparation text misses circular crest`);
      if (frame.bottom > 1060) issues.push(`${card.name} too close to viewport edge`);
    }
    if (view.selectedInstance) {
      const selected = ui.getChildByName(`Card-${view.selectedInstance}`);
      const others = ui.children.filter(node => node.name.startsWith('Card-') && node !== selected);
      if (!selected || !others.length || rect(selected.getChildByName('CardFrame')).top > Math.min(...others.map(node => rect(node.getChildByName('CardFrame')).top)) - 9)
        issues.push('Selected card lacks a clear raised state');
    }
    return issues;
  });
  if (problems.length) throw new Error(`Battle text layout: ${problems.join(' | ')}`);
};
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__META_TEST__?.snapshot().page === 'home');
  await page.evaluate(() => globalThis.__META_TEST__.enterBattle(1));
  await page.waitForTimeout(800);
  const previews = await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return ['U001', 'U002', 'U005', 'U008'].map(id => ({ id, width: view.previewFrames.get(id)?.rect.width ?? 0, height: view.previewFrames.get(id)?.rect.height ?? 0 }));
  });
  if (previews.some(preview => preview.width < 200 || preview.height < 300)) throw new Error(`2D unit preview assets unavailable: ${JSON.stringify(previews)}`);
  const presentation = await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return { board: view.boardLayer.children.map(node => node.name), scenery: view.staticLayer.children.map(node => node.name) };
  });
  if (presentation.board.some(name => name.startsWith('Lane-') || name.startsWith('Cell-')) ||
      presentation.scenery.some(name => name.includes('PortraitFrame') || name.includes('Nameplate')) ||
      !presentation.scenery.includes('playerCommander') || !presentation.scenery.includes('enemyCommander')) {
    throw new Error(`Battlefield still uses framed board or portrait UI: ${JSON.stringify(presentation)}`);
  }
  await page.mouse.click(1085, 770); // briefing: 建立阵线
  await page.waitForFunction(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return !view.busy && view.state.activeSide === 'player' && view.modal.children.length === 0;
  }, { timeout: 15000 });
  await page.screenshot({ path: path.join(evidenceDir, 'battle-ready.png') });
  await checkTextLayout();
  let state = await inspect();
  for (let turn = 0; turn < 7 && !state.hand.some(card => card.prepare === 0 && card.id.startsWith('U')); turn++) {
    await page.mouse.click(960, 65); // center medallion: 结束回合
    await page.waitForFunction(round => {
      const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
      return !view.busy && view.state.activeSide === 'player' && view.state.round > round;
    }, state.round, { timeout: 20000 });
    state = await inspect();
  }
  const index = state.hand.findIndex(card => card.prepare === 0 && card.id.startsWith('U'));
  if (index < 0) throw new Error(`No ready unit card after ${state.round} rounds`);
  const spread = Math.min(146, 1170 / state.hand.length);
  await page.mouse.click(960 + (index - (state.hand.length - 1) / 2) * spread, 985);
  state = await inspect();
  if (state.selected !== state.hand[index].instance) throw new Error('Clicked card was not selected');
  const deploymentArt = await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    const cues = view.boardLayer.children.filter(node => node.name.startsWith('DeployCue-'));
    return { count: cues.length, allSprites: cues.every(node => !!node.getComponent('cc.Sprite') && !node.getComponent('cc.Graphics')) };
  });
  if (deploymentArt.count < 3 || !deploymentArt.allSprites) throw new Error(`Deployment art missing: ${JSON.stringify(deploymentArt)}`);
  await page.screenshot({ path: path.join(evidenceDir, 'battle-deployment-cues.png') });
  await checkTextLayout();
  await page.mouse.click(204, 418); // top lane, first legal summon cell
  await page.waitForFunction(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return view.state.units.some(unit => unit.side === 'player') && view.state.laneCount === 2;
  }, { timeout: 10000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: output });
  await page.mouse.click(1809, 1003); // bottom right: 菜单
  state = await inspect();
  if (!state.paused || !state.dialog.includes('ModalShade')) throw new Error('Pause dialog did not open');
  await page.screenshot({ path: path.join(evidenceDir, 'battle-menu.png') });
  await page.mouse.click(960, 495); // continue battle
  state = await inspect();
  if (state.paused) throw new Error('Pause dialog did not close');
  await page.mouse.click(1809, 1003); // reopen menu
  await page.mouse.click(960, 665); // toggle audio from menu
  state = await inspect();
  if (!state.muted || !state.paused) throw new Error('Audio menu toggle did not apply');
  await page.mouse.click(960, 580); // 玩法说明
  state = await inspect();
  if (!state.paused || !state.dialog.includes('ModalShade')) throw new Error('Help dialog did not open');
  await page.mouse.click(960, 781); // 返回战场
  await page.mouse.click(1809, 1003); // reopen menu
  await page.mouse.click(960, 750); // 退出并返回主城
  state = await inspect();
  if (!state.paused || !state.dialog.includes('ModalShade')) throw new Error('Exit confirmation did not open');
  await page.mouse.click(1129, 682); // confirm exit
  await page.waitForFunction(() => globalThis.__META_TEST__.snapshot().view === 'meta');
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log(`Battle UI interaction PASS: ${state.round} rounds, card select, second lane unlocked, pause/resume, confirmed return`);
} finally {
  await browser.close();
}
