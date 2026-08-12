import { describe, expect, it } from 'vitest';
import {
  buildDeterministicActions,
  compare,
  fixture,
  hasAutoAction,
  heroDeathActions,
  lifecycleCount,
  runCocos,
  withActions,
} from './golden-corpus';

describe('React to Cocos golden parity contract', () => {
  it('locks the empty input golden snapshot and byte determinism', () => {
    const input = withActions([{ type: 'BATTLE_START' }]);
    const first = runCocos(42, input);
    const second = runCocos(42, input);
    expect(first.status).toBe(0);
    expect(first.output.status).toBe('ok');
    expect(first.output.fixtureVersion).toBe(2);
    expect(first.output.finalState.round).toBe(1);
    expect(first.output.finalState.turn).toBe(1);
    expect(first.output.finalState.hands.player).toHaveLength(5);
    expect(first.output.lifecycleEvents).toEqual([]);
    expect(first.bytes).toBe(second.bytes);
    const result = compare(42, input);
    expect(result.react).toEqual(result.cocos);
    expect(result.reactEvents).toEqual(result.cocosEvents);
  });

  it('locks the seeded interaction golden scenario and complete mapped event stream', () => {
    const input = withActions(buildDeterministicActions(42));
    const result = compare(42, input);
    expect(input.actions.length).toBeGreaterThan(10);
    expect(input.actions.map((action) => action.type)).toEqual(expect.arrayContaining(['DEPLOY_UNIT', 'MOVE_UNIT', 'ATTACK', 'END_TURN']));
    expect(result.react).toEqual(result.cocos);
    expect(result.reactEvents).toEqual(result.cocosEvents);
    expect(result.cocosEvents.some((event) => event.type === 'UNIT_MOVED')).toBe(true);
    expect(result.cocosEvents.some((event) => event.type === 'ATTACK')).toBe(true);
    expect(result.cocosEvents.some((event) => event.type === 'DAMAGE')).toBe(true);
    expect(hasAutoAction(result.cocosEvents)).toBe(true);
    expect((result.cocosOutput.events as Array<{ type: string; payload?: { blocked?: string } }>).some((event) => event.type === 'UNIT_MOVED' && event.payload?.blocked === 'occupied')).toBe(true);
  });

  it('locks round-limit, hero-death and lifecycle golden boundaries', () => {
    const round80 = compare(42, withActions([{ type: 'BATTLE_START' }, ...Array.from({ length: 160 }, () => ({ type: 'END_TURN' }))]));
    expect(round80.react).toEqual(round80.cocos);
    expect(round80.reactRun.rawFinalState.round).toBe(80);
    expect(lifecycleCount(round80.reactEvents)).toBe(1);
    expect(lifecycleCount(round80.cocosEvents)).toBe(1);

    const heroDeath = compare(42, withActions(heroDeathActions()));
    expect(heroDeath.react).toEqual(heroDeath.cocos);
    expect(heroDeath.reactRun.rawFinalState.status).not.toBe('playing');
    expect(lifecycleCount(heroDeath.reactEvents)).toBe(1);
    expect(lifecycleCount(heroDeath.cocosEvents)).toBe(1);
    expect(heroDeath.cocosOutput.events.filter((event: { type: string }) => event.type === 'BATTLE_END')).toHaveLength(1);
  });

  it('rejects invalid version/fixture inputs without turning them into golden success', () => {
    const wrongVersion = runCocos(42, { ...fixture, version: 1 } as never);
    expect(wrongVersion.status).not.toBe(0);
    expect(wrongVersion.output.status).toBe('error');
    expect(wrongVersion.output.error.code).toBe('INVALID_INPUT');

    const unknownCard = runCocos(42, { ...fixture, cards: fixture.cards.map((card, index) => index === 0 ? { ...card, cocosCardId: 'U999' } : card) } as never);
    expect(unknownCard.status).not.toBe(0);
    expect(unknownCard.output.status).toBe('error');
    expect(unknownCard.output.error.code).toBe('INVALID_INPUT');
  });

  it('replays 100 seeded independent action streams as golden corpus', { timeout: 120000 }, () => {
    const actionCoverage = new Set<string>();
    const eventCoverage = new Set<string>();
    let automaticCoverage = false;
    let blockedCoverage = false;
    const hashes = new Set<string>();
    for (let seed = 1; seed <= 100; seed += 1) {
      const input = withActions(buildDeterministicActions(seed));
      for (const action of input.actions) actionCoverage.add(action.type);
      const result = compare(seed, input);
      expect(result.react).toEqual(result.cocos);
      for (const event of result.cocosEvents) eventCoverage.add(String(event.type));
      automaticCoverage ||= hasAutoAction(result.cocosEvents);
      blockedCoverage ||= (result.cocosOutput.events as Array<{ type: string; payload?: { blocked?: string } }>).some((event) => event.type === 'UNIT_MOVED' && event.payload?.blocked === 'occupied');
      hashes.add(String(result.cocosOutput.finalHash));
    }
    expect([...actionCoverage]).toEqual(expect.arrayContaining(['DEPLOY_UNIT', 'MOVE_UNIT', 'ATTACK', 'END_TURN']));
    expect([...eventCoverage]).toEqual(expect.arrayContaining(['UNIT_MOVED', 'ATTACK', 'DAMAGE']));
    expect(automaticCoverage).toBe(true);
    expect(blockedCoverage).toBe(true);
    expect(hashes.size).toBeGreaterThan(1);
  });
});
