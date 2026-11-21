import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { RoomManager } from "./rooms.js";
import { clearSessionCookie, readSessionCookie, sessionCookie } from "./accounts.js";

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);
const VERSIONED_MESSAGE_TYPES = new Set([
  "room-created", "room-joined", "room-resumed", "room-ready", "state"
]);
const DEFAULT_ROOM_CREATE_LIMIT = Object.freeze({ max: 5, windowMs: 10 * 60_000 });
const DEFAULT_ROOM_JOIN_LIMIT = Object.freeze({ max: 30, windowMs: 60_000 });
const DEFAULT_AIM_UPDATE_LIMIT = Object.freeze({ max: 30, windowMs: 1_000 });
const DEFAULT_TIME_BOOST_LIMIT = Object.freeze({ max: 4, windowMs: 60_000 });
const DEFAULT_ADMIN_AUTH_LIMIT = Object.freeze({ max: 6, windowMs: 10 * 60_000 });
const DEFAULT_LOGIN_LIMIT = Object.freeze({ max: 10, windowMs: 15 * 60_000 });
const DEFAULT_REGISTER_LIMIT = Object.freeze({ max: 4, windowMs: 60 * 60_000 });

class FixedWindowRateLimiter {
  constructor({ max, windowMs, now, maxKeys = 10_000 }) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.maxKeys = maxKeys;
    this.windows = new Map();
  }

  allow(key) {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || now >= window.resetAt) {
      if (this.windows.size >= this.maxKeys) this.#prune(now);
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    if (window.count >= this.max) return false;
    window.count += 1;
    return true;
  }

  #prune(now) {
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) this.windows.delete(key);
    }
    while (this.windows.size >= this.maxKeys) {
      this.windows.delete(this.windows.keys().next().value);
    }
  }
}

function getClientAddress(request, trustProxy) {
  if (trustProxy) {
    const forwardedFor = request.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
      return forwardedFor.split(",", 1)[0].trim();
    }
  }
  return request.socket.remoteAddress || "unknown";
}

function exactKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function matchesAdminSecret(supplied, configured) {
  if (typeof supplied !== "string" || typeof configured !== "string" || !configured) return false;
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const configuredBytes = Buffer.from(configured, "utf8");
  return suppliedBytes.length === configuredBytes.length && timingSafeEqual(suppliedBytes, configuredBytes);
}

function isValidRequestId(requestId) {
  return requestId === undefined
    || (typeof requestId === "string" && requestId.length > 0 && requestId.length <= 64);
}

function safeJsonSend(socket, message, connection = null) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  if (connection && VERSIONED_MESSAGE_TYPES.has(message.type)) {
    if (!Number.isSafeInteger(message.version)
      || (!["room-ready", "room-resumed"].includes(message.type) && message.version <= connection.lastSentVersion)
      || message.version < connection.lastSentVersion) return false;
  }
  try {
    socket.send(JSON.stringify(message));
    if (connection && VERSIONED_MESSAGE_TYPES.has(message.type)) {
      connection.lastSentVersion = message.version;
    }
    if (message.type === "room-closed") socket.close(4001, message.reason);
    if (message.type === "session-replaced") socket.close(4002, "session-replaced");
    return true;
  } catch {
    return false;
  }
}

function sendError(socket, code, requestId) {
  const message = { type: "server-error", code };
  if (requestId !== undefined) message.requestId = requestId;
  safeJsonSend(socket, message);
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request, maxBytes = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("payload-too-large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw Object.assign(new Error("invalid-json"), { status: 400 });
  }
}

export function createMultiplayerServer({
  roomManager = new RoomManager(),
  host = "127.0.0.1",
  port = 3001,
  path = "/ws",
  maxPayload = 8 * 1024,
  cleanupIntervalMs = 30_000,
  heartbeatIntervalMs = 30_000,
  allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
  trustProxy = false,
  roomCreationRateLimit = DEFAULT_ROOM_CREATE_LIMIT,
  roomJoinRateLimit = DEFAULT_ROOM_JOIN_LIMIT,
  aimUpdateRateLimit = DEFAULT_AIM_UPDATE_LIMIT,
  timeBoostRateLimit = DEFAULT_TIME_BOOST_LIMIT,
  adminAuthRateLimit = DEFAULT_ADMIN_AUTH_LIMIT,
  loginRateLimit = DEFAULT_LOGIN_LIMIT,
  registerRateLimit = DEFAULT_REGISTER_LIMIT,
  adminSecret = null,
  accountStore = null,
  now = Date.now
} = {}) {
  const httpServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ok", service: "viruses-multiplayer" }));
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/api/rooms")) {
      const origin = request.headers.origin;
      if (typeof origin !== "string" || !allowedOrigins?.has(origin)) {
        return sendJson(response, 403, { error: "origin-not-allowed" });
      }
      const pathname = new URL(request.url, "http://localhost").pathname;
      const rooms = roomManager.listRoomCatalog?.() ?? [];
      if (pathname === "/api/rooms") {
        return sendJson(response, 200, { rooms }, { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" });
      }
      const match = pathname.match(/^\/api\/rooms\/([0-9a-f-]{36})$/i);
      if (match) {
        const room = rooms.find((entry) => entry.id === match[1]);
        return sendJson(response, room ? 200 : 404, room ? { room } : { error: "room-not-found" }, {
          "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin"
        });
      }
      return sendJson(response, 404, { error: "not-found" });
    }
    if (request.url?.startsWith("/api/")) {
      void handleAccountApi(request, response);
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not-found" }));
  });
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload,
    perMessageDeflate: false
  });
  const contexts = new WeakMap();
  const createLimiter = new FixedWindowRateLimiter({ ...roomCreationRateLimit, now });
  const joinLimiter = new FixedWindowRateLimiter({ ...roomJoinRateLimit, now });
  const aimLimiter = new FixedWindowRateLimiter({ ...aimUpdateRateLimit, now });
  const timeBoostLimiter = new FixedWindowRateLimiter({ ...timeBoostRateLimit, now });
  const adminAuthLimiter = new FixedWindowRateLimiter({ ...adminAuthRateLimit, now });
  const loginLimiter = new FixedWindowRateLimiter({ ...loginRateLimit, now });
  const registerLimiter = new FixedWindowRateLimiter({ ...registerRateLimit, now });
  let cleanupTimer = null;
  let heartbeatTimer = null;
  let closing = false;

  async function handleAccountApi(request, response) {
    const origin = request.headers.origin;
    const allowOrigin = typeof origin === "string" && allowedOrigins?.has(origin);
    const corsHeaders = allowOrigin ? {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, X-CW-Request",
      "access-control-max-age": "600",
      vary: "Origin"
    } : {};
    if (!allowOrigin) return sendJson(response, 403, { error: "origin-not-allowed" });
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }
    const address = getClientAddress(request, trustProxy);
    const pathName = new URL(request.url, "http://localhost").pathname;
    try {
      if (!accountStore) return sendJson(response, 503, { error: "accounts-unavailable" }, corsHeaders);
      if (request.method === "GET" && pathName === "/api/leaderboard") {
        return sendJson(response, 200, { entries: await accountStore.leaderboard() }, corsHeaders);
      }
      const token = readSessionCookie(request.headers.cookie);
      if (request.method === "GET" && pathName === "/api/me") {
        const account = token ? await accountStore.getSession(token) : null;
        return sendJson(response, 200, { account }, corsHeaders);
      }
      if (request.method !== "POST") return sendJson(response, 404, { error: "not-found" }, corsHeaders);
      if (request.headers["x-cw-request"] !== "1" || !String(request.headers["content-type"] || "").startsWith("application/json")) {
        return sendJson(response, 403, { error: "request-verification-failed" }, corsHeaders);
      }
      if (pathName === "/api/auth/logout") {
        if (token) await accountStore.deleteSession(token);
        return sendJson(response, 200, { ok: true }, { ...corsHeaders, "set-cookie": clearSessionCookie() });
      }
      if (pathName !== "/api/auth/register" && pathName !== "/api/auth/login") {
        return sendJson(response, 404, { error: "not-found" }, corsHeaders);
      }
      const registering = pathName.endsWith("/register");
      const limiter = registering ? registerLimiter : loginLimiter;
      if (!limiter.allow(address)) return sendJson(response, 429, { error: "rate-limited" }, corsHeaders);
      const body = await readJsonBody(request);
      if (Object.keys(body).some((key) => !["username", "password"].includes(key))
        || typeof body.username !== "string" || typeof body.password !== "string") {
        return sendJson(response, 400, { error: "invalid-request" }, corsHeaders);
      }
      let account;
      if (registering) {
        const result = await accountStore.register(body);
        if (!result.ok) return sendJson(response, result.code === "username-taken" ? 409 : 400, { error: result.code }, corsHeaders);
        account = result.account;
      } else {
        account = await accountStore.authenticate(body);
        if (!account) return sendJson(response, 401, { error: "invalid-credentials" }, corsHeaders);
      }
      if (token) await accountStore.deleteSession(token);
      const freshToken = await accountStore.createSession(account.id);
      const safeAccount = await accountStore.getSession(freshToken);
      return sendJson(response, registering ? 201 : 200, { account: safeAccount }, {
        ...corsHeaders,
        "set-cookie": sessionCookie(freshToken)
      });
    } catch (error) {
      if (error?.status) return sendJson(response, error.status, { error: error.message }, corsHeaders);
      // Do not log request bodies, credentials, cookies, or database error details.
      return sendJson(response, 500, { error: "server-error" }, corsHeaders);
    }
  }

  httpServer.on("upgrade", (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    if (pathname !== path || !origin
      || (allowedOrigins !== null && !allowedOrigins.has(origin))) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    void (async () => {
      try {
        const token = readSessionCookie(request.headers.cookie);
        const identity = token && accountStore ? await accountStore.getSession(token) : null;
        if (socket.destroyed) return;
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          webSocketServer.emit("connection", webSocket, request, identity);
        });
      } catch {
        socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
        socket.destroy();
      }
    })();
  });

  roomManager.setMatchFinishedHandler?.((match) => accountStore?.recordRatedMatch(match));
  roomManager.setMatchStartedHandler?.(async (accountIds) => accountStore?.getRatings(accountIds) ?? {});

  webSocketServer.on("connection", (socket, request, identity = null) => {
    socket.on("error", () => {});
    socket.isAlive = true;
    socket.on("pong", () => { socket.isAlive = true; });
    const clientAddress = getClientAddress(request, trustProxy);
    socket.on("message", async (raw, isBinary) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (isBinary) {
        sendError(socket, "binary-message-not-supported");
        return;
      }

      let message;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        sendError(socket, "invalid-json");
        return;
      }
      if (!message || typeof message !== "object" || Array.isArray(message)
        || typeof message.type !== "string" || !isValidRequestId(message.requestId)) {
        sendError(socket, "invalid-message");
        return;
      }

      const context = contexts.get(socket);
      if (context?.pending) return sendError(socket, "room-joining", message.requestId);
      if (context?.connection && !roomManager.isCurrentConnection(context.roomCode, context.connection)) {
        return sendError(socket, "session-replaced", message.requestId);
      }
      if (context?.observer && !["command", "admin-time"].includes(message.type)) {
        return sendError(socket, "spectator-read-only", message.requestId);
      }
      if (message.type === "create-room") {
        if (!exactKeys(message, ["type", "settings", "publicRoom", "requestId"])
          || (message.publicRoom !== undefined && typeof message.publicRoom !== "boolean")) return sendError(socket, "invalid-message", message.requestId);
        if (context) return sendError(socket, "already-in-room", message.requestId);
        if (!createLimiter.allow(clientAddress)) return sendError(socket, "rate-limited", message.requestId);
        const created = roomManager.createRoom(message.settings, { accountId: identity?.id ?? null });
        if (!created.ok) return sendError(socket, created.error.code, message.requestId);
        roomManager.setRoomVisibility?.(created.roomCode, message.publicRoom === true);
        const attached = roomManager.attachConnection(created.roomCode, created.seatKey, (outgoing) => {
          safeJsonSend(socket, outgoing, attached.connection);
        });
        if (!attached.ok) return sendError(socket, attached.error.code, message.requestId);
        contexts.set(socket, {
          roomCode: created.roomCode,
          connection: attached.connection,
          isAdmin: false
        });
        safeJsonSend(socket, {
          type: "room-created",
          roomCode: created.roomCode,
          side: created.side,
          playerToken: created.playerToken,
          status: created.status,
          version: created.version,
          state: created.state,
          history: created.history,
          clock: created.clock,
          undoAvailable: created.undoAvailable,
          undoProposal: created.undoProposal,
          requestId: message.requestId
        }, attached.connection);
        return;
      }

      if (message.type === "join-room") {
        if (!exactKeys(message, ["type", "code", "requestId"]) || typeof message.code !== "string") {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (context) return sendError(socket, "already-in-room", message.requestId);
        if (!joinLimiter.allow(clientAddress)) return sendError(socket, "rate-limited", message.requestId);
        contexts.set(socket, { pending: true });
        const accountIds = [...new Set([...(roomManager.getParticipantAccountIds?.(message.code) ?? []), identity?.id].filter(Boolean))];
        if (socket.readyState !== WebSocket.OPEN) {
          contexts.delete(socket);
          return;
        }
        let ratingsByAccount = {};
        try {
          if (accountStore && accountIds.length) ratingsByAccount = await accountStore.getRatings(accountIds);
        } catch {
          contexts.delete(socket);
          return sendError(socket, "account-service-unavailable", message.requestId);
        }
        if (socket.readyState !== WebSocket.OPEN) { contexts.delete(socket); return; }
        const joined = roomManager.joinRoom(message.code, {
          accountId: identity?.id ?? null,
          ratingsByAccount
        });
        if (!joined.ok) {
          contexts.delete(socket);
          return sendError(socket, joined.error.code, message.requestId);
        }
        const attached = roomManager.attachConnection(joined.roomCode, joined.seatKey, (outgoing) => {
          safeJsonSend(socket, outgoing, attached.connection);
        });
        if (!attached.ok) {
          contexts.delete(socket);
          return sendError(socket, attached.error.code, message.requestId);
        }
        contexts.set(socket, {
          roomCode: joined.roomCode,
          connection: attached.connection,
          isAdmin: false
        });
        safeJsonSend(socket, {
          type: "room-joined",
          roomCode: joined.roomCode,
          side: joined.side,
          playerToken: joined.playerToken,
          status: joined.status,
          version: joined.version,
          state: joined.state,
          history: joined.history,
          clock: joined.clock,
          undoAvailable: joined.undoAvailable,
          undoProposal: joined.undoProposal,
          requestId: message.requestId
        }, attached.connection);
        roomManager.broadcastReady(joined.roomCode);
        return;
      }

      if (message.type === "join-public-room") {
        if (!exactKeys(message, ["type", "roomId", "requestId"]) || typeof message.roomId !== "string") {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (context) return sendError(socket, "already-in-room", message.requestId);
        if (!joinLimiter.allow(clientAddress)) return sendError(socket, "rate-limited", message.requestId);
        const catalogRoom = roomManager.resolveCatalogRoom(message.roomId);
        if (!catalogRoom || !catalogRoom.publicRoom) return sendError(socket, "room-not-public", message.requestId);
        contexts.set(socket, { pending: true });
        const accountIds = [...new Set([...(roomManager.getParticipantAccountIds(catalogRoom.code) ?? []), identity?.id].filter(Boolean))];
        let ratingsByAccount = {};
        try {
          if (accountStore && accountIds.length) ratingsByAccount = await accountStore.getRatings(accountIds);
        } catch {
          contexts.delete(socket);
          return sendError(socket, "account-service-unavailable", message.requestId);
        }
        if (socket.readyState !== WebSocket.OPEN) { contexts.delete(socket); return; }
        const joined = roomManager.joinRoom(catalogRoom.code, { accountId: identity?.id ?? null, ratingsByAccount });
        if (!joined.ok) { contexts.delete(socket); return sendError(socket, joined.error.code, message.requestId); }
        const attached = roomManager.attachConnection(joined.roomCode, joined.seatKey, (outgoing) => {
          safeJsonSend(socket, outgoing, attached.connection);
        });
        if (!attached.ok) { contexts.delete(socket); return sendError(socket, attached.error.code, message.requestId); }
        contexts.set(socket, { roomCode: joined.roomCode, connection: attached.connection, isAdmin: false });
        safeJsonSend(socket, {
          type: "room-joined", roomCode: joined.roomCode, side: joined.side,
          playerToken: joined.playerToken, status: joined.status, version: joined.version,
          state: joined.state, history: joined.history, clock: joined.clock,
          undoAvailable: joined.undoAvailable, undoProposal: joined.undoProposal, requestId: message.requestId
        }, attached.connection);
        roomManager.broadcastReady(joined.roomCode);
        return;
      }

      if (message.type === "resume-room") {
        if (!exactKeys(message, ["type", "code", "playerToken", "replaceExisting", "requestId"])
          || typeof message.code !== "string" || typeof message.playerToken !== "string"
          || (message.replaceExisting !== undefined && typeof message.replaceExisting !== "boolean")) {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (context && (context.observer || context.roomCode !== message.code.trim().toUpperCase())) {
          return sendError(socket, "already-in-room", message.requestId);
        }
        const resumed = roomManager.resumeRoom(message.code, message.playerToken, (outgoing) => {
          safeJsonSend(socket, outgoing, resumed.connection);
        }, {
          accountId: identity?.id ?? null, connection: context?.connection,
          // Legacy clients do not understand session-replaced and would
          // otherwise reconnect forever, stealing the seat back and forth.
          replaceExisting: message.replaceExisting === true
        });
        if (!resumed.ok) return sendError(socket, resumed.error.code, message.requestId);
        contexts.set(socket, {
          roomCode: resumed.roomCode,
          connection: resumed.connection,
          isAdmin: false
        });
        safeJsonSend(socket, {
          type: "room-resumed",
          roomCode: resumed.roomCode,
          side: resumed.side,
          status: resumed.status,
          version: resumed.version,
          state: resumed.state,
          history: resumed.history,
          clock: resumed.clock,
          undoAvailable: resumed.undoAvailable,
          undoProposal: resumed.undoProposal,
          requestId: message.requestId
        }, resumed.connection);
        return;
      }

      if (message.type === "observe-room") {
        if (!exactKeys(message, ["type", "roomId", "adminSecret", "requestId"])
          || typeof message.roomId !== "string"
          || (message.adminSecret !== undefined && (typeof message.adminSecret !== "string" || message.adminSecret.length > 512))) {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (context) return sendError(socket, "already-in-room", message.requestId);
        const isAdmin = matchesAdminSecret(message.adminSecret, adminSecret);
        if (message.adminSecret && !isAdmin) return sendError(socket, "admin-auth-failed", message.requestId);
        const observed = roomManager.attachObserver(message.roomId, {
          isAdmin,
          send: (outgoing) => safeJsonSend(socket, outgoing)
        });
        if (!observed.ok) return sendError(socket, observed.error.code, message.requestId);
        contexts.set(socket, {
          observer: true,
          isAdminObserver: isAdmin,
          roomId: observed.roomId,
          roomCode: roomManager.resolveCatalogRoom(observed.roomId)?.code,
          observerId: observed.observerId
        });
        safeJsonSend(socket, {
          type: "observing-room", roomId: observed.roomId, status: observed.status,
          version: observed.version, state: observed.state, clock: observed.clock,
          settings: observed.settings, isAdmin, requestId: message.requestId
        });
        return;
      }

      if (message.type === "command") {
        if (!exactKeys(message, ["type", "command", "requestId"]) || !message.command
          || typeof message.command !== "object" || Array.isArray(message.command)) {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (!context) return sendError(socket, "not-in-room", message.requestId);
        if (context.observer && !context.isAdminObserver) return sendError(socket, "spectator-read-only", message.requestId);
        if (context.isAdminObserver && !["board-edit", "select-ability", "ability-target", "place"].includes(message.command.type)) {
          return sendError(socket, "admin-command-not-allowed", message.requestId);
        }
        roomManager.submitCommand(context.roomCode, context.observer ? null : context.connection.side, message.command, {
          isAdmin: context.isAdmin === true || context.isAdminObserver === true,
          adminObserverId: context.isAdminObserver ? context.observerId : null,
          connection: context.connection
        }).then((result) => {
          if (!result.ok && socket.readyState === WebSocket.OPEN) {
            safeJsonSend(socket, {
              type: "command-error",
              code: result.error.code,
              version: result.version,
              requestId: message.requestId
            });
          }
        }).catch(() => sendError(socket, "command-failed", message.requestId));
        return;
      }

      if (message.type === "opponent-time") {
        if (!exactKeys(message, ["type", "requestId"])) return sendError(socket, "invalid-message", message.requestId);
        if (!context || context.observer) return sendError(socket, "not-a-player", message.requestId);
        if (!timeBoostLimiter.allow(clientAddress)) return sendError(socket, "rate-limited", message.requestId);
        roomManager.addOpponentTime(context.roomCode, context.connection.side).then((result) => {
          if (!result.ok) return sendError(socket, result.error.code, message.requestId);
          safeJsonSend(socket, { type: "opponent-time-added", roomCode: context.roomCode, requestId: message.requestId });
        }).catch(() => sendError(socket, "time-update-failed", message.requestId));
        return;
      }

      if (message.type === "admin-time") {
        if (!exactKeys(message, ["type", "target", "seconds", "requestId"])
          || !["both", "X", "O"].includes(message.target)
          || !Number.isInteger(message.seconds) || message.seconds < 1 || message.seconds > 600) {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (!context || !(context.isAdmin || context.isAdminObserver)) return sendError(socket, "admin-required", message.requestId);
        if (!timeBoostLimiter.allow(clientAddress)) return sendError(socket, "rate-limited", message.requestId);
        roomManager.addAdminTime(context.roomId || roomManager.resolveCatalogRoom(context.roomCode)?.catalogId, message.target, message.seconds)
          .then((result) => {
            if (!result.ok) return sendError(socket, result.error.code, message.requestId);
            safeJsonSend(socket, { type: "admin-time-recorded", roomId: context.roomId, requestId: message.requestId });
          }).catch(() => sendError(socket, "time-update-failed", message.requestId));
        return;
      }

      if (message.type === "admin-auth") {
        if (!exactKeys(message, ["type", "secret", "requestId"])
          || typeof message.secret !== "string" || message.secret.length < 1 || message.secret.length > 512) {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (!context || context.observer) return sendError(socket, "not-in-room", message.requestId);
        if (!adminAuthLimiter.allow(clientAddress)) return sendError(socket, "rate-limited", message.requestId);
        if (!matchesAdminSecret(message.secret, adminSecret)) return sendError(socket, "admin-auth-failed", message.requestId);
        context.isAdmin = true;
        safeJsonSend(socket, { type: "admin-authenticated", roomCode: context.roomCode, requestId: message.requestId });
        return;
      }

      if (message.type === "restart-propose") {
        const expected = message.kind === "settings"
          ? ["type", "kind", "settings", "requestId"]
          : ["type", "kind", "requestId"];
        if (!exactKeys(message, expected) || !["settings", "rematch"].includes(message.kind)
          || (message.kind === "settings" && (!message.settings || typeof message.settings !== "object" || Array.isArray(message.settings)))) {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (!context) return sendError(socket, "not-in-room", message.requestId);
        roomManager.proposeRestart(context.roomCode, context.connection.side, message.kind, message.settings)
          .then((result) => {
            if (!result.ok) return sendError(socket, result.error.code, message.requestId);
            safeJsonSend(socket, {
              type: "restart-proposal-created",
              roomCode: context.roomCode,
              proposalId: result.proposalId,
              kind: result.kind,
              requestId: message.requestId
            });
          }).catch(() => sendError(socket, "restart-failed", message.requestId));
        return;
      }

      if (message.type === "restart-vote") {
        if (!exactKeys(message, ["type", "proposalId", "accept", "requestId"])
          || typeof message.proposalId !== "string" || typeof message.accept !== "boolean") {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (!context) return sendError(socket, "not-in-room", message.requestId);
        roomManager.voteRestart(context.roomCode, context.connection.side, message.proposalId, message.accept)
          .then((result) => {
            if (!result.ok) return sendError(socket, result.error.code, message.requestId);
            safeJsonSend(socket, {
              type: "restart-vote-recorded",
              roomCode: context.roomCode,
              accepted: result.accepted,
              version: result.version,
              requestId: message.requestId
            });
          }).catch(() => sendError(socket, "restart-failed", message.requestId));
        return;
      }

      if (message.type === "undo-propose") {
        if (!exactKeys(message, ["type", "requestId"])) return sendError(socket, "invalid-message", message.requestId);
        if (!context) return sendError(socket, "not-in-room", message.requestId);
        roomManager.proposeUndo(context.roomCode, context.connection.side)
          .then((result) => {
            if (!result.ok) return sendError(socket, result.error.code, message.requestId);
            safeJsonSend(socket, {
              type: "undo-proposal-created",
              roomCode: context.roomCode,
              proposalId: result.proposalId,
              expiresAt: result.expiresAt,
              requestId: message.requestId
            });
          }).catch(() => sendError(socket, "undo-failed", message.requestId));
        return;
      }

      if (message.type === "undo-vote") {
        if (!exactKeys(message, ["type", "proposalId", "accept", "requestId"])
          || typeof message.proposalId !== "string" || typeof message.accept !== "boolean") {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (!context) return sendError(socket, "not-in-room", message.requestId);
        roomManager.voteUndo(context.roomCode, context.connection.side, message.proposalId, message.accept)
          .then((result) => {
            if (!result.ok) return sendError(socket, result.error.code, message.requestId);
            safeJsonSend(socket, {
              type: "undo-vote-recorded",
              roomCode: context.roomCode,
              accepted: result.accepted,
              version: result.version,
              requestId: message.requestId
            });
          }).catch(() => sendError(socket, "undo-failed", message.requestId));
        return;
      }

      if (message.type === "aim") {
        if (!exactKeys(message, ["type", "row", "col"])) return sendError(socket, "invalid-message");
        if (!context) return sendError(socket, "not-in-room");
        const clearing = message.row === null && message.col === null;
        if (!clearing && (!Number.isInteger(message.row) || !Number.isInteger(message.col))) {
          return sendError(socket, "invalid-coordinate");
        }
        if (!clearing && !aimLimiter.allow(clientAddress)) return;
        const result = roomManager.updateAim(context.roomCode, context.connection.side,
          clearing ? null : { row: message.row, col: message.col });
        if (!result.ok) sendError(socket, result.error.code);
        return;
      }

      sendError(socket, "unknown-message-type", message.requestId);
    });

    socket.on("close", () => {
      const context = contexts.get(socket);
      if (context?.observer) roomManager.detachObserver(context.roomId, context.observerId);
      else if (context?.connection) roomManager.detachConnection(context.roomCode, context.connection.side, context.connection);
      contexts.delete(socket);
    });
  });

  webSocketServer.on("error", (error) => {
    if (!closing) httpServer.emit("error", error);
  });

  return {
    httpServer,
    webSocketServer,
    roomManager,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          httpServer.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          httpServer.off("error", onError);
          if (cleanupIntervalMs > 0) {
            cleanupTimer = setInterval(() => roomManager.sweepExpiredRooms(), cleanupIntervalMs);
            cleanupTimer.unref?.();
          }
          if (heartbeatIntervalMs > 0) {
            heartbeatTimer = setInterval(() => {
              for (const socket of webSocketServer.clients) {
                if (!socket.isAlive) { socket.terminate(); continue; }
                socket.isAlive = false;
                if (socket.readyState === WebSocket.OPEN) socket.ping();
              }
            }, heartbeatIntervalMs);
            heartbeatTimer.unref?.();
          }
          resolve(httpServer.address());
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(port, host);
      });
    },
    close() {
      closing = true;
      if (cleanupTimer) clearInterval(cleanupTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      roomManager.stopAllClocks?.();
      for (const socket of webSocketServer.clients) socket.close(1001, "server-shutdown");
      return new Promise((resolve) => {
        const closeStore = () => Promise.resolve(accountStore?.close?.()).then(resolve, resolve);
        const closeHttp = () => {
          if (!httpServer.listening) return closeStore();
          httpServer.close(closeStore);
        };
        webSocketServer.close(closeHttp);
      });
    }
  };
}
