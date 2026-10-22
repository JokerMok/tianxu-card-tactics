import { BlockInputEvents, Button, Color, Node, UIOpacity } from 'cc';
import { CocosUi, Theme } from './CocosUi.ts';
import type { OriginalUi } from './OriginalUi.ts';
import type { RecoveredCatalog } from './RecoveredContent.ts';
import { presentationName } from './GameText.ts';

interface SceneNodeView {
  id: string;
  originalId: string;
  name: string;
  story?: string;
  x: number;
  y: number;
  cleared: boolean;
  accessible: boolean;
  battle: boolean;
  transitions: number[];
  triggers: { id: string; name: string; repeat: number }[];
}

interface SceneView {
  id: string;
  name: string;
  unlocked: boolean;
  minLevel: number;
  nodes: SceneNodeView[];
}

interface DungeonView { name: string; easy?: number; normal?: number; hard?: number }
interface WorldState { scenes: SceneView[]; dungeons: DungeonView[] }

interface Callbacks {
  close(): void;
  enter(sceneId: number): void;
  transition(nodeId: string): void;
  challenge(node: SceneNodeView): void;
  dungeon(sceneId: number): void;
}

interface Landmark {
  sceneId: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

const REGION_NAMES_ZH: Record<number, string> = {
  1: '银鹭岭', 2: '凛冬丘陵', 3: '雪岭', 4: '精灵心木', 5: '荒野草原',
  6: '圣战军遗迹', 7: '迷雾沼泽', 8: '失落之地', 9: '沙漠遗迹', 10: '禁区',
  11: '龙眠圣殿', 12: '沉睡森林', 13: '烈火草原', 14: '沙之疮痕', 15: '神秘之地',
  16: '冰雪之地', 17: '空中群岛', 18: '混沌巢穴', 19: '低语森林',
};

const MAP_ONE: Landmark[] = [
  { sceneId: 1, left: 293.3, top: 3.35, width: 194, height: 193 },
  { sceneId: 2, left: 136.85, top: 7.85, width: 187, height: 125 },
  { sceneId: 3, left: 0, top: 44.35, width: 315, height: 201 },
  { sceneId: 4, left: 247.85, top: 88.4, width: 155, height: 177 },
  { sceneId: 5, left: 422.75, top: 1.35, width: 241, height: 251 },
  { sceneId: 6, left: 387.85, top: 195.85, width: 193, height: 166 },
  { sceneId: 7, left: 275.8, top: 204.3, width: 194, height: 198 },
  { sceneId: 8, left: 72.85, top: 199.3, width: 292, height: 248 },
  { sceneId: 9, left: 387.85, top: 313, width: 188, height: 130 },
  { sceneId: 10, left: 505.95, top: 235.8, width: 196, height: 193 },
];

const MAP_TWO: Landmark[] = [
  { sceneId: 11, left: 72.3, top: 36.5, width: 206, height: 183 },
  { sceneId: 12, left: 234.8, top: 49.85, width: 155, height: 161 },
  { sceneId: 13, left: 154.35, top: 200.8, width: 124, height: 122 },
  { sceneId: 14, left: 75.35, top: 145.35, width: 124, height: 122 },
  { sceneId: 15, left: 44.8, top: 219.5, width: 186, height: 231 },
  { sceneId: 16, left: 197.8, top: 193.55, width: 307, height: 266 },
  { sceneId: 17, left: 343, top: 136, width: 189, height: 169 },
  { sceneId: 18, left: 402, top: 32, width: 220, height: 188 },
  { sceneId: 19, left: 493, top: 166.05, width: 162, height: 138 },
];

/** Source-faithful WorldMapWnd/SencePane adapter over the service snapshot. */
export class WorldMapWindow {
  private root?: Node;
  private mode: 'world' | 'scene' = 'world';
  private mapPage: 1 | 2 = 1;
  private selectedScene = 1;
  private dungeonPage = 0;

  constructor(
    private readonly ui: CocosUi,
    private readonly original: OriginalUi,
    private readonly catalog: RecoveredCatalog,
    private readonly base: string,
    private readonly callbacks: Callbacks,
  ) {
    const resourceBase = `${base.replace(/\/$/, '')}/recovered/`;
    this.ui.configureOriginal(original, resourceBase);
  }

  render(parent: Node, state: any, selectedScene: number): void {
    const worldState = state as WorldState;
    if (this.root?.isValid) { this.root.removeFromParent(); this.root.destroy(); }
    this.selectedScene = selectedScene;
    this.root = this.ui.node(parent, 'OriginalWorldMapWindow', 777, 513, 0, -4);
    this.root.addComponent(BlockInputEvents);
    this.ui.skin(this.root, 'WorldMap:Frame', 'kphcbj_1_2', 0, 0, 777, 513);
    this.ui.label(this.root, 'WorldMap:Title', '世界地图', 0, 235, 104, 26, 15, new Color(255, 232, 174));
    this.ui.button(this.root, 'WorldMap:Close', '×', 351, 230, 32, 26, this.callbacks.close);

    const content = this.ui.node(this.root, 'WorldMap:Content', 740, 450, 0, -9);
    if (this.mode === 'scene') this.renderScene(content, worldState);
    else this.renderAtlas(content, worldState);
  }

  private renderAtlas(parent: Node, state: WorldState): void {
    const landmarks = this.mapPage === 1 ? MAP_ONE : MAP_TWO;
    this.ui.skin(parent, `WorldMap:Background:${this.mapPage}`, `worldmap-background-${this.mapPage}`, 0, 4.5, 740, 441);
    for (const landmark of landmarks) {
      const scene = state.scenes.find(candidate => candidate.id === `main:scene:${landmark.sceneId}`);
      if (!scene) continue;
      const x = landmark.left - 370 + landmark.width / 2;
      const y = 225 - landmark.top - landmark.height / 2;
      const region = this.ui.node(parent, `WorldMap:Region:${landmark.sceneId}`,
        landmark.width, landmark.height, x, y);
      void this.ui.image(region, `WorldMap:RegionArt:${landmark.sceneId}`,
        this.uiAsset(`worldmap-region-${landmark.sceneId}-textless.png`), landmark.width, landmark.height).then(art => {
          if (art.isValid && !scene.unlocked) art.addComponent(UIOpacity).opacity = 115;
        });
      const hitTarget = this.ui.button(region, `WorldMap:Scene:${landmark.sceneId}`, '', 0, 0,
        landmark.width, landmark.height, () => this.openScene(parent.parent!, state, landmark.sceneId), !scene.unlocked, true);
      if (!scene.unlocked) hitTarget.getComponent(Button)!.enabled = false;
      this.ui.label(hitTarget, `WorldMap:RegionName:${landmark.sceneId}`,
        `第${landmark.sceneId}区\n${this.regionName(landmark.sceneId)}`, 0, 0,
        Math.min(148, landmark.width - 12), 42, 13, scene.unlocked ? new Color(255, 232, 174) : Theme.dim);
    }
    const hasSecondMap = state.scenes.some(scene => scene.unlocked && Number(scene.id.split(':').at(-1)) > 10);
    if (this.mapPage === 1 && hasSecondMap) {
      this.ui.sourceButton(parent, 'WorldMap:NextAtlas', 'ajqwxdl', '', '', 315, -177, 94, 92,
        () => { this.mapPage = 2; this.render(parent.parent!.parent!, state, this.selectedScene); });
    } else if (this.mapPage === 2) {
      this.ui.sourceButton(parent, 'WorldMap:PreviousAtlas', 'ajqwjdl', '', '', -318, 178, 94, 92,
        () => { this.mapPage = 1; this.render(parent.parent!.parent!, state, this.selectedScene); });
    }
  }

  private openScene(windowParent: Node, state: WorldState, sceneId: number): void {
    this.mode = 'scene';
    this.selectedScene = sceneId;
    this.callbacks.enter(sceneId);
    const host = windowParent.parent;
    if (host?.isValid) this.render(host, state, sceneId);
  }

  private renderScene(parent: Node, state: WorldState): void {
    const scene = state.scenes.find(candidate => candidate.id === `main:scene:${this.selectedScene}` && candidate.unlocked)
      ?? state.scenes.find(candidate => candidate.unlocked);
    if (!scene) {
      this.ui.label(parent, 'WorldMap:Empty', '暂无已解锁场景', 0, 0, 400, 40, 18);
      return;
    }
    this.selectedScene = Number(scene.id.split(':').at(-1));
    const chapter = Number(scene.id.split(':').at(-1));
    const originalScene = this.catalog.scopes.main.scenes.find(candidate => candidate.id === scene.id);
    const background = String(originalScene?.header.background ?? '').replaceAll('\\', '/').toLowerCase();
    const asset = Object.values(this.catalog.assets).find(candidate =>
      String((candidate as unknown as { container?: string }).container ?? '').replaceAll('\\', '/').toLowerCase().endsWith(background));
    if (chapter >= 1 && chapter <= 19) {
      void this.ui.image(parent, 'WorldMap:SceneBackground',
        this.uiAsset(`scene-background-${chapter}-textless.jpg`), 740, 441, 0, 4.5);
    } else if (asset?.path) {
      void this.ui.image(parent, 'WorldMap:SceneBackground', this.recoveredUrl(asset.path), 740, 441, 0, 4.5);
    }

    for (const node of scene.nodes) {
      if (!node.battle && node.transitions.length === 0) continue;
      const repeat = node.cleared || node.triggers.every(trigger => trigger.repeat > 0);
      const skin = repeat ? 'scene-trigger-blue' : 'scene-trigger-red';
      const width = node.transitions.length ? 55 : 64;
      const height = node.transitions.length ? 36 : 91;
      const x = node.x - 370;
      const y = 220.5 - node.y;
      if (node.transitions.length) {
        const trigger = this.ui.node(parent, `WorldMap:Transition:${node.originalId}`, width, height, x, y);
        this.ui.sourceButton(trigger, `WorldMap:Node:${node.originalId}`, 'ajda_1', '', '前往', 0, 0,
          width, height, () => this.callbacks.transition(node.id), !node.accessible);
      } else {
        this.ui.sourceButton(parent, `WorldMap:Node:${node.originalId}`, skin, '', '', x, y, width, height,
          () => this.callbacks.challenge(node), !node.accessible);
      }
      this.ui.label(parent, `WorldMap:NodeLabel:${node.originalId}`,
        `${node.cleared ? '✓ ' : ''}${presentationName(node.name)}`, x, y - height / 2 - 10, 150, 32, 12,
        node.accessible ? Color.WHITE : Theme.dim);
    }

    this.ui.button(parent, 'WorldMap:BackToAtlas', '返回世界地图', -285, -198, 140, 30,
      () => { this.mode = 'world'; this.render(parent.parent!.parent!, state, this.selectedScene); });
    this.ui.button(parent, 'WorldMap:Dungeon', '副本选择', 285, -198, 120, 30,
      () => this.renderDungeonChooser(parent, state));
    this.ui.label(parent, 'WorldMap:Chapter', `第${chapter}章\n${this.regionName(chapter)}`, 297, 197,
      116, 44, 13, new Color(62, 37, 17)).enableOutline = false;
    this.ui.label(parent, 'WorldMap:SceneName', `${this.regionName(chapter)} · 第${chapter}章`,
      0, 205, 300, 28, 16, new Color(255, 232, 174));
  }

  private renderDungeonChooser(parent: Node, state: WorldState): void {
    const previous = parent.getChildByName('WorldMap:DungeonChooser');
    if (previous?.isValid) { previous.removeFromParent(); previous.destroy(); }
    const overlay = this.ui.node(parent, 'WorldMap:DungeonChooser', 740, 450);
    this.ui.panel(overlay, 'WorldMap:DungeonShade', 740, 450, 0, 0, new Color(0, 0, 0, 165));
    const panel = this.ui.skin(overlay, 'WorldMap:DungeonFrame', 'kpglk_1', 0, 0, 477, 346);
    this.ui.label(panel, 'WorldMap:DungeonTitle', '副本与难度', 0, 140, 260, 28, 18,
      new Color(255, 232, 174));
    const difficulties = [
      ['easy', '简单'], ['normal', '普通'], ['hard', '困难'],
    ] as const;
    const choices = (state.dungeons || []).flatMap(row => difficulties
      .filter(([key]) => Number(row[key] || 0) > 0)
      .map(([key, label]) => ({ name: presentationName(row.name), label, sceneId: Number(row[key]) })));
    this.dungeonPage = Math.max(0, Math.min(this.dungeonPage, Math.ceil(choices.length / 12) - 1));
    const visible = choices.slice(this.dungeonPage * 12, this.dungeonPage * 12 + 12);
    visible.forEach((choice, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      this.ui.button(panel, `WorldMap:Dungeon:${choice.sceneId}`, `${choice.name} · ${choice.label}`,
        -116 + column * 232, 96 - row * 40, 216, 32,
        () => this.callbacks.dungeon(choice.sceneId));
    });
    if (!visible.length) this.ui.label(panel, 'WorldMap:DungeonEmpty', '暂无可进入副本', 0, 20, 300, 40, 16);
    if (choices.length > visible.length) {
      this.ui.label(panel, 'WorldMap:DungeonPage', `${this.dungeonPage + 1}/${Math.ceil(choices.length / 12)}`, 0, -126, 100, 22, 12, Theme.dim);
      this.ui.button(panel, 'WorldMap:DungeonPrevious', '‹', -154, -126, 50, 23, () => { this.dungeonPage--; this.renderDungeonChooser(parent, state); }, this.dungeonPage === 0);
      this.ui.button(panel, 'WorldMap:DungeonNext', '›', 154, -126, 50, 23, () => { this.dungeonPage++; this.renderDungeonChooser(parent, state); }, (this.dungeonPage + 1) * 12 >= choices.length);
    }
    this.ui.button(panel, 'WorldMap:DungeonClose', '关闭', 0, -145, 100, 28,
      () => { if (overlay.isValid) { overlay.removeFromParent(); overlay.destroy(); } });
  }

  private recoveredUrl(path: string): string {
    return `${this.base.replace(/\/$/, '')}/recovered/${path.replace(/^\//, '')}`;
  }

  private uiAsset(file: string): string {
    return `${this.base.replace(/\/$/, '')}/ui-assets/${file}`;
  }

  private regionName(sceneId: number): string {
    return REGION_NAMES_ZH[sceneId] ?? `区域${sceneId}`;
  }
}
