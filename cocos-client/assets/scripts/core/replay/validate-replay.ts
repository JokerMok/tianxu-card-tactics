import { keyReplayEvents, replayCommands, replayHash, verifyReplay, type ReplayCommand } from './index.ts';

export function runReplayValidation(): void {
  const commands: readonly ReplayCommand[] = [
    { type: 'BATTLE_START', payload: { activeSide: 'player' } },
    { type: 'CARD_PLAYED', payload: { cardId: 'U013', lane: 0, cell: 2 } },
    { type: 'HERO_DAMAGED', payload: { side: 'enemy', value: 3 } },
  ];
  const trace = replayCommands(42, commands);
  const replayed = replayCommands(42, commands);
  if (trace.finalHash !== replayed.finalHash || JSON.stringify(trace.events) !== JSON.stringify(replayed.events)) throw new Error('replay is not deterministic');
  if (!verifyReplay(trace).valid) throw new Error('replay verification failed');
  if (trace.events[2].state.heroHp.enemy !== 0) throw new Error('replay did not rebuild hero state');
  if (!Object.isFrozen(trace) || !Object.isFrozen(trace.events) || !Object.isFrozen(trace.events[2].state)) throw new Error('replay trace is mutable');
  if (replayHash(43, commands) === trace.finalHash || replayHash(42, commands.slice(0, 2)) === trace.finalHash) throw new Error('replay hash ignores input');
  if (keyReplayEvents(trace, ['BATTLE_START', 'HERO_DAMAGED']).length !== 2) throw new Error('key replay event filter failed');
  let rejected = false;
  try { replayCommands(42, [{ type: '' }]); } catch { rejected = true; }
  if (!rejected) throw new Error('invalid replay command was accepted');
  let unknownRejected = false;
  try { replayCommands(42, [{ type: 'UNKNOWN' }]); } catch { unknownRejected = true; }
  if (!unknownRejected) throw new Error('unknown replay command was accepted');
}

runReplayValidation();
