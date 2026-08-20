export type BossStatus = 'playing' | 'won' | 'lost';
export type BossRuleMode = 'ANY' | 'ALL';

export type BossSkillEffect =
  | { readonly type: 'DAMAGE_PLAYER_HERO'; readonly amount: number }
  | { readonly type: 'HEAL_BOSS'; readonly amount: number }
  | { readonly type: 'SUMMON'; readonly summonId: string }
  | { readonly type: 'SET_FLAG'; readonly flag: string; readonly value: boolean };

export interface BossSkillConfig {
  readonly id: string;
  readonly effect: BossSkillEffect;
}

export interface BossSummonConfig {
  readonly id: string;
  readonly unitId: string;
  readonly maxHp: number;
  readonly maxActive: number;
}

export interface BossPhaseConfig {
  readonly id: string;
  readonly hpPercentAtMost: number;
  readonly skillIds: readonly string[];
  readonly onEnterSummonIds: readonly string[];
}

export type BossOutcomeRule =
  | { readonly type: 'BOSS_HP_AT_MOST'; readonly value: number }
  | { readonly type: 'PLAYER_HERO_HP_AT_MOST'; readonly value: number }
  | { readonly type: 'ROUND_AT_LEAST'; readonly value: number }
  | { readonly type: 'ACTIVE_SUMMONS_AT_LEAST'; readonly value: number }
  | { readonly type: 'ACTIVE_SUMMONS_AT_MOST'; readonly value: number }
  | { readonly type: 'FLAG_SET'; readonly flag: string };

export interface BossOutcomeGroup {
  readonly mode: BossRuleMode;
  readonly rules: readonly BossOutcomeRule[];
}

export interface BossOutcomeConfig {
  readonly priority: 'WIN' | 'LOSE';
  readonly win: BossOutcomeGroup;
  readonly lose: BossOutcomeGroup;
}

export interface BossConfig {
  readonly id: string;
  readonly maxHp: number;
  readonly phases: readonly BossPhaseConfig[];
  readonly skills: readonly BossSkillConfig[];
  readonly summons: readonly BossSummonConfig[];
  readonly flags: readonly string[];
  readonly outcome: BossOutcomeConfig;
}

export interface BossStateOptions {
  readonly bossHp?: number;
  readonly playerHeroHp?: number;
  readonly round?: number;
  readonly flags?: Readonly<Record<string, boolean>>;
}

export interface BossSummonState {
  readonly instanceId: string;
  readonly summonId: string;
  readonly unitId: string;
  readonly hp: number;
  readonly maxHp: number;
}

export type BossEventType =
  | 'PHASE_CHANGED'
  | 'SKILL_EXECUTED'
  | 'BOSS_DAMAGED'
  | 'BOSS_HEALED'
  | 'SUMMON_CREATED'
  | 'SUMMON_SKIPPED'
  | 'SUMMON_DEFEATED'
  | 'FLAG_SET'
  | 'ROUND_ADVANCED'
  | 'OUTCOME_RESOLVED';

export interface BossEvent {
  readonly eventId: number;
  readonly round: number;
  readonly type: BossEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface BossState {
  readonly configId: string;
  readonly bossHp: number;
  readonly playerHeroHp: number;
  readonly round: number;
  readonly phaseId: string;
  readonly activeSummons: readonly BossSummonState[];
  readonly flags: Readonly<Record<string, boolean>>;
  readonly status: BossStatus;
  readonly reason?: 'SPECIAL_WIN' | 'SPECIAL_LOSE';
  readonly events: readonly BossEvent[];
  readonly nextEventId: number;
  readonly nextSummonSequence: number;
}

export class BossConfigError extends Error {
  readonly configPath: string;

  constructor(configPath: string, message: string) {
    super(`${configPath}: ${message}`);
    this.name = 'BossConfigError';
    this.configPath = configPath;
  }
}

function record(value: unknown, configPath: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BossConfigError(configPath, '必须是对象');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], configPath: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in value)) throw new BossConfigError(`${configPath}.${key}`, '缺少字段');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new BossConfigError(`${configPath}.${key}`, '未知字段');
  }
}

function nonEmptyString(value: unknown, configPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BossConfigError(configPath, '必须是非空字符串');
  }
  return value;
}

function positiveInteger(value: unknown, configPath: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new BossConfigError(configPath, '必须是正整数');
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, configPath: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new BossConfigError(configPath, '必须是非负整数');
  }
  return value as number;
}

function booleanValue(value: unknown, configPath: string): boolean {
  if (typeof value !== 'boolean') throw new BossConfigError(configPath, '必须是 boolean');
  return value;
}

function uniqueStrings(value: unknown, configPath: string): string[] {
  if (!Array.isArray(value)) throw new BossConfigError(configPath, '必须是字符串数组');
  const values = value.map((item, index) => nonEmptyString(item, `${configPath}[${index}]`));
  if (new Set(values).size !== values.length) throw new BossConfigError(configPath, '不得包含重复值');
  return values;
}

function finitePercent(value: unknown, configPath: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new BossConfigError(configPath, '必须是 0 到 100 的数字');
  }
  return value;
}

function parseRule(value: unknown, configPath: string, flags: ReadonlySet<string>): BossOutcomeRule {
  const rule = record(value, configPath);
  if (typeof rule.type !== 'string') throw new BossConfigError(`${configPath}.type`, '缺少规则类型');
  if (rule.type === 'FLAG_SET') {
    exactKeys(rule, ['type', 'flag'], [], configPath);
    const flag = nonEmptyString(rule.flag, `${configPath}.flag`);
    if (!flags.has(flag)) throw new BossConfigError(`${configPath}.flag`, `未声明旗标: ${flag}`);
    return { type: 'FLAG_SET', flag };
  }
  const numericTypes = new Set([
    'BOSS_HP_AT_MOST',
    'PLAYER_HERO_HP_AT_MOST',
    'ROUND_AT_LEAST',
    'ACTIVE_SUMMONS_AT_LEAST',
    'ACTIVE_SUMMONS_AT_MOST',
  ]);
  if (!numericTypes.has(rule.type)) throw new BossConfigError(`${configPath}.type`, `不支持的规则: ${rule.type}`);
  exactKeys(rule, ['type', 'value'], [], configPath);
  const valueRule = rule.type === 'ROUND_AT_LEAST'
    ? positiveInteger(rule.value, `${configPath}.value`)
    : nonNegativeInteger(rule.value, `${configPath}.value`);
  return { type: rule.type as BossOutcomeRule['type'], value: valueRule } as BossOutcomeRule;
}

function parseOutcomeGroup(value: unknown, configPath: string, flags: ReadonlySet<string>): BossOutcomeGroup {
  const group = record(value, configPath);
  exactKeys(group, ['mode', 'rules'], [], configPath);
  if (group.mode !== 'ANY' && group.mode !== 'ALL') throw new BossConfigError(`${configPath}.mode`, '必须是 ANY 或 ALL');
  if (!Array.isArray(group.rules) || group.rules.length === 0) throw new BossConfigError(`${configPath}.rules`, '不得为空');
  return {
    mode: group.mode,
    rules: group.rules.map((rule, index) => parseRule(rule, `${configPath}.rules[${index}]`, flags)),
  };
}

function parseEffect(value: unknown, configPath: string, summonIds: ReadonlySet<string>, flags: ReadonlySet<string>): BossSkillEffect {
  const effect = record(value, configPath);
  if (typeof effect.type !== 'string') throw new BossConfigError(`${configPath}.type`, '缺少效果类型');
  if (effect.type === 'DAMAGE_PLAYER_HERO' || effect.type === 'HEAL_BOSS') {
    exactKeys(effect, ['type', 'amount'], [], configPath);
    return { type: effect.type, amount: positiveInteger(effect.amount, `${configPath}.amount`) };
  }
  if (effect.type === 'SUMMON') {
    exactKeys(effect, ['type', 'summonId'], [], configPath);
    const summonId = nonEmptyString(effect.summonId, `${configPath}.summonId`);
    if (!summonIds.has(summonId)) throw new BossConfigError(`${configPath}.summonId`, `未声明召唤: ${summonId}`);
    return { type: 'SUMMON', summonId };
  }
  if (effect.type === 'SET_FLAG') {
    exactKeys(effect, ['type', 'flag', 'value'], [], configPath);
    const flag = nonEmptyString(effect.flag, `${configPath}.flag`);
    if (!flags.has(flag)) throw new BossConfigError(`${configPath}.flag`, `未声明旗标: ${flag}`);
    return { type: 'SET_FLAG', flag, value: booleanValue(effect.value, `${configPath}.value`) };
  }
  throw new BossConfigError(`${configPath}.type`, `不支持的技能效果: ${effect.type}`);
}

export function validateBossConfig(value: unknown, configPath = 'boss'): BossConfig {
  const root = record(value, configPath);
  exactKeys(root, ['id', 'maxHp', 'phases', 'skills', 'summons', 'flags', 'outcome'], [], configPath);
  const id = nonEmptyString(root.id, `${configPath}.id`);
  const maxHp = positiveInteger(root.maxHp, `${configPath}.maxHp`);
  const flags = uniqueStrings(root.flags, `${configPath}.flags`);
  const flagSet = new Set(flags);

  if (!Array.isArray(root.summons) || root.summons.length === 0) {
    throw new BossConfigError(`${configPath}.summons`, '不得为空');
  }
  const summons: BossSummonConfig[] = [];
  const summonIds = new Set<string>();
  root.summons.forEach((value, index) => {
    const summon = record(value, `${configPath}.summons[${index}]`);
    exactKeys(summon, ['id', 'unitId', 'maxHp', 'maxActive'], [], `${configPath}.summons[${index}]`);
    const summonId = nonEmptyString(summon.id, `${configPath}.summons[${index}].id`);
    if (summonIds.has(summonId)) throw new BossConfigError(`${configPath}.summons[${index}].id`, `重复召唤: ${summonId}`);
    summonIds.add(summonId);
    summons.push({
      id: summonId,
      unitId: nonEmptyString(summon.unitId, `${configPath}.summons[${index}].unitId`),
      maxHp: positiveInteger(summon.maxHp, `${configPath}.summons[${index}].maxHp`),
      maxActive: positiveInteger(summon.maxActive, `${configPath}.summons[${index}].maxActive`),
    });
  });

  if (!Array.isArray(root.skills) || root.skills.length === 0) throw new BossConfigError(`${configPath}.skills`, '不得为空');
  const skills: BossSkillConfig[] = [];
  const skillIds = new Set<string>();
  root.skills.forEach((value, index) => {
    const skill = record(value, `${configPath}.skills[${index}]`);
    exactKeys(skill, ['id', 'effect'], [], `${configPath}.skills[${index}]`);
    const skillId = nonEmptyString(skill.id, `${configPath}.skills[${index}].id`);
    if (skillIds.has(skillId)) throw new BossConfigError(`${configPath}.skills[${index}].id`, `重复技能: ${skillId}`);
    skillIds.add(skillId);
    skills.push({ id: skillId, effect: parseEffect(skill.effect, `${configPath}.skills[${index}].effect`, summonIds, flagSet) });
  });

  if (!Array.isArray(root.phases) || root.phases.length === 0) throw new BossConfigError(`${configPath}.phases`, '不得为空');
  const phases: BossPhaseConfig[] = [];
  const phaseIds = new Set<string>();
  let previousThreshold = 101;
  root.phases.forEach((value, index) => {
    const phase = record(value, `${configPath}.phases[${index}]`);
    exactKeys(phase, ['id', 'hpPercentAtMost', 'skillIds', 'onEnterSummonIds'], [], `${configPath}.phases[${index}]`);
    const phaseId = nonEmptyString(phase.id, `${configPath}.phases[${index}].id`);
    if (phaseIds.has(phaseId)) throw new BossConfigError(`${configPath}.phases[${index}].id`, `重复阶段: ${phaseId}`);
    phaseIds.add(phaseId);
    const hpPercentAtMost = finitePercent(phase.hpPercentAtMost, `${configPath}.phases[${index}].hpPercentAtMost`);
    if (index === 0 && hpPercentAtMost !== 100) throw new BossConfigError(`${configPath}.phases[${index}].hpPercentAtMost`, '第一阶段必须从 100% 生效');
    if (hpPercentAtMost >= previousThreshold) throw new BossConfigError(`${configPath}.phases[${index}].hpPercentAtMost`, '阶段阈值必须严格递减');
    previousThreshold = hpPercentAtMost;
    const skillIdsForPhase = uniqueStrings(phase.skillIds, `${configPath}.phases[${index}].skillIds`);
    if (skillIdsForPhase.length === 0) throw new BossConfigError(`${configPath}.phases[${index}].skillIds`, '阶段技能表不得为空');
    skillIdsForPhase.forEach((skillId, skillIndex) => {
      if (!skillIds.has(skillId)) throw new BossConfigError(`${configPath}.phases[${index}].skillIds[${skillIndex}]`, `未声明技能: ${skillId}`);
    });
    const onEnterSummonIds = uniqueStrings(phase.onEnterSummonIds, `${configPath}.phases[${index}].onEnterSummonIds`);
    onEnterSummonIds.forEach((summonId, summonIndex) => {
      if (!summonIds.has(summonId)) throw new BossConfigError(`${configPath}.phases[${index}].onEnterSummonIds[${summonIndex}]`, `未声明召唤: ${summonId}`);
    });
    phases.push({ id: phaseId, hpPercentAtMost, skillIds: skillIdsForPhase, onEnterSummonIds });
  });

  const outcome = record(root.outcome, `${configPath}.outcome`);
  exactKeys(outcome, ['priority', 'win', 'lose'], [], `${configPath}.outcome`);
  if (outcome.priority !== 'WIN' && outcome.priority !== 'LOSE') throw new BossConfigError(`${configPath}.outcome.priority`, '必须是 WIN 或 LOSE');
  return {
    id,
    maxHp,
    phases,
    skills,
    summons,
    flags,
    outcome: {
      priority: outcome.priority,
      win: parseOutcomeGroup(outcome.win, `${configPath}.outcome.win`, flagSet),
      lose: parseOutcomeGroup(outcome.lose, `${configPath}.outcome.lose`, flagSet),
    },
  };
}

function phaseIndexForHp(config: BossConfig, bossHp: number): number {
  const percent = (bossHp / config.maxHp) * 100;
  let index = 0;
  config.phases.forEach((phase, phaseIndex) => {
    if (percent <= phase.hpPercentAtMost) index = phaseIndex;
  });
  return index;
}

function phaseForId(config: BossConfig, phaseId: string): BossPhaseConfig {
  const phase = config.phases.find((candidate) => candidate.id === phaseId);
  if (!phase) throw new Error(`unknown boss phase: ${phaseId}`);
  return phase;
}

function skillForId(config: BossConfig, skillId: string): BossSkillConfig {
  const skill = config.skills.find((candidate) => candidate.id === skillId);
  if (!skill) throw new Error(`unknown boss skill: ${skillId}`);
  return skill;
}

function summonForId(config: BossConfig, summonId: string): BossSummonConfig {
  const summon = config.summons.find((candidate) => candidate.id === summonId);
  if (!summon) throw new Error(`unknown boss summon: ${summonId}`);
  return summon;
}

function addEvent(state: BossState, type: BossEventType, payload: Readonly<Record<string, unknown>>): BossState {
  return {
    ...state,
    events: [...state.events, { eventId: state.nextEventId, round: state.round, type, payload }],
    nextEventId: state.nextEventId + 1,
  };
}

function assertConfigState(config: BossConfig, state: BossState): void {
  if (state.configId !== config.id) throw new Error(`boss config mismatch: ${state.configId}`);
}

function assertPlaying(state: BossState): void {
  if (state.status !== 'playing') throw new Error(`boss encounter is already settled: ${state.status}`);
}

function spawnSummon(config: BossConfig, state: BossState, summonId: string): BossState {
  const summon = summonForId(config, summonId);
  const activeCount = state.activeSummons.filter((item) => item.summonId === summonId).length;
  if (activeCount >= summon.maxActive) {
    return addEvent(state, 'SUMMON_SKIPPED', { summonId, reason: 'MAX_ACTIVE' });
  }
  const instanceId = `${summonId}:${state.nextSummonSequence}`;
  const next = {
    ...state,
    activeSummons: [...state.activeSummons, { instanceId, summonId, unitId: summon.unitId, hp: summon.maxHp, maxHp: summon.maxHp }],
    nextSummonSequence: state.nextSummonSequence + 1,
  };
  return addEvent(next, 'SUMMON_CREATED', { summonId, unitId: summon.unitId, instanceId });
}

function enterPhase(config: BossConfig, state: BossState, phaseIndex: number, previousPhaseId: string | undefined): BossState {
  const phase = config.phases[phaseIndex];
  let next = addEvent(state, 'PHASE_CHANGED', { from: previousPhaseId ?? null, to: phase.id, hpPercent: (state.bossHp / config.maxHp) * 100 });
  for (const summonId of phase.onEnterSummonIds) next = spawnSummon(config, next, summonId);
  return next;
}

function ruleMatches(config: BossConfig, state: BossState, rule: BossOutcomeRule): boolean {
  if (rule.type === 'BOSS_HP_AT_MOST') return state.bossHp <= rule.value;
  if (rule.type === 'PLAYER_HERO_HP_AT_MOST') return state.playerHeroHp <= rule.value;
  if (rule.type === 'ROUND_AT_LEAST') return state.round >= rule.value;
  if (rule.type === 'ACTIVE_SUMMONS_AT_LEAST') return state.activeSummons.length >= rule.value;
  if (rule.type === 'ACTIVE_SUMMONS_AT_MOST') return state.activeSummons.length <= rule.value;
  if (!config.flags.includes(rule.flag)) throw new Error(`unknown boss flag: ${rule.flag}`);
  return state.flags[rule.flag] === true;
}

function groupMatches(config: BossConfig, state: BossState, group: BossOutcomeGroup): boolean {
  const matches = group.rules.map((rule) => ruleMatches(config, state, rule));
  return group.mode === 'ANY' ? matches.some(Boolean) : matches.every(Boolean);
}

function settle(config: BossConfig, state: BossState): BossState {
  if (state.status !== 'playing') return state;
  const lose = groupMatches(config, state, config.outcome.lose);
  const win = groupMatches(config, state, config.outcome.win);
  if ((config.outcome.priority === 'LOSE' && lose) || (config.outcome.priority === 'WIN' && lose && !win)) {
    return addEvent({ ...state, status: 'lost', reason: 'SPECIAL_LOSE' }, 'OUTCOME_RESOLVED', { status: 'lost', reason: 'SPECIAL_LOSE' });
  }
  if (win) {
    return addEvent({ ...state, status: 'won', reason: 'SPECIAL_WIN' }, 'OUTCOME_RESOLVED', { status: 'won', reason: 'SPECIAL_WIN' });
  }
  return state;
}

export function createBossState(input: unknown, options: BossStateOptions = {}): BossState {
  const config = validateBossConfig(input);
  const bossHp = options.bossHp ?? config.maxHp;
  const playerHeroHp = options.playerHeroHp ?? 100;
  const round = options.round ?? 0;
  if (!Number.isSafeInteger(bossHp) || bossHp < 0 || bossHp > config.maxHp) throw new Error('bossHp is invalid');
  if (!Number.isSafeInteger(playerHeroHp) || playerHeroHp < 0) throw new Error('playerHeroHp is invalid');
  if (!Number.isSafeInteger(round) || round < 0) throw new Error('round is invalid');
  const flags: Record<string, boolean> = Object.fromEntries(config.flags.map((flag) => [flag, false]));
  for (const [flag, value] of Object.entries(options.flags ?? {})) {
    if (!config.flags.includes(flag)) throw new Error(`unknown boss flag: ${flag}`);
    flags[flag] = booleanValue(value, `flags.${flag}`);
  }
  const initialPhaseIndex = phaseIndexForHp(config, bossHp);
  let state: BossState = {
    configId: config.id,
    bossHp,
    playerHeroHp,
    round,
    phaseId: config.phases[initialPhaseIndex].id,
    activeSummons: [],
    flags,
    status: 'playing',
    events: [],
    nextEventId: 1,
    nextSummonSequence: 1,
  };
  state = enterPhase(config, state, initialPhaseIndex, undefined);
  return settle(config, state);
}

export function availableBossSkillIds(configInput: unknown, state: BossState): readonly string[] {
  const config = validateBossConfig(configInput);
  assertConfigState(config, state);
  return [...phaseForId(config, state.phaseId).skillIds];
}

export function applyBossDamage(configInput: unknown, state: BossState, amount: number): BossState {
  const config = validateBossConfig(configInput);
  assertConfigState(config, state);
  assertPlaying(state);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('damage amount is invalid');
  let next = addEvent({ ...state, bossHp: Math.max(0, state.bossHp - amount) }, 'BOSS_DAMAGED', { amount, bossHp: Math.max(0, state.bossHp - amount) });
  const currentIndex = config.phases.findIndex((phase) => phase.id === state.phaseId);
  const nextIndex = phaseIndexForHp(config, next.bossHp);
  let previousPhaseId = state.phaseId;
  for (let phaseIndex = currentIndex + 1; phaseIndex <= nextIndex; phaseIndex += 1) {
    next = { ...next, phaseId: config.phases[phaseIndex].id };
    next = enterPhase(config, next, phaseIndex, previousPhaseId);
    previousPhaseId = config.phases[phaseIndex].id;
  }
  return settle(config, next);
}

export function executeBossSkill(configInput: unknown, state: BossState, skillId: string): BossState {
  const config = validateBossConfig(configInput);
  assertConfigState(config, state);
  assertPlaying(state);
  const phase = phaseForId(config, state.phaseId);
  if (!phase.skillIds.includes(skillId)) throw new Error(`skill ${skillId} is not available in phase ${phase.id}`);
  const skill = skillForId(config, skillId);
  let next = state;
  if (skill.effect.type === 'DAMAGE_PLAYER_HERO') {
    next = addEvent({ ...next, playerHeroHp: Math.max(0, next.playerHeroHp - skill.effect.amount) }, 'BOSS_DAMAGED', {
      amount: skill.effect.amount,
      target: 'playerHero',
      playerHeroHp: Math.max(0, next.playerHeroHp - skill.effect.amount),
    });
  } else if (skill.effect.type === 'HEAL_BOSS') {
    next = addEvent({ ...next, bossHp: Math.min(config.maxHp, next.bossHp + skill.effect.amount) }, 'BOSS_HEALED', {
      amount: skill.effect.amount,
      bossHp: Math.min(config.maxHp, next.bossHp + skill.effect.amount),
    });
  } else if (skill.effect.type === 'SUMMON') {
    next = spawnSummon(config, next, skill.effect.summonId);
  } else {
    next = addEvent({ ...next, flags: { ...next.flags, [skill.effect.flag]: skill.effect.value } }, 'FLAG_SET', {
      flag: skill.effect.flag,
      value: skill.effect.value,
    });
  }
  next = addEvent(next, 'SKILL_EXECUTED', { skillId, phaseId: phase.id });
  return settle(config, next);
}

export function advanceBossRound(configInput: unknown, state: BossState): BossState {
  const config = validateBossConfig(configInput);
  assertConfigState(config, state);
  assertPlaying(state);
  return settle(config, addEvent({ ...state, round: state.round + 1 }, 'ROUND_ADVANCED', { round: state.round + 1 }));
}

export function defeatBossSummon(configInput: unknown, state: BossState, instanceId: string): BossState {
  const config = validateBossConfig(configInput);
  assertConfigState(config, state);
  assertPlaying(state);
  if (!state.activeSummons.some((summon) => summon.instanceId === instanceId)) throw new Error(`unknown summon instance: ${instanceId}`);
  return settle(config, addEvent({ ...state, activeSummons: state.activeSummons.filter((summon) => summon.instanceId !== instanceId) }, 'SUMMON_DEFEATED', { instanceId }));
}

export function setBossFlag(configInput: unknown, state: BossState, flag: string, value: boolean): BossState {
  const config = validateBossConfig(configInput);
  assertConfigState(config, state);
  assertPlaying(state);
  if (!config.flags.includes(flag)) throw new Error(`unknown boss flag: ${flag}`);
  return settle(config, addEvent({ ...state, flags: { ...state.flags, [flag]: booleanValue(value, `flags.${flag}`) } }, 'FLAG_SET', { flag, value }));
}
