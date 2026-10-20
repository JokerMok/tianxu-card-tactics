import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = { checkedAt: new Date().toISOString(), status: 'running', scope: 'integrated-game', steps: [], boundaries: ['Browser interaction evidence is recorded separately in ui-check.md.', 'Configuration counts do not prove every possible deck or matchup has been played.'] };
const out = path.join(root, 'documentation/recovery/final-regression.json');
await mkdir(path.dirname(out), { recursive: true });
const tests = (await readdir(path.join(root, 'backend/game'))).filter(file => file.endsWith('.test.mjs')).map(file => 'backend/game/' + file);
const steps = [
  [process.execPath, ['scripts/verify-recovered-content.mjs']],
  [process.execPath, ['--test', '--test-concurrency=1', ...tests, 'cocos-client/assets/scripts/game/BattleKernel.test.mjs']],
  [process.execPath, ['web-prototype/node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--allowImportingTsExtensions', '--experimentalDecorators', '--skipLibCheck', '.local/creator-build/project/temp/declarations/cc.d.ts', 'cocos-client/assets/scripts/a0/BattleA0Bootstrap.ts']],
  [process.execPath, ['scripts/verify-recovered-visuals.mjs']],
];
for (const [command, args] of steps) {
  const began = Date.now();
  const code = await new Promise(resolve => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('exit', resolve); child.once('error', () => resolve(1));
  });
  report.steps.push({ command: [path.basename(command), ...args].join(' '), exitCode: code, durationMs: Date.now() - began });
  report.status = code === 0 ? 'running' : 'failed';
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  if (code !== 0) process.exit(Number(code ?? 1));
}
const folders = ['backend/game', 'cocos-client/assets/scripts/game'];
const sources = (await Promise.all(folders.map(async folder => (await readdir(path.join(root, folder))).filter(file => /\.(ts|mjs)$/.test(file)).map(file => folder + '/' + file)))).flat();
report.sourceHashes = Object.fromEntries(await Promise.all(sources.map(async file => [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
report.buildPresent = existsSync(path.join(root, '.local/web/index.html'));
report.status = 'passed';
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log('Integrated game checks passed. Campaign progression and browser evidence remain separately scoped.');
