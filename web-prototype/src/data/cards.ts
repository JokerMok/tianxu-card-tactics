import type { CardDefinition } from '../battle/types';

const cards: CardDefinition[] = [
  {
    id: 'U001', name: '铸壁守望者', shortName: '守望者', kind: 'unit', prepare: 3, copyLimit: 4, faction: '人族',
    unit: { maxHp: 8, attack: 2, armor: 2, move: 1, range: 1, role: 'guard' },
  },
  {
    id: 'U002', name: '折锋枪兵', shortName: '枪兵', kind: 'unit', prepare: 2, copyLimit: 4, faction: '人族',
    unit: { maxHp: 5, attack: 3, armor: 1, move: 1, range: 1, role: 'striker', tags: ['anti-fast'] },
  },
  {
    id: 'U003', name: '晨誓医师', shortName: '医师', kind: 'unit', prepare: 4, copyLimit: 3, faction: '人族',
    unit: { maxHp: 5, attack: 1, armor: 0, move: 1, range: 2, role: 'healer', heal: 2 },
  },
  {
    id: 'U004', name: '岚羽游射手', shortName: '游射手', kind: 'unit', prepare: 3, copyLimit: 4, faction: '森灵',
    unit: { maxHp: 4, attack: 3, armor: 0, move: 1, range: 3, role: 'ranged' },
  },
  {
    id: 'U005', name: '流光驭手', shortName: '驭手', kind: 'unit', prepare: 2, copyLimit: 3, faction: '森灵',
    unit: { maxHp: 4, attack: 2, armor: 0, move: 2, range: 1, role: 'fast', tags: ['fast'] },
  },
  {
    id: 'U006', name: '风迹侦猎者', shortName: '侦猎者', kind: 'unit', prepare: 1, copyLimit: 2, faction: '森灵',
    unit: { maxHp: 3, attack: 2, armor: 0, move: 2, range: 2, role: 'fast', tags: ['fast'], firstMoveBonus: 1 },
  },
  {
    id: 'U007', name: '炽痕猎犬', shortName: '猎犬', kind: 'unit', prepare: 2, copyLimit: 3, faction: '荒兽',
    unit: { maxHp: 4, attack: 2, armor: 0, move: 2, range: 1, role: 'fast', tags: ['fast'], burnOnHit: 1 },
  },
  {
    id: 'U008', name: '霆脊巨兽', shortName: '巨兽', kind: 'unit', prepare: 5, copyLimit: 1, faction: '荒兽',
    unit: { maxHp: 10, attack: 4, armor: 2, move: 1, range: 1, role: 'guard', stunOnHitChance: 2500 },
  },
  {
    id: 'U011', name: '铁颚掠阵者', shortName: '掠阵者', kind: 'unit', prepare: 3, copyLimit: 2, faction: '岩裔',
    unit: { maxHp: 7, attack: 3, armor: 1, move: 1, range: 1, role: 'striker', enrageOnDamage: 1, enrageCap: 3 },
  },
  {
    id: 'U012', name: '脊岭投石手', shortName: '投石手', kind: 'unit', prepare: 4, copyLimit: 2, faction: '岩裔',
    unit: { maxHp: 6, attack: 3, armor: 0, move: 1, range: 3, role: 'ranged', knockbackOnHit: 1 },
  },
  {
    id: 'S001', name: '烈纹投射', shortName: '烈纹', kind: 'skill', prepare: 4, copyLimit: 1, profession: '秘术师',
    skill: { targetType: 'enemy-unit', damage: 4, burn: { damage: 1, rounds: 2 } },
  },
  {
    id: 'S002', name: '凝霜界线', shortName: '凝霜', kind: 'skill', prepare: 5, copyLimit: 1, profession: '秘术师',
    skill: { targetType: 'lane', freezeRounds: 1 },
  },
  {
    id: 'S003', name: '斥力脉冲', shortName: '脉冲', kind: 'skill', prepare: 4, copyLimit: 1, profession: '秘术师',
    skill: { targetType: 'lane', damage: 2, knockback: 1 },
  },
  {
    id: 'S006', name: '守望屏障', shortName: '屏障', kind: 'skill', prepare: 3, copyLimit: 1, profession: '统御者',
    skill: { targetType: 'ally-unit', barrier: 4 },
  },
  {
    id: 'S007', name: '晨辉赐福', shortName: '赐福', kind: 'skill', prepare: 2, copyLimit: 1, profession: '圣契者',
    skill: { targetType: 'ally-unit', heal: 5 },
  },
  {
    id: 'S009', name: '战术回收', shortName: '回收', kind: 'skill', prepare: 3, copyLimit: 1, profession: '影策者',
    skill: { targetType: 'global', prepareReduction: { count: 2, value: 2 } },
  },
];

export const CARD_DEFINITIONS: Record<string, CardDefinition> = Object.fromEntries(
  cards.map((card) => [card.id, card]),
);

export function getCard(cardId: string): CardDefinition {
  const card = CARD_DEFINITIONS[cardId];
  if (!card) throw new Error(`Unknown card: ${cardId}`);
  return card;
}
