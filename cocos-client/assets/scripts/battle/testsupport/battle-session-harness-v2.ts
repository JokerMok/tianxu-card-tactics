import { BattleControlController } from '../battle-control-controller.ts';
import { BattleExitController } from '../battle-exit-controller.ts';
import { BattleInputAdapter } from '../input/battle-input-adapter.ts';
import { runBattleRunner, BATTLE_RUNNER_PROTOCOL } from '../runner/battle-runner.ts';
import { BattleSessionController } from '../session-controller.ts';

export const BATTLE_HARNESS_V2_ALLOWED_ACTIONS = Object.freeze([
  'BATTLE_START',
  'DEPLOY_UNIT',
  'END_TURN',
] as const);

function resolveInputCard(cardId: string) {
  return cardId.startsWith('U') ? { kind: 'unit' as const } : undefined;
}

function createSession(seed: number): BattleSessionController {
  return new BattleSessionController({
    seed,
    engine: {
      run(nextSeed, actions) {
        const output = runBattleRunner({ protocol: BATTLE_RUNNER_PROTOCOL, seed: nextSeed, actions });
        return { finalState: output.finalState, events: output.events, finalHash: output.finalHash };
      },
    },
  });
}

export class BattleSessionHarnessV2 {
  private readonly session: BattleSessionController;
  private readonly managed: BattleControlController;
  private readonly exit: BattleExitController;
  private input: BattleInputAdapter | null = null;

  constructor(seed: number) {
    this.session = createSession(seed);
    this.managed = new BattleControlController({ session: this.session });
    this.exit = new BattleExitController({
      port: {
        settle: () => {
          this.session.end();
          return Object.freeze({ accepted: true });
        },
      },
    });
  }

  get actions() {
    return this.session.snapshot.actions;
  }

  get lifecycle() {
    return this.session.lifecycle;
  }

  start() {
    const snapshot = this.session.start();
    return snapshot;
  }

  selectFirstUnit() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const state = this.session.snapshot.state;
      const card = state.hands[state.activeSide].find(
        ({ cardId, remainingPreparation }) => cardId.startsWith('U') && remainingPreparation === 0,
      );
      if (card) {
        this.input = new BattleInputAdapter({
          session: this.session,
          side: state.activeSide,
          resolveCard: resolveInputCard,
        });
        const selected = this.input.selectCard(card.instanceId);
        if (!selected.ok) throw new Error(`unit card was rejected: ${selected.code} ${selected.reason}`);
        return selected;
      }
      this.session.dispatch({ type: 'END_TURN' });
    }
    throw new Error('no deployable unit became ready after eight real turns');
  }

  deploySelection(preferredLane: number) {
    const input = this.requireInput();
    const target = input.preview.candidates.find(
      (candidate) => candidate.kind === 'cell' && candidate.lane === preferredLane,
    ) ?? input.preview.candidates.find((candidate) => candidate.kind === 'cell');
    if (!target || target.kind !== 'cell') throw new Error('selected unit has no deployable cell');
    const selected = input.selectCell(target.lane, target.cell);
    if (!selected.ok) throw new Error(`unit target was rejected: ${selected.code} ${selected.reason}`);
    const committed = input.confirm();
    if (!committed.ok) throw new Error(`unit deploy was rejected: ${committed.code} ${committed.reason}`);
    return committed;
  }

  endTurn() {
    return this.session.dispatch({ type: 'END_TURN' });
  }

  enqueueManagedEndTurn() {
    return this.managed.enqueue({ type: 'END_TURN' });
  }

  tickManaged() {
    return this.managed.tick();
  }

  pause() {
    return this.session.pause();
  }

  resume() {
    return this.session.resume();
  }

  requestExit() {
    return this.exit.requestSurrender();
  }

  confirmExit() {
    return this.exit.confirm().snapshot;
  }

  readHash() {
    return this.session.snapshot.finalHash;
  }

  private requireInput(): BattleInputAdapter {
    if (this.input === null) throw new Error('battle input requires an active session');
    return this.input;
  }
}

export function createBattleSessionHarnessV2(seed = 42): BattleSessionHarnessV2 {
  return new BattleSessionHarnessV2(seed);
}
