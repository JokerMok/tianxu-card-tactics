import { AudioClip, AudioSource, Node, assetManager } from 'cc';
import type { RecoveredCatalog } from './RecoveredContent.ts';

export class GameAudio {
  private music: AudioSource;
  private effects: AudioSource;
  private clips = new Map<string, Promise<AudioClip>>();
  private musicId = '';
  private enabledEffects = true;
  private musicEpoch = 0;
  constructor(host: Node, private catalog: RecoveredCatalog, private baseUrl: string) {
    this.music = host.addComponent(AudioSource); this.music.loop = true; this.music.volume = .35;
    const child = new Node('GameSound'); host.addChild(child); this.effects = child.addComponent(AudioSource); this.effects.volume = .6;
  }
  private clip(id: string) {
    let pending = this.clips.get(id);
    if (!pending) {
      const path = this.catalog.assets[id]?.path;
      if (!path) return Promise.reject(new Error('音频未导入'));
      pending = new Promise<AudioClip>((resolve, reject) => assetManager.loadRemote<AudioClip>(this.baseUrl + path,
        { ext: path.endsWith('.ogg') ? '.ogg' : '.mp3' }, (error, clip) => error ? reject(error) : resolve(clip)));
      this.clips.set(id, pending);
    }
    return pending;
  }
  sync(mapId: number, settings: Record<string, boolean>) {
    this.enabledEffects = settings.sound !== false;
    const id = this.catalog.scopes.main.maps[String(mapId)]?.sound?.asset_ids[0] ?? '';
    if (settings.music === false || !id) { this.music.stop(); this.musicId = ''; this.musicEpoch++; return; }
    if (id === this.musicId) return;
    this.musicId = id; const epoch = ++this.musicEpoch;
    void this.clip(id).then(clip => {
      if (epoch !== this.musicEpoch || !this.music.isValid) return;
      this.music.stop(); this.music.clip = clip; this.music.play();
    }).catch(() => { if (epoch === this.musicEpoch) this.musicId = ''; });
  }
  shot(skillId = 0) {
    if (!this.enabledEffects) return;
    const id = this.catalog.scopes.main.skills[String(skillId)]?.soundAssets?.[0];
    if (id) void this.clip(id).then(clip => { if (this.effects.isValid) this.effects.playOneShot(clip, .6); }).catch(() => undefined);
  }
  destroy() { this.music.stop(); this.effects.stop(); }
}
