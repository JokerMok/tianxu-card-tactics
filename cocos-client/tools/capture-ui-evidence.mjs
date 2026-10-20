import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../../web-prototype/node_modules/playwright');
const baseUrl = process.env.UI_EVIDENCE_URL ?? 'http://127.0.0.1:4193/web/';
const output = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '../../交付/系统界面设计对照版-20260927/actual'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__META_TEST__?.snapshot().page === 'home', { timeout: 30000 });
  const pages = ['home', 'campaign', 'cards', 'deck', 'hero', 'adventure', 'city', 'tasks', 'inventory'];
  for (const name of pages) {
    await page.evaluate(name => globalThis.__META_NAVIGATE__(name), name);
    await page.waitForFunction(name => globalThis.__META_TEST__.snapshot().page === name, name);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
  }
  await page.evaluate(() => globalThis.__META_TEST__.enterBattle(1));
  await page.waitForFunction(() => globalThis.__META_TEST__.snapshot().view === 'battle');
  await page.waitForTimeout(900);
  await page.mouse.click(1085, 770); // close the first-battle story overlay
  await page.waitForTimeout(2400);
  await page.screenshot({ path: path.join(output, 'battle.png') });
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log(`Captured ${pages.length + 1} real Cocos views at 1920x1080: ${output}`);
} finally {
  await browser.close();
}
