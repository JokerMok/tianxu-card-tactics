export const REPUTATION_SCHEMA_VERSION = 1 as const;
export const REPUTATION_LEVELS = Object.freeze([1, 2, 3, 4]) as readonly [1, 2, 3, 4];
export const REPUTATION_RACES = Object.freeze([
  '人族', '羽民', '鳞民', '山灵', '冥裔', '巧民', '异兽',
] as const);
export const REPUTATION_PROFESSIONS = Object.freeze(['P001', 'P002', 'P003', 'P004'] as const);
export const REPUTATION_FACTIONS = Object.freeze([
  '无籍行营', '朔垣军府', '天序神庭', '河中诸国', '离山仙盟', '山海诸庭', '归墟会',
] as const);

export type ReputationLevel = (typeof REPUTATION_LEVELS)[number];
export type ReputationSubjectType = 'RACE' | 'PROFESSION';
export type ReputationRelation =
  | 'SELF'
  | 'FRIENDLY'
  | 'ALLIED'
  | 'CONTACT'
  | 'TRUCE'
  | 'DISTANT'
  | 'TRADE'
  | 'UNSETTLED'
  | 'FRACTURED'
  | 'NOMINAL'
  | 'PRESSURED'
  | 'MIXED'
  | 'BORDER_CONFLICT'
  | 'OPPOSED'
  | 'HOSTILE'
  | 'ENEMY';

export interface ReputationBattleModifier {
  readonly attackPercent: number;
  readonly defensePercent: number;
  readonly healingPercent: number;
  readonly prepareDiscount: number;
}

export interface ReputationLevelDefinition {
  readonly level: ReputationLevel;
  readonly threshold: number;
  readonly rewardIds: readonly string[];
  readonly battleModifier: ReputationBattleModifier;
}

export interface ReputationTrackDefinition {
  readonly id: string;
  readonly subjectType: ReputationSubjectType;
  readonly subjectId: string;
  readonly sourceId: string;
  readonly levels: readonly ReputationLevelDefinition[];
}

export interface ReputationRelationDefinition {
  readonly sourceFactionId: string;
  readonly targetFactionId: string;
  readonly relation: ReputationRelation;
  readonly score: number;
}

export interface ReputationCatalogConfig {
  readonly schemaVersion: typeof REPUTATION_SCHEMA_VERSION;
  readonly tracks: readonly ReputationTrackDefinition[];
  readonly relations: readonly ReputationRelationDefinition[];
}

export interface ReputationProgress {
  readonly trackId: string;
  readonly points: number;
  readonly level: ReputationLevel;
  readonly currentThreshold: number;
  readonly nextThreshold: number | null;
  readonly pointsIntoLevel: number;
  readonly pointsToNextLevel: number | null;
  readonly rewardIds: readonly string[];
  readonly battleModifier: ReputationBattleModifier;
}

export interface ReputationState {
  readonly schemaVersion: typeof REPUTATION_SCHEMA_VERSION;
  readonly points: readonly { readonly trackId: string; readonly points: number }[];
}

export type ReputationErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_TRACK'
  | 'INVALID_LEVEL'
  | 'INVALID_THRESHOLD'
  | 'INVALID_REWARD'
  | 'INVALID_MODIFIER'
  | 'DUPLICATE_TRACK'
  | 'MISSING_LEVEL'
  | 'UNKNOWN_TRACK'
  | 'INVALID_RELATION'
  | 'DUPLICATE_RELATION'
  | 'UNKNOWN_FACTION'
  | 'INVALID_POINTS'
  | 'INVALID_METADATA'
  | 'UNKNOWN_SOURCE';

export class ReputationError extends Error {
  readonly code: ReputationErrorCode;

  constructor(code: ReputationErrorCode, message: string) {
    super(message);
    this.name = 'ReputationError';
    this.code = code;
  }
}

const TRACK_KEYS = new Set(['id', 'subjectType', 'subjectId', 'sourceId', 'levels']);
const LEVEL_KEYS = new Set(['level', 'threshold', 'rewardIds', 'battleModifier']);
const MODIFIER_KEYS = new Set(['attackPercent', 'defensePercent', 'healingPercent', 'prepareDiscount']);
const RELATION_KEYS = new Set(['sourceFactionId', 'targetFactionId', 'relation', 'score']);
const CONFIG_KEYS = new Set(['schemaVersion', 'tracks', 'relations']);
const STATE_KEYS = new Set(['schemaVersion', 'points']);
const STATE_POINT_KEYS = new Set(['trackId', 'points']);
const RELATIONS = new Set<ReputationRelation>([
  'SELF', 'FRIENDLY', 'ALLIED', 'CONTACT', 'TRUCE', 'DISTANT', 'TRADE', 'UNSETTLED',
  'FRACTURED', 'NOMINAL', 'PRESSURED', 'MIXED', 'BORDER_CONFLICT', 'OPPOSED', 'HOSTILE', 'ENEMY',
]);

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(code: ReputationErrorCode, message: string): never {
  throw new ReputationError(code, message);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
  code: ReputationErrorCode = 'INVALID_CONFIG',
): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code, `${label} contains unknown field: ${key}`);
}

function requiredString(value: Record<string, unknown>, key: string, label: string): string {
  const candidate = value[key];
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.trim() !== candidate) {
    fail('INVALID_CONFIG', `${label}.${key} must be a non-empty trimmed string`);
  }
  return candidate;
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return safeInteger(value) && value >= 0;
}

function freezeModifier(value: ReputationBattleModifier): ReputationBattleModifier {
  return Object.freeze({
    attackPercent: value.attackPercent,
    defensePercent: value.defensePercent,
    healingPercent: value.healingPercent,
    prepareDiscount: value.prepareDiscount,
  });
}

function parseModifier(value: unknown, label: string): ReputationBattleModifier {
  if (!isRecord(value)) fail('INVALID_MODIFIER', `${label} must be an object`);
  assertOnlyKeys(value, MODIFIER_KEYS, label);
  for (const key of MODIFIER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('INVALID_MODIFIER', `${label}.${key} is required`);
  }
  if (!safeInteger(value.attackPercent) || value.attackPercent < 0 || value.attackPercent > 5
    || !safeInteger(value.defensePercent) || value.defensePercent < 0 || value.defensePercent > 5
    || !safeInteger(value.healingPercent) || value.healingPercent < 0 || value.healingPercent > 5
    || !safeInteger(value.prepareDiscount) || value.prepareDiscount < 0 || value.prepareDiscount > 2) {
    fail('INVALID_MODIFIER', `${label} contains an out-of-range battle modifier`);
  }
  return freezeModifier(value as ReputationBattleModifier);
}

function parseLevel(value: unknown, index: number): ReputationLevelDefinition {
  const label = `tracks.levels[${index}]`;
  if (!isRecord(value)) fail('INVALID_LEVEL', `${label} must be an object`);
  assertOnlyKeys(value, LEVEL_KEYS, label);
  for (const key of LEVEL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('INVALID_LEVEL', `${label}.${key} is required`);
  }
  if (!REPUTATION_LEVELS.includes(value.level as ReputationLevel)) fail('INVALID_LEVEL', `${label}.level is invalid`);
  if (!nonNegativeInteger(value.threshold)) fail('INVALID_THRESHOLD', `${label}.threshold must be a non-negative safe integer`);
  if (!Array.isArray(value.rewardIds) || value.rewardIds.length === 0
    || value.rewardIds.some((rewardId) => typeof rewardId !== 'string' || rewardId.length === 0 || rewardId.trim() !== rewardId)
    || new Set(value.rewardIds).size !== value.rewardIds.length) {
    fail('INVALID_REWARD', `${label}.rewardIds must be a unique non-empty string array`);
  }
  return Object.freeze({
    level: value.level as ReputationLevel,
    threshold: value.threshold,
    rewardIds: Object.freeze([...value.rewardIds] as string[]),
    battleModifier: parseModifier(value.battleModifier, `${label}.battleModifier`),
  });
}

function parseTrack(value: unknown, index: number): ReputationTrackDefinition {
  const label = `tracks[${index}]`;
  if (!isRecord(value)) fail('INVALID_TRACK', `${label} must be an object`);
  assertOnlyKeys(value, TRACK_KEYS, label);
  for (const key of TRACK_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('INVALID_TRACK', `${label}.${key} is required`);
  }
  const id = requiredString(value, 'id', label);
  const subjectId = requiredString(value, 'subjectId', label);
  const sourceId = requiredString(value, 'sourceId', label);
  if (value.subjectType !== 'RACE' && value.subjectType !== 'PROFESSION') fail('INVALID_TRACK', `${label}.subjectType is invalid`);
  if (!Array.isArray(value.levels) || value.levels.length !== REPUTATION_LEVELS.length) {
    fail('INVALID_LEVEL', `${label}.levels must contain exactly four levels`);
  }
  const levels = value.levels.map((level, levelIndex) => parseLevel(level, levelIndex));
  const seenLevels = new Set<number>();
  levels.forEach((level, levelIndex) => {
    if (seenLevels.has(level.level)) fail('INVALID_LEVEL', `${label}.levels contains duplicate level ${level.level}`);
    seenLevels.add(level.level);
    if (level.level !== REPUTATION_LEVELS[levelIndex]) fail('INVALID_LEVEL', `${label}.levels must be ordered 1 to 4`);
    if (levelIndex === 0 && level.threshold !== 0) fail('INVALID_THRESHOLD', `${label}.levels[0].threshold must be zero`);
    if (levelIndex > 0 && level.threshold <= levels[levelIndex - 1].threshold) {
      fail('INVALID_THRESHOLD', `${label}.levels thresholds must increase strictly`);
    }
  });
  return Object.freeze({
    id,
    subjectType: value.subjectType as ReputationSubjectType,
    subjectId,
    sourceId,
    levels: Object.freeze(levels),
  });
}

function parseRelation(value: unknown, index: number): ReputationRelationDefinition {
  const label = `relations[${index}]`;
  if (!isRecord(value)) fail('INVALID_RELATION', `${label} must be an object`);
  assertOnlyKeys(value, RELATION_KEYS, label);
  for (const key of RELATION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('INVALID_RELATION', `${label}.${key} is required`);
  }
  const sourceFactionId = requiredString(value, 'sourceFactionId', label);
  const targetFactionId = requiredString(value, 'targetFactionId', label);
  if (!REPUTATION_FACTIONS.includes(sourceFactionId as (typeof REPUTATION_FACTIONS)[number])
    || !REPUTATION_FACTIONS.includes(targetFactionId as (typeof REPUTATION_FACTIONS)[number])) {
    fail('UNKNOWN_FACTION', `${label} contains an unknown faction`);
  }
  if (!RELATIONS.has(value.relation as ReputationRelation)) fail('INVALID_RELATION', `${label}.relation is invalid`);
  if (!safeInteger(value.score) || value.score < -100 || value.score > 100) fail('INVALID_RELATION', `${label}.score must be -100 to 100`);
  if (sourceFactionId === targetFactionId && (value.relation !== 'SELF' || value.score !== 0)) {
    fail('INVALID_RELATION', `${label} self relation must be SELF with score zero`);
  }
  return Object.freeze({
    sourceFactionId,
    targetFactionId,
    relation: value.relation as ReputationRelation,
    score: value.score,
  });
}

function parseConfig(value: unknown): ReputationCatalogConfig {
  if (!isRecord(value)) fail('INVALID_CONFIG', 'reputation config must be an object');
  assertOnlyKeys(value, CONFIG_KEYS, 'reputation config');
  if (value.schemaVersion !== REPUTATION_SCHEMA_VERSION) fail('INVALID_CONFIG', 'unsupported reputation schema version');
  if (!Array.isArray(value.tracks) || value.tracks.length === 0) fail('INVALID_CONFIG', 'reputation tracks must be a non-empty array');
  if (!Array.isArray(value.relations) || value.relations.length === 0) fail('INVALID_CONFIG', 'reputation relations must be a non-empty array');
  if (value.tracks.length !== REPUTATION_RACES.length + REPUTATION_PROFESSIONS.length) {
    fail('INVALID_TRACK', 'reputation config must contain exactly seven race and four profession tracks');
  }
  const tracks = value.tracks.map(parseTrack);
  const trackIds = new Set<string>();
  const raceSources = new Set<string>();
  const professionSources = new Set<string>();
  tracks.forEach((track) => {
    if (trackIds.has(track.id)) fail('DUPLICATE_TRACK', `duplicate reputation track: ${track.id}`);
    trackIds.add(track.id);
    if (track.subjectId !== track.sourceId) fail('UNKNOWN_SOURCE', `track ${track.id} subject/source IDs must match`);
    if (track.subjectType === 'RACE') {
      if (!REPUTATION_RACES.includes(track.sourceId as (typeof REPUTATION_RACES)[number])) fail('UNKNOWN_SOURCE', `unknown race source: ${track.sourceId}`);
      if (raceSources.has(track.sourceId)) fail('DUPLICATE_TRACK', `duplicate race reputation source: ${track.sourceId}`);
      raceSources.add(track.sourceId);
    } else {
      if (!REPUTATION_PROFESSIONS.includes(track.sourceId as (typeof REPUTATION_PROFESSIONS)[number])) fail('UNKNOWN_SOURCE', `unknown profession source: ${track.sourceId}`);
      if (professionSources.has(track.sourceId)) fail('DUPLICATE_TRACK', `duplicate profession reputation source: ${track.sourceId}`);
      professionSources.add(track.sourceId);
    }
  });
  if (raceSources.size !== REPUTATION_RACES.length || REPUTATION_RACES.some((race) => !raceSources.has(race))
    || professionSources.size !== REPUTATION_PROFESSIONS.length
    || REPUTATION_PROFESSIONS.some((professionId) => !professionSources.has(professionId))) {
    fail('INVALID_TRACK', 'reputation config must contain the complete seven-race/four-profession track set');
  }
  const relations = value.relations.map(parseRelation);
  const relationKeys = new Set<string>();
  for (const relation of relations) {
    const key = `${relation.sourceFactionId}\u0000${relation.targetFactionId}`;
    if (relationKeys.has(key)) fail('DUPLICATE_RELATION', `duplicate faction relation: ${key}`);
    relationKeys.add(key);
  }
  if (relations.length !== REPUTATION_FACTIONS.length ** 2
    || relationKeys.size !== REPUTATION_FACTIONS.length ** 2) {
    fail('INVALID_RELATION', 'reputation relations must contain the complete faction matrix');
  }
  for (const sourceFactionId of REPUTATION_FACTIONS) {
    for (const targetFactionId of REPUTATION_FACTIONS) {
      if (!relationKeys.has(`${sourceFactionId}\u0000${targetFactionId}`)) {
        fail('INVALID_RELATION', `missing faction relation: ${sourceFactionId} -> ${targetFactionId}`);
      }
    }
  }
  return Object.freeze({
    schemaVersion: REPUTATION_SCHEMA_VERSION,
    tracks: Object.freeze([...tracks].sort((left, right) => compare(left.id, right.id))),
    relations: Object.freeze([...relations].sort((left, right) => compare(left.sourceFactionId, right.sourceFactionId)
      || compare(left.targetFactionId, right.targetFactionId))),
  });
}

function parsePoints(value: unknown, label: string): number {
  if (!nonNegativeInteger(value)) fail('INVALID_POINTS', `${label} must be a non-negative safe integer`);
  return value;
}

function canonicalConfig(config: ReputationCatalogConfig): ReputationCatalogConfig {
  return {
    schemaVersion: REPUTATION_SCHEMA_VERSION,
    tracks: config.tracks.map((track) => ({
      id: track.id,
      subjectType: track.subjectType,
      subjectId: track.subjectId,
      sourceId: track.sourceId,
      levels: track.levels.map((level) => ({
        level: level.level,
        threshold: level.threshold,
        rewardIds: [...level.rewardIds].sort(),
        battleModifier: { ...level.battleModifier },
      })),
    })).sort((left, right) => compare(left.id, right.id)),
    relations: config.relations.map((relation) => ({ ...relation }))
      .sort((left, right) => compare(left.sourceFactionId, right.sourceFactionId)
        || compare(left.targetFactionId, right.targetFactionId)),
  };
}

export class ReputationCatalog {
  readonly schemaVersion = REPUTATION_SCHEMA_VERSION;
  readonly tracks: readonly ReputationTrackDefinition[];
  readonly relations: readonly ReputationRelationDefinition[];
  private readonly trackById: ReadonlyMap<string, ReputationTrackDefinition>;
  private readonly relationByKey: ReadonlyMap<string, ReputationRelationDefinition>;

  constructor(config: ReputationCatalogConfig) {
    const parsed = parseConfig(config);
    const canonical = canonicalConfig(parsed);
    this.tracks = Object.freeze(canonical.tracks.map((track) => Object.freeze({
      ...track,
      levels: Object.freeze(track.levels.map((level) => Object.freeze({
        ...level,
        rewardIds: Object.freeze([...level.rewardIds]),
        battleModifier: freezeModifier(level.battleModifier),
      }))),
    })));
    this.relations = Object.freeze(canonical.relations.map((relation) => Object.freeze({ ...relation })));
    this.trackById = new Map(this.tracks.map((track) => [track.id, track]));
    this.relationByKey = new Map(this.relations.map((relation) => [
      `${relation.sourceFactionId}\u0000${relation.targetFactionId}`,
      relation,
    ]));
  }

  snapshot(): ReputationCatalogConfig {
    return structuredClone({
      schemaVersion: this.schemaVersion,
      tracks: this.tracks,
      relations: this.relations,
    });
  }

  getTrack(trackId: unknown): ReputationTrackDefinition {
    if (typeof trackId !== 'string' || !this.trackById.has(trackId)) fail('UNKNOWN_TRACK', `unknown reputation track: ${String(trackId)}`);
    return this.trackById.get(trackId)!;
  }

  levelFor(trackId: unknown, points: unknown): ReputationLevel {
    const track = this.getTrack(trackId);
    const normalizedPoints = parsePoints(points, 'reputation points');
    let level = REPUTATION_LEVELS[0];
    for (const definition of track.levels) {
      if (normalizedPoints >= definition.threshold) level = definition.level;
      else break;
    }
    return level;
  }

  progress(trackId: unknown, points: unknown): ReputationProgress {
    const track = this.getTrack(trackId);
    const normalizedPoints = parsePoints(points, 'reputation points');
    const level = this.levelFor(track.id, normalizedPoints);
    const current = track.levels[level - 1];
    const next = track.levels[level] ?? null;
    return Object.freeze({
      trackId: track.id,
      points: normalizedPoints,
      level,
      currentThreshold: current.threshold,
      nextThreshold: next?.threshold ?? null,
      pointsIntoLevel: normalizedPoints - current.threshold,
      pointsToNextLevel: next ? Math.max(0, next.threshold - normalizedPoints) : null,
      rewardIds: Object.freeze([...current.rewardIds]),
      battleModifier: freezeModifier(current.battleModifier),
    });
  }

  getBattleModifier(trackId: unknown, points: unknown): ReputationBattleModifier {
    return this.progress(trackId, points).battleModifier;
  }

  getRelation(sourceFactionId: unknown, targetFactionId: unknown): ReputationRelationDefinition {
    if (typeof sourceFactionId !== 'string' || typeof targetFactionId !== 'string') {
      fail('UNKNOWN_FACTION', 'faction relation IDs must be strings');
    }
    const relation = this.relationByKey.get(`${sourceFactionId}\u0000${targetFactionId}`);
    if (!relation) fail('UNKNOWN_FACTION', `unknown faction relation: ${sourceFactionId} -> ${targetFactionId}`);
    return relation;
  }

  createState(initialPoints?: readonly { readonly trackId: unknown; readonly points: unknown }[]): ReputationState {
    const input = initialPoints ?? [];
    const pointsByTrack = new Map<string, number>();
    for (const entry of input) {
      if (!isRecord(entry)) fail('INVALID_STATE', 'initial reputation state entries must be objects');
      const track = this.getTrack(entry.trackId);
      const points = parsePoints(entry.points, `initial reputation state ${track.id}`);
      if (pointsByTrack.has(track.id)) fail('INVALID_STATE', `duplicate initial reputation state: ${track.id}`);
      pointsByTrack.set(track.id, points);
    }
    return Object.freeze({
      schemaVersion: REPUTATION_SCHEMA_VERSION,
      points: Object.freeze(this.tracks.map((track) => Object.freeze({ trackId: track.id, points: pointsByTrack.get(track.id) ?? 0 }))),
    });
  }

  addPoints(state: ReputationState, trackId: unknown, amount: unknown): ReputationState {
    const current = normalizeState(this, state);
    const track = this.getTrack(trackId);
    const delta = parsePoints(amount, 'reputation amount');
    const points = current.points.map((entry) => entry.trackId === track.id
      ? { trackId: entry.trackId, points: entry.points + delta }
      : { ...entry });
    if (points.some((entry) => !Number.isSafeInteger(entry.points))) fail('INVALID_POINTS', 'reputation points exceed safe integer range');
    return Object.freeze({ schemaVersion: REPUTATION_SCHEMA_VERSION, points: Object.freeze(points) });
  }

  serialize(): string {
    return JSON.stringify(this.snapshot());
  }
}

function normalizeState(catalog: ReputationCatalog, value: unknown): ReputationState {
  if (!isRecord(value)) fail('INVALID_STATE', 'reputation state must be an object');
  assertOnlyKeys(value, STATE_KEYS, 'reputation state', 'INVALID_STATE');
  if (value.schemaVersion !== REPUTATION_SCHEMA_VERSION || !Array.isArray(value.points)) fail('INVALID_STATE', 'unsupported or incomplete reputation state');
  const points = value.points.map((entry, index) => {
    const label = `reputation state.points[${index}]`;
    if (!isRecord(entry)) fail('INVALID_STATE', `${label} must be an object`);
    for (const key of STATE_POINT_KEYS) if (!Object.prototype.hasOwnProperty.call(entry, key)) fail('INVALID_STATE', `${label}.${key} is required`);
    assertOnlyKeys(entry, STATE_POINT_KEYS, label, 'INVALID_STATE');
    const track = catalog.getTrack(entry.trackId);
    return { trackId: track.id, points: parsePoints(entry.points, `${label}.points`) };
  });
  if (points.length !== catalog.tracks.length || new Set(points.map((entry) => entry.trackId)).size !== points.length) {
    fail('INVALID_STATE', 'reputation state must contain exactly one entry for every track');
  }
  const expected = new Set(catalog.tracks.map((track) => track.id));
  if (points.some((entry) => !expected.has(entry.trackId))) fail('INVALID_STATE', 'reputation state contains an unknown track');
  return Object.freeze({
    schemaVersion: REPUTATION_SCHEMA_VERSION,
    points: Object.freeze([...points].sort((left, right) => compare(left.trackId, right.trackId))),
  });
}

export function createReputationCatalog(config: unknown): ReputationCatalog {
  return new ReputationCatalog(config as ReputationCatalogConfig);
}

export function serializeReputationCatalog(catalog: ReputationCatalog): string {
  if (!(catalog instanceof ReputationCatalog)) fail('INVALID_CONFIG', 'serializeReputationCatalog requires a ReputationCatalog');
  return catalog.serialize();
}

export function restoreReputationCatalog(serialized: string): ReputationCatalog {
  if (typeof serialized !== 'string' || serialized.trim().length === 0) fail('INVALID_STATE', 'reputation catalog save must be a non-empty string');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_STATE', 'reputation catalog save is not valid JSON');
  }
  try {
    return createReputationCatalog(parsed);
  } catch (error) {
    if (error instanceof ReputationError && error.code === 'INVALID_CONFIG') {
      throw new ReputationError('INVALID_STATE', error.message);
    }
    throw error;
  }
}

export function serializeReputationState(catalog: ReputationCatalog, state: ReputationState): string {
  return JSON.stringify(normalizeState(catalog, state));
}

export function restoreReputationState(catalog: ReputationCatalog, serialized: string): ReputationState {
  if (typeof serialized !== 'string' || serialized.trim().length === 0) fail('INVALID_STATE', 'reputation state save must be a non-empty string');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_STATE', 'reputation state save is not valid JSON');
  }
  return normalizeState(catalog, parsed);
}
