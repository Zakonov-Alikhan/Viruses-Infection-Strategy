import { createServer } from "node:http";
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
        if (!exactKeys(message, ["type", "requestId"])) return sendError(socket, "invalid-message", message.requestId);
        if (context) return sendError(socket, "already-in-room", message.requestId);
        if (!createLimiter.allow(clientAddress)) return sendError(socket, "rate-limited", message.requestId);
        const created = roomManager.createRoom();
        if (!created.ok) return sendError(socket, created.error.code, message.requestId);
        const attached = roomManager.attachConnection(created.roomCode, created.side, (outgoing) => {
          safeJsonSend(socket, outgoing, attached.connection);
        });
        if (!attached.ok) return sendError(socket, attached.error.code, message.requestId);
        contexts.set(socket, {
          roomCode: created.roomCode,
          side: created.side,
          connection: attached.connection
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
        const attached = roomManager.attachConnection(joined.roomCode, joined.side, (outgoing) => {
          safeJsonSend(socket, outgoing, attached.connection);
        });
        if (!attached.ok) return sendError(socket, attached.error.code, message.requestId);
        contexts.set(socket, {
          roomCode: joined.roomCode,
          side: joined.side,
          connection: attached.connection
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
          side: resumed.side,
          connection: resumed.connection
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
        roomManager.submitCommand(context.roomCode, context.side, message.command).then((result) => {
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

      sendError(socket, "unknown-message-type", message.requestId);
    });

    socket.on("close", () => {
      const context = contexts.get(socket);
      if (context) roomManager.detachConnection(context.roomCode, context.side, context.connection);
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
