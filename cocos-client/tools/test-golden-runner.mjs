import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(root, 'assets/scripts/battle/runner/golden-runner.ts');
const fixtureRoot = path.join(import.meta.dirname, 'fixtures/golden-runner');

assert.equal(fs.existsSync(runnerPath), true, `runner is missing: ${runnerPath}`);
const runnerSource = fs.readFileSync(runnerPath, 'utf8');
assert.match(runnerSource, /\.\.\/\.\.\/core\/replay\/index\.ts/);
assert.doesNotMatch(runnerSource, /web-prototype|React/i);

function runFixture(name) {
  const input = fs.readFileSync(path.join(fixtureRoot, name), 'utf8');
  const result = spawnSync(process.execPath, ['--experimental-strip-types', runnerPath], {
    input,
    encoding: 'utf8',
  });
  return { ...result, output: JSON.parse(result.stdout), bytes: result.stdout };
}

const normal = runFixture('normal-combat.json');
assert.equal(normal.status, 0);
assert.equal(normal.output.status, 'ok');
assert.equal(normal.output.runner, 'cocos-core-replay');
assert.equal(normal.output.finalState.status, 'won');
assert.equal(normal.output.finalState.heroHp.enemy, 0);
assert.equal(normal.output.rngCursor, normal.output.commandCount);
assert(normal.output.keyEvents.some(({ type }) => type === 'BATTLE_END'));

const empty = runFixture('empty.json');
assert.equal(empty.status, 0);
assert.equal(empty.output.status, 'ok');
assert.equal(empty.output.rngCursor, 0);

const invalid = runFixture('invalid-command.json');
assert.notEqual(invalid.status, 0);
assert.equal(invalid.output.status, 'error');
assert.equal(invalid.output.error.code, 'INVALID_COMMAND');

const repeatA = runFixture('normal-combat.json');
const repeatB = runFixture('normal-combat.json');
assert.equal(repeatA.bytes, repeatB.bytes);

const normalInput = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'normal-combat.json'), 'utf8'));
const invalidProtocol = spawnSync(process.execPath, ['--experimental-strip-types', runnerPath], {
  input: JSON.stringify({ ...normalInput, protocol: 'wrong/v1' }),
  encoding: 'utf8',
});
assert.notEqual(invalidProtocol.status, 0);
assert.equal(JSON.parse(invalidProtocol.stdout).error.code, 'INVALID_INPUT');

const changedSeed = spawnSync(process.execPath, ['--experimental-strip-types', runnerPath], {
  input: JSON.stringify({ ...normalInput, seed: 43 }),
  encoding: 'utf8',
});
const changedStream = spawnSync(process.execPath, ['--experimental-strip-types', runnerPath], {
  input: JSON.stringify({ ...normalInput, commands: normalInput.commands.slice(0, -1) }),
  encoding: 'utf8',
});
assert.notEqual(JSON.parse(changedSeed.stdout).finalHash, normal.output.finalHash);
assert.notEqual(JSON.parse(changedStream.stdout).finalHash, normal.output.finalHash);

console.log('Golden runner fixture harness: PASS');
