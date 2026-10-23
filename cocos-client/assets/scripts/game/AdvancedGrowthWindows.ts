import { BlockInputEvents, Button, Color, Node, UIOpacity } from 'cc';
import { CocosUi, Theme } from './CocosUi.ts';
import type { OriginalUi, OriginalUiMount } from './OriginalUi.ts';
import type { RecoveredCatalog } from './RecoveredContent.ts';
import { stageActionReason, stageSectionAllowed } from './StageScope.ts';

type Row = Record<string, unknown>;
interface Field { key: string; label: string; type?: string; value?: unknown; min?: number; max?: number; options?: {label: string; value: string}[] }
interface ActionItem {
  label: string;
  detail?: string;
  action: string;
  payload?: Record<string, unknown>;
  disabled?: boolean;
  fields?: Field[];
}
interface Section { id: string; title: string; items: ActionItem[] }
interface AdvancedGrowthState {
  now?: number;
  actor: { currencies?: { silver?: number; gold?: number; crystal?: number }; growth?: Row; cards?: Record<string, number> };
  growth: { sections: Section[]; summary?: Row };
  pve?: { state?: Row; schedules?: Row; rankings?: Row };
  league?: { season?: Row; ranked?: { ranking?: Row[]; history?: Row[]; pendingRewards?: Row[] } };
  rankings?: Row[];
  assetNames?: Record<string, string>;
  assetIcons?: Record<string, string>;
}
interface ActionGroup { key: string; label: string; detail: string; assetId: string; items: ActionItem[] }
export interface AdvancedGrowthCallbacks {
  close(): void;
  action(item: ActionItem): void;
  run(action: string, payload?: Record<string, unknown>): void;
  detail(title: string, text: string, actions?: ActionItem[]): void;
}

type AdvancedSection = 'pets' | 'cards' | 'progression' | 'city' | 'shop' | 'reputation-shop'
  | 'profession-skill-shop' | 'activities' | 'summon' | 'tower' | 'forbidden' | 'world-boss'
  | 'dock' | 'expedition' | 'defense' | 'ranked-season' | 'tournament';
type PetTab = 0 | 1 | 2 | 3;
type CardTab = 0 | 1;

const COMPONENTS: Partial<Record<AdvancedSection, string>> = {
  pets: 'Pet/PetWnd',
  cards: 'MagicJar/MagicJarWnd',
  progression: 'PassPort/PassPortWnd',
  city: 'Town/TownSelectModelWnd',
};

const SHOP_ICONS: Record<string, { assetId?: string; sourceIcon?: string }> = {
  'supply:gem': { assetId: 'main:item:100', sourceIcon: 'qhs_1.jpg' },
  'supply:pet-food': { assetId: 'main:item:1101', sourceIcon: 'cwdjinghua.jpg' },
  'pack:basic': { sourceIcon: 'kahelibao.jpg' },
  'pack:ten': { sourceIcon: 'kahelibao.jpg' },
  'limited:crystal': { sourceIcon: 'shuijinglibao.jpg' },
  'exchange:crystal': { sourceIcon: 'yinbidaoju.jpg' },
};

const MISSING_PET_SOURCE_ICONS = new Set(['1019']);

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function center(left: number, top: number, width: number, height: number): [number, number] {
  return [left + width / 2 - 600, 300 - top - height / 2];
}

/** Original full-screen FairyGUI growth surfaces bound to the current service actions. */
export class AdvancedGrowthWindows {
  private root?: Node;
  private mount?: OriginalUiMount;
  private state?: AdvancedGrowthState;
  private section: AdvancedSection = 'pets';
  private generation = 0;
  private readonly pages = new Map<string, number>();
  private readonly selections = new Map<string, string>();
  private readonly multiSelections = new Map<string, Set<string>>();
  private petTab: PetTab = 0;
  private cardTab: CardTab = 0;
  private workshopAction = 'magic.synthesize';
  private workshopMaterialMode = false;
  private passTab: 'rewards' | 'tasks' = 'rewards';
  private towerMode: 'normal' | 'infernal' = 'normal';

  constructor(
    private readonly ui: CocosUi,
    private readonly original: OriginalUi,
    private readonly _catalog: RecoveredCatalog,
    private readonly _base: string,
    private readonly callbacks: AdvancedGrowthCallbacks,
  ) {}

  supports(section: string): section is AdvancedSection {
    return ['progression', 'city', 'shop', 'profession-skill-shop', 'activities'].includes(section)
      && stageSectionAllowed(section);
  }

  render(parent: Node, state: unknown, section: AdvancedSection): void {
    this.destroyView();
    this.state = state as AdvancedGrowthState;
    this.section = section;
    const generation = ++this.generation;
    const root = this.ui.node(parent, `AdvancedGrowth:${section}`, 1200, 600);
    root.addComponent(BlockInputEvents);
    this.root = root;
    this.ui.label(root, 'AdvancedGrowth:Loading', '正在载入…', 0, 0, 360, 32, 17, Theme.gold);
    if (section === 'cards' && this.cardTab === 1) {
      root.getChildByName('AdvancedGrowth:Loading')?.destroy();
      this.bindCardWorkshop(root);
      return;
    }
    const component = COMPONENTS[section];
    if (!component) {
      root.getChildByName('AdvancedGrowth:Loading')?.destroy();
      this.bindLegacy(root);
      return;
    }
    void this.original.mount(component, root).then(mount => {
      if (generation !== this.generation || !root.isValid) {
        if (mount.node.isValid) mount.node.destroy();
        return;
      }
      root.getChildByName('AdvancedGrowth:Loading')?.destroy();
      mount.node.setPosition(-600, 300);
      this.mount = mount;
      this.bindMounted(root, mount);
    }).catch(() => {
      if (generation !== this.generation || !root.isValid) return;
      root.getChildByName('AdvancedGrowth:Loading')?.destroy();
      this.ui.label(root, 'AdvancedGrowth:Error', '该界面暂时无法显示', 0, 30, 680, 80, 15, Theme.red);
      this.ui.button(root, 'AdvancedGrowth:CloseAfterError', '返回主城', 0, -55, 150, 34, () => this.callbacks.close());
    });
  }

  update(_dt: number): void { /* These source windows contain no actor timeline. */ }

  destroy(): void {
    this.generation++;
    this.destroyView();
    this.state = undefined;
  }

  private destroyView(): void {
    this.mount = undefined;
    if (this.root?.isValid) this.root.destroy();
    this.root = undefined;
  }

  private bindMounted(root: Node, mount: OriginalUiMount): void {
    if (this.section === 'pets') this.bindPets(root, mount);
    else if (this.section === 'cards') this.bindMagicJar(root, mount);
    else if (this.section === 'progression') this.bindPassPort(root, mount);
    else this.bindTown(root, mount);
  }

  private bindPets(root: Node, mount: OriginalUiMount): void {
    this.applyPetSourceVisibility(mount);
    void mount.setController('cTab', this.petTab).then(() => {
      if (this.mount === mount && this.section === 'pets') this.applyPetSourceVisibility(mount);
    }).catch(() => { /* The explicit source visibility below still keeps the usable panel isolated. */ });
    const growth = record(this.state?.actor.growth);
    const pets = Object.entries(record(growth.pets));
    const current = pets[0];
    const pet = record(current?.[1]);
    this.safeText(mount, 'txtPetName', current ? `宠物 ${current[0]}` : '尚未领养宠物');
    this.safeText(mount, 'txtGrade', Number(pet.level ?? 0));
    this.safeText(mount, 'txtAttack', '—');
    this.safeText(mount, 'txtQuality', current ? `#${current[0]}` : '—');
    this.safeText(mount, 'txtProg', Number(pet.exp ?? 0));
    try { mount.setProgress('propExp', Number(pet.exp ?? 0), 100); } catch { /* Optional progress component. */ }

    this.transparent(root, 'Pet:Close', 927, 81, 38, 38, () => this.callbacks.close());
    const tabs: Array<[PetTab, number, string]> = [[0, 121, '宠物'], [1, 209, '转生'], [2, 297, '技能'], [3, 385, '商店']];
    tabs.forEach(([tab, top, label]) => this.transparent(root, `Pet:Tab:${tab}`, 268, top, 34, 79, () => {
      this.petTab = tab; this.redraw();
    }, false, label));

    const ownedPetIds = new Set(pets.map(([id]) => id));
    const items = this.petActions();
    const groups = this.groupActions(items).filter(group => this.petTab === 3 || ownedPetIds.has(group.key));
    const key = `pet:${this.petTab}`;
    if (this.petTab === 3) this.renderPetShopGrid(root, key, groups);
    else if (this.petTab !== 1) this.renderPetBagGrid(root, key, groups);
    const selected = this.selectedGroup(key, groups);
    const selectedItems = selected?.items ?? [];
    const upgrade = selectedItems.find(item => item.action === 'pet.upgrade' || item.action === 'mount.upgrade')
      ?? selectedItems.find(item => item.action === 'pet.adopt');
    const feed = selectedItems.find(item => item.action === 'pet.feed');
    const ride = selectedItems.find(item => item.action === 'mount.equip' || item.action === 'mount.adopt');
    const canUpgrade = Boolean(upgrade && !upgrade.disabled);
    const canFeed = Boolean(feed && !feed.disabled);
    const canRide = Boolean(ride && !ride.disabled);
    this.safeButtonState(mount, 'btnGrowUp', canUpgrade);
    this.safeButtonState(mount, 'btnAbsorb', canFeed);
    this.safeButtonState(mount, 'btnBattle', canRide);
    this.safeButtonState(mount, 'btnCancelBattle', canRide);
    if (this.petTab === 1) {
      this.ui.label(root, 'Pet:ReincarnationGap', '转生功能尚未开放', ...center(330, 222, 570, 90), 570, 90, 16, Theme.dim);
    } else if (this.petTab === 2) {
      this.ui.label(root, 'Pet:SkillTitle', selected ? `${selected.label} 可学技能` : '请选择宠物', ...center(320, 350, 280, 26), 280, 26, 13, Theme.gold);
      selectedItems.slice(0, 4).forEach((item, index) => this.ui.button(root, `Pet:Skill:${index}`,
        item.label.replace(/^\S+\s+/, ''), ...center(320 + (index % 2) * 145, 386 + Math.floor(index / 2) * 42, 132, 32), 132, 32,
        () => this.execute(item), Boolean(item.disabled)));
      if (!selectedItems.length) this.ui.label(root, 'Pet:SkillGap', '该宠物当前没有可学技能', ...center(320, 390, 280, 48), 280, 48, 12, Theme.dim);
    } else if (this.petTab === 0 && selected) {
      this.transparent(root, 'Pet:Grow', 321, 362, 74, 27, () => this.executeMaybe(upgrade, '宠物成长'), !canUpgrade);
      this.transparent(root, 'Pet:Feed', 422, 362, 74, 27, () => this.executeMaybe(feed, '宠物喂养'), !canFeed);
      this.transparent(root, 'Pet:Ride', 526, 362, 74, 27, () => this.executeMaybe(ride, '宠物出战'), !canRide);
      if (selectedItems.length > 1) this.transparent(root, 'Pet:Operate', 816, 442, 74, 27,
        () => this.openGroup(selected, '宠物操作'), false, '更多');
    }
    if (this.petTab === 0 && !pets.length) {
      this.ui.label(root, 'Pet:ServiceNote', '暂未领养宠物', ...center(646, 235, 284, 42), 284, 42, 13, Theme.dim);
      this.ui.button(root, 'Pet:OpenShop', '前往宠物商店', ...center(708, 292, 160, 34), 160, 34, () => {
        this.petTab = 3;
        this.redraw();
      });
    }
  }

  private applyPetSourceVisibility(mount: OriginalUiMount): void {
    this.safeVisible(mount, 'petBag', this.petTab === 0);
    this.safeVisible(mount, 'petEatGroup', false);
    this.safeVisible(mount, 'petZS', false);
    this.safeVisible(mount, 'petSkillPanel', this.petTab === 2);
    this.safeVisible(mount, 'petShop', this.petTab === 3);
    this.safeVisible(mount, 'bagList', this.petTab === 0 || this.petTab === 2);
    this.safeVisible(mount, 'txt_level_target', false);
    this.safeVisible(mount, 'txt_level_abs', false);
    this.safeVisible(mount, 'txt_property', false);
  }

  private petActions(): ActionItem[] {
    const all = this.sectionItems('pets');
    if (this.petTab === 0) return all.filter(item => ['pet.adopt', 'pet.feed', 'pet.upgrade', 'mount.equip', 'mount.adopt', 'mount.upgrade'].includes(item.action));
    if (this.petTab === 1) return all.filter(item => item.action === 'pet.upgrade' || item.action === 'mount.upgrade');
    if (this.petTab === 2) return all.filter(item => item.action === 'pet.learnSkill');
    return all.filter(item => item.action === 'pet.adopt' || item.action === 'mount.adopt');
  }

  private bindMagicJar(root: Node, mount: OriginalUiMount): void {
    void mount.setController('cTab', this.cardTab);
    const crystals = Number(this.state?.actor.currencies?.crystal ?? 0);
    this.safeText(mount, 'lab_num', crystals);
    this.safeText(mount, 'lab_tip', this.cardTab === 0 ? '普通魔法罐：单次消耗 25 晶石' : '高级卡牌加工');
    this.safeText(mount, 'lab_tipD', '开启后随机获得卡牌');
    this.safeText(mount, 'lab_logT', '开启记录');
    this.safeText(mount, 'lab_timedT', '本地常驻');
    this.safeText(mount, 'lab_timed', '');
    this.safeText(mount, 'btn_ptT', '普通魔罐');
    this.safeText(mount, 'btn_sjT', '卡牌加工');
    this.safeText(mount, 'btnHelp', '帮助');
    this.safeButtonState(mount, 'btn_one', crystals >= 25);
    this.safeButtonState(mount, 'btn_ten', crystals >= 250);
    this.transparent(root, 'MagicJar:Close', 924, 79, 38, 38, () => this.callbacks.close());
    this.transparent(root, 'MagicJar:NormalTab', 300, 104, 104, 29, () => { this.cardTab = 0; this.redraw(); });
    this.transparent(root, 'MagicJar:AdvancedTab', 416, 104, 104, 29, () => { this.cardTab = 1; this.redraw(); });
    this.transparent(root, 'MagicJar:One', 370, 395, 100, 45, () => this.runJar(1), crystals < 25, '开启 1 次');
    this.transparent(root, 'MagicJar:Ten', 593, 395, 100, 45, () => this.runJar(10), crystals < 250, '开启 10 次');
    this.transparent(root, 'MagicJar:Help', 641, 108, 56, 20, () => this.callbacks.detail('魔法罐', '可选择开启 1 次或 10 次。'));
    this.ui.label(root, 'MagicJar:LogGap', '暂无可用数据', ...center(724, 260, 214, 54), 214, 54, 12, Theme.dim);
  }

  private runJar(count: number): void {
    const source = this.sectionItems('cards').find(item => item.action === 'magic.jar');
    if (!source) {
      this.callbacks.detail('魔法罐', '该功能暂未开放');
      return;
    }
    this.callbacks.run(source.action, { ...(source.payload ?? {}), count });
  }

  private bindCardWorkshop(root: Node): void {
    this.sourceSkin(root, 'CardWorkshop:Frame', 'kphcbj_1_2', 240, 20, 777, 513);
    this.sourceSkin(root, 'CardWorkshop:Inner', 'kphcbj_1_3', 270, 52, 728, 469);
    this.ui.label(root, 'CardWorkshop:Title', '炼金房 · 卡牌加工', -55, 258, 320, 30, 20, Theme.gold);
    this.transparent(root, 'CardWorkshop:Close', 972, 27, 38, 38, () => this.callbacks.close(), false, '×');
    const tabs: Array<[string, string]> = [
      ['magic.synthesize', '合成'], ['magic.dismantle', '分解'], ['magic.refine', '炼制'],
      ['magic.point', '点化'], ['magic.enchant', '融合'],
    ];
    tabs.forEach(([action, label], index) => this.transparent(root, `CardWorkshop:Tab:${action}`,
      247, 74 + index * 82, 38, 72, () => { this.workshopAction = action; this.workshopMaterialMode = false; this.redraw(); }, false, label));
    const skin = this.workshopAction === 'magic.refine' ? 'ronglianbeijing_1' : 'kphcbj_2';
    this.sourceSkin(root, 'CardWorkshop:ModeArt', skin, 292, 70,
      this.workshopAction === 'magic.refine' ? 670 : 330, 410);
    if (this.workshopAction !== 'magic.refine') this.sourceSkin(root, 'CardWorkshop:LibraryArt', 'kphcbj_3', 630, 70, 342, 410);
    const actions = this.sectionItems('cards').filter(item => item.action === this.workshopAction);
    const groups = this.groupActions(actions);
    const key = `workshop:${this.workshopAction}`;
    if (this.workshopAction === 'magic.refine') this.renderRefineRecipes(root, key, groups);
    else {
      const selected = this.selectedGroup(key, groups);
      if (this.workshopAction === 'magic.enchant') {
        const materialKey = `${key}:material:${selected?.key ?? 'none'}`;
        if (selected && !this.selections.has(materialKey)) this.selections.set(materialKey, selected.key);
        const material = this.selectedGroup(materialKey, groups);
        const libraryKey = this.workshopMaterialMode ? materialKey : key;
        this.ui.label(root, 'CardWorkshop:LibraryMode', this.workshopMaterialMode ? '选择素材卡' : '选择主卡',
          ...center(650, 75, 300, 24), 300, 24, 12, Theme.gold);
        this.renderCardLibrary(root, libraryKey, groups, group => {
          this.selections.set(libraryKey, group.key);
          this.workshopMaterialMode = false;
          this.redraw();
        });
        this.renderWorkshopSelection(root, selected, material, materialKey);
      } else {
        this.renderCardLibrary(root, key, groups);
        this.renderWorkshopSelection(root, selected);
      }
    }
    this.transparent(root, 'CardWorkshop:Jar', 830, 458, 140, 34, () => { this.cardTab = 0; this.redraw(); }, false, '返回魔法罐');
  }

  private bindPassPort(root: Node, mount: OriginalUiMount): void {
    void mount.setController('c1', this.passTab === 'rewards' ? 0 : 1);
    const growth = record(this.state?.actor.growth);
    const pass = record(growth.battlePass);
    const counters = record(growth.counters);
    const level = Math.min(50, Math.max(Math.floor(Number(counters.growthActions ?? 0) / 5), Math.floor(Number(pass.exp ?? 0) / 500)) + 1);
    const progress = Math.max(Number(counters.growthActions ?? 0) % 5 * 20, Number(pass.exp ?? 0) % 500 / 5);
    this.safeText(mount, 'title', `荣誉战令 ${String(pass.season ?? '')}`.trim());
    this.safeText(mount, 'txt_explv', level);
    this.safeText(mount, 'txt_des', `${Math.round(progress)}%`);
    try { mount.setProgress('progress', progress, 100); } catch { /* Optional progress component. */ }
    this.transparent(root, 'PassPort:Close', 1162, 0, 38, 40, () => this.callbacks.close());
    this.transparent(root, 'PassPort:RewardsTab', 10, 145, 161, 52, () => { this.passTab = 'rewards'; this.redraw(); }, false, '战令奖励');
    this.transparent(root, 'PassPort:TasksTab', 10, 202, 161, 52, () => { this.passTab = 'tasks'; this.redraw(); }, false, '保留日常');
    const all = this.sectionItems('progression');
    const claims = all.filter(item => item.action === 'battlePass.claim');
    const items = this.passTab === 'rewards' ? claims : all.filter(item => item.action !== 'battlePass.claim');
    if (this.passTab === 'rewards') {
      this.renderPassRewards(root, items);
      this.transparent(root, 'PassPort:Receive', 479, 518, 94, 40, () => {
        const next = claims.find(item => !item.disabled);
        this.executeMaybe(next, '一键领取');
      }, !claims.some(item => !item.disabled), '领取下一档');
    } else {
      this.renderPassTasks(root, items);
    }
    this.ui.label(root, 'PassPort:StageNote', '本阶段保留免费战令', ...center(888, 69, 250, 70), 250, 70, 13, Theme.dim);
  }

  private bindTown(root: Node, mount: OriginalUiMount): void {
    this.safeText(mount, 'txtNorTitle', '城池经营');
    this.safeText(mount, 'txtDiffTitle', '本阶段范围');
    this.safeText(mount, 'txtReward', '征收税金');
    this.safeText(mount, 'txtReward1', '仅保留税收');
    const items = this.sectionItems('city');
    const tax = items.find(item => item.action === 'city.tax');
    this.transparent(root, 'Town:Close', 881, 96, 36, 36, () => this.callbacks.close());
    this.transparent(root, 'Town:Tax', 384, 401, 126, 47, () => this.executeMaybe(tax, '征收税金'), Boolean(tax?.disabled), '进入经营');
    this.transparent(root, 'Town:Buildings', 693, 402, 126, 47,
      () => this.callbacks.detail('本阶段范围', '本阶段仅保留每日税收。'), true, '暂缓升级');
    const city = record(record(this.state?.actor.growth).city);
    const buildings = record(city.buildings);
    const status = Object.entries(buildings).map(([id, value]) => `${id} Lv.${Number(record(value).level ?? 0)}`).join('  ');
    this.ui.label(root, 'Town:Status', status || '暂无可用数据', 0, -218, 610, 28, 13, status ? Theme.text : Theme.dim);
  }

  private bindLegacy(root: Node): void {
    const configs: Record<Exclude<AdvancedSection, 'pets' | 'cards' | 'progression' | 'city'>,
      { skin: string; left: number; top: number; width: number; height: number; title: string;
        panel: [number, number, number, number]; note?: string }> = {
      shop: { skin: 'chaojishangdiandi', left: 280, top: 15, width: 744, height: 463, title: '超级商店', panel: [315, 72, 650, 330] },
      'reputation-shop': { skin: 'shengwangdi', left: 240, top: 10, width: 726, height: 469, title: '声望商店', panel: [292, 74, 620, 330] },
      'profession-skill-shop': { skin: 'chaojishangdiandi', left: 280, top: 15, width: 744, height: 463, title: '职业技能商店', panel: [315, 72, 650, 330] },
      activities: { skin: 'yjdi', left: 280, top: 40, width: 687, height: 399, title: '精彩活动', panel: [470, 86, 455, 315] },
      summon: { skin: 'zhaohuanshijiedi', left: 160, top: 15, width: 877, height: 511, title: '召唤世界', panel: [570, 59, 435, 420] },
      tower: { skin: 'tttbeijing', left: 280, top: 15, width: 755, height: 469, title: '通天塔', panel: [314, 92, 300, 265] },
      forbidden: { skin: 'jinduanzhidibj', left: 224, top: 20, width: 751, height: 465, title: '禁断之地', panel: [245, 70, 710, 340] },
      'world-boss': { skin: 'shijiebossdi_1', left: 0, top: 0, width: 1200, height: 600, title: '世界 Boss', panel: [390, 92, 700, 390] },
      dock: { skin: 'czgkbj', left: 0, top: 0, width: 1200, height: 600, title: '出征港口', panel: [480, 75, 630, 435], note: '选择远征岛屿后可出发或领取结果。' },
      expedition: { skin: 'czgkbj', left: 0, top: 0, width: 1200, height: 600, title: '远征港口', panel: [480, 75, 630, 435], note: '选择远征岛屿后可出发或领取结果。' },
      defense: { skin: 'huchengyaosaidi', left: 251, top: 54, width: 755, height: 469, title: '护城要塞', panel: [315, 82, 610, 340] },
      'ranked-season': { skin: 'paihangbangbeijing', left: 0, top: 0, width: 1200, height: 600, title: '排位赛季', panel: [542, 70, 641, 450] },
      tournament: { skin: 'jingjisaidi', left: 0, top: 0, width: 1200, height: 600, title: '竞技赛', panel: [390, 92, 700, 390] },
    };
    const config = configs[this.section as keyof typeof configs];
    if (this.section === 'defense') this.sourceSkin(root, 'Legacy:defense:Frame', 'kphcbj_1_2', 240, 20, 777, 513);
    this.sourceSkin(root, `Legacy:${this.section}:Background`, config.skin, config.left, config.top, config.width, config.height);
    this.ui.label(root, `Legacy:${this.section}:Title`, config.title, config.left + config.width / 2 - 600,
      300 - config.top - 24, Math.min(420, config.width - 100), 32, 21, Theme.gold);
    this.transparent(root, `Legacy:${this.section}:Close`, config.left + config.width - 44, config.top + 4, 40, 40,
      () => this.callbacks.close(), false, '×');
    const items = this.legacyItems();
    if (this.section === 'shop') this.renderSuperShop(root, this.groupActions(items));
    else if (this.section === 'reputation-shop' || this.section === 'profession-skill-shop') {
      this.renderReputationShop(root, `legacy:${this.section}`, this.groupActions(items), config.panel);
    } else if (this.section === 'activities') this.renderActivities(root, items);
    else if (this.section === 'tower') this.renderTower(root, items);
    else if (this.section === 'forbidden') this.renderForbidden(root, items);
    else if (this.section === 'world-boss') this.renderWorldBoss(root, items);
    else if (this.section === 'dock' || this.section === 'expedition') this.renderDock(root, items);
    else if (this.section === 'summon') this.renderSummon(root, items);
    else if (this.section === 'defense') this.renderDefense(root, items);
    else if (this.section === 'ranked-season') this.renderRankedSeason(root, items);
    else if (this.section === 'tournament') this.renderTournament(root, items);
    else this.ui.label(root, `Legacy:${this.section}:Unmapped`, '该功能暂未开放', 0, 0, 420, 40, 14, Theme.red);
    if (config.note) this.ui.label(root, `Legacy:${this.section}:Note`, config.note, 0, -272, 900, 22, 11, Theme.dim);
    if (!items.length && this.section !== 'defense') this.ui.label(root, `Legacy:${this.section}:Gap`, '暂无可用数据',
      0, -235, 720, 26, 13, Theme.dim);
  }

  private legacyItems(): ActionItem[] {
    if (this.section === 'dock' || this.section === 'expedition') {
      return this.sectionItems('quest-operations').filter(item => item.action.startsWith('quest.explore.'));
    }
    if (this.section === 'defense') {
      return this.sectionItems('quest-operations').filter(item => item.action.startsWith('cityDefense.'));
    }
    return this.sectionItems(this.section);
  }

  private sourceSkin(parent: Node, name: string, skin: string, left: number, top: number, width: number, height: number): void {
    const [x, y] = center(left, top, width, height);
    try { this.ui.skin(parent, name, skin, x, y, width, height); }
    catch { this.ui.label(parent, `${name}:Missing`, '该界面暂时无法显示', x, y, width, 30, 13, Theme.red); }
  }

  private groupActions(items: ActionItem[]): ActionGroup[] {
    const groups = new Map<string, ActionGroup>();
    items.forEach((item, index) => {
      const payload = item.payload ?? {};
      const raw = payload.cardId ?? payload.petId ?? payload.mountId ?? payload.itemId ?? payload.offerId ?? payload.recipeId;
      const assetId = String(payload.cardId ?? payload.itemId ?? '');
      const key = raw === undefined ? `${item.action}:${index}` : String(raw);
      let group = groups.get(key);
      if (!group) {
        group = { key, label: this.compactLabel(item.label), detail: item.detail ?? '', assetId, items: [] };
        groups.set(key, group);
      }
      group.items.push(item);
      if (!group.assetId && assetId) group.assetId = assetId;
    });
    return Array.from(groups.values());
  }

  private compactLabel(label: string): string {
    return label.replace(/^(购买|领养坐骑装备|领养|喂养宠物|升级宠物|升级坐骑|骑乘|合成|分解|融合|点化|炼制卡牌)\s*/, '') || label;
  }

  private selectedGroup(key: string, groups: ActionGroup[]): ActionGroup | undefined {
    const selected = groups.find(group => group.key === this.selections.get(key)) ?? groups[0];
    if (selected) this.selections.set(key, selected.key);
    return selected;
  }

  private selectGroup(key: string, group: ActionGroup): void {
    this.selections.set(key, group.key);
    this.redraw();
  }

  private openGroup(group: ActionGroup | undefined, fallback: string): void {
    if (!group) { this.callbacks.detail(fallback, '该功能暂未开放'); return; }
    if (group.items.length === 1 && !group.items[0].fields?.length) this.execute(group.items[0]);
    else this.callbacks.detail(group.label, group.detail || '选择操作。', group.items);
  }

  private renderPassRewards(parent: Node, items: ActionItem[]): void {
    const levels = new Map<string, ActionItem[]>();
    items.forEach((item, index) => {
      const level = String(item.payload?.level ?? index + 1);
      levels.set(level, [...(levels.get(level) ?? []), item]);
    });
    const entries = Array.from(levels.entries()); const key = 'passport:rewards';
    const pageSize = 4; const page = this.gridPage(key, entries.length, pageSize);
    entries.slice(page * pageSize, page * pageSize + pageSize).forEach(([level, rewards], column) => {
      const left = 326 + column * 101;
      this.ui.label(parent, `${key}:Level:${level}`, `等级 ${level}`, ...center(left, 157, 96, 30), 96, 30, 13, Theme.gold);
      const tracks = ['free'];
      tracks.forEach((track, index) => {
        const item = rewards.find(candidate => String(candidate.payload?.track ?? 'free') === track);
        const top = 192 + index * 92;
        const label = track === 'free' ? '免费奖励' : track === 'premium' ? '进阶奖励' : '终极奖励';
        const button = this.ui.button(parent, `${key}:${level}:${track}`, item ? label : `${label}\n已领取`,
          ...center(left, top, 96, 82), 96, 82, () => this.executeMaybe(item, label), !item || Boolean(item.disabled));
        if (item?.detail) this.ui.label(button, 'Detail', item.detail, 0, -24, 88, 22, 9, Theme.dim);
      });
    });
    this.gridPager(parent, key, entries.length, pageSize, 535, 492);
    if (!entries.length) this.ui.label(parent, `${key}:Empty`, '当前等级没有待领取战令奖励', 535, 0, 417, 48, 13, Theme.dim);
  }

  private renderPassTasks(parent: Node, items: ActionItem[]): void {
    const key = 'passport:tasks'; const pageSize = 3; const page = this.gridPage(key, items.length, pageSize);
    items.slice(page * pageSize, page * pageSize + pageSize).forEach((item, index) => {
      const top = 146 + index * 141;
      this.ui.label(parent, `${key}:Title:${index}`, item.label, ...center(225, top + 21, 370, 28), 370, 28, 15,
        item.disabled ? Theme.dim : Theme.gold, true);
      this.ui.label(parent, `${key}:Detail:${index}`, item.detail ?? '', ...center(225, top + 55, 600, 54), 600, 54, 12, Theme.text, true);
      this.ui.button(parent, `${key}:Receive:${index}`, item.disabled ? '不可领取' : '领取', ...center(1036, top + 48, 94, 40), 94, 40,
        () => this.execute(item), Boolean(item.disabled));
    });
    this.gridPager(parent, key, items.length, pageSize, 690, 548);
    if (!items.length) this.ui.label(parent, `${key}:Empty`, '当前没有任务、声望或称号操作', 690, 0, 720, 48, 13, Theme.dim);
  }

  private renderActivities(parent: Node, items: ActionItem[]): void {
    const key = 'legacy:activities'; const pageSize = 6; const groups = this.groupActions(items);
    const page = this.gridPage(key, groups.length, pageSize); const visible = groups.slice(page * pageSize, page * pageSize + pageSize);
    let selected = this.selectedGroup(key, groups);
    if (visible.length && !visible.includes(selected!)) { selected = visible[0]; this.selections.set(key, selected.key); }
    visible.forEach((group, index) => {
      const top = 87 + index * 51;
      this.ui.button(parent, `${key}:Nav:${index}`, group.label, ...center(298, top, 162, 44), 162, 44,
        () => this.selectGroup(key, group), selected?.key === group.key);
    });
    this.sourceSkin(parent, `${key}:DetailBackground`, 'huodongbeijing_1', 474, 60, 470, 379);
    this.ui.label(parent, `${key}:SelectedTitle`, selected?.label ?? '每日活动', ...center(500, 78, 410, 36), 410, 36, 19, Theme.gold);
    this.ui.label(parent, `${key}:SelectedDetail`, selected?.detail ?? '暂无可用数据',
      ...center(510, 135, 390, 165), 390, 165, 14, Theme.text, true);
    const action = selected?.items[0];
    if (action?.action === 'activity.wish') {
      this.ui.label(parent, `${key}:WishPrompt`, '选择许愿奖池', ...center(570, 302, 270, 26), 270, 26, 13, Theme.gold);
      this.ui.button(parent, `${key}:Wish7`, '7 日奖池 · 2 金币', ...center(535, 340, 165, 42), 165, 42,
        () => this.callbacks.run(action.action, { ...(action.payload ?? {}), group: 1 }), Boolean(action.disabled));
      this.ui.button(parent, `${key}:Wish30`, '30 日奖池 · 5 金币', ...center(715, 340, 165, 42), 165, 42,
        () => this.callbacks.run(action.action, { ...(action.payload ?? {}), group: 2 }), Boolean(action.disabled));
    } else {
      this.ui.button(parent, `${key}:Execute`, action?.disabled ? '今日已完成' : '参与活动', ...center(628, 350, 160, 42), 160, 42,
        () => this.openGroup(selected, '每日活动'), !action || selected!.items.every(item => item.disabled));
    }
    this.gridPager(parent, key, groups.length, pageSize, 379, 416);
  }

  private renderSummon(parent: Node, items: ActionItem[]): void {
    const single = items.find(item => Number(item.payload?.count ?? 1) === 1);
    const ten = items.find(item => Number(item.payload?.count) === 10);
    const crystals = Number(this.state?.actor.currencies?.crystal ?? 0);
    // SearchWorld uses an explicit 2×4 reveal area above the two search buttons.
    for (let index = 0; index < 8; index++) {
      const col = index % 4; const row = Math.floor(index / 4);
      this.sourceSkin(parent, `Summon:CardBack:${index}`, 'fpbm.png', 582 + col * 104, 66 + row * 132, 92, 118);
    }
    this.ui.label(parent, 'Summon:SingleCost', `普通搜索   30 晶石`, ...center(750, 338, 145, 20), 145, 20, 12, Theme.gold);
    this.ui.label(parent, 'Summon:TenCost', `高级搜索   300 晶石`, ...center(750, 363, 160, 20), 160, 20, 12, Theme.gold);
    this.sourceSkin(parent, 'Summon:RuleArt', 'aj_sousuoguize', 899, 352, 75, 27);
    this.transparent(parent, 'Summon:Rule', 899, 352, 75, 27,
      () => this.callbacks.detail('召唤规则', '单次消耗 30 晶石，十次消耗 300 晶石。'));
    this.sourceSkin(parent, 'Summon:SingleArt', 'aj_putongsousuo', 685, 411, 90, 33);
    this.transparent(parent, 'Summon:Single', 685, 411, 90, 33, () => this.executeMaybe(single, '普通搜索'),
      !single || Boolean(single.disabled) || crystals < 30);
    this.sourceSkin(parent, 'Summon:TenArt', 'aj_gaojisousuo', 795, 411, 90, 33);
    this.transparent(parent, 'Summon:Ten', 795, 411, 90, 33, () => this.executeMaybe(ten, '高级搜索'),
      !ten || Boolean(ten.disabled) || crystals < 300);

    // CollectPanel is source-visible, but the snapshot has no collection/material/progress model.
    for (let index = 0; index < 6; index++) {
      const col = index % 3; const row = Math.floor(index / 3);
      this.sourceSkin(parent, `Summon:CollectionSlot:${index}`, 'kphccao_1', 224 + col * 104, 54 + row * 126, 84, 108);
    }
    this.sourceSkin(parent, 'Summon:CollectionProgressBack', 'kongzhilitiao_2', 337, 291, 216, 19);
    this.ui.label(parent, 'Summon:CollectionProgress', '暂无可用数据', ...center(337, 291, 216, 19), 216, 19, 11, Theme.dim);
    this.ui.label(parent, 'Summon:CollectionGap', '收藏功能暂未开放',
      ...center(190, 326, 335, 82), 335, 82, 12, Theme.dim, true);
  }

  private renderDefense(parent: Node, items: ActionItem[]): void {
    const find = (...parts: string[]) => items.find(item => parts.some(part => item.action.toLowerCase().includes(part)));
    const repair = find('repair'); const protect = find('protect'); const attack = find('attack');
    const buyAttack = items.find(item => /buy.*(attack|ticket)|(attack|ticket).*buy/i.test(item.action));
    const build = this.sectionItems('city').find(item => item.action === 'city.upgrade' && item.payload?.buildingId === 'defense');
    const city = record(record(this.state?.actor.growth).city);
    const defense = record(record(city.buildings).defense);
    const level = Number(defense.level ?? 0); const readyAt = Number(defense.readyAt ?? 0);

    this.sourceSkin(parent, 'Defense:Fortress', 'wodeyaosai_1', 407, 119, 107, 102);
    this.ui.label(parent, 'Defense:Level', `要塞等级 ${level}${readyAt > Number(this.state?.now ?? 0) ? ' · 升级中' : ''}`,
      ...center(274, 222, 360, 28), 360, 28, 15, Theme.gold);
    this.ui.label(parent, 'Defense:EnduranceGap', '耐久：暂无可用数据', ...center(274, 252, 360, 26), 360, 26, 13, Theme.dim);
    this.ui.label(parent, 'Defense:CardGap', '防守卡组与战力暂无可用数据', ...center(326, 426, 260, 82), 260, 82, 13, Theme.dim);
    this.ui.label(parent, 'Defense:TargetGap', '好友要塞 / 战报\n暂无可用数据',
      ...center(668, 82, 310, 245), 310, 245, 13, Theme.dim, true);

    this.bindSourceAction(parent, 'Defense:Repair', 'ajhcysxiufu', 321, 303, 120, 49, repair,
      '修复要塞', '该功能暂未开放');
    this.bindSourceAction(parent, 'Defense:Build', 'ajhcysjianzao', 486, 303, 120, 49, build,
      '建造要塞', '该功能暂未开放');
    this.bindSourceAction(parent, 'Defense:Attack', 'ajhcysgongji', 814, 428, 171, 72, attack,
      '攻击要塞', '该功能暂未开放');
    this.ui.button(parent, 'Defense:Protect', protect?.label ?? '购买保护', ...center(554, 244, 90, 30), 90, 30,
      () => protect ? this.execute(protect) : this.callbacks.detail('要塞保护', '该功能暂未开放'), Boolean(protect?.disabled));
    this.ui.button(parent, 'Defense:BuyAttack', buyAttack?.label ?? '购买攻击次数', ...center(745, 472, 118, 30), 118, 30,
      () => buyAttack ? this.execute(buyAttack) : this.callbacks.detail('攻击次数', '该功能暂未开放'), Boolean(buyAttack?.disabled));
    this.ui.label(parent, 'Defense:RuleBoundary', '部分功能暂未开放',
      ...center(315, 506, 610, 24), 610, 24, 11, Theme.dim);
  }

  private renderTower(parent: Node, items: ActionItem[]): void {
    const modeItems = items.filter(item => String(item.payload?.mode ?? 'normal') === this.towerMode);
    const challenge = modeItems.find(item => item.action === 'tower.challenge');
    const refresh = modeItems.find(item => item.action === 'tower.refresh');
    const reset = modeItems.find(item => item.action === 'tower.reset');
    this.sourceSkin(parent, 'Tower:Inner', this.towerMode === 'normal' ? 'tttbeijing_2.jpg' : 'tttbeijing_6', 288, 20, 731, 343);
    this.ui.button(parent, 'Tower:NormalMode', '普通塔', ...center(309, 37, 92, 32), 92, 32,
      () => { this.towerMode = 'normal'; this.redraw(); }, this.towerMode === 'normal');
    this.ui.button(parent, 'Tower:InfernalMode', '地狱塔', ...center(407, 37, 92, 32), 92, 32,
      () => { this.towerMode = 'infernal'; this.redraw(); }, this.towerMode === 'infernal');
    this.ui.label(parent, 'Tower:Floor', challenge?.label ?? (this.towerMode === 'normal' ? '普通塔已通关' : '地狱塔已通关'),
      ...center(386, 66, 210, 34), 210, 34, 18, Theme.gold);
    [0, 1, 2].forEach(index => this.sourceSkin(parent, `Tower:CardSlot:${index}`, 'kphccao_1', 314 + index * 96, 111, 84, 110));
    this.ui.label(parent, 'Tower:Rule', challenge?.detail ?? '当前层不可继续挑战', ...center(306, 278, 356, 70), 356, 70, 13, Theme.text, true);
    this.ui.button(parent, 'Tower:Refresh', refresh?.label ?? '刷新敌人', ...center(518, 244, 84, 31), 84, 31,
      () => this.executeMaybe(refresh, '刷新敌人'), !refresh || Boolean(refresh.disabled));
    this.ui.button(parent, 'Tower:Reset', reset?.label ?? '重置塔层', ...center(520, 315, 110, 31), 110, 31,
      () => this.executeMaybe(reset, '重置塔层'), !reset || Boolean(reset.disabled));
    this.gapControl(parent, 'Tower:DeckGap', '塔内卡组', 590, 388, 104, 34, '通天塔卡组', '该功能暂未开放');
    this.gapControl(parent, 'Tower:ShopGap', '塔币商店', 704, 388, 104, 34, '通天塔商店', '该功能暂未开放');
    this.sourceSkin(parent, 'Tower:ChallengeArt', challenge?.label.includes('已通关') ? 'jixutiaozhan' : 'kaishitiaozhan', 843, 388, 176, 74);
    this.transparent(parent, 'Tower:Challenge', 843, 388, 176, 74, () => this.executeMaybe(challenge, '通天塔挑战'),
      !challenge || Boolean(challenge.disabled));
  }

  private renderForbidden(parent: Node, items: ActionItem[]): void {
    const challenge = items.find(item => item.action === 'forbidden.challenge');
    const offers = items.filter(item => item.action === 'forbidden.shop.buy');
    const claims = items.filter(item => item.action === 'forbidden.reward.claim');
    const key = 'legacy:forbidden:offers'; const pageSize = 3; const page = this.gridPage(key, offers.length, pageSize);
    const score = challenge?.detail?.match(/\d+/)?.[0] ?? '—';
    this.ui.label(parent, 'Forbidden:Status', `${challenge?.disabled ? '当前未开放' : '活动开放中'}   可用积分 ${score}`,
      ...center(244, 25, 700, 28), 700, 28, 13, Theme.gold, true);
    offers.slice(page * pageSize, page * pageSize + pageSize).forEach((item, index) => {
      const left = 292 + index * 194; const top = 66;
      this.sourceSkin(parent, `${key}:Frame:${index}`, 'duihuandi', left, top, 184, 322);
      const itemId = String(item.payload?.offerId ?? '');
      this.assetIcon(parent, itemId, 96, 96, ...center(left + 44, top + 42, 96, 96));
      this.ui.label(parent, `${key}:Name:${index}`, item.label, ...center(left + 12, top + 160, 160, 44), 160, 44, 13, Theme.gold);
      this.ui.label(parent, `${key}:Cost:${index}`, item.detail ?? '', ...center(left + 25, top + 250, 134, 34), 134, 34, 12, Theme.text);
      this.ui.button(parent, `${key}:Buy:${index}`, '兑换', ...center(left + 55, top + 290, 74, 28), 74, 28,
        () => this.execute(item), Boolean(item.disabled));
    });
    this.gridPager(parent, key, offers.length, pageSize, 600, 396);
    this.ui.button(parent, 'Forbidden:Challenge', challenge?.disabled ? '禁地未开放' : '挑战禁地', ...center(249, 434, 122, 32), 122, 32,
      () => this.executeMaybe(challenge, '禁地挑战'), !challenge || Boolean(challenge.disabled));
    this.ui.button(parent, 'Forbidden:Rewards', claims.length ? `领取奖励 ${claims.length}` : '赛季奖励', ...center(785, 434, 128, 32), 128, 32,
      () => claims.length ? this.callbacks.detail('禁地赛季奖励', '选择待领取奖励。', claims) : this.callbacks.detail('禁地赛季奖励', '当前没有可领取奖励。'), !claims.length);
    this.gapControl(parent, 'Forbidden:RefreshGap', '刷新道具', 382, 434, 104, 32, '禁地刷新', '该功能暂未开放');
    this.gapControl(parent, 'Forbidden:RankGap', '排行榜', 496, 434, 104, 32, '禁地排行榜', '暂无可用数据');
    this.gapControl(parent, 'Forbidden:GlobalGap', '全服奖励', 610, 434, 104, 32, '禁地全服奖励', '暂无可领取项目');
  }

  private renderWorldBoss(parent: Node, items: ActionItem[]): void {
    const challenge = items.find(item => item.action === 'worldBoss.challenge');
    const hires = items.filter(item => item.action === 'worldBoss.hire');
    const claims = items.filter(item => item.action === 'worldBoss.reward.claim');
    this.ui.label(parent, 'WorldBoss:BossName', '世界 Boss', ...center(771, 224, 150, 24), 150, 24, 18, Theme.gold);
    this.ui.label(parent, 'WorldBoss:Hp', challenge?.detail ?? '当前未开放', ...center(941, 224, 205, 24), 205, 24, 13, Theme.text, true);
    this.ui.label(parent, 'WorldBoss:MercenaryTitle', '佣兵支援', ...center(770, 310, 375, 28), 375, 28, 15, Theme.gold);
    const hireKey = 'legacy:world-boss:hires'; const hirePageSize = 3;
    const hirePage = this.gridPage(hireKey, hires.length, hirePageSize);
    hires.slice(hirePage * hirePageSize, hirePage * hirePageSize + hirePageSize).forEach((item, index) => {
      const left = 770 + index * 125;
      this.sourceSkin(parent, `WorldBoss:HireArt:${index}`, ['boss_zhongyong', 'boss_kuangbao', 'boss_xuruo'][index] ?? 'boss_fuhuo', left, 344, 66, 50);
      this.ui.label(parent, `WorldBoss:HireName:${index}`, item.label.replace('雇佣', ''), ...center(left - 18, 401, 104, 24), 104, 24, 10, Theme.text);
      this.ui.button(parent, `WorldBoss:Hire:${index}`, item.detail ?? '雇佣', ...center(left - 18, 428, 104, 28), 104, 28,
        () => this.execute(item), Boolean(item.disabled));
    });
    this.gridPager(parent, hireKey, hires.length, hirePageSize, 958, 470);
    const claimKey = 'legacy:world-boss:claims'; const claimPageSize = 6;
    const claimPage = this.gridPage(claimKey, claims.length, claimPageSize);
    claims.slice(claimPage * claimPageSize, claimPage * claimPageSize + claimPageSize).forEach((item, index) => {
      const top = 96 + index * 48;
      this.ui.label(parent, `WorldBoss:Reward:${index}`, item.label, ...center(60, top, 470, 26), 470, 26, 12, Theme.text, true);
      this.ui.button(parent, `WorldBoss:Claim:${index}`, '领取', ...center(555, top, 74, 28), 74, 28,
        () => this.execute(item), Boolean(item.disabled));
    });
    this.gridPager(parent, claimKey, claims.length, claimPageSize, 348, 402);
    if (!claims.length) this.ui.label(parent, 'WorldBoss:NoReward', '当前没有待领取的世界 Boss 奖励', ...center(60, 105, 570, 42), 570, 42, 13, Theme.dim);
    this.ui.button(parent, 'WorldBoss:Challenge', challenge?.disabled ? '当前未开放' : '发起挑战', ...center(755, 506, 174, 52), 174, 52,
      () => this.executeMaybe(challenge, '世界 Boss'), !challenge || Boolean(challenge.disabled));
    this.gapControl(parent, 'WorldBoss:RoomGap', '房间列表', 941, 506, 112, 36, '世界 Boss 房间', '该功能暂未开放');
  }

  private renderDock(parent: Node, items: ActionItem[]): void {
    const key = 'legacy:dock'; const pageSize = 7; const groups = this.groupActions(items);
    const page = this.gridPage(key, groups.length, pageSize); const visible = groups.slice(page * pageSize, page * pageSize + pageSize);
    let selected = this.selectedGroup(key, groups);
    if (visible.length && !visible.includes(selected!)) { selected = visible[0]; this.selections.set(key, selected.key); }
    visible.forEach((group, index) => {
      const top = 75 + index * 55;
      const button = this.ui.button(parent, `${key}:Island:${index}`, '', ...center(480, top, 590, 51), 590, 51,
        () => this.selectGroup(key, group), false, true);
      this.ui.label(button, 'Name', group.label, -165, 9, 245, 22, 13, selected?.key === group.key ? Theme.gold : Theme.text, true);
      this.ui.label(button, 'Detail', group.detail, 90, -9, 245, 20, 11, Theme.dim, true);
    });
    this.ui.label(parent, 'Dock:SelectedName', selected?.label ?? '请选择远征岛屿', ...center(25, 72, 385, 34), 385, 34, 18, Theme.gold);
    this.ui.label(parent, 'Dock:SelectedDetail', selected?.detail ?? '当前没有可用远征。', ...center(35, 118, 360, 112), 360, 112, 13, Theme.text, true);
    const action = selected?.items[0]; const claim = action?.action === 'quest.explore.claim';
    const hoursKey = `dock-hours:${selected?.key ?? 'none'}`;
    const maxHours = Math.max(1, Number(action?.detail?.match(/最长\s*(\d+)小时/)?.[1] ?? 1));
    const hours = Math.max(1, Math.min(maxHours, Number(this.selections.get(hoursKey) ?? action?.payload?.hours ?? 1)));
    this.selections.set(hoursKey, String(hours));
    if (claim) {
      this.ui.label(parent, 'Dock:Time', '远征完成后可领取结果', ...center(35, 275, 360, 70), 360, 70, 14, Theme.gold);
    } else {
      this.ui.label(parent, 'Dock:Time', `远征时长 ${hours}:00:00   ·   最长 ${maxHours} 小时`, ...center(35, 272, 360, 36), 360, 36, 14, Theme.gold);
      this.ui.button(parent, 'Dock:HoursMinus', '−', ...center(108, 316, 46, 32), 46, 32,
        () => { this.selections.set(hoursKey, String(hours - 1)); this.redraw(); }, hours <= 1);
      this.ui.button(parent, 'Dock:HoursPlus', '+', ...center(282, 316, 46, 32), 46, 32,
        () => { this.selections.set(hoursKey, String(hours + 1)); this.redraw(); }, hours >= maxHours);
      this.ui.label(parent, 'Dock:HoursValue', `${hours} 小时`, ...center(160, 316, 110, 32), 110, 32, 15, Theme.text);
    }
    this.sourceSkin(parent, 'Dock:ExecuteArt', claim ? 'ajmzeg' : 'ajksch', 1085, 380, 98, 98);
    this.transparent(parent, 'Dock:Execute', 1085, 380, 98, 98, () => {
      if (!action) return;
      if (claim) this.execute(action);
      else this.callbacks.run(action.action, { ...(action.payload ?? {}), hours });
    },
      !selected || selected.items.every(item => item.disabled));
    this.gapControl(parent, 'Dock:DeckGap', '远征卡组', 100, 370, 240, 52, '远征卡组', '该功能暂未开放');
    this.gridPager(parent, key, groups.length, pageSize, 795, 522);
  }

  private renderRankedSeason(parent: Node, items: ActionItem[]): void {
    const ranking = this.state?.league?.ranked?.ranking ?? this.state?.rankings ?? [];
    const key = 'legacy:ranked'; const pageSize = 8; const page = this.gridPage(key, ranking.length, pageSize);
    this.sourceSkin(parent, 'Ranked:ListHeader', 'jingjisaijingjichang', 542, 108, 634, 37);
    this.ui.label(parent, 'Ranked:Columns', '排名        角色                         评分        胜 / 负',
      ...center(551, 111, 615, 30), 615, 30, 13, Theme.gold, true);
    ranking.slice(page * pageSize, page * pageSize + pageSize).forEach((row, index) => {
      const top = 153 + index * 43; const rank = page * pageSize + index + 1;
      this.ui.label(parent, `${key}:Row:${index}`,
        `${rank}        ${String(row.name ?? row.id ?? '未知角色')}                         ${Number(row.rating ?? 0)}        ${Number(row.wins ?? 0)} / ${Number(row.losses ?? 0)}`,
        ...center(551, top, 615, 36), 615, 36, 12, rank <= 3 ? Theme.gold : Theme.text, true);
    });
    this.gridPager(parent, key, ranking.length, pageSize, 860, 515);
    const season = this.state?.league?.season;
    this.ui.label(parent, 'Ranked:Season', `赛季 ${String(season?.key ?? '当前')} · 待领取奖励 ${items.length}`,
      ...center(80, 86, 250, 48), 250, 48, 16, Theme.gold);
    const claimKey = 'legacy:ranked:claims'; const claimPageSize = 4;
    const claimPage = this.gridPage(claimKey, items.length, claimPageSize);
    items.slice(claimPage * claimPageSize, claimPage * claimPageSize + claimPageSize).forEach((item, index) => this.ui.button(parent, `Ranked:Claim:${index}`, item.label,
      ...center(94, 166 + index * 62, 220, 48), 220, 48, () => this.execute(item), Boolean(item.disabled)));
    this.gridPager(parent, claimKey, items.length, claimPageSize, 204, 428);
    if (!items.length) this.ui.label(parent, 'Ranked:NoReward', '当前没有待领取赛季奖励', ...center(94, 177, 220, 60), 220, 60, 13, Theme.dim);
    this.gapControl(parent, 'Ranked:ScopeGap', '本服 / 跨服', 136, 466, 136, 32, '排行范围', '该功能暂未开放');
  }

  private renderTournament(parent: Node, items: ActionItem[]): void {
    const register = items.find(item => item.action === 'tournament.register');
    const deck = items.find(item => item.action === 'tournament.deck.save');
    const room = items.find(item => item.action === 'room.create');
    const claim = items.find(item => item.action === 'tournament.claim');
    this.sourceSkin(parent, 'Tournament:Flag', 'jingjisaiqi_1', 80, 0, 196, 252);
    this.ui.label(parent, 'Tournament:Record', claim?.detail ?? (deck?.detail ? `构筑进度 ${deck.detail}` : '三胜或三负结束'),
      ...center(100, 270, 220, 42), 220, 42, 16, Theme.gold);
    [0, 1, 2].forEach(index => this.sourceSkin(parent, `Tournament:Loss:${index}`, 'jingjisaishibai_1', 145 + index * 48, 315, 38, 38));
    if (!deck) this.sourceSkin(parent, 'Tournament:Chest', 'jingjisaixiangzi1_1', 530, 78, 300, 281);
    this.ui.label(parent, 'Tournament:Guide', '竞技赛卡组与比赛', ...center(930, 65, 250, 34), 250, 34, 18, Theme.gold);
    this.ui.label(parent, 'Tournament:GuideText', deck?.detail ?? register?.detail ?? claim?.detail ?? '报名后完成卡组构筑，再创建竞技赛房间。',
      ...center(950, 115, 220, 230), 220, 230, 13, Theme.text, true);
    if (register && !deck && !claim && (!room || room.disabled)) this.ui.button(parent, 'Tournament:Register', register.label, ...center(470, 390, 420, 52), 420, 52,
      () => this.execute(register), Boolean(register.disabled));
    if (deck) {
      this.renderTournamentDeck(parent, deck);
      this.sourceSkin(parent, 'Tournament:DeckArt', 'zbstp', 700, 505, 164, 71);
    }
    if (room && !room.disabled) this.ui.button(parent, 'Tournament:Start', '开始比赛', ...center(1000, 504, 164, 71), 164, 71,
      () => this.execute(room), Boolean(room.disabled));
    if (claim) this.ui.button(parent, 'Tournament:Claim', claim.label, ...center(598, 430, 164, 54), 164, 54,
      () => this.execute(claim), Boolean(claim.disabled));
    this.gapControl(parent, 'Tournament:AbandonGap', '放弃本轮', 164, 385, 112, 34, '放弃竞技赛', '该功能暂未开放');
    this.gapControl(parent, 'Tournament:RankingGap', '竞技赛排行', 970, 372, 150, 34, '竞技赛排行', '暂无可用数据');
    const known = new Set([register, deck, room, claim].filter(Boolean));
    const extra = items.filter(item => !known.has(item));
    if (extra.length) this.ui.button(parent, 'Tournament:More', `其它操作 ${extra.length}`, ...center(963, 418, 190, 38), 190, 38,
      () => this.callbacks.detail('竞技赛操作', '选择操作。', extra));
  }

  private renderTournamentDeck(parent: Node, item: ActionItem): void {
    const field = item.fields?.find(candidate => candidate.key === 'cards');
    const options = field?.options ?? [];
    const key = 'legacy:tournament:deck';
    let selected = this.multiSelections.get(key);
    if (!selected) {
      const initial = Array.isArray(field?.value) ? field!.value : Array.isArray(item.payload?.cards) ? item.payload!.cards : [];
      selected = new Set(initial.map(String)); this.multiSelections.set(key, selected);
    }
    const max = Number(field?.max ?? 10); const pageSize = 10; const page = this.gridPage(key, options.length, pageSize);
    this.ui.label(parent, 'Tournament:DeckStatus', `选择竞技赛卡组   ${selected.size}/${max}`,
      ...center(365, 62, 530, 28), 530, 28, 16, selected.size === max ? Theme.gold : Theme.text);
    options.slice(page * pageSize, page * pageSize + pageSize).forEach((option, index) => {
      const col = index % 5; const row = Math.floor(index / 5); const left = 365 + col * 106; const top = 98 + row * 130;
      const chosen = selected!.has(option.value);
      this.sourceSkin(parent, `${key}:Frame:${index}`, 'kphccao_1', left, top, 84, 108);
      const tile = this.ui.button(parent, `${key}:Card:${index}`, '', ...center(left, top, 84, 108), 84, 108, () => {
        if (chosen) selected!.delete(option.value);
        else if (selected!.size < max) selected!.add(option.value);
        this.redraw();
      }, Boolean(item.disabled), true);
      this.assetIcon(tile, option.value, 68, 74, 0, 7);
      this.ui.label(tile, 'Name', option.label, 0, -41, 80, 20, 9, chosen ? Theme.gold : Theme.text);
      if (chosen) this.ui.label(tile, 'Chosen', '已选', 0, 38, 42, 18, 10, Theme.gold);
    });
    this.gridPager(parent, key, options.length, pageSize, 630, 374);
    this.transparent(parent, 'Tournament:Deck', 700, 505, 164, 71,
      () => this.callbacks.run(item.action, { ...(item.payload ?? {}), cards: Array.from(selected!) }),
      Boolean(item.disabled) || selected.size !== max, '保存卡组');
    if (!options.length) this.ui.label(parent, 'Tournament:DeckGap', '暂无可用数据',
      ...center(410, 130, 440, 80), 440, 80, 13, Theme.dim);
  }

  private renderPetBagGrid(parent: Node, key: string, groups: ActionGroup[]): void {
    const pageSize = 25; const page = this.gridPage(key, groups.length, pageSize);
    const selected = this.selectedGroup(key, groups);
    groups.slice(page * pageSize, page * pageSize + pageSize).forEach((group, index) => {
      const col = index % 5; const row = Math.floor(index / 5); const left = 636 + col * 60; const top = 143 + row * 60;
      if (selected?.key === group.key) this.sourceSkin(parent, `${key}:Selected:${index}`, 'wupingezi_2', left + 7, top + 7, 45, 45);
      const [x, y] = center(left, top, 56, 56);
      const tile = this.ui.button(parent, `${key}:Pet:${index}`, '', x, y, 56, 56, () => this.selectGroup(key, group), false, true);
      this.petIcon(tile, group, 42, 42, 0, 4);
      this.ui.label(tile, 'Name', group.label, 0, -18, 52, 14, 9, selected?.key === group.key ? Theme.gold : Theme.text);
    });
    this.gridPager(parent, key, groups.length, pageSize, 788, 465);
    if (!groups.length) this.ui.label(parent, `${key}:Empty`, '当前没有可用宠物', 788, -2, 270, 42, 12, Theme.dim);
  }

  private renderPetShopGrid(parent: Node, key: string, groups: ActionGroup[]): void {
    const pageSize = 4; const page = this.gridPage(key, groups.length, pageSize);
    groups.slice(page * pageSize, page * pageSize + pageSize).forEach((group, index) => {
      const col = index % 2; const row = Math.floor(index / 2); const left = 310 + col * 279; const top = 115 + row * 144;
      const [x, y] = center(left, top, 269, 134);
      const tile = this.ui.button(parent, `${key}:Offer:${index}`, '', x, y, 269, 134, () => this.openGroup(group, '宠物商店'), false, true);
      this.petIcon(tile, group, 76, 76, -82, 9);
      this.ui.label(tile, 'Name', group.label, 48, 28, 150, 28, 14, Theme.gold, true);
      this.ui.label(tile, 'Detail', group.detail, 48, -2, 150, 34, 11, Theme.text, true);
      this.ui.button(tile, 'Buy', '领养', 70, -45, 76, 27, () => this.openGroup(group, '宠物商店'),
        group.items.every(item => item.disabled));
    });
    this.gridPager(parent, key, groups.length, pageSize, 617, 459);
  }

  private renderCardLibrary(parent: Node, key: string, groups: ActionGroup[], onSelect?: (group: ActionGroup) => void): void {
    const pageSize = 9; const page = this.gridPage(key, groups.length, pageSize);
    const selected = this.selectedGroup(key, groups);
    const leftBase = 644; const topBase = 102;
    groups.slice(page * pageSize, page * pageSize + pageSize).forEach((group, index) => {
      const col = index % 3; const row = Math.floor(index / 3); const left = leftBase + col * 104; const top = topBase + row * 116;
      this.sourceSkin(parent, `${key}:CardFrame:${index}`, 'kphccao_1', left, top, 84, 108);
      const [x, y] = center(left, top, 84, 108);
      const tile = this.ui.button(parent, `${key}:Card:${index}`, '', x, y, 84, 108,
        () => onSelect ? onSelect(group) : this.selectGroup(key, group), false, true);
      this.assetIcon(tile, group.assetId, 72, 78, 0, 6);
      this.ui.label(tile, 'Name', group.label, 0, -43, 80, 18, 9, selected?.key === group.key ? Theme.gold : Theme.text);
    });
    this.gridPager(parent, key, groups.length, pageSize, 808, 452);
    if (!groups.length) this.ui.label(parent, `${key}:Empty`, '当前没有可加工卡牌', 795, 0, 260, 42, 13, Theme.dim);
  }

  private renderRefineRecipes(parent: Node, key: string, groups: ActionGroup[]): void {
    const pageSize = 5; const page = this.gridPage(key, groups.length, pageSize);
    groups.slice(page * pageSize, page * pageSize + pageSize).forEach((group, index) => {
      const left = 295 + index * 136; const top = 77;
      this.sourceSkin(parent, `${key}:RecipeFrame:${index}`, 'ronglianbeijing_2', left, top, 134, 398);
      this.sourceSkin(parent, `${key}:CardFrame:${index}`, 'kphccao_1', left + 15, top + 24, 105, 138);
      this.assetIcon(parent, group.assetId, 88, 104, ...center(left + 23, top + 32, 88, 104));
      this.ui.label(parent, `${key}:Name:${index}`, group.label, ...center(left + 7, top + 167, 120, 36), 120, 36, 11, Theme.gold);
      this.ui.label(parent, `${key}:Detail:${index}`, group.detail, ...center(left + 10, top + 216, 114, 76), 114, 76, 10, Theme.text);
      this.sourceSkin(parent, `${key}:ExecuteArt:${index}`, 'ronglian', left + 8, top + 337, 118, 50);
      this.transparent(parent, `${key}:Execute:${index}`, left + 8, top + 337, 118, 50,
        () => this.openGroup(group, '卡牌炼制'), group.items.every(item => item.disabled));
    });
    this.gridPager(parent, key, groups.length, pageSize, 635, 486);
    if (!groups.length) this.ui.label(parent, `${key}:Empty`, '当前没有可用炼制配方', 635, 0, 500, 42, 13, Theme.dim);
  }

  private renderWorkshopSelection(parent: Node, group: ActionGroup | undefined, material?: ActionGroup, materialKey = ''): void {
    if (this.workshopAction === 'magic.enchant') {
      this.sourceSkin(parent, 'CardWorkshop:SelectedFrame', 'kphccao_1', 312, 120, 84, 108);
      this.sourceSkin(parent, 'CardWorkshop:MaterialFrame', 'kphccao_1', 312, 280, 84, 108);
      this.sourceSkin(parent, 'CardWorkshop:ResultFrame', 'kphccao_1', 528, 200, 84, 108);
      if (group) this.assetIcon(parent, group.assetId, 72, 78, ...center(318, 128, 72, 78));
      if (material) this.assetIcon(parent, material.assetId, 72, 78, ...center(318, 288, 72, 78));
      this.ui.label(parent, 'CardWorkshop:SelectedName', group?.label ?? '请选择主卡', ...center(302, 91, 105, 24), 105, 24, 11, group ? Theme.gold : Theme.dim);
      this.ui.label(parent, 'CardWorkshop:MaterialName', material?.label ?? '请选择素材', ...center(302, 251, 105, 24), 105, 24, 11, material ? Theme.gold : Theme.dim);
      this.ui.button(parent, 'CardWorkshop:ChooseMaterial', '更换素材', ...center(304, 396, 100, 28), 100, 28,
        () => { this.workshopMaterialMode = true; this.redraw(); }, !group);
      this.ui.label(parent, 'CardWorkshop:ResultGap', '融合后可查看结果', ...center(470, 329, 150, 50), 150, 50, 11, Theme.dim);
      const action = group?.items[0];
      const cardId = action?.payload?.cardId; const materialCardId = material?.items[0]?.payload?.cardId;
      const sourceKey = String(cardId ?? ''); const materialAssetKey = String(materialCardId ?? '');
      const cards = this.state?.actor.cards ?? {};
      const sourceCount = Number(cards[sourceKey] ?? cards[`main:card:${sourceKey}`] ?? 0);
      const materialCount = Number(cards[materialAssetKey] ?? cards[`main:card:${materialAssetKey}`] ?? 0);
      const enough = sourceKey && materialAssetKey && (sourceKey === materialAssetKey ? sourceCount >= 2 : sourceCount >= 1 && materialCount >= 1);
      this.sourceSkin(parent, 'CardWorkshop:ExecuteArt', 'hc', 404, 454, 118, 50);
      this.transparent(parent, 'CardWorkshop:Execute', 404, 454, 118, 50, () => {
        if (action && materialCardId !== undefined) this.callbacks.run(action.action, { ...(action.payload ?? {}), materialCardId });
      }, !action || !material || !enough);
      if (!materialKey) this.ui.label(parent, 'CardWorkshop:MaterialGap', '暂无可用数据', ...center(300, 405, 320, 26), 320, 26, 11, Theme.dim);
      return;
    }
    this.sourceSkin(parent, 'CardWorkshop:SelectedFrame', 'kphccao_1', 333, 156, 105, 138);
    if (group) this.assetIcon(parent, group.assetId, 88, 104, ...center(341, 164, 88, 104));
    if (this.workshopAction === 'magic.synthesize') {
      this.sourceSkin(parent, 'CardWorkshop:Arrow', 'jiantou2', 477, 198, 37, 35);
      this.sourceSkin(parent, 'CardWorkshop:ResultFrame', 'kphccao_1', 521, 147, 105, 138);
    } else if (this.workshopAction === 'magic.dismantle') {
      this.sourceSkin(parent, 'CardWorkshop:Preview', 'kpfenjiekuang', 318, 314, 296, 96);
      this.sourceSkin(parent, 'CardWorkshop:PreviewTitle', 'fenjieyulan', 321, 319, 291, 24);
    }
    this.ui.label(parent, 'CardWorkshop:SelectedName', group?.label ?? '请选择卡牌', -170, -18, 300, 26, 14, group ? Theme.gold : Theme.dim);
    const disabled = !group || group.items.every(item => item.disabled);
    const buttonSkin = this.workshopAction === 'magic.dismantle' ? 'fj' : 'hc';
    this.sourceSkin(parent, 'CardWorkshop:ExecuteArt', buttonSkin, 404, 454, 118, 50);
    this.transparent(parent, 'CardWorkshop:Execute', 404, 454, 118, 50,
      () => group ? this.openGroup(group, '卡牌加工') : undefined, disabled);
  }

  private renderSuperShop(parent: Node, groups: ActionGroup[]): void {
    const key = 'legacy:shop'; const pageSize = 4; const page = this.gridPage(key, groups.length, pageSize);
    groups.slice(page * pageSize, page * pageSize + pageSize).forEach((group, index) => {
      const col = index % 2; const row = Math.floor(index / 2); const left = 330 + col * 310; const top = 72 + row * 160;
      const [x, y] = center(left, top, 272, 144);
      const tile = this.ui.button(parent, `${key}:Goods:${index}`, '', x, y, 272, 144, () => this.openGroup(group, '超级商店'), false, true);
      this.ui.panel(tile, 'GoodsBackground', 272, 144, 0, 0, new Color(31, 11, 18, 238), new Color(111, 62, 60, 230));
      this.localSkin(tile, 'IconFrame', 'wupingezi_2', -79, 19, 72, 72);
      this.shopIcon(tile, group, -79, 19);
      this.ui.label(tile, 'Name', group.label, 49, 34, 154, 28, 14, Theme.gold, true);
      this.ui.label(tile, 'Price', this.localizedShopPrice(group.detail), 49, 4, 154, 24, 12, Theme.text, true);
      this.ui.button(tile, 'Buy', '购买', 75, -43, 82, 28, () => this.openGroup(group, '超级商店'),
        group.items.every(item => item.disabled));
    });
    this.gridPager(parent, key, groups.length, pageSize, 652, 382);
    this.ui.panel(parent, `${key}:StatusBackground`, 738, 50, ...center(283, 410, 738, 50),
      new Color(49, 12, 20, 255), new Color(112, 55, 58, 255));
    const currencies = this.state?.actor.currencies ?? {};
    const balance = (value: number | undefined): string => Number.isFinite(value) ? Number(value).toLocaleString('zh-CN') : '—';
    this.ui.label(parent, `${key}:Balances`,
      `余额  银币 ${balance(currencies.silver)}   金币 ${balance(currencies.gold)}   晶石 ${balance(currencies.crystal)}`,
      ...center(305, 420, 430, 28), 430, 28, 13, Theme.gold, true);

  }

  private shopIcon(parent: Node, group: ActionGroup, x: number, y: number): void {
    const presentation = SHOP_ICONS[group.key];
    const assetId = presentation?.assetId ?? group.assetId;
    const path = assetId && this.state?.assetIcons?.[assetId];
    if (path) {
      void this.ui.image(parent, `ShopIcon:${group.key}`, `${this._base}/recovered/${path.replace(/^\//, '')}`, 60, 60, x, y);
      return;
    }
    if (presentation?.sourceIcon) {
      void this.ui.image(parent, `ShopIcon:${group.key}`,
        `${this._base}/recovered/original-ui/items/${presentation.sourceIcon}`, 60, 60, x, y);
    }
  }

  private localizedShopPrice(detail: string): string {
    return detail.replace(/\bsilver\b/gi, '银币').replace(/\bgold\b/gi, '金币').replace(/\bcrystal\b/gi, '晶石');
  }

  private renderReputationShop(parent: Node, key: string, groups: ActionGroup[], panel: [number, number, number, number]): void {
    const pageSize = 3; const page = this.gridPage(key, groups.length, pageSize);
    groups.slice(page * pageSize, page * pageSize + pageSize).forEach((group, index) => {
      const left = panel[0] + 14 + index * 190; const top = panel[1] + 55;
      this.sourceSkin(parent, `${key}:GoodsFrame:${index}`, 'swshangchengkuang', left, top, 155, 178);
      const [x, y] = center(left, top, 155, 178);
      const tile = this.ui.button(parent, `${key}:Goods:${index}`, '', x, y, 155, 178, () => this.openGroup(group, '声望商店'), false, true);
      this.assetIcon(tile, group.assetId, 82, 108, 0, 20);
      this.ui.label(tile, 'Name', group.label, 0, -39, 142, 22, 11, Theme.gold);
      this.ui.label(tile, 'Price', group.detail, -18, -62, 94, 20, 10, Theme.text);
      this.ui.button(tile, 'Buy', '购买', 45, -62, 52, 24, () => this.openGroup(group, '声望商店'),
        group.items.every(item => item.disabled));
    });
    this.gridPager(parent, key, groups.length, pageSize, panel[0] + panel[2] / 2, panel[1] + panel[3] - 24);
  }

  private assetIcon(parent: Node, id: string, width: number, height: number, x = 0, y = 0): void {
    const cardMatch = /^main:card:(\d+)$/.exec(id);
    let path = id && this.state?.assetIcons?.[id];
    if (!path && cardMatch) {
      const card = this._catalog.scopes.main.cards[cardMatch[1]];
      path = this._catalog.assets[card?.art[0]]?.path ?? undefined;
    }
    if (!path) return;
    if (!cardMatch) {
      void this.ui.image(parent, `AssetIcon:${id}`, `${this._base}/recovered/${path.replace(/^\//, '')}`, width, height, x, y);
      return;
    }
    const scale = Math.min(width / 85, height / 116);
    void this.ui.image(parent, `AssetIcon:${id}`, `${this._base}/recovered/${path.replace(/^\//, '')}`,
      85 * scale, 116 * scale, x, y);
  }

  private petIcon(parent: Node, group: ActionGroup, width: number, height: number, x = 0, y = 0): void {
    const petId = group.items.map(item => item.payload?.petId).find(id => String(id ?? '') === group.key);
    if (petId !== undefined && !MISSING_PET_SOURCE_ICONS.has(String(petId))) {
      void this.ui.image(parent, `PetIcon:${group.key}`,
        `${this._base}/recovered/original-ui/items/pet${String(petId)}.jpg`, width, height, x, y);
      return;
    }
    this.assetIcon(parent, group.assetId, width, height, x, y);
  }

  private localSkin(parent: Node, name: string, skin: string, x: number, y: number, width: number, height: number): void {
    try { this.ui.skin(parent, name, skin, x, y, width, height); }
    catch { /* The surrounding original window remains usable if an optional cell skin is absent. */ }
  }

  private gridPage(key: string, length: number, pageSize: number): number {
    const max = Math.max(0, Math.ceil(length / pageSize) - 1);
    const page = Math.max(0, Math.min(this.pages.get(key) ?? 0, max));
    this.pages.set(key, page); return page;
  }

  private gridPager(parent: Node, key: string, length: number, pageSize: number, sourceX: number, sourceY: number): void {
    const pages = Math.max(1, Math.ceil(length / pageSize)); const page = this.gridPage(key, length, pageSize);
    if (pages <= 1) return;
    const [x, y] = center(sourceX - 80, sourceY, 160, 24);
    this.ui.button(parent, `${key}:Previous`, '‹', x - 56, y, 34, 24, () => { this.pages.set(key, page - 1); this.redraw(); }, page === 0);
    this.ui.label(parent, `${key}:Page`, `${page + 1}/${pages}`, x, y, 52, 22, 11, Theme.dim);
    this.ui.button(parent, `${key}:Next`, '›', x + 56, y, 34, 24, () => { this.pages.set(key, page + 1); this.redraw(); }, page >= pages - 1);
  }

  private gapControl(parent: Node, name: string, label: string, left: number, top: number, width: number, height: number,
      title: string, detail: string): void {
    this.ui.button(parent, name, label, ...center(left, top, width, height), width, height,
      () => this.callbacks.detail(title, detail));
  }

  private bindSourceAction(parent: Node, name: string, skin: string, left: number, top: number, width: number, height: number,
      item: ActionItem | undefined, title: string, missingDetail: string): void {
    this.sourceSkin(parent, `${name}:Art`, skin, left, top, width, height);
    this.transparent(parent, name, left, top, width, height,
      () => item ? this.execute(item) : this.callbacks.detail(title, missingDetail), Boolean(item?.disabled));
  }

  private transparent(parent: Node, name: string, left: number, top: number, width: number, height: number,
      callback: () => void, disabled = false, label = ''): void {
    const [x, y] = center(left, top, width, height);
    const button = this.ui.button(parent, name, '', x, y, width, height, callback, disabled, true);
    if (label) this.ui.label(button, 'BoundAction', label, 0, 0, Math.max(20, width - 4), Math.max(16, height - 2), Math.min(13, height - 7), disabled ? Theme.dim : Theme.text);
  }

  private safeText(mount: OriginalUiMount, selector: string, value: string | number): void {
    try { mount.setText(selector, value); } catch { /* The source may omit an optional label in another export. */ }
  }

  private safeVisible(mount: OriginalUiMount, selector: string, visible: boolean): void {
    try { mount.setVisible(selector, visible); } catch { /* The source may omit an optional group in another export. */ }
  }

  private safeButtonState(mount: OriginalUiMount, selector: string, enabled: boolean): void {
    const node = mount.child(selector);
    if (!node) return;
    const button = node.getComponent(Button);
    if (button) button.interactable = enabled;
    const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    opacity.opacity = enabled ? 255 : 115;
  }

  private sectionItems(id: string): ActionItem[] {
    const items = this.state?.growth.sections.find(section => section.id === id)?.items ?? [];
    if (!stageSectionAllowed(id)) return [];
    return items.filter(item => {
      if (stageActionReason(item.action, item.payload ?? {})) return false;
      if (id === 'city') return item.action === 'city.tax';
      if (id === 'activities') return item.action === 'activity.loginClaim' || item.action === 'activity.checkin';
      if (id === 'progression') return item.action === 'quest.repeatClaim'
        || (item.action === 'battlePass.claim' && String(item.payload?.track ?? 'free') === 'free');
      if (id === 'profession-skill-shop') return item.action === 'shop.skill.buy';
      return true;
    });
  }

  private execute(item: ActionItem): void {
    if (item.disabled || !item.action) return;
    const reason = stageActionReason(item.action, item.payload ?? {});
    if (reason) { this.callbacks.detail('本阶段范围', reason); return; }
    if (item.fields?.length) this.callbacks.action(item);
    else this.callbacks.run(item.action, item.payload ?? {});
  }

  private executeMaybe(item: ActionItem | undefined, title: string): void {
    if (item) this.execute(item);
    else this.callbacks.detail(title, '该功能暂未开放');
  }

  private redraw(): void {
    const parent = this.root?.parent;
    if (parent && parent.isValid && this.state) this.render(parent, this.state, this.section);
  }
}
