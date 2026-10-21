import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { RoomManager } from "./rooms.js";

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
const DEFAULT_ADMIN_AUTH_LIMIT = Object.freeze({ max: 6, windowMs: 10 * 60_000 });

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
      || (message.type !== "room-ready" && message.version <= connection.lastSentVersion)) return false;
  }
  try {
    socket.send(JSON.stringify(message));
    if (connection && VERSIONED_MESSAGE_TYPES.has(message.type)) {
      connection.lastSentVersion = message.version;
    }
    if (message.type === "room-closed") socket.close(4001, message.reason);
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

export function createMultiplayerServer({
  roomManager = new RoomManager(),
  host = "127.0.0.1",
  port = 3001,
  path = "/ws",
  maxPayload = 8 * 1024,
  cleanupIntervalMs = 30_000,
  allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
  trustProxy = false,
  roomCreationRateLimit = DEFAULT_ROOM_CREATE_LIMIT,
  roomJoinRateLimit = DEFAULT_ROOM_JOIN_LIMIT,
  aimUpdateRateLimit = DEFAULT_AIM_UPDATE_LIMIT,
  adminAuthRateLimit = DEFAULT_ADMIN_AUTH_LIMIT,
  adminSecret = null,
  now = Date.now
} = {}) {
  const httpServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ok", service: "viruses-multiplayer" }));
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
  const adminAuthLimiter = new FixedWindowRateLimiter({ ...adminAuthRateLimit, now });
  let cleanupTimer = null;
  let closing = false;

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
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (socket, request) => {
    socket.on("error", () => {});
    const clientAddress = getClientAddress(request, trustProxy);
    socket.on("message", (raw, isBinary) => {
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
      if (message.type === "create-room") {
        if (!exactKeys(message, ["type", "settings", "requestId"])) return sendError(socket, "invalid-message", message.requestId);
        if (context) return sendError(socket, "already-in-room", message.requestId);
        if (!createLimiter.allow(clientAddress)) return sendError(socket, "rate-limited", message.requestId);
        const created = roomManager.createRoom(message.settings);
        if (!created.ok) return sendError(socket, created.error.code, message.requestId);
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
          clock: created.clock,
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
        const joined = roomManager.joinRoom(message.code);
        if (!joined.ok) return sendError(socket, joined.error.code, message.requestId);
        const attached = roomManager.attachConnection(joined.roomCode, joined.seatKey, (outgoing) => {
          safeJsonSend(socket, outgoing, attached.connection);
        });
        if (!attached.ok) return sendError(socket, attached.error.code, message.requestId);
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
          clock: joined.clock,
          requestId: message.requestId
        }, attached.connection);
        roomManager.broadcastReady(joined.roomCode);
        return;
      }

      if (message.type === "resume-room") {
        if (!exactKeys(message, ["type", "code", "playerToken", "requestId"])
          || typeof message.code !== "string" || typeof message.playerToken !== "string") {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (context) return sendError(socket, "already-in-room", message.requestId);
        const resumed = roomManager.resumeRoom(message.code, message.playerToken, (outgoing) => {
          safeJsonSend(socket, outgoing, resumed.connection);
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
          clock: resumed.clock,
          requestId: message.requestId
        }, resumed.connection);
        return;
      }

      if (message.type === "command") {
        if (!exactKeys(message, ["type", "command", "requestId"]) || !message.command
          || typeof message.command !== "object" || Array.isArray(message.command)) {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (!context) return sendError(socket, "not-in-room", message.requestId);
        roomManager.submitCommand(context.roomCode, context.connection.side, message.command, {
          isAdmin: context.isAdmin === true
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

      if (message.type === "admin-auth") {
        if (!exactKeys(message, ["type", "secret", "requestId"])
          || typeof message.secret !== "string" || message.secret.length < 1 || message.secret.length > 512) {
          return sendError(socket, "invalid-message", message.requestId);
        }
        if (!context) return sendError(socket, "not-in-room", message.requestId);
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
      if (context) roomManager.detachConnection(context.roomCode, context.connection.side, context.connection);
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
      roomManager.stopAllClocks?.();
      for (const socket of webSocketServer.clients) socket.close(1001, "server-shutdown");
      return new Promise((resolve) => {
        const closeHttp = () => {
          if (!httpServer.listening) return resolve();
          httpServer.close(() => resolve());
        };
        webSocketServer.close(closeHttp);
      });
    }
  };
}
