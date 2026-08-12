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
  private readonly registry = new Map<string, BattleViewNode<NodeHandle>>();
  private readonly states = new Map<string, BattleUnitViewState>();
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
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const nextState of nextStates) {
      const previous = this.states.get(nextState.id);
      const node = this.registry.get(nextState.id);
      if (!node || !previous) {
        const nextNode = this.factory.createUnitNode(nextState, this.rootValue);
        if (!nextNode || typeof nextNode.apply !== 'function' || typeof nextNode.destroy !== 'function') {
          throw new Error(`unit node factory returned an invalid node: ${nextState.id}`);
        }
        nextNode.apply(nextState);
        this.registry.set(nextState.id, nextNode);
        this.states.set(nextState.id, nextState);
        created += 1;
      } else if (sameUnit(previous, nextState)) {
        unchanged += 1;
      } else {
        node.apply(nextState);
        this.states.set(nextState.id, nextState);
        updated += 1;
      }
    }

    let removed = 0;
    for (const [unitId, node] of this.registry) {
      if (nextIds.has(unitId)) continue;
      node.destroy();
      this.registry.delete(unitId);
      this.states.delete(unitId);
      removed += 1;
    }

    this.order = nextStates.map((unit) => unit.id);

    return Object.freeze({ created, updated, unchanged, removed, unitCount: this.registry.size });
  }

  clear(): void {
    for (const node of this.registry.values()) node.destroy();
    this.registry.clear();
    this.states.clear();
    this.order = [];
  }
}

export type BattleView = BattleStateView;

export interface CocosNodeLike {
  name?: string;
  active?: boolean;
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
      let currentState = initialState;
      const apply = (state: BattleUnitViewState): void => {
        currentState = state;
        node.name = `BattleUnit-${state.id}`;
        node.active = true;
        const position = getPosition(state);
        node.setPosition?.(position.x, position.y, position.z ?? 0);
        options.applyState?.(node, state);
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
