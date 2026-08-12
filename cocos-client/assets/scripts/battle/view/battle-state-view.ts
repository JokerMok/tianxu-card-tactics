import type { BattleState, Status, Unit } from '../../core/types/index.ts';

export type BattleUnitViewState = Readonly<Unit>;

export interface BattleViewNode<NodeHandle = unknown> {
  readonly node?: NodeHandle;
  readonly unitId: string;
  readonly state?: BattleUnitViewState;
  apply(state: BattleUnitViewState): void;
  destroy(): void;
}

export interface BattleViewNodeFactory<NodeHandle = unknown> {
  createUnitNode(state: BattleUnitViewState, parent: unknown): BattleViewNode<NodeHandle>;
}

export interface BattleStateViewOptions<NodeHandle = unknown> {
  readonly root: unknown;
  readonly factory: BattleViewNodeFactory<NodeHandle>;
}

export interface BattleStateViewSyncResult {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly removed: number;
  readonly unitCount: number;
}

function freezeStatus(status: Status): Status {
  return Object.freeze({ ...status });
}

function freezeUnit(unit: Unit): BattleUnitViewState {
  return Object.freeze({
    ...unit,
    tags: Object.freeze([...unit.tags]),
    statuses: Object.freeze(unit.statuses.map(freezeStatus)),
  });
}

function sameArray<T>(left: readonly T[], right: readonly T[], equal: (a: T, b: T) => boolean): boolean {
  return left.length === right.length && left.every((value, index) => equal(value, right[index]));
}

function sameStatus(left: Status, right: Status): boolean {
  return left.id === right.id
    && left.kind === right.kind
    && left.sourceId === right.sourceId
    && left.stacks === right.stacks
    && left.remainingRounds === right.remainingRounds
    && left.value === right.value;
}

function sameUnit(left: BattleUnitViewState, right: BattleUnitViewState): boolean {
  return left.id === right.id
    && left.cardId === right.cardId
    && left.name === right.name
    && left.side === right.side
    && left.lane === right.lane
    && left.cell === right.cell
    && left.hp === right.hp
    && left.maxHp === right.maxHp
    && left.attack === right.attack
    && left.armor === right.armor
    && left.move === right.move
    && left.range === right.range
    && left.role === right.role
    && left.actionsTaken === right.actionsTaken
    && left.spawnRound === right.spawnRound
    && sameArray(left.tags, right.tags, (a, b) => a === b)
    && sameArray(left.statuses, right.statuses, sameStatus);
}

function assertUnitIds(units: readonly Unit[]): void {
  const ids = new Set<string>();
  for (const unit of units) {
    if (typeof unit.id !== 'string' || unit.id.length === 0) throw new Error('unit id is required');
    if (ids.has(unit.id)) throw new Error(`duplicate unit id: ${unit.id}`);
    ids.add(unit.id);
  }
}

/**
 * Projects immutable BattleState units into a keyed node registry.
 * The session controller stays responsible for lifecycle and commands; this class only syncs views.
 */
export class BattleStateView<NodeHandle = unknown> {
  private readonly rootValue: unknown;
  private readonly factory: BattleViewNodeFactory<NodeHandle>;
  private registry = new Map<string, BattleViewNode<NodeHandle>>();
  private states = new Map<string, BattleUnitViewState>();
  private order: string[] = [];

  constructor(options: BattleStateViewOptions<NodeHandle>) {
    if (!options || !options.factory || typeof options.factory.createUnitNode !== 'function') {
      throw new Error('a battle view node factory is required');
    }
    this.rootValue = options.root;
    this.factory = options.factory;
  }

  get root(): unknown {
    return this.rootValue;
  }

  get unitCount(): number {
    return this.registry.size;
  }

  getNode(unitId: string): BattleViewNode<NodeHandle> | undefined {
    return this.registry.get(unitId);
  }

  get nodes(): readonly BattleViewNode<NodeHandle>[] {
    return Object.freeze(this.order.map((unitId) => this.registry.get(unitId)).filter(
      (node): node is BattleViewNode<NodeHandle> => node !== undefined,
    ));
  }

  sync(snapshot: BattleState): BattleStateViewSyncResult {
    if (!snapshot || !Array.isArray(snapshot.units)) throw new Error('battle snapshot units are required');
    assertUnitIds(snapshot.units);

    const nextStates = snapshot.units.map(freezeUnit);
    const nextIds = new Set(nextStates.map((unit) => unit.id));
    const stagedRegistry = new Map<string, BattleViewNode<NodeHandle>>();
    const stagedStates = new Map<string, BattleUnitViewState>();
    const stagedNewNodes: BattleViewNode<NodeHandle>[] = [];
    const stagedUpdates: Array<{
      readonly node: BattleViewNode<NodeHandle>;
      readonly previous: BattleUnitViewState;
      readonly next: BattleUnitViewState;
    }> = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    // Phase 1: create every new node without touching the committed registry or state maps.
    try {
      for (const nextState of nextStates) {
        const previous = this.states.get(nextState.id);
        const node = this.registry.get(nextState.id);
        if (!node || !previous) {
          const nextNode = this.factory.createUnitNode(nextState, this.rootValue);
          if (!nextNode || typeof nextNode.apply !== 'function' || typeof nextNode.destroy !== 'function') {
            nextNode?.destroy?.();
            throw new Error(`unit node factory returned an invalid node: ${nextState.id}`);
          }
          stagedRegistry.set(nextState.id, nextNode);
          stagedStates.set(nextState.id, nextState);
          stagedNewNodes.push(nextNode);
          created += 1;
        } else {
          stagedRegistry.set(nextState.id, node);
          stagedStates.set(nextState.id, nextState);
          if (sameUnit(previous, nextState)) unchanged += 1;
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

    // Phase 2: apply state. Existing nodes are recorded before apply so even a partially
    // applied node is included in the rollback attempt.
    const appliedExisting: Array<{ readonly node: BattleViewNode<NodeHandle>; readonly previous: BattleUnitViewState }> = [];
    try {
      for (const update of stagedUpdates) {
        appliedExisting.push({ node: update.node, previous: update.previous });
        update.node.apply(update.next);
      }
      for (const nextState of nextStates) {
        if (!stagedNewNodes.includes(stagedRegistry.get(nextState.id)!)) continue;
        stagedRegistry.get(nextState.id)!.apply(nextState);
      }
    } catch (error) {
      for (let index = appliedExisting.length - 1; index >= 0; index -= 1) {
        const applied = appliedExisting[index];
        try { applied.node.apply(applied.previous); } catch { /* preserve the original failure */ }
      }
      for (const node of stagedNewNodes) safelyDestroy(node);
      throw error;
    }

    // Commit only after all creation and application work succeeds. Removed nodes are
    // destroyed after the new maps/order become the committed view.
    const removedNodes = [...this.registry.entries()]
      .filter(([unitId]) => !nextIds.has(unitId))
      .map(([, node]) => node);
    this.registry = stagedRegistry;
    this.states = stagedStates;
    this.order = nextStates.map((unit) => unit.id);
    for (const node of removedNodes) safelyDestroy(node);

    return Object.freeze({ created, updated, unchanged, removed: removedNodes.length, unitCount: this.registry.size });
  }

  clear(): void {
    for (const node of this.registry.values()) node.destroy();
    this.registry.clear();
    this.states.clear();
    this.order = [];
  }
}

export type BattleView = BattleStateView;

function safelyDestroy<NodeHandle>(node: BattleViewNode<NodeHandle>): void {
  try { node.destroy(); } catch { /* cleanup must not replace the factory/apply failure */ }
}

export interface CocosNodeLike {
  name?: string;
  active?: boolean;
  battleUnitState?: BattleUnitViewState;
  battleUnitId?: string;
  battleSide?: BattleUnitViewState['side'];
  battleLane?: number;
  battleCell?: number;
  battleHp?: number;
  battleMaxHp?: number;
  battleStatuses?: BattleUnitViewState['statuses'];
  setParent?(parent: unknown): void;
  setPosition?(x: number, y: number, z?: number): void;
  destroy?(): void;
}

export interface BattleViewPosition {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

export interface CocosBattleNodeFactoryOptions<Node extends CocosNodeLike = CocosNodeLike> {
  readonly parent: Node;
  readonly createNode: (name: string) => Node;
  readonly getPosition?: (state: BattleUnitViewState) => BattleViewPosition;
  readonly applyState?: (node: Node, state: BattleUnitViewState) => void;
}

export function defaultBattleViewPosition(state: BattleUnitViewState): BattleViewPosition {
  return { x: state.cell, y: -state.lane, z: 0 };
}

/**
 * Factory bridge for Cocos Node. The caller injects `new Node(name)` so this module remains
 * usable by strip-types/CI and has no Node.js or browser dependency.
 */
export function createCocosBattleNodeFactory<Node extends CocosNodeLike = CocosNodeLike>(
  options: CocosBattleNodeFactoryOptions<Node>,
): BattleViewNodeFactory<Node> {
  const getPosition = options.getPosition ?? defaultBattleViewPosition;
  return {
    createUnitNode(initialState, parent): BattleViewNode<Node> {
      const node = options.createNode(`BattleUnit-${initialState.id}`);
      node.setParent?.(parent ?? options.parent);
      let currentState = freezeUnit(initialState);
      const apply = (state: BattleUnitViewState): void => {
        currentState = freezeUnit(state);
        node.battleUnitState = currentState;
        node.battleUnitId = currentState.id;
        node.battleSide = currentState.side;
        node.battleLane = currentState.lane;
        node.battleCell = currentState.cell;
        node.battleHp = currentState.hp;
        node.battleMaxHp = currentState.maxHp;
        node.battleStatuses = currentState.statuses;
        node.name = `BattleUnit-${currentState.id}`;
        node.active = true;
        const position = getPosition(currentState);
        node.setPosition?.(position.x, position.y, position.z ?? 0);
        options.applyState?.(node, currentState);
      };
      return {
        node,
        unitId: initialState.id,
        get state(): BattleUnitViewState { return currentState; },
        apply,
        destroy: () => node.destroy?.(),
      };
    },
  };
}

export const createBattleViewNodeFactory = createCocosBattleNodeFactory;
