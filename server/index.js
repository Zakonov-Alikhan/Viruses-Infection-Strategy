import { pathToFileURL } from "node:url";
import { createMultiplayerServer } from "./websocket.js";

function parsePort(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port ${JSON.stringify(value)}; expected a number from 1 to 65535`);
  }
  return port;
}

export function parseAllowedOrigins(value, { production = false } = {}) {
  if (value === undefined) {
    if (production) throw new Error("Set MULTIPLAYER_ALLOWED_ORIGINS to the public web app origin");
    return new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
  }

  const origins = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (production && origins.length === 0) {
    throw new Error("MULTIPLAYER_ALLOWED_ORIGINS must contain the public web app origin");
  }
  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid origin in MULTIPLAYER_ALLOWED_ORIGINS: ${origin}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error(`Origins must be exact http(s) origins without paths: ${origin}`);
    }
  }
  return new Set(origins);
}

export function startMultiplayerServer({
  port = parsePort(process.env.MULTIPLAYER_PORT || process.env.PORT, 3001),
  host = process.env.MULTIPLAYER_HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
  allowedOrigins = parseAllowedOrigins(process.env.MULTIPLAYER_ALLOWED_ORIGINS, {
    production: process.env.NODE_ENV === "production"
  }),
  trustProxy = process.env.MULTIPLAYER_TRUST_PROXY === "true",
  adminSecret = process.env.MULTIPLAYER_ADMIN_SECRET || null
} = {}) {
  const server = createMultiplayerServer({ port, host, allowedOrigins, trustProxy, adminSecret });
  return server.listen().then((address) => {
    console.log(`Multiplayer WebSocket listening on ${address.address}:${address.port} at /ws`);
    return server;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMultiplayerServer().catch((error) => {
    console.error("Could not start multiplayer server:", error);
    process.exitCode = 1;
  });
}
