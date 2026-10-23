/** Approved local slim-PVE stage. IDs/data remain compatible; this is not a deletion list. */
export const STAGE_SCOPE = Object.freeze({
  id: 'slim-pve-20261023', title: '精简PVE范围版',
  pages: ['home', 'cards', 'world', 'tasks', 'growth', 'mail', 'settings', 'social', 'legacy'],
  sections: ['inventory', 'equipment', 'shop', 'profession-skill-shop', 'city', 'activities', 'progression', 'tasks', 'legacy'],
  suspendedSkillIds: [41105, 41107],
});
export const STAGE_PAUSED = '本阶段暂缓此功能；旧资产与已形成的领取权益保留。';
export function stagePageAllowed(page: string): boolean { return STAGE_SCOPE.pages.includes(page); }
export function stageSectionAllowed(section: string): boolean { return STAGE_SCOPE.sections.includes(section); }
/** Context-sensitive legacy claims are additionally checked by the authoritative service. */
export function stageActionReason(action: string, payload: Record<string, any> = {}): string | null {
  if (/^(magic\.|pet\.|mount\.|summon\.|profile\.|title\.|reputation\.)/.test(action)
    || ['equipment.enhance','equipment.craft','equipment.runeCraft','equipment.refine','city.upgrade',
      'shop.openTen','shop.reputation.buy','quest.explore.start','quest.energy.buy','quest.tax.force',
      'quest.account.confirm','quest.elitePack.open','petIsland.challenge','pet.synthesize',
      'tower.challenge','tower.refresh','tower.reset','worldBoss.challenge','worldBoss.hire',
      'forbidden.challenge','forbidden.shop.buy','friend.request','friend.accept','mail.send',
      'guild.create','guild.apply','guild.accept','guild.donate','guild.upgrade','trade.offer',
      'auction.list','auction.bid','auction.buy','room.create','room.join','room.invite','tournament.register',
      'tournament.deck.save','clanwar.register','activity.wheel','activity.wish'].includes(action)
    || action.startsWith('quest.marriage.') && !(action === 'quest.marriage.respond' && payload.accept === false)) return STAGE_PAUSED;
  if (action === 'chat.send' && payload.channel !== 'world') return '本阶段仅保留世界频道。';
  if (['shop.buy','shop.openPack','shop.buyLimited','shop.exchange'].includes(action)
    && !['pack:basic','limited:crystal','exchange:crystal'].includes(String(payload.offerId ?? (action === 'shop.openPack' ? 'pack:basic' : '')))) return STAGE_PAUSED;
  return null;
}
