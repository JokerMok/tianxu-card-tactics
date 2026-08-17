import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BattleFeedbackProjector } from './battle-feedback-projector.ts';

const source = fs.readFileSync(new URL('./battle-feedback-projector.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /(?:from|require\()\s*["']node:/, 'feedback projector must be runtime-neutral');
assert.doesNotMatch(source, /\b(?:window|document|cc|React|setTimeout|setInterval|Date)\b/, 'feedback projector must not require host runtime');
assert.match(source, /DAMAGE/);
assert.match(source, /HERO_DAMAGED/);
assert.match(source, /HEAL/);
assert.match(source, /STATUS_APPLIED/);
assert.match(source, /UNIT_DIED/);
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

function projector() {
  return new BattleFeedbackProjector({
    heroIds: { player: 'player', enemy: 'enemy' },
    heroMaxHp: 30,
    heroInitialHp: 30,
  });
}

function heroSnapshot(projector, side) {
  return projector.snapshot.heroes[side];
}

// Initial projection should be immutable and deterministic.
{
  const fb = projector();
  assert.deepEqual(fb.snapshot, {
    battleStatus: 'playing',
    winner: null,
    reason: null,
    settled: false,
    lastEventId: null,
    lastEventType: null,
    sequence: 0,
    heroes: {
      player: {
        id: 'player',
        side: 'player',
        hp: 30,
        maxHp: 30,
        dead: false,
        shield: 0,
      },
      enemy: {
        id: 'enemy',
        side: 'enemy',
        hp: 30,
        maxHp: 30,
        dead: false,
        shield: 0,
      },
    },
    units: [],
  });
  assert.equal(Object.isFrozen(fb.snapshot), true);
}

// Custom hero IDs must be explicit and only map through configured IDs.
{
  const fb = new BattleFeedbackProjector({ heroIds: { player: 'p-hero', enemy: 'e-hero' } });
  const custom = fb.dispatch(event(1, 'DAMAGE', { targetKind: 'hero', targetId: 'p-hero', value: 2 }));
  assert.equal(custom.accepted, true);
  assert.equal(custom.snapshot.winner, null);

  const alias = fb.dispatch(event(2, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 1 }));
  assert.equal(alias.accepted, false);
  assert.equal(alias.code, 'INVALID_EVENT');
}

// DAMAGE/HEAL target requires explicit targetKind and identity.
{
  const fb = projector();
  const noKind = fb.dispatch(event(1, 'DAMAGE', { targetId: 'player', value: 2 }, {}));
  assert.equal(noKind.accepted, false);
  assert.equal(noKind.code, 'INVALID_EVENT');
  assert.strictEqual(fb.snapshot, noKind.snapshot);

  const noTarget = fb.dispatch(event(2, 'DAMAGE', { targetKind: 'hero', value: 2 }));
  assert.equal(noTarget.accepted, false);
  assert.equal(noTarget.code, 'INVALID_EVENT');
  assert.strictEqual(fb.snapshot, noTarget.snapshot);

  const heroHit = fb.dispatch(event(3, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2 }));
  assert.equal(heroHit.accepted, true);
  assert.equal(heroSnapshot(fb, 'player').hp, 28);
  assert.equal(heroHit.snapshot.units.length, 0);

  const unitMissingId = fb.dispatch(event(4, 'DAMAGE', { targetKind: 'unit', value: 1 }));
  assert.equal(unitMissingId.accepted, false);
  assert.equal(unitMissingId.code, 'INVALID_EVENT');
}

// HERO_DAMAGED only accepts explicit hero identity and must be hero-kind target.
{
  const fb = projector();
  const missing = fb.dispatch(event(1, 'HERO_DAMAGED', { targetKind: 'hero', value: 3 }));
  assert.equal(missing.accepted, false);
  assert.equal(missing.code, 'INVALID_EVENT');
  assert.strictEqual(fb.snapshot, missing.snapshot);

  const wrongKind = fb.dispatch(event(1, 'HERO_DAMAGED', { targetKind: 'unit', targetId: 'u1', value: 3 }));
  assert.equal(wrongKind.accepted, false);
  assert.equal(wrongKind.code, 'INVALID_EVENT');

  const byHeroId = fb.dispatch(event(2, 'HERO_DAMAGED', { targetKind: 'hero', heroId: 'player', value: 3 }));
  assert.equal(byHeroId.accepted, true);
  assert.equal(byHeroId.snapshot.winner, null);
  assert.equal(heroSnapshot(fb, 'player').hp, 27);
}

// Field conflicts or malformed values are rejected and do not mutate.
{
  const fb = projector();
  assert.strictEqual(fb.snapshot.sequence, 0);

  const conflict = fb.dispatch(event(1, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2 }, { targetId: 'enemy' }));
  assert.equal(conflict.accepted, false);
  assert.equal(conflict.code, 'INVALID_EVENT');
  assert.strictEqual(fb.snapshot.sequence, 0);

  const malformed = fb.dispatch(event(2, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2, status: 'x' }, { value: 3 }));
  assert.equal(malformed.accepted, false);
  assert.equal(malformed.code, 'INVALID_EVENT');
  assert.strictEqual(fb.snapshot.sequence, 0);

  const malformedHp = fb.dispatch(event(3, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2, currentHp: 'bad' }));
  assert.equal(malformedHp.accepted, false);
  assert.equal(malformedHp.code, 'INVALID_EVENT');
  assert.strictEqual(fb.snapshot.sequence, 0);

  const hpMismatch = fb.dispatch(event(4, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2, currentHp: 30 }));
  assert.equal(hpMismatch.accepted, false);
  assert.equal(hpMismatch.code, 'INVALID_EVENT');
  assert.strictEqual(fb.snapshot, hpMismatch.snapshot);
}

// Generic target feedback must include targetKind and target identity with conflict checks.
{
  const fb = projector();
  const statusNoKind = fb.dispatch(event(1, 'STATUS_APPLIED', { targetId: 'p1', kind: 'BARRIER' }));
  assert.equal(statusNoKind.accepted, false);
  assert.equal(statusNoKind.code, 'INVALID_EVENT');

  const statusNoTarget = fb.dispatch(event(2, 'STATUS_APPLIED', { targetKind: 'hero', kind: 'BARRIER' }));
  assert.equal(statusNoTarget.accepted, false);
  assert.equal(statusNoTarget.code, 'INVALID_EVENT');

  const statusOk = fb.dispatch(event(3, 'STATUS_APPLIED', { targetKind: 'hero', targetId: 'player', kind: 'BARRIER' }, { side: 'player' }));
  assert.equal(statusOk.accepted, true);

  const deadNoTargetKind = fb.dispatch(event(4, 'UNIT_DIED', { targetId: 'unit-1' }, { targetKind: 'hero' }));
  assert.equal(deadNoTargetKind.accepted, false);
  assert.equal(deadNoTargetKind.code, 'INVALID_EVENT');

  const deadByUnitId = fb.dispatch(event(5, 'UNIT_DIED', { unitId: 'unit-1', cardId: 'c-1' }));
  assert.equal(deadByUnitId.accepted, true);
  assert.equal(deadByUnitId.snapshot.units[0].id, 'unit-1');
  assert.equal(deadByUnitId.snapshot.units[0].dead, true);
}

// Unit death and heal target checks.

// Shield feedback updates for hero and unit targets.
{
  const fb = projector();
  const heroShield = fb.dispatch(event(1, 'STATUS_APPLIED', {
    targetKind: 'hero',
    targetId: 'player',
    kind: 'SHIELD',
    value: 3,
  }));
  assert.equal(heroShield.accepted, true);
  assert.equal(heroShield.snapshot.heroes.player.shield, 3);

  const unitShield = fb.dispatch(event(2, 'STATUS_APPLIED', {
    targetKind: 'unit',
    targetId: 'unit-1',
    side: 'player',
    kind: 'ARMOR',
    amount: 5,
  }));
  assert.equal(unitShield.accepted, true);
  assert.equal(unitShield.snapshot.units[0].id, 'unit-1');
  assert.equal(unitShield.snapshot.units[0].shield, 5);

  const shieldWithoutValue = fb.dispatch(event(3, 'STATUS_APPLIED', {
    targetKind: 'unit',
    targetId: 'unit-2',
    kind: 'SHIELD',
    side: 'player',
  }));
  assert.equal(shieldWithoutValue.accepted, false);
  assert.equal(shieldWithoutValue.code, 'INVALID_EVENT');
}

{
  const fb = projector();
  const dead = fb.dispatch(event(1, 'UNIT_DIED', { targetKind: 'unit', targetId: 'unit-1' }));
  assert.equal(dead.accepted, true);
  assert.equal(dead.snapshot.units[0].dead, true);

  const heal = fb.dispatch(event(2, 'HEAL', { targetKind: 'hero', targetId: 'enemy', value: 5 }));
  assert.equal(heal.accepted, true);
  assert.equal(heal.snapshot.heroes.enemy.hp, 30);

  const unitHealMissingTarget = fb.dispatch(event(3, 'HEAL', { targetKind: 'unit', value: 2 }));
  assert.equal(unitHealMissingTarget.accepted, false);
  assert.equal(unitHealMissingTarget.code, 'INVALID_EVENT');
}

// BATTLE_END truth table and side as metadata must not influence winner mapping.
{
  const won = projector();
  const win = won.dispatch(event(1, 'BATTLE_END', { status: 'won', winner: 'player', reason: 'HERO_DEFEATED' }, { side: 'enemy' }));
  assert.equal(win.accepted, true);
  assert.equal(win.snapshot.battleStatus, 'won');
  assert.equal(win.snapshot.winner, 'player');
  assert.equal(win.snapshot.reason, 'HERO_DEFEATED');

  const draw = projector();
  const drawWithoutWinner = draw.dispatch(event(1, 'BATTLE_END', { status: 'draw', reason: 'ROUND_LIMIT' }));
  assert.equal(drawWithoutWinner.accepted, true);
  assert.equal(drawWithoutWinner.snapshot.battleStatus, 'draw');
  assert.equal(drawWithoutWinner.snapshot.winner, null);

  const lost = projector();
  const lose = lost.dispatch(event(1, 'BATTLE_END', { status: 'lost', winner: 'enemy', reason: 'HERO_DEFEATED' }));
  assert.equal(lose.accepted, true);
  assert.equal(lose.snapshot.battleStatus, 'lost');
  assert.equal(lose.snapshot.winner, 'enemy');

  const wrongWinner = projector();
  assert.equal(wrongWinner.dispatch(event(1, 'BATTLE_END', { status: 'won', winner: 'enemy', reason: 'HERO_DEFEATED' })).accepted, false);
  assert.equal(wrongWinner.dispatch(event(1, 'BATTLE_END', { status: 'draw', winner: 'player', reason: 'ROUND_LIMIT' })).accepted, false);
  assert.equal(wrongWinner.dispatch(event(1, 'BATTLE_END', { status: 'lost', reason: 'ROUND_LIMIT' })).accepted, false);
  assert.equal(wrongWinner.dispatch(event(1, 'BATTLE_END', { status: 'won', winner: 'player' })).accepted, false);
  assert.equal(wrongWinner.dispatch(event(1, 'BATTLE_END', { status: 'won', winner: 'player', reason: '' })).accepted, false);

  const metadataConflict = projector();
  const conflictingSide = metadataConflict.dispatch(event(1, 'BATTLE_END', {
    status: 'won', winner: 'player', reason: 'HERO_DEFEATED', side: 'player',
  }, { side: 'enemy' }));
  assert.equal(conflictingSide.accepted, false);
  assert.equal(conflictingSide.code, 'INVALID_EVENT');
}

// Duplicate, out-of-order and terminal events must not change projection snapshot references.
{
  const fb = projector();
  const first = fb.dispatch(event(2, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2 }));
  assert.equal(first.accepted, true);
  const beforeTerminal = fb.snapshot;
  const outOfOrder = fb.dispatch(event(1, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2 }));
  assert.equal(outOfOrder.code, 'OUT_OF_ORDER_EVENT');
  assert.strictEqual(outOfOrder.snapshot, beforeTerminal);

  const duplicate = fb.dispatch(event(2, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2 }));
  assert.equal(duplicate.code, 'DUPLICATE_EVENT');
  assert.strictEqual(duplicate.snapshot, beforeTerminal);

  const duplicateEvent = fb.dispatch(event(2, 'HERO_DAMAGED', { targetKind: 'hero', targetId: 'player', value: 2 }));
  assert.equal(duplicateEvent.code, 'DUPLICATE_EVENT');

  const end = fb.dispatch(event(3, 'BATTLE_END', { status: 'draw', reason: 'ROUND_LIMIT' }));
  assert.equal(end.accepted, true);
  const settled = fb.snapshot;

  const terminalRejected = fb.dispatch(event(4, 'HEAL', { targetKind: 'hero', targetId: 'player', value: 3 }));
  assert.equal(terminalRejected.accepted, false);
  assert.equal(terminalRejected.code, 'TERMINAL_STATE');
  assert.strictEqual(terminalRejected.snapshot, settled);

  const duplicateAfterSettle = fb.dispatch(event(4, 'HEAL', { targetKind: 'hero', targetId: 'player', value: 3 }));
  assert.equal(duplicateAfterSettle.accepted, false);
  assert.equal(duplicateAfterSettle.code, 'TERMINAL_STATE');
  assert.strictEqual(duplicateAfterSettle.snapshot, settled);
}

// Side is metadata and must not derive identity, and conflicting identities are rejected.
{
  const fb = projector();
  const heroWithMetadataSide = fb.dispatch(event(1, 'DAMAGE', {
    targetKind: 'hero',
    targetId: 'player',
    side: 'enemy',
    value: 2,
  }));
  assert.equal(heroWithMetadataSide.accepted, true);
  assert.equal(heroWithMetadataSide.snapshot.heroes.player.hp, 28);

  const unit = fb.dispatch(event(1, 'UNIT_DIED', { targetKind: 'unit', targetId: 'unit-1', side: 'player', cardId: 'u1' }));
  assert.equal(unit.accepted, false, 'event ids remain globally ordered after accepted feedback');

  const unitWithMetadataSide = fb.dispatch(event(2, 'UNIT_DIED', {
    targetKind: 'unit', targetId: 'unit-1', side: 'player', cardId: 'u1',
  }));
  assert.equal(unitWithMetadataSide.accepted, true);
  assert.equal(unitWithMetadataSide.snapshot.units[0].side, 'player');

  const unitConflict = fb.dispatch(event(3, 'DAMAGE', {
    targetKind: 'unit',
    targetId: 'unit-1',
    side: 'enemy',
    value: 1,
  }));
  assert.equal(unitConflict.accepted, false);
  assert.equal(unitConflict.code, 'INVALID_EVENT');

  const heroConflict = fb.dispatch(event(4, 'DAMAGE', {
    targetKind: 'hero',
    targetId: 'player',
    heroId: 'enemy',
    value: 2,
  }));
  assert.equal(heroConflict.accepted, false);
  assert.equal(heroConflict.code, 'INVALID_EVENT');

  const heroAliasConflict = fb.dispatch(event(5, 'HERO_DAMAGED', {
    targetKind: 'hero',
    targetId: 'player',
    heroId: 'enemy',
    value: 2,
  }));
  assert.equal(heroAliasConflict.accepted, false);
  assert.equal(heroAliasConflict.code, 'INVALID_EVENT');

  const unknown = fb.dispatch(event(3, 'ROUND_START'));
  assert.equal(unknown.accepted, false);
  assert.equal(unknown.code, 'UNKNOWN_EVENT');
}

// Snapshot should be deterministic for same accepted stream.
{
  const events = [
    event(1, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 2 }),
    event(2, 'HERO_DAMAGED', { targetKind: 'hero', targetId: 'enemy', value: 3 }),
    event(3, 'HEAL', { targetKind: 'hero', targetId: 'player', value: 1 }),
    event(4, 'BATTLE_END', { status: 'won', winner: 'player', reason: 'HERO_DEFEATED' }),
  ];
  const first = projector();
  const second = projector();
  first.applyEvents(events);
  second.applyEvents(events);
  assert.deepEqual(first.snapshot, second.snapshot);
  assert.equal(Object.isFrozen(first.snapshot), true);
  assert.equal(Object.isFrozen(second.snapshot), true);
}

console.log('BattleFeedbackProjector contract PASS');
