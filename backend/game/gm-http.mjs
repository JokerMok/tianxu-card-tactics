import {randomBytes,timingSafeEqual} from 'node:crypto';
import {digest} from './store.mjs';
import {exactKeys} from './gm-service.mjs';

const COOKIE='__Host-tianxu_gm';
const denied=(message,code,status)=>Object.assign(new Error(message),{code,status});
function cookieToken(request) {
  const values=String(request.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));
  if(values.length!==1)return '';
  const token=values[0].slice(COOKIE.length+1);return /^[A-Za-z0-9_-]{40,60}$/.test(token)?token:'';
}
function sameSecret(a,b) {
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);
}
function setCookie(response,token,maxAge) {
  response.setHeader('Set-Cookie',`${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`);
}
export function createGmHttp({store,gm,publicOrigin,body,limit,address}) {
  function origin(request) {
    const expected=publicOrigin??(process.env.NODE_ENV==='production'?null:'http://'+request.headers.host);
    if(!expected||request.headers.origin!==expected)throw denied('请求来源无效','GM_ORIGIN_REJECTED',403);
  }
  function session(request) {
    const token=cookieToken(request);let accountId;
    try{accountId=store.authenticate(token);}catch{throw denied('请登录GM后台','GM_LOGIN_REQUIRED',401);}
    const record=store.db.prepare('SELECT * FROM gm_sessions WHERE token_hash=? AND account_id=?').get(digest(token),accountId);
    if(!record||record.expires<=Date.now())throw denied('GM会话已过期，请重新登录','GM_LOGIN_REQUIRED',401);
    const access=gm.authorize(accountId);
    if(record.access_revision!==access.revision)throw denied('管理权限已更新，请重新登录','GM_SESSION_REVOKED',401);
    return {accountId,token,record};
  }
  return async (request,response,url,json)=>{
    if(!url.pathname.startsWith('/api/gm/'))return false;
    const ip=address(request);limit('gm-all:'+ip,180);
    if(url.pathname==='/api/gm/login') {
      if(request.method!=='POST')throw denied('不支持此请求','METHOD_NOT_ALLOWED',405);
      origin(request);limit('gm-login:'+ip,10);const data=await body(request);exactKeys(data,['username','password']);
      limit('gm-login-account:'+String(data.username).toLowerCase(),10);
      let identity;try{identity=store.login(data.username,data.password);}catch{throw denied('账号或密码错误','GM_LOGIN_FAILED',401);}
      let view;
      try{view=gm.identity(identity.accountId);}catch(e){store.logout(identity.token);throw Object.assign(e,{details:{accountId:identity.accountId}});}
      const csrfToken=randomBytes(32).toString('base64url'),access=gm.access(identity.accountId);
      store.db.prepare('INSERT INTO gm_sessions VALUES(?,?,?,?,?)').run(digest(identity.token),identity.accountId,access.revision,csrfToken,Date.now()+8*3600000);
      setCookie(response,identity.token,8*3600);json(200,{...view,csrfToken});return true;
    }
    const s=session(request);
    if(!['GET','POST'].includes(request.method))throw denied('不支持此请求','METHOD_NOT_ALLOWED',405);
    if(request.method==='POST') {
      origin(request);
      if(!sameSecret(request.headers['x-csrf-token'],s.record.csrf))throw denied('管理请求校验失败，请刷新页面','GM_CSRF_REJECTED',403);
      limit('gm-write:'+s.accountId,40);limit('gm-write-ip:'+ip,80);
    }
    const query=Object.fromEntries(url.searchParams);
    if(request.method==='GET') {
      if(url.pathname==='/api/gm/session')json(200,{...gm.identity(s.accountId),csrfToken:s.record.csrf});
      else if(url.pathname==='/api/gm/players')json(200,gm.players(s.accountId,query));
      else if(url.pathname==='/api/gm/character')json(200,gm.character(s.accountId,query.accountId,query.characterId));
      else if(url.pathname==='/api/gm/resources')json(200,gm.resources(s.accountId,query));
      else if(url.pathname==='/api/gm/access')json(200,gm.getAccess(s.accountId,query.accountId));
      else if(url.pathname==='/api/gm/logs')json(200,gm.logs(s.accountId,query));
      else if(/^\/api\/gm\/operations\/[A-Za-z0-9_-]{8,100}$/.test(url.pathname))json(200,gm.operation(s.accountId,url.pathname.split('/').at(-1)));
      else throw denied('管理接口不存在','GM_NOT_FOUND',404);
      return true;
    }
    const data=await body(request);
    if(url.pathname==='/api/gm/logout'){exactKeys(data,[]);store.logout(s.token);setCookie(response,'',0);json(200,{loggedOut:true});}
    else if(url.pathname==='/api/gm/grants')json(200,gm.grant(s.accountId,data));
    else if(url.pathname==='/api/gm/access'){limit('gm-access:'+s.accountId,15);json(200,gm.changeAccess(s.accountId,data));}
    else throw denied('管理接口不存在','GM_NOT_FOUND',404);
    return true;
  };
}
