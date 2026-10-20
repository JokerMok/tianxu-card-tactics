import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerContent } from './content.mjs';
import {
  competitionActions,
  competitionView,
  onCompetitionSettled,
  operateCompetition,
  tournamentDeck,
} from './competition-systems.mjs';
import { combatBonuses, growthView, operateGrowth } from './growth-systems.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const content = new ServerContent(path.resolve(here, '../../cocos-client/assets/resources/recovered'));
const NOW = Date.UTC(2026, 9, 20, 8);

function character(id = 'c1', overrides = {}) {
  return {
    id, accountId: `account-${id}`, name: id, profession: 1, level: 20, xp: 0,
    currencies: { silver: 2_000, gold: 20, crystal: 0 },
    cards: {}, inventory: {}, equipment: {}, enhancements: {}, warehouse: {},
    progress: { clearedTriggers: [], clearedNodes: [], unlockedScenes: [1], positionByScene: {} },
    stats: { battles: 0, pveWins: 0, pvpMatches: 0 }, claimed: [], economicLog: [],
    settings: { music: true, sound: true }, createdAt: NOW, lastLogin: NOW,
    ...overrides,
  };
}

function setup(actor = character()) {
  const opponent = character('c2');
  const world = { characters: { [actor.id]: actor, [opponent.id]: opponent } };
  let random = 0;
  const ctx = { world, actor, content, tables: content.tables, now: NOW,
    randomInt(max) { const value = random % max; random += 17; return value; } };
  return { actor, opponent, world, ctx };
}

function tournamentRecord(actor, opponent, tournamentId, opponentAI = false) {
  return {
    id: `match-${Math.random()}`,
    mode: 'tournament',
    tournamentId,
    participants: [actor.id, opponent.id],
    state: { players: [{ id: actor.id, ai: false }, { id: opponent.id, ai: opponentAI }] },
  };
}

test('exports a complete menu contract and full source-backed collection catalog', () => {
  const { ctx } = setup();
  assert.deepEqual(competitionActions, [
    'tournament.register', 'tournament.deck.save', 'tournament.claim', 'collection.claim',
  ]);
  const view = competitionView(ctx);
  assert.deepEqual(view.sections.map(section => section.id), ['tournament', 'collection']);
  assert.equal(view.collection.sourceComplete, true);
  assert.equal(view.collection.totalGroups, 18);
  assert.ok(view.collection.totalCards > 1_000);
  assert.equal(view.collection.groups.length, view.collection.totalGroups);
  assert.equal(view.collection.groups.reduce((sum, group) => sum + group.cards.length, 0), view.collection.totalCards);
  assert.ok(view.collection.groups.every(group => group.cards.every(card => /^main:card:\d+$/.test(card.id))));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(view)));
});

test('collection parent mapping, threshold, and source card rewards are persistent and non-empty', () => {
  const { actor, ctx } = setup();
  const human = competitionView(ctx).collection.groups.find(group => group.id === 1010100);
  assert.equal(human.title, 'Human');
  assert.equal(human.threshold, 75);
  assert.equal(human.total, 137);
  assert.deepEqual(human.reward.cards, ['main:card:63', 'main:card:94', 'main:card:124', 'main:card:35']);

  const needed = Math.ceil(human.total * human.threshold / 100);
  for (const card of human.cards.slice(0, needed)) actor.cards[card.id] = 1;
  const ready = competitionView(ctx).collection.groups.find(group => group.id === human.id);
  assert.equal(ready.ready, true);
  assert.ok(ready.percent >= 75);
  const before = Object.fromEntries(ready.reward.cards.map(id => [id, actor.cards[id] ?? 0]));
  const claimed = operateCompetition(ctx, 'collection.claim', { groupId: human.id });
  assert.deepEqual(claimed.reward, ready.reward);
  assert.ok(actor.competition.collectionClaims.includes(human.id));
  for (const id of ready.reward.cards) assert.equal(actor.cards[id], before[id] + 1);
  assert.throws(() => operateCompetition(ctx, 'collection.claim', { groupId: human.id }), /未达成或已领取/);
});

test('registration opens three source-valid packs, auto-builds ten cards, and keeps draft cards temporary', () => {
  const { actor, ctx } = setup();
  const permanentCards = structuredClone(actor.cards);
  const registered = operateCompetition(ctx, 'tournament.register');
  assert.deepEqual(registered.entry, { currency: 'silver', amount: 120 });
  assert.equal(actor.currencies.silver, 1_880);
  assert.deepEqual(registered.packs.map(pack => pack.length), [10, 10, 10]);
  assert.equal(new Set(registered.packs.flat()).size, 30);
  assert.equal(tournamentDeck(ctx).length, 10);
  assert.deepEqual(actor.cards, permanentCards);

  const view = competitionView(ctx);
  assert.equal(view.tournament.pool.length, 30);
  assert.equal(view.tournament.draftStats.total, 30);
  const deckField = view.sections.find(section => section.id === 'tournament').items
    .find(item => item.action === 'tournament.deck.save').fields[0];
  assert.equal(deckField.type, 'card-multiselect');
  assert.equal(deckField.options.length, 30);
  assert.deepEqual(deckField.value, tournamentDeck(ctx));

  const replacement = view.tournament.pool.slice(-10).map(card => card.id);
  operateCompetition(ctx, 'tournament.deck.save', { cards: replacement });
  assert.deepEqual(tournamentDeck(ctx), replacement);
  assert.throws(() => operateCompetition(ctx, 'tournament.deck.save', { cards: [...replacement.slice(0, 9), 'main:card:999999'] }), /未开出的卡牌/);
});

test('three real-player wins end a run and claim the AthleticsPrize package exactly once', () => {
  const { actor, opponent, ctx } = setup();
  operateCompetition(ctx, 'tournament.register');
  const permanentCards = structuredClone(actor.cards);
  const tournamentId = actor.competition.tournament.id;

  const first = tournamentRecord(actor, opponent, tournamentId);
  onCompetitionSettled(ctx, first, true);
  onCompetitionSettled(ctx, first, true);
  assert.deepEqual([actor.competition.tournament.matches, actor.competition.tournament.wins], [1, 1]);
  onCompetitionSettled(ctx, tournamentRecord(actor, opponent, tournamentId), true);
  onCompetitionSettled(ctx, tournamentRecord(actor, opponent, tournamentId), true);

  const tournament = actor.competition.tournament;
  assert.equal(tournament.status, 'claimable');
  assert.deepEqual([tournament.wins, tournament.losses, tournament.matches], [3, 0, 3]);
  assert.deepEqual(tournament.reward, {
    itemId: 3001, quantity: 1, onlinePrizeTableGroup: 54, flips: 3, tier: 1, sourceWinTime: 3,
  });
  assert.deepEqual(actor.cards, permanentCards);

  const claimed = operateCompetition(ctx, 'tournament.claim');
  assert.equal(claimed.reward.itemId, 3001);
  assert.equal(actor.inventory['main:item:3001'], 1);
  assert.equal(actor.competition.history.length, 1);
  assert.throws(() => operateCompetition(ctx, 'tournament.claim'), /尚不可领取/);
});

test('three losses use the zero-win source row and AI opponents cannot settle tournament progress', () => {
  const { actor, opponent, ctx } = setup();
  operateCompetition(ctx, 'tournament.register');
  const tournamentId = actor.competition.tournament.id;
  const aiRecord = tournamentRecord(actor, opponent, tournamentId, true);
  assert.throws(() => onCompetitionSettled(ctx, aiRecord, false), /两名真实玩家/);
  assert.equal(actor.competition.tournament.matches, 0);

  for (let index = 0; index < 3; index += 1) onCompetitionSettled(ctx, tournamentRecord(actor, opponent, tournamentId), false);
  assert.equal(actor.competition.tournament.status, 'claimable');
  assert.deepEqual(actor.competition.tournament.reward, {
    itemId: 3001, quantity: 1, onlinePrizeTableGroup: 0, flips: 0, tier: 1, sourceWinTime: 0,
  });
});

test('Appell source titles are fully listed and their four abilities enter combat effects', () => {
  const actor = character('c1', {
    growth: { titles: ['novice', 'item-title:2'], titleExpiries: {}, activeTitle: 'item-title:2' },
  });
  const { ctx } = setup(actor);
  const view = growthView(ctx);
  const titleItems = view.sections.find(section => section.id === 'progression').items
    .filter(item => item.label.startsWith('装备原版称号：'));
  assert.equal(titleItems.length, 13);
  assert.notEqual(titleItems.find(item => item.payload.titleId === 'item-title:2').disabled, true);
  assert.equal(titleItems.find(item => item.payload.titleId === 'item-title:3').disabled, true);

  operateGrowth(ctx, 'title.equip', { titleId: 'item-title:2' });
  const bonus = combatBonuses(ctx);
  assert.deepEqual(new Set(bonus.effects), new Set([50101, 50501, 50301, 50401]));

  actor.growth.titleExpiries['item-title:2'] = NOW - 1;
  assert.equal(combatBonuses(ctx).effects, undefined);
});
