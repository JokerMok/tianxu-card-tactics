import type { Side } from '../core/types/index.ts';

export type BattleTarget =
  | { readonly kind: 'cell'; readonly lane: number; readonly cell: number }
  | { readonly kind: 'lane'; readonly lane: number }
  | { readonly kind: 'unit'; readonly unitId: string }
  | { readonly kind: 'global' };

export interface BattlePlayCardAction {
  readonly type: 'PLAY_CARD';
  readonly cardId: string;
  readonly side: Side;
  readonly target: BattleTarget;
}
