import { Component, Node, Label, EditBox, Color, UITransform, view, ResolutionPolicy, tween, Vec3, Graphics, profiler } from 'cc';
import { CocosUi, Theme } from './CocosUi.ts';
import { RecoveredAnimation } from './RecoveredAnimation.ts';
import { RecoveredEffects } from './RecoveredEffects.ts';
import { GameAudio } from './GameAudio.ts';
import type { RecoveredCatalog, RecoveredCard } from './RecoveredContent.ts';
import type { BattleState, LegalPlay, BattleAction, BattleEvent } from './GameContracts.ts';

interface FormField { key: string; label: string; type?: string; value?: unknown; min?: number; max?: number; options?: {label: string; value: string}[] }
interface ActionItem { label: string; detail?: string; action: string; payload?: Record<string, unknown>; disabled?: boolean; fields?: FormField[] }
interface Section { id: string; title: string; items: ActionItem[] }
interface SceneNodeView { id: string; originalId: string; name: string; story?: string; x: number; y: number; cleared: boolean; accessible: boolean;
  battle: boolean; transitions: number[]; triggers: { id: string; name: string; repeat: number }[] }
interface SceneView { id: string; name: string; unlocked: boolean; minLevel: number; nodes: SceneNodeView[] }
interface ActorView { id: string; name: string; profession: number; level: number; xp: number; tutorialStep: number;
  currencies: { silver: number; gold: number; crystal: number }; cards: Record<string, number>; deck: string[];
  inventory: Record<string, number>; progress: { sceneId: number }; guildId?: string; settings: Record<string, boolean> }
type Row = Record<string, unknown>;
interface Snapshot { assetNames: Record<string, string>; story: string; revision: number; now: number; actor: ActorView; scenes: SceneView[];
  tasks: { id: string; name: string; detail: string; ready: boolean; claimed: boolean; reward: number }[];
  growth: { profile: { avatarAssetId: string | null }; sections: Section[] }; social: { people: Row[]; friends: Row[]; friendRequests: Row[]; chat: Row[]; mail: Row[]; guilds: Row[]; trades: Row[]; auctions: Row[] };
  rooms: Row[]; roomInvites: Row[]; rankings: Row[]; dungeons: Row[];
  battle: { id: string; mode: string; state: BattleState; settled: boolean; rewards?: { won: boolean; silver: number; xp: number; cards: {id: string; count: number}[] }; legalPlays: LegalPlay[] } | null }
interface Character { id: string; name: string; level: number; profession: number }
interface UnitDisplay { node: Node; animation: RecoveredAnimation; hp: Label; name: Label; monsterId: number; team: number }
const PROFESSIONS = ['', '战士', '游侠', '法师', '牧师'];
const NAV = [['home','主城'],['world','世界地图'],['cards','卡牌与编队'],['growth','成长与背包'],['tasks','任务与引导'],
  ['social','好友与聊天'],['mail','邮件'],['guild','公会与城战'],['trade','交易与拍卖'],['rooms','合作与竞技'],['rankings','天梯排行'],['settings','系统设置']];
const AUTH_KEY = 'tianxu.auth.v1';

export class TianxuGame extends Component {
  private ui = new CocosUi(); private root!: Node; private body!: Node; private modal?: Node;
  private token = ''; private characterId = ''; private characters: Character[] = [];
  private catalog?: RecoveredCatalog; private state?: Snapshot;
  private page = 'home'; private listPage = 0; private section = ''; private selectedScene = 1;
  private cardsAll = false; private draftDeck?: string[]; private busy = false; private polling = false;
  private notice = ''; private noticeUntil = 0; private noticeLabel?: Label;
  private pollTimer?: ReturnType<typeof setInterval>; private autoTimer = 0; private autoplay = false; private battleHidden = false;
  private selectedHand = ''; private battleId = ''; private battleLayer?: Node; private battleHud?: Node;
  private lastUnitCells = new Map<string, { row: number; col: number; team: number }>();
  private unitDisplays = new Map<string, UnitDisplay>(); private eventSeq = 0; private speed = 1;
  private animationQueue: BattleEvent[] = []; private nextEventAt = 0;
  private apiBase = '';
  private recoveredEffects?: RecoveredEffects;
  private authKey = AUTH_KEY; private backdrop = ''; private audio?: GameAudio;

  onLoad() {
    view.setDesignResolutionSize(1200, 600, ResolutionPolicy.SHOW_ALL);
    profiler.hideStats();
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const origin = params.get('api') ?? globalThis.location?.origin ?? 'http://127.0.0.1:7400';
    const destination = new URL(origin);
    this.apiBase = ['localhost','127.0.0.1','[::1]'].includes(destination.hostname) ? destination.origin : globalThis.location.origin;
    const slot = params.get('client'); if (slot && /^[a-zA-Z0-9_-]{1,30}$/.test(slot)) this.authKey += ':' + slot;
    this.root = this.ui.node(this.node, 'TianxuRoot', 1200, 600);
    try { const cached = JSON.parse(localStorage.getItem(this.authKey) ?? '{}'); this.token = cached.token ?? ''; this.characterId = cached.characterId ?? ''; } catch { /* Old campaign save keys are intentionally independent. */ }
    (globalThis as unknown as { __TIANXU_UI__: unknown }).__TIANXU_UI__ = {
      snapshot: () => ({ page: this.page, ready: Boolean(this.state), characterId: this.characterId, busy: this.busy,
        battleId: this.state?.battle?.id, revision: this.state?.revision, buttons: this.ui.targets.map(target => ({ ...target })) }),
    };
    void this.boot();
    this.pollTimer = setInterval(() => { void this.poll(); }, 1000);
  }
  onDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.audio?.destroy(); this.recoveredEffects?.destroy();
    for (const display of this.unitDisplays.values()) display.animation.destroy();
  }
  update(dt: number) {
    this.recoveredEffects?.update(dt * this.speed);
    for (const display of this.unitDisplays.values()) display.animation.update(dt * this.speed);
    if (this.noticeLabel?.isValid) this.noticeLabel.string = Date.now() < this.noticeUntil ? this.notice : '';
    if (this.animationQueue.length && Date.now() >= this.nextEventAt) {
      const event = this.animationQueue.shift()!; this.playEvent(event); this.nextEventAt = Date.now() + 150 / this.speed;
    }
    if (this.autoplay && this.state?.battle && !this.state.battle.settled && !this.busy && Date.now() > this.autoTimer) {
      const battle = this.state.battle; const player = battle.state.players[battle.state.activePlayer];
      if (player?.id === this.characterId) {
        this.autoTimer = Date.now() + 350;
        const legal = battle.legalPlays[0]; void this.command(legal ? { type: 'play', ...legal } : { type: 'end' });
      }
    }
  }
  private async api<T>(route: string, payload?: unknown): Promise<T> {
    const response = await fetch(this.apiBase + route, { method: payload === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}`, 'X-Character-Id': this.characterId },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error ?? `请求失败 ${response.status}`); return value as T;
  }
  private saveAuth() { localStorage.setItem(this.authKey, JSON.stringify({ token: this.token, characterId: this.characterId })); }
  private async boot() {
    if (!this.backdrop) { try { this.backdrop = (await this.api<{backdrop?: string}>('/api/bootstrap')).backdrop ?? ''; } catch { /* Login still provides the server error on submission. */ } }
    if (!this.token) { this.renderLogin(); return; }
    try {
      this.characters = (await this.api<{ characters: Character[] }>('/api/characters')).characters;
      if (!this.characters.some(char => char.id === this.characterId)) this.characterId = '';
      if (!this.characterId) { this.renderCharacters(); return; }
      if (!this.catalog) this.catalog = await this.api<RecoveredCatalog>('/api/catalog');
      this.audio ??= new GameAudio(this.node, this.catalog, this.apiBase + '/recovered/');
      this.state = await this.api<Snapshot>('/api/state'); this.selectedScene = Number(this.state.actor.progress.sceneId); this.saveAuth(); this.render();
    } catch (error) { this.token = ''; this.renderLogin(); this.toast(String(error)); }
  }
  private async poll() {
    if (!this.state || this.busy || this.polling || this.modal?.isValid) return;
    this.polling = true;
    try {
      const next = await this.api<Snapshot>('/api/state');
      if (next.revision !== this.state.revision) { this.state = next; this.render(); }
    } catch (error) { this.toast(String(error)); }
    finally { this.polling = false; }
  }
  private async run(action: string, payload: Record<string, unknown> = {}) {
    if (this.busy) return; this.busy = true;
    try {
      const response = await this.api<{ result: { message?: string; characterId?: string; roomId?: string; battleId?: string }; replayed: boolean }>('/api/act', {
        requestId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, action, payload });
      if (response.result.characterId) { this.characterId = response.result.characterId; this.saveAuth(); await this.boot(); }
      else { this.state = await this.api<Snapshot>('/api/state');
        if (['pve.dungeon', 'pve.enterScene', 'pve.transition'].includes(action)) this.selectedScene = Number(this.state.actor.progress.sceneId);
        if (response.result.roomId) this.page = 'rooms'; if (response.result.battleId) this.battleHidden = false; this.render(); }
      this.toast(response.result.message ?? '操作完成');
    } catch (error) { this.toast(String(error)); }
    finally { this.busy = false; }
  }
  private toast(message: string) { this.notice = message.replace(/^Error: /, ''); this.noticeUntil = Date.now() + 5500;
    if (this.noticeLabel?.isValid) { this.noticeLabel.string = this.notice; this.noticeLabel.node.setSiblingIndex(this.root.children.length - 1); } }
  private clear() {
    this.recoveredEffects?.destroy(); this.recoveredEffects = undefined;
    for (const display of this.unitDisplays.values()) display.animation.destroy(); this.unitDisplays.clear();
    for (const child of Array.from(this.root.children)) child.destroy();
    this.root.removeAllChildren(); this.ui.targets = []; this.battleLayer = undefined; this.battleHud = undefined; this.battleId = ''; this.modal = undefined;
    this.ui.panel(this.root, 'Base', 1200, 600, 0, 0, Theme.ink);
    if (this.backdrop) {
      void this.ui.image(this.root, 'OriginalBackdrop', this.apiBase + this.backdrop, 1200, 600);
      this.ui.panel(this.root, 'BackdropShade', 1200, 600, 0, 0, new Color(10, 24, 25, 175));
    }
    this.noticeLabel = this.ui.label(this.root, 'Notice', '', 0, -282, 1160, 28, 15, Theme.green);
  }
  private renderLogin() {
    this.clear(); this.ui.label(this.root, 'Title', '天墟：万象战阵', 0, 175, 700, 55, 36, Theme.gold);
    this.ui.label(this.root, 'Subtitle', '战术卡牌 · 结伴征战', 0, 124, 600, 28, 18, Theme.dim);
    const username = this.ui.input(this.root, 'Username', '账号', 0, 52);
    const password = this.ui.input(this.root, 'Password', '密码（至少6位）', 0, 0, 280, '', true);
    const auth = async (register: boolean) => {
      if (this.busy) return; this.busy = true;
      try { const result = await this.api<{ token: string }>(register ? '/api/register' : '/api/login', { username: username.string, password: password.string });
        this.token = result.token; this.characterId = ''; this.saveAuth(); await this.boot(); }
      catch (error) { this.toast(String(error)); } finally { this.busy = false; }
    };
    this.ui.button(this.root, 'Login', '登录', -76, -65, 130, 40, () => { void auth(false); });
    this.ui.button(this.root, 'Register', '注册账号', 76, -65, 130, 40, () => { void auth(true); });
    this.ui.label(this.root, 'LocalIdentity', '创建角色，整备卡组，从世界地图出发。', 0, -130, 720, 45, 16, Theme.dim);
  }
  private renderCharacters() {
    this.clear(); this.ui.label(this.root, 'Title', '选择角色', 0, 240, 600, 50, 30, Theme.gold);
    this.characters.forEach((char, index) => this.ui.button(this.root, `Character:${char.id}`,
      `${char.name} · ${PROFESSIONS[char.profession]} Lv.${char.level}`, 0, 170 - index * 50, 420, 40,
      () => { this.characterId = char.id; void this.boot(); }));
    this.ui.button(this.root, 'CreateCharacter', '创建新角色', 0, -70, 300, 40, () => this.choose('选择职业',
      [1,2,3,4].map(profession => ({ label: PROFESSIONS[profession], action: '', payload: { profession } })), item =>
        this.form(`创建${item.label}`, [{ key: 'name', label: '角色名称' }],
          payload => { void this.run('character.create', { ...payload, profession: item.payload?.profession }); })));
    this.ui.button(this.root, 'ReturnLogin', '返回登录', 0, -140, 160, 36, () => { this.token = ''; this.characterId = ''; this.saveAuth(); this.renderLogin(); });
  }
  private navigate(page: string) { this.page = page; this.listPage = 0; this.section = ''; this.battleHidden = page !== 'battle'; this.render(); }
  private render() {
    if (!this.state) return;
    this.audio?.sync(this.state.battle?.state.mapId ?? 1, this.state.actor.settings);
    if (this.state.battle && !this.battleHidden) { this.renderBattle(); return; }
    this.clear(); const actor = this.state.actor;
    this.ui.label(this.root, 'Brand', '天墟 · 万象战阵', -390, 275, 400, 35, 24, Theme.gold, true);
    const avatar = this.catalog!.assets[this.state.growth.profile.avatarAssetId ?? ''];
    if (avatar?.path) {
      const portrait = this.ui.button(this.root, 'Profile:Avatar', '', -163, 275, 32, 40, () => {
        const item = this.state!.growth.sections.flatMap(section => section.items).find(item => item.action === 'profile.update' && item.payload?.avatarAssetId !== undefined);
        if (item) this.action(item);
      });
      void this.ui.image(portrait, 'PlayerAvatar', this.apiBase + '/recovered/' + avatar.path, 28, 37);
    }
    this.ui.label(this.root, 'PlayerInfo', `${actor.name}  ${PROFESSIONS[actor.profession]} Lv.${actor.level}  |  银币 ${actor.currencies.silver}  金币 ${actor.currencies.gold}  晶石 ${actor.currencies.crystal}`, 230, 275, 700, 35, 16);
    NAV.forEach(([id, name], index) => this.ui.button(this.root, `Nav:${id}`, name, -518, 222 - index * 39, 140, 32, () => this.navigate(id), this.page === id));
    this.body = this.ui.node(this.root, 'Content', 1000, 495, 76, -5);
    if (this.page === 'home') this.renderHome();
    else if (this.page === 'world') this.renderWorld();
    else if (this.page === 'cards') this.renderCards();
    else if (this.page === 'growth') this.renderGrowth();
    else if (this.page === 'tasks') this.renderTasks();
    else if (this.page === 'social') this.renderSocial();
    else if (this.page === 'mail') this.renderMail();
    else if (this.page === 'guild') this.renderGuild();
    else if (this.page === 'trade') this.renderTrade();
    else if (this.page === 'rooms') this.renderRooms();
    else if (this.page === 'rankings') this.renderRankings();
    else if (this.page === 'settings') this.renderSettings();
  }
  private title(text: string, subtitle = '') {
    this.ui.label(this.body, 'PageTitle', text, -250, 223, 480, 34, 25, Theme.gold, true);
    if (subtitle) this.ui.label(this.body, 'PageSubtitle', subtitle, 0, 188, 970, 30, 15, Theme.dim, true);
  }
  private renderHome() {
    const state = this.state!; this.title('主城', '整备卡组，完成任务，与伙伴一同征战。');
    this.ui.label(this.body, 'Welcome', `欢迎归来，${state.actor.name}\n\n当前经验 ${state.actor.xp}  ·  已拥有 ${Object.keys(state.actor.cards).length} 种卡牌\n\n主线进度与角色成长已保存。`, 0, 75, 880, 160, 22);
    this.ui.button(this.body, 'Home:World', '世界地图', -250, -70, 180, 46, () => this.navigate('world'));
    this.ui.button(this.body, 'Home:Deck', '整备卡组', 0, -70, 180, 46, () => this.navigate('cards'));
    this.ui.button(this.body, 'Home:Tasks', '领取任务', 250, -70, 180, 46, () => this.navigate('tasks'));
    this.ui.button(this.body, 'Home:Story', '大陆往事', 300, -145, 170, 36, () => this.showStory(state.story));
    if (state.battle) this.ui.button(this.body, 'Home:Resume', state.battle.settled ? '查看战斗结算' : '继续未结束战斗', 0, -145, 320, 44, () => { this.battleHidden = false; this.render(); });
  }
  private showStory(story: string, offset = 0) {
    const pages = story.match(/[\s\S]{1,650}(?:\s|$)/g) ?? [story];
    this.info(`大陆往事 · ${offset + 1}/${pages.length}`, pages[offset] ?? '', [], undefined);
    const panel = this.modal!.getChildByName('Modal')!;
    this.ui.button(panel, 'Story:Previous', '上一页', -190, -210, 160, 36, () => this.showStory(story, offset - 1), offset === 0);
    this.ui.button(panel, 'Story:Next', '下一页', 190, -210, 160, 36, () => this.showStory(story, offset + 1), offset >= pages.length - 1);
  }
  private renderWorld() {
    const state = this.state!; this.title('世界地图');
    const scenes = state.scenes.filter(scene => scene.unlocked);
    const scene = scenes.find(scene => scene.id === `main:scene:${this.selectedScene}`) ?? scenes[0];
    if (!scene) { this.ui.label(this.body, 'EmptyScene', '暂无已解锁场景', 0, 0); return; }
    this.selectedScene = Number(scene.id.split(':').at(-1));
    this.ui.button(this.body, 'World:Scenes', `${scene.name} · 切换章节`, -245, 181, 450, 32, () => this.choose('已解锁场景', scenes.map(scene => ({
      label: scene.name, detail: `等级${scene.minLevel}`, action: '', payload: { sceneId: Number(scene.id.split(':').at(-1)) } })), item => {
        this.selectedScene = Number(item.payload?.sceneId); void this.run('pve.enterScene', { sceneId: this.selectedScene });
      }));
    this.ui.button(this.body, 'World:Dungeons', '副本选择', 295, 181, 180, 32, () => this.choose('副本与难度', state.dungeons.flatMap(row => ['easy','normal','hard'].filter(key => Number(row[key]) > 0)
      .map(key => ({ label: `${row.name} · ${{easy:'简单',normal:'普通',hard:'困难'}[key]}`, action: 'pve.dungeon', payload: { sceneId: Number(row[key]) } })))));
    const original = this.catalog?.scopes.main.scenes.find(item => item.id === scene.id);
    const background = String(original?.header.background ?? '').replaceAll('\\', '/').toLowerCase();
    const asset = Object.values(this.catalog?.assets ?? {}).find(item => String((item as unknown as Row).container ?? '').toLowerCase().endsWith(background));
    if (background && asset?.path) void this.ui.image(this.body, 'WorldArt', this.apiBase + '/recovered/' + asset.path, 960, 345, 0, -35);
    for (const [index, node] of scene.nodes.entries()) {
      if (!node.battle && !node.transitions.length) continue;
      const x = node.x / 1200 * 920 - 460; const y = 140 - node.y / 720 * 330;
      const text = `${node.cleared ? '✓ ' : node.accessible ? '' : '🔒 '}${node.name}`;
      this.ui.button(this.body, 'Node:' + node.originalId, text, x, y, 125, 46,
        () => node.transitions.length ? void this.run('pve.transition', { nodeId: node.id }) : this.openNode(node), !node.accessible);
      this.ui.label(this.body, `NodeIndex:${index}`, node.originalId, x, y - 30, 120, 18, 11, Theme.dim);
    }
  }
  private openNode(node: SceneNodeView) {
    const actions = [
      { label: '单人挑战', detail: '独自迎战当前敌军', action: 'pve.start', payload: { nodeId: node.id } },
      { label: '创建合作房间', detail: '队友加入并准备后开始', action: 'room.create', payload: { mode: 'coop', nodeId: node.id } },
    ];
    if (node.story) this.info(node.name, node.story, actions); else this.choose(node.name, actions);
    this.battleHidden = false;
  }
  private renderCards() {
    const state = this.state!; this.title('卡牌与编队', `当前卡组 ${state.actor.deck.length} 张；进入详情调整，保存后生效。`);
    this.ui.button(this.body, 'Cards:Toggle', this.cardsAll ? '只看拥有' : '查看图鉴', -270, 151, 150, 30, () => { this.cardsAll = !this.cardsAll; this.listPage = 0; this.render(); });
    this.ui.button(this.body, 'Cards:Deck', '编辑卡组', 0, 151, 150, 30, () => this.editDeck());
    this.ui.button(this.body, 'Cards:Growth', '卡牌加工', 270, 151, 150, 30, () => { this.page = 'growth'; this.section = 'cards'; this.listPage = 0; this.render(); });
    const cards = Object.values(this.catalog!.scopes.main.cards).filter(card => this.cardsAll || (state.actor.cards[card.id] ?? 0) > 0);
    const page = cards.slice(this.listPage * 12, (this.listPage + 1) * 12);
    page.forEach((card, index) => {
      const x = -365 + (index % 4) * 245; const y = 70 - Math.floor(index / 4) * 113;
      const panel = this.ui.button(this.body, 'Card:' + card.id, '', x, y, 230, 104, () => this.cardDetail(card));
      const art = this.catalog!.assets[card.art[0]];
      if (art?.path) void this.ui.image(panel, 'Portrait', this.apiBase + '/recovered/' + art.path, 57, 79, -76, 0);
      this.ui.label(panel, 'CardName', `${String(card.raw.Name)}\n持有 ${state.actor.cards[card.id] ?? 0} · 准备 ${card.raw.InitReady}`, 35, 8, 145, 65, 15);
    });
    this.pager(cards.length, 12, () => this.render());
  }
  private cardDetail(card: RecoveredCard) {
    const monster = this.catalog!.scopes.main.monsters[String(card.raw.MonsterID)];
    const skill = this.catalog!.scopes.main.skills[String(card.raw.SkillID)];
    const text = monster ? `生命 ${monster.HP} · 攻击 ${monster.Attack}\n` + [1,2,3,4,5].map(index => this.catalog!.scopes.main.effects[String(monster[`ability${index}`])]?.EffectDes ?? '').filter(Boolean).join('\n') : String(skill?.raw?.Des ?? card.raw.Des ?? '特殊英雄展示卡');
    this.info(String(card.raw.Name), text, [
      { label: '加入待保存卡组', action: '', payload: {} },
    ], () => { this.draftDeck ??= [...this.state!.actor.deck]; this.draftDeck.push(card.id); this.editDeck(); });
  }
  private editDeck() {
    this.draftDeck ??= [...this.state!.actor.deck];
    this.choose(`待保存卡组 · ${this.draftDeck.length} 张`, this.draftDeck.map((id, index) => ({ label: `${String(this.catalog!.scopes.main.cards[id.split(':').at(-1)!]?.raw.Name ?? id)} · 移除`, action: '', payload: { index } })), item => {
      this.draftDeck!.splice(Number(item.payload?.index), 1); this.editDeck();
    }, [{ label: '保存卡组', callback: () => { const cards = [...this.draftDeck!]; this.draftDeck = undefined; this.closeModal(); void this.run('deck.save', { cards }); } },
      { label: '加入已有卡牌', callback: () => this.choose('选择卡牌', Object.entries(this.state!.actor.cards).filter(([,count]) => count > 0).map(([id]) => ({
        label: String(this.catalog!.scopes.main.cards[id.split(':').at(-1)!]?.raw.Name ?? id), action: '', payload: { id } })), item => { this.draftDeck!.push(String(item.payload?.id)); this.editDeck(); }) }]);
  }
  private renderGrowth() {
    const sections = this.state!.growth.sections; const selected = sections.find(section => section.id === this.section) ?? sections[0];
    this.title(selected?.title ?? '成长');
    this.ui.button(this.body, 'Growth:Categories', '切换成长功能', 300, 222, 240, 32, () => this.choose('成长与资产', sections.map(section => ({ label: section.title, action: '', payload: { id: section.id } })), item => { this.section = String(item.payload?.id); this.listPage = 0; this.render(); }));
    if (selected) this.list(selected.items);
  }
  private renderTasks() {
    this.title('任务与引导'); const state = this.state!;
    this.list([{ label: `新手引导 ${Math.min(state.actor.tutorialStep + 1, 4)}/4`, detail: ['领取出征补给','保存一次合法卡组','完成一场战斗','取得PVE胜利'][state.actor.tutorialStep] ?? '引导已完成', action: 'tutorial.advance', disabled: state.actor.tutorialStep >= 4 },
      ...state.tasks.map(task => ({ label: `${task.name}${task.claimed ? ' · 已领取' : ''}`, detail: `${task.detail} · ${task.reward}银币`, action: 'task.claim', payload: { taskId: task.id }, disabled: !task.ready || task.claimed }))]);
  }
  private characterName(id: unknown) { return this.state?.social.people.find(person => person.id === id)?.name ?? (id === 'system' ? '系统' : String(id ?? '')); }
  private renderSocial() {
    this.title('好友与聊天'); const social = this.state!.social;
    this.ui.button(this.body, 'Social:Friend', '添加好友', -300, 176, 170, 32, () => this.action({ label: '添加好友', action: 'friend.request', fields: [{ key: 'target', label: '对方角色名称' }] }));
    this.ui.button(this.body, 'Social:WorldChat', '世界发言', -70, 176, 170, 32, () => this.action({ label: '世界发言', action: 'chat.send', payload: { channel: 'world' }, fields: [{ key: 'text', label: '消息' }] }));
    this.ui.button(this.body, 'Social:Private', '发送私聊', 160, 176, 170, 32, () => this.action({ label: '发送私聊', action: 'chat.send', payload: { channel: 'private' }, fields: [{ key: 'target', label: '对方角色名称' }, { key: 'text', label: '消息' }] }));
    const items: ActionItem[] = [
      ...social.friendRequests.filter(row => row.to === this.characterId).map(row => ({ label: `${this.characterName(row.from)}申请好友`, action: 'friend.accept', payload: { requestId: row.id } })),
      ...social.friends.map(row => ({ label: `${row.name} · Lv.${row.level}`, detail: '点击移除好友', action: 'friend.remove', payload: { target: row.id } })),
      ...social.chat.slice().reverse().map(row => ({ label: `${this.characterName(row.from)}：${row.text}`, detail: `${row.channel}`, action: '', disabled: true })),
    ]; this.list(items, 130);
  }
  private renderMail() {
    this.title('邮件'); this.ui.button(this.body, 'Mail:Send', '写信', 300, 220, 160, 32, () => this.action({ label: '写信 · 邮资1银币', action: 'mail.send', fields: [
      { key: 'target', label: '收件角色名称' }, { key: 'title', label: '标题' }, { key: 'text', label: '正文' }] }));
    this.list(this.state!.social.mail.map(mail => ({ label: `${mail.read ? '' : '● '}${mail.title}`, detail: `${this.characterName(mail.from)}：${mail.text}`,
      action: '', payload: { mail } })), 160, item => {
        const mail = item.payload!.mail as Row;
        void this.run('mail.read', { mailId: mail.id }).then(() => this.info(String(mail.title), String(mail.text) + (mail.attachment ? `\n附件：${this.goodsLabel(mail.attachment)}` : ''), [
          ...(mail.claimed ? [] : [{ label: '领取附件', action: 'mail.claim', payload: { mailId: mail.id } }]),
          { label: '删除邮件', action: 'mail.delete', payload: { mailId: mail.id }, disabled: !mail.claimed },
        ]));
      });
  }
  private renderGuild() {
    const state = this.state!; const mine = state.social.guilds.find(guild => guild.id === state.actor.guildId);
    this.title(mine ? `公会 · ${mine.name}` : '公会');
    if (!mine) {
      this.ui.button(this.body, 'Guild:Create', '创建公会 · 100银币', 280, 222, 260, 32, () => this.action({ label: '创建公会', action: 'guild.create', fields: [{ key: 'name', label: '公会名称' }] }));
      this.list(state.social.guilds.map(guild => ({ label: String(guild.name), detail: `${(guild.members as string[]).length}位成员`, action: 'guild.apply', payload: { guildId: guild.id } }))); return;
    }
    this.list([
      { label: `捐献 · 当前公会资金${mine.treasury}`, action: 'guild.donate', fields: [{ key: 'amount', label: '银币数量', type: 'number', value: 100 }] },
      { label: '公会聊天', action: 'chat.send', payload: { channel: 'guild' }, fields: [{ key: 'text', label: '消息' }] },
      { label: '升级公会生命技能', action: 'guild.upgrade', payload: { skill: 'vitality' }, disabled: mine.leader !== this.characterId },
      { label: '升级公会收入技能', action: 'guild.upgrade', payload: { skill: 'income' }, disabled: mine.leader !== this.characterId },
      ...((mine.applications as string[]) ?? []).map(id => ({ label: `接受${this.characterName(id)}入会`, action: 'guild.accept', payload: { target: id } })),
      ...((mine.members as string[]) ?? []).filter(id => id !== this.characterId).map(id => ({ label: `移交会长给${this.characterName(id)}`, action: 'guild.transfer', payload: { target: id }, disabled: mine.leader !== this.characterId })),
      { label: '城战报名与出征', detail: '选择领地，与另一公会玩家交战', action: 'local:clanwar' },
      { label: '退出公会', action: 'guild.leave' },
    ]);
  }
  private spareCards() { return Object.entries(this.state!.actor.cards).filter(([id, count]) => count > this.state!.actor.deck.filter(card => card === id).length); }
  private assetName(id: unknown) { return this.state?.assetNames[String(id)] ?? this.catalog?.scopes.main.cards[String(id).split(':').at(-1)!]?.raw.Name ?? '未知物品'; }
  private goodsLabel(goods: unknown) { const row = goods as Row | undefined; return row ? `${this.assetName(row.id)} × ${row.quantity}` : ''; }
  private renderTrade() {
    this.title('交易与拍卖');
    this.ui.button(this.body, 'Trade:Offer', '交易、拍卖与赠礼', 260, 222, 260, 32, () => this.choose('选择持有资产', [
      ...this.spareCards().map(([id]) => ({ label: `卡牌 · ${this.assetName(id)}`, action: '', payload: { kind: 'card', id, quantity: 1 } })),
      ...Object.entries(this.state!.actor.inventory).filter(([, count]) => count > 0).map(([id, count]) => ({ label: `物品 · ${this.assetName(id)} × ${count}`, action: '', payload: { kind: 'item', id, quantity: 1 } })),
    ], item => this.choose(item.label, [
      { label: '指定玩家交易', action: 'trade.offer', payload: item.payload, fields: [{ key: 'target', label: '对方角色名称' }, { key: 'price', label: '银币价格', type: 'number', value: 10 }] },
      { label: '上架拍卖', action: 'auction.list', payload: item.payload, fields: [{ key: 'price', label: '起拍银币', type: 'number', value: 10 }, { key: 'buyout', label: '一口价', type: 'number', value: 20 }] },
      { label: '邮寄给玩家', action: 'mail.send', payload: { title: '好友赠礼', text: `一份${this.assetName(item.payload?.id)}赠礼。`, attachment: item.payload }, fields: [{ key: 'target', label: '收件角色名称' }] },
    ])));
    this.list([
      ...this.state!.social.trades.filter(trade => trade.status === 'open').map(trade => ({ label: `交易 · ${this.characterName(trade.from)} → ${this.characterName(trade.to)}`, detail: `${this.goodsLabel(trade.goods)} · ${trade.price}银币`, action: trade.from === this.characterId ? 'trade.cancel' : 'trade.accept', payload: { tradeId: trade.id } })),
      ...this.state!.social.auctions.filter(auction => auction.status === 'open').map(auction => ({ label: `拍卖 · ${this.characterName(auction.seller)}`, detail: `${this.goodsLabel(auction.goods)} · 当前 ${auction.bid || auction.minimum} · 一口价${auction.buyout}`, action: '', payload: { auctionId: auction.id, auction } })),
    ], 160, item => {
      if (item.action) { this.action(item); return; }
      const auction = item.payload?.auction as Row;
      this.choose('拍卖操作', auction.seller === this.characterId ? [{ label: '撤回拍卖', action: 'auction.cancel', payload: { auctionId: auction.id } }] : [
        { label: '参与竞价', action: 'auction.bid', payload: { auctionId: auction.id }, fields: [{ key: 'amount', label: '竞价银币', type: 'number', value: Math.max(Number(auction.minimum), Number(auction.bid) + 1) }] },
        { label: `一口价 ${auction.buyout}`, action: 'auction.buy', payload: { auctionId: auction.id } },
      ]);
    });
  }
  private renderRooms() {
    this.title('合作与竞技', '组队挑战副本，或在竞技场与天梯切磋。');
    this.ui.button(this.body, 'Room:Pvp', '创建竞技房间', -260, 151, 230, 36, () => this.choose('选择竞技人数', [1, 2, 4].map(teamSize => ({ label: `${teamSize}对${teamSize} · ${teamSize * 2}位真实玩家`, action: 'room.create', payload: { mode: 'pvp', teamSize } }))));
    this.ui.button(this.body, 'Room:Ranked', '创建天梯房间', 20, 151, 230, 36, () => { void this.run('room.create', { mode: 'ranked' }); });
    this.ui.button(this.body, 'Room:Tournament', '竞技赛', 300, 205, 150, 30, () => { this.page = 'growth'; this.section = 'tournament'; this.listPage = 0; this.render(); });
    this.ui.button(this.body, 'Room:Coop', '选择关卡合作', 300, 151, 230, 36, () => this.navigate('world'));
    this.list([...(this.state!.roomInvites ?? []).map(invite => ({ label: `${this.characterName(invite.from)} 邀请你加入房间`, action: 'room.join', payload: { roomId: invite.roomId } })), ...this.state!.rooms.map(room => ({ label: `${{coop:'合作PVE',pvp:'竞技场',ranked:'天梯','clan-war':'公会城战',tournament:'竞技赛'}[String(room.mode)] ?? room.mode} · ${this.characterName(room.host)}`,
      detail: `${(room.members as string[]).length}/${room.capacity ?? 2} · 已准备 ${(room.members as string[]).filter(id => (room.ready as Record<string, boolean>)?.[id]).length}人 · ${room.status === 'waiting' ? '等待中' : room.status === 'battle' ? '战斗中' : '已结算'} · ${(room.members as string[]).map(id => this.characterName(id)).join(' / ')}`, action: '', payload: { room } }))], 95, item => {
      if (item.action) { this.action(item); return; }
      const room = item.payload?.room as Row; const members = room.members as string[];
      if (room.status !== 'waiting') { this.battleHidden = false; this.render(); return; }
      if (!members.includes(this.characterId)) { void this.run('room.join', { roomId: room.id }); return; }
      this.choose('房间操作', [
        { label: '邀请玩家', action: 'room.invite', payload: { roomId: room.id }, fields: [{ key: 'target', label: '角色名称' }] },
        { label: '准备', action: 'room.ready', payload: { roomId: room.id, ready: true } },
        { label: '开始战斗', action: 'room.start', payload: { roomId: room.id }, disabled: room.host !== this.characterId },
        { label: '离开房间', action: 'room.leave', payload: { roomId: room.id } },
      ]); this.battleHidden = false;
    });
  }
  private renderRankings() { this.title('天梯排行', '每场天梯对战都会影响赛季积分。'); this.list(this.state!.rankings.map((row, index) => ({ label: `${index + 1}. ${row.name}`, detail: `${row.rating}分 · ${row.wins}胜 ${row.losses}负 · Lv.${row.level}`, action: '', disabled: true }))); }
  private renderSettings() {
    this.title('系统设置'); this.list([
      ...['music','sound','rejectPrivate','rejectInvites'].map(key => ({ label: `${{music:'音乐',sound:'音效',rejectPrivate:'拒绝私聊',rejectInvites:'拒绝邀请'}[key]}：${this.state!.actor.settings[key] ? '开启' : '关闭'}`,
        action: 'settings.save', payload: { [key]: !this.state!.actor.settings[key] } })),
      { label: '切换角色', action: 'local:characters' }, { label: '退出登录', action: 'local:logout' },
    ]);
  }
  private list(items: ActionItem[], startY = 140, onClick?: (item: ActionItem) => void) {
    const page = items.slice(this.listPage * 6, (this.listPage + 1) * 6);
    if (!page.length) this.ui.label(this.body, 'Empty', '当前没有记录', 0, 0, 700, 45, 20, Theme.dim);
    page.forEach((item, index) => {
      const node = this.ui.button(this.body, 'Action:' + item.action + ':' + index, '', 0, startY - index * 61, 960, 54,
        () => onClick ? onClick(item) : this.action(item), item.disabled);
      this.ui.label(node, 'Label', item.label, -5, item.detail ? 11 : 0, 920, 26, 17, item.disabled ? Theme.dim : Theme.text, true);
      if (item.detail) this.ui.label(node, 'Detail', item.detail, -5, -14, 920, 21, 13, Theme.dim, true);
    }); this.pager(items.length, 6, () => this.render());
  }
  private pager(length: number, count: number, render: () => void) {
    const pages = Math.max(1, Math.ceil(length / count)); this.listPage = Math.max(0, Math.min(this.listPage, pages - 1));
    this.ui.button(this.body, 'PreviousPage', '上一页', -145, -230, 125, 30, () => { this.listPage--; render(); }, this.listPage === 0);
    this.ui.label(this.body, 'PageNumber', `${this.listPage + 1}/${pages}`, 0, -230, 100, 28, 15, Theme.dim);
    this.ui.button(this.body, 'NextPage', '下一页', 145, -230, 125, 30, () => { this.listPage++; render(); }, this.listPage >= pages - 1);
  }
  private action(item: ActionItem) {
    if (item.disabled) return;
    if (item.action === 'local:clanwar') { this.closeModal(); this.page = 'growth'; this.section = 'clan-war'; this.listPage = 0; this.render(); return; }
    if (item.action === 'local:characters') { this.characterId = ''; this.state = undefined; this.renderCharacters(); return; }
    if (item.action === 'local:logout') { void this.api('/api/logout', {}).finally(() => { this.token = ''; this.characterId = ''; this.state = undefined; this.saveAuth(); this.renderLogin(); }); return; }
    if (!item.action) return;
    const selection = item.fields?.find(field => field.type === 'card-multiselect');
    if (selection) { this.selectDraft(item, selection, Array.isArray(selection.value) ? selection.value.map(String) : []); return; }
    const dropdown = item.fields?.find(field => field.type === 'select');
    if (dropdown) {
      this.choose(`${item.label} · ${dropdown.label}`, (dropdown.options ?? []).map(option => ({ label: option.label, action: '', payload: { value: option.value } })), option =>
        this.action({ ...item, payload: { ...item.payload, [dropdown.key]: option.payload?.value }, fields: item.fields?.filter(field => field !== dropdown) }));
      return;
    }
    if (item.fields?.length) this.form(item.label, item.fields, payload => { void this.run(item.action, { ...item.payload, ...payload }); });
    else { this.closeModal(); void this.run(item.action, item.payload); }
  }
  private selectDraft(item: ActionItem, field: FormField, selected: string[], offset = 0) {
    const panel = this.modalBase(`${item.label} · ${selected.length}/${field.max ?? 10}`);
    const options = field.options ?? [];
    options.slice(offset, offset + 6).forEach((option, index) => this.ui.button(panel, 'DraftCard:' + index, `${selected.includes(option.value) ? '✓ ' : ''}${option.label}`, 0, 160 - index * 54, 790, 43, () => {
      const next = selected.includes(option.value) ? selected.filter(id => id !== option.value) : selected.length < (field.max ?? 10) ? [...selected, option.value] : selected;
      this.selectDraft(item, field, next, offset);
    }));
    this.ui.button(panel, 'DraftPrevious', '上一页', -270, -180, 130, 32, () => this.selectDraft(item, field, selected, Math.max(0, offset - 6)), offset === 0);
    this.ui.button(panel, 'DraftNext', '下一页', 270, -180, 130, 32, () => this.selectDraft(item, field, selected, offset + 6), offset + 6 >= options.length);
    this.ui.button(panel, 'DraftSave', '保存竞技赛卡组', 0, -225, 300, 32, () => { this.closeModal(); void this.run(item.action, { ...item.payload, [field.key]: selected }); }, selected.length !== (field.min ?? 10));
  }
  private closeModal() { if (this.modal?.isValid) this.modal.destroy(); this.modal = undefined; }
  private modalBase(title: string) {
    this.closeModal(); this.modal = this.ui.panel(this.root, 'ModalShade', 1200, 600, 0, 0, new Color(0, 0, 0, 205));
    const panel = this.ui.panel(this.modal, 'Modal', 880, 515, 50, 0, Theme.panel, Theme.gold);
    this.ui.label(panel, 'Title', title, 0, 225, 760, 35, 24, Theme.gold);
    this.ui.button(panel, 'CloseModal', '关闭', 350, 225, 85, 29, () => this.closeModal()); return panel;
  }
  private form(title: string, fields: FormField[], callback: (payload: Record<string, unknown>) => void) {
    const panel = this.modalBase(title); const boxes: { field: FormField; box: EditBox }[] = [];
    fields.forEach((field, index) => {
      this.ui.label(panel, 'FieldLabel:' + field.key, field.label, -235, 145 - index * 72, 320, 32, 16, Theme.dim, true);
      boxes.push({ field, box: this.ui.input(panel, 'Field:' + field.key, field.label, 160, 145 - index * 72, 360, String(field.value ?? '')) });
    });
    this.ui.button(panel, 'SubmitForm', '确认', 0, -210, 180, 38, () => {
      const payload = Object.fromEntries(boxes.map(({ field, box }) => [field.key, field.type === 'number' ? Number(box.string) : box.string]));
      this.closeModal(); callback(payload);
    });
  }
  private choose(title: string, items: ActionItem[], callback?: (item: ActionItem) => void, extra: {label: string; callback: () => void}[] = [], offset = 0) {
    const panel = this.modalBase(title); const page = items.slice(offset, offset + 6);
    if (!page.length) this.ui.label(panel, 'ModalEmpty', '当前没有可选记录', 0, 30, 700, 60, 19, Theme.dim);
    page.forEach((item, index) => this.ui.button(panel, 'Choice:' + index, item.detail ? `${item.label}  ·  ${item.detail}` : item.label,
      0, 160 - index * 54, 790, 43, () => { this.closeModal(); callback ? callback(item) : this.action(item); }, item.disabled));
    if (items.length > 6) {
      this.ui.button(panel, 'ChoicePrev', '上一页', -230, -180, 130, 32, () => this.choose(title, items, callback, extra, Math.max(0, offset - 6)), offset === 0);
      this.ui.button(panel, 'ChoiceNext', '下一页', 230, -180, 130, 32, () => this.choose(title, items, callback, extra, offset + 6), offset + 6 >= items.length);
    }
    extra.forEach((button, index) => this.ui.button(panel, 'ChoiceExtra:' + index, button.label, -170 + index * 340, -225, 300, 32, button.callback));
  }
  private info(title: string, text: string, actions: ActionItem[] = [], callback?: () => void) {
    const panel = this.modalBase(title); this.ui.label(panel, 'Information', text.replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<[^>]*>/g, ''), 0, 5, 770, 340, 19, Theme.text, true);
    actions.forEach((item, index) => this.ui.button(panel, 'InfoAction:' + index, item.label, (index - (actions.length - 1) / 2) * Math.min(340, 780 / actions.length), -210, Math.min(300, 750 / actions.length), 36, () => callback ? callback() : this.action(item), item.disabled));
  }
  private async command(action: BattleAction) {
    const battle = this.state?.battle; if (!battle || this.busy) return;
    const hand = battle.state.players.find(player => player.id === this.characterId)?.hand ?? [];
    const index = action.type === 'play' ? hand.findIndex(card => card.instanceId === action.instanceId) : -1;
    const card = index >= 0 ? hand[index] : undefined; const previousSeq = battle.state.events.at(-1)?.seq ?? 0;
    this.selectedHand = ''; await this.run('battle.command', { battleId: battle.id, revision: battle.state.revision, action });
    if (action.type === 'play' && card && this.state?.battle?.id === battle.id && this.state.battle.state.events.some(event =>
      event.seq > previousSeq && event.type === 'play' && event.actor === this.characterId && event.cardId === card.cardId)) {
      void this.flyCard(card.cardId, index, action.row, action.col);
    }
  }
  private async flyCard(cardId: string, index: number, row: number, col: number) {
    const state = this.state?.battle?.state; if (!state || !this.root.isValid) return;
    const card = this.catalog!.scopes.main.cards[cardId.split(':').at(-1)!]; const art = this.catalog!.assets[card?.art[0]];
    if (!art?.path) return;
    const layout = this.catalog!.scopes.main.maps[String(state.mapId)]?.layoutRows.find(value => value._tag === 'map');
    const tw = Number(layout?.tilewidth ?? 90), th = Number(layout?.tileheight ?? 95);
    const destination = new Vec3((1200 - state.columns * tw) / 2 + (col + .5) * tw - 600, 300 - (45 + (row + .5) * th), 0);
    const flight = this.ui.panel(this.root, 'CardFlight', 85, 116, -350 + index * 89, -207, Theme.panel, Theme.gold);
    await this.ui.image(flight, 'FlightPortrait', this.apiBase + '/recovered/' + art.path, 75, 100);
    if (!flight.isValid) return;
    const duration = .38 / this.speed; this.nextEventAt = Math.max(this.nextEventAt, Date.now() + duration * 1000);
    tween(flight).to(duration, { position: destination, scale: new Vec3(.65, .65, 1) }, { easing: 'quadOut' })
      .call(() => { if (flight.isValid) flight.destroy(); }).start();
  }
  private renderBattle() {
    const battle = this.state!.battle!; const state = battle.state;
    if (!this.battleLayer?.isValid || this.battleId !== battle.id) {
      this.recoveredEffects?.destroy(); this.recoveredEffects = undefined;
      this.clear(); this.lastUnitCells.clear(); this.battleId = battle.id; this.eventSeq = 0; this.animationQueue = [];
      this.battleLayer = this.ui.node(this.root, 'BattleScene', 1200, 600);
      const map = this.catalog!.scopes.main.maps[String(state.mapId)]; const art = this.catalog!.assets[map?.background_asset_ids[0]];
      if (art?.path) void this.ui.image(this.battleLayer, 'MapBackground', this.apiBase + '/recovered/' + art.path, 1200, 600);
      this.recoveredEffects = new RecoveredEffects(this.battleLayer, this.catalog!, this.apiBase + '/recovered/');
    }
    const map = this.catalog!.scopes.main.maps[String(state.mapId)]; const raw = map?.layoutRows.find(row => row._tag === 'map');
    const tw = Number(raw?.tilewidth ?? 90); const th = Number(raw?.tileheight ?? 95);
    const xy = (row: number, col: number) => ({ x: (1200 - state.columns * tw) / 2 + (col + .5) * tw - 600, y: 300 - (45 + (row + .5) * th) });
    for (const unit of state.units) {
      this.lastUnitCells.set(unit.id, { row: unit.row, col: unit.col, team: unit.team });
      if (unit.hp <= 0) continue; let display = this.unitDisplays.get(unit.id);
      const position = xy(unit.row, unit.col);
      if (!display) {
        const node = this.ui.node(this.battleLayer!, 'Unit:' + unit.id, 100, 120, position.x, position.y - 28);
        const visual = this.ui.node(node, 'Visual', 170, 170, 0, 0);
        const animation = new RecoveredAnimation(visual, this.catalog!, this.apiBase + '/recovered/');
        const owner = state.players.find(player => player.id === unit.playerId)!;
        const loaded = unit.flags.hero === 1 && !unit.monsterId ? animation.setActor(owner.profession ?? 1, owner.sex ?? 1) : animation.setMonster(unit.monsterId);
        void loaded.then(() => {
          if (node.isValid && this.unitDisplays.get(unit.id)?.node === node) animation.play('stand', unit.team === 0 ? 'east' : 'west');
        }).catch(error => this.toast(String(error)));
        display = { node, animation, monsterId: unit.monsterId, team: unit.team,
          name: this.ui.label(node, 'UnitName', unit.flags.hero ? owner.name : String(this.catalog!.scopes.main.monsters[String(unit.monsterId)]?.Name ?? ''), 0, 57, 130, 22, 12, unit.team === 0 ? Theme.green : Theme.red),
          hp: this.ui.label(node, 'Health', `${unit.hp}/${unit.maxHp}`, 0, 38, 100, 20, 13, Theme.text) };
        this.unitDisplays.set(unit.id, display);
      } else {
        if (Math.abs(display.node.position.x - position.x) > 1 || Math.abs(display.node.position.y - (position.y - 28)) > 1) {
          display.animation.play('walk', unit.team === 0 ? 'east' : 'west');
          tween(display.node).to(.25 / this.speed, { position: new Vec3(position.x, position.y - 28, 0) }).call(() => display?.animation.play('stand', unit.team === 0 ? 'east' : 'west')).start();
        }
        display.hp.string = `${unit.hp}/${unit.maxHp}`;
      }
    }
    for (const [id, display] of this.unitDisplays) if (!state.units.some(unit => unit.id === id && unit.hp > 0)) {
      display.hp.string = display.hp.string.replace(/^\d+\//, '0/');
      this.unitDisplays.delete(id);
      display.animation.play('die', display.team === 0 ? 'east' : 'west');
      setTimeout(() => { if (display.node.isValid) { display.animation.destroy(); display.node.destroy(); } }, 400 / this.speed);
    }
    const events = state.events.filter(event => event.seq > this.eventSeq);
    for (const event of events) if (event.type === 'death' && event.actor && event.row !== undefined && event.col !== undefined) {
      this.lastUnitCells.set(event.actor, { row: event.row, col: event.col, team: this.lastUnitCells.get(event.actor)?.team ?? 0 });
    }
    if (this.eventSeq > 0) this.animationQueue.push(...events.filter(event => ['play','attack','damage','death','status','skill','effect'].includes(event.type)));
    this.eventSeq = state.events.at(-1)?.seq ?? 0;
    if (this.battleHud?.isValid) this.battleHud.destroy(); this.ui.targets = [];
    this.battleHud = this.ui.node(this.root, 'BattleHud', 1200, 600);
    this.ui.panel(this.battleHud, 'Header', 1200, 40, 0, 280, new Color(12, 25, 27, 235));
    const active = state.players[state.activePlayer];
    this.ui.label(this.battleHud, 'Turn', `回合 ${state.turn} · ${battle.settled ? '已结束' : active?.name + '行动'}`, -210, 281, 700, 30, 18, Theme.gold);
    this.ui.button(this.battleHud, 'Battle:Log', '战报', 380, 280, 80, 28, () => this.info('战报', state.events.slice(-35).map(event => `${event.seq} ${event.type} ${event.amount ?? ''}`).join('\n')));
    this.ui.button(this.battleHud, 'Battle:Menu', '菜单', 520, 280, 95, 28, () => this.choose('战斗菜单', [
      { label: '稍后继续', action: 'local:battleHide' }, { label: '认输退出', action: 'battle.command', payload: { battleId: battle.id, revision: state.revision, action: { type: 'surrender' } } },
    ], item => { if (item.action === 'local:battleHide') { this.battleHidden = true; this.page = 'home'; this.render(); } else this.action(item); }));
    this.ui.panel(this.battleHud, 'HandBase', 1200, 151, 0, -224, new Color(12, 25, 27, 240));
    const me = state.players.find(player => player.id === this.characterId)!;
    me.hand.forEach((hand, index) => {
      const card = this.catalog!.scopes.main.cards[hand.cardId.split(':').at(-1)!]; if (!card) return;
      const x = -350 + index * 89; const selected = this.selectedHand === hand.instanceId;
      const box = this.ui.button(this.battleHud!, 'Hand:' + index, '', x, -222 + (selected ? 15 : 0), 85, 116, () => { this.selectedHand = selected ? '' : hand.instanceId; this.renderBattle(); }, hand.wait > 0 || active?.id !== me.id);
      const art = this.catalog!.assets[card.art[0]];
      if (art?.path) void this.ui.image(box, 'HandPortrait', this.apiBase + '/recovered/' + art.path, 75, 88, 0, 6);
      this.ui.label(box, 'Countdown', hand.wait > 0 ? `准备 ${hand.wait}` : '可出牌', 0, 45, 80, 22, 13, hand.wait > 0 ? Theme.gold : Theme.green);
      this.ui.label(box, 'HandName', String(card.raw.Name), 0, -42, 80, 30, 13, Theme.text);
    });
    this.ui.label(this.battleHud, 'DeckCount', `牌库 ${me.drawPile.length}\n墓地 ${me.graveyard.length}`, -510, -224, 145, 70, 18, Theme.dim);
    this.ui.button(this.battleHud, 'Battle:End', '结束回合', 440, -210, 220, 44, () => { void this.command({ type: 'end' }); }, battle.settled || active?.id !== this.characterId);
    this.ui.button(this.battleHud, 'Battle:Auto', this.autoplay ? '托管：开' : '托管：关', 395, -265, 125, 32, () => { this.autoplay = !this.autoplay; this.renderBattle(); }, battle.settled);
    this.ui.button(this.battleHud, 'Battle:Speed', `${this.speed}倍速`, 520, -265, 100, 32, () => { this.speed = this.speed === 1 ? 2 : 1; this.renderBattle(); });
    for (const [index, play] of battle.legalPlays.filter(play => play.instanceId === this.selectedHand).entries()) {
      const position = xy(play.row, play.col);
      this.ui.button(this.battleHud, 'Legal:' + index, play.targetId ? '目标' : '部署', position.x, position.y, tw - 8, th - 8,
        () => { void this.command({ type: 'play', ...play }); }, false, true);
    }
    if (battle.settled) {
      const outcome = battle.rewards; const panel = this.ui.panel(this.battleHud, 'Result', 620, 225, 0, 10, Theme.panel, Theme.gold);
      this.ui.label(panel, 'Outcome', state.winner === null ? '平局' : outcome?.won ? '胜利' : '战败', 0, 65, 500, 45, 34, outcome?.won ? Theme.gold : Theme.red);
      this.ui.label(panel, 'Rewards', `银币 +${outcome?.silver ?? 0}  ·  经验 +${outcome?.xp ?? 0}\n${outcome?.cards?.map(card => `${this.catalog!.scopes.main.cards[card.id.split(':').at(-1)!]?.raw.Name} ×${card.count}`).join('  ') ?? ''}`, 0, 2, 560, 65, 20);
      this.ui.button(panel, 'Battle:Dismiss', '保存结算并返回', 0, -68, 280, 40, () => { this.battleHidden = true; this.page = 'world'; void this.run('battle.dismiss', { battleId: battle.id }); });
    }
  }
  private playEvent(event: BattleEvent) {
    if ((event.type === 'play' && event.skillId !== undefined) || event.type === 'attack') {
      const state = this.state?.battle?.state;
      const target = event.row !== undefined && event.col !== undefined ? { row: event.row, col: event.col } : this.lastUnitCells.get(event.target ?? event.actor ?? '');
      const caster = this.lastUnitCells.get(event.actor ?? '') ?? this.lastUnitCells.get('hero:' + event.actor);
      if (target && state) {
        const layout = this.catalog!.scopes.main.maps[String(state.mapId)]?.layoutRows.find(row => row._tag === 'map');
        const tw = Number(layout?.tilewidth ?? 90), th = Number(layout?.tileheight ?? 95);
        this.recoveredEffects?.play(event.skillId ?? 0, (1200 - state.columns * tw) / 2 + (target.col + .5) * tw - 600,
          300 - (45 + (target.row + .5) * th), caster?.team === 1 ? 'west' : 'east');
      }
      if (event.type !== 'attack') this.audio?.shot(event.skillId ?? 0);
    }
    if (event.type === 'attack') {
      this.audio?.shot(event.skillId ?? 0);
      const actor = event.actor ? this.unitDisplays.get(event.actor) : undefined;
      const unit = this.state?.battle?.state.units.find(unit => unit.id === event.actor);
      actor?.animation.play('atk', unit?.team === 1 ? 'west' : 'east', () => {
        const target = event.target ? this.unitDisplays.get(event.target) : undefined;
        if (target) { target.hp.color = Theme.red; setTimeout(() => { if (target.hp.isValid) target.hp.color = Theme.text; }, 180); }
      });
    }
    if (event.type === 'damage' || event.type === 'status') {
      const display = event.target ? this.unitDisplays.get(event.target) : undefined;
      display?.animation.play('hit', display.team === 0 ? 'east' : 'west');
    }
  }
}
