import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const requireFromPrototype = createRequire(new URL('../../web-prototype/package.json', import.meta.url));
const { chromium } = requireFromPrototype('playwright');
const baseUrl = process.env.A0_BASE_URL ?? 'http://127.0.0.1:4180';
const artifacts = path.resolve(import.meta.dirname, '../test-artifacts/meta');
await fs.mkdir(artifacts, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/?meta-test=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__META_TEST__?.snapshot);
  await page.evaluate(() => globalThis.__META_TEST__.reset());
  await page.waitForFunction(() => globalThis.__META_ART_PAGE__ === 'home');
  await page.waitForTimeout(260);

  const initial = await page.evaluate(() => globalThis.__META_TEST__.snapshot());
  assert.equal(initial.page, 'home');
  assert.equal(initial.view, 'meta');
  assert.equal(initial.state.deck.length, 10);
  assert.equal(initial.state.cards.length, 12);
  await page.screenshot({ path: path.join(artifacts, '01-home.png') });
  await page.mouse.move(1078, 620);
  await page.waitForTimeout(140);
  assert.equal(await page.locator('canvas').evaluate((canvas) => canvas.style.cursor), 'pointer');
  await page.screenshot({ path: path.join(artifacts, '13-home-hover.png') });
  await page.mouse.move(1700, 1000);

  const pages = [
    ['campaign', 282], ['cards', 365], ['deck', 448], ['hero', 528],
    ['adventure', 613], ['city', 694], ['tasks', 779], ['inventory', 863], ['home', 197],
  ];
  for (const [index, [target, screenY]] of pages.entries()) {
    await page.mouse.click(130, screenY);
    await page.waitForFunction((id) => globalThis.__META_TEST__.snapshot().page === id, target);
    await page.waitForFunction((id) => globalThis.__META_ART_PAGE__ === id, target);
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(artifacts, `${String(index + 4).padStart(2, '0')}-${target}.png`) });
  }
  await page.mouse.click(1078, 620);
  await page.waitForFunction(() => globalThis.__META_TEST__.snapshot().page === 'campaign');
  await page.waitForFunction(() => globalThis.__META_ART_PAGE__ === 'campaign');
  await page.waitForTimeout(260);

  await page.mouse.click(390, 620);
  await page.waitForFunction(() => globalThis.__META_TEST__.snapshot().state.campaign.selectedStage === 1);
  await page.waitForFunction(() => globalThis.__META_TEST__.snapshot().dynamicOverlays.includes('LiveStage'));
  await page.screenshot({ path: path.join(artifacts, '14-campaign-selected.png') });

  await page.mouse.click(130, 365);
  await page.waitForFunction(() => globalThis.__META_ART_PAGE__ === 'cards');
  await page.waitForTimeout(260);
  await page.mouse.click(594, 415);
  await page.waitForFunction(() => globalThis.__META_TEST__.snapshot().selectedCard === 'U004');
  await page.waitForFunction(() => globalThis.__META_TEST__.snapshot().dynamicOverlays.includes('LiveCardName'));
  await page.screenshot({ path: path.join(artifacts, '15-cards-selected.png') });

  await page.mouse.click(130, 528);
  await page.waitForFunction(() => globalThis.__META_ART_PAGE__ === 'hero');
  await page.mouse.move(1480, 370);
  await page.waitForTimeout(120);
  assert.equal(await page.locator('canvas').evaluate((canvas) => canvas.style.cursor), 'pointer');
  await page.mouse.click(1480, 370);

  await page.mouse.click(130, 863);
  await page.waitForFunction(() => globalThis.__META_ART_PAGE__ === 'inventory');
  await page.mouse.move(565, 430);
  await page.waitForTimeout(120);
  assert.equal(await page.locator('canvas').evaluate((canvas) => canvas.style.cursor), 'pointer');
  await page.mouse.click(565, 430);

  await page.evaluate(() => globalThis.__META_TEST__.reset());
  await page.waitForFunction(() => globalThis.__META_ART_PAGE__ === 'home');
  await page.waitForTimeout(260);
  await page.evaluate(() => globalThis.__META_NAVIGATE__('campaign'));
  await page.waitForFunction(() => globalThis.__META_ART_PAGE__ === 'campaign');
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(artifacts, '02-campaign.png') });
  await page.evaluate(() => globalThis.__META_NAVIGATE__('cards'));
  await page.waitForFunction(() => globalThis.__META_ART_PAGE__ === 'cards');
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(artifacts, '03-cards.png') });

  const beforeBattle = await page.evaluate(() => globalThis.__META_TEST__.snapshot());
  await page.evaluate(() => globalThis.__META_TEST__.enterBattle(1));
  const duringBattle = await page.evaluate(() => globalThis.__META_TEST__.snapshot());
  assert.equal(duringBattle.view, 'battle');
  assert.equal(duringBattle.state.resources.stamina, beforeBattle.state.resources.stamina - 6);
  await page.evaluate(() => globalThis.__META_TEST__.finishBattle(true));
  const afterBattle = await page.evaluate(() => globalThis.__META_TEST__.snapshot());
  assert.equal(afterBattle.view, 'meta');
  assert.equal(afterBattle.page, 'campaign');
  assert(afterBattle.state.resources.silver > beforeBattle.state.resources.silver);
  assert.equal(afterBattle.state.tasks.stage.progress, 4);

  const towerTicket = afterBattle.state.resources.towerTicket;
  const towerFloor = afterBattle.state.tower.floor;
  await page.evaluate(() => globalThis.__META_TEST__.enterBattle(8, 'tower'));
  assert.equal((await page.evaluate(() => globalThis.__META_TEST__.snapshot())).state.resources.towerTicket, towerTicket - 1);
  await page.evaluate(() => globalThis.__META_TEST__.finishBattle(true));
  const afterTower = await page.evaluate(() => globalThis.__META_TEST__.snapshot());
  assert.equal(afterTower.page, 'adventure');
  assert.equal(afterTower.state.tower.floor, towerFloor + 1);
  assert.equal(afterTower.state.campaign.unlocked, afterBattle.state.campaign.unlocked);

  const beforeClaim = afterTower.state.resources.silver;
  assert.equal(await page.evaluate(() => globalThis.__META_TEST__.claimTask('stage')), true);
  assert.equal(await page.evaluate(() => globalThis.__META_TEST__.claimTask('stage')), false);
  const afterClaim = await page.evaluate(() => globalThis.__META_TEST__.snapshot());
  assert.equal(afterClaim.state.resources.silver, beforeClaim + 1200);
  await page.evaluate(() => globalThis.__META_NAVIGATE__('tasks'));
  await page.waitForFunction(() => globalThis.__META_ART_PAGE__ === 'tasks');
  await page.waitForFunction(() => globalThis.__META_TEST__.snapshot().dynamicOverlays.includes('LiveTask-stage'));
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(artifacts, '16-tasks-dynamic.png') });

  const beforeUpgrade = afterClaim.state.resources.silver;
  assert.equal(await page.evaluate(() => globalThis.__META_TEST__.upgradeCard('U002')), true);
  const afterUpgrade = await page.evaluate(() => globalThis.__META_TEST__.snapshot());
  assert.equal(afterUpgrade.state.cards.find((card) => card.id === 'U002').level, 2);
  assert.equal(afterUpgrade.state.resources.silver, beforeUpgrade - 500);
  await page.evaluate(() => globalThis.__META_NAVIGATE__('cards'));
  await page.waitForFunction(() => globalThis.__META_ART_PAGE__ === 'cards');
  await page.waitForFunction(() => globalThis.__META_TEST__.snapshot().dynamicOverlays.includes('LiveCardStats'));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__META_TEST__?.snapshot);
  const persisted = await page.evaluate(() => globalThis.__META_TEST__.snapshot());
  assert.equal(persisted.state.cards.find((card) => card.id === 'U002').level, 2);
  assert.equal(persisted.state.tasks.stage.claimed, true);
  await page.evaluate(() => globalThis.__META_TEST__.reset());
  const resetState = await page.evaluate(() => globalThis.__META_TEST__.snapshot());
  assert.equal(resetState.state.cards.find((card) => card.id === 'U002').level, 1);
  assert.equal(resetState.state.cards.find((card) => card.id === 'U002').copies, 3);
  assert.equal(errors.length, 0, errors.join('\n'));

  const result = { initial, afterBattle, afterClaim, afterUpgrade, persisted, pages: pages.map(([id]) => id), errors };
  await fs.writeFile(path.join(artifacts, 'meta-verification.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log('Meta-game navigation, battle loop, rewards, idempotency and persistence: PASS');
} finally {
  await browser.close();
}
