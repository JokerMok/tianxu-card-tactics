export const CHAPTER01_ID = 'CHAPTER01' as const;
export const CHAPTER01_INDEX_CONFIG_REF = 'config/levels/chapter01/index' as const;
export const STORY_SAVE_VERSION = 1 as const;

export const CHAPTER01_LEVEL_IDS = [
  'L01', 'L02', 'L03', 'L04', 'L05', 'L06',
  'L07', 'L08', 'L09', 'L10', 'L11', 'L12',
] as const;

export type Chapter01LevelId = typeof CHAPTER01_LEVEL_IDS[number];
export type StoryNodeKind = 'OPENING' | 'PRE_BATTLE' | 'POST_BATTLE' | 'BOSS';

export interface Chapter01StoryNode {
  readonly id: string;
  readonly kind: StoryNodeKind;
  readonly levelId: Chapter01LevelId | null;
  readonly levelConfigRef: string;
  readonly title: string;
  readonly text: string;
  readonly skippable: true;
}

export interface Chapter01StorySnapshot {
  readonly schemaVersion: typeof STORY_SAVE_VERSION;
  readonly chapterId: typeof CHAPTER01_ID;
  readonly readNodeIds: readonly string[];
  readonly currentNodeId: string | null;
}

export type StoryPersistence = (serialized: string) => void;

export interface Chapter01StoryOptions {
  readonly persist?: StoryPersistence;
  readonly onSave?: StoryPersistence;
}

export type Chapter01StoryErrorCode =
  | 'INVALID_NODE'
  | 'OUT_OF_ORDER'
  | 'INVALID_SAVE'
  | 'SAVE_VERSION'
  | 'PERSISTENCE_FAILED';

export class Chapter01StoryError extends Error {
  readonly code: Chapter01StoryErrorCode;

  constructor(
    code: Chapter01StoryErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(`首章剧情演出 [${code}]：${message}`);
    this.name = 'Chapter01StoryError';
    this.code = code;
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

interface Chapter01LevelDefinition {
  readonly id: Chapter01LevelId;
  readonly title: string;
  readonly configRef: string;
  readonly setup: string;
  readonly aftermath: string;
}

const LEVELS: readonly Chapter01LevelDefinition[] = [
  {
    id: 'L01',
    title: '押册出垣',
    configRef: 'config/levels/chapter01/L01',
    setup: '岳沉戈命你负责前营，晏归要求封匣远离祭坛；山道失控役兵逼近，押运队必须先立阵线。',
    aftermath: '敌兵甲牌上的姓名仍在，持牌者却已无法说出姓名；晏归判断名册正在先于现实改写人。',
  },
  {
    id: 'L02',
    title: '烽台失名',
    configRef: 'config/levels/chapter01/L02',
    setup: '末烽台沉默不报，守军机械重复巡查命令；岳沉戈要求突破，但不得焚毁烽台。',
    aftermath: '烽台名碑出现空白，空白位置与仍活着的守军一一对应。',
  },
  {
    id: 'L03',
    title: '风谷截路',
    configRef: 'config/levels/chapter01/L03',
    setup: '翎照误以为押运队带走了失踪羽民的真名，率斥候截路；神庭追兵抵达后，双方被迫并肩作战。',
    aftermath: '翎照确认迁徙队已被神庭敕令从路径记录中抹除，暂时加入队伍寻找证据。',
  },
  {
    id: 'L04',
    title: '双线交锋',
    configRef: 'config/levels/chapter01/L04',
    setup: '神庭册兵在谷口形成对称包围，这是你第一次独立指挥两路完整军契。',
    aftermath: '押运队截获玄枢敕令：定阙关将在第七日完成重新造册。',
  },
  {
    id: 'L05',
    title: '烬犬追迹',
    configRef: 'config/levels/chapter01/L05',
    setup: '敕印把猎犬领地记为追缉道路，异兽被迫追踪空白神册；目标是解除敕印，而非屠尽兽群。',
    aftermath: '一头猎犬摆脱控制留下，成为队伍获得异兽军契的起点。',
  },
  {
    id: 'L06',
    title: '寒铭封路',
    configRef: 'config/levels/chapter01/L06',
    setup: '山道名碑被错封为寒冬职分，道路持续冻结；晏归解释职分失控与普通天气法术的区别。',
    aftermath: '封路的寒铭暂时失效，队伍得以沿着仍未被抹去的山道继续前进。',
  },
  {
    id: 'L07',
    title: '崩岩阵地',
    configRef: 'config/levels/chapter01/L07',
    setup: '山灵砺山封闭地脉桥，要求朔垣军府兑现修路盟约；岳沉戈同意先清除错封机关。',
    aftermath: '机关被毁，砺山停止敌对，并在最后两回合作为规则型援军加入。',
  },
  {
    id: 'L08',
    title: '空册开封',
    configRef: 'config/levels/chapter01/L08',
    setup: '归序敕令追上押运队，众人的真名在空中逐项改写；岳沉戈命你打开封匣。',
    aftermath: '空白神册将你的真名从天序中剥离；晏归仍能记住你，而神庭法器只显示“无此人”。',
  },
  {
    id: 'L09',
    title: '旧军返阵',
    configRef: 'config/levels/chapter01/L09',
    setup: '坠星道亡兵被写成临时职分，成为只会重复旧军令的册奴；旧誓守夜人请求解除职分，而非抹去记忆。',
    aftermath: '旧军的复归链被截断，余下记忆锚点得到保留，队伍继续向定阙关推进。',
  },
  {
    id: 'L10',
    title: '夺回末烽',
    configRef: 'config/levels/chapter01/L10',
    setup: '队伍必须夺回高处烽台向定阙关示警；翎照传讯，砺山稳定山道，两个目标缺一不可。',
    aftermath: '烽火点燃，定阙关内部分守军拒绝玄枢命令，为攻关留下内应。',
  },
  {
    id: 'L11',
    title: '神门点册',
    configRef: 'config/levels/chapter01/L11',
    setup: '玄枢封锁定阙关外门，要求所有人报出真名并接受新职分；主角拒绝，守土派边军倒向无籍队伍。',
    aftermath: '外门阵台被夺，空白神册记录第一批自愿军契；队伍开始以独立行营行动。',
  },
  {
    id: 'L12',
    title: '玄枢归序',
    configRef: 'config/levels/chapter01/L12',
    setup: '玄枢承认归序正在误伤活人，却仍以城关神位保护为由坚持造册；你拒绝以被抹名者换取稳定。',
    aftermath: '玄枢神位崩裂，空白神册登记自愿军契；无籍行营成立，第二章地图开放。',
  },
] as const;

function freezeNode(node: Chapter01StoryNode): Chapter01StoryNode {
  return Object.freeze(node);
}

function buildNodes(): readonly Chapter01StoryNode[] {
  const nodes: Chapter01StoryNode[] = [freezeNode({
    id: 'CH01-OPENING',
    kind: 'OPENING',
    levelId: null,
    levelConfigRef: CHAPTER01_INDEX_CONFIG_REF,
    title: '第一章《空册坠关》·开场',
    text: '归序元年冬末，押运队从坠星道出发，护送青铜封匣中的空白神册前往定阙关。',
    skippable: true,
  })];

  for (const level of LEVELS) {
    nodes.push(freezeNode({
      id: `CH01-${level.id}-PRE`,
      kind: 'PRE_BATTLE',
      levelId: level.id,
      levelConfigRef: level.configRef,
      title: `1-${Number(level.id.slice(1))} ${level.title}·战前`,
      text: level.setup,
      skippable: true,
    }));
    if (level.id === 'L12') {
      nodes.push(freezeNode({
        id: 'CH01-L12-BOSS',
        kind: 'BOSS',
        levelId: level.id,
        levelConfigRef: level.configRef,
        title: '1-12 玄枢归序·Boss',
        text: '第一阶段玄枢以神庭册兵作战；生命降至一半后，玄枢失去司籍职分并亲自入场。',
        skippable: true,
      }));
    }
    nodes.push(freezeNode({
      id: `CH01-${level.id}-POST`,
      kind: 'POST_BATTLE',
      levelId: level.id,
      levelConfigRef: level.configRef,
      title: `1-${Number(level.id.slice(1))} ${level.title}·战后`,
      text: level.aftermath,
      skippable: true,
    }));
  }
  return Object.freeze(nodes);
}

export const CHAPTER01_STORY_NODES: readonly Chapter01StoryNode[] = buildNodes();
export const CHAPTER01_STORY_NODE_IDS: readonly string[] = Object.freeze(
  CHAPTER01_STORY_NODES.map((node) => node.id),
);

const NODE_INDEX = new Map(CHAPTER01_STORY_NODES.map((node, index) => [node.id, index]));
const SAVE_KEYS = ['schemaVersion', 'chapterId', 'readNodeIds'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidSave(message: string): never {
  throw new Chapter01StoryError('INVALID_SAVE', message);
}

function assertKnownNodeId(value: unknown): string {
  if (typeof value !== 'string' || !NODE_INDEX.has(value)) {
    throw new Chapter01StoryError('INVALID_NODE', `未知剧情节点：${String(value)}`);
  }
  return value;
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    invalidSave(`${label}字段不符合固定存档格式`);
  }
}

function readPrefix(readNodeIds: readonly string[]): string[] {
  if (!Array.isArray(readNodeIds)) invalidSave('readNodeIds必须是数组');
  const expected: string[] = [];
  const seen = new Set<string>();
  readNodeIds.forEach((value, index) => {
    const nodeId = typeof value === 'string' ? value : String(value);
    if (typeof value !== 'string' || !NODE_INDEX.has(value)) {
      invalidSave(`readNodeIds[${index}]不是已注册节点`);
    }
    if (seen.has(nodeId)) invalidSave(`readNodeIds[${index}]重复`);
    seen.add(nodeId);
    if (nodeId !== CHAPTER01_STORY_NODE_IDS[index]) {
      invalidSave('已读节点必须是演出顺序的连续前缀');
    }
    expected.push(nodeId);
  });
  return expected;
}

function serializeReadNodeIds(readNodeIds: readonly string[]): string {
  const normalized = readPrefix(readNodeIds);
  return JSON.stringify({
    schemaVersion: STORY_SAVE_VERSION,
    chapterId: CHAPTER01_ID,
    readNodeIds: normalized,
  });
}

function parseSave(serialized: string): string[] {
  if (typeof serialized !== 'string' || serialized.length === 0) invalidSave('存档必须是非空字符串');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Chapter01StoryError('INVALID_SAVE', '存档不是有效JSON', { cause: error });
  }
  if (!isPlainRecord(parsed)) invalidSave('存档根值必须是普通对象');
  assertExactKeys(parsed, SAVE_KEYS, '存档');
  if (parsed.schemaVersion !== STORY_SAVE_VERSION) {
    throw new Chapter01StoryError('SAVE_VERSION', '不支持的剧情存档版本');
  }
  if (parsed.chapterId !== CHAPTER01_ID) invalidSave('存档章节不是CHAPTER01');
  return readPrefix(parsed.readNodeIds as unknown as readonly string[]);
}

function snapshotFrom(readNodeIds: readonly string[]): Chapter01StorySnapshot {
  const normalized = readPrefix(readNodeIds);
  const currentNodeId = normalized.length < CHAPTER01_STORY_NODE_IDS.length
    ? CHAPTER01_STORY_NODE_IDS[normalized.length]
    : null;
  return Object.freeze({
    schemaVersion: STORY_SAVE_VERSION,
    chapterId: CHAPTER01_ID,
    readNodeIds: Object.freeze([...normalized]),
    currentNodeId,
  });
}

function persistenceError(error: unknown): Chapter01StoryError {
  if (error instanceof Chapter01StoryError) return error;
  return new Chapter01StoryError('PERSISTENCE_FAILED', '剧情存档持久化失败', { cause: error });
}

export function serializeChapter01Story(snapshot: Chapter01StorySnapshot): string {
  if (!snapshot || snapshot.schemaVersion !== STORY_SAVE_VERSION || snapshot.chapterId !== CHAPTER01_ID) {
    invalidSave('剧情快照不符合CHAPTER01存档协议');
  }
  return serializeReadNodeIds(snapshot.readNodeIds);
}

export class Chapter01StoryService {
  private current: Chapter01StorySnapshot;
  private readonly persist?: StoryPersistence;

  constructor(options: Chapter01StoryOptions = {}) {
    if (!isPlainRecord(options)) throw new Chapter01StoryError('INVALID_SAVE', '剧情服务选项必须是普通对象');
    if (options.persist !== undefined && typeof options.persist !== 'function') {
      throw new Chapter01StoryError('PERSISTENCE_FAILED', 'persist必须是函数');
    }
    if (options.onSave !== undefined && typeof options.onSave !== 'function') {
      throw new Chapter01StoryError('PERSISTENCE_FAILED', 'onSave必须是函数');
    }
    if (options.persist !== undefined && options.onSave !== undefined) {
      throw new Chapter01StoryError('PERSISTENCE_FAILED', 'persist和onSave只能指定一个');
    }
    this.persist = options.persist ?? options.onSave;
    this.current = snapshotFrom([]);
  }

  static fromSerialized(serialized: string, options: Chapter01StoryOptions = {}): Chapter01StoryService {
    const readNodeIds = parseSave(serialized);
    const service = new Chapter01StoryService(options);
    service.current = snapshotFrom(readNodeIds);
    return service;
  }

  snapshot(): Chapter01StorySnapshot {
    return this.current;
  }

  currentNode(): Chapter01StoryNode | null {
    return this.current.currentNodeId === null
      ? null
      : CHAPTER01_STORY_NODES[NODE_INDEX.get(this.current.currentNodeId)!];
  }

  isRead(nodeId: string): boolean {
    assertKnownNodeId(nodeId);
    return this.current.readNodeIds.includes(nodeId);
  }

  serialize(): string {
    return serializeChapter01Story(this.current);
  }

  save(): string {
    const serialized = this.serialize();
    this.persistSerialized(serialized);
    return serialized;
  }

  restore(serialized: string): Chapter01StorySnapshot {
    const readNodeIds = parseSave(serialized);
    this.current = snapshotFrom(readNodeIds);
    return this.current;
  }

  skipCurrent(): boolean {
    return this.current.currentNodeId === null ? false : this.skip(this.current.currentNodeId);
  }

  skip(nodeId: string): boolean {
    assertKnownNodeId(nodeId);
    const nodeIndex = NODE_INDEX.get(nodeId)!;
    const currentIndex = this.current.readNodeIds.length;
    if (nodeIndex < currentIndex) return false;
    if (nodeIndex > currentIndex) {
      throw new Chapter01StoryError('OUT_OF_ORDER', `节点${nodeId}不是当前待演出节点`);
    }
    const nextReadNodeIds = [...this.current.readNodeIds, nodeId];
    const serialized = serializeReadNodeIds(nextReadNodeIds);
    this.persistSerialized(serialized);
    this.current = snapshotFrom(nextReadNodeIds);
    return true;
  }

  private persistSerialized(serialized: string): void {
    if (!this.persist) return;
    try {
      this.persist(serialized);
    } catch (error) {
      throw persistenceError(error);
    }
  }
}

export function createChapter01Story(options: Chapter01StoryOptions = {}): Chapter01StoryService {
  return new Chapter01StoryService(options);
}

export function restoreChapter01Story(
  serialized: string,
  options: Chapter01StoryOptions = {},
): Chapter01StoryService {
  return Chapter01StoryService.fromSerialized(serialized, options);
}

export function getChapter01StoryNode(nodeId: string): Chapter01StoryNode {
  assertKnownNodeId(nodeId);
  return CHAPTER01_STORY_NODES[NODE_INDEX.get(nodeId)!];
}
