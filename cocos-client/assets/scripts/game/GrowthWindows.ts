import { cardName } from './GameText.ts';
import { BlockInputEvents, Color, Node } from 'cc';
import { CocosUi, Theme } from './CocosUi.ts';
import type { OriginalUi } from './OriginalUi.ts';
import type { RecoveredCatalog } from './RecoveredContent.ts';
import { RecoveredAnimation } from './RecoveredAnimation.ts';
import { AdvancedGrowthWindows } from './AdvancedGrowthWindows.ts';

type Row = Record<string, unknown>;
interface Field { key: string; label: string; type?: string; value?: unknown; min?: number; max?: number; options?: {label: string; value: string}[] }
type SmithyMode = 'enhance' | 'refine' | 'craft' | 'runeCraft';
interface ActionItem {
  label: string;
  detail?: string;
  action: string;
  payload?: Record<string, unknown>;
  disabled?: boolean;
  fields?: Field[];
}
interface Section { id: string; title: string; items: ActionItem[] }
interface GrowthDestination { id: string; title: string }
interface GrowthState {
  actor: {
    name?: string; level?: number; profession?: number; xp?: number;
    sex?: number; gender?: number;
    currencies?: { silver?: number; gold?: number; crystal?: number };
    inventory?: Record<string, number>; warehouse?: Record<string, number>;
    equipment?: Record<string, string>; enhancements?: Record<string, number>;
    growth?: Row;
  };
  growth: { characterStats?: Row; sections: Section[]; summary?: Row; profile?: { avatarAssetId?: string | null } };
  assetNames?: Record<string, string>;
  assetIcons?: Record<string, string>;
}
interface GrowthCallbacks {
  close(): void;
  action(item: ActionItem): void;
  run(action: string, payload?: Record<string, unknown>): void;
  detail(title: string, text: string, actions?: ActionItem[]): void;
}

const WINDOW_W = 709;
const WINDOW_H = 443;
const WINDOW_X = 240 + WINDOW_W / 2 - 600;
const WINDOW_Y = 300 - (40 + WINDOW_H / 2);
const PAGE_SIZE = 36;
const PROFESSIONS = ['', '战士', '游侠', '法师', '牧师'];
const SLOT_NAMES = ['头盔', '护甲', '护腿', '靴子', '徽记', '武器', '护符', '戒指', '勋章', '披风', '宝石', '坐骑', '副手', '饰品'];
// EquipPane.ITEM_X / ITEM_Y translated from its 296×225 source pane into
// the left half of PackagePane.  The right half is reserved for SmallPackagePane.
const SLOT_POINTS: Array<[number, number]> = [
  [-264, 114], [-264, 64], [-264, 14], [-264, -47], [-203, -47], [-20, 64], [-81, -47],
  [-20, 14], [-142, -47], [-20, 114], [-207, 114], [-20, -137], [-20, -47], [-76, 114],
];

function object(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function entries(value: unknown): Array<[string, number]> {
  return Object.entries(object(value)).map(([id, count]): [string, number] => [id, Number(count)]).filter(([, count]) => count > 0);
}

function sameItem(left: unknown, right: unknown): boolean {
  const a = String(left ?? ''); const b = String(right ?? '');
  return a === b || a.split(':').at(-1) === b.split(':').at(-1);
}

/** Source-shaped package, equipment and smithy surfaces for the growth snapshot. */
export class GrowthWindows {
  private root?: Node;
  private parent?: Node;
  private state?: GrowthState;
  private section = '';
  private readonly pages = new Map<string, number>();
  private selectedItem = '';
  private inventoryStore: 'inventory' | 'warehouse' = 'inventory';
  private equipmentMode: 'wear' | 'smithy' = 'wear';
  private smithyMode: SmithyMode = 'enhance';
  private categoryPage = 0;
  private categoriesOpen = false;
  private actorPreview?: RecoveredAnimation;
  private readonly advanced: AdvancedGrowthWindows;

  constructor(private readonly ui: CocosUi, private readonly original: OriginalUi,
              private readonly catalog: RecoveredCatalog, private readonly base: string,
              private readonly callbacks: GrowthCallbacks) {
    this.advanced = new AdvancedGrowthWindows(ui, original, catalog, base, callbacks);
  }

  render(parent: Node, state: unknown, section: string): void {
    this.parent = parent;
    this.state = state as GrowthState;
    const requested = this.routeSection(section || this.state.growth.sections[0]?.id || 'inventory');
    this.section = requested === 'smithy' ? 'equipment' : requested;
    this.categoriesOpen = false;
    if (this.advanced.supports(requested)) {
      this.actorPreview?.destroy(); this.actorPreview = undefined;
      if (this.root?.isValid) this.root.destroy();
      this.root = undefined;
      this.advanced.render(parent, state, requested);
      return;
    }
    this.advanced.destroy();
    // The home-screen smithy shortcut currently routes to `equipment`.  Make
    // that public entry open the smithy; the bqzl tab switches to wear/profile.
    if (requested === 'equipment' || requested === 'smithy') this.equipmentMode = 'smithy';
    this.draw();
  }

  update(dt: number): void { this.actorPreview?.update(dt); this.advanced.update(dt); }

  destroy(): void {
    this.actorPreview?.destroy(); this.actorPreview = undefined;
    this.advanced.destroy();
    if (this.root?.isValid) this.root.destroy();
    this.root = undefined; this.parent = undefined; this.state = undefined;
  }

  private draw(): void {
    this.actorPreview?.destroy(); this.actorPreview = undefined;
    if (this.root?.isValid) this.root.destroy();
    this.root = this.ui.node(this.parent!, 'GrowthWindows', WINDOW_W, WINDOW_H, WINDOW_X, WINDOW_Y);
    this.root.addComponent(BlockInputEvents);
    this.skin(this.root, 'WindowFrame', 'ckxiao', WINDOW_W, WINDOW_H);
    this.skin(this.root, 'WindowTitle', this.section === 'equipment' && this.equipmentMode === 'smithy' ? 'tiejiangpu' : 'btrenwu',
      this.section === 'equipment' && this.equipmentMode === 'smithy' ? 92 : 53,
      this.section === 'equipment' && this.equipmentMode === 'smithy' ? 25 : 24, 0, 196);
    this.skin(this.root, 'CloseArt', 'guanbi', 34, 33, 326, 193);
    this.ui.button(this.root, 'Growth:Close', '', 326, 193, 34, 33, () => this.callbacks.close(), false, true);
    this.renderRail();
    const content = this.ui.node(this.root, 'GrowthContent', 660, 399, 17, -8);
    const contentSkin = this.contentSkin();
    this.skin(content, 'ContentBackground', contentSkin.name, 660, 399, 0, 0, contentSkin.variant);
    if (this.categoriesOpen) this.renderCategories(content);
    else if (this.section === 'inventory') this.renderInventory(content);
    else if (this.section === 'equipment') this.renderEquipment(content);
    else this.renderModule(content);
  }

  private renderRail(): void {
    const root = this.root!;
    if (this.section === 'equipment' && this.equipmentMode === 'smithy' && !this.categoriesOpen) {
      const smithyTabs: Array<{ id: SmithyMode; normal: string; selected: string }> = [
        { id: 'enhance', normal: 'bqqh', selected: 'bqqh_l' },
        { id: 'craft', normal: 'bqhc', selected: 'bqhc_l' },
        { id: 'runeCraft', normal: 'bqdz', selected: 'bqdz_l' },
      ];
      smithyTabs.forEach((tab, index) => {
        const y = 125 - index * 88;
        this.skin(root, `SmithyRailArt:${tab.id}`, this.smithyMode === tab.id ? tab.selected : tab.normal, 32, 79, -332, y);
        this.ui.button(root, `SmithyRail:${tab.id}`, '', -332, y, 36, 80, () => {
          this.smithyMode = tab.id; this.selectedItem = ''; this.renderCurrent();
        }, false, true);
      });
      this.ui.button(root, 'SmithyRail:Refine', '精炼', -332, -135, 38, 66, () => {
        this.smithyMode = 'refine'; this.selectedItem = ''; this.renderCurrent();
      }, this.smithyMode === 'refine', true);
      this.ui.button(root, 'SmithyRail:Actor', '角色', -332, -167, 38, 28, () => {
        this.openSection('equipment', 'wear');
      }, false, true);
      this.ui.button(root, 'SmithyRail:All', '全部', -332, -199, 38, 28, () => {
        this.categoriesOpen = true; this.renderCurrent();
      }, false, true);
      return;
    }
    const tabs: Array<{ id: string; title: string; normal: string; selected: string }> = [
      { id: 'inventory', title: '背包', normal: 'bqbb', selected: 'bqbb_l' },
      { id: 'equipment', title: '角色资料', normal: 'bqzl', selected: 'bqzl_l' },
      { id: 'pets', title: '宠物与坐骑', normal: 'bqzq', selected: 'bqzq_l' },
    ];
    tabs.forEach((tab, index) => {
      const y = 125 - index * 88;
      this.skin(root, `RailArt:${tab.id}`, this.section === tab.id && !this.categoriesOpen ? tab.selected : tab.normal, 32, 79, -332, y);
      this.ui.button(root, `GrowthTab:${tab.id}`, '', -332, y, 36, 80, () => {
        this.openSection(tab.id, tab.id === 'equipment' ? 'wear' : undefined);
      }, false, true);
    });
    this.ui.button(root, 'GrowthTab:All', '更多', -332, -145, 38, 76, () => {
      this.categoriesOpen = true; this.renderCurrent();
    }, false, true);
  }

  private contentSkin(): { name: string; variant?: string } {
    if (this.section === 'inventory') return { name: 'zbbj_1' };
    if (this.section === 'equipment' && this.equipmentMode === 'wear') return { name: 'renwuziliao' };
    if (this.section === 'pets') return { name: 'zbbj_2_zq' };
    return { name: 'xiaochuangkoubj', variant: 'game/data/img/ui/gonggongchuangkou.swf#144' };
  }

  private renderInventory(content: Node): void {
    const state = this.state!;
    this.renderEquipPane(content, false);
    this.ui.button(content, 'Inventory:Bag', '背包', 92, 166, 96, 25, () => {
      this.inventoryStore = 'inventory'; this.selectedItem = ''; this.renderCurrent();
    }, this.inventoryStore === 'inventory');
    this.ui.button(content, 'Inventory:Warehouse', '仓库', 205, 166, 96, 25, () => {
      this.inventoryStore = 'warehouse'; this.selectedItem = ''; this.renderCurrent();
    }, this.inventoryStore === 'warehouse');
    const source = entries(state.actor[this.inventoryStore]);
    const pageKey = `inventory:${this.inventoryStore}`;
    const page = this.page(pageKey, source.length, PAGE_SIZE);
    const visible = source.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const selected = source.find(([id]) => id === this.selectedItem) ?? visible[0] ?? source[0];
    if (selected) this.selectedItem = selected[0];
    for (let index = 0; index < PAGE_SIZE; index++) {
      const col = index % 6; const row = Math.floor(index / 6); const item = visible[index];
      const x = 43 + col * 47; const y = 126 - row * 47;
      this.skin(content, `InventoryFrame:${page * PAGE_SIZE + index}`,
        this.selectedItem === item?.[0] ? 'wupingezi_2' : 'qianghuagezi_1', 43, 43, x, y);
      const slot = this.ui.button(content, `InventorySlot:${page * PAGE_SIZE + index}`, '', x, y, 42, 42,
        () => { if (item) { this.selectedItem = item[0]; this.renderCurrent(); } }, !item, true);
      if (!item) continue;
      const hasIcon = this.itemIcon(slot, item[0], 31, 31, 0, 3);
      if (!hasIcon) this.ui.label(slot, 'Id', this.shortName(item[0]), 0, 2, 38, 20, 10, Theme.text);
      this.ui.label(slot, 'Count', String(item[1]), 9, -13, 20, 14, 10, Theme.gold);
    }
    this.renderPackageOperations(content, selected);
    this.pager(content, pageKey, source.length, PAGE_SIZE, 182, -162);
  }

  private renderPackageOperations(content: Node, selected?: [string, number]): void {
    if (!selected) {
      this.ui.label(content, 'InventoryEmpty', this.inventoryStore === 'warehouse' ? '仓库为空' : '背包为空',
        182, 0, 260, 50, 16, Theme.dim);
      return;
    }
    const actions = this.itemActions(selected[0]);
    this.ui.label(content, 'SelectedItem', `${this.assetName(selected[0])} ×${selected[1]}`, 182, -138, 270, 19, 12, Theme.gold);
    actions.slice(0, 3).forEach((item, index) => this.ui.button(content, `ItemAction:${index}`,
      item.label.replace(this.assetName(selected[0]), '').trim() || item.label,
      49 + index * 91, -187, 82, 25, () => this.execute(item), Boolean(item.disabled)));
    if (actions.length > 3) this.ui.button(content, 'ItemAction:More', '更多', 312, -187, 38, 25,
      () => this.callbacks.detail(this.assetName(selected[0]), `${this.inventoryStore === 'warehouse' ? '仓库' : '持有'} ${selected[1]}`, actions));
  }

  private renderEquipment(content: Node): void {
    this.ui.button(content, 'Equipment:Wear', '角色装备', -85, 165, 150, 28, () => {
      this.equipmentMode = 'wear'; this.renderCurrent();
    }, this.equipmentMode === 'wear');
    this.ui.button(content, 'Equipment:Smithy', '铁匠铺', 85, 165, 150, 28, () => {
      this.equipmentMode = 'smithy'; this.renderCurrent();
    }, this.equipmentMode === 'smithy');
    if (this.equipmentMode === 'wear') this.renderWear(content);
    else this.renderSmithy(content);
  }

  private renderWear(content: Node): void {
    this.renderEquipPane(content, true);
    const actor = this.state!.actor;
    const equipActions = this.sectionItems('equipment').filter(item => item.action === 'equipment.equip');
    const key = 'equipment:equip'; const page = this.page(key, equipActions.length, 6);
    this.ui.label(content, 'EquipCandidates', '背包装备', 186, 121, 220, 24, 16, Theme.gold);
    equipActions.slice(page * 6, page * 6 + 6).forEach((item, index) => this.ui.button(content,
      `EquipCandidate:${index}`, item.label.replace(/^装备\s*/, ''), 186, 86 - index * 42, 224, 34,
      () => this.execute(item), Boolean(item.disabled)));
    if (!equipActions.length) this.ui.label(content, 'NoEquipCandidates', '背包中没有可装备物品', 186, 28, 224, 42, 14, Theme.dim);
    this.pager(content, key, equipActions.length, 6, 186, -168);
    const xp = Number(actor.xp ?? 0);
    this.ui.label(content, 'ActorProgress', `等级 ${actor.level ?? 1} · 经验 ${xp}`, 186, -137, 230, 22, 12, Theme.dim);
  }

  private renderEquipPane(content: Node, profile: boolean): void {
    const actor = this.state!.actor;
    this.ui.label(content, 'ActorName', actor.name ?? '角色', -165, 156, 280, 28, 18, Theme.gold);
    this.ui.label(content, 'ActorSummary', `Lv.${actor.level ?? 1}  ${PROFESSIONS[Number(actor.profession)] ?? `职业${actor.profession ?? ''}`}`,
      -165, 134, 280, 21, 13, Theme.text);
    const previewHost = this.ui.node(content, 'ActorPreview', 170, 170, -165, 82);
    const preview = new RecoveredAnimation(previewHost, this.catalog, `${this.base}/recovered/`);
    this.actorPreview = preview;
    const sex = actor.sex === 0 || actor.sex === 1 ? actor.sex : actor.gender === 2 ? 0 : 1;
    const previewLoading = this.ui.label(previewHost, 'PreviewLoading', '正在载入…', 0, 0, 140, 24, 12, Theme.dim);
    void preview.setActor(Number(actor.profession ?? 1), sex as 0 | 1, true).then(() => {
      if (this.actorPreview === preview && previewHost.isValid) { previewLoading.node.destroy(); preview.fitPreviewBox(170, 170); }
    }).catch(() => {
      if (this.actorPreview !== preview || !previewHost.isValid) return;
      previewLoading.node.destroy(); preview.destroy(); this.actorPreview = undefined;
      const avatarId = this.state?.growth.profile?.avatarAssetId ?? '';
      const avatar = this.catalog.assets[String(avatarId)];
      if (avatar?.path) void this.ui.image(previewHost, 'ActorAvatarFallback', `${this.base}/recovered/${avatar.path}`, 120, 150);
      else this.ui.label(previewHost, 'ActorUnavailable', '角色形象资源缺失', 0, 0, 150, 32, 12, Theme.dim);
    });
    const equipped = object(actor.equipment);
    SLOT_POINTS.forEach(([x, y], slot) => {
      const id = String(equipped[String(slot)] ?? '');
      this.skin(content, `EquipFrame:${slot}`, slot === 4 ? 'fuwengezi' : 'qianghuagezi_1',
        slot === 4 ? 50 : 43, slot === 4 ? 47 : 43, x, y);
      const button = this.ui.button(content, `EquipSlot:${slot}`, '', x, y, 45, 45, () => {
        if (!id) return;
        const actions = this.sectionItems('equipment').filter(item => item.action === 'equipment.unequip'
          ? Number(item.payload?.slot) === slot : sameItem(item.payload?.itemId, id));
        this.callbacks.detail(`${SLOT_NAMES[slot]} · ${this.assetName(id)}`,
          `强化 +${Number(actor.enhancements?.[id] ?? 0)}`, actions);
      }, !id, true);
      if (id) {
        const hasIcon = this.itemIcon(button, id, 34, 34);
        if (!hasIcon) this.ui.label(button, 'Equipped', this.shortName(id), 0, 0, 41, 18, 9);
      }
      else this.ui.label(button, 'EmptySlot', SLOT_NAMES[slot], 0, 0, 41, 26, 9, Theme.dim);
    });
    const stats = this.state!.growth.characterStats ?? {};
    this.ui.label(content, 'SourceLevelValue', String(actor.level ?? 1), -262, -113.5, 24, 22, 14, Theme.gold);
    const required = Number(stats.nextLevelXp ?? 0), ratio = required > 0 ? Math.min(1, Number(actor.xp ?? 0) / required) : 1;
    this.ui.label(content, 'SourceExperiencePercent', `${Math.floor(ratio * 100)}%`, -26.5, -113.5, 35, 22, 11, Theme.gold);
    if (this.original.catalog.skins.rwjyt?.path) {
      const progress = this.ui.node(content, 'SourceExperienceBar', 199, 6, -249, -113);
      const bar = this.ui.skin(progress, 'SourceExperienceFill', 'rwjyt', 99.5, 0, 199, 6);
      progress.setScale(ratio, 1, 1);
    }
    [stats.hp, stats.critical, stats.soldierBlock, stats.soldierAttack].forEach((value, index) => {
      this.ui.label(content, 'SourceActorStat:' + index, value === null || value === undefined ? '—' : String(value),
        [-270, -197, -125, -50][index], -166.5, 60, 20, 11, Theme.gold);
    });
    if (!profile) this.ui.label(content, 'PackageActorHint', '点击装备槽查看或卸下', -165, -174, 270, 20, 11, Theme.dim);
  }

  private renderSmithy(content: Node): void {
    if (this.smithyMode === 'enhance') this.renderEnhance(content);
    else this.renderSmithyRecipes(content);
  }

  private renderEnhance(content: Node): void {
    const items = this.sectionItems('equipment').filter(item => item.action === 'equipment.enhance');
    const selected = this.selectedItem ? items.find(item => sameItem(item.payload?.itemId, this.selectedItem)) : undefined;
    if (!selected) this.selectedItem = '';

    // QianghuaPane occupies the left 324×389 source region. Its qhzbcl decorator is
    // fitted to the pane's 324×303 background; controls below it remain inside the 399px window.
    const paneLeft = -330; const paneTop = 199.5;
    const at = (left: number, top: number, width: number, height: number): [number, number] =>
      [paneLeft + left + width / 2, paneTop - top - height / 2];
    this.skin(content, 'EnhanceBoard', 'qhzbcl', 324, 303, ...at(0, 0, 324, 303));
    this.ui.label(content, 'EnhanceTitle', '装备强化', ...at(18, 7, 303, 19), 303, 19, 13, Theme.gold);
    this.skin(content, 'EnhanceArrow', 'qianghuajiantou', 179, 44, ...at(73, 117, 179, 44));
    this.skin(content, 'EnhanceEquipmentFrame', 'qhzb_3', 68, 65, ...at(128, 50, 68, 65));
    if (selected) this.itemIcon(content, String(selected.payload?.itemId ?? ''), 50, 50, ...at(137, 57, 50, 50));
    this.ui.label(content, 'EnhancePreview', selected ? `${this.assetName(selected.payload?.itemId)}\n${selected.detail ?? ''}` : '请选择装备',
      ...at(30, 47, 100, 72), 100, 72, 12, selected ? Theme.text : Theme.dim, true);
    [55, 142, 227].forEach((left, index) => {
      const [x, y] = at(left, 139, 43, 43);
      this.skin(content, `MaterialSlot:${index}`, 'qianghuagezi_1', 43, 43, x, y);
      this.ui.label(content, `MaterialText:${index}`, index === 0 ? '强化石' : '材料', x, y, 40, 18, 9, Theme.dim);
    });
    this.skin(content, 'EnhanceRate', 'tjpchenggonglv', 296, 49, ...at(7, 239, 296, 49));
    this.ui.label(content, 'EnhanceRateLabel', selected ? '强化成功率' : '选择装备后查看成功率', ...at(13, 240, 307, 46),
      307, 46, 11, selected ? Theme.gold : Theme.dim);
    if (selected) {
      const button = this.ui.button(content, 'Enhance:Execute', '', ...at(120, 339, 118, 50), 118, 50,
        () => this.execute(selected), Boolean(selected.disabled), true);
      this.skin(button, 'EnhanceButtonArt', 'qh', 118, 50);
    }

    // QianghuaMain's right BeibaoPane is a six-column equipment package.
    this.skin(content, 'EnhancePackage', 'qhzbcl_2', 326, 374, 157, 12.5);
    this.ui.label(content, 'EnhancePackageTitle', '可强化装备', 157, 169, 286, 22, 13, Theme.gold);
    const key = 'equipment:enhance'; const pageSize = 24; const page = this.page(key, items.length, pageSize);
    items.slice(page * pageSize, page * pageSize + pageSize).forEach((item, index) => {
      const col = index % 6; const row = Math.floor(index / 6); const x = 35.5 + col * 49; const y = 128 - row * 49;
      const itemId = String(item.payload?.itemId ?? ''); const chosen = sameItem(itemId, this.selectedItem);
      this.skin(content, `EnhanceCandidateFrame:${index}`, chosen ? 'wupingezi_2' : 'qianghuagezi_1', 45, 45, x, y);
      const tile = this.ui.button(content, `EnhanceCandidate:${index}`, '', x, y, 43, 43, () => {
        this.selectedItem = itemId; this.renderCurrent();
      }, false, true);
      if (!this.itemIcon(tile, itemId, 32, 32)) this.ui.label(tile, 'Name', this.shortName(itemId), 0, 1, 39, 18, 8,
        item.disabled ? Theme.dim : Theme.text);
    });
    if (!items.length) this.ui.label(content, 'EnhanceEmpty', '暂无可强化装备', 157, 40, 260, 48, 14, Theme.dim);
    if (items.length > pageSize) this.pager(content, key, items.length, pageSize, 157, -154);
  }

  private renderSmithyRecipes(content: Node): void {
    const action = `equipment.${this.smithyMode}`;
    const items = this.sectionItems('equipment').filter(item => item.action === action);
    const key = `equipment:${this.smithyMode}`; const pageSize = 24; const page = this.page(key, items.length, pageSize);
    const headings: Record<SmithyMode, string> = { enhance: '装备强化', refine: '精炼装备', craft: '装备合成', runeCraft: '符文锻造' };
    const itemKey = (item: ActionItem) => String(item.payload?.recipeId ?? item.payload?.itemId ?? item.label);
    const selected = items.find(item => itemKey(item) === this.selectedItem) ?? items[0];
    if (selected) this.selectedItem = itemKey(selected);

    // HechengPane keeps the recipe/material/result slots on the left and the selectable
    // inventory/recipe package on the right. Preserve that interaction instead of a text action list.
    this.skin(content, 'RecipeBoard', this.smithyMode === 'runeCraft' ? 'fuwenzhizaodi_2' : 'qhzbcl', 324, 303, -168, 48);
    this.skin(content, 'RecipePackage', 'qhzbcl_2', 326, 374, 157, 12.5);
    this.ui.label(content, 'SmithyHeading', headings[this.smithyMode], -145, 142, 280, 26, 17, Theme.gold);
    const materialSlots: Array<[number, number]> = [[-248, 54], [-180, 54], [-248, -12], [-180, -12]];
    materialSlots.forEach(([x, y], index) => {
      this.skin(content, `RecipeMaterial:${index}`, this.smithyMode === 'runeCraft' ? 'fuwengezi_2' : 'qianghuagezi_1', 45, 45, x, y);
      this.ui.label(content, `RecipeMaterialLabel:${index}`, '材料', x, y, 40, 18, 9, Theme.dim);
    });
    this.skin(content, 'RecipeArrow', 'hechengjiantou', 19, 27, -145, 20);
    this.skin(content, 'RecipeResult', this.smithyMode === 'runeCraft' ? 'fuwengezi' : 'qhzb_3',
      this.smithyMode === 'runeCraft' ? 61 : 68, this.smithyMode === 'runeCraft' ? 56 : 65, -70, 20);
    if (selected?.payload?.itemId) this.itemIcon(content, String(selected.payload.itemId), 48, 48, -70, 22);
    this.ui.label(content, 'RecipeSelection', selected?.label ?? '请选择配方', -145, -65, 275, 26, 13, selected ? Theme.text : Theme.dim);
    this.ui.label(content, 'RecipeDetail', selected?.detail ?? '暂无可用配方', -145, -91, 275, 38, 11, Theme.dim, true);
    if (selected) {
      const execute = this.ui.button(content, 'RecipeExecute', '', -145, -137, 118, 50,
        () => this.execute(selected), Boolean(selected.disabled), true);
      this.skin(execute, 'RecipeExecuteArt', 'hc', 118, 50);
    }
    const visible = items.slice(page * pageSize, page * pageSize + pageSize);
    visible.forEach((item, index) => {
      const col = index % 6; const row = Math.floor(index / 6); const x = 43 + col * 47; const y = 91 - row * 51;
      this.skin(content, `SmithyRecipeFrame:${index}`, itemKey(item) === this.selectedItem ? 'wupingezi_2' : 'qianghuagezi_1', 45, 45, x, y);
      const tile = this.ui.button(content, `SmithyRecipe:${index}`, '', x, y, 43, 43, () => {
        this.selectedItem = itemKey(item); this.renderCurrent();
      }, false, true);
      const assetId = String(item.payload?.itemId ?? '');
      if (!assetId || !this.itemIcon(tile, assetId, 32, 32)) {
        this.ui.label(tile, 'RecipeId', String(item.payload?.recipeId ?? item.payload?.itemId ?? index + 1), 0, 2, 39, 18, 9,
          item.disabled ? Theme.dim : Theme.text);
      }
    });
    if (!items.length) this.ui.label(content, 'RecipeEmpty', '暂无可用配方', 160, 0, 250, 50, 15, Theme.dim);
    this.pager(content, key, items.length, pageSize, 160, -162);
  }

  private renderModule(content: Node): void {
    if (this.section === 'energy-supply') this.renderEnergySupply(content);
    else if (this.section === 'clan-war') this.renderClanWar(content);
    else if (this.section === 'tasks') this.renderTaskJournal(content);
    else if (this.section === 'collection') this.renderCollection(content);
    else this.renderDebugModule(content);
  }

  private renderCategories(content: Node): void {
    const sections = this.categoryDestinations();
    const size = 12; const pages = Math.max(1, Math.ceil(sections.length / size));
    this.categoryPage = Math.max(0, Math.min(this.categoryPage, pages - 1));
    this.ui.label(content, 'CategoryTitle', '成长与冒险', 0, 137, 560, 32, 18, Theme.gold);
    sections.slice(this.categoryPage * size, this.categoryPage * size + size).forEach((section, index) => {
      const col = index % 3; const row = Math.floor(index / 3);
      this.ui.button(content, `Category:${section.id}`, section.title, -210 + col * 210, 79 - row * 66, 184, 50,
        () => this.openSection(section.id));
    });
    if (this.debugSections().length) this.ui.button(content, 'Category:Debug', '调试', 270, -167, 72, 28,
      () => this.openSection('debug-sections'));
    this.ui.button(content, 'CategoryPrevious', '上一页', -100, -167, 120, 28, () => {
      this.categoryPage--; this.renderCurrent();
    }, this.categoryPage === 0);
    this.ui.label(content, 'CategoryPage', `${this.categoryPage + 1}/${pages}`, 0, -167, 70, 26, 13, Theme.dim);
    this.ui.button(content, 'CategoryNext', '下一页', 100, -167, 120, 28, () => {
      this.categoryPage++; this.renderCurrent();
    }, this.categoryPage >= pages - 1);
  }

  private categoryDestinations(): GrowthDestination[] {
    const available = new Map(this.state!.growth.sections.map(section => [section.id, section.title]));
    const result: GrowthDestination[] = [];
    const add = (id: string, title?: string) => { if (available.has(id)) result.push({ id, title: title ?? available.get(id)! }); };
    add('cards'); add('progression'); add('city'); add('activities'); add('summon'); add('shop');
    add('reputation-shop'); add('profession-skill-shop'); add('tower'); add('forbidden'); add('world-boss');
    const operations = this.sectionItems('quest-operations');
    if (operations.some(item => item.action.startsWith('quest.explore.'))) result.push({ id: 'dock', title: '出征港口' });
    if (operations.some(item => !item.action.startsWith('quest.explore.'))) result.push({ id: 'energy-supply', title: '精力与冒险补给' });
    if (available.has('city')) result.push({ id: 'defense', title: '护城要塞' });
    add('ranked-season'); add('tournament'); add('clan-war'); add('tasks'); add('collection');
    return result;
  }

  private debugSections(): Section[] {
    const known = new Set(['inventory', 'equipment', 'pets', 'cards', 'progression', 'city', 'activities', 'summon', 'shop',
      'reputation-shop', 'profession-skill-shop', 'tower', 'forbidden', 'world-boss', 'quest-operations', 'ranked-season',
      'tournament', 'clan-war', 'tasks', 'collection']);
    return this.state!.growth.sections.filter(section => section.id === 'local-tools' || !known.has(section.id));
  }

  private renderEnergySupply(content: Node): void {
    const items = this.sectionItems('quest-operations').filter(item => !item.action.startsWith('quest.explore.'));
    const supplies = items.filter(item => ['quest.energy.buy', 'quest.tax.force', 'quest.elitePack.open'].includes(item.action));
    const petIsland = items.filter(item => item.action.startsWith('petIsland.') || item.action === 'pet.synthesize');
    const affairs = items.filter(item => !supplies.includes(item) && !petIsland.includes(item));
    this.ui.label(content, 'EnergyTitle', '精力与冒险补给', 0, 142, 520, 28, 19, Theme.gold);
    this.ui.label(content, 'EnergyValue', `当前精力 ${Number(object(this.state!.actor.growth).energy ?? 0)}/40`, -205, 101, 210, 26, 15, Theme.gold);
    supplies.forEach((item, index) => {
      const tile = this.ui.button(content, `EnergySupply:${index}`, item.label, -205, 58 - index * 52, 220, 42,
        () => this.execute(item), Boolean(item.disabled));
      if (item.detail) this.ui.label(tile, 'Detail', item.detail, 0, -13, 205, 16, 9, Theme.dim);
    });
    this.ui.label(content, 'PetIslandTitle', '宠物岛', 70, 101, 220, 24, 15, Theme.gold);
    const petPage = this.page('energy:pet-island', petIsland.length, 4);
    petIsland.slice(petPage * 4, petPage * 4 + 4).forEach((item, index) => this.ui.button(content,
      `PetIsland:${index}`, item.label, 70, 64 - index * 48, 260, 38, () => this.execute(item), Boolean(item.disabled)));
    this.pager(content, 'energy:pet-island', petIsland.length, 4, 70, -145);
    this.ui.label(content, 'AdventureAffairsTitle', '冒险事务', 245, 101, 160, 24, 15, Theme.gold);
    const affairPage = this.page('energy:affairs', affairs.length, 4);
    affairs.slice(affairPage * 4, affairPage * 4 + 4).forEach((item, index) => this.ui.button(content,
      `AdventureAffair:${index}`, item.label, 245, 64 - index * 48, 165, 38, () => this.execute(item), Boolean(item.disabled)));
    this.pager(content, 'energy:affairs', affairs.length, 4, 245, -145);
  }

  private renderClanWar(content: Node): void {
    const items = this.sectionItems('clan-war');
    const registrations = items.filter(item => item.action === 'clanwar.register');
    const departures = items.filter(item => item.action === 'room.create');
    const rewards = items.filter(item => item.action === 'clanwar.reward.claim');
    this.skin(content, 'ClanWarPanel', 'gonghuixiaokuang_3', 438, 359, 0, -5);
    this.ui.label(content, 'ClanWarTitle', '公会城战', 0, 142, 320, 28, 19, Theme.gold);
    this.ui.label(content, 'ClanWarRegisterTitle', '领地报名', -142, 102, 170, 24, 14, Theme.gold);
    const registerPage = this.page('clan-war:register', registrations.length, 3);
    registrations.slice(registerPage * 3, registerPage * 3 + 3).forEach((item, index) => this.ui.button(content, `ClanWar:Register:${index}`,
      item.label.replace(/^报名城战：/, ''), -142, 63 - index * 54, 170, 42, () => this.execute(item), Boolean(item.disabled)));
    this.ui.label(content, 'ClanWarDepartureTitle', '出征', 52, 102, 170, 24, 14, Theme.gold);
    const departurePage = this.page('clan-war:departure', departures.length, 3);
    departures.slice(departurePage * 3, departurePage * 3 + 3).forEach((item, index) => this.ui.button(content, `ClanWar:Departure:${index}`,
      item.label.replace(/^出征：/, ''), 52, 63 - index * 54, 170, 42, () => this.execute(item), Boolean(item.disabled)));
    this.ui.label(content, 'ClanWarRewardTitle', '赛季奖励', 225, 102, 130, 24, 14, Theme.gold);
    const rewardPage = this.page('clan-war:reward', rewards.length, 3);
    rewards.slice(rewardPage * 3, rewardPage * 3 + 3).forEach((item, index) => this.ui.button(content, `ClanWar:Reward:${index}`,
      item.label, 225, 63 - index * 54, 125, 42, () => this.execute(item), Boolean(item.disabled)));
    if (registrations.length > 3) this.pager(content, 'clan-war:register', registrations.length, 3, -142, -121);
    if (departures.length > 3) this.pager(content, 'clan-war:departure', departures.length, 3, 52, -121);
    if (rewards.length > 3) this.pager(content, 'clan-war:reward', rewards.length, 3, 225, -121);
    if (!items.length) this.ui.label(content, 'ClanWarEmpty', '暂无可用数据', 0, 0, 300, 46, 14, Theme.dim);
  }

  private renderTaskJournal(content: Node): void {
    const items = this.sectionItems('tasks'); const key = 'module:tasks'; const pageSize = 6; const page = this.page(key, items.length, pageSize);
    this.ui.label(content, 'TaskJournalTitle', '任务手册', 0, 142, 420, 28, 19, Theme.gold);
    items.slice(page * pageSize, page * pageSize + pageSize).forEach((item, index) => {
      const col = index % 2; const row = Math.floor(index / 2); const x = col ? 160 : -160; const y = 87 - row * 92;
      const card = this.ui.node(content, `TaskJournal:${index}`, 292, 78, x, y);
      this.ui.label(card, 'Name', item.label, 0, 19, 268, 24, 14, item.disabled ? Theme.dim : Theme.gold, true);
      this.ui.label(card, 'Progress', item.detail ?? '', 0, -11, 268, 34, 11, Theme.text, true);
      this.ui.button(card, 'Claim', '领取', 98, -24, 70, 24, () => this.execute(item), Boolean(item.disabled));
    });
    if (!items.length) this.ui.label(content, 'TaskJournalEmpty', '暂无可领取项目', 0, 0, 340, 48, 14, Theme.dim);
    this.pager(content, key, items.length, pageSize, 0, -168);
  }

  private renderCollection(content: Node): void {
    const items = this.sectionItems('collection'); const key = 'module:collection'; const pageSize = 6; const page = this.page(key, items.length, pageSize);
    this.ui.label(content, 'CollectionTitle', '图鉴奖励', 0, 142, 420, 28, 19, Theme.gold);
    items.slice(page * pageSize, page * pageSize + pageSize).forEach((item, index) => {
      const col = index % 3; const row = Math.floor(index / 3); const x = -210 + col * 210; const y = 72 - row * 145;
      this.skin(content, `CollectionFrame:${index}`, 'kphccao_1', 84, 108, x, y + 14);
      this.ui.label(content, `CollectionName:${index}`, item.label.replace(/^领取图鉴：/, ''), x, y - 53, 180, 22, 12, Theme.gold);
      this.ui.button(content, `CollectionClaim:${index}`, '领取奖励', x, y - 82, 112, 28,
        () => this.execute(item), Boolean(item.disabled));
    });
    if (!items.length) this.ui.label(content, 'CollectionEmpty', '暂无可领取项目', 0, 0, 340, 48, 14, Theme.dim);
    this.pager(content, key, items.length, pageSize, 0, -168);
  }

  private renderDebugModule(content: Node): void {
    const sections = this.debugSections();
    const selectedSection = sections.find(section => section.id === this.section)
      ?? (this.section === 'debug-sections' ? undefined : this.state!.growth.sections.find(section => section.id === this.section));
    const items = selectedSection?.items ?? sections.flatMap(section => section.items);
    const key = `debug:${selectedSection?.id ?? 'all'}`; const pageSize = 8; const page = this.page(key, items.length, pageSize);
    this.ui.label(content, 'DebugTitle', selectedSection?.title ?? '调试功能', 0, 137, 520, 30, 18, Theme.gold);
    if (!selectedSection && sections.length > 1) sections.forEach((section, index) => this.ui.button(content,
      `DebugSection:${section.id}`, section.title, -230 + (index % 4) * 154, 100 - Math.floor(index / 4) * 40, 142, 30,
      () => this.openSection(section.id)));
    const top = !selectedSection && sections.length > 1 ? 30 : 87;
    items.slice(page * pageSize, page * pageSize + pageSize).forEach((item, index) => {
      const x = index % 2 ? 158 : -158; const y = top - Math.floor(index / 2) * 56;
      this.ui.button(content, `DebugAction:${index}`, item.label, x, y, 292, 44,
        () => this.execute(item), Boolean(item.disabled));
    });
    if (!items.length) this.ui.label(content, 'DebugEmpty', '暂无调试项目', 0, 0, 400, 50, 14, Theme.dim);
    this.pager(content, key, items.length, pageSize, 0, -168);
  }

  private sectionItems(id: string): ActionItem[] {
    return this.state!.growth.sections.find(section => section.id === id)?.items ?? [];
  }

  private itemActions(id: string): ActionItem[] {
    return this.sectionItems('inventory').filter(item => sameItem(item.payload?.itemId, id));
  }

  private execute(item: ActionItem): void {
    if (item.disabled || !item.action) return;
    if (item.fields?.length) this.callbacks.action(item);
    else this.callbacks.run(item.action, item.payload ?? {});
  }

  private page(key: string, length: number, size: number): number {
    const max = Math.max(0, Math.ceil(length / size) - 1);
    const value = Math.max(0, Math.min(this.pages.get(key) ?? 0, max));
    this.pages.set(key, value); return value;
  }

  private pager(parent: Node, key: string, length: number, size: number, x: number, y: number): void {
    const pages = Math.max(1, Math.ceil(length / size)); const page = this.page(key, length, size);
    this.ui.button(parent, `${key}:Previous`, '‹', x - 55, y, 38, 26, () => {
      this.pages.set(key, page - 1); this.selectedItem = ''; this.renderCurrent();
    }, page === 0);
    this.ui.label(parent, `${key}:Page`, `${page + 1}/${pages}`, x, y, 55, 24, 12, Theme.dim);
    this.ui.button(parent, `${key}:Next`, '›', x + 55, y, 38, 26, () => {
      this.pages.set(key, page + 1); this.selectedItem = ''; this.renderCurrent();
    }, page >= pages - 1);
  }

  private currencyBar(content: Node): void {
    const values = this.state!.actor.currencies ?? {};
    this.ui.label(content, 'CurrencyBar', `金币 ${values.gold ?? 0}   银币 ${values.silver ?? 0}   晶石 ${values.crystal ?? 0}`,
      -105, -140, 310, 22, 12, Theme.gold);
  }

  private assetName(id: unknown): string {
    const key = String(id ?? '');
    return this.state!.assetNames?.[key]
      ?? (key.includes(':card:')?cardName(this.catalog,key):`物品 #${key.split(':').at(-1)}`);
  }

  private shortName(id: string): string {
    const name = this.assetName(id).replace(/^物品\s*/, '');
    return name.length > 5 ? name.slice(0, 5) : name;
  }

  private itemIcon(parent: Node, id: string, width: number, height: number, x = 0, y = 0): boolean {
    const path = this.state!.assetIcons?.[id];
    if (!path) return false;
    void this.ui.image(parent, `ItemIcon:${id}`, `${this.base}/recovered/${path.replace(/^\//, '')}`, width, height, x, y);
    return true;
  }

  private skin(parent: Node, nodeName: string, name: string, width: number, height: number, x = 0, y = 0,
               containerVariant?: string): void {
    try {
      const source = this.original.skin(name, containerVariant);
      void this.ui.image(parent, nodeName, `${this.base}/recovered/${source.path}.png`, width, height, x, y);
    } catch { /* Optional source skin gaps keep the controls usable. */ }
  }

  private renderCurrent(): void {
    if (this.parent && this.state) this.draw();
  }

  private routeSection(section: string): string {
    if (section === 'quest-operations') return 'energy-supply';
    if (section === 'mounts' || section === 'mount') return 'pets';
    if (section === 'expedition') return 'dock';
    return section;
  }

  private openSection(section: string, equipmentMode?: 'wear' | 'smithy'): void {
    const destination = this.routeSection(section);
    this.section = destination;
    if (equipmentMode) this.equipmentMode = equipmentMode;
    this.categoriesOpen = false;
    this.selectedItem = '';
    if (this.advanced.supports(destination)) {
      this.actorPreview?.destroy(); this.actorPreview = undefined;
      if (this.root?.isValid) this.root.destroy();
      this.root = undefined;
      this.advanced.render(this.parent!, this.state!, destination);
      return;
    }
    this.advanced.destroy();
    this.renderCurrent();
  }
}
