import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBetaAccess } from './beta-access.mjs';

function hash(code) {
  return createHash('sha256').update(code).digest('hex');
}

function sampleConfig() {
  return {
    version: 1,
    signingKey: Buffer.alloc(32, 7).toString('base64url'),
    invitations: [
      { id: 'active', codeHash: hash('correct-horse'), enabled: true, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), version: 1 },
      { id: 'expired', codeHash: hash('expired-code'), enabled: true, expiresAt: new Date(Date.now() - 60_000).toISOString(), version: 1 },
    ],
  };
}

function writePrivate(filename, value) {
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(filename, 0o600);
}

function replacePrivate(filename, value) {
  const temporary = `${filename}.next`;
  writePrivate(temporary, value);
  renameSync(temporary, filename);
}

function request(port, pathname, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

test('disabled gate is a no-op; explicit and required configurations fail closed at startup', async () => {
  const disabled = createBetaAccess();
  assert.equal(await disabled({}, {}, new URL('http://example.test/')), false);

  assert.throws(() => createBetaAccess({ required: true, publicOrigin: 'https://example.test' }), /未提供配置路径/);
  assert.throws(() => createBetaAccess({ configPath: '/definitely/missing/beta.json', publicOrigin: 'https://example.test' }));

  const folder = mkdtempSync(path.join(tmpdir(), 'tianxu-beta-invalid-'));
  const invalid = path.join(folder, 'invalid.json');
  writePrivate(invalid, { version: 1, signingKey: 'bad', invitations: [] });
  assert.throws(() => createBetaAccess({ configPath: invalid, required: true, publicOrigin: 'https://example.test' }), /signingKey/);
  const leaked = sampleConfig();
  leaked.invitations[0].code = 'must-not-be-in-config';
  writePrivate(invalid, leaked);
  assert.throws(() => createBetaAccess({ configPath: invalid, required: true, publicOrigin: 'https://example.test' }), /未知或缺失字段/);
  chmodSync(invalid, 0o644);
  assert.throws(() => createBetaAccess({ configPath: invalid, required: true, publicOrigin: 'https://example.test' }), /权限/);
});

test('real HTTP gate protects navigation, assets and APIs while preserving Bearer authentication', async t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'tianxu-beta-http-'));
  const configPath = path.join(folder, 'beta.json');
  writePrivate(configPath, sampleConfig());
  const origin = 'http://beta.test';
  const gate = createBetaAccess({ configPath, required: true, publicOrigin: origin });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    if (await gate(req, res, url)) return;
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ready":true}');
    }
    if (url.pathname === '/api/private') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ authorization: req.headers.authorization ?? null }));
    }
    if (url.pathname === '/asset.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end('protected asset');
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>protected game</h1>');
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = await listen(server);

  const health = await request(port, '/api/health');
  assert.equal(health.status, 200);

  const assetDenied = await request(port, '/asset.js', { headers: { Accept: '*/*' } });
  assert.equal(assetDenied.status, 403);
  assert.match(assetDenied.headers['content-type'], /application\/json/);
  assert.doesNotMatch(assetDenied.body, /protected asset/);

  const apiDenied = await request(port, '/api/private', { headers: { Authorization: 'Bearer secret-game-token' } });
  assert.equal(apiDenied.status, 403);

  const navigation = await request(port, '/', { headers: { Accept: 'text/html,application/xhtml+xml' } });
  assert.equal(navigation.status, 303);
  assert.equal(navigation.headers.location, '/beta');

  const betaPage = await request(port, '/beta');
  assert.equal(betaPage.headers['referrer-policy'], 'same-origin', 'browser form Origin must survive the invitation page policy');
  assert.equal(betaPage.status, 200);
  assert.match(betaPage.body, /邀请码/);
  assert.doesNotMatch(betaPage.body, /<(?:script|link|img)\b/i);

  const correctBody = 'code=correct-horse';
  const wrongOrigin = await request(port, '/beta/enter', {
    method: 'POST',
    headers: { Origin: 'http://evil.test', 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(correctBody) },
    body: correctBody,
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers['set-cookie'], undefined);

  const badBody = 'code=wrong-code';
  const badCode = await request(port, '/beta/enter', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(badBody) },
    body: badBody,
  });
  assert.equal(badCode.status, 401);
  assert.equal(badCode.headers['set-cookie'], undefined);

  const expiredBody = 'code=expired-code';
  const expired = await request(port, '/beta/enter', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(expiredBody) },
    body: expiredBody,
  });
  assert.equal(expired.status, 401);

  const entered = await request(port, '/beta/enter', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(correctBody) },
    body: correctBody,
  });
  assert.equal(entered.status, 303);
  assert.equal(entered.headers.location, '/');
  const setCookie = entered.headers['set-cookie'][0];
  assert.match(setCookie, /^__Host-tianxu_beta=/);
  assert.match(setCookie, /; Path=\//);
  assert.match(setCookie, /; HttpOnly/);
  assert.match(setCookie, /; Secure/);
  assert.match(setCookie, /; SameSite=Lax/);
  assert.match(setCookie, /; Max-Age=\d+/);
  assert.doesNotMatch(setCookie, /Domain=/i);
  const cookie = setCookie.split(';', 1)[0];

  const apiAllowed = await request(port, '/api/private', { headers: { Cookie: cookie, Authorization: 'Bearer secret-game-token' } });
  assert.equal(apiAllowed.status, 200);
  assert.deepEqual(JSON.parse(apiAllowed.body), { authorization: 'Bearer secret-game-token' });
  const assetAllowed = await request(port, '/asset.js', { headers: { Cookie: cookie } });
  assert.equal(assetAllowed.status, 200);
  assert.equal(assetAllowed.body, 'protected asset');

  const middle = Math.floor(cookie.length / 2);
  const tamperedCookie = `${cookie.slice(0, middle)}${cookie[middle] === 'A' ? 'B' : 'A'}${cookie.slice(middle + 1)}`;
  const tampered = await request(port, '/api/private', { headers: { Cookie: tamperedCookie } });
  assert.equal(tampered.status, 403);

  const oversizedBody = `code=${'x'.repeat(4092)}`;
  assert.ok(Buffer.byteLength(oversizedBody) > 4096);
  const oversized = await request(port, '/beta/enter', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(oversizedBody) },
    body: oversizedBody,
  });
  assert.equal(oversized.status, 413);

  const revokedConfig = sampleConfig();
  revokedConfig.invitations[0] = { ...revokedConfig.invitations[0], enabled: false, version: 2 };
  replacePrivate(configPath, revokedConfig);
  const revoked = await request(port, '/api/private', { headers: { Cookie: cookie } });
  assert.equal(revoked.status, 403);

  writeFileSync(`${configPath}.bad`, '{broken', { mode: 0o600 });
  renameSync(`${configPath}.bad`, configPath);
  const failClosed = await request(port, '/asset.js', { headers: { Cookie: cookie } });
  assert.equal(failClosed.status, 503);
  assert.equal((await request(port, '/api/health')).status, 200);
});

test('exit validates Origin and clears the host-only secure cookie', async t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'tianxu-beta-exit-'));
  const configPath = path.join(folder, 'beta.json');
  writePrivate(configPath, sampleConfig());
  const origin = 'http://beta.test';
  const gate = createBetaAccess({ configPath, publicOrigin: origin });
  const server = http.createServer(async (req, res) => {
    if (await gate(req, res, new URL(req.url, origin))) return;
    res.end('unexpected');
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = await listen(server);

  assert.equal((await request(port, '/beta/exit', { method: 'POST', headers: { Origin: 'http://evil.test' } })).status, 403);
  const exited = await request(port, '/beta/exit', { method: 'POST', headers: { Origin: origin } });
  assert.equal(exited.status, 303);
  assert.equal(exited.headers.location, '/beta');
  const cleared = exited.headers['set-cookie'][0];
  assert.match(cleared, /^__Host-tianxu_beta=;/);
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /HttpOnly; Secure; SameSite=Lax/);
  assert.doesNotMatch(cleared, /Domain=/i);
});

test('CLI keeps credentials out of config and stdout, writes mode 0600, adds and revokes atomically', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'tianxu-beta-cli-'));
  const configPath = path.join(folder, 'private', 'beta.json');
  const firstDelivery = path.join(folder, 'delivery-1.json');
  const script = path.resolve('scripts/beta-invites.mjs');
  const init = spawnSync(process.execPath, [script, 'init', '--config', configPath, '--delivery', firstDelivery, '--id', 'first', '--days30'], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const first = JSON.parse(readFileSync(firstDelivery, 'utf8'));
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(statSync(configPath).mode & 0o777, 0o600);
  assert.equal(statSync(firstDelivery).mode & 0o777, 0o600);
  assert.equal(config.invitations[0].codeHash, hash(first.invitationCode));
  assert.equal(JSON.stringify(config).includes(first.invitationCode), false);
  assert.equal(init.stdout.includes(first.invitationCode), false);
  assert.equal(init.stderr.includes(first.invitationCode), false);

  const secondDelivery = path.join(folder, 'delivery-2.json');
  const add = spawnSync(process.execPath, [script, 'add', '--config', configPath, '--delivery', secondDelivery, '--id', 'second', '--days', '1'], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
  const second = JSON.parse(readFileSync(secondDelivery, 'utf8'));
  const afterAdd = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(afterAdd.invitations.length, 2);
  assert.equal(afterAdd.invitations[1].codeHash, hash(second.invitationCode));
  assert.equal(add.stdout.includes(second.invitationCode), false);

  const revoke = spawnSync(process.execPath, [script, 'revoke', '--config', configPath, '--id', 'first'], { encoding: 'utf8' });
  assert.equal(revoke.status, 0, revoke.stderr);
  const afterRevoke = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(afterRevoke.invitations[0].enabled, false);
  assert.equal(afterRevoke.invitations[0].version, 2);
  assert.equal(statSync(configPath).mode & 0o777, 0o600);

  const collision = path.join(folder, 'collision.json');
  const rejected = spawnSync(process.execPath, [script, 'init', '--config', collision, '--delivery', collision], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /不同文件/);
});

