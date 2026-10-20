import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('../../web-prototype/node_modules/playwright');
const url = process.env.UI_EVIDENCE_URL ?? 'http://127.0.0.1:4193/web/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__META_TEST__?.snapshot().page === 'home');
  const initialCopies = await page.evaluate(() => globalThis.__META_TEST__.snapshot().state.cards.find(card => card.id === 'U001').copies);
  await page.evaluate(() => globalThis.__META_TEST__.enterBattle(1));
  await page.waitForTimeout(800);
  await page.mouse.click(1085, 770);
  await page.waitForFunction(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return !view.busy && view.modal.children.length === 0;
  });
  await page.mouse.click(1085, 65); // 2× speed
  await page.mouse.click(840, 65); // auto-play via real UI
  await page.waitForFunction(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return view.state.status !== 'playing' && !view.busy;
  }, null, { timeout: 180000 });
  const result = await page.evaluate(() => {
    const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
    return { status: view.state.status, round: view.state.round, recordPhase: view.session.record.phase,
      dialog: view.modal.children.map(node => node.name), playerHp: view.state.heroHp.player, enemyHp: view.state.heroHp.enemy };
  });
  assert(['won', 'lost'].includes(result.status), JSON.stringify(result));
  assert.equal(result.recordPhase, 'settled');
  assert(result.dialog.includes('ModalShade'), 'Result dialog is missing');
  await page.mouse.click(774, 822); // return home from settlement
  await page.waitForFunction(() => globalThis.__META_TEST__.snapshot().view === 'meta');
  const afterCopies = await page.evaluate(() => globalThis.__META_TEST__.snapshot().state.cards.find(card => card.id === 'U001').copies);
  assert.equal(afterCopies, initialCopies + (result.status === 'won' ? 4 : 0));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__META_TEST__?.snapshot().page === 'home');
  const restoredCopies = await page.evaluate(() => globalThis.__META_TEST__.snapshot().state.cards.find(card => card.id === 'U001').copies);
  assert.equal(restoredCopies, afterCopies, 'Reward did not survive reload');
  assert.equal(errors.length, 0, errors.join(' | '));
  console.log(`Full Cocos UI battle and persisted reward PASS: ${JSON.stringify({ ...result, initialCopies, restoredCopies })}`);
} finally {
  await browser.close();
}
