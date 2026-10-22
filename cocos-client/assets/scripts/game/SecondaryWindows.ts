import { cardName } from './GameText.ts';
import { Color, Node } from 'cc';
import { CocosUi, Theme } from './CocosUi.ts';
import type { OriginalUi } from './OriginalUi.ts';
import type { RecoveredCatalog } from './RecoveredContent.ts';
import { RecoveredAnimation } from './RecoveredAnimation.ts';

type Row = Record<string, unknown>;
interface Field { key: string; label: string; type?: string; value?: unknown; min?: number; max?: number; options?: {label: string; value: string}[] }
interface ActionItem { label: string; detail?: string; action: string; payload?: Record<string, unknown>; disabled?: boolean; fields?: Field[] }
interface SecondaryCallbacks {
  close(): void;
  run(action: string, payload?: Record<string, unknown>): void;
  action(item: ActionItem): void;
  navigate(page: string, section?: string): void;
  info(title: string, text: string, actions?: ActionItem[]): void;
  choose(title: string, items: ActionItem[], callback?: (item: ActionItem) => void): void;
}
interface SecondaryState {
  actor: { id?: string; name?: string; level?: number; profession?: number; gender?: number; sex?: number; guildId?: string; cards?: Record<string, number>; deck?: string[];
    inventory?: Record<string, number>; settings?: Record<string, boolean>; currencies?: Record<string, number>; tutorialStep?: number };
  tasks?: Array<{ id: string; name: string; detail: string; ready: boolean; claimed: boolean; reward: number }>;
  social: { people: Row[]; friends: Row[]; friendRequests: Row[]; chat: Row[]; mail: Row[]; guilds: Row[]; trades: Row[]; auctions: Row[] };
  rooms?: Row[];
  roomInvites?: Row[];
  rankings?: Row[];
  assetNames?: Record<string, string>;
  assetIcons?: Record<string, string>;
}

const WINDOW_W = 709;
const WINDOW_H = 443;
const WINDOW_X = 240 + WINDOW_W / 2 - 600;
const WINDOW_Y = 300 - (40 + WINDOW_H / 2);
const MODE_NAMES: Record<string, string> = { coop: '合作PVE', pvp: '竞技场', ranked: '天梯', 'clan-war': '公会城战', tournament: '竞技赛' };
const PROFESSION_NAMES: Record<number, string> = { 1: '战士', 2: '游侠', 3: '法师', 4: '牧师' };
const PROFESSION_SKINS: Record<number, string> = { 1: 'rwzyzhanshi', 2: 'rwzyyouxia', 3: 'rwzyfashi', 4: 'rwzymushi' };

function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Row[] : []; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : []; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

/** Source-shaped mail, task, social, ranking, room, settings, guild and trade windows. */
export class SecondaryWindows {
  private root?: Node;
  private parent?: Node;
  private state?: SecondaryState;
  private page = '';
  private characterId = '';
  private pageByView = new Map<string, number>();
  private selectedMail = '';
  private selectedTask = '';
  private selectedRoom = '';
  private knownOwnRooms = new Set<string>();
  private socialTab: 'friends' | 'requests' | 'chat' = 'friends';
  private tradeTab: 'trade' | 'auction' = 'trade';
  private composingMail = false;
  private creatingPvp = false;
  private roomTeamSize: 1 | 2 | 4 = 1;
  private settingsDraft: Record<string, boolean> = {};
  private roomSignature = '';
  private readonly roomAnimations = new Set<RecoveredAnimation>();
  private readonly roomPreviewFits = new Map<RecoveredAnimation, {
    panel: Node; member: string; profession: number; loading: Node; elapsed: number;
  }>();

  constructor(private readonly ui: CocosUi, private readonly original: OriginalUi,
              private readonly catalog: RecoveredCatalog, private readonly base: string,
              private readonly callbacks: SecondaryCallbacks) {}

  render(parent: Node, state: unknown, page: string, characterId: string): void {
    const pageChanged = this.page !== page;
    this.parent = parent; this.state = state as SecondaryState; this.page = page; this.characterId = characterId;
    if (pageChanged) { this.settingsDraft = {}; this.composingMail = false; this.creatingPvp = false; this.roomTeamSize = 1; }
    if (page === 'rooms') {
      const ownRoom = rows(this.state.rooms).find(room => strings(room.members).includes(characterId) && room.status === 'waiting');
      if (ownRoom && (pageChanged || this.creatingPvp || !this.knownOwnRooms.has(String(ownRoom.id)))) {
        this.selectedRoom = String(ownRoom.id); this.creatingPvp = false;
      }
      this.knownOwnRooms = new Set(rows(this.state.rooms).filter(room => strings(room.members).includes(characterId) && room.status === 'waiting').map(room => String(room.id)));
    }
    const roomSignature = page === 'rooms' ? this.currentRoomSignature() : '';
    if (roomSignature && roomSignature === this.roomSignature && this.root?.isValid) return;
    this.destroyRoomAnimations();
    this.roomSignature = roomSignature;
    if (this.root?.isValid) this.root.destroy();
    this.root = this.ui.node(parent, `Secondary:${page}`, 1200, 600);
    if (page === 'mail') this.renderMail();
    else if (page === 'tasks') this.renderTasks();
    else if (page === 'social') this.renderSocial();
    else if (page === 'guild') this.renderGuild();
    else if (page === 'trade') this.renderTrade();
    else if (page === 'rooms') this.renderRooms();
    else if (page === 'rankings') this.renderRankings();
    else if (page === 'settings') this.renderSettings();
    else this.callbacks.close();
  }

  update(dt: number): void {
    this.roomAnimations.forEach(animation => animation.update(dt));
    for (const [animation, pending] of this.roomPreviewFits) {
      pending.elapsed += dt;
      if (animation.fitPreviewBox(185, 185)) {
        if (pending.loading.isValid) pending.loading.destroy();
        this.roomPreviewFits.delete(animation);
      } else if (pending.elapsed >= 3) this.fallbackRoomActor(animation, pending);
    }
  }

  destroy(): void {
    this.destroyRoomAnimations();
    this.roomSignature = '';
    if (this.root?.isValid) this.root.destroy();
    this.root = undefined; this.parent = undefined; this.state = undefined;
  }

  private renderMail(): void {
    const wnd = this.window('MailWnd', WINDOW_W, 473, 277 + WINDOW_W / 2 - 600, 300 - (70 + 473 / 2), 'youjian', '邮件');
    const mail = rows(this.state!.social.mail);
    const left = this.ui.node(wnd, 'LeftMail', 324, 369, -174, -2);
    const right = this.ui.node(wnd, 'RightMail', 324, 369, 171, -2);
    this.safeSkin(left, 'MailListBackground', 'yjliebiao_2', 324, 344, 0, 1);
    this.ui.label(left, 'MailListTitle', '全部邮件', 0, 163, 290, 26, 17, Theme.gold);
    this.ui.button(right, 'Mail:Compose', this.composingMail ? '返回邮件' : '写信', 116, 163, 78, 27, () => {
      this.composingMail = !this.composingMail; this.redraw();
    });
    if (this.composingMail) this.renderMailComposer(right);
    else {
      const selected = mail.find(item => String(item.id) === this.selectedMail) ?? mail[0];
      if (selected) this.selectedMail = String(selected.id);
      this.mailRows(left, mail);
      this.safeSkin(right, 'MailContentBackground', String(selected?.from) === 'system' ? 'yjneirong_2' : 'yjneirong_3', 324, 344, 0, 1);
      this.renderMailDetail(right, selected);
    }
    // The source content bitmap is added after the compose control; keep the
    // interactive control above it instead of letting the paper cover it.
    right.getChildByName('Mail:Compose')?.setSiblingIndex(right.children.length - 1);
    const claimable = mail.filter(item => !item.claimed && item.attachment);
    const deletable = mail.filter(item => Boolean(item.claimed));
    this.ui.button(wnd, 'Mail:ClaimAll', '领取全部', -260, -203, 116, 27, () => this.callbacks.choose('选择要领取的邮件', claimable.map(item => ({
      label: String(item.title ?? '邮件'), action: 'mail.claim', payload: { mailId: item.id },
    }))), claimable.length === 0);
    this.ui.button(wnd, 'Mail:DeleteAll', '删除已领', -128, -203, 116, 27, () => this.callbacks.choose('选择要删除的邮件', deletable.map(item => ({
      label: String(item.title ?? '邮件'), action: 'mail.delete', payload: { mailId: item.id },
    }))), deletable.length === 0);
  }

  private mailRows(parent: Node, items: Row[]): void {
    const page = this.pageSlice('mail', items, 5);
    if (!page.items.length) this.ui.label(parent, 'MailEmpty', '暂无邮件', 0, 0, 260, 40, 16, Theme.dim);
    page.items.forEach((item, index) => {
      const selected = String(item.id) === this.selectedMail;
      const node = this.ui.button(parent, `MailRow:${item.id}`, '', 0, 116 - index * 60, 313, 60, () => {
        this.selectedMail = String(item.id); this.composingMail = false;
        if (!item.read) this.callbacks.run('mail.read', { mailId: item.id });
        this.redraw();
      }, false, !selected);
      this.safeSkin(node, 'SourceRow', selected ? 'yjliebiao_4' : 'yjliebiao_3', 313, 60);
      this.ui.label(node, 'Title', `${item.read ? '' : '● '}${String(item.title ?? '无标题')}`, -1, 8, 290, 20, 13, selected ? Theme.gold : Theme.text, true);
      this.ui.label(node, 'From', this.characterName(item.from), -1, -12, 290, 15, 10, Theme.dim, true);
    });
    this.pager(parent, 'mail', page.pages, page.index, 0, -161);
  }

  private renderMailDetail(parent: Node, mail?: Row): void {
    if (!mail) { this.ui.label(parent, 'MailPrompt', '从左侧选择邮件', 0, 0, 260, 40, 16, Theme.dim); return; }
    this.ui.label(parent, 'MailTitle', String(mail.title ?? '无标题'), 0, 130, 286, 30, 18, Theme.gold);
    this.ui.label(parent, 'MailSender', `发件人：${this.characterName(mail.from)}`, 0, 102, 286, 20, 12, Theme.dim, true);
    this.ui.label(parent, 'MailText', String(mail.text ?? ''), 0, 5, 280, 165, 15, Theme.text, true);
    if (mail.attachment) this.ui.label(parent, 'Attachment', `附件：${this.goodsLabel(mail.attachment)}`, 0, -93, 280, 24, 13, Theme.gold, true);
    this.ui.button(parent, 'Mail:Claim', '领取附件', -75, -145, 124, 30,
      () => this.callbacks.run('mail.claim', { mailId: mail.id }), Boolean(mail.claimed || !mail.attachment));
    this.ui.button(parent, 'Mail:Delete', '删除邮件', 75, -145, 124, 30,
      () => this.callbacks.run('mail.delete', { mailId: mail.id }), !Boolean(mail.claimed));
  }

  private renderMailComposer(parent: Node): void {
    this.ui.label(parent, 'ComposeTitle', '写信', 0, 129, 270, 28, 18, Theme.gold);
    const target = this.ui.input(parent, 'MailTarget', '收件角色名称', 0, 86, 280);
    const title = this.ui.input(parent, 'MailTitleInput', '标题', 0, 35, 280);
    const body = this.ui.input(parent, 'MailBodyInput', '正文', 0, -16, 280);
    this.ui.label(parent, 'Postage', '邮资 1 银币', 0, -70, 270, 20, 12, Theme.dim);
    this.ui.button(parent, 'Mail:Send', '发送', 0, -133, 150, 34, () => {
      this.callbacks.run('mail.send', { target: target.string, title: title.string, text: body.string });
      this.composingMail = false;
    });
  }

  private renderTasks(): void {
    const wnd = this.window('TaskWnd', WINDOW_W, WINDOW_H, 280 + WINDOW_W / 2 - 600, WINDOW_Y, 'renwu', '任务');
    this.safeSkin(wnd, 'TaskBackground', 'yjdi', 687, 399, 0, -8);
    const left = this.ui.node(wnd, 'TaskLeftPane', 195, 369, -225, -8);
    const right = this.ui.node(wnd, 'TaskRightPane', 430, 369, 104, -8);
    const tutorialStep = Number(this.state!.actor.tutorialStep ?? 0);
    const tutorial: Row = { id: 'tutorial', name: `新手引导 ${Math.min(tutorialStep + 1, 4)}/4`,
      detail: ['领取出征补给', '保存一次合法卡组', '完成一场战斗', '取得PVE胜利'][tutorialStep] ?? '引导已完成',
      reward: 20, ready: tutorialStep < 4, claimed: tutorialStep >= 4, tutorial: true };
    const tasks: Row[] = [tutorial, ...rows(this.state!.tasks)];
    const selected = tasks.find(task => String(task.id) === this.selectedTask) ?? tasks[0];
    if (selected) this.selectedTask = String(selected.id);
    this.ui.label(left, 'TaskFolder', '任务目录', 0, 163, 170, 25, 16, Theme.gold);
    const page = this.pageSlice('tasks', tasks, 8);
    page.items.forEach((task, index) => this.ui.button(left, `Task:${task.id}`, `${task.claimed ? '✓ ' : task.ready ? '◆ ' : '◇ '}${String(task.name)}`,
      0, 126 - index * 38, 168, 32, () => { this.selectedTask = String(task.id); this.redraw(); }, false, String(task.id) !== this.selectedTask));
    this.pager(left, 'tasks', page.pages, page.index, 0, -163);
    if (selected) this.renderTaskDetail(right, selected);
  }

  private renderTaskDetail(parent: Node, task: Row): void {
    this.ui.label(parent, 'TaskName', String(task.name ?? '任务'), 0, 142, 390, 32, 20, Theme.gold);
    this.ui.label(parent, 'TaskDescription', String(task.detail ?? ''), 0, 48, 380, 130, 16, Theme.text, true);
    this.ui.label(parent, 'TaskPrizeTitle', '任务奖励', -130, -63, 120, 24, 15, Theme.gold, true);
    this.ui.panel(parent, 'TaskPrizeBox', 92, 64, -113, -112, new Color(20, 35, 36), Theme.gold);
    this.ui.label(parent, 'TaskReward', `${Number(task.reward ?? 0)} 银币`, -113, -112, 86, 24, 13, Theme.text);
    const action = task.tutorial ? 'tutorial.advance' : 'task.claim';
    const payload = task.tutorial ? {} : { taskId: task.id };
    this.ui.button(parent, 'Task:Claim', task.claimed ? '已完成' : task.ready ? '领取奖励' : '尚未完成', 110, -125, 155, 38,
      () => this.callbacks.run(action, payload), Boolean(task.claimed || !task.ready));
    this.safeSkin(parent, 'TaskClaimArt', 'lqjl_4', 133, 31, 110, -125);
  }

  private renderSocial(): void {
    const wnd = this.ui.node(this.root!, 'SocialWnd', 279, 509, 429.5, 25.5);
    this.safeSkin(wnd, 'SocialBackground', 'sjbeijing_1', 279, 509);
    this.ui.label(wnd, 'SocialTitle', '社交', 0, 229, 210, 29, 19, Theme.gold);
    this.closeButton(wnd, 115, 228);
    const actor = this.state!.actor;
    this.ui.label(wnd, 'PlayerInfo', `Lv.${actor.level ?? 1}  ${actor.name ?? ''}\n公会：${this.guildName(actor.guildId)}`, 0, 183, 244, 55, 13, Theme.text, true);
    const search = this.ui.input(wnd, 'FriendSearch', '输入角色名称', -25, 142, 180);
    this.safeSkin(wnd, 'FriendSearchArt', 'sousuoanjian_2', 19, 18, 98, 142);
    this.ui.button(wnd, 'Friend:Add', '', 98, 142, 38, 30, () => this.callbacks.run('friend.request', { target: search.string }), false, true);
    const tabs: Array<[typeof this.socialTab, string]> = [['friends', '好友'], ['requests', '申请'], ['chat', '聊天']];
    tabs.forEach(([id, label], index) => {
      const x = -86 + index * 86;
      if (id === 'friends') this.safeSkin(wnd, 'FriendsTabArt', this.socialTab === id ? 'bqhaoyou_1.png' : 'bqhaoyou_2.png', 79, 23, x, 104);
      this.ui.button(wnd, `SocialTab:${id}`, label, x, 104, 76, 28,
        () => { this.socialTab = id; this.redraw(); }, this.socialTab === id, id === 'friends');
    });
    if (this.socialTab === 'friends') this.renderFriends(wnd);
    else if (this.socialTab === 'requests') this.renderRequests(wnd);
    else this.renderChat(wnd);
    this.safeSkin(wnd, 'GuildTabArt', 'bqgonghui_2.png', 79, 23, -70, -222);
    this.ui.button(wnd, 'Social:Guild', '', -70, -222, 79, 23, () => this.callbacks.navigate('guild'), false, true);
    this.safeSkin(wnd, 'AddFriendArt', 'sjjiaohaoyou_1', 103, 31, 70, -222);
    this.ui.button(wnd, 'Social:World', '世界发言', 70, -222, 103, 31, () => { this.socialTab = 'chat'; this.redraw(); }, false, true);
  }

  private renderFriends(parent: Node): void {
    const friends = rows(this.state!.social.friends);
    const page = this.pageSlice('friends', friends, 7);
    if (!page.items.length) this.ui.label(parent, 'FriendsEmpty', '暂无好友', 0, -20, 220, 40, 15, Theme.dim);
    page.items.forEach((friend, index) => this.ui.button(parent, `Friend:${friend.id}`, `${String(friend.name)} · Lv.${Number(friend.level ?? 1)}`,
      0, 85 - index * 42, 244, 34, () => this.callbacks.choose(String(friend.name), [
        { label: '发送私聊', action: 'chat.send', payload: { channel: 'private', target: friend.name }, fields: [{ key: 'text', label: '消息' }] },
        { label: '移除好友', action: 'friend.remove', payload: { target: friend.id } },
      ])));
    this.pager(parent, 'friends', page.pages, page.index, 0, -198);
  }

  private renderRequests(parent: Node): void {
    const requests = rows(this.state!.social.friendRequests).filter(item => String(item.to) === this.characterId);
    const page = this.pageSlice('requests', requests, 6);
    if (!page.items.length) this.ui.label(parent, 'RequestsEmpty', '暂无好友申请', 0, -20, 220, 40, 15, Theme.dim);
    page.items.forEach((request, index) => this.ui.button(parent, `Request:${request.id}`, `${this.characterName(request.from)} 申请好友`,
      0, 82 - index * 47, 244, 38, () => this.callbacks.run('friend.accept', { requestId: request.id })));
    this.pager(parent, 'requests', page.pages, page.index, 0, -198);
  }

  private renderChat(parent: Node): void {
    const chat = rows(this.state!.social.chat).slice().reverse();
    const page = this.pageSlice('chat', chat, 4);
    page.items.forEach((message, index) => {
      this.ui.label(parent, `ChatFrom:${index}`, `${this.characterName(message.from)} · ${String(message.channel ?? '')}`, 0, 86 - index * 43, 238, 17, 11, Theme.gold, true);
      this.ui.label(parent, `ChatText:${index}`, String(message.text ?? ''), 0, 69 - index * 43, 238, 20, 12, Theme.text, true);
    });
    this.pager(parent, 'chat', page.pages, page.index, 0, -88);
    const target = this.ui.input(parent, 'PrivateTarget', '私聊角色名称', -25, -126, 180);
    const input = this.ui.input(parent, 'ChatInput', '输入消息', -25, -169, 180);
    this.ui.button(parent, 'Chat:World', '世界', 98, -126, 55, 34, () => this.callbacks.run('chat.send', { channel: 'world', text: input.string }));
    this.ui.button(parent, 'Chat:Private', '私聊', 98, -169, 55, 34, () => this.callbacks.run('chat.send', { channel: 'private', target: target.string, text: input.string }));
  }

  private renderGuild(): void {
    const wnd = this.root!;
    this.safeSkin(wnd, 'GuildBackground', 'gonghuidating_1', 1200, 600);
    this.closeButton(wnd, 565, 270);
    const guilds = rows(this.state!.social.guilds);
    const mine = guilds.find(guild => String(guild.id) === String(this.state!.actor.guildId ?? ''));
    if (!mine) { this.renderGuildBrowser(wnd, guilds); return; }
    const members = strings(mine.members);
    const info = this.ui.node(wnd, 'GuildInfoPane', 380, 405, -390, 100);
    const membersPane = this.ui.node(wnd, 'GuildMemberPane', 700, 300, 200, -22);
    const leftActions = this.ui.node(wnd, 'GuildLeftActions', 400, 95, -390, -128);
    const rightActions = this.ui.node(wnd, 'GuildRightActions', 160, 400, 505, -5);
    this.ui.label(info, 'GuildName', String(mine.name ?? '公会'), 0, 152, 340, 31, 21, Theme.gold);
    this.ui.label(info, 'GuildSummary', `等级 ${Number(mine.level ?? 1)}\n成员 ${members.length} 人\n公会资金 ${Number(mine.treasury ?? 0)}`, 0, 100, 340, 67, 14, Theme.text, true);
    this.ui.label(info, 'GuildNotice', String(mine.notice ?? '欢迎加入公会'), 0, -40, 340, 150, 13, Theme.text, true);
    this.ui.label(membersPane, 'GuildMembersTitle', '成员列表', 0, 130, 630, 25, 17, Theme.gold);
    const memberPage = this.pageSlice('guild-members', members.map(id => ({ id })), 6);
    memberPage.items.forEach((entry, index) => { const id = String(entry.id); const person = this.person(id);
      const y = 91 - index * 38;
      this.ui.button(membersPane, `GuildMember:${id}`, '', 0, y, 640, 31, () => {
      if (id === this.characterId) return;
      this.callbacks.choose(this.characterName(id), [{ label: '移交会长', action: 'guild.transfer', payload: { target: id }, disabled: String(mine.leader) !== this.characterId }]);
      }, false, true);
      this.ui.label(membersPane, `GuildMemberName:${id}`, this.characterName(id), -245, y, 145, 23, 13, Theme.text, true);
      this.ui.label(membersPane, `GuildMemberLevel:${id}`, `Lv.${Number(person?.level ?? 1)}`, -112, y, 75, 23, 12, Theme.dim);
      this.ui.label(membersPane, `GuildMemberJob:${id}`, PROFESSION_NAMES[Number(person?.profession ?? 0)] ?? '成员', 3, y, 100, 23, 12, Theme.dim);
      this.ui.label(membersPane, `GuildMemberRole:${id}`, String(mine.leader) === id ? '会长' : '会员', 127, y, 100, 23, 12, Theme.dim);
    });
    this.pager(membersPane, 'guild-members', memberPage.pages, memberPage.index, 0, -137);
    const actions: ActionItem[] = [
      { label: '捐献银币', detail: `当前资金 ${Number(mine.treasury ?? 0)}`, action: 'guild.donate', fields: [{ key: 'amount', label: '银币数量', type: 'number', value: 100 }] },
      { label: '公会聊天', action: 'chat.send', payload: { channel: 'guild' }, fields: [{ key: 'text', label: '消息' }] },
      { label: '升级生命技能', action: 'guild.upgrade', payload: { skill: 'vitality' }, disabled: String(mine.leader) !== this.characterId },
      { label: '升级收入技能', action: 'guild.upgrade', payload: { skill: 'income' }, disabled: String(mine.leader) !== this.characterId },
      ...strings(mine.applications).map(id => ({ label: `接受 ${this.characterName(id)} 入会`, action: 'guild.accept', payload: { target: id }, disabled: String(mine.leader) !== this.characterId })),
      { label: '城战报名与出征', action: '', detail: '进入公会城战', payload: { local: 'clanwar' } },
      { label: '退出公会', action: 'guild.leave' },
    ];
    const primary = actions.slice(0, 2);
    primary.forEach((item, index) => this.actionRow(leftActions, item, 23 - index * 45, 185, () => this.execute(item)));
    const remaining = actions.slice(2);
    const page = this.pageSlice('guild-actions', remaining as unknown as Row[], 7);
    (page.items as unknown as ActionItem[]).forEach((item, index) => this.actionRow(rightActions, item, 145 - index * 45, 145, () => {
      if (item.payload?.local === 'clanwar') this.callbacks.navigate('growth', 'clan-war'); else this.execute(item);
    }));
    this.pager(rightActions, 'guild-actions', page.pages, page.index, 0, -180);
  }

  private renderGuildBrowser(parent: Node, guilds: Row[]): void {
    const list = this.ui.node(parent, 'GuildListPane', 700, 360, 200, -5);
    this.safeSkin(list, 'GuildListArt', 'gonghuiliebiao', 671, 301, 0, -5);
    this.ui.label(list, 'GuildListTitle', '公会列表', 0, 160, 620, 28, 19, Theme.gold);
    const page = this.pageSlice('guild-list', guilds, 6);
    page.items.forEach((guild, index) => this.ui.button(list, `Guild:${guild.id}`, `${String(guild.name ?? '公会')}　成员 ${strings(guild.members).length}　资金 ${Number(guild.treasury ?? 0)}`,
      0, 112 - index * 42, 620, 34,
      () => this.callbacks.info(String(guild.name), `${strings(guild.members).length} 位成员\n公会资金 ${Number(guild.treasury ?? 0)}`, [
        { label: '申请加入', action: 'guild.apply', payload: { guildId: guild.id } },
      ]), false, true));
    this.pager(list, 'guild-list', page.pages, page.index, 0, -154);
    const info = this.ui.node(parent, 'GuildBrowserInfo', 380, 405, -390, 100);
    this.ui.label(info, 'NoGuild', '尚未加入公会', 0, 94, 330, 38, 21, Theme.gold);
    this.ui.label(info, 'NoGuildHint', '从公会列表申请加入，\n或创建自己的公会。', 0, 24, 330, 70, 15, Theme.text);
    this.ui.button(info, 'Guild:Create', '创建公会 · 100银币', 0, -72, 250, 40, () => this.callbacks.action({
      label: '创建公会', action: 'guild.create', fields: [{ key: 'name', label: '公会名称' }],
    }));
  }

  private renderTrade(): void {
    const wnd = this.ui.node(this.root!, 'TradeCityWnd', 1200, 600);
    this.safeSkin(wnd, 'TradeBackground', 'tradecitywnd', 1200, 600);
    this.ui.label(wnd, 'TradeTitle', '交易与拍卖', -420, 268, 330, 34, 25, Theme.gold, true);
    this.closeButton(wnd, 565, 270);
    const inventory = Object.entries(this.state!.actor.inventory ?? {}).filter(([, count]) => Number(count) > 0);
    const spareCards = Object.entries(this.state!.actor.cards ?? {}).filter(([id, count]) => Number(count) > (this.state!.actor.deck ?? []).filter(card => card === id).length);
    const assets = [...inventory.map(([id, count]) => ({ kind: 'item', id, count: Number(count) })), ...spareCards.map(([id, count]) => ({ kind: 'card', id, count: Number(count) }))];
    const assetPane = this.ui.node(wnd, 'TradeAssets', 300, 500, -430, -10);
    this.ui.label(assetPane, 'AssetsTitle', '可交易资产', 0, 222, 270, 26, 17, Theme.gold);
    const assetPage = this.pageSlice('trade-assets', assets as unknown as Row[], 8);
    (assetPage.items as unknown as Array<{kind: string; id: string; count: number}>).forEach((asset, index) => {
      const tile = this.ui.button(assetPane, `TradeAsset:${asset.id}`, '', 0, 181 - index * 49, 270, 42, () => this.offerAsset(asset));
      const icon = this.state!.assetIcons?.[asset.id];
      if (icon) void this.ui.image(tile, 'Icon', `${this.base}/recovered/${icon.replace(/^\//, '')}`, 34, 34, -108, 0);
      this.ui.label(tile, 'Name', `${asset.kind === 'card' ? '卡牌' : '物品'} · ${this.assetName(asset.id)} ×${asset.count}`, 18, 0, 215, 24, 12, Theme.text, true);
    });
    this.pager(assetPane, 'trade-assets', assetPage.pages, assetPage.index, 0, -222);
    this.ui.button(wnd, 'TradeTab:Offers', '玩家交易', -130, 230, 160, 32, () => { this.tradeTab = 'trade'; this.redraw(); }, this.tradeTab === 'trade');
    this.ui.button(wnd, 'TradeTab:Auctions', '拍卖行', 50, 230, 160, 32, () => { this.tradeTab = 'auction'; this.redraw(); }, this.tradeTab === 'auction');
    const listings = this.tradeTab === 'trade' ? rows(this.state!.social.trades).filter(item => item.status === 'open') : rows(this.state!.social.auctions).filter(item => item.status === 'open');
    this.renderTradeListings(wnd, listings);
  }

  private offerAsset(asset: {kind: string; id: string; count: number}): void {
    const payload = { kind: asset.kind, id: asset.id, quantity: 1 };
    this.callbacks.choose(`${this.assetName(asset.id)} · 选择操作`, [
      { label: '指定玩家交易', action: 'trade.offer', payload, fields: [{ key: 'target', label: '对方角色名称' }, { key: 'price', label: '银币价格', type: 'number', value: 10 }] },
      { label: '上架拍卖', action: 'auction.list', payload, fields: [{ key: 'price', label: '起拍银币', type: 'number', value: 10 }, { key: 'buyout', label: '一口价', type: 'number', value: 20 }] },
      { label: '邮寄给玩家', action: 'mail.send', payload: { title: '好友赠礼', text: `一份${this.assetName(asset.id)}赠礼。`, attachment: payload }, fields: [{ key: 'target', label: '收件角色名称' }] },
    ]);
  }

  private renderTradeListings(parent: Node, listings: Row[]): void {
    const page = this.pageSlice(`trade:${this.tradeTab}`, listings, 8);
    if (!page.items.length) this.ui.label(parent, 'TradeEmpty', this.tradeTab === 'trade' ? '暂无交易委托' : '暂无拍卖', 155, 0, 520, 50, 18, Theme.dim);
    page.items.forEach((item, index) => {
      const col = index % 2; const row = Math.floor(index / 2); const x = -90 + col * 335; const y = 174 - row * 102;
      const goods = record(item.goods); const node = this.ui.button(parent, `Listing:${item.id}`, '', x, y, 315, 88, () => this.openListing(item));
      const icon = this.state!.assetIcons?.[String(goods.id ?? '')];
      if (icon) void this.ui.image(node, 'GoodsIcon', `${this.base}/recovered/${icon.replace(/^\//, '')}`, 54, 54, -112, 4);
      this.ui.label(node, 'ListingName', this.goodsLabel(goods), 22, 18, 220, 24, 14, Theme.gold, true);
      const detail = this.tradeTab === 'trade' ? `${this.characterName(item.from)} → ${this.characterName(item.to)} · ${Number(item.price)}银币`
        : `卖家 ${this.characterName(item.seller)} · 当前 ${Number(item.bid || item.minimum)} · 一口价 ${Number(item.buyout)}`;
      this.ui.label(node, 'ListingDetail', detail, 22, -14, 220, 36, 11, Theme.text, true);
    });
    this.pager(parent, `trade:${this.tradeTab}`, page.pages, page.index, 80, -260);
  }

  private openListing(item: Row): void {
    if (this.tradeTab === 'trade') {
      const mine = String(item.from) === this.characterId;
      this.callbacks.info('交易委托', `${this.goodsLabel(item.goods)}\n价格 ${Number(item.price)} 银币`, [
        { label: mine ? '撤回交易' : '接受交易', action: mine ? 'trade.cancel' : 'trade.accept', payload: { tradeId: item.id } },
      ]); return;
    }
    const mine = String(item.seller) === this.characterId;
    this.callbacks.choose('拍卖操作', mine ? [{ label: '撤回拍卖', action: 'auction.cancel', payload: { auctionId: item.id } }] : [
      { label: '参与竞价', action: 'auction.bid', payload: { auctionId: item.id }, fields: [{ key: 'amount', label: '竞价银币', type: 'number', value: Math.max(Number(item.minimum), Number(item.bid) + 1) }] },
      { label: `一口价 ${Number(item.buyout)}`, action: 'auction.buy', payload: { auctionId: item.id } },
    ]);
  }

  private renderRooms(): void {
    const wnd = this.root!;
    const rooms = rows(this.state!.rooms); const invites = rows(this.state!.roomInvites);
    const selected = rooms.find(room => String(room.id) === this.selectedRoom);
    this.safeSkin(wnd, 'RoomBackground', selected ? 'PVPfjbeijing' : 'PVPfjlb', 1200, 600);
    this.safeSkin(wnd, 'RoomCloseBackground', 'guanbidi_bg', 95, 59, 552, 264);
    this.safeSkin(wnd, 'RoomCloseArt', 'guanbidi_1', 42, 41, 567, 270);
    this.ui.button(wnd, 'Close', '', 567, 270, 46, 44, () => this.callbacks.close(), false, true);
    if (selected) { this.renderRoomInterior(wnd, selected); return; }
    this.ui.label(wnd, 'RoomsTitle', '房间列表', -430, 265, 340, 36, 26, Theme.gold, true);
    this.ui.button(wnd, 'Room:CreatePvp', '创建竞技房间', 485, 175, 165, 34, () => { this.creatingPvp = true; this.redraw(); });
    this.ui.button(wnd, 'Room:Ranked', '创建天梯房间', 485, 126, 165, 34, () => this.callbacks.run('room.create', { mode: 'ranked' }));
    this.ui.button(wnd, 'Room:Coop', '合作关卡', 485, 77, 165, 34, () => this.callbacks.navigate('world'));
    this.ui.button(wnd, 'Room:Tournament', '竞技赛', 485, 28, 165, 34, () => this.callbacks.navigate('growth', 'tournament'));
    if (this.creatingPvp) { this.renderPvpCreation(wnd); return; }
    const all = [...invites.map(item => ({ ...item, invite: true })), ...rooms];
    const page = this.pageSlice('rooms', all, 6);
    page.items.forEach((room, index) => {
      const x = -417 + (index % 3) * 313; const y = 142 - Math.floor(index / 3) * 133;
      const item = room as Row;
      const label = item.invite ? `${this.characterName(item.from)} 的邀请` : `${MODE_NAMES[String(item.mode)] ?? String(item.mode)} · ${this.characterName(item.host)}`;
      const members = strings(item.members);
      const tile = this.ui.node(wnd, `RoomTile:${item.id ?? item.roomId}`, 299, 125, x, y);
      if (!this.safeSkin(tile, 'RoomTileArt', 'fangjianliebiaoditu', 299, 125))
        this.ui.panel(tile, 'RoomTileFallback', 299, 125, 0, 0, new Color(13, 34, 38, 218), Theme.gold);
      if (item.invite || item.mode === 'pvp' || item.mode === 'ranked')
        this.safeSkin(tile, 'RoomTypeArt', 'PVPjingjizhan', 284, 61, 0, 29);
      this.ui.button(tile, `Room:${item.id ?? item.roomId}`, '', 0, 0, 299, 125, () => {
        if (item.invite) this.callbacks.run('room.join', { roomId: item.roomId });
        else if (!members.includes(this.characterId)) this.callbacks.run('room.join', { roomId: item.id });
        else { this.selectedRoom = String(item.id); this.redraw(); }
      }, false, true);
      this.ui.label(tile, 'RoomName', label, -64, -24, 140, 20, 14, Theme.gold, true);
      this.ui.label(tile, 'RoomCount', `${members.length}/${Number(item.capacity ?? 2)}`, 109, 23, 36, 20, 13, Theme.text);
      this.ui.label(tile, 'RoomState', item.invite ? '接受邀请' : this.roomStatus(item.status), 71, -33, 80, 20, 12, Theme.text);
    });
    if (!page.items.length) this.ui.label(wnd, 'RoomsEmpty', '暂无公开房间', -105, 35, 700, 42, 17, Theme.dim);
    this.pager(wnd, 'rooms', page.pages, page.index, -105, -82);
  }

  private renderPvpCreation(parent: Node): void {
    const panel = this.ui.panel(parent, 'CreatePvpPane', 720, 310, -105, 28, new Color(12, 29, 31, 238), Theme.gold);
    this.ui.label(panel, 'CreatePvpTitle', '创建竞技房间', 0, 118, 620, 34, 23, Theme.gold);
    this.ui.label(panel, 'CreatePvpType', '对战类型', -270, 63, 105, 25, 15, Theme.text, true);
    this.safeSkin(panel, 'CreatePvp:CompetitiveArt', 'PVPjingjizhan', 284, 61, -70, 63);
    this.ui.button(panel, 'CreatePvp:Competitive', '', -70, 63, 284, 61, () => undefined, false, true);
    this.safeSkin(panel, 'CreatePvp:PracticeArt', 'PVPlianxisai', 284, 61, 224, 63);
    this.ui.label(panel, 'CreatePvp:PracticeUnavailable', '服务未开放', 224, 63, 110, 22, 12, Theme.dim);
    this.ui.label(panel, 'CreatePvpCapacity', '队伍人数', -195, 7, 160, 25, 15, Theme.text, true);
    ([1, 2, 4] as const).forEach((teamSize, index) => this.ui.button(panel, `CreatePvp:${teamSize}`,
      `${this.roomTeamSize === teamSize ? '●' : '○'} ${teamSize}V${teamSize}`, -55 + index * 145, 7, 126, 34,
      () => { this.roomTeamSize = teamSize; this.redraw(); }, false, true));
    this.ui.label(panel, 'CreatePvpHint', `房间容量 ${this.roomTeamSize * 2} 人`, 0, -48, 560, 25, 13, Theme.dim);
    this.ui.button(panel, 'CreatePvp:Confirm', '创建房间', -92, -105, 160, 40,
      () => this.callbacks.run('room.create', { mode: 'pvp', teamSize: this.roomTeamSize }));
    this.ui.button(panel, 'CreatePvp:Cancel', '返回列表', 92, -105, 160, 40, () => { this.creatingPvp = false; this.redraw(); });
  }

  private renderRoomInterior(parent: Node, room: Row): void {
    const members = strings(room.members); const ready = record(room.ready);
    this.ui.label(parent, 'RoomName', `${MODE_NAMES[String(room.mode)] ?? String(room.mode)}房间`, -420, 264, 420, 34, 24, Theme.gold, true);
    this.safeSkin(parent, 'RoomInfoIcon', 'PVPfjxx', 62, 65, 396, 217);
    this.ui.label(parent, 'RoomIndex', String(room.id ?? '').slice(-5), 480, 267, 120, 24, 14, Theme.gold, true);
    this.ui.label(parent, 'RoomOwner', this.characterName(room.host), 480, 235, 140, 23, 13, Theme.text, true);
    this.ui.label(parent, 'RoomMode', MODE_NAMES[String(room.mode)] ?? String(room.mode), 480, 207, 140, 23, 13, Theme.text, true);
    this.ui.label(parent, 'RoomCount', `${members.length}/${Number(room.capacity ?? 2)}`, 480, 177, 140, 23, 13, Theme.text, true);
    const myRanking = rows(this.state!.rankings).find(item => String(item.id) === this.characterId);
    this.safeSkin(parent, 'PlayerRecordIcon', 'PVPgrxx', 93, 84, 407, -10);
    this.ui.label(parent, 'PlayerRecord', `${Number(myRanking?.rating ?? 0)}\n—\n—`, 500, -10, 100, 84, 13, Theme.text, true);
    const capacity = Math.max(2, Number(room.capacity ?? 2));
    for (let index = 0; index < capacity; index++) {
      const member = members[index]; const grid = Math.floor(index / 4); const withinGrid = index % 4;
      const col = withinGrid % 2; const row = Math.floor(withinGrid / 2);
      const panel = this.ui.node(parent, `RoomSeat:${index}`, 227, 205, -474 + col * 237 + grid * 474, 163 - row * 215);
      if (!member) {
        this.safeSkin(panel, 'OpenSeat', 'PVPfjrwbeijing_3', 182, 45, 0, -58);
        this.ui.label(panel, 'EmptySeat', '等待玩家', 0, 18, 190, 30, 15, Theme.dim);
        continue;
      }
      const person = this.person(member);
      this.renderRoomActor(panel, member, person);
      this.ui.label(panel, 'MemberName', `${this.characterName(member)}  Lv.${Number(person?.level ?? 1)}`, 0, 80, 205, 25, 15, Theme.gold);
      this.ui.label(panel, 'MemberGuild', this.guildForPerson(member), 0, 54, 205, 20, 11, Theme.dim);
      if (String(room.host) === member) this.safeSkin(panel, 'HostStamp', 'fangzhu', 82, 25, -63, -85);
      if (ready[member]) this.safeSkin(panel, 'ReadyStamp', 'ready', 120, 84, -4, -5);
    }
    const mineReady = Boolean(ready[this.characterId]);
    if (String(room.status) === 'waiting') {
      this.sourceActionButton(parent, 'Room:Invite', 'fjyq_1.jpg', '邀请玩家', -5, -205, 164, 71, () => this.callbacks.action({
        label: '邀请玩家', action: 'room.invite', payload: { roomId: room.id }, fields: [{ key: 'target', label: '角色名称' }],
      }), false, 'game/data/img/ui/pvppve.swf#188');
      this.sourceActionButton(parent, 'Room:Ready', mineReady ? 'fjqx_1.jpg' : 'fjzb_1.jpg', mineReady ? '取消准备' : '准备', 160, -205, 164, 71,
        () => this.callbacks.run('room.ready', { roomId: room.id, ready: !mineReady }), false,
        mineReady ? undefined : 'game/data/img/ui/pvppve.swf#189');
      const startDisabled = String(room.host) !== this.characterId;
      this.sourceActionButton(parent, 'Room:Start', 'fjks_1.jpg', '开始战斗', 330, -205, 164, 71,
        () => this.callbacks.run('room.start', { roomId: room.id }), startDisabled, 'game/data/img/ui/gonggongchuangkou.swf#243');
      this.ui.button(parent, 'Room:Leave', '离开房间', 500, -218, 145, 30, () => {
        this.selectedRoom = ''; this.callbacks.run('room.leave', { roomId: room.id });
      }, false, true);
      this.ui.button(parent, 'Room:Back', '返回大厅', 500, -253, 145, 28, () => { this.selectedRoom = ''; this.redraw(); }, false, true);
    } else {
      this.ui.button(parent, 'Room:Resume', '继续战斗', 325, -205, 200, 42, () => this.callbacks.navigate('battle'));
      this.ui.button(parent, 'Room:Back', '返回大厅', 500, -205, 150, 42, () => { this.selectedRoom = ''; this.redraw(); });
    }
  }

  private renderRankings(): void {
    const wnd = this.root!;
    this.safeSkin(wnd, 'RankingBackground', 'paihangbangbeijing', 1200, 600);
    this.closeButton(wnd, 565, 270);
    const rankings = rows(this.state!.rankings);
    const winner = rankings[0];
    const podium = this.ui.node(wnd, 'WinnerPane', 359, 260, -360, 80);
    this.ui.label(podium, 'RankingTitle', '天梯赛季', 0, 104, 320, 34, 24, Theme.gold);
    if (winner) {
      this.ui.label(podium, 'WinnerCrown', 'Ⅰ', 0, 47, 90, 55, 38, Theme.gold);
      this.ui.label(podium, 'WinnerName', String(winner.name ?? ''), 0, 2, 300, 30, 20, Theme.text);
      this.ui.label(podium, 'WinnerScore', `${Number(winner.rating)} 分 · ${Number(winner.wins)}胜`, 0, -38, 300, 25, 14, Theme.dim);
    }
    this.sourceTab(wnd, 'Ranking:1v1', 'bqphb1V1_1', 'bqphb1V1_2', 70, 230, true, () => undefined);
    this.sourceTab(wnd, 'Ranking:2v2', 'bqphb2V2_1', 'bqphb2V2_2', 180, 230, false, () => this.callbacks.navigate('rooms'));
    this.sourceTab(wnd, 'Ranking:Tournament', 'bqjingjisai_1', 'bqjingjisai_2', 290, 230, false, () => this.callbacks.navigate('growth', 'tournament'));
    const pane = this.ui.node(wnd, 'RankingPane', 647, 450, 264, -5);
    const widths = [42, 200, 90, 96, 63, 128];
    const headers = ['名次', '玩家', '职业', '积分', '胜率', '等级'];
    let cursor = -309.5;
    const centers = widths.map(width => { const center = cursor + width / 2; cursor += width; return center; });
    headers.forEach((header, index) => this.ui.label(pane, `RankHeader:${index}`, header, centers[index], 188,
      widths[index], 24, 12, Theme.gold));
    const page = this.pageSlice('rankings', rankings, 10);
    page.items.forEach((rank, index) => {
      const y = 154 - index * 33; const own = String(rank.id) === this.characterId;
      if (own) this.ui.panel(pane, `RankRow:${rank.id}`, 619, 31, 0, y, new Color(72, 92, 73, 125), Theme.gold);
      const person = this.person(rank.id) ?? this.personByName(rank.name);
      const profession = PROFESSION_NAMES[Number(rank.profession ?? person?.profession ?? 0)] ?? '—';
      const wins = Number(rank.wins ?? 0); const losses = Number(rank.losses ?? 0);
      const winRate = wins + losses > 0 ? `${Math.round(wins / (wins + losses) * 100)}%` : '—';
      const values = [String(page.index * 10 + index + 1), String(rank.name ?? ''), profession,
        String(Number(rank.rating ?? 0)), winRate, `Lv.${Number(rank.level ?? person?.level ?? 1)}`];
      values.forEach((value, column) => this.ui.label(pane, `RankCell:${index}:${column}`, value, centers[column], y,
        widths[column] - 4, 23, column === 1 ? 13 : 12, own ? Theme.gold : column >= 4 ? Theme.dim : Theme.text, column === 1));
    });
    this.pager(pane, 'rankings', page.pages, page.index, 0, -201);
  }

  private renderSettings(): void {
    const width = 431; const height = 336;
    const wnd = this.ui.node(this.root!, 'SystemSetWnd', width, height, 420 + width / 2 - 600, 300 - (107 + height / 2));
    this.safeSkin(wnd, 'SettingsBackground', 'xtszbj_1', width, height);
    this.ui.label(wnd, 'SettingsTitle', '系统设置', 0, 147, 300, 30, 20, Theme.gold);
    this.closeButton(wnd, 184, 148);
    const current = this.state!.actor.settings ?? {};
    if (!Object.keys(this.settingsDraft).length) this.settingsDraft = {
      music: Boolean(current.music), sound: Boolean(current.sound),
      rejectPrivate: Boolean(current.rejectPrivate), rejectInvites: Boolean(current.rejectInvites),
    };
    this.ui.label(wnd, 'AudioHeading', '声音设置', 0, 140, 400, 18, 12, Theme.dim);
    this.settingSlider(wnd, 'music', '背景音乐', 82);
    this.settingSlider(wnd, 'sound', '游戏音效', 52);
    this.ui.label(wnd, 'PrivacyHeading', '交互设置', 0, 1, 400, 18, 12, Theme.dim);
    this.settingCheck(wnd, 'rejectPrivate', '拒绝私聊', -103, -28);
    this.settingCheck(wnd, 'rejectInvites', '拒绝房间邀请', 91, -28);
    this.ui.button(wnd, 'Settings:Characters', '切换角色', -93, -77, 150, 30, () => this.callbacks.action({ label: '切换角色', action: 'local:characters' }));
    this.ui.button(wnd, 'Settings:Logout', '退出登录', 93, -77, 150, 30, () => this.callbacks.action({ label: '退出登录', action: 'local:logout' }));
    this.ui.button(wnd, 'Settings:Save', '确定', -61, -112, 110, 32, () => this.callbacks.run('settings.save', { ...this.settingsDraft }));
    this.ui.button(wnd, 'Settings:Cancel', '取消', 61, -112, 110, 32, () => { this.settingsDraft = {}; this.callbacks.close(); });
  }

  private settingSlider(parent: Node, key: 'music' | 'sound', label: string, y: number): void {
    const enabled = Boolean(this.settingsDraft[key]);
    this.ui.label(parent, `SettingLabel:${key}`, label, -154, y, 110, 22, 14, Theme.text, true);
    this.ui.panel(parent, `SettingTrack:${key}`, 238, 8, 47, y, new Color(48, 69, 68), Theme.dim);
    this.ui.panel(parent, `SettingFill:${key}`, enabled ? 210 : 20, 8, enabled ? 33 : -62, y, enabled ? Theme.gold : Theme.dim);
    this.ui.button(parent, `SettingToggle:${key}`, enabled ? '开' : '关', 184, y, 48, 25, () => {
      this.settingsDraft[key] = !enabled; this.redraw();
    });
  }

  private settingCheck(parent: Node, key: 'rejectPrivate' | 'rejectInvites', label: string, x: number, y: number): void {
    const enabled = Boolean(this.settingsDraft[key]);
    this.ui.button(parent, `SettingCheck:${key}`, `${enabled ? '☑' : '☐'} ${label}`, x, y, 165, 29, () => {
      this.settingsDraft[key] = !enabled; this.redraw();
    }, false, true);
  }

  private window(name: string, width: number, height: number, x: number, y: number, titleSkin: string, titleText: string): Node {
    const wnd = this.ui.node(this.root!, name, width, height, x, y);
    this.ui.panel(wnd, `${name}:Fallback`, width - 12, height - 12, 0, 0, new Color(14, 28, 30, 215), Theme.gold);
    this.safeSkin(wnd, `${name}:Frame`, 'ckxiao', width, height);
    if (!this.safeSkin(wnd, `${name}:TitleArt`, titleSkin, 90, 28, 0, height / 2 - 27))
      this.ui.label(wnd, `${name}:Title`, titleText, 0, height / 2 - 27, width - 110, 28, 20, Theme.gold);
    this.closeButton(wnd, width / 2 - 31, height / 2 - 28);
    return wnd;
  }

  private closeButton(parent: Node, x: number, y: number): void {
    this.safeSkin(parent, 'CloseArt', 'guanbi', 38, 37, x, y);
    this.ui.button(parent, 'Close', '', x, y, 42, 40, () => this.callbacks.close(), false, true);
  }

  private actionRow(parent: Node, item: ActionItem, y: number, width: number, callback?: () => void): void {
    const node = this.ui.button(parent, `Action:${item.action}:${y}`, '', 0, y, width, 40, callback ?? (() => this.execute(item)), Boolean(item.disabled));
    this.ui.label(node, 'Label', item.label, 0, item.detail ? 8 : 0, width - 18, 21, 13, item.disabled ? Theme.dim : Theme.text, true);
    if (item.detail) this.ui.label(node, 'Detail', item.detail, 0, -10, width - 18, 17, 10, Theme.dim, true);
  }

  private execute(item: ActionItem): void {
    if (item.disabled || !item.action) return;
    if (item.fields?.length) this.callbacks.action(item); else this.callbacks.run(item.action, item.payload ?? {});
  }

  private pageSlice<T extends Row>(key: string, source: T[], size: number): {items: T[]; pages: number; index: number} {
    const pages = Math.max(1, Math.ceil(source.length / size));
    const index = Math.max(0, Math.min(this.pageByView.get(key) ?? 0, pages - 1));
    this.pageByView.set(key, index);
    return { items: source.slice(index * size, index * size + size), pages, index };
  }

  private pager(parent: Node, key: string, pages: number, index: number, x: number, y: number): void {
    if (pages <= 1) return;
    this.ui.button(parent, `${key}:Prev`, '‹', x - 55, y, 36, 25, () => { this.pageByView.set(key, index - 1); this.redraw(); }, index === 0);
    this.ui.label(parent, `${key}:Page`, `${index + 1}/${pages}`, x, y, 56, 23, 11, Theme.dim);
    this.ui.button(parent, `${key}:Next`, '›', x + 55, y, 36, 25, () => { this.pageByView.set(key, index + 1); this.redraw(); }, index >= pages - 1);
  }

  private safeSkin(parent: Node, nodeName: string, skin: string, width: number, height: number, x = 0, y = 0,
      variant?: string): boolean {
    try {
      const source = this.original.skin(skin, variant);
      void this.ui.image(parent, nodeName, `${this.base}/recovered/${source.file ?? `${source.path}.png`}`, width, height, x, y);
      return true;
    } catch { return false; }
  }

  private sourceActionButton(parent: Node, name: string, skin: string, label: string, x: number, y: number,
      width: number, height: number, callback: () => void, disabled = false, variant?: string): void {
    if (!this.safeSkin(parent, `${name}:Art`, skin, width, height, x, y, variant)) {
      this.ui.button(parent, name, label, x, y, width, Math.min(42, height), callback, disabled);
      return;
    }
    this.ui.button(parent, name, '', x, y, width, height, callback, disabled, true);
    if (disabled) this.ui.label(parent, `${name}:Disabled`, '房主可开始', x, y, width - 20, 24, 12, Theme.dim);
  }

  private sourceTab(parent: Node, name: string, normal: string, selected: string, x: number, y: number,
      active: boolean, callback: () => void): void {
    const skin = active ? selected : normal;
    if (!this.safeSkin(parent, `${name}:Art`, skin, 99, 29, x, y)) {
      this.ui.button(parent, name, name.split(':').at(-1) ?? '', x, y, 99, 29, callback, active);
      return;
    }
    this.ui.button(parent, name, '', x, y, 99, 29, callback, active, true);
  }

  private characterName(id: unknown): string {
    return String(this.state!.social.people.find(person => String(person.id) === String(id))?.name ?? (id === 'system' ? '系统' : id ?? ''));
  }

  private person(id: unknown): Row | undefined {
    if (String(id) === this.characterId || String(id) === String(this.state!.actor.id ?? '')) return this.state!.actor as Row;
    return this.state!.social.people.find(person => String(person.id) === String(id));
  }

  private personByName(name: unknown): Row | undefined {
    return this.state!.social.people.find(person => String(person.name) === String(name));
  }

  private renderRoomActor(panel: Node, member: string, person?: Row): void {
    const profession = Number(person?.profession);
    const explicitSex = person?.sex;
    const gender = person?.gender;
    // Existing characters predate the gender field. Match playerSpec and the
    // growth preview: only explicit gender 2 is female; absent legacy data is male.
    const sex = explicitSex === 0 || explicitSex === 1 ? explicitSex : gender === 2 ? 0 : 1;
    if (!Number.isInteger(profession) || profession < 1 || profession > 4) {
      this.ui.label(panel, `ActorIdentityMissing:${member}`, '角色身份数据缺失', 0, -2, 172, 34, 12, Theme.dim);
      return;
    }
    const host = this.ui.node(panel, `ActorPreview:${member}`, 185, 185, -14, -2);
    const animation = new RecoveredAnimation(host, this.catalog, `${this.base}/recovered/`);
    this.roomAnimations.add(animation);
    const loading = this.ui.label(host, 'PreviewLoading', '正在载入…', 0, 0, 140, 24, 12, Theme.dim).node;
    void animation.setActor(profession, sex as 0 | 1, true).then(() => {
      if (host.isValid && this.roomAnimations.has(animation))
        this.roomPreviewFits.set(animation, { panel, member, profession, loading, elapsed: 0 });
    }).catch(() => {
      if (!host.isValid || !this.roomAnimations.has(animation)) return;
      this.fallbackRoomActor(animation, { panel, member, profession, loading });
    });
  }

  private fallbackRoomActor(animation: RecoveredAnimation,
      pending: { panel: Node; member: string; profession: number; loading: Node }): void {
    this.roomPreviewFits.delete(animation);
    this.roomAnimations.delete(animation);
    animation.destroy();
    if (pending.loading.isValid) pending.loading.destroy();
    if (!pending.panel.isValid) return;
    this.safeSkin(pending.panel, `ActorFallback:${pending.member}`, PROFESSION_SKINS[pending.profession], 48, 48, -14, 1);
    this.ui.label(pending.panel, `ActorFallbackText:${pending.member}`, '角色动画无法显示', -14, -34, 170, 24, 11, Theme.dim);
  }

  private currentRoomSignature(): string {
    const room = rows(this.state?.rooms).find(item => String(item.id) === this.selectedRoom);
    if (!room) return '';
    const members = strings(room.members);
    return JSON.stringify({
      id: room.id, mode: room.mode, status: room.status, capacity: room.capacity, host: room.host,
      ready: record(room.ready),
      members: members.map(id => {
        const person = this.person(id);
        return [id, person?.name, person?.level, person?.profession, person?.gender, person?.sex, this.guildForPerson(id)];
      }),
      rating: rows(this.state?.rankings).find(item => String(item.id) === this.characterId)?.rating,
    });
  }

  private destroyRoomAnimations(): void {
    this.roomAnimations.forEach(animation => animation.destroy());
    this.roomAnimations.clear();
    this.roomPreviewFits.clear();
  }

  private guildForPerson(id: unknown): string {
    const guild = this.state!.social.guilds.find(item => strings(item.members).includes(String(id)));
    return String(guild?.name ?? '未加入公会');
  }

  private roomStatus(value: unknown): string {
    return value === 'battle' ? '战斗中' : value === 'settled' ? '已结束' : '等待中';
  }

  private guildName(id: unknown): string {
    return String(this.state!.social.guilds.find(guild => String(guild.id) === String(id))?.name ?? '未加入');
  }

  private assetName(id: unknown): string {
    const key = String(id ?? '');
    return this.state!.assetNames?.[key] ?? cardName(this.catalog,key);
  }

  private goodsLabel(value: unknown): string {
    const goods = record(value); return `${this.assetName(goods.id)} ×${Number(goods.quantity ?? 1)}`;
  }

  private redraw(): void {
    if (this.parent && this.state) this.render(this.parent, this.state, this.page, this.characterId);
  }
}
