import { fileURLToPath } from 'node:url';
import { createRng } from '../../core/rng/index.ts';
import {
  keyReplayEvents,
  replayCommands,
  type ReplayCommand,
  type ReplayState,
} from '../../core/replay/index.ts';

export const GOLDEN_RUNNER_PROTOCOL = 'tianxu.cocos-golden-runner/v1';

interface GoldenRunnerInput {
  readonly protocol: typeof GOLDEN_RUNNER_PROTOCOL;
  readonly seed: number;
  readonly commands: readonly ReplayCommand[];
}

interface GoldenRunnerError {
  readonly protocol: typeof GOLDEN_RUNNER_PROTOCOL;
  readonly status: 'error';
  readonly error: { readonly code: 'INVALID_JSON' | 'INVALID_INPUT' | 'INVALID_COMMAND'; readonly message: string };
}

export interface GoldenRunnerOutput {
  readonly protocol: typeof GOLDEN_RUNNER_PROTOCOL;
  readonly status: 'ok';
  readonly runner: 'cocos-core-replay';
  readonly seed: number;
  readonly commandCount: number;
  readonly finalState: ReplayState;
  readonly keyEvents: readonly Readonly<Record<string, unknown>>[];
  readonly rngCursor: number;
  readonly finalHash: string;
}

const KEY_EVENT_TYPES = [
  'BATTLE_START',
  'ROUND_START',
  'ATTACK',
  'DAMAGE',
  'HERO_DAMAGED',
  'UNIT_DIED',
  'BATTLE_END',
] as const;

const INITIAL_STATE: ReplayState = {
  round: 0,
  heroHp: { player: 0, enemy: 0 },
  units: [],
  playedCards: [],
  status: 'playing',
};

class RunnerInputError extends Error {
  readonly code: 'INVALID_INPUT' | 'INVALID_COMMAND';

  constructor(code: 'INVALID_INPUT' | 'INVALID_COMMAND', message: string) {
    super(message);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new RunnerInputError('INVALID_INPUT', `${label} must contain only: ${allowed.join(', ')}`);
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  code: 'INVALID_INPUT' | 'INVALID_COMMAND' = 'INVALID_INPUT',
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new RunnerInputError(code, `${label} has unsupported field: ${unknown[0]}`);
}

function parseInput(value: unknown): GoldenRunnerInput {
  if (!isRecord(value)) throw new RunnerInputError('INVALID_INPUT', 'input must be a JSON object');
  assertExactKeys(value, ['protocol', 'seed', 'commands'], 'input');
  if (value.protocol !== GOLDEN_RUNNER_PROTOCOL) {
    throw new RunnerInputError('INVALID_INPUT', `input.protocol must be ${GOLDEN_RUNNER_PROTOCOL}`);
  }
  if (!Number.isSafeInteger(value.seed)) throw new RunnerInputError('INVALID_INPUT', 'input.seed must be a safe integer');
  if (!Array.isArray(value.commands)) throw new RunnerInputError('INVALID_INPUT', 'input.commands must be an array');
  value.commands.forEach((command, index) => {
    if (!isRecord(command)) throw new RunnerInputError('INVALID_COMMAND', `input.commands[${index}] must be an object`);
    assertAllowedKeys(command, ['type', 'payload'], `input.commands[${index}]`, 'INVALID_COMMAND');
    if (typeof command.type !== 'string' || command.type.trim().length === 0) {
      throw new RunnerInputError('INVALID_COMMAND', `input.commands[${index}].type must be a non-empty string`);
    }
    if (command.payload !== undefined && !isRecord(command.payload)) {
      throw new RunnerInputError('INVALID_COMMAND', `input.commands[${index}].payload must be an object`);
    }
  });
  return value as GoldenRunnerInput;
}

export function runGoldenRunner(input: unknown): GoldenRunnerOutput {
  const parsed = parseInput(input);
  let trace;
  try {
    // This is the Cocos-side deterministic core execution boundary.
    trace = replayCommands(parsed.seed, parsed.commands);
  } catch (error) {
    throw new RunnerInputError('INVALID_COMMAND', error instanceof Error ? error.message : String(error));
  }
  const finalEvent = trace.events[trace.events.length - 1];
  const keyEvents = keyReplayEvents(trace, KEY_EVENT_TYPES).map(({ sequence, type, payload, rngCursor }) => ({
    sequence,
    type,
    payload,
    rngCursor,
  }));
  return {
    protocol: GOLDEN_RUNNER_PROTOCOL,
    status: 'ok',
    runner: 'cocos-core-replay',
    seed: parsed.seed,
    commandCount: parsed.commands.length,
    finalState: finalEvent?.state ?? INITIAL_STATE,
    keyEvents,
    rngCursor: finalEvent?.rngCursor ?? createRng(parsed.seed).rngCursor,
    finalHash: trace.finalHash,
  };
}

function errorOutput(error: unknown): GoldenRunnerError {
  if (error instanceof RunnerInputError) {
    return { protocol: GOLDEN_RUNNER_PROTOCOL, status: 'error', error: { code: error.code, message: error.message } };
  }
  return {
    protocol: GOLDEN_RUNNER_PROTOCOL,
    status: 'error',
    error: { code: 'INVALID_JSON', message: error instanceof Error ? error.message : String(error) },
  };
}

async function main(): Promise<void> {
  let output: GoldenRunnerOutput | GoldenRunnerError;
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      let value = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { value += chunk; });
      process.stdin.on('end', () => resolve(value));
      process.stdin.on('error', reject);
    });
    output = runGoldenRunner(JSON.parse(raw));
  } catch (error) {
    output = errorOutput(error);
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
