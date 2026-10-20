import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerContent } from './content.mjs';
import { GameService } from './service.mjs';
import { GameStore } from './store.mjs';

const NOW = Date.UTC(2026, 9, 20, 8);
const here = path.dirname(fileURLToPath(import.meta.url));
const recovered = path.resolve(here, '../../cocos-client/assets/resources/recovered');

test('real accounts enforce guild authority and conservation plus social refusal boundaries', t => {
  const store = new GameStore(':memory:');
  const content = new ServerContent(recovered);
  const service = new GameService(store, content, { clock: () => NOW });
  let sequence = 0;
  t.after(() => store.close());

  const act = (player, action, payload = {}) => service.act(
    player.accountId,
    player.characterId,
    `social-${++sequence}`,
    action,
    payload,
  );
  const register = (username, name, profession) => {
    const session = store.register(username, 'correct-horse', NOW);
    const created = service.act(session.accountId, null, `create-${username}`, 'character.create', { name, profession });
    return { accountId: session.accountId, characterId: created.result.characterId };
  };
  const actor = player => store.read().characters[player.characterId];
  const expectAtomicFailure = (player, action, payload, pattern) => {
    const before = store.read();
    assert.throws(() => act(player, action, payload), pattern);
    assert.deepEqual(store.read(), before, `${action} failure must not change revision, balances, or world state`);
  };

  const alpha = register('social_alpha', 'SocialAlpha', 1);
  const beta = register('social_beta', 'SocialBeta', 2);
  const gamma = register('social_gamma', 'SocialGamma', 3);
  assert.equal(actor(alpha).currencies.silver, 300);
  assert.equal(actor(beta).currencies.silver, 300);
  assert.equal(actor(gamma).currencies.silver, 300);

  act(alpha, 'test.grant', { silver: 500, gold: 0, crystal: 0, itemId: 100, count: 0 });
  act(beta, 'test.grant', { silver: 500, gold: 0, crystal: 0, itemId: 100, count: 1 });

  const created = act(alpha, 'guild.create', { name: 'Boundary Guild' });
  const guildId = created.result.id;
  let world = store.read();
  assert.equal(world.characters[alpha.characterId].currencies.silver, 700, 'guild creation charges exactly 100 silver');
  assert.deepEqual(world.guilds[guildId].members, [alpha.characterId]);
  assert.equal(world.guilds[guildId].leader, alpha.characterId);

  expectAtomicFailure(gamma, 'guild.create', { name: 'Boundary Guild' }, /公会名称已存在/);
  assert.equal(actor(gamma).currencies.silver, 300, 'duplicate name failure charges no creation fee');

  act(beta, 'guild.apply', { guildId });
  act(alpha, 'guild.accept', { target: beta.characterId });
  world = store.read();
  assert.deepEqual(world.guilds[guildId].members, [alpha.characterId, beta.characterId]);
  assert.equal(world.characters[beta.characterId].guildId, guildId);

  expectAtomicFailure(beta, 'guild.upgrade', { skill: 'vitality' }, /需要会长权限/);
  expectAtomicFailure(beta, 'guild.transfer', { target: alpha.characterId }, /需要会长权限/);

  const beforeDonation = store.read();
  const conservedBefore = beforeDonation.characters[alpha.characterId].currencies.silver
    + beforeDonation.characters[beta.characterId].currencies.silver
    + beforeDonation.guilds[guildId].treasury;
  act(alpha, 'guild.donate', { amount: 100 });
  act(beta, 'guild.donate', { amount: 100 });
  world = store.read();
  const conservedAfter = world.characters[alpha.characterId].currencies.silver
    + world.characters[beta.characterId].currencies.silver
    + world.guilds[guildId].treasury;
  assert.equal(conservedAfter, conservedBefore, 'donations move silver into treasury without creating or losing it');
  assert.equal(world.guilds[guildId].treasury, 200);
  assert.equal(world.guilds[guildId].contributions[alpha.characterId], 100);
  assert.equal(world.guilds[guildId].contributions[beta.characterId], 100);

  expectAtomicFailure(alpha, 'guild.leave', {}, /请先移交会长/);

  const specBefore = service.playerSpec(world, world.characters[alpha.characterId], 0);
  act(alpha, 'guild.upgrade', { skill: 'vitality' });
  act(alpha, 'guild.upgrade', { skill: 'income' });
  world = store.read();
  assert.deepEqual(world.guilds[guildId].skills, { vitality: 1, income: 1 });
  assert.equal(world.guilds[guildId].treasury, 0, 'two level-one skills consume the real 200 treasury');
  const specAfter = service.playerSpec(world, world.characters[alpha.characterId], 0);
  assert.equal(specAfter.hp, specBefore.hp + 1, 'vitality skill reaches the battle player specification');
  assert.equal(specAfter.attack, specBefore.attack);

  act(alpha, 'guild.transfer', { target: beta.characterId });
  act(alpha, 'guild.leave');
  world = store.read();
  assert.equal(world.characters[alpha.characterId].guildId, null);
  assert.deepEqual(world.guilds[guildId].members, [beta.characterId]);
  assert.equal(world.guilds[guildId].leader, beta.characterId);
  act(beta, 'guild.leave');
  world = store.read();
  assert.equal(world.characters[beta.characterId].guildId, null);
  assert.equal(world.guilds[guildId], undefined, 'the final member leaving removes the empty guild');

  const sent = act(beta, 'mail.send', {
    target: gamma.characterId,
    title: 'Attachment boundary',
    text: 'Read and claim are separate operations.',
    attachment: { kind: 'item', id: 'main:item:100', quantity: 1 },
  });
  const mailId = sent.result.id;
  const recipientItemsBeforeRead = actor(gamma).inventory['main:item:100'] ?? 0;
  act(gamma, 'mail.read', { mailId });
  world = store.read();
  assert.equal(world.characters[gamma.characterId].inventory['main:item:100'] ?? 0, recipientItemsBeforeRead);
  assert.equal(world.mail[mailId].attachment.quantity, 1);
  assert.equal(world.mail[mailId].claimed, false);
  assert.equal(world.mail[mailId].read, true);

  act(gamma, 'mail.claim', { mailId });
  assert.equal(actor(gamma).inventory['main:item:100'], recipientItemsBeforeRead + 1);
  expectAtomicFailure(gamma, 'mail.claim', { mailId }, /附件已领取或没有附件/);

  act(gamma, 'settings.save', { rejectPrivate: true, rejectInvites: true });
  expectAtomicFailure(beta, 'chat.send', {
    channel: 'private', target: gamma.characterId, text: 'blocked private message',
  }, /对方已关闭私聊/);

  const room = act(beta, 'room.create', { mode: 'pvp', teamSize: 1 });
  expectAtomicFailure(beta, 'room.invite', {
    roomId: room.result.roomId, target: gamma.characterId,
  }, /对方不存在或已关闭邀请/);
  assert.deepEqual(store.read().roomInvites ?? {}, {});
});
