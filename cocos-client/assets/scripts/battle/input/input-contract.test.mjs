import assert from 'node:assert/strict';
import fs from 'node:fs';

const adapterSource = fs.readFileSync(new URL('./battle-input-adapter.ts', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

assert.match(adapterSource, /export class BattleInputAdapter/);
assert.match(adapterSource, /DEPLOY_UNIT/);
assert.match(adapterSource, /PLAY_CARD/);
assert.match(adapterSource, /CELL_OUT_OF_BOUNDS/);
assert.match(adapterSource, /CELL_OCCUPIED/);
assert.match(adapterSource, /TARGET_TYPE_MISMATCH/);
assert.match(adapterSource, /Object\.freeze/);
assert.doesNotMatch(adapterSource, /from ['"]node:/);
assert.doesNotMatch(adapterSource, /from ['"](?:fs|path|url|events)['"]/);
assert.match(indexSource, /battle-input-adapter/);

console.log('BattleInputAdapter static contract PASS');
