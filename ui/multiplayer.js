const SESSION_STORAGE_KEY = "viruses.online-room";
const REQUEST_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 1_200;
const MAX_RECONNECT_ATTEMPTS = 110;
const VERSIONED_TYPES = new Set(["room-created", "room-joined", "room-resumed", "room-ready", "state"]);
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
  try {
    const persistent = globalThis.localStorage;
    const legacySession = globalThis.sessionStorage;
    if (persistent) {
      if (!persistent.getItem(SESSION_STORAGE_KEY) && legacySession?.getItem(SESSION_STORAGE_KEY)) {
        persistent.setItem(SESSION_STORAGE_KEY, legacySession.getItem(SESSION_STORAGE_KEY));
        legacySession.removeItem(SESSION_STORAGE_KEY);
      }
      return persistent;
    }
    return legacySession ?? null;
  } catch {
    return null;
  }
}

function safeParseSession(storage) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(SESSION_STORAGE_KEY) || "null");
    if (typeof value?.roomCode !== "string" || typeof value?.playerToken !== "string"
      || !["X", "O"].includes(value.side)) return null;
    return { roomCode: value.roomCode, playerToken: value.playerToken, side: value.side };
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
    this.requestTimeoutMs = requestTimeoutMs;
    this.reconnectDelayMs = reconnectDelayMs;
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.listeners = new Set();
    this.pendingRequests = new Map();
    this.socket = null;
    this.connectPromise = null;
    this.reconnectPromise = null;
    this.intentionalClose = false;
    this.requestNumber = 0;
    this.lastVersion = -1;
    this.lastRoomSnapshot = null;
    this.seenVisualEventIds = new Set();
  }

  get connected() {
    return Boolean(this.socket && this.socket.readyState === this.WebSocketImpl.OPEN);
  }

  get savedSession() {
    return safeParseSession(this.storage);
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
      const onOpen = () => {
        opened = true;
        this.connectPromise = null;
        this.#emit({ type: "transport-open" });
        resolve(socket);
      };
      const onError = () => {
        if (!opened) {
          this.connectPromise = null;
          reject(new MultiplayerError("connection-failed"));
        } else {
          this.#emit({ type: "transport-error", code: "connection-failed" });
        }
      };
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError);
      socket.addEventListener("message", (event) => {
        if (socket === this.socket) this.#receive(event.data);
      });
      socket.addEventListener("close", (event) => this.#handleClose(socket, event));
    });
    return this.connectPromise;
  }

  async createRoom(settings) {
    await this.connect();
    return this.#request("create-room", settings ? { settings } : {}, "room-created");
  }

  async joinRoom(code) {
    await this.connect();
    return this.#request("join-room", { code: String(code).trim().toUpperCase() }, "room-joined");
  }

  async resumeSavedRoom() {
    const session = this.savedSession;
    if (!session) throw new MultiplayerError("no-saved-room");
    await this.connect();
    if (this.lastRoomSnapshot?.roomCode === session.roomCode) {
      const resumed = { ...this.lastRoomSnapshot, type: "room-resumed" };
      this.#emit(resumed);
      return resumed;
    }
    return this.#request("resume-room", {
      code: session.roomCode,
      playerToken: session.playerToken
    }, "room-resumed");
  }

  sendCommand(command) {
    if (!this.connected || !command || typeof command !== "object" || Array.isArray(command)) return false;
    const requestId = this.#nextRequestId();
    return this.#send({ type: "command", command, requestId });
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
    this.disconnect({ preserveSession: false });
    this.#emit({ type: "left-room" });
  }

  disconnect({ preserveSession = true } = {}) {
    this.intentionalClose = true;
    if (!preserveSession) {
      this.#clearSavedSession();
      this.lastRoomSnapshot = null;
      this.seenVisualEventIds.clear();
    }
    this.#rejectPending(new MultiplayerError("left-room"));
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    if (socket && socket.readyState < this.WebSocketImpl.CLOSING) socket.close(1000, "leave-room");
    if (!preserveSession) this.lastVersion = -1;
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
      if (message.version < this.lastVersion) return;
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
      this.#saveSession(message);
    } else if (message.type === "room-closed") {
      this.#clearSavedSession();
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
    this.connectPromise = null;
    this.#rejectPending(new MultiplayerError("connection-lost"));
    if (this.intentionalClose) {
      this.intentionalClose = false;
      return;
    }
    this.#emit({ type: "disconnected", code: event.code });
    if (this.savedSession) this.#reconnect();
  }

  #reconnect() {
    if (this.reconnectPromise || !this.savedSession) return;
    this.reconnectPromise = (async () => {
      for (let attempt = 0; attempt < this.maxReconnectAttempts; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, this.reconnectDelayMs));
        if (this.intentionalClose || !this.savedSession) return;
        try {
          await this.connect();
          const session = this.savedSession;
          const resumed = await this.#request("resume-room", {
            code: session.roomCode,
            playerToken: session.playerToken
          }, "room-resumed");
          this.#emit({ type: "reconnected", room: resumed });
          return;
        } catch (error) {
          if (TERMINAL_RESUME_ERRORS.has(error.code)) {
            this.#clearSavedSession();
            this.#emit({ type: "reconnect-failed", code: error.code });
            return;
          }
          if (error.code === "seat-already-connected") {
            this.#emit({ type: "reconnect-failed", code: error.code });
            return;
          }
        }
      }
      this.#clearSavedSession();
      this.#emit({ type: "reconnect-failed", code: "reconnect-expired" });
    })().finally(() => {
      this.reconnectPromise = null;
    });
  }

  #saveSession(message) {
    if (!this.storage || typeof message.roomCode !== "string"
      || typeof message.playerToken !== "string" || !["X", "O"].includes(message.side)) return;
    try {
      const previous = safeParseSession(this.storage);
      if (previous && previous.roomCode !== message.roomCode) {
        this.lastVersion = -1;
        this.lastRoomSnapshot = null;
        this.seenVisualEventIds.clear();
      }
      this.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        roomCode: message.roomCode,
        playerToken: message.playerToken,
        side: message.side
      }));
    } catch {
      this.#emit({ type: "session-storage-unavailable" });
    }
  }

  #clearSavedSession() {
    try {
      this.storage?.removeItem(SESSION_STORAGE_KEY);
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
