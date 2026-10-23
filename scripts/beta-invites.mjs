#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBetaAccessConfig } from '../backend/game/beta-access.mjs';

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write('用法：beta-invites.mjs init|add --config PATH --delivery PATH [--id ID] [--days 30]\n       beta-invites.mjs revoke --config PATH --id ID\n');
  process.exitCode = 2;
}

function parseArgs(argv) {
  const command = argv.shift();
  if (!['init', 'add', 'revoke'].includes(command)) return { error: '命令必须是 init、add 或 revoke' };
  const options = { command };
  while (argv.length) {
    const raw = argv.shift();
    const joined = /^--(config|delivery|id|days)=(.*)$/.exec(raw);
    if (joined) { options[joined[1]] = joined[2]; continue; }
    const compactDays = /^--days(\d+)$/.exec(raw);
    if (compactDays) { options.days = compactDays[1]; continue; }
    if (!['--config', '--delivery', '--id', '--days'].includes(raw)) return { error: `未知参数：${raw}` };
    if (!argv.length) return { error: `${raw} 缺少值` };
    options[raw.slice(2)] = argv.shift();
  }
  if (!options.config) return { error: '缺少 --config' };
  if (command !== 'revoke' && !options.delivery) return { error: 'init/add 缺少 --delivery' };
  if (command === 'revoke' && !options.id) return { error: 'revoke 缺少 --id' };
  const days = Number(options.days ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) return { error: '--days 必须是 1 至 365 的整数' };
  options.days = days;
  options.id ??= `invite-${randomUUID()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(options.id)) return { error: '--id 只能包含字母、数字、点、下划线或连字符，且不超过 64 字符' };
  return options;
}

function ensurePrivateFile(filename) {
  const stat = statSync(filename);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error(`${filename} 必须是仅文件所有者可访问的普通文件`);
}

function readConfig(filename) {
  ensurePrivateFile(filename);
  const parsed = JSON.parse(readFileSync(filename, 'utf8'));
  validateBetaAccessConfig(parsed);
  return parsed;
}

function atomicWrite(filename, contents, { replace = false } = {}) {
  const directory = path.dirname(filename);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!replace && existsSync(filename)) throw new Error(`拒绝覆盖已有文件：${filename}`);
  const temporary = path.join(directory, `.${path.basename(filename)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(descriptor, contents, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    chmodSync(temporary, 0o600);
    if (replace) renameSync(temporary, filename);
    else { linkSync(temporary, filename); unlinkSync(temporary); }
    chmodSync(filename, 0o600);
    let directoryFd;
    try { directoryFd = openSync(directory, constants.O_RDONLY); fsyncSync(directoryFd); } finally { if (directoryFd !== undefined) closeSync(directoryFd); }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

function invitation(id, days) {
  const code = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  return {
    code,
    record: { id, codeHash: createHash('sha256').update(code).digest('hex'), enabled: true, expiresAt, version: 1 },
  };
}

function delivery(record, code) {
  return `${JSON.stringify({ version: 1, invitationId: record.id, invitationCode: code, expiresAt: record.expiresAt }, null, 2)}\n`;
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) return usage(options.error);
  const configPath = path.resolve(options.config);
  const deliveryPath = options.delivery ? path.resolve(options.delivery) : null;
  if (deliveryPath === configPath) throw new Error('--delivery 必须与 --config 使用不同文件');

  if (options.command === 'init') {
    if (existsSync(configPath)) throw new Error(`拒绝覆盖已有配置：${configPath}`);
    const created = invitation(options.id, options.days);
    const config = { version: 1, signingKey: randomBytes(32).toString('base64url'), invitations: [created.record] };
    validateBetaAccessConfig(config);
    atomicWrite(deliveryPath, delivery(created.record, created.code));
    try { atomicWrite(configPath, `${JSON.stringify(config, null, 2)}\n`); } catch (error) { throw new Error(`配置未创建；交付文件中的邀请码尚未生效。${error.message}`); }
    process.stdout.write('邀请配置已创建；邀请码仅写入指定交付文件。\n');
    return;
  }

  const config = readConfig(configPath);
  if (options.command === 'add') {
    if (config.invitations.some(item => item.id === options.id)) throw new Error(`邀请 id 已存在：${options.id}`);
    const created = invitation(options.id, options.days);
    const updated = { ...config, invitations: [...config.invitations, created.record] };
    validateBetaAccessConfig(updated);
    atomicWrite(deliveryPath, delivery(created.record, created.code));
    try { atomicWrite(configPath, `${JSON.stringify(updated, null, 2)}\n`, { replace: true }); } catch (error) { throw new Error(`配置未更新；交付文件中的邀请码尚未生效。${error.message}`); }
    process.stdout.write('新邀请已加入；邀请码仅写入指定交付文件。\n');
    return;
  }

  const index = config.invitations.findIndex(item => item.id === options.id);
  if (index < 0) throw new Error(`邀请不存在：${options.id}`);
  const updated = { ...config, invitations: config.invitations.map((item, at) => at === index ? { ...item, enabled: false, version: item.version + 1 } : item) };
  validateBetaAccessConfig(updated);
  atomicWrite(configPath, `${JSON.stringify(updated, null, 2)}\n`, { replace: true });
  process.stdout.write('邀请已撤销，已有会话将立即失效。\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) { process.stderr.write(`操作失败：${error.message}\n`); process.exitCode = 1; }
}

