import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerContent } from './content.mjs';
import { leagueActions, leagueView, onLeagueSettled, operateLeague, tickLeague, validateLeagueRoom } from './league-systems.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const content = new ServerContent(path.resolve(here, '../../cocos-client/assets/resources/recovered'));
const MONDAY = Date.parse('2026-10-19T00:00:00+08:00');

function actor(id, guildId, overrides = {}) {
  return {
    id, accountId: `account-${id}`, name: id, guildId, rating: 1000, wins: 0, losses: 0,
    currencies: { silver: 0, gold: 0, crystal: 0 }, inventory: {}, cards: {}, economicLog: [], ...overrides,
  };
}

function setup() {
  const a = actor('a', 'g1', { rating: 1400 }); const b = actor('b', 'g2', { rating: 1200 }); const c = actor('c', 'g1');
  const world = {
    characters: { a, b, c },
    guilds: {
      g1: { id: 'g1', name: '甲会', leader: 'a', members: ['a', 'c'], treasury: 0, contributions: { a: 0, c: 700 } },
      g2: { id: 'g2', name: '乙会', leader: 'b', members: ['b'], treasury: 0, contributions: { b: 0 } },
    },
  };
  return { world, a, b, c };
}

function ctx(world, who, now = MONDAY + 12 * 3_600_000, extra = {}) {
  return { world, actor: who, content, tables: content.tables, now, randomInt: () => 0, ...extra };
}

function record(mode, a, b, options = {}) {
  return {
    id: options.id ?? `${mode}-1`, mode, territoryId: options.territoryId,
    participants: [a.id, b.id],
    state: { winner: options.winner ?? 0, players: [
      { id: a.id, team: 0, ai: options.aiA ?? false },
      { id: b.id, team: 1, ai: options.aiB ?? false },
    ] },
  };
}

test('exports renderable actions, Beijing Monday boundaries, and source-backed territories', () => {
  const { world, a } = setup();
  assert.deepEqual(leagueActions, ['league.reward.claim', 'clanwar.register', 'clanwar.reward.claim']);
  const view = leagueView(ctx(world, a));
  assert.equal(view.season.startAt, MONDAY);
  assert.equal(view.season.endAt, MONDAY + 7 * 86_400_000);
  assert.deepEqual(view.season.ratingReset, { center: 1000, retain: 0.5 });
  assert.ok(view.clanWar.territories.length >= 1);
  assert.ok(view.clanWar.territories.every(entry => /^main:clan-activity:\d+$/.test(entry.id) && entry.sourcePath));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(view)));
});

test('ranked settlement is idempotent, rejects AI, closes on the real week boundary, and claims once', () => {
  const { world, a, b } = setup(); const match = record('ranked', a, b);
  onLeagueSettled(ctx(world, a), match, true);
  onLeagueSettled(ctx(world, a), match, true);
  onLeagueSettled(ctx(world, b), match, false);
  assert.deepEqual(world.league.current.ranked.participants.a, { matches: 1, wins: 1, losses: 0 });
  assert.throws(() => onLeagueSettled(ctx(world, a), record('ranked', a, b, { aiB: true, id: 'ai' }), true), /两名真实玩家/);

  const before = MONDAY + 7 * 86_400_000 - 1;
  assert.equal(tickLeague(world, content.tables, before), false);
  assert.equal(a.rating, 1400);
  assert.equal(tickLeague(world, content.tables, before + 1), true);
  assert.equal(world.league.history.length, 1);
  assert.deepEqual(world.league.history[0].ranked.map(entry => entry.id), ['a', 'b']);
  assert.equal(a.rating, 1200);
  assert.equal(b.rating, 1100);
  assert.equal(a.league.pendingRewards[0].reward.gold, 1000);
  assert.equal(a.league.pendingRewards[0].reward.honor, 500);
  assert.deepEqual(a.league.pendingRewards[0].reward.items, [{ id: 20002, count: 1 }]);

  const result = operateLeague(ctx(world, a, before + 1), 'league.reward.claim');
  assert.equal(result.reward.gold, 1000);
  assert.equal(a.currencies.gold, 1000);
  assert.equal(a.currencies.honor, 500);
  assert.equal(a.inventory['main:item:20002'], 1);
  assert.throws(() => operateLeague(ctx(world, a, before + 1), 'league.reward.claim'), /没有可领取/);
  assert.equal(tickLeague(world, content.tables, before + 1), false);
  assert.equal(world.league.history.length, 1);
});

test('clan registration requires the leader and a valid source territory', () => {
  const { world, a, c } = setup();
  const territoryId = leagueView(ctx(world, a)).clanWar.territories[0].id;
  assert.throws(() => operateLeague(ctx(world, c), 'clanwar.register', { territoryId }), /会长权限/);
  assert.throws(() => operateLeague(ctx(world, a), 'clanwar.register', { territoryId: 'local:invented' }), /领地无效/);
  const registered = operateLeague(ctx(world, a), 'clanwar.register', { territoryId });
  assert.equal(registered.territory.id, territoryId);
  operateLeague(ctx(world, a), 'clanwar.register', { territoryId });
  assert.deepEqual(world.league.current.clan.registrations[territoryId], ['g1']);
});

test('clan rooms require two registered real players from different guilds', () => {
  const { world, a, b, c } = setup();
  const territoryId = leagueView(ctx(world, a)).clanWar.territories[0].id;
  operateLeague(ctx(world, a), 'clanwar.register', { territoryId });
  assert.throws(() => validateLeagueRoom(ctx(world, a, undefined, { mode: 'clan-war', territoryId }), b), /尚未报名/);
  operateLeague(ctx(world, b), 'clanwar.register', { territoryId });
  assert.equal(validateLeagueRoom(ctx(world, a, undefined, { mode: 'clan-war', territoryId }), b), true);
  assert.throws(() => validateLeagueRoom(ctx(world, a, undefined, { mode: 'clan-war', territoryId }), c), /不同公会/);
  assert.throws(() => validateLeagueRoom(ctx(world, a, undefined, { mode: 'clan-war', territoryId }), { ...b, ai: true }), /真实玩家/);
});

test('real clan battle records drive score, territory control, season rewards, and duplicate protection', () => {
  const { world, a, b, c } = setup();
  const territoryId = leagueView(ctx(world, a)).clanWar.territories[0].id;
  operateLeague(ctx(world, a), 'clanwar.register', { territoryId });
  operateLeague(ctx(world, b), 'clanwar.register', { territoryId });
  const battle = record('clan-war', a, b, { territoryId });
  onLeagueSettled(ctx(world, a), battle, true);
  onLeagueSettled(ctx(world, b), battle, false);
  assert.equal(world.league.current.clan.standings[territoryId].g1.score, 3);
  assert.equal(world.league.current.clan.standings[territoryId].g2.score, 1);
  assert.equal(world.league.controllers[territoryId], 'g1');
  assert.equal(world.league.current.clan.standings[territoryId].g1.matches, 1);

  const boundary = MONDAY + 7 * 86_400_000;
  tickLeague(world, content.tables, boundary);
  assert.equal(world.guilds.g1.treasury, 50_000);
  assert.equal(world.guilds.g2.treasury, 30_000);
  assert.ok(a.league.pendingRewards.some(entry => entry.kind === 'clan' && entry.reward.silver === 22_000));
  assert.ok(b.league.pendingRewards.some(entry => entry.kind === 'clan' && entry.reward.silver === 15_000));
  assert.ok(c.league.pendingRewards.some(entry => entry.kind === 'clan' && entry.reward.source.kind === 'member'));

  const claimed = operateLeague(ctx(world, a, boundary), 'clanwar.reward.claim');
  assert.equal(claimed.reward.crystal, 9000);
  assert.equal(a.currencies.silver, 22_000);
  assert.equal(a.currencies.crystal, 9000);
  assert.equal(a.inventory['main:item:1100'], 1);
  assert.equal(world.guilds.g1.contributions.a, 1000);
  assert.throws(() => operateLeague(ctx(world, a, boundary), 'clanwar.reward.claim'), /没有可领取/);
});

test('clan settlement rejects AI and unregistered or invalid territory records', () => {
  const { world, a, b } = setup();
  const territoryId = leagueView(ctx(world, a)).clanWar.territories[0].id;
  operateLeague(ctx(world, a), 'clanwar.register', { territoryId });
  operateLeague(ctx(world, b), 'clanwar.register', { territoryId });
  assert.throws(() => onLeagueSettled(ctx(world, a), record('clan-war', a, b, { territoryId, aiB: true }), true), /两名真实玩家/);
  assert.throws(() => onLeagueSettled(ctx(world, a), record('clan-war', a, b, { territoryId: 'bad' }), true), /领地无效/);
});
