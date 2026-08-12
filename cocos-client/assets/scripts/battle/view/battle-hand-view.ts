import type { BattleState, CardInstance, Side } from '../../core/types/index.ts';

export interface BattleCardViewState {
  readonly instanceId: string;
  readonly cardId: string;
  readonly remainingPreparation: number;
  readonly available: boolean;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly discarded: false;
}

export interface BattleCardViewNode<NodeHandle = unknown> {
  readonly node?: NodeHandle;
  readonly instanceId?: string;
  readonly state?: BattleCardViewState;
  apply(state: BattleCardViewState): void;
  destroy(): void;
}

export interface BattleHandViewNodeFactory<NodeHandle = unknown> {
  createCardNode(state: BattleCardViewState, parent: unknown): BattleCardViewNode<NodeHandle>;
}

export interface BattleCardStateProjection {
  readonly selectedCardId?: string | null;
  readonly isCardSelected?: (card: CardInstance, snapshot: BattleState) => boolean;
  readonly isCardAvailable?: (card: CardInstance, snapshot: BattleState) => boolean;
  readonly isCardDisabled?: (card: CardInstance, snapshot: BattleState) => boolean;
  readonly getCardState?: (card: CardInstance, snapshot: BattleState) => Partial<Pick<BattleCardViewState, 'available' | 'selected' | 'disabled'>>;
}

export interface BattleHandViewOptions<NodeHandle = unknown> extends BattleCardStateProjection {
  readonly root: unknown;
  readonly side?: Side;
  readonly factory: BattleHandViewNodeFactory<NodeHandle>;
}

export interface BattleHandViewSyncResult {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly removed: number;
  readonly discarded: number;
  readonly cardCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function freezeCardState(state: BattleCardViewState): BattleCardViewState {
  return Object.freeze({ ...state });
}

function assertCard(card: unknown, label: string): asserts card is CardInstance {
  if (!isRecord(card)) throw new Error(`${label} must be a card instance`);
  if (typeof card.instanceId !== 'string' || card.instanceId.length === 0) {
    throw new Error(`${label}.instanceId is required`);
  }
  if (typeof card.cardId !== 'string' || card.cardId.length === 0) {
    throw new Error(`${label}.cardId is required`);
  }
  if (!Number.isSafeInteger(card.remainingPreparation) || card.remainingPreparation < 0) {
    throw new Error(`${label}.remainingPreparation must be a non-negative safe integer`);
  }
}

function assertSnapshot(snapshot: BattleState): void {
  if (!isRecord(snapshot) || !isRecord(snapshot.hands)) throw new Error('battle snapshot hands are required');
  const instanceIds = new Set<string>();
  for (const side of ['player', 'enemy'] as const) {
    const hand = snapshot.hands[side];
    if (!Array.isArray(hand)) throw new Error(`battle snapshot ${side} hand is required`);
    for (let index = 0; index < hand.length; index += 1) {
      const card = hand[index];
      assertCard(card, `battle snapshot ${side} hand[${index}]`);
      if (instanceIds.has(card.instanceId)) throw new Error(`duplicate card instanceId: ${card.instanceId}`);
      instanceIds.add(card.instanceId);
    }
  }
  if (snapshot.graveyards !== undefined) {
    if (!isRecord(snapshot.graveyards)) throw new Error('battle snapshot graveyards are invalid');
    for (const side of ['player', 'enemy'] as const) {
      const graveyard = snapshot.graveyards[side];
      if (!Array.isArray(graveyard) || !graveyard.every((cardId) => typeof cardId === 'string')) {
        throw new Error(`battle snapshot ${side} graveyard is invalid`);
      }
    }
  }
}

function sameCardState(left: BattleCardViewState, right: BattleCardViewState): boolean {
  return left.instanceId === right.instanceId
    && left.cardId === right.cardId
    && left.remainingPreparation === right.remainingPreparation
    && left.available === right.available
    && left.selected === right.selected
    && left.disabled === right.disabled
    && left.discarded === right.discarded;
}

function readBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function readRequiredBoolean(value: unknown, callbackName: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${callbackName} must return a boolean`);
  return value;
}

/** Purely projects one immutable core card into render state. */
export function projectBattleCardState(
  card: CardInstance,
  snapshot: BattleState,
  projection: BattleCardStateProjection = {},
): BattleCardViewState {
  assertCard(card, 'card');
  const custom = projection.getCardState?.(card, snapshot) ?? {};
  const selectedCardId = projection.selectedCardId;
  const selected = readBoolean(custom.selected, 'card selected')
    ?? (projection.isCardSelected
      ? readRequiredBoolean(projection.isCardSelected(card, snapshot), 'isCardSelected')
      : selectedCardId !== undefined && selectedCardId !== null && selectedCardId === card.instanceId);
  const available = readBoolean(custom.available, 'card available')
    ?? (projection.isCardAvailable
      ? readRequiredBoolean(projection.isCardAvailable(card, snapshot), 'isCardAvailable')
      : card.remainingPreparation === 0);
  const disabled = readBoolean(custom.disabled, 'card disabled')
    ?? (projection.isCardDisabled
      ? readRequiredBoolean(projection.isCardDisabled(card, snapshot), 'isCardDisabled')
      : !available);
  return freezeCardState({
    instanceId: card.instanceId,
    cardId: card.cardId,
    remainingPreparation: card.remainingPreparation,
    available,
    selected,
    disabled,
    discarded: false,
  });
}

/**
 * Binds one side of an immutable BattleState hand to keyed card nodes.
 * It owns projection only; selection and play policy are injected callbacks.
 */
export class BattleHandView<NodeHandle = unknown> {
  private readonly rootValue: unknown;
  private readonly sideValue: Side;
  private readonly factory: BattleHandViewNodeFactory<NodeHandle>;
  private readonly defaultProjection: BattleCardStateProjection;
  private registry = new Map<string, BattleCardViewNode<NodeHandle>>();
  private states = new Map<string, BattleCardViewState>();
  private order: string[] = [];
  private graveyardLength = 0;

  constructor(options: BattleHandViewOptions<NodeHandle>) {
    if (!options || !options.factory || typeof options.factory.createCardNode !== 'function') {
      throw new Error('a battle hand card node factory is required');
    }
    if (options.side !== undefined && options.side !== 'player' && options.side !== 'enemy') {
      throw new Error('battle hand side must be player or enemy');
    }
    this.rootValue = options.root;
    this.sideValue = options.side ?? 'player';
    this.factory = options.factory;
    this.defaultProjection = {
      selectedCardId: options.selectedCardId,
      isCardSelected: options.isCardSelected,
      isCardAvailable: options.isCardAvailable,
      isCardDisabled: options.isCardDisabled,
      getCardState: options.getCardState,
    };
  }

  get root(): unknown { return this.rootValue; }
  get side(): Side { return this.sideValue; }
  get cardCount(): number { return this.registry.size; }
  getNode(instanceId: string): BattleCardViewNode<NodeHandle> | undefined { return this.registry.get(instanceId); }
  get nodes(): readonly BattleCardViewNode<NodeHandle>[] {
    return Object.freeze(this.order.map((instanceId) => this.registry.get(instanceId)).filter(
      (node): node is BattleCardViewNode<NodeHandle> => node !== undefined,
    ));
  }

  sync(snapshot: BattleState, projection: BattleCardStateProjection = {}): BattleHandViewSyncResult {
    assertSnapshot(snapshot);
    const hand = snapshot.hands[this.sideValue];
    const mergedProjection: BattleCardStateProjection = {
      ...this.defaultProjection,
      ...projection,
    };
    const nextStates = hand.map((card) => projectBattleCardState(card, snapshot, mergedProjection));
    const nextIds = new Set(nextStates.map((card) => card.instanceId));
    const stagedRegistry = new Map<string, BattleCardViewNode<NodeHandle>>();
    const stagedStates = new Map<string, BattleCardViewState>();
    const stagedNewNodes: BattleCardViewNode<NodeHandle>[] = [];
    const stagedUpdates: Array<{ node: BattleCardViewNode<NodeHandle>; previous: BattleCardViewState; next: BattleCardViewState }> = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    try {
      for (const nextState of nextStates) {
        const previous = this.states.get(nextState.instanceId);
        const node = this.registry.get(nextState.instanceId);
        if (!node || !previous) {
          const nextNode = this.factory.createCardNode(nextState, this.rootValue);
          if (!nextNode || typeof nextNode.apply !== 'function' || typeof nextNode.destroy !== 'function') {
            nextNode?.destroy?.();
            throw new Error(`card node factory returned an invalid node: ${nextState.instanceId}`);
          }
          stagedRegistry.set(nextState.instanceId, nextNode);
          stagedStates.set(nextState.instanceId, nextState);
          stagedNewNodes.push(nextNode);
          created += 1;
        } else {
          stagedRegistry.set(nextState.instanceId, node);
          stagedStates.set(nextState.instanceId, nextState);
          if (sameCardState(previous, nextState)) unchanged += 1;
          else {
            stagedUpdates.push({ node, previous, next: nextState });
            updated += 1;
          }
        }
      }
    } catch (error) {
      for (const node of stagedNewNodes) safelyDestroy(node);
      throw error;
    }

    const appliedExisting: Array<{ node: BattleCardViewNode<NodeHandle>; previous: BattleCardViewState }> = [];
    try {
      for (const update of stagedUpdates) {
        appliedExisting.push({ node: update.node, previous: update.previous });
        update.node.apply(update.next);
      }
      for (const nextState of nextStates) {
        const node = stagedRegistry.get(nextState.instanceId);
        if (node && stagedNewNodes.includes(node)) node.apply(nextState);
      }
    } catch (error) {
      for (let index = appliedExisting.length - 1; index >= 0; index -= 1) {
        const applied = appliedExisting[index];
        try { applied.node.apply(applied.previous); } catch { /* preserve original failure */ }
      }
      for (const node of stagedNewNodes) safelyDestroy(node);
      throw error;
    }

    const removedNodes = [...this.registry.entries()]
      .filter(([instanceId]) => !nextIds.has(instanceId))
      .map(([, node]) => node);
    const previousGraveyardLength = this.graveyardLength;
    const nextGraveyardLength = Array.isArray(snapshot.graveyards?.[this.sideValue])
      ? snapshot.graveyards[this.sideValue].length
      : previousGraveyardLength;
    this.registry = stagedRegistry;
    this.states = stagedStates;
    this.order = nextStates.map((card) => card.instanceId);
    this.graveyardLength = nextGraveyardLength;
    for (const node of removedNodes) safelyDestroy(node);

    const discarded = Math.min(removedNodes.length, Math.max(0, nextGraveyardLength - previousGraveyardLength));
    return Object.freeze({ created, updated, unchanged, removed: removedNodes.length, discarded, cardCount: this.registry.size });
  }

  clear(): void {
    for (const node of this.registry.values()) safelyDestroy(node);
    this.registry.clear();
    this.states.clear();
    this.order = [];
    this.graveyardLength = 0;
  }
}

export type BattleViewHand = BattleHandView;

function safelyDestroy<NodeHandle>(node: BattleCardViewNode<NodeHandle>): void {
  try { node.destroy(); } catch { /* cleanup must not replace the original failure */ }
}

export interface CocosBattleCardNodeLike {
  name?: string;
  active?: boolean;
  battleCardState?: BattleCardViewState;
  battleCardInstanceId?: string;
  battleCardId?: string;
  battleRemainingPreparation?: number;
  battleAvailable?: boolean;
  battleSelected?: boolean;
  battleDisabled?: boolean;
  battleDiscarded?: boolean;
  setParent?(parent: unknown): void;
  setPosition?(x: number, y: number, z?: number): void;
  destroy?(): void;
}

export interface BattleHandViewPosition { readonly x: number; readonly y: number; readonly z?: number }

export interface CocosBattleHandNodeFactoryOptions<Node extends CocosBattleCardNodeLike = CocosBattleCardNodeLike> {
  readonly parent: Node;
  readonly createNode: (name: string) => Node;
  readonly getPosition?: (state: BattleCardViewState) => BattleHandViewPosition;
  readonly applyState?: (node: Node, state: BattleCardViewState) => void;
}

export function defaultBattleHandViewPosition(state: BattleCardViewState): BattleHandViewPosition {
  return { x: 0, y: 0, z: 0 };
}

/** Injects Cocos Node creation so this adapter remains runtime-neutral in tests and CI. */
export function createCocosBattleHandNodeFactory<Node extends CocosBattleCardNodeLike = CocosBattleCardNodeLike>(
  options: CocosBattleHandNodeFactoryOptions<Node>,
): BattleHandViewNodeFactory<Node> {
  const getPosition = options.getPosition ?? defaultBattleHandViewPosition;
  return {
    createCardNode(initialState, parent): BattleCardViewNode<Node> {
      const node = options.createNode(`BattleCard-${initialState.instanceId}`);
      node.setParent?.(parent ?? options.parent);
      let currentState = freezeCardState(initialState);
      const apply = (state: BattleCardViewState): void => {
        currentState = freezeCardState(state);
        node.battleCardState = currentState;
        node.battleCardInstanceId = currentState.instanceId;
        node.battleCardId = currentState.cardId;
        node.battleRemainingPreparation = currentState.remainingPreparation;
        node.battleAvailable = currentState.available;
        node.battleSelected = currentState.selected;
        node.battleDisabled = currentState.disabled;
        node.battleDiscarded = currentState.discarded;
        node.name = `BattleCard-${currentState.instanceId}`;
        node.active = true;
        const position = getPosition(currentState);
        node.setPosition?.(position.x, position.y, position.z ?? 0);
        options.applyState?.(node, currentState);
      };
      return {
        node,
        instanceId: initialState.instanceId,
        get state(): BattleCardViewState { return currentState; },
        apply,
        destroy: () => node.destroy?.(),
      };
    },
  };
}

export const createBattleHandViewNodeFactory = createCocosBattleHandNodeFactory;
export const createCocosBattleCardNodeFactory = createCocosBattleHandNodeFactory;
