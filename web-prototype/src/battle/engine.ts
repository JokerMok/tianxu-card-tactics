import { getCard } from '../data/cards';
import {
  ENEMY_DECK,
  ENEMY_PROFESSION,
  PLAYER_DECK,
  PLAYER_PROFESSION,
  validateDeck,
  validateDecks,
} from '../data/decks';
import { chooseSeeded, nextRandom, shuffleInPlace } from './rng';
import type {
  BattleEvent,
  BattleState,
  CardInstance,
  CardTarget,
  PlayResult,
  Side,
  Unit,
} from './types';

const OPENING_HAND_SIZE = 5;
const LANE_COUNT = 2;
const BOARD_CELLS = 12;
const SUMMON_DEPTH = 3;

export interface AdvanceRoundOptions {
  enemyAi?: boolean;
}

export interface BattleSetup {
  decks?: {
    player: readonly string[];
    enemy: readonly string[];
  };
  openingInitiative?: Side;
}

function cloneState(state: BattleState): BattleState {
  return structuredClone(state);
}

function otherSide(side: Side): Side {
  return side === 'player' ? 'enemy' : 'player';
}

function addEvent(
  state: BattleState,
  event: Omit<BattleEvent, 'id' | 'round' | 'turn'>,
): void {
  state.events.push({ ...event, id: state.nextEventId, round: state.round, turn: state.turn });
  state.nextEventId += 1;
  if (state.events.length > 140) state.events.splice(0, state.events.length - 140);
}

function drawOne(state: BattleState, side: Side): void {
  const cardId = state.decks[side].shift();
  if (!cardId) return;
  const card = getCard(cardId);
  state.hands[side].push({
    instanceId: `card-${state.nextId}`,
    cardId,
    remaining: card.prepare,
  });
  state.nextId += 1;
}

function drawOpeningHand(state: BattleState, side: Side): void {
  while (state.hands[side].length < OPENING_HAND_SIZE && state.decks[side].length > 0) {
    drawOne(state, side);
  }
}

export function createBattle(seed = 20260712, setup: BattleSetup = {}): BattleState {
  if (setup.decks) {
    validateDeck([...setup.decks.player], PLAYER_PROFESSION, '玩家牌组');
    validateDeck([...setup.decks.enemy], ENEMY_PROFESSION, '敌方牌组');
  } else {
    validateDecks();
  }
  const normalizedSeed = seed || 1;
  const decks = setup.decks ?? { player: PLAYER_DECK, enemy: ENEMY_DECK };
  const openingInitiative = setup.openingInitiative ?? (normalizedSeed % 2 === 0 ? 'player' : 'enemy');
  const state: BattleState = {
    seed: normalizedSeed,
    rngState: normalizedSeed,
    rngCursor: 0,
    round: 1,
    turn: 1,
    maxRounds: 80,
    laneCount: LANE_COUNT,
    cellsPerLane: BOARD_CELLS,
    summonDepth: SUMMON_DEPTH,
    openingInitiative,
    activeSide: openingInitiative,
    heroHp: { player: 30, enemy: 30 },
    heroMaxHp: { player: 30, enemy: 30 },
    decks: { player: [...decks.player], enemy: [...decks.enemy] },
    hands: { player: [], enemy: [] },
    graveyards: { player: [], enemy: [] },
    units: [],
    events: [],
    status: 'playing',
    nextId: 1,
    nextEventId: 1,
  };
  shuffleInPlace(state, state.decks.player);
  shuffleInPlace(state, state.decks.enemy);
  drawOpeningHand(state, 'player');
  drawOpeningHand(state, 'enemy');
  addEvent(state, { type: 'BATTLE_START', message: `战斗开始 · 种子 ${normalizedSeed}` });
  beginTurn(state, state.openingInitiative);
  return state;
}

function summonCells(side: Side): number[] {
  return side === 'player'
    ? Array.from({ length: SUMMON_DEPTH }, (_, index) => index)
    : Array.from({ length: SUMMON_DEPTH }, (_, index) => BOARD_CELLS - 1 - index);
}

function isCellOccupied(state: BattleState, lane: number, cell: number): boolean {
  return state.units.some((unit) => unit.hp > 0 && unit.lane === lane && unit.cell === cell);
}

function createUnit(state: BattleState, side: Side, cardId: string, lane: number, cell: number): Unit {
  const card = getCard(cardId);
  if (!card.unit) throw new Error(`Card ${cardId} has no unit definition.`);
  const definition = card.unit;
  const unit: Unit = {
    id: `unit-${state.nextId}`,
    cardId,
    name: card.shortName,
    side,
    lane,
    cell,
    hp: definition.maxHp,
    maxHp: definition.maxHp,
    attack: definition.attack,
    armor: definition.armor,
    move: definition.move,
    range: definition.range,
    role: definition.role,
    tags: [...(definition.tags ?? [])],
    heal: definition.heal ?? 0,
    burnOnHit: definition.burnOnHit ?? 0,
    knockbackOnHit: definition.knockbackOnHit ?? 0,
    firstMoveBonus: definition.firstMoveBonus ?? 0,
    stunOnHitChance: definition.stunOnHitChance ?? 0,
    enrageOnDamage: definition.enrageOnDamage ?? 0,
    enrageCap: definition.enrageCap ?? 0,
    enrageGained: 0,
    actionsTaken: 0,
    spawnRound: state.round,
    status: { burnDamage: 0, burnRounds: 0, freezeRounds: 0, stunRounds: 0, barrier: 0 },
  };
  state.nextId += 1;
  return unit;
}

function removeDead(state: BattleState): void {
  const dead = state.units.filter((unit) => unit.hp <= 0);
  for (const unit of dead) {
    addEvent(state, {
      type: 'UNIT_DIED',
      message: `${unit.name}倒下`,
      side: unit.side,
      sourceId: unit.id,
    });
  }
  state.units = state.units.filter((unit) => unit.hp > 0);
}

function checkOutcome(state: BattleState): void {
  if (state.status !== 'playing') return;
  if (state.heroHp.player <= 0 || state.heroHp.enemy <= 0) {
    const bothDefeated = state.heroHp.enemy <= 0 && state.heroHp.player <= 0;
    const playerWon = bothDefeated
      ? nextRandom(state) < 0.5
      : state.heroHp.enemy <= 0 && state.heroHp.player > 0;
    state.status = playerWon ? 'won' : 'lost';
    state.winner = playerWon ? 'player' : 'enemy';
    addEvent(state, {
      type: 'BATTLE_END',
      message: playerWon ? '敌方阵线崩溃' : '我方阵线失守',
      side: state.winner,
    });
  }
}

function damageUnit(
  state: BattleState,
  target: Unit,
  rawDamage: number,
  physical: boolean,
  sourceId?: string,
): number {
  let damage = physical ? Math.max(1, rawDamage - target.armor) : Math.max(1, rawDamage);
  if (target.status.barrier > 0) {
    const absorbed = Math.min(target.status.barrier, damage);
    target.status.barrier -= absorbed;
    damage -= absorbed;
  }
  target.hp = Math.max(0, target.hp - damage);
  addEvent(state, {
    type: 'DAMAGE',
    message: `${target.name}受到 ${damage} 点伤害`,
    side: target.side,
    sourceId,
    targetId: target.id,
    value: damage,
  });
  if (damage > 0 && target.hp > 0 && target.enrageOnDamage > 0 && target.enrageGained < target.enrageCap) {
    const gained = Math.min(target.enrageOnDamage, target.enrageCap - target.enrageGained);
    target.attack += gained;
    target.enrageGained += gained;
    addEvent(state, {
      type: 'STATUS_APPLIED',
      message: `${target.name}受击后攻击提升 ${gained} 点`,
      side: target.side,
      sourceId: target.id,
      targetId: target.id,
      value: gained,
    });
  }
  return damage;
}

function healUnit(state: BattleState, target: Unit, amount: number, sourceId?: string): number {
  const healed = Math.min(amount, target.maxHp - target.hp);
  if (healed <= 0) return 0;
  target.hp += healed;
  addEvent(state, {
    type: 'HEAL',
    message: `${target.name}恢复 ${healed} 点生命`,
    side: target.side,
    sourceId,
    targetId: target.id,
    value: healed,
  });
  return healed;
}

function damageHero(state: BattleState, side: Side, amount: number, sourceId?: string): void {
  const damage = Math.max(1, amount);
  state.heroHp[side] = Math.max(0, state.heroHp[side] - damage);
  addEvent(state, {
    type: 'HERO_DAMAGED',
    message: `${side === 'player' ? '我方' : '敌方'}英雄受到 ${damage} 点伤害`,
    side,
    sourceId,
    value: damage,
  });
  checkOutcome(state);
}

function knockbackFromSide(
  state: BattleState,
  sourceSide: Side,
  target: Unit,
  amount: number,
  sourceId?: string,
): void {
  const direction = sourceSide === 'player' ? 1 : -1;
  for (let step = 0; step < amount; step += 1) {
    const nextCell = target.cell + direction;
    if (nextCell < 0 || nextCell >= BOARD_CELLS) break;
    if (isCellOccupied(state, target.lane, nextCell)) break;
    target.cell = nextCell;
    addEvent(state, {
      type: 'UNIT_MOVED',
      message: `${target.name}被击退`,
      side: target.side,
      sourceId,
      targetId: target.id,
    });
  }
}

function reject(state: BattleState, reason: string): PlayResult {
  addEvent(state, { type: 'ACTION_REJECTED', message: reason });
  return { state, played: false, reason };
}

function resolveSkill(
  state: BattleState,
  side: Side,
  card: CardInstance,
  target: CardTarget,
): boolean {
  const definition = getCard(card.cardId);
  const skill = definition.skill;
  if (!skill) return false;
  const enemy = otherSide(side);

  if (skill.targetType === 'global') {
    const candidates = state.hands[side]
      .filter((item) => item.instanceId !== card.instanceId && item.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining || a.instanceId.localeCompare(b.instanceId));
    const reduction = skill.prepareReduction;
    if (!reduction || candidates.length === 0) return false;
    for (const item of candidates.slice(0, reduction.count)) {
      item.remaining = Math.max(0, item.remaining - reduction.value);
    }
    addEvent(state, {
      type: 'PREPARE_CHANGED',
      message: `${definition.name}加速了准备栏`,
      side,
      sourceId: card.instanceId,
    });
    return true;
  }

  if (skill.targetType === 'lane') {
    if (target.kind !== 'lane' || target.lane < 0 || target.lane >= LANE_COUNT) return false;
    const targets = state.units
      .filter((unit) => unit.side === enemy && unit.lane === target.lane)
      .sort((a, b) => side === 'player' ? b.cell - a.cell : a.cell - b.cell);
    if (targets.length === 0) return false;
    for (const unit of targets) {
      if (skill.freezeRounds) {
        unit.status.freezeRounds = Math.max(unit.status.freezeRounds, skill.freezeRounds);
      }
      if (skill.damage) damageUnit(state, unit, skill.damage, false, card.instanceId);
      if (skill.knockback && unit.hp > 0) {
        knockbackFromSide(state, side, unit, skill.knockback, card.instanceId);
      }
    }
    addEvent(state, {
      type: 'STATUS_APPLIED',
      message: `${definition.name}覆盖第 ${target.lane + 1} 路`,
      side,
      sourceId: card.instanceId,
    });
    removeDead(state);
    return true;
  }

  if (target.kind !== 'unit') return false;
  const unit = state.units.find((candidate) => candidate.id === target.unitId && candidate.hp > 0);
  if (!unit) return false;
  if (skill.targetType === 'enemy-unit' && unit.side !== enemy) return false;
  if (skill.targetType === 'ally-unit' && unit.side !== side) return false;
  if (skill.heal && unit.hp >= unit.maxHp) return false;

  if (skill.damage) damageUnit(state, unit, skill.damage, false, card.instanceId);
  if (skill.heal) healUnit(state, unit, skill.heal, card.instanceId);
  if (skill.barrier) unit.status.barrier = Math.max(unit.status.barrier, skill.barrier);
  if (skill.burn && unit.hp > 0) {
    unit.status.burnDamage += skill.burn.damage;
    unit.status.burnRounds = Math.max(unit.status.burnRounds, skill.burn.rounds);
  }
  removeDead(state);
  return true;
}

export function playCard(
  original: BattleState,
  side: Side,
  instanceId: string,
  target: CardTarget,
): PlayResult {
  const state = cloneState(original);
  if (state.status !== 'playing') return reject(state, '战斗已经结束');
  if (state.activeSide !== side) return reject(state, '当前不是该阵营的行动回合');
  const cardIndex = state.hands[side].findIndex((card) => card.instanceId === instanceId);
  if (cardIndex < 0) return reject(state, '卡牌不在准备栏');
  const instance = state.hands[side][cardIndex];
  if (instance.remaining > 0) return reject(state, '卡牌尚未准备完成');
  const definition = getCard(instance.cardId);

  let resolved = false;
  if (definition.kind === 'unit') {
    if (
      target.kind !== 'cell'
      || target.lane < 0
      || target.lane >= LANE_COUNT
      || !summonCells(side).includes(target.cell)
    ) {
      return reject(state, '请选择己方召唤区域内的合法格子');
    }
    if (isCellOccupied(state, target.lane, target.cell)) {
      return reject(state, '该召唤格已经被占用');
    }
    const unit = createUnit(state, side, instance.cardId, target.lane, target.cell);
    state.units.push(unit);
    addEvent(state, {
      type: 'UNIT_SPAWNED',
      message: `${definition.name}进入第 ${target.lane + 1} 路`,
      side,
      sourceId: instance.instanceId,
      targetId: unit.id,
    });
    resolved = true;
  } else {
    resolved = resolveSkill(state, side, instance, target);
  }

  if (!resolved) return reject(state, '当前目标无效');
  state.hands[side].splice(cardIndex, 1);
  state.graveyards[side].push(instance.cardId);
  addEvent(state, {
    type: 'CARD_PLAYED',
    message: `${side === 'player' ? '我方' : '敌方'}使用 ${definition.name}`,
    side,
    sourceId: instance.instanceId,
  });
  checkOutcome(state);
  return { state, played: true };
}

export function moveUnitForParity(original: BattleState, unitId: string, steps?: number): BattleState {
  const state = cloneState(original);
  if (state.status !== 'playing') return reject(state, '战斗已经结束').state;
  const unit = state.units.find((candidate) => candidate.id === unitId && candidate.hp > 0);
  if (!unit) return reject(state, `单位不存在: ${unitId}`).state;
  if (unit.side !== state.activeSide) return reject(state, `当前不是该阵营的行动回合: ${unitId}`).state;
  const beforeCell = unit.cell;
  moveUnit(state, unit, steps, false);
  addEvent(state, {
    type: 'UNIT_MOVED',
    message: unit.cell === beforeCell ? `${unit.name}移动受阻` : `${unit.name}推进至 ${unit.cell + 1} 格`,
    side: unit.side,
    sourceId: unit.id,
  });
  if (unit.cell !== beforeCell) unit.actionsTaken += 1;
  return state;
}

export function attackUnitForParity(original: BattleState, attackerId: string): BattleState {
  const state = cloneState(original);
  if (state.status !== 'playing') return reject(state, '战斗已经结束').state;
  const attacker = state.units.find((candidate) => candidate.id === attackerId && candidate.hp > 0);
  if (!attacker) return reject(state, `单位不存在: ${attackerId}`).state;
  if (attacker.side !== state.activeSide) return reject(state, `当前不是该阵营的行动回合: ${attackerId}`).state;
  const target = findTarget(state, attacker);
  if (target) {
    attackUnit(state, attacker, target);
  } else if (heroDistance(attacker) <= attacker.range) {
    const targetSide = otherSide(attacker.side);
    const damage = Math.max(1, attacker.attack);
    addEvent(state, {
      type: 'ATTACK',
      message: `${attacker.name}攻击${targetSide === 'player' ? '我方' : '敌方'}英雄`,
      side: attacker.side,
      sourceId: attacker.id,
      targetId: targetSide,
    });
    state.heroHp[targetSide] = Math.max(0, state.heroHp[targetSide] - damage);
    addEvent(state, {
      type: 'DAMAGE',
      message: `${targetSide === 'player' ? '我方' : '敌方'}英雄受到 ${damage} 点伤害`,
      side: targetSide,
      sourceId: attacker.id,
      targetId: targetSide,
      value: damage,
    });
    checkOutcome(state);
  } else {
    return reject(state, `单位没有合法目标: ${attackerId}`).state;
  }
  attacker.actionsTaken += 1;
  return state;
}

function decrementPreparation(state: BattleState, side: Side): void {
  for (const card of state.hands[side]) {
    const before = card.remaining;
    card.remaining = Math.max(0, card.remaining - 1);
    if (before > 0 && card.remaining === 0) {
      addEvent(state, {
        type: 'CARD_READY',
        message: `${side === 'player' ? '我方' : '敌方'}卡牌准备完成`,
        side,
        sourceId: card.instanceId,
      });
    }
  }
}

function beginTurn(state: BattleState, side: Side): void {
  state.activeSide = side;
  addEvent(state, {
    type: 'TURN_START',
    message: `${side === 'player' ? '我方' : '敌方'}行动回合开始`,
    side,
  });
  decrementPreparation(state, side);
}

function tickBurn(state: BattleState, side: Side): void {
  for (const unit of state.units.filter((candidate) => candidate.side === side)) {
    if (unit.status.burnRounds > 0 && unit.status.burnDamage > 0) {
      damageUnit(state, unit, unit.status.burnDamage, false);
      unit.status.burnRounds -= 1;
      if (unit.status.burnRounds <= 0) unit.status.burnDamage = 0;
    }
  }
  removeDead(state);
}

function forwardDistance(attacker: Unit, target: Unit): number {
  return attacker.side === 'player' ? target.cell - attacker.cell : attacker.cell - target.cell;
}

function findTarget(state: BattleState, attacker: Unit): Unit | undefined {
  return state.units
    .filter((target) => (
      target.side !== attacker.side
      && target.lane === attacker.lane
      && target.hp > 0
      && forwardDistance(attacker, target) > 0
      && forwardDistance(attacker, target) <= attacker.range
    ))
    .sort((a, b) => (
      forwardDistance(attacker, a) - forwardDistance(attacker, b)
      || a.hp - b.hp
      || a.id.localeCompare(b.id)
    ))[0];
}

function heroDistance(unit: Unit): number {
  return unit.side === 'player' ? BOARD_CELLS - unit.cell : unit.cell + 1;
}

function attackUnit(state: BattleState, attacker: Unit, target: Unit): void {
  let rawDamage = attacker.attack;
  if (attacker.tags.includes('anti-fast') && target.tags.includes('fast')) rawDamage += 2;
  damageUnit(state, target, rawDamage, true, attacker.id);
  addEvent(state, {
    type: 'ATTACK',
    message: `${attacker.name}攻击 ${target.name}`,
    side: attacker.side,
    sourceId: attacker.id,
    targetId: target.id,
  });
  if (target.hp > 0 && attacker.burnOnHit > 0) {
    target.status.burnDamage += attacker.burnOnHit;
    target.status.burnRounds = Math.max(target.status.burnRounds, 2);
  }
  if (target.hp > 0 && attacker.knockbackOnHit > 0) {
    knockbackFromSide(state, attacker.side, target, attacker.knockbackOnHit, attacker.id);
  }
  if (target.hp > 0 && attacker.stunOnHitChance > 0 && nextRandom(state) < attacker.stunOnHitChance / 10000) {
    target.status.stunRounds = Math.max(target.status.stunRounds, 1);
    addEvent(state, {
      type: 'STATUS_APPLIED',
      message: `${attacker.name}使${target.name}眩晕`,
      side: attacker.side,
      sourceId: attacker.id,
      targetId: target.id,
    });
  }
  removeDead(state);
}

function tryAttack(state: BattleState, unit: Unit): boolean {
  const target = findTarget(state, unit);
  if (target) {
    attackUnit(state, unit, target);
    return true;
  }
  if (heroDistance(unit) <= unit.range) {
    damageHero(state, otherSide(unit.side), unit.attack, unit.id);
    return true;
  }
  return false;
}

function moveUnit(state: BattleState, unit: Unit, requestedSteps?: number, emitEvents = true): void {
  const direction = unit.side === 'player' ? 1 : -1;
  const distance = requestedSteps ?? unit.move + (unit.actionsTaken === 0 ? unit.firstMoveBonus : 0);
  for (let step = 0; step < distance; step += 1) {
    const nextCell = unit.cell + direction;
    if (nextCell < 0 || nextCell >= BOARD_CELLS) break;
    if (isCellOccupied(state, unit.lane, nextCell)) break;
    unit.cell = nextCell;
    if (emitEvents) {
      addEvent(state, {
        type: 'UNIT_MOVED',
        message: `${unit.name}推进至 ${unit.cell + 1} 格`,
        side: unit.side,
        sourceId: unit.id,
      });
    }
  }
}

function healAfterAction(state: BattleState, unit: Unit): void {
  if (unit.heal <= 0 || unit.hp <= 0) return;
  const target = state.units
    .filter((candidate) => (
      candidate.side === unit.side
      && candidate.lane === unit.lane
      && candidate.hp > 0
      && candidate.hp < candidate.maxHp
    ))
    .sort((a, b) => (
      (b.maxHp - b.hp) - (a.maxHp - a.hp)
      || a.id.localeCompare(b.id)
    ))[0];
  if (target) healUnit(state, target, unit.heal, unit.id);
}

function actUnit(state: BattleState, unitId: string): void {
  const unit = state.units.find((candidate) => candidate.id === unitId && candidate.hp > 0);
  if (!unit || state.status !== 'playing') return;
  if (unit.status.stunRounds > 0) {
    unit.status.stunRounds -= 1;
    unit.actionsTaken += 1;
    addEvent(state, {
      type: 'ACTION_SKIPPED',
      message: `${unit.name}因眩晕跳过行动`,
      side: unit.side,
      sourceId: unit.id,
    });
    return;
  }
  const frozen = unit.status.freezeRounds > 0;
  const attacked = tryAttack(state, unit);
  if (!attacked && !frozen && state.status === 'playing') {
    moveUnit(state, unit);
    tryAttack(state, unit);
  }
  healAfterAction(state, unit);
  if (frozen) unit.status.freezeRounds = Math.max(0, unit.status.freezeRounds - 1);
  unit.actionsTaken += 1;
}

function actionOrder(state: BattleState, side: Side): string[] {
  const direction = side === 'player' ? -1 : 1;
  return state.units
    .filter((unit) => unit.side === side && unit.hp > 0)
    .sort((a, b) => (
      a.lane - b.lane
      || direction * (a.cell - b.cell)
      || a.id.localeCompare(b.id)
    ))
    .map((unit) => unit.id);
}

function lanePressure(state: BattleState, lane: number): number {
  const players = state.units.filter((unit) => unit.side === 'player' && unit.lane === lane);
  const enemies = state.units.filter((unit) => unit.side === 'enemy' && unit.lane === lane);
  const playerAttack = players.reduce((sum, unit) => sum + unit.attack, 0);
  const playerHp = players.reduce((sum, unit) => sum + unit.hp, 0);
  const enemyAttack = enemies.reduce((sum, unit) => sum + unit.attack, 0);
  const enemyHp = enemies.reduce((sum, unit) => sum + unit.hp, 0);
  const playerAdvance = players.reduce((sum, unit) => sum + unit.cell, 0);
  return playerAttack * 2 + playerHp + playerAdvance * 2
    - enemyAttack * 2 - enemyHp;
}

function chooseEnemyLane(state: BattleState, cardId: string): number | undefined {
  const definition = getCard(cardId);
  const legal = Array.from({ length: LANE_COUNT }, (_, lane) => lane)
    .filter((lane) => summonCells('enemy').some((cell) => !isCellOccupied(state, lane, cell)));
  if (legal.length === 0) return undefined;
  if (definition.unit?.tags?.includes('fast')) {
    const openPlayerLanes = legal.filter((lane) => !state.units.some((unit) => unit.side === 'player' && unit.lane === lane));
    if (openPlayerLanes.length > 0) return chooseSeeded(state, openPlayerLanes);
  }
  const scored = legal.map((lane) => ({ lane, score: lanePressure(state, lane) }));
  const max = Math.max(...scored.map((item) => item.score));
  return chooseSeeded(state, scored.filter((item) => item.score === max).map((item) => item.lane));
}

function choosePlayerLane(state: BattleState, cardId: string): number | undefined {
  const definition = getCard(cardId);
  const legal = Array.from(new Set(getLegalDeploymentCells(state, 'player').map(({ lane }) => lane)));
  if (legal.length === 0) return undefined;
  if (definition.unit?.tags?.includes('fast')) {
    const openEnemyLanes = legal.filter((lane) => !state.units.some((unit) => unit.side === 'enemy' && unit.lane === lane));
    if (openEnemyLanes.length > 0) return chooseSeeded(state, openEnemyLanes);
  }
  const scored = legal.map((lane) => ({ lane, score: lanePressure(state, lane) }));
  const min = Math.min(...scored.map((item) => item.score));
  return chooseSeeded(state, scored.filter((item) => item.score === min).map((item) => item.lane));
}

function runPlayerAutoUnit(original: BattleState): BattleState {
  const ready = original.hands.player
    .filter((card) => card.remaining === 0 && getCard(card.cardId).kind === 'unit')
    .sort((a, b) => {
      const left = getCard(a.cardId).unit!;
      const right = getCard(b.cardId).unit!;
      return (right.attack * 2 + right.maxHp + right.armor * 2)
        - (left.attack * 2 + left.maxHp + left.armor * 2);
    });
  for (const card of ready) {
    const lane = choosePlayerLane(original, card.cardId);
    if (lane === undefined) continue;
    const role = getCard(card.cardId).unit!.role;
    const preferredCells = role === 'ranged' || role === 'healer'
      ? summonCells('player')
      : [...summonCells('player')].reverse();
    const cell = preferredCells.find((value) => !isCellOccupied(original, lane, value));
    if (cell !== undefined) {
      return playCard(original, 'player', card.instanceId, { kind: 'cell', lane, cell }).state;
    }
  }
  return original;
}

function runPlayerAutoSkill(original: BattleState): BattleState {
  const ready = original.hands.player.filter((card) => card.remaining === 0);
  const damageCard = ready.find((card) => card.cardId === 'S001');
  if (damageCard) {
    const lethal = original.units
      .filter((unit) => unit.side === 'enemy' && unit.hp <= 4)
      .sort((a, b) => b.attack - a.attack || a.hp - b.hp || a.id.localeCompare(b.id))[0];
    if (lethal) return playCard(original, 'player', damageCard.instanceId, { kind: 'unit', unitId: lethal.id }).state;
  }

  const laneTargets = Array.from({ length: LANE_COUNT }, (_, lane) => ({
    lane,
    units: original.units.filter((unit) => unit.side === 'enemy' && unit.lane === lane),
  }))
    .filter(({ units }) => units.length >= 2)
    .sort((a, b) => b.units.length - a.units.length
      || b.units.reduce((sum, unit) => sum + unit.attack, 0) - a.units.reduce((sum, unit) => sum + unit.attack, 0)
      || a.lane - b.lane);
  const targetLane = laneTargets[0]?.lane;
  if (targetLane !== undefined) {
    const areaCard = ready.find((card) => card.cardId === 'S003');
    if (areaCard) return playCard(original, 'player', areaCard.instanceId, { kind: 'lane', lane: targetLane }).state;
    const freezeCard = ready.find((card) => card.cardId === 'S002');
    if (freezeCard) return playCard(original, 'player', freezeCard.instanceId, { kind: 'lane', lane: targetLane }).state;
  }
  return original;
}

function runEnemySkill(original: BattleState): BattleState {
  let state = original;
  const ready = state.hands.enemy.filter((card) => card.remaining === 0);
  if (ready.length === 0) return state;

  const damageCard = ready.find((card) => card.cardId === 'S001');
  if (damageCard) {
    const lethal = state.units
      .filter((unit) => unit.side === 'player' && unit.hp <= 4)
      .sort((a, b) => b.attack - a.attack || a.hp - b.hp)[0];
    if (lethal) return playCard(state, 'enemy', damageCard.instanceId, { kind: 'unit', unitId: lethal.id }).state;
  }

  const healCard = ready.find((card) => card.cardId === 'S007');
  if (healCard) {
    const injured = state.units
      .filter((unit) => unit.side === 'enemy' && unit.maxHp - unit.hp >= 3)
      .sort((a, b) => (b.maxHp - b.hp) - (a.maxHp - a.hp))[0];
    if (injured) return playCard(state, 'enemy', healCard.instanceId, { kind: 'unit', unitId: injured.id }).state;
  }

  const freezeCard = ready.find((card) => card.cardId === 'S002');
  if (freezeCard) {
    const lane = Array.from({ length: LANE_COUNT }, (_, value) => value)
      .map((value) => ({ value, count: state.units.filter((unit) => unit.side === 'player' && unit.lane === value).length }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)[0]?.value;
    if (lane !== undefined) return playCard(state, 'enemy', freezeCard.instanceId, { kind: 'lane', lane }).state;
  }

  const areaCard = ready.find((card) => card.cardId === 'S003');
  if (areaCard) {
    const lane = Array.from({ length: LANE_COUNT }, (_, value) => value)
      .map((value) => ({ value, count: state.units.filter((unit) => unit.side === 'player' && unit.lane === value).length }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.value - b.value)[0]?.value;
    if (lane !== undefined) return playCard(state, 'enemy', areaCard.instanceId, { kind: 'lane', lane }).state;
  }

  const barrierCard = ready.find((card) => card.cardId === 'S006');
  if (barrierCard) {
    const ally = state.units.filter((unit) => unit.side === 'enemy').sort((a, b) => b.attack - a.attack)[0];
    if (ally) return playCard(state, 'enemy', barrierCard.instanceId, { kind: 'unit', unitId: ally.id }).state;
  }

  const recovery = ready.find((card) => card.cardId === 'S009');
  if (recovery) return playCard(state, 'enemy', recovery.instanceId, { kind: 'global' }).state;

  if (damageCard) {
    const target = state.units
      .filter((unit) => unit.side === 'player')
      .sort((a, b) => b.attack - a.attack || a.hp - b.hp || a.id.localeCompare(b.id))[0];
    if (target) return playCard(state, 'enemy', damageCard.instanceId, { kind: 'unit', unitId: target.id }).state;
  }
  return state;
}

function runEnemyUnit(original: BattleState): BattleState {
  const ready = original.hands.enemy
    .filter((card) => card.remaining === 0 && getCard(card.cardId).kind === 'unit')
    .sort((a, b) => {
      const left = getCard(a.cardId).unit!;
      const right = getCard(b.cardId).unit!;
      return (right.attack * 2 + right.maxHp + right.armor * 2)
        - (left.attack * 2 + left.maxHp + left.armor * 2);
    });
  if (ready.length === 0) return original;
  for (const card of ready) {
    const lane = chooseEnemyLane(original, card.cardId);
    if (lane !== undefined) {
      const role = getCard(card.cardId).unit!.role;
      const preferredCells = role === 'ranged' || role === 'healer'
        ? summonCells('enemy')
        : [...summonCells('enemy')].reverse();
      const cell = preferredCells.find((value) => !isCellOccupied(original, lane, value));
      if (cell !== undefined) {
        return playCard(original, 'enemy', card.instanceId, { kind: 'cell', lane, cell }).state;
      }
    }
  }
  return original;
}

function resetUnusedReadyCards(state: BattleState, side: Side): void {
  for (const card of state.hands[side]) {
    if (card.remaining !== 0) continue;
    card.remaining = Math.floor(getCard(card.cardId).prepare / 2);
    addEvent(state, {
      type: 'PREPARE_CHANGED',
      message: `${getCard(card.cardId).name}未使用，准备值恢复至 ${card.remaining}`,
      side,
      sourceId: card.instanceId,
      value: card.remaining,
    });
  }
}

function settleRoundLimit(state: BattleState): void {
  const playerWon = state.heroHp.player === state.heroHp.enemy
    ? nextRandom(state) < 0.5
    : state.heroHp.player > state.heroHp.enemy;
  state.status = playerWon ? 'won' : 'lost';
  state.winner = playerWon ? 'player' : 'enemy';
  addEvent(state, {
    type: 'BATTLE_END',
    message: playerWon ? '回合上限 · 我方生命领先' : '回合上限 · 我方未能取胜',
    side: state.winner,
  });
}

export function endTurn(original: BattleState, side: Side): BattleState {
  if (original.status !== 'playing' || original.activeSide !== side) return original;
  let state = cloneState(original);
  resetUnusedReadyCards(state, side);
  drawOne(state, side);
  addEvent(state, {
    type: 'TURN_END',
    message: `${side === 'player' ? '我方' : '敌方'}结束出牌`,
    side,
  });

  tickBurn(state, side);
  checkOutcome(state);
  if (state.status !== 'playing') return state;
  for (const unitId of actionOrder(state, side)) {
    actUnit(state, unitId);
    if (state.status !== 'playing') return state;
  }
  removeDead(state);

  const nextSide = otherSide(side);
  const roundCompleted = nextSide === state.openingInitiative;
  if (roundCompleted && state.round >= state.maxRounds) {
    settleRoundLimit(state);
    return state;
  }
  if (roundCompleted) state.round += 1;
  state.turn += 1;
  beginTurn(state, nextSide);
  return state;
}

export function surrenderBattle(original: BattleState, side: Side = 'player'): BattleState {
  if (original.status !== 'playing') return original;
  const state = cloneState(original);
  state.status = side === 'player' ? 'lost' : 'won';
  state.winner = otherSide(side);
  addEvent(state, {
    type: 'BATTLE_END',
    message: `${side === 'player' ? '我方' : '敌方'}选择投降`,
    side: state.winner,
  });
  return state;
}

export function runEnemyTurn(original: BattleState): BattleState {
  if (original.status !== 'playing' || original.activeSide !== 'enemy') return original;
  let state = original;
  const safetyLimit = state.hands.enemy.length + 1;
  for (let index = 0; index < safetyLimit && state.status === 'playing'; index += 1) {
    const before = state.hands.enemy.length;
    state = runEnemySkill(state);
    state = runEnemyUnit(state);
    if (state.hands.enemy.length === before) break;
  }
  return endTurn(state, 'enemy');
}

export function runPlayerAutoAction(original: BattleState): BattleState {
  if (original.status !== 'playing' || original.activeSide !== 'player') return original;
  const afterUnit = runPlayerAutoUnit(original);
  if (afterUnit !== original) return afterUnit;
  const afterSkill = runPlayerAutoSkill(original);
  if (afterSkill !== original) return afterSkill;
  return endTurn(original, 'player');
}

export function advanceRound(original: BattleState, options: AdvanceRoundOptions = {}): BattleState {
  if (original.activeSide === 'enemy' && options.enemyAi !== false) return runEnemyTurn(original);
  return endTurn(original, original.activeSide);
}

export function getLegalLanes(state: BattleState, side: Side, cardId: string): number[] {
  const definition = getCard(cardId);
  if (definition.kind === 'unit') {
    return [...new Set(getLegalDeploymentCells(state, side).map((target) => target.lane))];
  }
  if (definition.skill?.targetType === 'lane') {
    const enemy = otherSide(side);
    return Array.from({ length: LANE_COUNT }, (_, lane) => lane)
      .filter((lane) => state.units.some((unit) => unit.side === enemy && unit.lane === lane));
  }
  return [];
}

export function getLegalDeploymentCells(state: BattleState, side: Side): Array<{ lane: number; cell: number }> {
  return Array.from({ length: LANE_COUNT }, (_, lane) => lane)
    .flatMap((lane) => summonCells(side).map((cell) => ({ lane, cell })))
    .filter(({ lane, cell }) => !isCellOccupied(state, lane, cell));
}

export function getLegalUnitIds(state: BattleState, side: Side, cardId: string): string[] {
  const skill = getCard(cardId).skill;
  if (!skill) return [];
  if (skill.targetType === 'enemy-unit') {
    return state.units.filter((unit) => unit.side !== side && unit.hp > 0).map((unit) => unit.id);
  }
  if (skill.targetType === 'ally-unit') {
    return state.units
      .filter((unit) => (
        unit.side === side
        && unit.hp > 0
        && (!skill.heal || unit.hp < unit.maxHp)
      ))
      .map((unit) => unit.id);
  }
  return [];
}

export function canPlayCard(state: BattleState, side: Side, card: CardInstance): boolean {
  if (state.status !== 'playing' || state.activeSide !== side || card.remaining > 0) return false;
  const definition = getCard(card.cardId);
  if (definition.kind === 'unit') {
    return getLegalDeploymentCells(state, side).length > 0;
  }
  if (definition.skill?.targetType === 'lane') {
    return getLegalLanes(state, side, card.cardId).length > 0;
  }
  if (definition.skill?.targetType === 'enemy-unit' || definition.skill?.targetType === 'ally-unit') {
    return getLegalUnitIds(state, side, card.cardId).length > 0;
  }
  if (definition.skill?.targetType === 'global') {
    return state.hands[side].some((item) => item.instanceId !== card.instanceId && item.remaining > 0);
  }
  return false;
}

export function getHandCard(state: BattleState, side: Side, instanceId: string): CardInstance | undefined {
  return state.hands[side].find((card) => card.instanceId === instanceId);
}
