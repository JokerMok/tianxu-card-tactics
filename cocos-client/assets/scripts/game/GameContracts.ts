export type Team = 0 | 1;
export type Profession = 1 | 2 | 3 | 4;
export interface BattlePlayerSpec {
  id: string;
  name: string;
  team: Team;
  hp: number;
  deck: string[];
  ai?: boolean;
  profession?: Profession;
  sex?: 0 | 1;
  monsterId?: number;
  attack?: number;
  effects?: number[];
}
export interface BattleSpec {
  id: string;
  seed: number;
  mapId: number;
  players: BattlePlayerSpec[];
  boardClearTeam?: Team;
  firstPlayer?: number;
  rows?: number;
  turnLimit?: number;
  initialUnits?: { monsterId: number; playerId: string; row: number; col: number }[];
}
export interface HandCard { instanceId: string; cardId: string; wait: number }
export interface BattlePlayer extends BattlePlayerSpec {
  maxHp: number;
  drawPile: string[];
  hand: HandCard[];
  graveyard: string[];
  fatigue: number;
  row: number;
  surrendered: boolean;
}
export interface UnitStatus {
  id: number;
  turns: number;
  sourceId?: string;
  /** Present only while a TypeID 39 source currently covers this unit. */
  auraEffectId?: number;
}
export interface BattleUnit {
  id: string;
  playerId: string;
  team: Team;
  cardId: string;
  monsterId: number;
  row: number;
  col: number;
  hp: number;
  maxHp: number;
  attack: number;
  range: number;
  movement: number;
  statuses: UnitStatus[];
  effects: number[];
  summonedTurn: number;
  flags: Record<string, number>;
}
export interface BattleEvent {
  seq: number;
  type: string;
  actor?: string;
  target?: string;
  amount?: number;
  effectiveAmount?: number;
  row?: number;
  col?: number;
  cardId?: string;
  skillId?: number;
  effectId?: number;
  message?: string;
}
export interface BattleState {
  version: 1;
  id: string;
  seed: number;
  rng: number;
  turn: number;
  revision: number;
  activePlayer: number;
  mapId: number;
  columns: number;
  rows: number;
  players: BattlePlayer[];
  units: BattleUnit[];
  events: BattleEvent[];
  status: 'playing' | 'settled';
  winner: Team | null;
  boardClearTeam?: Team;
  nextId: number;
}
export type BattleAction =
  | { type: 'play'; instanceId: string; row: number; col: number; targetId?: string }
  | { type: 'end' }
  | { type: 'surrender' };
export interface LegalPlay {
  instanceId: string;
  row: number;
  col: number;
  targetId?: string;
}
