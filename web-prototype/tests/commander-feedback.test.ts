import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createBattle } from '../src/battle/engine';
import { BattlefieldCommander } from '../src/components/GamePieces';

function renderCommanderHit(value: number): string {
  const state = createBattle(20260715);
  state.events.push({
    id: state.nextEventId,
    round: state.round,
    turn: state.turn,
    type: 'HERO_DAMAGED',
    message: `我方英雄受到 ${value} 点伤害`,
    side: 'player',
    value,
  });
  return renderToStaticMarkup(createElement(BattlefieldCommander, { side: 'player', state }));
}

describe('fixed commander feedback', () => {
  it('maps minor hero damage to the light hit animation', () => {
    const markup = renderCommanderHit(2);
    expect(markup).toContain('is-hit-light');
    expect(markup).toContain('data-hit-level="light"');
  });

  it('maps major hero damage to the heavy hit animation', () => {
    const markup = renderCommanderHit(5);
    expect(markup).toContain('is-hit-heavy');
    expect(markup).toContain('data-hit-level="heavy"');
  });
});
