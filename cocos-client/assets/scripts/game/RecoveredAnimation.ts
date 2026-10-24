import { ArtSkin } from './ArtSkin.ts';
import { SampleUnitAnimation } from './SampleUnitAnimation.ts';
import {
  assetManager,
  Color,
  ImageAsset,
  Layers,
  Node,
  Rect,
  Sprite,
  SpriteFrame,
  Texture2D,
  UITransform,
  Vec3,
} from 'cc';
import type { DataScope, RecoveredCatalog } from './RecoveredContent.ts';
import {
  evaluateRecoveredTimeline,
  recoveredChildFrame,
  type RecoveredDisplayState,
  type RecoveredMatrix2D,
  type RecoveredTimelineControl,
} from './RecoveredTimeline.ts';

export type RecoveredAnimationStatus = 'stand' | 'walk' | 'atk' | 'hit' | 'die';
export type RecoveredAnimationDirection = 'east' | 'west';

export interface RecoveredOneShot {
  durationSeconds: number;
  offsetX: number;
  offsetY: number;
  statusName: string;
}

export interface RecoveredPlaybackHandle {
  generation: number;
  status: RecoveredAnimationStatus;
  statusName: string | null;
  durationSeconds: number;
  cueSeconds: number | null;
  hasNativeState: boolean;
  completion: Promise<void>;
  cancel(): void;
}

type Matrix2D = RecoveredMatrix2D;
type TimelineControl = RecoveredTimelineControl;
interface Timeline {
  id: string;
  container_path: string;
  character_id: number;
  declared_frames: number;
  show_frame_count: number;
  fps: number;
  controls: TimelineControl[];
}
interface FillStyle { bitmap_asset_id?: string; matrix?: Matrix2D; type?: number }
interface RuntimeAsset {
  id: string;
  kind?: string;
  path: string | null;
  boundsPx?: [number, number, number, number] | null;
  fillStyles?: FillStyle[];
}
interface ModelStatus {
  raw: Record<string, unknown>;
  timeline_id?: string;
  particle_framerate?: number;
}
interface Model {
  id: string;
  name: string;
  raw: Record<string, unknown>;
  statuses: ModelStatus[];
}
interface MonsterModelLink { modelId: string | null; modelName: string; resolution: string }
interface ActorModelLink {
  profession: number; sex: number; sexName: string; modelIds: string[]; resolution: string;
}
interface RuntimeCatalog {
  scopes: Record<DataScope, {
    monsterModels: Record<string, MonsterModelLink>;
    actorModels: Record<string, ActorModelLink>;
  }>;
  assets: Record<string, RuntimeAsset>;
  models: Record<string, Model>;
  timelines: Record<string, Timeline>;
}
interface CachedFrameTree { node: Node; ready: boolean; generation: number }
type DisplayState = RecoveredDisplayState;
const IDENTITY: Matrix2D = { a: 1, b: 0, c: 0, d: 1, tx_px: 0, ty_px: 0 };
const STATUS_ALIASES: Record<RecoveredAnimationStatus, string[]> = {
  stand: ['stand', 'std', 'idle'], walk: ['walk', 'move'], atk: ['atk', 'attack'],
  hit: ['hit', 'behit', 'hurt'], die: ['die', 'dead', 'death'],
};
const MAX_CACHED_FRAMES = 48;
const FRAME_ASSET_TIMEOUT_MS = 8000;

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pair(value: unknown): [number, number] {
  const parts = String(value ?? '0,0').split(',');
  return [finite(parts[0]), finite(parts[1])];
}

function urlJoin(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/**
 * Runtime renderer for the recovered SWF display lists.
 *
 * It uses source frame rates and delta display-list operations. Bitmap-filled
 * shapes are resolved to their original converted PNG/JPEG dependencies; a
 * missing timeline or bitmap leaves the host empty instead of presenting a
 * still portrait as animation.
 */
const timelineIndices = new WeakMap<RuntimeCatalog, Map<string, Timeline>>();
export class RecoveredAnimation {
  readonly node: Node;
  readonly mountNode: Node;

  private readonly catalog: RuntimeCatalog;
  private readonly assetBaseUrl: string;
  private readonly timelineByCharacter: Map<string, Timeline>;
  private readonly textures = new Map<string, Promise<Texture2D>>();
  private model: Model | null = null;
  private models: Model[] = [];
  private current: ModelStatus | null = null;
  private currentLayers: Array<{ model: Model; status: ModelStatus }> = [];
  private currentDirection: RecoveredAnimationDirection = 'east';
  private frameAccumulator = 0;
  private absoluteFrame = 0;
  private frame = -1;
  private loop = true;
  private attackFrame = -1;
  private attackFired = false;
  private attackCallback?: () => void;
  private completionFired = false;
  private completionCallback?: () => void;
  private completionResolve?: () => void;
  private playbackGeneration = 0;
  private generation = 0;
  private renderCacheKey = '';
  private renderedFrameKey = '';
  private activeRenderer?: Node;
  private readonly frameCache = new Map<string, CachedFrameTree>();
  private readonly performance = { frameTreesBuilt: 0, frameTreesReused: 0, frameTreesEvicted: 0 };
  private disposed = false;
  private sample?: SampleUnitAnimation;

  constructor(parent: Node, catalog: RecoveredCatalog, assetBaseUrl: string) {
    this.catalog = catalog as unknown as RuntimeCatalog;
    this.assetBaseUrl = assetBaseUrl;
    this.node = new Node('RecoveredAnimation');
    this.node.layer = Layers.Enum.UI_2D;
    this.node.setParent(parent);
    this.node.addComponent(UITransform).setContentSize(1, 1);
    this.mountNode = new Node('RecoveredMount');
    this.mountNode.layer = Layers.Enum.UI_2D;
    this.mountNode.setParent(this.node);
    let index=timelineIndices.get(this.catalog);
    if(!index){index=new Map();for(const timeline of Object.values(this.catalog.timelines))index.set(`${timeline.container_path}:${timeline.character_id}`,timeline);timelineIndices.set(this.catalog,index);}
    this.timelineByCharacter=index;
  }

  async setMonster(monsterId: number, scope: DataScope = 'main'): Promise<void> {
    if (this.disposed) throw new Error('RecoveredAnimation has been destroyed');
    const replacement=ArtSkin.unit(scope,monsterId);
    if(replacement){this.sample?.destroy();this.clearDisplay();this.sample=new SampleUnitAnimation(this.node,ArtSkin.unitBase(),replacement);await this.sample.load();this.play('stand','east');return;}
    this.sample?.destroy();this.sample=undefined;
    const link = this.catalog.scopes[scope]?.monsterModels?.[String(monsterId)];
    if (!link?.modelId) throw new Error(`No recovered ${scope} items.xml model for monster ${monsterId}`);
    await this.setModels([link.modelId]);
    this.play('stand', 'east');
  }

  /** Load the source client's default body + weapon actor for a profession. */
  async setActor(profession: number, sex: 0 | 1 = 0, previewOnly = false): Promise<void> {
    if (this.disposed) throw new Error('RecoveredAnimation has been destroyed');
    const link = this.catalog.scopes.main.actorModels?.[`${profession}:${sex}`];
    if (!link || link.resolution !== 'actor_xml_exact' || link.modelIds.length < 2) {
      throw new Error(`No complete recovered actor.xml model for profession ${profession}, sex ${sex}`);
    }
    await this.setModels(link.modelIds, previewOnly);
    this.play('stand', 'east');
  }

  /** Load exact recovered model layers without replacing them with fallback art. */
  async setModels(modelIds: string[], standOnly = false): Promise<void> {
    this.sample?.destroy();this.sample=undefined;
    if (this.disposed) throw new Error('RecoveredAnimation has been destroyed');
    if (modelIds.length === 0) throw new Error('Recovered model list is empty');
    const models = modelIds.map(id => {
      const model = this.catalog.models[id];
      if (!model) throw new Error(`Recovered model is absent from the catalog: ${id}`);
      return model;
    });
    this.models = models;
    this.model = models[0];
    this.applyModelOrigin(this.model);
    await Promise.all(models.map(model => this.preloadModel(model, standOnly)));
  }

  /** No fallback to injury for an absorbed hit on legacy models. */
  playBlock(direction:RecoveredAnimationDirection):RecoveredPlaybackHandle|null {return this.sample?.playBlock(direction)??null;}

  play(status: RecoveredAnimationStatus, direction: RecoveredAnimationDirection,
       onAttack?: () => void, onComplete?: () => void): RecoveredPlaybackHandle {
    if(this.sample){
      this.currentDirection=direction;const handle=this.sample.play(status,direction,onAttack,onComplete);
      const p=this.sample.mountNode.position,o=this.sample.node.position;this.mountNode.setPosition(p.x+o.x,p.y+o.y);return handle;
    }
    const playbackGeneration = this.beginPlayback();
    if (!this.model || this.disposed) return this.unavailablePlayback(status, playbackGeneration);
    const selected = this.selectStatus(this.model, status, direction);
    if (!selected) {
      // Missing hit/death timelines are source gaps. In particular, do not
      // present stand as a native death animation; a missing death hides the
      // recovered display so the owner can apply its source-backed removal.
      if (status === 'die') {
        this.current = null;
        this.currentLayers = [];
        this.clearDisplay();
      }
      return this.unavailablePlayback(status, playbackGeneration);
    }
    const actualDirection = String(selected.raw.dir ?? 'east') as RecoveredAnimationDirection;
    this.currentLayers = this.models.map(model => ({ model, status: this.selectStatus(model, status, actualDirection) }))
      .filter((layer): layer is { model: Model; status: ModelStatus } => Boolean(layer.status));
    this.current = selected;
    this.currentDirection = direction;
    const renderCacheKey = `${this.models.map(model => model.id).join(',')}|${this.currentLayers
      .map(layer => layer.status.timeline_id ?? '').join(',')}|${direction}`;
    if (renderCacheKey !== this.renderCacheKey) {
      this.renderCacheKey = renderCacheKey;
      this.prepareRenderHandoff();
    }
    this.applyModelOrigin(this.model, direction);
    this.frameAccumulator = 0;
    this.absoluteFrame = 0;
    this.frame = -1;
    this.loop = String(selected?.raw.loop ?? '0') === '1';
    const timeline = selected.timeline_id ? this.catalog.timelines[selected.timeline_id] : undefined;
    const fps = Math.max(1, finite(selected.particle_framerate,
      finite(selected.raw.framerate, timeline?.fps || 24)));
    const frames = Math.max(1, timeline?.show_frame_count || timeline?.declared_frames || 1);
    const configuredCue = finite(String(selected.raw.attack ?? '0').split(',')[0]);
    const cueFrame = status === 'atk' ? Math.max(1, configuredCue || 3) : 0;
    this.attackFrame = cueFrame ? cueFrame - 1 : -1;
    this.attackFired = false;
    this.attackCallback = onAttack;
    this.completionFired = false;
    this.completionCallback = onComplete;
    const completion = new Promise<void>(resolve => { this.completionResolve = resolve; });
    this.node.setScale(1, 1, 1);
    this.renderCurrentFrame(true);
    if (this.attackFrame === 0) this.fireAttack(playbackGeneration);
    return {
      generation: playbackGeneration,
      status,
      statusName: String(selected.raw.name ?? status),
      durationSeconds: frames / fps,
      cueSeconds: cueFrame ? (Math.min(frames, cueFrame) - 1) / fps : null,
      hasNativeState: true,
      completion,
      cancel: () => this.cancelPlayback(playbackGeneration),
    };
  }

  /**
   * Play a recovered effect once. Stand is preferred when present; effect
   * models normally use names such as hold, fly, bind or behit, so their first
   * real timeline is used when stand is absent.
   */
  playOneShot(direction: RecoveredAnimationDirection, onComplete?: () => void): RecoveredOneShot | null {
    if (!this.model || this.disposed) return null;
    this.beginPlayback();
    const chosen = this.selectOneShotStatus(this.model, direction);
    if (!chosen?.timeline_id) return null;
    const statusName = String(chosen.raw.name ?? '');
    const actualDirection = String(chosen.raw.dir ?? 'east') as RecoveredAnimationDirection;
    this.currentLayers = this.models.map(model => {
      const status = this.selectNamedStatus(model, statusName, actualDirection)
        ?? this.selectOneShotStatus(model, actualDirection);
      return status ? { model, status } : null;
    }).filter((layer): layer is { model: Model; status: ModelStatus } => Boolean(layer));
    this.current = chosen;
    this.currentDirection = direction;
    const renderCacheKey = `${this.models.map(model => model.id).join(',')}|${this.currentLayers
      .map(layer => layer.status.timeline_id ?? '').join(',')}|${direction}`;
    if (renderCacheKey !== this.renderCacheKey) {
      this.renderCacheKey = renderCacheKey;
      this.prepareRenderHandoff();
    }
    this.applyModelOrigin(this.model, direction);
    this.frameAccumulator = 0;
    this.absoluteFrame = 0;
    this.frame = -1;
    this.loop = false;
    this.attackFrame = -1;
    this.attackFired = false;
    this.attackCallback = undefined;
    this.completionFired = false;
    this.completionCallback = onComplete;
    this.node.setScale(1, 1, 1);
    this.renderCurrentFrame(true);
    const timeline = this.catalog.timelines[chosen.timeline_id];
    const fps = Math.max(1, finite(chosen.particle_framerate,
      finite(chosen.raw.framerate, timeline?.fps || 24)));
    const frames = Math.max(1, timeline?.show_frame_count || timeline?.declared_frames || 1);
    const offsetX = finite(direction === 'west' ? chosen.raw.woffsetx : chosen.raw.offsetx);
    const offsetY = -finite(direction === 'west' ? chosen.raw.woffsety : chosen.raw.offsety);
    return { durationSeconds: frames / fps, offsetX, offsetY, statusName };
  }

  update(dt: number): void {
    if(this.sample){this.sample.update(dt);return;}
    if (!this.current?.timeline_id || this.disposed || dt <= 0) return;
    const playbackGeneration = this.playbackGeneration;
    const timeline = this.catalog.timelines[this.current.timeline_id];
    if (!timeline) return;
    const fps = Math.max(1, finite(this.current.particle_framerate,
      finite(this.current.raw.framerate, timeline.fps || 24)));
    const count = Math.max(1, timeline.show_frame_count || timeline.declared_frames);
    this.frameAccumulator += dt;
    const interval = 1 / fps;
    if (this.frameAccumulator < interval) return;
    // The recovered client advances at most one frame per render update and
    // resets its clock; a long stall must not burst through several poses.
    this.frameAccumulator = 0;
    this.absoluteFrame++;
    const nextFrame = this.loop ? this.absoluteFrame % count : Math.min(count - 1, this.absoluteFrame);
    if (this.attackFrame >= 0 && !this.attackFired && this.absoluteFrame >= this.attackFrame) {
      this.fireAttack(playbackGeneration);
      if (playbackGeneration !== this.playbackGeneration) return;
    }
    // Layer timelines may use a different frame rate/count from the root.
    // Let the composite frame key decide whether the retained tree changes.
    this.renderCurrentFrame(false);
    if (!this.loop && this.absoluteFrame >= count && !this.completionFired) {
      // CreatureAttackState calls the attack on exit when the configured cue
      // was never reached (for example, a malformed cue beyond the clip).
      if (this.attackFrame >= 0 && !this.attackFired) {
        this.fireAttack(playbackGeneration);
        if (playbackGeneration !== this.playbackGeneration) return;
      }
      this.completionFired = true;
      const callback = this.completionCallback;
      const resolve = this.completionResolve;
      this.completionCallback = undefined;
      this.completionResolve = undefined;
      callback?.();
      resolve?.();
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sample?.destroy(); this.sample=undefined;
    this.generation++;
    for (const texture of this.textures.values()) void texture.then(value => value.destroy()).catch(() => undefined);
    this.textures.clear();
    this.node.destroy();
    this.model = null;
    this.models = [];
    this.current = null;
    this.currentLayers = [];
    this.completionCallback = undefined;
    this.completionResolve?.();
    this.completionResolve = undefined;
  }

  /** Bounded, identity-free counters used by local performance comparison. */
  getPerformanceStats() {
    if(this.sample)return {kind:"sample",...this.sample.getPerformanceStats()};
    const entries = Array.from(this.frameCache.values()).filter(entry => entry.node.isValid);
    const retained = this.node.children.filter(child => child !== this.mountNode && child.isValid);
    return { ...this.performance, frameCacheSize: entries.length, retainedFrameTrees: retained.length,
      activeFrameTrees: retained.filter(node => node.active !== false).length,
      pendingFrameTrees: entries.filter(entry => !entry.ready).length };
  }

  /** AutoupdateAssertBackground sizes the actual displayed clip to its UI box.
   * This is only for window previews; board entities retain source anchors. */
  fitPreviewBox(width: number, height: number): boolean {
    const parent = this.node.parent?.getComponent(UITransform);
    if (!parent || this.disposed) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const visit = (node: Node) => {
      if (node !== this.node && node.active === false) return;
      if (node.getComponent(Sprite)) {
        const box = node.getComponent(UITransform)?.getBoundingBoxToWorld();
        if (box) for (const [x, y] of [[box.xMin, box.yMin], [box.xMax, box.yMax]]) {
          const point = parent.convertToNodeSpaceAR(new Vec3(x, y, 0));
          minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
        }
      }
      for (const child of node.children) visit(child);
    };
    visit(this.node);
    if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return false;
    const sx = width / (maxX - minX), sy = height / (maxY - minY);
    this.node.setScale(this.node.scale.x * sx, this.node.scale.y * sy, 1);
    this.node.setPosition(-(minX + maxX) / 2 * sx, -(minY + maxY) / 2 * sy);
    return true;
  }

  /** Nominal source envelope, not measured opaque pixels or a foot marker. */
  getSourceLayoutMetrics(direction: RecoveredAnimationDirection = this.currentDirection) {
    if(this.sample)return this.sample.getSourceLayoutMetrics(direction);
    if (!this.model) return undefined;
    const raw = this.model.raw, scale = finite(raw.scale, 1) || 1;
    const [anchorX, anchorY] = pair(raw.anchor);
    return { nominalWidth: finite(raw.width) * scale, nominalHeight: finite(raw.height) * scale,
      anchorX: direction === 'west' ? finite(raw.width) * scale - anchorX : anchorX, anchorY };
  }

  private applyModelOrigin(model: Model,
                           direction: RecoveredAnimationDirection = 'east'): void {
    const [mountX, mountY] = pair(model.raw.mount);
    // AnimateSceneObject.statusPoint is relative to the logical position, not
    // the renderer's anchor-adjusted top-left position.
    this.mountNode.setPosition(direction === 'west' ? -mountX : mountX, -mountY);
  }

  private applyRendererGeometry(host: Node, model: Model, status: ModelStatus,
                                direction: RecoveredAnimationDirection): void {
    const scale = finite(model.raw.scale, 1) || 1;
    const width = finite(model.raw.width);
    const [anchorX, anchorY] = pair(model.raw.anchor);
    // AnimateSceneObject subtracts the raw anchor before DisplayObjectRenderer
    // applies scale. West uses wanchor.x = width * scale - anchor.x.
    const sourceAnchorX = direction === 'west' ? width * scale - anchorX : anchorX;
    const actualDirection = String(status.raw.dir ?? 'east');
    const mirrored = actualDirection !== direction;
    host.setPosition(-sourceAnchorX + (mirrored ? width * scale : 0), anchorY);
    host.setScale(mirrored ? -scale : scale, scale, 1);
  }

  private selectNamedStatus(model: Model, name: string,
                            direction: RecoveredAnimationDirection): ModelStatus | undefined {
    const statuses = model.statuses.filter(candidate =>
      String(candidate.raw.name ?? '').toLowerCase() === name.toLowerCase() && Boolean(candidate.timeline_id));
    return statuses.find(candidate => String(candidate.raw.dir ?? 'east') === direction)
      ?? statuses.find(candidate => String(candidate.raw.dir ?? 'east') === 'east')
      ?? statuses[0];
  }

  private selectOneShotStatus(model: Model,
                              direction: RecoveredAnimationDirection): ModelStatus | undefined {
    const stand = STATUS_ALIASES.stand.flatMap(name =>
      model.statuses.filter(candidate => String(candidate.raw.name ?? '').toLowerCase() === name
        && Boolean(candidate.timeline_id)));
    const playable = stand.length ? stand : model.statuses.filter(candidate => Boolean(candidate.timeline_id));
    return playable.find(candidate => String(candidate.raw.dir ?? 'east') === direction)
      ?? playable.find(candidate => String(candidate.raw.dir ?? 'east') === 'east')
      ?? playable[0];
  }

  private selectStatus(model: Model, status: RecoveredAnimationStatus,
                       direction: RecoveredAnimationDirection): ModelStatus | undefined {
    const aliases = STATUS_ALIASES[status];
    const statuses = model.statuses.filter(candidate =>
      aliases.includes(String(candidate.raw.name ?? '').toLowerCase()) && Boolean(candidate.timeline_id));
    return statuses.find(candidate => String(candidate.raw.dir ?? 'east') === direction)
      ?? statuses.find(candidate => String(candidate.raw.dir ?? 'east') === 'east')
      ?? statuses[0];
  }

  private async preloadModel(model: Model, standOnly = false): Promise<void> {
    const bitmapIds = new Set<string>();
    const timelines = new Set<string>();
    const visit = (timelineId?: string): void => {
      if (!timelineId || timelines.has(timelineId)) return;
      timelines.add(timelineId);
      const timeline = this.catalog.timelines[timelineId];
      if (!timeline) return;
      for (const control of timeline.controls) {
        const asset = control.asset_id ? this.catalog.assets[control.asset_id] : undefined;
        if (asset?.path) bitmapIds.add(asset.id);
        for (const fill of asset?.fillStyles ?? []) if (fill.bitmap_asset_id) bitmapIds.add(fill.bitmap_asset_id);
        const child = this.timelineByCharacter.get(`${timeline.container_path}:${control.character_id}`);
        if (child) visit(child.id);
      }
    };
    for (const status of model.statuses) if (!standOnly || STATUS_ALIASES.stand.includes(String(status.raw.name ?? '').toLowerCase())) visit(status.timeline_id);
    await Promise.all(Array.from(bitmapIds).map(id => this.loadTexture(id).catch(() => undefined)));
  }

  private renderCurrentFrame(force: boolean): void {
    const timeline = this.current?.timeline_id ? this.catalog.timelines[this.current.timeline_id] : undefined;
    if (!timeline) {
      this.clearDisplay();
      return;
    }
    const count = Math.max(1, timeline.show_frame_count || timeline.declared_frames);
    const nextFrame = this.loop ? this.absoluteFrame % count : Math.min(count - 1, this.absoluteFrame);
    this.frame = nextFrame;
    const currentFps = Math.max(1, finite(this.current?.particle_framerate,
      finite(this.current?.raw.framerate, timeline.fps || 24)));
    const layerFrames = this.currentLayers.map(layer => {
      const layerTimeline = layer.status.timeline_id ? this.catalog.timelines[layer.status.timeline_id] : undefined;
      if (!layerTimeline) return -1;
      const layerCount = Math.max(1, layerTimeline.show_frame_count || layerTimeline.declared_frames);
      const layerFps = Math.max(1, finite(layer.status.particle_framerate,
        finite(layer.status.raw.framerate, layerTimeline.fps || currentFps)));
      const layerAbsoluteFrame = Math.floor(this.absoluteFrame / currentFps * layerFps + 1e-9);
      return this.loop ? layerAbsoluteFrame % layerCount : Math.min(layerCount - 1, layerAbsoluteFrame);
    });
    const cacheKey = `${this.renderCacheKey}:${nextFrame}:${layerFrames.join(',')}`;
    if (!force && cacheKey === this.renderedFrameKey) return;
    this.renderedFrameKey = cacheKey;
    const cached = this.frameCache.get(cacheKey);
    if (cached?.node.isValid) {
      this.frameCache.delete(cacheKey);
      this.frameCache.set(cacheKey, cached);
      if (cached.ready) this.activateFrame(cacheKey, cached, true);
      return;
    }
    const generation = this.generation;
    const rendererNode = new Node('RecoveredRenderer');
    rendererNode.layer = Layers.Enum.UI_2D;
    rendererNode.setParent(this.node);
    rendererNode.active = false;
    const entry: CachedFrameTree = { node: rendererNode, ready: false, generation };
    this.frameCache.set(cacheKey, entry);
    this.performance.frameTreesBuilt++;
    this.applyRendererGeometry(rendererNode, this.model!, this.current!, this.currentDirection);
    const pendingAssets: Promise<void>[] = [];
    for (const [index, layer] of this.currentLayers.entries()) {
      const layerTimeline = layer.status.timeline_id ? this.catalog.timelines[layer.status.timeline_id] : undefined;
      if (!layerTimeline) continue;
      const layerNode = new Node(`RecoveredLayer-${index}-${layer.model.name}`);
      layerNode.layer = Layers.Enum.UI_2D;
      layerNode.setParent(rendererNode);
      this.renderTimeline(layerTimeline, layerFrames[index] + 1, layerNode, generation, new Set(), pendingAssets);
    }
    while (this.frameCache.size > MAX_CACHED_FRAMES) {
      const oldest = Array.from(this.frameCache.entries()).find(([, candidate]) => candidate.node !== this.activeRenderer);
      if (!oldest) break;
      this.frameCache.delete(oldest[0]);
      if (oldest[1].node.isValid) oldest[1].node.destroy();
      this.performance.frameTreesEvicted++;
    }
    this.mountNode.setSiblingIndex(this.node.children.length - 1);
    if (!pendingAssets.length) {
      entry.ready = true;
      this.activateFrame(cacheKey, entry, false);
    } else {
      void Promise.all(pendingAssets).then(() => {
        entry.ready = true;
        this.activateFrame(cacheKey, entry, false);
      });
    }
  }

  private activateFrame(cacheKey: string, entry: CachedFrameTree, reused: boolean): void {
    if (this.disposed || entry.generation !== this.generation || !entry.ready || !entry.node.isValid
        || this.renderedFrameKey !== cacheKey || this.frameCache.get(cacheKey) !== entry) return;
    // Make the complete tree visible before retiring the previous tree. Both
    // writes occur in one JS turn, so Cocos never renders the prepared gap.
    entry.node.active = true;
    const previous = this.activeRenderer;
    if (previous?.isValid && previous !== entry.node) previous.active = false;
    entry.node.setSiblingIndex(this.node.children.length - 1);
    this.mountNode.setSiblingIndex(this.node.children.length - 1);
    this.activeRenderer = entry.node;
    if (previous?.isValid && previous !== entry.node
        && !Array.from(this.frameCache.values()).some(candidate => candidate.node === previous)) previous.destroy();
    if (reused) this.performance.frameTreesReused++;
  }

  /** Invalidate pending work while keeping the last complete tree visible for handoff. */
  private prepareRenderHandoff(): void {
    this.generation++;
    for (const child of Array.from(this.node.children)) {
      if (child !== this.mountNode && child !== this.activeRenderer) child.destroy();
    }
    this.frameCache.clear();
    this.renderedFrameKey = '';
    this.mountNode.setSiblingIndex(this.node.children.length - 1);
  }

  private clearDisplay(): void {
    this.generation++;
    for (const child of Array.from(this.node.children)) if (child !== this.mountNode) child.destroy();
    this.frameCache.clear();
    this.activeRenderer = undefined;
    this.renderedFrameKey = '';
    this.mountNode.setSiblingIndex(this.node.children.length - 1);
  }

  private evaluate(timeline: Timeline, frame: number): Map<number, DisplayState> {
    return evaluateRecoveredTimeline(timeline.controls, frame);
  }

  private renderTimeline(timeline: Timeline, frame: number, parent: Node, generation: number,
                         ancestors: Set<string>, pendingAssets: Promise<void>[], offsetX = 0, offsetY = 0): void {
    if (ancestors.has(timeline.id)) return;
    const branch = new Set(ancestors).add(timeline.id);
    for (const [depth, state] of Array.from(this.evaluate(timeline, frame)).sort((a, b) => a[0] - b[0])) {
      const transformed = this.affine(parent, state.matrix, `depth-${depth}`, offsetX, offsetY);
      const child = state.characterId === undefined ? undefined
        : this.timelineByCharacter.get(`${timeline.container_path}:${state.characterId}`);
      if (child) {
        const childFrame = recoveredChildFrame(frame, timeline.fps, state, child);
        this.renderTimeline(child, childFrame, transformed, generation, branch, pendingAssets);
      } else if (state.assetId) {
        this.renderAsset(state.assetId, transformed, generation, pendingAssets);
      }
    }
  }

  /** Represent a general 2D affine as R * scale * R (SVD), preserving shear. */
  private affine(parent: Node, raw: Matrix2D, name: string, offsetX = 0, offsetY = 0): Node {
    // Conjugating with diag(1,-1) converts Flash's y-down matrix to Cocos y-up.
    const a = finite(raw.a, 1), b = -finite(raw.b), c = -finite(raw.c), d = finite(raw.d, 1);
    const tx = finite(raw.tx_px) + offsetX, ty = -finite(raw.ty_px) + offsetY;
    const ata00 = a * a + b * b, ata01 = a * c + b * d, ata11 = c * c + d * d;
    const v = .5 * Math.atan2(2 * ata01, ata00 - ata11);
    const cv = Math.cos(v), sv = Math.sin(v);
    const s1 = Math.sqrt(Math.max(0, ata00 * cv * cv + 2 * ata01 * cv * sv + ata11 * sv * sv));
    const det = a * d - b * c;
    const s2 = s1 > 1e-8 ? Math.abs(det) / s1 : Math.sqrt(Math.max(0, ata00 + ata11));
    const ux = s1 > 1e-8 ? (a * cv + c * sv) / s1 : 1;
    const uy = s1 > 1e-8 ? (b * cv + d * sv) / s1 : 0;
    const u = Math.atan2(uy, ux);
    const outer = new Node(`${name}-translate-rotate`); outer.layer = Layers.Enum.UI_2D; outer.setParent(parent);
    outer.setPosition(tx, ty); outer.setRotationFromEuler(0, 0, u * 180 / Math.PI);
    const scale = new Node(`${name}-scale`); scale.layer = Layers.Enum.UI_2D; scale.setParent(outer);
    scale.setScale(s1, det < 0 ? -s2 : s2, 1);
    const inner = new Node(`${name}-inner-rotate`); inner.layer = Layers.Enum.UI_2D; inner.setParent(scale);
    inner.setRotationFromEuler(0, 0, -v * 180 / Math.PI);
    return inner;
  }

  private renderAsset(assetId: string, parent: Node, generation: number, pendingAssets: Promise<void>[]): void {
    const asset = this.catalog.assets[assetId];
    if (!asset) return;
    if (asset.path) {
      pendingAssets.push(this.attachSprite(asset, parent, generation));
      return;
    }
    const fill = (asset.fillStyles ?? []).find(candidate => candidate.bitmap_asset_id);
    if (!fill?.bitmap_asset_id) return;
    const fillHost = this.affine(parent, this.fillMatrix(fill.matrix), 'bitmap-fill');
    const bitmap = this.catalog.assets[fill.bitmap_asset_id];
    if (bitmap?.path) pendingAssets.push(this.attachSprite(bitmap, fillHost, generation));
  }

  private fillMatrix(matrix?: Matrix2D): Matrix2D {
    if (!matrix) return IDENTITY;
    // Bitmap-fill matrices are stored in twips per bitmap pixel.
    return { a: finite(matrix.a, 20) / 20, b: finite(matrix.b) / 20,
      c: finite(matrix.c) / 20, d: finite(matrix.d, 20) / 20,
      tx_px: finite(matrix.tx_px), ty_px: finite(matrix.ty_px) };
  }

  private attachSprite(asset: RuntimeAsset, parent: Node, generation: number,
                       bounds?: [number, number, number, number]): Promise<void> {
    return this.loadTextureWithin(asset.id).then(texture => {
      if (this.disposed || generation !== this.generation || !parent.isValid) return;
      const node = new Node(`asset-${asset.id.slice(-8)}`);
      node.layer = Layers.Enum.UI_2D;
      node.setParent(parent);
      const sprite = node.addComponent(Sprite);
      const frame = new SpriteFrame();
      frame.texture = texture;
      const width = bounds ? Math.max(1, bounds[1] - bounds[0]) : texture.width;
      const height = bounds ? Math.max(1, bounds[3] - bounds[2]) : texture.height;
      // Bitmap-filled character shapes in this source are rectangular frame
      // clips. Clamp the crop to the recovered texture dimensions.
      frame.rect = new Rect(0, 0, Math.min(width, texture.width), Math.min(height, texture.height));
      sprite.spriteFrame = frame;
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.color = Color.WHITE;
      node.addComponent(UITransform).setContentSize(width, height);
      const x = bounds ? bounds[0] + width / 2 : width / 2;
      const y = bounds ? -(bounds[2] + height / 2) : -height / 2;
      node.setPosition(x, y);
    }).catch(error => console.warn(`[RecoveredAnimation] Unable to load ${asset.id}`, error));
  }

  private loadTextureWithin(assetId: string): Promise<Texture2D> {
    const load = this.loadTexture(assetId);
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Recovered bitmap ${assetId} timed out after ${FRAME_ASSET_TIMEOUT_MS}ms`));
      }, FRAME_ASSET_TIMEOUT_MS);
      load.then(texture => {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(texture);
      }, error => {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(error);
      });
    });
  }

  private loadTexture(assetId: string): Promise<Texture2D> {
    const cached = this.textures.get(assetId);
    if (cached) return cached;
    const asset = this.catalog.assets[assetId];
    if (!asset?.path) return Promise.reject(new Error(`Recovered bitmap ${assetId} has no imported path`));
    const url = urlJoin(this.assetBaseUrl, asset.path);
    const promise = new Promise<Texture2D>((resolve, reject) => {
      assetManager.loadRemote<ImageAsset>(url, (error, image) => {
        if (error || !image) return reject(error ?? new Error(`Empty image ${url}`));
        const texture = new Texture2D(assetId);
        texture.image = image;
        resolve(texture);
      });
    });
    this.textures.set(assetId, promise);
    return promise;
  }

  private beginPlayback(): number {
    this.cancelPlayback(this.playbackGeneration);
    this.playbackGeneration++;
    this.attackCallback = undefined;
    this.completionCallback = undefined;
    this.attackFired = false;
    this.completionFired = false;
    return this.playbackGeneration;
  }

  private cancelPlayback(generation: number): void {
    if (generation !== this.playbackGeneration || this.completionFired) return;
    this.completionFired = true;
    this.attackCallback = undefined;
    this.completionCallback = undefined;
    this.completionResolve?.();
    this.completionResolve = undefined;
  }

  private unavailablePlayback(status: RecoveredAnimationStatus, generation: number): RecoveredPlaybackHandle {
    this.completionFired = true;
    return { generation, status, statusName: null, durationSeconds: 0, cueSeconds: null,
      hasNativeState: false, completion: Promise.resolve(), cancel: () => undefined };
  }

  private fireAttack(generation: number): void {
    if (generation !== this.playbackGeneration || this.attackFired) return;
    this.attackFired = true;
    const callback = this.attackCallback;
    this.attackCallback = undefined;
    callback?.();
  }
}
