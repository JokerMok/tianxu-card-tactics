import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from './server.mjs';

const FIXED_NOW = Date.UTC(2026, 9, 20, 8);

test('real HTTP PVP supports 2v2 and 4v4 with unique accounts and one settlement', { timeout: 120_000 }, async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'tianxu-multiplayer-'));
  const database = path.join(folder, 'game.sqlite');
  const app = await createGameServer({ database, scheduler: false, clock: () => FIXED_NOW });
  let requestSequence = 0;

  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

  t.after(async () => {
    await app.close();
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
    return { status: response.status, body: await response.json() };
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
    return response.body.error;
  }

  async function createCharacter(token, name, profession = 1) {
    return request('/api/act', {
      method: 'POST', token,
      json: {
        requestId: `character-${++requestSequence}`,
        action: 'character.create',
        payload: { name, profession },
      },
    });
  }

  async function register(index) {
    const username = `variant_user_${index}`;
    const session = await expectOk('/api/register', {
      method: 'POST', json: { username, password: 'correct-horse' },
    });
    const name = index === 1 ? 'abcdefghijklmn' : `PVPActor${index}`;
    const created = await createCharacter(session.token, name, (index - 1) % 4 + 1);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    return {
      username,
      token: session.token,
      accountId: session.accountId,
      characterId: created.body.result.characterId,
    };
  }

  async function state(player) {
    return expectOk('/api/state', { token: player.token, characterId: player.characterId });
  }

  const players = [];
  for (let index = 1; index <= 8; index += 1) players.push(await register(index));
  assert.equal((await state(players[0])).actor.name.length, 14);

  const tooLong = await createCharacter(players[0].token, 'abcdefghijklmno', 2);
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.body.error, /角色名称无效/);
  const duplicate = await createCharacter(players[1].token, 'abcdefghijklmn', 2);
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.body.error, /角色名称已存在/);

  const alternate = await createCharacter(players[0].token, 'AccountOneAlt', 2);
  assert.equal(alternate.status, 200, JSON.stringify(alternate.body));
  const alternatePlayer = { ...players[0], characterId: alternate.body.result.characterId };

  async function runVariant(teamSize) {
    const participants = players.slice(0, teamSize * 2);
    const host = participants[0];
    const created = await act(host, 'room.create', { mode: 'pvp', teamSize });
    const roomId = created.result.roomId;

    const insufficient = await failedAct(host, 'room.start', { roomId });
    assert.match(insufficient, /至少两位已准备玩家/);

    if (teamSize === 2) {
      const sameAccount = await failedAct(alternatePlayer, 'room.join', { roomId });
      assert.match(sameAccount, /独立账号/);

      const storedBefore = app.store.read();
      const fixture = structuredClone(storedBefore);
      fixture.rooms[roomId].teamSize = 1;
      fixture.rooms[roomId].capacity = 2;
      fixture.rooms[roomId].members = [host.characterId, alternatePlayer.characterId];
      fixture.rooms[roomId].ready = { [host.characterId]: true, [alternatePlayer.characterId]: true };
      assert.throws(
        () => app.service.startRoom(fixture, fixture.characters[host.characterId], roomId, FIXED_NOW),
        /独立账号/,
      );
      assert.deepEqual(app.store.read(), storedBefore);
    }

    for (const player of participants.slice(1)) await act(player, 'room.join', { roomId });
    const unready = await failedAct(host, 'room.start', { roomId });
    assert.match(unready, /已准备玩家/);
    for (const player of participants.slice(1)) await act(player, 'room.ready', { roomId, ready: true });

    const before = new Map();
    for (const player of participants) {
      const current = await state(player);
      before.set(player.characterId, {
        silver: current.actor.currencies.silver,
        matches: current.actor.stats.pvpMatches,
      });
    }

    const started = await act(host, 'room.start', { roomId });
    const battleId = started.result.battleId;
    const playerById = new Map(participants.map(player => [player.characterId, player]));
    const issuedBy = new Set();

    for (let commands = 0; commands < 300 && issuedBy.size < participants.length; commands += 1) {
      const current = await state(host);
      assert.equal(current.battle.id, battleId);
      assert.equal(current.battle.settled, false);
      const activeId = current.battle.state.players[current.battle.state.activePlayer].id;
      const player = playerById.get(activeId);
      assert.ok(player, `unexpected non-participant ${activeId}`);
      const activeView = player.characterId === host.characterId ? current : await state(player);
      const legal = activeView.battle.legalPlays[0];
      await act(player, 'battle.command', {
        battleId,
        revision: activeView.battle.state.revision,
        action: legal ? { type: 'play', ...legal } : { type: 'end' },
      });
      issuedBy.add(activeId);
    }
    assert.deepEqual(issuedBy, new Set(participants.map(player => player.characterId)));

    const teamOne = participants.slice(teamSize);
    let finalPayload;
    let finalRequestId;
    let finalResponse;
    for (const [index, player] of teamOne.entries()) {
      const current = await state(player);
      finalPayload = {
        battleId,
        revision: current.battle.state.revision,
        action: { type: 'surrender' },
      };
      finalRequestId = `settle-${teamSize}v${teamSize}-${index}`;
      finalResponse = await act(player, 'battle.command', finalPayload, finalRequestId);
    }
    assert.equal(finalResponse.replayed, false);

    const settledWorld = app.store.read();
    const record = settledWorld.battles[battleId];
    assert.equal(record.mode, 'pvp');
    assert.equal(record.teamSize, teamSize);
    assert.equal(record.settled, true);
    assert.equal(record.state.winner, 0);
    assert.equal(record.participants.length, teamSize * 2);
    assert.deepEqual(
      record.state.players.reduce((counts, player) => {
        counts[player.team] = (counts[player.team] ?? 0) + 1;
        return counts;
      }, {}),
      { 0: teamSize, 1: teamSize },
    );
    assert.ok(record.state.players.every(player => player.ai === false));

    const after = new Map();
    for (const player of participants) after.set(player.characterId, await state(player));
    for (const [index, player] of participants.entries()) {
      const previous = before.get(player.characterId);
      const current = after.get(player.characterId);
      const won = index < teamSize;
      assert.equal(current.battle.id, battleId);
      assert.equal(current.battle.settled, true);
      assert.equal(current.battle.state.winner, 0);
      assert.equal(current.battle.rewards.won, won);
      assert.equal(current.battle.rewards.silver, won ? 30 : 10);
      assert.equal(current.actor.stats.pvpMatches, previous.matches + 1);
      assert.equal(current.actor.currencies.silver, previous.silver + (won ? 30 : 10));
    }
    assert.deepEqual(
      participants.slice(0, teamSize).map(player => after.get(player.characterId).battle.rewards),
      Array(teamSize).fill({ won: true, silver: 30, xp: 6, cards: [] }),
    );
    assert.deepEqual(
      participants.slice(teamSize).map(player => after.get(player.characterId).battle.rewards),
      Array(teamSize).fill({ won: false, silver: 10, xp: 3, cards: [] }),
    );

    const finalActor = teamOne.at(-1);
    const snapshotBeforeReplay = app.store.read();
    const replay = await act(finalActor, 'battle.command', finalPayload, finalRequestId);
    assert.equal(replay.replayed, true);
    assert.equal(replay.revision, finalResponse.revision);
    assert.deepEqual(app.store.read(), snapshotBeforeReplay);

    for (const player of participants) await act(player, 'battle.dismiss', { battleId });
  }

  await runVariant(2);
  await runVariant(4);
});
