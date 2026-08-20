import assert from 'node:assert/strict';
import {
  BossConfigError,
  advanceBossRound,
  applyBossDamage,
  availableBossSkillIds,
  createBossState,
  defeatBossSummon,
  executeBossSkill,
  setBossFlag,
  validateBossConfig,
} from '../assets/scripts/core/boss/index.ts';

const config = {
  id: 'BOSS-T222-IRON-ROOT',
  maxHp: 100,
  flags: ['sealBroken'],
  summons: [
    { id: 'rootling', unitId: 'U-ROOTLING', maxHp: 12, maxActive: 1 },
    { id: 'thorn-guard', unitId: 'U-THORN-GUARD', maxHp: 20, maxActive: 2 },
  ],
  skills: [
    { id: 'heavy-strike', effect: { type: 'DAMAGE_PLAYER_HERO', amount: 7 } },
    { id: 'seal-break', effect: { type: 'SET_FLAG', flag: 'sealBroken', value: true } },
    { id: 'call-rootling', effect: { type: 'SUMMON', summonId: 'rootling' } },
    { id: 'call-thorns', effect: { type: 'SUMMON', summonId: 'thorn-guard' } },
    { id: 'regrow', effect: { type: 'HEAL_BOSS', amount: 10 } },
  ],
  phases: [
    { id: 'P1', hpPercentAtMost: 100, skillIds: ['heavy-strike', 'call-rootling'], onEnterSummonIds: ['rootling'] },
    { id: 'P2', hpPercentAtMost: 50, skillIds: ['heavy-strike', 'call-thorns', 'seal-break'], onEnterSummonIds: ['thorn-guard'] },
    { id: 'P3', hpPercentAtMost: 20, skillIds: ['heavy-strike', 'regrow', 'seal-break'], onEnterSummonIds: [] },
  ],
  outcome: {
    priority: 'LOSE',
    win: { mode: 'ALL', rules: [{ type: 'BOSS_HP_AT_MOST', value: 0 }, { type: 'FLAG_SET', flag: 'sealBroken' }] },
    lose: { mode: 'ANY', rules: [{ type: 'PLAYER_HERO_HP_AT_MOST', value: 0 }, { type: 'ROUND_AT_LEAST', value: 5 }] },
  },
};

function expectConfigError(label, mutate, expectedPath) {
  const candidate = structuredClone(config);
  mutate(candidate);
  assert.throws(() => validateBossConfig(candidate), (error) => {
    assert(error instanceof BossConfigError, `${label} must throw BossConfigError`);
    assert.equal(error.configPath, expectedPath, `${label} path`);
    return true;
  });
}

validateBossConfig(config);
let state = createBossState(config, { playerHeroHp: 30 });
assert.equal(state.phaseId, 'P1');
assert.equal(state.activeSummons.length, 1, 'phase entry must execute configured summon');
assert.deepEqual(availableBossSkillIds(config, state), ['heavy-strike', 'call-rootling']);
assert.equal(state.events.some(({ type, payload }) => type === 'SUMMON_CREATED' && payload.summonId === 'rootling'), true);

const crossedPhases = applyBossDamage(config, createBossState(config, { playerHeroHp: 30 }), 81);
assert.equal(crossedPhases.bossHp, 19);
assert.equal(crossedPhases.phaseId, 'P3', 'large damage must reach the final configured phase');
assert.deepEqual(
  crossedPhases.events
    .filter(({ type }) => type === 'PHASE_CHANGED')
    .map(({ payload }) => payload.to),
  ['P1', 'P2', 'P3'],
  'crossing multiple thresholds must enter every phase in order',
);
const p2PhaseEvent = crossedPhases.events.find(({ type, payload }) => type === 'PHASE_CHANGED' && payload.to === 'P2');
const p2SummonEvent = crossedPhases.events.find(({ type, payload }) => type === 'SUMMON_CREATED' && payload.summonId === 'thorn-guard');
const p3PhaseEvent = crossedPhases.events.find(({ type, payload }) => type === 'PHASE_CHANGED' && payload.to === 'P3');
assert(p2PhaseEvent && p2SummonEvent && p3PhaseEvent, 'crossing phases must run P2 entry summon');
assert(p2PhaseEvent.eventId < p2SummonEvent.eventId && p2SummonEvent.eventId < p3PhaseEvent.eventId, 'P2 entry must happen before P3 entry');
assert.equal(crossedPhases.activeSummons.some(({ summonId }) => summonId === 'thorn-guard'), true, 'P2 onEnterSummonIds must execute during a large transition');

const cappedSummon = executeBossSkill(config, state, 'call-rootling');
assert.equal(cappedSummon.activeSummons.length, 1, 'maxActive must be executed, not just validated');
assert.equal(cappedSummon.events.some(({ type, payload }) => type === 'SUMMON_SKIPPED' && payload.reason === 'MAX_ACTIVE'), true);
const damagedHero = executeBossSkill(config, state, 'heavy-strike');
assert.equal(damagedHero.playerHeroHp, 23, 'configured skill damage must execute');
assert.equal(state.playerHeroHp, 30, 'skill execution must not mutate the previous state');
assert.equal(state.bossHp, 100, 'damage execution must not mutate the previous state');
assert.throws(() => executeBossSkill(config, state, 'call-thorns'), /not available/);
assert.throws(() => executeBossSkill(config, state, 'missing-skill'), /not available/);

state = applyBossDamage(config, state, 51);
assert.equal(state.bossHp, 49);
assert.equal(state.phaseId, 'P2', 'HP threshold must switch phase');
assert.deepEqual(availableBossSkillIds(config, state), ['heavy-strike', 'call-thorns', 'seal-break']);
assert.equal(state.activeSummons.length, 2, 'phase transition must execute configured summon');
assert.equal(state.events.some(({ type, payload }) => type === 'PHASE_CHANGED' && payload.to === 'P2'), true);
assert.throws(() => executeBossSkill(config, state, 'call-rootling'), /not available/);

const phaseThree = applyBossDamage(config, state, 30);
assert.equal(phaseThree.phaseId, 'P3');
assert.equal(phaseThree.activeSummons.length, 2, 'phase without entry summons must not invent one');
const healed = executeBossSkill(config, phaseThree, 'regrow');
assert.equal(healed.bossHp, 29, 'configured healing must execute');
assert.equal(healed.phaseId, 'P3', 'healing must not rewind an entered phase');

const sealed = executeBossSkill(config, state, 'seal-break');
assert.equal(sealed.flags.sealBroken, true);
const defeated = applyBossDamage(config, sealed, 100);
assert.equal(defeated.status, 'won', 'special win rules must resolve at runtime');
assert.equal(defeated.reason, 'SPECIAL_WIN');
assert.equal(defeated.events.at(-1).type, 'OUTCOME_RESOLVED');
assert.throws(() => applyBossDamage(config, defeated, 1), /already settled/);

const roundLoss = advanceBossRound(config, createBossState(config, { playerHeroHp: 30 }));
const roundLoss2 = advanceBossRound(config, roundLoss);
const roundLoss3 = advanceBossRound(config, roundLoss2);
const roundLoss4 = advanceBossRound(config, roundLoss3);
const lost = advanceBossRound(config, roundLoss4);
assert.equal(lost.status, 'lost', 'configured round loss must resolve at runtime');
assert.equal(lost.reason, 'SPECIAL_LOSE');
assert.equal(lost.events.at(-1).type, 'OUTCOME_RESOLVED');

const cleared = defeatBossSummon(config, state, state.activeSummons[0].instanceId);
assert.equal(cleared.activeSummons.length, 1);
const clearedAll = defeatBossSummon(config, cleared, cleared.activeSummons[0].instanceId);
assert.equal(clearedAll.activeSummons.length, 0);
assert.throws(() => defeatBossSummon(config, state, 'missing-instance'), /unknown summon instance/);
assert.throws(() => setBossFlag(config, state, 'missing-flag', true), /unknown boss flag/);
assert.equal(setBossFlag(config, state, 'sealBroken', true).flags.sealBroken, true);

expectConfigError('unknown phase skill', (candidate) => { candidate.phases[1].skillIds[0] = 'forged'; }, 'boss.phases[1].skillIds[0]');
expectConfigError('duplicate phase threshold', (candidate) => { candidate.phases[1].hpPercentAtMost = 100; }, 'boss.phases[1].hpPercentAtMost');
expectConfigError('unknown summon effect', (candidate) => { candidate.skills[2].effect.summonId = 'forged'; }, 'boss.skills[2].effect.summonId');
expectConfigError('unknown outcome flag', (candidate) => { candidate.outcome.win.rules[1].flag = 'forged'; }, 'boss.outcome.win.rules[1].flag');
expectConfigError('unknown field', (candidate) => { candidate.phases[0].cheat = true; }, 'boss.phases[0].cheat');
expectConfigError('invalid outcome mode', (candidate) => { candidate.outcome.lose.mode = 'FIRST'; }, 'boss.outcome.lose.mode');
expectConfigError('invalid outcome priority', (candidate) => { candidate.outcome.priority = 'FIRST'; }, 'boss.outcome.priority');
expectConfigError('empty skill table', (candidate) => { candidate.phases[0].skillIds = []; }, 'boss.phases[0].skillIds');

const tunedConfig = structuredClone(config);
tunedConfig.phases[1].hpPercentAtMost = 60;
tunedConfig.skills[0].effect.amount = 3;
const tuned = createBossState(tunedConfig, { playerHeroHp: 30 });
assert.equal(applyBossDamage(tunedConfig, tuned, 41).phaseId, 'P2', 'changing config must change phase execution');
assert.equal(executeBossSkill(tunedConfig, tuned, 'heavy-strike').playerHeroHp, 27, 'changing config must change skill execution');

console.log('T222 M5-07 Boss phases: configurable phase switching, skill table execution, summon caps, special outcomes, immutability and negative cases PASS');
