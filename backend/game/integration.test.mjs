import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from './server.mjs';

const FIXED_NOW = Date.UTC(2026, 9, 20, 8);

test('real HTTP integration covers isolated accounts, progression, economy, multiplayer, and restart', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'tianxu-integration-'));
  const database = path.join(folder, 'game.sqlite');
  let app;
  let baseUrl;
  let requestSequence = 0;

  async function start() {
    app = await createGameServer({ database, scheduler: false, clock: () => FIXED_NOW });
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  }

  async function stop() {
    if (!app) return;
    const closing = app;
    app = undefined;
    await closing.close();
  }

  t.after(async () => {
    await stop();
    await rm(folder, { recursive: true, force: true });
  });

  async function request(pathname, { method = 'GET', token, characterId, json } = {}) {
    const response = await fetch(baseUrl + pathname, {
      method,
      headers: {
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(characterId ? { 'x-character-id': characterId } : {}),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const body = await response.json();
    return { status: response.status, ok: response.ok, body };
  }

  async function expectOk(pathname, options) {
    const response = await request(pathname, options);
    assert.equal(response.status, 200, `${pathname}: ${JSON.stringify(response.body)}`);
    return response.body;
  }

  async function act(player, action, payload = {}, requestId = `request-${++requestSequence}`) {
    return expectOk('/api/act', {
      method: 'POST', token: player.token, characterId: player.characterId,
      json: { requestId, action, payload },
    });
  }

  async function failedAct(player, action, payload = {}, requestId = `request-${++requestSequence}`) {
    const response = await request('/api/act', {
      method: 'POST', token: player.token, characterId: player.characterId,
      json: { requestId, action, payload },
    });
    assert.ok(response.status >= 400, `expected ${action} to fail`);
    assert.equal(typeof response.body.error, 'string');
    return response;
  }

  async function state(player) {
    return expectOk('/api/state', { token: player.token, characterId: player.characterId });
  }

  async function register(username, name, profession, gender) {
    const session = await expectOk('/api/register', {
      method: 'POST', json: { username, password: 'correct-horse' },
    });
    const created = await expectOk('/api/act', {
      method: 'POST', token: session.token,
      json: {
        requestId: `create-${username}`,
        action: 'character.create',
        payload: { name, profession, ...(gender === undefined ? {} : { gender }) },
      },
    });
    return { username, token: session.token, accountId: session.accountId, characterId: created.result.characterId };
  }

  async function finishBattle(playersById, battleId, participants) {
    const issuedBy = new Set();
    for (let count = 0; count < 400; count += 1) {
      const current = await state(participants[0]);
      assert.equal(current.battle.id, battleId);
      if (current.battle.settled) return { state: current, issuedBy, commands: count };
      const active = current.battle.state.players[current.battle.state.activePlayer];
      const player = playersById.get(active.id);
      assert.ok(player, `unexpected non-AI active player ${active.id}`);
      const activeView = player.characterId === participants[0].characterId ? current : await state(player);
      const legal = activeView.battle.legalPlays[0];
      const action = legal ? { type: 'play', ...legal } : { type: 'end' };
      await act(player, 'battle.command', {
        battleId,
        revision: activeView.battle.state.revision,
        action,
      });
      issuedBy.add(player.characterId);
    }
    assert.fail(`battle ${battleId} did not settle within 400 commands`);
  }

  async function startFirstClear(player, originalNodeId) {
    const before = await state(player);
    const scene = before.scenes.find(candidate => candidate.id === 'main:scene:1');
    const node = scene.nodes.find(candidate => candidate.originalId === String(originalNodeId));
    assert.equal(node.accessible, true);
    const started = await act(player, 'pve.start', { nodeId: node.id });
    const entered = await state(player);
    assert.equal(entered.battle.id, started.result.battleId);
    assert.equal(entered.battle.entryState.id, started.result.battleId);
    assert.equal(entered.battle.entryState.revision, 0);
    const stored = app.store.read().battles[started.result.battleId];
    assert.ok(stored.entryState, 'PVE record preserves the createBattle entry snapshot');
    const storedEnemy = stored.entryState.players.find(candidate => candidate.team === 1);
    const projectedEnemy = entered.battle.entryState.players.find(candidate => candidate.team === 1);
    assert.ok(storedEnemy.deck.length > 0);
    assert.deepEqual(projectedEnemy.deck, []);
    assert.deepEqual(projectedEnemy.hand, []);
    assert.equal(projectedEnemy.deckCount, storedEnemy.deck.length);
    assert.equal(projectedEnemy.handCount, storedEnemy.hand.length);
    const finished = await finishBattle(new Map([[player.characterId, player]]), started.result.battleId, [player]);
    assert.equal(finished.state.battle.state.winner, 0);
    assert.equal(finished.state.battle.rewards.won, true);
    assert.ok(finished.commands > 0);
    return finished.state;
  }

  await start();
  const health = await expectOk('/api/health');
  assert.equal(health.ready, true);

  const alpha = await register('integration_alpha', 'AlphaTester', 1);
  const beta = await register('integration_beta', 'BetaTester', 2, 2);
  assert.equal((await state(alpha)).actor.gender, 1);
  assert.equal((await state(beta)).actor.gender, 2);
  const alphaPresentation = await state(alpha);
  assert.equal(alphaPresentation.growth.characterStats.level, alphaPresentation.actor.level);
  assert.ok(alphaPresentation.growth.characterStats.hp > 0);
  assert.equal(alphaPresentation.social.people.find(person => person.id === beta.characterId).profession, 2);
  assert.equal(alphaPresentation.social.people.find(person => person.id === beta.characterId).gender, 2);
  await failedAct(alpha, 'character.create', { name: 'InvalidGender', profession: 1, gender: 3 });
  assert.notEqual(alpha.accountId, beta.accountId);
  assert.notEqual(alpha.characterId, beta.characterId);

  const alphaCharacters = await expectOk('/api/characters', { token: alpha.token });
  const betaCharacters = await expectOk('/api/characters', { token: beta.token });
  assert.deepEqual(alphaCharacters.characters.map(character => character.id), [alpha.characterId]);
  assert.deepEqual(betaCharacters.characters.map(character => character.id), [beta.characterId]);
  const isolated = await request('/api/state', { token: alpha.token, characterId: beta.characterId });
  assert.equal(isolated.status, 401);

  const firstIdempotent = await act(alpha, 'settings.save', { music: false }, 'same-settings-request');
  const replayed = await act(alpha, 'settings.save', { music: false }, 'same-settings-request');
  assert.equal(firstIdempotent.replayed, false);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.revision, firstIdempotent.revision);
  const reusedDifferently = await failedAct(alpha, 'settings.save', { music: true }, 'same-settings-request');
  assert.match(reusedDifferently.body.error, /请求编号已用于不同操作/);

  const beforeIllegal = await state(alpha);
  const illegal = await failedAct(alpha, 'settings.save', { music: 'loud' });
  assert.match(illegal.body.error, /设置格式错误/);
  assert.deepEqual(await state(alpha), beforeIllegal);

  const beforeInsufficient = await state(alpha);
  const insufficient = await failedAct(alpha, 'city.upgrade', { buildingId: 'castle' });
  assert.match(insufficient.body.error, /insufficient silver/);
  assert.deepEqual(await state(alpha), beforeInsufficient);

  let alphaState = await startFirstClear(alpha, 101);
  assert.ok(alphaState.actor.progress.clearedNodes.includes('main:scene:1:node:101'));
  assert.equal(alphaState.actor.cards['main:card:5019'], 1);
  await act(alpha, 'battle.dismiss', { battleId: alphaState.battle.id });

  alphaState = await startFirstClear(alpha, 102);
  assert.ok(alphaState.actor.progress.clearedNodes.includes('main:scene:1:node:102'));
  assert.equal(alphaState.actor.stats.pveWins, 2);
  assert.equal(alphaState.actor.cards['main:card:2'], 1);
  await act(alpha, 'battle.dismiss', { battleId: alphaState.battle.id });

  const friendRequest = await act(alpha, 'friend.request', { target: beta.characterId });
  await act(beta, 'friend.accept', { requestId: friendRequest.result.id });
  await act(alpha, 'chat.send', { channel: 'private', target: beta.characterId, text: 'integration hello' });
  let betaState = await state(beta);
  assert.ok(betaState.social.friends.some(friend => friend.id === alpha.characterId));
  assert.ok(betaState.social.chat.some(message => message.text === 'integration hello' && message.from === alpha.characterId));

  const mail = await act(alpha, 'mail.send', {
    target: beta.characterId,
    title: 'integration attachment',
    text: 'asset conservation check',
    attachment: { kind: 'card', id: 'main:card:5019', quantity: 1 },
  });
  assert.equal((await state(alpha)).actor.cards['main:card:5019'], 0);
  betaState = await state(beta);
  assert.equal(betaState.social.mail.find(message => message.id === mail.result.id).attachment.id, 'main:card:5019');
  await act(beta, 'mail.claim', { mailId: mail.result.id });
  assert.equal((await state(beta)).actor.cards['main:card:5019'], 1);

  const silverBeforeTrade = (await state(alpha)).actor.currencies.silver + (await state(beta)).actor.currencies.silver;
  const trade = await act(beta, 'trade.offer', {
    target: alpha.characterId, kind: 'card', id: 'main:card:5019', quantity: 1, price: 5,
  });
  await act(alpha, 'trade.accept', { tradeId: trade.result.id });
  alphaState = await state(alpha);
  betaState = await state(beta);
  assert.equal(alphaState.actor.cards['main:card:5019'], 1);
  assert.equal(betaState.actor.cards['main:card:5019'], 0);
  assert.equal(alphaState.actor.currencies.silver + betaState.actor.currencies.silver, silverBeforeTrade);

  const silverBeforeAuction = alphaState.actor.currencies.silver + betaState.actor.currencies.silver;
  const auction = await act(alpha, 'auction.list', {
    kind: 'card', id: 'main:card:2', quantity: 1, price: 10, buyout: 10, durationMinutes: 60,
  });
  await act(beta, 'auction.buy', { auctionId: auction.result.id });
  alphaState = await state(alpha);
  betaState = await state(beta);
  assert.equal(alphaState.actor.cards['main:card:2'], 0);
  assert.equal(betaState.actor.cards['main:card:2'], 1);
  assert.equal(alphaState.actor.currencies.silver + betaState.actor.currencies.silver, silverBeforeAuction);
  assert.equal(alphaState.social.auctions.find(item => item.id === auction.result.id).status, 'completed');

  const helperCardsBefore = alphaState.actor.cards['main:card:5019'] ?? 0;
  const newcomerCardsBefore = betaState.actor.cards['main:card:5019'] ?? 0;
  const coopRoom = await act(beta, 'room.create', {
    mode: 'coop', nodeId: 'main:scene:1:node:101', triggerId: 'main:scene:1:node:101:trigger:101001',
  });
  await act(alpha, 'room.join', { roomId: coopRoom.result.roomId });
  await act(alpha, 'room.ready', { roomId: coopRoom.result.roomId, ready: true });
  const coopStarted = await act(beta, 'room.start', { roomId: coopRoom.result.roomId });
  const playersById = new Map([[alpha.characterId, alpha], [beta.characterId, beta]]);
  const coopFinished = await finishBattle(playersById, coopStarted.result.battleId, [alpha, beta]);
  assert.equal(coopFinished.state.battle.mode, 'coop');
  assert.equal(coopFinished.state.battle.state.winner, 0);
  assert.deepEqual(coopFinished.issuedBy, new Set([alpha.characterId, beta.characterId]));
  const coopAlpha = await state(alpha);
  const coopBeta = await state(beta);
  assert.equal(coopAlpha.battle.rewards.won, true);
  assert.equal(coopBeta.battle.rewards.won, true);
  assert.equal(coopAlpha.actor.cards['main:card:5019'] ?? 0, helperCardsBefore, 'helper must not receive a second first-clear card');
  assert.equal(coopBeta.actor.cards['main:card:5019'], newcomerCardsBefore + 1, 'newcomer receives first-clear card');
  assert.equal(coopAlpha.actor.stats.coopWins, 1);
  assert.equal(coopBeta.actor.stats.coopWins, 1);
  await act(alpha, 'battle.dismiss', { battleId: coopStarted.result.battleId });
  await act(beta, 'battle.dismiss', { battleId: coopStarted.result.battleId });

  const rankedRoom = await act(alpha, 'room.create', { mode: 'ranked' });
  await act(beta, 'room.join', { roomId: rankedRoom.result.roomId });
  await act(beta, 'room.ready', { roomId: rankedRoom.result.roomId, ready: true });
  const rankedStarted = await act(alpha, 'room.start', { roomId: rankedRoom.result.roomId });
  const rankedBefore = await state(alpha);
  const activePlayerId = rankedBefore.battle.state.players[rankedBefore.battle.state.activePlayer].id;
  const activePlayer = playersById.get(activePlayerId);
  const activeView = activePlayer.characterId === alpha.characterId ? rankedBefore : await state(activePlayer);
  const firstPlay = activeView.battle.legalPlays[0];
  await act(activePlayer, 'battle.command', {
    battleId: rankedStarted.result.battleId,
    revision: activeView.battle.state.revision,
    action: firstPlay ? { type: 'play', ...firstPlay } : { type: 'end' },
  });
  const surrenderingPlayer = activePlayer.characterId === alpha.characterId ? beta : alpha;
  const beforeSurrender = await state(surrenderingPlayer);
  await act(surrenderingPlayer, 'battle.command', {
    battleId: rankedStarted.result.battleId,
    revision: beforeSurrender.battle.state.revision,
    action: { type: 'surrender' },
  });
  alphaState = await state(alpha);
  betaState = await state(beta);
  assert.equal(alphaState.battle.settled, true);
  assert.equal(betaState.battle.settled, true);
  assert.equal(alphaState.actor.stats.pvpMatches, 1);
  assert.equal(betaState.actor.stats.pvpMatches, 1);
  assert.equal(alphaState.actor.rating + betaState.actor.rating, 2000);
  assert.deepEqual([alphaState.actor.wins + betaState.actor.wins, alphaState.actor.losses + betaState.actor.losses], [1, 1]);
  assert.deepEqual(alphaState.rankings.map(entry => entry.rating), [1016, 984]);

  const towerStarted = await act(alpha, 'tower.challenge', { mode: 'normal' });
  alphaState = await state(alpha);
  assert.equal(alphaState.battle.id, towerStarted.result.battleId);
  assert.equal(alphaState.battle.entryState.id, towerStarted.result.battleId);
  assert.equal(alphaState.battle.entryState.revision, 0, 'special PVE also exposes its projected entry baseline');

  const persisted = {
    alphaRating: alphaState.actor.rating,
    betaRating: betaState.actor.rating,
    alphaSilver: alphaState.actor.currencies.silver,
    betaSilver: betaState.actor.currencies.silver,
    friendships: alphaState.social.friends.map(friend => friend.id),
    clearedNodes: [...alphaState.actor.progress.clearedNodes],
  };

  await stop();
  await start();
  const alphaLogin = await expectOk('/api/login', {
    method: 'POST', json: { username: alpha.username, password: 'correct-horse' },
  });
  const betaLogin = await expectOk('/api/login', {
    method: 'POST', json: { username: beta.username, password: 'correct-horse' },
  });
  alpha.token = alphaLogin.token;
  beta.token = betaLogin.token;
  alphaState = await state(alpha);
  betaState = await state(beta);
  assert.equal(alphaState.actor.gender, 1);
  assert.equal(betaState.actor.gender, 2);
  assert.equal(alphaState.actor.rating, persisted.alphaRating);
  assert.equal(betaState.actor.rating, persisted.betaRating);
  assert.equal(alphaState.actor.currencies.silver, persisted.alphaSilver);
  assert.equal(betaState.actor.currencies.silver, persisted.betaSilver);
  assert.deepEqual(alphaState.social.friends.map(friend => friend.id), persisted.friendships);
  assert.deepEqual(alphaState.actor.progress.clearedNodes, persisted.clearedNodes);
  assert.equal(alphaState.social.trades.find(item => item.id === trade.result.id).status, 'completed');
  assert.equal(alphaState.social.auctions.find(item => item.id === auction.result.id).status, 'completed');
});
