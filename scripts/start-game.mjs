import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node 22.18 或更新版本');
async function run(command, args) {
  const code = await new Promise(resolve => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('exit', resolve); child.once('error', () => resolve(1));
  });
  if (code !== 0) process.exit(Number(code ?? 1));
}
if (!existsSync(path.join(root, 'cocos-client/assets/resources/recovered/catalog.json'))) await run('python3', ['scripts/import-kings-call.py']);
if (!existsSync(path.join(root, 'cocos-client/assets/resources/recovered/original-ui.json'))) await run('python3', ['scripts/import-original-ui.py']);
if (!existsSync(path.join(root, 'cocos-client/assets/resources/recovered/item-ui.json'))) await run('python3', ['scripts/import-item-ui.py']);
if (!existsSync(path.join(root, '.local/web/index.html'))) await run(process.execPath, ['scripts/build-game.mjs']);
const { createGameServer } = await import('../backend/game/server.mjs');
const app = await createGameServer();
const port = Number(process.env.TIANXU_PORT ?? 7400);
app.server.on('error', error => { console.error(error.message); void app.close().finally(() => process.exit(1)); });
app.server.listen(port, '127.0.0.1', () => console.log(`\n天墟：万象战阵已启动\n实际访问地址：http://127.0.0.1:${port}\n角色和存档：backend/data/tianxu.sqlite\n按 Ctrl+C 停止服务\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
