import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, getLegalMoves } from "../ui/game.js";
import { RoomManager } from "./rooms.js";

const TEST_SETTINGS = {
  width: 10,
  height: 10,
  piecesPerTurn: 3,
  clockMinutes: 5,
  incrementSeconds: 0,
  unlimitedTime: true,
  randomEvents: false,
  animationsEnabled: false,
  freeStartingPositions: true,
  adminMode: true
};
const VALID_ROOM_SETTINGS = Object.fromEntries(Object.entries(TEST_SETTINGS).filter(([key]) => key !== "adminMode"));

function makeManager(options = {}) {
  let nextCode = 0;
  let nextToken = 0;
  return new RoomManager({
    settings: TEST_SETTINGS,
    random: () => 0.75,
    sideRandom: () => 0.25,
    roomCodeFactory: () => `ROOM${String(++nextCode).padStart(4, "0")}`,
    playerTokenFactory: () => `test-token-${String(++nextToken).padStart(32, "0")}`,
    ...options
  });
}

function makeFakeScheduler() {
  let now = 1_000;
  let nextId = 0;
  const timers = new Map();
  const setTimeoutFn = (callback, delay) => {
    const id = ++nextId;
    timers.set(id, { callback, dueAt: now + delay });
    return id;
  };
  const clearTimeoutFn = (id) => timers.delete(id);
  return {
    now: () => now,
    timers,
    setTimeoutFn,
    clearTimeoutFn,
    async advance(milliseconds) {
      now += milliseconds;
      const due = [...timers.entries()].filter(([, timer]) => timer.dueAt <= now);
      for (const [id, timer] of due) {
        if (!timers.delete(id)) continue;
        await timer.callback();
      }
      await Promise.resolve();
    }
  };
}

function makeTimedManager(scheduler, { unlimitedTime = false } = {}) {
  let nextCode = 0;
  let nextToken = 0;
  const manager = new RoomManager({
    settings: {
      ...TEST_SETTINGS,
      clockMinutes: 1,
      incrementSeconds: 2,
      piecesPerTurn: 1,
      unlimitedTime
    },
    now: scheduler.now,
    scheduleTimeout: scheduler.setTimeoutFn,
    cancelTimeout: scheduler.clearTimeoutFn,
    random: () => 0.75,
    sideRandom: () => 0.25,
    roomCodeFactory: () => `CLOCK${++nextCode}`,
    playerTokenFactory: () => `clock-test-token-${String(++nextToken).padStart(32, "0")}`
  });
  const room = manager.createRoom();
  manager.joinRoom(room.roomCode);
  const received = { X: [], O: [] };
  const connectionX = manager.attachConnection(room.roomCode, "X", (message) => received.X.push(message));
  const connectionO = manager.attachConnection(room.roomCode, "O", (message) => received.O.push(message));
  return { manager, room, received, connectionX, connectionO };
}

async function startGame(manager, code, connections) {
  manager.broadcastReady(code);
  const x = await manager.submitCommand(code, "X", { type: "choose-start", row: 0, col: 0 });
  const oViewBefore = manager.getSnapshot(code, "O").state;
  assert.equal(oViewBefore.startChoices.X, null);
  const o = await manager.submitCommand(code, "O", { type: "choose-start", row: 9, col: 9 });
  assert.equal(x.ok, true);
  assert.equal(o.ok, true);
  assert.equal(manager.getSnapshot(code, "X").state.phase, "playing");
  assert.equal(connections.X.at(-1).type, "state");
}

test("creates private rooms without exposing a final side until the second player joins", () => {
  const manager = makeManager();
  const created = manager.createRoom();
  const joined = manager.joinRoom(created.roomCode.toLowerCase());

  assert.equal(created.ok, true);
  assert.equal(joined.ok, true);
  assert.equal(created.side, null);
  assert.equal(joined.side, "O");
  assert.equal("adminMode" in created.state.settings, false);
  assert.equal("adminMode" in joined.state.settings, false);
  assert.deepEqual(created.state.settings.disabledItems, ["freePlacement"]);
  assert.deepEqual(joined.state.settings.disabledItems, ["freePlacement"]);
  assert.equal(manager.roomCount, 1);
});

test("room catalog omits invite codes and spectators require a public room or admin authority", () => {
  const manager = makeManager();
  const created = manager.createRoom();
  const listing = manager.listRoomCatalog();
  assert.equal(listing.length, 1);
  assert.equal(listing[0].visibility, "private");
  assert.equal(listing[0].players, 1);
  assert.equal(listing[0].settings.width, 10);
  assert.equal(JSON.stringify(listing).includes(created.roomCode), false);
  assert.equal(manager.attachObserver(listing[0].id, { send() {} }).error.code, "private-room");

  assert.equal(manager.setRoomVisibility(created.roomCode, true), true);
  const received = [];
  const observer = manager.attachObserver(listing[0].id, { send: (message) => received.push(message) });
  assert.equal(observer.ok, true);
  manager.joinRoom(created.roomCode);
  manager.broadcastReady(created.roomCode);
  assert.equal(received.at(-1).type, "room-ready");
  assert.equal(received.at(-1).roomId, listing[0].id);
  assert.equal("roomCode" in received.at(-1), false);
  assert.equal(manager.listRoomCatalog()[0].observers, 1);
  assert.equal(manager.detachObserver(listing[0].id, observer.observerId), true);
});

test("finished matches are excluded from the active room catalog", async () => {
  const manager = makeManager();
  const created = manager.createRoom();
  manager.joinRoom(created.roomCode);
  manager.setRoomVisibility(created.roomCode, true);
  assert.equal(manager.listRoomCatalog().length, 1);
  manager.rooms.get(created.roomCode).state = { ...manager.rooms.get(created.roomCode).state, phase: "finished" };
  assert.equal(manager.listRoomCatalog().length, 0);
});

test("field item expiry is resolved once by the room engine and synchronized to players and observers", async () => {
  const manager = makeManager({ random: () => 0.75 });
  const created = manager.createRoom({
    ...VALID_ROOM_SETTINGS,
    piecesPerTurn: 1,
    unlimitedItemLifetime: false,
    itemLifetimeTurns: 1,
    randomEvents: false
  });
  manager.setRoomVisibility(created.roomCode, true);
  const joined = manager.joinRoom(created.roomCode);
  const received = { X: [], O: [], observer: [] };
  const connectionX = manager.attachConnection(created.roomCode, "X", (message) => received.X.push(message));
  const connectionO = manager.attachConnection(created.roomCode, "O", (message) => received.O.push(message));
  const roomId = manager.listRoomCatalog()[0].id;
  const observer = manager.attachObserver(roomId, { send: (message) => received.observer.push(message) });
  assert.equal(joined.ok, true);
  await startGame(manager, created.roomCode, received);
  const room = manager.resolveCatalogRoom(roomId);
  room.state = { ...room.state, eventItems: [{ id: 101, type: "bomb", row: 5, col: 5, lifetimeTurns: 1 }] };
  const move = getLegalMoves(room.state, "X")[0];
  assert.ok(move);
  const xSnapshot = received.X.length;
  const oSnapshot = received.O.length;
  const observerSnapshot = received.observer.length;
  const result = await manager.submitCommand(created.roomCode, "X", { type: "place", ...move });
  assert.equal(result.ok, true);
  assert.deepEqual(room.state.eventItems, []);
  assert.deepEqual(received.X.at(-1).state.eventItems, []);
  assert.deepEqual(received.O.at(-1).state.eventItems, []);
  assert.deepEqual(received.observer.at(-1).state.eventItems, []);
  assert.equal(received.X.length, xSnapshot + 1);
  assert.equal(received.O.length, oSnapshot + 1);
  assert.equal(received.observer.length, observerSnapshot + 1);
  manager.detachObserver(roomId, observer.observerId);
  manager.detachConnection(created.roomCode, "X", connectionX.connection);
  manager.detachConnection(created.roomCode, "O", connectionO.connection);
});

test("administrator clock adjustment is bounded and authoritative", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received } = makeTimedManager(scheduler);
  await startGame(manager, room.roomCode, received);
  const id = manager.listRoomCatalog()[0].id;
  const before = manager.getSnapshot(room.roomCode, "X").clock.remainingMs;
  const changed = await manager.addAdminTime(id, "both", 30);
  assert.equal(changed.ok, true);
  assert.equal(changed.clock.remainingMs.X, before.X + 30_000);
  assert.equal(changed.clock.remainingMs.O, before.O + 30_000);
  assert.equal((await manager.addAdminTime(id, "O", 0)).error.code, "invalid-time-adjustment");
  assert.equal((await manager.addAdminTime(id, "O", 601)).error.code, "invalid-time-adjustment");
});

test("a player can add a fixed 15 seconds to the connected opponent in an active timed room", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received } = makeTimedManager(scheduler);
  await startGame(manager, room.roomCode, received);
  const before = manager.getSnapshot(room.roomCode, "X").clock;
  const boosted = await manager.addOpponentTime(room.roomCode, "O");
  assert.equal(boosted.ok, true);
  assert.equal(boosted.targetSide, "X");
  assert.equal(boosted.seconds, 15);
  assert.equal(boosted.clock.remainingMs.X, before.remainingMs.X + 15_000);
  assert.equal(received.X.at(-1).type, "time-added");
  assert.deepEqual(received.X.at(-1), received.O.at(-1));
  assert.equal(received.X.at(-1).targetSide, "X");
});

test("time boost rejects waiting, untimed, and invalid-player states", async () => {
  const scheduler = makeFakeScheduler();
  const waiting = makeTimedManager(scheduler);
  assert.equal((await waiting.manager.addOpponentTime(waiting.room.roomCode, "X")).error.code, "wrong-phase");
  assert.equal((await waiting.manager.addOpponentTime(waiting.room.roomCode, null)).error.code, "invalid-player");

  const manager = makeManager();
  const room = manager.createRoom({ ...VALID_ROOM_SETTINGS, unlimitedTime: true });
  manager.joinRoom(room.roomCode);
  const received = { X: [], O: [] };
  manager.attachConnection(room.roomCode, "X", (message) => received.X.push(message));
  manager.attachConnection(room.roomCode, "O", (message) => received.O.push(message));
  await startGame(manager, room.roomCode, received);
  assert.equal((await manager.addOpponentTime(room.roomCode, "X")).error.code, "clock-disabled");
});

test("rated room binds distinct account identities and reports only the server winner", async () => {
  const results = [];
  const manager = new RoomManager({
    onMatchFinished: async (result) => { results.push(result); return { recorded: true, delta: 16 }; },
    settings: { ...DEFAULT_SETTINGS, freeStartingPositions: false, randomEvents: false },
    random: () => 0.75,
    sideRandom: () => 0.25,
    roomCodeFactory: () => "RATEDROOM",
    playerTokenFactory: (() => { let n = 0; return () => `rated-test-token-${String(++n).padStart(32, "0")}`; })()
  });
  const created = manager.createRoom(undefined, { accountId: "account-a" });
  const sameAccount = manager.joinRoom(created.roomCode, { accountId: "account-a" });
  assert.equal(sameAccount.error.code, "same-account");
  const joined = manager.joinRoom(created.roomCode, {
    accountId: "account-b",
    ratingsByAccount: { "account-a": 1300, "account-b": 1200 }
  });
  assert.equal(joined.ok, true);
  const notifications = [];
  manager.attachConnection(created.roomCode, "X", (message) => notifications.push(message));
  manager.attachConnection(created.roomCode, "O", (message) => notifications.push(message));
  const loserSide = manager.rooms.get(created.roomCode).state.currentPlayer;
  const finished = await manager.submitCommand(created.roomCode, loserSide, { type: "resign" });
  assert.equal(finished.ok, true);
  await manager.rooms.get(created.roomCode).ratingPromise;
  assert.equal(results.length, 1);
  assert.equal(results[0].winnerId, manager.rooms.get(created.roomCode).seats[loserSide === "X" ? "O" : "X"].accountId);
  assert.deepEqual(results[0].ratingsAtStart, { "account-a": 1300, "account-b": 1200 });
  assert.equal(notifications.filter(({ type }) => type === "rating-updated").length, 2);
  assert.equal(manager.resumeRoom(created.roomCode, created.playerToken, () => {}, { accountId: "account-c" }).error.code, "account-mismatch");
  manager.sweepExpiredRooms();
  assert.equal(results.length, 1);
  manager.stopAllClocks();
});

test("room history contains only confirmed commands and is shared with each player's view", async () => {
  const manager = makeManager();
  const room = manager.createRoom();
  manager.joinRoom(room.roomCode);
  const received = { X: [], O: [] };
  manager.attachConnection(room.roomCode, "X", (message) => received.X.push(message));
  manager.attachConnection(room.roomCode, "O", (message) => received.O.push(message));
  manager.broadcastReady(room.roomCode);

  await startGame(manager, room.roomCode, received);
  const initialHistory = manager.getSnapshot(room.roomCode, "X").history;
  assert.equal(initialHistory.length, 1);
  assert.equal(initialHistory[0].type, "start");
  assert.equal("startChoices" in initialHistory[0].position, false);

  const rejected = await manager.submitCommand(room.roomCode, "X", { type: "place", row: -1, col: -1 });
  assert.equal(rejected.ok, false);
  assert.equal(manager.getSnapshot(room.roomCode, "X").history.length, 1);

  const state = manager.getSnapshot(room.roomCode, "X").state;
  const move = getLegalMoves(state)[0];
  const accepted = await manager.submitCommand(room.roomCode, "X", {
    type: "place", row: move.row, col: move.col
  });
  assert.equal(accepted.ok, true);
  const historyX = manager.getSnapshot(room.roomCode, "X").history;
  const historyO = manager.getSnapshot(room.roomCode, "O").history;
  assert.equal(historyX.length, 2);
  assert.deepEqual(historyO.map(({ id }) => id), historyX.map(({ id }) => id));
  assert.equal(historyX[1].type, "placement");
  assert.equal(historyX[1].side, "X");
  assert.deepEqual(historyX[1].coordinates, [move]);
  assert.equal(received.X.at(-1).historyEntry.id, historyX[1].id);
  assert.equal(received.O.at(-1).historyEntry.id, historyX[1].id);
});

test("randomly assigns X and O after the second player joins and retains token ownership", () => {
  for (const [sideRandom, expectedCreator, expectedJoiner] of [
    [() => 0.25, "X", "O"],
    [() => 0.75, "O", "X"]
  ]) {
    const manager = makeManager({ sideRandom });
    const sentByCreator = [];
    const created = manager.createRoom();
    const creatorConnection = manager.attachConnection(created.roomCode, "X", (message) => sentByCreator.push(message));
    const joined = manager.joinRoom(created.roomCode);
    assert.equal(joined.side, expectedJoiner);
    assert.equal(creatorConnection.connection.side, expectedCreator);
    assert.equal(manager.resumeRoom(created.roomCode, created.playerToken, () => {}).error.code, "seat-already-connected");
    manager.broadcastReady(created.roomCode);
    assert.equal(sentByCreator.at(-1).side, expectedCreator);
    manager.detachConnection(created.roomCode, expectedCreator, creatorConnection.connection);
    const resumed = manager.resumeRoom(created.roomCode, created.playerToken, () => {});
    assert.equal(resumed.side, expectedCreator);
    assert.deepEqual(resumed.state.settings.disabledItems, ["freePlacement"]);
  }
});

test("applies validated per-room settings to game state and clock, and rejects invalid settings", () => {
  const manager = makeManager();
  const customSettings = {
    width: 12,
    height: 10,
    piecesPerTurn: 3,
    clockMinutes: 7,
    incrementSeconds: 4,
    unlimitedTime: false,
    randomEvents: false,
    itemSpawnMode: "cascade",
    wormholesEnabled: false,
    animationsEnabled: false,
    freeStartingPositions: false,
    disabledItems: ["bomb", "shield"],
    unlimitedItemLifetime: true,
    itemLifetimeTurns: 10
  };
  const created = manager.createRoom(customSettings);
  assert.equal(created.ok, true);
  assert.equal(created.state.phase, "playing");
  assert.deepEqual(created.state.settings, customSettings);
  assert.deepEqual(created.clock.remainingMs, { X: 7 * 60_000, O: 7 * 60_000 });
  assert.equal(created.clock.enabled, true);

  const joined = manager.joinRoom(created.roomCode);
  assert.deepEqual(joined.state.settings, customSettings);
  assert.ok(joined.clock.remainingMs.X <= 7 * 60_000 && joined.clock.remainingMs.X > 7 * 60_000 - 1_000);
  assert.equal(joined.clock.remainingMs.O, 7 * 60_000);

  const roomCount = manager.roomCount;
  const invalidPieces = manager.createRoom({ ...customSettings, piecesPerTurn: 13 });
  const unknownSetting = manager.createRoom({ ...customSettings, adminMode: true });
  const unknownItem = manager.createRoom({ ...customSettings, disabledItems: ["not-an-item"] });
  const invalidWormholeSetting = manager.createRoom({ ...customSettings, wormholesEnabled: "false" });
  const invalidSpawnMode = manager.createRoom({ ...customSettings, itemSpawnMode: "unknown" });
  assert.deepEqual(invalidPieces.error, { code: "invalid-settings" });
  assert.deepEqual(unknownSetting.error, { code: "invalid-settings" });
  assert.deepEqual(unknownItem.error, { code: "invalid-settings" });
  assert.deepEqual(invalidWormholeSetting.error, { code: "invalid-settings" });
  assert.deepEqual(invalidSpawnMode.error, { code: "invalid-settings" });
  assert.equal(manager.roomCount, roomCount);
});

test("unlimited-time rooms accept absent time values and keep finite settings with disabled clocks", () => {
  const manager = makeManager();
  const created = manager.createRoom({
    width: 10,
    height: 10,
    piecesPerTurn: 1,
    clockMinutes: null,
    incrementSeconds: null,
    unlimitedTime: true,
    randomEvents: false,
    wormholesEnabled: false,
    animationsEnabled: true,
    freeStartingPositions: false
  });

  assert.equal(created.ok, true);
  assert.equal(created.clock.enabled, false);
  assert.deepEqual(created.clock.remainingMs, { X: null, O: null });
  assert.equal(Number.isFinite(created.state.settings.clockMinutes), true);
  assert.equal(Number.isFinite(created.state.settings.incrementSeconds), true);
  assert.equal(created.state.settings.clockMinutes, DEFAULT_SETTINGS.clockMinutes);
  assert.equal(created.state.settings.incrementSeconds, DEFAULT_SETTINGS.incrementSeconds);
});

test("a fixed-corner online game starts the server clock when the second player joins", () => {
  const scheduler = makeFakeScheduler();
  const manager = new RoomManager({
    settings: { ...TEST_SETTINGS, freeStartingPositions: false, unlimitedTime: false },
    now: scheduler.now,
    scheduleTimeout: scheduler.setTimeoutFn,
    cancelTimeout: scheduler.clearTimeoutFn,
    sideRandom: () => 0.25,
    roomCodeFactory: () => "FIXED1",
    playerTokenFactory: () => "fixed-start-test-token-000000000000000"
  });
  const room = manager.createRoom();
  assert.equal(room.state.phase, "playing");
  manager.joinRoom(room.roomCode);
  const clock = manager.getSnapshot(room.roomCode, "X").clock;
  assert.equal(clock.activePlayer, "X");
  assert.equal(scheduler.timers.size, 1);
});

test("rejects a third seat and unknown room codes", () => {
  const manager = makeManager();
  const room = manager.createRoom();
  manager.joinRoom(room.roomCode);

  assert.equal(manager.joinRoom(room.roomCode).error.code, "room-full");
  assert.equal(manager.joinRoom("MISSING").error.code, "room-not-found");
});

test("routes commands with the assigned side and sends per-player allow-listed views", async () => {
  const manager = makeManager();
  const room = manager.createRoom();
  manager.joinRoom(room.roomCode);
  const received = { X: [], O: [] };
  manager.attachConnection(room.roomCode, "X", (message) => received.X.push(message));
  manager.attachConnection(room.roomCode, "O", (message) => received.O.push(message));

  const result = await manager.submitCommand(room.roomCode, "X", {
    type: "choose-start", row: 2, col: 3
  });
  assert.equal(result.ok, true);
  assert.deepEqual(received.X.at(-1).state.startChoices.X, { row: 2, col: 3 });
  assert.equal(received.O.at(-1).state.startChoices.X, null);
  assert.equal("playerRoles" in received.X.at(-1).state, false);
  assert.equal("pendingExtraTurn" in received.X.at(-1).state, false);

  const wrongSide = await manager.submitCommand(room.roomCode, "X", {
    type: "choose-start", row: 8, col: 8
  });
  assert.equal(wrongSide.ok, false);
  assert.equal(wrongSide.error.code, "not-your-turn");
  assert.equal(result.version, 1);
  assert.equal(wrongSide.version, 1);
});

test("confirmed room snapshots synchronize the public wormhole pair to both players", async () => {
  const manager = makeManager();
  const room = manager.createRoom();
  manager.joinRoom(room.roomCode);
  const received = { X: [], O: [] };
  manager.attachConnection(room.roomCode, "X", (message) => received.X.push(message));
  manager.attachConnection(room.roomCode, "O", (message) => received.O.push(message));
  await startGame(manager, room.roomCode, received);
  const pair = { id: 7, endpoints: { orange: { row: 2, col: 2 }, blue: { row: 7, col: 7 } }, roundsRemaining: 4 };
  manager.rooms.get(room.roomCode).state.wormholePair = pair;

  const move = getLegalMoves(manager.rooms.get(room.roomCode).state)[0];
  const result = await manager.submitCommand(room.roomCode, "X", { type: "place", ...move });
  assert.equal(result.ok, true);
  const xState = received.X.filter(({ type }) => type === "state").at(-1).state;
  const oState = received.O.filter(({ type }) => type === "state").at(-1).state;
  assert.deepEqual(xState.wormholePair, pair);
  assert.deepEqual(oState.wormholePair, pair);
  assert.equal(received.X.filter(({ type }) => type === "state").at(-1).version,
    received.O.filter(({ type }) => type === "state").at(-1).version);
});

test("room broadcasts one server-resolved random artifact reward to both clients", async () => {
  const manager = makeManager({ random: () => 0 });
  const room = manager.createRoom();
  manager.joinRoom(room.roomCode);
  const received = { X: [], O: [] };
  manager.attachConnection(room.roomCode, "X", (message) => received.X.push(message));
  manager.attachConnection(room.roomCode, "O", (message) => received.O.push(message));
  await startGame(manager, room.roomCode, received);

  const internal = manager.rooms.get(room.roomCode);
  internal.state = {
    ...internal.state,
    eventItems: [{ id: 702, type: "randomArtifact", row: 0, col: 1 }]
  };
  const result = await manager.submitCommand(room.roomCode, "X", {
    type: "place", row: 0, col: 1
  });

  assert.equal(result.ok, true);
  assert.deepEqual(received.X.at(-1).state.inventory.X, [{ id: 702, type: "bomb" }]);
  assert.deepEqual(received.O.at(-1).state.inventory.X, [{ id: 702, type: "bomb" }]);
  assert.equal(received.X.at(-1).version, received.O.at(-1).version);
  assert.equal(internal.state.eventItems.length, 0);
});

test("serializes consecutive commands and publishes monotonically increasing versions", async () => {
  const manager = makeManager();
  const room = manager.createRoom();
  manager.joinRoom(room.roomCode);
  const received = { X: [], O: [] };
  manager.attachConnection(room.roomCode, "X", (message) => received.X.push(message));
  manager.attachConnection(room.roomCode, "O", (message) => received.O.push(message));
  await startGame(manager, room.roomCode, received);

  const results = await Promise.all([
    manager.submitCommand(room.roomCode, "X", { type: "place", row: 0, col: 1 }),
    manager.submitCommand(room.roomCode, "X", { type: "place", row: 0, col: 2 })
  ]);
  assert.deepEqual(results.map(({ version }) => version), [3, 4]);
  const xVersions = received.X.filter(({ type }) => type === "state").map(({ version }) => version);
  assert.deepEqual(xVersions, [1, 2, 3, 4]);
  assert.equal(manager.getSnapshot(room.roomCode, "X").state.board[0][2], "X");
  assert.equal(manager.getSnapshot(room.roomCode, "X").state.piecesLeft, 1);
});

test("authorized board edit updates both player snapshots without consuming a turn or changing clock ownership", async () => {
  const manager = makeManager();
  const room = manager.createRoom({ ...VALID_ROOM_SETTINGS, unlimitedTime: true });
  manager.joinRoom(room.roomCode);
  const received = { X: [], O: [] };
  manager.attachConnection(room.roomCode, "X", (message) => received.X.push(message));
  manager.attachConnection(room.roomCode, "O", (message) => received.O.push(message));
  await startGame(manager, room.roomCode, received);
  const before = manager.getSnapshot(room.roomCode, "X");

  const result = await manager.submitCommand(room.roomCode, "O", {
    type: "board-edit", object: { kind: "item", itemType: "bomb", row: 4, col: 4 }
  }, { isAdmin: true });
  assert.equal(result.ok, true);
  const xSnapshot = received.X.at(-1);
  const oSnapshot = received.O.at(-1);
  assert.equal(xSnapshot.version, before.version + 1);
  assert.equal(oSnapshot.version, xSnapshot.version);
  assert.deepEqual(xSnapshot.state.eventItems, oSnapshot.state.eventItems);
  assert.equal(xSnapshot.state.currentPlayer, before.state.currentPlayer);
  assert.equal(xSnapshot.state.piecesLeft, before.state.piecesLeft);
  assert.deepEqual(xSnapshot.clock, oSnapshot.clock);

  const cleared = await manager.submitCommand(room.roomCode, "O", {
    type: "board-edit", object: { kind: "clear", row: 4, col: 4 }
  }, { isAdmin: true });
  assert.equal(cleared.ok, true);
  const clearX = received.X.at(-1);
  const clearO = received.O.at(-1);
  assert.equal(clearX.version, xSnapshot.version + 1);
  assert.equal(clearX.version, clearO.version);
  assert.deepEqual(clearX.state.eventItems, []);
  assert.deepEqual(clearX.state.eventItems, clearO.state.eventItems);
  assert.equal(clearX.state.currentPlayer, before.state.currentPlayer);
  assert.equal(clearX.state.piecesLeft, before.state.piecesLeft);
  assert.deepEqual(clearX.clock, clearO.clock);
});

test("rejects a command that cannot be used in the current phase without mutating room state", async () => {
  const manager = makeManager();
  const room = manager.createRoom();
  manager.joinRoom(room.roomCode);
  manager.attachConnection(room.roomCode, "X", () => {});
  manager.attachConnection(room.roomCode, "O", () => {});
  const before = manager.getSnapshot(room.roomCode, "X");

  const result = await manager.submitCommand(room.roomCode, "X", { type: "place", row: 0, col: 0 });
  const after = manager.getSnapshot(room.roomCode, "X");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "wrong-phase");
  assert.equal(result.version, before.version);
  assert.deepEqual(after, before);
});

test("supports reconnection only with the seat token and within the grace period", () => {
  let now = 1_000;
  const manager = makeManager({ now: () => now, reconnectGraceMs: 500 });
  const created = manager.createRoom();
  const joined = manager.joinRoom(created.roomCode);
  const x = manager.attachConnection(created.roomCode, "X", () => {});
  manager.attachConnection(created.roomCode, "O", () => {});
  manager.detachConnection(created.roomCode, "X", x.connection);

  const resumed = manager.resumeRoom(created.roomCode, created.playerToken, () => {});
  assert.equal(resumed.ok, true);
  assert.equal(resumed.side, "X");
  assert.equal(manager.resumeRoom(created.roomCode, joined.playerToken, () => {}).error.code, "seat-already-connected");
  manager.detachConnection(created.roomCode, "X", resumed.connection);
  now += 500;
  assert.equal(manager.resumeRoom(created.roomCode, created.playerToken, () => {}).error.code, "reconnect-expired");
});

test("the room creator can reclaim X after disconnecting even after O joins, using only the private seat token", () => {
  let now = 1_000;
  const manager = makeManager({ now: () => now, reconnectGraceMs: 5_000 });
  const created = manager.createRoom();
  const x = manager.attachConnection(created.roomCode, "X", () => {});
  const invited = manager.joinRoom(created.roomCode);
  manager.attachConnection(created.roomCode, "O", () => {});
  manager.detachConnection(created.roomCode, "X", x.connection);
  now += 1_000;

  assert.equal(manager.joinRoom(created.roomCode).error.code, "room-full");
  const resumed = manager.resumeRoom(created.roomCode, created.playerToken, () => {});
  assert.equal(resumed.ok, true);
  assert.equal(resumed.side, "X");
  assert.equal(resumed.roomCode, invited.roomCode);
});

test("cleans up waiting rooms and disconnect-expired matches with a close notification", () => {
  let now = 0;
  const manager = makeManager({
    now: () => now,
    waitingRoomTtlMs: 100,
    reconnectGraceMs: 200
  });
  const waiting = manager.createRoom();
  now = 100;
  assert.deepEqual(manager.sweepExpiredRooms(), [{ roomCode: waiting.roomCode, reason: "waiting-room-expired" }]);
  assert.equal(manager.hasRoom(waiting.roomCode), false);

  now = 200;
  const active = manager.createRoom();
  manager.joinRoom(active.roomCode);
  const notices = [];
  const x = manager.attachConnection(active.roomCode, "X", (message) => notices.push(message));
  manager.attachConnection(active.roomCode, "O", (message) => notices.push(message));
  manager.detachConnection(active.roomCode, "X", x.connection);
  now = 400;
  assert.deepEqual(manager.sweepExpiredRooms(), [{ roomCode: active.roomCode, reason: "reconnect-expired" }]);
  assert.deepEqual(notices, [{ type: "room-closed", roomCode: active.roomCode, reason: "reconnect-expired" }]);
  assert.equal(manager.hasRoom(active.roomCode), false);
});

test("enforces room capacity on creation", () => {
  const manager = makeManager({ maxRooms: 1 });
  assert.equal(manager.createRoom().ok, true);
  assert.equal(manager.createRoom().error.code, "server-full");
});

test("server flag-falls the active player at the deadline exactly once", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received } = makeTimedManager(scheduler);
  await startGame(manager, room.roomCode, received);
  assert.equal(manager.getSnapshot(room.roomCode, "X").clock.activePlayer, "X");
  const staleTimer = [...scheduler.timers.values()][0].callback;

  await scheduler.advance(60_000);
  const afterTimeout = manager.getSnapshot(room.roomCode, "X");
  assert.equal(afterTimeout.state.phase, "finished");
  assert.equal(afterTimeout.state.winner, "O");
  assert.equal(afterTimeout.clock.remainingMs.X, 0);
  assert.equal(afterTimeout.clock.activePlayer, null);
  const version = afterTimeout.version;
  assert.equal(received.X.filter(({ state }) => state.phase === "finished").length, 1);

  await staleTimer();
  assert.equal(manager.getSnapshot(room.roomCode, "X").version, version);
  assert.equal(received.X.filter(({ state }) => state.phase === "finished").length, 1);
  assert.equal((await manager.proposeUndo(room.roomCode, "O")).error.code, "wrong-phase");
});

test("a timely move preserves elapsed time, adds the configured increment, and starts the opponent clock", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received } = makeTimedManager(scheduler);
  await startGame(manager, room.roomCode, received);
  const staleTimer = [...scheduler.timers.values()][0].callback;
  await scheduler.advance(5_000);

  const moved = await manager.submitCommand(room.roomCode, "X", { type: "place", row: 0, col: 1 });
  await staleTimer();
  const snapshot = manager.getSnapshot(room.roomCode, "O");
  assert.equal(moved.ok, true);
  assert.equal(snapshot.clock.remainingMs.X, 57_000);
  assert.equal(snapshot.clock.remainingMs.O, 60_000);
  assert.equal(snapshot.clock.activePlayer, "O");
  assert.equal([...scheduler.timers.values()][0].dueAt, scheduler.now() + snapshot.clock.remainingMs.O);
  assert.equal(snapshot.state.phase, "playing");
});

test("a collected extra turn receives its increment, then the clock passes to the opponent", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received, connectionX, connectionO } = makeTimedManager(scheduler);
  await startGame(manager, room.roomCode, received);
  const internalRoom = manager.rooms.get(room.roomCode);
  internalRoom.state = {
    ...internalRoom.state,
    eventItems: [{ id: 73, type: "extraTurn", row: 0, col: 1 }]
  };

  await scheduler.advance(3_000);
  const extraTurnMove = await manager.submitCommand(room.roomCode, "X", {
    type: "place", row: 0, col: 1
  });
  assert.equal(extraTurnMove.ok, true);
  let snapshot = manager.getSnapshot(room.roomCode, "X");
  assert.equal(snapshot.state.currentPlayer, "X");
  assert.equal(snapshot.state.piecesLeft, 1);
  assert.equal(snapshot.clock.activePlayer, "X");
  assert.equal(snapshot.clock.remainingMs.X, 59_000);

  await scheduler.advance(4_000);
  const regularMove = await manager.submitCommand(room.roomCode, "X", {
    type: "place", row: 0, col: 2
  });
  assert.equal(regularMove.ok, true);
  snapshot = manager.getSnapshot(room.roomCode, "O");
  assert.equal(snapshot.state.currentPlayer, "O");
  assert.equal(snapshot.clock.activePlayer, "O");
  assert.equal(snapshot.clock.remainingMs.X, 57_000);
});

test("online takeback restores the full pre-turn state, records the rollback and preserves fair clocks", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received } = makeTimedManager(scheduler);
  await startGame(manager, room.roomCode, received);
  const internal = manager.rooms.get(room.roomCode);
  const seatsBefore = { X: internal.seats.X, O: internal.seats.O };
  const beforeTurn = structuredClone(internal.state);
  const move = getLegalMoves(beforeTurn)[0];
  await scheduler.advance(3_000);
  const placed = await manager.submitCommand(room.roomCode, "X", { type: "place", ...move });
  assert.equal(placed.ok, true);
  const endedTurn = manager.getSnapshot(room.roomCode, "X");
  assert.equal(endedTurn.undoAvailable, true);
  assert.equal(endedTurn.clock.activePlayer, "O");
  const oldVersion = endedTurn.version;

  const offer = await manager.proposeUndo(room.roomCode, "X");
  assert.equal(offer.ok, true);
  assert.equal(manager.getSnapshot(room.roomCode, "X").clock.activePlayer, null);
  assert.equal(received.X.at(-1).type, "undo-proposal");
  assert.equal(received.O.at(-1).type, "undo-proposal");
  assert.equal(received.O.at(-1).fromSide, "X");

  const blockedState = structuredClone(internal.state);
  const blocked = await manager.submitCommand(room.roomCode, "O", { type: "resign" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "undo-pending");
  assert.deepEqual(internal.state, blockedState);
  assert.equal((await manager.voteUndo(room.roomCode, "X", offer.proposalId, true)).error.code, "cannot-vote-own-undo");

  await scheduler.advance(5_000);
  assert.equal(manager.getSnapshot(room.roomCode, "O").clock.remainingMs.O, 60_000);
  const accepted = await manager.voteUndo(room.roomCode, "O", offer.proposalId, true);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.version, oldVersion + 1);
  const xSnapshot = manager.getSnapshot(room.roomCode, "X");
  const oSnapshot = manager.getSnapshot(room.roomCode, "O");
  assert.deepEqual(internal.state, beforeTurn);
  assert.deepEqual(xSnapshot.state, oSnapshot.state);
  assert.equal(xSnapshot.state.currentPlayer, "X");
  assert.equal(xSnapshot.clock.activePlayer, "X");
  assert.equal(xSnapshot.clock.remainingMs.X, 57_000); // spent time remains spent; the undone turn's +2s increment is removed
  assert.equal(internal.seats.X, seatsBefore.X);
  assert.equal(internal.seats.O, seatsBefore.O);
  assert.equal(internal.history.at(-1).type, "undo");
  assert.equal(internal.history.at(-1).side, "X");
  assert.equal(internal.history.at(-1).position.board[move.row][move.col], ".");
  assert.equal(xSnapshot.undoAvailable, false);
  assert.equal(received.X.filter((message) => message.type === "state" && message.version === accepted.version).length, 1);
  assert.equal(received.O.filter((message) => message.type === "state" && message.version === accepted.version).length, 1);
  const restoredState = structuredClone(internal.state);
  assert.equal((await manager.voteUndo(room.roomCode, "O", offer.proposalId, true)).error.code, "undo-proposal-expired");
  assert.equal(internal.version, accepted.version);
  assert.deepEqual(internal.state, restoredState);
});

test("declined, duplicate and stale takeback votes cannot change the game and resume the opponent clock", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received } = makeTimedManager(scheduler);
  await startGame(manager, room.roomCode, received);
  const internal = manager.rooms.get(room.roomCode);
  const move = getLegalMoves(internal.state)[0];
  await manager.submitCommand(room.roomCode, "X", { type: "place", ...move });
  const beforeOffer = structuredClone(internal.state);
  const version = internal.version;
  const offer = await manager.proposeUndo(room.roomCode, "X");
  const declined = await manager.voteUndo(room.roomCode, "O", offer.proposalId, false);

  assert.equal(declined.ok, true);
  assert.equal(declined.accepted, false);
  assert.deepEqual(internal.state, beforeOffer);
  assert.equal(internal.version, version);
  assert.equal(manager.getSnapshot(room.roomCode, "O").clock.activePlayer, "O");
  assert.equal((await manager.voteUndo(room.roomCode, "O", offer.proposalId, true)).error.code, "undo-proposal-expired");
  assert.deepEqual(internal.state, beforeOffer);
});

test("undo proposal expiration and disconnect clear the lock and restart the server clock", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received, connectionO } = makeTimedManager(scheduler);
  manager.undoResponseTimeoutMs = 2_000;
  await startGame(manager, room.roomCode, received);
  const move = getLegalMoves(manager.getSnapshot(room.roomCode, "X").state)[0];
  await manager.submitCommand(room.roomCode, "X", { type: "place", ...move });
  const offer = await manager.proposeUndo(room.roomCode, "X");
  await scheduler.advance(2_000);
  assert.equal(manager.getSnapshot(room.roomCode, "O").undoProposal, null);
  assert.equal(manager.getSnapshot(room.roomCode, "O").clock.activePlayer, "O");
  assert.equal(received.X.some((message) => message.type === "undo-cancelled" && message.reason === "expired"), true);
  assert.equal((await manager.voteUndo(room.roomCode, "O", offer.proposalId, true)).error.code, "undo-proposal-expired");

  const secondOffer = await manager.proposeUndo(room.roomCode, "X");
  assert.equal(secondOffer.ok, true);
  manager.detachConnection(room.roomCode, "O", connectionO.connection);
  assert.equal(manager.getSnapshot(room.roomCode, "X").undoProposal, null);
  assert.equal(manager.getSnapshot(room.roomCode, "X").clock.activePlayer, "O");
});

test("a committed opponent action and a finished match make the old takeback unavailable", async () => {
  const { manager, room, received } = makeTimedManager(makeFakeScheduler(), { unlimitedTime: true });
  await startGame(manager, room.roomCode, received);
  const state = manager.getSnapshot(room.roomCode, "X").state;
  await manager.submitCommand(room.roomCode, "X", { type: "place", ...getLegalMoves(state)[0] });
  const opponentState = manager.getSnapshot(room.roomCode, "O").state;
  await manager.submitCommand(room.roomCode, "O", { type: "place", ...getLegalMoves(opponentState)[0] });
  assert.equal(manager.getSnapshot(room.roomCode, "X").undoAvailable, false);
  assert.equal((await manager.proposeUndo(room.roomCode, "X")).error.code, "undo-unavailable");
  await manager.submitCommand(room.roomCode, "X", { type: "resign" });
  assert.equal((await manager.proposeUndo(room.roomCode, "O")).error.code, "wrong-phase");
});

test("unlimited-time games never schedule or apply a timeout", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received } = makeTimedManager(scheduler, { unlimitedTime: true });
  await startGame(manager, room.roomCode, received);
  assert.equal(scheduler.timers.size, 0);
  await scheduler.advance(10 * 60_000);
  const snapshot = manager.getSnapshot(room.roomCode, "X");
  assert.equal(snapshot.state.phase, "playing");
  assert.equal(snapshot.clock.enabled, false);
  assert.deepEqual(snapshot.clock.remainingMs, { X: null, O: null });
});

test("a reconnecting player receives the current server clock", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received, connectionX } = makeTimedManager(scheduler);
  await startGame(manager, room.roomCode, received);
  manager.detachConnection(room.roomCode, "X", connectionX.connection);
  await scheduler.advance(4_000);

  const resumed = manager.resumeRoom(room.roomCode, room.playerToken, () => {});
  assert.equal(resumed.ok, true);
  assert.equal(resumed.clock.activePlayer, "X");
  assert.equal(resumed.clock.remainingMs.X, 56_000);
  assert.equal(resumed.clock.remainingMs.O, 60_000);
});

test("room cleanup cancels the active timer", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received, connectionX } = makeTimedManager(scheduler);
  manager.reconnectGraceMs = 1_000;
  await startGame(manager, room.roomCode, received);
  assert.equal(scheduler.timers.size, 1);
  manager.detachConnection(room.roomCode, "X", connectionX.connection);
  await scheduler.advance(manager.reconnectGraceMs);
  assert.equal(manager.sweepExpiredRooms().length, 1);
  assert.equal(scheduler.timers.size, 0);
  assert.equal(manager.hasRoom(room.roomCode), false);
});

test("server shutdown invalidates every pending room timer", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received } = makeTimedManager(scheduler);
  await startGame(manager, room.roomCode, received);
  assert.equal(scheduler.timers.size, 1);
  manager.stopAllClocks();
  assert.equal(scheduler.timers.size, 0);
  await scheduler.advance(60_000);
  assert.equal(manager.getSnapshot(room.roomCode, "X").state.phase, "playing");
});

test("resignation stops the running clock and prevents a later timeout", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received } = makeTimedManager(scheduler);
  await startGame(manager, room.roomCode, received);
  const resigned = await manager.submitCommand(room.roomCode, "X", { type: "resign" });
  assert.equal(resigned.ok, true);
  assert.equal(scheduler.timers.size, 0);
  const version = manager.getSnapshot(room.roomCode, "X").version;
  await scheduler.advance(60_000);
  const snapshot = manager.getSnapshot(room.roomCode, "X");
  assert.equal(snapshot.state.finishReason.key, "message.resigned");
  assert.equal(snapshot.version, version);
});

test("confirmed attacks broadcast a unique visual event to both players, but rejected attacks do not", async () => {
  let eventNumber = 0;
  const manager = makeManager({ eventIdFactory: () => `visual-${++eventNumber}` });
  const room = manager.createRoom();
  manager.joinRoom(room.roomCode);
  const messages = { X: [], O: [] };
  manager.attachConnection(room.roomCode, "X", (message) => messages.X.push(message));
  manager.attachConnection(room.roomCode, "O", (message) => messages.O.push(message));
  await startGame(manager, room.roomCode, messages);
  const internal = manager.rooms.get(room.roomCode);
  internal.state = {
    ...internal.state,
    inventory: { X: [{ id: 501, type: "bomb" }], O: [] },
    selectedAbility: null
  };
  const selection = await manager.submitCommand(room.roomCode, "X", { type: "select-ability", itemId: 501 });
  assert.equal(selection.ok, true);
  assert.equal((await manager.submitCommand(room.roomCode, "X", {
    type: "ability-target", itemId: 501, row: 20, col: 20
  })).ok, false);
  assert.equal(messages.X.filter(({ type }) => type === "visual-event").length, 0);

  const applied = await manager.submitCommand(room.roomCode, "X", {
    type: "ability-target", itemId: 501, row: 2, col: 2
  });
  assert.equal(applied.ok, true);
  const xEvent = messages.X.find(({ type }) => type === "visual-event");
  const oEvent = messages.O.find(({ type }) => type === "visual-event");
  assert.deepEqual(xEvent, oEvent);
  assert.deepEqual({ ...xEvent, eventId: undefined, roomCode: undefined }, {
    type: "visual-event", eventId: undefined, roomCode: undefined,
    abilityType: "bomb", row: 2, col: 2
  });
  assert.equal(xEvent.eventId, "visual-1");
});

test("a confirmed exchange synchronizes both inventories and broadcasts one shared visual event", async () => {
  let eventNumber = 0;
  const manager = makeManager({ eventIdFactory: () => `exchange-${++eventNumber}` });
  const created = manager.createRoom();
  manager.joinRoom(created.roomCode);
  const received = { X: [], O: [] };
  manager.attachConnection(created.roomCode, "X", (message) => received.X.push(message));
  manager.attachConnection(created.roomCode, "O", (message) => received.O.push(message));
  await startGame(manager, created.roomCode, received);
  const room = manager.rooms.get(created.roomCode);
  room.state = {
    ...room.state,
    inventory: {
      X: [{ id: "online-exchange", type: "exchange" }, { id: "x-bomb", type: "bomb" }],
      O: [{ id: "o-shield", type: "shield" }]
    }
  };

  const result = await manager.submitCommand(created.roomCode, "X", {
    type: "select-ability", itemId: "online-exchange"
  });
  assert.equal(result.ok, true);
  const xSnapshot = received.X.filter(({ type }) => type === "state").at(-1);
  const oSnapshot = received.O.filter(({ type }) => type === "state").at(-1);
  assert.deepEqual(xSnapshot.state.inventory, {
    X: [{ id: "o-shield", type: "shield" }], O: [{ id: "x-bomb", type: "bomb" }]
  });
  assert.deepEqual(oSnapshot.state.inventory, xSnapshot.state.inventory);

  const xEvent = received.X.find(({ type, abilityType }) => type === "visual-event" && abilityType === "exchange");
  const oEvent = received.O.find(({ type, abilityType }) => type === "visual-event" && abilityType === "exchange");
  assert.deepEqual(xEvent, oEvent);
  assert.equal(xEvent.eventId, "exchange-1");
  assert.equal(xEvent.row, undefined);
  assert.equal(xEvent.col, undefined);

  const invalid = await manager.submitCommand(created.roomCode, "X", {
    type: "select-ability", itemId: "online-exchange"
  });
  assert.equal(invalid.ok, false);
  assert.equal(received.X.filter(({ type, abilityType }) => type === "visual-event" && abilityType === "exchange").length, 1);
});

test("aim updates use core target validation, do not change game state, and clear on actions or disconnect", async () => {
  const manager = makeManager();
  const created = manager.createRoom();
  manager.joinRoom(created.roomCode);
  const received = { X: [], O: [] };
  const x = manager.attachConnection(created.roomCode, "X", (message) => received.X.push(message));
  manager.attachConnection(created.roomCode, "O", (message) => received.O.push(message));
  await startGame(manager, created.roomCode, received);
  const internal = manager.rooms.get(created.roomCode);
  internal.state = {
    ...internal.state,
    inventory: { X: [{ id: "bomb-aim", type: "bomb" }], O: [] },
    selectedAbility: null
  };
  assert.equal(manager.updateAim(created.roomCode, "X", { row: 2, col: 2 }).error.code, "ability-not-selected");
  assert.equal((await manager.submitCommand(created.roomCode, "X", {
    type: "select-ability", itemId: "bomb-aim"
  })).ok, true);
  const before = manager.getSnapshot(created.roomCode, "X");
  assert.equal(manager.updateAim(created.roomCode, "X", { row: 2, col: 2 }).ok, true);
  assert.equal(received.O.at(-1).type, "aim");
  assert.deepEqual(received.O.at(-1).target, { row: 2, col: 2, abilityType: "bomb" });
  assert.deepEqual(manager.getSnapshot(created.roomCode, "X"), before);
  assert.equal(manager.updateAim(created.roomCode, "X", { row: 9, col: 9 }).error.code, "invalid-target");

  assert.equal((await manager.submitCommand(created.roomCode, "X", {
    type: "ability-target", itemId: "bomb-aim", row: 2, col: 2
  })).ok, true);
  assert.equal(received.O.filter(({ type }) => type === "aim").at(-1).target, null);
  internal.state = {
    ...internal.state,
    inventory: { X: [{ id: "bomb-aim-2", type: "bomb" }], O: [] },
    selectedAbility: null
  };
  assert.equal((await manager.submitCommand(created.roomCode, "X", {
    type: "select-ability", itemId: "bomb-aim-2"
  })).ok, true);
  assert.equal(manager.updateAim(created.roomCode, "X", { row: 2, col: 2 }).ok, true);
  manager.detachConnection(created.roomCode, "X", x.connection);
  assert.equal(received.O.filter(({ type }) => type === "aim").at(-1).target, null);
});

test("settings restart requires both connected players and resets the whole authoritative match", async () => {
  const sideChoices = [0.25, 0.75];
  const manager = makeManager({ sideRandom: () => sideChoices.shift() ?? 0.25 });
  const created = manager.createRoom({ ...VALID_ROOM_SETTINGS, piecesPerTurn: 1, freeStartingPositions: false });
  manager.joinRoom(created.roomCode);
  const messages = { X: [], O: [] };
  const x = manager.attachConnection(created.roomCode, "X", (message) => messages.X.push(message)).connection;
  manager.attachConnection(created.roomCode, "O", (message) => messages.O.push(message));
  const { row, col } = getLegalMoves(manager.getSnapshot(created.roomCode, "X").state)[0];
  const placed = await manager.submitCommand(created.roomCode, "X", { type: "place", row, col });
  assert.equal(placed.ok, true);
  const oldState = manager.getSnapshot(created.roomCode, "X").state;
  const proposal = await manager.proposeRestart(created.roomCode, "X", "settings", {
    ...VALID_ROOM_SETTINGS, width: 12, height: 10, piecesPerTurn: 2,
    freeStartingPositions: false, disabledItems: ["bomb"],
    unlimitedTime: false, clockMinutes: 2, incrementSeconds: 1
  });
  assert.equal(proposal.ok, true);
  assert.equal(messages.O.at(-1).type, "restart-proposal");
  assert.equal(messages.O.at(-1).settings.width, 12);
  assert.equal(manager.getSnapshot(created.roomCode, "X").state.board.length, 10);

  const accepted = await manager.voteRestart(created.roomCode, "O", proposal.proposalId, true);
  assert.equal(accepted.ok, true);
  const next = manager.getSnapshot(created.roomCode, x.side).state;
  const internalNext = manager.rooms.get(created.roomCode).state;
  assert.equal(next.board.length, 10);
  assert.equal(next.board[0].length, 12);
  assert.deepEqual(next.settings.disabledItems, ["bomb"]);
  assert.equal(next.piecesLeft, 2);
  assert.equal(next.winner, null);
  assert.deepEqual(next.inventory, { X: [], O: [] });
  assert.deepEqual(next.protections, []);
  assert.deepEqual(next.eventItems, []);
  assert.deepEqual(next.lastDestroyed, []);
  assert.equal(next.selectedAbility, null);
  assert.deepEqual(next.abilityTargets, []);
  assert.deepEqual(internalNext.pendingExtraTurns, { X: [], O: [] });
  assert.notEqual(next, oldState);
  assert.notEqual(x.side, "X", "the seat is reassigned for the restarted game");
  const resetSnapshot = messages.X.findLast((message) => message.type === "state");
  assert.equal(resetSnapshot.restartKind, "settings");
  assert.equal(resetSnapshot.state.board[0].length, 12);
  assert.ok(resetSnapshot.clock.remainingMs.X <= 120_000 && resetSnapshot.clock.remainingMs.X > 119_000);
  assert.equal(resetSnapshot.clock.remainingMs.O, 120_000);
  assert.equal(resetSnapshot.clock.activePlayer, resetSnapshot.state.currentPlayer);
  manager.stopAllClocks();
});

test("declining a settings restart leaves the current authoritative state untouched", async () => {
  const manager = makeManager();
  const created = manager.createRoom();
  manager.joinRoom(created.roomCode);
  const messages = { X: [], O: [] };
  manager.attachConnection(created.roomCode, "X", (message) => messages.X.push(message));
  manager.attachConnection(created.roomCode, "O", (message) => messages.O.push(message));
  const before = manager.rooms.get(created.roomCode).state;
  const proposal = await manager.proposeRestart(created.roomCode, "X", "settings", {
    ...VALID_ROOM_SETTINGS, width: 12
  });
  assert.equal(proposal.ok, true);
  const refused = await manager.voteRestart(created.roomCode, "O", proposal.proposalId, false);
  assert.deepEqual(refused, { ok: true, accepted: false });
  assert.equal(manager.rooms.get(created.roomCode).state, before);
  assert.equal(manager.rooms.get(created.roomCode).restartProposal, null);
  assert.equal(messages.X.at(-1).type, "restart-cancelled");
  assert.equal(messages.X.at(-1).reason, "declined");
});

test("mutual rematch starts a fresh game with saved room settings and renewed sides", async () => {
  const sideChoices = [0.25, 0.75];
  const manager = makeManager({ sideRandom: () => sideChoices.shift() ?? 0.25 });
  const created = manager.createRoom({ ...VALID_ROOM_SETTINGS, piecesPerTurn: 1, freeStartingPositions: false, disabledItems: ["pointDestroy"] });
  manager.joinRoom(created.roomCode);
  const messages = { X: [], O: [] };
  const x = manager.attachConnection(created.roomCode, "X", (message) => messages.X.push(message)).connection;
  manager.attachConnection(created.roomCode, "O", (message) => messages.O.push(message));
  const finished = await manager.submitCommand(created.roomCode, "X", { type: "resign" });
  assert.equal(finished.ok, true);
  const oldState = manager.rooms.get(created.roomCode).state;
  const offer = await manager.proposeRestart(created.roomCode, "X", "rematch");
  assert.equal(offer.ok, true);
  assert.equal(messages.O.at(-1).kind, "rematch");
  const accepted = await manager.voteRestart(created.roomCode, "O", offer.proposalId, true);
  assert.equal(accepted.ok, true);
  const room = manager.rooms.get(created.roomCode);
  assert.equal(room.state.phase, "playing");
  assert.equal(room.state.winner, null);
  assert.notEqual(room.state, oldState);
  assert.deepEqual(room.state.settings.disabledItems, ["pointDestroy"]);
  assert.deepEqual(room.state.inventory, { X: [], O: [] });
  assert.equal(x.side, "O");
  assert.equal(messages.X.findLast((message) => message.type === "state").restartKind, "rematch");
  assert.equal(room.clock.remainingMs.X, null);
});

test("declining a rematch keeps the finished result and cannot be accepted by its proposer", async () => {
  const manager = makeManager();
  const created = manager.createRoom({ ...VALID_ROOM_SETTINGS, piecesPerTurn: 1, freeStartingPositions: false });
  manager.joinRoom(created.roomCode);
  const received = { X: [], O: [] };
  manager.attachConnection(created.roomCode, "X", (message) => received.X.push(message));
  manager.attachConnection(created.roomCode, "O", (message) => received.O.push(message));
  await manager.submitCommand(created.roomCode, "X", { type: "resign" });
  const finishedState = manager.rooms.get(created.roomCode).state;
  const offer = await manager.proposeRestart(created.roomCode, "X", "rematch");
  const ownVote = await manager.voteRestart(created.roomCode, "X", offer.proposalId, true);
  assert.equal(ownVote.error.code, "cannot-vote-own-proposal");
  const declined = await manager.voteRestart(created.roomCode, "O", offer.proposalId, false);
  assert.equal(declined.accepted, false);
  assert.equal(manager.rooms.get(created.roomCode).state, finishedState);
  assert.equal(manager.rooms.get(created.roomCode).state.phase, "finished");
  assert.equal(received.X.at(-1).reason, "declined");
});

test("restarting a timed room invalidates the previous match deadline", async () => {
  const scheduler = makeFakeScheduler();
  const { manager, room, received } = makeTimedManager(scheduler);
  await startGame(manager, room.roomCode, received);
  const oldTimer = [...scheduler.timers.values()][0];
  assert.ok(oldTimer);
  const proposal = await manager.proposeRestart(room.roomCode, "X", "settings", {
    ...manager.getSnapshot(room.roomCode, "X").state.settings,
    freeStartingPositions: false,
    clockMinutes: 2
  });
  assert.equal(proposal.ok, true);
  const accepted = await manager.voteRestart(room.roomCode, "O", proposal.proposalId, true);
  assert.equal(accepted.ok, true);
  const reset = manager.rooms.get(room.roomCode).state;
  assert.equal(reset.phase, "playing");
  assert.equal(manager.rooms.get(room.roomCode).clock.remainingMs.X, 120_000);

  await oldTimer.callback();
  assert.equal(manager.rooms.get(room.roomCode).state, reset);
  assert.equal(manager.rooms.get(room.roomCode).state.phase, "playing");
  assert.equal(manager.rooms.get(room.roomCode).clock.remainingMs.X, 120_000);
  manager.stopAllClocks();
});

test("disconnect cancels pending restart and clients cannot reset the game with a game command", async () => {
  const manager = makeManager();
  const created = manager.createRoom();
  manager.joinRoom(created.roomCode);
  const received = [];
  const x = manager.attachConnection(created.roomCode, "X", () => {}).connection;
  manager.attachConnection(created.roomCode, "O", (message) => received.push(message));
  const before = manager.rooms.get(created.roomCode).state;
  const proposal = await manager.proposeRestart(created.roomCode, "X", "settings", VALID_ROOM_SETTINGS);
  const forged = await manager.submitCommand(created.roomCode, "X", { type: "restart" });
  assert.equal(forged.ok, false);
  assert.equal(manager.rooms.get(created.roomCode).state, before);
  manager.detachConnection(created.roomCode, "X", x);
  assert.equal(manager.rooms.get(created.roomCode).restartProposal, null);
  assert.equal(received.at(-1).type, "restart-cancelled");
  assert.equal(received.at(-1).proposalId, proposal.proposalId);
});
