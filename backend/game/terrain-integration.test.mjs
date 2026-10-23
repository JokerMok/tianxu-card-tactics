import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from './server.mjs';
import { restoreBackup } from './store.mjs';

const FIXED_NOW = Date.UTC(2026, 9, 23, 8);
const PASSWORD = 'terrain-test-only-password';
const HATCH_CARDS = ['main:card:50806', 'main:card:50807'];
const STRONG_CREATURES = ['main:card:9506', 'main:card:9508', 'main:card:9507', 'main:card:9420'];

function terrainEvents(state, terrainId) {
  return state.events.filter(event => ['terrain-add', 'terrain-update', 'terrain-remove'].includes(event.type)
    && (terrainId === undefined || event.terrainId === terrainId));
}

function countCardZones(state, actorId, cardId) {
  const player = state.players.find(candidate => candidate.id === actorId);
  assert.ok(player, `battle player ${actorId} is visible`);
  return {
    hand: player.hand.filter(card => card.cardId === cardId).length,
    draw: player.drawPile.filter(id => id === cardId).length,
    graveyard: player.graveyard.filter(id => id === cardId).length,
  };
}

function assertTerrainShape(terrain) {
  assert.equal(typeof terrain.id, 'string');
  assert.equal(typeof terrain.skillId, 'number');
  assert.equal(typeof terrain.topographyId, 'number');
  assert.equal(typeof terrain.ownerId, 'string');
  assert.ok(terrain.team === 0 || terrain.team === 1);
  assert.ok(Array.isArray(terrain.cells) && terrain.cells.length > 0);
  assert.ok(terrain.cells.every(cell => Number.isInteger(cell.row) && Number.isInteger(cell.col)));
  assert.ok(terrain.remainingTurns === null || Number.isInteger(terrain.remainingTurns));
  assert.equal(typeof terrain.createdTurn, 'number');
  assert.ok(Array.isArray(terrain.occupants));
}

test('real HTTP terrain commands persist, reject conflicts, replay once, restore independently, and settle once', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'tianxu-terrain-http-'));
  const database = path.join(folder, 'game.sqlite');
  const restoredDatabase = path.join(folder, 'restored.sqlite');
  let app;
  let baseUrl;
  let sequence = 0;

  async function start(filename = database) {
    app = await createGameServer({ database: filename, scheduler: false, clock: () => FIXED_NOW });
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
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  }

  async function act(player, action, payload = {}, requestId = `terrain-${++sequence}`, expectedActorRevision) {
    return request('/api/act', {
      method: 'POST', token: player.token, characterId: player.characterId,
      json: { requestId, action, payload, ...(expectedActorRevision === undefined ? {} : { expectedActorRevision }) },
    });
  }

  async function ok(player, action, payload = {}, requestId, expectedActorRevision) {
    const response = await act(player, action, payload, requestId, expectedActorRevision);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  }

  async function state(player) {
    return expectOk('/api/state', { token: player.token, characterId: player.characterId });
  }

  async function createPlayer(username, name) {
    const auth = await expectOk('/api/register', { method: 'POST', json: { username, password: PASSWORD } });
    const player = { ...auth, username, password: PASSWORD };
    player.characterId = (await ok(player, 'character.create', { name, profession: 1 })).result.characterId;
    return player;
  }

  t.after(async () => {
    await stop();
    await rm(folder, { recursive: true, force: true });
  });

  await start();
  const alpha = await createPlayer('terrain_http_a', '地形验收甲');
  const beta = await createPlayer('terrain_http_b', '地形验收乙');
  const legalDeck = [
    ...Array(3).fill(HATCH_CARDS[0]),
    ...Array(3).fill(HATCH_CARDS[1]),
    ...STRONG_CREATURES,
  ];

  app.store.scheduled(world => {
    const actor = world.characters[alpha.characterId];
    actor.level = 30;
    for (const id of new Set(legalDeck)) actor.cards[id] = legalDeck.filter(candidate => candidate === id).length;
    actor.cards[HATCH_CARDS[0]] = 4;
    return true;
  });

  const originalDeck = (await state(alpha)).actor.deck;
  const overCopyLimit = [HATCH_CARDS[0], HATCH_CARDS[0], HATCH_CARDS[0], HATCH_CARDS[0], HATCH_CARDS[1], HATCH_CARDS[1], ...STRONG_CREATURES];
  const rejectedDeck = await act(alpha, 'deck.save', { cards: overCopyLimit, expectedDeck: originalDeck });
  assert.equal(rejectedDeck.status, 400);
  assert.match(rejectedDeck.body.error, /同名卡牌超出允许数量/);
  assert.deepEqual((await state(alpha)).actor.deck, originalDeck, 'invalid four-copy deck is rolled back');

  const saved = await ok(alpha, 'deck.save', { cards: legalDeck, expectedDeck: originalDeck }, 'terrain-deck-save');
  assert.deepEqual(saved.result.cards, legalDeck);
  assert.equal(saved.result.cards.length, 10, 'the service accepted a formal ten-card deck');

  const beforeStart = await state(alpha);
  const actorRecord = app.store.read().characters[alpha.characterId];
  const node = beforeStart.scenes.flatMap(scene => scene.nodes).find(candidate => {
    if (!candidate.battle || !candidate.accessible) return false;
    try { app.content.level(actorRecord, candidate.id); return true; } catch { return false; }
  });
  assert.ok(node, 'an accessible configured PVE node exists');
  const started = await ok(alpha, 'pve.start', { nodeId: node.id }, 'terrain-pve-start');
  const battleId = started.result.battleId;
  let active = await state(alpha);
  assert.equal(active.battle.id, battleId);
  assert.equal(active.battle.state.version, 1);
  assert.deepEqual(active.battle.state.terrains ?? [], []);

  const owner = active.battle.state.players.find(player => player.id === alpha.characterId);
  const hatchHand = owner.hand.find(card => HATCH_CARDS.includes(card.cardId));
  assert.ok(hatchHand, 'six hatch cards guarantee a terrain card in the five-card opening hand');
  const legalTerrain = active.battle.legalPlays.find(play => play.instanceId === hatchHand.instanceId);
  assert.ok(legalTerrain, 'the saved terrain card has an authoritative legal placement');

  const beforeInvalid = structuredClone(active.battle.state);
  const invalid = await act(alpha, 'battle.command', {
    battleId, revision: beforeInvalid.revision,
    action: { type: 'play', instanceId: hatchHand.instanceId, row: -1, col: -1 },
  }, 'terrain-invalid-cast', active.actor.commandRevision);
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /合法落点|目标/);
  assert.deepEqual((await state(alpha)).battle.state, beforeInvalid, 'invalid placement consumes no card, RNG, event, or revision');

  const actorRevisionAtCast = active.actor.commandRevision;
  const terrainRequest = 'terrain-cast-once';
  const terrainPayload = {
    battleId, revision: beforeInvalid.revision,
    action: { type: 'play', ...legalTerrain },
  };
  const firstCast = await ok(alpha, 'battle.command', terrainPayload, terrainRequest, actorRevisionAtCast);
  active = await state(alpha);
  const added = terrainEvents(active.battle.state).filter(event => event.type === 'terrain-add');
  assert.ok(added.length > 0, 'the HTTP command emitted terrain-add events');
  assert.ok(added.every(event => event.terrainId && event.terrain?.id === event.terrainId));
  assert.ok(active.battle.state.terrains.length > 0);
  for (const terrain of active.battle.state.terrains) assertTerrainShape(terrain);
  for (const event of added) assertTerrainShape(event.terrain);
  assert.ok(active.battle.state.terrains.every(terrain => terrain.remainingTurns === 1), 'hatch duration is stored in authoritative state');
  const afterCastState = structuredClone(active.battle.state);
  const zonesAfterCast = countCardZones(afterCastState, alpha.characterId, hatchHand.cardId);
  assert.equal(zonesAfterCast.hand, countCardZones(beforeInvalid, alpha.characterId, hatchHand.cardId).hand - 1);
  assert.equal(zonesAfterCast.graveyard, countCardZones(beforeInvalid, alpha.characterId, hatchHand.cardId).graveyard + 1);

  const replay = await ok(alpha, 'battle.command', terrainPayload, terrainRequest, actorRevisionAtCast);
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision, firstCast.revision);
  assert.deepEqual((await state(alpha)).battle.state, afterCastState, 'same request adds no terrain, trigger, card consumption, RNG, or revision');

  const conflict = await act(alpha, 'battle.command', {
    battleId, revision: afterCastState.revision, action: { type: 'end' },
  }, 'terrain-stale-page', actorRevisionAtCast);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'ACTOR_CONFLICT');
  assert.deepEqual((await state(alpha)).battle.state, afterCastState);

  const foreign = await request('/api/act', {
    method: 'POST', token: beta.token, characterId: alpha.characterId,
    json: { requestId: 'terrain-foreign', action: 'battle.command', payload: { battleId, revision: afterCastState.revision, action: { type: 'end' } } },
  });
  assert.equal(foreign.status, 401);
  assert.deepEqual((await state(alpha)).battle.state, afterCastState);

  const relogin = await expectOk('/api/login', { method: 'POST', json: { username: alpha.username, password: alpha.password } });
  alpha.token = relogin.token;
  const refreshed = await state(alpha);
  assert.deepEqual(refreshed.battle.state.terrains, afterCastState.terrains);
  assert.equal(refreshed.battle.state.rng, afterCastState.rng);
  assert.deepEqual(countCardZones(refreshed.battle.state, alpha.characterId, hatchHand.cardId), zonesAfterCast);

  await stop();
  await start(database);
  alpha.token = (await expectOk('/api/login', { method: 'POST', json: { username: alpha.username, password: alpha.password } })).token;
  const restarted = await state(alpha);
  assert.deepEqual(restarted.battle.state.terrains, afterCastState.terrains);
  assert.ok(restarted.battle.state.terrains.every(terrain => terrain.remainingTurns === 1));
  assert.equal(restarted.battle.state.rng, afterCastState.rng);
  assert.equal(terrainEvents(restarted.battle.state).filter(event => event.type === 'terrain-add').length, added.length);

  const backup = path.join(folder, 'active-backup');
  await app.store.backup(backup);
  await stop();
  assert.deepEqual(restoreBackup(backup, restoredDatabase), { alreadyRestored: false });
  await start(restoredDatabase);
  alpha.token = (await expectOk('/api/login', { method: 'POST', json: { username: alpha.username, password: alpha.password } })).token;
  let restored = await state(alpha);
  assert.deepEqual(restored.battle.state.terrains, afterCastState.terrains, 'independent restored database retains active terrain and duration');
  assert.equal(restored.battle.state.rng, afterCastState.rng);

  await ok(alpha, 'battle.command', {
    battleId, revision: restored.battle.state.revision, action: { type: 'end' },
  }, 'terrain-owner-end', restored.actor.commandRevision);
  restored = await state(alpha);
  assert.equal(restored.battle.state.terrains.length, 0, 'duration-one hatch terrain expires on its owner end');
  assert.ok(terrainEvents(restored.battle.state).some(event => event.type === 'terrain-remove'));

  let commands = 0;
  while (!(restored = await state(alpha)).battle.settled && commands++ < 300) {
    const currentPlayer = restored.battle.state.players.find(player => player.id === alpha.characterId);
    const creaturePlay = restored.battle.legalPlays.find(play => {
      const cardId = currentPlayer.hand.find(card => card.instanceId === play.instanceId)?.cardId;
      return cardId && Number(app.content.card(cardId).raw.Type) === 1;
    });
    const action = creaturePlay ? { type: 'play', ...creaturePlay } : restored.battle.legalPlays[0]
      ? { type: 'play', ...restored.battle.legalPlays[0] } : { type: 'end' };
    await ok(alpha, 'battle.command', { battleId, revision: restored.battle.state.revision, action }, `terrain-finish-${commands}`, restored.actor.commandRevision);
  }
  assert.ok(restored.battle.settled, 'the restored authoritative battle finishes');
  assert.equal(restored.battle.rewards.won, true, 'the seeded strong legal deck wins the configured PVE battle');
  const settledSnapshot = structuredClone(await state(alpha));
  assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM settlements WHERE battle_id=? AND actor_id=?').get(battleId, alpha.characterId).n, 1);

  const historicalReplay = await ok(alpha, 'battle.command', terrainPayload, terrainRequest, actorRevisionAtCast);
  assert.equal(historicalReplay.replayed, true);
  const afterHistoricalReplay = await state(alpha);
  assert.deepEqual(afterHistoricalReplay.battle, settledSnapshot.battle, 'historic command replay does not restore an old battle snapshot or trigger terrain again');
  assert.deepEqual(afterHistoricalReplay.actor.currencies, settledSnapshot.actor.currencies, 'historic replay cannot duplicate settlement rewards');
  assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM settlements WHERE battle_id=? AND actor_id=?').get(battleId, alpha.characterId).n, 1);
});

test('a persisted version-one battle without the optional terrains field remains playable over HTTP', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'tianxu-terrain-legacy-'));
  const database = path.join(folder, 'legacy.sqlite');
  let app;
  let baseUrl;
  let sequence = 0;

  async function start() {
    app = await createGameServer({ database, scheduler: false, clock: () => FIXED_NOW });
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  }
  async function request(pathname, { method = 'GET', token, characterId, json } = {}) {
    const response = await fetch(baseUrl + pathname, {
      method,
      headers: { ...(json === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(characterId ? { 'x-character-id': characterId } : {}) },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    return { status: response.status, body: await response.json() };
  }
  async function act(player, action, payload = {}) {
    return request('/api/act', { method: 'POST', token: player.token, characterId: player.characterId, json: { requestId: `legacy-${++sequence}`, action, payload } });
  }
  async function state(player) {
    const response = await request('/api/state', { token: player.token, characterId: player.characterId });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  }
  t.after(async () => { await app?.close(); await rm(folder, { recursive: true, force: true }); });

  await start();
  const auth = (await request('/api/register', { method: 'POST', json: { username: 'terrain_legacy', password: PASSWORD } })).body;
  const player = { ...auth };
  const created = await act(player, 'character.create', { name: '旧地形存档', profession: 1 });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  player.characterId = created.body.result.characterId;
  const initial = await state(player);
  const actor = app.store.read().characters[player.characterId];
  const node = initial.scenes.flatMap(scene => scene.nodes).find(candidate => {
    if (!candidate.battle || !candidate.accessible) return false;
    try { app.content.level(actor, candidate.id); return true; } catch { return false; }
  });
  const started = await act(player, 'pve.start', { nodeId: node.id });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const battleId = started.body.result.battleId;
  app.store.scheduled(world => {
    delete world.battles[battleId].state.terrains;
    if (world.battles[battleId].entryState) delete world.battles[battleId].entryState.terrains;
    return true;
  });
  await app.close();
  app = undefined;
  await start();
  const legacy = await state(player);
  assert.equal(legacy.battle.state.version, 1);
  assert.deepEqual(legacy.battle.state.terrains ?? [], []);
  const continued = await act(player, 'battle.command', { battleId, revision: legacy.battle.state.revision, action: { type: 'end' } });
  assert.equal(continued.status, 200, JSON.stringify(continued.body));
});
