import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const requireFromPrototype = createRequire(new URL('../../web-prototype/package.json', import.meta.url));
const { chromium } = requireFromPrototype('playwright');

const root = path.resolve(import.meta.dirname, '..');
const referenceRoot = path.resolve(root, '../美术素材/UI全界面/Image2-v1-1920');
const screenshotRoot = path.join(root, 'test-artifacts/meta');
const outputPath = path.join(screenshotRoot, 'image2-1920-visual-audit.json');
const pairs = [
  ['home', '12-home.png', 'UI01-主城.png'],
  ['campaign', '04-campaign.png', 'UI02-征战.png'],
  ['cards', '05-cards.png', 'UI03-卡库.png'],
  ['deck', '06-deck.png', 'UI04-编队.png'],
  ['hero', '07-hero.png', 'UI05-主将.png'],
  ['adventure', '08-adventure.png', 'UI06-历练.png'],
  ['city', '09-city.png', 'UI07-营造.png'],
  ['tasks', '10-tasks.png', 'UI08-任务.png'],
  ['inventory', '11-inventory.png', 'UI09-行囊.png'],
];

const results = [];
const browser = await chromium.launch({ headless: true });
try {
  const browserPage = await browser.newPage();
  for (const [page, screenshotName, referenceName] of pairs) {
    const [screenshotPng, referencePng] = await Promise.all([
      fs.readFile(path.join(screenshotRoot, screenshotName)),
      fs.readFile(path.join(referenceRoot, referenceName)),
    ]);
    const metrics = await browserPage.evaluate(async ([screenshotUrl, referenceUrl]) => {
      const decode = async (url) => createImageBitmap(await (await fetch(url)).blob());
      const [screenshot, reference] = await Promise.all([decode(screenshotUrl), decode(referenceUrl)]);
      if (screenshot.width !== reference.width || screenshot.height !== reference.height) throw new Error('image dimensions differ');
      const pixelsFor = (bitmap) => {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const actual = pixelsFor(screenshot);
      const expected = pixelsFor(reference);
      let absolute = 0;
      let squared = 0;
      let over4 = 0;
      let max = 0;
      const bias = [0, 0, 0];
      for (let index = 0; index < actual.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          const delta = actual[index + channel] - expected[index + channel];
          const difference = Math.abs(delta);
          absolute += difference;
          squared += delta * delta;
          if (difference > 4) over4 += 1;
          if (difference > max) max = difference;
          bias[channel] += delta;
        }
      }
      const pixels = screenshot.width * screenshot.height;
      const channels = pixels * 3;
      return {
        mae: absolute / channels,
        rmse: Math.sqrt(squared / channels),
        channelsOver4Pct: (over4 / channels) * 100,
        max,
        meanBiasRGB: bias.map((value) => value / pixels),
      };
    }, [
      `data:image/png;base64,${screenshotPng.toString('base64')}`,
      `data:image/png;base64,${referencePng.toString('base64')}`,
    ]);
    results.push({ page, ...metrics });
  }
} finally {
  await browser.close();
}

await fs.writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`);
const exact = results.every((item) => item.mae === 0 && item.max === 0);
console.log(`Image2 native 1920x1080 static pixel audit: ${exact ? 'PASS' : 'FAIL'}`);
if (!exact) process.exitCode = 1;
