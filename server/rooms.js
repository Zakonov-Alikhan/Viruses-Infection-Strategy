import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DEFAULT_SETTINGS, MAX_BOARD_DIMENSION, MIN_BOARD_DIMENSION, createGameState } from "../ui/game.js";
import { getPlayerView, processGameCommand } from "./game-service.js";

const SIDES = ["X", "O"];
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeRoomCode() {
  const bytes = randomBytes(8);
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function makePlayerToken() {
  return randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest();
}

function failure(code) {
  return { ok: false, error: { code } };
}

function normalizeCode(code) {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

const ROOM_SETTING_FIELDS = new Set([
  "width", "height", "piecesPerTurn", "clockMinutes", "incrementSeconds",
  "unlimitedTime", "randomEvents", "animationsEnabled", "freeStartingPositions"
]);

function normalizeRoomSettings(input, defaults) {
  if (input === undefined) input = {};
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !ROOM_SETTING_FIELDS.has(key))) return null;
  const settings = { ...defaults, ...input, adminMode: false };
  if (settings.unlimitedTime) {
    if (!Number.isInteger(settings.clockMinutes) || settings.clockMinutes < 1 || settings.clockMinutes > 60) {
      settings.clockMinutes = DEFAULT_SETTINGS.clockMinutes;
    }
    if (!Number.isInteger(settings.incrementSeconds) || settings.incrementSeconds < 0 || settings.incrementSeconds > 60) {
      settings.incrementSeconds = DEFAULT_SETTINGS.incrementSeconds;
    }
  }
  const dimensionsValid = [settings.width, settings.height].every((value) =>
    Number.isInteger(value) && value >= MIN_BOARD_DIMENSION && value <= MAX_BOARD_DIMENSION);
  if (!dimensionsValid
    || !Number.isInteger(settings.piecesPerTurn) || settings.piecesPerTurn < 1
    || settings.piecesPerTurn > Math.floor(settings.width * settings.height / 10)
    || !Number.isInteger(settings.clockMinutes) || settings.clockMinutes < 1 || settings.clockMinutes > 60
    || !Number.isInteger(settings.incrementSeconds) || settings.incrementSeconds < 0 || settings.incrementSeconds > 60
    || !["unlimitedTime", "randomEvents", "animationsEnabled", "freeStartingPositions"]
      .every((key) => typeof settings[key] === "boolean")) return null;
  return settings;
}

export class RoomManager {
  constructor({
    settings = DEFAULT_SETTINGS,
    maxRooms = 200,
    waitingRoomTtlMs = 5 * 60_000,
    reconnectGraceMs = 2 * 60_000,
    finishedRoomTtlMs = 60_000,
    now = Date.now,
    roomCodeFactory = makeRoomCode,
    playerTokenFactory = makePlayerToken,
    random = Math.random,
    scheduleTimeout = setTimeout,
    cancelTimeout = clearTimeout
  } = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings, adminMode: false };
    this.maxRooms = maxRooms;
    this.waitingRoomTtlMs = waitingRoomTtlMs;
    this.reconnectGraceMs = reconnectGraceMs;
    this.finishedRoomTtlMs = finishedRoomTtlMs;
    this.now = now;
    this.roomCodeFactory = roomCodeFactory;
    this.playerTokenFactory = playerTokenFactory;
    this.random = random;
    this.scheduleTimeout = scheduleTimeout;
    this.cancelTimeout = cancelTimeout;
    this.rooms = new Map();
  }

  createRoom(requestedSettings) {
    if (this.rooms.size >= this.maxRooms) return failure("server-full");
    const roomSettings = normalizeRoomSettings(requestedSettings, this.settings);
    if (!roomSettings) return failure("invalid-settings");
    let code;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = normalizeCode(this.roomCodeFactory());
      if (candidate && !this.rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) return failure("room-code-unavailable");

    const createdAt = this.now();
    const token = this.playerTokenFactory();
    const room = {
      code,
      state: createGameState(roomSettings, this.random),
      version: 0,
      status: "waiting",
      createdAt,
      lastActivityAt: createdAt,
      clock: {
        enabled: !roomSettings.unlimitedTime,
        remainingMs: {
          X: roomSettings.unlimitedTime ? null : roomSettings.clockMinutes * 60_000,
          O: roomSettings.unlimitedTime ? null : roomSettings.clockMinutes * 60_000
        },
        activePlayer: null,
        deadlineAt: null,
        timer: null,
        generation: 0
      },
      seats: {
        X: this.#newSeat(token, createdAt),
        O: null
      },
      queue: Promise.resolve()
    };
    this.rooms.set(code, room);
    return {
      ok: true,
      roomCode: code,
      side: "X",
      playerToken: token,
      status: room.status,
      version: room.version,
      state: getPlayerView(room.state, "X"),
      clock: this.#clockSnapshot(room)
    };
  }

  joinRoom(rawCode) {
    const code = normalizeCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) return failure("room-not-found");
    if (room.status !== "waiting" || room.seats.O) return failure("room-full");

    const token = this.playerTokenFactory();
    const joinedAt = this.now();
    room.seats.O = this.#newSeat(token, joinedAt);
    room.status = "active";
    room.lastActivityAt = joinedAt;
    return {
      ok: true,
      roomCode: code,
      side: "O",
      playerToken: token,
      status: room.status,
      version: room.version,
      state: getPlayerView(room.state, "O"),
      clock: this.#clockSnapshot(room)
    };
  }

  attachConnection(rawCode, side, send) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return failure("room-not-found");
    const seat = room.seats[side];
    if (!seat) return failure("seat-not-found");
    if (seat.connection) return failure("seat-already-connected");
    if (typeof send !== "function") return failure("invalid-connection");

    const connection = { send, lastSentVersion: -1 };
    seat.connection = connection;
    seat.disconnectedAt = null;
    room.lastActivityAt = this.now();
    return { ok: true, connection };
  }

  resumeRoom(rawCode, playerToken, send) {
    const code = normalizeCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) return failure("room-not-found");
    if (typeof playerToken !== "string" || playerToken.length < 32 || playerToken.length > 128) {
      return failure("invalid-resume-token");
    }
    const suppliedHash = hashToken(playerToken);
    const side = SIDES.find((candidate) => {
      const expectedHash = room.seats[candidate]?.tokenHash;
      return expectedHash && timingSafeEqual(suppliedHash, expectedHash);
    });
    if (!side) return failure("invalid-resume-token");

    const seat = room.seats[side];
    if (seat.connection) return failure("seat-already-connected");
    if (seat.disconnectedAt === null) return failure("seat-not-disconnected");
    if (this.now() - seat.disconnectedAt >= this.reconnectGraceMs) return failure("reconnect-expired");
    const attached = this.attachConnection(code, side, send);
    if (!attached.ok) return attached;
    return {
      ok: true,
      roomCode: code,
      side,
      status: room.status,
      version: room.version,
      state: getPlayerView(room.state, side),
      clock: this.#clockSnapshot(room),
      connection: attached.connection
    };
  }

  detachConnection(rawCode, side, connection) {
    const room = this.rooms.get(normalizeCode(rawCode));
    const seat = room?.seats[side];
    if (!seat?.connection || (connection && seat.connection !== connection)) return false;
    seat.connection = null;
    seat.disconnectedAt = this.now();
    room.lastActivityAt = seat.disconnectedAt;
    return true;
  }

  getSnapshot(rawCode, side) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return failure("room-not-found");
    if (!room.seats[side]) return failure("seat-not-found");
    return {
      ok: true,
      roomCode: room.code,
      side,
      status: room.status,
      version: room.version,
      state: getPlayerView(room.state, side),
      clock: this.#clockSnapshot(room)
    };
  }

  broadcastReady(rawCode) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room || room.status !== "active") return false;
    this.#broadcastSnapshots(room, "room-ready");
    return true;
  }

  submitCommand(rawCode, side, command) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return Promise.resolve(failure("room-not-found"));
    if (!room.seats[side]) return Promise.resolve(failure("seat-not-found"));
    if (room.status !== "active") return Promise.resolve(failure("room-not-ready"));

    const operation = room.queue.then(() => {
      if (this.rooms.get(room.code) !== room) return failure("room-not-found");
      if (room.status !== "active") return failure("room-not-ready");
      if (!room.seats[side]?.connection) return failure("player-disconnected");

      const now = this.now();
      if (this.#expireClockIfDue(room, now)) {
        return { ...failure(room.state, "time-expired"), version: room.version };
      }

      const result = processGameCommand(room.state, side, command, { random: this.random });
      if (!result.ok) return { ...result, version: room.version };

      const previousState = room.state;
      room.state = result.state;
      this.#updateClockAfterCommand(room, previousState, room.state, now);
      room.version += 1;
      room.lastActivityAt = this.now();
      this.#broadcastSnapshots(room, "state");
      return { ok: true, version: room.version };
    });
    room.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  sweepExpiredRooms() {
    const now = this.now();
    const removed = [];
    for (const [code, room] of this.rooms) {
      let reason = null;
      if (room.status === "waiting" && now - room.createdAt >= this.waitingRoomTtlMs) {
        reason = "waiting-room-expired";
      } else if (room.state.phase === "finished" && now - room.lastActivityAt >= this.finishedRoomTtlMs) {
        reason = "finished-room-expired";
      } else if (room.status === "active") {
        const expiredSeat = SIDES.some((side) => {
          const seat = room.seats[side];
          return seat?.disconnectedAt !== null
            && seat?.disconnectedAt !== undefined
            && now - seat.disconnectedAt >= this.reconnectGraceMs;
        });
        if (expiredSeat) reason = "reconnect-expired";
      }
      if (!reason) continue;
      this.#stopClock(room);

      for (const side of SIDES) {
        const connection = room.seats[side]?.connection;
        if (!connection) continue;
        try {
          connection.send({ type: "room-closed", roomCode: code, reason });
        } catch { /* A disconnected peer cannot prevent room cleanup. */ }
      }
      this.rooms.delete(code);
      removed.push({ roomCode: code, reason });
    }
    return removed;
  }

  stopAllClocks() {
    for (const room of this.rooms.values()) this.#stopClock(room);
  }

  hasRoom(rawCode) {
    return this.rooms.has(normalizeCode(rawCode));
  }

  get roomCount() {
    return this.rooms.size;
  }

  #newSeat(token, disconnectedAt) {
    return { tokenHash: hashToken(token), connection: null, disconnectedAt };
  }

  #broadcastSnapshots(room, type) {
    for (const side of SIDES) {
      const connection = room.seats[side]?.connection;
      if (!connection || (type !== "room-ready" && room.version <= connection.lastSentVersion)) continue;
      const envelope = {
        type,
        roomCode: room.code,
        version: room.version,
        state: getPlayerView(room.state, side),
        clock: this.#clockSnapshot(room)
      };
      try {
        connection.send(envelope);
        connection.lastSentVersion = room.version;
      } catch {
        this.detachConnection(room.code, side, connection);
      }
    }
  }

  #clockSnapshot(room) {
    const now = this.now();
    const remainingMs = { ...room.clock.remainingMs };
    if (room.clock.activePlayer && room.clock.deadlineAt !== null) {
      remainingMs[room.clock.activePlayer] = Math.max(0, room.clock.deadlineAt - now);
    }
    return {
      enabled: room.clock.enabled,
      remainingMs,
      activePlayer: room.clock.activePlayer
    };
  }

  #stopClock(room) {
    const clock = room.clock;
    clock.generation += 1;
    if (clock.timer !== null) this.cancelTimeout(clock.timer);
    clock.timer = null;
    clock.activePlayer = null;
    clock.deadlineAt = null;
  }

  #startClock(room, player, now) {
    const clock = room.clock;
    if (!clock.enabled || room.state.phase !== "playing") {
      this.#stopClock(room);
      return;
    }
    if (clock.timer !== null) this.cancelTimeout(clock.timer);
    clock.generation += 1;
    clock.activePlayer = player;
    clock.deadlineAt = now + Math.max(0, clock.remainingMs[player]);
    this.#scheduleClockTimeout(room, clock.generation);
  }

  #scheduleClockTimeout(room, generation) {
    const delay = Math.max(0, room.clock.deadlineAt - this.now());
    room.clock.timer = this.scheduleTimeout(() => {
      const operation = room.queue.then(() => {
        if (this.rooms.get(room.code) !== room || room.clock.generation !== generation) return;
        room.clock.timer = null;
        const now = this.now();
        if (!this.#expireClockIfDue(room, now, generation)
          && room.clock.generation === generation && room.clock.deadlineAt !== null) {
          this.#scheduleClockTimeout(room, generation);
        }
      });
      room.queue = operation.then(() => undefined, () => undefined);
      return operation;
    }, delay);
    room.clock.timer?.unref?.();
  }

  #expireClockIfDue(room, now, expectedGeneration = room.clock.generation) {
    const clock = room.clock;
    if (!clock.enabled || !clock.activePlayer || clock.deadlineAt === null
      || clock.generation !== expectedGeneration || now < clock.deadlineAt
      || room.state.phase !== "playing") return false;

    const timedOutPlayer = clock.activePlayer;
    clock.remainingMs[timedOutPlayer] = 0;
    const result = processGameCommand(room.state, timedOutPlayer, { type: "timeout" }, {
      authority: "server",
      random: this.random
    });
    if (!result.ok) {
      this.#stopClock(room);
      return false;
    }
    room.state = result.state;
    this.#stopClock(room);
    room.version += 1;
    room.lastActivityAt = now;
    this.#broadcastSnapshots(room, "state");
    return true;
  }

  #updateClockAfterCommand(room, previousState, nextState, now) {
    const clock = room.clock;
    if (!clock.enabled) return;

    if (previousState.phase !== "playing" && nextState.phase === "playing") {
      this.#startClock(room, nextState.currentPlayer, now);
      return;
    }
    if (previousState.phase !== "playing") return;

    const activePlayer = clock.activePlayer;
    if (activePlayer && clock.deadlineAt !== null) {
      clock.remainingMs[activePlayer] = Math.max(0, clock.deadlineAt - now);
    }
    const completedTurn = previousState.piecesLeft === 1
      && (nextState.currentPlayer !== previousState.currentPlayer
        || (nextState.phase === "playing"
          && nextState.currentPlayer === previousState.currentPlayer
          && nextState.piecesLeft === nextState.settings.piecesPerTurn
          && Array.isArray(nextState.message)
          && nextState.message.some((entry) => entry?.key === "message.extraTurn"))
        || (nextState.phase === "finished" && nextState.piecesLeft === 0));
    if (completedTurn) {
      clock.remainingMs[previousState.currentPlayer] += room.state.settings.incrementSeconds * 1000;
    }

    if (nextState.phase !== "playing") {
      this.#stopClock(room);
      return;
    }
    if (nextState.currentPlayer !== activePlayer) {
      this.#startClock(room, nextState.currentPlayer, now);
      return;
    }
    if (clock.deadlineAt !== null) {
      clock.deadlineAt = now + clock.remainingMs[activePlayer];
      if (completedTurn) this.#startClock(room, nextState.currentPlayer, now);
    }
  }
}
