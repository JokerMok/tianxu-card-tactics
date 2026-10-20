import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onPveAction, onPveBattleSettled, operatePve, pveActionSnapshot, pveActions, pveView, tickPve } from './pve-systems.mjs';
import { operateGrowth } from './growth-systems.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const recovered = path.resolve(here, '../../cocos-client/assets/resources/recovered');
const catalog = JSON.parse(fs.readFileSync(path.join(recovered, 'catalog.json'), 'utf8'));
const tables = {};
for (const [key, entry] of Object.entries(catalog.tables)) {
  if (!key.startsWith('main:')) continue;
  tables[key.slice(5).toLowerCase()] = JSON.parse(fs.readFileSync(path.join(recovered, entry.path), 'utf8')).rows;
}

const atCst = (hour, minute = 0) => Date.UTC(2026, 9, 20, hour - 8, minute);

function character(id = 'c1') {
  return { id, accountId: 'a1', name: id, level: 20, xp: 0, profession: 1,
    currencies: { silver: 50_000, gold: 500, crystal: 0 }, inventory: {}, cards: {}, deck: [],
    progress: { clearedTriggers: [], clearedNodes: [], unlockedScenes: [1], positionByScene: {} },
    stats: { battles: 0, pveWins: 0, pvpMatches: 0 }, claimed: [], economicLog: [] };
}

function setup(now = atCst(12, 10)) {
  const actor = character();
  const world = { characters: { c1: actor }, rooms: {}, battles: {}, guilds: {}, friendships: [], pve: undefined };
  const content = { grantExperience(target, amount) { target.xp += amount; } };
  return { world, actor, ctx: { world, actor, tables, content, now, randomInt: () => 0 } };
}

test('exports a unique action contract and a source-backed renderable view', () => {
  const { ctx } = setup();
  assert.equal(new Set(pveActions).size, pveActions.length);
  for (const action of ['tower.challenge', 'worldBoss.challenge', 'worldBoss.reward.claim', 'forbidden.challenge', 'forbidden.shop.buy', 'forbidden.reward.claim', 'task.claim']) {
    assert.ok(pveActions.includes(action));
  }
  const view = pveView(ctx);
  assert.equal(view.version, 1);
  assert.deepEqual(view.sections.map(section => section.id), ['tower', 'world-boss', 'forbidden', 'quest-operations', 'tasks']);
  assert.ok(view.groups.length > 300);
  assert.ok(view.groups.flatMap(group => group.tasks).some(task => task.description.length > 20));
  assert.ok(view.sections.every(section => section.items.every(item => pveActions.includes(item.action))));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(view)));
});

test('task view returns every eligible source task without a server-side display cap', () => {
  const { ctx, actor } = setup();
  actor.level = 100;
  const view = pveView(ctx);
  assert.equal(view.groups.flatMap(group => group.tasks).length, 1236);
  assert.ok(view.sections.find(section => section.id === 'tasks').items.length > 100);
  assert.equal(view.groups.at(-1).tasks[0].id, 36905);
});

test('tower challenge uses TownLayouts enemy pool, prices and settlement rewards', () => {
  const { ctx, actor } = setup();
  const before = actor.currencies.silver;
  const started = operatePve(ctx, 'tower.challenge', { mode: 'normal' });
  assert.equal(started.start.mode, 'tower');
  assert.equal(started.start.mapId, 99);
  assert.equal(started.start.enemies[0].monsterId, 3001);
  assert.equal(actor.currencies.silver, before - 2);
  const record = { pve: started.start.pve, state: { winner: 0 } };
  assert.equal(onPveBattleSettled(ctx, record, true), true);
  assert.equal(actor.pve.tower.nextNormal, 2);
  assert.equal(actor.pve.tasks.counters.towerWins, 1);
  assert.deepEqual(record.pveReward, { silver: 30, xp: 6, milestone: null });
});

test('tower refresh and reset enforce source costs and progression', () => {
  const { ctx, actor } = setup();
  const refreshed = operatePve(ctx, 'tower.refresh', { mode: 'normal' });
  assert.equal(refreshed.result.monsterId, 3001);
  assert.equal(actor.currencies.silver, 49_999);
  actor.pve.tower.highestNormal = 5;
  actor.pve.tower.nextNormal = 6;
  const reset = operatePve(ctx, 'tower.reset', { mode: 'normal' });
  assert.equal(reset.result.nextLayer, 1);
  assert.equal(reset.result.price, 30);
});

test('invalid infernal layout candidates map deterministically to real configured monsters', () => {
  const { ctx, actor } = setup();
  pveView(ctx);
  const started = operatePve(ctx, 'tower.challenge', { mode: 'infernal' });
  const enemy = started.start.enemies[0];
  assert.equal(enemy.sourceId, 50027);
  assert.equal(enemy.mapped, true);
  const monsterRows = tables['embeddata/scp/monster.xml'];
  assert.ok(monsterRows.some(row => row.ID === enemy.monsterId));
  assert.notEqual(enemy.monsterId, enemy.sourceId);
  assert.equal(actor.pve.tower.nextInfernal, 501);
});

test('world boss keeps shared HP, per-player contribution and source schedule', () => {
  const { ctx, world, actor } = setup(atCst(12, 10));
  const started = operatePve(ctx, 'worldBoss.challenge');
  assert.equal(started.start.mode, 'world-boss');
  assert.equal(started.start.mapId, 1002);
  assert.equal(started.start.enemies[0].monsterId, 66111);
  assert.equal(world.pve.worldBoss['2026-10-20:0'].hp, 450);
  const record = { pve: { ...started.start.pve, damageDealt: 37 }, state: {} };
  onPveBattleSettled(ctx, record, false);
  assert.equal(world.pve.worldBoss['2026-10-20:0'].hp, 413);
  assert.equal(actor.pve.worldBoss.contributions['2026-10-20:0'], 37);
  assert.equal(record.pveReward.damage, 37);
});

test('world boss missing or zero damage evidence awards exactly zero damage', () => {
  const { ctx, world, actor } = setup(atCst(12, 10));
  const first = operatePve(ctx, 'worldBoss.challenge');
  const missing = { pve: first.start.pve, state: {} };
  onPveBattleSettled(ctx, missing, true);
  assert.equal(world.pve.worldBoss['2026-10-20:0'].hp, 450);
  assert.equal(actor.pve.worldBoss.contributions['2026-10-20:0'], undefined);
  assert.equal(missing.pveReward.damage, 0);

  const second = operatePve(ctx, 'worldBoss.challenge');
  const zero = { pve: { ...second.start.pve, damageDealt: 0 }, state: {} };
  onPveBattleSettled(ctx, zero, false);
  assert.equal(world.pve.worldBoss['2026-10-20:0'].hp, 450);
  assert.equal(zero.pveReward.damage, 0);
});

test('world boss level and hire gates use recovered values', () => {
  const { ctx, actor } = setup(atCst(19, 10));
  actor.level = 19;
  assert.throws(() => operatePve(ctx, 'worldBoss.challenge'), /等级20/);
  actor.level = 20;
  operatePve(ctx, 'worldBoss.hire', { id: 1 });
  assert.equal(actor.currencies.gold, 485);
  assert.throws(() => operatePve(ctx, 'worldBoss.hire', { id: 1 }), /已雇佣/);
});

test('world boss caps the allied side at three hired mercenaries', () => {
  const { ctx, actor } = setup(atCst(19, 10));
  for (const id of [1, 2, 3]) operatePve(ctx, 'worldBoss.hire', { id });
  const gold = actor.currencies.gold;
  assert.throws(() => operatePve(ctx, 'worldBoss.hire', { id: 4 }), /最多雇佣三名/);
  assert.equal(actor.currencies.gold, gold);
  assert.equal(operatePve(ctx, 'worldBoss.challenge').start.allies.length, 3);
});

test('forbidden land follows visibility/open schedule, score ranking and source shop', () => {
  const early = setup(atCst(18, 40));
  const earlyView = pveView(early.ctx);
  assert.equal(earlyView.sections.find(section => section.id === 'forbidden').items[0].disabled, true);
  early.ctx.now = atCst(19, 30);
  const started = operatePve(early.ctx, 'forbidden.challenge');
  assert.equal(started.start.enemies[0].arrangementId, 250101002);
  assert.equal(started.start.enemies[0].hpMultiplier, 5);
  const record = { pve: started.start.pve, state: {} };
  onPveBattleSettled(early.ctx, record, true);
  assert.equal(early.actor.pve.forbidden.score, 6);
  assert.equal(early.world.pve.forbidden['2026-10-20'].rankings.c1, 6);
  operatePve(early.ctx, 'forbidden.shop.buy', { offerId: 'soul:9179' });
  assert.equal(early.actor.inventory['main:item:9179'], 1);
  assert.equal(early.actor.pve.forbidden.score, 4);
});

test('Task.xml hierarchy drives eligibility, progress and exact source rewards', () => {
  const { ctx, actor } = setup();
  actor.progress.clearedTriggers.push('main:scene:1:trigger:103001');
  const view = pveView(ctx);
  const sourceTask = view.groups.flatMap(group => group.tasks).find(task => task.id === 1);
  assert.equal(sourceTask.ready, true);
  assert.equal(sourceTask.reward.silver, 500);
  const claimed = operatePve(ctx, 'task.claim', { taskId: 1 });
  assert.equal(claimed.result.taskId, 1);
  assert.equal(actor.currencies.silver, 50_500);
  assert.equal(actor.xp, 35);
  assert.equal(actor.inventory['main:item:10202'], 1);
  assert.throws(() => operatePve(ctx, 'task.claim', { taskId: 1 }), /已领取/);
});

test('regular campaign settlement feeds source task hooks once from actual evidence', () => {
  const { ctx, actor } = setup();
  const record = { mode: 'pve', level: { sceneId: 'main:scene:1', nodeId: 'n', triggerId: 'main:scene:1:trigger:103001' },
    killedMonsters: { c1: { 9081: 2 } } };
  assert.equal(onPveBattleSettled(ctx, record, true), true);
  assert.equal(onPveBattleSettled(ctx, record, true), false);
  assert.equal(actor.pve.tasks.counters.pveBattles, 1);
  assert.equal(actor.pve.tasks.counters.pveWins, 1);
  assert.equal(actor.pve.tasks.counters.triggers[103001], 1);
  assert.equal(actor.pve.tasks.counters.monsterKills[9081], 2);
});

test('scheduler persists source-backed world boss and forbidden reward eligibility for explicit claim', () => {
  const { ctx, world, actor } = setup(atCst(12, 10));
  const boss = operatePve(ctx, 'worldBoss.challenge');
  onPveBattleSettled(ctx, { pve: { ...boss.start.pve, damageDealt: 25 }, state: {} }, false);
  assert.equal(tickPve(world, tables, atCst(13, 1)), true);
  const bossSeason = world.pve.worldBoss['2026-10-20:0'];
  assert.equal(bossSeason.rankings[0].actorId, 'c1');
  assert.deepEqual(bossSeason.rewardEligibility.c1.map(prize => prize.rankType), [6, 1]);
  ctx.now = atCst(13, 2);
  operatePve(ctx, 'worldBoss.reward.claim', { seasonKey: bossSeason.key });
  assert.equal(actor.inventory['main:item:1668'], 1);
  assert.equal(actor.currencies.silver, 50_005);

  ctx.now = atCst(19, 30);
  const forbidden = operatePve(ctx, 'forbidden.challenge');
  onPveBattleSettled(ctx, { pve: forbidden.start.pve, state: {} }, true);
  assert.equal(tickPve(world, tables, atCst(21, 1)), true);
  const season = world.pve.forbidden['2026-10-20'];
  assert.equal(season.rewardEligibility.c1.rank, 1);
  ctx.now = atCst(21, 2);
  const claim = operatePve(ctx, 'forbidden.reward.claim', { seasonKey: season.key });
  assert.equal(claim.result.entitlement.prizeTableId, 211);
  assert.deepEqual(claim.result.granted, [{ type: 'item', itemId: 9182, count: 1 }]);
  assert.equal(actor.inventory['main:item:9182'], 1);
  assert.equal(actor.pve.forbidden.onlinePrizeEntitlements.length, 1);
  assert.throws(() => operatePve(ctx, 'forbidden.reward.claim', { seasonKey: season.key }), /已领取/);
});

test('source-backed task operations require real time, currency and daily limits', () => {
  const { ctx, actor } = setup();
  actor.growth = { energy: 0, city: { buildings: { castle: { level: 2, readyAt: 0 } }, lastTaxDay: -1 }, pets: {} };
  const started = operatePve(ctx, 'quest.explore.start', { islandId: 1, hours: 1 });
  assert.equal(started.result.exploration.readyAt, ctx.now + 3_600_000);
  assert.throws(() => operatePve(ctx, 'quest.explore.claim'), /尚未完成/);
  ctx.now += 3_600_000;
  const claimed = operatePve(ctx, 'quest.explore.claim');
  assert.equal(claimed.result.islandId, 1);
  assert.equal(actor.pve.tasks.counters.explorations['1'], 1);
  assert.ok(actor.currencies.silver > 50_000);

  const gold = actor.currencies.gold;
  const energy = operatePve(ctx, 'quest.energy.buy');
  assert.equal(energy.result.gained, 10);
  assert.equal(actor.currencies.gold, gold - 1);
  assert.equal(actor.pve.tasks.counters.energyPurchases, 1);

  const beforeTax = { ...actor.currencies };
  const tax = operatePve(ctx, 'quest.tax.force');
  assert.equal(tax.result.silver, 600);
  assert.equal(actor.currencies.silver, beforeTax.silver + 600);
  assert.equal(actor.currencies.gold, beforeTax.gold - 2);
  assert.equal(actor.pve.tasks.counters.forcedTaxes, 1);
  const afterTax = { ...actor.currencies };
  assert.throws(() => operatePve(ctx, 'quest.tax.force'), /次数已用完/);
  assert.deepEqual(actor.currencies, afterTax);
});

test('pet island collection follows a won battle and source refresh timer', () => {
  const { ctx, actor } = setup();
  actor.growth = { energy: 1, pets: {} };
  const started = operatePve(ctx, 'petIsland.challenge', { nodeId: 1 });
  assert.equal(actor.growth.energy, 0);
  assert.equal(started.start.enemies[0].monsterId, 65690);
  const record = { pve: started.start.pve, participants: ['c1'], state: {} };
  assert.equal(onPveBattleSettled(ctx, record, true), true);
  const collection = record.pveReward.collection;
  assert.throws(() => operatePve(ctx, 'petIsland.collect', { collectionId: collection.id }), /尚未成熟/);
  ctx.now = collection.readyAt;
  operatePve(ctx, 'petIsland.collect', { collectionId: collection.id });
  assert.equal(actor.inventory['main:item:1101'], 1);
  assert.equal(actor.pve.tasks.counters.petIslandCollections, 1);
  assert.throws(() => operatePve(ctx, 'petIsland.collect', { collectionId: collection.id }), /不存在/);
});

test('pet synthesis consumes two owned same-quality pets and creates a configured successor', () => {
  const { ctx, actor } = setup();
  actor.growth = { pets: { 1001: { level: 3, exp: 10 }, 1002: { level: 2, exp: 5 } } };
  const result = operatePve(ctx, 'pet.synthesize', { sourcePetIds: [1001, 1002] });
  assert.equal(result.result.petId, 1004);
  assert.equal(actor.growth.pets[1001], undefined);
  assert.equal(actor.growth.pets[1002], undefined);
  assert.deepEqual(actor.growth.pets[1004], { level: 1, exp: 0, skills: [40007] });
  assert.equal(actor.pve.tasks.counters.petSyntheses, 1);
});

test('action hook advances source targets only after matching state changes', () => {
  const { ctx, actor, world } = setup();
  actor.growth = { city: { buildings: { castle: { level: 1, readyAt: 0 } }, lastTaxDay: -1 }, pets: { 1001: { level: 1, exp: 0 } },
    reputationClaims: [], repeatClaims: {}, activities: { wheelDay: -1, wheelCount: 0 } };
  actor.inventory['main:item:1101'] = 2;
  let before = pveActionSnapshot(ctx);
  actor.growth.city.lastTaxDay = 1; actor.currencies.silver += 300;
  onPveAction(ctx, 'city.tax', {}, {}, before);
  assert.equal(actor.pve.tasks.counters.taxClaims, 1);

  world.guilds.g1 = { contributions: { c1: 0 } }; actor.guildId = 'g1';
  before = pveActionSnapshot(ctx); world.guilds.g1.contributions.c1 = 10;
  onPveAction(ctx, 'guild.donate', { amount: 10 }, {}, before);
  assert.equal(actor.pve.tasks.counters.donations, 1);

  before = pveActionSnapshot(ctx); actor.inventory['main:item:1101'] -= 2; actor.growth.pets[1001].exp += 20;
  onPveAction(ctx, 'pet.feed', { count: 2 }, {}, before);
  assert.equal(actor.pve.tasks.counters.petFeeds, 2);

  actor.cards['main:card:1'] = 3;
  before = pveActionSnapshot(ctx); delete actor.cards['main:card:1']; actor.cards['main:card:2'] = 1;
  onPveAction(ctx, 'magic.synthesize', { cardId: 'main:card:1' }, {}, before);
  assert.equal(actor.pve.tasks.counters.cardSynthesisByQuality['1'], 1);

  before = pveActionSnapshot(ctx);
  onPveAction(ctx, 'city.tax', {}, {}, before);
  assert.equal(actor.pve.tasks.counters.taxClaims, 1);
});

test('real competitive settlements feed ranked, clan-war and tournament task counters once', () => {
  const { ctx, actor, world } = setup();
  const opponent = character('c2'); opponent.accountId = 'a2'; actor.guildId = 'g1'; opponent.guildId = 'g1'; world.characters.c2 = opponent;
  const record = mode => ({ mode, participants: ['c1', 'c2'], state: { players: [
    { id: 'c1', team: 0, ai: false }, { id: 'c2', team: 1, ai: false }
  ], winner: 0 } });
  const ranked = record('ranked');
  assert.equal(onPveBattleSettled(ctx, ranked, true), true);
  assert.equal(onPveBattleSettled(ctx, ranked, true), false);
  assert.equal(actor.pve.tasks.counters.pvpMatches['15:0'], 1);
  assert.equal(actor.pve.tasks.counters.pvpMatches['2:0'], undefined);
  assert.equal(actor.pve.tasks.counters.pvpMatches['12:0'], undefined);
  assert.equal(actor.pve.tasks.counters.pvpMatches['1:1'], undefined);
  assert.equal(pveView(ctx).groups.flatMap(group => group.tasks).find(task => task.id === 2004).progress[0].value, 0);
  assert.equal(actor.pve.tasks.counters.pvpWins['1:0'], 1);
  assert.equal(actor.pve.tasks.counters.rankedWins, 1);

  assert.equal(onPveBattleSettled(ctx, record('clan-war'), true), true);
  assert.equal(actor.pve.tasks.counters.cityAttacks, 1);
  assert.equal(actor.pve.tasks.counters.cityAttackWins, 1);
  assert.equal(actor.pve.tasks.counters.cityBattles, 1);

  assert.equal(onPveBattleSettled(ctx, record('tournament'), false), true);
  assert.equal(actor.pve.tasks.counters.athleticsMatches, 1);
  assert.equal(actor.pve.tasks.counters.athleticsWins, undefined);

  const fake = record('ranked'); fake.state.players[1].ai = true;
  assert.equal(onPveBattleSettled(ctx, fake, true), false);
  assert.equal(actor.pve.tasks.counters.rankedMatches, 1);
});

test('source PvP masks advance only from the matching real 2v2 or 4v4 team size', () => {
  const makeRecord = (ctx, world, teamSize, teammateGuild = 'g1') => {
    const participants = ['c1'];
    for (let index = 2; index <= teamSize * 2; index += 1) {
      const id = `c${index}`, candidate = character(id);
      candidate.accountId = `a${index}`;
      candidate.guildId = index <= teamSize ? teammateGuild : 'g2';
      world.characters[id] = candidate;
      participants.push(id);
    }
    ctx.actor.guildId = 'g1';
    return { mode: 'pvp', teamSize, participants, state: { players: participants.map((id, index) => ({
      id, team: index < teamSize ? 0 : 1, ai: false
    })) } };
  };

  const two = setup(), twoRecord = makeRecord(two.ctx, two.world, 2);
  assert.equal(onPveBattleSettled(two.ctx, twoRecord, true), true);
  assert.equal(two.actor.pve.tasks.counters.pvpMatches['2:0'], 1);
  assert.equal(two.actor.pve.tasks.counters.pvpMatches['2:1'], 1);
  assert.equal(two.actor.pve.tasks.counters.pvpMatches['3:0'], 1);
  assert.equal(two.actor.pve.tasks.counters.pvpMatches['15:0'], 1);
  assert.equal(two.actor.pve.tasks.counters.pvpMatches['1:0'], undefined);
  assert.equal(two.actor.pve.tasks.counters.pvpMatches['12:0'], undefined);
  assert.equal(pveView(two.ctx).groups.flatMap(group => group.tasks).find(task => task.id === 13201).progress[0].value, 1);

  const four = setup(), fourRecord = makeRecord(four.ctx, four.world, 4);
  assert.equal(onPveBattleSettled(four.ctx, fourRecord, false), true);
  assert.equal(four.actor.pve.tasks.counters.pvpMatches['12:0'], 1);
  assert.equal(four.actor.pve.tasks.counters.pvpMatches['12:1'], 1);
  assert.equal(four.actor.pve.tasks.counters.pvpMatches['15:0'], 1);
  assert.equal(four.actor.pve.tasks.counters.pvpMatches['2:0'], undefined);
  assert.equal(four.actor.pve.tasks.counters.pvpWins, undefined);
  assert.equal(pveView(four.ctx).groups.flatMap(group => group.tasks).find(task => task.id === 13301).progress[0].value, 1);

  const mixedGuild = setup(), mixedRecord = makeRecord(mixedGuild.ctx, mixedGuild.world, 4);
  mixedGuild.world.characters.c3.guildId = 'g3';
  assert.equal(onPveBattleSettled(mixedGuild.ctx, mixedRecord, true), true);
  assert.equal(mixedGuild.actor.pve.tasks.counters.pvpMatches['12:0'], 1);
  assert.equal(mixedGuild.actor.pve.tasks.counters.pvpMatches['12:1'], undefined);

  const duplicateAccount = setup(), duplicateRecord = makeRecord(duplicateAccount.ctx, duplicateAccount.world, 2);
  duplicateAccount.world.characters.c4.accountId = duplicateAccount.world.characters.c3.accountId;
  assert.equal(onPveBattleSettled(duplicateAccount.ctx, duplicateRecord, true), false);
  const unbalanced = setup(), unbalancedRecord = makeRecord(unbalanced.ctx, unbalanced.world, 2);
  unbalancedRecord.state.players[1].team = 1;
  assert.equal(onPveBattleSettled(unbalanced.ctx, unbalancedRecord, true), false);
});

test('source marriage tasks require two accounts, mutual consent, a real cost and ceremony mail before claiming', () => {
  const { ctx, actor, world } = setup(); actor.level = 100;
  const partner = character('c2'); partner.accountId = 'a2'; partner.name = 'Partner'; partner.level = 100; world.characters.c2 = partner;
  const proposal = operatePve(ctx, 'quest.marriage.propose', { target: 'Partner' }).result;
  assert.match(proposal.message, /对方角色确认/);
  ctx.actor = partner;
  assert.equal(operatePve(ctx, 'quest.marriage.respond', { proposalId: proposal.proposalId, accept: true }).result.accepted, true);
  ctx.actor = actor;
  let tasks = pveView(ctx).groups.flatMap(group => group.tasks);
  assert.equal(tasks.find(task => task.id === 3004).ready, true);
  assert.equal(operatePve(ctx, 'task.claim', { taskId: 3004 }).result.taskId, 3004);
  const gold = actor.currencies.gold;
  const ceremony = operatePve(ctx, 'quest.marriage.ceremony').result;
  assert.equal(ceremony.cost.amount, 20);
  assert.equal(actor.currencies.gold, gold - 20);
  assert.equal(Object.values(world.mail).filter(mail => mail.title === '盟约纪念').length, 2);
  tasks = pveView(ctx).groups.flatMap(group => group.tasks);
  assert.equal(tasks.find(task => task.id === 3005).ready, true);
  assert.equal(operatePve(ctx, 'task.claim', { taskId: 3005 }).result.taskId, 3005);
});

test('local account confirmation only binds current account id and character name', () => {
  const { ctx } = setup();
  const result = operatePve(ctx, 'quest.account.confirm').result;
  assert.match(result.message, /未采集证件，未联网认证/);
  assert.deepEqual(result.confirmation, { accountId: 'a1', actorName: 'c1', confirmedAt: ctx.now,
    scope: 'local-account-profile-only', documentsCollected: false });
  assert.throws(() => operatePve(ctx, 'quest.account.confirm'), /已确认/);
});

test('elite pack spends source gold, grants valid high-quality cards and unlocks source task 3103 by asset delta', () => {
  const { ctx, actor } = setup(); actor.level = 100;
  const before = pveActionSnapshot(ctx), gold = actor.currencies.gold, silver = actor.currencies.silver;
  const opened = operatePve(ctx, 'quest.elitePack.open').result;
  onPveAction(ctx, 'quest.elitePack.open', {}, opened, before);
  assert.equal(actor.currencies.gold, gold - 98);
  assert.equal(opened.granted.length, 6);
  assert.ok(opened.granted.some(card => card.quality >= 3));
  assert.ok(opened.granted.every(card => card.cardId > 0 && card.quality >= 2));
  const task = pveView(ctx).groups.flatMap(group => group.tasks).find(candidate => candidate.id === 3103);
  assert.equal(task.ready, true);
  assert.equal(operatePve(ctx, 'task.claim', { taskId: 3103 }).result.taskId, 3103);
  assert.equal(actor.currencies.silver, silver + 5000);
  assert.ok(Object.values(actor.pve.tasks.counters.openedCardsByQuality).reduce((sum, count) => sum + count, 0) >= 6);
});

test('local gold grants count only their real positive gold delta and unlock source task 3907', () => {
  const { ctx, actor } = setup(); actor.level = 100;
  for (let day = 0; day < 10; day += 1) {
    const before = pveActionSnapshot(ctx), result = operateGrowth(ctx, 'test.grant', { gold: 10 });
    onPveAction(ctx, 'test.grant', { gold: 10 }, result, before);
    ctx.now += 86_400_000;
  }
  const task = pveView(ctx).groups.flatMap(group => group.tasks).find(candidate => candidate.id === 3907);
  assert.equal(task.progress[0].value, 100);
  assert.equal(task.ready, true);
  assert.equal(operatePve(ctx, 'task.claim', { taskId: 3907 }).result.taskId, 3907);
});

test('reordered saved deck is charged once and counts only after a real two-account PvP start', () => {
  const { ctx, actor, world } = setup(); actor.level = 100; actor.deck = ['a', 'b', 'c', 'd'];
  const opponent = character('c2'); opponent.accountId = 'a2'; world.characters.c2 = opponent;
  let before = pveActionSnapshot(ctx); actor.deck = ['b', 'a', 'd', 'c'];
  const saved = { message: '卡组已保存' };
  onPveAction(ctx, 'deck.save', { cards: actor.deck }, saved, before);
  assert.equal(actor.currencies.gold, 499);
  assert.match(saved.message, /消耗1金币/);
  assert.equal(actor.pve.tasks.counters.pvpDeckShuffles, undefined);
  world.battles.b1 = { id: 'b1', mode: 'pvp', participants: ['c1', 'c2'], state: { players: [
    { id: 'c1', team: 0, ai: false, hand: [{ cardId: 'd' }], drawPile: ['a', 'b', 'c'] },
    { id: 'c2', team: 1, ai: false, hand: [{ cardId: 'x' }], drawPile: ['y'] }
  ] } };
  before = pveActionSnapshot(ctx);
  onPveAction(ctx, 'room.start', { roomId: 'r1' }, { battleId: 'b1' }, before);
  const task = pveView(ctx).groups.flatMap(group => group.tasks).find(candidate => candidate.id === 3904);
  assert.equal(task.ready, true);
  assert.equal(operatePve(ctx, 'task.claim', { taskId: 3904 }).result.taskId, 3904);
});

test('opening shuffle accepts balanced real four-account and eight-account PvP starts', () => {
  for (const teamSize of [2, 4]) {
    const { ctx, actor, world } = setup(); actor.deck = ['a', 'b', 'c', 'd'];
    let before = pveActionSnapshot(ctx); actor.deck = ['d', 'c', 'b', 'a'];
    onPveAction(ctx, 'deck.save', { cards: actor.deck }, { message: '卡组已保存' }, before);
    const participants = ['c1'];
    for (let index = 2; index <= teamSize * 2; index += 1) {
      const id = `c${index}`, candidate = character(id); candidate.accountId = `a${index}`;
      world.characters[id] = candidate; participants.push(id);
    }
    const battleId = `pvp-${teamSize}`;
    world.battles[battleId] = { id: battleId, mode: 'pvp', teamSize, participants, state: { players: participants.map((id, index) => ({
      id, team: index < teamSize ? 0 : 1, ai: false, hand: [{ cardId: 'a' }], drawPile: ['b', 'c', 'd']
    })) } };
    before = pveActionSnapshot(ctx);
    onPveAction(ctx, 'room.start', {}, { battleId }, before);
    assert.equal(actor.pve.tasks.counters.pvpDeckShuffles, 1);
  }
});

test('every source task referenced by an enabled group has a supported local progress path', () => {
  const { ctx, actor } = setup(); actor.level = 100;
  const unsupported = pveView(ctx).groups.flatMap(group => group.tasks)
    .filter(task => task.progress.some(item => !item.supported)).map(task => task.id);
  assert.deepEqual(unsupported, []);
});

test('source building targets map all five types and reach their maximum level 20 tasks', () => {
  const { ctx, actor } = setup(); actor.level = 100;
  actor.growth = { city: { buildings: Object.fromEntries(['castle', 'dock', 'alchemy', 'smithy', 'defense']
    .map(id => [id, { level: 20, readyAt: 0 }])) } };
  const tasks = pveView(ctx).groups.flatMap(group => group.tasks);
  assert.equal(tasks.find(task => task.id === 3219).ready, true);
  assert.equal(tasks.find(task => task.id === 3345).ready, true);
});

test('authoritative tick closes elapsed shared seasons once', () => {
  const { ctx, world } = setup(atCst(12, 10));
  operatePve(ctx, 'worldBoss.challenge');
  ctx.now = atCst(19, 30);
  operatePve(ctx, 'forbidden.challenge');
  assert.equal(tickPve(world, tables, atCst(21, 1)), true);
  assert.equal(world.pve.worldBoss['2026-10-20:0'].closed, true);
  assert.equal(world.pve.forbidden['2026-10-20'].closed, true);
  assert.equal(tickPve(world, tables, atCst(21, 2)), false);
});
