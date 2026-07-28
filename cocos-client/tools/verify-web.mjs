import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const requireFromPrototype = createRequire(new URL('../../web-prototype/package.json', import.meta.url));
const { chromium } = requireFromPrototype('playwright');
const baseUrl = process.env.A0_BASE_URL ?? 'http://127.0.0.1:4180';
const headless = process.env.A0_HEADLESS !== 'false';
const artifacts = path.resolve(import.meta.dirname, '../test-artifacts');
await fs.mkdir(artifacts, { recursive: true });

async function measureFrames(page, warmupFrames = 60, sampleFrames = 180) {
  return page.evaluate(({ warmupFrames, sampleFrames }) => new Promise((resolve) => {
    const deltas = [];
    let previous;
    let warmupRemaining = warmupFrames;
    const sample = (now) => {
      if (previous !== undefined && warmupRemaining <= 0) deltas.push(now - previous);
      previous = now;
      if (warmupRemaining > 0) {
        warmupRemaining -= 1;
      }
      if (deltas.length >= sampleFrames) {
        const sorted = [...deltas].sort((a, b) => a - b);
        const average = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
        resolve({ fps: 1000 / average, p95FrameTimeMs: sorted[Math.floor(sorted.length * .95)] });
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), { warmupFrames, sampleFrames });
}

const browser = await chromium.launch({ headless });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent('<!doctype html><title>rAF calibration</title>');
  const environmentFrameSample = await measureFrames(page);
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__A0_METRICS__?.ready === true, null, { timeout: 30000 });
  await page.waitForFunction(() => globalThis.__A0_METRICS__?.assetsReady === true, null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  const initial = await page.evaluate(() => globalThis.__A0_METRICS__);
  assert.equal(initial.lanes, 2);
  assert.equal(initial.cells, 24);
  assert.equal(initial.legalDeploymentCells, 6);
  assert.equal(initial.commanders, 2);
  assert.equal(initial.commandersOutsideGrid, true);
  assert(initial.commanderCenterErrorPx <= 2);
  assert.equal(initial.loadedVisualAssets, 9);
  assert.equal(initial.previewPoseAssets, 2);
  assert.equal(initial.spineAssets, 0);
  assert.equal(initial.artMode, 'preview-pose');
  assert.equal(initial.artIntegrationComplete, false);
  assert.equal(initial.runtimeUnitSprites, 2);
  assert.equal(initial.stressRenderer, 'individual-sprites');
  assert.equal(initial.unitMotion, 'idle-breathing');
  assert.equal(initial.selectedCard, -1);
  assert.equal(initial.activeDeploymentMarkers, 0);
  const idlePhaseSamples = [];
  for (let sample = 0; sample < 10; sample += 1) {
    idlePhaseSamples.push(await page.evaluate(() => globalThis.__A0_IDLE_PHASE__()));
    await page.waitForTimeout(90);
  }
  assert(idlePhaseSamples.every(Number.isFinite), 'idle breathing state is unavailable');
  assert(Math.max(...idlePhaseSamples) - Math.min(...idlePhaseSamples) >= 2, 'idle breathing motion is not running');
  const initialScreenshotPath = path.join(artifacts, 'BattleA0-art-integration-1920x1080.png');
  await page.screenshot({ path: initialScreenshotPath });
  const baselineFrameSample = await measureFrames(page);

  await page.evaluate(() => globalThis.__A0_SELECT_CARD__(0));
  await page.waitForFunction(() => globalThis.__A0_METRICS__?.activeDeploymentMarkers === 6);
  await page.evaluate(() => globalThis.__A0_DEPLOY__(1, 0));
  await page.waitForFunction(() => globalThis.__A0_METRICS__?.activeUnits === 3);
  assert.equal(await page.evaluate(() => globalThis.__A0_METRICS__?.selectedCard), -1);
  assert.equal(await page.evaluate(() => globalThis.__A0_METRICS__?.activeDeploymentMarkers), 0);

  await page.evaluate(() => globalThis.__A0_ENABLE_STRESS__());
  await page.waitForFunction(() => globalThis.__A0_METRICS__?.activeUnits === 24);
  await page.waitForTimeout(1000);
  await page.evaluate(() => globalThis.__A0_TRIGGER_HIT__());
  await page.waitForFunction(() => globalThis.__A0_METRICS__?.enemyHp === 3300);
  const final = await page.evaluate(() => globalThis.__A0_METRICS__);
  const canvas = await page.locator('canvas').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, bufferWidth: node.width, bufferHeight: node.height };
  });
  const stressFrameSample = await measureFrames(page);
  assert.equal(final.activeUnits, 24);
  assert.equal(final.runtimeUnitSprites, 24);
  assert.equal(final.stressRenderer, 'individual-sprites');
  assert.equal(final.unitMotion, 'idle-breathing');
  assert.equal(final.hitCount, 1);
  assert.equal(errors.length, 0, errors.join('\n'));
  assert(await page.locator('canvas').count() > 0, 'Cocos canvas is missing');
  assert(canvas.width >= 1918 && canvas.height >= 1078, 'Cocos canvas does not fill the 1920x1080 viewport');
  assert(Math.abs(canvas.width / canvas.height - 16 / 9) < 0.01, 'Cocos canvas is not 16:9');
  const absolutePerformancePass = stressFrameSample.fps >= 55 && stressFrameSample.p95FrameTimeMs <= 22;
  const relativePerformancePass = stressFrameSample.fps >= baselineFrameSample.fps * .9
    && stressFrameSample.p95FrameTimeMs <= Math.max(22, baselineFrameSample.p95FrameTimeMs * 1.25);
  if (process.env.REQUIRE_ABSOLUTE_PERF === '1') {
    assert(absolutePerformancePass, `absolute performance gate failed: ${stressFrameSample.fps.toFixed(1)} FPS, P95 ${stressFrameSample.p95FrameTimeMs.toFixed(1)}ms`);
  }

  const screenshotPath = path.join(artifacts, 'BattleA0-1920x1080.png');
  await page.screenshot({ path: screenshotPath });
  const result = {
    initial,
    final,
    canvas,
    headless,
    environmentFrameSample,
    baselineFrameSample,
    stressFrameSample,
    relativePerformancePass,
    absolutePerformancePass,
    initialScreenshotPath,
    screenshotPath,
  };
  await fs.writeFile(path.join(artifacts, 'BattleA0-performance.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!headless || process.env.REQUIRE_RELATIVE_PERF === '1') {
    assert(relativePerformancePass, '24-unit stress mode exceeded the relative performance budget');
  }
} finally {
  await browser.close();
}
