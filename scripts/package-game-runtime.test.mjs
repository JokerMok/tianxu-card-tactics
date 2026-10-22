import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { materializeRuntime, safeRelative } from './package-game-runtime.mjs';

test('runtime paths reject traversal and platform-specific escapes', () => {
  for (const value of ['../secret', 'files/../../secret', '/absolute', 'windows\\secret']) {
    assert.throws(() => safeRelative(value), /escapes|Invalid/);
  }
  assert.equal(safeRelative('backend/game/server.mjs'), 'backend/game/server.mjs');
});

test('small runtime fixture is copied and manifested without overwriting output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tianxu-package-test-'));
  try {
    const source = path.join(root, 'source');
    const output = path.join(root, 'runtime');
    await mkdir(path.join(source, 'backend/game'), { recursive: true });
    const filename = path.join(source, 'backend/game/server.mjs');
    await writeFile(filename, 'export const ready = true;\n');
    const plan = { files: [{ relative: 'backend/game/server.mjs', filename, size: 27 }] };
    await materializeRuntime(plan, output);
    assert.equal(await readFile(path.join(output, 'backend/game/server.mjs'), 'utf8'), 'export const ready = true;\n');
    const manifest = JSON.parse(await readFile(path.join(output, 'runtime-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.files.map(file => file.path), ['backend/game/server.mjs', 'package.json']);
    await assert.rejects(() => materializeRuntime(plan, output), /already exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
