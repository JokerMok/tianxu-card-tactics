import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { createBoardState } from '../../core/board/index.ts';
import { moveUnit } from '../../core/movement/index.ts';
import { createAttackAction } from '../../core/combat/index.ts';
import { enqueue } from '../../core/events/index.ts';
import { resolveOutcome } from '../../core/outcome/index.ts';
import { chooseSeeded } from '../../core/rng/index.ts';
import {
  BATTLE_RUNNER_PROTOCOL, BATTLE_RUNNER_V2_PROTOCOL, DEFAULT_BATTLE_BINDINGS,
  createBattleRuntime, parseAction, RunnerInputError, errorOutput,
  type HighLevelAction, type BattleRunnerOutput, type ParityBattleRunnerOutput, type BattleRunnerError,
} from '../runtime/battle-core.ts';
import { createAuthority } from '../runtime/battle-config.ts';

export { BATTLE_RUNNER_PROTOCOL, BATTLE_RUNNER_V2_PROTOCOL, BATTLE_RUNNER } from '../runtime/battle-core.ts';
export type { HighLevelAction, BattleRunnerOutput, NeutralBattleOutput } from '../runtime/battle-core.ts';

const HERO_MAX_HP = 30;

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function parseActions(value: Record<string, unknown>): HighLevelAction[] {
  const rawActions = value.actions;
  if (!isUnknownArray(rawActions)) throw new RunnerInputError('INVALID_INPUT', 'input.actions must be an array');
  const actions: HighLevelAction[] = rawActions.map((action, index) => parseAction(action, index));
  return actions;
}

function loadAuthority() {
  const configRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../resources/config');
  const tables = Object.fromEntries(['cards', 'skills', 'units', 'professions', 'decks'].map((name) => {
    const table = JSON.parse(fs.readFileSync(path.join(configRoot, `${name}.json`), 'utf8'));
    return [name, table[name]];
  }));
  return createAuthority(tables);
}

// Executable CLI bindings: all rule orchestration is owned by the shared runtime.
const runtime = createBattleRuntime(loadAuthority(), {
  ...DEFAULT_BATTLE_BINDINGS,
  heroMaxHp: HERO_MAX_HP,
  isSafeInteger,
  isUnknownArray,
  parseActions,
  createBoardState: (...args) => createBoardState(...args),
  moveUnit: (...args) => moveUnit(...args),
  createAttackAction: (...args) => createAttackAction(...args),
  enqueue: (...args) => enqueue(...args),
  resolveOutcome: (...args) => resolveOutcome(...args),
  chooseSeeded: (state, values) => chooseSeeded(state, values),
});

export function runBattleRunner(input: unknown): BattleRunnerOutput {
  return runtime.runBattleRunner(input);
}

export function runBattleRunnerV2(input: unknown): ParityBattleRunnerOutput {
  return runtime.runBattleRunnerV2(input);
}

export function runNeutralBattle(seed: number) {
  return runtime.runNeutralBattle(seed);
}

async function main(): Promise<void> {
  let output: BattleRunnerOutput | ParityBattleRunnerOutput | BattleRunnerError;
  let protocol: typeof BATTLE_RUNNER_PROTOCOL | typeof BATTLE_RUNNER_V2_PROTOCOL = BATTLE_RUNNER_PROTOCOL;
  try {
    let raw = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
    const parsed = JSON.parse(raw) as { protocol?: unknown };
    protocol = parsed.protocol === BATTLE_RUNNER_V2_PROTOCOL ? BATTLE_RUNNER_V2_PROTOCOL : BATTLE_RUNNER_PROTOCOL;
    output = protocol === BATTLE_RUNNER_V2_PROTOCOL ? runBattleRunnerV2(parsed) : runBattleRunner(parsed);
  } catch (error) {
    output = errorOutput(error, protocol);
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
