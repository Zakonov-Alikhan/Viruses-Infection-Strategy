import assert from "node:assert/strict";
import test from "node:test";
import { parseAllowedOrigins } from "./index.js";

test("parses exact configured HTTP origins for WebSocket checks", () => {
  assert.deepEqual(
    [...parseAllowedOrigins("https://game.example,https://preview.example")],
    ["https://game.example", "https://preview.example"]
  );
});

test("requires an explicit public origin in production", () => {
  assert.throws(() => parseAllowedOrigins(undefined, { production: true }), /MULTIPLAYER_ALLOWED_ORIGINS/);
  assert.throws(() => parseAllowedOrigins("", { production: true }), /MULTIPLAYER_ALLOWED_ORIGINS/);
});

test("rejects non-origin values and insecure public origins", () => {
  assert.throws(() => parseAllowedOrigins("https://game.example/path"), /exact http\(s\) origins/);
  assert.throws(() => parseAllowedOrigins("ws://socket.example"), /exact http\(s\) origins/);
});
