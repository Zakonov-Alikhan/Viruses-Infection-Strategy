const SESSION_STORAGE_KEY = "viruses.online-room";
const REQUEST_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 1_200;
const MAX_RECONNECT_ATTEMPTS = 110;
const VERSIONED_TYPES = new Set(["room-created", "room-joined", "room-resumed", "observing-room", "room-ready", "state"]);
const TERMINAL_RESUME_ERRORS = new Set(["room-not-found", "invalid-resume-token", "reconnect-expired"]);

export const MULTIPLAYER_CONFIG = Object.freeze({
  localWebSocketUrl: "ws://127.0.0.1:3001/ws",
  publicPath: "/ws"
});

export function resolveMultiplayerUrl({
  configuredUrl = globalThis.VIRUSES_MULTIPLAYER_URL,
  location = globalThis.location
} = {}) {
  if (typeof configuredUrl === "string" && configuredUrl.trim()) return configuredUrl.trim();
  if (!location) return MULTIPLAYER_CONFIG.localWebSocketUrl;
  if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    return MULTIPLAYER_CONFIG.localWebSocketUrl;
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${MULTIPLAYER_CONFIG.publicPath}`;
}

function getPersistentStorage() {
  let legacySession = null;
  try { legacySession = globalThis.sessionStorage; } catch { /* Browser storage may be restricted. */ }
  try {
    const persistent = globalThis.localStorage;
    if (persistent) {
      if (!persistent.getItem(SESSION_STORAGE_KEY) && legacySession?.getItem(SESSION_STORAGE_KEY)) {
        persistent.setItem(SESSION_STORAGE_KEY, legacySession.getItem(SESSION_STORAGE_KEY));
        legacySession.removeItem(SESSION_STORAGE_KEY);
      }
      return persistent;
    }
    return legacySession ?? null;
  } catch {
    return legacySession;
  }
}

function safeParseSession(storage, key = SESSION_STORAGE_KEY) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(key) || "null");
    if (typeof value?.roomCode !== "string" || typeof value?.playerToken !== "string"
      || (value.side !== null && !["X", "O"].includes(value.side))) return null;
    return { roomCode: value.roomCode, playerToken: value.playerToken, side: value.side ?? null };
  } catch {
    return null;
  }
}

export class MultiplayerError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "MultiplayerError";
    this.code = code;
  }
}

/** WebSocket protocol client. It contains no DOM or game-rule logic. */
export class MultiplayerClient {
  constructor({
    url = resolveMultiplayerUrl(),
    WebSocketImpl = globalThis.WebSocket,
    storage = getPersistentStorage(),
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    reconnectDelayMs = RECONNECT_DELAY_MS,
    maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS
  } = {}) {
    if (typeof WebSocketImpl !== "function") throw new TypeError("A WebSocket implementation is required");
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.storage = storage;
    this.session = safeParseSession(storage);
    this.requestTimeoutMs = requestTimeoutMs;
    this.reconnectDelayMs = reconnectDelayMs;
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.listeners = new Set();
    this.pendingRequests = new Map();
    this.socket = null;
    this.connectPromise = null;
    this.reconnectPromise = null;
    this.resumePromise = null;
    this.lifecycle = 0;
    this.intentionalClose = false;
    this.requestNumber = 0;
    this.lastVersion = -1;
    this.lastVersionRoomCode = null;
    this.lastRoomSnapshot = null;
    this.seenVisualEventIds = new Set();
    this.isObserving = false;
  }

  get connected() {
    return Boolean(this.socket && this.socket.readyState === this.WebSocketImpl.OPEN);
  }

  get savedSession() {
    return this.session ? { ...this.session } : null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect() {
    if (this.connected) return this.socket;
    if (this.connectPromise) return this.connectPromise;
    this.intentionalClose = false;

    const socket = new this.WebSocketImpl(this.url);
    this.socket = socket;
    this.connectPromise = new Promise((resolve, reject) => {
      let opened = false;
      let settled = false;
      const fail = (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (socket === this.socket) this.connectPromise = null;
        reject(new MultiplayerError(code));
      };
      const timer = setTimeout(() => {
        fail("connection-failed");
        if (socket.readyState < this.WebSocketImpl.CLOSING) socket.close();
      }, this.requestTimeoutMs);
      const onOpen = () => {
        if (socket !== this.socket) { fail("left-room"); return; }
        opened = true;
        settled = true;
        clearTimeout(timer);
        this.connectPromise = null;
        this.#emit({ type: "transport-open" });
        resolve(socket);
      };
      const onError = () => {
        if (!opened) {
          fail("connection-failed");
        } else if (socket === this.socket) {
          this.#emit({ type: "transport-error", code: "connection-failed" });
        }
      };
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError);
      socket.addEventListener("message", (event) => {
        if (socket === this.socket) this.#receive(event.data);
      });
      socket.addEventListener("close", (event) => {
        if (!opened) fail("connection-lost");
        this.#handleClose(socket, event);
      });
    });
    return this.connectPromise;
  }

  async createRoom(settings, { publicRoom = false } = {}) {
    if (this.lastRoomSnapshot || this.isObserving) this.disconnect({ preserveSession: true });
    await this.connect();
    return this.#request("create-room", { ...(settings ? { settings } : {}), publicRoom }, "room-created");
  }

  async observeRoom(roomId, adminSecret = undefined) {
    if (typeof roomId !== "string" || !roomId) throw new MultiplayerError("invalid-room-id");
    if (this.lastRoomSnapshot || this.isObserving) this.disconnect({ preserveSession: true });
    await this.connect();
    return this.#request("observe-room", {
      roomId,
      ...(adminSecret ? { adminSecret } : {})
    }, "observing-room");
  }

  async joinRoom(code) {
    const normalizedCode = String(code).trim().toUpperCase();
    const saved = this.session?.roomCode === normalizedCode ? this.session
      : safeParseSession(this.storage, `${SESSION_STORAGE_KEY}:${normalizedCode}`)
        ?? safeParseSession(this.storage);
    if (saved?.roomCode === normalizedCode) {
      if ((this.lastRoomSnapshot && this.lastRoomSnapshot.roomCode !== normalizedCode) || this.isObserving) {
        this.disconnect({ preserveSession: true });
      }
      this.session = saved;
      return this.resumeSavedRoom();
    }
    if (this.lastRoomSnapshot || this.isObserving) this.disconnect({ preserveSession: true });
    await this.connect();
    return this.#request("join-room", { code: normalizedCode }, "room-joined");
  }

  async joinPublicRoom(roomId) {
    if (typeof roomId !== "string" || !roomId) throw new MultiplayerError("invalid-room-id");
    if (this.lastRoomSnapshot || this.isObserving) this.disconnect({ preserveSession: true });
    await this.connect();
    return this.#request("join-public-room", { roomId }, "room-joined");
  }

  resumeSavedRoom() {
    if (this.resumePromise) return this.resumePromise;
    if (this.isObserving) this.disconnect({ preserveSession: true });
    const session = this.savedSession;
    if (!session) return Promise.reject(new MultiplayerError("no-saved-room"));
    const lifecycle = this.lifecycle;
    const operation = (async () => {
      await this.connect();
      if (lifecycle !== this.lifecycle) throw new MultiplayerError("left-room");
      // Even an open transport must confirm its seat on the server. A cached
      // snapshot cannot authorize a new socket after refresh/disconnect.
      return this.#request("resume-room", {
        code: session.roomCode, playerToken: session.playerToken, replaceExisting: true
      }, "room-resumed");
    })().finally(() => {
      if (this.resumePromise === operation) this.resumePromise = null;
    });
    this.resumePromise = operation;
    return operation;
  }

  sendCommand(command) {
    if (!this.connected || !command || typeof command !== "object" || Array.isArray(command)) return false;
    const requestId = this.#nextRequestId();
    return this.#send({ type: "command", command, requestId });
  }

  addTimeToOpponent() {
    return this.#request("opponent-time", {}, "opponent-time-added");
  }

  adjustAdminTime(target, seconds = 30) {
    if (!["both", "X", "O"].includes(target) || !Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
      return Promise.reject(new MultiplayerError("invalid-time-adjustment"));
    }
    return this.#request("admin-time", { target, seconds }, "admin-time-recorded");
  }

  authenticateAdmin(secret) {
    if (typeof secret !== "string" || secret.length < 1 || secret.length > 512) {
      return Promise.reject(new MultiplayerError("invalid-admin-secret"));
    }
    return this.#request("admin-auth", { secret }, "admin-authenticated");
  }

  proposeRestart(kind, settings = undefined) {
    if (!["settings", "rematch"].includes(kind)) return Promise.reject(new MultiplayerError("invalid-restart-kind"));
    if (kind === "settings" && (!settings || typeof settings !== "object" || Array.isArray(settings))) {
      return Promise.reject(new MultiplayerError("invalid-settings"));
    }
    const fields = kind === "settings" ? { kind, settings } : { kind };
    return this.#request("restart-propose", fields, "restart-proposal-created");
  }

  voteRestart(proposalId, accept) {
    if (typeof proposalId !== "string" || typeof accept !== "boolean") {
      return Promise.reject(new MultiplayerError("invalid-restart-vote"));
    }
    return this.#request("restart-vote", { proposalId, accept }, "restart-vote-recorded");
  }

  proposeUndo() {
    return this.#request("undo-propose", {}, "undo-proposal-created");
  }

  voteUndo(proposalId, accept) {
    if (typeof proposalId !== "string" || typeof accept !== "boolean") {
      return Promise.reject(new MultiplayerError("invalid-undo-vote"));
    }
    return this.#request("undo-vote", { proposalId, accept }, "undo-vote-recorded");
  }

  sendAim(row, col) {
    if (!this.connected) return false;
    if (row === null && col === null) return this.#send({ type: "aim", row: null, col: null });
    if (!Number.isInteger(row) || !Number.isInteger(col)) return false;
    return this.#send({ type: "aim", row, col });
  }

  clearAim() {
    return this.sendAim(null, null);
  }

  leave() {
    this.isObserving = false;
    this.disconnect({ preserveSession: false });
    this.#emit({ type: "left-room" });
  }

  leaveObserver() {
    this.isObserving = false;
    this.disconnect({ preserveSession: true });
    this.#emit({ type: "left-observation" });
  }

  disconnect({ preserveSession = true } = {}) {
    this.lifecycle += 1;
    this.intentionalClose = true;
    this.resumePromise = null;
    this.reconnectPromise = null;
    this.lastRoomSnapshot = null;
    this.lastVersion = -1;
    this.lastVersionRoomCode = null;
    this.isObserving = false;
    if (!preserveSession) {
      this.#clearSavedSession();
      this.seenVisualEventIds.clear();
    }
    this.#rejectPending(new MultiplayerError("left-room"));
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    if (socket && socket.readyState < this.WebSocketImpl.CLOSING) socket.close(1000, "leave-room");
    if (!preserveSession) {
      this.lastVersion = -1;
      this.lastVersionRoomCode = null;
    }
    this.#emit({ type: "disconnected", manual: true });
  }

  #request(type, fields, expectedType) {
    const requestId = this.#nextRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new MultiplayerError("request-timeout"));
      }, this.requestTimeoutMs);
      this.pendingRequests.set(requestId, { resolve, reject, timer, expectedType, requestType: type });
      if (!this.#send({ type, ...fields, requestId })) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new MultiplayerError("not-connected"));
      }
    });
  }

  #send(message) {
    if (!this.connected) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  #receive(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      this.#emit({ type: "client-protocol-error", code: "invalid-server-json" });
      return;
    }
    if (!message || typeof message !== "object" || typeof message.type !== "string") return;
    if (Number.isSafeInteger(message.version) && VERSIONED_TYPES.has(message.type)) {
      const beginsRoomSession = ["room-created", "room-joined", "observing-room"].includes(message.type);
      const roomIdentity = message.roomCode ? `player:${message.roomCode}` : message.roomId ? `observer:${message.roomId}` : null;
      if (beginsRoomSession) {
        if (this.lastVersionRoomCode !== roomIdentity) {
          this.lastVersion = -1;
          this.lastRoomSnapshot = null;
          this.seenVisualEventIds.clear();
        }
        this.lastVersionRoomCode = roomIdentity;
      } else if (this.lastVersionRoomCode && roomIdentity && roomIdentity !== this.lastVersionRoomCode) {
        return;
      } else if (!this.lastVersionRoomCode) {
        if (this.savedSession?.roomCode !== message.roomCode) return;
        this.lastVersionRoomCode = `player:${message.roomCode}`;
      }

      const mayRepeatVersion = message.type === "room-ready" || message.type === "room-resumed";
      if (message.version < this.lastVersion
        || (!mayRepeatVersion && message.version === this.lastVersion)) return;
      this.lastVersion = message.version;
      if (typeof message.roomCode === "string" && message.state && message.clock) {
        this.lastRoomSnapshot = message;
      }
    }

    if (message.type === "visual-event") {
      if (typeof message.eventId !== "string" || this.seenVisualEventIds.has(message.eventId)) return;
      this.seenVisualEventIds.add(message.eventId);
      if (this.seenVisualEventIds.size > 128) this.seenVisualEventIds.delete(this.seenVisualEventIds.values().next().value);
    }
    if (message.type === "aim" && message.roomCode !== this.savedSession?.roomCode) return;

    if (message.type === "room-created" || message.type === "room-joined") {
      this.isObserving = false;
      this.#saveSession(message);
    } else if (message.type === "observing-room") {
      this.isObserving = true;
    } else if (message.type === "room-closed") {
      this.#clearSavedSession();
    } else if (message.type === "session-replaced") {
      // A newer tab owns this seat. Do not reconnect in a loop or erase its
      // shared browser credentials when this old tab is later closed.
      this.session = null;
      this.disconnect({ preserveSession: true });
    } else if (["room-ready", "room-resumed", "state"].includes(message.type)) {
      this.#updateSavedSide(message);
    }

    if (message.type === "server-error" && message.requestId) {
      const pending = this.pendingRequests.get(message.requestId);
      if (pending) {
        this.pendingRequests.delete(message.requestId);
        clearTimeout(pending.timer);
        const error = new MultiplayerError(message.code);
        pending.reject(error);
        if (pending.requestType === "resume-room" && TERMINAL_RESUME_ERRORS.has(message.code)) {
          this.#clearSavedSession();
          this.#emit({ type: "reconnect-failed", code: message.code });
        }
      }
    } else if (message.type !== "server-error" && message.requestId) {
      const pending = this.pendingRequests.get(message.requestId);
      if (pending && pending.expectedType === message.type) {
        this.pendingRequests.delete(message.requestId);
        clearTimeout(pending.timer);
        pending.resolve(message);
      }
    }

    this.#emit(message);
  }

  #handleClose(socket, event) {
    if (socket !== this.socket) return;
    this.socket = null;
    this.lastRoomSnapshot = null;
    this.connectPromise = null;
    this.#rejectPending(new MultiplayerError("connection-lost"));
    if (this.intentionalClose) {
      this.intentionalClose = false;
      return;
    }
    this.#emit({ type: "disconnected", code: event.code });
    if (!this.isObserving && this.savedSession) this.#reconnect();
  }

  #reconnect() {
    if (this.reconnectPromise || !this.savedSession) return;
    const lifecycle = this.lifecycle;
    const operation = (async () => {
      for (let attempt = 0; attempt < this.maxReconnectAttempts; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, this.reconnectDelayMs));
        if (lifecycle !== this.lifecycle || this.intentionalClose || !this.savedSession) return;
        try {
          const resumed = await this.resumeSavedRoom();
          if (lifecycle !== this.lifecycle) return;
          this.#emit({ type: "reconnected", room: resumed });
          return;
        } catch (error) {
          if (lifecycle !== this.lifecycle || this.intentionalClose) return;
          if (TERMINAL_RESUME_ERRORS.has(error.code)) {
            return;
          }
          if (error.code === "account-mismatch") {
            this.#emit({ type: "reconnect-failed", code: error.code });
            return;
          }
        }
      }
      // A failed transport is not proof that the server's grace period expired.
      this.#emit({ type: "reconnect-failed", code: "connection-failed" });
    })().finally(() => {
      if (this.reconnectPromise === operation) this.reconnectPromise = null;
    });
    this.reconnectPromise = operation;
  }

  #saveSession(message) {
    if (typeof message.roomCode !== "string"
      || typeof message.playerToken !== "string"
      || (message.side !== null && !["X", "O"].includes(message.side))) return;
    this.session = {
        roomCode: message.roomCode,
        playerToken: message.playerToken,
        side: message.side ?? null
    };
    try {
      this.storage?.setItem(`${SESSION_STORAGE_KEY}:${message.roomCode}`, JSON.stringify(this.session));
      this.storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.session));
    } catch {
      this.#emit({ type: "session-storage-unavailable" });
    }
  }

  #updateSavedSide(message) {
    if (typeof message.roomCode !== "string"
      || (message.side !== null && !["X", "O"].includes(message.side))) return;
    const previous = this.session;
    if (!previous || previous.roomCode !== message.roomCode) return;
    this.session = { ...previous, side: message.side ?? null };
    try {
      this.storage?.setItem(`${SESSION_STORAGE_KEY}:${message.roomCode}`, JSON.stringify(this.session));
      const latest = safeParseSession(this.storage);
      if (latest?.playerToken === previous.playerToken) this.storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.session));
    } catch {
      this.#emit({ type: "session-storage-unavailable" });
    }
  }

  #clearSavedSession() {
    const previous = this.session;
    this.session = null;
    if (!previous) return;
    try {
      const latest = safeParseSession(this.storage);
      if (latest?.playerToken === previous.playerToken) this.storage?.removeItem(SESSION_STORAGE_KEY);
      const key = `${SESSION_STORAGE_KEY}:${previous.roomCode}`;
      if (safeParseSession(this.storage, key)?.playerToken === previous.playerToken) this.storage?.removeItem(key);
    } catch { /* Session can still end when storage is disabled. */ }
  }

  #rejectPending(error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  #nextRequestId() {
    this.requestNumber += 1;
    return `ui-${this.requestNumber}`;
  }

  #emit(event) {
    for (const listener of this.listeners) listener(event);
  }
}
