import assert from 'node:assert/strict';
import { runNeutralBattle } from '../assets/scripts/battle/runner/battle-runner.ts';

const GAMES_PER_BATCH = 10_000;
const BATCH_OFFSETS = [300_000, 900_000];
const WILSON_Z = 1.959963984540054;

function wilson95(wins, games) {
  const proportion = wins / games;
  const zSquared = WILSON_Z ** 2;
  const denominator = 1 + zSquared / games;
  const center = (proportion + zSquared / (2 * games)) / denominator;
  const halfWidth = WILSON_Z * Math.sqrt(
    (proportion * (1 - proportion) / games) + (zSquared / (4 * games ** 2)),
  ) / denominator;
  return [center - halfWidth, center + halfWidth];
}

function runBatch(seedOffset) {
  let playerWins = 0;
  let enemyWins = 0;
  const hashes = new Set();
  let first;
  let last;
  for (let index = 0; index < GAMES_PER_BATCH; index += 1) {
    const result = runNeutralBattle(seedOffset + index);
    assert.equal(result.finalState.status === 'won' || result.finalState.status === 'lost', true);
    assert.equal(result.outcome.winner === 'player' || result.outcome.winner === 'enemy', true);
    assert.equal(result.finalState.status, result.outcome.status);
    assert.equal(result.finalState.events.at(-1)?.type, 'BATTLE_END');
    assert.equal(result.finalState.events.at(-1)?.payload?.winner, result.outcome.winner);
    if (result.outcome.winner === 'player') playerWins += 1;
    else enemyWins += 1;
    hashes.add(result.finalHash);
    const summary = { seed: result.seed, finalHash: result.finalHash, winner: result.outcome.winner };
    if (!first) first = summary;
    last = summary;
  }
  const playerWinRate = playerWins / GAMES_PER_BATCH;
  const enemyWinRate = enemyWins / GAMES_PER_BATCH;
  const playerCi95 = wilson95(playerWins, GAMES_PER_BATCH);
  const enemyCi95 = wilson95(enemyWins, GAMES_PER_BATCH);
  assert.equal(playerWins + enemyWins, GAMES_PER_BATCH);
  assert.equal(playerWinRate >= 0.49 && playerWinRate <= 0.51, true);
  assert.equal(enemyWinRate >= 0.49 && enemyWinRate <= 0.51, true);
  assert.equal(playerCi95[0] <= 0.5 && playerCi95[1] >= 0.5, true);
  assert.equal(enemyCi95[0] <= 0.5 && enemyCi95[1] >= 0.5, true);
  assert.equal(hashes.size > 1, true);
  return {
    seedOffset,
    games: GAMES_PER_BATCH,
    playerWins,
    enemyWins,
    player: { wins: playerWins, winRate: playerWinRate, ci95: playerCi95 },
    enemy: { wins: enemyWins, winRate: enemyWinRate, ci95: enemyCi95 },
    distinctFinalHashes: hashes.size,
    first,
    last,
  };
}

const sentinelSeed = BATCH_OFFSETS[0] + 777;
const before = runNeutralBattle(sentinelSeed);
assert.equal(Object.isFrozen(before.finalState), true);
assert.equal(Object.isFrozen(before.finalState.events), true);
assert.equal(Object.isFrozen(before.finalState.hands), true);
assert.throws(() => before.finalState.events.push(undefined), TypeError);
assert.throws(() => before.finalState.hands.player.push(undefined), TypeError);
const batches = BATCH_OFFSETS.map(runBatch);
const after = runNeutralBattle(sentinelSeed);
assert.equal(before.finalHash, after.finalHash, 'a batch must not contaminate another battle');
assert.equal(before.outcome.winner, after.outcome.winner, 'same seed must have the same winner');

for (const batch of batches) {
  console.log(JSON.stringify({
    ...batch,
    player: { ...batch.player, winRate: batch.player.winRate.toFixed(4), ci95: batch.player.ci95.map((value) => value.toFixed(4)) },
    enemy: { ...batch.enemy, winRate: batch.enemy.winRate.toFixed(4), ci95: batch.enemy.ci95.map((value) => value.toFixed(4)) },
  }));
}
console.log(JSON.stringify({
  deterministic: true,
  isolatedBatches: true,
  sentinel: { seed: sentinelSeed, finalHash: before.finalHash },
}));
