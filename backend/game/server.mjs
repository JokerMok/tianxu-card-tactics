import http from 'node:http';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createReadStream, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runtimeLogger} from './runtime-log.mjs';
import { GameStore } from './store.mjs';
import { ServerContent } from './content.mjs';
import { GameService } from './service.mjs';
import {GmService,exactKeys} from './gm-service.mjs';
import {createGmHttp} from './gm-http.mjs';
import {clientAddress,rateLimiter} from './request-security.mjs';

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
function rejectManagementFields(data) {
  const pending=[data];let nodes=0;
  while(pending.length){const value=pending.pop();if(!value||typeof value!=='object')continue;
    if(++nodes>10000)throw new Error('请求结构过于复杂');
    for(const [key,item]of Object.entries(value)){
      if(['role','isAdmin','permissions','accountRole','super_admin'].includes(key))throw new Error('玩家接口不接受管理权限字段');
      if(item&&typeof item==='object')pending.push(item);
    }
  }
}
export async function createGameServer(options = {}) {
  const folder = options.contentFolder ?? process.env.TIANXU_CONTENT_DIR ?? path.join(ROOT, 'cocos-client/assets/resources/recovered');
  const web = options.webFolder ?? process.env.TIANXU_WEB_DIR ?? path.join(ROOT, '.local/web');
  const uiFolder=options.uiFolder??process.env.TIANXU_UI_DIR??path.join(folder,'../ui-revision-a');
  const localizationFolder=options.localizationFolder??process.env.TIANXU_LOCALIZATION_DIR??path.join(folder,'../localization');
  const log=runtimeLogger(options.logDir??process.env.TIANXU_LOG_DIR);
  const publicOrigin=options.publicOrigin??process.env.TIANXU_PUBLIC_ORIGIN;
  const trustedProxies=options.trustedProxies??String(process.env.TIANXU_TRUSTED_PROXY??'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!existsSync(path.join(folder,'catalog.json')))throw new Error('缺少运行资源catalog.json，请先按资源清单打包/导入，不需要逆向目录');
  const content = new ServerContent(folder,{localizationFolder});
  const store = new GameStore(options.database ?? process.env.TIANXU_DATABASE ?? path.join(ROOT, 'backend/data/tianxu.sqlite'));
  const service = new GameService(store, content, { clock: options.clock });
  const catalogBytes=Buffer.from(JSON.stringify(content.catalog));
  const catalogGzip=gzipSync(catalogBytes);
  const catalogEtag='"'+createHash('sha256').update(catalogBytes).digest('hex')+'"';
  const gm=new GmService(store,content),limit=rateLimiter(),address=req=>clientAddress(req,trustedProxies);
  const gmHttp=createGmHttp({store,gm,publicOrigin,body,limit,address});
  const gmWeb=options.gmWebFolder??path.join(ROOT,'backend/gm-web');
  const allowTestActions = options.allowTestActions === true && process.env.NODE_ENV !== 'production';
  const server = http.createServer(async (request, response) => {
    const traceId=randomUUID();response.setHeader('X-Trace-Id',traceId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      if(url.pathname==='/beta'||url.pathname.startsWith('/beta/')){
        response.writeHead(303,{'Location':'/','Cache-Control':'no-store','Set-Cookie':'__Host-tianxu_beta=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'});response.end();return;
      }
      if(url.pathname==='/'&&String(request.headers.cookie??'').includes('__Host-tianxu_beta='))response.setHeader('Set-Cookie','__Host-tianxu_beta=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
      if(await gmHttp(request,response,url,json))return;
      if (request.method === 'GET' && url.pathname === '/api/health') return json(200, { ready: true, game: '天墟：万象战阵', version: 2, schema:2, sourceManifest: content.catalog.sourceManifest });
      if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
        const backdrop = content.catalog.assets[content.catalog.ui?.backgroundAssetId]?.path;
        return json(200, { title: '天墟：万象战阵', backdrop: backdrop ? '/recovered/' + backdrop : null });
      }
      if (request.method === 'POST' && ['/api/register', '/api/login'].includes(url.pathname)) {
        limit('player-auth:'+address(request),20);
        const data = await body(request);
        exactKeys(data,['username','password']);
        limit('player-auth-account:'+String(data.username).toLowerCase(),10);
        return json(200, url.pathname === '/api/register' ? store.register(data.username, data.password) : store.login(data.username, data.password));
      }
      if (url.pathname.startsWith('/api/')) {
        const token = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
        const accountId = store.authenticate(token);
        const characterId = String(request.headers['x-character-id'] ?? '');
        if (request.method === 'GET' && url.pathname === '/api/characters') return json(200, { characters: service.characters(accountId) });
        if (request.method === 'GET' && url.pathname === '/api/catalog') {
          const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, max-age=3600','ETag':catalogEtag,'Vary':'Accept-Encoding'};
          if(request.headers['if-none-match']===catalogEtag){response.writeHead(304,headers);response.end();return;}
          const compressed=/\bgzip\b/.test(String(request.headers['accept-encoding']??''));
          const bytes=compressed?catalogGzip:catalogBytes;
          response.writeHead(200,{...headers,'Content-Length':bytes.length,...(compressed?{'Content-Encoding':'gzip'}:{})});response.end(bytes);return;
        }
        if (request.method === 'GET' && url.pathname === '/api/state') {
          if(url.searchParams.get('instance')===service.instanceId){
            const world=store.read(),actor=service.actor(world,accountId,characterId);
            if(url.searchParams.get('since')===String(world.revision)&&actor.stageScope&&Number.isFinite(actor.growth?.lastActiveAt)&&service.clock()-actor.growth.lastActiveAt<60000)return json(200,{unchanged:true,revision:world.revision,serverInstance:service.instanceId,now:service.clock()});
          }
          const view = service.view(accountId, characterId);
          if (!allowTestActions && view.growth?.sections) view.growth.sections = view.growth.sections
            .filter(section => section.id !== 'local-tools')
            .map(section => ({ ...section, items: section.items.filter(item => !String(item.action ?? '').startsWith('test.')) }));
          return json(200, view);
        }
        if (request.method === 'POST' && url.pathname === '/api/logout') { store.logout(token); return json(200, { loggedOut: true }); }
        if (request.method === 'POST' && url.pathname === '/api/act') {
          const data = await body(request);
          rejectManagementFields(data);
          if (typeof data.action !== 'string') throw new Error('缺少操作');
          if (!allowTestActions && data.action.startsWith('test.')) throw Object.assign(new Error('当前服务器未开放测试操作'), { status: 403, code: 'TEST_ACTION_DISABLED' });
          const result=service.act(accountId,characterId,data.requestId,data.action,data.payload,{expectedActorRevision:data.expectedActorRevision});
          log('info','operation',{traceId,accountId,characterId,action:data.action,requestId:data.requestId,revision:result.revision,replayed:result.replayed});
          return json(200,result);
        }
        return json(404, { error: '接口不存在' });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: '不支持此请求' });
      if(url.pathname==='/gm'){response.writeHead(308,{'Location':'/gm/','Cache-Control':'no-store'});response.end();return;}
      const isGm=url.pathname.startsWith('/gm/');
      const isResource = url.pathname.startsWith('/recovered/');
      const isUi=url.pathname.startsWith('/ui-assets/');
      const base = isGm?gmWeb:isUi ? uiFolder : isResource ? folder : web;
      const relative = decodeURIComponent(isGm?url.pathname.slice('/gm/'.length):isUi ? url.pathname.slice('/ui-assets/'.length) : isResource ? url.pathname.slice('/recovered/'.length) : url.pathname.slice(1)) || 'index.html';
      if(isGm&&!['index.html','app.js','style.css'].includes(relative))return json(404,{error:'资源不存在'});
      if(isGm){response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");response.setHeader('X-Frame-Options','DENY');}
      const filename = path.resolve(base, relative);
      if (!filename.startsWith(path.resolve(base) + path.sep) || !existsSync(filename) || !statSync(filename).isFile()) return json(404, { error: '资源不存在' });
      const stat = statSync(filename);
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filename).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': stat.size, 'Cache-Control': isGm?'no-store':isResource && path.extname(filename) !== '.json' ? 'private, max-age=3600' : 'no-cache' });
      if (request.method === 'HEAD') return response.end();
      createReadStream(filename).pipe(response);
    } catch (error) {
      if(error instanceof SyntaxError)error=new Error('数据格式无效，请检查请求或存档');
      const internal=error instanceof TypeError||error instanceof ReferenceError||String(error.code??'').startsWith('ERR_SQLITE');
      const status=internal?500:(error.status??(/登录|角色不存在或/.test(error.message)?401:400));
      log(status>=500?'error':'warn','request-rejected',{traceId,status,code:error.code??'VALIDATION_REJECTED',message:error.message,...(internal?{stack:error.stack}:{})});
      if (!response.headersSent) json(status, { error:internal?'服务暂时异常，操作未确认，请用原请求重试':error.message,code:error.code??(internal?'INTERNAL_ERROR':'VALIDATION_REJECTED'),...(error.details??{}),traceId });
      else response.end();
    }
  });
  const timer = options.scheduler === false ? null : setInterval(() => {
    try { service.tick(); } catch (error) { log('error','scheduler-error',{message:error.message,stack:error.stack}); }
  }, 1000);
  timer?.unref();
  let stopping;const close=()=>stopping??=(async()=>{if(timer)clearInterval(timer);await new Promise(resolve=>{const deadline=setTimeout(()=>server.closeAllConnections(),10000);deadline.unref();server.close(()=>{clearTimeout(deadline);resolve();});server.closeIdleConnections?.();});store.close();log('info','stopped');})();
  return { server, store, content, service, gm, close, log };
}
export async function startConfiguredServer(){
 const port=Number(process.env.TIANXU_PORT??7400),host=process.env.TIANXU_HOST??'127.0.0.1';
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('TIANXU_PORT需为1至65535');const app=await createGameServer();
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,host,resolve);}).catch(async e=>{await app.close();throw e;});
 console.log(`天墟服务已启动 http://${host}:${port}；数据库：${app.store.filename}`);app.log('info','started',{port,host,schema:2});
 let stopping=false;const stop=async code=>{if(stopping)return;stopping=true;try{await app.close();}finally{process.exitCode=code;}};
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop(0));
 process.once('uncaughtException',e=>{app.log('error','uncaught-exception',{message:e.message,stack:e.stack});void stop(1);});
 process.once('unhandledRejection',e=>{app.log('error','unhandled-rejection',{message:String(e)});void stop(1);});return app;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startConfiguredServer().catch(e=>{console.error('启动失败：'+e.message);process.exitCode=1;});
