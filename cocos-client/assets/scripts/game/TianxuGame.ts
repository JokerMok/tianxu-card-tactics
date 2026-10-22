import { Component, Node, Label, EditBox, Color, UITransform, view, screen, Size, ResolutionPolicy, profiler, Button, BlockInputEvents } from 'cc';
import { CocosUi, Theme } from './CocosUi.ts';
import { GameAudio } from './GameAudio.ts';
import type { RecoveredCatalog, RecoveredCard } from './RecoveredContent.ts';
import type { BattleState, LegalPlay, BattleAction } from './GameContracts.ts';
import { OriginalUi, type OriginalUiCatalog, type OriginalUiMount } from './OriginalUi.ts';
import { BattleSceneView } from './BattleSceneView.ts';
import { cardName, cardDisplay } from './GameText.ts';
import { CardDeckWindow } from './CardDeckWindow.ts';
import { GrowthWindows } from './GrowthWindows.ts';
import { WorldMapWindow } from './WorldMapWindow.ts';
import { SecondaryWindows } from './SecondaryWindows.ts';

interface FormField { key: string; label: string; type?: string; value?: unknown; min?: number; max?: number; options?: {label: string; value: string}[] }
interface ActionItem { label: string; detail?: string; action: string; payload?: Record<string, unknown>; disabled?: boolean; fields?: FormField[] }
interface Section { id: string; title: string; items: ActionItem[] }
interface SceneNodeView { id: string; originalId: string; name: string; story?: string; x: number; y: number; cleared: boolean; accessible: boolean;
  battle: boolean; transitions: number[]; triggers: { id: string; name: string; repeat: number }[] }
interface SceneView { id: string; name: string; unlocked: boolean; minLevel: number; nodes: SceneNodeView[] }
interface ActorView { id: string; name: string; profession: number; level: number; xp: number; tutorialStep: number;
  currencies: { silver: number; gold: number; crystal: number }; cards: Record<string, number>; deck: string[]; deckCapacity: number;
  inventory: Record<string, number>; progress: { sceneId: number }; guildId?: string; settings: Record<string, boolean> }
type Row = Record<string, unknown>;
interface Snapshot { assetNames: Record<string, string>; story: string; revision: number; now: number; actor: ActorView; scenes: SceneView[];
  tasks: { id: string; name: string; detail: string; ready: boolean; claimed: boolean; reward: number }[];
  growth: { profile: { avatarAssetId: string | null }; summary: {energy: number}; sections: Section[] }; social: { people: Row[]; friends: Row[]; friendRequests: Row[]; chat: Row[]; mail: Row[]; guilds: Row[]; trades: Row[]; auctions: Row[] };
  rooms: Row[]; roomInvites: Row[]; rankings: Row[]; dungeons: Row[];
  battle: { id: string; mode: string; state: BattleState; entryState?: BattleState; settled: boolean; rewards?: { won: boolean; silver: number; xp: number; cards: {id: string; count: number}[] }; legalPlays: LegalPlay[] } | null }
interface Character { id: string; name: string; level: number; profession: number }
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
  private battleId = ''; private entryReplayBattleId = ''; private apiBase = '';
  private authKey = AUTH_KEY; private backdrop = ''; private audio?: GameAudio;
  private original?: OriginalUi; private home?: OriginalUiMount; private renderGeneration = 0;
  private battleView?: BattleSceneView; private deckWindow?: CardDeckWindow; private growthWindows?: GrowthWindows;
  private worldWindow?: WorldMapWindow; private debugUi = false;
  private secondaryWindows?: SecondaryWindows;

  private viewportObserver?: ResizeObserver; private viewportKey='';
  private syncViewport=()=>{
    if(typeof window==='undefined')return;const width=window.innerWidth,height=window.innerHeight,dpr=Math.min(window.devicePixelRatio||1,2),key=width+':'+height+':'+dpr;
    if(width<=0||height<=0||key===this.viewportKey)return;this.viewportKey=key;screen.windowSize=new Size(width*dpr,height*dpr);
  };
  onLoad() {
    view.setDesignResolutionSize(1200, 600, ResolutionPolicy.SHOW_ALL);
    view.resizeWithBrowserSize(true);
    // CSS-sized SubFrame containers do not change inline styles on resize; notify the public screen API explicitly.
    if(typeof ResizeObserver!=='undefined'){this.viewportObserver=new ResizeObserver(this.syncViewport);this.viewportObserver.observe(document.documentElement);}
    globalThis.addEventListener('resize',this.syncViewport);
    profiler.hideStats();
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    this.debugUi = params.get('debug') === '1';
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
    this.viewportObserver?.disconnect();globalThis.removeEventListener('resize',this.syncViewport);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.deckWindow?.destroy(); this.audio?.destroy(); this.battleView?.destroy(); this.growthWindows?.destroy(); this.secondaryWindows?.destroy();
  }
  update(dt: number) {
    this.battleView?.update(dt);
    this.growthWindows?.update(dt); this.secondaryWindows?.update(dt);
    if (this.noticeLabel?.isValid) this.noticeLabel.string = Date.now() < this.noticeUntil ? this.notice : '';
    if ((this.battleView?.autoplay ?? this.autoplay) && !this.battleView?.locked && this.state?.battle && !this.state.battle.settled && !this.busy && Date.now() > this.autoTimer) {
      const battle = this.state.battle; const player = battle.state.players[battle.state.activePlayer];
      if (player?.id === this.characterId) {
        this.autoTimer = Date.now() + 350;
        const legal = battle.legalPlays[0]; void this.command(legal ? { type: 'play', ...legal } : { type: 'end' });
      }
    }
  }
  private async api<T>(route: string, payload?: unknown, characterId = this.characterId): Promise<T> {
    const response = await fetch(this.apiBase + route, { method: payload === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}`, 'X-Character-Id': characterId },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    const value = await response.json(); if (!response.ok) { const error = new Error(value.error ?? `请求失败 ${response.status}`) as Error & {definitive:boolean}; error.definitive=response.status>=400&&response.status<500; throw error; } return value as T;
  }
  private saveAuth() { localStorage.setItem(this.authKey, JSON.stringify({ token: this.token, characterId: this.characterId })); }
  private async boot() {
    this.entryReplayBattleId = '';
    if (!this.backdrop) { try { this.backdrop = (await this.api<{backdrop?: string}>('/api/bootstrap')).backdrop ?? ''; } catch { /* Login still provides the server error on submission. */ } }
    if (!this.original) {
      const response = await fetch(this.apiBase + '/recovered/original-ui.json', { cache: 'no-store' });
      if (!response.ok) { this.renderLogin(); this.toast('原版界面资源未导入，请导入界面资源后重启'); return; }
      this.original = new OriginalUi(await response.json() as OriginalUiCatalog, this.apiBase + '/recovered/');
      this.ui.configureOriginal(this.original, this.apiBase + '/recovered/');
    }
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
      const actorId=this.characterId;const next = await this.api<Snapshot>('/api/state',undefined,actorId);
      if(actorId!==this.characterId||!this.state)return;
      if (next.revision > this.state.revision) {
        if (next.battle && next.battle.id !== this.state.battle?.id) {
          this.battleHidden = false;
          this.entryReplayBattleId = next.battle.id;
        }
        this.state = next;
        if (this.original && !this.debugUi && this.page === 'rooms' && this.body?.isValid
            && (!next.battle || this.battleHidden)) this.renderModuleWindow();
        else if(this.page==='cards'&&this.body?.isValid&&this.deckWindow&&(!next.battle||this.battleHidden))this.deckWindow.updateActor(next.actor);
        else this.render();
      }
    } catch (error) { this.toast(String(error)); }
    finally { this.polling = false; }
  }
  private async run(action: string, payload: Record<string, unknown> = {}) {
    if (this.busy) return; this.busy = true;
    const previousBattleId = this.state?.battle?.id;
    try {
      const response = await this.api<{ result: { message?: string; characterId?: string; roomId?: string; battleId?: string }; replayed: boolean }>('/api/act', {
        requestId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, action, payload });
      if (response.result.characterId) { this.characterId = response.result.characterId; this.saveAuth(); await this.boot(); }
      else { this.state = await this.api<Snapshot>('/api/state');
        if (['pve.dungeon', 'pve.enterScene', 'pve.transition'].includes(action)) this.selectedScene = Number(this.state.actor.progress.sceneId);
        if (response.result.roomId) this.page = 'rooms';
        if (response.result.battleId) {
          this.battleHidden = false;
          if (response.result.battleId !== previousBattleId && this.state.battle?.id === response.result.battleId)
            this.entryReplayBattleId = response.result.battleId;
        }
        this.render(); }
      this.toast(response.result.message ?? '操作完成');
    } catch (error) { this.toast(String(error)); }
    finally { this.busy = false; }
  }
  private async saveDeck(cards:string[],requestId:string,actorId:string):Promise<string[]> {
    const response=await this.api<{result:{cards:string[]};revision:number;replayed:boolean}>('/api/act',{action:'deck.save',payload:{cards},requestId},actorId);
    if(!Array.isArray(response.result.cards))throw new Error('保存响应缺少确认卡组，请重试确认');
    if(this.state?.actor.id===actorId){this.state.actor.deck=[...response.result.cards];this.state.revision=Math.max(this.state.revision,response.revision);}
    return response.result.cards;
  }
  private toast(message: string) { this.notice = /Failed to fetch|NetworkError|Load failed/i.test(message)?'网络连接中断，请稍后重试。':message.replace(/^Error: /, ''); this.noticeUntil = Date.now() + 5500;
    if (this.noticeLabel?.isValid) { this.noticeLabel.string = this.notice; this.noticeLabel.node.setSiblingIndex(this.root.children.length - 1); } }
  private clear() {
    this.renderGeneration++; this.home = undefined; this.deckWindow?.detach();
    this.growthWindows?.destroy(); this.secondaryWindows?.destroy();
    this.battleView?.destroy(); this.battleView = undefined;

    for (const child of Array.from(this.root.children)) child.destroy();
    this.root.removeAllChildren(); this.ui.targets = []; this.battleId = ''; this.modal = undefined;
    this.ui.panel(this.root, 'Base', 1200, 600, 0, 0, Theme.ink);
    if (this.backdrop) {
      void this.ui.image(this.root, 'OriginalBackdrop', this.apiBase + this.backdrop, 1200, 600);
      this.ui.panel(this.root, 'BackdropShade', 1200, 600, 0, 0, new Color(10, 24, 25, 175));
    }
    this.noticeLabel = this.ui.label(this.root, 'Notice', '', 0, -282, 1160, 28, 15, Theme.green);
  }
  private renderLogin() {
    if (this.original?.catalog.fairygui.aliases['Login/LoginWnd'] && !this.debugUi) { this.renderOriginalLogin(); return; }
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
  private sourceInput(mount: OriginalUiMount, name: string, placeholder: string, password = false): EditBox {
    const parent = mount.requireChild(name); const size = parent.getComponent(UITransform)!.contentSize;
    const title = parent.getChildByName('title'); if (title) title.active = false;
    return this.ui.input(parent, 'LiveInput:' + name, placeholder, size.width / 2, -size.height / 2, size.width, '', password, size.height, true);
  }
  private renderOriginalLogin() {
    this.clear(); const generation = this.renderGeneration;
    void this.original!.mount('Login/LoginWnd', this.root).then(async login => {
      if (generation !== this.renderGeneration) return; login.node.setPosition(-600, 300);
      await login.setController('debug', '0'); await login.setController('loginState', '0');
      if (generation !== this.renderGeneration) return;
      login.setVisible('txt_clearSite', false);
      const username = this.sourceInput(login, 'textUserName', '本机账号');
      const password = this.sourceInput(login, 'textPassword', '密码（至少6位）', true);
      const auth = async (register: boolean) => {
        if (this.busy) return; this.busy = true;
        try { const result = await this.api<{token: string}>(register ? '/api/register' : '/api/login', { username: username.string, password: password.string });
          this.token = result.token; this.characterId = ''; this.saveAuth(); await this.boot(); }
        catch (error) { this.toast(String(error)); } finally { this.busy = false; }
      };
      login.on('logindebugBtn', Button.EventType.CLICK, () => { void auth(false); });
      this.ui.button(this.root, 'RegisterLocal', '注册本机账号', 0, -260, 150, 27, () => { void auth(true); });
      this.ui.label(this.root, 'LocalServer', '本机服务器 · 账号与角色保存在此电脑', 0, -294, 600, 20, 12, Theme.dim);
      this.noticeLabel?.node.setSiblingIndex(this.root.children.length - 1);
    }).catch(error => this.toast(String(error)));
  }
  private renderCharacters() {
    if (this.original?.catalog.fairygui.aliases['Login/ServerListWnd'] && !this.debugUi) { this.renderOriginalCharacters(); return; }
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
  private renderOriginalCharacters() {
    this.clear(); const generation = this.renderGeneration;
    void this.original!.mount('Login/ServerListWnd', this.root).then(mount => {
      if (generation !== this.renderGeneration) return; mount.node.setPosition(-600, 300);
      const list = mount.requireChild('list'); list.active = false;
      ['nGroup0', 'nGroup1', 'nGroup2'].forEach(name => mount.setVisible(name, false));
      this.ui.label(this.root, 'Character:LocalTitle', '本机角色', 0, 165, 600, 36, 24, Theme.gold);
      this.characters.forEach((char, index) => this.ui.button(this.root, `Character:${char.id}`, `${char.name} · ${PROFESSIONS[char.profession]} Lv.${char.level}`,
        0, 105 - index * 64, 350, 44, () => { this.characterId = char.id; void this.boot(); }));
      this.ui.button(this.root, 'CreateCharacter', '创建新角色', -140, -188, 210, 34, () => this.renderCreateCharacter(), this.characters.length >= 4);
      this.ui.button(this.root, 'ReturnLogin', '返回登录', 140, -188, 210, 34, () => { this.token = ''; this.characterId = ''; this.saveAuth(); this.renderLogin(); });
      this.noticeLabel?.node.setSiblingIndex(this.root.children.length - 1);
    }).catch(error => this.toast(String(error)));
  }
  private renderCreateCharacter() {
    this.clear(); const generation = this.renderGeneration;
    void this.original!.mount('Login/CreateActorWnd', this.root).then(mount => {
      if (generation !== this.renderGeneration) return; mount.node.setPosition(-600, 300);
      const name = this.sourceInput(mount, 'actorname', '角色名称'); name.maxLength = 14;
      let gender = 2, profession = 1;
      mount.on('roleListItem0', Button.EventType.CLICK, () => { gender = 1; mount.setText('msg', '已选择男性角色'); });
      mount.on('roleListItem1', Button.EventType.CLICK, () => { gender = 2; mount.setText('msg', '已选择女性角色'); });
      mount.on('btnRandom', Button.EventType.CLICK, () => { name.string = '旅人' + Math.floor(Math.random() * 100000); });
      const choices = this.ui.node(this.root, 'LocalProfession:server-adapter', 360, 70, 313, -103);
      this.ui.label(choices, 'Hint', '选择初始职业', 0, 15, 340, 20, 12, Theme.gold);
      const labels: Label[] = [];
      [1, 2, 3, 4].forEach((value, index) => { const button = this.ui.button(choices, 'Profession:' + value, '', -135 + index * 90, -15, 82, 30, () => {
        profession = value; labels.forEach((label, i) => { label.color = i === index ? Theme.gold : Theme.text; });
      }, false, true); labels.push(this.ui.label(button, 'Name', PROFESSIONS[value], 0, 0, 80, 24, 14, value === 1 ? Theme.gold : Theme.text)); });
      mount.on('btnStart', Button.EventType.CLICK, () => { void this.run('character.create', { name: name.string, profession, gender }); });
      this.ui.button(this.root, 'BackCharacters', '返回角色', -500, -264, 120, 27, () => this.renderCharacters());
      this.noticeLabel?.node.setSiblingIndex(this.root.children.length - 1);
    }).catch(error => this.toast(String(error)));
  }
  private navigate(page: string) { this.page = page; this.listPage = 0; this.section = ''; this.battleHidden = page !== 'battle'; this.render(); }
  private render() {
    if (!this.state) return;
    this.audio?.sync(this.state.battle?.state.mapId ?? 1, this.state.actor.settings);
    if (this.state.battle && !this.battleHidden) { this.renderBattle(); return; }
    if (this.original && !this.debugUi) { this.renderPlayer(); return; }
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
  private renderPlayer() {
    this.clear(); const generation = this.renderGeneration;
    const homeLayer = this.ui.node(this.root, 'HomeWnd:original', 1200, 600);
    void this.original!.mount('Home/HomeWnd', homeLayer).then(home => {
      if (generation !== this.renderGeneration || !homeLayer.isValid) { if (home.node.isValid) home.node.destroy(); return; }
      home.node.setPosition(-600, 300); this.home = home;
      const actor = this.state!.actor;
      home.setText('_nameLabel', actor.name); home.setText('_level', `Lv.${actor.level}`);
      home.setText('_gold', actor.currencies.gold); home.setText('_silver', actor.currencies.silver); home.setText('_shuijin', actor.currencies.crystal);
      home.setProgress('_jlTiao', this.state!.growth.summary.energy, 40);
      home.setVisible('vipGrouy', false);
      const portrait = home.child('actorPane/head/pic'); const avatar = this.catalog!.assets[this.state!.growth.profile.avatarAssetId ?? ''];
      if (portrait && avatar?.path) { portrait.active = false; const holder = home.requireChild('actorPane/head');
        void this.ui.image(holder, 'SavedAvatar', this.apiBase + '/recovered/' + avatar.path, 60, 60, 30, -30); }
      const bind = (name: string, fn: () => void) => { const node = home.child(name); if (node) {
        if (!node.getComponent(Button)) node.addComponent(Button); node.on(Button.EventType.CLICK, fn);
      } };
      const growth = (section: string) => { this.section = section; this.page = 'growth'; this.listPage = 0; this.render(); };
      bind('roleBtn', () => growth('inventory')); bind('tjBtn', () => { this.cardsAll = true; this.deckWindow?.setLibraryMode(true); this.navigate('cards'); });
      bind('rwBtn', () => this.navigate('tasks')); bind('kpBtn', () => { this.cardsAll = false; this.deckWindow?.setLibraryMode(false); this.navigate('cards'); });
      bind('dtBtn', () => this.navigate('world')); bind('swBtn', () => growth('progression')); bind('jjBtn', () => this.navigate('rooms'));
      bind('sjBtn', () => this.navigate('social')); bind('petBtn', () => growth('pets')); bind('scBtn', () => growth('shop'));
      bind('czgk', () => growth('dock')); bind('hh', () => this.navigate('guild')); bind('jjc', () => this.navigate('rooms'));
      bind('ljf', () => growth('cards')); bind('phb', () => this.navigate('rankings')); bind('tjp', () => growth('equipment'));
      bind('mxdt', () => this.navigate('world')); bind('ttt', () => growth('tower')); bind('zc', () => growth('city'));
      bind('pmh', () => this.navigate('trade')); bind('hcys', () => growth('city'));
      bind('head', () => growth('inventory')); bind('systemSetBtn', () => this.navigate('settings')); bind('mailBtn', () => this.navigate('mail'));
      bind('liBtn', () => growth('activities')); bind('chargeBtn', () => growth('shop')); bind('zhuanBtn', () => growth('profession-skill-shop'));
      bind('_jiBtn', () => growth('activities'));
      const chat = home.child('chat');
      if (chat) {
        const input = this.sourceInput(home, 'chat/input', '输入世界消息');
        const transcript = this.state!.social.chat.filter(row => row.channel === 'world').slice(-5)
          .map(row => `${this.characterName(row.from)}：${row.text}`).join('\n');
        this.ui.label(chat, 'ChatTranscript', transcript, 185, -56, 355, 100, 12, Theme.text, true);
        bind('enterBtn', () => { if (input.string.trim()) void this.run('chat.send', { channel: 'world', text: input.string }); });
        bind('channelBtn', () => this.navigate('social')); bind('msgBtn', () => this.navigate('social'));
      }
      const activityRoutes = ['activities','world-boss','ranked-season','forbidden','activities',null,'activities',null,null,'activities','activities','activities','tournament','activities','forbidden','ranked-season','activities','activities','world-boss',null,'activities','activities','shop'];
      activityRoutes.forEach((section, index) => bind(`listItem${index}`, () => section ? growth(section) : this.info('原版活动', '该入口的原客户端资源已取得，当前对应服务规则和专属窗口仍未恢复。')));
      bind('expandBtn', () => { const list = home.child('list'); if (list) list.active = !list.active; });
      // Window overlays stay above the asynchronously imported home display tree.
      if (this.noticeLabel?.isValid) this.noticeLabel.node.setSiblingIndex(this.root.children.length - 1);
    }).catch(error => { if (generation === this.renderGeneration) this.toast(String(error)); });
    if (this.page === 'home') {
      if (this.state!.battle) this.ui.button(this.root, 'Home:Resume', '继续战斗', 0, -195, 160, 32, () => { this.battleHidden = false; this.render(); });
      return;
    }
    this.body = this.ui.node(this.root, 'PlayerWindow:' + this.page, 1200, 600);
    if (this.page === 'cards') {
      this.deckWindow ??= new CardDeckWindow(this.ui, this.original!, this.catalog!, this.apiBase, {
        close: () => this.navigate('home'), save: (cards, requestId, actorId) => this.saveDeck(cards, requestId, actorId),
        detail: card => this.cardDetail(card), growth: () => { this.page = 'growth'; this.section = 'cards'; this.render(); },
      }); this.deckWindow.render(this.body, this.state!.actor, this.cardsAll); return;
    }
    if (this.page === 'growth') {
      this.growthWindows ??= new GrowthWindows(this.ui, this.original!, this.catalog!, this.apiBase, {
        close: () => this.navigate('home'), action: item => this.action(item), run: (action, payload) => { void this.run(action, payload); },
        detail: (title, text, actions) => this.info(title, text, actions),
      }); this.growthWindows.render(this.body, this.state!, this.section || 'inventory'); return;
    }
    if (this.page === 'world') {
      this.worldWindow ??= new WorldMapWindow(this.ui, this.original!, this.catalog!, this.apiBase, {
        close: () => this.navigate('home'), enter: sceneId => { this.selectedScene = sceneId; void this.run('pve.enterScene', { sceneId }); },
        transition: nodeId => { void this.run('pve.transition', { nodeId }); }, challenge: node => this.openNode(node),
        dungeon: sceneId => { void this.run('pve.dungeon', { sceneId }); },
      }); this.worldWindow.render(this.body, this.state!, this.selectedScene); return;
    }
    // Source-specific remaining windows are dispatched below; debug navigation is never shown here.
    this.renderModuleWindow();
  }
  private renderModuleWindow() {
    this.secondaryWindows ??= new SecondaryWindows(this.ui, this.original!, this.catalog!, this.apiBase, {
      close: () => this.navigate('home'), run: (action, payload) => { void this.run(action, payload); },
      action: item => this.action(item), navigate: (page, section) => { this.page = page; this.section = section ?? ''; if (page === 'battle') this.battleHidden = false; this.render(); },
      info: (title, text, actions) => this.info(title, text, actions),
      choose: (title, items, callback) => this.choose(title, items, callback),
    }); this.secondaryWindows.render(this.body, this.state!, this.page, this.characterId);
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
    if (this.original && !this.debugUi) { this.openOriginalNode(node); return; }
    const actions = [
      { label: '单人挑战', detail: '独自迎战当前敌军', action: 'pve.start', payload: { nodeId: node.id } },
      { label: '创建合作房间', detail: '队友加入并准备后开始', action: 'room.create', payload: { mode: 'coop', nodeId: node.id } },
    ];
    if (node.story) this.info(node.name, node.story, actions); else this.choose(node.name, actions);
    this.battleHidden = false;
  }
  private openOriginalNode(node: SceneNodeView, page = 0) {
    this.closeModal();
    this.modal = this.ui.panel(this.root, 'PathPoint:shade', 1200, 600, 0, 0, new Color(0, 0, 0, 128));
    const panel = this.ui.skin(this.modal, 'PathPointPane', 'dtks_1', 0, 0, 472, 346);
    this.ui.label(panel, 'Title', node.name, 0, 154, 380, 26, 18, Theme.gold);
    this.ui.sourceButton(panel, 'PathPoint:Close', 'ajguanbixiao', '', '', 218, 155, 24, 24, () => this.closeModal());
    const story = (node.story || node.name).replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'); const chunks = story.match(/[\s\S]{1,300}/g) ?? [story];
    this.ui.label(panel, 'Description', chunks[page] ?? '', -83, 37, 256, 200, 13, Theme.text, true);
    this.ui.label(panel, 'DeckName', `当前卡组 ${this.state!.actor.deck.length} 张`, -63, -94, 210, 26, 14, Theme.gold);
    this.ui.sourceButton(panel, 'PathPoint:Deck', 'ajtpgg_1', '', '', -39, -133, 114, 36, () => { this.closeModal(); this.navigate('cards'); });
    const scene = this.catalog!.scopes.main.scenes.find(scene => scene.id === node.id.split(':node:')[0]);
    const pathpoint = scene?.nodes.find(row => row._tag === 'pathpoint' && String(row.id) === node.originalId);
    const card = this.catalog!.scopes.main.cards[String(pathpoint?.cardid ?? '')]; const art = this.catalog!.assets[card?.art[0]];
    if (art?.path) void this.ui.image(panel, 'PathPoint:EnemyCard', this.apiBase + '/recovered/' + art.path, 121, 166, 139, 40);
    this.ui.sourceButton(panel, 'PathPoint:Start', 'ajks_1', '', '', 139, -89, 114, 36, () => {
      this.closeModal(); this.battleHidden = false; void this.run('pve.start', { nodeId: node.id });
    }, !node.accessible, 'game/data/img/ui/ui_step1.swf#177');
    this.ui.button(panel, 'PathPoint:Coop', '合作挑战', 139, -132, 114, 27, () => {
      this.closeModal(); this.battleHidden = false; void this.run('room.create', { mode: 'coop', nodeId: node.id });
    }, !node.accessible);
    if (chunks.length > 1) {
      this.ui.button(panel, 'PathPoint:Previous', '‹', -188, -76, 28, 22, () => this.openOriginalNode(node, page - 1), page === 0);
      this.ui.button(panel, 'PathPoint:Next', '›', 16, -76, 28, 22, () => this.openOriginalNode(node, page + 1), page + 1 >= chunks.length);
    }
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
      this.ui.label(panel, 'CardName', `${cardName(this.catalog!,card.id)}\n持有 ${state.actor.cards[card.id] ?? 0} · 准备 ${card.raw.InitReady}`, 35, 8, 145, 65, 15);
    });
    this.pager(cards.length, 12, () => this.render());
  }
  private cardDetail(card: RecoveredCard) {
    const display=cardDisplay(this.catalog!,card,this.apiBase);
    const text=display.abilities.map(a=>a.name+'：'+a.text).join('\n');
    this.info(cardName(this.catalog!,card.id), text, [
      { label: '加入待保存卡组', action: '', payload: {} },
    ], () => { this.draftDeck ??= [...this.state!.actor.deck]; this.draftDeck.push(card.id); this.editDeck(); });
  }
  private editDeck() {
    if (!this.debugUi) { this.closeModal(); this.navigate('cards'); return; }
    this.draftDeck ??= [...this.state!.actor.deck];
    this.choose(`待保存卡组 · ${this.draftDeck.length} 张`, this.draftDeck.map((id, index) => ({ label: `${cardName(this.catalog!,id)} · 移除`, action: '', payload: { index } })), item => {
      this.draftDeck!.splice(Number(item.payload?.index), 1); this.editDeck();
    }, [{ label: '保存卡组', callback: () => { const cards = [...this.draftDeck!]; this.draftDeck = undefined; this.closeModal(); void this.run('deck.save', { cards }); } },
      { label: '加入已有卡牌', callback: () => this.choose('选择卡牌', Object.entries(this.state!.actor.cards).filter(([,count]) => count > 0).map(([id]) => ({
        label: cardName(this.catalog!,id), action: '', payload: { id } })), item => { this.draftDeck!.push(String(item.payload?.id)); this.editDeck(); }) }]);
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
  private assetName(id: unknown) { return this.state?.assetNames[String(id)] ?? (this.catalog?cardName(this.catalog,String(id)):undefined) ?? '未知物品'; }
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
    if (item.action === 'local:battleHide') { this.closeModal(); this.battleHidden = true; this.page = 'home'; this.render(); return; }
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
    if (this.original && !this.debugUi) { this.sourceDraft(item, field, selected, offset); return; }
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
    if (this.original && !this.debugUi) { this.sourceFields(title, fields, callback); return; }
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
    if (this.original && !this.debugUi) { this.sourceChoices(title, items, callback, extra, offset); return; }
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
    if (this.original && !this.debugUi) { this.sourceInformation(title, text, actions, callback); return; }
    const panel = this.modalBase(title); this.ui.label(panel, 'Information', text.replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<[^>]*>/g, ''), 0, 5, 770, 340, 19, Theme.text, true);
    actions.forEach((item, index) => this.ui.button(panel, 'InfoAction:' + index, item.label, (index - (actions.length - 1) / 2) * Math.min(340, 780 / actions.length), -210, Math.min(300, 750 / actions.length), 36, () => callback ? callback() : this.action(item), item.disabled));
  }
  /** NMiniPopWnd supplies the original shared input/message shell. Content
   * below adapts local service parameters; it does not replace module windows. */
  private sourcePanel(title: string, wide = false) {
    this.closeModal(); this.modal = this.ui.node(this.root, 'NMiniPopWnd:modal-host', 1200, 600);
    this.modal.addComponent(BlockInputEvents);
    this.ui.panel(this.modal, 'NMiniPopWnd:shade', 1200, 600, 0, 0, new Color(0, 0, 0, 128));
    const width = wide ? 777 : 477, height = wide ? 513 : 346;
    const panel = this.ui.skin(this.modal, 'NMiniPopWnd:source-frame', wide ? 'kphcbj_1_2' : 'kpglk_1', 0, 0, width, height);
    this.ui.label(panel, 'NMiniPopWnd:title', title, 0, height / 2 - 17, width - 70, 27, 16, Theme.gold);
    this.ui.sourceButton(panel, 'NMiniPopWnd:close', 'ajguanbixiao', '', '', width / 2 - 19,
      height / 2 - 17, 24, 24, () => this.closeModal());
    return panel;
  }
  private sourceFields(title: string, fields: FormField[], callback: (payload: Record<string, unknown>) => void,
      offset = 0, values: Record<string, unknown> = {}) {
    const panel = this.sourcePanel(title); const visible = fields.slice(offset, offset + 3);
    const boxes = visible.map((field, index) => {
      this.ui.label(panel, 'ParameterLabel:' + field.key, field.label, -135, 86 - index * 66, 145, 26, 13, Theme.gold);
      const box = this.ui.input(panel, 'Parameter:' + field.key, '', 73, 86 - index * 66, 236,
        String(values[field.key] ?? field.value ?? ''));
      return { field, box };
    });
    this.ui.button(panel, 'NMiniPopWnd:confirm', offset + 3 < fields.length ? '下一步' : '确认', 0, -130, 120, 29, () => {
      const result = { ...values };
      for (const {field, box} of boxes) {
        const value = field.type === 'number' ? Number(box.string) : box.string;
        if (typeof value === 'number' && (!Number.isFinite(value) || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max)) {
          this.toast(`${field.label}超出允许范围`); return;
        }
        result[field.key] = value;
      }
      if (offset + 3 < fields.length) this.sourceFields(title, fields, callback, offset + 3, result);
      else { this.closeModal(); callback(result); }
    });
  }
  private sourceChoices(title: string, items: ActionItem[], callback?: (item: ActionItem) => void,
      extra: {label: string; callback: () => void}[] = [], offset = 0) {
    const panel = this.sourcePanel(title); const page = items.slice(offset, offset + 6);
    page.forEach((item, index) => {
      const x = index % 2 ? 111 : -111, y = 85 - Math.floor(index / 2) * 73;
      this.ui.button(panel, 'SourceChoice:' + index, item.label, x, y, 205, 31,
        () => { this.closeModal(); callback ? callback(item) : this.action(item); }, item.disabled);
      if (item.detail) this.ui.label(panel, 'SourceChoiceDetail:' + index, item.detail, x, y - 25, 202, 27, 10, Theme.dim, true);
    });
    if (!page.length) this.ui.label(panel, 'Empty', '当前没有可选项目', 0, 0, 360, 50, 14, Theme.dim);
    if (items.length > 6) {
      this.ui.button(panel, 'SourceChoice:previous', '‹', -192, -106, 32, 25,
        () => this.sourceChoices(title, items, callback, extra, Math.max(0, offset - 6)), offset === 0);
      this.ui.button(panel, 'SourceChoice:next', '›', 192, -106, 32, 25,
        () => this.sourceChoices(title, items, callback, extra, offset + 6), offset + 6 >= items.length);
    }
    extra.forEach((button, index) => this.ui.button(panel, 'SourceChoiceExtra:' + index, button.label,
      (index - (extra.length - 1) / 2) * 180, -137, 170, 26, button.callback));
  }
  private sourceInformation(title: string, text: string, actions: ActionItem[], callback?: () => void, offset = 0) {
    const plain = text.replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<[^>]*>/g, '');
    const pages = plain.match(/[\s\S]{1,420}/g) ?? ['']; const panel = this.sourcePanel(title);
    this.ui.label(panel, 'MessageText', pages[offset] ?? '', 0, 12, 422, 214, 13, Theme.text, true);
    actions.forEach((item, index) => this.ui.button(panel, 'MessageAction:' + index, item.label,
      (index - (actions.length - 1) / 2) * Math.min(210, 420 / actions.length), -132,
      Math.min(200, 410 / actions.length), 29, () => callback ? callback() : this.action(item), item.disabled));
    if (pages.length > 1) {
      this.ui.button(panel, 'MessagePrevious', '‹', -197, -99, 26, 22,
        () => this.sourceInformation(title, text, actions, callback, offset - 1), offset === 0);
      this.ui.button(panel, 'MessageNext', '›', 197, -99, 26, 22,
        () => this.sourceInformation(title, text, actions, callback, offset + 1), offset + 1 >= pages.length);
    }
  }
  private sourceDraft(item: ActionItem, field: FormField, selected: string[], offset: number) {
    const panel = this.sourcePanel(`${item.label} · ${selected.length}/${field.max ?? 10}`, true);
    const options = field.options ?? []; const visible = options.slice(offset, offset + 9);
    visible.forEach((option, index) => {
      const x = -281 + index % 3 * 110, y = 125 - Math.floor(index / 3) * 133;
      const card = this.catalog!.scopes.main.cards[option.value.split(':').at(-1)!];
      const slot = this.ui.button(panel, 'DraftCard:' + index, '', x, y, 91, 120, () => {
        const next = selected.includes(option.value) ? selected.filter(id => id !== option.value)
          : selected.length < (field.max ?? 10) ? [...selected, option.value] : selected;
        this.sourceDraft(item, field, next, offset);
      }, false, true);
      const art = this.catalog!.assets[card?.art[0]];
      if (art?.path) void this.ui.image(slot, 'OriginalCard', this.apiBase + '/recovered/' + art.path, 85, 116);
      if (selected.includes(option.value)) this.ui.label(slot, 'Selected', '✓', 24, 37, 32, 35, 27, Theme.green);
      this.ui.label(slot, 'CardName', card ? cardName(this.catalog!,card.id) : option.label, 0, -50, 83, 25, 10, Theme.text);
    });
    this.ui.label(panel, 'DraftInstructions', `已选择 ${selected.length} 张\n\n${selected.map(id => this.assetName(id)).join('\n')}`,
      192, 30, 290, 330, 13, Theme.text, true);
    this.ui.button(panel, 'DraftPrevious', '‹', -305, -211, 50, 28,
      () => this.sourceDraft(item, field, selected, Math.max(0, offset - 9)), offset === 0);
    this.ui.button(panel, 'DraftNext', '›', -84, -211, 50, 28,
      () => this.sourceDraft(item, field, selected, offset + 9), offset + 9 >= options.length);
    this.ui.button(panel, 'DraftSave', '保存卡组', 192, -211, 150, 30,
      () => { this.closeModal(); void this.run(item.action, { ...item.payload, [field.key]: selected }); }, selected.length !== (field.min ?? 10));
  }

  private async command(action: BattleAction) {
    const battle = this.state?.battle;
    if (!battle || this.busy || this.battleView?.locked) return;
    await this.run('battle.command', { battleId: battle.id, revision: battle.state.revision, action });
  }
  private renderBattle() {
    if (this.original) {
      const battle = this.state!.battle!;
      if (!this.battleView || this.battleId !== battle.id) {
        this.clear(); this.battleId = battle.id;
        this.battleView = new BattleSceneView(this.root, this.ui, this.original, this.catalog!, this.apiBase, {
          command: action => { void this.command(action); }, hide: () => this.info('战斗设置', '当前战斗会持续保存。', [
            { label: '返回主城，稍后继续', action: 'local:battleHide' },
            { label: '认输', action: 'battle.command', payload: { battleId: battle.id, revision: this.state!.battle!.state.revision, action: { type: 'surrender' } } },
          ]), dismiss: () => { this.battleHidden = true; this.page = 'world'; void this.run('battle.dismiss', { battleId: battle.id }); },
          sound: skill => this.audio?.shot(skill), log: text => this.info('战报', text), notice: text => this.toast(text),
        });
      }
      const replayEntry = this.entryReplayBattleId === battle.id;
      this.battleView.sync(battle, this.characterId, replayEntry);
      if (replayEntry) this.entryReplayBattleId = '';
      return;
    }
  }
}
