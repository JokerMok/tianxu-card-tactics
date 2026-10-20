import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../../web-prototype/node_modules/playwright');
const url = process.env.UI_EVIDENCE_URL ?? 'http://127.0.0.1:4193/web/';
const output = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '../../交付/系统界面设计对照版-20260927/actual/battle-u001-preview.png'));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__META_TEST__?.snapshot().page === 'home');
  await page.evaluate(() => globalThis.__META_TEST__.enterBattle(1));
  await page.waitForTimeout(800);
  await page.mouse.click(1085, 770);
  for (let step = 0; step < 8; step++) {
    const state = await page.evaluate(() => {
      const view = cc.director.getScene().getChildByName('Canvas').getComponent('BattleA0Bootstrap').campaignView;
      return { round: view.state.round, busy: view.busy, side: view.state.activeSide,
        enemyPresent: view.state.units.some(unit => unit.side === 'enemy' && unit.cardId === 'U001'),
        previewPresent: view.previewFrames.has('U001') };
    });
    if (!state.previewPresent) throw new Error('U001 2D preview asset did not load');
    if (state.enemyPresent && !state.busy) {
      await page.screenshot({ path: output });
      console.log(`Captured enemy U001 in a live battle: ${output}`);
      break;
    }
    if (step === 7) throw new Error('Enemy U001 did not appear within eight player turns');
    if (state.side === 'player' && !state.busy) await page.mouse.click(860, 40);
    await page.waitForTimeout(1700);
  }
} finally {
  await browser.close();
}
