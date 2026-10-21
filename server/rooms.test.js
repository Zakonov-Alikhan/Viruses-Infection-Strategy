import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../ui/game.js";
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
  assert.equal(manager.roomCount, 1);
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
    assert.equal(resumed.state.settings.disabledItems.length, 0);
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
    animationsEnabled: false,
    freeStartingPositions: false,
    disabledItems: ["bomb", "shield"]
  };
  const created = manager.createRoom(customSettings);
  assert.equal(created.ok, true);
  assert.equal(created.state.phase, "playing");
  assert.deepEqual(created.state.settings, customSettings);
  assert.deepEqual(created.clock.remainingMs, { X: 7 * 60_000, O: 7 * 60_000 });
  assert.equal(created.clock.enabled, true);

  const joined = manager.joinRoom(created.roomCode);
  assert.deepEqual(joined.state.settings, customSettings);
  assert.deepEqual(joined.clock.remainingMs, { X: 7 * 60_000, O: 7 * 60_000 });

  const roomCount = manager.roomCount;
  const invalidPieces = manager.createRoom({ ...customSettings, piecesPerTurn: 13 });
  const unknownSetting = manager.createRoom({ ...customSettings, adminMode: true });
  const unknownItem = manager.createRoom({ ...customSettings, disabledItems: ["not-an-item"] });
  assert.deepEqual(invalidPieces.error, { code: "invalid-settings" });
  assert.deepEqual(unknownSetting.error, { code: "invalid-settings" });
  assert.deepEqual(unknownItem.error, { code: "invalid-settings" });
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
