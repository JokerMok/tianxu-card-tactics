import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runBattleRunner, BATTLE_RUNNER_PROTOCOL } from './runner/battle-runner.ts';
import { BattleSessionController } from './session-controller.ts';
import { BattleInputAdapter } from './input/battle-input-adapter.ts';

const skillConfigs = JSON.parse(
  fs.readFileSync(new URL('../../resources/config/skills.json', import.meta.url), 'utf8'),
).skills;
const cardConfigs = JSON.parse(
  fs.readFileSync(new URL('../../resources/config/cards.json', import.meta.url), 'utf8'),
).cards;

function inputSkillTargetType(cardId) {
  const skillId = cardConfigs.find((card) => card.id === cardId)?.skillId;
  const targetType = skillConfigs.find((skill) => skill.id === skillId)?.targetType;
  if (targetType === 'ENEMY_UNIT') return 'enemy-unit';
  if (targetType === 'ALLY_UNIT') return 'ally-unit';
  if (targetType === 'ENEMY_LANE') return 'enemy-lane';
  if (targetType === 'ALLY_LANE') return 'ally-lane';
  if (targetType === 'PREPARE_BAR') return 'global';
  return undefined;
}

// T040 deliberately exercises the preparation transition needed by a real
// skill submission. The changed v1 state is still deterministic for the same
// seed and action list; this locks both facts without asserting a skill effect.
{
  const input = { protocol: BATTLE_RUNNER_PROTOCOL, seed: 42, actions: [{ type: 'BATTLE_START' }] };
  const first = runBattleRunner(input);
  const repeat = runBattleRunner(input);
  assert.equal(first.finalHash, '2d397e91');
  assert.equal(first.finalHash, repeat.finalHash);
  assert.equal(first.finalState.hands[first.finalState.activeSide].some((card) => inputSkillTargetType(card.cardId) === 'ally-lane' && card.remainingPreparation === 0), true);
}

function resolveInputCard(cardId) {
  if (cardId.startsWith('U')) return { kind: 'unit' };
  const targetType = inputSkillTargetType(cardId);
  return targetType ? { kind: 'skill', targetType } : undefined;
}

function makeController(seed) {
  return new BattleSessionController({
    seed,
    engine: {
      run(nextSeed, actions) {
        const output = runBattleRunner({ protocol: BATTLE_RUNNER_PROTOCOL, seed: nextSeed, actions });
        return { finalState: output.finalState, events: output.events, finalHash: output.finalHash };
      },
    },
  });
}

// The real DEPLOY_UNIT action reaches the real controller and runner.
{
  const controller = makeController(42);
  controller.start();
  const side = controller.snapshot.state.activeSide;
  const card = controller.snapshot.state.hands[side].find((item) => item.cardId.startsWith('U'));
  assert(card, 'the seed must expose a unit card in the active hand');
  controller.dispatch({
    type: 'DEPLOY_UNIT',
    cardId: card.cardId,
    side,
    lane: 0,
    cell: side === 'player' ? 0 : 11,
  });
  assert.equal(controller.snapshot.actions.at(-1).type, 'DEPLOY_UNIT');
  assert.equal(controller.snapshot.state.units.length, 1);
}

// A real skill selected by the adapter reaches the real controller and runner.
// The skill is target-validated and recorded as a submission; effect resolution
// remains outside this runner contract and the card is intentionally retained.
{
  const controller = makeController(9);
  controller.start();
  const playerUnit = controller.snapshot.state.hands.player.find((item) => item.cardId.startsWith('U'));
  const enemyUnit = controller.snapshot.state.hands.enemy.find((item) => item.cardId.startsWith('U'));
  assert(playerUnit && enemyUnit);
  controller.dispatch({ type: 'DEPLOY_UNIT', cardId: playerUnit.cardId, side: 'player', lane: 0, cell: 0 });
  controller.dispatch({ type: 'END_TURN' });
  controller.dispatch({ type: 'DEPLOY_UNIT', cardId: enemyUnit.cardId, side: 'enemy', lane: 1, cell: 11 });
  controller.dispatch({ type: 'END_TURN' });
  const skill = controller.snapshot.state.hands.player.find((item) => inputSkillTargetType(item.cardId) === 'ally-lane');
  const allySkill = controller.snapshot.state.hands.player.find((item) => inputSkillTargetType(item.cardId) === 'ally-unit');
  assert(skill, 'the seed must expose a ready ally-lane skill card in the active hand');
  assert(allySkill, 'the seed must expose a ready ally-unit skill card in the active hand');
  const enemy = controller.snapshot.state.units.find((unit) => unit.side === 'enemy');
  const ally = controller.snapshot.state.units.find((unit) => unit.side === 'player');
  assert(enemy && ally);

  const adapter = new BattleInputAdapter({ session: controller, side: 'player', resolveCard: resolveInputCard });
  assert.equal(adapter.selectCard(skill.instanceId).ok, true);
  assert.deepEqual(adapter.preview.candidates, [{ kind: 'lane', lane: 0 }]);
  assert.equal(adapter.preview.candidates.some((target) => target.lane === 1), false);
  assert.equal(adapter.selectLane(0).ok, true);
  const committed = adapter.confirm();
  assert.equal(committed.ok, true);
  assert.equal(committed.value.type, 'PLAY_CARD');
  assert.deepEqual(committed.value.target, { kind: 'lane', lane: 0 });
  assert.deepEqual(controller.snapshot.actions.at(-1), committed.value);
  assert.equal(controller.snapshot.events.at(-1).type, 'CARD_TARGET_SUBMITTED');
  assert.equal(controller.snapshot.state.hands.player.some((item) => item.cardId === skill.cardId), true);
  assert.equal(controller.snapshot.events.filter(({ type }) => type === 'CARD_PLAYED').length, 2);

  const allyAdapter = new BattleInputAdapter({ session: controller, side: 'player', resolveCard: resolveInputCard });
  assert.equal(allyAdapter.selectCard(allySkill.instanceId).ok, true);
  assert.deepEqual(allyAdapter.preview.candidates, [{ kind: 'unit', unitId: ally.id }]);
  assert.equal(allyAdapter.selectUnit(ally.id).ok, true);
  assert.equal(allyAdapter.confirm().ok, true);
  assert.equal(controller.snapshot.events.at(-1).type, 'CARD_TARGET_SUBMITTED');
  assert.throws(
    () => controller.dispatch({ type: 'PLAY_CARD', cardId: allySkill.cardId, side: 'player', target: { kind: 'unit', unitId: enemy.id } }),
    (error) => error?.code === 'INVALID_COMMAND' && /wrong side/.test(error.message),
  );

  // D001 has no ENEMY_LANE, ENEMY_UNIT, or PREPARE_BAR card. The real
  // ALLY_LANE card must reject an enemy-only lane even though the lane shape
  // itself is valid; this is the runner's relationship guard.
  assert.throws(
    () => controller.dispatch({ type: 'PLAY_CARD', cardId: skill.cardId, side: 'player', target: { kind: 'lane', lane: 1 } }),
    (error) => error?.code === 'INVALID_COMMAND' && /no living ally unit/.test(error.message),
  );
}

// A malformed target is rejected by the runner's command parser, not reported
// as an unsupported high-level action.
assert.throws(
  () => runBattleRunner({
    protocol: BATTLE_RUNNER_PROTOCOL,
    seed: 9,
    actions: [
      { type: 'BATTLE_START' },
      { type: 'PLAY_CARD', cardId: 'S004', side: 'player', target: { kind: 'unsupported' } },
    ],
  }),
  (error) => error?.code === 'INVALID_COMMAND' && !/unsupported high-level action/.test(error.message),
);

console.log('Battle action integration contract PASS');
