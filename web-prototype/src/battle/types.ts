export type Side = 'player' | 'enemy';
export type BattleStatus = 'playing' | 'won' | 'lost';
export type CardKind = 'unit' | 'skill';
export type TargetType = 'lane' | 'enemy-unit' | 'ally-unit' | 'global';
export type Role = 'guard' | 'striker' | 'ranged' | 'healer' | 'fast' | 'caster';

export interface UnitDefinition {
  maxHp: number;
  attack: number;
  armor: number;
  move: number;
  range: number;
  role: Role;
  tags?: string[];
  heal?: number;
  burnOnHit?: number;
  knockbackOnHit?: number;
  firstMoveBonus?: number;
  stunOnHitChance?: number;
  enrageOnDamage?: number;
  enrageCap?: number;
}

export interface SkillDefinition {
  targetType: TargetType;
  damage?: number;
  heal?: number;
  burn?: { damage: number; rounds: number };
  freezeRounds?: number;
  knockback?: number;
  barrier?: number;
  prepareReduction?: { count: number; value: number };
}

export interface CardDefinition {
  id: string;
  name: string;
  shortName: string;
  kind: CardKind;
  prepare: number;
  copyLimit: number;
  faction?: string;
  profession?: string;
  unit?: UnitDefinition;
  skill?: SkillDefinition;
}

export interface CardInstance {
  instanceId: string;
  cardId: string;
  remaining: number;
}

export interface UnitStatus {
  burnDamage: number;
  burnRounds: number;
  freezeRounds: number;
  stunRounds: number;
  barrier: number;
}

export interface Unit {
  id: string;
  cardId: string;
  name: string;
  side: Side;
  lane: number;
  cell: number;
  hp: number;
  maxHp: number;
  attack: number;
  armor: number;
  move: number;
  range: number;
  role: Role;
  tags: string[];
  heal: number;
  burnOnHit: number;
  knockbackOnHit: number;
  firstMoveBonus: number;
  stunOnHitChance: number;
  enrageOnDamage: number;
  enrageCap: number;
  enrageGained: number;
  actionsTaken: number;
  spawnRound: number;
  status: UnitStatus;
}

export type CardTarget =
  | { kind: 'lane'; lane: number }
  | { kind: 'cell'; lane: number; cell: number }
  | { kind: 'unit'; unitId: string }
  | { kind: 'global' };

export interface BattleEvent {
  id: number;
  round: number;
  turn: number;
  type: string;
  message: string;
  side?: Side;
  sourceId?: string;
  targetId?: string;
  value?: number;
}

export interface BattleState {
  seed: number;
  rngState: number;
  rngCursor: number;
  round: number;
  turn: number;
  maxRounds: number;
  laneCount: number;
  cellsPerLane: number;
  summonDepth: number;
  openingInitiative: Side;
  activeSide: Side;
  heroHp: Record<Side, number>;
  heroMaxHp: Record<Side, number>;
  decks: Record<Side, string[]>;
  hands: Record<Side, CardInstance[]>;
  graveyards: Record<Side, string[]>;
  units: Unit[];
  events: BattleEvent[];
  status: BattleStatus;
  winner?: Side;
  nextId: number;
  nextEventId: number;
}

export interface PlayResult {
  state: BattleState;
  played: boolean;
  reason?: string;
}
