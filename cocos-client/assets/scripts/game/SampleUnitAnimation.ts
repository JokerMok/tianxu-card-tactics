import {
  assetManager,
  ImageAsset,
  Layers,
  Node,
  Rect,
  Sprite,
  SpriteFrame,
  Size,
  Texture2D,
  UITransform,
} from 'cc';
import type {
  RecoveredAnimationDirection,
  RecoveredAnimationStatus,
  RecoveredPlaybackHandle,
} from './RecoveredAnimation.ts';

export interface SampleUnitSpec {
  atlas: string;
  frameSize: [number, number];
  columns: number;
  frameCount: number;
  displaySize: [number, number];
  foot: [number, number];
  mount: [number, number];
  /** Offset from the unchanged board logical point, in design coordinates. */
  origin?: [number, number];
  /** Head label position above the board point, independent of transparent atlas padding. */
  nameOffsetY?: number;
  /** Optional presentation of an authoritative blocked impact; not a new battle action. */
  reactions?: {block?: {start:number;count:number;fps:number;loop:boolean}};
  clips: Record<RecoveredAnimationStatus, {
    start: number;
    count: number;
    fps: number;
    loop: boolean;
    cueFrame?: number;
  }>;
}

interface AtlasLayout {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  frameCount: number;
  key: string;
}

interface AtlasEntry {
  readonly url: string;
  readonly layout: AtlasLayout;
  refs: number;
  state: 'pending' | 'ready' | 'failed';
  image?: ImageAsset;
  texture?: Texture2D;
  frames?: SpriteFrame[];
  readonly ready: Promise<AtlasEntry>;
  resolve(entry: AtlasEntry): void;
  reject(error: Error): void;
}

interface AtlasLease {
  readonly ready: Promise<AtlasEntry>;
  release(): void;
}

interface ActivePlayback {
  readonly generation: number;
  readonly status: RecoveredAnimationStatus;
  readonly start: number;
  readonly count: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly cueFrame?: number;
  elapsed: number;
  displayedFrame: number;
  cueFired: boolean;
  finished: boolean;
  onAttack?: () => void;
  onComplete?: () => void;
  resolve?: () => void;
}

const REQUIRED_STATUSES: RecoveredAnimationStatus[] = ['stand', 'walk', 'atk', 'hit', 'die'];
const MAX_ATLAS_ENTRIES = 4;

function atlasUrl(base: string, atlas: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(atlas) || atlas.startsWith('/') || atlas.startsWith('data:')) return atlas;
  return `${base.replace(/\/$/, '')}/${atlas.replace(/^\//, '')}`;
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function finitePair(value: [number, number]): boolean {
  return value.length === 2 && value.every(Number.isFinite);
}

function validateSpec(spec: SampleUnitSpec): AtlasLayout {
  if (!spec.atlas) throw new Error('Sample unit atlas is missing');
  const [frameWidth, frameHeight] = spec.frameSize;
  if (!positiveInteger(frameWidth) || !positiveInteger(frameHeight)
      || !positiveInteger(spec.columns) || !positiveInteger(spec.frameCount)) {
    throw new Error('Sample unit atlas layout is invalid');
  }
  if (!finitePair(spec.displaySize) || spec.displaySize.some(value => value <= 0)
      || !finitePair(spec.foot) || !finitePair(spec.mount) || (spec.origin !== undefined && !finitePair(spec.origin))
      || (spec.nameOffsetY !== undefined && (!Number.isFinite(spec.nameOffsetY) || spec.nameOffsetY < 0))
      || spec.foot[0] < 0 || spec.foot[0] > frameWidth
      || spec.foot[1] < 0 || spec.foot[1] > frameHeight) {
    throw new Error('Sample unit display layout is invalid');
  }
  for (const status of REQUIRED_STATUSES) {
    const clip = spec.clips?.[status];
    if (!clip || !Number.isInteger(clip.start) || clip.start < 0
        || !positiveInteger(clip.count) || !Number.isFinite(clip.fps) || clip.fps <= 0
        || typeof clip.loop !== 'boolean' || clip.start + clip.count > spec.frameCount
        || (clip.cueFrame !== undefined
          && (!Number.isInteger(clip.cueFrame) || clip.cueFrame < 0 || clip.cueFrame >= clip.count))) {
      throw new Error(`Sample unit ${status} clip is invalid`);
    }
  }
  const block=spec.reactions?.block;
  if(block&&(!Number.isInteger(block.start)||block.start<0||!positiveInteger(block.count)||!Number.isFinite(block.fps)||block.fps<=0||block.loop!==false||block.start+block.count>spec.frameCount))throw new Error('Sample block clip is invalid');
  return {
    frameWidth,
    frameHeight,
    columns: spec.columns,
    frameCount: spec.frameCount,
    key: `${frameWidth}x${frameHeight}:${spec.columns}:${spec.frameCount}`,
  };
}

class SharedAtlasBank {
  private static readonly entries = new Map<string, AtlasEntry>();

  static retain(url: string, layout: AtlasLayout): AtlasLease {
    let entry = this.entries.get(url);
    if (entry && entry.layout.key !== layout.key) {
      throw new Error('Sample atlas layout conflicts with an active instance');
    }
    if (!entry) {
      this.makeRoom();
      if (this.entries.size >= MAX_ATLAS_ENTRIES) throw new Error('Sample atlas pool is full');
      let resolve!: (entry: AtlasEntry) => void;
      let reject!: (error: Error) => void;
      const ready = new Promise<AtlasEntry>((accept, decline) => { resolve = accept; reject = decline; });
      entry = { url, layout, refs: 1, state: 'pending', ready, resolve, reject };
      this.entries.set(url, entry);
      this.load(entry);
    } else {
      entry.refs++;
    }
    const retained = entry;
    let released = false;
    return {
      ready: retained.ready,
      release: () => {
        if (released) return;
        released = true;
        retained.refs = Math.max(0, retained.refs - 1);
        if (retained.refs === 0 && retained.state === 'ready') this.dispose(retained);
      },
    };
  }

  static stats() {
    const entries = Array.from(this.entries.values());
    return {
      atlasPoolEntries: entries.length,
      atlasPoolPendingEntries: entries.filter(entry => entry.state === 'pending').length,
      atlasPoolLiveReferences: entries.reduce((sum, entry) => sum + entry.refs, 0),
      atlasPoolSpriteFrames: entries.reduce((sum, entry) => sum + (entry.frames?.length ?? 0), 0),
    };
  }

  private static makeRoom(): void {
    if (this.entries.size < MAX_ATLAS_ENTRIES) return;
    const unused = Array.from(this.entries.values()).find(entry => entry.refs === 0);
    if (unused) this.dispose(unused, new Error('Sample atlas load was abandoned'));
  }

  private static load(entry: AtlasEntry): void {
    const extension = /\.jpe?g(?:$|[?#])/i.test(entry.url) ? '.jpg' : '.png';
    assetManager.loadRemote<ImageAsset>(entry.url, { ext: extension }, (error, image) => {
      if (entry.state !== 'pending') {
        if (image) assetManager.releaseAsset(image);
        return;
      }
      if (error || !image) {
        entry.state = 'failed';
        if (this.entries.get(entry.url) === entry) this.entries.delete(entry.url);
        entry.reject(new Error(`Unable to load sample atlas: ${entry.url}`));
        return;
      }
      const rows = Math.ceil(entry.layout.frameCount / entry.layout.columns);
      if (image.width < entry.layout.columns * entry.layout.frameWidth
          || image.height < rows * entry.layout.frameHeight) {
        assetManager.releaseAsset(image);
        entry.state = 'failed';
        if (this.entries.get(entry.url) === entry) this.entries.delete(entry.url);
        entry.reject(new Error('Sample atlas image is smaller than its frame layout'));
        return;
      }
      const texture = new Texture2D('SampleUnitAtlas');
      texture.image = image;
      const frames: SpriteFrame[] = [];
      for (let index = 0; index < entry.layout.frameCount; index++) {
        const frame = new SpriteFrame();
        frame.texture = texture;
        frame.rect = new Rect(
          (index % entry.layout.columns) * entry.layout.frameWidth,
          Math.floor(index / entry.layout.columns) * entry.layout.frameHeight,
          entry.layout.frameWidth,
          entry.layout.frameHeight,
        );
        frame.originalSize = new Size(entry.layout.frameWidth, entry.layout.frameHeight);
        frames.push(frame);
      }
      entry.image = image;
      entry.texture = texture;
      entry.frames = frames;
      entry.state = 'ready';
      if (entry.refs === 0) {
        entry.reject(new Error('Sample atlas load was abandoned'));
        this.dispose(entry);
        return;
      }
      entry.resolve(entry);
    });
  }

  private static dispose(entry: AtlasEntry, pendingError?: Error): void {
    if (this.entries.get(entry.url) === entry) this.entries.delete(entry.url);
    if (entry.state === 'pending') {
      entry.state = 'failed';
      entry.reject(pendingError ?? new Error('Sample atlas load was abandoned'));
      return;
    }
    for (const frame of entry.frames ?? []) if (frame.isValid !== false) frame.destroy();
    entry.frames = undefined;
    if (entry.texture && entry.texture.isValid !== false) entry.texture.destroy();
    entry.texture = undefined;
    if (entry.image) assetManager.releaseAsset(entry.image);
    entry.image = undefined;
    entry.state = 'failed';
  }
}

/** Runtime player for a bounded, pre-rendered unit sprite atlas. */
export class SampleUnitAnimation {
  readonly node: Node;
  readonly spriteNode: Node;
  readonly mountNode: Node;

  private readonly sprite: Sprite;
  private readonly layout: AtlasLayout;
  private readonly resolvedAtlasUrl: string;
  private lease?: AtlasLease;
  private entry?: AtlasEntry;
  private loadPromise?: Promise<void>;
  private playback?: ActivePlayback;
  private currentDirection: RecoveredAnimationDirection = 'east';
  private playbackGeneration = 0;
  private disposed = false;
  private readonly performance = {
    plays: 0,
    frameChanges: 0,
    cues: 0,
    completions: 0,
    cancellations: 0,
  };

  constructor(parent: Node, url: string, private readonly spec: SampleUnitSpec) {
    this.layout = validateSpec(spec);
    this.resolvedAtlasUrl = atlasUrl(url, spec.atlas);
    this.node = new Node('SampleUnitAnimation');
    this.node.layer = Layers.Enum.UI_2D;
    this.node.setParent(parent);
    this.node.setPosition(spec.origin?.[0] ?? 0, spec.origin?.[1] ?? 0);
    this.node.addComponent(UITransform).setContentSize(1, 1);

    this.spriteNode = new Node('SampleUnitSprite');
    this.spriteNode.layer = Layers.Enum.UI_2D;
    this.spriteNode.setParent(this.node);
    const transform = this.spriteNode.addComponent(UITransform);
    transform.setContentSize(spec.displaySize[0], spec.displaySize[1]);
    transform.setAnchorPoint(spec.foot[0] / this.layout.frameWidth, 1 - spec.foot[1] / this.layout.frameHeight);
    this.sprite = this.spriteNode.addComponent(Sprite);
    this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.spriteNode.active = false;

    this.mountNode = new Node('SampleUnitMount');
    this.mountNode.layer = Layers.Enum.UI_2D;
    this.mountNode.setParent(this.node);
    this.applyDirection('east');
  }

  load(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Sample unit has been destroyed'));
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadAtlas();
    return this.loadPromise;
  }

  play(status: RecoveredAnimationStatus, direction: RecoveredAnimationDirection,
       onAttack?: () => void, onComplete?: () => void, reaction?: 'block'): RecoveredPlaybackHandle {
    this.cancelActive();
    const generation = ++this.playbackGeneration;
    const entry = this.entry;
    const clip = reaction ? this.spec.reactions?.[reaction] as SampleUnitSpec['clips']['hit'] : this.spec.clips[status];
    if (this.disposed || !entry?.frames || !clip) {
      return { generation, status, statusName: null, durationSeconds: 0, cueSeconds: null,
        hasNativeState: false, completion: Promise.resolve(), cancel: () => undefined };
    }
    this.currentDirection = direction;
    this.applyDirection(direction);
    let resolve!: () => void;
    const completion = new Promise<void>(accept => { resolve = accept; });
    const playback: ActivePlayback = {
      generation,
      status,
      start: clip.start,
      count: clip.count,
      fps: clip.fps,
      loop: clip.loop,
      cueFrame: clip.cueFrame,
      elapsed: 0,
      displayedFrame: 0,
      cueFired: false,
      finished: false,
      onAttack,
      onComplete,
      resolve,
    };
    this.playback = playback;
    this.performance.plays++;
    this.setFrame(playback, 0);
    this.spriteNode.active = true;
    if (playback.cueFrame === 0) this.fireCue(playback);
    return {
      generation,
      status,
      statusName: reaction??status,
      durationSeconds: clip.count / clip.fps,
      cueSeconds: clip.cueFrame === undefined ? null : clip.cueFrame / clip.fps,
      hasNativeState: true,
      completion,
      cancel: () => this.cancelPlayback(generation),
    };
  }

  playBlock(direction:RecoveredAnimationDirection):RecoveredPlaybackHandle|null {
    return this.spec.reactions?.block?this.play('hit',direction,undefined,undefined,'block'):null;
  }

  update(dt: number): void {
    const playback = this.playback;
    if (!playback || playback.finished || this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    playback.elapsed += dt;
    if (!playback.cueFired && playback.cueFrame !== undefined
        && playback.elapsed >= playback.cueFrame / playback.fps) {
      this.fireCue(playback);
      if (this.playback !== playback || playback.finished) return;
    }
    const absoluteFrame = Math.floor(playback.elapsed * playback.fps);
    const displayFrame = playback.loop
      ? absoluteFrame % playback.count
      : Math.min(playback.count - 1, absoluteFrame);
    this.setFrame(playback, displayFrame);
    if (!playback.loop && playback.elapsed >= playback.count / playback.fps) this.complete(playback);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelActive();
    this.sprite.spriteFrame = null;
    this.node.destroy();
    this.entry = undefined;
    this.lease?.release();
    this.lease = undefined;
  }

  getSourceLayoutMetrics(direction: RecoveredAnimationDirection = this.currentDirection) {
    const scaleX = this.spec.displaySize[0] / this.layout.frameWidth;
    const scaleY = this.spec.displaySize[1] / this.layout.frameHeight;
    const anchorX = this.spec.foot[0] * scaleX;
    return {
      nominalWidth: this.spec.displaySize[0],
      nominalHeight: this.spec.displaySize[1],
      anchorX: direction === 'west' ? this.spec.displaySize[0] - anchorX : anchorX,
      anchorY: this.spec.foot[1] * scaleY,
      nameOffsetY: this.spec.nameOffsetY,
    };
  }

  /** Bounded counters only; no URL, asset, node, or unit identity is exposed. */
  getPerformanceStats() {
    return {
      ...SharedAtlasBank.stats(),
      instanceLoaded: this.entry?.state === 'ready',
      instancePlaying: Boolean(this.playback && !this.playback.finished),
      instanceFrame: this.playback?.displayedFrame ?? -1,
      ...this.performance,
    };
  }

  private async loadAtlas(): Promise<void> {
    try {
      this.lease = SharedAtlasBank.retain(this.resolvedAtlasUrl, this.layout);
      const entry = await this.lease.ready;
      if (this.disposed) throw new Error('Sample unit has been destroyed');
      this.entry = entry;
    } catch (error) {
      this.lease?.release();
      this.lease = undefined;
      if (this.disposed) throw new Error('Sample unit has been destroyed');
      throw error instanceof Error ? error : new Error('Unable to load sample atlas');
    }
  }

  private applyDirection(direction: RecoveredAnimationDirection): void {
    this.spriteNode.setScale(direction === 'west' ? -1 : 1, 1, 1);
    const scaleX = this.spec.displaySize[0] / this.layout.frameWidth;
    const scaleY = this.spec.displaySize[1] / this.layout.frameHeight;
    const mountX = (this.spec.mount[0] - this.spec.foot[0]) * scaleX;
    const mountY = (this.spec.foot[1] - this.spec.mount[1]) * scaleY;
    this.mountNode.setPosition(direction === 'west' ? -mountX : mountX, mountY, 0);
  }

  private setFrame(playback: ActivePlayback, frame: number): void {
    if (frame === playback.displayedFrame && this.sprite.spriteFrame) return;
    const spriteFrame = this.entry?.frames?.[playback.start + frame];
    if (!spriteFrame) return;
    this.sprite.spriteFrame = spriteFrame;
    playback.displayedFrame = frame;
    this.performance.frameChanges++;
  }

  private fireCue(playback: ActivePlayback): void {
    if (this.playback !== playback || playback.finished || playback.cueFired) return;
    playback.cueFired = true;
    this.performance.cues++;
    const callback = playback.onAttack;
    playback.onAttack = undefined;
    callback?.();
  }

  private complete(playback: ActivePlayback): void {
    if (this.playback !== playback || playback.finished) return;
    playback.finished = true;
    this.performance.completions++;
    const callback = playback.onComplete;
    const resolve = playback.resolve;
    playback.onAttack = undefined;
    playback.onComplete = undefined;
    playback.resolve = undefined;
    try {
      callback?.();
    } finally {
      resolve?.();
    }
  }

  private cancelPlayback(generation: number): void {
    const playback = this.playback;
    if (!playback || playback.generation !== generation || playback.finished) return;
    this.cancel(playback);
  }

  private cancelActive(): void {
    const playback = this.playback;
    if (playback && !playback.finished) this.cancel(playback);
  }

  private cancel(playback: ActivePlayback): void {
    playback.finished = true;
    this.performance.cancellations++;
    const resolve = playback.resolve;
    playback.onAttack = undefined;
    playback.onComplete = undefined;
    playback.resolve = undefined;
    resolve?.();
  }
}
