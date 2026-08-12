import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  HERO_ACTION_STATES,
  HeroActionStateMachine,
} from './hero-action-state-machine.ts';

const source = fs.readFileSync(new URL('./hero-action-state-machine.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /(?:from|require\()\s*["']node:/, 'hero presentation must be runtime-neutral');
assert.doesNotMatch(source, /\b(?:window|document|cc|React|setTimeout|setInterval|Date)\b/, 'hero presentation must not require a host or clock');
assert.match(source, /DAMAGE/);
assert.match(source, /HERO_DAMAGED/);
assert.match(source, /BATTLE_END/);
assert.match(source, /ORDER/);
assert.match(source, /Object\.freeze/);
assert.doesNotMatch(source, /DEFAULT_CRITICAL_HP_RATIO|Math\.max\(4|0\.12/);

function event(eventId, type, payload = {}, overrides = {}) {
  return {
    eventId,
    round: 1,
    turn: eventId,
    activeSide: 'player',
    rngCursor: eventId,
    type,
    payload,
    ...overrides,
  };
}

function machine(side = 'player', options = {}) {
  return new HeroActionStateMachine({
    heroId: `${side}-hero`,
    side,
    maxHp: 30,
    heavyDamageThreshold: 4,
    criticalHpRatio: 0.25,
    ...options,
  });
}

assert.throws(
  () => new HeroActionStateMachine({ side: 'player', maxHp: 30 }),
  /heavyDamageThreshold/,
  'damage threshold must be supplied by the caller',
);
assert.throws(
  () => new HeroActionStateMachine({ side: 'player', maxHp: 30, heavyDamageThreshold: 4 }),
  /criticalHpRatio/,
  'critical ratio must be supplied by the caller',
);

assert.deepEqual(HERO_ACTION_STATES, {
  IDLE: 'Idle',
  HIT_LIGHT: 'HitLight',
  HIT_HEAVY: 'HitHeavy',
  COMMAND: 'Command',
  CRITICAL: 'Critical',
  DEFEAT: 'Defeat',
});

// The machine starts at Idle with an immutable, deterministic projection.
{
  const hero = machine();
  assert.deepEqual(hero.snapshot, {
    heroId: 'player-hero',
    side: 'player',
    hp: 30,
    maxHp: 30,
    state: 'Idle',
    lastEventId: null,
    lastEventType: null,
    sequence: 0,
  });
  assert.equal(Object.isFrozen(hero.snapshot), true);
}

// Damage must identify the hero. A unit damage event is never a hero projection.
{
  const hero = machine();
  const before = hero.snapshot;
  const unitDamage = hero.dispatch(event(1, 'DAMAGE', {
    targetKind: 'unit',
    targetId: 'unit-player-1',
    value: 5,
  }, { side: 'player', targetId: 'unit-player-1' }));
  assert.equal(unitDamage.accepted, false);
  assert.equal(unitDamage.code, 'NOT_HERO_EVENT');
  assert.strictEqual(hero.snapshot, before);

  const wrongSide = hero.dispatch(event(2, 'HERO_DAMAGED', { damage: 5, side: 'enemy' }, { side: 'enemy' }));
  assert.equal(wrongSide.accepted, false);
  assert.equal(wrongSide.code, 'WRONG_HERO');
  assert.strictEqual(hero.snapshot, before);

  const malformedHeroDamage = hero.dispatch(event(3, 'HERO_DAMAGED', {
    targetKind: 'unit',
    targetId: 'unit-player-1',
    damage: 5,
    side: 'player',
  }, { side: 'player' }));
  assert.equal(malformedHeroDamage.accepted, false);
  assert.equal(malformedHeroDamage.code, 'NOT_HERO_EVENT');
  assert.strictEqual(hero.snapshot, before);
}

// Real core DAMAGE fields use payload.targetKind/targetId/value and event.side.
// A small hit is light; a hit at the configured core-facing threshold is heavy.
{
  const hero = machine();
  const light = hero.dispatch(event(1, 'DAMAGE', {
    targetKind: 'hero',
    value: 2,
  }, { side: 'player', targetId: 'player' }));
  assert.equal(light.accepted, true);
  assert.equal(light.state, 'HitLight');
  assert.equal(hero.snapshot.hp, 28);

  const heavy = hero.dispatch(event(2, 'DAMAGE', {
    targetKind: 'hero',
    targetId: 'player',
    value: 5,
  }));
  assert.equal(heavy.accepted, true);
  assert.equal(heavy.state, 'HitHeavy');
  assert.equal(hero.snapshot.hp, 23);
}

// HERO_DAMAGED accepts the real payload { side, value } and event-level target identity.
// Cumulative damage puts the hero into Critical without reading BattleState.
{
  const hero = machine();
  const result = hero.dispatch(event(1, 'HERO_DAMAGED', { side: 'player', value: 23 }, {
    side: 'player',
    targetId: 'player',
  }));
  assert.equal(result.accepted, true);
  assert.equal(result.state, 'Critical');
  assert.equal(hero.snapshot.hp, 7);
}

// A command event is accepted only when its source is the configured hero.
{
  const hero = machine();
  const command = hero.dispatch(event(1, 'COMMAND', { targetId: 'player-hero' }, { sourceId: 'player-hero' }));
  assert.equal(command.accepted, true);
  assert.equal(command.state, 'Command');

  const unitCommand = hero.dispatch(event(2, 'COMMAND', { sourceId: 'unit-player-1' }));
  assert.equal(unitCommand.accepted, false);
  assert.equal(unitCommand.code, 'WRONG_HERO');
  assert.equal(hero.snapshot.state, 'Command');

  const mixedIdentity = hero.dispatch(event(3, 'COMMAND', { sourceId: 'unit-player-1' }, { side: 'player' }));
  assert.equal(mixedIdentity.accepted, false);
  assert.equal(mixedIdentity.code, 'WRONG_HERO');

  const order = hero.dispatch(event(4, 'ORDER', {}, { sourceId: 'player-hero' }));
  assert.equal(order.accepted, true);
  assert.equal(order.state, 'Command');
}

// BATTLE_END maps the player's result and the event-level winner to each hero.
{
  const player = machine('player');
  const enemy = machine('enemy');
  const win = event(1, 'BATTLE_END', { status: 'won', winner: 'player', reason: 'HERO_DEFEATED' }, { side: 'player' });
  assert.equal(player.dispatch(win).state, 'Idle');
  assert.equal(enemy.dispatch(win).state, 'Defeat');

  const drawPlayer = machine('player');
  const drawEnemy = machine('enemy');
  const draw = event(1, 'BATTLE_END', { status: 'draw', reason: 'ROUND_LIMIT' }, { side: 'player' });
  assert.equal(drawPlayer.dispatch(draw).state, 'Idle');
  assert.equal(drawEnemy.dispatch(draw).state, 'Idle');

  const enemyWinner = machine('enemy');
  assert.equal(enemyWinner.dispatch(event(1, 'BATTLE_END', { status: 'lost', winner: 'enemy', reason: 'HERO_DEFEATED' }, { side: 'enemy' })).state, 'Idle');
}

// Invalid, unknown, duplicate, out-of-order, and post-settlement events are no-ops.
{
  const hero = machine();
  const initial = hero.snapshot;
  assert.equal(hero.dispatch(event(1, 'ROUND_START')).code, 'UNKNOWN_EVENT');
  assert.strictEqual(hero.snapshot, initial);
  assert.equal(hero.dispatch(event(1, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: -1 }, { side: 'player' })).code, 'INVALID_EVENT');
  assert.strictEqual(hero.snapshot, initial);

  hero.dispatch(event(2, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2 }, { side: 'player' }));
  const beforeDuplicate = hero.snapshot;
  assert.equal(hero.dispatch(event(2, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2 }, { side: 'player' })).code, 'DUPLICATE_EVENT');
  assert.strictEqual(hero.snapshot, beforeDuplicate);
  assert.equal(hero.dispatch(event(1, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2 }, { side: 'player' })).code, 'OUT_OF_ORDER_EVENT');
  assert.strictEqual(hero.snapshot, beforeDuplicate);

  assert.equal(hero.dispatch(event(3, 'BATTLE_END', { status: 'lost', winner: 'enemy', reason: 'HERO_DEFEATED' }, { side: 'enemy' })).state, 'Defeat');
  const beforeTerminal = hero.snapshot;
  assert.equal(hero.dispatch(event(4, 'COMMAND', {}, { sourceId: 'player-hero' })).code, 'TERMINAL_STATE');
  assert.strictEqual(hero.snapshot, beforeTerminal);
}

// The same accepted event stream has byte-for-byte equivalent immutable output.
{
  const sequence = [
    event(1, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2 }, { side: 'player' }),
    event(2, 'COMMAND', {}, { sourceId: 'player-hero' }),
    event(3, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 23 }, { side: 'player' }),
    event(4, 'BATTLE_END', { status: 'lost', winner: 'enemy', reason: 'HERO_DEFEATED' }, { side: 'enemy' }),
  ];
  const first = machine();
  const second = machine();
  first.applyEvents(sequence);
  second.applyEvents(sequence);
  assert.deepEqual(first.snapshot, second.snapshot);
  assert.equal(Object.isFrozen(first.snapshot), true);
  assert.throws(() => { first.snapshot.state = 'Idle'; }, TypeError);
  assert.throws(() => { first.snapshot.hp = 30; }, TypeError);
}

// DAMAGE is strict: targetId is required, payload/event duplicates must agree,
// side cannot stand in for targetId, and numeric/source fields reject malformed input.
{
  const missingTarget = machine();
  assert.equal(missingTarget.dispatch(event(1, 'DAMAGE', {
    targetKind: 'hero',
    side: 'player',
    value: 2,
  })).code, 'INVALID_EVENT');

  const conflictingTarget = machine();
  assert.equal(conflictingTarget.dispatch(event(1, 'DAMAGE', {
    targetKind: 'hero',
    targetId: 'player',
    value: 2,
  }, { targetId: 'enemy' })).code, 'INVALID_EVENT');

  const conflictingSide = machine();
  assert.equal(conflictingSide.dispatch(event(1, 'DAMAGE', {
    targetKind: 'hero',
    targetId: 'player',
    side: 'enemy',
    value: 2,
  })).code, 'INVALID_EVENT');

  const malformed = machine();
  for (const payload of [
    { targetKind: 'hero', targetId: 1, value: 2 },
    { targetKind: 'hero', targetId: 'player', value: 0 },
    { targetKind: 'hero', targetId: 'player', value: 2.5 },
    { targetKind: 'hero', targetId: 'player', value: 2, damage: 3 },
    { targetKind: 'hero', targetId: 'player', value: 2, sourceId: 7 },
    { targetKind: 'hero', targetId: 'player', value: 2, attackerId: '' },
    { targetKind: 'hero', targetId: 'player', value: 2, currentHp: 27 },
  ]) {
    assert.equal(malformed.dispatch(event(malformed.snapshot.sequence + 1, 'DAMAGE', payload, { side: 'player' })).accepted, false);
    assert.equal(malformed.snapshot.sequence, 0);
  }

  const hpConflict = machine();
  assert.equal(hpConflict.dispatch(event(1, 'DAMAGE', {
    targetKind: 'hero',
    targetId: 'player',
    value: 2,
    currentHp: 28,
  }, { side: 'player', currentHp: 27 })).code, 'INVALID_EVENT');
  assert.equal(hpConflict.snapshot.hp, 30);
}

// HERO_DAMAGED requires at least one typed identity and rejects field conflicts.
{
  const missingIdentity = machine();
  assert.equal(missingIdentity.dispatch(event(1, 'HERO_DAMAGED', { value: 2 })).code, 'INVALID_EVENT');

  const wrongType = machine();
  assert.equal(wrongType.dispatch(event(1, 'HERO_DAMAGED', { side: 1, value: 2 })).code, 'INVALID_EVENT');
  assert.equal(wrongType.dispatch(event(2, 'HERO_DAMAGED', { heroId: 3, value: 2 })).code, 'INVALID_EVENT');
  assert.equal(wrongType.dispatch(event(3, 'HERO_DAMAGED', { targetId: null, value: 2 })).code, 'INVALID_EVENT');

  const fieldConflict = machine();
  assert.equal(fieldConflict.dispatch(event(1, 'HERO_DAMAGED', { side: 'player', value: 2 }, { side: 'enemy' })).code, 'INVALID_EVENT');

  const identityConflict = machine();
  assert.equal(identityConflict.dispatch(event(1, 'HERO_DAMAGED', {
    side: 'player',
    targetId: 'enemy',
    value: 2,
  })).code, 'INVALID_EVENT');

  const eventSourceConflict = machine();
  assert.equal(eventSourceConflict.dispatch(event(1, 'HERO_DAMAGED', {
    side: 'player',
    value: 2,
    sourceId: 'player-hero',
  }, { sourceId: 7 })).code, 'INVALID_EVENT');

  const hpMismatch = machine();
  assert.equal(hpMismatch.dispatch(event(1, 'HERO_DAMAGED', {
    side: 'player',
    value: 2,
    remainingHp: 27,
  })).code, 'INVALID_EVENT');
}

// BATTLE_END requires reason and an explicit status-consistent winner.
{
  const missingReason = machine();
  assert.equal(missingReason.dispatch(event(1, 'BATTLE_END', { status: 'won', winner: 'player' })).code, 'INVALID_EVENT');

  const missingWinner = machine();
  assert.equal(missingWinner.dispatch(event(1, 'BATTLE_END', { status: 'lost', reason: 'HERO_DEFEATED' })).code, 'INVALID_EVENT');

  const sideCannotBeWinner = machine();
  assert.equal(sideCannotBeWinner.dispatch(event(1, 'BATTLE_END', { status: 'won', reason: 'HERO_DEFEATED' }, { side: 'player' })).code, 'INVALID_EVENT');

  const undefinedWinner = machine();
  assert.equal(undefinedWinner.dispatch(event(1, 'BATTLE_END', {
    status: 'won',
    winner: undefined,
    reason: 'HERO_DEFEATED',
  })).code, 'INVALID_EVENT');

  const wrongWinner = machine();
  assert.equal(wrongWinner.dispatch(event(1, 'BATTLE_END', { status: 'won', winner: 'enemy', reason: 'HERO_DEFEATED' })).code, 'INVALID_EVENT');

  const conflictingWinner = machine();
  assert.equal(conflictingWinner.dispatch(event(1, 'BATTLE_END', {
    status: 'won',
    winner: 'player',
    reason: 'HERO_DEFEATED',
  }, { winner: 'enemy' })).code, 'INVALID_EVENT');

  const conflictingReason = machine();
  assert.equal(conflictingReason.dispatch(event(1, 'BATTLE_END', {
    status: 'won',
    winner: 'player',
    reason: 'HERO_DEFEATED',
  }, { reason: 'ROUND_LIMIT' })).code, 'INVALID_EVENT');

  const drawWinner = machine();
  assert.equal(drawWinner.dispatch(event(1, 'BATTLE_END', { status: 'draw', winner: 'player', reason: 'ROUND_LIMIT' })).code, 'INVALID_EVENT');

  const statusConflict = machine();
  assert.equal(statusConflict.dispatch(event(1, 'BATTLE_END', {
    status: 'won',
    winner: 'player',
    reason: 'HERO_DEFEATED',
  }, { status: 'lost' })).code, 'INVALID_EVENT');
}

// Thresholds are explicit caller policy rather than hidden core-derived defaults.
{
  const policy = machine('player', { heavyDamageThreshold: 3, criticalHpRatio: 0.5 });
  const result = policy.dispatch(event(1, 'DAMAGE', {
    targetKind: 'hero',
    targetId: 'player',
    value: 3,
  }, { side: 'player' }));
  assert.equal(result.state, 'HitHeavy');
  assert.equal(policy.snapshot.hp, 27);
}

console.log('HeroActionStateMachine contract PASS');
