import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { getLegalMoves } from "./game.js";
import { MultiplayerClient, MULTIPLAYER_CONFIG, resolveMultiplayerUrl } from "./multiplayer.js";
import { RoomManager } from "../server/rooms.js";
import { createMultiplayerServer } from "../server/websocket.js";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

class BrowserLikeWebSocket extends WebSocket {
  constructor(url, options = {}) {
    super(url, { ...options, origin: "http://localhost:3000" });
  }
}

function eventLog(client) {
  const events = [];
  client.subscribe((event) => events.push(event));
  return {
    events,
    waitFor(predicate, timeoutMs = 2500) {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const check = () => {
          const event = events.find(predicate);
          if (event) return resolve(event);
          if (Date.now() - startedAt >= timeoutMs) return reject(new Error("Timed out waiting for client event"));
          setTimeout(check, 5);
        };
        check();
      });
    }
  };
}

async function makeFixture(t) {
  let codeNumber = 0;
  let tokenNumber = 0;
  const roomManager = new RoomManager({
    settings: {
      width: 10,
      height: 10,
      piecesPerTurn: 1,
      randomEvents: false,
      freeStartingPositions: true,
      adminMode: false
    },
    random: () => 0.75,
    roomCodeFactory: () => `CLIENT${++codeNumber}`,
    playerTokenFactory: () => `client-test-token-${String(++tokenNumber).padStart(32, "0")}`
  });
  const server = createMultiplayerServer({
    host: "127.0.0.1",
    port: 0,
    cleanupIntervalMs: 0,
    allowedOrigins: new Set(["http://localhost:3000"]),
    roomManager
  });
  const address = await server.listen();
  const storageX = new MemoryStorage();
  const storageO = new MemoryStorage();
  const options = {
    url: `ws://127.0.0.1:${address.port}/ws`,
    WebSocketImpl: BrowserLikeWebSocket,
    requestTimeoutMs: 1500,
    reconnectDelayMs: 25,
    maxReconnectAttempts: 2
  };
  const x = new MultiplayerClient({ ...options, storage: storageX });
  const o = new MultiplayerClient({ ...options, storage: storageO });
  const clients = [x, o];
  t.after(async () => {
    for (const client of clients) client.leave();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await server.close();
  });
  return { server, roomManager, x, o, storageX, storageO };
}

test("client creates and joins a room, then relays confirmed authoritative turns", async (t) => {
  const { x, o, storageX, storageO } = await makeFixture(t);
  const xEvents = eventLog(x);
  const oEvents = eventLog(o);

  const created = await x.createRoom();
  assert.equal(created.side, "X");
  assert.equal(created.status, "waiting");
  assert.equal(x.savedSession.playerToken, created.playerToken);
  assert.equal(x.url.includes(created.playerToken), false);

  const joined = await o.joinRoom(created.roomCode.toLowerCase());
  assert.equal(joined.side, "O");
  assert.equal(o.savedSession.side, "O");
  await xEvents.waitFor((event) => event.type === "room-ready");
  await oEvents.waitFor((event) => event.type === "room-ready");

  assert.equal(x.sendCommand({ type: "choose-start", row: 1, col: 1 }), true);
  const xSetup = await xEvents.waitFor((event) => event.type === "state" && event.state.phase === "setup-o");
  const oSetup = await oEvents.waitFor((event) => event.type === "state" && event.state.phase === "setup-o");
  assert.deepEqual(xSetup.state.startChoices, { X: { row: 1, col: 1 }, O: null });
  assert.deepEqual(oSetup.state.startChoices, { X: null, O: null });

  assert.equal(o.sendCommand({ type: "choose-start", row: 8, col: 8 }), true);
  const xPlaying = await xEvents.waitFor((event) => event.type === "state" && event.state.phase === "playing");
  const oPlaying = await oEvents.waitFor((event) => event.type === "state" && event.state.phase === "playing");
  assert.equal(xPlaying.state.currentPlayer, "X");
  assert.equal(oPlaying.state.currentPlayer, "X");
  assert.equal(xPlaying.clock.activePlayer, "X");
  assert.equal(oPlaying.clock.remainingMs.X > 0, true);

  const move = getLegalMoves(xPlaying.state)[0];
  assert.ok(move, "the initialized game should have a legal X move");
  assert.equal(x.sendCommand({ type: "place", ...move }), true);
  const nextForX = await xEvents.waitFor((event) => event.type === "state" && event.state.currentPlayer === "O");
  const nextForO = await oEvents.waitFor((event) => event.type === "state" && event.state.currentPlayer === "O");
  assert.equal(nextForX.version, nextForO.version);
  assert.deepEqual(nextForX.state.board, nextForO.state.board);
  assert.equal(nextForX.clock.activePlayer, "O");
  assert.equal(nextForX.clock.remainingMs.X, nextForO.clock.remainingMs.X);
  assert.equal(x.sendCommand({ type: "place", ...move }), true);
  const rejected = await xEvents.waitFor((event) => event.type === "command-error" && event.code === "not-your-turn");
  assert.equal(rejected.version, nextForX.version);

  x.leave();
  o.leave();
  assert.equal(storageX.getItem("viruses.online-room"), null);
  assert.equal(storageO.getItem("viruses.online-room"), null);
});

test("client handles reconnect snapshots and resets version for a new room", async (t) => {
  const { server, x, storageX } = await makeFixture(t);
  const events = eventLog(x);
  const created = await x.createRoom();
  assert.equal(x.savedSession.roomCode, created.roomCode);

  const rawSocket = [...server.webSocketServer.clients][0];
  const reconnected = events.waitFor((event) => event.type === "reconnected", 2500);
  rawSocket.terminate();
  const resumed = await reconnected;
  assert.equal(resumed.room.side, "X");
  assert.equal(resumed.room.roomCode, created.roomCode);
  assert.equal(resumed.room.clock.activePlayer, null);
  assert.equal(resumed.room.clock.enabled, true);

  x.leave();
  const secondRoom = await x.createRoom();
  assert.notEqual(secondRoom.roomCode, created.roomCode);
  assert.equal(x.savedSession.roomCode, secondRoom.roomCode);
  assert.equal(x.lastVersion, 0);
  storageX.removeItem("viruses.online-room");
});

test("WebSocket address defaults are local-only and secure on HTTPS origins", () => {
  assert.equal(MULTIPLAYER_CONFIG.localWebSocketUrl, "ws://127.0.0.1:3001/ws");
  assert.equal(resolveMultiplayerUrl({ location: { hostname: "localhost" } }), MULTIPLAYER_CONFIG.localWebSocketUrl);
  assert.equal(resolveMultiplayerUrl({ location: { hostname: "game.example", protocol: "https:", host: "game.example" } }), "wss://game.example/ws");
  assert.equal(resolveMultiplayerUrl({ configuredUrl: "wss://socket.example/game", location: { hostname: "localhost" } }), "wss://socket.example/game");
});
