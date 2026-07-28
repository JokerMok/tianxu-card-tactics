import {
  Button,
  Color,
  Graphics,
  HorizontalTextAlignment,
  Label,
  Layers,
  Node,
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
  createDefaultState,
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

const W = 1920;
const H = 1080;
const colors = {
  ink: new Color(19, 23, 22, 255),
  panel: new Color(31, 37, 34, 244),
  raised: new Color(48, 56, 51, 250),
  soft: new Color(78, 88, 80, 210),
  jade: new Color(43, 154, 111, 255),
  gold: new Color(205, 170, 91, 255),
  red: new Color(190, 67, 51, 255),
  bone: new Color(246, 242, 228, 255),
  muted: new Color(190, 197, 188, 255),
  line: new Color(168, 157, 126, 145),
  clear: new Color(0, 0, 0, 0),
};

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

const pageArtwork: Record<PageId, string> = {
  home: 'ui/image2/UI01-home/spriteFrame',
  campaign: 'ui/image2/UI02-campaign/spriteFrame',
  cards: 'ui/image2/UI03-cards/spriteFrame',
  deck: 'ui/image2/UI04-deck/spriteFrame',
  hero: 'ui/image2/UI05-hero/spriteFrame',
  adventure: 'ui/image2/UI06-adventure/spriteFrame',
  city: 'ui/image2/UI07-city/spriteFrame',
  tasks: 'ui/image2/UI08-tasks/spriteFrame',
  inventory: 'ui/image2/UI09-inventory/spriteFrame',
};

export class GameShell {
  private shell!: Node;
  private content!: Node;
  private battleToolbar!: Node;
  private state: GameState = loadGame();
  private page: PageId = 'home';
  private selectedCard = 'U002';
  private notice!: Node;
  private activeStage = 1;
  private battleMode: 'campaign' | 'dungeon' | 'tower' | 'boss' = 'campaign';

  constructor(private host: Node, private battleRoot: Node) {}

  mount(): void {
    this.battleRoot.active = false;
    this.shell = this.node(this.host, 'GameShell', W, H, 0, 0);
    this.panel(this.shell, 'Base', W, H, 0, 0, colors.ink);
    this.content = this.node(this.shell, 'PageContent', W, H, 0, 0);
    this.notice = this.panel(this.shell, 'Notice', 520, 54, 105, -472, new Color(14, 18, 16, 238), colors.gold, 1);
    this.notice.active = false;
    this.drawBattleToolbar();
    this.renderPage();
    const runtime = globalThis as Record<string, any>;
    runtime.__META_BATTLE_COMPLETE__ = (victory = true) => this.returnFromBattle(victory);
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
      finishBattle: (victory = true) => this.returnFromBattle(victory),
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
    this.loadSprite('a0/background/E104-PARALLAX-BOARD/spriteFrame', image, W, H, new Color(205, 218, 207, 115));
    this.panel(this.shell, 'BackdropShade', W, H, 0, 0, new Color(15, 20, 18, 168));
  }

  private drawTopBar(): void {
    const top = this.panel(this.shell, 'TopBar', W, 92, 0, 494, new Color(20, 25, 23, 248), colors.line, 1);
    this.label(top, 'Brand', '天序·无名之卷', -790, 10, 270, 34, 25, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(top, 'Profile', `${this.state.player.name}  Lv.${this.state.player.level}  ${this.state.player.profession}`, -780, -23, 310, 24, 14, colors.muted, HorizontalTextAlignment.LEFT);
    this.label(top, 'Power', `战力 ${this.state.player.power}`, -455, 0, 150, 34, 18, colors.gold);
    this.resource(top, '体力', `${this.state.resources.stamina}/${this.state.resources.staminaMax}`, 190);
    this.resource(top, '银币', this.compact(this.state.resources.silver), 390);
    this.resource(top, '水晶', this.compact(this.state.resources.crystal), 590);
    this.button(top, 'Settings', '设置', 830, 0, 100, 44, () => this.openSettings());
  }

  private resource(parent: Node, name: string, value: string, x: number): void {
    this.label(parent, `${name}-Name`, name, x - 68, 0, 60, 24, 13, colors.muted);
    this.label(parent, `${name}-Value`, value, x + 18, 0, 110, 28, 18, colors.bone);
  }

  private drawNavigation(): void {
    const rail = this.panel(this.shell, 'Navigation', 210, 988, -855, -46, new Color(22, 28, 25, 246), colors.line, 1);
    navigation.forEach(([id, name, glyph], index) => {
      const y = 390 - index * 91;
      const active = id === this.page;
      const button = this.button(rail, `Nav-${id}`, name, 10, y, 178, 68, () => this.navigate(id), active ? colors.jade : colors.raised, active ? colors.gold : colors.clear);
      this.label(button, 'Glyph', glyph, -58, 0, 36, 36, 19, active ? colors.bone : colors.gold);
    });
  }

  private drawBattleToolbar(): void {
    this.battleToolbar = this.panel(this.host, 'MetaBattleToolbar', 150, 52, -872, -502, new Color(18, 22, 20, 238), colors.gold, 1);
    this.button(this.battleToolbar, 'Return', '返回主城', 0, 0, 132, 38, () => this.returnFromBattle(false));
    this.battleToolbar.active = false;
  }

  private navigate(page: PageId): void {
    this.page = page;
    this.renderChrome();
    this.renderPage();
  }

  private renderChrome(): void {
    // The approved Image 2 screens own the complete chrome. Runtime state remains
    // independent so visual composition cannot drift between Cocos and the source art.
  }

  private renderPage(): void {
    this.content.destroyAllChildren();
    const requestedPage = this.page;
    const art = this.node(this.content, `Artwork-${requestedPage}`, W, H, 0, 0);
    const artOpacity = art.addComponent(UIOpacity);
    artOpacity.opacity = 0;
    art.setScale(1.012, 1.012, 1);
    const runtime = globalThis as Record<string, any>;
    runtime.__META_ART_PAGE__ = null;
    this.loadSprite(pageArtwork[requestedPage], art, W, H, Color.WHITE, () => {
      if (this.page !== requestedPage) return;
      runtime.__META_ART_PAGE__ = requestedPage;
      Tween.stopAllByTarget(artOpacity);
      Tween.stopAllByTarget(art);
      tween(artOpacity).to(0.18, { opacity: 255 }, { easing: 'quadOut' }).start();
      tween(art).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
    });
    this.drawNavigationHotspots();
    this.drawPageHotspots();
    this.drawDynamicStateOverlays();
  }

  private drawDynamicStateOverlays(): void {
    const defaults = createDefaultState();
    if (this.state.resources.stamina !== defaults.resources.stamina) {
      this.dynamicPatch('LiveStamina', `${this.state.resources.stamina}/${this.state.resources.staminaMax}`, 266, 507, 150, 36);
    }
    if (this.state.resources.silver !== defaults.resources.silver) {
      this.dynamicPatch('LiveSilver', this.compact(this.state.resources.silver), 492, 507, 138, 36);
    }
    if (this.state.resources.crystal !== defaults.resources.crystal) {
      this.dynamicPatch('LiveCrystal', String(this.state.resources.crystal), 720, 507, 116, 36);
    }

    if (this.page === 'campaign' && this.state.campaign.selectedStage !== defaults.campaign.selectedStage) {
      const stage = this.state.campaign.selectedStage;
      this.dynamicPatch('LiveStage', `1-${stage} ${this.stageName(stage)}`, 620, 250, 390, 58, 24);
    }
    if (this.page === 'cards') {
      const card = this.state.cards.find((entry) => entry.id === this.selectedCard);
      const defaultCard = defaults.cards.find((entry) => entry.id === this.selectedCard);
      if (card && (card.id !== 'U002' || card.level !== defaultCard?.level)) {
        this.dynamicPatch('LiveCardName', card.name, 620, 165, 350, 46, 21);
        this.dynamicPatch('LiveCardStats', `战力 ${card.power}  准备 ${card.cost}`, 620, -160, 350, 42, 16);
      }
    }
    if (this.page === 'hero' && (this.state.player.profession !== defaults.player.profession || this.state.player.level !== defaults.player.level)) {
      this.dynamicPatch('LiveProfession', `${this.state.player.profession} Lv.${this.state.player.level}`, 70, 215, 270, 42, 18);
    }
    if (this.page === 'city') {
      const anchors: Record<keyof GameState['buildings'], [number, number]> = {
        alchemy: [-355, 205], castle: [110, 285], forge: [-390, -210], harbor: [420, -155],
      };
      (Object.keys(this.state.buildings) as Array<keyof GameState['buildings']>).forEach((id) => {
        if (this.state.buildings[id] === defaults.buildings[id]) return;
        const [x, y] = anchors[id];
        this.dynamicPatch(`LiveBuilding-${id}`, `Lv.${this.state.buildings[id]}`, x, y, 86, 34, 15);
      });
    }
    if (this.page === 'tasks') {
      const anchors: Record<string, [number, number]> = { stage: [90, 38], upgrade: [90, -105], tower: [90, -275] };
      Object.entries(this.state.tasks).forEach(([id, task]) => {
        const original = defaults.tasks[id];
        if (!original || (task.progress === original.progress && task.claimed === original.claimed)) return;
        const [x, y] = anchors[id];
        this.dynamicPatch(`LiveTask-${id}`, `${task.progress}/${task.target}`, x, y, 120, 44, 18);
        if (task.claimed) this.dynamicPatch(`LiveTaskClaimed-${id}`, '已领取', 485, y, 170, 54, 17);
      });
    }
    if (this.page === 'inventory') {
      const names = ['强化石', '山海鳞片', '法印残片', '远征券'];
      names.forEach((name, index) => {
        const count = this.state.inventory[name] ?? 0;
        if (count === defaults.inventory[name]) return;
        this.dynamicPatch(`LiveInventory-${index}`, String(count), -342 + index * 165, 72, 48, 28, 14);
      });
    }
  }

  private dynamicPatch(name: string, text: string, x: number, y: number, width: number, height: number, size = 18): void {
    const patch = this.panel(this.content, name, width, height, x, y, new Color(18, 27, 24, 255));
    this.label(patch, 'Value', text, 0, 0, width - 10, height - 6, size, colors.bone);
  }

  private drawNavigationHotspots(): void {
    const centers = [343, 258, 175, 92, 12, -73, -154, -239, -323];
    navigation.forEach(([id], index) => {
      this.hotspot(this.content, `NavHotspot-${id}`, -825, centers[index], 230, 74, () => this.navigate(id));
    });
  }

  private drawPageHotspots(): void {
    switch (this.page) {
      case 'home':
        this.hotspot(this.content, 'ContinueHotspot', 118, -80, 330, 86, () => this.navigate('campaign'));
        this.hotspot(this.content, 'DeckShortcut', -80, -340, 150, 170, () => this.navigate('deck'));
        this.hotspot(this.content, 'CardsShortcut', 110, -340, 150, 170, () => this.navigate('cards'));
        this.hotspot(this.content, 'CityShortcut', 300, -340, 150, 170, () => this.navigate('city'));
        break;
      case 'campaign':
        [
          [-570, -80], [-440, 15], [-270, 120], [-55, 180], [197, 143],
          [295, 0], [245, -128], [-13, -196], [-308, -155], [-553, -211],
        ].forEach(([x, y], index) => {
          const stage = index < 8 ? index + 1 : index === 8 ? 10 : 12;
          this.hotspot(this.content, `StageHotspot-${stage}`, x, y, 82, 82, () => {
            if (stage > this.state.campaign.unlocked) return this.toast('需要先通关前置关卡');
            this.state.campaign.selectedStage = stage;
            saveGame(this.state);
            this.renderPage();
            this.toast(`已选择 1-${stage} ${this.stageName(stage)}`);
          });
        });
        this.hotspot(this.content, 'EditDeckHotspot', 630, -178, 250, 64, () => this.navigate('deck'));
        this.hotspot(this.content, 'FightHotspot', 640, -286, 300, 84, () => this.enterBattle(this.state.campaign.selectedStage));
        break;
      case 'cards':
        this.state.cards.forEach((card, index) => {
          const x = -562 + (index % 6) * 196;
          const y = index < 6 ? 125 : -180;
          this.hotspot(this.content, `OwnedCardHotspot-${card.id}`, x, y, 176, 276, () => {
            this.selectedCard = card.id;
            this.renderPage();
            this.toast(`已选择 ${card.name} · Lv.${card.level}`);
          });
        });
        this.hotspot(this.content, 'UpgradeCardHotspot', 650, -240, 240, 72, () => {
          const upgraded = upgradeCard(this.state, this.selectedCard);
          if (upgraded) this.renderPage();
          this.toast(upgraded ? '卡牌升级成功' : '副卡或银币不足');
        });
        break;
      case 'deck':
        this.hotspot(this.content, 'AutoDeckHotspot', 630, -250, 250, 70, () => this.toast('当前牌组已符合 8 单位、2 技能限制'));
        break;
      case 'hero':
        ['weapon', 'helmet', 'armor', 'cloak'].forEach((slot, index) => {
          this.hotspot(this.content, `EquipmentHotspot-${slot}`, 520, 170 - index * 140, 430, 112, () => {
            const item = this.state.equipment[slot as keyof GameState['equipment']];
            this.toast(`${item.name} +${item.level}`);
          });
        });
        this.hotspot(this.content, 'ProfessionHotspot', 100, -275, 270, 72, () => {
          const list = ['镇军', '方士', '游侠', '神使'];
          this.state.player.profession = list[(list.indexOf(this.state.player.profession) + 1) % list.length];
          saveGame(this.state);
          this.renderPage();
          this.toast(`职业已切换为${this.state.player.profession}`);
        });
        break;
      case 'adventure':
        this.hotspot(this.content, 'DungeonHotspot', -390, -285, 260, 72, () => this.enterBattle(5, 'dungeon'));
        this.hotspot(this.content, 'TowerHotspot', 0, -285, 260, 72, () => this.enterBattle(8, 'tower'));
        this.hotspot(this.content, 'BossHotspot', 455, -285, 260, 72, () => this.enterBattle(12, 'boss'));
        break;
      case 'city':
        this.hotspot(this.content, 'AlchemyHotspot', -310, 105, 170, 60, () => this.upgradeBuildingFromArt('alchemy', '炼金房'));
        this.hotspot(this.content, 'CastleHotspot', 110, 185, 170, 60, () => this.upgradeBuildingFromArt('castle', '主堡'));
        this.hotspot(this.content, 'ForgeHotspot', -345, -275, 170, 60, () => this.upgradeBuildingFromArt('forge', '铁匠铺'));
        this.hotspot(this.content, 'HarborHotspot', 440, -225, 170, 60, () => {
          const ready = this.state.expedition.active && Date.now() >= this.state.expedition.endsAt;
          const ok = ready ? claimExpedition(this.state) : startExpedition(this.state);
          if (ok) this.renderPage();
          this.toast(ok ? (ready ? '远征奖励已入账' : '远征队已出发') : '当前无法执行');
        });
        break;
      case 'tasks':
        this.hotspot(this.content, 'ClaimStageHotspot', 485, 38, 210, 68, () => this.claimTaskFromArt('stage'));
        this.hotspot(this.content, 'ClaimUpgradeHotspot', 485, -105, 210, 68, () => this.claimTaskFromArt('upgrade'));
        this.hotspot(this.content, 'ClaimTowerHotspot', 485, -250, 210, 68, () => this.claimTaskFromArt('tower'));
        break;
      case 'inventory':
        ['全部', '武器', '防具', '药材', '晶石', '卷轴', '消耗品', '材料'].forEach((name, index) => {
          this.hotspot(this.content, `InventoryTab-${index}`, -355 + index * 87, 255, 72, 58, () => this.toast(`已切换：${name}`));
        });
        [
          ['强化石', 36], ['山海鳞片', 14], ['法印残片', 8], ['远征券', 5], ['玄铁矿', 23],
          ['赤金晶', 18], ['雪参', 27], ['朱果', 31], ['凝露花', 19], ['古卷', 12],
          ['乌金矿', 17], ['断刃', 21], ['缚神索', 28], ['玄晶', 16], ['阵法残卷', 9],
        ].forEach(([name, count], index) => {
          const x = -390 + (index % 5) * 165;
          const y = 105 - Math.floor(index / 5) * 190;
          this.hotspot(this.content, `InventoryItem-${index}`, x, y, 145, 170, () => this.toast(`已选择 ${name} ×${count}`));
        });
        this.hotspot(this.content, 'UseItemHotspot', 580, -255, 250, 80, () => this.toast('强化石已选中'));
        break;
    }
  }

  private upgradeBuildingFromArt(id: keyof GameState['buildings'], name: string): void {
    const upgraded = upgradeBuilding(this.state, id);
    if (upgraded) this.renderPage();
    this.toast(upgraded ? `${name}已升级` : '资源不足或需先提升主堡');
  }

  private claimTaskFromArt(id: keyof GameState['tasks']): void {
    const claimed = claimTask(this.state, id);
    if (claimed) this.renderPage();
    this.toast(claimed ? '任务奖励已入账' : '当前不可领取');
  }

  private pageTitle(title: string, subtitle: string): void {
    this.label(this.content, 'Title', title, -700, 398, 280, 46, 30, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(this.content, 'Subtitle', subtitle, 40, 398, 1100, 34, 14, colors.muted, HorizontalTextAlignment.LEFT);
    this.panel(this.content, 'TitleLine', 1510, 1, 0, 365, colors.line);
  }

  private renderHome(): void {
    this.pageTitle('天序城', '空白神册抵达边城后，各方势力已开始争夺天命。');
    const hero = this.node(this.content, 'HomeHero', 360, 700, -580, -20);
    this.loadSprite('a0/commanders/C009-BATTLE-SIDESLOT/spriteFrame', hero, 280, 700);
    this.label(this.content, 'HeroName', `${this.state.player.name} · ${this.state.player.profession}`, -590, -352, 330, 38, 23, colors.bone);

    const main = this.panel(this.content, 'MainMission', 630, 310, 80, 170, new Color(40, 49, 44, 240), colors.gold, 2);
    this.label(main, 'Chapter', '第一章·空册入世', -270, 112, 260, 30, 17, colors.gold, HorizontalTextAlignment.LEFT);
    this.label(main, 'Stage', `1-${this.state.campaign.selectedStage}  白鹿渡口`, -270, 53, 310, 48, 29, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(main, 'Desc', '神册的气息引来山海异兽，护送队必须在日落前穿过渡口。', -270, -7, 520, 64, 15, colors.muted, HorizontalTextAlignment.LEFT);
    this.button(main, 'Continue', '继续征战', 190, -95, 190, 54, () => this.navigate('campaign'), colors.jade, colors.gold);

    this.quickTile('卡组编成', `${this.state.deck.length}/10 张`, -130, -170, () => this.navigate('deck'));
    this.quickTile('挑战塔', `当前第 ${this.state.tower.floor} 层`, 205, -170, () => this.navigate('adventure'));
    this.quickTile('营造队列', this.state.expedition.active ? '远征进行中' : '港口可派遣', 540, -170, () => this.navigate('city'));
    this.label(this.content, 'Activity', '今日目标', 508, 321, 170, 30, 18, colors.bone);
    this.progressRow('通关 4 次', this.state.tasks.stage.progress, this.state.tasks.stage.target, 530, 250);
    this.progressRow('强化 1 次', this.state.tasks.upgrade.progress, this.state.tasks.upgrade.target, 530, 180);
  }

  private quickTile(title: string, value: string, x: number, y: number, action: () => void): void {
    const tile = this.button(this.content, `Quick-${title}`, '', x, y, 300, 156, action, colors.raised, colors.line);
    this.label(tile, 'Title', title, -122, 39, 240, 30, 18, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(tile, 'Value', value, -122, -10, 240, 26, 14, colors.muted, HorizontalTextAlignment.LEFT);
    this.label(tile, 'Arrow', '›', 120, 0, 30, 46, 32, colors.gold);
  }

  private renderCampaign(): void {
    this.pageTitle('主线征战', '第一章·白鹿古道  3/36 星');
    const map = this.panel(this.content, 'Map', 1080, 700, -230, -5, new Color(34, 43, 39, 225), colors.line, 1);
    for (let i = 1; i <= 12; i += 1) {
      const row = Math.floor((i - 1) / 4);
      const colInRow = (i - 1) % 4;
      const col = row % 2 === 0 ? colInRow : 3 - colInRow;
      const x = -390 + col * 260;
      const y = 225 - row * 225;
      const unlocked = i <= this.state.campaign.unlocked;
      const selected = i === this.state.campaign.selectedStage;
      const node = this.button(map, `Stage-${i}`, unlocked ? String(i) : '锁', x, y, 86, 86, () => {
        if (!unlocked) return this.toast('需要先通关前置关卡');
        this.state.campaign.selectedStage = i;
        saveGame(this.state);
        this.renderPage();
      }, selected ? colors.jade : unlocked ? colors.raised : colors.soft, selected ? colors.gold : colors.line);
      const stars = this.state.campaign.stars[String(i)] ?? 0;
      this.label(node, 'Stars', unlocked ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '', 0, -58, 90, 22, 13, colors.gold);
      if (i < 12 && colInRow < 3) this.panel(map, `Path-${i}`, 165, 2, x + (row % 2 === 0 ? 128 : -128), y, colors.line);
    }
    const stage = this.state.campaign.selectedStage;
    const detail = this.panel(this.content, 'StageDetail', 420, 700, 565, -5, colors.panel, colors.line, 1);
    this.label(detail, 'Name', `1-${stage}  ${this.stageName(stage)}`, -175, 285, 350, 42, 25, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(detail, 'Objective', '胜利条件：击破敌方主将', -175, 225, 340, 30, 15, colors.muted, HorizontalTextAlignment.LEFT);
    this.label(detail, 'Enemy', `推荐战力 ${1250 + stage * 105}`, -175, 175, 330, 30, 16, colors.gold, HorizontalTextAlignment.LEFT);
    this.label(detail, 'Cost', '体力消耗  6', -175, 125, 260, 30, 15, colors.muted, HorizontalTextAlignment.LEFT);
    this.panel(detail, 'RewardLine', 350, 1, 0, 75, colors.line);
    this.label(detail, 'RewardTitle', '可能获得', -175, 42, 200, 28, 15, colors.bone, HorizontalTextAlignment.LEFT);
    this.rewardChip(detail, '银币', '900', -105, -18);
    this.rewardChip(detail, '法印残片', '3', 105, -18);
    this.label(detail, 'Deck', `出战牌组  ${this.state.deck.length}/10`, -175, -110, 320, 30, 15, colors.muted, HorizontalTextAlignment.LEFT);
    this.button(detail, 'EditDeck', '调整编队', -92, -168, 160, 44, () => this.navigate('deck'));
    this.button(detail, 'Fight', '进入战斗', 0, -285, 300, 58, () => this.enterBattle(stage), colors.jade, colors.gold);
  }

  private renderCards(): void {
    this.pageTitle('卡牌背包', `已收集 ${this.state.cards.length}/44  · 可升级 ${this.state.cards.filter((card) => card.copies >= 2).length}`);
    const selected = this.state.cards.find((card) => card.id === this.selectedCard) ?? this.state.cards[0];
    this.state.cards.forEach((card, index) => {
      const col = index % 6;
      const row = Math.floor(index / 6);
      const x = -660 + col * 205;
      const y = 235 - row * 275;
      const item = this.button(this.content, `Card-${card.id}`, '', x, y, 176, 244, () => { this.selectedCard = card.id; this.renderPage(); }, colors.panel, selected.id === card.id ? colors.gold : colors.line);
      this.cardArt(item, card.id, 0, 30, 154, 150);
      this.label(item, 'Cost', String(card.cost), -66, 101, 32, 30, 17, colors.bone);
      this.label(item, 'Name', card.name, 0, -62, 152, 28, 15, colors.bone);
      this.label(item, 'Meta', `Lv.${card.level}  ×${card.copies}`, 0, -96, 150, 22, 12, colors.muted);
    });
    const panel = this.panel(this.content, 'CardDetail', 300, 600, 660, 45, colors.raised, colors.line, 1);
    this.label(panel, 'Name', selected.name, 0, 244, 260, 40, 23, colors.bone);
    this.cardArt(panel, selected.id, 0, 90, 248, 220);
    this.label(panel, 'Faction', `${selected.faction} · ${selected.kind === 'unit' ? '单位' : '法术'}`, 0, -45, 260, 28, 14, colors.gold);
    this.label(panel, 'Stats', `战力 ${selected.power}   准备 ${selected.cost}`, 0, -92, 260, 28, 16, colors.bone);
    this.label(panel, 'UpgradeCost', `升级需要 2 张副卡 / ${selected.level * 500} 银币`, 0, -145, 260, 42, 13, colors.muted);
    this.button(panel, 'Upgrade', '升级', 0, -238, 220, 50, () => {
      this.toast(upgradeCard(this.state, selected.id) ? '卡牌升级成功' : '副卡或银币不足');
      this.renderChrome(); this.renderPage();
    }, colors.jade, colors.gold);
  }

  private renderDeck(): void {
    this.pageTitle('出战编队', '单位牌最多 8 张，主动技能与法术合计最多 2 张。');
    const deckPanel = this.panel(this.content, 'Deck', 940, 690, -270, 0, colors.panel, colors.line, 1);
    this.label(deckPanel, 'DeckName', '边军护册队', -410, 300, 300, 32, 22, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(deckPanel, 'Count', `${this.state.deck.length}/10`, 390, 300, 100, 30, 18, colors.gold);
    this.state.deck.forEach((id, index) => {
      const card = this.state.cards.find((entry) => entry.id === id)!;
      const col = index % 5;
      const row = Math.floor(index / 5);
      const item = this.panel(deckPanel, `Deck-${id}`, 160, 250, -350 + col * 175, 130 - row * 280, colors.raised, colors.line, 1);
      this.cardArt(item, id, 0, 32, 142, 160);
      this.label(item, 'Name', card.name, 0, -73, 146, 28, 14, colors.bone);
      this.label(item, 'Type', card.kind === 'unit' ? '单位' : '技能', 0, -104, 140, 22, 12, card.kind === 'unit' ? colors.muted : colors.gold);
    });
    const side = this.panel(this.content, 'Rules', 450, 690, 520, 0, colors.raised, colors.line, 1);
    const unitCount = this.state.deck.filter((id) => this.state.cards.find((card) => card.id === id)?.kind === 'unit').length;
    const skillCount = this.state.deck.length - unitCount;
    this.label(side, 'Title', '编队检查', -65, 295, 300, 34, 21, colors.bone, HorizontalTextAlignment.LEFT);
    this.ruleRow(side, '卡牌数量', this.state.deck.length, 10, 220);
    this.ruleRow(side, '单位卡', unitCount, 8, 145);
    this.ruleRow(side, '技能卡上限', skillCount, 2, 70);
    this.label(side, 'Curve', '准备值曲线', -190, -25, 260, 30, 16, colors.bone, HorizontalTextAlignment.LEFT);
    [2, 3, 4, 5, 6].forEach((cost, index) => {
      const count = this.state.deck.filter((id) => this.state.cards.find((card) => card.id === id)?.cost === cost).length;
      const bar = this.panel(side, `Curve-${cost}`, 44, Math.max(8, count * 30), -140 + index * 70, -155 + Math.max(8, count * 30) / 2, colors.jade);
      this.label(side, `Cost-${cost}`, String(cost), -140 + index * 70, -190, 30, 24, 13, colors.muted);
      void bar;
    });
    this.button(side, 'AutoDeck', '自动整理', 0, -270, 220, 48, () => this.toast('当前牌组已符合限制'));
  }

  private renderHero(): void {
    this.pageTitle('主将与装备', '主将姓名与职业可选，成长进度在职业切换后保留。');
    const portrait = this.node(this.content, 'HeroPortrait', 420, 720, -560, -10);
    this.loadSprite('a0/commanders/C009-BATTLE-SIDESLOT/spriteFrame', portrait, 290, 720);
    const stats = this.panel(this.content, 'HeroStats', 490, 680, -70, -5, colors.panel, colors.line, 1);
    this.label(stats, 'Name', this.state.player.name, -125, 285, 220, 40, 28, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(stats, 'Profession', `${this.state.player.profession}  Lv.${this.state.player.level}`, -100, 238, 260, 28, 16, colors.gold, HorizontalTextAlignment.LEFT);
    this.statRow(stats, '生命', 3600 + this.state.player.level * 80, 170);
    this.statRow(stats, '攻势', 218 + this.state.player.level * 9, 105);
    this.statRow(stats, '护甲', 142 + this.state.player.level * 7, 40);
    this.statRow(stats, '术强', 96 + this.state.player.level * 5, -25);
    this.statRow(stats, '统御', 180 + this.state.player.level * 8, -90);
    this.label(stats, 'XP', `经验 ${this.state.player.xp}/${this.state.player.level * 100}`, -205, -175, 360, 30, 14, colors.muted, HorizontalTextAlignment.LEFT);
    this.button(stats, 'Profession', '切换职业', 0, -265, 210, 48, () => {
      const list = ['镇军', '方士', '游侠', '神使'];
      this.state.player.profession = list[(list.indexOf(this.state.player.profession) + 1) % list.length];
      saveGame(this.state); this.renderChrome(); this.renderPage();
    });
    const equipment = this.panel(this.content, 'Equipment', 510, 680, 500, -5, colors.raised, colors.line, 1);
    this.label(equipment, 'Title', '装备', -125, 285, 200, 34, 22, colors.bone, HorizontalTextAlignment.LEFT);
    const labels: Array<[keyof GameState['equipment'], string]> = [['weapon', '武器'], ['helmet', '头盔'], ['armor', '衣甲'], ['cloak', '披风']];
    labels.forEach(([key, label], index) => {
      const item = this.panel(equipment, `Equip-${key}`, 430, 100, 0, 195 - index * 125, colors.panel, colors.line, 1);
      this.label(item, 'Slot', label, -145, 21, 90, 26, 14, colors.gold, HorizontalTextAlignment.LEFT);
      this.label(item, 'Name', this.state.equipment[key].name, -80, -19, 250, 30, 17, colors.bone, HorizontalTextAlignment.LEFT);
      this.label(item, 'Level', `+${this.state.equipment[key].level}`, 160, 0, 60, 30, 16, colors.jade);
    });
  }

  private renderAdventure(): void {
    this.pageTitle('历练', '副本、五十层挑战塔与系统援军 Boss 共用出战牌组。');
    this.modePanel('三段式副本', '山海遗踪', '连续三场战斗，体力与已损单位在关间保留。', -500, 80, '今日 2/3', () => this.enterBattle(5, 'dungeon'));
    this.modePanel('五十层挑战塔', `当前第 ${this.state.tower.floor} 层`, '敌人随层数强化，每五层获得塔币和定向卡牌。', 0, 80, `门票 ${this.state.resources.towerTicket}`, () => this.enterBattle(8, 'tower'));
    this.modePanel('援军 Boss', '吞册玄龟', '三名系统援军与玩家共同对抗多阶段山海巨兽。', 500, 80, '本周 0/2', () => this.enterBattle(12, 'boss'));
    this.label(this.content, 'Rules', '每周一 05:00 重置挑战塔和 Boss 次数', 0, -315, 800, 30, 14, colors.muted);
  }

  private modePanel(title: string, name: string, desc: string, x: number, y: number, count: string, action: () => void): void {
    const panel = this.panel(this.content, `Mode-${title}`, 450, 610, x, y, colors.panel, colors.line, 1);
    this.panel(panel, 'Visual', 410, 210, 0, 175, new Color(69, 84, 75, 255), colors.gold, 1);
    this.label(panel, 'Title', title, 0, 35, 370, 34, 19, colors.gold, HorizontalTextAlignment.LEFT);
    this.label(panel, 'Name', name, 0, -18, 370, 42, 27, colors.bone, HorizontalTextAlignment.LEFT);
    this.label(panel, 'Desc', desc, 0, -100, 370, 70, 14, colors.muted, HorizontalTextAlignment.LEFT);
    this.label(panel, 'Count', count, -75, -190, 220, 28, 14, colors.muted, HorizontalTextAlignment.LEFT);
    this.button(panel, 'Enter', '挑战', 0, -258, 250, 50, action, colors.jade, colors.gold);
  }

  private renderCity(): void {
    this.pageTitle('营造与远征', '主堡决定其他建筑上限，建筑产出只用于 PVE 养成。');
    const definitions: Array<[keyof GameState['buildings'], string, string]> = [
      ['castle', '主堡', '提高玩家等级上限与每日税收'],
      ['alchemy', '炼金房', '卡牌升品、分解与配方熔炼'],
      ['forge', '铁匠铺', '装备强化、合成与保护'],
      ['harbor', '远征港口', '派遣队伍获得离线资源'],
    ];
    definitions.forEach(([id, name, desc], index) => {
      const x = -440 + (index % 2) * 590;
      const y = 190 - Math.floor(index / 2) * 330;
      const card = this.panel(this.content, `Building-${id}`, 540, 275, x, y, colors.panel, colors.line, 1);
      this.label(card, 'Glyph', name.slice(0, 1), -205, 45, 88, 88, 38, colors.gold);
      this.label(card, 'Name', name, -130, 85, 240, 36, 23, colors.bone, HorizontalTextAlignment.LEFT);
      this.label(card, 'Level', `Lv.${this.state.buildings[id]}`, 170, 85, 90, 30, 16, colors.jade);
      this.label(card, 'Desc', desc, -130, 25, 340, 54, 14, colors.muted, HorizontalTextAlignment.LEFT);
      if (id === 'harbor') {
        const ready = this.state.expedition.active && Date.now() >= this.state.expedition.endsAt;
        const label = ready ? '领取返航' : this.state.expedition.active ? '远征中' : '派遣';
        this.button(card, 'Expedition', label, 135, -78, 170, 44, () => {
          const ok = ready ? claimExpedition(this.state) : startExpedition(this.state);
          this.toast(ok ? (ready ? '远征奖励已入账' : '远征队已出发，60 秒后返航') : '当前无法执行');
          this.renderChrome(); this.renderPage();
        }, ready ? colors.jade : colors.raised, colors.gold);
      } else {
        this.button(card, 'Upgrade', '升级', 135, -78, 170, 44, () => {
          this.toast(upgradeBuilding(this.state, id) ? `${name}已升级` : '资源不足或需先提升主堡');
          this.renderChrome(); this.renderPage();
        });
      }
    });
  }

  private renderTasks(): void {
    this.pageTitle('任务与活跃', '主线、日常与周活跃奖励使用唯一事务号发放。');
    const definitions: Array<[keyof GameState['tasks'], string, string]> = [
      ['stage', '征战白鹿古道', '完成 4 次主线或副本战斗'],
      ['upgrade', '整备新军', '完成 1 次卡牌升级'],
      ['tower', '登临天阶', '挑战塔达到第 10 层'],
    ];
    definitions.forEach(([id, name, desc], index) => {
      const task = this.state.tasks[id];
      const row = this.panel(this.content, `Task-${id}`, 1440, 160, 0, 245 - index * 190, colors.panel, colors.line, 1);
      this.label(row, 'Name', name, -530, 36, 360, 34, 20, colors.bone, HorizontalTextAlignment.LEFT);
      this.label(row, 'Desc', desc, -430, -17, 560, 28, 14, colors.muted, HorizontalTextAlignment.LEFT);
      this.label(row, 'Progress', `${Math.min(task.progress, task.target)}/${task.target}`, 350, 10, 90, 30, 16, colors.gold);
      this.label(row, 'Reward', '1200 银币  ·  30 水晶', 470, 10, 250, 30, 14, colors.muted);
      this.button(row, 'Claim', task.claimed ? '已领取' : task.progress >= task.target ? '领取' : '未完成', 650, 0, 140, 46, () => {
        this.toast(claimTask(this.state, id) ? '任务奖励已入账' : '当前不可领取');
        this.renderChrome(); this.renderPage();
      }, task.progress >= task.target && !task.claimed ? colors.jade : colors.soft, colors.line);
    });
  }

  private renderInventory(): void {
    this.pageTitle('行囊', '材料、门票和消耗品的统一库存。');
    Object.entries(this.state.inventory).forEach(([name, count], index) => {
      const col = index % 5;
      const row = Math.floor(index / 5);
      const item = this.panel(this.content, `Item-${name}`, 260, 220, -600 + col * 300, 220 - row * 250, colors.panel, colors.line, 1);
      this.panel(item, 'Icon', 92, 92, 0, 43, new Color(69, 88, 76, 255), colors.gold, 1);
      this.label(item, 'Glyph', name.slice(0, 1), 0, 43, 60, 60, 28, colors.gold);
      this.label(item, 'Name', name, 0, -42, 220, 30, 17, colors.bone);
      this.label(item, 'Count', `×${count}`, 0, -78, 160, 24, 14, colors.muted);
    });
  }

  private enterBattle(stage: number, mode: 'campaign' | 'dungeon' | 'tower' | 'boss' = 'campaign'): void {
    const staminaCost = mode === 'dungeon' || mode === 'boss' ? 10 : 6;
    if (mode === 'tower' && this.state.resources.towerTicket < 1) return this.toast('挑战塔门票不足');
    if (mode !== 'tower' && this.state.resources.stamina < staminaCost) return this.toast('体力不足');
    if (this.state.deck.length !== 10) return this.toast('请先配置 10 张合法卡组');
    this.activeStage = stage;
    this.battleMode = mode;
    if (mode === 'tower') this.state.resources.towerTicket -= 1;
    else this.state.resources.stamina -= staminaCost;
    saveGame(this.state);
    this.shell.active = false;
    this.battleRoot.active = true;
    this.battleToolbar.active = true;
  }

  private returnFromBattle(victory: boolean): void {
    this.battleRoot.active = false;
    this.battleToolbar.active = false;
    this.shell.active = true;
    if (victory) {
      let reward: { silver?: number; xp?: number };
      if (this.battleMode === 'campaign') {
        reward = completeStage(this.state, this.activeStage);
        this.state.campaign.selectedStage = Math.min(12, this.activeStage + 1);
        this.page = 'campaign';
      } else if (this.battleMode === 'tower') {
        const clearedFloor = this.state.tower.floor;
        this.state.tower.best = Math.max(this.state.tower.best, clearedFloor);
        this.state.tower.floor = Math.min(50, clearedFloor + 1);
        this.state.tasks.tower.progress = Math.max(this.state.tasks.tower.progress, this.state.tower.best);
        reward = { silver: 500 + clearedFloor * 80, xp: 90 };
        grantReward(this.state, reward, `tower:${clearedFloor}`);
        this.page = 'adventure';
      } else if (this.battleMode === 'dungeon') {
        reward = { silver: 1800, xp: 160 };
        grantReward(this.state, { ...reward, material: '山海鳞片', materialCount: 4 }, `dungeon:${Date.now()}`);
        this.page = 'adventure';
      } else {
        reward = { silver: 2600, xp: 240 };
        grantReward(this.state, { ...reward, crystal: 60, material: '法印残片', materialCount: 6 }, `boss:${Date.now()}`);
        this.page = 'adventure';
      }
      saveGame(this.state);
      this.renderChrome();
      this.renderPage();
      this.toast(`胜利：银币 +${reward.silver ?? 0}，经验 +${reward.xp ?? 0}`);
    } else {
      this.renderChrome();
      this.toast('已退出战斗，本局不发放奖励');
    }
  }

  private openSettings(): void {
    const modal = this.panel(this.shell, 'SettingsModal', W, H, 0, 0, new Color(0, 0, 0, 165));
    const box = this.panel(modal, 'Box', 620, 520, 0, 0, colors.panel, colors.gold, 1);
    this.label(box, 'Title', '设置', -250, 205, 200, 40, 28, colors.bone, HorizontalTextAlignment.LEFT);
    this.settingRow(box, '音乐', '开启', 120);
    this.settingRow(box, '音效', '开启', 45);
    this.settingRow(box, '战斗倍速', '1×', -30);
    this.settingRow(box, '画面质量', '高', -105);
    this.button(box, 'Reset', '重置测试存档', -110, -202, 230, 46, () => {
      this.state = resetGame(); modal.destroy(); this.renderChrome(); this.renderPage(); this.toast('测试存档已重置');
    }, colors.red, colors.line);
    this.button(box, 'Close', '关闭', 170, -202, 170, 46, () => modal.destroy());
  }

  private settingRow(parent: Node, name: string, value: string, y: number): void {
    this.label(parent, `${name}-Name`, name, -230, y, 200, 30, 16, colors.bone, HorizontalTextAlignment.LEFT);
    this.button(parent, `${name}-Value`, value, 190, y, 130, 38, () => this.toast('设置已更新'));
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
    const supported: Record<string, string> = {
      U002: 'a0/cards/U002-CARD-THUMB/spriteFrame',
      U004: 'a0/cards/U004-CARD-THUMB/spriteFrame',
      U001: 'a0/cards/U001-CARD-THUMB/spriteFrame',
      U008: 'a0/cards/U008-CARD-THUMB/spriteFrame',
    };
    if (supported[id]) {
      const image = this.node(host, 'Image', width - 4, height - 4, 0, 0);
      this.loadSprite(supported[id], image, width - 4, height - 4);
    }
    else this.label(host, 'Fallback', id.startsWith('S') ? '法' : '兵', 0, 0, 80, 80, 34, colors.gold);
  }

  private stageName(stage: number): string {
    return ['起程', '林道伏击', '断桥', '白鹿渡口', '异兽潮', '沉册坑', '旧神庙', '无名祭坛', '仙门阵眼', '龙骨关', '天序裂口', '吞册玄龟'][stage - 1] ?? '未知节点';
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
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
    if (stroke && stroke.a > 0) {
      graphics.lineWidth = lineWidth;
      graphics.strokeColor = stroke;
      graphics.rect(-width / 2 + lineWidth / 2, -height / 2 + lineWidth / 2, width - lineWidth, height - lineWidth);
      graphics.stroke();
    }
    return node;
  }

  private label(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number, size: number, color: Color, align = HorizontalTextAlignment.CENTER): Node {
    const node = this.node(parent, name, width, height, x, y);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
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
    node.on(Node.EventType.TOUCH_END, action);
    if (text) this.label(node, 'Text', text, 0, 0, width - 12, height - 8, 15, colors.bone);
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
