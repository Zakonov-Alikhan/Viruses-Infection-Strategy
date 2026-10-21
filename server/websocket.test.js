import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { RoomManager } from "./rooms.js";
import { createMultiplayerServer } from "./websocket.js";

class Peer {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.waiters = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString("utf8"));
      const waiterIndex = this.waiters.findIndex(({ predicate }) => predicate(message));
      if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1)[0].resolve(message);
      else this.messages.push(message);
    });
    socket.on("error", () => {});
  }

  send(value) {
    this.socket.send(typeof value === "string" ? value : JSON.stringify(value));
  }

  next(type, timeoutMs = 2500) {
    const index = this.messages.findIndex((message) => message.type === type);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.resolve !== wrappedResolve);
        reject(new Error(`Timed out waiting for WebSocket message '${type}'`));
      }, timeoutMs);
      const wrappedResolve = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push({ predicate: (message) => message.type === type, resolve: wrappedResolve });
    });
  }

  close() {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", resolve);
      this.socket.close();
    });
  }
}

async function openPeer(address, origin = "http://localhost:3000") {
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return new Peer(socket);
}

async function makeTestServer(options = {}) {
  let codeNumber = 0;
  let tokenNumber = 0;
  const roomManager = options.roomManager ?? new RoomManager({
    settings: {
      width: 10,
      height: 10,
      piecesPerTurn: 3,
      randomEvents: false,
      freeStartingPositions: true,
      adminMode: false
    },
    random: () => 0.75,
    sideRandom: () => 0.25,
    roomCodeFactory: () => `WSROOM${++codeNumber}`,
    playerTokenFactory: () => `ws-test-token-${String(++tokenNumber).padStart(32, "0")}`
  });
  const server = createMultiplayerServer({
    host: "127.0.0.1",
    port: 0,
    cleanupIntervalMs: 0,
    allowedOrigins: new Set(["http://localhost:3000"]),
    roomManager,
    ...options
  });
  const address = await server.listen();
  return { server, address, roomManager };
}

test("real WebSocket peers get server-assigned seats and private, versioned state", async (t) => {
  const { server, address } = await makeTestServer();
  const peers = [];
  t.after(async () => {
    await Promise.all(peers.map((peer) => peer.close().catch(() => {})));
    await server.close();
  });

  const x = await openPeer(address);
  peers.push(x);
  x.send({ type: "create-room", requestId: "create" });
  const created = await x.next("room-created");
  assert.equal(created.side, null);
  assert.equal(created.status, "waiting");
  assert.equal(created.clock.enabled, true);
  assert.deepEqual(created.clock.remainingMs, { X: 5 * 60_000, O: 5 * 60_000 });
  assert.equal("playerRoles" in created.state, false);
  assert.equal("pendingExtraTurn" in created.state, false);

  const o = await openPeer(address);
  peers.push(o);
  o.send({ type: "join-room", code: created.roomCode, requestId: "join" });
  const joined = await o.next("room-joined");
  assert.equal(joined.side, "O");
  assert.equal(joined.playerToken.length >= 32, true);
  assert.equal(joined.clock.enabled, true);
  const ready = await x.next("room-ready");
  assert.equal(ready.side, "X");
  assert.equal(ready.version, 0);
  assert.equal("playerToken" in ready, false);

  const third = await openPeer(address);
  peers.push(third);
  third.send({ type: "join-room", code: created.roomCode });
  assert.equal((await third.next("server-error")).code, "room-full");

  const xStart = x.next("state");
  const oStart = o.next("state");
  x.send({ type: "command", command: { type: "choose-start", row: 0, col: 0 } });
  const [xStartState, oStartState] = await Promise.all([xStart, oStart]);
  assert.deepEqual(xStartState.state.startChoices.X, { row: 0, col: 0 });
  assert.equal(oStartState.state.startChoices.X, null);
  assert.equal(xStartState.version, 1);
  assert.equal(oStartState.version, 1);

  o.send({ type: "command", side: "X", command: { type: "choose-start", row: 9, col: 9 } });
  assert.equal((await o.next("server-error")).code, "invalid-message");

  o.send({ type: "command", command: { type: "place", row: 9, col: 8 }, requestId: "wrong-phase" });
  const phaseError = await o.next("command-error");
  assert.equal(phaseError.code, "wrong-phase");
  assert.equal(phaseError.requestId, "wrong-phase");

  const xGame = x.next("state");
  const oGame = o.next("state");
  o.send({ type: "command", command: { type: "choose-start", row: 9, col: 9 } });
  const [xGameState, oGameState] = await Promise.all([xGame, oGame]);
  assert.equal(xGameState.version, 2);
  assert.equal(xGameState.state.phase, "playing");
  assert.equal(xGameState.clock.activePlayer, "X");
  assert.equal(xGameState.clock.remainingMs.X > 0, true);
  assert.equal(xGameState.state.board[0][0], "X");
  assert.equal(oGameState.state.startChoices.X, null);

  const xMove = x.next("state");
  const oMove = o.next("state");
  x.send({ type: "command", command: { type: "place", row: 0, col: 1 } });
  const [xMoveState, oMoveState] = await Promise.all([xMove, oMove]);
  assert.equal(xMoveState.version, 3);
  assert.equal(oMoveState.version, 3);
  assert.equal(xMoveState.clock.activePlayer, "X");
  assert.equal(oMoveState.clock.activePlayer, "X");
  assert.equal(xMoveState.state.board[0][1], "X");
  assert.deepEqual(xMoveState.state, oMoveState.state);
});

test("WebSocket board editing requires the configured admin secret and broadcasts the authoritative snapshot", async (t) => {
  const secret = "test-admin-secret-not-for-client-state";
  const { server, address } = await makeTestServer({ adminSecret: secret });
  const peers = [];
  t.after(async () => {
    await Promise.all(peers.map((peer) => peer.close().catch(() => {})));
    await server.close();
  });

  const x = await openPeer(address);
  peers.push(x);
  x.send({ type: "create-room", settings: { freeStartingPositions: false }, requestId: "create" });
  const created = await x.next("room-created");
  const o = await openPeer(address);
  peers.push(o);
  o.send({ type: "join-room", code: created.roomCode, requestId: "join" });
  await o.next("room-joined");
  await x.next("room-ready");
  const readyO = await o.next("room-ready");
  assert.equal(readyO.state.phase, "playing");

  x.send({ type: "command", command: {
    type: "board-edit", object: { kind: "item", itemType: "bomb", row: 4, col: 4 }
  }, requestId: "unauthorized" });
  assert.equal((await x.next("command-error")).code, "admin-required");

  x.send({ type: "admin-auth", secret: "wrong", requestId: "bad-auth" });
  assert.equal((await x.next("server-error")).code, "admin-auth-failed");
  x.send({ type: "admin-auth", secret, requestId: "auth" });
  assert.equal((await x.next("admin-authenticated")).requestId, "auth");
  x.send({ type: "command", command: {
    type: "board-edit", object: { kind: "item", itemType: "bomb", row: 4, col: 4 }
  }, requestId: "edit" });

  const [xState, oState] = await Promise.all([x.next("state"), o.next("state")]);
  assert.equal(xState.version, oState.version);
  assert.deepEqual(xState.state.eventItems, oState.state.eventItems);
  assert.equal(xState.state.eventItems.at(-1).type, "bomb");
  assert.equal(xState.state.currentPlayer, "X");
  assert.equal(xState.state.piecesLeft, readyO.state.piecesLeft);
  assert.equal(JSON.stringify(x.messages.concat(o.messages)).includes(secret), false);
});

test("forwards validated room settings through WebSocket creation to both players", async (t) => {
  const { server, address } = await makeTestServer();
  const peers = [];
  t.after(async () => {
    await Promise.all(peers.map((peer) => peer.close().catch(() => {})));
    await server.close();
  });

  const host = await openPeer(address);
  peers.push(host);
  host.send({
    type: "create-room",
    requestId: "settings-create",
    settings: {
      width: 12,
      height: 10,
      piecesPerTurn: 3,
      clockMinutes: 4,
      incrementSeconds: 6,
      unlimitedTime: false,
      randomEvents: false,
      wormholesEnabled: false,
      animationsEnabled: false,
      freeStartingPositions: false,
      disabledItems: ["bomb", "shield"]
    }
  });
  const created = await host.next("room-created");
  assert.equal(created.requestId, "settings-create");
  assert.deepEqual(created.state.settings, {
    width: 12,
    height: 10,
    piecesPerTurn: 3,
    clockMinutes: 4,
    incrementSeconds: 6,
    unlimitedTime: false,
    randomEvents: false,
    wormholesEnabled: false,
    animationsEnabled: false,
    freeStartingPositions: false,
    disabledItems: ["bomb", "shield"]
  });
  assert.equal(created.state.phase, "playing");
  assert.deepEqual(created.clock.remainingMs, { X: 4 * 60_000, O: 4 * 60_000 });

  const guest = await openPeer(address);
  peers.push(guest);
  guest.send({ type: "join-room", code: created.roomCode });
  const joined = await guest.next("room-joined");
  assert.deepEqual(joined.state.settings, created.state.settings);
  assert.deepEqual(joined.clock.remainingMs, created.clock.remainingMs);
});

test("WebSocket room creation accepts blank clock values when time is unlimited", async (t) => {
  const { server, address } = await makeTestServer();
  const peer = await openPeer(address);
  t.after(async () => {
    await peer.close().catch(() => {});
    await server.close();
  });

  peer.send({
    type: "create-room",
    requestId: "unlimited-create",
    settings: {
      width: 10,
      height: 10,
      piecesPerTurn: 1,
      clockMinutes: null,
      incrementSeconds: null,
      unlimitedTime: true,
      randomEvents: false,
      animationsEnabled: true,
      freeStartingPositions: false
    }
  });
  const created = await peer.next("room-created");
  assert.equal(created.requestId, "unlimited-create");
  assert.equal(created.state.settings.unlimitedTime, true);
  assert.equal(Number.isFinite(created.state.settings.clockMinutes), true);
  assert.equal(Number.isFinite(created.state.settings.incrementSeconds), true);
  assert.equal(created.clock.enabled, false);
  assert.deepEqual(created.clock.remainingMs, { X: null, O: null });
});

test("handles malformed and unknown messages, binary frames, and rejects oversized frames", async (t) => {
  const { server, address } = await makeTestServer({ maxPayload: 1024 });
  const peers = [];
  t.after(async () => {
    await Promise.all(peers.map((peer) => peer.close().catch(() => {})));
    await server.close();
  });

  const peer = await openPeer(address);
  peers.push(peer);
  peer.send("{");
  assert.equal((await peer.next("server-error")).code, "invalid-json");
  peer.send({ type: "future-action" });
  assert.equal((await peer.next("server-error")).code, "unknown-message-type");
  peer.socket.send(Buffer.from([1, 2, 3]));
  assert.equal((await peer.next("server-error")).code, "binary-message-not-supported");

  const close = new Promise((resolve) => peer.socket.once("close", (code) => resolve(code)));
  peer.socket.send("x".repeat(2048));
  assert.equal(await close, 1009);
});

test("exposes health check over HTTP", async (t) => {
  const { server, address } = await makeTestServer();
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "viruses-multiplayer" });
});

test("rejects missing and non-allow-listed WebSocket origins", async (t) => {
  const { server, address } = await makeTestServer({
    allowedOrigins: new Set(["https://game.example"])
  });
  t.after(() => server.close());

  for (const origin of [undefined, "https://attacker.example"]) {
    const options = origin ? { origin } : {};
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, options);
    await assert.rejects(new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }));
  }
});

test("limits room creation and join attempts by client address", async (t) => {
  const { server, address } = await makeTestServer({
    roomCreationRateLimit: { max: 1, windowMs: 60_000 },
    roomJoinRateLimit: { max: 1, windowMs: 60_000 }
  });
  const peers = [];
  t.after(async () => {
    await Promise.all(peers.map((peer) => peer.close().catch(() => {})));
    await server.close();
  });

  const host = await openPeer(address);
  peers.push(host);
  host.send({ type: "create-room", requestId: "create-1" });
  const created = await host.next("room-created");

  const guest = await openPeer(address);
  peers.push(guest);
  guest.send({ type: "join-room", code: created.roomCode, requestId: "join-1" });
  assert.equal((await guest.next("room-joined")).side, "O");

  const anotherHost = await openPeer(address);
  peers.push(anotherHost);
  anotherHost.send({ type: "create-room", requestId: "create-other" });
  assert.equal((await anotherHost.next("server-error")).code, "rate-limited");
  const anotherGuest = await openPeer(address);
  peers.push(anotherGuest);
  anotherGuest.send({ type: "join-room", code: "NOTFOUND", requestId: "join-2" });
  assert.equal((await anotherGuest.next("server-error")).code, "rate-limited");
});

test("does not broadcast reconnect tokens to the other room participant", async (t) => {
  const { server, address } = await makeTestServer();
  const peers = [];
  t.after(async () => {
    await Promise.all(peers.map((peer) => peer.close().catch(() => {})));
    await server.close();
  });

  const x = await openPeer(address);
  peers.push(x);
  x.send({ type: "create-room" });
  const created = await x.next("room-created");
  const o = await openPeer(address);
  peers.push(o);
  o.send({ type: "join-room", code: created.roomCode });
  const joined = await o.next("room-joined");
  const readyForX = await x.next("room-ready");
  assert.notEqual(created.playerToken, joined.playerToken);
  assert.equal("playerToken" in readyForX, false);
  assert.equal(JSON.stringify(readyForX).includes(created.playerToken), false);
  assert.equal(JSON.stringify(readyForX).includes(joined.playerToken), false);
});
