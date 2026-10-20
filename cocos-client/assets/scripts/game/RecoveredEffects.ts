import { Layers, Node } from 'cc';
import { RecoveredAnimation } from './RecoveredAnimation.ts';
import type { RecoveredAnimationDirection } from './RecoveredAnimation.ts';
import type { RecoveredCatalog } from './RecoveredContent.ts';

interface ActiveEffect {
  host: Node;
  animation: RecoveredAnimation;
  ready: boolean;
  cancelled: boolean;
}

/** Plays source-backed skill visuals at Cocos battlefield design coordinates. */
export class RecoveredEffects {
  private readonly node: Node;
  private readonly active = new Set<ActiveEffect>();
  private disposed = false;

  constructor(parent: Node, private readonly catalog: RecoveredCatalog,
              private readonly assetBaseUrl: string) {
    this.node = new Node('RecoveredEffects');
    this.node.layer = Layers.Enum.UI_2D;
    this.node.setParent(parent);
  }

  play(skillId: number, x: number, y: number,
       direction: RecoveredAnimationDirection): void {
    if (this.disposed) return;
    const skill = this.catalog.scopes.main.skills[String(skillId)];
    if (!skill?.visualModels?.length) return;
    for (const modelId of skill.visualModels) this.spawnModel(modelId, x, y, direction);
  }

  update(dt: number): void {
    if (this.disposed || dt <= 0) return;
    for (const effect of Array.from(this.active)) {
      if (!effect.ready) continue;
      effect.animation.update(dt);
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const effect of Array.from(this.active)) this.release(effect);
    this.node.destroy();
  }

  private spawnModel(modelId: string, x: number, y: number,
                     direction: RecoveredAnimationDirection): void {
    const host = new Node(`RecoveredEffect-${modelId}`);
    host.layer = Layers.Enum.UI_2D;
    host.setParent(this.node);
    host.setPosition(x, y);
    const animation = new RecoveredAnimation(host, this.catalog, this.assetBaseUrl);
    const effect: ActiveEffect = { host, animation, ready: false, cancelled: false };
    this.active.add(effect);
    void animation.setModels([modelId]).then(() => {
      if (this.disposed || effect.cancelled) return;
      const playback = animation.playOneShot(direction, () => this.release(effect));
      if (!playback) {
        this.release(effect);
        return;
      }
      animation.node.setPosition(playback.offsetX, playback.offsetY);
      effect.ready = true;
    }).catch(error => {
      if (!effect.cancelled && !this.disposed) {
        console.warn(`[RecoveredEffects] Unable to play ${modelId}`, error);
      }
      this.release(effect);
    });
  }

  private release(effect: ActiveEffect): void {
    if (effect.cancelled) return;
    effect.cancelled = true;
    this.active.delete(effect);
    effect.animation.destroy();
    if (effect.host.isValid) effect.host.destroy();
  }
}
