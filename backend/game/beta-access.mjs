import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const COOKIE_NAME = '__Host-tianxu_beta';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const ATTEMPT_WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 20;
const MAX_RATE_KEYS = 4096;
const MAX_FORM_BYTES = 4096;

function fail(message) {
  throw new Error(`Beta 邀请配置无效：${message}`);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : null;
}

export function validateBetaAccessConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('根节点必须是对象');
  if (!hasExactKeys(value, ['invitations', 'signingKey', 'version'])) fail('根节点包含未知或缺失字段');
  if (value.version !== 1) fail('version 必须为 1');
  const key = decodeBase64Url(value.signingKey);
  if (!key || key.length !== 32) fail('signingKey 必须是 32 字节 base64url 值');
  if (!Array.isArray(value.invitations)) fail('invitations 必须是数组');

  const ids = new Set();
  const invitations = value.invitations.map((invitation, index) => {
    if (!invitation || typeof invitation !== 'object' || Array.isArray(invitation)) fail(`invitations[${index}] 必须是对象`);
    if (!hasExactKeys(invitation, ['codeHash', 'enabled', 'expiresAt', 'id', 'version'])) fail(`invitations[${index}] 包含未知或缺失字段`);
    if (typeof invitation.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(invitation.id)) fail(`invitations[${index}].id 格式错误`);
    if (ids.has(invitation.id)) fail(`邀请 id 重复：${invitation.id}`);
    ids.add(invitation.id);
    if (typeof invitation.codeHash !== 'string' || !/^[a-f0-9]{64}$/.test(invitation.codeHash)) fail(`invitations[${index}].codeHash 必须是 sha256 十六进制值`);
    if (typeof invitation.enabled !== 'boolean') fail(`invitations[${index}].enabled 必须是布尔值`);
    if (!Number.isInteger(invitation.version) || invitation.version < 1) fail(`invitations[${index}].version 必须是正整数`);
    const expiresAtMs = Date.parse(invitation.expiresAt);
    if (typeof invitation.expiresAt !== 'string' || !Number.isFinite(expiresAtMs) || new Date(expiresAtMs).toISOString() !== invitation.expiresAt) fail(`invitations[${index}].expiresAt 必须是 ISO 时间`);
    return Object.freeze({ ...invitation, expiresAtMs, hashBytes: Buffer.from(invitation.codeHash, 'hex') });
  });

  return Object.freeze({ version: 1, signingKey: Buffer.from(key), invitations: Object.freeze(invitations) });
}

function loadConfig(configPath) {
  const stat = statSync(configPath, { bigint: true });
  if (!stat.isFile()) fail('配置路径不是普通文件');
  if ((Number(stat.mode) & 0o077) !== 0) fail('配置文件权限必须禁止组用户和其他用户访问');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(error instanceof SyntaxError ? 'JSON 无法解析' : '配置文件无法读取');
  }
  return {
    fingerprint: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.mode}`,
    value: validateBetaAccessConfig(parsed),
  };
}

function normalizeOrigin(publicOrigin) {
  let url;
  try { url = new URL(publicOrigin); } catch { fail('publicOrigin 必须是完整的 http(s) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('publicOrigin 必须是完整的 http(s) origin');
  return url.origin;
}

function send(res, status, headers, body = '') {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(value));
}

function page(message = '') {
  const notice = message ? `<p role="alert">${message}</p>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>天墟限量试玩</title></head><body><main><h1>天墟：万象战阵</h1><p>本次试玩仅向受邀玩家开放。</p>${notice}<form method="post" action="/beta/enter"><label>邀请码 <input name="code" type="password" autocomplete="one-time-code" required maxlength="256"></label><button type="submit">进入试玩</button></form></main></body></html>`;
}

function sendPage(res, status, message = '') {
  send(res, status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    // Browser form POSTs need their same-origin Origin for the CSRF check.
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  }, page(message));
}

function parseCookies(header) {
  const result = new Map();
  for (const entry of String(header ?? '').split(';')) {
    const at = entry.indexOf('=');
    if (at < 1) continue;
    const name = entry.slice(0, at).trim();
    if (!result.has(name)) result.set(name, entry.slice(at + 1).trim());
  }
  return result;
}

function sign(key, payload) {
  return createHmac('sha256', key).update(payload).digest();
}

function createCookie(config, invitation, now) {
  const expires = Math.min(now + SESSION_SECONDS * 1000, invitation.expiresAtMs);
  const payload = Buffer.from(JSON.stringify({ id: invitation.id, version: invitation.version, exp: expires })).toString('base64url');
  const signature = sign(config.signingKey, payload).toString('base64url');
  const maxAge = Math.max(0, Math.floor((expires - now) / 1000));
  return `${COOKIE_NAME}=${payload}.${signature}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

function authenticate(req, config, now) {
  const token = parseCookies(req.headers.cookie).get(COOKIE_NAME);
  if (!token || token.length > 2048) return false;
  const separator = token.indexOf('.');
  if (separator < 1 || token.indexOf('.', separator + 1) !== -1) return false;
  const payloadText = token.slice(0, separator);
  const suppliedSignature = decodeBase64Url(token.slice(separator + 1));
  const expectedSignature = sign(config.signingKey, payloadText);
  if (!suppliedSignature || suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) return false;
  const payloadBytes = decodeBase64Url(payloadText);
  if (!payloadBytes || payloadBytes.length > 1024) return false;
  let payload;
  try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { return false; }
  if (!payload || typeof payload.id !== 'string' || !Number.isInteger(payload.version) || !Number.isFinite(payload.exp) || payload.exp <= now) return false;
  const invitation = config.invitations.find(item => item.id === payload.id);
  return Boolean(invitation && invitation.enabled && invitation.version === payload.version && invitation.expiresAtMs > now);
}

function readSmallForm(req) {
  const lengthHeader = req.headers['content-length'];
  if (lengthHeader !== undefined && (!/^\d+$/.test(String(lengthHeader)) || Number(lengthHeader) > MAX_FORM_BYTES)) return Promise.reject(Object.assign(new Error('请求内容过大'), { status: 413 }));
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_FORM_BYTES) { tooLarge = true; chunks.length = 0; }
      else if (!tooLarge) chunks.push(chunk);
    });
    req.once('end', () => tooLarge ? reject(Object.assign(new Error('请求内容过大'), { status: 413 })) : resolve(Buffer.concat(chunks).toString('utf8')));
    req.once('aborted', () => reject(Object.assign(new Error('请求已中断'), { status: 400 })));
    req.once('error', reject);
  });
}

function isNavigation(req) {
  return (req.method === 'GET' || req.method === 'HEAD') && /(?:^|,)\s*text\/html(?:\s*[;,]|$)/i.test(String(req.headers.accept ?? ''));
}

/**
 * Creates the request gate. A configured path is validated synchronously so a
 * required or explicitly configured gate can never silently start unprotected.
 */
export function createBetaAccess({ configPath, required = false, publicOrigin } = {}) {
  if (!configPath) {
    if (required) throw new Error('Beta 邀请门禁已设为必需，但未提供配置路径');
    return async () => false;
  }
  const origin = normalizeOrigin(publicOrigin);
  let snapshot = loadConfig(configPath);
  const attempts = new Map();

  function currentConfig() {
    const stat = statSync(configPath, { bigint: true });
    const fingerprint = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.mode}`;
    if (fingerprint !== snapshot.fingerprint) snapshot = loadConfig(configPath);
    return snapshot.value;
  }

  return async function handle(req, res, suppliedUrl) {
    const url = suppliedUrl instanceof URL ? suppliedUrl : new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/api/health') return false;
    let config;
    try { config = currentConfig(); } catch {
      sendJson(res, 503, { error: '试玩邀请服务暂时不可用' });
      return true;
    }

    if (url.pathname === '/beta' && req.method === 'GET') {
      sendPage(res, 200, authenticate(req, config, Date.now()) ? '当前浏览器已通过邀请验证。' : '');
      return true;
    }

    if (url.pathname === '/beta/enter' && req.method === 'POST') {
      const now = Date.now();
      const key = String(req.socket?.remoteAddress ?? 'unknown');
      if (!attempts.has(key) && attempts.size >= MAX_RATE_KEYS) attempts.delete(attempts.keys().next().value);
      const recent = (attempts.get(key) ?? []).filter(value => now - value < ATTEMPT_WINDOW_MS);
      if (recent.length >= MAX_ATTEMPTS_PER_WINDOW) {
        attempts.set(key, recent);
        sendJson(res, 429, { error: '尝试过于频繁，请稍后再试' });
        return true;
      }
      recent.push(now); attempts.set(key, recent);
      if (req.headers.origin !== origin) {
        sendJson(res, 403, { error: '请求来源无效' });
        return true;
      }
      if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) {
        sendJson(res, 415, { error: '请求格式无效' });
        return true;
      }
      let encoded;
      try { encoded = await readSmallForm(req); } catch (error) {
        sendJson(res, error.status === 413 ? 413 : 400, { error: error.status === 413 ? '请求内容过大' : '请求无法读取' });
        return true;
      }
      const form = new URLSearchParams(encoded);
      const codes = form.getAll('code');
      const candidateHash = createHash('sha256').update(codes.length === 1 ? codes[0] : '').digest();
      let matched = null;
      for (const invitation of config.invitations) {
        if (timingSafeEqual(candidateHash, invitation.hashBytes)) matched = invitation;
      }
      if (!matched || codes.length !== 1 || !matched.enabled || matched.expiresAtMs <= now) {
        sendPage(res, 401, '邀请码无效或已失效。');
        return true;
      }
      send(res, 303, { 'Location': '/', 'Set-Cookie': createCookie(config, matched, now) });
      return true;
    }

    if (url.pathname === '/beta/exit' && req.method === 'POST') {
      if (req.headers.origin !== origin) {
        sendJson(res, 403, { error: '请求来源无效' });
        return true;
      }
      send(res, 303, { 'Location': '/beta', 'Set-Cookie': clearCookie() });
      return true;
    }

    if (url.pathname === '/beta' || url.pathname.startsWith('/beta/')) {
      sendJson(res, 405, { error: '不支持此请求' });
      return true;
    }

    if (authenticate(req, config, Date.now())) return false;
    if (isNavigation(req)) {
      send(res, 303, { 'Location': '/beta' });
      return true;
    }
    sendJson(res, 403, { error: '需要有效的试玩邀请' });
    return true;
  };
}

