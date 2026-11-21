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

async function makeFixture(t, { sideRandom = () => 0.25, adminSecret = null } = {}) {
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
    sideRandom,
    roomCodeFactory: () => `CLIENT${++codeNumber}`,
    playerTokenFactory: () => `client-test-token-${String(++tokenNumber).padStart(32, "0")}`
  });
  const server = createMultiplayerServer({
    host: "127.0.0.1",
    port: 0,
    cleanupIntervalMs: 0,
    allowedOrigins: new Set(["http://localhost:3000"]),
    roomManager,
    adminSecret
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
  return { server, roomManager, x, o, storageX, storageO, createClient(storage = new MemoryStorage()) {
    const client = new MultiplayerClient({ ...options, storage });
    clients.push(client);
    return client;
  } };
}

test("reopening a room after disconnect confirms the new socket before accepting moves", async (t) => {
  const { x, o, roomManager } = await makeFixture(t);
  const events = eventLog(x);
  const room = await x.createRoom();
  await o.joinRoom(room.roomCode);
  await events.waitFor(e => e.type === "room-ready");
  const oldSocket = x.socket;
  x.disconnect({ preserveSession: true });
  const resumed = await x.joinRoom(room.roomCode.toLowerCase());
  assert.equal(resumed.type, "room-resumed");
  assert.notEqual(x.socket, oldSocket);
  const update = events.waitFor(e => e.type === "state" && e.state.phase === "setup-o");
  x.sendCommand({ type: "choose-start", row: 1, col: 1 });
  await update;
  assert.equal(roomManager.getSnapshot(room.roomCode, "X").state.phase, "setup-o");
});

test("repeated resume on a live socket returns a fresh confirmed snapshot at the same version", async (t) => {
  const { x } = await makeFixture(t);
  const room = await x.createRoom();
  const socket = x.socket;
  for (let i = 0; i < 4; i += 1) {
    const resumed = await x.resumeSavedRoom();
    assert.equal(resumed.version, room.version);
    assert.equal(resumed.type, "room-resumed");
    assert.equal(x.socket, socket);
  }
});

test("a refreshed tab reclaims the token's seat without an old-tab reconnect fight or token deletion", async (t) => {
  const { x, o, storageX, createClient } = await makeFixture(t);
  const events = eventLog(x);
  const room = await x.createRoom();
  await o.joinRoom(room.roomCode);
  const reloaded = createClient(storageX);
  const resumed = await reloaded.joinRoom(room.roomCode);
  assert.equal(resumed.type, "room-resumed");
  assert.equal(resumed.side, "X");
  await events.waitFor(e => e.type === "session-replaced");
  assert.equal(x.connected, false);
  assert.equal(x.savedSession, null);
  x.leave();
  assert.equal(JSON.parse(storageX.getItem("viruses.online-room")).playerToken, room.playerToken);
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.equal(reloaded.connected, true);
  assert.equal(events.events.some(e => e.type === "reconnected"), false);
  const next = eventLog(reloaded).waitFor(e => e.type === "state" && e.state.phase === "setup-o");
  reloaded.sendCommand({ type: "choose-start", row: 1, col: 1 });
  await next;
});

test("closing an older room does not delete another room's credentials in shared storage", async (t) => {
  const { x, storageX, createClient } = await makeFixture(t);
  const first = await x.createRoom();
  const secondClient = createClient(storageX);
  const second = await secondClient.createRoom();
  x.leave();
  assert.equal(JSON.parse(storageX.getItem("viruses.online-room")).roomCode, second.roomCode);
  assert.equal(storageX.getItem(`viruses.online-room:${first.roomCode}`), null);
  const reload = createClient(storageX);
  assert.equal((await reload.resumeSavedRoom()).roomCode, second.roomCode);
});

test("a transient reconnect failure retains the credential for a later manual resume", async (t) => {
  const { x, server } = await makeFixture(t);
  const room = await x.createRoom();
  const events = eventLog(x);
  class UnavailableSocket extends EventTarget {
    static OPEN = 1; static CLOSING = 2;
    readyState = 0;
    constructor() { super(); queueMicrotask(() => { this.readyState = 3; this.dispatchEvent(new Event("close")); }); }
    close() { this.readyState = 3; }
  }
  x.WebSocketImpl = UnavailableSocket;
  [...server.webSocketServer.clients][0].terminate();
  await events.waitFor(e => e.type === "reconnect-failed");
  assert.equal(x.savedSession.playerToken, room.playerToken);
  x.WebSocketImpl = BrowserLikeWebSocket;
  assert.equal((await x.resumeSavedRoom()).roomCode, room.roomCode);
});

test("a close before transport open rejects connect instead of leaving it pending forever", async () => {
  class ClosedSocket extends EventTarget {
    static OPEN = 1; static CLOSING = 2;
    readyState = 0;
    constructor() { super(); queueMicrotask(() => { this.readyState = 3; this.dispatchEvent(new Event("close")); }); }
    close() { this.readyState = 3; }
  }
  const client = new MultiplayerClient({ WebSocketImpl: ClosedSocket, storage: null, requestTimeoutMs: 100 });
  await assert.rejects(client.connect(), { code: "connection-lost" });
  assert.equal(client.connectPromise, null);
  client.leave();
});

test("manual leave cancels the previous reconnect loop before another room is created", async (t) => {
  const { x, server } = await makeFixture(t);
  await x.createRoom();
  const events = eventLog(x);
  [...server.webSocketServer.clients][0].terminate();
  await events.waitFor(e => e.type === "disconnected");
  x.leave();
  const next = await x.createRoom();
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.equal(x.savedSession.roomCode, next.roomCode);
  assert.equal(events.events.some(e => e.type === "reconnected"), false);
});

test("disabled browser storage does not discard the in-memory token during a network interruption", async (t) => {
  const { x } = await makeFixture(t);
  x.storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const room = await x.createRoom();
  x.disconnect({ preserveSession: true });
  assert.equal((await x.resumeSavedRoom()).roomCode, room.roomCode);
});

test("client creates and joins a room, then relays confirmed authoritative turns", async (t) => {
  const { x, o, storageX, storageO } = await makeFixture(t);
  const xEvents = eventLog(x);
  const oEvents = eventLog(o);

  const created = await x.createRoom({
    width: 10, height: 10, piecesPerTurn: 1, clockMinutes: 5, incrementSeconds: 0,
    unlimitedTime: false, randomEvents: false, animationsEnabled: true,
    freeStartingPositions: true, disabledItems: ["bomb", "shield"]
  });
  assert.equal(created.side, null);
  assert.equal(created.status, "waiting");
  assert.equal(x.savedSession.playerToken, created.playerToken);
  assert.equal(x.url.includes(created.playerToken), false);

  const joined = await o.joinRoom(created.roomCode.toLowerCase());
  assert.equal(joined.side, "O");
  assert.equal(o.savedSession.side, "O");
  assert.deepEqual(created.state.settings.disabledItems, ["bomb", "shield"]);
  await xEvents.waitFor((event) => event.type === "room-ready");
  await oEvents.waitFor((event) => event.type === "room-ready");
  assert.equal(x.savedSession.side, "X");

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
  assert.equal(nextForX.undoAvailable, true);
  assert.equal(x.sendCommand({ type: "place", ...move }), true);
  const rejected = await xEvents.waitFor((event) => event.type === "command-error" && event.code === "not-your-turn");
  assert.equal(rejected.version, nextForX.version);

  const offer = await x.proposeUndo();
  const incomingOffer = await oEvents.waitFor((event) => event.type === "undo-proposal" && event.proposalId === offer.proposalId);
  assert.equal(incomingOffer.fromSide, "X");
  const restoredX = xEvents.waitFor((event) => event.type === "state" && event.undoAccepted === true);
  const restoredO = oEvents.waitFor((event) => event.type === "state" && event.undoAccepted === true);
  const vote = await o.voteUndo(offer.proposalId, true);
  assert.equal(vote.accepted, true);
  const [xAfterUndo, oAfterUndo] = await Promise.all([restoredX, restoredO]);
  assert.deepEqual(xAfterUndo.state, oAfterUndo.state);
  assert.equal(xAfterUndo.state.board[move.row][move.col], "");
  assert.equal(xAfterUndo.historyEntry.type, "undo");

  x.leave();
  o.leave();
  assert.equal(storageX.getItem("viruses.online-room"), null);
  assert.equal(storageO.getItem("viruses.online-room"), null);
});

test("client submits the admin secret only for the current connection and does not persist it", async (t) => {
  const secret = "client-test-private-admin-secret";
  const { x, o, storageX } = await makeFixture(t, { adminSecret: secret });
  const xEvents = eventLog(x);
  const created = await x.createRoom({
    width: 10, height: 10, piecesPerTurn: 1, clockMinutes: 5, incrementSeconds: 0,
    unlimitedTime: true, randomEvents: false, animationsEnabled: true,
    freeStartingPositions: true, disabledItems: []
  });
  await o.joinRoom(created.roomCode);
  await xEvents.waitFor((event) => event.type === "room-ready");
  const authorized = await x.authenticateAdmin(secret);
  assert.equal(authorized.type, "admin-authenticated");
  assert.equal(JSON.stringify([...storageX.values.values()]).includes(secret), false);
});

test("clients receive randomized sides and the creator's saved session is updated", async (t) => {
  const { x, o, storageX } = await makeFixture(t, { sideRandom: () => 0.75 });
  const xEvents = eventLog(x);
  const oEvents = eventLog(o);
  const created = await x.createRoom();
  assert.equal(created.side, null);
  const joined = await o.joinRoom(created.roomCode);
  assert.equal(joined.side, "X");
  const creatorReady = await xEvents.waitFor((event) => event.type === "room-ready");
  assert.equal(creatorReady.side, "O");
  assert.equal(x.savedSession.side, "O");
  await oEvents.waitFor((event) => event.type === "room-ready");
  assert.equal(o.savedSession.side, "X");
  assert.equal(JSON.parse(storageX.getItem("viruses.online-room")).side, "O");
  const creatorUpdate = xEvents.waitFor((event) => event.type === "state" && event.state.phase === "setup-o");
  assert.equal(o.sendCommand({ type: "choose-start", row: 1, col: 1 }), true);
  const afterXChoice = await creatorUpdate;
  assert.equal(afterXChoice.state.setupPlayer, "O");
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
  assert.equal(resumed.room.side, null);
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

test("client derives wormhole hints from the newest snapshot and ignores same-version or older snapshots", async (t) => {
  const { server, x } = await makeFixture(t);
  const events = eventLog(x);
  const created = await x.createRoom();
  const rawServerSocket = [...server.webSocketServer.clients][0];
  const board = Array.from({ length: 10 }, () => Array(10).fill("#"));
  board[2][1] = "X";
  board[9][9] = "O";
  board[7][8] = "";
  const state = {
    ...created.state,
    phase: "playing",
    board,
    currentPlayer: "X",
    piecesLeft: 1,
    wormholePair: {
      id: 41,
      endpoints: { orange: { row: 2, col: 2 }, blue: { row: 7, col: 7 } },
      roundsRemaining: 3
    }
  };
  const envelope = {
    type: "state", roomCode: created.roomCode, side: "X", version: 1,
    state, clock: { enabled: false, remainingMs: { X: null, O: null }, activePlayer: null }
  };
  rawServerSocket.send(JSON.stringify(envelope));
  const accepted = await events.waitFor((event) => event.type === "state" && event.version === 1);
  assert.deepEqual(getLegalMoves(accepted.state), [{ row: 7, col: 8 }]);

  const sameVersionState = structuredClone(state);
  sameVersionState.board[7][8] = "#";
  rawServerSocket.send(JSON.stringify({ ...envelope, state: sameVersionState }));
  rawServerSocket.send(JSON.stringify({ ...envelope, version: 0, state: sameVersionState }));
  rawServerSocket.send(JSON.stringify({ ...envelope, roomCode: "OTHERROOM", version: 99, state: sameVersionState }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(x.lastVersion, 1);
  assert.deepEqual(x.lastRoomSnapshot.state.board, state.board);
  assert.equal(events.events.filter((event) => event.type === "state").length, 1);
});

test("creator can reopen the waiting room in the same tab without trying to claim its connected seat", async (t) => {
  const { x } = await makeFixture(t);
  const created = await x.createRoom();
  const resumed = await x.resumeSavedRoom();
  assert.equal(resumed.type, "room-resumed");
  assert.equal(resumed.roomCode, created.roomCode);
  assert.equal(resumed.side, null);
  assert.equal(resumed.status, "waiting");
  assert.equal(x.connected, true);
});

test("room recovery token migrates from tab storage to persistent browser storage", () => {
  const priorLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const priorSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  session.setItem("viruses.online-room", JSON.stringify({
    roomCode: "ROOM1234", side: "X", playerToken: "legacy-private-token-12345678901234567890"
  }));
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });
    const client = new MultiplayerClient({ WebSocketImpl: BrowserLikeWebSocket });
    assert.equal(client.savedSession.roomCode, "ROOM1234");
    assert.equal(local.getItem("viruses.online-room") !== null, true);
    assert.equal(session.getItem("viruses.online-room"), null);
  } finally {
    if (priorLocal) Object.defineProperty(globalThis, "localStorage", priorLocal);
    else delete globalThis.localStorage;
    if (priorSession) Object.defineProperty(globalThis, "sessionStorage", priorSession);
    else delete globalThis.sessionStorage;
  }
});

test("online clients receive validated opponent aim and confirmed attack visuals", async (t) => {
  const { x, o, roomManager } = await makeFixture(t);
  const xEvents = eventLog(x);
  const oEvents = eventLog(o);
  const created = await x.createRoom();
  await o.joinRoom(created.roomCode);
  await xEvents.waitFor((event) => event.type === "room-ready");
  const xSetup = xEvents.waitFor((event) => event.type === "state" && event.state.phase === "setup-o");
  x.sendCommand({ type: "choose-start", row: 0, col: 0 });
  await xSetup;
  const playing = oEvents.waitFor((event) => event.type === "state" && event.state.phase === "playing");
  o.sendCommand({ type: "choose-start", row: 9, col: 9 });
  await playing;

  const internal = roomManager.rooms.get(created.roomCode);
  internal.state = {
    ...internal.state,
    inventory: { X: [{ id: 701, type: "bomb" }], O: [] },
    selectedAbility: null
  };
  const selection = xEvents.waitFor((event) => event.type === "state" && event.state.selectedAbility === 701);
  x.sendCommand({ type: "select-ability", itemId: 701 });
  await selection;
  assert.equal(x.sendAim(2, 2), true);
  const aim = await oEvents.waitFor((event) => event.type === "aim" && event.target?.row === 2);
  assert.equal(aim.side, "X");
  assert.equal(aim.target.abilityType, "bomb");

  const xVisual = xEvents.waitFor((event) => event.type === "visual-event");
  const oVisual = oEvents.waitFor((event) => event.type === "visual-event");
  x.sendCommand({ type: "ability-target", itemId: 701, row: 2, col: 2 });
  const [xEvent, oEvent] = await Promise.all([xVisual, oVisual]);
  assert.equal(xEvent.eventId, oEvent.eventId);
  assert.equal(xEvent.abilityType, "bomb");
  assert.equal(xEvent.row, 2);
  assert.equal(oEvent.roomCode, created.roomCode);
  const clear = await oEvents.waitFor((event) => event.type === "aim" && event.target === null);
  assert.equal(clear.roomCode, created.roomCode);
});

test("online settings restart and rematch require the second player's approval", async (t) => {
  const { x, o, roomManager } = await makeFixture(t);
  const xEvents = eventLog(x);
  const oEvents = eventLog(o);
  const baseSettings = {
    width: 10, height: 10, piecesPerTurn: 1, clockMinutes: 5, incrementSeconds: 0,
    unlimitedTime: true, randomEvents: false, animationsEnabled: true,
    freeStartingPositions: false, disabledItems: ["pointDestroy"]
  };
  const created = await x.createRoom(baseSettings);
  await o.joinRoom(created.roomCode);
  const readyX = await xEvents.waitFor((event) => event.type === "room-ready" && event.side);
  const readyO = await oEvents.waitFor((event) => event.type === "room-ready" && event.side);
  const players = { [readyX.side]: x, [readyO.side]: o };
  const events = { X: readyX.side === "X" ? xEvents : oEvents, O: readyO.side === "O" ? oEvents : xEvents };

  const declinedOffer = await players.X.proposeRestart("settings", { ...baseSettings, width: 12 });
  const settingsPrompt = await events.O.waitFor((event) => event.type === "restart-proposal" && event.proposalId === declinedOffer.proposalId);
  assert.equal(settingsPrompt.settings.width, 12);
  await players.O.voteRestart(declinedOffer.proposalId, false);
  await events.X.waitFor((event) => event.type === "restart-cancelled" && event.proposalId === declinedOffer.proposalId);
  assert.equal(roomManager.getSnapshot(created.roomCode, "X").state.board[0].length, 10);

  const acceptedOffer = await players.X.proposeRestart("settings", { ...baseSettings, width: 12 });
  await events.O.waitFor((event) => event.type === "restart-proposal" && event.proposalId === acceptedOffer.proposalId);
  await players.O.voteRestart(acceptedOffer.proposalId, true);
  const restarted = await Promise.all([xEvents, oEvents].map((log) => log.waitFor((event) => event.type === "state" && event.restartKind === "settings")));
  assert.deepEqual(restarted.map((event) => event.state.board[0].length), [12, 12]);
  assert.deepEqual(restarted[0].state.settings.disabledItems, ["pointDestroy"]);

  const xPlayer = restarted.find((event) => event.side === "X") === restarted[0] ? x : o;
  const oPlayer = xPlayer === x ? o : x;
  await xPlayer.sendCommand({ type: "resign" });
  await Promise.all([xEvents, oEvents].map((log) => log.waitFor((event) => event.type === "state" && event.state.phase === "finished")));
  const rematchOffer = await xPlayer.proposeRestart("rematch");
  await (xPlayer === x ? oEvents : xEvents).waitFor((event) => event.type === "restart-proposal" && event.proposalId === rematchOffer.proposalId);
  await oPlayer.voteRestart(rematchOffer.proposalId, true);
  const rematchStates = await Promise.all([xEvents, oEvents].map((log) => log.waitFor((event) => event.type === "state" && event.restartKind === "rematch")));
  assert.ok(rematchStates.every((event) => event.state.phase === "playing" && event.state.winner === null));
  assert.equal(rematchStates[0].side, rematchStates[1].side === "X" ? "O" : "X");
  assert.ok(rematchStates.every((event) => event.state.settings.width === 12));
});

test("WebSocket address defaults are local-only and secure on HTTPS origins", () => {
  assert.equal(resolveMultiplayerUrl({ configuredUrl: "/ws", location: { protocol: "https:", host: "game.example" } }), "wss://game.example/ws");
  assert.equal(resolveMultiplayerUrl({ configuredUrl: "/ws", location: { protocol: "http:", host: "127.0.0.1:3000" } }), "ws://127.0.0.1:3000/ws");
  assert.equal(MULTIPLAYER_CONFIG.localWebSocketUrl, "ws://127.0.0.1:3001/ws");
  assert.equal(resolveMultiplayerUrl({ location: { hostname: "localhost" } }), MULTIPLAYER_CONFIG.localWebSocketUrl);
  assert.equal(resolveMultiplayerUrl({ location: { hostname: "game.example", protocol: "https:", host: "game.example" } }), "wss://game.example/ws");
  assert.equal(resolveMultiplayerUrl({ configuredUrl: "wss://socket.example/game", location: { hostname: "localhost" } }), "wss://socket.example/game");
});
