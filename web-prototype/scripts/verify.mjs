import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const outputDir = path.resolve('artifacts');
await mkdir(outputDir, { recursive: true });

const cases = [
  { name: 'A-1280x720', variant: 'A', width: 1280, height: 720, flow: 'unit' },
  { name: 'A-1366x768', variant: 'A', width: 1366, height: 768, flow: 'auto' },
  { name: 'A-1672x1084', variant: 'A', width: 1672, height: 1084, flow: 'skill' },
  { name: 'A-1920x1080', variant: 'A', width: 1920, height: 1080, flow: 'surrender' },
  { name: 'A-844x390', variant: 'A', width: 844, height: 390 },
  { name: 'A-932x430', variant: 'A', width: 932, height: 430, flow: 'unit' },
  { name: 'B-1280x720', variant: 'B', width: 1280, height: 720 },
  { name: 'C-932x430', variant: 'C', width: 932, height: 430 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pageMetrics() {
  const stage = document.querySelector('.battlefield-shell')?.getBoundingClientRect();
  const board = document.querySelector('[data-testid="battlefield"]')?.getBoundingClientRect();
  const playerCommander = document.querySelector('[data-testid="battlefield-commander-player"]')?.getBoundingClientRect();
  const enemyCommander = document.querySelector('[data-testid="battlefield-commander-enemy"]')?.getBoundingClientRect();
  const cell = document.querySelector('[data-testid="cell-0-0"]')?.getBoundingClientRect();
  const cards = [...document.querySelectorAll('.ready-card')].map((node) => node.getBoundingClientRect());
  const upperCells = [...document.querySelectorAll('[data-testid="lane-0"] .battle-cell')]
    .map((node) => node.getBoundingClientRect());
  const lowerCells = [...document.querySelectorAll('[data-testid="lane-1"] .battle-cell')]
    .map((node) => node.getBoundingClientRect());
  const gridAligned = upperCells.length === 12 && lowerCells.length === 12 && upperCells.every((upper, index) => (
    Math.abs(upper.x - lowerCells[index].x) <= 1
    && Math.abs(upper.width - lowerCells[index].width) <= 1
  ));
  const laneHeightDelta = upperCells.length > 0 && lowerCells.length > 0
    ? Math.abs(upperCells[0].height - lowerCells[0].height)
    : Number.POSITIVE_INFINITY;
  const boardCenterY = board ? board.top + board.height / 2 : 0;
  const commanderCenterDelta = playerCommander && enemyCommander
    ? Math.max(
      Math.abs(playerCommander.top + playerCommander.height / 2 - boardCenterY),
      Math.abs(enemyCommander.top + enemyCommander.height / 2 - boardCenterY),
    )
    : Number.POSITIVE_INFINITY;
  return {
    cells: document.querySelectorAll('.battle-cell').length,
    commanders: document.querySelectorAll('.battlefield-commander').length,
    commandersOutsideGrid: Boolean(
      board && playerCommander && enemyCommander
      && playerCommander.right <= board.left + 1
      && enemyCommander.left >= board.right - 1
    ),
    gridAligned,
    laneHeightDelta,
    commanderCenterDelta,
    surrenderInTopHud: Boolean(document.querySelector('.top-hud .surrender, .center-controls .surrender, .immersive-controls .surrender')),
    surrenderInBottomZone: Boolean(document.querySelector('.bottom-zone .surrender, .ready-hand .surrender, .immersive-hand .surrender')),
    commanderCardsInHand: document.querySelectorAll('.ready-card[data-card-id^="C"]').length,
    overstackedCells: [...document.querySelectorAll('.battle-cell')]
      .filter((node) => node.querySelectorAll(':scope > .unit-token').length > 1).length,
    board: board ? { width: board.width, height: board.height, top: board.top, bottom: board.bottom } : null,
    boardWidthRatio: board ? board.width / window.innerWidth : 0,
    stageWidthRatio: stage ? stage.width / window.innerWidth : 0,
    cell: cell ? { width: cell.width, height: cell.height } : null,
    cardMinWidth: Math.min(...cards.map((rect) => rect.width)),
    cardMinHeight: Math.min(...cards.map((rect) => rect.height)),
    handHeight: document.querySelector('.ready-hand')?.getBoundingClientRect().height ?? 0,
    scrollX: document.documentElement.scrollWidth - window.innerWidth,
    scrollY: document.documentElement.scrollHeight - window.innerHeight,
    nestedButtons: document.querySelectorAll('button button').length,
    errorOverlay: Boolean(document.querySelector('.vite-error-overlay, #webpack-dev-server-client-overlay')),
    bodyTextLength: document.body.innerText.trim().length,
    switcherVisible: Boolean(document.querySelector('.prototype-switcher')),
    enabledReadyWithoutTarget: document.querySelectorAll('.ready-card.is-ready:not(.is-playable):not(:disabled)').length,
    battlefieldLuminance: (() => {
      const value = getComputedStyle(document.querySelector('.battle-lane')).backgroundColor;
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    })(),
    commanderHitSets: [...document.querySelectorAll('.battlefield-commander')]
      .every((node) => node.dataset.animationSet === 'idle hit-light hit-heavy command critical defeat'),
  };
}

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const item of cases) {
    console.log(`VERIFY ${item.name}`);
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto(`${baseUrl}/?variant=${item.variant}`, { waitUntil: 'networkidle' });
    await page.getByTestId('battlefield').waitFor({ state: 'visible' });
    const initial = await page.evaluate(pageMetrics);

    assert(initial.cells === 24, `${item.name}: expected 24 battle cells for 1v1`);
    assert(initial.commanders === 2, `${item.name}: expected two fixed battlefield commanders`);
    assert(initial.commandersOutsideGrid, `${item.name}: a commander overlaps the route grid`);
    assert(initial.gridAligned, `${item.name}: upper and lower lane columns are not aligned`);
    assert(initial.laneHeightDelta <= 1, `${item.name}: upper and lower lane heights differ`);
    assert(initial.commanderCenterDelta <= 2, `${item.name}: a commander is not centered between the two lanes`);
    assert(initial.surrenderInTopHud, `${item.name}: surrender is missing from the top controls`);
    assert(!initial.surrenderInBottomZone, `${item.name}: surrender appears in the bottom interaction zone`);
    assert(initial.commanderCardsInHand === 0, `${item.name}: a commander appeared in the hand`);
    assert(initial.overstackedCells === 0, `${item.name}: more than one unit occupies a cell`);
    assert(initial.battlefieldLuminance >= 82, `${item.name}: battlefield palette is still too dark`);
    assert(initial.commanderHitSets, `${item.name}: commander animation contract is missing`);
    assert(initial.board && initial.board.width > 480 && initial.board.height > 90, `${item.name}: board is too small`);
    assert(initial.cell && initial.cell.width >= 44 && initial.cell.height >= 44, `${item.name}: battle cells are below 44px`);
    assert(initial.cardMinWidth >= 44 && initial.cardMinHeight >= 44, `${item.name}: card target is below 44px`);
    assert(initial.handHeight >= 44, `${item.name}: ready hand has no interactive height`);
    assert(initial.scrollX <= 0 && initial.scrollY <= 0, `${item.name}: unexpected page scrolling`);
    assert(initial.nestedButtons === 0, `${item.name}: nested interactive buttons found`);
    assert(!initial.errorOverlay && initial.bodyTextLength > 0, `${item.name}: blank page or error overlay`);
    assert(!initial.switcherVisible, `${item.name}: prototype switcher should be hidden by default`);
    assert(initial.enabledReadyWithoutTarget === 0, `${item.name}: a ready card without a target remained enabled`);
    if (item.width >= 1440) assert(initial.stageWidthRatio >= 0.9, `${item.name}: large-screen battlefield stage uses too little width`);

    let interaction = null;
    if (item.flow === 'unit') {
      for (let turn = 0; turn < 12; turn += 1) {
        if (await page.locator('.ready-card.is-playable[data-card-id^="U"]').count() > 0) break;
        await page.getByRole('button', { name: '结束回合' }).click();
        await page.waitForFunction(
          () => document.querySelector('.round-counter')?.textContent?.includes('我方行动'),
          null,
          { timeout: 5000 },
        );
      }
      assert(
        await page.locator('.ready-card.is-playable[data-card-id^="U"]').count() > 0,
        `${item.name}: no playable unit appeared after 12 manual turns`,
      );
      await page.locator('.ready-card.is-playable[data-card-id^="U"]').first().click();
      await page.locator('.target-prompt').waitFor({ state: 'visible' });
      const promptSpacing = await page.evaluate(() => {
        const prompt = document.querySelector('.target-prompt')?.getBoundingClientRect();
        const hand = document.querySelector('.ready-hand')?.getBoundingClientRect();
        return prompt && hand ? hand.top - prompt.bottom : null;
      });
      assert(promptSpacing !== null && promptSpacing >= -2, `${item.name}: target prompt overlaps the hand`);
      const focusableCells = await page.locator('.battle-cell[tabindex="0"]').count();
      assert(focusableCells === 6, `${item.name}: expected all six summon cells to be keyboard reachable`);
      await page.locator('.battle-cell.legal-deployment').nth(2).click();
      await page.locator('.unit-token.player').first().waitFor({ state: 'visible' });
      assert(await page.locator('.target-prompt').count() === 0, `${item.name}: target prompt did not close after deployment`);

      const roundBefore = Number(await page.locator('.round-counter b').textContent());
      await page.getByRole('button', { name: '结束回合' }).click();
      await page.waitForFunction(
        () => document.querySelector('.round-counter')?.textContent?.includes('我方行动'),
        null,
        { timeout: 5000 },
      );
      const roundAfter = Number(await page.locator('.round-counter b').textContent());
      assert(roundAfter >= roundBefore, `${item.name}: ending the turn moved the round counter backwards`);
      interaction = { type: 'unit', focusableCells, promptSpacing, roundBefore, roundAfter };
    }

    if (item.flow === 'auto') {
      const unitsBefore = await page.locator('.unit-token.player').count();
      await page.getByRole('button', { name: '当前 1 倍速，点击切换' }).click();
      await page.getByRole('switch', { name: '开启自动托管' }).click();
      await page.waitForFunction(
        ({ before, minimumRound }) => (
          document.querySelectorAll('.unit-token.player').length > before
          && Number(document.querySelector('.round-counter b')?.textContent) >= minimumRound
        ),
        { before: unitsBefore, minimumRound: 5 },
        { timeout: 20000 },
      );
      const unitsAfter = await page.locator('.unit-token.player').count();
      const automatedRound = Number(await page.locator('.round-counter b').textContent());
      assert(unitsAfter > unitsBefore, `${item.name}: auto-control did not deploy a unit`);
      assert(automatedRound >= 5, `${item.name}: auto-control did not continue across turns`);
      await page.getByRole('switch', { name: '关闭自动托管' }).click();
      await page.waitForFunction(
        () => document.querySelector('.round-counter')?.textContent?.includes('我方行动'),
        null,
        { timeout: 5000 },
      );
      const roundBefore = Number(await page.locator('.round-counter b').textContent());
      await page.waitForTimeout(900);
      const roundAfter = Number(await page.locator('.round-counter b').textContent());
      assert(roundAfter === roundBefore, `${item.name}: auto-control continued after manual takeover`);
      interaction = { type: 'auto', unitsBefore, unitsAfter, automatedRound, roundBefore, roundAfter };
    }

    if (item.flow === 'skill') {
      for (let turn = 0; turn < 36; turn += 1) {
        if (await page.locator('.ready-card.is-playable[data-card-id^="S"]').count() > 0) break;
        const unitCard = page.locator('.ready-card.is-playable[data-card-id^="U"]').first();
        if (await unitCard.count() > 0) {
          await unitCard.click();
          await page.locator('.battle-cell.legal-deployment').first().click();
        }
        await page.getByRole('button', { name: '结束回合' }).click();
        await page.waitForTimeout(850);
        await page.waitForFunction(
          () => document.querySelector('.round-counter')?.textContent?.includes('我方行动'),
          null,
          { timeout: 5000 },
        );
      }
      assert(
        await page.locator('.ready-card.is-playable[data-card-id^="S"]').count() > 0,
        `${item.name}: no playable skill appeared after 36 player turns`,
      );
      await page.locator('.ready-card.is-playable[data-card-id^="S"]').first().click();
      await page.locator('.target-prompt').waitFor({ state: 'visible' });
      const selectedCards = await page.locator('.ready-card.selected').count();
      const legalTargets = await page.locator('.battle-lane.legal-lane, .unit-token.legal-target').count();
      const focusableCells = await page.locator('.battle-cell[tabindex="0"]').count();
      assert(selectedCards === 1, `${item.name}: selected-card state is ambiguous`);
      assert(legalTargets > 0, `${item.name}: selected skill has no visible legal target`);
      assert(focusableCells <= 2, `${item.name}: skill targeting exposes too many keyboard stops`);
      const roundBefore = Number(await page.locator('.round-counter b').textContent());
      await page.waitForTimeout(1000);
      const roundAfter = Number(await page.locator('.round-counter b').textContent());
      assert(roundAfter === roundBefore, `${item.name}: target selection did not hold the action window`);
      interaction = { type: 'skill', selectedCards, legalTargets, focusableCells, roundBefore, roundAfter };
    }

    if (item.flow === 'surrender') {
      await page.getByRole('button', { name: '投降', exact: true }).click();
      await page.getByRole('dialog', { name: '确认投降' }).waitFor({ state: 'visible' });
      assert(await page.locator('.result-scrim').count() === 0, `${item.name}: first surrender click ended the battle`);
      await page.getByRole('button', { name: '取消', exact: true }).click();
      assert(await page.getByRole('dialog', { name: '确认投降' }).count() === 0, `${item.name}: surrender cancel did not close confirmation`);
      assert(await page.locator('.result-scrim').count() === 0, `${item.name}: surrender cancel changed battle status`);
      await page.getByRole('button', { name: '投降', exact: true }).click();
      await page.getByRole('button', { name: '确认投降', exact: true }).click();
      await page.getByRole('dialog', { name: '战斗失败' }).waitFor({ state: 'visible' });
      interaction = { type: 'surrender', firstClickConfirmed: false, cancelKeptPlaying: true, finalStatus: 'lost' };
    }

    await page.waitForTimeout(150);
    const final = await page.evaluate(pageMetrics);
    assert(final.enabledReadyWithoutTarget === 0, `${item.name}: targetless card became enabled after interaction`);
    assert(consoleErrors.length === 0, `${item.name}: console errors: ${consoleErrors.join(' | ')}`);

    const screenshotPath = path.join(outputDir, `${item.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    results.push({ ...item, ...final, interaction, consoleErrors, screenshotPath });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
