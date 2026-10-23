import { cardName,cardDisplay,sourceDisplayName } from './GameText.ts';
import { Color, Graphics, instantiate, Label, Node, tween, UIOpacity, UITransform, Vec3, EventTouch } from 'cc';
import { CocosUi, Theme } from './CocosUi.ts';
import { OriginalUi } from './OriginalUi.ts';
import { BattlePresentation, type BattlePresentationStep } from './BattlePresentation.ts';
import { RecoveredAnimation } from './RecoveredAnimation.ts';
import { RecoveredEffects } from './RecoveredEffects.ts';
import type { RecoveredCatalog } from './RecoveredContent.ts';
import type { BattleAction, BattleState, BattleUnit, BattleTerrain, LegalPlay } from './GameContracts.ts';

interface BattleView { id: string; settled: boolean; state: BattleState; entryState?: BattleState; legalPlays: LegalPlay[];
  rewards?: { won: boolean; silver: number; xp: number; cards?: { id: string; count: number }[] } }
interface Display { node: Node; animation: RecoveredAnimation; ready: Promise<void>; hp: Label; attack: Label; name: Label; team: number; dying: boolean; generation: number }
interface Hooks { command(action: BattleAction): void; hide(): void; dismiss(): void; sound(skill: number): void;
  log(text: string): void; notice(text: string): void }

/** Server snapshots never directly move, hurt or remove a live presentation entity. */
export class BattleSceneView {
  readonly presentation = new BattlePresentation();
  private scene: Node; private actors: Node; private ground: Node; private groundKey = ''; private hud?: Node; private result?: Node;
  private effects: RecoveredEffects; private displays = new Map<string, Display>();
  private latest!: BattleView; private me = ''; private selected = ''; private activeToken = '';
  private disposed = false; private uiKey = ''; private processing = false;
  private clocks: { remaining: number; done(): void }[] = [];
  private flights: Node[] = []; private selectedHandPositions = new Map<string, Vec3>();
  private pendingFlight?: { cardId: string; origin: Vec3 }; private impacted = new Set<string>();
  speed = 1; autoplay = false;

  constructor(private parent: Node, private ui: CocosUi, private original: OriginalUi,
      private catalog: RecoveredCatalog, private base: string, private hooks: Hooks) {
    this.scene = ui.node(parent, 'BattleScene:source-layers', 1200, 600);
    this.ground = ui.node(this.scene, 'Terrain:authoritative-ground', 1200, 600);
    this.actors = ui.node(this.scene, 'Actors:feet-sorted', 1200, 600);
    this.effects = new RecoveredEffects(this.scene, catalog, base + '/recovered/');
  }
  get locked() { return this.presentation.locked || this.processing; }
  get settledReady() { return this.presentation.settledReady && !this.processing; }
  sync(battle: BattleView, character: string, replayEntry = false) {
    const first = !this.latest; this.latest = battle; this.me = character;
    if (first && replayEntry && battle.entryState?.id === battle.state.id) {
      this.presentation.sync(battle.entryState, { baseline: true });
      this.presentation.sync(battle.state);
    } else this.presentation.sync(battle.state, { baseline: first });
    if (first) {
      const map = this.catalog.scopes.main.maps[String(battle.state.mapId)];
      const art = this.catalog.assets[map?.background_asset_ids[0]];
      if (art?.path) { void this.ui.image(this.scene, 'OriginalBattleMap', this.base + '/recovered/' + art.path, 1200, 600); this.scene.children.at(-1)?.setSiblingIndex(0); }
    }
    this.syncDisplays(); this.renderHud(); this.advance();
  }
  update(dt: number) {
    if (this.disposed) return;
    const delta = dt * this.speed;
    this.effects.update(delta);
    for (const display of this.displays.values()) display.animation.update(delta);
    const pending = this.clocks; this.clocks = [];
    for (const clock of pending) { clock.remaining -= delta; if (clock.remaining <= 0) clock.done(); else this.clocks.push(clock); }
    this.advance();
  }
  destroy() {
    this.disposed = true; this.effects.destroy();
    for (const display of this.displays.values()) display.animation.destroy();
    this.displays.clear(); for (const clock of this.clocks) clock.done(); this.clocks.length = 0;
    for (const flight of this.flights) if (flight.isValid) flight.destroy(); this.flights.length = 0;
    this.scene.destroy(); this.hud?.destroy(); this.result?.destroy();
  }
  private wait(seconds: number): Promise<void> { return new Promise(resolve => this.clocks.push({ remaining: seconds, done: resolve })); }
  private position(row: number, col: number) {
    const state = this.presentation.visibleState!;
    const map = this.catalog.scopes.main.maps[String(state.mapId)];
    const raw = map?.layoutRows.find(row => row._tag === 'map');
    const tw = Number(raw?.tilewidth ?? 90), th = Number(raw?.tileheight ?? 95);
    return new Vec3((1200 - state.columns * tw) / 2 + (col + .5) * tw - 600, 300 - (45 + (row + .5) * th), 0);
  }
  private direction(display: Display) { return display.team === 0 ? 'east' as const : 'west' as const; }
  private syncDisplays() {
    const state = this.presentation.visibleState; if (!state || this.disposed) return;
    this.syncTerrainDisplays(state);
    for (const unit of state.units) {
      let display = this.displays.get(unit.id);
      if (!display && unit.hp > 0) {
        const point = this.position(unit.row, unit.col);
        const node = this.ui.node(this.actors, 'Unit:' + unit.id, 170, 170, point.x, point.y);
        const visual = this.ui.node(node, 'RecoveredVisual:source-anchor', 170, 170);
        const animation = new RecoveredAnimation(visual, this.catalog, this.base + '/recovered/');
        const owner = state.players.find(player => player.id === unit.playerId);
        const ready = (unit.flags.hero === 1 && !unit.monsterId ? animation.setActor(owner?.profession ?? 1, owner?.sex ?? 1) : animation.setMonster(unit.monsterId));
        display = { node, animation, ready, team: unit.team, dying: false, generation: 0,
          hp: this.ui.label(node, 'Health', `${unit.hp}`, 16, -34, 35, 22, 16, Theme.red),
          attack: this.ui.label(node, 'Attack', `${unit.attack}`, -16, -34, 35, 22, 16, Theme.text),
          name: this.ui.label(node, 'Name', unit.flags.hero ? (owner?.ai?sourceDisplayName(this.catalog,owner.name):owner?.name??'') : cardName(this.catalog,unit.cardId), 0, 119, 140, 18, 12,
          unit.team === 0 ? Theme.green : Theme.red) };
        this.ui.label(node, 'StatsSeparator', '/', 0, -34, 12, 20, 14);
        this.displays.set(unit.id, display);
        const instance = display;
        void ready.then(() => {
          if (!this.disposed && instance.node.isValid && !instance.dying && instance.generation === 0) {
            instance.generation++; animation.play('stand', this.direction(instance));
            const anchorY = animation.getSourceLayoutMetrics(this.direction(instance))?.anchorY ?? 70;
            // CreatureItem.updateNamePos uses raw anchor + 10. Keep the first
            // row text inside the viewport when the local battle places a hero there.
            instance.name.node.setPosition(0, Math.min(anchorY + 1, 279 - instance.node.position.y), 0);
          }
        }).catch(error => this.hooks.notice(String(error)));
      }
      if (display && !display.dying) {
        display.hp.string = `${unit.hp}`; display.attack.string = `${unit.attack}`;
        if (!this.presentation.locked) display.node.setPosition(this.position(unit.row, unit.col));
      }
    }
    // HP-zero entities remain registered and are updated until the death step completes.
    for (const [id, display] of this.displays) if (!state.units.some(unit => unit.id === id) && !display.dying) this.release(id);
    const ordered = Array.from(this.displays.values()).sort((a, b) => b.node.position.y - a.node.position.y);
    ordered.forEach((display, index) => display.node.setSiblingIndex(index));
  }
  private terrainText(terrain: BattleTerrain): string {
    const name = cardName(this.catalog, String(terrain.skillId));
    const duration = terrain.remainingTurns === null ? '持续至被覆盖或战斗结束' : `剩余${terrain.remainingTurns}个玩家回合`;
    return `${name} · ${terrain.cells.length}格 · ${duration}`;
  }
  private syncTerrainDisplays(state: BattleState): void {
    const terrains = state.terrains ?? [];
    const key = JSON.stringify(terrains.map(t => [t.id, t.cells, t.remainingTurns]));
    if (key === this.groundKey) return;
    this.groundKey = key; for (const child of [...this.ground.children]) { child.active = false; child.destroy(); }
    for (const terrain of terrains) {
      const hatch = terrain.topographyId === 50806 || terrain.topographyId === 50807;
      const ward = terrain.topographyId === 50903;
      const color = ward ? new Color(108, 191, 236, 110) : hatch ? new Color(139, 203, 108, 110) : new Color(229, 105, 46, 105);
      for (const cell of terrain.cells) {
        const point = this.position(cell.row, cell.col);
        const node = this.ui.node(this.ground, `Terrain:${terrain.id}:${cell.row}:${cell.col}`, 84, 88, point.x, point.y);
        const graphic = node.addComponent(Graphics);
        graphic.fillColor = color; graphic.roundRect(-40, -39, 80, 78, 9); graphic.fill();
        graphic.strokeColor = terrain.team === 0 ? new Color(239, 206, 122, 195) : new Color(222, 128, 105, 195);
        graphic.lineWidth = 2; graphic.roundRect(-40, -39, 80, 78, 9); graphic.stroke();
        // These markers are current-version feedback, not a replacement source map or character texture.
        const label = this.ui.label(node, 'Terrain:state', `${ward ? '净' : hatch ? '孵' : '炎'} ${terrain.remainingTurns ?? '∞'}`, 20, -27, 39, 19, 12, Theme.text);
        label.overflow = Label.Overflow.CLAMP;
        node.on(Node.EventType.TOUCH_END, () => {
          const card = this.catalog.scopes.main.cards[String(terrain.skillId)];
          const description = card ? cardDisplay(this.catalog, card, this.base).abilities.map(a => a.text).join('\n') : '';
          this.hooks.log(this.terrainText(terrain) + '\n' + description);
        });
      }
    }
  }
  private release(id: string) { const display = this.displays.get(id); if (!display) return;
    display.animation.destroy(); display.node.destroy(); this.displays.delete(id); }
  private advance() {
    if (this.processing || this.disposed) return;
    const step = this.presentation.nextStep();
    if (!step) { this.renderHud(); return; }
    this.processing = true; this.activeToken = step.token; this.renderHud(true);
    void this.perform(step).then(() => {
      if (this.disposed || this.activeToken !== step.token) return;
      if (!this.presentation.complete(step.token)) throw new Error('表现事件未收到命中信号：' + step.token);
      this.impacted.delete(step.token);
      this.processing = false; this.syncDisplays(); this.renderHud(true); this.advance();
    }).catch(error => {
      if (this.disposed || this.activeToken !== step.token) return;
      // A missing recovered asset is a visible source gap, not permission to
      // replay the same authoritative event forever. Commit its required cue
      // and continue the server sequence after reporting the gap.
      this.hooks.notice(String(error));
      if (step.requiredCues.includes('impact')) this.impact(step);
      this.presentation.complete(step.token);
      this.impacted.delete(step.token);
      this.processing = false; this.syncDisplays(); this.renderHud(true); this.advance();
    });
  }
  private impact(step: BattlePresentationStep) {
    if (this.disposed || this.activeToken !== step.token || this.impacted.has(step.token)) return;
    if (!this.presentation.cue(step.token, 'impact')) return;
    this.impacted.add(step.token); this.syncDisplays();
    for (const change of step.hpChanges) {
      const display = this.displays.get(change.unitId); if (!display) continue;
      const delta = change.after - change.before;
      const hit = this.ui.label(display.node, 'Damage:' + change.eventSeq,
        delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`, 0, 38, 110, 30, 24, delta > 0 ? Theme.green : Theme.red);
      tween(hit.node).by(.5 / this.speed, { position: new Vec3(0, 40, 0) }).call(() => { if (hit.node.isValid) hit.node.destroy(); }).start();
      if (!display.dying && change.unitId !== step.actorId && change.after > 0) {
        const generation = ++display.generation;
        const handle = display.animation.play('hit', this.direction(display));
        if (handle.hasNativeState) void handle.completion.then(() => {
          // RecoveredAnimation resolves a canceled handle. Only the handle
          // that still owns this display may restore stand; an old hit must
          // never cancel a newer attack animation.
          if (!this.disposed && display.node.isValid && !display.dying && display.generation === generation
              && !this.presentation.visibleState?.units.find(u => u.id === change.unitId && u.hp <= 0)) {
            display.generation++; display.animation.play('stand', this.direction(display));
          }
        });
      }
    }
    const event = step.events.find(event => event.skillId !== undefined);
    const target = step.after.target ?? step.before.target ?? step.after.actor ?? step.before.actor;
    if (target && event?.skillId !== undefined) { const p = this.position(target.row, target.col); this.effects.play(event.skillId, p.x, p.y, target.team === 0 ? 'east' : 'west'); this.hooks.sound(event.skillId); }
  }
  private async perform(step: BattlePresentationStep) {
    this.syncDisplays();
    const display = step.actorId ? this.displays.get(step.actorId) : undefined;
    if (display) await display.ready;
    if (this.disposed) return;
    if (step.kind === 'move' && display && step.moveTo) {
      const end = this.position(step.moveTo.row, step.moveTo.col); const start = display.node.position.clone();
      const monster = this.catalog.scopes.main.monsters[String(step.before.actor?.monsterId ?? 0)];
      // NormalMoveStyle: horizontal distance / recovered monster Speed. Vertical-only moves use Euclidean distance.
      const distance = Math.abs(end.x - start.x) || Vec3.distance(start, end);
      const seconds = distance / Math.max(1, Number(monster?.Speed ?? 200));
      const generation = ++display.generation;
      display.animation.play('walk', end.x < start.x ? 'west' : 'east');
      await new Promise<void>(resolve => tween(display.node).to(seconds / this.speed, { position: end }).call(() => resolve()).start());
      if (!this.disposed && !display.dying && display.generation === generation) {
        display.generation++; display.animation.play('stand', this.direction(display));
      }
    } else if (step.kind === 'attack') {
      let hit = false; const cue = () => { if (!hit) { hit = true; this.impact(step); } };
      if (display && !display.dying) {
        const generation = ++display.generation;
        const handle = display.animation.play('atk', this.direction(display), cue);
        if (handle.hasNativeState) { await handle.completion; if (!hit) cue(); }
        else cue();
        if (!this.disposed && !display.dying && display.generation === generation) {
          display.generation++; display.animation.play('stand', this.direction(display));
        }
      } else cue();
    } else if (step.kind === 'death' && display) {
      display.dying = true; display.generation++; display.hp.string = '0';
      // Keep the last recovered pose for the AS3 AlphaEffect fallback, never substitute stand as death.
      const pose = instantiate(display.animation.node); display.node.addChild(pose);
      const handle = display.animation.play('die', this.direction(display));
      if (handle.hasNativeState) pose.destroy();
      const opacity = (handle.hasNativeState ? display.animation.node : pose).addComponent(UIOpacity);
      const fade = new Promise<void>(resolve => tween(opacity).to(.6 / this.speed, { opacity: 0 }).call(() => resolve()).start());
      // CreatureDieState runs its recovered AlphaEffect and keeps the dying
      // creature registered for its full two-second lifetime before destroy.
      await Promise.all([fade, handle.completion, this.wait(2)]);
      if (step.actorId) this.release(step.actorId);
    } else if (step.kind === 'summon') {
      const summonedEvent = step.events.find(event => event.type === 'summon');
      const spawned = step.after.target ?? summonedEvent?.targetView;
      if (spawned) { const instance = this.displays.get(spawned.id); if (instance) await instance.ready; }
    } else if (step.events.some(event => event.type.startsWith('terrain-'))) {
      const event = step.events.find(event => event.type.startsWith('terrain-'))!;
      if (event.type === 'terrain-update') return;
      const terrain = event.terrain;
      const point = terrain?.cells[0];
      if (point) {
        const p = this.position(point.row, point.col);
        const text = event.type === 'terrain-remove' ? '地形结束' : event.type === 'terrain-add' ? '地形生效' : `地形剩余 ${terrain!.remainingTurns ?? '∞'}`;
        const label = this.ui.label(this.scene, 'Terrain:feedback', text, p.x, p.y + 39, 150, 24, 16, Theme.gold);
        await new Promise<void>(resolve => tween(label.node).by(.4 / this.speed, { position: new Vec3(0, 17, 0) }).call(() => {
          if (label.node.isValid) label.node.destroy(); resolve();
        }).start());
      }
    } else if (step.events.some(event => event.type === 'play' && event.cardId)) {
      const event = step.events.find(event => event.type === 'play')!;
      const card = this.catalog.scopes.main.cards[event.cardId!.split(':').at(-1)!];
      const art = this.catalog.assets[card?.art[0]];
      if (art?.path && event.row !== undefined && event.col !== undefined) {
        const pending = this.pendingFlight;
        const saved = event.actor === this.me && pending && pending.cardId === event.cardId ? pending.origin : undefined;
        const origin = saved ?? (event.actor === this.me ? new Vec3(-143, -228) : new Vec3(0, 228));
        if (event.actor === this.me) this.pendingFlight = undefined;
        const flight = this.ui.node(this.parent, 'Card:flight', 85, 116, origin.x, origin.y);
        await this.drawSmallCard(flight, card, Number(card.raw.InitReady ?? 0), false, false);
        if (!flight.isValid || this.disposed) return;
        this.flights.push(flight);
        await new Promise<void>(resolve => tween(flight).to(.35 / this.speed,
          { position: this.position(event.row!, event.col!), scale: new Vec3(.7, .7, 1) }, { easing: 'quadOut' }).call(() => resolve()).start());
        flight.destroy(); this.flights = this.flights.filter(node => node !== flight);
      }
      if (step.requiredCues.includes('impact')) this.impact(step);
    } else {
      if (step.requiredCues.includes('impact')) this.impact(step);
      // Source status-only messages have no creature action to await.
    }
  }
  private skinButton(parent: Node, name: string, skin: string, selected: string, title: string,
      x: number, y: number, w: number, h: number, fn: () => void, disabled = false) {
    if (this.original.catalog.skins[skin]?.path) return this.ui.sourceButton(parent, name, skin, selected, title, x, y, w, h, fn, disabled);
    return this.ui.button(parent, name, title, x, y, w, h, fn, disabled);
  }
  private cardFrame(card: RecoveredCatalog['scopes']['main']['cards'][string]): string {
    if (Number(card.raw.SkillID ?? 0) > 0) return 'jineng';
    const monster = this.catalog.scopes.main.monsters[String(card.raw.MonsterID ?? '')];
    const phyle = Number(monster?.Phyle ?? card.raw.Race ?? 0);
    // CardUtils._zhongzu[][0]. Profession troops use the skill frame.
    if (phyle >= 100) return 'jineng';
    return ['renleikuang', 'renleikuang', 'wanglingkuang', 'yeshoukuang', 'dijingkuang', 'jumokuang',
      'jinglingkuang', 'shourenkuang', 'yijiekuang', 'longzukuang', 'tianshikuang', 'emokuang',
      'ronghekuang_shengjun', 'ronghekuang_xianling', 'ronghekuang_banjingling', 'ronghekuang_anjumo',
      'ronghekuang_duotoulong', 'ronghekuang_aishimo', 'ronghekuang_longnu', 'ronghekuang_pinjiejumo'][phyle] ?? 'jinglingkuang';
  }
  private cardBadge(card: RecoveredCatalog['scopes']['main']['cards'][string]): string {
    const skillId = String(card.raw.SkillID ?? '');
    if (skillId) {
      const profession = Number(this.catalog.scopes.main.skills[skillId]?.raw?.['使用职业'] ?? 0);
      return ['ZSxiao', 'ZSxiao', 'LRxiao', 'FSxiao', 'MSxiao', 'MSxiao'][profession] ?? 'ZSxiao';
    }
    const monster = this.catalog.scopes.main.monsters[String(card.raw.MonsterID ?? '')];
    const phyle = Number(monster?.Phyle ?? card.raw.Race ?? 0);
    if (phyle >= 100) return ['ZSxiao', 'ZSxiao', 'LRxiao', 'FSxiao', 'MSxiao', 'MSxiao'][phyle % 100 + 1] ?? 'ZSxiao';
    return ['renleizhongzuxiao', 'renleizhongzuxiao', 'wanglingbiaozhixiao', 'yeshoubiaozhixiao',
      'dijingbiaozhixiao', 'jumobiaozhixiao', 'jinglingbiaozhixiao', 'shourenbiaozhixiao',
      'yijietubiaoxiao', 'longzubiaozhixiao', 'tianshibiaozhixiao', 'emobiaozhixiao',
      'shengjuntubiaoxiao', 'xianlingtubiaoxiao', 'banjinglingtubiaoxiao', 'anjumotubiaoxiao',
      'duotoulongtubiaoxiao', 'aishimotubiaoxiao', 'longnutubiaoxiao', 'pinjiejumotubiaoxiao'][phyle] ?? 'jinglingbiaozhixiao';
  }
  private sourceCardSkin(parent: Node, name: string, skinName: string, x: number, y: number,
      width?: number, height?: number): Node | undefined {
    const skin = this.original.catalog.skins[skinName];
    if (!skin) return undefined;
    const variant = skin.path ? undefined : Object.keys(skin.variants)[0];
    try { return this.ui.skin(parent, name, skinName, x, y, width, height, variant); }
    catch { return undefined; }
  }
  private async drawSmallCard(parent: Node, card: RecoveredCatalog['scopes']['main']['cards'][string], wait: number,
      selected: boolean, showStats = true): Promise<void> {
    const art = this.catalog.assets[card.art[0]];
    if (art?.path) await this.ui.image(parent, 'Portrait', this.base + '/recovered/' + art.path, 85, 116);
    if (!parent.isValid) return;
    // CardBackgroundPane places the original race/skill frame over raw art.
    const frame = this.sourceCardSkin(parent, 'SourceFrame:' + this.cardFrame(card), this.cardFrame(card), 0, 0, 85, 116);
    if (!frame) {
      const outline = parent.addComponent(Graphics); outline.strokeColor = selected ? Theme.gold : new Color(125, 91, 39);
      outline.lineWidth = selected ? 3 : 1; outline.rect(-42.5, -58, 85, 116); outline.stroke();
    }
    this.sourceCardSkin(parent, 'ReadyPlate', 'feiyongxiao', -30, 43);
    this.ui.label(parent, 'Wait', String(wait), -29, 43, 25, 25, 19, Theme.text);
    const quality = Math.max(0, Math.min(6, Number(card.raw.Quality ?? 0)));
    this.sourceCardSkin(parent, 'QualityStar', ['baixingxiao', 'lvxingxiao', 'lanxingxiao', 'zixingxiao',
      'chengxingxiao', 'hongxingxiao', 'jinxingxiao'][quality], 0, 50);
    this.sourceCardSkin(parent, 'RaceOrProfession', this.cardBadge(card), 31, 44);
    if (selected) this.sourceCardSkin(parent, 'PlayableRing', 'raoquan', 0, 0, 85, 116);
    const cardLabel=this.ui.label(parent, 'CardName', cardName(this.catalog,card.id), 0, -47, 80, 24, 11);cardLabel.overflow=Label.Overflow.CLAMP;cardLabel.lineHeight=12;
    if (!showStats) return;
    const monster = this.catalog.scopes.main.monsters[String(card.raw.MonsterID)];
    if (monster) {
      this.ui.label(parent, 'Attack', String(monster.Attack), -28, -24, 25, 22, 16);
      this.ui.label(parent, 'HP', String(monster.HP), 28, -24, 25, 22, 16);
    }
  }
  private renderHud(force = false) {
    const state = this.presentation.visibleState; if (!state || this.disposed) return;
    const key = `${state.revision}:${this.locked}:${this.selected}:${this.speed}:${this.autoplay}:${this.settledReady}`;
    if (!force && this.uiKey === key) return; this.uiKey = key;
    this.hud?.destroy(); this.hud = this.ui.node(this.parent, 'BattleWnd:original-layout', 1200, 600);
    const hud = this.hud; const active = state.players[state.activePlayer];
    this.ui.label(hud, 'Round', `${state.turn}`, -20, 269.5, 100, 35, 35);
    this.ui.label(hud, 'TurnName', this.locked ? '战斗进行中' : (active?.ai?sourceDisplayName(this.catalog,active.name):active?.name??'') + '行动', 0, 224, 350, 24, 14);
    this.skinButton(hud, 'Battle:Menu', 'ajbangzhu', '', '设置', 551, 274, 75, 27, () => this.hooks.hide());
    this.skinButton(hud, 'Battle:Log', 'ajbangzhu', '', '战报', 462, 274, 75, 27, () => this.hooks.log(state.events.slice(-35).map(event => `${event.seq} ${({move:'移动',attack:'攻击',damage:'伤害',heal:'治疗',summon:'召唤',death:'死亡',play:'出牌',skill:'技能',status:'状态',effect:'效果',settled:'结算',surrender:'认输',draw:'抽牌',terrain:'地形','terrain-add':'地形生效','terrain-update':'地形变化','terrain-remove':'地形结束','return-hand':'返回手牌'} as Record<string,string>)[event.type]??'战斗事件'} ${event.amount ?? ''}`).join('\n')));
    // BattleWnd rightContent is aligned EAST, not a full-width replacement panel.
    const skin = this.original.catalog.skins.zdjm_1;
    if (skin?.path) this.ui.skin(hud, 'HandPane:source-zdjm_1', 'zdjm_1', 173, -228, 854, 144);
    else this.ui.panel(hud, 'HandPane:missing-source', 854, 144, 173, -228, new Color(45, 34, 20, 210));
    const me = state.players.find(player => player.id === this.me); if (!me) return;
    const mine = !this.locked && !this.latest.settled && active?.id === this.me;
    const terrainCount = (state.terrains ?? []).reduce((sum, t) => sum + t.cells.length, 0);
    if (terrainCount) this.ui.label(hud, 'Terrain:legend', `地形 ${terrainCount}格 · 点击格子查看效果 · 数字为玩家回合`, -302, -136, 510, 25, 13, Theme.gold);
    this.ui.label(hud, 'DrawPile', `${me.drawPile.length}`, -191, -228, 44, 30, 22, Theme.gold);
    this.ui.label(hud, 'Graveyard', `${me.graveyard.length}`, 555, -228, 44, 30, 22, Theme.gold);
    this.selectedHandPositions.clear();
    me.hand.forEach((hand, index) => {
      const card = this.catalog.scopes.main.cards[hand.cardId.split(':').at(-1)!]; if (!card) return;
      const x = -143 + index * 89; const y = -228 + (this.selected === hand.instanceId ? 15 : 0);
      const box = this.ui.node(hud, 'Hand:' + index, 85, 116, x, y);
      void this.drawSmallCard(box, card, hand.wait, this.selected === hand.instanceId);
      box.on(Node.EventType.TOUCH_START, () => { if (mine && hand.wait === 0) {const unsupported=cardDisplay(this.catalog,card,this.base).abilities.find(a=>a.status==='unsupported');if(unsupported){this.hooks.notice(unsupported.text);return;} this.selected = hand.instanceId; box.setPosition(x, y + 15); } });
      box.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => { if (this.selected !== hand.instanceId || !mine) return;
        const p = event.getUILocation(); const local = hud.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(p.x, p.y)); box.setPosition(local); });
      box.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
        if (!mine || hand.wait > 0) { this.hooks.notice(hand.wait > 0 ? '卡牌仍在准备' : '请等待当前行动结束'); return; }
        const p = event.getUILocation(); const local = hud.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(p.x, p.y));
        const legal = this.latest.legalPlays.filter(play => play.instanceId === hand.instanceId).find(play => Vec3.distance(local, this.position(play.row, play.col)) < 45);
        if (legal && local.y > -150) this.playFromHand(hand.cardId, legal);
        else { this.selected = hand.instanceId; this.renderHud(true); }
      });
      this.selectedHandPositions.set(hand.instanceId, new Vec3(x, y));
    });
    this.skinButton(hud, 'Battle:End', 'hhjs_1', '', '结束回合', 528.5, -136, 139, 35, () => this.hooks.command({ type: 'end' }), !mine);
    this.skinButton(hud, 'Battle:Auto', 'ajbangzhu', '', this.autoplay ? '自动' : '手动', 432, -136, 50, 35, () => { this.autoplay = !this.autoplay; this.renderHud(true); }, this.latest.settled);
    this.skinButton(hud, 'Battle:Surrender', 'tx_1', '', '', 382, -136, 50, 35, () => this.hooks.command({ type: 'surrender' }), this.locked || this.latest.settled);
    this.skinButton(hud, 'Battle:Speed', 'ajbangzhu', '', `${this.speed}倍速`, 312, -136, 75, 27, () => { this.speed = this.speed === 1 ? 2 : 1; this.renderHud(true); });
    if (mine) for (const [index, play] of this.latest.legalPlays.filter(play => play.instanceId === this.selected).entries()) {
      const p = this.position(play.row, play.col);
      const hand = me.hand.find(card => card.instanceId === play.instanceId);
      this.ui.button(hud, 'Legal:' + index, play.targetId ? '目标' : hand && Number(this.catalog.scopes.main.cards[hand.cardId.split(':').at(-1)!]?.raw.Type) === 2 ? '施放' : '部署', p.x, p.y, 78, 82,
        () => { if (hand) this.playFromHand(hand.cardId, play); }, false, true);
    }
    if (this.settledReady) this.renderResult();
  }
  private playFromHand(cardId: string, play: LegalPlay): void {
    const origin = this.selectedHandPositions.get(play.instanceId) ?? new Vec3(-143, -228);
    this.pendingFlight = { cardId, origin: origin.clone() };
    this.selected = '';
    this.hooks.command({ type: 'play', ...play });
  }
  private renderResult() {
    if (this.result?.isValid) return;
    const state = this.presentation.visibleState!; const outcome = this.latest.rewards;
    this.result = this.ui.node(this.parent, 'BattleResultWnd', 1200, 600);
    const won = outcome?.won ?? state.winner === state.players.find(p => p.id === this.me)?.team;
    const skin = won ? 'victory-textless.png' : 'defeat-textless.png';
    const source = this.original.skin(won ? 'shengli' : 'shibai');
    const sx = won ? 425 : 432, sy = won ? 56 : 120;
    const resultX = sx + source.width! / 2 - 600;
    const resultY = 300 - sy - source.height! / 2;
    void this.ui.image(this.result, 'Result:textless-art', this.base + '/ui-assets/' + skin,
      source.width!, source.height!, resultX, resultY);
    this.ui.label(this.result, 'Result:title', won ? '战斗胜利' : '战斗失败', resultX,
      resultY + (won ? 36 : 23), won ? 300 : 260, 62, won ? 44 : 40, won ? Theme.gold : new Color(220, 224, 232));
    this.ui.label(this.result, 'Result:round', `回合数：${state.turn}`, resultX, resultY - (won ? 67 : 48), 180, 30, 18, Theme.gold);
    this.ui.label(this.result, 'Result:rewards', `银币 +${outcome?.silver ?? 0}    经验 +${outcome?.xp ?? 0}`, 0, -82, 500, 35, 18, Theme.gold);
    if(outcome?.cards?.length)this.ui.label(this.result,'RewardCards',outcome.cards.map(c=>cardName(this.catalog,c.id)+' ×'+c.count).join('、'),0,-113,560,32,13,Theme.gold);
    this.skinButton(this.result, 'Battle:Dismiss', 'kapaixiangqing_1', 'kapaixiangqing_2', '领取并返回地图', 0, -160, 220, 38, () => this.hooks.dismiss());
  }
}
