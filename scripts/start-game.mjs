import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) throw new Error('需要 Node 22.18 或更新版本');
// Runtime startup consumes prebuilt assets only; Cocos compilation/import are separate explicit steps.
const web=process.env.TIANXU_WEB_DIR??path.join(root,'.local/web');
if(!existsSync(path.join(web,'index.html')))throw new Error('缺少前端构建，请先构建Cocos客户端或配置TIANXU_WEB_DIR');
const {startConfiguredServer}=await import('../backend/game/server.mjs');
await startConfiguredServer();
