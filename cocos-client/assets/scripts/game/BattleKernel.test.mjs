import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RecoveredContent } from './RecoveredContent.ts';
import {
  advanceAI, applyBattleAction, chooseAIAction, createBattle, legalPlays, publicBattle,
} from './BattleKernel.ts';

const catalog = JSON.parse(readFileSync(new URL('../../resources/recovered/catalog.json', import.meta.url), 'utf8'));
const content = new RecoveredContent(catalog, 'main');

function spec(overrides = {}) {
  return {
    id: 'kernel-test', seed: 424242, mapId: 1, rows: 4, firstPlayer: 0,
    players: [
      { id: 'p0', name: 'Human', team: 0, hp: 30, attack: 1, deck: ['1', '2', '3', '4', '5', '6', '19'], ai: false },
      { id: 'p1', name: 'AI', team: 1, hp: 30, attack: 1, deck: ['1', '2', '3', '4', '5', '6', '19'], ai: true },
    ],
    ...overrides,
  };
}

test('creates a deterministic 12-column countdown battle from recovered main data', () => {
  const a = createBattle(content, spec());
  const b = createBattle(content, spec());
  assert.deepEqual(a, b);
  assert.equal(a.columns, 12);
  assert.equal(a.rows, 4);
  assert.equal(a.players[0].hand.length, 5);
  assert.equal(a.players[1].hand.length, 5);
  assert.equal(a.units.find(unit => unit.id === 'hero:p0').col, 0);
  assert.equal(a.units.find(unit => unit.id === 'hero:p1').col, 11);
  assert.ok(a.players[0].hand.every(card => card.wait === 0), 'active opening countdown ticks');
  assert.ok(a.players[1].hand.every(card => card.wait === 1), 'inactive countdown has not ticked');
});

test('legal summon cells use recovered countdown and the inner deployment zones', () => {
  const state = createBattle(content, spec());
  const plays = legalPlays(content, state, 'p0');
  assert.ok(plays.length > 0);
  assert.ok(plays.every(play => play.col >= 1 && play.col <= 3));
  assert.deepEqual(new Set(plays.map(play => play.row)), new Set([0, 1, 2, 3]));

  const special = createBattle(content, spec({ players: [
    { id: 'p0', name: 'Human', team: 0, hp: 30, deck: Array(5).fill('60001') },
    { id: 'p1', name: 'AI', team: 1, hp: 30, deck: Array(5).fill('1'), ai: true },
  ] }));
  assert.equal(legalPlays(content, special, 'p0').length, 0, 'MonsterID 0 display cards are not summonable');
});

test('play/end uses one reducer for human and AI and never mutates input', () => {
  const initial = createBattle(content, spec());
  const before = structuredClone(initial);
  const play = legalPlays(content, initial, 'p0')[0];
  const deployed = applyBattleAction(content, initial, 'p0', { type: 'play', ...play });
  assert.deepEqual(initial, before);
  assert.equal(deployed.revision, 1);
  assert.ok(deployed.events.some(event => event.type === 'summon'));
  assert.equal(deployed.players[0].graveyard.length, 0, 'a living creature card remains on the battlefield');

  const ended = applyBattleAction(content, deployed, 'p0', { type: 'end' });
  assert.equal(ended.activePlayer, 1);
  const aiAction = chooseAIAction(content, ended, 'p1');
  assert.equal(aiAction.type, 'play');
  const aiPlayed = applyBattleAction(content, ended, 'p1', aiAction);
  assert.equal(aiPlayed.revision, ended.revision + 1);
});

test('illegal commands throw and preserve the authoritative value', () => {
  const state = createBattle(content, spec());
  const snapshot = JSON.stringify(state);
  assert.throws(() => applyBattleAction(content, state, 'p1', { type: 'end' }), /active player/);
  assert.throws(() => applyBattleAction(content, state, 'p0', { type: 'play', instanceId: 'forged', row: 0, col: 1 }), /Illegal/);
  assert.equal(JSON.stringify(state), snapshot);
});

test('actual recovered armor, movement, regeneration and direct-damage families execute', () => {
  let state = createBattle(content, spec({
    players: [
      { id: 'p0', name: 'A', team: 0, hp: 30, deck: Array(5).fill('1') },
      { id: 'p1', name: 'B', team: 1, hp: 30, deck: Array(5).fill('1'), ai: true },
    ],
    initialUnits: [
      { playerId: 'p0', monsterId: 1, row: 0, col: 5 },
      { playerId: 'p0', monsterId: 43, row: 1, col: 2 },
      { playerId: 'p0', monsterId: 208, row: 2, col: 2 },
      { playerId: 'p0', monsterId: 363, row: 3, col: 2 },
      { playerId: 'p1', monsterId: 1, row: 0, col: 6 },
    ],
  }));
  const guard = state.units.find(unit => unit.playerId === 'p0' && unit.monsterId === 1);
  const lancer = state.units.find(unit => unit.monsterId === 43);
  const healer = state.units.find(unit => unit.monsterId === 208);
  assert.equal(guard.flags.armor, 1);
  assert.equal(lancer.movement, 3);
  assert.equal(healer.flags.regeneration, 2);
  healer.hp -= 2;
  const enemyHeroHp = state.players[1].hp;
  state = applyBattleAction(content, state, 'p0', { type: 'end' });
  assert.equal(state.units.find(unit => unit.id === healer.id)?.hp, healer.maxHp);
  assert.ok(state.players[1].hp < enemyHeroHp, 'General Nina direct damage reached an enemy hero');
  assert.ok(state.events.some(event => event.type === 'attack'));
  assert.ok(state.events.some(event => event.type === 'damage'));
  assert.ok(state.events.some(event => event.type === 'move'));
});

test('a recovered damaging skill causes death and moves the spell to graveyard', () => {
  let state = createBattle(content, spec({
    players: [
      { id: 'p0', name: 'Mage', team: 0, hp: 30, deck: Array(5).fill('40000') },
      { id: 'p1', name: 'Target', team: 1, hp: 30, deck: Array(5).fill('1'), ai: true },
    ],
    initialUnits: [{ playerId: 'p1', monsterId: 1, row: 0, col: 6 }],
  }));
  const play = legalPlays(content, state, 'p0').find(candidate => candidate.targetId?.startsWith('unit:'));
  assert.ok(play);
  state = applyBattleAction(content, state, 'p0', { type: 'play', ...play });
  assert.ok(state.events.some(event => event.type === 'death'));
  const overkill = state.events.find(event => event.type === 'damage' && event.target === play.targetId);
  assert.ok(overkill.amount > overkill.effectiveAmount);
  assert.equal(overkill.effectiveAmount, 3);
  assert.equal(state.players[0].graveyard.length, 1);
  assert.equal(state.units.some(unit => unit.monsterId === 1 && unit.playerId === 'p1'), false);
});

test('a recovered status skill applies its configured status to a friendly unit', () => {
  let state = createBattle(content, spec({
    players: [
      { id: 'p0', name: 'Commander', team: 0, hp: 30, deck: Array(5).fill('41007') },
      { id: 'p1', name: 'Enemy', team: 1, hp: 30, deck: Array(5).fill('1'), ai: true },
    ],
    initialUnits: [{ playerId: 'p0', monsterId: 1, row: 0, col: 2 }],
  }));
  const play = legalPlays(content, state, 'p0').find(candidate => candidate.targetId?.startsWith('unit:'));
  assert.ok(play);
  state = applyBattleAction(content, state, 'p0', { type: 'play', ...play });
  const target = state.units.find(unit => unit.id === play.targetId);
  assert.ok(target.statuses.some(status => status.id === 41007));
  assert.ok(state.events.some(event => event.type === 'status' && event.effectId === 41007));
});

test('source rule markers disable reflection and range bonuses while Amnesic removes base abilities', () => {
  const reflectedMessages = statusId => {
    let state = createBattle(content, spec({
      players: [
        { id: 'p0', name: 'Attacker', team: 0, hp: 30, deck: Array(5).fill('1') },
        { id: 'p1', name: 'Reflector', team: 1, hp: 30, deck: Array(5).fill('1'), ai: true },
      ],
      initialUnits: [
        { playerId: 'p0', monsterId: 43, row: 0, col: 5 },
        { playerId: 'p1', monsterId: 17525, row: 0, col: 6 },
      ],
    }));
    const reflector = state.units.find(unit => unit.monsterId === 17525);
    if (statusId) reflector.statuses.push({ id: statusId, turns: 3 });
    state = applyBattleAction(content, state, 'p0', { type: 'end' });
    return state.events.filter(event => event.type === 'damage').map(event => event.message);
  };
  assert.ok(reflectedMessages().includes('reflection'));
  assert.equal(reflectedMessages(41178).includes('reflection'), false, '7707 disables source Magic Reflection');
  assert.equal(reflectedMessages(4).includes('reflection'), false, 'Type 30 removes the source reflection ability');

  const attackTarget = statusId => {
    let state = createBattle(content, spec({
      players: [
        { id: 'p0', name: 'Sniper', team: 0, hp: 30, deck: Array(5).fill('1') },
        { id: 'p1', name: 'Targets', team: 1, hp: 30, deck: Array(5).fill('1'), ai: true },
      ],
      initialUnits: [
        { playerId: 'p0', monsterId: 3086, row: 0, col: 4 },
        { playerId: 'p1', monsterId: 61, row: 0, col: 5 },
        { playerId: 'p1', monsterId: 43, row: 0, col: 6 },
      ],
    }));
    const sniper = state.units.find(unit => unit.monsterId === 3086);
    const monsterByUnit = Object.fromEntries(state.units.map(unit => [unit.id, unit.monsterId]));
    sniper.flags.aiType = 0;
    sniper.movement = 0;
    if (statusId) sniper.statuses.push({ id: statusId, turns: 3 });
    state = applyBattleAction(content, state, 'p0', { type: 'end' });
    const attack = state.events.find(event => event.type === 'attack' && event.actor === sniper.id);
    return { target: monsterByUnit[attack?.target], events: state.events, sniper };
  };
  assert.equal(attackTarget().target, 43, 'source Sniper selects the lowest-HP in-range target');
  assert.equal(attackTarget(4).target, 61, 'Amnesic removes source Sniper targeting');

  const rangeBonusAttacks = statusId => {
    let state = createBattle(content, spec({
      players: [
        { id: 'p0', name: 'Ranged', team: 0, hp: 30, deck: Array(5).fill('1') },
        { id: 'p1', name: 'Target', team: 1, hp: 30, deck: Array(5).fill('1'), ai: true },
      ],
      initialUnits: [
        { playerId: 'p0', monsterId: 346, row: 0, col: 4 },
        { playerId: 'p1', monsterId: 61, row: 0, col: 6 },
      ],
    }));
    const ranged = state.units.find(unit => unit.monsterId === 346);
    ranged.movement = 0;
    if (statusId) ranged.statuses.push({ id: statusId, turns: 3 });
    state = applyBattleAction(content, state, 'p0', { type: 'end' });
    return state.events.some(event => event.type === 'attack' && event.actor === ranged.id);
  };
  assert.equal(rangeBonusAttacks(), true);
  assert.equal(rangeBonusAttacks(597), false, '7708 suppresses source range bonuses down to native range');
});

test('surrender is accepted from any participant and settles only when its team is gone', () => {
  let state = createBattle(content, spec({ players: [
    { id: 'p0', name: 'A', team: 0, hp: 20, deck: Array(5).fill('1') },
    { id: 'ally', name: 'Ally', team: 0, hp: 20, deck: Array(5).fill('1') },
    { id: 'p1', name: 'Enemy', team: 1, hp: 20, deck: Array(5).fill('1'), ai: true },
  ] }));
  state = applyBattleAction(content, state, 'ally', { type: 'surrender' });
  assert.equal(state.status, 'playing');
  assert.equal(state.activePlayer, 0);
  state = applyBattleAction(content, state, 'p0', { type: 'surrender' });
  assert.equal(state.status, 'settled');
  assert.equal(state.winner, 1);
});

test('AI advance is bounded, deterministic and stops on a human or settlement', () => {
  const aiSpec = spec({ players: [
    { id: 'p0', name: 'Bot A', team: 0, hp: 12, deck: ['1', '2', '3'], ai: true },
    { id: 'p1', name: 'Bot B', team: 1, hp: 12, deck: ['1', '2', '3'], ai: true },
  ], turnLimit: 20 });
  const a = advanceAI(content, createBattle(content, aiSpec), 200);
  const b = advanceAI(content, createBattle(content, aiSpec), 200);
  assert.deepEqual(a, b);
  assert.equal(a.status, 'settled');
  assert.ok(a.turn <= 21);

  const mixed = createBattle(content, spec({ firstPlayer: 1 }));
  const stopped = advanceAI(content, mixed, 50);
  assert.equal(stopped.status, 'playing');
  assert.equal(stopped.players[stopped.activePlayer].ai, false);
});

test('fatigue lethal damage synchronizes the player and removes the dead hero before settlement', () => {
  let state = createBattle(content, spec({
    players: [
      { id: 'p0', name: 'Survivor', team: 0, hp: 2, deck: ['1'] },
      { id: 'p1', name: 'Fatigued', team: 1, hp: 1, deck: ['1'] },
    ],
  }));
  state = applyBattleAction(content, state, 'p0', { type: 'end' });
  assert.equal(state.status, 'settled');
  assert.equal(state.winner, 0);
  assert.equal(state.players.find(player => player.id === 'p1')?.hp, 0);
  assert.equal(state.units.some(unit => unit.id === 'hero:p1'), false);
  assert.deepEqual(state.events.slice(-5).map(event => [event.type, event.actor, event.target, event.amount, event.message]), [
    ['damage', undefined, 'hero:p1', 1, 'fatigue'],
    ['fatigue', 'p1', undefined, 1, undefined],
    ['turn-start', 'p1', undefined, 2, undefined],
    ['death', 'hero:p1', undefined, undefined, undefined],
    ['settled', undefined, undefined, 0, undefined],
  ]);
});

test('a player killed by fatigue at turn start is skipped while its team remains alive', () => {
  let state = createBattle(content, spec({
    players: [
      { id: 'p0', name: 'Human', team: 0, hp: 20, deck: Array(6).fill('1') },
      { id: 'e0', name: 'Exhausted', team: 1, hp: 1, deck: ['1'], ai: true },
      { id: 'e1', name: 'Reserve', team: 1, hp: 20, deck: Array(6).fill('1'), ai: true },
    ],
  }));
  state = applyBattleAction(content, state, 'p0', { type: 'end' });
  assert.equal(state.status, 'playing');
  assert.equal(state.players.find(player => player.id === 'e0')?.hp, 0);
  assert.equal(state.units.some(unit => unit.id === 'hero:e0'), false);
  assert.equal(state.players[state.activePlayer]?.id, 'e1');
  assert.equal(state.turn, 3);
});

test('public projection hides opposing hand and deck identities without mutating state', () => {
  const state = createBattle(content, spec());
  const projected = publicBattle(state, 'p0');
  const enemy = projected.players.find(candidate => candidate.id === 'p1');
  assert.equal(enemy.handCount, 5);
  assert.deepEqual(enemy.hand, []);
  assert.deepEqual(enemy.drawPile, []);
  assert.deepEqual(enemy.deck, []);
  assert.equal(state.players[1].hand.length, 5);
});

test('equipment effects apply to heroes and ranged rows retain an evidence-based fallback range', () => {
  const state = createBattle(content, spec({
    players: [
      { id: 'p0', name: 'Equipped', team: 0, hp: 30, attack: 1, effects: [1201], deck: Array(5).fill('1') },
      { id: 'p1', name: 'Enemy', team: 1, hp: 30, deck: Array(5).fill('1') },
    ],
    initialUnits: [
      { playerId: 'p0', monsterId: 334, row: 0, col: 2 },
      { playerId: 'p0', monsterId: 127, row: 1, col: 2 },
    ],
  }));
  assert.equal(state.units.find(unit => unit.id === 'hero:p0').flags.armor, 1);
  assert.equal(state.units.find(unit => unit.monsterId === 334).range, 2, 'AttackType 1 has a ranged fallback');
  assert.equal(state.units.find(unit => unit.monsterId === 127).range, 3, 'explicit +2 Range remains exact');
});

test('area type 0 uses rectangles while type 1 uses exact coordinate pairs', () => {
  const skill = content.data.skills['66'].raw;
  const originalAreaId = skill.AreaID;
  const originalDamage = skill.DamValue;
  const areaId = '999999';
  const run = area => {
    content.data.areas[areaId] = area;
    skill.AreaID = Number(areaId);
    let state = createBattle(content, spec({
      players: [
        { id: 'p0', name: 'Caster', team: 0, hp: 30, deck: Array(5).fill('40000') },
        { id: 'p1', name: 'Targets', team: 1, hp: 30, deck: Array(5).fill('1') },
      ],
      initialUnits: [
        { playerId: 'p1', monsterId: 1, row: 1, col: 6 },
        { playerId: 'p1', monsterId: 1, row: 1, col: 7 },
        { playerId: 'p1', monsterId: 1, row: 2, col: 6 },
        { playerId: 'p1', monsterId: 1, row: 1, col: 8 },
      ],
    }));
    const primary = state.units.find(unit => unit.row === 1 && unit.col === 6);
    const play = legalPlays(content, state, 'p0').find(candidate => candidate.targetId === primary.id);
    assert.ok(play);
    state = applyBattleAction(content, state, 'p0', { type: 'play', ...play });
    return state.events.filter(event => event.type === 'damage' && event.skillId === 66).map(event => event.target).sort();
  };
  try {
    skill.DamValue = 1;
    const rectangle = run({ type: 0, '参数1': -1, '参数2': 1, '参数3': -1, '参数4': 1 });
    const exact = run({ type: 1, '参数1': 0, '参数2': 0, '参数3': 2, '参数4': 0 });
    assert.equal(rectangle.length, 3);
    assert.equal(exact.length, 2);
  } finally {
    skill.AreaID = originalAreaId;
    skill.DamValue = originalDamage;
    delete content.data.areas[areaId];
  }
});

test('the authoritative state supports a full four-versus-four encounter', () => {
  const players = [];
  for (let index = 0; index < 4; index += 1) {
    players.push({ id: `left-${index}`, name: `Left ${index}`, team: 0, hp: 30, deck: Array(5).fill('1'), ai: index > 0 });
    players.push({ id: `right-${index}`, name: `Right ${index}`, team: 1, hp: 30, deck: Array(5).fill('1'), ai: true });
  }
  const state = createBattle(content, spec({ players, rows: 4, firstPlayer: 0 }));
  assert.equal(state.players.length, 8);
  assert.deepEqual(state.units.filter(unit => unit.flags.hero === 1 && unit.team === 0).map(unit => unit.row), [0, 1, 2, 3]);
  assert.deepEqual(state.units.filter(unit => unit.flags.hero === 1 && unit.team === 1).map(unit => unit.row), [0, 1, 2, 3]);
  const aiState = structuredClone(state);
  aiState.activePlayer = 1;
  aiState.players[1].hand.forEach(card => { card.wait = 0; });
  assert.equal(chooseAIAction(content, aiState, 'right-0').type, 'play');
});

test('board-clear battles omit the defending hero and settle when every defending unit dies', () => {
  let state = createBattle(content, spec({
    boardClearTeam: 1,
    players: [
      { id: 'p0', name: 'Challenger', team: 0, hp: 20, deck: Array(5).fill('40000') },
      { id: 'defender', name: 'Egg Field', team: 1, hp: 9999, deck: [], ai: true },
    ],
    initialUnits: [{ playerId: 'defender', monsterId: 9119, row: 0, col: 6 }],
  }));
  assert.equal(state.units.some(unit => unit.id === 'hero:defender'), false);
  assert.deepEqual(state.players.find(player => player.id === 'defender')?.hand, []);
  for (let plays = 0; state.status === 'playing' && plays < 5; plays += 1) {
    const play = legalPlays(content, state, 'p0').find(candidate => candidate.targetId?.startsWith('unit:'));
    assert.ok(play);
    state = applyBattleAction(content, state, 'p0', { type: 'play', ...play });
  }
  assert.equal(state.status, 'settled');
  assert.equal(state.winner, 0);
  assert.equal(state.units.some(unit => unit.team === 1 && unit.flags.hero !== 1), false);
});

test('board-clear turn limit is a defense win while a target remains', () => {
  const state = advanceAI(content, createBattle(content, spec({
    boardClearTeam: 1,
    turnLimit: 2,
    players: [
      { id: 'p0', name: 'Challenger', team: 0, hp: 20, deck: Array(6).fill('60001'), ai: true },
      { id: 'defender', name: 'Egg Field', team: 1, hp: 9999, deck: [], ai: true },
    ],
    initialUnits: [{ playerId: 'defender', monsterId: 9119, row: 0, col: 6 }],
  })), 50);
  assert.equal(state.status, 'settled');
  assert.equal(state.winner, 1);
  assert.ok(state.units.some(unit => unit.team === 1 && unit.flags.hero !== 1 && unit.hp > 0));
  assert.equal(state.events.at(-1)?.message, 'turn-limit');
  assert.equal(state.players.find(player => player.id === 'defender')?.fatigue, 0);
});

test('board-clear challenge is lost when the challenger hero dies', () => {
  const state = advanceAI(content, createBattle(content, spec({
    boardClearTeam: 1,
    firstPlayer: 1,
    players: [
      { id: 'p0', name: 'Challenger', team: 0, hp: 1, deck: Array(5).fill('1'), ai: true },
      { id: 'defender', name: 'Guard Field', team: 1, hp: 9999, deck: [], ai: true },
    ],
    initialUnits: [{ playerId: 'defender', monsterId: 43, row: 0, col: 1 }],
  })), 20);
  assert.equal(state.status, 'settled');
  assert.equal(state.winner, 1);
  assert.equal(state.players.find(player => player.id === 'p0')?.hp, 0);
  assert.equal(state.units.some(unit => unit.id === 'hero:p0'), false);
});

test('Type 39 auras follow recovered area, relation and Phyle filters and leave no residual modifiers', () => {
  let state = createBattle(content, spec({
    players: [
      { id: 'p0', name: 'Aura', team: 0, hp: 30, deck: Array(5).fill('1'), effects: [547, 543] },
      { id: 'p1', name: 'Enemy', team: 1, hp: 30, deck: Array(5).fill('1'), ai: true },
    ],
    initialUnits: [
      { playerId: 'p0', monsterId: 315, row: 0, col: 1 },
      { playerId: 'p0', monsterId: 10, row: 1, col: 1 },
      { playerId: 'p1', monsterId: 10, row: 0, col: 8 },
    ],
  }));
  const beast = state.units.find(unit => unit.playerId === 'p0' && unit.monsterId === 315);
  const human = state.units.find(unit => unit.playerId === 'p0' && unit.monsterId === 10);
  const enemy = state.units.find(unit => unit.playerId === 'p1' && unit.monsterId === 10);
  assert.equal(beast.attack, 4, 'adjacent friendly target receives recovered Carol 1');
  assert.equal(beast.maxHp, 14, 'matching Beast receives recovered Life 3');
  assert.equal(human.attack, 3, 'the adjacent aura is not restricted by Phyle');
  assert.equal(human.maxHp, 11, 'the Beast aura excludes a Human');
  assert.equal(enemy.attack, 2, 'friendly-only aura excludes enemies');

  beast.col = 3;
  beast.movement = 0;
  state = applyBattleAction(content, state, 'p0', { type: 'end' });
  const outside = state.units.find(unit => unit.id === beast.id);
  assert.equal(outside.attack, 3, 'leaving the recovered 3x3 area removes the attack modifier');
  assert.equal(outside.maxHp, 14, 'the independent full-field Phyle aura remains');

  outside.col = 1;
  state = applyBattleAction(content, state, 'p1', { type: 'end' });
  assert.equal(state.units.find(unit => unit.id === beast.id)?.attack, 4, 're-entering the area reapplies the aura');

  state = applyBattleAction(content, state, 'p0', { type: 'surrender' });
  const afterSourceDeath = state.units.find(unit => unit.id === beast.id);
  assert.equal(afterSourceDeath.attack, 3);
  assert.equal(afterSourceDeath.maxHp, 11);
  assert.equal(afterSourceDeath.statuses.some(status => status.auraEffectId !== undefined), false);
});

test('Type 39 enemy aura applies and reverses recovered negative HP status', () => {
  let state = createBattle(content, spec({
    players: [
      { id: 'p0', name: 'Witherer', team: 0, hp: 30, deck: Array(5).fill('1'), effects: [505] },
      { id: 'p1', name: 'Enemy', team: 1, hp: 30, deck: Array(5).fill('1'), ai: true },
    ],
    initialUnits: [
      { playerId: 'p0', monsterId: 10, row: 0, col: 1 },
      { playerId: 'p1', monsterId: 10, row: 0, col: 8 },
    ],
  }));
  const friendly = state.units.find(unit => unit.playerId === 'p0' && unit.monsterId === 10);
  const enemy = state.units.find(unit => unit.playerId === 'p1' && unit.monsterId === 10);
  assert.equal(friendly.maxHp, 11);
  assert.equal(enemy.maxHp, 1, 'enemy creature receives recovered Withered 10');
  state = applyBattleAction(content, state, 'p0', { type: 'surrender' });
  assert.equal(state.units.find(unit => unit.id === enemy.id)?.maxHp, 11, 'source death reverses the aura modifier');
});

test('summon, draw, turn, movement, attack, death and skill-play effect hooks change runtime state', () => {
  const effectIds = ['999901', '999902', '999903', '999904', '999905', '999906', '999907'];
  const originalEffects = Object.fromEntries(effectIds.map(id => [id, content.data.effects[id]]));
  const monster = content.data.monsters['1'];
  const attacker = content.data.monsters['43'];
  const originalMonster = { ...monster };
  const originalAttacker = { ...attacker };
  try {
    content.data.effects['999901'] = { EffectID: 999901, TypeID: 140, param1: 1, param2: 100 };
    monster.ability1 = 999901;
    let state = createBattle(content, spec({ initialUnits: [{ playerId: 'p0', monsterId: 1, row: 0, col: 2 }] }));
    const handBefore = state.players[0].hand.length;
    state = applyBattleAction(content, state, 'p0', { type: 'end' });
    assert.ok(state.events.some(event => event.effectId === 999901 && event.message === 'turn-draw'));
    assert.equal(state.players[0].hand.length, handBefore + 1);

    content.data.effects['999902'] = { EffectID: 999902, TypeID: 245, param1: 200, param2: 1 };
    content.data.effects['999903'] = { EffectID: 999903, TypeID: 9, param1: 2 };
    Object.assign(attacker, originalAttacker, { Attack: 5, ability1: 999902, ability2: 999903 });
    Object.assign(monster, originalMonster);
    state = createBattle(content, spec({ initialUnits: [
      { playerId: 'p0', monsterId: 43, row: 0, col: 2 },
      { playerId: 'p1', monsterId: 1, row: 0, col: 6 },
    ] }));
    state = applyBattleAction(content, state, 'p0', { type: 'end' });
    assert.ok(state.events.some(event => event.effectId === 999902 && event.message === 'move-charge'));
    assert.ok(state.events.some(event => event.type === 'damage' && event.amount >= 9), 'move charge doubles the next attack');

    content.data.effects['999904'] = { EffectID: 999904, TypeID: 105, param1: 3, param2: 0, param3: 100 };
    Object.assign(monster, originalMonster, { HP: 1, ability1: 999904 });
    Object.assign(attacker, originalAttacker, { Attack: 10 });
    state = createBattle(content, spec({ initialUnits: [
      { playerId: 'p0', monsterId: 43, row: 0, col: 5 },
      { playerId: 'p1', monsterId: 1, row: 0, col: 6 },
    ] }));
    state = applyBattleAction(content, state, 'p0', { type: 'end' });
    assert.ok(state.events.some(event => event.effectId === 999904 && event.message === 'vengeance'));

    content.data.effects['999905'] = { EffectID: 999905, TypeID: 104, param1: 2, param2: 100 };
    Object.assign(monster, originalMonster, { ability1: 999905 });
    state = createBattle(content, spec({
      players: [
        { id: 'p0', name: 'Caster', team: 0, hp: 30, deck: Array(5).fill('40000') },
        { id: 'p1', name: 'Enemy', team: 1, hp: 30, deck: Array(5).fill('1') },
      ],
      initialUnits: [{ playerId: 'p0', monsterId: 1, row: 0, col: 2 }],
    }));
    state.players[0].hand.forEach(card => { card.wait = 0; });
    const play = legalPlays(content, state, 'p0')[0];
    state = applyBattleAction(content, state, 'p0', { type: 'play', ...play });
    assert.ok(state.events.some(event => event.effectId === 999905 && event.message === 'skill-speed'));

    content.data.effects['999906'] = { EffectID: 999906, TypeID: 122, param1: 2 };
    Object.assign(monster, originalMonster, { ability1: 999906 });
    state = createBattle(content, spec({ players: [
      { id: 'p0', name: 'Summoner', team: 0, hp: 30, deck: Array(5).fill('1') },
      { id: 'p1', name: 'Enemy', team: 1, hp: 30, deck: Array(5).fill('1') },
    ] }));
    const summonPlay = legalPlays(content, state, 'p0')[0];
    state = applyBattleAction(content, state, 'p0', { type: 'play', ...summonPlay });
    assert.ok(state.events.some(event => event.effectId === 999906 && event.message === 'healing-prayer'));

    content.data.effects['999907'] = { EffectID: 999907, TypeID: 174, param1: 2, param2: Number(originalMonster.Phyle ?? 0), param3: 3, param4: 100 };
    Object.assign(attacker, originalAttacker, { Attack: 4, ability1: 999907 });
    Object.assign(monster, originalMonster);
    state = createBattle(content, spec({ initialUnits: [
      { playerId: 'p0', monsterId: 43, row: 0, col: 5 },
      { playerId: 'p1', monsterId: 1, row: 0, col: 6 },
    ] }));
    state = applyBattleAction(content, state, 'p0', { type: 'end' });
    assert.ok(state.events.some(event => event.type === 'damage' && event.amount >= 10), 'race multiplier changes live damage');
  } finally {
    Object.assign(monster, originalMonster);
    Object.assign(attacker, originalAttacker);
    for (const id of effectIds) {
      if (originalEffects[id] === undefined) delete content.data.effects[id];
      else content.data.effects[id] = originalEffects[id];
    }
  }
});

test('every recovered monster can enter an authoritative battle without malformed optional parameters crashing', () => {
  const ids = Object.keys(content.data.monsters).filter(id => Number(id) > 0);
  for (const id of ids) {
    const state = createBattle(content, spec({
      players: [
        { id: 'p0', name: 'Audit', team: 0, hp: 30, deck: Array(5).fill('1') },
        { id: 'p1', name: 'Enemy', team: 1, hp: 30, deck: Array(5).fill('1') },
      ],
      initialUnits: [{ playerId: 'p0', monsterId: Number(id), row: 0, col: 2 }],
    }));
    const unit = state.units.find(candidate => candidate.monsterId === Number(id));
    assert.ok(unit, `monster ${id}`);
    assert.equal(Object.keys(unit.flags).some(key => key.startsWith('descriptionEffectType:') || key.startsWith('unresolvedEffectType:')), false, `monster ${id} uses only explicit TypeID rules`);
  }
  assert.equal(ids.length, 8265);
});

test('all status-linked effect families use explicit TypeID compatibility rules', () => {
  const monster = content.data.monsters['1'];
  const original = { ...monster };
  try {
    for (const [statusId, status] of Object.entries(content.data.statuses)) {
      for (let index = 1; index <= 5; index += 1) monster[`ability${index}`] = status[`Effect${index}`] ?? 0;
      const state = createBattle(content, spec({ initialUnits: [{ playerId: 'p0', monsterId: 1, row: 0, col: 2 }] }));
      const unit = state.units.find(candidate => candidate.monsterId === 1 && candidate.flags.hero !== 1);
      assert.ok(unit, `status ${statusId}`);
      assert.equal(Object.keys(unit.flags).some(key => key.startsWith('descriptionEffectType:') || key.startsWith('unresolvedEffectType:')), false, `status ${statusId}`);
    }
  } finally {
    Object.assign(monster, original);
  }
});

test('all recovered nonzero ServerClass skill cards are legal and execute in a populated battle', () => {
  const executedClasses = new Set();
  let executedCards = 0;
  for (const [cardId, card] of Object.entries(content.data.cards)) {
    if (Number(card.raw.Type) !== 2) continue;
    const skillId = String(card.raw.SkillID);
    const raw = content.data.skills[skillId]?.raw;
    const serverClass = Number(raw?.ServerClassID ?? 0);
    if (!raw || serverClass <= 0) continue;
    let state = createBattle(content, spec({
      players: [
        { id: 'p0', name: 'Caster', team: 0, hp: 300, attack: 5, deck: Array(5).fill(cardId) },
        { id: 'p1', name: 'Target', team: 1, hp: 300, attack: 5, deck: Array(5).fill('1') },
      ],
      initialUnits: [
        { playerId: 'p0', monsterId: 1, row: 1, col: 3 },
        { playerId: 'p1', monsterId: 1, row: 1, col: 6 },
        { playerId: 'p1', monsterId: 43, row: 2, col: 6 },
      ],
    }));
    state.players[0].hand.forEach(hand => { hand.wait = 0; });
    const play = legalPlays(content, state, 'p0')[0];
    assert.ok(play, `ServerClass ${serverClass} card ${cardId} is legal`);
    assert.doesNotThrow(() => applyBattleAction(content, state, 'p0', { type: 'play', ...play }));
    executedClasses.add(serverClass);
    executedCards += 1;
  }
  assert.equal(executedCards, 292);
  assert.deepEqual([...executedClasses].sort((a, b) => a - b), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32, 33, 35, 36, 37, 38, 39, 44]);
});

test('every recovered nonzero ServerClassID has an executable authoritative path', () => {
  const firstSkillByClass = new Map();
  for (const [skillId, skill] of Object.entries(content.data.skills)) {
    const serverClass = Number(skill.raw?.ServerClassID ?? 0);
    if (serverClass > 0 && !firstSkillByClass.has(serverClass)) firstSkillByClass.set(serverClass, skillId);
  }
  const cardId = '999999';
  const template = content.data.cards['40000'];
  try {
    for (const [serverClass, skillId] of firstSkillByClass) {
      content.data.cards[cardId] = {
        ...template,
        id: `main:card:${cardId}`,
        sourceId: `main:card:${cardId}`,
        raw: { ...template.raw, ID: Number(cardId), SkillID: Number(skillId), InitReady: 0 },
      };
      let state = createBattle(content, spec({
        players: [
          { id: 'p0', name: 'Caster', team: 0, hp: 300, attack: 5, deck: Array(5).fill(cardId) },
          { id: 'p1', name: 'Target', team: 1, hp: 300, attack: 5, deck: Array(5).fill('1') },
        ],
        initialUnits: [
          { playerId: 'p0', monsterId: 1, row: 1, col: 3 },
          { playerId: 'p1', monsterId: 1, row: 1, col: 6 },
          { playerId: 'p1', monsterId: 43, row: 2, col: 6 },
        ],
      }));
      const play = legalPlays(content, state, 'p0')[0];
      assert.ok(play, `ServerClass ${serverClass} has a legal action`);
      assert.doesNotThrow(() => applyBattleAction(content, state, 'p0', { type: 'play', ...play }), `ServerClass ${serverClass}`);
    }
  } finally {
    delete content.data.cards[cardId];
  }
  assert.deepEqual([...firstSkillByClass.keys()].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 41, 42, 43, 44, 46, 47]);
});

test('recovered monster-only normal ServerClass algorithms execute through the shared attack path', () => {
  const representatives = [145, 511, 526, 1103, 3169, 4178, 9133, 9577];
  for (const monsterId of representatives) {
    let state = createBattle(content, spec({
      players: [
        { id: 'p0', name: 'Attacker', team: 0, hp: 300, deck: ['1', '2', '3', '4', '5'] },
        { id: 'p1', name: 'Target', team: 1, hp: 300, deck: ['1', '2', '3', '4', '5'] },
      ],
      initialUnits: [
        { playerId: 'p0', monsterId, row: 1, col: 5 },
        { playerId: 'p1', monsterId: 1, row: 1, col: 6 },
      ],
    }));
    const attacker = state.units.find(unit => unit.monsterId === monsterId);
    state = applyBattleAction(content, state, 'p0', { type: 'end' });
    assert.ok(state.events.some(event => event.type === 'attack' && event.actor === attacker.id && event.skillId === attacker.flags.normalSkillId), `monster ${monsterId}`);
  }
});
