import {
  _decorator,
  Button,
  Color,
  Component,
  Graphics,
  HorizontalTextAlignment,
  ImageAsset,
  Label,
  Layers,
  Node,
  Rect,
  ResolutionPolicy,
  resources,
  Sprite,
  SpriteFrame,
  Texture2D,
  tween,
  UIOpacity,
  UITransform,
  Vec3,
  VerticalTextAlignment,
  view,
} from 'cc';
import { GameShell } from '../meta/GameShell';

const { ccclass } = _decorator;

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const LANES = 2;
const CELLS_PER_LANE = 12;
const SUMMON_DEPTH = 3;
const STRESS_UNIT_COUNT = 24;
const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 500;
const BOARD_Y = 44;
const CELL_WIDTH = BOARD_WIDTH / CELLS_PER_LANE;
const LANE_HEIGHT = BOARD_HEIGHT / LANES;
const COMMANDER_X = 820;

const palette = {
  background: new Color(21, 24, 23, 255),
  cloud: new Color(220, 228, 224, 255),
  mountainFar: new Color(148, 164, 158, 255),
  mountainNear: new Color(102, 119, 112, 255),
  surface: new Color(24, 28, 27, 245),
  surfaceRaised: new Color(48, 53, 49, 255),
  laneUpper: new Color(225, 224, 207, 24),
  laneLower: new Color(98, 105, 95, 34),
  line: new Color(181, 173, 143, 138),
  bone: new Color(245, 242, 229, 255),
  textMuted: new Color(204, 207, 196, 255),
  jade: new Color(49, 177, 132, 255),
  vermilion: new Color(201, 72, 58, 255),
  gold: new Color(201, 164, 85, 255),
  blackIron: new Color(20, 23, 22, 255),
};

interface A0Metrics {
  ready: boolean;
  lanes: number;
  cells: number;
  legalDeploymentCells: number;
  commanders: number;
  commandersOutsideGrid: boolean;
  commanderCenterErrorPx: number;
  activeUnits: number;
  enemyHp: number;
  hitCount: number;
  stressMode: boolean;
  assetsReady: boolean;
  loadedVisualAssets: number;
  previewPoseAssets: number;
  spineAssets: number;
  artMode: 'preview-pose';
  artIntegrationComplete: boolean;
  runtimeUnitSprites: number;
  stressRenderer: 'individual-sprites';
  unitMotion: 'idle-breathing';
  selectedCard: number;
  activeDeploymentMarkers: number;
}

@ccclass('BattleA0Bootstrap')
export class BattleA0Bootstrap extends Component {
  private root!: Node;
  private board!: Node;
  private boardTextureHost!: Node;
  private unitLayer!: Node;
  private playerCommander!: Node;
  private enemyCommander!: Node;
  private enemyFlash!: Node;
  private enemyHpBar!: Node;
  private enemyHpLabel!: Label;
  private selectedCard = -1;
  private enemyHp = 3600;
  private hitCount = 0;
  private activeUnits = 0;
  private stressMode = false;
  private occupied = new Set<string>();
  private commanderArtHosts = new Map<'player' | 'enemy', Node>();
  private handArtHosts = new Map<number, Node>();
  private handCards: Node[] = [];
  private handSelectionGlows: Node[] = [];
  private deploymentMarkers: Node[] = [];
  private deploymentHint!: Node;
  private unitFrames = new Map<'U002' | 'U008', SpriteFrame[]>();
  private loadedVisualAssets = new Set<string>();
  private unitPreviewEntries = new Map<Node, {
    sprite: Sprite;
    frames: SpriteFrame[];
    facing: number;
    phase: number;
    speed: number;
    amplitude: number;
  }>();
  private metrics!: A0Metrics;
  private gameShell!: GameShell;

  onLoad(): void {
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.SHOW_ALL);
    this.node.getComponent(UITransform)!.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    this.node.setPosition(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
    this.root = new Node('BattleA0Root');
    this.root.layer = Layers.Enum.UI_2D;
    this.root.setParent(this.node);
    this.addTransform(this.root, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.buildScene();
    this.publishHarness();
    void this.loadRuntimeArt();
    this.gameShell = new GameShell(this.node, this.root);
    this.gameShell.mount();
  }

  onDestroy(): void {
    const runtime = globalThis as Record<string, unknown>;
    delete runtime.__A0_METRICS__;
    delete runtime.__A0_ENABLE_STRESS__;
    delete runtime.__A0_TRIGGER_HIT__;
    delete runtime.__A0_SELECT_CARD__;
    delete runtime.__A0_DEPLOY__;
    delete runtime.__A0_IDLE_PHASE__;
    delete runtime.__META_BATTLE_COMPLETE__;
    delete runtime.__META_STATE__;
    delete runtime.__META_NAVIGATE__;
    delete runtime.__META_RESET__;
    delete runtime.__META_TEST__;
    delete runtime.__META_ART_PAGE__;
  }

  update(deltaTime: number): void {
    for (const [art, idle] of this.unitPreviewEntries) {
      idle.phase += deltaTime * idle.speed;
      const breath = (Math.sin(idle.phase) + 1) * 0.5;
      art.setPosition(0, -2 + breath * idle.amplitude, 0);
      art.setScale(idle.facing, 1 + breath * 0.012, 1);
    }
  }

  private buildScene(): void {
    this.drawBackground();
    this.drawHud();
    this.drawBoard();
    this.drawCommanders();
    this.drawHand();
    this.spawnInitialUnits();
  }

  private drawBackground(): void {
    this.createPanel(this.root, 'Background', DESIGN_WIDTH, DESIGN_HEIGHT, 0, 0, palette.background);
    const scenery = this.createGraphicsNode(this.root, 'E104-Placeholder', DESIGN_WIDTH, 760, 0, 150);
    const graphics = scenery.getComponent(Graphics)!;
    graphics.fillColor = palette.cloud;
    graphics.rect(-DESIGN_WIDTH / 2, -380, DESIGN_WIDTH, 760);
    graphics.fill();

    graphics.fillColor = palette.mountainFar;
    graphics.moveTo(-960, -150);
    graphics.lineTo(-960, 30);
    graphics.lineTo(-760, 170);
    graphics.lineTo(-590, 20);
    graphics.lineTo(-370, 190);
    graphics.lineTo(-150, 30);
    graphics.lineTo(80, 205);
    graphics.lineTo(300, 25);
    graphics.lineTo(520, 155);
    graphics.lineTo(720, 5);
    graphics.lineTo(960, 160);
    graphics.lineTo(960, -150);
    graphics.close();
    graphics.fill();

    graphics.fillColor = palette.mountainNear;
    graphics.moveTo(-960, -170);
    graphics.lineTo(-960, -20);
    graphics.lineTo(-700, 100);
    graphics.lineTo(-460, -30);
    graphics.lineTo(-180, 115);
    graphics.lineTo(60, -15);
    graphics.lineTo(350, 105);
    graphics.lineTo(590, -20);
    graphics.lineTo(820, 80);
    graphics.lineTo(960, 10);
    graphics.lineTo(960, -170);
    graphics.close();
    graphics.fill();

    this.createPanel(this.root, 'Terrace', DESIGN_WIDTH, 480, 0, -350, new Color(25, 29, 27, 255));
    this.createPanel(this.root, 'TerraceHighlight', DESIGN_WIDTH, 3, 0, -112, new Color(162, 148, 109, 120));

    const artHost = new Node('E104-ArtHost');
    artHost.layer = Layers.Enum.UI_2D;
    artHost.setParent(this.root);
    artHost.setPosition(0, 160);
    this.addTransform(artHost, DESIGN_WIDTH, 760);

    const floorHost = new Node('E104-FloorHost');
    floorHost.layer = Layers.Enum.UI_2D;
    floorHost.setParent(this.root);
    floorHost.setPosition(0, -335);
    this.addTransform(floorHost, DESIGN_WIDTH, 430);
  }

  private drawHud(): void {
    this.createHudSide('PlayerHud', -670, palette.jade, '我方主将', '3600 / 3600');
    this.createHudSide('EnemyHud', 670, palette.vermilion, '敌方主将', '3600 / 3600', true);

    const controls = this.createPanel(this.root, 'TopControls', 500, 62, 0, 500, new Color(0, 0, 0, 0));
    this.createButton(controls, 'Pause', 'Ⅱ', -218, 0, 46, 44, palette.surfaceRaised, () => undefined);
    this.createButton(controls, 'Surrender', '⚑', -166, 0, 46, 44, palette.surfaceRaised, () => undefined, palette.vermilion);
    this.createPanel(controls, 'RoundPlate', 112, 50, -73, 0, new Color(16, 19, 18, 178));
    this.createLabel(controls, 'Round', '1 / 12', -73, 8, 104, 28, 22, palette.bone);
    this.createLabel(controls, 'Window', '行动阶段', -73, -16, 104, 18, 11, palette.gold);
    this.createButton(controls, 'Speed', '1×', 23, 0, 58, 44, palette.surfaceRaised, () => undefined);
    this.createButton(controls, 'Auto', '托管', 91, 0, 68, 44, palette.surfaceRaised, () => undefined);
    this.createButton(controls, 'Deck', '▣ 25', 177, 0, 82, 44, palette.surfaceRaised, () => undefined);
  }

  private createHudSide(name: string, x: number, accent: Color, title: string, hp: string, enemy = false): void {
    const hud = this.createPanel(this.root, name, 540, 62, x, 500, new Color(0, 0, 0, 0));
    this.createLabel(hud, `${name}-Title`, title, enemy ? 206 : -206, 11, 104, 24, 14, accent);
    const hpLabel = this.createLabel(hud, `${name}-HpLabel`, hp, 0, 9, 220, 26, 21, palette.bone).getComponent(Label)!;
    this.createPanel(hud, `${name}-Track`, 486, 9, 0, -19, palette.blackIron);
    const bar = this.createPanel(hud, `${name}-Bar`, 482, 5, 0, -19, accent);
    if (enemy) {
      this.enemyHpLabel = hpLabel;
      this.enemyHpBar = bar;
    }
  }

  private drawBoard(): void {
    this.createPanel(this.root, 'BoardShadow', BOARD_WIDTH + 12, BOARD_HEIGHT + 14, 0, BOARD_Y - 5, new Color(8, 10, 9, 72));
    this.board = this.createPanel(this.root, 'BattleBoard', BOARD_WIDTH, BOARD_HEIGHT, 0, BOARD_Y, new Color(18, 21, 20, 108), new Color(184, 153, 88, 128), 1);
    this.boardTextureHost = new Node('BoardTextureHost');
    this.boardTextureHost.layer = Layers.Enum.UI_2D;
    this.boardTextureHost.setParent(this.board);
    this.addTransform(this.boardTextureHost, BOARD_WIDTH, BOARD_HEIGHT);
    for (let lane = 0; lane < LANES; lane += 1) {
      const laneY = lane === 0 ? LANE_HEIGHT / 2 : -LANE_HEIGHT / 2;
      this.createPanel(
        this.board,
        `Lane-${lane + 1}`,
        BOARD_WIDTH,
        LANE_HEIGHT,
        0,
        laneY,
        lane === 0 ? palette.laneUpper : palette.laneLower,
      );
      for (let cell = 0; cell < CELLS_PER_LANE; cell += 1) {
        const cellX = -BOARD_WIDTH / 2 + CELL_WIDTH / 2 + cell * CELL_WIDTH;
        const fill = new Color(255, 255, 255, cell % 2 === 0 ? 6 : 1);
        const cellNode = this.createPanel(
          this.board,
          `Cell-${lane}-${cell}`,
          CELL_WIDTH,
          LANE_HEIGHT,
          cellX,
          laneY,
          fill,
          new Color(197, 194, 171, 48),
          1,
        );
        this.createLabel(cellNode, 'Index', String(cell + 1), -46, 99, 20, 18, 10, new Color(240, 235, 215, 72));
        if (cell < SUMMON_DEPTH) {
          const marker = this.createPanel(cellNode, 'DeployMarker', 34, 3, 0, -110, palette.gold);
          marker.active = false;
          this.deploymentMarkers.push(marker);
          cellNode.addComponent(Button);
          cellNode.on(Node.EventType.TOUCH_END, () => this.deploySelected(lane, cell), this);
        }
      }
    }
    this.createPanel(this.board, 'LaneDivider', BOARD_WIDTH, 2, 0, 0, new Color(210, 178, 103, 190));
    this.createLabel(this.board, 'UpperLane', '上路', -670, 99, 44, 22, 12, new Color(239, 232, 205, 158));
    this.createLabel(this.board, 'LowerLane', '下路', -670, -99, 44, 22, 12, new Color(239, 232, 205, 158));
    const clash = this.createPanel(this.board, 'ClashMark', 18, 18, 0, 0, new Color(31, 35, 32, 230), palette.gold, 2);
    clash.setRotationFromEuler(0, 0, 45);
    this.unitLayer = new Node('UnitLayer');
    this.unitLayer.layer = Layers.Enum.UI_2D;
    this.unitLayer.setParent(this.board);
    this.addTransform(this.unitLayer, BOARD_WIDTH, BOARD_HEIGHT);
  }

  private drawCommanders(): void {
    this.playerCommander = this.createCommander('PlayerCommander', -COMMANDER_X, BOARD_Y, '岳沉戈', palette.jade, false);
    this.enemyCommander = this.createCommander('EnemyCommander', COMMANDER_X, BOARD_Y, '晏归', palette.vermilion, true);
    this.enemyCommander.addComponent(Button);
    this.enemyCommander.on(Node.EventType.TOUCH_END, () => this.triggerEnemyHit(), this);
    this.enemyFlash = this.createPanel(
      this.enemyCommander,
      'HitFlash',
      218,
      650,
      0,
      0,
      new Color(245, 242, 229, 220),
      palette.vermilion,
      3,
    );
    this.enemyFlash.addComponent(UIOpacity).opacity = 0;
  }

  private createCommander(name: string, x: number, y: number, label: string, accent: Color, enemy: boolean): Node {
    const commander = this.createPanel(this.root, name, 228, 666, x, y, new Color(12, 15, 14, 0));
    const ornament = this.createGraphicsNode(commander, `${name}-Ornament`, 220, 640, 0, 0);
    const ornamentGraphics = ornament.getComponent(Graphics)!;
    ornamentGraphics.lineWidth = 3;
    ornamentGraphics.strokeColor = new Color(190, 156, 91, 170);
    ornamentGraphics.circle(0, 156, 92);
    ornamentGraphics.stroke();
    ornamentGraphics.lineWidth = 1;
    ornamentGraphics.circle(0, 156, 108);
    ornamentGraphics.stroke();
    const figure = this.createGraphicsNode(commander, `${name}-Figure`, 210, 600, 0, 6);
    const graphics = figure.getComponent(Graphics)!;
    graphics.fillColor = new Color(accent.r, accent.g, accent.b, 190);
    graphics.circle(0, 88, 34);
    graphics.fill();
    graphics.roundRect(-42, -64, 84, 138, 20);
    graphics.fill();
    graphics.lineWidth = 12;
    graphics.strokeColor = accent;
    graphics.moveTo(enemy ? -30 : 30, 32);
    graphics.lineTo(enemy ? 54 : -54, -45);
    graphics.stroke();
    const artHost = new Node(`${name}-ArtHost`);
    artHost.layer = Layers.Enum.UI_2D;
    artHost.setParent(commander);
    artHost.setPosition(0, 0);
    this.addTransform(artHost, 214, 640);
    this.commanderArtHosts.set(enemy ? 'enemy' : 'player', artHost);
    this.createPanel(commander, `${name}-NamePlate`, 170, 34, 0, -299, new Color(16, 19, 18, 176));
    this.createLabel(commander, `${name}-Name`, label, 0, -299, 160, 28, 18, palette.bone);
    return commander;
  }

  private drawHand(): void {
    this.createPanel(this.root, 'HandRail', 920, 2, 0, -286, new Color(195, 164, 94, 145));
    this.deploymentHint = this.createPanel(this.root, 'DeploymentHint', 128, 28, 0, -265, new Color(20, 24, 22, 226), palette.gold, 1);
    this.createLabel(this.deploymentHint, 'DeploymentHintText', '可部署 6', 0, 0, 112, 22, 12, palette.bone);
    this.deploymentHint.active = false;

    const hand = new Node('ReadyHand');
    hand.layer = Layers.Enum.UI_2D;
    hand.setParent(this.root);
    this.addTransform(hand, 820, 228);
    hand.setPosition(0, -416);
    const cards = [
      ['折锋枪兵', '攻 3  体 5', '3'],
      ['岚羽游射手', '攻 3  体 4', '2'],
      ['铸壁守望者', '攻 3  体 8', '3'],
      ['霆脊巨兽', '攻 4  体 10', '6'],
      ['烈纹天罚', '路线技能', '3'],
    ];
    cards.forEach(([name, stat, cost], index) => {
      const x = (index - 2) * 154;
      const card = this.createButton(
        hand,
        `Card-${index}`,
        '',
        x,
        0,
        144,
        224,
        index === this.selectedCard ? palette.surfaceRaised : palette.surface,
        () => this.selectCard(index),
        index === this.selectedCard ? palette.gold : palette.line,
      );
      card.on(Node.EventType.MOUSE_ENTER, () => this.setCardLift(index, index === this.selectedCard ? 12 : 6), this);
      card.on(Node.EventType.MOUSE_LEAVE, () => this.setCardLift(index, index === this.selectedCard ? 12 : 0), this);
      this.handCards.push(card);
      const glow = this.createPanel(card, 'SelectedGlow', 152, 232, 0, 0, new Color(255, 255, 255, 0), palette.gold, 3);
      glow.active = index === this.selectedCard;
      this.handSelectionGlows.push(glow);
      this.createPanel(card, 'Art', 128, 146, 0, 25, index === 4 ? new Color(68, 60, 46, 255) : new Color(46, 51, 48, 255), palette.line, 1);
      if (index < 4) {
        const artHost = new Node(`Card-${index}-ArtHost`);
        artHost.layer = Layers.Enum.UI_2D;
        artHost.setParent(card);
        artHost.setPosition(0, 25);
        this.addTransform(artHost, 124, 142);
        this.handArtHosts.set(index, artHost);
      }
      if (index === 4) this.drawSkillArt(card);
      const badge = this.createPanel(card, 'CostBadge', 36, 36, -54, 92, new Color(32, 78, 57, 255), palette.gold, 2);
      this.createLabel(badge, 'Cost', cost, 0, 0, 28, 28, 18, palette.bone);
      this.createLabel(card, 'Name', name, 0, -67, 128, 28, 15, palette.bone);
      this.createLabel(card, 'Stat', stat, 0, -96, 124, 22, 12, palette.textMuted);
    });
    this.selectCard(this.selectedCard);
  }

  private selectCard(index: number): void {
    this.selectedCard = index;
    this.handCards.forEach((_card, cardIndex) => {
      this.setCardLift(cardIndex, cardIndex === index ? 12 : 0);
      this.handSelectionGlows[cardIndex].active = cardIndex === index;
    });
    const showDeployment = index >= 0 && index < 4;
    this.deploymentMarkers.forEach((marker) => { marker.active = showDeployment; });
    this.deploymentHint.active = showDeployment;
    this.updateMetrics();
  }

  private setCardLift(index: number, lift: number): void {
    const card = this.handCards[index];
    if (!card) return;
    tween(card).to(0.12, { position: new Vec3((index - 2) * 154, lift, 0) }).start();
  }

  private drawSkillArt(card: Node): void {
    const art = this.createGraphicsNode(card, 'SkillArt', 124, 142, 0, 25);
    const graphics = art.getComponent(Graphics)!;
    graphics.fillColor = new Color(42, 44, 41, 255);
    graphics.rect(-62, -71, 124, 142);
    graphics.fill();
    graphics.lineWidth = 7;
    graphics.strokeColor = new Color(226, 198, 126, 245);
    graphics.moveTo(-40, -38);
    graphics.lineTo(20, 38);
    graphics.lineTo(4, 38);
    graphics.lineTo(42, 62);
    graphics.moveTo(-18, -48);
    graphics.lineTo(42, 20);
    graphics.stroke();
  }

  private spawnInitialUnits(): void {
    this.spawnUnit(0, 2, 'player', 'U002');
    this.spawnUnit(0, 9, 'enemy', 'U008');
    this.updateMetrics();
  }

  private deploySelected(lane: number, cell: number): void {
    if (this.stressMode || this.selectedCard < 0 || this.selectedCard === 4) return;
    this.spawnUnit(lane, cell, 'player', this.selectedCard === 3 ? 'U008' : 'U002');
    this.selectCard(-1);
  }

  private spawnUnit(lane: number, cell: number, side: 'player' | 'enemy', name: string): void {
    const key = `${lane}:${cell}`;
    if (this.occupied.has(key)) return;
    this.occupied.add(key);
    this.activeUnits += 1;

    const x = -BOARD_WIDTH / 2 + CELL_WIDTH / 2 + cell * CELL_WIDTH;
    const y = lane === 0 ? LANE_HEIGHT / 2 : -LANE_HEIGHT / 2;
    const color = side === 'player' ? palette.jade : palette.vermilion;
    const unit = this.createGraphicsNode(this.unitLayer, `Unit-${side}-${key}`, 82, 118, x, y);
    const graphics = unit.getComponent(Graphics)!;
    graphics.fillColor = new Color(40, 54, 48, 235);
    graphics.rect(-41, -59, 82, 118);
    graphics.fill();
    graphics.lineWidth = 2;
    graphics.strokeColor = color;
    graphics.rect(-40, -58, 80, 116);
    graphics.stroke();
    graphics.fillColor = palette.blackIron;
    graphics.rect(-36, 49, 72, 6);
    graphics.fill();
    graphics.fillColor = color;
    graphics.rect(-35, 50, 70, 4);
    graphics.fill();
    if (name === 'U008') {
      graphics.roundRect(-31, -10, 62, 38, 15);
      graphics.fill();
      graphics.circle(27, 2, 17);
      graphics.fill();
    } else {
      graphics.circle(0, 25, 13);
      graphics.fill();
      graphics.roundRect(-13, -18, 26, 42, 8);
      graphics.fill();
    }
    this.createLabel(unit, 'UnitName', name, 0, -46, 76, 20, 12, palette.bone);
    if (name === 'U002' || name === 'U008') {
      this.attachUnitPreview(unit, name);
    }
    this.updateMetrics();
  }

  private enableStressMode(): void {
    if (this.stressMode) return;
    this.stressMode = true;
    this.unitLayer.destroyAllChildren();
    this.unitPreviewEntries.clear();
    this.occupied.clear();
    this.activeUnits = 0;
    for (let lane = 0; lane < LANES; lane += 1) {
      for (let cell = 0; cell < CELLS_PER_LANE; cell += 1) {
        const side = cell < CELLS_PER_LANE / 2 ? 'player' : 'enemy';
        const id = cell % 4 === 0 ? 'U008' : 'U002';
        this.spawnUnit(lane, cell, side, id);
      }
    }
    this.updateMetrics();
  }

  private triggerEnemyHit(): void {
    if (this.enemyHp <= 0) return;
    this.enemyHp = Math.max(0, this.enemyHp - 300);
    this.hitCount += 1;
    this.enemyHpLabel.string = `${this.enemyHp} / 3600`;
    const ratio = this.enemyHp / 3600;
    this.enemyHpBar.getComponent(UITransform)!.setContentSize(482 * ratio, 5);
    this.enemyHpBar.setPosition(-241 * (1 - ratio), -19);

    const opacity = this.enemyFlash.getComponent(UIOpacity)!;
    opacity.opacity = 230;
    tween(opacity).to(0.09, { opacity: 0 }).start();
    tween(this.enemyCommander)
      .by(0.08, { position: new Vec3(10, 0, 0) })
      .by(0.14, { position: new Vec3(-10, 0, 0) })
      .start();
    this.updateMetrics();
    if (this.enemyHp === 0) {
      window.setTimeout(() => (globalThis as Record<string, any>).__META_BATTLE_COMPLETE__?.(true), 650);
    }
  }

  private publishHarness(): void {
    const runtime = globalThis as Record<string, any>;
    runtime.__A0_ENABLE_STRESS__ = () => this.enableStressMode();
    runtime.__A0_TRIGGER_HIT__ = () => this.triggerEnemyHit();
    runtime.__A0_SELECT_CARD__ = (index: number) => this.selectCard(index);
    runtime.__A0_DEPLOY__ = (lane: number, cell: number) => this.deploySelected(lane, cell);
    runtime.__A0_IDLE_PHASE__ = () => this.unitPreviewEntries.values().next().value?.phase ?? null;
    this.metrics = {
      ready: true,
      lanes: LANES,
      cells: LANES * CELLS_PER_LANE,
      legalDeploymentCells: LANES * SUMMON_DEPTH,
      commanders: 2,
      commandersOutsideGrid: COMMANDER_X - 114 >= BOARD_WIDTH / 2,
      commanderCenterErrorPx: Math.max(
        Math.abs(this.playerCommander.getPosition().y - BOARD_Y),
        Math.abs(this.enemyCommander.getPosition().y - BOARD_Y),
      ),
      activeUnits: this.activeUnits,
      enemyHp: this.enemyHp,
      hitCount: this.hitCount,
      stressMode: this.stressMode,
      assetsReady: false,
      loadedVisualAssets: 0,
      previewPoseAssets: 0,
      spineAssets: 0,
      artMode: 'preview-pose',
      artIntegrationComplete: false,
      runtimeUnitSprites: 0,
      stressRenderer: 'individual-sprites',
      unitMotion: 'idle-breathing',
      selectedCard: this.selectedCard,
      activeDeploymentMarkers: 0,
    };
    runtime.__A0_METRICS__ = this.metrics;
  }

  private updateMetrics(): void {
    if (!this.metrics) return;
    this.metrics.activeUnits = this.activeUnits;
    this.metrics.enemyHp = this.enemyHp;
    this.metrics.hitCount = this.hitCount;
    this.metrics.stressMode = this.stressMode;
    this.metrics.loadedVisualAssets = this.loadedVisualAssets.size;
    this.metrics.previewPoseAssets = this.unitFrames.size;
    this.metrics.runtimeUnitSprites = this.unitPreviewEntries.size;
    this.metrics.selectedCard = this.selectedCard;
    this.metrics.activeDeploymentMarkers = this.deploymentMarkers.filter((marker) => marker.active).length;
  }

  private async loadRuntimeArt(): Promise<void> {
    const entries = await Promise.all([
      this.loadSpriteFrame('a0/background/E104-PARALLAX-BOARD/spriteFrame'),
      this.loadSpriteFrame('a0/commanders/C009-BATTLE-SIDESLOT/spriteFrame'),
      this.loadSpriteFrame('a0/commanders/C001-BATTLE-SIDESLOT/spriteFrame'),
      this.loadSpriteFrame('a0/units/U002-ANIMATION-POSES/spriteFrame'),
      this.loadSpriteFrame('a0/units/U008-ANIMATION-POSES/spriteFrame'),
      this.loadSpriteFrame('a0/cards/U002-CARD-THUMB/spriteFrame'),
      this.loadSpriteFrame('a0/cards/U004-CARD-THUMB/spriteFrame'),
      this.loadSpriteFrame('a0/cards/U001-CARD-THUMB/spriteFrame'),
      this.loadSpriteFrame('a0/cards/U008-CARD-THUMB/spriteFrame'),
    ]);

    const [background, player, enemy, u002Sheet, u008Sheet, u002Card, u004Card, u001Card, u008Card] = entries;
    this.attachBackgroundArt(background);
    this.attachCommanderArt('player', player);
    this.attachCommanderArt('enemy', enemy);
    this.unitFrames.set('U002', this.createPoseFrames(this.createKeyedPoseSheet(u002Sheet), 'U002'));
    this.unitFrames.set('U008', this.createPoseFrames(this.createKeyedPoseSheet(u008Sheet), 'U008'));
    this.attachHandArt(0, u002Card);
    this.attachHandArt(1, u004Card);
    this.attachHandArt(2, u001Card);
    this.attachHandArt(3, u008Card);

    this.loadedVisualAssets = new Set(['E104', 'C009', 'C001', 'U002-POSE', 'U008-POSE', 'U001-CARD', 'U002-CARD', 'U004-CARD', 'U008-CARD']);
    this.refreshUnitPreviews();
    this.metrics.assetsReady = true;
    this.updateMetrics();
  }

  private loadSpriteFrame(path: string): Promise<SpriteFrame> {
    return new Promise((resolve, reject) => {
      resources.load(path, SpriteFrame, (error, frame) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(frame);
      });
    });
  }

  private attachBackgroundArt(source: SpriteFrame): void {
    const host = this.root.getChildByName('E104-ArtHost');
    if (!host) return;
    const frame = new SpriteFrame();
    frame.texture = source.texture;
    frame.rect = new Rect(0, 0, source.texture.width, Math.round(source.texture.height * 0.47));
    const sprite = host.addComponent(Sprite);
    sprite.spriteFrame = frame;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.color = new Color(255, 255, 255, 245);
    host.getComponent(UITransform)!.setContentSize(DESIGN_WIDTH, 760);

    const floorHost = this.root.getChildByName('E104-FloorHost');
    if (floorHost) {
      const floorFrame = new SpriteFrame();
      floorFrame.texture = source.texture;
      floorFrame.rect = new Rect(
        0,
        Math.round(source.texture.height * 0.315),
        source.texture.width,
        Math.round(source.texture.height * 0.153),
      );
      const floorSprite = floorHost.addComponent(Sprite);
      floorSprite.spriteFrame = floorFrame;
      floorSprite.sizeMode = Sprite.SizeMode.CUSTOM;
      floorSprite.color = new Color(235, 234, 222, 255);
      floorHost.getComponent(UITransform)!.setContentSize(DESIGN_WIDTH, 430);
    }

    const boardFrame = new SpriteFrame();
    boardFrame.texture = source.texture;
    boardFrame.rect = new Rect(0, Math.round(source.texture.height * 0.23), source.texture.width, Math.round(source.texture.height * 0.22));
    const boardSprite = this.boardTextureHost.addComponent(Sprite);
    boardSprite.spriteFrame = boardFrame;
    boardSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    boardSprite.color = new Color(214, 210, 194, 255);
    this.boardTextureHost.getComponent(UITransform)!.setContentSize(BOARD_WIDTH, BOARD_HEIGHT);
  }

  private attachCommanderArt(side: 'player' | 'enemy', source: SpriteFrame): void {
    const host = this.commanderArtHosts.get(side);
    if (!host) return;
    const sprite = host.addComponent(Sprite);
    sprite.spriteFrame = source;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    const displayHeight = side === 'player' ? 640 : 580;
    const displayWidth = displayHeight * source.texture.width / source.texture.height;
    host.setPosition(side === 'player' ? 0 : -20, 0);
    host.getComponent(UITransform)!.setContentSize(displayWidth, displayHeight);
    const placeholder = host.parent?.getChildByName(`${host.parent.name}-Figure`);
    if (placeholder) placeholder.active = false;
  }

  private attachHandArt(index: number, source: SpriteFrame): void {
    const host = this.handArtHosts.get(index);
    if (!host) return;
    const sprite = host.addComponent(Sprite);
    sprite.spriteFrame = this.createCenterCrop(source, 124 / 142);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    host.getComponent(UITransform)!.setContentSize(124, 142);
  }

  private createCenterCrop(source: SpriteFrame, targetAspect: number): SpriteFrame {
    const textureWidth = source.texture.width;
    const textureHeight = source.texture.height;
    const sourceAspect = textureWidth / textureHeight;
    let width = textureWidth;
    let height = textureHeight;
    let x = 0;
    let y = 0;
    if (sourceAspect > targetAspect) {
      width = Math.round(textureHeight * targetAspect);
      x = Math.round((textureWidth - width) / 2);
    } else {
      height = Math.round(textureWidth / targetAspect);
      y = Math.round((textureHeight - height) / 2);
    }
    const frame = new SpriteFrame();
    frame.texture = source.texture;
    frame.rect = new Rect(x, y, width, height);
    return frame;
  }

  private createPoseFrames(source: SpriteFrame, id: 'U002' | 'U008'): SpriteFrame[] {
    const count = 5;
    const frameWidth = Math.floor(source.texture.width / count);
    const crop = id === 'U002'
      ? { insetX: 30, y: 160, width: frameWidth - 60, height: 520 }
      : { insetX: 8, y: 230, width: frameWidth - 16, height: 330 };
    return Array.from({ length: count }, (_, index) => {
      const frame = new SpriteFrame();
      frame.texture = source.texture;
      frame.rect = new Rect(index * frameWidth + crop.insetX, crop.y, crop.width, crop.height);
      return frame;
    });
  }

  private createKeyedPoseSheet(source: SpriteFrame): SpriteFrame {
    const image = source.texture.image?.data;
    if (!image || ArrayBuffer.isView(image)) return source;

    const canvas = document.createElement('canvas');
    canvas.width = source.texture.width;
    canvas.height = source.texture.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return source;
    context.drawImage(image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    for (let offset = 0; offset < data.length; offset += 4) {
      const red = data[offset] / 255;
      const green = data[offset + 1] / 255;
      const blue = data[offset + 2] / 255;
      const channelMax = Math.max(red, green, blue);
      const channelMin = Math.min(red, green, blue);
      const chroma = channelMax - channelMin;
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const neutral = 1 - this.smoothstep(0.025, 0.105, chroma);
      const bright = this.smoothstep(0.50, 0.72, luminance);
      data[offset + 3] = Math.round(data[offset + 3] * (1 - neutral * bright));
    }
    context.putImageData(pixels, 0, 0);

    const texture = new Texture2D(`${source.texture.name}-keyed`);
    texture.image = new ImageAsset(canvas);
    const keyed = new SpriteFrame();
    keyed.texture = texture;
    keyed.rect = new Rect(0, 0, texture.width, texture.height);
    return keyed;
  }

  private smoothstep(edge0: number, edge1: number, value: number): number {
    const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return normalized * normalized * (3 - 2 * normalized);
  }

  private attachUnitPreview(unit: Node, id: 'U002' | 'U008'): void {
    const frames = this.unitFrames.get(id);
    if (!frames || unit.getChildByName('RuntimeArt')) return;
    const art = new Node('RuntimeArt');
    art.layer = Layers.Enum.UI_2D;
    art.setParent(unit);
    const facing = unit.name.includes('-player-') ? -1 : 1;
    art.setPosition(0, -2);
    art.setScale(facing, 1, 1);
    this.addTransform(art, id === 'U008' ? 102 : 96, id === 'U008' ? 100 : 176);
    const sprite = art.addComponent(Sprite);
    sprite.spriteFrame = frames[0];
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.color = Color.WHITE;
    art.getComponent(UITransform)!.setContentSize(id === 'U008' ? 102 : 96, id === 'U008' ? 100 : 176);
    const fallback = unit.getComponent(Graphics);
    if (fallback) fallback.enabled = false;
    const nameLabel = unit.getChildByName('UnitName');
    if (nameLabel) nameLabel.active = false;

    this.unitPreviewEntries.set(art, {
      sprite,
      frames,
      facing,
      phase: id === 'U008' ? Math.PI * 0.4 : 0,
      speed: id === 'U008' ? 3 : 3.8,
      amplitude: id === 'U008' ? 1.2 : 1.8,
    });
    this.updateMetrics();
  }

  private refreshUnitPreviews(): void {
    for (const unit of this.unitLayer.children) {
      const label = unit.getChildByName('UnitName')?.getComponent(Label)?.string;
      if (label === 'U002' || label === 'U008') this.attachUnitPreview(unit, label);
    }
  }

  private createButton(
    parent: Node,
    name: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fill: Color,
    handler: () => void,
    border = palette.line,
  ): Node {
    const button = this.createPanel(parent, name, width, height, x, y, fill, border, 2);
    button.addComponent(Button);
    button.on(Node.EventType.TOUCH_END, handler, this);
    if (text) this.createLabel(button, 'Text', text, 0, 0, width - 8, height - 6, 17, palette.bone);
    return button;
  }

  private createPanel(
    parent: Node,
    name: string,
    width: number,
    height: number,
    x: number,
    y: number,
    fill: Color,
    stroke?: Color,
    lineWidth = 1,
  ): Node {
    const node = this.createGraphicsNode(parent, name, width, height, x, y);
    const graphics = node.getComponent(Graphics)!;
    graphics.fillColor = fill;
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
    if (stroke) {
      graphics.lineWidth = lineWidth;
      graphics.strokeColor = stroke;
      graphics.rect(-width / 2 + lineWidth / 2, -height / 2 + lineWidth / 2, width - lineWidth, height - lineWidth);
      graphics.stroke();
    }
    return node;
  }

  private createGraphicsNode(parent: Node, name: string, width: number, height: number, x: number, y: number): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    node.setPosition(x, y);
    this.addTransform(node, width, height);
    node.addComponent(Graphics);
    return node;
  }

  private createLabel(
    parent: Node,
    name: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    size: number,
    color: Color,
  ): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    node.setPosition(x, y);
    this.addTransform(node, width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = size + 4;
    label.color = color;
    label.horizontalAlign = HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return node;
  }

  private addTransform(node: Node, width: number, height: number): UITransform {
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(width, height);
    transform.setAnchorPoint(0.5, 0.5);
    return transform;
  }
}
