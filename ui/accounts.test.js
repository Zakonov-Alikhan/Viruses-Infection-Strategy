import assert from "node:assert/strict";
import test from "node:test";
import { AccountsClient, resolveAccountApiBase } from "./accounts.js";

test("account API origin is derived from the configured WebSocket host without credentials", () => {
  assert.equal(resolveAccountApiBase("wss://multiplayer.example.test/ws"), "https://multiplayer.example.test/api");
  assert.equal(resolveAccountApiBase("ws://127.0.0.1:3001/ws"), "http://127.0.0.1:3001/api");
});

test("account requests include cookies and the custom same-origin verification header", async () => {
  const calls = [];
  const client = new AccountsClient({
    baseUrl: "https://multiplayer.example.test/api",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ account: { username: "Alice" } }) };
    }
  });
  await client.register("Alice", "a-secret-password");
  assert.equal(calls[0].url, "https://multiplayer.example.test/api/auth/register");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.headers["x-cw-request"], "1");
  assert.equal(JSON.parse(calls[0].options.body).password, "a-secret-password");
  assert.equal(new URL(calls[0].url).search, "");
});
