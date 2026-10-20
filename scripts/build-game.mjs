import { spawn } from 'node:child_process';
import { mkdir, cp, rename, stat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = path.join(root, '.local/creator-build');
await mkdir(buildRoot, { recursive: true });
const code = await new Promise(resolve => {
  const child = spawn('bash', [path.join(root, 'cocos-client/tools/build-p0.sh')], { cwd: root,
    env: { ...process.env, P0_BUILD_ROOT: buildRoot, P0_RECORD_BUILD_LOCATION: '0' }, stdio: 'inherit' });
  child.once('exit', resolve); child.once('error', () => resolve(1));
});
if (code !== 0) process.exit(Number(code ?? 1));
const next = path.join(root, '.local/web-next-' + Date.now());
await cp(path.join(buildRoot, 'project/build/web-desktop'), next, { recursive: true });
const html = path.join(next, 'index.html');
await writeFile(html, (await readFile(html, 'utf8')).replace(/<title>[^<]*<\/title>/, '<title>天墟 · 战术卡牌</title>'));
const final = path.join(root, '.local/web');
try { await stat(final); await rename(final, path.join(root, '.local/web-previous-' + Date.now())); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await rename(next, final);
console.log('本机客户端已生成：.local/web；启动：npm start');
