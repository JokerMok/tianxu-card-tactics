/** Scope-aware read adapter shared by the Cocos client and the future authoritative service.
 * It does not decide combat outcomes, grant rewards, or activate imported content.
 */
export type DataScope = 'main' | 'media';
export type RawRow = Record<string, unknown>;

export interface RecoveredCard {
  id: string;
  sourceId: string;
  raw: RawRow;
  art: string[];
  models: string[];
  artResolution: string;
  modelResolution: string;
}
export interface RecoveredSkill {
  id: string;
  sourceId: string;
  raw: RawRow | null;
  visualModels: string[];
  soundAssets?: string[];
  effects: unknown[];
}
export interface RecoveredScene {
  id: string;
  logicalPath: string;
  header: RawRow;
  nodes: RawRow[];
}
export interface RecoveredMap {
  id: string;
  map_id: number;
  scope: DataScope;
  map_file: string;
  background_asset_ids: string[];
  sound?: { asset_ids: string[] };
  layoutRows: RawRow[];
}
export interface RecoveredScope {
  cards: Record<string, RecoveredCard>;
  monsters: Record<string, RawRow>;
  skills: Record<string, RecoveredSkill>;
  maps: Record<string, RecoveredMap>;
  scenes: RecoveredScene[];
  effects: Record<string, RawRow>;
  statuses: Record<string, RawRow>;
  areas: Record<string, RawRow>;
}
export interface RecoveredCatalog {
  localization?: import('./GameText.ts').GameLocalization;
  version: 1;
  sourceManifest: string;
  activeScope: DataScope;
  ui?: { backgroundAssetId: string };
  scopes: Record<DataScope, RecoveredScope>;
  tables: Record<string, { id: string; path: string; rows: number; sha256: string }>;
  assets: Record<string, { id: string; path: string | null; source: string | null }>;
  models: Record<string, unknown>;
  timelines: Record<string, unknown>;
  layout: {
    design_resolution: [number, number];
    grid: { columns: number; rows_initialized: number; origin_for_90x95: [number, number] };
  };
}
export interface SceneNode {
  id: string;
  originalId: string;
  raw: RawRow;
  triggers: SceneTrigger[];
  incoming: string[];
  outgoing: string[];
}
export interface SceneTrigger {
  id: string;
  raw: RawRow;
  children: RawRow[];
}
export interface SceneGraph {
  id: string;
  startNodeId: string;
  nodes: SceneNode[];
  danglingEdges: RawRow[];
}

export function numeric(row: RawRow, key: string, fallback = 0): number {
  const value = row[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Invalid numeric field ${key}`);
  }
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid numeric field ${key}: ${String(value)}`);
  return result;
}

function dictionary(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseRecoveredCatalog(value: unknown): RecoveredCatalog {
  if (!dictionary(value) || value.version !== 1 || value.sourceManifest !== '5254333315581813739'
      || !dictionary(value.scopes) || !dictionary(value.tables) || !dictionary(value.assets)
      || !dictionary(value.models) || !dictionary(value.timelines) || !dictionary(value.layout)
      || !['main', 'media'].includes(String(value.activeScope))) {
    throw new Error('Recovered catalog schema/version is invalid; rerun the importer');
  }
  for (const scope of ['main', 'media']) {
    const part = value.scopes[scope];
    if (!dictionary(part) || !Array.isArray(part.scenes)
        || ['cards', 'monsters', 'skills', 'maps', 'effects', 'statuses', 'areas'].some(key => !dictionary(part[key]))) {
      throw new Error(`Recovered catalog is missing scope ${scope}`);
    }
    for (const [id, row] of Object.entries(part.cards as Record<string, unknown>)) {
      if (!dictionary(row) || row.id !== `${scope}:card:${id}` || !dictionary(row.raw)
          || !Array.isArray(row.art) || !Array.isArray(row.models)) {
        throw new Error(`Invalid recovered card identity: ${scope}:${id}`);
      }
    }
    for (const scene of part.scenes) {
      if (!dictionary(scene) || typeof scene.id !== 'string' || !scene.id.startsWith(`${scope}:scene:`)
          || !dictionary(scene.header) || !Array.isArray(scene.nodes)) throw new Error('Invalid scene identity');
    }
  }
  // Shape is checked above; data-specific links are audited separately without rewriting the source.
  return value as unknown as RecoveredCatalog;
}

export class RecoveredContent {
  readonly catalog: RecoveredCatalog;
  readonly scope: DataScope;
  constructor(value: unknown, scope: DataScope = 'main') {
    this.catalog = parseRecoveredCatalog(value);
    if (scope !== 'main' && scope !== 'media') throw new Error('Invalid data scope');
    this.scope = scope;
  }
  get data(): RecoveredScope { return this.catalog.scopes[this.scope]; }
  card(id: string | number): RecoveredCard {
    const key = this.localId(id, 'card');
    const card = this.data.cards[key];
    if (!card) throw new Error(`Unknown card ${this.scope}:${key}`);
    return card;
  }
  monsterForCard(id: string | number): RawRow | undefined {
    const card = this.card(id);
    if (numeric(card.raw, 'Type') !== 1) return undefined;
    return this.data.monsters[String(numeric(card.raw, 'MonsterID'))];
  }
  skill(id: string | number): RecoveredSkill {
    const key = this.localId(id, 'skill');
    const skill = this.data.skills[key];
    if (!skill?.raw) throw new Error(`Unknown skill ${this.scope}:${key}`);
    return skill;
  }
  map(id: string | number): RecoveredMap {
    const key = this.localId(id, 'map');
    const map = this.data.maps[key];
    if (!map) throw new Error(`Unknown map ${this.scope}:${key}`);
    return map;
  }
  mapGrid(id: string | number) {
    const map = this.map(id);
    const raw = map.layoutRows.find(row => row._tag === 'map');
    if (!raw) throw new Error(`Map layout is absent for ${map.id}`);
    const tileWidth = numeric(raw, 'tilewidth');
    const tileHeight = numeric(raw, 'tileheight');
    const columns = this.catalog.layout.grid.columns;
    const rows = this.catalog.layout.grid.rows_initialized;
    if (tileWidth <= 0 || tileHeight <= 0 || columns < 1 || rows < 1) throw new Error('Invalid map grid');
    return { columns, rows, tileWidth, tileHeight, originX: (1200 - columns * tileWidth) / 2, originY: 45 };
  }
  graph(sceneId: string | number): SceneGraph {
    const localId = this.localId(sceneId, 'scene');
    const id = `${this.scope}:scene:${localId}`;
    const scene = this.data.scenes.find(candidate => candidate.id === id);
    if (!scene) throw new Error(`Unknown scene ${id}`);
    const root = scene.nodes.find(row => row._tag === 'GraphNodes');
    const points = scene.nodes.filter(row => row._tag === 'pathpoint');
    const sourceEdges = scene.nodes.filter(row => row._tag === 'GraphEdge');
    const pointIds = new Set(points.map(point => String(point.id)));
    const start = String(root?.startid ?? '');
    if (!pointIds.has(start)) throw new Error(`Scene start node is missing: ${id}`);
    // Some original event maps retain edges into absent nodes. Preserve these as
    // explicit adaptation records; do not invent stages or block the valid map.
    const danglingEdges = sourceEdges.filter(edge => !pointIds.has(String(edge.from)) || !pointIds.has(String(edge.to)));
    const edges = sourceEdges.filter(edge => pointIds.has(String(edge.from)) && pointIds.has(String(edge.to)));
    const nodes = points.map(raw => {
      const originalId = String(raw.id);
      const path = String(raw._path);
      const triggers = scene.nodes.filter(row => row._tag === 'Trigger'
          && String(row._path).startsWith(path + '/')).map(row => ({
        id: `${id}:node:${originalId}:trigger:${String(row.id)}`,
        raw: row,
        children: scene.nodes.filter(child => String(child._path).startsWith(String(row._path) + '/')),
      }));
      return { id: `${id}:node:${originalId}`, originalId, raw, triggers,
        incoming: edges.filter(edge => String(edge.to) === originalId).map(edge => `${id}:node:${String(edge.from)}`),
        outgoing: edges.filter(edge => String(edge.from) === originalId).map(edge => `${id}:node:${String(edge.to)}`) };
    });
    return { id, startNodeId: `${id}:node:${start}`, nodes, danglingEdges };
  }
  assetPath(id: string): string {
    const path = this.catalog.assets[id]?.path;
    if (!path) throw new Error(`Asset has not been imported: ${id}`);
    if (path.includes('..') || path.startsWith('/') || path.includes('\\')) throw new Error('Invalid imported asset path');
    return path;
  }
  private localId(id: string | number, kind: string): string {
    const raw = String(id);
    if (/^\d+$/.test(raw)) return raw;
    const prefix = `${this.scope}:${kind}:`;
    if (!raw.startsWith(prefix) || !/^\d+$/.test(raw.slice(prefix.length))) {
      throw new Error(`ID must belong to ${this.scope}:${kind}: ${raw}`);
    }
    return raw.slice(prefix.length);
  }
}
