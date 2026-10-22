import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createReadStream, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { GameStore } from './store.mjs';
import { ServerContent } from './content.mjs';
import { GameService } from './service.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.css': 'text/css', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.woff': 'font/woff' };
async function body(request) {
  let bytes = 0; const parts = [];
  for await (const part of request) {
    bytes += part.length; if (bytes > 1024 * 1024) throw new Error('请求内容过大'); parts.push(part);
  }
  const result = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('请求格式错误');
  return result;
}
export async function createGameServer(options = {}) {
  const folder = options.contentFolder ?? path.join(ROOT, 'cocos-client/assets/resources/recovered');
  const web = options.webFolder ?? path.join(ROOT, '.local/web');
  const store = new GameStore(options.database ?? path.join(ROOT, 'backend/data/tianxu.sqlite'));
  const content = new ServerContent(folder);
  const service = new GameService(store, content, { clock: options.clock });
  const rates = new Map();
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/health') return json(200, { ready: true, game: '天墟：万象战阵', version: 1, sourceManifest: content.catalog.sourceManifest });
      if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
        const backdrop = content.catalog.assets[content.catalog.ui?.backgroundAssetId]?.path;
        return json(200, { title: '天墟：万象战阵', backdrop: backdrop ? '/recovered/' + backdrop : null });
      }
      if (request.method === 'POST' && ['/api/register', '/api/login'].includes(url.pathname)) {
        const origin = request.socket.remoteAddress; const now = Date.now();
        const rate = (rates.get(origin) ?? []).filter(at => now - at < 60000);
        if (rate.length >= 20) return json(429, { error: '登录操作过快，请稍后重试' });
        rate.push(now); rates.set(origin, rate);
        const data = await body(request);
        return json(200, url.pathname === '/api/register' ? store.register(data.username, data.password) : store.login(data.username, data.password));
      }
      if (url.pathname.startsWith('/api/')) {
        const token = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
        const accountId = store.authenticate(token);
        const characterId = String(request.headers['x-character-id'] ?? '');
        if (request.method === 'GET' && url.pathname === '/api/characters') return json(200, { characters: service.characters(accountId) });
        if (request.method === 'GET' && url.pathname === '/api/catalog') return json(200, content.catalog);
        if (request.method === 'GET' && url.pathname === '/api/state') return json(200, service.view(accountId, characterId));
        if (request.method === 'POST' && url.pathname === '/api/logout') { store.logout(token); return json(200, { loggedOut: true }); }
        if (request.method === 'POST' && url.pathname === '/api/act') {
          const data = await body(request);
          if (typeof data.action !== 'string') throw new Error('缺少操作');
          return json(200, service.act(accountId, characterId, data.requestId, data.action, data.payload));
        }
        return json(404, { error: '接口不存在' });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: '不支持此请求' });
      const isResource = url.pathname.startsWith('/recovered/');
      const isUi=url.pathname.startsWith('/ui-assets/');
      const base = isUi ? path.join(folder,'../ui-revision-a') : isResource ? folder : web;
      const relative = decodeURIComponent(isUi ? url.pathname.slice('/ui-assets/'.length) : isResource ? url.pathname.slice('/recovered/'.length) : url.pathname.slice(1)) || 'index.html';
      const filename = path.resolve(base, relative);
      if (!filename.startsWith(path.resolve(base) + path.sep) || !existsSync(filename) || !statSync(filename).isFile()) return json(404, { error: '资源不存在' });
      const stat = statSync(filename);
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filename).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': stat.size, 'Cache-Control': isResource && path.extname(filename) !== '.json' ? 'private, max-age=3600' : 'no-cache' });
      if (request.method === 'HEAD') return response.end();
      createReadStream(filename).pipe(response);
    } catch (error) {
      if (!response.headersSent) json(/登录|角色不存在或/.test(error.message) ? 401 : 400, { error: error.message });
      else response.end();
    }
  });
  const timer = options.scheduler === false ? null : setInterval(() => {
    try { service.tick(); } catch (error) { console.error('定时结算失败:', error.message); }
  }, 1000);
  timer?.unref();
  const close = () => new Promise(resolve => server.close(() => { if (timer) clearInterval(timer); store.close(); resolve(); }));
  return { server, store, content, service, close };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createGameServer();
  const port = Number(process.env.TIANXU_PORT ?? 7400);
  app.server.listen(port, '127.0.0.1', () => console.log(`天墟：万象战阵 http://127.0.0.1:${port}\n数据库：backend/data/tianxu.sqlite`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
}
