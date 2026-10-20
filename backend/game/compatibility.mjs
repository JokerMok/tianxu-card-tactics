// Explicit runtime adaptations. The recovered catalog remains immutable.
export const MISSING_MONSTERS = Object.freeze({
  61152: { id: 60152, reason: 'Chapter 15 final node displays 60152; absent second ID uses a same-theme dragon echo.' },
  65601: { id: 65611, reason: 'Isolated tomb route lacks its defender row; use the existing tomb spirit Grace.' },
  5901010: { id: 590110, reason: 'Elite dragon sequence 590108,590109,5901010; existing third queen is 590110.' },
});
export const BOARD_SCENES = Object.freeze({ 2501: { monsterId: 9119, count: 9 }, 2502: { monsterId: 9321, count: 9 }, 2503: { monsterId: 9330, count: 9 } });
export const FALLBACK_MAP = 1;
