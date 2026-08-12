import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../../..');
const viewRoot = path.join(root, 'assets/scripts/battle/view');
const runtimeFiles = fs.readdirSync(viewRoot).filter((file) => file.endsWith('.ts'));
assert.ok(runtimeFiles.length > 0, 'battle/view must contain runtime view code');

for (const file of runtimeFiles) {
  const source = fs.readFileSync(path.join(viewRoot, file), 'utf8');
  assert.doesNotMatch(source, /(?:from|require\()\s*['"]node:/, `${file} must not use Node-only dependencies`);
  assert.doesNotMatch(source, /runner\/|session-controller|web-prototype|\bReact\b/, `${file} must remain a view adapter`);
  assert.doesNotMatch(source, /import\s+(?!type\b)[\s\S]*?from ['"]\.\.\/\.\.\/core\//, `${file} must not place view logic in core`);
}

const controllerSource = fs.readFileSync(path.join(root, 'assets/scripts/battle/session-controller.ts'), 'utf8');
assert.doesNotMatch(controllerSource, /view\//, 'session controller must not own view binding');

const handSource = fs.readFileSync(path.join(viewRoot, 'battle-hand-view.ts'), 'utf8');
assert.doesNotMatch(handSource, /(?:from|require\()\s*['"]node:/, 'battle hand view must not use Node-only dependencies');
assert.doesNotMatch(handSource, /runner\/|session-controller|web-prototype|\bReact\b/, 'battle hand view must remain a view adapter');
assert.doesNotMatch(handSource, /import\s+(?!type\b)[\s\S]*?from ['"]\.\.\/\.\.\/core\//, 'battle hand view must not place view logic in core');

console.log('BattleState view static contract: PASS');
