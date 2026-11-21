import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_SETTINGS, EVENT_ITEMS, ITEM_SPAWN_MODES, MAX_BOARD_DIMENSION, MIN_BOARD_DIMENSION, createGameState,
  getSelectedAbility, isValidAreaTarget, isValidDebrisTarget, isValidPointDestroyTarget,
  isValidShieldTarget
} from "../ui/game.js";
import { getPlayerView, getSpectatorView, processGameCommand } from "./game-service.js";
import { appendHistoryEntry, createHistoryEntry, createUndoHistoryEntry, MAX_HISTORY_ENTRIES } from "../ui/history.js";
import { TurnUndoHistory } from "../ui/turn-undo.js";

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
  "unlimitedTime", "randomEvents", "itemSpawnMode", "wormholesEnabled", "animationsEnabled", "freeStartingPositions", "disabledItems",
  "unlimitedItemLifetime", "itemLifetimeTurns"
]);

function normalizeRoomSettings(input, defaults) {
  if (input === undefined) input = {};
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !ROOM_SETTING_FIELDS.has(key))) return null;
  const settings = { ...defaults, ...input, adminMode: false };
  if (input.disabledItems !== undefined
    && (!Array.isArray(input.disabledItems) || input.disabledItems.some((type) => !EVENT_ITEMS.includes(type)))) return null;
  settings.disabledItems = [...new Set(input.disabledItems ?? defaults.disabledItems ?? [])];
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
    || !["unlimitedTime", "randomEvents", "wormholesEnabled", "animationsEnabled", "freeStartingPositions"]
      .every((key) => typeof settings[key] === "boolean")) return null;
  if (typeof settings.unlimitedItemLifetime !== "boolean"
    || !Number.isInteger(settings.itemLifetimeTurns) || settings.itemLifetimeTurns < 1 || settings.itemLifetimeTurns > 1000) return null;
  if (!ITEM_SPAWN_MODES.includes(settings.itemSpawnMode)) return null;
  return settings;
}

export class RoomManager {
  constructor({
    settings = DEFAULT_SETTINGS,
    maxRooms = 200,
    waitingRoomTtlMs = 5 * 60_000,
    reconnectGraceMs = 2 * 60_000,
    finishedRoomTtlMs = 60_000,
    undoResponseTimeoutMs = 30_000,
    now = Date.now,
    roomCodeFactory = makeRoomCode,
    playerTokenFactory = makePlayerToken,
    eventIdFactory = randomUUID,
    random = Math.random,
    sideRandom = () => randomBytes(1)[0] / 256,
    scheduleTimeout = setTimeout,
    cancelTimeout = clearTimeout,
    onMatchFinished = null,
    onMatchStarted = null
  } = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings, adminMode: false };
    this.maxRooms = maxRooms;
    this.waitingRoomTtlMs = waitingRoomTtlMs;
    this.reconnectGraceMs = reconnectGraceMs;
    this.finishedRoomTtlMs = finishedRoomTtlMs;
    this.undoResponseTimeoutMs = undoResponseTimeoutMs;
    this.now = now;
    this.roomCodeFactory = roomCodeFactory;
    this.playerTokenFactory = playerTokenFactory;
    this.eventIdFactory = eventIdFactory;
    this.random = random;
    this.sideRandom = sideRandom;
    this.scheduleTimeout = scheduleTimeout;
    this.cancelTimeout = cancelTimeout;
    this.onMatchFinished = onMatchFinished;
    this.onMatchStarted = onMatchStarted;
    this.rooms = new Map();
  }

  setMatchFinishedHandler(handler) {
    this.onMatchFinished = typeof handler === "function" ? handler : null;
  }

  setMatchStartedHandler(handler) {
    this.onMatchStarted = typeof handler === "function" ? handler : null;
  }

  createRoom(requestedSettings, { accountId = null } = {}) {
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
    const initialState = createGameState(roomSettings, this.random);
    const room = {
      code,
      catalogId: randomUUID(),
      publicRoom: false,
      observers: new Map(),
      matchId: randomUUID(),
      state: initialState,
      history: [],
      nextHistoryId: 1,
      undoHistory: new TurnUndoHistory(),
      undoProposal: null,
      version: 0,
      status: "waiting",
      startRatings: null,
      ratingPromise: null,
      ratingRecorded: false,
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
        X: this.#newSeat(token, createdAt, accountId),
        O: null
      },
      aims: { X: null, O: null },
      restartProposal: null,
      queue: Promise.resolve()
    };
    room.undoHistory.reset(initialState, room.clock.remainingMs);
    const initialEntry = createHistoryEntry(null, initialState, room.nextHistoryId);
    if (initialEntry) {
      room.history.push(initialEntry);
      room.nextHistoryId += 1;
    }
    this.rooms.set(code, room);
    return {
      ok: true,
      roomCode: code,
      side: null,
      seatKey: "X",
      playerToken: token,
      status: room.status,
      version: room.version,
      state: getPlayerView(room.state, "X"),
      history: room.history,
      clock: this.#clockSnapshot(room),
      ...this.#undoView(room, "X")
    };
  }

  joinRoom(rawCode, { accountId = null, ratingsByAccount = {} } = {}) {
    const code = normalizeCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) return failure("room-not-found");
    if (room.status !== "waiting" || room.seats.O) return failure("room-full");
    if (accountId && room.seats.X.accountId === accountId) return failure("same-account");

    const token = this.playerTokenFactory();
    const joinedAt = this.now();
    const creatorSeat = room.seats.X;
    const joiningSeat = this.#newSeat(token, joinedAt, accountId);
    const creatorSide = this.sideRandom() < 0.5 ? "X" : "O";
    const joiningSide = creatorSide === "X" ? "O" : "X";
    room.seats = creatorSide === "X"
      ? { X: creatorSeat, O: joiningSeat }
      : { X: joiningSeat, O: creatorSeat };
    for (const side of SIDES) {
      if (room.seats[side].connection) room.seats[side].connection.side = side;
    }
    room.status = "active";
    if (room.seats.X.accountId && room.seats.O.accountId) {
      room.startRatings = {
        [room.seats.X.accountId]: Number(ratingsByAccount[room.seats.X.accountId]),
        [room.seats.O.accountId]: Number(ratingsByAccount[room.seats.O.accountId])
      };
    }
    room.lastActivityAt = joinedAt;
    if (room.state.phase === "playing") this.#startClock(room, room.state.currentPlayer, joinedAt);
    return {
      ok: true,
      roomCode: code,
      side: joiningSide,
      seatKey: joiningSide,
      playerToken: token,
      status: room.status,
      version: room.version,
      state: getPlayerView(room.state, joiningSide),
      history: room.history,
      clock: this.#clockSnapshot(room),
      ...this.#undoView(room, joiningSide)
    };
  }

  attachConnection(rawCode, side, send) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return failure("room-not-found");
    const seat = room.seats[side];
    if (!seat) return failure("seat-not-found");
    if (seat.connection) return failure("seat-already-connected");
    if (typeof send !== "function") return failure("invalid-connection");

    const connection = { side, send, lastSentVersion: -1 };
    seat.connection = connection;
    seat.disconnectedAt = null;
    room.lastActivityAt = this.now();
    return { ok: true, connection };
  }

  resumeRoom(rawCode, playerToken, send, { accountId = null, connection = null, replaceExisting = true } = {}) {
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
    if (seat.accountId && seat.accountId !== accountId) return failure("account-mismatch");
    if (typeof send !== "function") return failure("invalid-connection");
    // A refresh can arrive before the previous socket's close event. Only the
    // private seat token (and the same account) can replace that connection.
    if (connection && seat.connection === connection) {
      return { ...this.getSnapshot(code, side), seatKey: side, connection };
    }
    if (seat.connection && !replaceExisting) return failure("seat-already-connected");
    if (!seat.connection && this.now() - seat.disconnectedAt >= this.reconnectGraceMs) return failure("reconnect-expired");
    const previous = seat.connection;
    if (previous) this.detachConnection(code, side, previous);
    const attached = this.attachConnection(code, side, send);
    if (!attached.ok) return attached;
    if (previous) {
      try { previous.send({ type: "session-replaced", roomCode: code }); } catch { /* The old transport may already be gone. */ }
    }
    return {
      ok: true,
      roomCode: code,
      side: room.status === "waiting" ? null : side,
      seatKey: side,
      status: room.status,
      version: room.version,
      state: getPlayerView(room.state, side),
      history: room.history,
      clock: this.#clockSnapshot(room),
      ...this.#undoView(room, side),
      connection: attached.connection
    };
  }

  getParticipantAccountIds(rawCode) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return [];
    return [room.seats.X?.accountId, room.seats.O?.accountId].filter(Boolean);
  }

  setRoomVisibility(rawCode, isPublic) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room || room.status !== "waiting" || typeof isPublic !== "boolean") return false;
    room.publicRoom = isPublic;
    return true;
  }

  listRoomCatalog() {
    return [...this.rooms.values()].filter((room) => (room.status === "active" || room.status === "waiting")
      && room.state.phase !== "finished")
      .map((room) => ({
        id: room.catalogId,
        visibility: room.publicRoom ? "public" : "private",
        status: room.status,
        players: SIDES.filter((side) => room.seats[side]).length,
        maxPlayers: 2,
        observers: room.observers.size,
        settings: Object.fromEntries([
          "width", "height", "piecesPerTurn", "clockMinutes", "incrementSeconds", "unlimitedTime",
          "randomEvents", "itemSpawnMode", "wormholesEnabled", "freeStartingPositions", "disabledItems",
          "unlimitedItemLifetime", "itemLifetimeTurns", "animationsEnabled"
        ].filter((key) => Object.hasOwn(room.state.settings, key)).map((key) => [
          key, key === "disabledItems" ? [...room.state.settings[key]] : room.state.settings[key]
        ]))
      }));
  }

  attachObserver(catalogId, { isAdmin = false, send } = {}) {
    const room = [...this.rooms.values()].find((candidate) => candidate.catalogId === catalogId);
    if (!room || (room.status !== "active" && room.status !== "waiting")) return failure("room-not-found");
    if (!room.publicRoom && !isAdmin) return failure("private-room");
    if (typeof send !== "function") return failure("invalid-connection");
    const observerId = randomUUID();
    const connection = { id: observerId, send, isAdmin, lastSentVersion: room.version };
    room.observers.set(observerId, connection);
    return {
      ok: true,
      roomId: room.catalogId,
      status: room.status,
      version: room.version,
      state: getSpectatorView(room.state, { isAdmin }),
      clock: this.#clockSnapshot(room),
      settings: this.listRoomCatalog().find(({ id }) => id === room.catalogId)?.settings,
      observerId,
      isAdmin
    };
  }

  detachObserver(catalogId, observerId) {
    const room = [...this.rooms.values()].find((candidate) => candidate.catalogId === catalogId);
    return room?.observers.delete(observerId) ?? false;
  }

  resolveCatalogRoom(catalogId) {
    return [...this.rooms.values()].find((room) => room.catalogId === catalogId) ?? null;
  }

  detachConnection(rawCode, side, connection) {
    const room = this.rooms.get(normalizeCode(rawCode));
    const seat = room?.seats[side];
    if (!seat?.connection || (connection && seat.connection !== connection)) return false;
    seat.connection = null;
    seat.disconnectedAt = this.now();
    room.lastActivityAt = seat.disconnectedAt;
    this.#clearAim(room, side);
    this.#cancelRestartProposal(room, "player-disconnected");
    this.#cancelUndoProposal(room, "player-disconnected");
    return true;
  }

  isCurrentConnection(rawCode, connection) {
    const room = this.rooms.get(normalizeCode(rawCode));
    return Boolean(connection && room?.seats[connection.side]?.connection === connection);
  }

  proposeRestart(rawCode, side, kind, requestedSettings = undefined) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return Promise.resolve(failure("room-not-found"));
    const operation = room.queue.then(() => {
      if (this.rooms.get(room.code) !== room) return failure("room-not-found");
      if (!room.seats[side]?.connection) return failure("player-disconnected");
      const opponentSide = side === "X" ? "O" : "X";
      if (!room.seats[opponentSide]?.connection) return failure("player-disconnected");
      if (room.restartProposal) return failure("restart-already-pending");
      if (room.undoProposal) return failure("undo-pending");
      if (kind === "settings") {
        if (this.#expireClockIfDue(room, this.now())) return failure("time-expired");
        if (room.status !== "active" || room.state.phase === "finished") return failure("wrong-phase");
        const settings = normalizeRoomSettings(requestedSettings, room.state.settings);
        if (!settings) return failure("invalid-settings");
        room.restartProposal = { id: randomUUID(), kind, fromSide: side, settings };
      } else if (kind === "rematch") {
        if (room.status !== "active" || room.state.phase !== "finished") return failure("wrong-phase");
        room.restartProposal = { id: randomUUID(), kind, fromSide: side, settings: { ...room.state.settings } };
      } else return failure("invalid-restart-kind");

      const proposal = room.restartProposal;
      const opponentConnection = room.seats[opponentSide]?.connection;
      if (opponentConnection) {
        try {
          opponentConnection.send({
            type: "restart-proposal",
            roomCode: room.code,
            proposalId: proposal.id,
            kind: proposal.kind,
            settings: proposal.kind === "settings" ? { ...proposal.settings } : undefined
          });
        } catch { this.detachConnection(room.code, opponentSide, opponentConnection); }
      }
      return { ok: true, proposalId: proposal.id, kind: proposal.kind };
    });
    room.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  voteRestart(rawCode, side, proposalId, accept) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return Promise.resolve(failure("room-not-found"));
    const operation = room.queue.then(async () => {
      if (this.rooms.get(room.code) !== room) return failure("room-not-found");
      if (!room.seats[side]?.connection) return failure("player-disconnected");
      const proposal = room.restartProposal;
      if (!proposal || proposal.id !== proposalId) return failure("restart-proposal-expired");
      if (proposal.fromSide === side) return failure("cannot-vote-own-proposal");
      if (typeof accept !== "boolean") return failure("invalid-restart-vote");
      if (proposal.kind === "settings" && this.#expireClockIfDue(room, this.now())) return failure("time-expired");
      if (!accept) {
        this.#cancelRestartProposal(room, "declined");
        return { ok: true, accepted: false };
      }
      if (proposal.kind === "settings" && room.state.phase === "finished") {
        this.#cancelRestartProposal(room, "match-finished");
        return failure("wrong-phase");
      }
      if (proposal.kind === "rematch" && room.state.phase !== "finished") {
        this.#cancelRestartProposal(room, "match-not-finished");
        return failure("wrong-phase");
      }

      if (this.onMatchStarted) {
        try {
          room.startRatings = await this.onMatchStarted(this.getParticipantAccountIds(room.code));
        } catch {
          return failure("rating-service-unavailable");
        }
      }
      this.#restartRoom(room, proposal);
      return { ok: true, accepted: true, version: room.version };
    });
    room.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  proposeUndo(rawCode, side) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return Promise.resolve(failure("room-not-found"));
    const operation = room.queue.then(() => {
      if (this.rooms.get(room.code) !== room) return failure("room-not-found");
      if (!room.seats[side]?.connection) return failure("player-disconnected");
      const opponentSide = side === "X" ? "O" : "X";
      if (!room.seats[opponentSide]?.connection) return failure("player-disconnected");
      if (room.status !== "active" || room.state.phase !== "playing") return failure("wrong-phase");
      if (room.restartProposal) return failure("restart-pending");
      if (room.undoProposal) return failure("undo-pending");
      if (this.#expireClockIfDue(room, this.now())) return failure("time-expired");
      if (room.state.currentPlayer === side
        || !room.undoHistory.canUndo(side, { latestOnly: true })) return failure("undo-unavailable");

      this.#pauseClock(room, this.now());
      const proposal = {
        id: randomUUID(),
        fromSide: side,
        toSide: opponentSide,
        expiresAt: this.now() + this.undoResponseTimeoutMs,
        timer: null
      };
      room.undoProposal = proposal;
      proposal.timer = this.scheduleTimeout(() => {
        const expiry = room.queue.then(() => {
          if (this.rooms.get(room.code) !== room || room.undoProposal?.id !== proposal.id) return;
          this.#cancelUndoProposal(room, "expired");
        });
        room.queue = expiry.then(() => undefined, () => undefined);
        return expiry;
      }, this.undoResponseTimeoutMs);
      proposal.timer?.unref?.();
      this.#broadcastEphemeral(room, {
        type: "undo-proposal",
        roomCode: room.code,
        proposalId: proposal.id,
        fromSide: proposal.fromSide,
        toSide: proposal.toSide,
        expiresAt: proposal.expiresAt,
        clock: this.#clockSnapshot(room)
      });
      return { ok: true, proposalId: proposal.id, expiresAt: proposal.expiresAt };
    });
    room.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  voteUndo(rawCode, side, proposalId, accept) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return Promise.resolve(failure("room-not-found"));
    const operation = room.queue.then(() => {
      if (this.rooms.get(room.code) !== room) return failure("room-not-found");
      if (!room.seats[side]?.connection) return failure("player-disconnected");
      const proposal = room.undoProposal;
      if (!proposal || proposal.id !== proposalId) return failure("undo-proposal-expired");
      if (proposal.toSide !== side) return failure("cannot-vote-own-undo");
      if (typeof accept !== "boolean") return failure("invalid-undo-vote");
      if (this.now() >= proposal.expiresAt) {
        this.#cancelUndoProposal(room, "expired");
        return failure("undo-proposal-expired");
      }
      if (!accept) {
        this.#cancelUndoProposal(room, "declined");
        return { ok: true, accepted: false };
      }
      if (room.status !== "active" || room.state.phase !== "playing"
        || !room.undoHistory.canUndo(proposal.fromSide, { latestOnly: true })) {
        this.#cancelUndoProposal(room, "no-longer-available");
        return failure("undo-unavailable");
      }

      const checkpoint = room.undoHistory.completed.at(-1);
      this.#clearUndoProposal(room);
      if (room.clock.enabled && checkpoint.clockIncrementMs > 0) {
        room.clock.remainingMs[proposal.fromSide] = Math.max(
          0,
          room.clock.remainingMs[proposal.fromSide] - checkpoint.clockIncrementMs
        );
      }
      room.state = room.undoHistory.undo(proposal.fromSide, { latestOnly: true }).state;
      this.#startClock(room, room.state.currentPlayer, this.now());
      room.undoHistory.reset(room.state, room.clock.remainingMs);
      room.aims = { X: null, O: null };
      const historyEntry = createUndoHistoryEntry(room.state, room.nextHistoryId, {
        side: proposal.fromSide,
        turnNumber: checkpoint.turnNumber
      });
      if (historyEntry) {
        room.history = appendHistoryEntry(room.history, historyEntry, MAX_HISTORY_ENTRIES);
        room.nextHistoryId += 1;
      }
      room.version += 1;
      room.lastActivityAt = this.now();
      this.#broadcastSnapshots(room, "state", {
        historyEntry,
        undoAccepted: true,
        undoneSide: proposal.fromSide
      });
      this.#broadcastEphemeral(room, {
        type: "undo-complete",
        roomCode: room.code,
        proposalId,
        version: room.version
      });
      return { ok: true, accepted: true, version: room.version };
    });
    room.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  updateAim(rawCode, side, target) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return failure("room-not-found");
    if (!room.seats[side]?.connection) return failure("player-disconnected");
    if (target === null) {
      this.#setAim(room, side, null);
      return { ok: true };
    }
    if (room.status !== "active" || room.state.phase !== "playing") return failure("wrong-phase");
    if (room.state.currentPlayer !== side) return failure("not-your-turn");
    const ability = getSelectedAbility(room.state);
    if (!ability) return failure("ability-not-selected");
    const { row, col } = target;
    if (!Number.isInteger(row) || !Number.isInteger(col)) return failure("invalid-coordinate");
    const valid = ability.type === "bomb" || ability.type === "antiBomb"
      ? isValidAreaTarget(room.state, row, col)
      : ability.type === "pointDestroy"
        ? isValidPointDestroyTarget(room.state, row, col)
        : ability.type === "debris"
          ? isValidDebrisTarget(room.state, row, col)
          : ability.type === "shield" || ability.type === "gangstaShield"
            ? isValidShieldTarget(room.state, row, col)
            : false;
    if (!valid) return failure("invalid-target");
    this.#setAim(room, side, { row, col, abilityType: ability.type });
    return { ok: true };
  }

  getSnapshot(rawCode, side) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return failure("room-not-found");
    if (!room.seats[side]) return failure("seat-not-found");
    return {
      ok: true,
      roomCode: room.code,
      side: room.status === "waiting" && !room.seats.O ? null : side,
      status: room.status,
      version: room.version,
      state: getPlayerView(room.state, side),
      history: room.history,
      clock: this.#clockSnapshot(room),
      ...this.#undoView(room, side)
    };
  }

  broadcastReady(rawCode) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room || room.status !== "active") return false;
    this.#broadcastSnapshots(room, "room-ready");
    return true;
  }

  submitCommand(rawCode, side, command, { isAdmin = false, adminObserverId = null, connection = null } = {}) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return Promise.resolve(failure("room-not-found"));
    if (!SIDES.includes(side) && !adminObserverId) return Promise.resolve(failure("invalid-player"));
    if (!adminObserverId && !room.seats[side]) return Promise.resolve(failure("seat-not-found"));
    if (room.status !== "active") return Promise.resolve(failure("room-not-ready"));

    const operation = room.queue.then(() => {
      if (this.rooms.get(room.code) !== room) return failure("room-not-found");
      if (connection && room.seats[side]?.connection !== connection) return failure("session-replaced");
      if (room.status !== "active") return failure("room-not-ready");
      if (!room.seats[side]?.connection
        && !(isAdmin && adminObserverId && room.observers.get(adminObserverId)?.isAdmin)) return failure("player-disconnected");
      const commandSide = adminObserverId ? room.state.currentPlayer : side;
      if (room.undoProposal) return { ...failure("undo-pending"), version: room.version };

      const now = this.now();
      if (this.#expireClockIfDue(room, now)) {
        return { ...failure("time-expired"), version: room.version };
      }

      const result = processGameCommand(room.state, commandSide, command, {
        random: this.random,
        authority: isAdmin ? "admin" : "player"
      });
      if (!result.ok) return { ...result, version: room.version };

      const previousState = room.state;
      const previousAbility = command.type === "ability-target" ? getSelectedAbility(previousState) : null;
      const selectedExchange = command.type === "select-ability"
        && previousState.inventory?.[side]?.some((item) => item.id === command.itemId && item.type === "exchange");
      room.state = result.state;
      const historyEntry = createHistoryEntry(previousState, room.state, room.nextHistoryId, { command, side: commandSide });
      if (historyEntry) {
        room.history = appendHistoryEntry(room.history, historyEntry, MAX_HISTORY_ENTRIES);
        room.nextHistoryId += 1;
      }
      const incrementAppliedMs = this.#updateClockAfterCommand(room, previousState, room.state, now);
      room.undoHistory.record(previousState, room.state, this.#clockSnapshot(room).remainingMs, incrementAppliedMs);
      room.version += 1;
      room.lastActivityAt = this.now();
      if (room.state.phase === "finished" && room.restartProposal?.kind === "settings") {
        this.#cancelRestartProposal(room, "match-finished");
      }
      this.#clearAllAims(room);
      this.#recordFinishedMatch(room);
      this.#broadcastSnapshots(room, "state", historyEntry ? { historyEntry } : {});
      if (previousAbility && ["bomb", "antiBomb", "pointDestroy"].includes(previousAbility.type)
        && room.state.board !== previousState.board && room.state.lastDestroyed.length > 0) {
        const visualEvent = {
          type: "visual-event",
          eventId: this.eventIdFactory(),
          roomCode: room.code,
          abilityType: previousAbility.type,
          row: command.row,
          col: command.col
        };
        this.#broadcastEphemeral(room, visualEvent);
      }
      if (selectedExchange && room.state.inventory !== previousState.inventory) {
        this.#broadcastEphemeral(room, {
          type: "visual-event",
          eventId: this.eventIdFactory(),
          roomCode: room.code,
          abilityType: "exchange"
        });
      }
      return { ok: true, version: room.version };
    });
    room.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  addOpponentTime(rawCode, side) {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return Promise.resolve(failure("room-not-found"));
    if (!SIDES.includes(side)) return Promise.resolve(failure("invalid-player"));
    const operation = room.queue.then(() => {
      if (this.rooms.get(room.code) !== room) return failure("room-not-found");
      if (room.status !== "active" || room.state.phase !== "playing") return failure("wrong-phase");
      if (!room.clock.enabled) return failure("clock-disabled");
      if (!room.seats.X?.connection || !room.seats.O?.connection) return failure("player-disconnected");
      const now = this.now();
      if (this.#expireClockIfDue(room, now)) return failure("time-expired");
      const targetSide = side === "X" ? "O" : "X";
      room.clock.remainingMs[targetSide] += 15_000;
      if (room.clock.activePlayer === targetSide) this.#startClock(room, targetSide, now);
      room.lastActivityAt = now;
      const clock = this.#clockSnapshot(room);
      this.#broadcastEphemeral(room, {
        type: "time-added",
        roomCode: room.code,
        side,
        targetSide,
        seconds: 15,
        clock
      });
      return { ok: true, targetSide, seconds: 15, clock };
    });
    room.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  addAdminTime(catalogId, target, seconds = 30) {
    const room = this.resolveCatalogRoom(catalogId);
    if (!room) return Promise.resolve(failure("room-not-found"));
    if (!["both", "X", "O"].includes(target) || !Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
      return Promise.resolve(failure("invalid-time-adjustment"));
    }
    const operation = room.queue.then(() => {
      if (this.rooms.get(room.code) !== room) return failure("room-not-found");
      if (room.status !== "active" || room.state.phase !== "playing") return failure("wrong-phase");
      if (!room.clock.enabled) return failure("clock-disabled");
      const now = this.now();
      if (this.#expireClockIfDue(room, now)) return failure("time-expired");
      const targets = target === "both" ? SIDES : [target];
      for (const side of targets) room.clock.remainingMs[side] += seconds * 1000;
      if (targets.includes(room.clock.activePlayer)) this.#startClock(room, room.clock.activePlayer, now);
      room.lastActivityAt = now;
      const clock = this.#clockSnapshot(room);
      this.#broadcastEphemeral(room, { type: "admin-time-added", roomId: room.catalogId, target, seconds, clock });
      return { ok: true, target, seconds, clock };
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
      } else if (room.state.phase === "finished" && !this.#hasPendingRatedResult(room)
        && now - room.lastActivityAt >= this.finishedRoomTtlMs) {
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
      if (room.state.phase === "finished") this.#recordFinishedMatch(room);
      if (!reason) continue;
      this.#clearUndoProposal(room);
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
    for (const room of this.rooms.values()) {
      this.#clearUndoProposal(room);
      this.#stopClock(room);
    }
  }

  hasRoom(rawCode) {
    return this.rooms.has(normalizeCode(rawCode));
  }

  get roomCount() {
    return this.rooms.size;
  }

  #newSeat(token, disconnectedAt, accountId = null) {
    return { tokenHash: hashToken(token), connection: null, disconnectedAt, accountId };
  }

  #recordFinishedMatch(room) {
    if (room.ratingRecorded || room.ratingPromise || !this.onMatchFinished
      || room.state.phase !== "finished" || !room.state.winner
      || !room.seats.X?.accountId || !room.seats.O?.accountId
      || room.seats.X.accountId === room.seats.O.accountId || !room.startRatings) return;
    const winnerId = room.seats[room.state.winner]?.accountId;
    const loserSide = room.state.winner === "X" ? "O" : "X";
    const loserId = room.seats[loserSide]?.accountId;
    if (!winnerId || !loserId) return;
    const matchId = room.matchId;
    const ratingPromise = Promise.resolve().then(() => this.onMatchFinished({
      matchId,
      winnerId,
      loserId,
      ratingsAtStart: room.startRatings
    })).then((result) => {
      if (room.matchId === matchId) {
        room.ratingRecorded = true;
        if (result?.recorded || result?.reason === "already-recorded") {
          this.#broadcastEphemeral(room, { type: "rating-updated", roomCode: room.code });
        }
      }
    }).catch(() => {
      // A later room sweep retries; database uniqueness makes this safe if the first write committed.
    }).finally(() => {
      if (room.ratingPromise === ratingPromise) room.ratingPromise = null;
    });
    room.ratingPromise = ratingPromise;
  }

  #hasPendingRatedResult(room) {
    return room.state.phase === "finished" && Boolean(room.state.winner)
      && Boolean(room.seats.X?.accountId && room.seats.O?.accountId)
      && room.seats.X.accountId !== room.seats.O.accountId
      && Number.isFinite(room.startRatings?.[room.seats.X.accountId])
      && Number.isFinite(room.startRatings?.[room.seats.O.accountId])
      && !room.ratingRecorded;
  }

  #cancelRestartProposal(room, reason) {
    const proposal = room.restartProposal;
    if (!proposal) return false;
    room.restartProposal = null;
    this.#broadcastEphemeral(room, {
      type: "restart-cancelled",
      roomCode: room.code,
      proposalId: proposal.id,
      reason
    });
    return true;
  }

  #undoView(room, side) {
    const proposal = room.undoProposal;
    return {
      undoAvailable: room.status === "active"
        && room.state.phase === "playing"
        && !proposal
        && room.undoHistory.canUndo(side, { latestOnly: true }),
      undoProposal: proposal ? {
        proposalId: proposal.id,
        fromSide: proposal.fromSide,
        toSide: proposal.toSide,
        expiresAt: proposal.expiresAt
      } : null
    };
  }

  #pauseClock(room, now) {
    const clock = room.clock;
    if (clock.activePlayer && clock.deadlineAt !== null) {
      clock.remainingMs[clock.activePlayer] = Math.max(0, clock.deadlineAt - now);
    }
    this.#stopClock(room);
  }

  #clearUndoProposal(room) {
    const proposal = room.undoProposal;
    if (!proposal) return null;
    room.undoProposal = null;
    if (proposal.timer !== null) this.cancelTimeout(proposal.timer);
    proposal.timer = null;
    return proposal;
  }

  #cancelUndoProposal(room, reason) {
    const proposal = this.#clearUndoProposal(room);
    if (!proposal) return false;
    if (room.status === "active" && room.state.phase === "playing") {
      this.#startClock(room, room.state.currentPlayer, this.now());
    }
    this.#broadcastEphemeral(room, {
      type: "undo-cancelled",
      roomCode: room.code,
      proposalId: proposal.id,
      reason,
      undoAvailableFor: this.#undoView(room, proposal.fromSide).undoAvailable ? proposal.fromSide : null,
      clock: this.#clockSnapshot(room)
    });
    return true;
  }

  #restartRoom(room, proposal) {
    this.#stopClock(room);
    this.#clearUndoProposal(room);
    room.restartProposal = null;
    room.state = createGameState(proposal.settings, this.random);
    room.matchId = randomUUID();
    room.ratingRecorded = false;
    room.history = [];
    const initialEntry = createHistoryEntry(null, room.state, room.nextHistoryId);
    if (initialEntry) {
      room.history.push(initialEntry);
      room.nextHistoryId += 1;
    }
    const oldX = room.seats.X;
    const oldO = room.seats.O;
    if (this.sideRandom() < 0.5) room.seats = { X: oldX, O: oldO };
    else room.seats = { X: oldO, O: oldX };
    for (const side of SIDES) {
      if (room.seats[side]?.connection) room.seats[side].connection.side = side;
    }
    room.aims = { X: null, O: null };
    const clockMinutes = proposal.settings.clockMinutes;
    room.clock = {
      enabled: !proposal.settings.unlimitedTime,
      remainingMs: {
        X: proposal.settings.unlimitedTime ? null : clockMinutes * 60_000,
        O: proposal.settings.unlimitedTime ? null : clockMinutes * 60_000
      },
      activePlayer: null,
      deadlineAt: null,
      timer: null,
      generation: room.clock.generation + 1
    };
    room.undoHistory.reset(room.state, room.clock.remainingMs);
    room.version += 1;
    room.lastActivityAt = this.now();
    if (room.state.phase === "playing") this.#startClock(room, room.state.currentPlayer, this.now());
    this.#broadcastSnapshots(room, "state", { restartKind: proposal.kind, history: room.history });
    this.#broadcastEphemeral(room, {
      type: "restart-complete",
      roomCode: room.code,
      kind: proposal.kind,
      version: room.version
    });
  }

  #setAim(room, side, target) {
    const previous = room.aims[side];
    if (JSON.stringify(previous) === JSON.stringify(target)) return;
    room.aims[side] = target;
    const opponent = side === "X" ? "O" : "X";
    const connection = room.seats[opponent]?.connection;
    const message = { type: "aim", roomCode: room.code, side, target };
    if (connection) {
      try { connection.send(message); }
      catch { this.detachConnection(room.code, opponent, connection); }
    }
    for (const observer of room.observers.values()) this.#sendToObserver(room, observer, message);
  }

  #clearAim(room, side) {
    if (room.aims[side] !== null) this.#setAim(room, side, null);
  }

  #clearAllAims(room) {
    for (const side of SIDES) this.#clearAim(room, side);
  }

  #broadcastEphemeral(room, message) {
    for (const side of SIDES) {
      const connection = room.seats[side]?.connection;
      if (!connection) continue;
      try {
        connection.send(message);
      } catch {
        this.detachConnection(room.code, side, connection);
      }
    }
    for (const observer of room.observers.values()) this.#sendToObserver(room, observer, message);
  }

  #sendToObserver(room, observer, message) {
    const safeMessage = { ...message, roomId: room.catalogId };
    delete safeMessage.roomCode;
    try { observer.send(safeMessage); }
    catch { room.observers.delete(observer.id); }
  }

  #broadcastSnapshots(room, type, extra = {}) {
    for (const side of SIDES) {
      const connection = room.seats[side]?.connection;
      if (!connection || (type !== "room-ready" && room.version <= connection.lastSentVersion)) continue;
      const envelope = {
        type,
        roomCode: room.code,
        side,
        version: room.version,
        ...extra,
        ...((type === "room-ready" || extra.restartKind) ? { history: room.history } : {}),
        state: getPlayerView(room.state, side),
        clock: this.#clockSnapshot(room),
        ...this.#undoView(room, side)
      };
      try {
        connection.send(envelope);
        connection.lastSentVersion = room.version;
      } catch {
        this.detachConnection(room.code, side, connection);
      }
    }
    for (const observer of room.observers.values()) {
      if (type !== "room-ready" && room.version <= observer.lastSentVersion) continue;
      const { history: _privateHistory, ...safeExtra } = extra;
      const envelope = {
        type,
        roomId: room.catalogId,
        roomCode: undefined,
        side: null,
        version: room.version,
        ...safeExtra,
        state: getSpectatorView(room.state, { isAdmin: observer.isAdmin }),
        clock: this.#clockSnapshot(room),
        undoAvailable: false,
        undoProposal: null
      };
      delete envelope.roomCode;
      try {
        observer.send(envelope);
        observer.lastSentVersion = room.version;
      } catch { room.observers.delete(observer.id); }
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
    const previousState = room.state;
    room.state = result.state;
    const historyEntry = createHistoryEntry(previousState, room.state, room.nextHistoryId, {
      command: { type: "timeout" },
      side: timedOutPlayer
    });
    if (historyEntry) {
      room.history = appendHistoryEntry(room.history, historyEntry, MAX_HISTORY_ENTRIES);
      room.nextHistoryId += 1;
    }
    room.undoHistory.clear();
    this.#stopClock(room);
    if (room.restartProposal?.kind === "settings") this.#cancelRestartProposal(room, "match-finished");
    room.version += 1;
    room.lastActivityAt = now;
    this.#clearAllAims(room);
    this.#recordFinishedMatch(room);
    this.#broadcastSnapshots(room, "state", historyEntry ? { historyEntry } : {});
    return true;
  }

  #updateClockAfterCommand(room, previousState, nextState, now) {
    const clock = room.clock;
    if (!clock.enabled) return 0;

    if (previousState.phase !== "playing" && nextState.phase === "playing") {
      this.#startClock(room, nextState.currentPlayer, now);
      return 0;
    }
    if (previousState.phase !== "playing") return 0;

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
    const incrementAppliedMs = completedTurn ? room.state.settings.incrementSeconds * 1000 : 0;
    if (incrementAppliedMs > 0) clock.remainingMs[previousState.currentPlayer] += incrementAppliedMs;

    if (nextState.phase !== "playing") {
      this.#stopClock(room);
      return incrementAppliedMs;
    }
    if (nextState.currentPlayer !== activePlayer) {
      this.#startClock(room, nextState.currentPlayer, now);
      return incrementAppliedMs;
    }
    if (clock.deadlineAt !== null) {
      clock.deadlineAt = now + clock.remainingMs[activePlayer];
      if (completedTurn) this.#startClock(room, nextState.currentPlayer, now);
    }
    return incrementAppliedMs;
  }
}
