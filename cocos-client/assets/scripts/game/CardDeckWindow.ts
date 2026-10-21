import { BlockInputEvents, Color, EventTouch, Node, UITransform, Vec3 } from 'cc';
import { CocosUi, Theme } from './CocosUi.ts';
import type { OriginalUi } from './OriginalUi.ts';
import type { RecoveredCard, RecoveredCatalog } from './RecoveredContent.ts';

type CardFilter = 1 | 2 | 3;

interface DeckActor {
  id?: string;
  name?: string;
  level?: number;
  profession?: number;
  cards?: Record<string, number>;
  deck?: string[];
}

const WINDOW_WIDTH = 922;
const WINDOW_HEIGHT = 540;
const PAGE_SIZE = 9;
const DECK_PAGE_SIZE = 9;
const PROFESSIONS = ['', '战士', '游侠', '法师', '牧师'];
const RACES: Record<number, string> = {
  1: '人类', 2: '亡灵', 3: '野兽', 4: '地精', 5: '巨魔', 6: '精灵', 7: '兽人',
  8: '异界', 9: '龙族', 10: '天使', 11: '恶魔', 12: '圣军', 13: '仙灵', 14: '半精灵',
  15: '暗巨魔', 16: '多头龙', 17: '艾什魔', 100: '战士', 101: '游侠', 102: '法师', 103: '牧师',
};
const NORMAL_RACE_ORDER = [1, 6, 7, 2, 4, 5, 3, 8, 9, 10, 11];
const NORMAL_RACE_SKINS = ['renlei', 'jingling', 'shouren', 'wangling', 'dijing', 'jumo', 'yeshou', 'yijie', 'longzu', 'tianshi', 'emo'];
const PROFESSION_TROOP_ORDER = [100, 101, 102, 103, 12, 13, 14, 15, 16, 17];
const PROFESSION_TROOP_SKINS = ['zhanshi', 'youxia', 'fashi', 'mushi', 'shengjun', 'xianling', 'banjingling', 'anjumo', 'duotoulong', 'aishimo'];
const DECK_CAPACITY_BY_LEVEL = [4, 5, 6, 7, 7, 8, 9, 9, 10, 11, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
const QUALITY_POWER = [100, 120, 150, 180, 210, 250, 300];

/**
 * Source-shaped card library and deck editor. It owns presentation state only;
 * the supplied callback remains the sole persistence boundary.
 */
export class CardDeckWindow {
  private root?: Node;
  private parent?: Node;
  private actor?: DeckActor;
  private draft: string[] = [];
  private initialDeck = '';
  private actorKey = '';
  private showAll = false;
  private type: CardFilter = 1;
  private race = 0;
  private profession = 0;
  private page = 0;
  private deckPage = 0;
  private dirty = false;
  private pendingSave?: string;
  private closeAfterSave = false;
  private tooltip?: Node;

  constructor(
    private readonly ui: CocosUi,
    private readonly original: OriginalUi,
    private readonly catalog: RecoveredCatalog,
    private readonly base: string,
    private readonly callbacks: { close(): void; save(cards: string[]): void; detail(card: any): void; growth(): void },
  ) {}

  render(parent: Node, actor: any, all = false): void {
    const nextActor = actor as DeckActor;
    const actorKey = String(nextActor.id ?? nextActor.name ?? 'actor');
    const normalizedDeck = (nextActor.deck ?? []).map(id => this.cardId(id)).filter(id => this.card(id));
    const deckSignature = normalizedDeck.join('|');
    if (this.pendingSave === deckSignature) {
      const unchangedSinceSave = this.draft.join('|') === this.pendingSave;
      this.initialDeck = deckSignature;
      this.pendingSave = undefined;
      this.dirty = !unchangedSinceSave;
      if (unchangedSinceSave) this.draft = normalizedDeck;
      if (this.closeAfterSave && unchangedSinceSave) {
        this.closeAfterSave = false;
        this.callbacks.close();
        return;
      }
      this.closeAfterSave = false;
    }
    if (actorKey !== this.actorKey || (!this.dirty && this.initialDeck !== deckSignature)) {
      this.actorKey = actorKey;
      this.draft = normalizedDeck;
      this.initialDeck = deckSignature;
      this.page = 0;
      this.deckPage = 0;
      this.type = 1;
      this.race = 0;
      this.profession = 0;
      this.dirty = false;
    }
    this.parent = parent;
    this.actor = nextActor;
    this.showAll = all;
    this.ensureSecondaryFilter();
    this.redraw();
  }

  private redraw(): void {
    if (!this.parent || !this.actor) return;
    if (this.root?.isValid) this.root.destroy();
    // CardEditWnd source location is (160,0) in the 1200×600 stage.
    const root = this.ui.node(this.parent, 'CardDeckWindow', WINDOW_WIDTH, WINDOW_HEIGHT, 21, 30);
    root.addComponent(BlockInputEvents);
    this.root = root;

    // CardEditWnd.as:25-45 and CardManagerBook.as:51-99.
    this.safeSkin(root, 'Book', 'KaPaiBianJi', 145 + 767 / 2, 17 + 515 / 2, 767, 515);
    this.safeSkin(root, 'LeftBackground', 'kpbjbeijing', 72, 18 + 501 / 2, 144, 501);
    this.ui.label(root, 'WindowTitle', '卡牌编辑', this.x(455), this.y(17), 220, 34, 20, Theme.gold);

    this.sourceButton(root, 'Close', 'guanbi', '', '', 876, 25, 36, 35, () => this.close());
    this.drawLeftPane(root);
    this.drawFilters(root);
    this.drawDeck(root);
    this.drawLibrary(root);
  }

  private drawLeftPane(root: Node): void {
    const capacity = this.deckCapacity();
    const power = this.draft.reduce((sum, id) => {
      const quality = Number(this.card(id)?.raw.Quality ?? 0);
      return sum + (QUALITY_POWER[Math.max(0, Math.min(QUALITY_POWER.length - 1, quality))] ?? 0);
    }, 0);
    // CardCount.as positions are relative to the left pane at source y=18.
    this.ui.label(root, 'DeckCount', `${this.draft.length}/${capacity}`, this.x(75), this.y(93), 80, 30, 25,
      this.draft.length < Math.floor(capacity / 2) || this.draft.length > capacity ? Theme.red : Theme.gold);
    this.ui.label(root, 'DeckMinimum', String(Math.floor(capacity / 2)), this.x(109), this.y(120), 20, 16, 14, Theme.gold);
    this.ui.label(root, 'DeckPower', String(power), this.x(72.5), this.y(171), 75, 16, 14, Theme.gold);
    this.ui.button(root, 'AutoDeck', '自动组牌', this.x(72), this.y(196.5), 74, 27, () => this.autoBuild(), false, true);

    this.safeSkin(root, 'DetailFolder', 'kapaixiangqing_2', 72, 231.5, 121, 27);
    const units = this.draft.filter(id => Number(this.card(id)?.raw.Type ?? 0) === 1).length;
    const skills = this.draft.filter(id => Number(this.card(id)?.raw.Type ?? 0) === 2).length;
    const unitPercent = this.draft.length ? Math.round(units * 100 / this.draft.length) : 0;
    const skillPercent = this.draft.length ? Math.round(skills * 100 / this.draft.length) : 0;
    this.ui.label(root, 'DeckTypes', `Troops: ${units} (${unitPercent}%)\nSkills: ${skills} (${skillPercent}%)`,
      this.x(72), this.y(275), 118, 45, 13, Theme.gold, true);
    const ready = Array.from({ length: 6 }, (_, index) => this.draft.filter(id => {
      const value = Number(this.card(id)?.raw.InitReady ?? 0); return index === 5 ? value >= 6 : value === index + 1;
    }).length);
    this.ui.label(root, 'DeckReady', `Ready\n1  2  3  4  5  6+\n${ready.join('  ')}`,
      this.x(72), this.y(350), 124, 70, 12, Theme.text, true);

    // CardEditLeftInfoPane places the manual button at (6,462) inside the pane.
    this.sourceButton(root, 'Codex', 'ajkptj', '', '', 6, 480, 134, 36, () => {
      this.showAll = true; this.page = 0; this.ensureSecondaryFilter(); this.redraw();
    }, this.showAll);
  }

  private drawFilters(root: Node): void {
    const top = 34;
    // TypeBtns.as uses a right-aligned 3×74 group with a 40px east inset.
    this.typeSkinButton(root, 'TypeProfessionTroop', 'zhiyeshibing_2', 'zhiyeshibing_1', 653, top,
      this.type === 3, '职业兵', () => this.setType(3));
    this.typeSkinButton(root, 'TypeTroop', 'shibing_2', 'shibing_1.png', 727, top,
      this.type === 1, '兵种', () => this.setType(1));
    this.typeSkinButton(root, 'TypeSkill', 'jineng_2.png', 'jineng_1.png', 801, top,
      this.type === 2, '技能', () => this.setType(2));

    const available = this.type === 1 ? this.availableRaces(false)
      : this.type === 3 ? this.availableRaces(true) : this.availableProfessions();
    const order = this.type === 1 ? NORMAL_RACE_ORDER
      : this.type === 3 ? PROFESSION_TROOP_ORDER : [1, 2, 3, 4];
    const skins = this.type === 1 ? NORMAL_RACE_SKINS
      : this.type === 3 ? PROFESSION_TROOP_SKINS : ['zhanshi', 'youxia', 'fashi', 'mushi'];
    order.filter(value => available.includes(value)).forEach((value, index) => {
      const selected = this.type === 2 ? this.profession === value : this.race === value;
      this.verticalFilterButton(root, `Secondary:${value}`, skins[order.indexOf(value)], value, 878, 88 + index * 36,
        selected, () => {
          if (this.type === 2) this.profession = value; else this.race = value;
          this.page = 0; this.redraw();
        });
    });
  }

  private drawDeck(root: Node): void {
    this.ui.label(root, 'DeckTitle', `卡组 ${this.draft.length}`, this.x(242), this.y(29), 94, 18, 15, Theme.gold);
    const start = this.deckPage * DECK_PAGE_SIZE;
    const cards = this.draft.slice(start, start + DECK_PAGE_SIZE);
    cards.forEach((id, index) => {
      const card = this.card(id);
      if (!card) return;
      const sourceX = 195 + (index % 3) * 100;
      const sourceY = 74 + Math.floor(index / 3) * 143;
      this.drawCard(root, card, sourceX, sourceY, 'deck', start + index, this.draftCount(id), this.owned(id));
    });
    this.pager(root, 'DeckPager', this.deckPage, Math.ceil(this.draft.length / DECK_PAGE_SIZE), 425, 58, page => {
      this.deckPage = page; this.redraw();
    });
  }

  private drawLibrary(root: Node): void {
    const cards = this.filteredCards();
    const pageCount = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
    this.page = Math.min(this.page, pageCount - 1);
    this.ui.label(root, 'LibraryTitle', `${this.showAll ? '图鉴' : '持有'} ${cards.length}`, this.x(597), this.y(29), 94, 18, 15, Theme.gold);
    cards.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE).forEach((card, index) => {
      const sourceX = 547 + (index % 3) * 100;
      const sourceY = 74 + Math.floor(index / 3) * 143;
      this.drawCard(root, card, sourceX, sourceY, 'library', index, this.draftCount(card.id), this.owned(card.id));
    });
    this.pager(root, 'LibraryPager', this.page, pageCount, 790, 58, page => {
      this.page = page; this.redraw();
    });
  }

  private drawCard(root: Node, card: RecoveredCard, sourceX: number, sourceY: number,
      side: 'deck' | 'library', index: number, inDeck: number, owned: number): void {
    const centerX = sourceX + 50;
    const centerY = sourceY + 71.5;
    const quality = Number(card.raw.Quality ?? 0);
    const qualityColor = [new Color(170, 170, 160), new Color(80, 190, 105), new Color(75, 135, 235),
      new Color(178, 100, 225), new Color(235, 155, 58), new Color(230, 205, 100)][Math.max(0, Math.min(5, quality))];
    const slot = this.ui.node(root, `${side}:Slot:${index}`, 100, 143, this.x(centerX), this.y(centerY));
    const panel = this.ui.panel(slot, `${side}:Card:${index}`, 85, 116, 0, 6, new Color(18, 22, 22, 245), qualityColor);
    const art = this.catalog.assets[card.art[0]];
    if (art?.path) void this.ui.image(panel, 'Portrait', this.assetUrl(art.path), 79, 110);
    this.cardFrame(panel, card);
    this.optionalLocalSkin(panel, 'ReadyPlate', 'feiyongxiao', -30, 44);
    this.optionalLocalSkin(panel, 'RaceOrProfession', this.cardBadge(card), 31, 44);
    this.ui.label(panel, 'Ready', String(card.raw.InitReady ?? ''), -31, 44, 18, 18, 12, Theme.gold);
    this.qualityMarker(panel, quality);
    const monster = this.catalog.scopes.main.monsters[String(card.raw.MonsterID ?? '')];
    if (monster) {
      this.ui.panel(panel, 'StatShade', 79, 24, 0, -43, new Color(3, 8, 8, 165));
      if (!(Number(monster.Type) === 2 && Number(monster.Attack) === 0)) {
        this.ui.label(panel, 'Attack', String(monster.Attack ?? 0), -29, -43, 25, 24, 18, Theme.text);
      }
      this.ui.label(panel, 'HP', String(monster.HP ?? 0), 29, -43, 25, 24, 18, Theme.text);
    }
    const countText = side === 'deck' ? `${inDeck}/${owned}` : this.showAll ? `${inDeck} / ${owned}` : `${Math.max(0, owned - inDeck)}可用`;
    this.ui.label(slot, 'Count', countText, 0, -64, 85, 15, 11,
      side === 'library' && owned <= inDeck ? Theme.red : Theme.dim);

    // CardToolTipUI installs an EditBigCarPanel (202×276), not a menu.
    slot.on(Node.EventType.MOUSE_ENTER, () => this.showCardTooltip(card, sourceX, sourceY));
    slot.on(Node.EventType.MOUSE_LEAVE, () => { this.tooltip?.destroy(); this.tooltip = undefined; });
    this.bindCardGesture(slot, side, card.id);
  }

  private showCardTooltip(card: RecoveredCard, sourceX: number, sourceY: number): void {
    this.tooltip?.destroy();
    if (!this.root?.isValid) return;
    const left = sourceX > 600 ? sourceX - 210 : sourceX + 94;
    const top = Math.min(235, Math.max(66, sourceY));
    const box = this.ui.node(this.root, 'CardToolTipUI:EditBigCarPanel', 202, 276,
      this.x(left + 101), this.y(top + 138));
    this.tooltip = box;
    const art = this.catalog.assets[card.art[0]];
    if (art?.path) void this.ui.image(box, 'OriginalPortrait', this.assetUrl(art.path), 196, 270);
    const frame = this.ui.node(box, 'BigCardFrame', 85, 116); frame.setScale(202 / 85, 276 / 116, 1);
    this.cardFrame(frame, card);
    this.ui.panel(box, 'ContentShade', 192, 122, 0, -64, new Color(4, 8, 9, 220));
    this.ui.label(box, 'Name', String(card.raw.Name), 0, 105, 176, 30, 14, Theme.gold);
    const monster = this.catalog.scopes.main.monsters[String(card.raw.MonsterID ?? '')];
    const skill = this.catalog.scopes.main.skills[String(card.raw.SkillID ?? '')];
    const description = monster ? [1, 2, 3, 4, 5].map(index =>
      this.catalog.scopes.main.effects[String(monster[`ability${index}`])]?.EffectDes ?? '').filter(Boolean).join('\n')
      : String(skill?.raw?.Des ?? card.raw.Des ?? '');
    this.ui.label(box, 'Description', description.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ''),
      0, -58, 178, 100, 11, Theme.text, true);
    this.ui.label(box, 'Ready', String(card.raw.InitReady ?? 0), -76, 113, 30, 28, 21, Theme.gold);
    if (monster) this.ui.label(box, 'AttackHP', `${monster.Attack}                 ${monster.HP}`,
      0, -120, 178, 26, 18, Theme.text);
  }

  private bindCardGesture(node: Node, side: 'deck' | 'library', id: string): void {
    let startX = 0;
    let startY = 0;
    node.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
      const point = event.getUILocation(); startX = point.x; startY = point.y;
    });
    const finish = (event: EventTouch, cancelled = false) => {
      const point = event.getUILocation();
      const dragged = Math.hypot(point.x - startX, point.y - startY) > 12;
      if (!dragged) {
        if (cancelled) return;
        if (side === 'library') this.add(id); else this.remove(id);
        return;
      }
      const local = this.root?.getComponent(UITransform)?.convertToNodeSpaceAR(new Vec3(point.x, point.y, 0));
      if (!local) return;
      // Source split: centerCards starts at x=175 after its 30px inset; the
      // preferred 342px deck pane therefore ends at source x=517.
      const sourceX = local.x + WINDOW_WIDTH / 2;
      if (side === 'library' && sourceX < 517) this.add(id);
      else if (side === 'deck' && sourceX >= 517) this.remove(id);
    };
    node.on(Node.EventType.TOUCH_END, (event: EventTouch) => finish(event));
    // Cocos emits TOUCH_CANCEL for a captured touch released outside the
    // original card bounds. It is the normal cross-pane drop path.
    node.on(Node.EventType.TOUCH_CANCEL, (event: EventTouch) => finish(event, true));
  }

  private add(id: string): void {
    if (this.draftCount(id) >= this.owned(id)) return;
    this.draft.push(id);
    this.dirty = this.draft.join('|') !== this.initialDeck;
    this.deckPage = Math.max(0, Math.ceil(this.draft.length / DECK_PAGE_SIZE) - 1);
    this.redraw();
  }

  private remove(id: string): void {
    const index = this.draft.lastIndexOf(id);
    if (index < 0) return;
    this.draft.splice(index, 1);
    this.dirty = this.draft.join('|') !== this.initialDeck;
    this.deckPage = Math.min(this.deckPage, Math.max(0, Math.ceil(this.draft.length / DECK_PAGE_SIZE) - 1));
    this.redraw();
  }

  private save(): void {
    this.pendingSave = this.draft.join('|');
    this.closeAfterSave = false;
    this.callbacks.save([...this.draft]);
  }

  private close(): void {
    if (!this.dirty) { this.callbacks.close(); return; }
    this.pendingSave = this.draft.join('|');
    this.closeAfterSave = true;
    this.callbacks.save([...this.draft]);
  }

  private autoBuild(): void {
    const capacity = this.deckCapacity();
    const next: string[] = [];
    for (const card of this.filteredCards()) {
      if (next.length >= capacity) break;
      const monster = this.catalog.scopes.main.monsters[String(card.raw.MonsterID ?? '')];
      const maxCopies = Number(monster?.Unique ?? 0) > 0 ? 1 : 3;
      const copies = Math.min(this.owned(card.id), maxCopies, capacity - next.length);
      for (let index = 0; index < copies; index++) next.push(card.id);
    }
    if (next.length) {
      this.draft = next;
      this.dirty = this.draft.join('|') !== this.initialDeck;
      this.deckPage = 0;
      this.redraw();
    }
  }

  private deckCapacity(): number {
    const level = Math.max(1, Math.floor(Number(this.actor?.level ?? 1)));
    return DECK_CAPACITY_BY_LEVEL[Math.min(level, DECK_CAPACITY_BY_LEVEL.length) - 1] ?? 30;
  }

  private filteredCards(): RecoveredCard[] {
    const cards = Object.values(this.catalog.scopes.main.cards).filter(card => {
      if (!this.showAll && this.owned(card.id) < 1) return false;
      const rawType = Number(card.raw.Type ?? 0);
      const phyle = this.monsterPhyle(card);
      if (this.type === 1 && (rawType !== 1 || phyle >= 12 || phyle >= 100)) return false;
      if (this.type === 2 && rawType !== 2) return false;
      if (this.type === 3 && (rawType !== 1 || (phyle < 12 && phyle < 100))) return false;
      if ((this.type === 1 || this.type === 3) && this.race && phyle !== this.race) return false;
      if (this.type === 2 && this.profession && this.skillProfession(card) !== this.profession) return false;
      return true;
    });
    return cards.sort((a, b) => Number(a.raw.ID ?? 0) - Number(b.raw.ID ?? 0));
  }

  private availableRaces(professionTroops: boolean): number[] {
    const races = new Set<number>();
    for (const card of Object.values(this.catalog.scopes.main.cards)) {
      if (Number(card.raw.Type) !== 1 || (!this.showAll && this.owned(card.id) < 1)) continue;
      const race = this.monsterPhyle(card);
      if (race > 0 && (professionTroops ? (race >= 12 || race >= 100) : race < 12)) races.add(race);
    }
    return Array.from(races).sort((a, b) => a - b);
  }

  private availableProfessions(): number[] {
    const professions = new Set<number>();
    for (const card of Object.values(this.catalog.scopes.main.cards)) {
      if (Number(card.raw.Type) !== 2 || (!this.showAll && this.owned(card.id) < 1)) continue;
      const profession = this.skillProfession(card); if (profession > 0) professions.add(profession);
    }
    return Array.from(professions).sort((a, b) => a - b);
  }

  private monsterPhyle(card: RecoveredCard): number {
    const monster = this.catalog.scopes.main.monsters[String(card.raw.MonsterID ?? '')];
    return Number(monster?.Phyle ?? card.raw.Race ?? 0);
  }

  private skillProfession(card: RecoveredCard): number {
    const skillId = String(card.raw.SkillID ?? card.raw.skillID ?? '');
    const raw = this.catalog.scopes.main.skills[skillId]?.raw;
    return Number(raw?.['使用职业'] ?? raw?.Occ ?? raw?.occ ?? 0);
  }

  private setType(type: CardFilter): void {
    this.type = type; this.race = 0; this.profession = 0; this.page = 0; this.ensureSecondaryFilter(); this.redraw();
  }

  private ensureSecondaryFilter(): void {
    if (this.type === 2) {
      const available = this.availableProfessions();
      if (!available.includes(this.profession)) this.profession = available[0] ?? 0;
      return;
    }
    const available = this.availableRaces(this.type === 3);
    const order = this.type === 3 ? PROFESSION_TROOP_ORDER : NORMAL_RACE_ORDER;
    if (!available.includes(this.race)) this.race = order.find(value => available.includes(value)) ?? available[0] ?? 0;
  }

  private card(id: string): RecoveredCard | undefined {
    return this.catalog.scopes.main.cards[this.localId(id)];
  }

  private cardId(id: string): string {
    return this.catalog.scopes.main.cards[this.localId(id)]?.id ?? id;
  }

  private localId(id: string): string { return String(id).split(':').at(-1) ?? String(id); }

  private owned(id: string): number {
    const cards = this.actor?.cards ?? {};
    const canonical = this.cardId(id);
    return Math.max(0, Number(cards[canonical] ?? cards[this.localId(canonical)] ?? 0));
  }

  private draftCount(id: string): number {
    const canonical = this.cardId(id);
    return this.draft.reduce((count, value) => count + (this.cardId(value) === canonical ? 1 : 0), 0);
  }

  private pager(root: Node, name: string, page: number, count: number, sourceX: number, sourceY: number,
      setPage: (page: number) => void): void {
    const pages = Math.max(1, count);
    this.sourceButton(root, name + ':Prev', 'zuo', '', '', sourceX - 55, sourceY - 13, 24, 30,
      () => setPage(Math.max(0, page - 1)), page <= 0);
    this.ui.label(root, name + ':Text', `${page + 1}/${pages}`, this.x(sourceX), this.y(sourceY), 70, 25, 12, Theme.dim);
    this.sourceButton(root, name + ':Next', 'you', '', '', sourceX + 43, sourceY - 13, 24, 30,
      () => setPage(Math.min(pages - 1, page + 1)), page >= pages - 1);
  }

  private typeSkinButton(root: Node, name: string, normal: string, selectedSkin: string, sourceX: number,
      sourceY: number, selected: boolean, label: string, callback: () => void): void {
    const skin = selected ? selectedSkin : normal;
    const node = this.safeSkin(root, name, skin, sourceX + 37, sourceY + 18, 74, 36, this.sourceSkinVariant(skin));
    if (!this.original.catalog.skins[skin]) this.ui.label(node, name + ':FallbackLabel', label, 0, 0, 65, 28, 12, new Color(255, 245, 210));
    if (!selected) node.on(Node.EventType.TOUCH_END, callback);
  }

  private verticalFilterButton(root: Node, name: string, skinRoot: string, value: number, sourceX: number,
      sourceY: number, selected: boolean, callback: () => void): void {
    const suffix = selected ? '_1.png' : '_2.png';
    let skin = skinRoot + suffix;
    if (!this.original.catalog.skins[skin]) {
      skin = skinRoot + (selected ? '_1' : '_2');
    }
    const node = this.safeSkin(root, name, skin, sourceX + 18.5, sourceY + 16.5, 37, 33, this.sourceSkinVariant(skin));
    if (!this.original.catalog.skins[skin]) this.ui.label(node, name + ':Label',
      (this.type === 2 ? PROFESSIONS[value] : RACES[value] ?? String(value)).slice(0, 2),
      0, 0, 34, 27, 10, selected ? Theme.gold : Theme.text);
    if (!selected) node.on(Node.EventType.TOUCH_END, callback);
  }

  private cardFrame(parent: Node, card: RecoveredCard): void {
    const phyle = this.monsterPhyle(card);
    const names = ['renleikuang', 'renleikuang', 'wanglingkuang', 'yeshoukuang', 'dijingkuang', 'jumokuang',
      'jinglingkuang', 'shourenkuang', 'yijiekuang', 'longzukuang', 'tianshikuang', 'emokuang',
      'ronghekuang_shengjun', 'ronghekuang_xianling', 'ronghekuang_banjingling', 'ronghekuang_anjumo',
      'ronghekuang_duotoulong', 'ronghekuang_aishimo', 'ronghekuang_longnu', 'ronghekuang_pinjiejumo'];
    const name = Number(card.raw.SkillID ?? 0) > 0 || phyle >= 100 ? 'jineng' : names[phyle] ?? 'jinglingkuang';
    const skin = this.original.catalog.skins[name];
    if (!skin) return;
    const variant = skin.path ? undefined : this.newPlayerVariant(name);
    try { this.ui.skin(parent, 'SourceFrame:' + name, name, 0, 0, 85, 116, variant); } catch { /* Imported source gap. */ }
  }

  private cardBadge(card: RecoveredCard): string {
    const skillId = String(card.raw.SkillID ?? '');
    if (skillId) {
      const profession = this.skillProfession(card);
      return ['ZSxiao', 'ZSxiao', 'LRxiao', 'FSxiao', 'MSxiao', 'MSxiao'][profession] ?? 'ZSxiao';
    }
    const phyle = this.monsterPhyle(card);
    if (phyle >= 100) return ['ZSxiao', 'ZSxiao', 'LRxiao', 'FSxiao', 'MSxiao', 'MSxiao'][phyle - 99] ?? 'ZSxiao';
    return ['renleizhongzuxiao', 'renleizhongzuxiao', 'wanglingbiaozhixiao', 'yeshoubiaozhixiao',
      'dijingbiaozhixiao', 'jumobiaozhixiao', 'jinglingbiaozhixiao', 'shourenbiaozhixiao',
      'yijietubiaoxiao', 'longzubiaozhixiao', 'tianshibiaozhixiao', 'emobiaozhixiao',
      'shengjuntubiaoxiao', 'xianlingtubiaoxiao', 'banjinglingtubiaoxiao', 'anjumotubiaoxiao',
      'duotoulongtubiaoxiao', 'aishimotubiaoxiao'][phyle] ?? 'jinglingbiaozhixiao';
  }

  private optionalLocalSkin(parent: Node, name: string, skinName: string, x: number, y: number,
      width?: number, height?: number): void {
    const skin = this.original.catalog.skins[skinName];
    if (!skin) return;
    const variant = skin.path ? undefined : this.newPlayerVariant(skinName);
    try { this.ui.skin(parent, name, skinName, x, y, width, height, variant); } catch { /* Imported source gap. */ }
  }

  private qualityMarker(parent: Node, quality: number): void {
    const names = ['baixingxiao', 'lvxingxiao', 'lanxingxiao', 'zixingxiao', 'chengxingxiao', 'hongxingxiao', 'jinxingxiao'];
    const name = names[Math.max(0, Math.min(names.length - 1, quality))];
    const skin = this.original.catalog.skins[name];
    if (!skin) return;
    const variant = skin.path ? undefined : this.newPlayerVariant(name);
    this.safeSkin(parent, 'Quality', name, 0, 49, 24, 12, variant, true);
  }

  private sourceSkinVariant(name: string): string | undefined {
    const skin = this.original.catalog.skins[name];
    if (!skin || skin.path) return undefined;
    return Object.keys(skin.variants).find(key => key.startsWith('game/data/img/ui/kapaibianji.swf'))
      ?? Object.keys(skin.variants)[0];
  }

  private newPlayerVariant(name: string): string | undefined {
    const skin = this.original.catalog.skins[name];
    if (!skin || skin.path) return undefined;
    return Object.keys(skin.variants).find(key => key.startsWith('game/data/newplayer.swf'))
      ?? Object.keys(skin.variants)[0];
  }

  private sourceButton(parent: Node, name: string, skin: string, pressed: string, text: string,
      sourceX: number, sourceY: number, width: number, height: number, callback: () => void, disabled = false): Node {
    try {
      return this.ui.sourceButton(parent, name, skin, pressed, text, this.x(sourceX + width / 2), this.y(sourceY + height / 2),
        width, height, callback, disabled);
    } catch {
      return this.ui.button(parent, name, text || '·', this.x(sourceX + width / 2), this.y(sourceY + height / 2),
        width, height, callback, disabled, true);
    }
  }

  private safeSkin(parent: Node, name: string, skin: string, sourceCenterX: number, sourceCenterY: number,
      width: number, height: number, variant?: string, local = false): Node {
    try {
      return this.ui.skin(parent, name, skin, local ? sourceCenterX : this.x(sourceCenterX), local ? sourceCenterY : this.y(sourceCenterY),
        width, height, variant);
    } catch {
      return this.ui.panel(parent, name, width, height, local ? sourceCenterX : this.x(sourceCenterX), local ? sourceCenterY : this.y(sourceCenterY),
        new Color(28, 42, 42, 235), Theme.gold);
    }
  }

  private assetUrl(path: string): string {
    return this.base.replace(/\/$/, '') + '/recovered/' + path.replace(/^\//, '');
  }

  private x(sourceX: number): number { return sourceX - WINDOW_WIDTH / 2; }
  private y(sourceY: number): number { return WINDOW_HEIGHT / 2 - sourceY; }
}
