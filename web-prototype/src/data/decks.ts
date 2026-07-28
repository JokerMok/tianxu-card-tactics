import { getCard } from './cards';

export const DECK_RULES = {
  totalCards: 30,
  minUnitCards: 24,
  maxSkillCards: 6,
} as const;

export const PLAYER_PROFESSION = '秘术师';
export const ENEMY_PROFESSION = '秘术师';

export const PLAYER_DECK = [
  ...Array(4).fill('U001'),
  ...Array(4).fill('U002'),
  ...Array(3).fill('U003'),
  ...Array(4).fill('U004'),
  ...Array(3).fill('U005'),
  ...Array(2).fill('U006'),
  ...Array(2).fill('U007'),
  'U008',
  ...Array(2).fill('U011'),
  ...Array(2).fill('U012'),
  'S001',
  'S002',
  'S003',
] as string[];

export const ENEMY_DECK = [
  ...Array(4).fill('U001'),
  ...Array(4).fill('U002'),
  ...Array(3).fill('U003'),
  ...Array(4).fill('U004'),
  ...Array(3).fill('U005'),
  ...Array(2).fill('U006'),
  ...Array(2).fill('U007'),
  'U008',
  ...Array(2).fill('U011'),
  ...Array(2).fill('U012'),
  'S001',
  'S002',
  'S003',
] as string[];

export function getDeckComposition(deck: string[]): { units: number; skills: number } {
  return deck.reduce((result, cardId) => {
    result[getCard(cardId).kind === 'unit' ? 'units' : 'skills'] += 1;
    return result;
  }, { units: 0, skills: 0 });
}

export function validateDeck(deck: string[], profession: string, label = '牌组'): void {
  if (deck.length !== DECK_RULES.totalCards) {
    throw new Error(`${label}必须包含 ${DECK_RULES.totalCards} 张卡牌，当前为 ${deck.length} 张。`);
  }

  const composition = getDeckComposition(deck);
  if (composition.units < DECK_RULES.minUnitCards) {
    throw new Error(`${label}单位卡不得少于 ${DECK_RULES.minUnitCards} 张。`);
  }
  if (composition.skills > DECK_RULES.maxSkillCards) {
    throw new Error(`${label}技能卡不得超过 ${DECK_RULES.maxSkillCards} 张。`);
  }

  const counts = new Map<string, number>();
  for (const cardId of deck) {
    const definition = getCard(cardId);
    const count = (counts.get(cardId) ?? 0) + 1;
    counts.set(cardId, count);
    if (count > definition.copyLimit) {
      throw new Error(`${label}中的${definition.name}超过携带上限 ${definition.copyLimit} 张。`);
    }
    if (definition.kind === 'skill' && definition.profession !== profession) {
      throw new Error(`${label}中的${definition.name}不属于当前职业${profession}。`);
    }
  }
}

export function validateDecks(): void {
  validateDeck(PLAYER_DECK, PLAYER_PROFESSION, '玩家牌组');
  validateDeck(ENEMY_DECK, ENEMY_PROFESSION, '敌方牌组');
}
