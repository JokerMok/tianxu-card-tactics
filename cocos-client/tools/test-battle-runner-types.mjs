import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(root, 'assets/scripts/battle/runner/battle-runner.ts');
const source = fs.readFileSync(runnerPath, 'utf8');

assert.match(source, /function isSafeInteger\(value: unknown\): value is number/);
assert.match(source, /function isUnknownArray\(value: unknown\): value is readonly unknown\[\]/);
assert.match(source, /const rawActions = value\.actions;/);
assert.match(source, /const actions: HighLevelAction\[\] = rawActions\.map\(\(action, index\) => parseAction\(action, index\)\);/);
assert.doesNotMatch(source, /\bas any\b/);
assert.doesNotMatch(source, /value\.actions\.map\(parseAction\)/);
assert.match(source, /const HERO_MAX_HP = 30;/);

console.log('Battle Runner type-contract static check: PASS');
