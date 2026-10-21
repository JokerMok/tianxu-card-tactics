import { randomUUID } from 'node:crypto';
import { requireCount, requireText } from './store.mjs';

export const socialActions = ['friend.request', 'friend.accept', 'friend.remove', 'chat.send',
  'mail.send', 'mail.read', 'mail.claim', 'mail.delete', 'guild.create', 'guild.apply', 'guild.accept',
  'guild.leave', 'guild.transfer', 'guild.donate', 'guild.upgrade',
  'trade.offer', 'trade.accept', 'trade.cancel', 'auction.list', 'auction.bid', 'auction.buy', 'auction.cancel'];
const findCharacter = (world, id) => world.characters[id] ?? Object.values(world.characters).find(char => char.name === id);
const pairKey = (a, b) => [a, b].sort().join(':');
function credit(actor, amount, reason, now) {
  if (!Number.isSafeInteger(amount) || actor.currencies.silver + amount < 0) throw new Error('银币不足');
  actor.currencies.silver += amount;
  actor.economicLog.push({ id: randomUUID(), currency: 'silver', amount, reason, at: now });
}
function owned(actor, kind, id, quantity, content) {
  requireCount(quantity);
  const container = kind === 'card' ? actor.cards : kind === 'item' ? actor.inventory : null;
  if (!container || (container[id] ?? 0) < quantity) throw new Error('持有数量不足');
  if (actor.lockedItems?.includes(id) || actor.boundItems?.includes(id)) throw new Error('锁定或绑定物品不能交易');
  if (kind === 'item') {
    const itemId = Number(id.split(':').at(-1));
    const def = ['equipment', 'medicament', 'warrant'].flatMap(name => content.table(name))
      .find(row => Number(row['物品ID\n'] ?? row['物品ID'] ?? row.ID) === itemId);
    if (!def || Number(def['获取绑定'] ?? 0) === 1) throw new Error('此物品不可交易');
  }
  if (kind === 'card') {
    const raw = content.card(id).raw;
    if (Number(raw['Auction Reserve Price'] ?? -1) < 0) throw new Error('此卡牌不可交易');
    const used = actor.deck.filter(card => card === id).length;
    if (container[id] - quantity < used) throw new Error('请先从当前卡组移除要交易的卡牌');
  }
  return container;
}
function take(actor, goods, content) { owned(actor, goods.kind, goods.id, goods.quantity, content)[goods.id] -= goods.quantity; }
function give(actor, goods) {
  const container = goods.kind === 'card' ? actor.cards : actor.inventory;
  container[goods.id] = (container[goods.id] ?? 0) + goods.quantity;
}
function goodsFrom(payload) {
  if (!['card', 'item'].includes(payload.kind)) throw new Error('请选择卡牌或物品');
  const id = requireText(payload.id, '资产编号', 100);
  if (!new RegExp(`^main:${payload.kind}:\\d+$`).test(id)) throw new Error('资产编号无效');
  return { kind: payload.kind, id, quantity: requireCount(Number(payload.quantity)) };
}
function guildOf(world, actor, leader = false) {
  const guild = world.guilds[actor.guildId];
  if (!guild || !guild.members.includes(actor.id)) throw new Error('请先加入公会');
  if (leader && guild.leader !== actor.id) throw new Error('需要会长权限');
  return guild;
}
export function operateSocial(ctx, action, payload) {
  const { world, actor, content, now } = ctx;
  if (action === 'friend.request') {
    const other = findCharacter(world, payload.target);
    if (!other || other.id === actor.id) throw new Error('好友角色无效');
    const pair = pairKey(actor.id, other.id);
    if (world.friendships.includes(pair)) throw new Error('已经是好友');
    if (Object.values(world.friendRequests).some(req => pairKey(req.from, req.to) === pair)) throw new Error('已有待处理申请');
    const id = randomUUID(); world.friendRequests[id] = { id, from: actor.id, to: other.id, at: now };
    return { message: '好友申请已发送', id };
  }
  if (action === 'friend.accept') {
    const request = world.friendRequests[payload.requestId];
    if (!request || request.to !== actor.id) throw new Error('申请不存在');
    world.friendships.push(pairKey(request.from, request.to)); delete world.friendRequests[request.id];
    return { message: '已成为好友' };
  }
  if (action === 'friend.remove') {
    const key = pairKey(actor.id, requireText(payload.target, '好友编号'));
    if (!world.friendships.includes(key)) throw new Error('好友不存在');
    world.friendships = world.friendships.filter(pair => pair !== key); return { message: '已移除好友' };
  }
  if (action === 'chat.send') {
    const channel = payload.channel ?? 'world';
    if (!['world', 'guild', 'private'].includes(channel)) throw new Error('聊天频道无效');
    const text = requireText(payload.text, '消息', 300);
    if (channel === 'guild') guildOf(world, actor);
    const other = channel === 'private' ? findCharacter(world, payload.target) : null;
    if (channel === 'private' && !other) throw new Error('私聊对象不存在');
    if (other?.settings?.rejectPrivate) throw new Error('对方已关闭私聊');
    const recent = world.chat.filter(message => message.from === actor.id && now - message.at < 1000);
    if (recent.length >= 3) throw new Error('消息发送过快');
    world.chat.push({ id: randomUUID(), channel, text, from: actor.id, to: other?.id ?? actor.guildId ?? null, at: now });
    if (world.chat.length > 2000) world.chat.splice(0, world.chat.length - 2000);
    return { message: '消息已发送' };
  }
  if (action === 'mail.send') {
    const other = findCharacter(world, payload.target);
    if (!other || other.id === actor.id) throw new Error('收件角色无效');
    const title = requireText(payload.title, '标题', 50); const text = requireText(payload.text, '正文', 1000);
    const attachment = payload.attachment ? goodsFrom(payload.attachment) : null;
    credit(actor, -1, '邮件邮资', now);
    if (attachment) take(actor, attachment, content);
    const id = randomUUID(); world.mail[id] = { id, from: actor.id, to: other.id, title, text, attachment, claimed: !attachment, read: false, at: now };
    return { message: '邮件已送达', id };
  }
  if (['mail.read', 'mail.claim', 'mail.delete'].includes(action)) {
    const mail = world.mail[payload.mailId];
    if (!mail || mail.to !== actor.id) throw new Error('邮件不存在');
    if (action === 'mail.read') { mail.read = true; return { message: '邮件已读' }; }
    if (action === 'mail.delete') {
      if (!mail.claimed) throw new Error('请先领取附件'); delete world.mail[mail.id]; return { message: '已删除邮件' };
    }
    if (mail.claimed) throw new Error('附件已领取或没有附件');
    give(actor, mail.attachment); mail.claimed = true; mail.read = true; return { message: '附件已入包' };
  }
  if (action === 'guild.create') {
    if (actor.guildId) throw new Error('请先退出当前公会');
    const name = requireText(payload.name, '公会名称', 24);
    if (Object.values(world.guilds).some(guild => guild.name === name)) throw new Error('公会名称已存在');
    credit(actor, -100, '创建公会', now);
    const id = randomUUID(); world.guilds[id] = { id, name, leader: actor.id, members: [actor.id], applications: [], treasury: 0, skills: {}, contributions: {}, createdAt: now };
    actor.guildId = id; return { message: '公会已创建', id };
  }
  if (action === 'guild.apply') {
    if (actor.guildId) throw new Error('已经加入公会');
    const guild = world.guilds[payload.guildId]; if (!guild) throw new Error('公会不存在');
    if (guild.applications.includes(actor.id)) throw new Error('已提交申请'); guild.applications.push(actor.id); return { message: '入会申请已提交' };
  }
  if (action === 'guild.accept') {
    const guild = guildOf(world, actor, true); const id = payload.target;
    const other = world.characters[id];
    if (!other || other.guildId || !guild.applications.includes(id)) throw new Error('入会申请无效');
    if (guild.members.length >= 50) throw new Error('公会已满');
    guild.applications = guild.applications.filter(candidate => candidate !== id); guild.members.push(id); other.guildId = guild.id;
    return { message: '成员已加入公会' };
  }
  if (action === 'guild.transfer') {
    const guild = guildOf(world, actor, true);
    if (!guild.members.includes(payload.target) || payload.target === actor.id) throw new Error('请选择其他公会成员');
    guild.leader = payload.target; return { message: '已移交会长' };
  }
  if (action === 'guild.leave') {
    const guild = guildOf(world, actor);
    if (guild.leader === actor.id && guild.members.length > 1) throw new Error('请先移交会长');
    guild.members = guild.members.filter(id => id !== actor.id); actor.guildId = null;
    if (!guild.members.length) delete world.guilds[guild.id]; return { message: '已退出公会' };
  }
  if (action === 'guild.donate') {
    const guild = guildOf(world, actor); const amount = requireCount(Number(payload.amount));
    credit(actor, -amount, '公会捐献', now); guild.treasury += amount;
    guild.contributions[actor.id] = (guild.contributions[actor.id] ?? 0) + amount;
    return { message: `公会资金增加${amount}` };
  }
  if (action === 'guild.upgrade') {
    const guild = guildOf(world, actor, true); const key = String(payload.skill ?? 'vitality');
    if (!['vitality', 'income'].includes(key)) throw new Error('公会技能无效');
    const level = guild.skills[key] ?? 0; const cost = 100 * (level + 1);
    if (level >= 10 || guild.treasury < cost) throw new Error('公会资金不足或技能已满级');
    guild.treasury -= cost; guild.skills[key] = level + 1; return { message: '公会技能已升级' };
  }
  if (action === 'trade.offer') {
    const other = findCharacter(world, payload.target); if (!other || other.id === actor.id) throw new Error('交易对象无效');
    const goods = goodsFrom(payload); const price = requireCount(Number(payload.price)); take(actor, goods, content);
    const id = randomUUID(); world.trades[id] = { id, from: actor.id, to: other.id, goods, price, status: 'open', at: now, expires: now + 86400000 };
    return { message: '资产已托管，等待对方确认', id };
  }
  if (action === 'trade.accept' || action === 'trade.cancel') {
    const trade = world.trades[payload.tradeId]; if (!trade || trade.status !== 'open') throw new Error('交易已结束');
    if (action === 'trade.cancel') {
      if (trade.from !== actor.id) throw new Error('只能撤回自己的交易');
      give(actor, trade.goods); trade.status = 'cancelled'; return { message: '已撤回托管资产' };
    }
    if (trade.to !== actor.id || trade.expires <= now) throw new Error('交易对象或有效期不符');
    credit(actor, -trade.price, '购买玩家交易', now); credit(world.characters[trade.from], trade.price, '玩家交易收入', now);
    give(actor, trade.goods); trade.status = 'completed'; return { message: '交易完成' };
  }
  if (action === 'auction.list') {
    const goods = goodsFrom(payload); const price = requireCount(Number(payload.price));
    const buyout = requireCount(Number(payload.buyout)); if (buyout < price) throw new Error('一口价不能低于起拍价');
    take(actor, goods, content); const id = randomUUID();
    const duration = requireCount(Number(payload.durationMinutes ?? 60), '拍卖时长', 1440);
    world.auctions[id] = { id, seller: actor.id, goods, minimum: price, buyout, bid: 0, bidder: null, status: 'open', expires: now + duration * 60000 };
    return { message: '拍卖已上架', id };
  }
  if (['auction.bid', 'auction.buy', 'auction.cancel'].includes(action)) {
    const auction = world.auctions[payload.auctionId];
    if (!auction || auction.status !== 'open' || auction.expires <= now) throw new Error('拍卖已结束');
    if (action === 'auction.cancel') {
      if (auction.seller !== actor.id || auction.bidder) throw new Error('只能撤回无人竞价的本人拍卖');
      give(actor, auction.goods); auction.status = 'cancelled'; return { message: '拍卖已撤回' };
    }
    if (auction.seller === actor.id) throw new Error('不能竞拍自己的物品');
    const amount = action === 'auction.buy' ? auction.buyout : requireCount(Number(payload.amount));
    if (amount < auction.minimum || amount <= auction.bid || amount > auction.buyout) throw new Error('竞价必须高于当前价格且不超过一口价');
    credit(actor, -amount, '拍卖竞价托管', now);
    if (auction.bidder) credit(world.characters[auction.bidder], auction.bid, '竞价退款', now);
    auction.bid = amount; auction.bidder = actor.id;
    if (amount === auction.buyout) settleAuction(world, auction, now);
    return { message: amount === auction.buyout ? '拍卖成交' : '竞价已托管' };
  }
  throw new Error('未知社交操作');
}
function settleAuction(world, auction, now) {
  if (auction.bidder) {
    credit(world.characters[auction.seller], auction.bid, '拍卖收入', now);
    give(world.characters[auction.bidder], auction.goods); auction.status = 'completed';
  } else { give(world.characters[auction.seller], auction.goods); auction.status = 'expired'; }
}
export function tickSocial(world, now) {
  let changed = false;
  for (const auction of Object.values(world.auctions)) if (auction.status === 'open' && auction.expires <= now) {
    settleAuction(world, auction, now); changed = true;
  }
  for (const trade of Object.values(world.trades)) if (trade.status === 'open' && trade.expires <= now) {
    give(world.characters[trade.from], trade.goods); trade.status = 'expired'; changed = true;
  }
  return changed;
}
export function socialView(world, actor) {
  const people = Object.values(world.characters).map(char => ({ id: char.id, name: char.name, level: char.level, profession: char.profession, gender: char.gender ?? 1,
    rating: char.rating, guildId: char.guildId ?? null, wins: char.wins, losses: char.losses }));
  const friends = people.filter(char => world.friendships.includes(pairKey(actor.id, char.id)));
  return { people, friends,
    friendRequests: Object.values(world.friendRequests).filter(request => request.to === actor.id || request.from === actor.id),
    chat: world.chat.filter(message => message.channel === 'world' || (message.channel === 'private' && [message.from, message.to].includes(actor.id))
      || (message.channel === 'guild' && message.to === actor.guildId)).slice(-100),
    mail: Object.values(world.mail).filter(mail => mail.to === actor.id),
    guilds: Object.values(world.guilds).map(guild => ({ ...guild, applications: guild.leader === actor.id ? guild.applications : [] })),
    trades: Object.values(world.trades).filter(trade => trade.from === actor.id || trade.to === actor.id),
    auctions: Object.values(world.auctions).filter(auction => auction.status === 'open' || auction.seller === actor.id || auction.bidder === actor.id) };
}
