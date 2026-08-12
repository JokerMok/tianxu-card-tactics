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
assert.match(source, /Object\.freeze/);

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
    ...options,
  });
}

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

// HERO_DAMAGED accepts the legacy damage field and event-level target identity.
// Cumulative damage puts the hero into Critical without reading BattleState.
{
  const hero = machine();
  const result = hero.dispatch(event(1, 'HERO_DAMAGED', { damage: 23 }, {
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
}

// BATTLE_END maps the player's result and the event-level winner to each hero.
{
  const player = machine('player');
  const enemy = machine('enemy');
  const win = event(1, 'BATTLE_END', { status: 'won' }, { side: 'player' });
  assert.equal(player.dispatch(win).state, 'Idle');
  assert.equal(enemy.dispatch(win).state, 'Defeat');

  const drawPlayer = machine('player');
  const drawEnemy = machine('enemy');
  const draw = event(1, 'BATTLE_END', { status: 'draw' }, { side: 'player' });
  assert.equal(drawPlayer.dispatch(draw).state, 'Idle');
  assert.equal(drawEnemy.dispatch(draw).state, 'Idle');

  const enemyWinner = machine('enemy');
  assert.equal(enemyWinner.dispatch(event(1, 'BATTLE_END', { status: 'lost', winner: 'enemy' }, { side: 'enemy' })).state, 'Idle');
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

  assert.equal(hero.dispatch(event(3, 'BATTLE_END', { status: 'lost' }, { side: 'enemy' })).state, 'Defeat');
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
    event(4, 'BATTLE_END', { status: 'lost' }, { side: 'enemy' }),
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

console.log('HeroActionStateMachine contract PASS');
