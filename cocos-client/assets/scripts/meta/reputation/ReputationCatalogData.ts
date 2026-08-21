import {
  REPUTATION_FACTIONS,
  REPUTATION_SCHEMA_VERSION,
  type ReputationCatalogConfig,
  type ReputationRelation,
  type ReputationSubjectType,
} from './Reputation.ts';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const LEVEL_BLUEPRINT = [
  { level: 1, threshold: 0, rewardSuffix: 'CONTACT', battleModifier: { attackPercent: 0, defensePercent: 0, healingPercent: 0, prepareDiscount: 0 } },
  { level: 2, threshold: 100, rewardSuffix: 'TRUST', battleModifier: { attackPercent: 1, defensePercent: 1, healingPercent: 1, prepareDiscount: 0 } },
  { level: 3, threshold: 300, rewardSuffix: 'ALLIANCE', battleModifier: { attackPercent: 2, defensePercent: 2, healingPercent: 2, prepareDiscount: 1 } },
  { level: 4, threshold: 700, rewardSuffix: 'OATH', battleModifier: { attackPercent: 3, defensePercent: 3, healingPercent: 3, prepareDiscount: 1 } },
] as const;

const TRACK_BLUEPRINTS: readonly {
  readonly id: string;
  readonly subjectType: ReputationSubjectType;
  readonly subjectId: string;
  readonly sourceId: string;
}[] = [
  { id: 'RACE_HUMAN', subjectType: 'RACE', subjectId: '人族', sourceId: '人族' },
  { id: 'RACE_FEATHERFOLK', subjectType: 'RACE', subjectId: '羽民', sourceId: '羽民' },
  { id: 'RACE_SCALEFOLK', subjectType: 'RACE', subjectId: '鳞民', sourceId: '鳞民' },
  { id: 'RACE_MOUNTAIN_SPIRIT', subjectType: 'RACE', subjectId: '山灵', sourceId: '山灵' },
  { id: 'RACE_UNDEAD', subjectType: 'RACE', subjectId: '冥裔', sourceId: '冥裔' },
  { id: 'RACE_CRAFTFOLK', subjectType: 'RACE', subjectId: '巧民', sourceId: '巧民' },
  { id: 'RACE_BEAST', subjectType: 'RACE', subjectId: '异兽', sourceId: '异兽' },
  { id: 'PROFESSION_COMMANDER', subjectType: 'PROFESSION', subjectId: 'P001', sourceId: 'P001' },
  { id: 'PROFESSION_ARCANIST', subjectType: 'PROFESSION', subjectId: 'P002', sourceId: 'P002' },
  { id: 'PROFESSION_COVENANT', subjectType: 'PROFESSION', subjectId: 'P003', sourceId: 'P003' },
  { id: 'PROFESSION_TACTICIAN', subjectType: 'PROFESSION', subjectId: 'P004', sourceId: 'P004' },
];

const RELATION_ROWS: Readonly<Record<string, Readonly<Record<string, { readonly relation: ReputationRelation; readonly score: number }>>>> = {
  '无籍行营': {
    '无籍行营': { relation: 'SELF', score: 0 }, '朔垣军府': { relation: 'FRIENDLY', score: 60 }, '天序神庭': { relation: 'HOSTILE', score: -70 },
    '河中诸国': { relation: 'UNSETTLED', score: 0 }, '离山仙盟': { relation: 'UNSETTLED', score: 0 }, '山海诸庭': { relation: 'CONTACT', score: 20 }, '归墟会': { relation: 'HOSTILE', score: -70 },
  },
  '朔垣军府': {
    '无籍行营': { relation: 'FRIENDLY', score: 60 }, '朔垣军府': { relation: 'SELF', score: 0 }, '天序神庭': { relation: 'FRACTURED', score: -20 },
    '河中诸国': { relation: 'ALLIED', score: 60 }, '离山仙盟': { relation: 'DISTANT', score: -10 }, '山海诸庭': { relation: 'TRUCE', score: 20 }, '归墟会': { relation: 'HOSTILE', score: -70 },
  },
  '天序神庭': {
    '无籍行营': { relation: 'HOSTILE', score: -70 }, '朔垣军府': { relation: 'NOMINAL', score: 20 }, '天序神庭': { relation: 'SELF', score: 0 },
    '河中诸国': { relation: 'PRESSURED', score: -20 }, '离山仙盟': { relation: 'OPPOSED', score: -40 }, '山海诸庭': { relation: 'HOSTILE', score: -70 }, '归墟会': { relation: 'ENEMY', score: -100 },
  },
  '河中诸国': {
    '无籍行营': { relation: 'UNSETTLED', score: 0 }, '朔垣军府': { relation: 'ALLIED', score: 60 }, '天序神庭': { relation: 'MIXED', score: -10 },
    '河中诸国': { relation: 'SELF', score: 0 }, '离山仙盟': { relation: 'TRADE', score: 30 }, '山海诸庭': { relation: 'BORDER_CONFLICT', score: -20 }, '归墟会': { relation: 'HOSTILE', score: -70 },
  },
  '离山仙盟': {
    '无籍行营': { relation: 'UNSETTLED', score: 0 }, '朔垣军府': { relation: 'DISTANT', score: -10 }, '天序神庭': { relation: 'OPPOSED', score: -40 },
    '河中诸国': { relation: 'TRADE', score: 30 }, '离山仙盟': { relation: 'SELF', score: 0 }, '山海诸庭': { relation: 'CONTACT', score: 20 }, '归墟会': { relation: 'UNSETTLED', score: 0 },
  },
  '山海诸庭': {
    '无籍行营': { relation: 'CONTACT', score: 20 }, '朔垣军府': { relation: 'TRUCE', score: 20 }, '天序神庭': { relation: 'HOSTILE', score: -70 },
    '河中诸国': { relation: 'BORDER_CONFLICT', score: -20 }, '离山仙盟': { relation: 'CONTACT', score: 20 }, '山海诸庭': { relation: 'SELF', score: 0 }, '归墟会': { relation: 'HOSTILE', score: -70 },
  },
  '归墟会': {
    '无籍行营': { relation: 'HOSTILE', score: -70 }, '朔垣军府': { relation: 'HOSTILE', score: -70 }, '天序神庭': { relation: 'ENEMY', score: -100 },
    '河中诸国': { relation: 'HOSTILE', score: -70 }, '离山仙盟': { relation: 'UNSETTLED', score: 0 }, '山海诸庭': { relation: 'HOSTILE', score: -70 }, '归墟会': { relation: 'SELF', score: 0 },
  },
};

function buildLevels(trackId: string) {
  return LEVEL_BLUEPRINT.map(({ level, threshold, rewardSuffix, battleModifier }) => ({
    level,
    threshold,
    rewardIds: [`REWARD_${trackId}_L${level}_${rewardSuffix}`],
    battleModifier: { ...battleModifier },
  }));
}

const tracks = TRACK_BLUEPRINTS.map(({ id, subjectType, subjectId, sourceId }) => ({
  id,
  subjectType,
  subjectId,
  sourceId,
  levels: buildLevels(id),
}));

const relations = REPUTATION_FACTIONS.flatMap((sourceFactionId) => REPUTATION_FACTIONS.map((targetFactionId) => ({
  sourceFactionId,
  targetFactionId,
  ...RELATION_ROWS[sourceFactionId][targetFactionId],
})));

export const REPUTATION_CATALOG_DATA: ReputationCatalogConfig = deepFreeze({
  schemaVersion: REPUTATION_SCHEMA_VERSION,
  tracks,
  relations,
});

export type ReputationCatalogData = typeof REPUTATION_CATALOG_DATA;
