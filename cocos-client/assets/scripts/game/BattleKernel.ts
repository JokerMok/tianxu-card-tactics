import type {
  BattleAction, BattleEvent, BattleEventUnitView, BattlePlayer, BattleSpec, BattleState, BattleUnit,
  HandCard, LegalPlay, Team, UnitStatus,
} from './GameContracts.ts';
import { numeric, type RawRow, type RecoveredSkill, RecoveredContent } from './RecoveredContent.ts';

const COLUMNS = 12;
const OPENING_HAND = 5;
const MAX_HAND = 7;
const DEFAULT_TURN_LIMIT = 120;
const MAX_ROWS = 12;

// Families referenced by enabled main-scope monsters or statuses whose server
// algorithms were absent from the recovered client. Each family is handled by
// an explicit compatibility rule below; none relies on free-form text parsing.
const COMPATIBLE_EFFECT_TYPES = new Set([
  1, 2, 3, 8, 30, 46, 76, 77,
  101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
  120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139,
  140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150,
  151, 152, 153, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 170,
  171, 172, 173, 174, 175, 176, 179, 181, 182, 185, 186, 187, 189, 190, 191, 192, 194, 196, 199,
  200, 201, 202, 203, 204, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218,
  219, 220, 221, 222, 223, 224, 225, 226, 229, 230, 231, 232, 233, 235, 236, 237, 238, 239, 240,
  241, 242, 243, 244, 245, 247, 248, 249, 250, 251, 252, 253, 255, 256, 257, 258,
  405, 409, 501, 509, 600,
]);

type EffectLifecycle = 'static' | 'summon' | 'draw' | 'damage' | 'kill' | 'death' | 'move' | 'attack' | 'turn' | 'skill' | 'status' | 'marker';
const EFFECT_LIFECYCLES = new Map<number, Set<EffectLifecycle>>();
function registerEffectLifecycles(lifecycle: EffectLifecycle, types: readonly number[]): void {
  for (const type of types) {
    const values = EFFECT_LIFECYCLES.get(type) ?? new Set<EffectLifecycle>();
    values.add(lifecycle);
    EFFECT_LIFECYCLES.set(type, values);
  }
}
registerEffectLifecycles('static', [1, 2, 3, 8, 30, 46, 76, 77, 108, 111, 112, 116, 118, 120, 129, 130, 138, 148, 149, 156, 160, 163, 164, 165, 167, 179, 187, 189, 190, 191, 192, 208, 210, 216, 218, 220, 221, 225, 231, 232, 235, 236, 238, 240, 242, 245, 248, 250, 251, 252, 256, 257, 509]);
registerEffectLifecycles('summon', [1, 101, 102, 109, 114, 119, 122, 136, 141, 158, 172, 173, 185, 186, 211, 225, 229, 239, 247, 255, 501, 600]);
registerEffectLifecycles('draw', [127, 128, 182, 222]);
registerEffectLifecycles('damage', [103, 115, 120, 125, 126, 130, 134, 147, 148, 149, 157, 163, 164, 174, 179, 189, 190, 191, 192, 205, 208, 210, 212, 213, 218, 220, 221, 223, 231, 232, 235, 236, 242, 248, 249, 250, 256, 257, 258]);
registerEffectLifecycles('kill', [106, 143, 196, 226, 237, 251]);
registerEffectLifecycles('death', [77, 105, 123, 124, 135, 171, 175, 194, 203, 243, 252]);
registerEffectLifecycles('move', [108, 118, 167, 230, 244, 245, 253]);
registerEffectLifecycles('attack', [3, 8, 115, 121, 133, 138, 139, 142, 145, 156, 174, 179, 187, 190, 192, 232, 245, 250, 256]);
registerEffectLifecycles('turn', [107, 110, 113, 117, 121, 131, 132, 133, 137, 138, 139, 140, 142, 144, 145, 146, 150, 151, 152, 153, 155, 159, 161, 162, 166, 168, 170, 181, 199, 200, 201, 202, 204, 206, 207, 209, 214, 215, 217, 219, 224, 241, 405, 409]);
registerEffectLifecycles('skill', [104, 176, 217]);
registerEffectLifecycles('status', [233, 240, 509]);
registerEffectLifecycles('marker', [76, 77]);
for (const type of COMPATIBLE_EFFECT_TYPES) {
  if (!EFFECT_LIFECYCLES.has(type)) throw new Error(`Compatible effect TypeID ${type} has no lifecycle`);
}

type MutableState = BattleState;
type RuntimeSpec = BattleSpec & { turnLimit?: number };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asString(row: RawRow, key: string, fallback = ''): string {
  const value = row[key];
  return value === undefined || value === null ? fallback : String(value);
}

function optionalNumber(row: RawRow, key: string, fallback = 0): number {
  const value = row[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function cardRaw(content: RecoveredContent, cardId: string): RawRow | undefined {
  try { return content.card(cardId).raw; } catch { return undefined; }
}

interface EffectRow { id: number; type: number; raw: RawRow }

function collectEffectRows(content: RecoveredContent, ids: readonly number[], output: EffectRow[], seen: Set<number>): void {
  for (const id of ids) {
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    const raw = content.data.effects[String(id)];
    if (!raw) continue;
    const type = optionalNumber(raw, 'TypeID', 0);
    output.push({ id, type, raw });
    if (type === 15) {
      const children: number[] = [];
      for (let index = 1; index <= 8; index += 1) {
        const child = optionalNumber(raw, `param${index}`, 0);
        if (child > 0) children.push(child);
      }
      collectEffectRows(content, children, output, seen);
    }
  }
}

function activeEffectRows(content: RecoveredContent, unit: BattleUnit, type?: number): EffectRow[] {
  const rows: EffectRow[] = [];
  const seen = new Set<number>();
  const statusEffectIds = unit.statuses.flatMap(status => {
    const raw = content.data.statuses[String(status.id)];
    return raw ? effectIdsFromStatus(raw) : [];
  });
  const stripsBaseAbilities = statusEffectIds.some(id => optionalNumber(content.data.effects[String(id)] ?? {}, 'TypeID', 0) === 30);
  if (!stripsBaseAbilities) collectEffectRows(content, unit.effects, rows, seen);
  for (const status of unit.statuses) {
    const raw = content.data.statuses[String(status.id)];
    if (raw) collectEffectRows(content, effectIdsFromStatus(raw), rows, seen);
  }
  return type === undefined ? rows : rows.filter(effect => effect.type === type);
}

function hasEffectId(content: RecoveredContent, unit: BattleUnit, effectId: number): boolean {
  return activeEffectRows(content, unit).some(effect => effect.id === effectId);
}

function effectiveRange(content: RecoveredContent, unit: BattleUnit): number {
  return hasEffectType(content, unit, 30) || hasEffectId(content, unit, 7708) || unit.flags.disableRangeBonus === 1
    ? Math.max(1, unit.flags.baseRange ?? 1)
    : unit.range;
}

function hasEffectType(content: RecoveredContent, unit: BattleUnit, type: number): boolean {
  return activeEffectRows(content, unit, type).length > 0;
}

function emitEffect(state: MutableState, unit: BattleUnit, effect: EffectRow, message: string, target?: BattleUnit, amount?: number): void {
  emit(state, { type: 'effect', actor: unit.id, target: target?.id, effectId: effect.id, amount, message });
}

function unitSequence(unit: BattleUnit): number {
  const match = unit.id.match(/:(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function unitBySequence(state: BattleState, sequence: number): BattleUnit | undefined {
  return sequence > 0 ? state.units.find(unit => unitSequence(unit) === sequence) : undefined;
}

function integer(value: number, label: string, minimum?: number): number {
  if (!Number.isInteger(value) || (minimum !== undefined && value < minimum)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nextRandom(state: MutableState): number {
  // Mulberry32: compact, platform-independent and fully represented by state.rng.
  state.rng = (state.rng + 0x6D2B79F5) >>> 0;
  let value = state.rng;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function chance(state: MutableState, percent: number): boolean {
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  return nextRandom(state) * 100 < percent;
}

function shuffle(state: MutableState, values: string[]): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = Math.floor(nextRandom(state) * (index + 1));
    [values[index], values[other]] = [values[other]!, values[index]!];
  }
}

function eventUnitView(unit: BattleUnit | undefined): BattleEventUnitView | undefined {
  if (!unit) return undefined;
  return {
    ...unit,
    statuses: unit.statuses.map(status => ({ ...status })),
    effects: [...unit.effects],
    flags: { ...unit.flags },
  };
}

function emit(state: MutableState, event: Omit<BattleEvent, 'seq'>): void {
  const actorView = event.actorView ?? eventUnitView(event.actor ? state.units.find(unit => unit.id === event.actor) : undefined);
  const targetView = event.targetView ?? eventUnitView(event.target ? state.units.find(unit => unit.id === event.target) : undefined);
  state.events.push({
    seq: state.events.length ? state.events[state.events.length - 1]!.seq + 1 : 1,
    ...event,
    ...(actorView ? { actorView } : {}),
    ...(targetView ? { targetView } : {}),
  });
}

function player(state: BattleState, id: string): BattlePlayer {
  const found = state.players.find(candidate => candidate.id === id);
  if (!found) throw new Error(`Unknown battle actor ${id}`);
  return found;
}

function activePlayer(state: BattleState): BattlePlayer {
  const found = state.players[state.activePlayer];
  if (!found) throw new Error('Active player index is invalid');
  return found;
}

function heroFor(state: BattleState, playerId: string): BattleUnit | undefined {
  return state.units.find(unit => unit.playerId === playerId && unit.flags.hero === 1);
}

function occupied(state: BattleState, row: number, col: number, exceptId?: string): boolean {
  return state.units.some(unit => unit.hp > 0 && unit.id !== exceptId && unit.row === row && unit.col === col);
}

function effectIds(row: RawRow): number[] {
  const result: number[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const value = numeric(row, `ability${index}`, 0);
    if (value > 0 && !result.includes(value)) result.push(value);
  }
  return result;
}

function attackRange(monster: RawRow, content: RecoveredContent): number {
  let range = 1;
  let configured = false;
  const seen = new Set<number>();
  const visit = (effectId: number): void => {
    if (seen.has(effectId)) return;
    seen.add(effectId);
    const effect = content.data.effects[String(effectId)];
    if (!effect) return;
    const type = optionalNumber(effect, 'TypeID');
    if (type === 10) {
      configured = true;
      range += Math.max(0, optionalNumber(effect, 'param1'));
    }
    if (type === 15) {
      for (let index = 1; index <= 8; index += 1) {
        const child = optionalNumber(effect, `param${index}`, 0);
        if (child > 0) visit(child);
      }
    }
  };
  effectIds(monster).forEach(visit);
  // The recovered monster-table header explicitly defines AttackType 1 as
  // ranged. Keep configured range bonuses exact, and provide a two-cell
  // fallback only for ranged rows that have no TypeID 10 range effect.
  return Math.max(1, !configured && numeric(monster, 'AttackType', 0) === 1 ? 2 : range);
}

function nativeAttackRange(monster: RawRow): number {
  return numeric(monster, 'AttackType', 0) === 1 ? 2 : 1;
}

function baseMovement(monster: RawRow, content: RecoveredContent): number {
  let movement = 1;
  const seen = new Set<number>();
  const visit = (effectId: number): void => {
    if (seen.has(effectId)) return;
    seen.add(effectId);
    const effect = content.data.effects[String(effectId)];
    if (!effect) return;
    const type = optionalNumber(effect, 'TypeID');
    if (type === 9) movement += optionalNumber(effect, 'param1');
    if (type === 27) movement = 0;
    if (type === 15) {
      for (let index = 1; index <= 8; index += 1) {
        const child = optionalNumber(effect, `param${index}`, 0);
        if (child > 0) visit(child);
      }
    }
  };
  effectIds(monster).forEach(visit);
  return Math.max(0, movement);
}

function makeUnit(
  content: RecoveredContent,
  state: MutableState,
  owner: BattlePlayer,
  monsterId: number,
  cardId: string,
  row: number,
  col: number,
  hero: boolean,
): BattleUnit {
  const monster = content.data.monsters[String(monsterId)];
  if (!monster && monsterId > 0) throw new Error(`Unknown monster ${monsterId}`);
  const raw = monster ?? {};
  const configuredHp = numeric(raw, 'HP', owner.hp);
  const maxHp = hero ? owner.hp : Math.max(1, configuredHp);
  const attack = hero && owner.attack !== undefined ? owner.attack : Math.max(0, numeric(raw, 'Attack', hero ? 1 : 0));
  const configuredEffects = monster ? effectIds(raw) : [];
  if (hero) for (const effectId of owner.effects ?? []) if (effectId > 0 && !configuredEffects.includes(effectId)) configuredEffects.push(effectId);
  const unit: BattleUnit = {
    id: hero ? `hero:${owner.id}` : `unit:${state.nextId++}`,
    playerId: owner.id,
    team: owner.team,
    cardId,
    monsterId,
    row,
    col,
    hp: maxHp,
    maxHp,
    attack,
    range: 1,
    movement: hero ? 0 : (monster ? 1 : 0),
    statuses: [],
    effects: configuredEffects,
    summonedTurn: state.turn,
    flags: {
      hero: hero ? 1 : 0,
      aiType: numeric(raw, 'AIType', 0),
      attackType: numeric(raw, 'AttackType', 0),
      normalSkillId: numeric(raw, 'normalSkillID', 0),
      baseAttack: attack,
      baseMovement: hero ? 0 : (monster ? baseMovement(raw, content) : 0),
      baseRange: monster ? nativeAttackRange(raw) : 1,
      armor: 0,
    },
  };
  applyStaticEffects(content, state, unit, unit.effects);
  unit.range = Math.max(unit.range, unit.flags.baseRange ?? 1);
  return unit;
}

function applyStaticEffects(
  content: RecoveredContent,
  state: MutableState,
  unit: BattleUnit,
  ids: readonly number[],
  visited = new Set<number>(),
): void {
  for (const effectId of ids) {
    if (visited.has(effectId)) continue;
    visited.add(effectId);
    const effect = content.data.effects[String(effectId)];
    if (!effect) {
      unit.flags[`unresolvedEffect:${effectId}`] = 1;
      continue;
    }
    const type = optionalNumber(effect, 'TypeID');
    const p1 = optionalNumber(effect, 'param1', 0);
    const p2 = optionalNumber(effect, 'param2', 0);
    unit.flags[`effectType:${type}`] = (unit.flags[`effectType:${type}`] ?? 0) + 1;
    switch (type) {
      case 7: unit.attack += p1; break;
      case 9: unit.movement = Math.max(0, unit.movement + p1); break;
      case 10: unit.range = Math.max(1, unit.range + p1); break;
      case 11: unit.flags.flying = 1; unit.flags[`partialEffectType:${type}`] = 1; break;
      case 12: unit.flags.armor = Math.max(unit.flags.armor ?? 0, Math.abs(optionalNumber(effect, 'param3', p1))); break;
      case 13: unit.flags.rage = Math.max(unit.flags.rage ?? 0, Math.abs(p2 || p1)); break;
      case 14: unit.flags.targetEffect = p2; unit.flags.targetDamageMultiplier = optionalNumber(effect, 'param3', 2); break;
      case 16: unit.flags.vigilance = 1; break;
      case 17: unit.flags.backstabMultiplier = Math.max(2, Math.abs(p2 || p1)); break;
      case 18: unit.flags.regeneration = Math.max(unit.flags.regeneration ?? 0, Math.abs(p1)); break;
      case 19: unit.flags.healWeakest = Math.max(unit.flags.healWeakest ?? 0, Math.abs(p1)); break;
      case 20: unit.flags.healAll = Math.max(unit.flags.healAll ?? 0, Math.abs(p1)); break;
      case 21: unit.flags.heroic = Math.max(unit.flags.heroic ?? 0, Math.abs(p1)); break;
      case 22: unit.flags.lifeSteal = Math.max(unit.flags.lifeSteal ?? 0, Math.abs(p2 || 100)); break;
      case 23: unit.flags.sniper = 1; break;
      case 24: unit.flags.periodicDamage = Math.max(unit.flags.periodicDamage ?? 0, Math.abs(p2 || p1)); break;
      case 25: unit.flags.chargeAttack = Math.max(unit.flags.chargeAttack ?? 0, Math.abs(p2 || p1)); break;
      case 26: unit.flags.counterattack = 1; break;
      case 27: unit.flags.noMove = 1; break;
      case 28: unit.flags.noAct = 1; break;
      case 29: unit.flags.retaliateStatus = p2; unit.flags.retaliateStatusChance = optionalNumber(effect, 'param4', 100); break;
      case 31: unit.flags.onDamageStatus = p2; unit.flags.onDamageStatusChance = optionalNumber(effect, 'param4', 100); break;
      case 32: unit.flags.resurrectChance = Math.max(unit.flags.resurrectChance ?? 0, Math.abs(p1)); break;
      case 33: unit.flags.noAttack = 1; break;
      case 34: unit.flags.noHeal = 1; break;
      case 35: unit.flags.aiType = p1; break;
      case 36: unit.flags.handSpeed = Math.max(unit.flags.handSpeed ?? 0, Math.abs(p1)); break;
      case 37: unit.flags.knockback = Math.max(unit.flags.knockback ?? 0, Math.abs(p1)); break;
      case 38: unit.flags.hitAndRun = 1; break;
      case 39: unit.flags.auraEffect = p1; unit.flags.auraRange = optionalNumber(effect, 'param2', 1); break;
      case 40: unit.flags.terrorChance = Math.max(unit.flags.terrorChance ?? 0, Math.abs(p1)); break;
      case 41: unit.flags.returnHandChance = Math.max(unit.flags.returnHandChance ?? 0, Math.abs(p1)); break;
      case 42: unit.flags.deathSkill = p1; unit.flags.deathSkillChance = p2 || 100; unit.flags[`partialEffectType:${type}`] = 1; break;
      case 43: unit.flags.heroTickDamage = Math.max(unit.flags.heroTickDamage ?? 0, Math.abs(p1)); break;
      case 44: unit.flags.damageTransfer = 1; unit.flags.damageTransferRange = Math.max(1, optionalNumber(effect, 'param2', 1)); break;
      case 45: unit.flags.ambush = Math.max(unit.flags.ambush ?? 0, Math.abs(p1)); break;
      case 47: unit.flags.reflectDamage = 1; break;
      case 48: unit.flags.thorns = Math.max(unit.flags.thorns ?? 0, Math.abs(p2 || p1)); break;
      case 49: unit.flags.turnStatus = p1; unit.flags.turnStatusChance = optionalNumber(effect, 'param3', 100); break;
      case 50: {
        const child = p2;
        if (child > 0 && content.data.effects[String(child)]) applyStaticEffects(content, state, unit, [child], visited);
        unit.flags.timedCompositeTurns = Math.max(1, p1);
        break;
      }
      case 51: unit.flags.piercing = 1; break;
      case 52: unit.flags.deathSummonMonster = p1; break;
      case 53: unit.flags.firstStrike = Math.max(1, p1); break;
      case 54: unit.flags.blocksFlight = 1; break;
      case 55: unit.flags.charmed = 1; break;
      case 56: unit.flags.pulseStatus = optionalNumber(effect, 'param4', p1); unit.flags.pulseStatusChance = p1 || 100; break;
      case 57: unit.flags.dispelChance = p1 || 100; unit.flags.dispelEnemy = optionalNumber(effect, 'param3', 0); break;
      case 58: unit.flags.enemyHandSlow = Math.max(unit.flags.enemyHandSlow ?? 0, Math.abs(p1)); break;
      case 59: unit.flags.protector = 1; break;
      case 60: unit.flags.damageTakenMultiplier = Math.max(unit.flags.damageTakenMultiplier ?? 1, Math.abs(p2 || 2)); break;
      case 61: unit.flags.turnSummonMonster = p1; break;
      case 62: unit.flags.cleave = 1; unit.flags[`partialEffectType:${type}`] = 1; break;
      case 63: unit.flags.statusImmunity = Math.max(unit.flags.statusImmunity ?? 0, Math.abs(p1)); break;
      case 64: unit.flags.guardianAngel = 1; break;
      case 65: unit.flags.noAttackAfterMove = 1; break;
      case 66: unit.flags.extraAttacks = Math.max(unit.flags.extraAttacks ?? 0, Math.abs(p1)); break;
      case 67: unit.flags.untargetable = 1; break;
      case 68: unit.flags.healHpGrowth = Math.max(unit.flags.healHpGrowth ?? 0, Math.abs(p1)); break;
      case 69: unit.flags.healAttackGrowth = Math.max(unit.flags.healAttackGrowth ?? 0, Math.abs(p1)); break;
      case 70: unit.flags.randomDamage = Math.max(unit.flags.randomDamage ?? 0, Math.abs(p1)); break;
      case 71: unit.flags.countdownThreshold = p1; unit.flags.countdownDamageMultiplier = p2; break;
      case 72: unit.flags.countdownDefenseThreshold = p1; unit.flags.countdownDamageCap = p2; break;
      case 73: unit.movement = Math.max(0, Math.floor(unit.movement * (100 + p1) / 100)); break;
      case 74: unit.flags.statusAttackBonus = Math.max(0, p1); break;
      case 75: unit.flags.heroHitSummon = p1; break;
      case 78: unit.flags.burrow = 1; break;
      case 79: unit.flags.withdraw = 1; break;
      case 80: unit.flags.summonTrapDamage = Math.max(0, p1); break;
      case 81: unit.flags.flatVulnerability = Math.max(unit.flags.flatVulnerability ?? 0, Math.abs(p2 || p1)); break;
      case 82: unit.flags.summonHeroDamage = Math.max(unit.flags.summonHeroDamage ?? 0, Math.abs(p1)); break;
      case 83: unit.flags.killHp = Math.max(unit.flags.killHp ?? 0, Math.abs(p1)); break;
      case 84: unit.flags.halfDamage = 1; unit.flags[`partialEffectType:${type}`] = 1; break;
      case 85: unit.flags.skeletonMonster = p1; unit.flags[`partialEffectType:${type}`] = 1; break;
      case 86: unit.flags.transformAfterTurns = Math.max(1, p1 || 1); break;
      case 87: unit.flags.selfDamageChance = p1 || 100; break;
      case 88: unit.flags.deathHeroDamage = Math.max(unit.flags.deathHeroDamage ?? 0, Math.abs(p1)); break;
      case 89: unit.flags.damageHp = Math.max(unit.flags.damageHp ?? 0, Math.abs(p1)); break;
      case 90: unit.flags.hurtHp = Math.max(unit.flags.hurtHp ?? 0, Math.abs(p2 || p1)); break;
      case 91: unit.flags.enemyDeathAttack = Math.max(unit.flags.enemyDeathAttack ?? 0, Math.abs(p1)); break;
      case 92: unit.flags.deathHp = Math.max(unit.flags.deathHp ?? 0, Math.abs(p1)); break;
      case 93: unit.flags.heroHitSlow = Math.max(unit.flags.heroHitSlow ?? 0, Math.abs(p1)); break;
      case 94: unit.flags.randomSkill = 1; break;
      case 95: unit.flags.randomActiveEffect = 1; break;
      case 96: unit.flags.desperateStrength = 1; break;
      case 97: unit.flags.deferLethal = 1; break;
      case 98: unit.flags.hurtStatus = p2; unit.flags.hurtStatusChance = optionalNumber(effect, 'param4', 100); break;
      case 99: unit.flags.predator = 1; break;
      case 100: unit.flags.summonDrawCount = Math.max(unit.flags.summonDrawCount ?? 0, Math.abs(p1)); unit.flags.summonDrawChance = p2 || 100; break;
      case 205: unit.flags.damageImmunityMask = p1; break;
      case 801: unit.flags.summonHandSpeed = Math.max(unit.flags.summonHandSpeed ?? 0, Math.abs(p1)); break;
      case 15: {
        const children: number[] = [];
        for (let index = 1; index <= 8; index += 1) {
          const child = optionalNumber(effect, `param${index}`, 0);
          if (child > 0 && content.data.effects[String(child)]) children.push(child);
        }
        applyStaticEffects(content, state, unit, children, visited);
        break;
      }
      default:
        if (COMPATIBLE_EFFECT_TYPES.has(type)) {
          applyCompatibleStaticEffect(content, state, unit, effectId, effect, type, visited);
        } else if (applyDescriptionEffect(content, unit, effect)) {
          unit.flags[`descriptionEffectType:${type}`] = (unit.flags[`descriptionEffectType:${type}`] ?? 0) + 1;
        } else {
          // The original ID and family remain visible to clients and diagnostics.
          // No gameplay is fabricated for families whose server algorithm is absent.
          unit.flags[`unresolvedEffectType:${type}`] = (unit.flags[`unresolvedEffectType:${type}`] ?? 0) + 1;
        }
    }
  }
}

function applyCompatibleStaticEffect(
  content: RecoveredContent,
  state: MutableState,
  unit: BattleUnit,
  effectId: number,
  effect: RawRow,
  type: number,
  visited: Set<number>,
): void {
  const p1 = optionalNumber(effect, 'param1', 0);
  const p2 = optionalNumber(effect, 'param2', 0);
  const p3 = optionalNumber(effect, 'param3', 0);
  unit.flags[`compatibleEffectType:${type}`] = (unit.flags[`compatibleEffectType:${type}`] ?? 0) + 1;
  switch (type) {
    case 1:
      if (unit.flags.hero === 1) growHp(unit, p1);
      else unit.flags.heroHpAura = (unit.flags.heroHpAura ?? 0) + p1;
      break;
    case 2: unit.flags.blockChance = Math.max(0, (unit.flags.blockChance ?? 0) + p1 / 100); break;
    case 3:
    case 8: unit.flags.criticalChance = Math.max(0, (unit.flags.criticalChance ?? 0) + p1 / 100); break;
    case 30: unit.flags.stripBaseAbilities = 1; break;
    case 46:
      unit.flags.movementStyle = p1;
      if (p1 > 0) unit.flags.infiltrate = p1;
      break;
    case 76: {
      const month = state.seed % 12 + 1;
      const first = Math.max(1, Math.min(12, p1));
      const second = Math.max(1, Math.min(12, p2 || first));
      const active = month === first || month === second;
      const child = optionalNumber(effect, active ? 'param3' : 'param4', 0);
      unit.flags.calendarMonth = month;
      if (child > 0 && child !== 7701 && content.data.effects[String(child)]) applyStaticEffects(content, state, unit, [child], visited);
      break;
    }
    case 77:
      unit.flags[`ruleMarker:${effectId}`] = 1;
      if (effectId === 7702) { unit.flags.piercing = 1; unit.flags.eraseKills = 1; }
      if (effectId === 7703) unit.flags.incubate = 1;
      if (effectId === 7706) unit.flags.mutualOblivion = 1;
      if (effectId === 7707) unit.flags.disableMagicReflection = 1;
      if (effectId === 7708) unit.flags.disableRangeBonus = 1;
      if (effectId === 7709) unit.flags.armorBreakImmune = Math.max(1, unit.flags.armorBreakImmune ?? 0);
      break;
    case 103: unit.flags.pullOnDamageChance = p1 || 100; break;
    case 108:
    case 118: unit.flags.infiltrate = Math.max(unit.flags.infiltrate ?? 0, p1 || 1); break;
    case 111: unit.flags.invincible = 1; break;
    case 112: unit.flags.untargetable = 1; unit.flags.statusImmunity = 3; break;
    case 116: unit.flags.adjacentDamageTransfer = Math.max(1, p2 || 1); break;
    case 120: unit.flags.heroLifeSteal = Math.max(unit.flags.heroLifeSteal ?? 0, p2 || 100); unit.flags.heroLifeStealType = p1; break;
    case 125: unit.flags.heroHitReturnChance = p1 || 100; break;
    case 129: unit.flags.protectHero = 1; break;
    case 130:
      unit.flags.heroDamageRule = p2;
      unit.flags.heroDamageReduction = Math.max(unit.flags.heroDamageReduction ?? 0, Math.abs(p3));
      unit.flags.heroDamageType = p1;
      break;
    case 134: unit.flags.assaultChance = p1 || 100; break;
    case 138: unit.flags.halfFieldMode = p1; unit.flags.halfFieldAttack = p2; break;
    case 148: unit.flags.heroReflectType = p2; unit.flags.heroReflectChance = p3 || 100; break;
    case 149: unit.flags.turnReflectionEffect = p2 || p1; break;
    case 156: unit.flags.statusAttackPerBuff = p2; unit.flags.statusHpPerBuff = p3; break;
    case 157: unit.flags.bonusDamageTarget = p1; unit.flags.bonusDamage = p2; unit.flags.bonusDamageType = p3; break;
    case 160: unit.flags.noReturn = 1; break;
    case 163: unit.flags.sharedPainHero = p1 || 1; break;
    case 164: unit.flags.damageOwnHero = 1; break;
    case 165:
      if (p1 === 1) unit.attack = 1;
      else { unit.maxHp = Math.max(1, unit.maxHp > 0 ? 1 : 0); unit.hp = Math.min(unit.hp, unit.maxHp); }
      break;
    case 167: unit.flags.reverseMove = 1; break;
    case 179: unit.flags.mercyAttribute = p1; unit.flags.mercyThreshold = p2; break;
    case 187: unit.flags.noGrowth = 1; break;
    case 189: unit.flags.bypassTransfer = 1; break;
    case 190: unit.flags.adjacentAttackBonus = p2; unit.flags.adjacentAttackRange = Math.max(1, optionalNumber(effect, 'param5', 1)); break;
    case 191: unit.flags.adjacentReduction = p2; unit.flags.adjacentReductionRange = Math.max(1, optionalNumber(effect, 'param5', 1)); break;
    case 192: unit.flags.edgeAttackTenths = p3; unit.flags.edgeHp = p2; break;
    case 208: unit.flags.elementAbsorbChance = p1 || 100; unit.flags.elementAbsorbType = p2; unit.flags.elementAbsorbHp = optionalNumber(effect, 'param7', p3); break;
    case 210: unit.flags.teamHeroDamageType = p1; unit.flags.teamHeroDamageCap = optionalNumber(effect, 'param4', 1); break;
    case 216: unit.flags.designatedProtector = 1; break;
    case 218: unit.flags.preventFriendlySplash = 1; break;
    case 220: unit.flags.rewindChance = p1 || 100; unit.flags.previousHp = unit.hp; break;
    case 221: unit.flags.suppression = 1; break;
    case 225: unit.flags.enemyBond = 1; break;
    case 231: unit.flags.transferDamageMultiplier = Math.max(1, p1); break;
    case 232: unit.flags.magicDamageAttack = 1; break;
    case 235: unit.flags.ignoreRepeatedHits = 1; break;
    case 236: unit.flags.physicalDamagePierces = 1; break;
    case 238: unit.flags.mergeMonster = p1; unit.flags.mergeEffect = p2; break;
    case 240: unit.flags.liveAttackReduction = p1; unit.flags.liveHpReduction = p2; break;
    case 242: unit.flags.physicalRecoveryPercent = p2; break;
    case 245: unit.flags.moveChargePercent = p1; break;
    case 248: unit.flags.magicDamageToHp = 1; break;
    case 250: unit.flags.adjacentAttackPool = 1; unit.flags.piercing = 1; break;
    case 251: unit.flags.eraseKills = 1; break;
    case 252: unit.flags.soulShieldMax = Math.max(1, p1); break;
    case 256: unit.flags.storePhysicalDamage = 1; break;
    case 257: unit.flags.enemyDamageSplitPercent = Math.max(0, Math.min(100, p1)); break;
    case 509: unit.attack = Math.max(0, unit.attack + p1); break;
    default:
      // Triggered and conditional families are interpreted at their named
      // lifecycle hook (summon, turn, draw, damage, kill, death or card play).
      break;
  }
}

function firstNumber(text: string, patterns: readonly RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  return undefined;
}

function applyDescriptionEffect(content: RecoveredContent, unit: BattleUnit, effect: RawRow): boolean {
  const text = `${asString(effect, 'Name')} ${asString(effect, 'EffectDes')}`;
  const lower = text.toLowerCase();
  let applied = false;
  const attack = firstNumber(text, [/\+(\d+)\s*Attack/i, /Attack\s*\+(\d+)/i, /攻击力?\s*\+(\d+)/]);
  const hp = firstNumber(text, [/\+(\d+)\s*(?:Life|HP)/i, /(?:Life|HP)\s*\+(\d+)/i, /生命(?:力|上限)?\s*\+(\d+)/]);
  const movement = firstNumber(text, [/\+(\d+)\s*Movement/i, /移动(?:力|格数)?\s*\+(\d+)/]);
  const range = firstNumber(text, [/\+(\d+)\s*Range/i, /射程\s*\+(\d+)/]);
  if (attack !== undefined) { unit.attack += attack; applied = true; }
  if (hp !== undefined) { growHp(unit, hp); applied = true; }
  if (movement !== undefined) { unit.movement += movement; applied = true; }
  if (range !== undefined) { unit.range += range; applied = true; }
  const periodic = firstNumber(text, [/(?:takes?|受到)\s*(\d+)\s*(?:\w+\s*)?damage.*(?:each|每).*turn/i, /每回合.*?(\d+)点.*?伤害/]);
  if (periodic !== undefined) { unit.flags.periodicDamage = Math.max(unit.flags.periodicDamage ?? 0, periodic); applied = true; }
  const regeneration = firstNumber(text, [/(?:restores?|heals?)\s*(\d+)\s*(?:Life|HP).*each turn/i, /每回合.*?(?:恢复|治疗).*?(\d+)/]);
  if (regeneration !== undefined) { unit.flags.regeneration = Math.max(unit.flags.regeneration ?? 0, regeneration); applied = true; }
  const heroDamage = firstNumber(text, [/(?:deals?|造成)\s*(\d+).*?(?:enemy hero|敌方英雄).*?(?:each turn|每回合)/i]);
  if (heroDamage !== undefined) { unit.flags.heroTickDamage = Math.max(unit.flags.heroTickDamage ?? 0, heroDamage); applied = true; }
  if (/cannot (?:move|移动)|无法移动|不能移动/i.test(text)) { unit.flags.noMove = 1; applied = true; }
  if (/cannot (?:act|行动)|无法行动|不能行动/i.test(text)) { unit.flags.noAct = 1; applied = true; }
  if (/cannot attack|无法攻击|不能攻击/i.test(text)) { unit.flags.noAttack = 1; applied = true; }
  if (/cannot be healed|无法被治疗|禁止治疗/i.test(text)) { unit.flags.noHeal = 1; applied = true; }
  if (/damage taken.*(?:half|50%)|受到.*伤害.*(?:减半|50%)/i.test(text)) { unit.flags.halfDamage = 1; applied = true; }
  const armor = firstNumber(text, [/reduces?.*damage taken by\s*(\d+)/i, /受到.*伤害.*减少\s*(\d+)/]);
  if (armor !== undefined) { unit.flags.armor = Math.max(unit.flags.armor ?? 0, armor); applied = true; }
  if (/flying|飞行/i.test(text)) { unit.flags.flying = 1; applied = true; }
  if (/reflects?.*damage|反射.*伤害/i.test(text)) { unit.flags.reflectDamage = 1; applied = true; }
  if (/converts?.*damage dealt to (?:HP|Life)|吸血/i.test(text)) { unit.flags.lifeSteal = 100; applied = true; }
  if (/damage dealt cannot be reduced|伤害无法被减免|不可减免/i.test(text)) { unit.flags.piercing = 1; applied = true; }
  const extraAttacks = firstNumber(text, [/attacks?\s*(\d+)\s*times/i, /攻击\s*(\d+)\s*次/]);
  if (extraAttacks !== undefined && extraAttacks > 1) { unit.flags.extraAttacks = Math.max(unit.flags.extraAttacks ?? 0, extraAttacks - 1); applied = true; }
  const drawCount = firstNumber(text, [/draw(?:ing|s)?\s*(\d+)\s*(?:extra\s*)?cards?/i, /抽(?:取)?\s*(\d+)\s*张/]);
  if (drawCount !== undefined && /summon|进场|召唤/i.test(text)) { unit.flags.summonDrawCount = drawCount; unit.flags.summonDrawChance = optionalNumber(effect, 'param2', 100); applied = true; }
  const summonId = optionalNumber(effect, 'param1', 0);
  if (/summons?|召唤/i.test(text) && summonId > 0 && content.data.monsters[String(summonId)]) { unit.flags.turnSummonMonster = summonId; applied = true; }
  if (/resurrect|reanimate|复活|重生/i.test(text)) { unit.flags.resurrectChance = Math.max(unit.flags.resurrectChance ?? 0, optionalNumber(effect, 'param1', 100)); applied = true; }
  if (/returns?.*hand.*(?:dying|death)|死亡.*返回.*准备栏|还魂/i.test(text)) { unit.flags.returnHandChance = Math.max(unit.flags.returnHandChance ?? 0, optionalNumber(effect, 'param1', 100)); applied = true; }
  if (/immune to.*damage|免疫.*伤害/i.test(text)) { unit.flags.damageImmunityMask = optionalNumber(effect, 'param1', 127); applied = true; }
  if (/immune to.*(?:positive|negative) effects|免疫.*(?:增益|减益)/i.test(text)) { unit.flags.statusImmunity = 3; applied = true; }
  if (/first attack.*(?:double|x2)|首次攻击.*(?:双倍|2倍)/i.test(text)) { unit.flags.ambush = 2; applied = true; }
  if (/counterattack|retaliate|反击/i.test(lower)) { unit.flags.counterattack = 1; applied = true; }
  return applied;
}

function syncHero(state: MutableState, unit: BattleUnit): void {
  if (unit.flags.hero !== 1) return;
  const owner = player(state, unit.playerId);
  owner.hp = Math.max(0, unit.hp);
}

function draw(content: RecoveredContent, state: MutableState, owner: BattlePlayer, count = 1): void {
  for (let drawn = 0; drawn < count; drawn += 1) {
    if (owner.hand.length >= MAX_HAND) {
      emit(state, { type: 'draw-blocked', actor: owner.id, amount: owner.hand.length });
      continue;
    }
    const drawBlocker = state.units.filter(unit => unit.team !== owner.team && unit.hp > 0).flatMap(unit => activeEffectRows(content, unit, 128).map(effect => ({ unit, effect })))
      .find(({ effect }) => chance(state, optionalNumber(effect.raw, 'param1', 0)));
    if (drawBlocker) {
      emitEffect(state, drawBlocker.unit, drawBlocker.effect, 'draw-failed', heroFor(state, owner.id));
      continue;
    }
    const cardId = owner.drawPile.shift();
    if (cardId === undefined) {
      owner.fatigue += 1;
      const hero = heroFor(state, owner.id);
      if (hero && hero.hp > 0) damage(content, state, undefined, hero, owner.fatigue, true, 'fatigue');
      emit(state, { type: 'fatigue', actor: owner.id, amount: owner.fatigue });
      continue;
    }
    const switcheroo = state.units.filter(unit => unit.team !== owner.team && unit.hp > 0).flatMap(unit => activeEffectRows(content, unit, 222).map(effect => ({ unit, effect })))
      .find(({ effect }) => cardKind(content, cardId) !== 2 && chance(state, optionalNumber(effect.raw, 'param2', 100)));
    if (switcheroo) {
      const thief = player(state, switcheroo.unit.playerId);
      if (addCardToHand(content, state, thief, cardId)) {
        const replacement = String(optionalNumber(switcheroo.effect.raw, 'param1', 0));
        if (!replacement || !content.data.cards[replacement] || !addCardToHand(content, state, owner, replacement)) owner.graveyard.push(cardId);
        emitEffect(state, switcheroo.unit, switcheroo.effect, 'switcheroo', heroFor(state, owner.id), 1);
        continue;
      }
    }
    const card = content.card(cardId);
    const hand: HandCard = { instanceId: `card:${state.nextId++}`, cardId, wait: Math.max(0, numeric(card.raw, 'InitReady')) };
    owner.hand.push(hand);
    emit(state, { type: 'draw', actor: owner.id, cardId });
    for (const watcher of state.units.filter(unit => unit.hp > 0)) {
      for (const effect of activeEffectRows(content, watcher)) {
        if (effect.type === 127 && watcher.team !== owner.team && chance(state, optionalNumber(effect.raw, 'param1', 100))) {
          const hero = heroFor(state, owner.id);
          if (hero) damage(content, state, watcher, hero, Math.abs(optionalNumber(effect.raw, 'param2', 0)), true, 'draw-punish', undefined, optionalNumber(effect.raw, 'param3', 6));
          emitEffect(state, watcher, effect, 'draw-punish', hero, optionalNumber(effect.raw, 'param2', 0));
        } else if (effect.type === 182 && watcher.playerId === owner.id) {
          watcher.attack += optionalNumber(effect.raw, 'param2', 0);
          growHp(watcher, optionalNumber(effect.raw, 'param3', 0));
          emitEffect(state, watcher, effect, 'draw-growth', watcher, 1);
        }
      }
    }
  }
}

function heal(state: MutableState, source: BattleUnit | undefined, target: BattleUnit, amount: number, skillId?: number): number {
  if (amount <= 0 || target.hp <= 0 || target.flags.noHeal === 1 || (target.flags.statusNoHeal ?? 0) > 0) return 0;
  const restored = Math.min(amount, target.maxHp - target.hp);
  if (restored <= 0) return 0;
  const hpBefore = target.hp;
  target.hp += restored;
  syncHero(state, target);
  emit(state, { type: 'heal', actor: source?.id, target: target.id, amount: restored, skillId, hpBefore, hpAfter: target.hp });
  if (source && source.hp > 0) {
    if ((source.flags.healHpGrowth ?? 0) > 0) growHp(source, source.flags.healHpGrowth!);
    if ((source.flags.healAttackGrowth ?? 0) > 0) source.attack += source.flags.healAttackGrowth!;
    if (source.flags.desperateStrength === 1) source.attack = Math.max(0, source.attack - restored);
  }
  return restored;
}

function growHp(unit: BattleUnit, amount: number): void {
  if (amount <= 0) return;
  unit.maxHp += amount;
  unit.hp += amount;
}

function applyStatus(content: RecoveredContent, state: MutableState, source: BattleUnit | undefined, target: BattleUnit, statusId: number): void {
  const raw = content.data.statuses[String(statusId)];
  if (!raw || target.hp <= 0) return;
  const harmful = numeric(raw, 'Harm', 0) === 1;
  const immunity = target.flags.statusImmunity ?? 0;
  if (immunity === 3 || (immunity === 1 && !harmful) || (immunity === 2 && harmful)) return;
  const turns = Math.max(1, numeric(raw, 'Turns', 1));
  const existing = target.statuses.find(candidate => candidate.id === statusId && candidate.auraEffectId === undefined);
  if (existing) existing.turns = Math.max(existing.turns, turns);
  else {
    target.statuses.push({ id: statusId, turns, sourceId: source?.id });
    applyStatusModifiers(content, target, statusId, 1);
  }
  emit(state, { type: 'status', actor: source?.id, target: target.id, effectId: statusId, message: asString(raw, 'Name') });
}

function applyStatusForTurns(
  content: RecoveredContent,
  state: MutableState,
  source: BattleUnit | undefined,
  target: BattleUnit,
  statusId: number,
  turns: number,
): void {
  applyStatus(content, state, source, target, statusId);
  const applied = target.statuses.find(status => status.id === statusId);
  if (applied) applied.turns = Math.max(1, turns || applied.turns);
}

function monsterValue(content: RecoveredContent, unit: BattleUnit, key: string, fallback = 0): number {
  return optionalNumber(content.data.monsters[String(unit.monsterId)] ?? {}, key, fallback);
}

function cardKind(content: RecoveredContent, cardId: string): number {
  return optionalNumber(cardRaw(content, cardId) ?? {}, 'Type', 0);
}

function applyStatusModifiers(content: RecoveredContent, target: BattleUnit, statusId: number, direction: 1 | -1): void {
  const status = content.data.statuses[String(statusId)];
  if (!status) return;
  for (const effectId of effectIdsFromStatus(status)) {
    const effect = content.data.effects[String(effectId)];
    if (!effect) continue;
    const type = optionalNumber(effect, 'TypeID');
    const p1 = optionalNumber(effect, 'param1', 0);
    const p2 = optionalNumber(effect, 'param2', 0);
    const p3 = optionalNumber(effect, 'param3', p1);
    if (type === 7) target.attack = Math.max(0, target.attack + direction * p1);
    else if (type === 9) target.movement = Math.max(0, target.movement + direction * p1);
    else if (type === 10) target.range = Math.max(1, target.range + direction * p1);
    else if (type === 12) target.flags.armor = Math.max(0, (target.flags.armor ?? 0) + direction * Math.abs(p3));
    else if (type === 27) target.flags.statusNoMove = Math.max(0, (target.flags.statusNoMove ?? 0) + direction);
    else if (type === 28) target.flags.statusNoAct = Math.max(0, (target.flags.statusNoAct ?? 0) + direction);
    else if (type === 33) target.flags.statusNoAttack = Math.max(0, (target.flags.statusNoAttack ?? 0) + direction);
    else if (type === 34) target.flags.statusNoHeal = Math.max(0, (target.flags.statusNoHeal ?? 0) + direction);
    else if (type === 55) target.flags.statusCharmed = Math.max(0, (target.flags.statusCharmed ?? 0) + direction);
    else if (type === 60) {
      const multiplier = Math.max(1, Math.abs(p2 || 2));
      target.flags.statusDamageMultiplier = direction === 1
        ? (target.flags.statusDamageMultiplier ?? 1) * multiplier
        : Math.max(1, (target.flags.statusDamageMultiplier ?? 1) / multiplier);
    } else if (type === 81) target.flags.statusFlatVulnerability = Math.max(0, (target.flags.statusFlatVulnerability ?? 0) + direction * Math.abs(p2 || p1));
    else if (type === 1) {
      target.maxHp = Math.max(1, target.maxHp + direction * p1);
      target.hp = direction === 1 ? Math.max(1, target.hp + p1) : Math.min(target.hp, target.maxHp);
    } else if (type === 2) target.flags.blockChance = Math.max(0, (target.flags.blockChance ?? 0) + direction * p1 / 100);
    else if (type === 3 || type === 8) target.flags.criticalChance = Math.max(0, (target.flags.criticalChance ?? 0) + direction * p1 / 100);
    else if (type === 509) target.attack = Math.max(0, target.attack + direction * p1);
    else if (type === 233 || type === 240) {
      const attackPercent = Math.max(0, Math.min(100, p1));
      const hpPercent = Math.max(0, Math.min(100, p2));
      const attackKey = `statusAttackLoss:${effectId}`;
      const hpKey = `statusHpLoss:${effectId}`;
      if (direction === 1) {
        const attackLoss = Math.floor(target.attack * attackPercent / 100);
        const hpLoss = Math.floor(target.maxHp * hpPercent / 100);
        target.flags[attackKey] = attackLoss;
        target.flags[hpKey] = hpLoss;
        target.attack = Math.max(0, target.attack - attackLoss);
        target.maxHp = Math.max(1, target.maxHp - hpLoss);
        target.hp = Math.min(target.hp, target.maxHp);
      } else {
        target.attack += target.flags[attackKey] ?? 0;
        target.maxHp += target.flags[hpKey] ?? 0;
        target.hp = Math.min(target.hp, target.maxHp);
        delete target.flags[attackKey];
        delete target.flags[hpKey];
      }
    }
  }
}

function auraAreaContains(content: RecoveredContent, source: BattleUnit, target: BattleUnit, areaId: number): boolean {
  const area = content.data.areas[String(areaId)];
  if (!area) return false;
  const dx = target.col - source.col;
  const dy = target.row - source.row;
  if (optionalNumber(area, 'type', 0) === 1) {
    for (let index = 1; index <= 20; index += 2) {
      const x = optionalNumber(area, `参数${index}`, Number.NaN);
      const y = optionalNumber(area, `参数${index + 1}`, Number.NaN);
      if (Number.isFinite(x) && Number.isFinite(y) && dx === x && dy === y) return true;
    }
    return false;
  }
  for (let index = 1; index <= 20; index += 4) {
    const x1 = optionalNumber(area, `参数${index}`, Number.NaN);
    const x2 = optionalNumber(area, `参数${index + 1}`, Number.NaN);
    const y1 = optionalNumber(area, `参数${index + 2}`, Number.NaN);
    const y2 = optionalNumber(area, `参数${index + 3}`, Number.NaN);
    if (![x1, x2, y1, y2].every(Number.isFinite)) continue;
    if (dx >= Math.min(x1, x2) && dx <= Math.max(x1, x2)
        && dy >= Math.min(y1, y2) && dy <= Math.max(y1, y2)) return true;
  }
  return false;
}

function auraTargetMatches(content: RecoveredContent, state: BattleState, source: BattleUnit, target: BattleUnit, effect: EffectRow): boolean {
  if (source.id === target.id || target.hp <= 0) return false;
  const relation = source.team === target.team
    ? (target.flags.hero === 1 ? 8 : 4)
    : (target.flags.hero === 1 ? 2 : 1);
  if ((optionalNumber(effect.raw, 'param3', 0) & relation) === 0) return false;
  if (!auraAreaContains(content, source, target, optionalNumber(effect.raw, 'param2', 0))) return false;
  const filterMode = optionalNumber(effect.raw, 'param4', 0);
  const filterValue = optionalNumber(effect.raw, 'param5', 0);
  if (!filterValue) {
    if (filterMode === 3) {
      const friendly = state.units.filter(unit => unit.hp > 0 && unit.flags.hero !== 1 && unit.team === source.team).length;
      const enemy = state.units.filter(unit => unit.hp > 0 && unit.flags.hero !== 1 && unit.team !== source.team).length;
      return enemy > friendly;
    }
    return true;
  }
  if (filterMode === 1) return target.monsterId === filterValue;
  if (filterMode === 2) return (filterValue & (1 << monsterValue(content, target, 'AttackType', 0))) !== 0;
  // The main table uses param5 as a Phyle filter. One recovered row has a
  // non-standard param4 value but still names the same Phyle in param5.
  return monsterValue(content, target, 'Phyle', 0) === filterValue;
}

function refreshAuras(content: RecoveredContent, state: MutableState): void {
  const desired = new Map<string, { target: BattleUnit; source: BattleUnit; effect: EffectRow; statusId: number }>();
  for (const source of state.units.filter(unit => unit.hp > 0)) {
    for (const effect of activeEffectRows(content, source, 39)) {
      const statusId = optionalNumber(effect.raw, 'param1', 0);
      if (!content.data.statuses[String(statusId)]) continue;
      for (const target of state.units) {
        if (!auraTargetMatches(content, state, source, target, effect)) continue;
        const key = `${target.id}:${statusId}`;
        if (!desired.has(key)) desired.set(key, { target, source, effect, statusId });
      }
    }
  }
  for (const unit of state.units) {
    const expired = unit.statuses.filter(status => status.auraEffectId !== undefined
      && !desired.has(`${unit.id}:${status.id}`));
    for (const status of expired) {
      applyStatusModifiers(content, unit, status.id, -1);
      emit(state, { type: 'status', actor: status.sourceId, target: unit.id, effectId: status.id, message: 'aura-removed' });
    }
    const expiredSet = new Set(expired);
    unit.statuses = unit.statuses.filter(status => !expiredSet.has(status));
  }
  for (const { target, source, effect, statusId } of desired.values()) {
    const existing = target.statuses.find(status => status.id === statusId && status.auraEffectId !== undefined);
    if (existing) {
      existing.sourceId = source.id;
      existing.auraEffectId = effect.id;
      continue;
    }
    const raw = content.data.statuses[String(statusId)]!;
    const harmful = numeric(raw, 'Harm', 0) === 1;
    const immunity = target.flags.statusImmunity ?? 0;
    if (immunity === 3 || (immunity === 1 && !harmful) || (immunity === 2 && harmful)) continue;
    target.statuses.push({ id: statusId, turns: Number.MAX_SAFE_INTEGER, sourceId: source.id, auraEffectId: effect.id });
    applyStatusModifiers(content, target, statusId, 1);
    emitEffect(state, source, effect, 'aura-applied', target, statusId);
  }
}

function protectionTarget(
  content: RecoveredContent,
  state: MutableState,
  source: BattleUnit | undefined,
  target: BattleUnit,
  damageType: number,
): BattleUnit | undefined {
  if (source && (source.flags.bypassTransfer === 1 || hasEffectType(content, source, 189))) return undefined;
  const bonded = unitBySequence(state, target.flags.enemyBondSequence ?? 0);
  if (bonded?.hp && bonded.id !== source?.id) return bonded;
  const soulBond = state.units.find(unit => unit.id !== target.id && unit.team === target.team && unit.hp > 0
    && Object.entries(unit.flags).some(([key, value]) => key.startsWith('soulBond:') && value === unitSequence(target)));
  if (soulBond && soulBond.id !== source?.id) return soulBond;
  const allies = state.units.filter(unit => unit.id !== target.id && unit.team === target.team && unit.hp > 0);
  const designated = allies.find(unit => activeEffectRows(content, unit, 216).some(effect => {
    const ids = [3, 4, 5].map(index => optionalNumber(effect.raw, `param${index}`, 0));
    return ids.includes(target.monsterId);
  }));
  if (designated) return designated;
  if (target.flags.hero === 1) {
    const bodyguard = allies.filter(unit => unit.flags.protectHero === 1 || hasEffectType(content, unit, 129))
      .sort((a, b) => distance(a, target) - distance(b, target) || a.id.localeCompare(b.id))[0];
    if (bodyguard) return bodyguard;
  }
  const absorber = allies.find(unit => activeEffectRows(content, unit, 208).some(effect => {
    const type = optionalNumber(effect.raw, 'param2', -1);
    return (type < 0 || type === damageType) && chance(state, optionalNumber(effect.raw, 'param1', 100));
  }));
  if (absorber) {
    const row = activeEffectRows(content, absorber, 208)[0]!;
    growHp(absorber, Math.max(0, optionalNumber(row.raw, 'param7', optionalNumber(row.raw, 'param3', 0))));
    emitEffect(state, absorber, row, 'element-absorb', target);
    return absorber;
  }
  if (target.flags.adjacentDamageTransfer === 1 || hasEffectType(content, target, 116)) {
    const adjacent = allies.filter(unit => unit.flags.hero !== 1 && distance(unit, target) <= 1)
      .sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id))[0];
    if (adjacent) return adjacent;
  }
  return allies.filter(unit => (unit.flags.protector === 1 || unit.flags.damageTransfer === 1)
      && distance(unit, target) <= (unit.flags.damageTransferRange ?? state.columns))
    .sort((a, b) => distance(a, target) - distance(b, target) || a.id.localeCompare(b.id))[0];
}

function handleKillEffects(content: RecoveredContent, state: MutableState, source: BattleUnit, target: BattleUnit): void {
  if (target.flags.killHandled === 1) return;
  target.flags.killHandled = 1;
  const owner = player(state, source.playerId);
  for (const effect of activeEffectRows(content, source)) {
    const p1 = optionalNumber(effect.raw, 'param1', 0);
    const p2 = optionalNumber(effect.raw, 'param2', 0);
    const p3 = optionalNumber(effect.raw, 'param3', 0);
    const p4 = optionalNumber(effect.raw, 'param4', 0);
    switch (effect.type) {
      case 106:
        source.attack += p1;
        emitEffect(state, source, effect, 'kill-attack', target, p1);
        break;
      case 143: {
        const hero = heroFor(state, target.playerId);
        if (hero) damage(content, state, source, hero, Math.abs(p1), false, 'kill-hero', undefined, p2);
        emitEffect(state, source, effect, 'kill-hero', hero, p1);
        break;
      }
      case 196: {
        const usedKey = `killRevives:${state.turn}`;
        if ((source.flags[usedKey] ?? 0) < Math.max(1, p4) && chance(state, p3 || 100)) {
          const cardId = owner.graveyard.find(id => cardKind(content, id) === 1);
          if (cardId) {
            const raw = cardRaw(content, cardId)!;
            const monsterId = optionalNumber(raw, 'MonsterID', 0);
            owner.graveyard.splice(owner.graveyard.indexOf(cardId), 1);
            summonToken(content, state, owner, monsterId, source.row, source.col);
            source.flags[usedKey] = (source.flags[usedKey] ?? 0) + 1;
          }
        }
        emitEffect(state, source, effect, 'kill-revive', target, source.flags[usedKey] ?? 0);
        break;
      }
      case 226: {
        const key = `killDraws:${state.turn}`;
        if ((source.flags[key] ?? 0) < Math.max(1, p4) && chance(state, p3 || 100)) {
          draw(content, state, owner, Math.max(1, p1));
          source.flags[key] = (source.flags[key] ?? 0) + 1;
        }
        emitEffect(state, source, effect, 'kill-draw', target, source.flags[key] ?? 0);
        break;
      }
      case 237: {
        const hero = heroFor(state, owner.id);
        if (hero && chance(state, p2 || 100)) heal(state, source, hero, Math.abs(p1));
        emitEffect(state, source, effect, 'kill-heal', hero, p1);
        break;
      }
      case 251:
        if (chance(state, p1 || 100)) target.flags.erased = 1;
        emitEffect(state, source, effect, 'erase', target, 1);
        break;
    }
  }
}

function drawMatching(content: RecoveredContent, state: MutableState, owner: BattlePlayer, count: number, kind: number): number {
  let drawn = 0;
  while (drawn < count && owner.hand.length < MAX_HAND) {
    const index = owner.drawPile.findIndex(cardId => !kind || cardKind(content, cardId) === kind);
    if (index < 0) break;
    const cardId = owner.drawPile.splice(index, 1)[0]!;
    if (!addCardToHand(content, state, owner, cardId)) { owner.drawPile.splice(index, 0, cardId); break; }
    emit(state, { type: 'draw', actor: owner.id, cardId, message: 'effect-filter' });
    drawn += 1;
  }
  return drawn;
}

function resolveDamageDealtEffects(
  content: RecoveredContent,
  state: MutableState,
  source: BattleUnit,
  target: BattleUnit,
  dealt: number,
  skillId?: number,
  damageType = 0,
): void {
  if (dealt <= 0) return;
  const owner = player(state, source.playerId);
  for (const effect of activeEffectRows(content, source)) {
    const p1 = optionalNumber(effect.raw, 'param1', 0);
    const p2 = optionalNumber(effect.raw, 'param2', 0);
    const p3 = optionalNumber(effect.raw, 'param3', 0);
    const p4 = optionalNumber(effect.raw, 'param4', 0);
    switch (effect.type) {
      case 103:
        if (target.flags.hero !== 1 && chance(state, p1 || 100)) {
          const col = source.col + (source.team === 0 ? 1 : -1);
          if (col > 0 && col < state.columns - 1 && !occupied(state, source.row, col, target.id)) {
            target.row = source.row;
            target.col = col;
            emitEffect(state, source, effect, 'pull', target, 1);
          }
        }
        break;
      case 125:
        if (target.flags.hero === 1 && chance(state, p1 || 100)) {
          emitEffect(state, source, effect, 'hero-hit-return', source, 1);
          returnUnitToHand(content, state, source);
        }
        break;
      case 126:
        if (target.flags.hero === 1 && chance(state, p2 || 100)) {
          const victim = player(state, target.playerId);
          let removed = 0;
          for (let index = 0; index < Math.max(1, p1) && victim.drawPile.length; index += 1) {
            victim.graveyard.push(victim.drawPile.shift()!);
            removed += 1;
          }
          if (p3 > 0 && content.data.cards[String(p3)]) victim.drawPile.push(String(p3));
          emitEffect(state, source, effect, 'temptation', target, removed);
        }
        break;
      case 134:
        if (target.flags.hero !== 1 && chance(state, p1 || 100)) {
          const hero = heroFor(state, target.playerId);
          if (hero?.hp) damage(content, state, source, hero, dealt, true, 'assault', skillId, damageType);
          emitEffect(state, source, effect, 'assault', hero, dealt);
        }
        break;
      case 147: {
        const correctTarget = p2 === 1 ? target.flags.hero !== 1 : target.flags.hero === 1;
        if (correctTarget && chance(state, p4 || 100)) {
          const drawn = drawMatching(content, state, owner, Math.max(1, p1), p3);
          emitEffect(state, source, effect, 'damage-draw', target, drawn);
        }
        break;
      }
      case 157: {
        const correctTarget = p1 === 1 ? target.flags.hero === 1 : target.flags.hero !== 1;
        if (correctTarget && p2 > 0 && target.hp > 0) {
          damage(content, state, source, target, p2, false, 'bonus-damage', skillId, p3);
          emitEffect(state, source, effect, 'bonus-damage', target, p2);
        }
        break;
      }
      case 212:
        if (target.flags.hero !== 1 && target.hp > 1 && target.hp <= p2 && chance(state, p1 || 100)) {
          const loss = target.hp - 1;
          target.hp = 1;
          emitEffect(state, source, effect, 'maim', target, loss);
        }
        break;
      case 223: {
        const parasitic = source.statuses.find(status => {
          const raw = content.data.statuses[String(status.id)];
          return raw && effectIdsFromStatus(raw).some(id => optionalNumber(content.data.effects[String(id)] ?? {}, 'TypeID', 0) === 223);
        });
        const healer = parasitic?.sourceId ? state.units.find(unit => unit.id === parasitic.sourceId && unit.hp > 0) : undefined;
        if (healer) { heal(state, source, healer, dealt); emitEffect(state, healer, effect, 'parasite-heal', healer, dealt); }
        break;
      }
      case 249:
        if (source.flags.firstDamageStatusApplied !== 1 && p1 > 0 && target.hp > 0) {
          source.flags.firstDamageStatusApplied = 1;
          applyStatusForTurns(content, state, source, target, p1, p2);
          emitEffect(state, source, effect, 'first-damage-status', target, p1);
        }
        break;
      case 258:
        if (source.flags.firstDamageReturnApplied !== 1) {
          source.flags.firstDamageReturnApplied = 1;
          const victims = state.units.filter(unit => unit.team !== source.team && unit.flags.hero !== 1 && unit.hp > 0 && distance(unit, target) <= 1
            && optionalNumber(cardRaw(content, unit.cardId) ?? {}, 'InitReady', 0) <= p2);
          for (const victim of [...victims]) returnUnitToHand(content, state, victim);
          emitEffect(state, source, effect, 'area-return', target, victims.length);
        }
        break;
    }
  }
}

function damage(
  content: RecoveredContent,
  state: MutableState,
  source: BattleUnit | undefined,
  target: BattleUnit,
  amount: number,
  piercing = false,
  message?: string,
  skillId?: number,
  damageType = 0,
): number {
  if (amount <= 0 || target.hp <= 0) return 0;
  if (message !== 'transferred' && message !== 'damage-split') {
    const protector = protectionTarget(content, state, source, target, damageType);
    if (protector) return damage(content, state, source, protector, amount, piercing, 'transferred', skillId, damageType);
  }
  if (source && message === undefined && distance(source, target) <= effectiveRange(content, target) && (target.flags.firstStrike ?? 0) > 0) {
    const counter = damage(content, state, target, source, target.attack, false, 'first-strike', target.flags.normalSkillId || undefined, target.flags.attackType ?? 0);
    if (source.hp <= 0 || (target.flags.firstStrike === 1 && counter > 0)) return 0;
  }
  if (source && message === undefined && target.flags.burrow === 1) {
    const moveFrom = { row: target.row, col: target.col };
    const col = source.col + (source.team === 0 ? -1 : 1);
    if (col > 0 && col < state.columns - 1 && !occupied(state, source.row, col, target.id)) {
      target.row = source.row; target.col = col;
      emit(state, { type: 'move', actor: target.id, row: target.row, col: target.col, moveFrom, moveTo: { row: target.row, col: target.col }, message: 'burrow' });
      if (distance(source, target) > effectiveRange(content, source)) return 0;
    }
  }
  if (source && message === undefined && target.flags.withdraw === 1) {
    const moveFrom = { row: target.row, col: target.col };
    for (let step = 0; step < target.movement; step += 1) {
      const col = target.col + (target.col >= source.col ? 1 : -1);
      if (col <= 0 || col >= state.columns - 1 || occupied(state, target.row, col, target.id)) break;
      target.col = col;
    }
    emit(state, { type: 'move', actor: target.id, row: target.row, col: target.col, moveFrom, moveTo: { row: target.row, col: target.col }, message: 'withdraw' });
    if (distance(source, target) > effectiveRange(content, source)) return 0;
  }
  if ((target.flags.damageImmuneTurns ?? 0) > 0 || target.flags.invincible === 1 || hasEffectType(content, target, 111)) return 0;
  if ((target.flags.souls ?? 0) > 0) {
    target.flags.souls -= 1;
    emit(state, { type: 'effect', actor: target.id, target: target.id, amount: 0, message: 'soul-shield' });
    return 0;
  }
  if ((target.flags.blockChance ?? 0) > 0 && chance(state, target.flags.blockChance!)) {
    emit(state, { type: 'damage', actor: source?.id, target: target.id, amount: 0, skillId, message: 'blocked' });
    return 0;
  }
  if ((target.flags.magicDamageToHp === 1 || hasEffectType(content, target, 248)) && damageType >= 2) {
    const hpBefore = target.hp;
    growHp(target, amount);
    emit(state, { type: 'heal', actor: target.id, target: target.id, amount, hpBefore, hpAfter: target.hp, message: 'magic-conversion' });
    return 0;
  }
  if ((target.flags.ignoreRepeatedHits === 1 || hasEffectType(content, target, 235)) && source
      && target.flags.lastHitTurn === state.turn && target.flags.lastHitSource === unitSequence(source)
      && target.flags.lastHitSkill === (skillId ?? -1)) return 0;
  target.flags.lastHitTurn = state.turn;
  target.flags.lastHitSource = source ? unitSequence(source) : 0;
  target.flags.lastHitSkill = skillId ?? -1;
  const damageMask = target.flags.damageImmunityMask ?? 0;
  if ((damageMask & (1 << Math.max(0, damageType))) !== 0) return 0;
  let dealt = amount;
  if (source && target.flags.countdownDefenseThreshold !== undefined && target.flags.countdownDamageCap !== undefined) {
    const countdown = source.flags.hero === 1 ? 0 : optionalNumber(cardRaw(content, source.cardId) ?? {}, 'InitReady', 0);
    const threshold = target.flags.countdownDefenseThreshold!;
    const matches = threshold < 0 ? countdown <= Math.abs(threshold) : countdown >= threshold;
    if (matches) dealt = Math.min(dealt, Math.max(0, target.flags.countdownDamageCap!));
  }
  for (const immunity of activeEffectRows(content, target, 205)) {
    const capMode = optionalNumber(immunity.raw, 'param2', 0);
    const cap = optionalNumber(immunity.raw, 'param3', 0);
    const probability = optionalNumber(immunity.raw, 'param4', 0);
    if ((!probability || chance(state, probability)) && capMode === 2) dealt = Math.min(dealt, Math.max(0, cap));
  }
  if (target.flags.hero === 1) {
    for (const watcher of state.units.filter(unit => unit.team === target.team && unit.hp > 0 && unit.id !== target.id)) {
      for (const effect of activeEffectRows(content, watcher)) {
        if (effect.type === 130) {
          const mode = optionalNumber(effect.raw, 'param2', 1);
          const value = Math.abs(optionalNumber(effect.raw, 'param3', 0));
          dealt = mode === 2 ? Math.min(dealt, value) : Math.max(0, dealt - value);
        } else if (effect.type === 210) dealt = Math.min(dealt, Math.max(0, optionalNumber(effect.raw, 'param4', 1)));
      }
    }
  }
  const adjacentReductionRow = activeEffectRows(content, target, 191)[0];
  const adjacentReduction = target.flags.adjacentReduction ?? (adjacentReductionRow ? optionalNumber(adjacentReductionRow.raw, 'param2', 0) : 0);
  if (adjacentReduction && state.units.some(unit => unit.team !== target.team && unit.hp > 0 && distance(unit, target) <= (target.flags.adjacentReductionRange ?? 1))) dealt = Math.max(0, dealt - adjacentReduction);
  if (damageType <= 1 && (target.flags.physicalDamagePierces === 1 || hasEffectType(content, target, 236))) piercing = true;
  if (!piercing) dealt = Math.max(0, dealt - (target.flags.armor ?? 0));
  if (message === 'transferred') dealt *= Math.max(1, target.flags.transferDamageMultiplier ?? 1);
  if (target.flags.halfDamage === 1) dealt = Math.ceil(dealt / 2);
  const reflectionDisabled = hasEffectId(content, target, 7707) || target.flags.disableMagicReflection === 1;
  const halfReflect = reflectionDisabled ? undefined : activeEffectRows(content, target, 213)[0];
  if (halfReflect) dealt = Math.ceil(dealt * Math.max(0, 100 - optionalNumber(halfReflect.raw, 'param1', 50)) / 100);
  dealt = Math.max(0, Math.floor(dealt * (target.flags.damageTakenMultiplier ?? 1) * (target.flags.statusDamageMultiplier ?? 1))
    + (target.flags.flatVulnerability ?? 0) + (target.flags.statusFlatVulnerability ?? 0));
  const split = activeEffectRows(content, target, 257)[0];
  if (split && message !== 'damage-split') {
    const portion = Math.floor(dealt * optionalNumber(split.raw, 'param1', 50) / 100);
    const other = randomItem(state, state.units.filter(unit => unit.team !== target.team && unit.hp > 0 && unit.flags.hero !== 1 && unit.id !== source?.id && distance(unit, target) <= 1));
    if (other && portion > 0) {
      dealt -= portion;
      damage(content, state, target, other, portion, true, 'damage-split', skillId, damageType);
      emitEffect(state, target, split, 'enemy-damage-split', other, portion);
    }
  }
  if (dealt <= 0) {
    emit(state, { type: 'damage', actor: source?.id, target: target.id, amount: 0, skillId, message: message ?? 'blocked' });
    return 0;
  }
  const hpBefore = target.hp;
  target.flags.previousHp = target.flags.previousHp ?? hpBefore;
  const effectiveAmount = Math.min(hpBefore, dealt);
  target.hp = Math.max(0, target.hp - dealt);
  if (source) target.flags.lastDamagerSequence = unitSequence(source);
  if (target.hp <= 0 && target.flags.deferLethal === 1 && target.flags.deferredOnce !== 1) {
    target.flags.deferredOnce = 1;
    target.flags.pendingDeath = 1;
    target.hp = 1;
  }
  const rewind = activeEffectRows(content, target, 220)[0];
  if (target.hp <= 0 && rewind && chance(state, optionalNumber(rewind.raw, 'param1', 0))) {
    target.hp = Math.max(1, Math.min(target.maxHp, target.flags.previousHp ?? 1));
    emitEffect(state, target, rewind, 'turn-back-time', target, target.hp);
  }
  syncHero(state, target);
  emit(state, { type: 'damage', actor: source?.id, target: target.id, amount: dealt, effectiveAmount, hpBefore, hpAfter: target.hp, skillId, message });
  if (halfReflect && source && source.hp > 0 && message !== 'half-reflection') {
    const reflected = Math.max(1, Math.floor(amount * optionalNumber(halfReflect.raw, 'param2', 100) / 200));
    damage(content, state, target, source, reflected, true, 'half-reflection', skillId, damageType);
  }
  if (target.hp > 0) {
    if ((target.flags.rage ?? 0) > 0) target.attack += target.flags.rage!;
    if ((target.flags.hurtHp ?? 0) > 0) growHp(target, target.flags.hurtHp!);
    if (target.flags.desperateStrength === 1) target.attack += dealt;
    if ((target.flags.hurtStatus ?? 0) > 0 && chance(state, target.flags.hurtStatusChance ?? 100)) applyStatus(content, state, target, target, target.flags.hurtStatus!);
    if (damageType <= 1 && (target.flags.physicalRecoveryPercent ?? 0) > 0) heal(state, target, target, Math.floor(dealt * target.flags.physicalRecoveryPercent! / 100));
    if (damageType <= 1 && (target.flags.storePhysicalDamage === 1 || hasEffectType(content, target, 256))) target.flags.storedPhysicalDamage = (target.flags.storedPhysicalDamage ?? 0) + dealt;
    if (damageType >= 2 && (target.flags.magicDamageAttack === 1 || hasEffectType(content, target, 232))) target.flags.magicDamageHits = (target.flags.magicDamageHits ?? 0) + 1;
    if ((target.flags.sharedPainHero === 1 || hasEffectType(content, target, 163)) && target.flags.hero !== 1 && message !== 'shared-pain') {
      const hero = heroFor(state, target.playerId);
      if (hero?.hp) damage(content, state, target, hero, dealt, true, 'shared-pain', skillId, damageType);
    }
  }
  if (source && source.hp > 0) {
    const stolen = Math.floor(dealt * (source.flags.lifeSteal ?? 0) / 100);
    if (stolen > 0) heal(state, source, source, stolen);
    if ((source.flags.heroic ?? 0) > 0) source.attack += source.flags.heroic!;
    if ((source.flags.damageHp ?? 0) > 0) growHp(source, source.flags.damageHp!);
    if ((source.flags.onDamageStatus ?? 0) > 0 && chance(state, source.flags.onDamageStatusChance ?? 100)) {
      applyStatus(content, state, source, target, source.flags.onDamageStatus!);
    }
    const suppressed = source.flags.suppression === 1 || hasEffectType(content, source, 221);
    if (!suppressed && (target.flags.thorns ?? 0) > 0 && target.hp > 0) damage(content, state, target, source, target.flags.thorns!, false, 'thorns');
    if (!suppressed && !reflectionDisabled && target.flags.reflectDamage === 1 && activeEffectRows(content, target, 47).length > 0
        && target.hp > 0 && message !== 'reflection') damage(content, state, target, source, dealt, true, 'reflection', skillId, damageType);
    if (!suppressed && target.flags.counterattack === 1 && target.hp > 0 && message !== 'counter' && distance(target, source) <= effectiveRange(content, target)) {
      emit(state, { type: 'attack', actor: target.id, target: source.id, amount: target.attack, skillId: target.flags.normalSkillId || undefined, message: 'counter' });
      damage(content, state, target, source, target.attack, false, 'counter', target.flags.normalSkillId || undefined, target.flags.attackType ?? 0);
    }
    if ((target.flags.retaliateStatus ?? 0) > 0 && chance(state, target.flags.retaliateStatusChance ?? 100)) applyStatus(content, state, target, source, target.flags.retaliateStatus!);
    if ((target.flags.selfDamageChance ?? 0) > 0 && chance(state, target.flags.selfDamageChance!)) damage(content, state, target, target, dealt, true, 'self-curse', skillId, damageType);
    const heroSteal = source.flags.heroLifeSteal ?? (activeEffectRows(content, source, 120)[0] ? optionalNumber(activeEffectRows(content, source, 120)[0]!.raw, 'param2', 100) : 0);
    if (heroSteal > 0) {
      const hero = heroFor(state, source.playerId);
      if (hero) heal(state, source, hero, Math.floor(dealt * heroSteal / 100));
    }
    if ((source.flags.damageOwnHero === 1 || hasEffectType(content, source, 164)) && message !== 'shared-pain') {
      const hero = heroFor(state, source.playerId);
      if (hero?.hp) damage(content, state, source, hero, dealt, true, 'shared-pain', skillId, damageType);
    }
    const offensiveTrigger = !['reflection', 'counter', 'thorns', 'shared-pain', 'damage-split', 'half-reflection', 'assault', 'bonus-damage'].includes(message ?? '');
    if (offensiveTrigger) resolveDamageDealtEffects(content, state, source, target, dealt, skillId, damageType);
    if (target.flags.hero === 1 && !['hero-reflection', 'reflection'].includes(message ?? '')) {
      const reflector = state.units.find(unit => unit.team === target.team && unit.id !== target.id && unit.hp > 0
        && !hasEffectId(content, unit, 7707) && unit.flags.disableMagicReflection !== 1
        && activeEffectRows(content, unit, 148).some(effect => {
          const required = optionalNumber(effect.raw, 'param2', 0);
          return (!required || required === damageType) && chance(state, optionalNumber(effect.raw, 'param3', 100));
        }));
      if (reflector && source.hp > 0) damage(content, state, reflector, source, dealt, true, 'hero-reflection', skillId, damageType);
    }
    if (message !== 'turn-reflection' && source.hp > 0) {
      const reflector = state.units.find(unit => unit.team === target.team && unit.id !== target.id && unit.hp > 0
        && !hasEffectId(content, unit, 7707) && unit.flags.disableMagicReflection !== 1
        && activeEffectRows(content, unit, 149).length > 0 && activePlayer(state).team === target.team);
      if (reflector) damage(content, state, reflector, source, dealt, true, 'turn-reflection', skillId, damageType);
    }
  }
  if (hpBefore > 0 && target.hp <= 0 && source) handleKillEffects(content, state, source, target);
  return dealt;
}

function resolveDeathEffects(content: RecoveredContent, state: MutableState, unit: BattleUnit): void {
  const owner = player(state, unit.playerId);
  const killer = unitBySequence(state, unit.flags.lastDamagerSequence ?? 0);
  for (const effect of activeEffectRows(content, unit)) {
    const p1 = optionalNumber(effect.raw, 'param1', 0);
    const p2 = optionalNumber(effect.raw, 'param2', 0);
    const p3 = optionalNumber(effect.raw, 'param3', 0);
    const p4 = optionalNumber(effect.raw, 'param4', 0);
    switch (effect.type) {
      case 105:
        if (killer?.hp && chance(state, p3 || 100)) damage(content, state, unit, killer, Math.abs(p1), false, 'vengeance', undefined, p2);
        emitEffect(state, unit, effect, 'vengeance', killer, p1);
        break;
      case 123: {
        const eligible = owner.graveyard.filter(cardId => !p2 || cardKind(content, cardId) === p2);
        let moved = 0;
        while (eligible.length && moved < Math.max(1, p1)) {
          const cardId = eligible.shift()!;
          owner.graveyard.splice(owner.graveyard.indexOf(cardId), 1);
          owner.drawPile.push(cardId);
          moved += 1;
        }
        if (p3) shuffle(state, owner.drawPile);
        emitEffect(state, unit, effect, 'death-recycle', unit, moved);
        break;
      }
      case 124: {
        const hero = heroFor(state, owner.id);
        if (hero) heal(state, unit, hero, Math.abs(p1));
        emitEffect(state, unit, effect, 'death-heal', hero, p1);
        break;
      }
      case 135: {
        const enemyHero = chooseTarget(content, state, unit, state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero === 1 && candidate.hp > 0));
        if (enemyHero) heal(state, unit, enemyHero, Math.abs(p1));
        emitEffect(state, unit, effect, 'wanted-death', enemyHero, p1);
        break;
      }
      case 171: {
        const healing = p2 < 0;
        const targets = state.units.filter(candidate => candidate.id !== unit.id && candidate.hp > 0
          && (healing ? candidate.team === unit.team : candidate.team !== unit.team));
        for (const target of targets) healing ? heal(state, unit, target, Math.abs(p1)) : damage(content, state, unit, target, Math.abs(p1), false, 'death-wave', undefined, p2);
        emitEffect(state, unit, effect, healing ? 'death-wave-heal' : 'death-wave-damage', unit, targets.length);
        break;
      }
      case 175:
        if (chance(state, p1 || 100)) draw(content, state, owner, Math.max(1, p3));
        emitEffect(state, unit, effect, 'death-draw', unit, p3 || 1);
        break;
      case 194: {
        const candidates = state.players.filter(candidate => candidate.team === (p2 ? (unit.team === 0 ? 1 : 0) : unit.team) && candidate.hand.length);
        const targetOwner = randomItem(state, candidates);
        if (targetOwner && chance(state, optionalNumber(effect.raw, 'param6', 100))) {
          const amount = Math.abs(optionalNumber(effect.raw, 'param5', 0)) * (p2 ? 1 : -1);
          const onlyHighest = optionalNumber(effect.raw, 'param8', 0) === 1;
          const cards = onlyHighest ? [...targetOwner.hand].sort((a, b) => b.wait - a.wait)[0] ? [[...targetOwner.hand].sort((a, b) => b.wait - a.wait)[0]!] : [] : targetOwner.hand;
          for (const card of cards) card.wait = Math.max(0, card.wait + amount);
          emitEffect(state, unit, effect, 'death-countdown', heroFor(state, targetOwner.id), amount);
        }
        break;
      }
      case 203:
        if (killer?.hp && p1 > 0 && chance(state, p3 || 100)) applyStatusForTurns(content, state, unit, killer, p1, Math.max(1, p2 - 1));
        emitEffect(state, unit, effect, 'death-status', killer, p1);
        break;
      case 243:
        if (killer?.hp) damage(content, state, unit, killer, Math.max(1, Math.floor(unit.attack * (p1 || 100) / 100)), true, 'death-hammer', undefined, p2);
        emitEffect(state, unit, effect, 'death-hammer', killer, p1);
        break;
    }
  }

  for (const watcher of state.units.filter(candidate => candidate.id !== unit.id && candidate.hp > 0)) {
    for (const effect of activeEffectRows(content, watcher, 252)) {
      const maximum = Math.max(1, optionalNumber(effect.raw, 'param1', 1));
      watcher.flags.souls = Math.min(maximum, (watcher.flags.souls ?? 0) + Math.max(1, optionalNumber(effect.raw, 'param2', 1)));
      emitEffect(state, watcher, effect, 'soul-gain', unit, watcher.flags.souls);
    }
  }
}

function removeDead(content: RecoveredContent, state: MutableState): void {
  let pass = 0;
  while (pass++ < 32) {
    const dead = state.units.filter(unit => unit.hp <= 0);
    if (!dead.length) break;
    let processed = false;
    for (const unit of dead) {
      if (unit.flags.deathProcessed === 1) continue;
      processed = true;
      unit.flags.deathProcessed = 1;
      const resurrectionBlocked = unit.flags.erased === 1 || unit.flags.mutualOblivion === 1;
      if (!resurrectionBlocked && unit.flags.guardianAngel === 1) {
        unit.flags.guardianAngel = 0;
        unit.flags.deathProcessed = 0;
        unit.hp = unit.maxHp;
        emit(state, { type: 'status', actor: unit.id, target: unit.id, message: 'guardian-angel' });
        continue;
      }
      if (!resurrectionBlocked && (unit.flags.resurrectChance ?? 0) > 0 && unit.flags.resurrected !== 1 && chance(state, unit.flags.resurrectChance!)) {
        unit.flags.resurrected = 1;
        unit.flags.deathProcessed = 0;
        unit.hp = Math.max(1, unit.maxHp);
        emit(state, { type: 'status', actor: unit.id, target: unit.id, message: 'resurrect' });
        continue;
      }
      emit(state, { type: 'death', actor: unit.id, row: unit.row, col: unit.col, cardId: unit.cardId });
      resolveDeathEffects(content, state, unit);
      const deathSkillId = unit.flags.deathSkill ?? ((() => {
        const skillId = unit.flags.normalSkillId ?? 0;
        const raw = content.data.skills[String(skillId)]?.raw;
        return raw && numeric(raw, 'ServerClassID', 0) === 1 ? skillId : 0;
      })());
      if (deathSkillId > 0 && chance(state, unit.flags.deathSkillChance ?? 100)) {
        const raw = content.data.skills[String(deathSkillId)]?.raw;
        if (raw) {
          const victims = targetsInArea(content, state, unit, raw, player(state, unit.playerId)).filter(target => target.id !== unit.id);
          for (const victim of victims) damage(content, state, unit, victim, Math.max(1, numeric(raw, 'DamValue', unit.attack)), false, 'death-skill', deathSkillId, numeric(raw, 'DamType', 0));
        }
      }
      if (!resurrectionBlocked && (unit.flags.deathSummonMonster ?? 0) > 0) summonToken(content, state, player(state, unit.playerId), unit.flags.deathSummonMonster!, unit.row, unit.col);
      if (!resurrectionBlocked && (unit.flags.skeletonMonster ?? 0) > 0) summonToken(content, state, player(state, unit.playerId), unit.flags.skeletonMonster!, unit.row, unit.col);
      if (!resurrectionBlocked && unit.flags.incubate === 1) {
        const outcomes = [2154, 6094, 6028, 2010, 9007, 0];
        const monsterId = outcomes[Math.floor(nextRandom(state) * outcomes.length)]!;
        if (monsterId > 0) summonToken(content, state, player(state, unit.playerId), monsterId, unit.row, unit.col);
      }
      if (unit.flags.hero !== 1) {
        const owner = player(state, unit.playerId);
        const raw = cardRaw(content, unit.cardId);
        if (!resurrectionBlocked && unit.flags.noReturn !== 1 && raw && (unit.flags.returnHandChance ?? 0) > 0 && chance(state, unit.flags.returnHandChance!)) {
          owner.hand.push({ instanceId: `card:${state.nextId++}`, cardId: unit.cardId, wait: Math.max(0, numeric(raw, 'InitReady')) });
        } else if (raw && unit.flags.erased !== 1 && unit.flags.noGraveyard !== 1) owner.graveyard.push(unit.cardId);
      }
      if ((unit.flags.deathHeroDamage ?? 0) > 0) {
        for (const enemy of state.players.filter(candidate => candidate.team !== unit.team && !candidate.surrendered)) {
          const hero = heroFor(state, enemy.id);
          if (hero) damage(content, state, unit, hero, unit.flags.deathHeroDamage!, true, 'death-curse');
        }
      }
      for (const watcher of state.units.filter(candidate => candidate.hp > 0 && candidate.id !== unit.id)) {
        if (watcher.team !== unit.team && (watcher.flags.enemyDeathAttack ?? 0) > 0) watcher.attack += watcher.flags.enemyDeathAttack!;
        if ((watcher.flags.deathHp ?? 0) > 0) growHp(watcher, watcher.flags.deathHp!);
      }
    }
    if (!processed) break;
    state.units = state.units.filter(unit => unit.hp > 0);
    refreshAuras(content, state);
  }
}

function aliveTeams(state: BattleState): Team[] {
  return ([0, 1] as Team[]).filter(team => team === state.boardClearTeam
    ? state.units.some(unit => unit.team === team && unit.flags.hero !== 1 && unit.hp > 0)
    : state.players.some(candidate => candidate.team === team && !candidate.surrendered && candidate.hp > 0));
}

function settleIfNeeded(state: MutableState): void {
  if (state.status !== 'playing') return;
  const teams = aliveTeams(state);
  if (teams.length <= 1) {
    state.status = 'settled';
    state.winner = teams[0] ?? null;
    emit(state, { type: 'settled', amount: state.winner ?? -1 });
    return;
  }
  const limit = Math.max(1, ...state.units.filter(unit => unit.flags.hero === 1).map(unit => unit.flags.turnLimit ?? DEFAULT_TURN_LIMIT));
  if (state.turn > limit) {
    if (state.boardClearTeam !== undefined) {
      state.status = 'settled';
      state.winner = state.units.some(unit => unit.team === state.boardClearTeam && unit.flags.hero !== 1 && unit.hp > 0)
        ? state.boardClearTeam : (state.boardClearTeam === 0 ? 1 : 0);
      emit(state, { type: 'settled', amount: state.winner, message: 'turn-limit' });
      return;
    }
    const scores = ([0, 1] as Team[]).map(team => ({ team, hp: state.players.filter(p => p.team === team).reduce((sum, p) => sum + Math.max(0, p.hp), 0) }));
    state.status = 'settled';
    state.winner = scores[0]!.hp === scores[1]!.hp ? null : (scores[0]!.hp > scores[1]!.hp ? 0 : 1);
    emit(state, { type: 'settled', amount: state.winner ?? -1, message: 'turn-limit' });
  }
}

function beginTurn(content: RecoveredContent, state: MutableState, owner: BattlePlayer, opening = false): void {
  if (!opening && owner.team !== state.boardClearTeam) draw(content, state, owner, 1);
  for (const card of owner.hand) card.wait = Math.max(0, card.wait - 1);
  const speed = state.units.filter(unit => unit.playerId === owner.id && unit.hp > 0).reduce((sum, unit) => sum + (unit.flags.handSpeed ?? 0), 0);
  if (speed > 0 && owner.hand.length) {
    const highest = [...owner.hand].sort((a, b) => b.wait - a.wait || a.instanceId.localeCompare(b.instanceId))[0]!;
    highest.wait = Math.max(0, highest.wait - speed);
  }
  emit(state, { type: 'turn-start', actor: owner.id, amount: state.turn });
  removeDead(content, state);
  settleIfNeeded(state);
  if (state.status === 'playing' && (owner.surrendered || owner.hp <= 0)) {
    let next = state.activePlayer;
    do { next = (next + 1) % state.players.length; }
    while (state.players[next]!.surrendered || state.players[next]!.hp <= 0);
    state.activePlayer = next;
    state.turn += 1;
    beginTurn(content, state, activePlayer(state));
  }
}

function deploymentColumns(team: Team): number[] { return team === 0 ? [1, 2, 3] : [8, 9, 10]; }

function skillTargets(content: RecoveredContent, state: BattleState, owner: BattlePlayer, skill: RecoveredSkill): BattleUnit[] {
  const raw = skill.raw!;
  const targetType = numeric(raw, 'TargetType', 0);
  const statusId = numeric(raw, 'StatusID', 0);
  const status = statusId ? content.data.statuses[String(statusId)] : undefined;
  const friendly = numeric(raw, 'HaveCure', 0) > 0 || (!!status && numeric(status, 'Harm', 0) === 0 && numeric(raw, 'HaveDam', 0) === 0);
  return state.units.filter(unit => {
    if (unit.hp <= 0) return false;
    if (numeric(raw, 'SelectType', 0) === 2 && unit.flags.untargetable === 1) return false;
    if (targetType === 1) return unit.team !== owner.team && unit.flags.hero !== 1;
    if (targetType === 2) return unit.team !== owner.team && unit.flags.hero === 1;
    if (targetType === 3 || targetType === 15) return unit.team !== owner.team;
    if (targetType === 4) return unit.team === owner.team && unit.flags.hero !== 1;
    if (targetType === 5) return unit.flags.hero !== 1;
    if (targetType === 8) return unit.team === owner.team && unit.flags.hero === 1;
    if (targetType === 10) return unit.flags.hero === 1;
    return friendly ? unit.team === owner.team : unit.team !== owner.team;
  });
}

function isResolvableSkill(raw: RawRow): boolean {
  const serverClass = numeric(raw, 'ServerClassID', 0);
  return serverClass > 0
    || (numeric(raw, 'HaveDam', 0) > 0 && numeric(raw, 'DamValue', 0) > 0)
    || (numeric(raw, 'HaveCure', 0) > 0 && numeric(raw, 'CureValue', 0) > 0)
    || numeric(raw, 'StatusID', 0) > 0;
}

export function legalPlays(content: RecoveredContent, state: BattleState, actorId: string): LegalPlay[] {
  if (state.status !== 'playing') return [];
  const owner = player(state, actorId);
  if (owner.team === state.boardClearTeam) return [];
  if (activePlayer(state).id !== actorId || owner.surrendered || owner.hp <= 0) return [];
  const result: LegalPlay[] = [];
  for (const hand of owner.hand) {
    if (hand.wait > 0) continue;
    const card = content.card(hand.cardId);
    const type = numeric(card.raw, 'Type');
    if (type === 1) {
      const monsterId = numeric(card.raw, 'MonsterID', 0);
      if (monsterId <= 0 || !content.data.monsters[String(monsterId)]) continue;
      for (let row = 0; row < state.rows; row += 1) {
        for (const col of deploymentColumns(owner.team)) {
          if (!occupied(state, row, col)) result.push({ instanceId: hand.instanceId, row, col });
        }
      }
    } else if (type === 2) {
      const skillId = numeric(card.raw, 'SkillID', 0);
      if (skillId <= 0) continue;
      let skill: RecoveredSkill;
      try { skill = content.skill(skillId); } catch { continue; }
      if (!isResolvableSkill(skill.raw!)) continue;
      const selectType = numeric(skill.raw!, 'SelectType', 0);
      if (selectType === 0) {
        const anchor = heroFor(state, owner.id)!;
        result.push({ instanceId: hand.instanceId, row: anchor.row, col: anchor.col, targetId: anchor.id });
      } else if (selectType === 1) {
        for (let row = 0; row < state.rows; row += 1) for (let col = 0; col < state.columns; col += 1) {
          result.push({ instanceId: hand.instanceId, row, col });
        }
      } else {
        for (const target of skillTargets(content, state, owner, skill)) {
          result.push({ instanceId: hand.instanceId, row: target.row, col: target.col, targetId: target.id });
        }
      }
    }
  }
  return result;
}

function targetsInArea(content: RecoveredContent, state: BattleState, primary: BattleUnit, skill: RawRow, owner: BattlePlayer): BattleUnit[] {
  const areaId = numeric(skill, 'AreaID', 0);
  if (!areaId) return [primary];
  const area = content.data.areas[String(areaId)];
  if (!area) return [primary];
  const candidates = skillTargets(content, state, owner, { id: '', sourceId: '', raw: skill, visualModels: [], effects: [] });
  const areaType = optionalNumber(area, 'type', 0);
  const hit = candidates.filter(unit => {
    const dx = unit.col - primary.col;
    const dy = unit.row - primary.row;
    if (areaType === 1) {
      for (let index = 1; index <= 20; index += 2) {
        const x = optionalNumber(area, `参数${index}`, Number.NaN);
        const y = optionalNumber(area, `参数${index + 1}`, Number.NaN);
        if (Number.isFinite(x) && Number.isFinite(y) && dx === x && dy === y) return true;
      }
      return false;
    }
    for (let index = 1; index <= 20; index += 4) {
      const x1 = optionalNumber(area, `参数${index}`, Number.NaN);
      const x2 = optionalNumber(area, `参数${index + 1}`, Number.NaN);
      const y1 = optionalNumber(area, `参数${index + 2}`, Number.NaN);
      const y2 = optionalNumber(area, `参数${index + 3}`, Number.NaN);
      if (![x1, x2, y1, y2].every(Number.isFinite)) continue;
      if (dx >= Math.min(x1, x2) && dx <= Math.max(x1, x2) && dy >= Math.min(y1, y2) && dy <= Math.max(y1, y2)) return true;
    }
    return false;
  });
  if (hit.length) return hit;
  return primary.id.startsWith('cell:') ? [] : [primary];
}

function removeStatuses(content: RecoveredContent, unit: BattleUnit, harmful: boolean, all: boolean): number {
  const selected = unit.statuses.filter(status => numeric(content.data.statuses[String(status.id)] ?? {}, 'Harm', 0) === (harmful ? 1 : 0))
    .sort((a, b) => b.turns - a.turns || a.id - b.id);
  const removed = all ? selected : selected.slice(0, 1);
  for (const status of removed) applyStatusModifiers(content, unit, status.id, -1);
  const removedSet = new Set(removed);
  unit.statuses = unit.statuses.filter(status => !removedSet.has(status));
  return removed.length;
}

function addCardToHand(content: RecoveredContent, state: MutableState, owner: BattlePlayer, cardId: string, wait?: number): boolean {
  if (owner.hand.length >= MAX_HAND) return false;
  const raw = content.card(cardId).raw;
  owner.hand.push({ instanceId: `card:${state.nextId++}`, cardId, wait: wait ?? Math.max(0, numeric(raw, 'InitReady')) });
  return true;
}

function returnUnitToHand(content: RecoveredContent, state: MutableState, unit: BattleUnit): void {
  if (unit.flags.hero === 1 || unit.hp <= 0) return;
  if (unit.flags.noReturn === 1 || hasEffectType(content, unit, 160)) {
    emit(state, { type: 'effect', actor: unit.id, target: unit.id, message: 'return-blocked' });
    return;
  }
  const owner = player(state, unit.playerId);
  const raw = cardRaw(content, unit.cardId);
  const wait = Math.ceil(Math.max(0, raw ? numeric(raw, 'InitReady') : 0) / 2);
  if (raw && !addCardToHand(content, state, owner, unit.cardId, wait)) owner.graveyard.push(unit.cardId);
  state.units = state.units.filter(candidate => candidate.id !== unit.id);
  emit(state, { type: 'return-hand', actor: unit.id, target: owner.id, cardId: unit.cardId });
  for (const effect of activeEffectRows(content, unit, 135)) {
    const enemyHero = chooseTarget(content, state, unit, state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero === 1 && candidate.hp > 0));
    if (enemyHero) heal(state, unit, enemyHero, Math.abs(optionalNumber(effect.raw, 'param1', 0)));
    emitEffect(state, unit, effect, 'wanted-return', enemyHero, optionalNumber(effect.raw, 'param1', 0));
  }
}

function randomItem<T>(state: MutableState, values: readonly T[]): T | undefined {
  return values.length ? values[Math.floor(nextRandom(state) * values.length)] : undefined;
}

function summonCardAt(content: RecoveredContent, state: MutableState, owner: BattlePlayer, cardId: string, row: number, col: number): boolean {
  const card = content.card(cardId);
  const monsterId = numeric(card.raw, 'MonsterID', 0);
  if (numeric(card.raw, 'Type') !== 1 || monsterId <= 0 || occupied(state, row, col) || row < 0 || row >= state.rows || col <= 0 || col >= state.columns - 1) return false;
  const unit = makeUnit(content, state, owner, monsterId, cardId, row, col, false);
  state.units.push(unit);
  emit(state, { type: 'summon', actor: owner.id, target: unit.id, cardId, row, col, message: 'skill' });
  resolveSummonEffects(content, state, unit);
  return true;
}

function playSkill(content: RecoveredContent, state: MutableState, owner: BattlePlayer, raw: RawRow, primary: BattleUnit, skillId: number): void {
  const targets = targetsInArea(content, state, primary, raw, owner);
  const damageValue = Math.max(0, numeric(raw, 'DamValue', 0));
  const cureValue = numeric(raw, 'CureValue', 0);
  const statusId = numeric(raw, 'StatusID', 0);
  const statusChance = numeric(raw, 'StatueVeracity', statusId ? 100 : 0);
  const serverClass = numeric(raw, 'ServerClassID', 0);
  const ownHero = heroFor(state, owner.id);
  const description = asString(raw, 'Des');
  const skillName = asString(raw, 'SkillName');
  let handled = false;
  if (serverClass === 3) {
    for (const target of targets) {
      const removed = removeStatuses(content, target, target.team === owner.team, /all/i.test(description));
      if (target.team !== owner.team && damageValue > 0 && removed > 0) damage(content, state, undefined, target, damageValue * removed, false, undefined, skillId);
      if (target.team === owner.team && numeric(raw, 'DamValue', 0) > 0) heal(state, undefined, target, numeric(raw, 'DamValue'), skillId);
    }
    handled = true;
  } else if (serverClass === 1) {
    for (const target of targets) damage(content, state, undefined, target, Math.max(1, damageValue), false, 'death-skill', skillId, numeric(raw, 'DamType', 0));
    handled = true;
  } else if (serverClass === 4) {
    if (ownHero && damageValue > 0) damage(content, state, undefined, ownHero, damageValue, true, 'skill-cost', skillId);
    draw(content, state, owner, Math.max(1, cureValue));
    handled = true;
  } else if (serverClass === 5) {
    for (const target of [...targets]) if (target.flags.hero !== 1 && (target.attack <= Math.max(3, cureValue) || !/Attack is/i.test(description))) returnUnitToHand(content, state, target);
    handled = true;
  } else if (serverClass === 6) {
    const heroes = targets.filter(target => target.flags.hero === 1);
    for (const hero of heroes) {
      const targetOwner = player(state, hero.playerId);
      const amount = Math.abs(cureValue || 1);
      const count = Math.max(1, statusId || 1);
      const ordered = [...targetOwner.hand].sort((a, b) => b.wait - a.wait || a.instanceId.localeCompare(b.instanceId));
      const selected: HandCard[] = [];
      if (statusId > 0) {
        const pool = [...ordered];
        while (pool.length && selected.length < count) selected.push(pool.splice(Math.floor(nextRandom(state) * pool.length), 1)[0]!);
      } else selected.push(...ordered.slice(0, numeric(raw, 'HaveCure') === 1 ? ordered.length : 1));
      for (const card of selected) {
        card.wait = Math.max(0, card.wait + (cureValue < 0 ? -amount : amount));
      }
    }
    handled = true;
  } else if (serverClass === 7) {
    const wantSkill = numeric(raw, 'HaveCure', 0) > 0;
    const count = Math.max(1, cureValue);
    const eligible = owner.graveyard.filter(cardId => (numeric(content.card(cardId).raw, 'Type') === 2) === wantSkill && cardId !== String(skillId));
    for (let index = 0; index < count; index += 1) {
      const cardId = randomItem(state, eligible);
      if (!cardId || !addCardToHand(content, state, owner, cardId)) break;
      owner.graveyard.splice(owner.graveyard.indexOf(cardId), 1);
      eligible.splice(eligible.indexOf(cardId), 1);
    }
    handled = true;
  } else if (serverClass === 8 || serverClass === 15) {
    for (const target of targets.filter(candidate => candidate.flags.hero !== 1)) {
      const countdown = optionalNumber(cardRaw(content, target.cardId) ?? {}, 'InitReady', 0);
      if (serverClass === 15 || countdown <= Math.max(0, cureValue)) target.hp = 0;
    }
    if (serverClass === 8 && ownHero && damageValue > 0) damage(content, state, undefined, ownHero, damageValue, true, 'skill-cost', skillId);
    if (serverClass === 15 && ownHero) {
      const total = targets.reduce((sum, target) => sum + Math.max(0, target.maxHp), 0);
      heal(state, undefined, ownHero, total, skillId);
    }
    handled = true;
  } else if (serverClass === 9) {
    for (const target of targets) damage(content, state, undefined, target, 1 + Math.floor(nextRandom(state) * Math.max(1, damageValue)), false, undefined, skillId);
    handled = true;
  } else if (serverClass === 10) {
    const units = state.units.filter(unit => unit.flags.hero !== 1 && unit.hp > 0 && distance(unit, primary) <= 2).sort((a, b) => distance(a, primary) - distance(b, primary) || a.id.localeCompare(b.id)).slice(0, 2);
    if (units.length === 2) [units[0]!.row, units[0]!.col, units[1]!.row, units[1]!.col] = [units[1]!.row, units[1]!.col, units[0]!.row, units[0]!.col];
    handled = true;
  } else if (serverClass === 11) {
    for (const target of targets) {
      damage(content, state, undefined, target, damageValue, false, undefined, skillId);
      if (target.hp > 0) {
        knockback(state, target, 2);
        refreshAuras(content, state);
      }
    }
    handled = true;
  } else if (serverClass === 12) {
    const heroes = targets.filter(target => target.flags.hero === 1);
    for (const hero of heroes) {
      const victim = player(state, hero.playerId);
      const count = cureValue >= 99 ? victim.hand.length : 1;
      const selected = [...victim.hand].sort((a, b) => b.wait - a.wait || a.instanceId.localeCompare(b.instanceId)).slice(0, count);
      for (const card of selected) { victim.hand.splice(victim.hand.indexOf(card), 1); victim.graveyard.push(card.cardId); }
    }
    handled = true;
  } else if (serverClass === 13) {
    for (const target of targets) damage(content, state, undefined, target, Math.max(1, target.attack * Math.max(1, damageValue)), true, undefined, skillId);
    handled = true;
  } else if (serverClass === 14) {
    for (const target of targets) for (let hit = 0; hit < Math.max(1, cureValue); hit += 1) damage(content, state, undefined, target, Math.max(1, damageValue), false, undefined, skillId);
    handled = true;
  } else if (serverClass === 16) {
    let total = 0;
    for (const target of targets) total += damage(content, state, undefined, target, damageValue, false, undefined, skillId);
    if (ownHero) heal(state, undefined, ownHero, total, skillId);
    handled = true;
  } else if (serverClass === 18) {
    const terrainTargets = state.units.filter(unit => unit.hp > 0 && distance(unit, primary) <= 3);
    const attackMatch = description.match(/\+(\d+) Attack/i);
    const rangeMatch = description.match(/\+(\d+) Range/i);
    for (const target of terrainTargets) {
      if (attackMatch) target.attack += Number(attackMatch[1]);
      if (rangeMatch) target.range += Number(rangeMatch[1]);
      target.flags[`terrainSkill:${skillId}`] = Math.max(1, Number(description.match(/(\d+) turns?/i)?.[1] ?? 1));
      if (statusId > 0) applyStatus(content, state, undefined, target, statusId);
    }
    emit(state, { type: 'terrain', actor: owner.id, skillId, row: primary.row, col: primary.col, amount: numeric(raw, 'DamValue', 0) });
    handled = true;
  } else if (serverClass === 19) {
    const cardId = String(damageValue);
    let summoned = 0;
    for (let row = 0; row < state.rows && summoned < Math.max(1, cureValue); row += 1) for (let col = 1; col < state.columns - 1 && summoned < Math.max(1, cureValue); col += 1) {
      if (Math.abs(row - primary.row) + Math.abs(col - primary.col) <= 2 && summonCardAt(content, state, owner, cardId, row, col)) summoned += 1;
    }
    handled = true;
  } else if (serverClass === 20 || serverClass === 34 || serverClass === 43) {
    for (const target of targets) damage(content, state, undefined, target, Math.max(1, damageValue || owner.attack || 1), false, undefined, skillId, numeric(raw, 'DamType', 0));
    handled = true;
  } else if (serverClass === 21) {
    const destroyed = owner.drawPile.shift();
    let bonus = 0;
    if (destroyed) { owner.graveyard.push(destroyed); bonus = numeric(content.card(destroyed).raw, 'InitReady', 0) + numeric(content.card(destroyed).raw, 'Quality', 0); }
    for (const target of targets) damage(content, state, undefined, target, Math.max(1, owner.attack ?? 1) + bonus, false, undefined, skillId, numeric(raw, 'DamType', 0));
    handled = true;
  } else if (serverClass === 22) {
    const count = Math.max(1, damageValue);
    let found = 0;
    while (owner.drawPile.length && found < count && owner.hand.length < MAX_HAND) {
      const cardId = owner.drawPile.shift()!;
      if (numeric(content.card(cardId).raw, 'Type') === 1) { addCardToHand(content, state, owner, cardId); found += 1; }
      else owner.graveyard.push(cardId);
    }
    handled = true;
  } else if (serverClass === 23 || serverClass === 31) {
    const targetOwner = serverClass === 31 && targets[0]?.flags.hero === 1 ? player(state, targets[0].playerId) : owner;
    const count = targetOwner.hand.length;
    targetOwner.drawPile.push(...targetOwner.hand.map(card => card.cardId)); targetOwner.hand = []; shuffle(state, targetOwner.drawPile);
    draw(content, state, targetOwner, count + (serverClass === 23 ? damageValue : 0));
    if (serverClass === 31) for (const card of targetOwner.hand) card.wait = Math.max(0, card.wait - 1);
    handled = true;
  } else if (serverClass === 24) {
    draw(content, state, owner, Math.max(0, MAX_HAND - owner.hand.length)); handled = true;
  } else if (serverClass === 25) {
    const candidates = owner.drawPile.filter(cardId => numeric(content.card(cardId).raw, 'Type') === 1).sort((a, b) => numeric(content.card(b).raw, 'InitReady') - numeric(content.card(a).raw, 'InitReady') || a.localeCompare(b));
    const cardId = candidates[0];
    if (cardId && addCardToHand(content, state, owner, cardId)) owner.drawPile.splice(owner.drawPile.indexOf(cardId), 1);
    handled = true;
  } else if (serverClass === 26) {
    const enemies = targets.filter(target => target.flags.hero === 1);
    for (const hero of enemies) {
      const victim = player(state, hero.playerId);
      const cards = victim.hand.filter(card => numeric(content.card(card.cardId).raw, 'Type') === 1);
      const selected = randomItem(state, cards);
      if (selected) addCardToHand(content, state, owner, selected.cardId);
    }
    handled = true;
  } else if (serverClass === 27) {
    for (const target of targets) {
      if (statusId > 0) applyStatus(content, state, undefined, target, statusId);
      else damage(content, state, undefined, target, Math.max(6, cureValue), true, 'rank-floor', skillId);
    }
    handled = true;
  } else if (serverClass === 28) {
    const maximum = Math.max(0, ...state.units.filter(unit => unit.team === owner.team && unit.flags.hero !== 1 && unit.hp > 0).map(unit => unit.attack));
    for (const target of targets) damage(content, state, undefined, target, maximum, false, undefined, skillId);
    handled = true;
  } else if (serverClass === 30) {
    for (const target of targets) if (target.flags.hero !== 1 && target.attack <= 2) target.hp = 0;
    const slowed = randomItem(state, owner.hand); if (slowed) slowed.wait += 1;
    handled = true;
  } else if (serverClass === 32) {
    for (const target of targets.filter(candidate => candidate.flags.hero !== 1)) target.hp = 0;
    const sacrifice = randomItem(state, state.units.filter(unit => unit.team === owner.team && unit.flags.hero !== 1 && unit.hp > 0)); if (sacrifice) sacrifice.hp = 0;
    handled = true;
  } else if (serverClass === 33) {
    const source = targets.find(target => target.flags.hero !== 1);
    if (source) summonToken(content, state, owner, source.monsterId, primary.row, primary.col);
    handled = true;
  } else if (serverClass === 35) {
    for (const unit of state.units.filter(unit => unit.hp > 0)) {
      if (unit.flags.hero === 1) unit.team === owner.team ? heal(state, undefined, unit, cureValue, skillId) : damage(content, state, undefined, unit, damageValue, false, undefined, skillId);
      else if (unit.team === owner.team && statusId > 0) applyStatus(content, state, undefined, unit, statusId);
    }
    handled = true;
  } else if (serverClass === 36) {
    if (/Mind Control/i.test(skillName)) {
      const target = targets.find(unit => unit.flags.hero !== 1); if (target) { target.team = owner.team; target.playerId = owner.id; target.flags.controlImmuneTurns = 3; }
    } else if (/Armor/i.test(skillName)) {
      for (const target of targets) { target.flags.armor = Math.max(target.flags.armor ?? 0, Math.max(0, target.hp - 3)); target.flags.armorBreakImmune = 10; }
    } else if (/Protection/i.test(skillName)) {
      for (const target of targets) target.flags.damageImmuneTurns = 2;
    } else if (/Suppression/i.test(skillName)) {
      for (const target of targets) { target.attack = target.flags.baseAttack ?? target.attack; target.movement = target.flags.baseMovement ?? target.movement; target.range = target.flags.baseRange ?? target.range; target.flags.noGrowthTurns = 5; }
    } else {
      let removed = 0;
      for (const unit of state.units.filter(unit => unit.hp > 0)) removed += removeStatuses(content, unit, unit.team === owner.team, /all|Purification/i.test(description));
      if (removed > 0 && chance(state, statusChance)) draw(content, state, owner, 1);
    }
    handled = true;
  } else if ([37, 38, 39].includes(serverClass)) {
    if (serverClass === 37 && ownHero) damage(content, state, undefined, ownHero, 10, true, 'crazy-bomb', skillId);
    if (serverClass === 38) for (const unit of state.units.filter(unit => unit.team === owner.team && unit.flags.hero !== 1)) damage(content, state, undefined, unit, 8, true, 'crazy-bomb', skillId);
    if (serverClass === 39 && owner.drawPile.length) owner.graveyard.push(owner.drawPile.splice(Math.floor(nextRandom(state) * owner.drawPile.length), 1)[0]!);
    handled = true;
  } else if (serverClass === 41) {
    for (const target of targets) { removeStatuses(content, target, false, true); damage(content, state, undefined, target, Math.max(1, damageValue), false, undefined, skillId); }
    handled = true;
  } else if (serverClass === 42) {
    const splash = state.units.filter(unit => unit.team !== owner.team && unit.hp > 0 && distance(unit, primary) <= 1);
    for (const target of splash) damage(content, state, undefined, target, Math.max(5, damageValue), false, undefined, skillId);
    handled = true;
  } else if (serverClass === 46) {
    targets.forEach((target, index) => damage(content, state, undefined, target, Math.max(1, damageValue || owner.attack || 1) * (index === 0 ? 1 : 2), false, undefined, skillId, numeric(raw, 'DamType', 0)));
    handled = true;
  } else if (serverClass === 47) {
    for (const target of targets) for (let hit = 0; hit < 2; hit += 1) damage(content, state, undefined, target, Math.max(1, (owner.attack ?? 1) + damageValue), false, undefined, skillId, numeric(raw, 'DamType', 0));
    handled = true;
  } else if (serverClass === 44) {
    let killed = false;
    for (const target of targets) {
      const amount = Math.max(1, Math.floor(target.maxHp * damageValue / 100));
      damage(content, state, undefined, target, amount, true, undefined, skillId);
      if (target.hp > 0 && target.hp * 100 <= target.maxHp * cureValue) target.hp = 0;
      if (target.hp <= 0) killed = true;
    }
    if (killed) { const card = randomItem(state, owner.hand); if (card) card.wait = 0; }
    handled = true;
  }
  if (!handled) {
    for (const target of targets) {
      let value = damageValue || ([2, 17].includes(serverClass) ? (owner.attack ?? 1) : 0);
      if (serverClass === 2 && value > 0) value = Math.floor(value * nextRandom(state) * 2);
      if (serverClass === 17 && value > 0) value = Math.max(1, Math.floor(value / Math.max(1, targets.length)));
      if (numeric(raw, 'HaveDam', 0) > 0 && value > 0) damage(content, state, undefined, target, value, false, undefined, skillId, numeric(raw, 'DamType', 0));
      if (numeric(raw, 'HaveCure', 0) > 0 && cureValue > 0) heal(state, undefined, target, cureValue, skillId);
      if (statusId > 0 && chance(state, statusChance)) applyStatus(content, state, undefined, target, statusId);
    }
  }
  removeDead(content, state);
}

function resolveSummonEffects(content: RecoveredContent, state: MutableState, summoned: BattleUnit): void {
  const owner = player(state, summoned.playerId);
  const rows = [...activeEffectRows(content, summoned)];
  for (const effect of rows) {
    const raw = effect.raw;
    const p1 = optionalNumber(raw, 'param1', 0);
    const p2 = optionalNumber(raw, 'param2', 0);
    const p3 = optionalNumber(raw, 'param3', 0);
    const p4 = optionalNumber(raw, 'param4', 0);
    const p5 = optionalNumber(raw, 'param5', 0);
    switch (effect.type) {
      case 1: {
        if (summoned.flags.heroHpAuraApplied === 1 || p1 === 0) break;
        const hero = heroFor(state, owner.id);
        if (hero) { growHp(hero, p1); syncHero(state, hero); summoned.flags.heroHpAuraApplied = 1; emitEffect(state, summoned, effect, 'hero-hp', hero, p1); }
        break;
      }
      case 102: {
        const phyle = p5;
        const allies = state.units.filter(unit => unit.id !== summoned.id && unit.team === summoned.team && unit.flags.hero !== 1 && unit.hp > 0
          && (!phyle || monsterValue(content, unit, 'Phyle') === phyle));
        const count = allies.length;
        if (count) {
          summoned.attack += p1 * count;
          growHp(summoned, p2 * count);
          emitEffect(state, summoned, effect, 'tribal-leader', summoned, count);
        }
        break;
      }
      case 109:
      case 119: {
        const count = owner.hand.length;
        owner.drawPile.push(...owner.hand.map(card => card.cardId));
        owner.hand = [];
        shuffle(state, owner.drawPile);
        draw(content, state, owner, count);
        emitEffect(state, summoned, effect, 'summon-shuffle', summoned, count);
        break;
      }
      case 114: {
        const partnerMonster = p3;
        const child = p4;
        const matches = state.units.filter(unit => unit.id !== summoned.id && unit.team === summoned.team && unit.hp > 0
          && (!partnerMonster || unit.monsterId === partnerMonster));
        if (matches.length && child > 0 && content.data.effects[String(child)]) {
          applyStaticEffects(content, state, summoned, [child]);
          emitEffect(state, summoned, effect, 'leader-link', matches[0]);
        }
        break;
      }
      case 122:
        for (const ally of state.units.filter(unit => unit.team === summoned.team && unit.hp > 0)) heal(state, summoned, ally, Math.abs(p1));
        emitEffect(state, summoned, effect, 'healing-prayer', summoned, p1);
        break;
      case 136: {
        const targets = state.units.filter(unit => unit.flags.hero !== 1 && unit.hp > 0 && (p1 < 0 ? unit.team !== summoned.team : unit.team === summoned.team));
        for (const target of targets) {
          target.flags.rankShift = (target.flags.rankShift ?? 0) + p1;
          if (p1 > 0 && p2 > 0) growHp(target, p2);
          if (p1 > 0 && p3 > 0) target.attack += p3;
        }
        emitEffect(state, summoned, effect, 'rank-change', summoned, targets.length);
        break;
      }
      case 158: {
        const candidates = [p2, p3, p4, p5, optionalNumber(raw, 'param6', 0), optionalNumber(raw, 'param7', 0)].map(String);
        const cardId = candidates.find(id => owner.drawPile.includes(id));
        if (cardId && addCardToHand(content, state, owner, cardId)) owner.drawPile.splice(owner.drawPile.indexOf(cardId), 1);
        emitEffect(state, summoned, effect, 'tutor', summoned, cardId ? 1 : 0);
        break;
      }
      case 172: {
        const statusId = p1;
        const scope = p4 || 1;
        const chancePercent = p3 || 100;
        const targets = scope === 1 ? [summoned] : state.units.filter(unit => unit.hp > 0 && unit.flags.hero !== 1
          && (scope === 4 ? unit.team !== summoned.team : unit.team === summoned.team));
        let applied = 0;
        for (const target of targets) if (statusId > 0 && chance(state, chancePercent)) {
          applyStatusForTurns(content, state, summoned, target, statusId, p2);
          applied += 1;
        }
        emitEffect(state, summoned, effect, 'summon-status', summoned, applied);
        break;
      }
      case 185: {
        const candidates = state.units.filter(unit => unit.id !== summoned.id && unit.team === summoned.team && unit.flags.hero !== 1 && unit.hp > 0);
        const selected = [...candidates].sort((a, b) => a.id.localeCompare(b.id)).slice(0, Math.max(1, p3));
        selected.forEach((target, index) => { summoned.flags[`soulBond:${index}`] = unitSequence(target); });
        emitEffect(state, summoned, effect, 'soul-bond', selected[0], selected.length);
        break;
      }
      case 173: {
        const phyle = p2;
        const targets = state.units.filter(unit => unit.team !== summoned.team && unit.flags.hero !== 1 && unit.hp > 0
          && (!phyle || monsterValue(content, unit, 'Phyle') === phyle));
        for (const target of targets) damage(content, state, summoned, target, Math.max(0, p4), false, 'summon-area', undefined, p3);
        emitEffect(state, summoned, effect, 'summon-area', summoned, targets.length);
        break;
      }
      case 186: {
        const pool = state.units.filter(unit => unit.team !== summoned.team && unit.flags.hero !== 1 && unit.hp > 0);
        let killed = 0;
        while (pool.length && killed < Math.max(1, p3) && chance(state, p1 || 100)) {
          const target = pool.splice(Math.floor(nextRandom(state) * pool.length), 1)[0]!;
          target.hp = 0;
          killed += 1;
        }
        emitEffect(state, summoned, effect, 'summon-execute', summoned, killed);
        break;
      }
      case 211: {
        const count = state.units.filter(unit => unit.id !== summoned.id && unit.flags.hero !== 1 && unit.hp > 0)
          .reduce((sum, unit) => sum + unit.statuses.filter(status => optionalNumber(content.data.statuses[String(status.id)] ?? {}, 'Harm', 0) === 0).length, 0);
        summoned.attack += p4 * count;
        growHp(summoned, p5 * count);
        emitEffect(state, summoned, effect, 'buff-count', summoned, count);
        break;
      }
      case 225: {
        const target = randomItem(state, state.units.filter(unit => unit.team !== summoned.team && unit.flags.hero !== 1 && unit.hp > 0 && monsterValue(content, unit, 'Type', 1) !== 2));
        if (target) {
          summoned.flags.enemyBondSequence = unitSequence(target);
          growHp(summoned, target.hp);
        }
        emitEffect(state, summoned, effect, 'enemy-bond', target, target?.hp ?? 0);
        break;
      }
      case 229: {
        const enemy = randomItem(state, state.players.filter(candidate => candidate.team !== summoned.team && candidate.graveyard.some(cardId => cardKind(content, cardId) === 1)));
        const eligible = enemy?.graveyard.filter(cardId => cardKind(content, cardId) === 1) ?? [];
        const cardId = randomItem(state, eligible);
        let amount = 0;
        if (enemy && cardId) {
          enemy.graveyard.splice(enemy.graveyard.indexOf(cardId), 1);
          const monsterId = optionalNumber(cardRaw(content, cardId) ?? {}, 'MonsterID', 0);
          amount = optionalNumber(content.data.monsters[String(monsterId)] ?? {}, 'HP', 1);
          for (const target of state.units.filter(unit => unit.team !== summoned.team && unit.flags.hero !== 1 && unit.hp > 0)) damage(content, state, summoned, target, amount, false, 'grave-detonate', undefined, p1);
        }
        emitEffect(state, summoned, effect, 'grave-detonate', summoned, amount);
        break;
      }
      case 239: {
        let removed = 0;
        for (const ally of state.units.filter(unit => unit.team === summoned.team && unit.hp > 0)) removed += removeStatuses(content, ally, true, true);
        summoned.attack += Math.max(0, p1) * removed;
        growHp(summoned, Math.max(0, p2) * removed);
        emitEffect(state, summoned, effect, 'mass-cleanse', summoned, removed);
        break;
      }
      case 238: {
        const partner = state.units.find(unit => unit.id !== summoned.id && unit.team === summoned.team && unit.flags.hero !== 1 && unit.hp > 0 && unit.monsterId === p1);
        if (partner) {
          partner.flags.erased = 1;
          partner.hp = 0;
          if (p2 > 0 && content.data.effects[String(p2)]) applyStaticEffects(content, state, summoned, [p2]);
        }
        emitEffect(state, summoned, effect, 'merge', partner, p2);
        break;
      }
      case 247: {
        const enemy = randomItem(state, state.players.filter(candidate => candidate.team !== summoned.team && candidate.drawPile.some(cardId => cardKind(content, cardId) === 1)));
        const eligible = enemy?.drawPile.filter(cardId => cardKind(content, cardId) === 1) ?? [];
        const cardId = randomItem(state, eligible);
        if (enemy && cardId && chance(state, p3 || 100) && addCardToHand(content, state, owner, cardId)) enemy.drawPile.splice(enemy.drawPile.indexOf(cardId), 1);
        emitEffect(state, summoned, effect, 'deck-steal', summoned, cardId ? 1 : 0);
        break;
      }
      case 255: {
        const friendly = state.units.filter(unit => unit.team === summoned.team && unit.flags.hero !== 1 && unit.id !== summoned.id && unit.hp > 0);
        const enemies = state.units.filter(unit => unit.team !== summoned.team && unit.flags.hero !== 1 && unit.hp > 0);
        const statusId = enemies.length >= friendly.length ? p1 : p3;
        for (const target of friendly) if (statusId > 0) applyStatusForTurns(content, state, summoned, target, statusId, p4);
        emitEffect(state, summoned, effect, 'battle-command', summoned, friendly.length);
        break;
      }
      case 501: {
        let applied = 0;
        for (const pet of state.units.filter(unit => unit.team === summoned.team && unit.flags.hero !== 1 && unit.hp > 0)) if (p1 > 0 && chance(state, p3 || 100)) {
          applyStatusForTurns(content, state, summoned, pet, p1, p2);
          applied += 1;
        }
        emitEffect(state, summoned, effect, 'pet-status', summoned, applied);
        break;
      }
      case 600: {
        let applied = 0;
        for (const target of state.units.filter(unit => unit.team !== summoned.team && unit.flags.hero !== 1 && unit.hp > 0)) if (p2 > 0 && chance(state, p4 || 100)) {
          applyStatusForTurns(content, state, summoned, target, p2, p3);
          applied += 1;
        }
        emitEffect(state, summoned, effect, 'summon-trap-status', summoned, applied);
        break;
      }
    }
  }

  // Existing battlefield auras and traps react to this summon.
  for (const watcher of [...state.units].filter(unit => unit.id !== summoned.id && unit.hp > 0)) {
    for (const effect of activeEffectRows(content, watcher)) {
      const raw = effect.raw;
      const p1 = optionalNumber(raw, 'param1', 0);
      const p2 = optionalNumber(raw, 'param2', 0);
      const p3 = optionalNumber(raw, 'param3', 0);
      const p4 = optionalNumber(raw, 'param4', 0);
      if (effect.type === 101 && watcher.team === summoned.team) {
        const race = p3;
        if ((!race || monsterValue(content, summoned, 'Phyle') === race) && chance(state, p4 || 100)) {
          draw(content, state, player(state, watcher.playerId), Math.max(1, p1));
          emitEffect(state, watcher, effect, 'tribal-draw', summoned, p1);
        }
      } else if (effect.type === 141) {
        const affectsEnemy = p1 === 1;
        if ((affectsEnemy ? watcher.team !== summoned.team : watcher.team === summoned.team) && p2 > 0 && chance(state, p4 || 100)) {
          applyStatusForTurns(content, state, watcher, summoned, p2, p3);
          emitEffect(state, watcher, effect, 'admission-status', summoned, p2);
        }
      } else if (effect.type === 600 && watcher.team !== summoned.team && p2 > 0 && chance(state, p4 || 100)) {
        applyStatusForTurns(content, state, watcher, summoned, p2, p3);
        emitEffect(state, watcher, effect, 'trap-admission-status', summoned, p2);
      }
    }
  }
  removeDead(content, state);
}

function summon(content: RecoveredContent, state: MutableState, owner: BattlePlayer, hand: HandCard, row: number, col: number): void {
  const card = content.card(hand.cardId);
  const monsterId = numeric(card.raw, 'MonsterID');
  const unit = makeUnit(content, state, owner, monsterId, hand.cardId, row, col, false);
  const cardEffects = effectIds(card.raw);
  const addedEffects = cardEffects.filter(effectId => !unit.effects.includes(effectId));
  unit.effects.push(...addedEffects);
  applyStaticEffects(content, state, unit, addedEffects);
  state.units.push(unit);
  emit(state, { type: 'play', actor: owner.id, target: unit.id, cardId: hand.cardId, row, col });
  emit(state, { type: 'summon', actor: owner.id, target: unit.id, cardId: hand.cardId, row, col });
  resolveSummonEffects(content, state, unit);
  if ((unit.flags.summonHeroDamage ?? 0) > 0) {
    const hero = heroFor(state, owner.id);
    if (hero) damage(content, state, unit, hero, unit.flags.summonHeroDamage!, true, 'summon-cost');
  }
  if ((unit.flags.summonDrawCount ?? 0) > 0 && chance(state, unit.flags.summonDrawChance ?? 100)) draw(content, state, owner, unit.flags.summonDrawCount!);
  if ((unit.flags.summonHandSpeed ?? 0) > 0) for (const cardInHand of owner.hand) cardInHand.wait = Math.max(0, cardInHand.wait - unit.flags.summonHandSpeed!);
  for (const watcher of state.units.filter(candidate => candidate.id !== unit.id && candidate.team !== unit.team && candidate.hp > 0)) {
    if (watcher.flags.predator === 1) unit.hp = 0;
    if ((watcher.flags.summonTrapDamage ?? 0) > 0) damage(content, state, watcher, unit, watcher.flags.summonTrapDamage!, false, 'summon-trap');
  }
  removeDead(content, state);
}

function distance(a: BattleUnit, b: BattleUnit): number { return Math.abs(a.col - b.col) + Math.abs(a.row - b.row); }

function chooseTarget(content: RecoveredContent, state: BattleState, unit: BattleUnit, candidates: BattleUnit[]): BattleUnit | undefined {
  if (!candidates.length) return undefined;
  const aiType = unit.flags.aiType ?? 0;
  const sniperMode = optionalNumber(activeEffectRows(content, unit, 23)[0]?.raw ?? {}, 'param1', 0);
  return [...candidates].sort((a, b) => {
    if (unit.flags.vigilance === 1) {
      const aBehind = unit.team === 0 ? a.col < unit.col : a.col > unit.col;
      const bBehind = unit.team === 0 ? b.col < unit.col : b.col > unit.col;
      if (aBehind !== bBehind) return aBehind ? -1 : 1;
    }
    if (aiType === 2) return a.hp - b.hp || distance(unit, a) - distance(unit, b) || a.id.localeCompare(b.id);
    if (aiType === 3) return b.attack - a.attack || distance(unit, a) - distance(unit, b) || a.id.localeCompare(b.id);
    if (aiType === 4) return (b.flags.hero ?? 0) - (a.flags.hero ?? 0) || distance(unit, a) - distance(unit, b) || a.id.localeCompare(b.id);
    if (sniperMode === 3) return optionalNumber(cardRaw(content, b.cardId) ?? {}, 'InitReady', 0)
      - optionalNumber(cardRaw(content, a.cardId) ?? {}, 'InitReady', 0) || a.id.localeCompare(b.id);
    if (sniperMode === 4) return distance(unit, b) - distance(unit, a) || a.id.localeCompare(b.id);
    if (activeEffectRows(content, unit, 23).length) return a.hp - b.hp || a.id.localeCompare(b.id);
    return distance(unit, a) - distance(unit, b) || a.hp - b.hp || a.id.localeCompare(b.id);
  })[0];
}

function moveUnit(content: RecoveredContent, state: MutableState, unit: BattleUnit, target: BattleUnit): void {
  if (unit.movement <= 0 || unit.flags.noMove === 1 || (unit.flags.statusNoMove ?? 0) > 0 || unit.flags.hero === 1) return;
  if ((unit.flags.aiType ?? 0) === 1 && distance(unit, target) > effectiveRange(content, unit) + 1) return;
  let remaining = unit.movement;
  const fromRow = unit.row;
  const fromCol = unit.col;
  let probeRow = unit.row;
  let probeCol = unit.col;
  let landedRow = unit.row;
  let landedCol = unit.col;
  const crossed: BattleUnit[] = [];
  while (remaining-- > 0 && Math.abs(probeCol - target.col) + Math.abs(probeRow - target.row) > effectiveRange(content, unit)) {
    const direction = unit.team === 0 ? 1 : -1;
    const candidates: Array<[number, number]> = [];
    if (target.col !== probeCol) candidates.push([probeRow, probeCol + Math.sign(target.col - probeCol)]);
    if (target.row !== probeRow) candidates.push([probeRow + Math.sign(target.row - probeRow), probeCol]);
    candidates.push([probeRow, probeCol + direction]);
    const cell = candidates.find(([row, col]) => {
      if (row < 0 || row >= state.rows || col <= 0 || col >= COLUMNS - 1) return false;
      const blocker = state.units.find(candidate => candidate.id !== unit.id && candidate.hp > 0 && candidate.row === row && candidate.col === col);
      if (!blocker) return true;
      if (unit.flags.flying === 1 && blocker.team !== unit.team && blocker.flags.blocksFlight !== 1) return true;
      return (unit.flags.infiltrate ?? 0) > 0 && blocker.team !== unit.team && (unit.flags.infiltrate! > 1 || monsterValue(content, blocker, 'Type', 1) !== 2);
    });
    if (!cell) break;
    [probeRow, probeCol] = cell;
    const crossedUnit = state.units.find(candidate => candidate.id !== unit.id && candidate.hp > 0 && candidate.row === probeRow && candidate.col === probeCol);
    if (crossedUnit && crossedUnit.team !== unit.team && !crossed.includes(crossedUnit)) crossed.push(crossedUnit);
    if (!occupied(state, probeRow, probeCol, unit.id)) [landedRow, landedCol] = [probeRow, probeCol];
  }
  [unit.row, unit.col] = [landedRow, landedCol];
  unit.flags.movedThisTurn = Math.abs(fromRow - unit.row) + Math.abs(fromCol - unit.col);
  if (unit.row !== fromRow || unit.col !== fromCol) {
    emit(state, {
      type: 'move', actor: unit.id, row: unit.row, col: unit.col,
      moveFrom: { row: fromRow, col: fromCol }, moveTo: { row: unit.row, col: unit.col },
    });
    for (const effect of activeEffectRows(content, unit)) {
      if (effect.type === 230) {
        const statusId = optionalNumber(effect.raw, 'param1', 0);
        for (const victim of crossed) if (statusId > 0 && chance(state, optionalNumber(effect.raw, 'param4', 100))) {
          applyStatusForTurns(content, state, unit, victim, statusId, optionalNumber(effect.raw, 'param2', 1));
        }
        emitEffect(state, unit, effect, 'infiltrate-status', crossed[0], crossed.length);
      } else if (effect.type === 244) {
        const statusId = optionalNumber(effect.raw, 'param1', 0);
        if (statusId > 0 && chance(state, optionalNumber(effect.raw, 'param3', 100))) applyStatusForTurns(content, state, unit, unit, statusId, optionalNumber(effect.raw, 'param2', 1));
        emitEffect(state, unit, effect, 'move-status', unit, statusId);
      } else if (effect.type === 245) {
        unit.flags.moveCharged = 1;
        emitEffect(state, unit, effect, 'move-charge', unit, optionalNumber(effect.raw, 'param1', 200));
      } else if (effect.type === 253) {
        for (const victim of crossed) damage(content, state, unit, victim, unit.attack, false, 'shadow-assault', undefined, unit.flags.attackType ?? 0);
        emitEffect(state, unit, effect, 'path-damage', crossed[0], crossed.length);
      }
    }
    refreshAuras(content, state);
  }
}

function knockback(state: MutableState, target: BattleUnit, squares: number): void {
  const direction = target.team === 0 ? -1 : 1;
  for (let count = 0; count < squares; count += 1) {
    const col = target.col + direction;
    if (col <= 0 || col >= COLUMNS - 1 || occupied(state, target.row, col, target.id)) break;
    target.col = col;
  }
}

function onRequestedHalf(state: BattleState, unit: BattleUnit, mode: number): boolean {
  const ownHalf = unit.team === 0 ? unit.col < state.columns / 2 : unit.col >= state.columns / 2;
  return mode === 0 ? ownHalf : !ownHalf;
}

function attackAmount(
  content: RecoveredContent,
  state: MutableState,
  attacker: BattleUnit,
  target: BattleUnit,
  base: number,
  damageType: number,
): { amount: number; piercing: boolean } {
  let amount = base;
  let piercing = attacker.flags.piercing === 1;
  const ownHero = heroFor(state, attacker.playerId);
  const friendly = state.units.filter(unit => unit.team === attacker.team && unit.flags.hero !== 1 && unit.hp > 0);
  const enemy = state.units.filter(unit => unit.team !== attacker.team && unit.flags.hero !== 1 && unit.hp > 0);
  for (const effect of activeEffectRows(content, attacker)) {
    const p1 = optionalNumber(effect.raw, 'param1', 0);
    const p2 = optionalNumber(effect.raw, 'param2', 0);
    const p3 = optionalNumber(effect.raw, 'param3', 0);
    const p4 = optionalNumber(effect.raw, 'param4', 0);
    const p6 = optionalNumber(effect.raw, 'param6', 0);
    if (effect.type === 14 && activeEffectRows(content, target).some(row => row.id === p2)) amount *= Math.max(1, p3);
    else if (effect.type === 121 && ownHero) {
      const lower = ownHero.hp * Math.max(1, p2) <= ownHero.maxHp;
      if ((p1 === 1 && lower) || (p1 === 0 && !lower)) amount += p3;
    } else if (effect.type === 133) {
      const comparison = enemy.length - friendly.length;
      if ((p1 === 0 && comparison >= 0) || (p1 === 1 && comparison < 0) || (p1 === 2 && comparison === 0)) amount += p2;
    } else if (effect.type === 138 && onRequestedHalf(state, attacker, p1)) amount += p2;
    else if (effect.type === 139) {
      const heroes = p6 === 2 ? state.units.filter(unit => unit.flags.hero === 1 && unit.hp > 0)
        : state.units.filter(unit => unit.flags.hero === 1 && unit.hp > 0 && unit.team === (p6 === 0 ? (attacker.team === 0 ? 1 : 0) : attacker.team));
      const active = heroes.some(hero => p1 === 1 ? hero.hp * 100 <= hero.maxHp * p2 : hero.hp * 100 > hero.maxHp * p2);
      if (active) amount += p3;
    } else if (effect.type === 145) {
      const alone = !friendly.some(unit => unit.id !== attacker.id && onRequestedHalf(state, unit, p2));
      if (alone && onRequestedHalf(state, attacker, p2)) amount += p3;
    } else if (effect.type === 156) {
      const positive = attacker.statuses.filter(status => optionalNumber(content.data.statuses[String(status.id)] ?? {}, 'Harm', 0) === 0).length;
      amount += positive * p2;
    } else if (effect.type === 174 && target.flags.hero !== 1 && (!p2 || monsterValue(content, target, 'Phyle') === p2) && chance(state, p4 || 100)) amount *= Math.max(1, p3);
    else if (effect.type === 179 && target.flags.hero !== 1 && target.attack <= p2) amount = 0;
    else if (effect.type === 190 && enemy.some(unit => distance(unit, attacker) <= Math.max(1, optionalNumber(effect.raw, 'param5', 1)))) amount += p2;
    else if (effect.type === 192) {
      const travelled = attacker.team === 0 ? attacker.col : state.columns - 1 - attacker.col;
      amount += Math.floor(travelled * p3 / 10);
    } else if (effect.type === 232) amount += attacker.flags.magicDamageHits ?? 0;
    else if (effect.type === 245 && (attacker.flags.moveCharged ?? 0) > 0) amount = Math.floor(amount * Math.max(100, p1) / 100);
    else if (effect.type === 250) {
      amount += friendly.filter(unit => unit.id !== attacker.id && distance(unit, attacker) <= 1).reduce((sum, unit) => sum + unit.attack, 0);
      piercing = true;
    } else if (effect.type === 256) amount += attacker.flags.storedPhysicalDamage ?? 0;
  }
  for (const watcher of friendly) {
    if (watcher.id === attacker.id) continue;
    for (const aura of activeEffectRows(content, watcher, 115)) {
      if (optionalNumber(aura.raw, 'param2', -1) === damageType) amount += optionalNumber(aura.raw, 'param4', optionalNumber(aura.raw, 'param3', 0));
    }
  }
  if ((attacker.flags.criticalChance ?? 0) > 0 && chance(state, attacker.flags.criticalChance!)) {
    amount *= 2;
    emit(state, { type: 'effect', actor: attacker.id, target: target.id, amount, message: 'critical' });
  }
  return { amount: Math.max(0, Math.floor(amount)), piercing };
}

function attack(content: RecoveredContent, state: MutableState, attacker: BattleUnit, target: BattleUnit): void {
  if (attacker.attack <= 0 || attacker.flags.noAttack === 1 || (attacker.flags.statusNoAttack ?? 0) > 0) return;
  let attacks = 1 + Math.max(0, attacker.flags.extraAttacks ?? 0);
  const skillId = attacker.flags.normalSkillId ?? 0;
  const skill = skillId > 0 ? content.data.skills[String(skillId)]?.raw : undefined;
  const serverClass = skill ? numeric(skill, 'ServerClassID', 0) : 0;
  if (serverClass === 14) attacks *= Math.max(1, numeric(skill!, 'CureValue', 2));
  if (serverClass === 47) attacks *= 2;
  let deckBonus = 0;
  if (serverClass === 21) {
    const owner = player(state, attacker.playerId);
    const cardId = owner.drawPile.shift();
    if (cardId) { owner.graveyard.push(cardId); deckBonus = numeric(content.card(cardId).raw, 'InitReady', 0) + numeric(content.card(cardId).raw, 'Quality', 0); }
  }
  for (let index = 0; index < attacks && attacker.hp > 0 && target.hp > 0; index += 1) {
    let amount = skill && numeric(skill, 'DamValue', 0) > 0 ? numeric(skill, 'DamValue') : attacker.attack;
    if (serverClass === 2) amount = Math.floor(amount * nextRandom(state) * 2);
    if (serverClass === 21) amount += deckBonus;
    if (serverClass === 47) amount += Math.max(0, numeric(skill!, 'DamValue', 3));
    if ((attacker.flags.chargeAttack ?? 0) > 0) amount += Math.floor((attacker.flags.movedThisTurn ?? 0) / 2) * attacker.flags.chargeAttack!;
    if ((attacker.flags.statusAttackBonus ?? 0) > 0) amount += target.statuses.length * attacker.flags.statusAttackBonus!;
    const behind = attacker.team === 0 ? attacker.col > target.col : attacker.col < target.col;
    if (behind && (attacker.flags.backstabMultiplier ?? 0) > 0) amount *= attacker.flags.backstabMultiplier!;
    const targetCountdown = target.flags.hero === 1 ? 0 : optionalNumber(cardRaw(content, target.cardId) ?? {}, 'InitReady', 0);
    if ((attacker.flags.countdownThreshold ?? Number.POSITIVE_INFINITY) <= targetCountdown) amount *= Math.max(1, attacker.flags.countdownDamageMultiplier ?? 1);
    if (attacker.flags.ambush && !attacker.flags.hasAttacked) amount *= attacker.flags.ambush;
    let affected = skill ? targetsInArea(content, state, target, skill, player(state, attacker.playerId)) : [target];
    if (serverClass === 42) affected = state.units.filter(unit => unit.team !== attacker.team && unit.hp > 0 && distance(unit, target) <= 1);
    if (attacker.flags.cleave === 1 && affected.length === 1) affected = state.units.filter(unit => unit.team !== attacker.team && unit.hp > 0 && distance(unit, target) <= 1);
    if (affected.length > 1 && (target.flags.preventFriendlySplash === 1 || hasEffectType(content, target, 218))) affected = [target];
    const perTarget = serverClass === 17 ? Math.max(1, Math.floor(amount / Math.max(1, affected.length))) : amount;
    emit(state, { type: 'attack', actor: attacker.id, target: target.id, amount: perTarget, skillId: skillId || undefined });
    let primaryDamage = 0;
    for (let victimIndex = 0; victimIndex < affected.length; victimIndex += 1) {
      const victim = affected[victimIndex]!;
      if (victim.hp <= 0) continue;
      if (serverClass === 41) removeStatuses(content, victim, false, true);
      let victimAmount = serverClass === 13 ? Math.max(1, victim.attack * Math.max(1, numeric(skill!, 'DamValue', 1))) : perTarget;
      if (serverClass === 46 && victimIndex > 0) victimAmount *= 2;
      const damageType = numeric(skill ?? {}, 'DamType', attacker.flags.attackType ?? 0);
      const adjusted = attackAmount(content, state, attacker, victim, victimAmount, damageType);
      const dealt = damage(content, state, attacker, victim, adjusted.amount, adjusted.piercing || serverClass === 13, undefined, skillId || undefined, damageType);
      if (victim.id === target.id) primaryDamage = dealt;
      if (skill) {
        const statusId = numeric(skill, 'StatusID', 0);
        if (statusId > 0 && chance(state, numeric(skill, 'StatueVeracity', 100))) applyStatus(content, state, attacker, victim, statusId);
        const cure = numeric(skill, 'CureValue', 0);
        if (numeric(skill, 'HaveCure', 0) > 0 && cure > 0) heal(state, attacker, attacker, cure, skillId);
      }
      if ((attacker.flags.knockback ?? 0) > 0 && victim.hp > 0) {
        knockback(state, victim, attacker.flags.knockback!);
        refreshAuras(content, state);
      }
      if (victim.flags.hero === 1) {
        if ((attacker.flags.heroHitSlow ?? 0) > 0) {
          const victimPlayer = player(state, victim.playerId);
          const ready = [...victimPlayer.hand].sort((a, b) => a.wait - b.wait || a.instanceId.localeCompare(b.instanceId))[0];
          if (ready) ready.wait += attacker.flags.heroHitSlow!;
        }
        if ((attacker.flags.heroHitSummon ?? 0) > 0) summonToken(content, state, player(state, attacker.playerId), attacker.flags.heroHitSummon!, attacker.row, attacker.col);
      }
      if (victim.hp <= 0 && (attacker.flags.killHp ?? 0) > 0) growHp(attacker, attacker.flags.killHp!);
    }
    attacker.flags.hasAttacked = 1;
    attacker.flags.movedThisTurn = 0;
    attacker.flags.moveCharged = 0;
    attacker.flags.magicDamageHits = 0;
    attacker.flags.storedPhysicalDamage = 0;
    if (primaryDamage <= 0) break;
  }
  if (attacker.flags.hitAndRun === 1 && attacker.hp > 0) {
    const col = attacker.col + (attacker.team === 0 ? -1 : 1);
    if (col > 0 && col < state.columns - 1 && !occupied(state, attacker.row, col, attacker.id)) {
      const moveFrom = { row: attacker.row, col: attacker.col };
      attacker.col = col;
      emit(state, { type: 'move', actor: attacker.id, row: attacker.row, col, moveFrom, moveTo: { row: attacker.row, col } });
    }
  }
  removeDead(content, state);
}

function summonToken(content: RecoveredContent, state: MutableState, owner: BattlePlayer, monsterId: number, nearRow: number, nearCol: number): void {
  const cells: Array<[number, number]> = [[nearRow, nearCol + (owner.team === 0 ? -1 : 1)], [nearRow - 1, nearCol], [nearRow + 1, nearCol]];
  const cell = cells.find(([row, col]) => row >= 0 && row < state.rows && col > 0 && col < COLUMNS - 1 && !occupied(state, row, col));
  if (!cell || !content.data.monsters[String(monsterId)]) return;
  const unit = makeUnit(content, state, owner, monsterId, `token:${monsterId}`, cell[0], cell[1], false);
  state.units.push(unit);
  emit(state, { type: 'summon', actor: owner.id, target: unit.id, row: unit.row, col: unit.col, message: 'effect' });
  resolveSummonEffects(content, state, unit);
}

function summonTokenAt(content: RecoveredContent, state: MutableState, owner: BattlePlayer, monsterId: number, row: number, col: number): BattleUnit | undefined {
  if (row < 0 || row >= state.rows || col <= 0 || col >= state.columns - 1 || occupied(state, row, col) || !content.data.monsters[String(monsterId)]) return undefined;
  const unit = makeUnit(content, state, owner, monsterId, `token:${monsterId}`, row, col, false);
  state.units.push(unit);
  emit(state, { type: 'summon', actor: owner.id, target: unit.id, row, col, message: 'effect' });
  resolveSummonEffects(content, state, unit);
  return unit;
}

function triggeredEffectAllowed(content: RecoveredContent, state: MutableState, unit: BattleUnit, effect: EffectRow): boolean {
  const blocker = state.units.filter(candidate => candidate.team !== unit.team && candidate.hp > 0)
    .flatMap(candidate => activeEffectRows(content, candidate, 181).map(row => ({ candidate, row })))
    .find(({ row }) => chance(state, optionalNumber(row.raw, 'param5', 0)));
  if (!blocker) return true;
  emitEffect(state, blocker.candidate, blocker.row, 'trigger-suppressed', unit, effect.type);
  return false;
}

function moveGraveyardToDeck(content: RecoveredContent, state: MutableState, owner: BattlePlayer, count: number, kind: number, shuffleCards: boolean): number {
  const eligible = owner.graveyard.filter(cardId => !kind || cardKind(content, cardId) === kind);
  let moved = 0;
  while (eligible.length && moved < count) {
    const cardId = eligible.shift()!;
    owner.graveyard.splice(owner.graveyard.indexOf(cardId), 1);
    if (shuffleCards) owner.drawPile.push(cardId); else owner.drawPile.unshift(cardId);
    moved += 1;
  }
  if (shuffleCards && moved) shuffle(state, owner.drawPile);
  return moved;
}

function resolveTurnEffects(content: RecoveredContent, state: MutableState, unit: BattleUnit): void {
  const owner = player(state, unit.playerId);
  for (const effect of activeEffectRows(content, unit)) {
    if (!triggeredEffectAllowed(content, state, unit, effect)) continue;
    const p1 = optionalNumber(effect.raw, 'param1', 0);
    const p2 = optionalNumber(effect.raw, 'param2', 0);
    const p3 = optionalNumber(effect.raw, 'param3', 0);
    const p4 = optionalNumber(effect.raw, 'param4', 0);
    const p5 = optionalNumber(effect.raw, 'param5', 0);
    const p6 = optionalNumber(effect.raw, 'param6', 0);
    switch (effect.type) {
      case 107: {
        const target = randomItem(state, state.units.filter(candidate => candidate.team !== unit.team && candidate.hp > 0
          && candidate.statuses.some(status => optionalNumber(content.data.statuses[String(status.id)] ?? {}, 'Harm', 0) === 0)));
        const removed = target ? removeStatuses(content, target, false, false) : 0;
        emitEffect(state, unit, effect, 'turn-dispel', target, removed);
        break;
      }
      case 110: {
        if (!chance(state, p2 || 100)) break;
        const reversed = state.units.some(candidate => candidate.team !== unit.team && candidate.hp > 0
          && activeEffectRows(content, candidate, 217).some(row => chance(state, optionalNumber(row.raw, 'param1', 0))));
        const cards = owner.hand.filter(card => !p3 || cardKind(content, card.cardId) === p3);
        for (const card of cards) card.wait = Math.max(0, card.wait + (reversed ? Math.abs(p1) : -Math.abs(p1)));
        emitEffect(state, unit, effect, reversed ? 'countdown-reversed' : 'countdown-speed', heroFor(state, owner.id), cards.length);
        break;
      }
      case 113: {
        const interval = Math.max(1, p1);
        const pool = [2, 3, 4, 5, 6, 7, 8].map(index => optionalNumber(effect.raw, `param${index}`, 0)).filter(id => id > 0 && !!content.data.monsters[String(id)]);
        if ((state.turn - unit.summonedTurn) % interval === 0) {
          const monsterId = randomItem(state, pool);
          if (monsterId) summonToken(content, state, owner, monsterId, unit.row, unit.col);
          emitEffect(state, unit, effect, 'gateway-summon', unit, monsterId ?? 0);
        }
        break;
      }
      case 117:
      case 405: {
        const roll = nextRandom(state) * 100;
        let monsterId = 0;
        for (let index = 1; index <= 7; index += 2) {
          const candidate = optionalNumber(effect.raw, `param${index}`, 0);
          const threshold = optionalNumber(effect.raw, `param${index + 1}`, 0);
          if (candidate > 0 && roll <= threshold) { monsterId = candidate; break; }
        }
        if (monsterId) summonToken(content, state, owner, monsterId, unit.row, unit.col);
        emitEffect(state, unit, effect, 'turn-summon', unit, monsterId);
        break;
      }
      case 131: {
        const hero = state.units.filter(candidate => candidate.team === unit.team && candidate.flags.hero === 1 && candidate.hp > 0)
          .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
        if (hero) heal(state, unit, hero, Math.abs(p1));
        emitEffect(state, unit, effect, 'hero-heal', hero, p1);
        break;
      }
      case 132: {
        const targets = state.units.filter(candidate => candidate.team === unit.team && candidate.hp > 0);
        for (const target of targets) heal(state, unit, target, Math.abs(p1));
        emitEffect(state, unit, effect, 'team-heal', unit, targets.length);
        break;
      }
      case 137: {
        if (!chance(state, p4 || 100)) break;
        const moved = moveGraveyardToDeck(content, state, owner, Math.max(1, p1), p2, p3 === 1);
        emitEffect(state, unit, effect, 'graveyard-recycle', unit, moved);
        break;
      }
      case 139: {
        const heroes = p6 === 2 ? state.units.filter(candidate => candidate.flags.hero === 1 && candidate.hp > 0)
          : state.units.filter(candidate => candidate.flags.hero === 1 && candidate.hp > 0 && candidate.team === (p6 === 0 ? (unit.team === 0 ? 1 : 0) : unit.team));
        const active = heroes.some(hero => p1 === 1 ? hero.hp * 100 <= hero.maxHp * p2 : hero.hp * 100 > hero.maxHp * p2);
        const key = `conditionalEffect:${effect.id}`;
        if (active && unit.flags[key] !== 1) {
          unit.flags[key] = 1;
          if (p4 > 0) growHp(unit, p4);
          if (p5 > 0 && p5 !== 7701 && content.data.effects[String(p5)]) applyStaticEffects(content, state, unit, [p5]);
        }
        emitEffect(state, unit, effect, 'hero-threshold', unit, active ? 1 : 0);
        break;
      }
      case 140:
        if (chance(state, p2 || 100)) draw(content, state, owner, Math.max(1, p1));
        emitEffect(state, unit, effect, 'turn-draw', heroFor(state, owner.id), p1);
        break;
      case 142: {
        const active = onRequestedHalf(state, unit, p1);
        const childId = active ? p2 : p3;
        if (childId > 0 && childId !== 7701 && content.data.effects[String(childId)]) {
          const key = `halfFieldChild:${childId}`;
          if (unit.flags[key] !== 1) { unit.flags[key] = 1; applyStaticEffects(content, state, unit, [childId]); }
        }
        emitEffect(state, unit, effect, 'half-field', unit, active ? 1 : 0);
        break;
      }
      case 146: {
        const cardId = owner.graveyard.find(id => !p2 || cardKind(content, id) === p2);
        if (cardId && addCardToHand(content, state, owner, cardId)) owner.graveyard.splice(owner.graveyard.indexOf(cardId), 1);
        emitEffect(state, unit, effect, 'graveyard-hand', unit, cardId ? 1 : 0);
        break;
      }
      case 150: {
        const drawn = drawMatching(content, state, owner, Math.max(1, p1), p2);
        emitEffect(state, unit, effect, 'premonition', unit, drawn);
        break;
      }
      case 151: {
        const targets = p3 === 2 ? [unit] : state.units.filter(candidate => candidate.team === unit.team && candidate.hp > 0 && candidate.flags.hero !== 1);
        for (const target of targets) {
          if (target.flags.noGrowth === 1 || (target.flags.noGrowthTurns ?? 0) > 0) continue;
          target.attack = Math.max(0, target.attack + p1);
          if (p2 > 0) growHp(target, p2); else if (p2 < 0) target.hp = Math.max(0, target.hp + p2);
        }
        emitEffect(state, unit, effect, 'action-growth', unit, targets.length);
        break;
      }
      case 152: {
        const harmfulSource = randomItem(state, state.units.filter(candidate => candidate.team === unit.team && candidate.statuses.some(status => optionalNumber(content.data.statuses[String(status.id)] ?? {}, 'Harm', 0) === 1)));
        const enemy = randomItem(state, state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero !== 1 && candidate.hp > 0));
        const status = harmfulSource?.statuses.find(candidate => optionalNumber(content.data.statuses[String(candidate.id)] ?? {}, 'Harm', 0) === 1);
        if (harmfulSource && enemy && status && chance(state, p3 || 100)) {
          applyStatusForTurns(content, state, unit, enemy, status.id, status.turns);
          applyStatusModifiers(content, harmfulSource, status.id, -1);
          harmfulSource.statuses.splice(harmfulSource.statuses.indexOf(status), 1);
        }
        emitEffect(state, unit, effect, 'status-transfer', enemy, status?.id ?? 0);
        break;
      }
      case 153: {
        const targets = state.units.filter(candidate => candidate.id !== unit.id && candidate.flags.hero !== 1 && candidate.hp > 0 && (p1 === 0 || candidate.team !== unit.team));
        for (const target of targets) damage(content, state, unit, target, Math.abs(p3), false, 'turn-area', undefined, p2);
        emitEffect(state, unit, effect, 'turn-area', unit, targets.length);
        break;
      }
      case 155:
      case 409: {
        const cardId = owner.graveyard.find(id => cardKind(content, id) === 1);
        if (cardId) {
          const monsterId = optionalNumber(cardRaw(content, cardId) ?? {}, 'MonsterID', 0);
          owner.graveyard.splice(owner.graveyard.indexOf(cardId), 1);
          summonToken(content, state, owner, monsterId, unit.row, unit.col);
        }
        emitEffect(state, unit, effect, 'turn-resurrect', unit, cardId ? 1 : 0);
        break;
      }
      case 159: {
        const enemies = state.players.filter(candidate => candidate.team !== unit.team && !candidate.surrendered);
        for (let index = 0; index < Math.max(1, p1); index += 1) {
          const victim = randomItem(state, enemies);
          if (victim && content.data.cards[String(p2)]) victim.drawPile.splice(Math.floor(nextRandom(state) * (victim.drawPile.length + 1)), 0, String(p2));
        }
        emitEffect(state, unit, effect, 'deck-injection', unit, p1);
        break;
      }
      case 161: {
        const hero = heroFor(state, owner.id);
        const allies = state.units.filter(candidate => candidate.team === unit.team && candidate.flags.hero !== 1 && candidate.hp > 0).length;
        if (hero) heal(state, unit, hero, allies + p1);
        emitEffect(state, unit, effect, 'unit-count-heal', hero, allies + p1);
        break;
      }
      case 162: {
        const race = p3;
        const allies = state.units.filter(candidate => candidate.team === unit.team && candidate.flags.hero !== 1 && candidate.hp > 0 && (!race || monsterValue(content, candidate, 'Phyle') === race));
        if (allies.length >= p4) for (const target of allies.filter(candidate => candidate.id !== unit.id)) {
          const key = `tribalEffect:${effect.id}`;
          if (target.flags[key] !== 1 && optionalNumber(effect.raw, 'param5', 0) > 0) {
            target.flags[key] = 1;
            applyStaticEffects(content, state, target, [optionalNumber(effect.raw, 'param5', 0)]);
          }
        }
        emitEffect(state, unit, effect, 'tribal-threshold', unit, allies.length);
        break;
      }
      case 166: {
        if (effect.id === 16603) {
          const target = randomItem(state, state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero !== 1 && candidate.hp > 0 && distance(candidate, unit) <= effectiveRange(content, unit)));
          if (target) { target.attack = 0; target.maxHp = 3; target.hp = Math.min(target.hp, 3); target.flags.transformed = 1; }
          emitEffect(state, unit, effect, 'transform-enemy', target, 1);
        } else {
          const candidates = Object.entries(content.data.monsters).filter(([id, raw]) => Number(id) > 0 && Number(id) !== unit.monsterId && optionalNumber(raw, 'Phyle', -1) === monsterValue(content, unit, 'Phyle', -2));
          const selected = randomItem(state, candidates);
          if (selected) {
            unit.monsterId = Number(selected[0]);
            unit.attack = Math.max(0, optionalNumber(selected[1], 'Attack', unit.attack));
            unit.maxHp = Math.max(1, optionalNumber(selected[1], 'HP', unit.maxHp));
            unit.hp = Math.min(unit.hp, unit.maxHp);
          }
          emitEffect(state, unit, effect, 'transform-self', unit, unit.monsterId);
        }
        break;
      }
      case 168: {
        const card = [...owner.hand].sort((a, b) => b.wait - a.wait)[0];
        if (card) card.wait = chance(state, p2 || 75) ? Math.max(0, card.wait - Math.abs(p1)) : 0;
        emitEffect(state, unit, effect, 'diligence', unit, card?.wait ?? 0);
        break;
      }
      case 170: {
        const col = unit.col + (unit.team === 0 ? 3 : -3);
        const trap = summonTokenAt(content, state, owner, p1, unit.row, col);
        if (trap && p2 > 0) trap.flags.admissionStatus = p2;
        emitEffect(state, unit, effect, 'create-trap', trap, p1);
        break;
      }
      case 199: {
        const target = state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero !== 1 && candidate.hp > 0).sort((a, b) => b.hp - a.hp)[0];
        if (target && chance(state, p2 || 100)) damage(content, state, unit, target, Math.abs(p1), false, 'highest-hp', undefined, p3);
        emitEffect(state, unit, effect, 'highest-hp', target, p1);
        break;
      }
      case 200: {
        const hero = heroFor(state, owner.id);
        if (hero) damage(content, state, unit, hero, Math.abs(p1), true, 'upkeep', undefined, p2);
        emitEffect(state, unit, effect, 'upkeep', hero, p1);
        break;
      }
      case 201: {
        if (unit.flags.devoured !== 1) {
          const target = state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero !== 1 && candidate.hp > 0 && Math.abs(candidate.row - unit.row) <= 1 && distance(candidate, unit) <= 3)
            .sort((a, b) => distance(a, unit) - distance(b, unit))[0];
          if (target) { unit.flags.devoured = 1; unit.attack += target.attack; growHp(unit, target.maxHp); target.flags.erased = 1; target.hp = 0; }
          emitEffect(state, unit, effect, 'devour', target, target?.maxHp ?? 0);
        }
        break;
      }
      case 202: {
        const converted = state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero !== 1 && candidate.hp > 0 && candidate.cardId.startsWith('token:') && candidate.flags.converted !== 1);
        for (const target of converted) { target.team = unit.team; target.playerId = unit.playerId; target.flags.converted = 1; target.flags.noGraveyard = 1; }
        emitEffect(state, unit, effect, 'convert-tokens', converted[0], converted.length);
        break;
      }
      case 204: {
        const targets = state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero !== 1 && candidate.hp > 0);
        for (const target of targets) { if (p2 > 0) applyStatus(content, state, unit, target, p2); damage(content, state, unit, target, 3, false, 'frostfire', undefined, 3); }
        emitEffect(state, unit, effect, 'frostfire', unit, targets.length);
        break;
      }
      case 206: {
        const targets = state.units.filter(candidate => candidate.id !== unit.id && candidate.flags.hero !== 1 && candidate.hp > 0 && distance(candidate, unit) <= 1 && (p2 === 3 ? candidate.team === unit.team : candidate.team !== unit.team));
        for (const target of targets) { damage(content, state, unit, target, Math.abs(p4), false, 'domain', undefined, p3); if (p5 > 0) applyStatusForTurns(content, state, unit, target, p5, optionalNumber(effect.raw, 'param6', 1)); }
        emitEffect(state, unit, effect, 'domain', unit, targets.length);
        break;
      }
      case 207: {
        if (onRequestedHalf(state, unit, p1)) {
          const direction = unit.team === 0 ? (p2 ? 1 : -1) : (p2 ? -1 : 1);
          const target = state.units.find(candidate => candidate.id !== unit.id && candidate.hp > 0 && candidate.row === unit.row && candidate.col === unit.col + direction && (p4 === 4 ? candidate.team === unit.team : candidate.team !== unit.team));
          if (target) [unit.row, unit.col, target.row, target.col] = [target.row, target.col, unit.row, unit.col];
          emitEffect(state, unit, effect, 'position-swap', target, target ? 1 : 0);
        }
        break;
      }
      case 209: {
        const victim = state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero !== 1 && candidate.hp > 0 && distance(candidate, unit) <= 1).sort((a, b) => b.attack - a.attack)[0];
        if (victim) {
          const blast = unit.attack + victim.attack;
          victim.flags.erased = 1; victim.hp = 0;
          const radius = p1 === 10 ? state.columns : (p1 === 55 ? 2 : 1);
          for (const target of state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero !== 1 && candidate.hp > 0 && distance(candidate, unit) <= radius)) damage(content, state, unit, target, blast, true, 'devour-blast');
          unit.flags.mutualOblivion = 1; unit.hp = 0;
          emitEffect(state, unit, effect, 'devour-blast', victim, blast);
        }
        break;
      }
      case 214: {
        const enemy = randomItem(state, state.units.filter(candidate => candidate.team !== unit.team && candidate.hp > 0));
        const ally = randomItem(state, state.units.filter(candidate => candidate.team === unit.team && candidate.hp > 0));
        let removed = 0;
        if (enemy) removed += removeStatuses(content, enemy, false, true);
        if (ally) removed += removeStatuses(content, ally, true, true);
        if (removed) { unit.attack += p4; growHp(unit, optionalNumber(effect.raw, 'param5', p4)); }
        emitEffect(state, unit, effect, 'celestial-purge', enemy, removed);
        break;
      }
      case 215: {
        const ids = [p3, p4, optionalNumber(effect.raw, 'param5', 0)];
        const target = state.units.find(candidate => candidate.team === unit.team && candidate.hp > 0 && ids.includes(candidate.monsterId));
        if (target && chance(state, p2 || 100)) heal(state, unit, target, Math.abs(p1));
        emitEffect(state, unit, effect, 'named-heal', target, p1);
        break;
      }
      case 219: {
        const target = randomItem(state, state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero !== 1 && candidate.hp > 0));
        const raw = content.data.monsters[String(p1)];
        if (target && raw && chance(state, p3 || 100)) {
          target.monsterId = p1;
          target.attack = Math.max(0, optionalNumber(raw, 'Attack', target.attack));
          target.maxHp = Math.max(1, optionalNumber(raw, 'HP', target.maxHp));
          target.hp = Math.min(target.hp, target.maxHp);
          target.flags.transformed = 1;
        }
        emitEffect(state, unit, effect, 'transform-enemy', target, p1);
        break;
      }
      case 224: {
        const target = state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero !== 1 && candidate.hp > 0).sort((a, b) => b.attack - a.attack)[0];
        if (target && p1 > 0 && chance(state, p3 || 100)) applyStatusForTurns(content, state, unit, target, p1, p2);
        emitEffect(state, unit, effect, 'charm-highest', target, p1);
        break;
      }
      case 241: {
        const target = state.units.filter(candidate => candidate.team === unit.team && candidate.flags.hero !== 1 && candidate.hp > 0).sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
        if (target) {
          heal(state, unit, target, p1);
          const harmful = target.statuses.find(status => optionalNumber(content.data.statuses[String(status.id)] ?? {}, 'Harm', 0) === 1);
          if (harmful) { applyStatusModifiers(content, target, harmful.id, -1); target.statuses.splice(target.statuses.indexOf(harmful), 1); }
          else growHp(target, p3);
        }
        emitEffect(state, unit, effect, 'triage', target, p1);
        break;
      }
    }
  }
}

function processUnitTurn(content: RecoveredContent, state: MutableState, unit: BattleUnit): void {
  if (unit.hp <= 0 || unit.flags.hero === 1) return;
  const statusDamage = unit.statuses.reduce((sum, status) => {
    const raw = content.data.statuses[String(status.id)];
    if (!raw) return sum;
    return sum + effectIdsFromStatus(raw).reduce((inner, effectId) => {
      const effect = content.data.effects[String(effectId)];
      return effect && optionalNumber(effect, 'TypeID') === 24 ? inner + Math.abs(optionalNumber(effect, 'param2', optionalNumber(effect, 'param1', 0))) : inner;
    }, 0);
  }, 0);
  if ((unit.flags.periodicDamage ?? 0) + statusDamage > 0) damage(content, state, undefined, unit, (unit.flags.periodicDamage ?? 0) + statusDamage, true, 'periodic');
  if (unit.hp <= 0) return;
  if ((unit.flags.regeneration ?? 0) > 0) heal(state, unit, unit, unit.flags.regeneration!);
  if ((unit.flags.healWeakest ?? 0) > 0) {
    const hurt = state.units.filter(candidate => candidate.team === unit.team && candidate.hp > 0 && candidate.hp < candidate.maxHp).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp) || a.id.localeCompare(b.id))[0];
    if (hurt) heal(state, unit, hurt, unit.flags.healWeakest!);
  }
  if ((unit.flags.healAll ?? 0) > 0) for (const ally of state.units.filter(candidate => candidate.team === unit.team && candidate.hp > 0)) heal(state, unit, ally, unit.flags.healAll!);
  if ((unit.flags.heroTickDamage ?? 0) > 0) {
    const enemyHero = chooseTarget(content, state, unit, state.units.filter(candidate => candidate.team !== unit.team && candidate.flags.hero === 1 && candidate.hp > 0));
    if (enemyHero) damage(content, state, unit, enemyHero, unit.flags.heroTickDamage!, true, 'direct');
  }
  if ((unit.flags.randomDamage ?? 0) > 0) {
    const enemies = state.units.filter(candidate => candidate.team !== unit.team && candidate.hp > 0);
    if (enemies.length) damage(content, state, unit, enemies[Math.floor(nextRandom(state) * enemies.length)]!, unit.flags.randomDamage!, false, 'random');
  }
  resolveTurnEffects(content, state, unit);
  if (unit.hp <= 0) return;
  if (unit.flags.randomActiveEffect === 1) {
    const row = activeEffectRows(content, unit, 95)[0];
    if (row) {
      const children = [1, 2, 3, 4, 5, 6, 7, 8].map(index => optionalNumber(row.raw, `param${index}`, 0)).filter(id => id > 0 && !!content.data.effects[String(id)]);
      const child = randomItem(state, children);
      const target = randomItem(state, state.units.filter(candidate => candidate.team === unit.team && candidate.hp > 0));
      if (child && target) applyStaticEffects(content, state, target, [child]);
      emitEffect(state, unit, row, 'random-effect', target, child ?? 0);
    }
  }
  if ((unit.flags.transformAfterTurns ?? 0) > 0 && unit.flags.transformed !== 1
      && state.turn - unit.summonedTurn >= unit.flags.transformAfterTurns!) {
    const candidates = Object.entries(content.data.monsters).filter(([id, raw]) => Number(id) > 0 && Number(id) !== unit.monsterId
      && optionalNumber(raw, 'Phyle', -1) === monsterValue(content, unit, 'Phyle', -2));
    const selected = candidates[0];
    if (selected) {
      unit.monsterId = Number(selected[0]);
      unit.attack = Math.max(0, optionalNumber(selected[1], 'Attack', unit.attack));
      unit.maxHp = Math.max(1, optionalNumber(selected[1], 'HP', unit.maxHp));
      unit.hp = Math.min(unit.hp, unit.maxHp);
      unit.flags.transformed = 1;
      emit(state, { type: 'effect', actor: unit.id, target: unit.id, amount: unit.monsterId, message: 'timed-transform' });
    }
  }
  if ((unit.flags.turnSummonMonster ?? 0) > 0) summonToken(content, state, player(state, unit.playerId), unit.flags.turnSummonMonster!, unit.row, unit.col);
  if ((unit.flags.turnStatus ?? 0) > 0 && chance(state, unit.flags.turnStatusChance ?? 100)) {
    const target = randomItem(state, state.units.filter(candidate => candidate.hp > 0 && candidate.team !== unit.team));
    if (target) applyStatus(content, state, unit, target, unit.flags.turnStatus!);
  }
  if ((unit.flags.pulseStatus ?? 0) > 0 && chance(state, unit.flags.pulseStatusChance ?? 100)) {
    const target = randomItem(state, state.units.filter(candidate => candidate.hp > 0 && candidate.team !== unit.team && distance(candidate, unit) <= effectiveRange(content, unit)));
    if (target) applyStatus(content, state, unit, target, unit.flags.pulseStatus!);
  }
  if ((unit.flags.terrorChance ?? 0) > 0 && chance(state, unit.flags.terrorChance!)) {
    const target = randomItem(state, state.units.filter(candidate => candidate.hp > 0 && candidate.team !== unit.team && candidate.flags.hero !== 1 && distance(candidate, unit) <= effectiveRange(content, unit)));
    if (target) returnUnitToHand(content, state, target);
  }
  if ((unit.flags.dispelChance ?? 0) > 0 && chance(state, unit.flags.dispelChance!)) {
    const pool = state.units.filter(candidate => candidate.hp > 0 && (unit.flags.dispelEnemy ? candidate.team !== unit.team : candidate.team === unit.team));
    const target = randomItem(state, pool); if (target) removeStatuses(content, target, !unit.flags.dispelEnemy, false);
  }
  if ((unit.flags.enemyHandSlow ?? 0) > 0) {
    const enemy = randomItem(state, state.players.filter(candidate => candidate.team !== unit.team && candidate.hand.length > 0));
    const card = enemy ? randomItem(state, enemy.hand) : undefined; if (card) card.wait += unit.flags.enemyHandSlow!;
  }
  const prevented = unit.flags.noAct === 1 || (unit.flags.statusNoAct ?? 0) > 0;
  if (!prevented) {
    const enemies = state.units.filter(candidate => candidate.id !== unit.id && candidate.hp > 0
      && (unit.flags.charmed === 1 || (unit.flags.statusCharmed ?? 0) > 0 ? candidate.team === unit.team : candidate.team !== unit.team)
      && candidate.flags.untargetable !== 1);
    if (unit.flags.randomSkill === 1) {
      const row = activeEffectRows(content, unit, 94)[0];
      const skillIds = row ? [1, 2, 3, 4, 5, 6, 7, 8].map(index => optionalNumber(row.raw, `param${index}`, 0)).filter(id => id > 0 && !!content.data.skills[String(id)]?.raw) : [];
      const chosenSkillId = randomItem(state, skillIds);
      const chosenTarget = chooseTarget(content, state, unit, enemies);
      if (row && chosenSkillId && chosenTarget) {
        playSkill(content, state, player(state, unit.playerId), content.skill(chosenSkillId).raw!, chosenTarget, chosenSkillId);
        emitEffect(state, unit, row, 'random-skill', chosenTarget, chosenSkillId);
      }
    }
    let target = chooseTarget(content, state, unit, enemies.filter(candidate => distance(unit, candidate) <= effectiveRange(content, unit)));
    if (!target) {
      const destination = chooseTarget(content, state, unit, enemies);
      if (destination) {
        const reverse = unit.flags.reverseMove === 1 || hasEffectType(content, unit, 167);
        moveUnit(content, state, unit, reverse ? (heroFor(state, unit.playerId) ?? destination) : destination);
      }
      target = chooseTarget(content, state, unit, enemies.filter(candidate => candidate.hp > 0 && distance(unit, candidate) <= effectiveRange(content, unit)));
    }
    if (target && !(unit.flags.noAttackAfterMove === 1 && (unit.flags.movedThisTurn ?? 0) > 0)) attack(content, state, unit, target);
  }
  if (unit.flags.pendingDeath === 1) unit.hp = 0;
  if (hasEffectType(content, unit, 144)) unit.hp = 0;
  unit.flags.previousHp = unit.hp;
  for (const key of ['damageImmuneTurns', 'armorBreakImmune', 'controlImmuneTurns', 'noGrowthTurns', 'timedCompositeTurns']) {
    if ((unit.flags[key] ?? 0) > 0) unit.flags[key] -= 1;
  }
  for (const status of unit.statuses) if (status.auraEffectId === undefined) status.turns -= 1;
  for (const expired of unit.statuses.filter(status => status.turns <= 0)) applyStatusModifiers(content, unit, expired.id, -1);
  unit.statuses = unit.statuses.filter(status => status.turns > 0);
  refreshAuras(content, state);
}

function effectIdsFromStatus(raw: RawRow): number[] {
  const ids: number[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const id = numeric(raw, `Effect${index}`, 0);
    if (id > 0) ids.push(id);
  }
  return ids;
}

function endTurn(content: RecoveredContent, state: MutableState, owner: BattlePlayer): void {
  const units = state.units.filter(unit => unit.playerId === owner.id && unit.hp > 0 && unit.summonedTurn < state.turn).sort((a, b) => a.row - b.row || (owner.team === 0 ? b.col - a.col : a.col - b.col) || a.id.localeCompare(b.id));
  for (const unit of units) {
    processUnitTurn(content, state, unit);
    removeDead(content, state);
    settleIfNeeded(state);
    if (state.status === 'settled') return;
  }
  emit(state, { type: 'turn-end', actor: owner.id, amount: state.turn });
  let next = state.activePlayer;
  for (let attempts = 0; attempts < state.players.length; attempts += 1) {
    next = (next + 1) % state.players.length;
    const candidate = state.players[next]!;
    if (!candidate.surrendered && candidate.hp > 0) break;
  }
  state.activePlayer = next;
  state.turn += 1;
  settleIfNeeded(state);
  if (state.status === 'playing') beginTurn(content, state, activePlayer(state));
}

function validateSpec(content: RecoveredContent, spec: BattleSpec): void {
  if (!spec.id) throw new Error('Battle id is required');
  integer(spec.seed, 'Battle seed');
  integer(spec.mapId, 'Map id', 0);
  content.map(spec.mapId);
  if (spec.players.length < 2 || spec.players.length > 8) throw new Error('Battle requires 2 to 8 players');
  const ids = new Set<string>();
  for (const candidate of spec.players) {
    if (!candidate.id || ids.has(candidate.id)) throw new Error('Battle player ids must be unique and non-empty');
    ids.add(candidate.id);
    if (candidate.team !== 0 && candidate.team !== 1) throw new Error('Invalid team');
    if (!Number.isFinite(candidate.hp) || candidate.hp <= 0) throw new Error(`Invalid hp for ${candidate.id}`);
    for (const cardId of candidate.deck) content.card(cardId);
    if (candidate.monsterId !== undefined && candidate.monsterId > 0 && !content.data.monsters[String(candidate.monsterId)]) throw new Error(`Unknown hero monster ${candidate.monsterId}`);
  }
  if (![0, 1].every(team => spec.players.some(candidate => candidate.team === team))) throw new Error('Battle requires both teams');
  if ([0, 1].some(team => spec.players.filter(candidate => candidate.team === team).length > 4)) throw new Error('Battle supports at most 4 players per team');
  if (spec.boardClearTeam !== undefined) {
    if (spec.boardClearTeam !== 0 && spec.boardClearTeam !== 1) throw new Error('Board-clear team is invalid');
    const defenderIds = new Set(spec.players.filter(candidate => candidate.team === spec.boardClearTeam).map(candidate => candidate.id));
    if (!spec.initialUnits?.some(unit => defenderIds.has(unit.playerId))) throw new Error('Board-clear battle requires a defending unit');
  }
  const rows = spec.rows ?? content.catalog.layout.grid.rows_initialized;
  integer(rows, 'Battle rows', 1);
  if (rows > MAX_ROWS) throw new Error(`Battle rows cannot exceed ${MAX_ROWS}`);
  const largestTeam = Math.max(...[0, 1].map(team => spec.players.filter(candidate => candidate.team === team).length));
  if (rows < largestTeam) throw new Error('Battle rows must fit every team hero');
}

export function createBattle(content: RecoveredContent, spec: BattleSpec): BattleState {
  validateSpec(content, spec);
  const rows = spec.rows ?? content.catalog.layout.grid.rows_initialized;
  const normalizedSeed = spec.seed >>> 0 || 1;
  const state: MutableState = {
    version: 1,
    id: spec.id,
    seed: normalizedSeed,
    rng: normalizedSeed,
    turn: 1,
    revision: 0,
    activePlayer: spec.firstPlayer === undefined ? normalizedSeed % spec.players.length : integer(spec.firstPlayer, 'First player', 0),
    mapId: spec.mapId,
    columns: COLUMNS,
    rows,
    players: [],
    units: [],
    events: [],
    status: 'playing',
    winner: null,
    ...(spec.boardClearTeam === undefined ? {} : { boardClearTeam: spec.boardClearTeam }),
    nextId: 1,
  };
  if (state.activePlayer >= spec.players.length) throw new Error('First player is out of range');
  for (const source of spec.players) {
    const battlePlayer: BattlePlayer = {
      ...clone(source), maxHp: source.hp, drawPile: [...source.deck], hand: [], graveyard: [], fatigue: 0,
      row: spec.players.filter(candidate => candidate.team === source.team).findIndex(candidate => candidate.id === source.id), surrendered: false,
    };
    shuffle(state, battlePlayer.drawPile);
    state.players.push(battlePlayer);
  }
  const turnLimit = integer((spec as RuntimeSpec).turnLimit ?? DEFAULT_TURN_LIMIT, 'Turn limit', 1);
  for (const owner of state.players) {
    if (owner.team === state.boardClearTeam) continue;
    const hero = makeUnit(content, state, owner, owner.monsterId ?? 0, `hero:${owner.id}`, owner.row, owner.team === 0 ? 0 : COLUMNS - 1, true);
    hero.flags.turnLimit = turnLimit;
    state.units.push(hero);
  }
  for (const initial of spec.initialUnits ?? []) {
    const owner = player(state, initial.playerId);
    integer(initial.row, 'Initial unit row', 0); integer(initial.col, 'Initial unit column', 1);
    if (initial.row >= rows || initial.col >= COLUMNS - 1 || occupied(state, initial.row, initial.col)) throw new Error('Initial unit cell is invalid or occupied');
    if (!content.data.monsters[String(initial.monsterId)]) throw new Error(`Unknown initial monster ${initial.monsterId}`);
    const unit = makeUnit(content, state, owner, initial.monsterId, `initial:${initial.monsterId}`, initial.row, initial.col, false);
    unit.summonedTurn = 0;
    state.units.push(unit);
  }
  for (const unit of [...state.units].filter(candidate => candidate.flags.hero !== 1)) resolveSummonEffects(content, state, unit);
  refreshAuras(content, state);
  for (const owner of state.players) if (owner.team !== state.boardClearTeam) draw(content, state, owner, Math.min(OPENING_HAND, owner.drawPile.length));
  emit(state, { type: 'battle-start', amount: normalizedSeed });
  beginTurn(content, state, activePlayer(state), true);
  return state;
}

function resolveSkillPlayedEffects(content: RecoveredContent, state: MutableState, caster: BattlePlayer): void {
  for (const watcher of state.units.filter(unit => unit.hp > 0)) {
    for (const effect of activeEffectRows(content, watcher)) {
      if (effect.type === 104 && watcher.team === caster.team && triggeredEffectAllowed(content, state, watcher, effect)) {
        const card = [...caster.hand].sort((a, b) => b.wait - a.wait || a.instanceId.localeCompare(b.instanceId))[0];
        if (card && chance(state, optionalNumber(effect.raw, 'param2', 100))) card.wait = Math.max(0, card.wait - Math.abs(optionalNumber(effect.raw, 'param1', 0)));
        emitEffect(state, watcher, effect, 'skill-speed', heroFor(state, caster.id), card?.wait ?? 0);
      } else if (effect.type === 176 && watcher.team !== caster.team && triggeredEffectAllowed(content, state, watcher, effect)) {
        const childId = optionalNumber(effect.raw, 'param3', 0);
        const child = content.data.effects[String(childId)];
        const childType = child ? optionalNumber(child, 'TypeID', 0) : 0;
        if (child && childType === 151) {
          watcher.attack = Math.max(0, watcher.attack + optionalNumber(child, 'param1', 0));
          growHp(watcher, optionalNumber(child, 'param2', 0));
        } else if (child && childType === 58) {
          const card = randomItem(state, caster.hand);
          if (card) card.wait += Math.max(1, Math.abs(optionalNumber(child, 'param1', 1)));
        } else if (childId > 0 && child) applyStaticEffects(content, state, watcher, [childId]);
        emitEffect(state, watcher, effect, 'enemy-skill-reaction', heroFor(state, caster.id), childId);
      }
    }
  }
}

export function applyBattleAction(content: RecoveredContent, state: BattleState, actorId: string, action: BattleAction): BattleState {
  if (state.status !== 'playing') throw new Error('Battle is already settled');
  player(state, actorId);
  if (action.type !== 'surrender' && activePlayer(state).id !== actorId) throw new Error('Actor is not the active player');
  const original = JSON.stringify(state);
  const next = clone(state);
  refreshAuras(content, next);
  const owner = player(next, actorId);
  if (owner.surrendered || owner.hp <= 0) throw new Error('Actor cannot act');
  if (action.type === 'surrender') {
    const surrenderedActivePlayer = next.activePlayer === next.players.findIndex(candidate => candidate.id === actorId);
    owner.surrendered = true;
    owner.hp = 0;
    const hero = heroFor(next, owner.id);
    if (hero) hero.hp = 0;
    emit(next, { type: 'surrender', actor: owner.id });
    removeDead(content, next);
    settleIfNeeded(next);
    if (next.status === 'playing' && surrenderedActivePlayer) {
      let index = next.activePlayer;
      do { index = (index + 1) % next.players.length; } while (next.players[index]!.surrendered || next.players[index]!.hp <= 0);
      next.activePlayer = index;
      next.turn += 1;
      beginTurn(content, next, activePlayer(next));
    }
  } else if (action.type === 'end') {
    endTurn(content, next, owner);
  } else {
    const legal = legalPlays(content, next, actorId).some(candidate => candidate.instanceId === action.instanceId && candidate.row === action.row && candidate.col === action.col && candidate.targetId === action.targetId);
    if (!legal) throw new Error('Illegal card play');
    const handIndex = owner.hand.findIndex(candidate => candidate.instanceId === action.instanceId);
    const hand = owner.hand[handIndex]!;
    const card = content.card(hand.cardId);
    owner.hand.splice(handIndex, 1);
    if (numeric(card.raw, 'Type') === 1) summon(content, next, owner, hand, action.row, action.col);
    else {
      owner.graveyard.push(hand.cardId);
      const skillId = numeric(card.raw, 'SkillID');
      const target = next.units.find(unit => unit.id === action.targetId && unit.hp > 0) ?? {
        id: `cell:${action.row}:${action.col}`, playerId: owner.id, team: owner.team, cardId: '', monsterId: 0,
        row: action.row, col: action.col, hp: 1, maxHp: 1, attack: 0, range: 0, movement: 0,
        statuses: [], effects: [], summonedTurn: next.turn, flags: {},
      };
      emit(next, { type: 'play', actor: owner.id, target: action.targetId, cardId: hand.cardId, skillId, row: action.row, col: action.col });
      playSkill(content, next, owner, content.skill(skillId).raw!, target, skillId);
      resolveSkillPlayedEffects(content, next, owner);
    }
    settleIfNeeded(next);
  }
  refreshAuras(content, next);
  if (JSON.stringify(state) !== original) throw new Error('Battle reducer mutated its input');
  next.revision = state.revision + 1;
  return next;
}

export function chooseAIAction(content: RecoveredContent, state: BattleState, actorId: string): BattleAction {
  const owner = player(state, actorId);
  if (!owner.ai) throw new Error('Actor is not AI-controlled');
  if (state.status !== 'playing' || activePlayer(state).id !== actorId) throw new Error('AI actor is not active');
  const plays = legalPlays(content, state, actorId);
  if (!plays.length) return { type: 'end' };
  const scored = plays.map(play => {
    const hand = owner.hand.find(card => card.instanceId === play.instanceId)!;
    const card = content.card(hand.cardId);
    const target = play.targetId ? state.units.find(unit => unit.id === play.targetId) : undefined;
    const score = numeric(card.raw, 'Type') === 1
      ? 100 + numeric(content.data.monsters[String(numeric(card.raw, 'MonsterID'))] ?? {}, 'Attack') * 4 + numeric(content.data.monsters[String(numeric(card.raw, 'MonsterID'))] ?? {}, 'HP')
      : 200 + (target && target.team !== owner.team ? 50 - target.hp : target ? target.maxHp - target.hp : 0);
    return { play, score, cardId: hand.cardId };
  }).sort((a, b) => b.score - a.score || a.cardId.localeCompare(b.cardId) || a.play.row - b.play.row || a.play.col - b.play.col || (a.play.targetId ?? '').localeCompare(b.play.targetId ?? ''));
  const choice = scored[0]!.play;
  return { type: 'play', instanceId: choice.instanceId, row: choice.row, col: choice.col, ...(choice.targetId ? { targetId: choice.targetId } : {}) };
}

export function advanceAI(content: RecoveredContent, state: BattleState, maxActions = 200): BattleState {
  integer(maxActions, 'Maximum AI actions', 0);
  let next = state;
  for (let count = 0; count < maxActions && next.status === 'playing'; count += 1) {
    const owner = activePlayer(next);
    if (!owner.ai) break;
    next = applyBattleAction(content, next, owner.id, chooseAIAction(content, next, owner.id));
  }
  return next;
}

export function publicBattle(state: BattleState, viewerId: string): unknown {
  const viewer = player(state, viewerId);
  const result = clone(state) as BattleState & { players: Array<BattlePlayer & { handCount?: number; drawPileCount?: number; deckCount?: number }> };
  result.players = result.players.map(candidate => {
    if (candidate.team === viewer.team) return candidate;
    const redacted = {
      ...candidate,
      handCount: candidate.hand.length,
      drawPileCount: candidate.drawPile.length,
      deckCount: candidate.deck.length,
      hand: [],
      drawPile: [],
      deck: [],
    };
    return redacted;
  });
  return result;
}
