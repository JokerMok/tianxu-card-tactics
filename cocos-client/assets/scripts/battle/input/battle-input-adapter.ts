import type { BattleState, CardInstance, Side } from '../../core/types/index.ts';

export type BattleInputCardKind = 'unit' | 'skill';
export type BattleInputTargetType = 'cell' | 'lane' | 'unit' | 'global';
export type BattleInputSkillTargetType = 'lane' | 'enemy-unit' | 'ally-unit' | 'global';

export type BattleInputTarget =
  | { readonly kind: 'cell'; readonly lane: number; readonly cell: number }
  | { readonly kind: 'lane'; readonly lane: number }
  | { readonly kind: 'unit'; readonly unitId: string }
  | { readonly kind: 'global' };

export interface BattleInputCardDefinition {
  readonly kind: BattleInputCardKind;
  readonly targetType?: BattleInputSkillTargetType;
  /** Optional range is measured in Manhattan lane/cell distance from sourceUnitId. */
  readonly range?: number;
  readonly sourceUnitId?: string;
  /** A definition may further reduce candidates; it cannot add state that is absent. */
  readonly canTarget?: (state: BattleState, target: BattleInputTarget, side: Side) => boolean;
  /** Ally skills normally omit full-health units when this is true. */
  readonly requiresDamagedAlly?: boolean;
};

export type BattleInputAction =
  | { readonly type: 'DEPLOY_UNIT'; readonly cardId: string; readonly side: Side; readonly lane: number; readonly cell: number }
  | { readonly type: 'PLAY_CARD'; readonly cardId: string; readonly side: Side; readonly target: BattleInputTarget };

export interface BattleInputSnapshot {
  readonly state: BattleState;
}

export interface BattleInputSession {
  readonly snapshot: BattleInputSnapshot | BattleState;
  readonly dispatch?: (action: BattleInputAction) => unknown;
}

export interface BattleInputAdapterOptions {
  readonly session?: BattleInputSession;
  readonly controller?: BattleInputSession;
  readonly side?: Side;
  readonly resolveCard: (cardId: string) => BattleInputCardDefinition | undefined;
}

export type BattleInputErrorCode =
  | 'OK'
  | 'INVALID_INPUT'
  | 'BATTLE_NOT_PLAYING'
  | 'WRONG_ACTIVE_SIDE'
  | 'CARD_NOT_IN_HAND'
  | 'CARD_NOT_READY'
  | 'CARD_DEFINITION_MISSING'
  | 'CARD_NOT_PLAYABLE'
  | 'NO_CARD_SELECTED'
  | 'NO_LEGAL_TARGET'
  | 'TARGET_REQUIRED'
  | 'TARGET_TYPE_MISMATCH'
  | 'CELL_OUT_OF_BOUNDS'
  | 'NOT_SUMMON_CELL'
  | 'ENEMY_DEPLOYMENT_CELL'
  | 'CELL_OCCUPIED'
  | 'LANE_OUT_OF_BOUNDS'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_DEAD'
  | 'TARGET_SIDE_MISMATCH'
  | 'TARGET_NOT_AVAILABLE'
  | 'TARGET_OUT_OF_RANGE'
  | 'RANGE_SOURCE_MISSING'
  | 'COMMIT_REJECTED'
  | 'COMMIT_FAILED';

export interface BattleInputResult<T = undefined> {
  readonly ok: boolean;
  readonly accepted: boolean;
  readonly code: BattleInputErrorCode;
  readonly reason: string;
  readonly value?: T;
}

export interface BattleInputSelection {
  readonly cardInstanceId: string | null;
  readonly target: BattleInputTarget | null;
}

export interface BattleInputPreview {
  readonly cardInstanceId: string | null;
  readonly cardId: string | null;
  readonly kind: BattleInputCardKind | null;
  readonly targetType: BattleInputTargetType | null;
  readonly candidates: readonly BattleInputTarget[];
}

export interface BattleInputNodeLike {
  on?(event: string, callback: () => void, target?: unknown): unknown;
  off?(event: string, callback: () => void, target?: unknown): unknown;
  addEventListener?(event: string, callback: () => void): unknown;
  removeEventListener?(event: string, callback: () => void): unknown;
}

export const BATTLE_INPUT_EVENTS = Object.freeze({
  TOUCH_END: 'touch-end',
  TOUCH_CANCEL: 'touch-cancel',
  CLICK: 'click',
});

const PLAYER: Side = 'player';
const ENEMY: Side = 'enemy';
const OTHER_SIDE: Readonly<Record<Side, Side>> = Object.freeze({ player: ENEMY, enemy: PLAYER });

function freezeTarget(target: BattleInputTarget): BattleInputTarget {
  return Object.freeze({ ...target });
}

function freezeTargets(targets: readonly BattleInputTarget[]): readonly BattleInputTarget[] {
  return Object.freeze(targets.map(freezeTarget));
}

function freezeSelection(cardInstanceId: string | null, target: BattleInputTarget | null): BattleInputSelection {
  return Object.freeze({
    cardInstanceId,
    target: target ? freezeTarget(target) : null,
  });
}

function success<T>(value?: T): BattleInputResult<T> {
  return Object.freeze({ ok: true, accepted: true, code: 'OK' as const, reason: '', ...(value === undefined ? {} : { value }) });
}

function failure<T = undefined>(code: BattleInputErrorCode, reason: string): BattleInputResult<T> {
  return Object.freeze({ ok: false, accepted: false, code, reason });
}

function isSide(value: unknown): value is Side {
  return value === PLAYER || value === ENEMY;
}

function isSafeIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isTarget(value: unknown): value is BattleInputTarget {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  if (target.kind === 'global') return Object.keys(target).length === 1;
  if (target.kind === 'lane') return Object.keys(target).length === 2 && isSafeIndex(target.lane);
  if (target.kind === 'cell') {
    return Object.keys(target).length === 3 && isSafeIndex(target.lane) && isSafeIndex(target.cell);
  }
  return target.kind === 'unit'
    && Object.keys(target).length === 2
    && typeof target.unitId === 'string'
    && target.unitId.length > 0;
}

function sameTarget(left: BattleInputTarget, right: BattleInputTarget): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'global' && right.kind === 'global') return true;
  if (left.kind === 'lane' && right.kind === 'lane') return left.lane === right.lane;
  if (left.kind === 'cell' && right.kind === 'cell') return left.lane === right.lane && left.cell === right.cell;
  return left.kind === 'unit' && right.kind === 'unit' && left.unitId === right.unitId;
}

function stateFrom(session: BattleInputSession): BattleState {
  const snapshot = session.snapshot;
  if (snapshot && 'state' in snapshot) return snapshot.state;
  return snapshot as BattleState;
}

function isLivingUnit(unit: BattleState['units'][number]): boolean {
  return unit.hp > 0;
}

function isInsideBoard(state: BattleState, lane: number, cell?: number): boolean {
  if (!isSafeIndex(lane) || lane >= state.laneCount) return false;
  return cell === undefined || (isSafeIndex(cell) && cell < state.cellsPerLane);
}

function isEnemyZone(state: BattleState, side: Side, cell: number): boolean {
  return side === PLAYER
    ? cell >= state.cellsPerLane - state.summonDepth
    : cell < state.summonDepth;
}

function isSummonCell(state: BattleState, side: Side, cell: number): boolean {
  return side === PLAYER
    ? cell >= 0 && cell < state.summonDepth
    : cell >= state.cellsPerLane - state.summonDepth && cell < state.cellsPerLane;
}

function isOccupied(state: BattleState, lane: number, cell: number): boolean {
  return state.units.some((unit) => isLivingUnit(unit) && unit.lane === lane && unit.cell === cell);
}

function targetTypeFor(definition: BattleInputCardDefinition): BattleInputTargetType {
  if (definition.kind === 'unit') return 'cell';
  return definition.targetType === 'enemy-unit' || definition.targetType === 'ally-unit' ? 'unit' : definition.targetType ?? 'global';
}

function targetAllowedByRange(
  state: BattleState,
  definition: BattleInputCardDefinition,
  target: BattleInputTarget,
): BattleInputErrorCode | null {
  if (definition.range === undefined) return null;
  if (!Number.isSafeInteger(definition.range) || definition.range < 0) return 'TARGET_OUT_OF_RANGE';
  if (!definition.sourceUnitId) return 'RANGE_SOURCE_MISSING';
  const source = state.units.find((unit) => unit.id === definition.sourceUnitId && isLivingUnit(unit));
  if (!source) return 'RANGE_SOURCE_MISSING';
  if (target.kind === 'lane' || target.kind === 'global') return null;
  const candidate = target.kind === 'unit'
    ? state.units.find((unit) => unit.id === target.unitId && isLivingUnit(unit))
    : { lane: target.lane, cell: target.cell };
  if (!candidate) return 'TARGET_NOT_FOUND';
  return Math.abs(source.lane - candidate.lane) + Math.abs(source.cell - candidate.cell) <= definition.range
    ? null
    : 'TARGET_OUT_OF_RANGE';
}

function reasonFor(code: BattleInputErrorCode): string {
  const messages: Readonly<Record<BattleInputErrorCode, string>> = {
    OK: '',
    INVALID_INPUT: '输入格式无效',
    BATTLE_NOT_PLAYING: '战斗当前不可操作',
    WRONG_ACTIVE_SIDE: '当前不是该阵营的行动回合',
    CARD_NOT_IN_HAND: '卡牌不在当前手牌中',
    CARD_NOT_READY: '卡牌尚未准备完成',
    CARD_DEFINITION_MISSING: '卡牌定义不存在',
    CARD_NOT_PLAYABLE: '当前卡牌不可使用',
    NO_CARD_SELECTED: '请先选择卡牌',
    NO_LEGAL_TARGET: '当前没有合法目标',
    TARGET_REQUIRED: '请选择目标后确认',
    TARGET_TYPE_MISMATCH: '目标类型与卡牌不匹配',
    CELL_OUT_OF_BOUNDS: '部署格越界',
    NOT_SUMMON_CELL: '该格不在召唤区域内',
    ENEMY_DEPLOYMENT_CELL: '不能部署到敌方区域',
    CELL_OCCUPIED: '该部署格已被占用',
    LANE_OUT_OF_BOUNDS: '路线越界',
    TARGET_NOT_FOUND: '目标单位不存在',
    TARGET_DEAD: '目标单位已阵亡',
    TARGET_SIDE_MISMATCH: '目标阵营不符合卡牌要求',
    TARGET_NOT_AVAILABLE: '该目标当前不可用',
    TARGET_OUT_OF_RANGE: '目标超出技能范围',
    RANGE_SOURCE_MISSING: '技能范围缺少有效来源单位',
    COMMIT_REJECTED: '核心拒绝了该操作',
    COMMIT_FAILED: '提交操作失败',
  };
  return messages[code];
}

/**
 * Runtime-neutral input policy. It reads immutable session state, stages a target,
 * and delegates one validated action to the injected session/engine only on confirm.
 */
export class BattleInputAdapter {
  private readonly sessionValue: BattleInputSession;
  private readonly sideValue: Side;
  private readonly resolveCardValue: (cardId: string) => BattleInputCardDefinition | undefined;
  private cardInstanceIdValue: string | null = null;
  private targetValue: BattleInputTarget | null = null;

  constructor(options: BattleInputAdapterOptions) {
    const session = options?.session ?? options?.controller;
    if (!session || typeof options.resolveCard !== 'function') {
      throw new Error('battle input adapter requires a session and card resolver');
    }
    if (options.side !== undefined && !isSide(options.side)) throw new Error('battle input side must be player or enemy');
    this.sessionValue = session;
    this.sideValue = options.side ?? PLAYER;
    this.resolveCardValue = options.resolveCard;
  }

  get side(): Side { return this.sideValue; }

  get selection(): BattleInputSelection {
    return freezeSelection(this.cardInstanceIdValue, this.targetValue);
  }

  get preview(): BattleInputPreview {
    if (!this.cardInstanceIdValue) {
      return Object.freeze({ cardInstanceId: null, cardId: null, kind: null, targetType: null, candidates: Object.freeze([]) });
    }
    const state = stateFrom(this.sessionValue);
    const card = this.findCard(state, this.cardInstanceIdValue);
    const definition = card ? this.resolveCardValue(card.cardId) : undefined;
    const candidates = card && definition && this.isReadyState(state)
      ? this.candidates(state, card, definition).targets
      : [];
    return Object.freeze({
      cardInstanceId: this.cardInstanceIdValue,
      cardId: card?.cardId ?? null,
      kind: definition?.kind ?? null,
      targetType: definition ? targetTypeFor(definition) : null,
      candidates: freezeTargets(candidates),
    });
  }

  selectCard(cardInstanceId: string): BattleInputResult<BattleInputPreview> {
    if (typeof cardInstanceId !== 'string' || cardInstanceId.length === 0) return failure('INVALID_INPUT', reasonFor('INVALID_INPUT'));
    const state = stateFrom(this.sessionValue);
    const activeFailure = this.activeFailure(state);
    if (activeFailure) return failure(activeFailure, reasonFor(activeFailure));
    const card = this.findCard(state, cardInstanceId);
    if (!card) return failure('CARD_NOT_IN_HAND', reasonFor('CARD_NOT_IN_HAND'));
    if (card.remainingPreparation !== 0) return failure('CARD_NOT_READY', reasonFor('CARD_NOT_READY'));
    const definition = this.resolveCardValue(card.cardId);
    if (!definition) return failure('CARD_DEFINITION_MISSING', reasonFor('CARD_DEFINITION_MISSING'));
    const candidates = this.candidates(state, card, definition);
    if (candidates.error) return failure(candidates.error, reasonFor(candidates.error));
    if (candidates.targets.length === 0) return failure('NO_LEGAL_TARGET', reasonFor('NO_LEGAL_TARGET'));
    if (this.cardInstanceIdValue === cardInstanceId) return success(this.preview);
    this.cardInstanceIdValue = cardInstanceId;
    this.targetValue = null;
    return success(this.preview);
  }

  selectTarget(target: BattleInputTarget): BattleInputResult<BattleInputPreview> {
    if (!this.cardInstanceIdValue) return failure('NO_CARD_SELECTED', reasonFor('NO_CARD_SELECTED'));
    if (!isTarget(target)) return failure('INVALID_INPUT', reasonFor('INVALID_INPUT'));
    const state = stateFrom(this.sessionValue);
    const activeFailure = this.activeFailure(state);
    if (activeFailure) return failure(activeFailure, reasonFor(activeFailure));
    const card = this.findCard(state, this.cardInstanceIdValue);
    if (!card) return failure('CARD_NOT_IN_HAND', reasonFor('CARD_NOT_IN_HAND'));
    const definition = this.resolveCardValue(card.cardId);
    if (!definition) return failure('CARD_DEFINITION_MISSING', reasonFor('CARD_DEFINITION_MISSING'));
    const validation = this.validateTargetShape(state, definition, target);
    if (validation) return failure(validation, reasonFor(validation));
    const candidates = this.candidates(state, card, definition);
    if (candidates.error) return failure(candidates.error, reasonFor(candidates.error));
    if (!candidates.targets.some((candidate) => sameTarget(candidate, target))) {
      const unavailable = this.unavailableReason(state, definition, target);
      return failure(unavailable, reasonFor(unavailable));
    }
    this.targetValue = freezeTarget(target);
    return success(this.preview);
  }

  selectCell(lane: number, cell: number): BattleInputResult<BattleInputPreview> {
    return this.selectTarget({ kind: 'cell', lane, cell });
  }

  selectLane(lane: number): BattleInputResult<BattleInputPreview> {
    return this.selectTarget({ kind: 'lane', lane });
  }

  selectUnit(unitId: string): BattleInputResult<BattleInputPreview> {
    return this.selectTarget({ kind: 'unit', unitId });
  }

  cancel(): BattleInputResult<BattleInputSelection> {
    const previous = this.selection;
    this.cardInstanceIdValue = null;
    this.targetValue = null;
    return success(previous);
  }

  confirm(): BattleInputResult<BattleInputAction> {
    if (!this.cardInstanceIdValue) return failure('NO_CARD_SELECTED', reasonFor('NO_CARD_SELECTED'));
    if (!this.targetValue) return failure('TARGET_REQUIRED', reasonFor('TARGET_REQUIRED'));
    const state = stateFrom(this.sessionValue);
    const activeFailure = this.activeFailure(state);
    if (activeFailure) return failure(activeFailure, reasonFor(activeFailure));
    const card = this.findCard(state, this.cardInstanceIdValue);
    if (!card) return failure('CARD_NOT_IN_HAND', reasonFor('CARD_NOT_IN_HAND'));
    if (card.remainingPreparation !== 0) return failure('CARD_NOT_READY', reasonFor('CARD_NOT_READY'));
    const definition = this.resolveCardValue(card.cardId);
    if (!definition) return failure('CARD_DEFINITION_MISSING', reasonFor('CARD_DEFINITION_MISSING'));
    const validation = this.validateTargetShape(state, definition, this.targetValue);
    if (validation) return failure(validation, reasonFor(validation));
    const candidates = this.candidates(state, card, definition);
    if (candidates.error) return failure(candidates.error, reasonFor(candidates.error));
    if (!candidates.targets.some((candidate) => sameTarget(candidate, this.targetValue!))) {
      const unavailable = this.unavailableReason(state, definition, this.targetValue);
      return failure(unavailable, reasonFor(unavailable));
    }
    const action: BattleInputAction = definition.kind === 'unit'
      ? { type: 'DEPLOY_UNIT', cardId: card.cardId, side: this.sideValue, lane: (this.targetValue as Extract<BattleInputTarget, { kind: 'cell' }>).lane, cell: (this.targetValue as Extract<BattleInputTarget, { kind: 'cell' }>).cell }
      : { type: 'PLAY_CARD', cardId: card.cardId, side: this.sideValue, target: this.targetValue };
    const frozenAction = Object.freeze({ ...action });
    const dispatch = this.sessionValue.dispatch;
    if (typeof dispatch !== 'function') return failure('COMMIT_FAILED', reasonFor('COMMIT_FAILED'));
    let output: unknown;
    try {
      output = dispatch(frozenAction);
    } catch {
      return failure('COMMIT_FAILED', reasonFor('COMMIT_FAILED'));
    }
    if (output === false || (output !== null && typeof output === 'object' && 'ok' in output && (output as { ok?: unknown }).ok === false)) {
      return failure('COMMIT_REJECTED', reasonFor('COMMIT_REJECTED'));
    }
    this.cardInstanceIdValue = null;
    this.targetValue = null;
    return success(frozenAction);
  }

  bindCardNode(node: BattleInputNodeLike, cardInstanceId: string): () => void {
    return this.bind(node, () => { this.selectCard(cardInstanceId); });
  }

  bindCellNode(node: BattleInputNodeLike, lane: number, cell: number): () => void {
    return this.bind(node, () => { this.selectCell(lane, cell); });
  }

  bindLaneNode(node: BattleInputNodeLike, lane: number): () => void {
    return this.bind(node, () => { this.selectLane(lane); });
  }

  bindUnitNode(node: BattleInputNodeLike, unitId: string): () => void {
    return this.bind(node, () => { this.selectUnit(unitId); });
  }

  bindCancelNode(node: BattleInputNodeLike): () => void {
    return this.bind(node, () => { this.cancel(); });
  }

  bindConfirmNode(node: BattleInputNodeLike): () => void {
    return this.bind(node, () => { this.confirm(); });
  }

  private bind(node: BattleInputNodeLike, callback: () => void): () => void {
    if (!node || typeof callback !== 'function') throw new Error('a Node-like input target is required');
    if (typeof node.on === 'function') {
      node.on(BATTLE_INPUT_EVENTS.TOUCH_END, callback);
      return () => node.off?.(BATTLE_INPUT_EVENTS.TOUCH_END, callback);
    }
    if (typeof node.addEventListener === 'function') {
      node.addEventListener(BATTLE_INPUT_EVENTS.CLICK, callback);
      return () => node.removeEventListener?.(BATTLE_INPUT_EVENTS.CLICK, callback);
    }
    throw new Error('Node-like input target must provide on/off or addEventListener/removeEventListener');
  }

  private findCard(state: BattleState, instanceId: string): CardInstance | undefined {
    return state.hands[this.sideValue].find((card) => card.instanceId === instanceId);
  }

  private isReadyState(state: BattleState): boolean {
    return state.status === 'playing' && state.activeSide === this.sideValue;
  }

  private activeFailure(state: BattleState): BattleInputErrorCode | null {
    if (state.status !== 'playing') return 'BATTLE_NOT_PLAYING';
    if (state.activeSide !== this.sideValue) return 'WRONG_ACTIVE_SIDE';
    return null;
  }

  private candidates(
    state: BattleState,
    card: CardInstance,
    definition: BattleInputCardDefinition,
  ): { readonly targets: readonly BattleInputTarget[]; readonly error?: BattleInputErrorCode } {
    if (definition.range !== undefined && definition.sourceUnitId === undefined) {
      return { targets: [], error: 'RANGE_SOURCE_MISSING' };
    }
    let targets: BattleInputTarget[];
    if (definition.kind === 'unit') {
      targets = Array.from({ length: state.laneCount }, (_, lane) => lane)
        .flatMap((lane) => Array.from({ length: state.summonDepth }, (_, offset) => ({
          kind: 'cell' as const,
          lane,
          cell: this.sideValue === PLAYER ? offset : state.cellsPerLane - 1 - offset,
        })))
        .filter((target) => !isOccupied(state, target.lane, target.cell));
    } else if (definition.targetType === 'lane') {
      targets = Array.from({ length: state.laneCount }, (_, lane) => ({ kind: 'lane' as const, lane }))
        .filter((target) => state.units.some((unit) => isLivingUnit(unit) && unit.side === OTHER_SIDE[this.sideValue] && unit.lane === target.lane));
    } else if (definition.targetType === 'enemy-unit' || definition.targetType === 'ally-unit') {
      const targetSide = definition.targetType === 'enemy-unit' ? OTHER_SIDE[this.sideValue] : this.sideValue;
      targets = state.units
        .filter((unit) => isLivingUnit(unit) && unit.side === targetSide)
        .filter((unit) => !definition.requiresDamagedAlly || unit.hp < unit.maxHp)
        .map((unit) => ({ kind: 'unit' as const, unitId: unit.id }));
    } else if (definition.targetType === 'global') {
      targets = state.hands[this.sideValue].some((item) => item.instanceId !== card.instanceId && item.remainingPreparation > 0)
        ? [{ kind: 'global' as const }]
        : [];
    } else {
      targets = [];
    }
    targets = targets.filter((target) => targetAllowedByRange(state, definition, target) === null);
    if (definition.canTarget) {
      targets = targets.filter((target) => {
        try { return definition.canTarget!(state, target, this.sideValue) === true; } catch { return false; }
      });
    }
    return { targets: freezeTargets(targets) };
  }

  private validateTargetShape(
    state: BattleState,
    definition: BattleInputCardDefinition,
    target: BattleInputTarget,
  ): BattleInputErrorCode | null {
    const expected = targetTypeFor(definition);
    if (target.kind !== expected) return 'TARGET_TYPE_MISMATCH';
    if (target.kind === 'cell') {
      if (!isInsideBoard(state, target.lane, target.cell)) return 'CELL_OUT_OF_BOUNDS';
      if (isEnemyZone(state, this.sideValue, target.cell)) return 'ENEMY_DEPLOYMENT_CELL';
      if (!isSummonCell(state, this.sideValue, target.cell)) return 'NOT_SUMMON_CELL';
      if (isOccupied(state, target.lane, target.cell)) return 'CELL_OCCUPIED';
    }
    if (target.kind === 'lane' && !isInsideBoard(state, target.lane)) return 'LANE_OUT_OF_BOUNDS';
    if (target.kind === 'unit') {
      const unit = state.units.find((candidate) => candidate.id === target.unitId);
      if (!unit) return 'TARGET_NOT_FOUND';
      if (!isLivingUnit(unit)) return 'TARGET_DEAD';
      const expectedSide = definition.targetType === 'enemy-unit' ? OTHER_SIDE[this.sideValue] : this.sideValue;
      if (unit.side !== expectedSide) return 'TARGET_SIDE_MISMATCH';
    }
    return null;
  }

  private unavailableReason(
    state: BattleState,
    definition: BattleInputCardDefinition,
    target: BattleInputTarget,
  ): BattleInputErrorCode {
    const rangeFailure = targetAllowedByRange(state, definition, target);
    if (rangeFailure) return rangeFailure;
    if (target.kind === 'lane' || target.kind === 'unit') return 'TARGET_NOT_AVAILABLE';
    return 'TARGET_NOT_AVAILABLE';
  }
}

export const BattleInputController = BattleInputAdapter;
