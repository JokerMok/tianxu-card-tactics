import {
  Button,
  Color,
  Graphics,
  HorizontalTextAlignment,
  JsonAsset,
  Label,
  Layers,
  Node,
  Rect,
  resources,
  Sprite,
  SpriteFrame,
  tween,
  Tween,
  UIOpacity,
  UITransform,
  Vec3,
  VerticalTextAlignment,
} from 'cc';
import {
  claimExpedition,
  claimTask,
  completeStage,
  GameState,
  grantReward,
  loadGame,
  PageId,
  resetGame,
  saveGame,
  startExpedition,
  upgradeBuilding,
  upgradeCard,
} from './GameState';
import { gameUiColors as colors, gameUiFontFamily } from '../ui/GameUiTheme';

const W = 1920;
const H = 1080;

const navigation: Array<[PageId, string, string]> = [
  ['home', '主城', '城'],
  ['campaign', '征战', '征'],
  ['cards', '卡库', '卡'],
  ['deck', '编队', '阵'],
  ['hero', '主将', '将'],
  ['adventure', '历练', '历'],
  ['city', '营造', '造'],
  ['tasks', '任务', '任'],
  ['inventory', '行囊', '囊'],
];

const inventoryIcons: Record<string, string> = {
  '强化石': 'item-upgrade', '山海鳞片': 'item-scale',
  '法印残片': 'item-seal', '远征券': 'item-ticket',
};

export class GameShell {
  private shell!: Node;
  private content!: Node;
  private battleToolbar!: Node;
  private state: GameState = loadGame();
  private page: PageId = 'home';
  private selectedCard = 'U002';
  private selectedItem = '强化石';
  private selectedBattleCard = 'U001';
  private battleDeck: string[] = [];
  private deckPage = 0;
  private notice!: Node;
  private activeStage = 1;
  private battleMode: 'campaign' | 'dungeon' | 'tower' | 'boss' = 'campaign';

  constructor(private host: Node, private battleRoot: Node, private campaignBattle: {enter():void;exit():void;resumable:boolean;restorable:boolean;rewardLabel:string;setReturnHandler(callback:()=>void):void}) {}

  mount(): void {
    this.battleRoot.active = false;
    this.shell = this.node(this.host, 'GameShell', W, H, 0, 0);
    this.panel(this.shell, 'Base', W, H, 0, 0, colors.ink);
    this.drawBackdrop();
    this.content = this.node(this.shell, 'PageContent', W, H, 0, 0);
    this.notice = this.panel(this.shell, 'Notice', 520, 54, 105, -472, new Color(14, 18, 16, 238), colors.gold, 1);
    this.notice.active = false;
    this.drawBattleToolbar();
    this.campaignBattle.setReturnHandler(()=>this.returnFromBattle());
    this.renderChrome();
    this.renderPage();
    resources.load('config/decks', JsonAsset, (error, asset) => {
      if (error || !this.shell?.isValid) return;
      const deck = (asset.json as { decks?: Array<{ id: string; cardEntries: Array<{ cardId: string; count: number }> }> })?.decks?.find((entry) => entry.id === 'D001');
      this.battleDeck = deck?.cardEntries.flatMap((entry) => Array(entry.count).fill(entry.cardId)) ?? [];
      if (this.page === 'deck') this.renderPage();
    });
    if(this.campaignBattle.restorable)this.enterBattle(1);
    const runtime = globalThis as Record<string, any>;

    runtime.__META_STATE__ = () => this.state;
    runtime.__META_NAVIGATE__ = (page: PageId) => this.navigate(page);
    runtime.__META_RESET__ = () => {
      this.state = resetGame(); this.page = 'home'; this.selectedCard = 'U002';
      this.renderChrome(); this.renderPage();
    };
    runtime.__META_TEST__ = {
      snapshot: () => ({
        page: this.page,
        view: this.shell.active ? 'meta' : 'battle',
        selectedCard: this.selectedCard,
        dynamicOverlays: this.content?.children.filter((child) => child.name.startsWith('Live')).map((child) => child.name) ?? [],
        state: JSON.parse(JSON.stringify(this.state)),
      }),
      enterBattle: (stage = 1, mode: 'campaign' | 'dungeon' | 'tower' | 'boss' = 'campaign') => this.enterBattle(stage, mode),

      upgradeCard: (id = 'U002') => upgradeCard(this.state, id),
      claimTask: (id: keyof GameState['tasks']) => claimTask(this.state, id),
      reset: () => {
        this.state = resetGame(); this.page = 'home'; this.selectedCard = 'U002';
        this.renderChrome(); this.renderPage();
      },
    };
  }

  private drawBackdrop(): void {
    const image = this.node(this.shell, 'Backdrop', W, H, 0, 0);
    this.loadSprite('ui/components/city-background-day/spriteFrame', image, W, H);
    this.panel(this.shell, 'BackdropShade', W, H, 0, 0, new Color(8, 18, 17, 28));
  }

  private drawTopBar(): void {
    const top = this.node(this.shell, 'TopBar', W, 100, 0, 490);
    this.label(top, 'Brand', '天序·无名之卷', -755, 3, 300, 54, 35, colors.gold, HorizontalTextAlignment.LEFT);
    this.resource(top, '体力', `${this.state.resources.stamina}/${this.state.resources.staminaMax}`, 145);
    this.resource(top, '银币', this.compact(this.state.resources.silver), 390);
    this.resource(top, '水晶', this.compact(this.state.resources.crystal), 635);
    this.hotspot(top, 'Settings', 890, 0, 72, 72, () => this.openSettings());
  }

  private resource(parent: Node, name: string, value: string, x: number): void {
    const icon = this.node(parent, `${name}-Icon`, 48, 48, x - 69, 0);
    const column = name === '体力' ? 0 : name === '银币' ? 1 : 2;
    this.loadSprite('ui/components/resource-icons-v2/spriteFrame', icon, 48, 48, Color.WHITE, () => {
      const sprite = icon.getComponent(Sprite);
      const texture = sprite?.spriteFrame?.texture;
      if (!sprite || !texture) return;
      const frame = new SpriteFrame();
      frame.texture = texture;
      frame.rect = new Rect(column * texture.width / 3, 0, texture.width / 3, texture.height);
      sprite.spriteFrame = frame;
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      icon.getComponent(UITransform)!.setContentSize(48, 48);
    });
    this.label(parent, `${name}-Name`, name, x - 26, 0, 58, 30, 18, colors.bone);
    this.label(parent, `${name}-Value`, value, x + 77, 0, 135, 32, 23, colors.bone);
  }

  private drawNavigation(): void {
    const rail = this.node(this.shell, 'Navigation', 286, 990, -817, -46);
    navigation.forEach(([id, name, glyph], index) => {
      const y = 381 - index * 79;
      const active = id === this.page;
      const button = this.node(rail, `Nav-${id}`, 280, 76, -3, y);
      button.addComponent(Button);
      if (active) {
        const selected = this.node(button, 'SelectedRibbon', 290, 125, -4, 0);
        this.loadSprite('ui/components/nav-selected/spriteFrame', selected, 290, 125);
      }
      this.label(button, 'Glyph', glyph, -50, 0, 44, 42, 28, colors.gold);
      this.label(button, 'Name', name, 18, 0, 112, 44, 27, colors.bone);
      button.on(Node.EventType.MOUSE_ENTER, () => this.setPointerCursor(true));
      button.on(Node.EventType.MOUSE_LEAVE, () => this.setPointerCursor(false));
      button.on(Node.EventType.TOUCH_END, () => this.navigate(id));
    });
  }

  private drawBattleToolbar(): void {
    this.battleToolbar = this.panel(this.host, 'MetaBattleToolbar', 150, 52, -872, -502, new Color(18, 22, 20, 238), colors.gold, 1);
    this.button(this.battleToolbar, 'Return', '返回主城', 0, 0, 132, 38, () => this.returnFromBattle());
    this.battleToolbar.active = false;
  }

  private navigate(page: PageId): void {
    this.page = page;
    if(page==='campaign')this.state.campaign.selectedStage=1;
    this.renderChrome();
    this.renderPage();
  }

  private renderChrome(): void {
    this.shell.getChildByName('ChromeArt')?.destroy();
    this.shell.getChildByName('TopBar')?.destroy();
    this.shell.getChildByName('Navigation')?.destroy();
    const art = this.node(this.shell, 'ChromeArt', W, H, 0, 0);
    this.loadSprite('ui/components/ornate-chrome/spriteFrame', art, W, H);
    this.drawTopBar();
    this.drawNavigation();
    this.notice.setSiblingIndex(this.shell.children.length - 1);
  }

  private renderPage(): void {
    this.content.destroyAllChildren();
    const pages: Record<PageId, () => void> = {
      home: () => this.renderHome(), campaign: () => this.renderCampaign(),
      cards: () => this.renderCards(), deck: () => this.renderDeck(),
      hero: () => this.renderHero(), adventure: () => this.renderAdventure(),
      city: () => this.renderCity(), tasks: () => this.renderTasks(),
      inventory: () => this.renderInventory(),
    };
    pages[this.page]();
    (globalThis as Record<string, any>).__META_ART_PAGE__ = this.page;
  }

  private pageTitle(title: string, subtitle: string): void {
    if (this.page === 'adventure' || this.page === 'inventory') return;
    if (this.page === 'campaign') {
      this.label(this.content, 'PageHeading', title, -445, 405, 390, 62, 47, colors.gold, HorizontalTextAlignment.LEFT);
      this.label(this.content, 'PageSubheading', '第一章 · 白鹿古道', -442, 350, 390, 38, 22, colors.gold, HorizontalTextAlignment.LEFT);
      return;
    }
    if (this.page === 'cards') {
      const heading = this.panel(this.content, 'PageHeading', 445, 96, -447, 397, new Color(13, 38, 34, 210));
      this.loadSlicedSprite('ui/components/jade-button/spriteFrame', heading, 445, 96, 0.18, 0.25);
      this.label(heading, 'Title', '卡牌背包', -100, 0, 230, 50, 34, colors.gold, HorizontalTextAlignment.LEFT);
      this.label(heading, 'Count', `已收集 ${this.state.cards.length}/44`, 145, 0, 145, 34, 17, colors.bone);
      return;
    }
    if (this.page === 'deck') {
      const heading = this.panel(this.content, 'PageHeading', 250, 62, -487, 320, new Color(18, 59, 49, 215), colors.gold, 1);
      this.loadSlicedSprite('ui/components/jade-button/spriteFrame', heading, 250, 62, 0.18, 0.25);
      this.label(heading, 'Title', '出战编队', 0, 0, 225, 48, 30, colors.gold);
      return;
    }
    if (this.page === 'hero') {
      this.label(this.content, 'PageHeading', title, 100, 375, 500, 70, 49, new Color(27, 61, 47, 255));
      return;
    }
    if (this.page === 'tasks') {
      this.label(this.content, 'PageHeading', '任务与活跃', -370, 360, 410, 65, 44, new Color(23, 58, 49, 255), HorizontalTextAlignment.LEFT);
      return;
    }
    this.label(this.content, 'PageHeading', title, -355, 390, 550, 70, 50, new Color(20, 48, 43, 255), HorizontalTextAlignment.LEFT);
  }

  private renderHome(): void {
    const hero = this.node(this.content, 'HomeHero', 330, 800, -465, -55);
    this.loadSprite('a0/commanders/C009-BATTLE-SIDESLOT/spriteFrame', hero, 330, 800);

    const main = this.node(this.content, 'MainMission', 600, 480, 100, 50);
    this.loadSprite('ui/components/mission-banner/spriteFrame', main, 600, 480);
    this.label(main, 'Chapter', '第一章 · 空册入世', 0, 118, 470, 42, 30, colors.gold);
    this.label(main, 'Stage', '1-1  押册出垣', 0, 30, 510, 66, 45, colors.bone);
    this.panel(main, 'Divider', 330, 2, 0, -32, colors.gold);
    this.label(main, 'Desc', '护送神册离开边城', 0, -69, 430, 32, 20, colors.muted);
    this.button(main, 'Continue', '进入首关', 0, -127, 315, 72, () => this.enterBattle(1), colors.jade, colors.gold);

    const shortcuts = this.node(this.content, 'HomeShortcuts', 610, 280, 90, -365);
    this.loadSprite('ui/components/home-shortcuts/spriteFrame', shortcuts, 610, 280);
    const links: Array<[string, PageId, number]> = [['编队', 'deck', -190], ['卡库', 'cards', 0], ['营造', 'city', 190]];
    links.forEach(([title, page, x]) => {
      this.label(shortcuts, `ShortcutLabel-${page}`, title, x, -92, 150, 39, 27, colors.bone);
      this.hotspot(shortcuts, `Shortcut-${page}`, x, 0, 170, 250, () => this.navigate(page));
    });

    const goals = this.node(this.content, 'Goals', 300, 495, 650, 24);
    this.loadSprite('ui/components/objective-pennant/spriteFrame', goals, 300, 495);
    this.label(goals, 'Activity', '今日目标', 0, 164, 250, 39, 28, colors.bone);
    const stage = this.state.tasks.stage;
    const ring = this.node(goals, 'StageRing', 120, 120, 0, 46);
    const draw = ring.addComponent(Graphics);
    draw.lineWidth = 8; draw.strokeColor = new Color(72, 100, 90, 255);
    draw.circle(0, 0, 56); draw.stroke();
    draw.strokeColor = colors.jade;
    draw.arc(0, 0, 56, Math.PI / 2, Math.PI / 2 + Math.PI * 2 * Math.min(1, stage.progress / stage.target), false);
    draw.stroke();
    this.label(ring, 'GoalIcon', '征', 0, 0, 78, 78, 46, colors.gold);
    this.label(goals, 'StageValue', `${stage.progress}/${stage.target}`, 0, -44, 200, 39, 27, colors.gold);
    this.panel(goals, 'StageTrack', 205, 7, 0, -65, new Color(12, 35, 30, 255));
    const filled = 205 * Math.min(1, stage.progress / stage.target);
    this.panel(goals, 'StageFill', filled, 7, -102.5 + filled / 2, -65, colors.jade);
    const upgrade = this.state.tasks.upgrade;
    this.label(goals, 'Upgrade', `卡牌强化  ${upgrade.progress}/${upgrade.target}`, 0, -130, 230, 33, 20, colors.bone);
  }

  private goalProgress(parent: Node, name: string, value: number, max: number, y: number): void {
    this.label(parent, `${name}-Label`, name, -60, y + 22, 240, 28, 16, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(parent, `${name}-Value`, `${value}/${max}`, 145, y + 22, 65, 28, 15, colors.gold);
    this.panel(parent, `${name}-Track`, 340, 9, 0, y - 17, new Color(12, 25, 23, 255));
    const filled = 340 * Math.min(1, value / max);
    this.panel(parent, `${name}-Fill`, filled, 9, -170 + filled / 2, y - 17, colors.jade);
  }

  private quickTile(title: string, value: string, x: number, y: number, action: () => void): void {
    const tile = this.button(this.content, `Quick-${title}`, '', x, y, 300, 156, action, colors.raised, colors.line);
    this.label(tile, 'Title', title, -6, 39, 240, 30, 18, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(tile, 'Value', value, -6, -10, 240, 26, 14, colors.muted, HorizontalTextAlignment.LEFT);
    this.label(tile, 'Arrow', '›', 120, 0, 30, 46, 32, colors.gold);
  }

  private renderCampaign(): void {
    const landscape = this.node(this.content, 'CampaignLandscape', W, H, 0, 0);
    this.loadSprite('ui/components/campaign-map/spriteFrame', landscape, W, H);
    this.pageTitle('主线征战', '第一章 · 首关可玩；后续关卡仍在制作。');
    const positions: Array<[number, number]> = [
      [-570, -80], [-440, 10], [-275, 105], [-55, 180], [200, 130], [300, 10],
      [245, -125], [-10, -185], [-230, -170], [-425, -195], [-545, -250], [-635, -245],
    ];
    const route = this.node(this.content, 'CampaignRoute', 1100, 730, -160, -35);
    const line = route.addComponent(Graphics);
    line.lineWidth = 7; line.strokeColor = new Color(248, 229, 166, 220);
    line.moveTo(positions[0][0] + 160, positions[0][1] + 35);
    for (let i = 1; i < positions.length; i += 1) line.lineTo(positions[i][0] + 160, positions[i][1] + 35);
    line.stroke();
    positions.forEach(([x, y], index) => {
      const stage = index + 1;
      const recorded = stage <= this.state.campaign.unlocked;
      const marker = this.node(this.content, `Stage-${stage}`, 80, 80, x, y);
      marker.addComponent(Button);
      const disc = marker.addComponent(Graphics);
      disc.fillColor = recorded ? new Color(21, 69, 61, 255) : new Color(41, 48, 47, 255);
      disc.strokeColor = recorded ? colors.gold : colors.muted;
      disc.lineWidth = 5; disc.circle(0, 0, 36); disc.fill(); disc.stroke();
      disc.lineWidth = 2; disc.circle(0, 0, 29); disc.stroke();
      this.label(marker, 'Number', String(stage), 0, 1, 65, 60, 29, recorded ? colors.bone : colors.muted);
      const stars = this.state.campaign.stars[String(stage)] ?? 0;
      if (stars) this.label(marker, 'Stars', '★'.repeat(stars), 0, -53, 100, 26, 20, colors.gold);
      else if (!recorded) this.label(marker, 'Lock', '锁', 0, -53, 75, 25, 15, colors.muted);
      marker.on(Node.EventType.MOUSE_ENTER, () => this.setPointerCursor(true));
      marker.on(Node.EventType.MOUSE_LEAVE, () => this.setPointerCursor(false));
      marker.on(Node.EventType.TOUCH_END, () => stage === 1 ? this.enterBattle(1) : this.toast('当前只有首关可进入战斗'));
    });
    const detail = this.panel(this.content, 'StageDetail', 435, 690, 650, -10, colors.panel, colors.line, 1);
    this.label(detail, 'Name', '1-1  押册出垣', 0, 285, 350, 42, 25, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(detail, 'Objective', '完成首关战斗；中途可续战', 0, 225, 340, 30, 15, colors.muted, HorizontalTextAlignment.LEFT);
    this.label(detail, 'Enemy', '真实战斗入口', 0, 175, 330, 30, 16, colors.gold, HorizontalTextAlignment.LEFT);
    this.label(detail, 'Cost', '战斗结果写入本地存档', 0, 125, 330, 30, 15, colors.muted, HorizontalTextAlignment.LEFT);
    this.panel(detail, 'RewardLine', 350, 1, 0, 75, colors.line);
    this.label(detail, 'RewardTitle', '通关奖励', -75, 42, 200, 28, 15, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(detail, 'Rewards', this.campaignBattle.rewardLabel, 0, -18, 350, 62, 16, colors.bone);
    this.label(detail, 'Deck', '出战牌组  D001 / 30 张', 0, -110, 320, 30, 15, colors.muted, HorizontalTextAlignment.LEFT);
    this.button(detail, 'ViewDeck', '查看牌组', -92, -168, 160, 44, () => this.navigate('deck'));
    this.button(detail, 'Fight', '进入战斗', 0, -285, 300, 58, () => this.enterBattle(1), colors.jade, colors.gold);
  }

  private renderCards(): void {
    this.pageTitle('卡牌收藏', `已收集 ${this.state.cards.length} 张 · 收藏与升级记录保存在本地；首关战斗使用固定 D001 牌组。`);
    const selected = this.state.cards.find((card) => card.id === this.selectedCard) ?? this.state.cards[0];
    this.state.cards.forEach((card, index) => {
      const col = index % 6;
      const row = Math.floor(index / 6);
      const x = -560 + col * 190;
      const y = 125 - row * 310;
      const item = this.button(this.content, `Card-${card.id}`, '', x, y, 184, 290, () => { this.selectedCard = card.id; this.renderPage(); }, colors.clear, colors.clear);
      this.cardArt(item, card.id, 0, 38, 164, 170);
      const frame = this.node(item, 'CardFrame', 184, 290, 0, 0);
      this.loadSprite('ui/battle/battle-card-frame/spriteFrame', frame, 184, 290);
      this.label(item, 'Cost', String(card.cost), -69, 122, 32, 30, 18, colors.bone);
      if (selected.id === card.id) this.label(item, 'Selected', '已选', 52, 122, 52, 28, 15, colors.gold);
      this.label(item, 'Name', card.name, 0, -84, 166, 34, 19, colors.bone);
      this.label(item, 'Meta', `Lv.${card.level}  ×${card.copies}`, 0, -114, 160, 24, 14, colors.muted);
    });
    const panel = this.panel(this.content, 'CardDetail', 390, 620, 660, -10, colors.raised, colors.line, 1);
    this.label(panel, 'Name', selected.name, 0, 205, 280, 40, 25, colors.bone);
    this.cardArt(panel, selected.id, 0, 65, 250, 225);
    this.label(panel, 'Faction', `${selected.faction} · ${selected.kind === 'unit' ? '单位' : '法术'}`, 0, -75, 280, 30, 16, colors.gold);
    this.label(panel, 'Stats', `战力 ${selected.power}   准备 ${selected.cost}`, 0, -125, 280, 30, 19, colors.bone);
    this.label(panel, 'UpgradeCost', `升级需 2 张副卡 / ${selected.level * 500} 银币`, 0, -173, 280, 42, 14, colors.muted);
    this.button(panel, 'Upgrade', '升级', 0, -220, 245, 55, () => {
      this.toast(upgradeCard(this.state, selected.id) ? '卡牌升级成功' : '副卡或银币不足');
      this.renderChrome(); this.renderPage();
    }, colors.jade, colors.gold);
  }

  private renderDeck(): void {
    this.pageTitle('首关出战牌组', 'D001 · 展示战斗实际读取的 30 张卡；编辑编队尚未开放。');
    const deckPanel = this.panel(this.content, 'Deck', 1030, 620, -105, -15, colors.panel, colors.line, 1);
    this.label(deckPanel, 'DeckName', '护册队 · D001', -280, 265, 350, 38, 27, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(deckPanel, 'Count', `${this.battleDeck.length}/30`, 385, 265, 140, 34, 23, colors.gold);
    const visible = this.battleDeck.slice(this.deckPage * 10, this.deckPage * 10 + 10);
    visible.forEach((id, index) => {
      const x = -370 + (index % 5) * 185;
      const y = 95 - Math.floor(index / 5) * 265;
      const tile = this.panel(deckPanel, `BattleCard-${id}`, 165, 250, x, y, colors.clear, colors.clear, 1);
      tile.addComponent(Button);
      tile.on(Node.EventType.MOUSE_ENTER, () => this.setPointerCursor(true));
      tile.on(Node.EventType.MOUSE_LEAVE, () => this.setPointerCursor(false));
      tile.on(Node.EventType.TOUCH_END, () => {
        this.selectedBattleCard = id;
        this.renderPage();
      });
      this.cardArt(tile, id, 0, 25, 145, 145);
      const frame = this.node(tile, 'CardFrame', 165, 250, 0, 0);
      this.loadSprite('ui/battle/battle-card-frame/spriteFrame', frame, 165, 250);
      if (this.selectedBattleCard === id) this.label(tile, 'Selected', '已选', 44, 101, 50, 25, 14, colors.gold);
      const named = this.state.cards.find((card) => card.id === id);
      this.label(tile, 'CardName', named?.name ?? id, 0, -78, 145, 29, 17, colors.bone);
      this.label(tile, 'CardType', id.startsWith('S') ? '技能' : '单位', 0, -102, 130, 22, 14, colors.gold);
    });
    this.button(deckPanel, 'Previous', '上一页', -340, -340, 145, 44, () => {
      this.deckPage = Math.max(0, this.deckPage - 1); this.renderPage();
    });
    this.label(deckPanel, 'Page', `${this.deckPage + 1} / ${Math.max(1, Math.ceil(this.battleDeck.length / 10))}`, 0, -340, 150, 32, 19, colors.gold);
    this.button(deckPanel, 'Next', '下一页', 340, -340, 145, 44, () => {
      this.deckPage = Math.min(Math.max(0, Math.ceil(this.battleDeck.length / 10) - 1), this.deckPage + 1); this.renderPage();
    });
    const side = this.panel(this.content, 'DeckDetail', 360, 600, 625, -15, colors.panel, colors.line, 1);
    this.label(side, 'Title', '编队检查', 0, 245, 300, 42, 28, colors.bone);
    const units = this.battleDeck.filter((id) => id.startsWith('U')).length;
    const skills = this.battleDeck.filter((id) => id.startsWith('S')).length;
    this.label(side, 'UnitCount', `单位卡  ${units}`, 0, 198, 280, 33, 20, colors.gold);
    this.label(side, 'SkillCount', `技能卡  ${skills}`, 0, 160, 280, 33, 20, colors.gold);
    this.label(side, 'PreviewTitle', '当前选中', 0, 110, 280, 32, 19, colors.muted);
    this.cardArt(side, this.selectedBattleCard, 0, -20, 255, 210);
    const selected = this.state.cards.find((card) => card.id === this.selectedBattleCard);
    this.label(side, 'SelectedName', selected?.name ?? this.selectedBattleCard, 0, -145, 330, 37, 22, colors.bone);
    this.label(side, 'Fixed', '首关使用固定牌组', 0, -190, 320, 30, 16, colors.muted);
    this.button(side, 'Battle', '进入首关', 0, -250, 260, 57, () => this.enterBattle(1), colors.jade, colors.gold);
  }

  private renderHero(): void {
    this.pageTitle('主将与装备', '展示当前本地存档中的主将资料与装备。');
    const portrait = this.node(this.content, 'HeroPortrait', 390, 860, -340, -5);
    this.loadSprite('a0/commanders/C009-BATTLE-SIDESLOT/spriteFrame', portrait, 390, 860);
    this.label(this.content, 'HeroName', this.state.player.name, 75, 257, 360, 52, 43, new Color(20, 55, 46, 255));
    this.label(this.content, 'HeroProfession', `${this.state.player.profession}  Lv.${this.state.player.level}`, 75, 211, 330, 35, 23, colors.gold);
    const stats: Array<[string, string]> = [
      ['养成战力', String(this.state.player.power)],
      ['经验', `${this.state.player.xp}/${this.state.player.level * 100}`],
      ['银币', this.compact(this.state.resources.silver)],
      ['水晶', String(this.state.resources.crystal)],
    ];
    stats.forEach(([name, value], index) => {
      const chip = this.panel(this.content, `HeroStat-${name}`, 285, 68, 105, 147 - index * 87, new Color(19, 72, 60, 235), colors.gold, 2);
      this.loadSlicedSprite('ui/components/jade-button/spriteFrame', chip, 285, 68, 0.18, 0.25);
      this.label(chip, 'Name', name, -64, 0, 125, 34, 21, colors.bone);
      this.label(chip, 'Value', value, 71, 0, 110, 34, 21, colors.bone);
    });
    const professionNote = this.panel(this.content, 'FixedProfessionNote', 360, 42, 75, -285, new Color(18, 52, 44, 225), colors.gold, 1);
    this.loadSlicedSprite('ui/components/jade-button/spriteFrame', professionNote, 360, 42, 0.18, 0.25);
    this.label(professionNote, 'Text', '当前首关职业固定为镇军', 0, 0, 338, 31, 18, colors.bone);
    const equipment = this.node(this.content, 'Equipment', 580, 820, 560, -25);
    this.loadSprite('ui/components/equipment-rack/spriteFrame', equipment, 580, 820);
    this.label(equipment, 'Title', '装备', 0, 335, 230, 46, 28, colors.bone);
    const labels: Array<[keyof GameState['equipment'], string]> = [['weapon', '武器'], ['helmet', '头盔'], ['armor', '衣甲'], ['cloak', '披风']];
    labels.forEach(([key, label], index) => {
      const y = 188 - index * 170;
      this.label(equipment, `Level-${key}`, `+${this.state.equipment[key].level}`, 165, y, 70, 32, 20, colors.gold);
      this.hotspot(equipment, `Equip-${key}`, 0, y, 380, 145, () => this.toast(`${label}：${this.state.equipment[key].name} +${this.state.equipment[key].level}`));
    });
  }

  private renderAdventure(): void {
    this.pageTitle('历练', '模式预览 · 副本、挑战塔与 Boss 战斗尚未开放。');
    this.modePanel('副本', '山海遗踪', '预定为连续多场战斗。当前尚无可玩关卡。', -455, -15, '开发中', () => this.toast('副本尚未开放'));
    this.modePanel('挑战塔', '天阶试炼', '预定为逐层挑战。当前尚无可玩关卡。', 50, -15, '开发中', () => this.toast('挑战塔尚未开放'));
    this.modePanel('援军 Boss', '吞册玄龟', '预定为多阶段首领战。当前尚无可玩关卡。', 525, -15, '开发中', () => this.toast('Boss 战尚未开放'));
  }

  private modePanel(title: string, name: string, desc: string, x: number, y: number, count: string, action: () => void): void {
    const panel = this.node(this.content, `Mode-${title}`, 460, 800, x + 50, y);
    const image = this.node(panel, 'SceneImage', 340, 500, 0, 20);
    const key = title === '副本' ? 'mode-dungeon' : title === '挑战塔' ? 'mode-tower' : 'mode-boss';
    this.loadSprite(`ui/components/${key}/spriteFrame`, image, 340, 500);
    const frame = this.node(panel, 'PortalFrame', 460, 800, 0, 0);
    this.loadSprite('ui/components/adventure-portal/spriteFrame', frame, 460, 800);
    this.label(panel, 'Title', title, 0, 323, 280, 43, 26, colors.bone);
    this.label(panel, 'Name', name, 0, -235, 275, 47, 28, colors.ink);
    this.button(panel, 'Enter', '尚未开放', 0, -308, 230, 48, action, colors.soft, colors.line);
  }

  private renderCity(): void {
    const landscape = this.node(this.content, 'CityLandscape', W, H, 0, 0);
    this.loadSprite('ui/components/city-management/spriteFrame', landscape, W, H);
    this.pageTitle('营造与远征', '建筑升级与远征计时已接入本地存档。');
    const definitions: Array<[keyof GameState['buildings'], string, number, number]> = [
      ['castle', '主堡', 175, 235],
      ['alchemy', '炼金房', -275, 155],
      ['forge', '铁匠铺', -360, -315],
      ['harbor', '远征港口', 440, -250],
    ];
    definitions.forEach(([id, name, x, y]) => {
      const tag = this.panel(this.content, `Building-${id}`, 280, 62, x, y, new Color(15, 40, 35, 235), colors.gold, 2);
      this.loadSlicedSprite('ui/components/jade-button/spriteFrame', tag, 280, 62, 0.18, 0.25);
      this.label(tag, 'Name', name, -38, 0, 172, 39, 25, colors.bone);
      this.label(tag, 'Level', `Lv.${this.state.buildings[id]}`, 94, 0, 75, 32, 19, colors.gold);
      if (id === 'harbor') {
        const ready = this.state.expedition.active && Date.now() >= this.state.expedition.endsAt;
        const label = ready ? '领取返航' : this.state.expedition.active ? '远征中' : '派遣';
        this.button(this.content, 'Expedition', label, x, y - 60, 170, 46, () => {
          const ok = ready ? claimExpedition(this.state) : startExpedition(this.state);
          this.toast(ok ? (ready ? '远征奖励已入账' : '远征队已出发，60 秒后返航') : '当前无法执行');
          this.renderChrome(); this.renderPage();
        }, ready ? colors.jade : colors.raised, colors.gold);
      } else {
        this.button(this.content, `Upgrade-${id}`, '升级', x, y - 60, 170, 46, () => {
          this.toast(upgradeBuilding(this.state, id) ? `${name}已升级` : '资源不足或需先提升主堡');
          this.renderChrome(); this.renderPage();
        });
      }
    });
  }

  private renderTasks(): void {
    this.pageTitle('任务', '任务进度与领取状态来自本地存档。');
    const tasks = Object.values(this.state.tasks);
    const completion = Math.round(tasks.reduce((sum, task) => sum + Math.min(1, task.progress / task.target), 0) / tasks.length * 100);
    this.label(this.content, 'Completion', `任务总进度  ${completion}/100`, -370, 295, 350, 42, 24, new Color(24, 58, 49, 255), HorizontalTextAlignment.LEFT);
    const rewards = this.node(this.content, 'ActivityRewards', 1220, 320, 40, 246);
    this.loadSprite('ui/components/task-rewards/spriteFrame', rewards, 1220, 320);
    this.panel(this.content, 'CompletionTrack', 1050, 8, 75, 205, new Color(14, 45, 39, 225), colors.gold, 1);
    if (completion) this.panel(this.content, 'CompletionFill', 1050 * completion / 100, 8, -450 + 525 * completion / 100, 205, colors.jade);
    [25, 50, 75, 100].forEach((mark, index) => this.label(this.content, `Milestone-${mark}`, String(mark), [-175, 70, 290, 510][index], 165, 70, 27, 16, new Color(28, 49, 43, 255)));
    const scroll = this.node(this.content, 'TaskScroll', 1490, 610, 40, -155);
    this.loadSprite('ui/components/task-scroll/spriteFrame', scroll, 1490, 610);
    const definitions: Array<[keyof GameState['tasks'], string, string]> = [
      ['stage', '征战白鹿古道', '完成 4 次首关战斗'],
      ['upgrade', '整备新军', '完成 1 次卡牌升级'],
      ['tower', '登临天阶', '挑战塔待开放，此任务暂不可推进'],
    ];
    definitions.forEach(([id, name, desc], index) => {
      const task = this.state.tasks[id];
      const row = this.node(scroll, `Task-${id}`, 1250, 140, 0, 155 - index * 155);
      const ink = new Color(30, 52, 45, 255);
      const icon = this.panel(row, 'Medallion', 78, 78, -520, 0, new Color(22, 98, 78, 255), colors.gold, 2);
      this.label(icon, 'Glyph', ['征', '阵', '历'][index], 0, 0, 66, 66, 39, colors.bone);
      this.label(row, 'Name', name, -255, 22, 345, 37, 25, ink, HorizontalTextAlignment.LEFT);
      this.label(row, 'Desc', desc, -255, -25, 360, 29, 17, ink, HorizontalTextAlignment.LEFT);
      this.label(row, 'Progress', `${Math.min(task.progress, task.target)}/${task.target}`, 55, 9, 110, 35, 24, new Color(24, 128, 86, 255));
      this.label(row, 'Reward', '银币 1200  ·  水晶 30', 295, 8, 290, 37, 18, ink);
      this.button(row, 'Claim', task.claimed ? '已领取' : task.progress >= task.target ? '领取' : '未完成', 555, 0, 165, 54, () => {
        this.toast(claimTask(this.state, id) ? '任务奖励已入账' : '当前不可领取');
        this.renderChrome(); this.renderPage();
      }, task.progress >= task.target && !task.claimed ? colors.jade : colors.soft, colors.line);
    });
  }

  private renderInventory(): void {
    this.pageTitle('行囊', '当前本地存档中的材料库存；点击物品查看数量。');
    const titlePlate = this.panel(this.content, 'InventoryTitlePlate', 300, 64, -360, 407, new Color(10, 35, 32, 220), colors.gold, 1);
    this.loadSlicedSprite('ui/components/jade-button/spriteFrame', titlePlate, 300, 64, 0.18, 0.25);
    this.label(this.content, 'InventoryTitle', '行囊', -360, 407, 260, 48, 31, colors.gold);
    const list = this.node(this.content, 'InventoryList', 1000, 810, -55, -25);
    this.loadSprite('ui/components/inventory-shelf/spriteFrame', list, 1000, 810);
    this.label(list, 'AllTab', '全部', -303, 285, 130, 34, 20, colors.bone);
    Object.entries(this.state.inventory).forEach(([name, count], index) => {
      const col = index % 5;
      const row = Math.floor(index / 5);
      const x = -320 + col * 160;
      const y = 132 - row * 190;
      const item = this.node(list, `Item-${name}`, 145, 140, x, y);
      item.addComponent(Button);
      if (this.selectedItem === name) this.panel(item, 'SelectedBorder', 138, 131, 0, 0, colors.clear, colors.gold, 3);
      this.itemIcon(item, name, 112);
      this.label(item, 'Count', String(count), 50, -45, 42, 28, 21, colors.bone);
      item.on(Node.EventType.MOUSE_ENTER, () => this.setPointerCursor(true));
      item.on(Node.EventType.MOUSE_LEAVE, () => this.setPointerCursor(false));
      item.on(Node.EventType.TOUCH_END, () => {
        this.selectedItem = name;
        this.renderPage();
      });
    });
    const detail = this.panel(this.content, 'ItemDetail', 365, 575, 600, -65, colors.panel, colors.line, 1);
    this.label(detail, 'Title', `${this.selectedItem}  ×${this.state.inventory[this.selectedItem] ?? 0}`, 0, 230, 350, 46, 27, colors.gold);
    const selectedIcon = this.node(detail, 'SelectedIcon', 230, 230, 0, 82);
    this.itemIcon(selectedIcon, this.selectedItem, 225);
    this.label(detail, 'Hint', `持有数量 ×${this.state.inventory[this.selectedItem] ?? 0} · 使用功能待开放`, 0, -120, 350, 58, 18, colors.muted);
    this.button(detail, 'Use', '暂不可使用', 0, -220, 260, 58, () => this.toast('物品使用功能尚未开放'), colors.soft, colors.line);
  }

  private itemIcon(parent: Node, name: string, size: number): void {
    const key = inventoryIcons[name];
    if (!key) return void this.label(parent, 'Fallback', name.slice(0, 1), 0, 0, size, size, size * 0.48, colors.gold);
    const image = this.node(parent, 'ItemImage', size, size, 0, 0);
    this.loadSprite(`ui/components/${key}/spriteFrame`, image, size, size);
  }

  private enterBattle(stage: number, mode: 'campaign' | 'dungeon' | 'tower' | 'boss' = 'campaign'): void {
    if(stage!==1||mode!=='campaign')return this.toast('当前真实战斗入口仅开放首关');
    try{this.campaignBattle.enter();}catch(error){return this.toast(error instanceof Error?error.message:String(error));}
    this.state=loadGame();this.activeStage=1;this.battleMode='campaign';
    this.shell.active=false;this.battleRoot.active=true;this.battleToolbar.active=false;
  }

  private returnFromBattle(): void {
    try{this.campaignBattle.exit();}catch(error){return this.toast(error instanceof Error?error.message:String(error));}
    this.battleRoot.active=false;this.battleToolbar.active=false;this.shell.active=true;
    this.state=loadGame();this.renderChrome();this.renderPage();
  }

  private openSettings(): void {
    const modal = this.panel(this.shell, 'SettingsModal', W, H, 0, 0, new Color(0, 0, 0, 165));
    const box = this.panel(modal, 'Box', 620, 400, 0, 0, colors.panel, colors.gold, 1);
    this.label(box, 'Title', '当前版本', -250, 135, 260, 40, 28, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(box, 'Scope', '首关战斗与九个系统页面可体验。\n副本、挑战塔与编队编辑仍在开发。', 0, 35, 500, 95, 17, colors.muted);
    this.button(box, 'Reset', '重置测试存档', -120, -135, 230, 48, () => {
      this.state = resetGame(); modal.destroy(); this.renderChrome(); this.renderPage(); this.toast('测试存档已重置');
    }, colors.red, colors.line);
    this.button(box, 'Close', '关闭', 170, -135, 170, 48, () => modal.destroy());
  }

  private progressRow(name: string, value: number, max: number, x: number, y: number): void {
    this.label(this.content, `${name}-Label`, name, x - 115, y, 210, 26, 14, colors.muted, HorizontalTextAlignment.LEFT);
    this.panel(this.content, `${name}-Track`, 220, 8, x + 95, y, new Color(18, 22, 20, 255));
    this.panel(this.content, `${name}-Fill`, 220 * Math.min(1, value / max), 8, x - 15 + 110 * Math.min(1, value / max), y, colors.jade);
    this.label(this.content, `${name}-Value`, `${value}/${max}`, x + 240, y, 70, 24, 13, colors.gold);
  }

  private ruleRow(parent: Node, name: string, value: number, max: number, y: number): void {
    this.label(parent, `${name}-Name`, name, -190, y, 220, 28, 15, colors.muted, HorizontalTextAlignment.LEFT);
    this.label(parent, `${name}-Value`, `${value}/${max}`, 160, y, 80, 28, 16, value <= max ? colors.jade : colors.red);
  }

  private statRow(parent: Node, name: string, value: number, y: number): void {
    this.label(parent, `${name}-Name`, name, -175, y, 120, 28, 15, colors.muted, HorizontalTextAlignment.LEFT);
    this.label(parent, `${name}-Value`, String(value), 160, y, 100, 30, 18, colors.bone);
    this.panel(parent, `${name}-Line`, 400, 1, 0, y - 31, colors.line);
  }

  private rewardChip(parent: Node, name: string, value: string, x: number, y: number): void {
    const chip = this.panel(parent, `Reward-${name}`, 180, 62, x, y, colors.raised, colors.line, 1);
    this.label(chip, 'Name', name, -45, 13, 100, 22, 13, colors.muted);
    this.label(chip, 'Value', value, 43, 0, 60, 28, 17, colors.bone);
  }

  private cardArt(parent: Node, id: string, x: number, y: number, width: number, height: number): void {
    const host = this.panel(parent, `Art-${id}`, width, height, x, y, new Color(65, 74, 68, 255));
    if (/^U\d{3}$/.test(id)) {
      const image = this.node(host, 'Image', width - 4, height - 4, 0, 0);
      this.loadSprite(`demo/cards/${id}/spriteFrame`, image, width - 4, height - 4);
    }
    else {
      const position: Record<string, [number, number]> = {
        S001: [0, 0], S002: [1, 0], S003: [2, 0],
        S004: [0, 1], S006: [1, 1], S014: [2, 1],
      };
      const cell = position[id];
      if (!cell) return void this.label(host, 'Fallback', '法', 0, 0, Math.min(80, width), Math.min(80, height), Math.min(34, height * 0.52), colors.gold);
      const image = this.node(host, 'Image', width - 4, height - 4, 0, 0);
      resources.load('ui/components/skill-art-atlas/spriteFrame', SpriteFrame, (error, source) => {
        if (error || !image.isValid) return;
        const frame = new SpriteFrame();
        frame.texture = source.texture;
        frame.rect = new Rect(cell[0] * source.texture.width / 3, cell[1] * source.texture.height / 2, source.texture.width / 3, source.texture.height / 2);
        const sprite = image.addComponent(Sprite);
        sprite.spriteFrame = frame;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        image.getComponent(UITransform)!.setContentSize(width - 4, height - 4);
      });
    }
  }

  private stageName(stage: number): string {
    return ['押册出垣', '林道伏击', '断桥', '白鹿渡口', '异兽潮', '沉册坑', '旧神庙', '无名祭坛', '仙门阵眼', '龙骨关', '天序裂口', '吞册玄龟'][stage - 1] ?? '未知节点';
  }

  private compact(value: number): string {
    return value >= 10_000 ? `${(value / 10_000).toFixed(1)}万` : String(value);
  }

  private toast(message: string): void {
    if (!this.notice?.isValid) return;
    this.notice.destroyAllChildren();
    this.label(this.notice, 'Message', message, 0, 0, 490, 34, 15, colors.bone);
    const opacity = this.notice.getComponent(UIOpacity) ?? this.notice.addComponent(UIOpacity);
    Tween.stopAllByTarget(opacity);
    Tween.stopAllByTarget(this.notice);
    opacity.opacity = 0;
    this.notice.setScale(0.985, 0.985, 1);
    this.notice.active = true;
    tween(opacity)
      .to(0.12, { opacity: 255 }, { easing: 'quadOut' })
      .delay(1.65)
      .to(0.2, { opacity: 0 }, { easing: 'quadIn' })
      .call(() => { if (this.notice?.isValid) this.notice.active = false; })
      .start();
    tween(this.notice).to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  private loadSprite(path: string, host: Node, width: number, height: number, color = Color.WHITE, onLoaded?: () => void): void {
    resources.load(path, SpriteFrame, (error, frame) => {
      if (error || !host.isValid) return;
      const sprite = host.getComponent(Sprite) ?? host.addComponent(Sprite);
      sprite.spriteFrame = frame;
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.color = color;
      host.getComponent(UITransform)!.setContentSize(width, height);
      onLoaded?.();
    });
  }

  private node(parent: Node, name: string, width: number, height: number, x: number, y: number): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    node.setPosition(x, y);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height);
    transform.setAnchorPoint(0.5, 0.5);
    return node;
  }

  private panel(parent: Node, name: string, width: number, height: number, x: number, y: number, fill: Color, stroke?: Color, lineWidth = 1): Node {
    const node = this.node(parent, name, width, height, x, y);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = fill;
    graphics.roundRect(-width / 2, -height / 2, width, height, Math.min(12, height / 5));
    graphics.fill();
    if (stroke && stroke.a > 0) {
      graphics.lineWidth = lineWidth;
      graphics.strokeColor = stroke;
      graphics.roundRect(-width / 2 + lineWidth / 2, -height / 2 + lineWidth / 2, width - lineWidth, height - lineWidth, Math.min(12, height / 5));
      graphics.stroke();
    }
    if (width >= 280 && height >= 140 && name !== 'Base' && name !== 'BackdropShade' && name !== 'SettingsModal') {
      this.loadSlicedSprite('ui/components/jade-panel/spriteFrame', node, width, height, 0.14, 0.20);
    }
    return node;
  }

  private loadSlicedSprite(path: string, host: Node, width: number, height: number, horizontalInset: number, verticalInset: number): void {
    resources.load(path, SpriteFrame, (error, frame) => {
      if (error || !host.isValid) return;
      frame.insetLeft = frame.width * horizontalInset;
      frame.insetRight = frame.width * horizontalInset;
      frame.insetTop = frame.height * verticalInset;
      frame.insetBottom = frame.height * verticalInset;
      const surfaceHeight = height * (path.includes('jade-button') ? 1.9 : 1.16);
      const surface = this.node(host, 'ArtworkSurface', width, surfaceHeight, 0, 0);
      surface.setSiblingIndex(0);
      const sprite = surface.addComponent(Sprite);
      sprite.spriteFrame = frame;
      sprite.type = path.includes('jade-button') ? Sprite.Type.SIMPLE : Sprite.Type.SLICED;
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      surface.getComponent(UITransform)!.setContentSize(width, surfaceHeight);
    });
  }

  private label(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number, size: number, color: Color, align = HorizontalTextAlignment.CENTER): Node {
    const node = this.node(parent, name, width, height, x, y);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.fontFamily = gameUiFontFamily;
    label.lineHeight = size + 5;
    label.color = color;
    label.horizontalAlign = align;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return node;
  }

  private button(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number, action: () => void, fill = colors.raised, stroke = colors.line): Node {
    const node = this.panel(parent, name, width, height, x, y, fill, stroke, 1);
    node.addComponent(Button);
    if (width >= 90 && height >= 38 && height <= 100) this.loadSlicedSprite('ui/components/jade-button/spriteFrame', node, width, height, 0.18, 0.25);
    node.on(Node.EventType.MOUSE_ENTER, () => { this.setPointerCursor(true); tween(node).to(0.1, { scale: new Vec3(1.035, 1.035, 1) }).start(); });
    node.on(Node.EventType.MOUSE_LEAVE, () => { this.setPointerCursor(false); tween(node).to(0.1, { scale: new Vec3(1, 1, 1) }).start(); });
    node.on(Node.EventType.TOUCH_END, action);
    if (text) this.label(node, 'Text', text, 0, 0, width - 20, height - 10, Math.min(19, Math.max(14, height * 0.32)), colors.bone);
    return node;
  }

  private hotspot(parent: Node, name: string, x: number, y: number, width: number, height: number, action: () => void): Node {
    const node = this.node(parent, name, width, height, x, y);
    node.addComponent(Button);
    const feedback = this.node(node, 'InteractionFeedback', width, height, 0, 0);
    const graphics = feedback.addComponent(Graphics);
    const isNavigation = name.startsWith('NavHotspot-');
    const visualWidth = isNavigation ? width : Math.min(width * 0.72, 210);
    const visualHeight = isNavigation ? height : Math.min(height * 0.68, 54);
    graphics.fillColor = isNavigation ? new Color(73, 201, 155, 30) : new Color(245, 225, 169, 24);
    graphics.roundRect(-visualWidth / 2, -visualHeight / 2, visualWidth, visualHeight, isNavigation ? 0 : 6);
    graphics.fill();
    graphics.fillColor = isNavigation ? colors.jade : colors.gold;
    graphics.rect(-visualWidth * 0.34, -visualHeight / 2, visualWidth * 0.68, 2);
    graphics.fill();
    const opacity = feedback.addComponent(UIOpacity);
    opacity.opacity = 0;
    let hovered = false;
    const fadeTo = (value: number, duration: number) => {
      Tween.stopAllByTarget(opacity);
      tween(opacity).to(duration, { opacity: value }, { easing: 'quadOut' }).start();
    };
    node.on(Node.EventType.MOUSE_ENTER, () => {
      hovered = true;
      this.setPointerCursor(true);
      fadeTo(255, 0.1);
    });
    node.on(Node.EventType.MOUSE_LEAVE, () => {
      hovered = false;
      this.setPointerCursor(false);
      fadeTo(0, 0.14);
    });
    node.on(Node.EventType.TOUCH_START, () => {
      Tween.stopAllByTarget(feedback);
      feedback.setScale(1, 1, 1);
      fadeTo(255, 0.05);
      tween(feedback).to(0.07, { scale: new Vec3(0.985, 0.92, 1) }, { easing: 'quadOut' }).start();
    });
    node.on(Node.EventType.TOUCH_CANCEL, () => {
      Tween.stopAllByTarget(feedback);
      feedback.setScale(1, 1, 1);
      fadeTo(hovered ? 255 : 0, 0.1);
    });
    node.on(Node.EventType.TOUCH_END, () => {
      Tween.stopAllByTarget(feedback);
      tween(feedback).to(0.09, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
      fadeTo(hovered ? 255 : 0, 0.12);
      action();
    });
    return node;
  }

  private setPointerCursor(active: boolean): void {
    const canvas = document.querySelector('canvas');
    if (canvas instanceof HTMLCanvasElement) canvas.style.cursor = active ? 'pointer' : 'default';
  }
}
