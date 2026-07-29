import { createRng, shuffle, type RngState } from '../rng/index.ts';

export type CardSide = 'player' | 'enemy';

export interface CardInstance {
  readonly instanceId: string;
  readonly cardId: string;
  readonly remainingPreparation: number;
}

export interface CardState {
  readonly rng: RngState;
  readonly decks: Readonly<Record<CardSide, readonly string[]>>;
  readonly hands: Readonly<Record<CardSide, readonly CardInstance[]>>;
  readonly prepareByCardId: Readonly<Record<string, number>>;
  readonly nextId: number;
}

export interface CardStateInput {
  readonly seed: number;
  readonly decks: Readonly<Record<CardSide, readonly string[]>>;
  readonly prepareByCardId: Readonly<Record<string, number>>;
  readonly nextId?: number;
}

function prepare(cardId: string, values: Readonly<Record<string, number>>): number {
  const value = values[cardId];
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid prepare value: ${cardId}`);
  return value;
}

function drawOne(state: CardState, side: CardSide): CardState {
  const [cardId, ...remaining] = state.decks[side];
  if (!cardId) return state;
  const instance: CardInstance = {
    instanceId: `card-${state.nextId}`,
    cardId,
    remainingPreparation: prepare(cardId, state.prepareByCardId),
  };
  return {
    ...state,
    decks: { ...state.decks, [side]: remaining },
    hands: { ...state.hands, [side]: [...state.hands[side], instance] },
    nextId: state.nextId + 1,
  };
}

function drawOpening(state: CardState, side: CardSide): CardState {
  let next = state;
  while (next.hands[side].length < 5 && next.decks[side].length > 0) next = drawOne(next, side);
  return next;
}

export function createCardState(input: CardStateInput): CardState {
  let rng = createRng(input.seed);
  const playerShuffle = shuffle(rng, input.decks.player);
  rng = playerShuffle.state;
  const enemyShuffle = shuffle(rng, input.decks.enemy);
  rng = enemyShuffle.state;
  let state: CardState = {
    rng,
    decks: { player: playerShuffle.values, enemy: enemyShuffle.values },
    hands: { player: [], enemy: [] },
    prepareByCardId: { ...input.prepareByCardId },
    nextId: input.nextId ?? 1,
  };
  state = drawOpening(state, 'player');
  return drawOpening(state, 'enemy');
}

export function decrementPreparation(state: CardState, side: CardSide): CardState {
  const hand = state.hands[side].map((card) => ({
    ...card,
    remainingPreparation: Math.max(0, card.remainingPreparation - 1),
  }));
  return { ...state, hands: { ...state.hands, [side]: hand } };
}

export function endCardTurn(state: CardState, side: CardSide): CardState {
  const hand = state.hands[side].map((card) => card.remainingPreparation === 0
    ? { ...card, remainingPreparation: Math.floor(prepare(card.cardId, state.prepareByCardId) / 2) }
    : card);
  return drawOne({ ...state, hands: { ...state.hands, [side]: hand } }, side);
}
