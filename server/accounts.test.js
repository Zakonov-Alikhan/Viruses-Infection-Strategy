import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import WebSocket from "ws";
import { AccountStore, calculateElo, clearSessionCookie, normalizeUsername, readSessionCookie, sessionCookie } from "./accounts.js";
import { createMultiplayerServer } from "./websocket.js";

const ORIGIN = "http://localhost:3000";

class FakeAccountStore {
  constructor() {
    this.accounts = new Map();
    this.sessions = new Map();
    this.next = 1;
  }
  async register({ username }) {
    const normalized = username.toLowerCase();
    if ([...this.accounts.values()].some((item) => item.username.toLowerCase() === normalized)) return { ok: false, code: "username-taken" };
    const account = { id: `test-account-${this.next++}`, username, rating: 1200, wins: 0, losses: 0, created_at: new Date().toISOString() };
    this.accounts.set(account.id, account);
    return { ok: true, account };
  }
  async authenticate({ username, password }) {
    const account = [...this.accounts.values()].find((item) => item.username.toLowerCase() === username.toLowerCase());
    return account && password === "test-password-123" ? account : null;
  }
  async createSession(accountId) {
    const token = `test-session-token-${String(accountId).padEnd(42, "x")}`.slice(0, 52);
    this.sessions.set(token, accountId);
    return token;
  }
  async getSession(token) { return this.accounts.get(this.sessions.get(token)) ?? null; }
  async deleteSession(token) { this.sessions.delete(token); }
  async getRatings(ids) {
    return Object.fromEntries(ids.map((id) => [id, this.accounts.get(id)?.rating]).filter(([, rating]) => Number.isFinite(rating)));
  }
  async leaderboard() {
    return [...this.accounts.values()].sort((a, b) => b.rating - a.rating).map((row, i) => ({ rank: i + 1, ...row }));
  }
}

test("username validation, Elo formula, and HttpOnly cookie helpers are stable", () => {
  assert.deepEqual(normalizeUsername("  Alikhan_1 "), { username: "Alikhan_1", normalized: "alikhan_1" });
  assert.equal(normalizeUsername("ab"), null);
  assert.equal(normalizeUsername("имя игрока"), null);
  assert.equal(calculateElo(1200, 1200), 16);
  assert.equal(calculateElo(1600, 1200), 3);
  assert.match(sessionCookie("x".repeat(43), { secure: true }), /HttpOnly/);
  assert.match(sessionCookie("x".repeat(43), { secure: true }), /Secure/);
  assert.match(sessionCookie("x".repeat(43), { secure: true }), /SameSite=Lax/);
  assert.equal(readSessionCookie(`other=x; cw_session=${"x".repeat(43)}`), "x".repeat(43));
  assert.match(clearSessionCookie({ secure: true }), /Max-Age=0/);
});

test("account API registers, persists a session cookie, authenticates, logs out, and serves leaderboard", async (t) => {
  const accountStore = new FakeAccountStore();
  const server = createMultiplayerServer({ host: "127.0.0.1", port: 0, cleanupIntervalMs: 0,
    allowedOrigins: new Set([ORIGIN]), accountStore });
  const address = await server.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path, body, extra = {}) => fetch(`${base}${path}`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-cw-request": "1", ...extra },
    body: JSON.stringify(body)
  });
  t.after(() => server.close());

  const registered = await post("/api/auth/register", { username: "Alice", password: "test-password-123" });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const account = (await registered.json()).account;
  assert.equal(account.rating, 1200);
  assert.equal("password_hash" in account, false);
  assert.equal("token" in account, false);

  const duplicate = await post("/api/auth/register", { username: "alice", password: "test-password-123" });
  assert.equal(duplicate.status, 409);
  const loginFailed = await post("/api/auth/login", { username: "Alice", password: "wrong-password" });
  assert.equal(loginFailed.status, 401);
  const login = await post("/api/auth/login", { username: "Alice", password: "test-password-123" });
  assert.equal(login.status, 200);
  const loginCookie = login.headers.get("set-cookie").split(";")[0];
  const me = await fetch(`${base}/api/me`, { headers: { origin: ORIGIN, cookie: loginCookie } });
  assert.equal((await me.json()).account.username, "Alice");
  assert.deepEqual((await (await fetch(`${base}/api/leaderboard`, { headers: { origin: ORIGIN } })).json()).entries.map((e) => e.username), ["Alice"]);
  const logout = await post("/api/auth/logout", {}, { cookie: loginCookie });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await (await fetch(`${base}/api/me`, { headers: { origin: ORIGIN, cookie: loginCookie } })).json()).account, null);
});

test("account API rejects unapproved Origins and requests without the anti-CSRF header", async (t) => {
  const server = createMultiplayerServer({ host: "127.0.0.1", port: 0, cleanupIntervalMs: 0,
    allowedOrigins: new Set([ORIGIN]), accountStore: new FakeAccountStore() });
  const address = await server.listen();
  const url = `http://127.0.0.1:${address.port}/api/auth/register`;
  t.after(() => server.close());
  const originRejected = await fetch(url, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" });
  assert.equal(originRejected.status, 403);
  const headerRejected = await fetch(url, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });
  assert.equal(headerRejected.status, 403);
});

test("account endpoints stay unavailable without DATABASE_URL while health and guest server remain usable", async (t) => {
  const server = createMultiplayerServer({ host: "127.0.0.1", port: 0, cleanupIntervalMs: 0, allowedOrigins: new Set([ORIGIN]) });
  const address = await server.listen();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => server.close());
  assert.equal((await fetch(`${base}/health`)).status, 200);
  const unavailable = await fetch(`${base}/api/me`, { headers: { origin: ORIGIN } });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error, "accounts-unavailable");
});

test("WebSocket seat identity comes from the HttpOnly session, and the same account cannot take both seats", async (t) => {
  const accountStore = new FakeAccountStore();
  const accountA = (await accountStore.register({ username: "PlayerA", password: "test-password-123" })).account;
  const accountB = (await accountStore.register({ username: "PlayerB", password: "test-password-123" })).account;
  const tokenA = await accountStore.createSession(accountA.id);
  const tokenB = await accountStore.createSession(accountB.id);
  const server = createMultiplayerServer({ host: "127.0.0.1", port: 0, cleanupIntervalMs: 0,
    allowedOrigins: new Set([ORIGIN]), accountStore });
  const address = await server.listen();
  const open = async (token) => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
      origin: ORIGIN,
      headers: { cookie: `cw_session=${token}` }
    });
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const messages = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    return { socket, messages, wait: async (type) => {
      for (let i = 0; i < 50; i += 1) {
        const found = messages.findIndex((message) => message.type === type);
        if (found >= 0) return messages.splice(found, 1)[0];
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`missing ${type}`);
    } };
  };
  const peers = [];
  t.after(async () => {
    for (const peer of peers) await new Promise((resolve) => {
      if (peer.socket.readyState === WebSocket.CLOSED) return resolve();
      peer.socket.once("close", resolve);
      peer.socket.close(1000, "done");
    });
    await server.close();
  });
  const a = await open(tokenA); peers.push(a);
  a.socket.send(JSON.stringify({ type: "create-room", requestId: "create" }));
  const created = await a.wait("room-created");
  assert.equal(server.roomManager.getParticipantAccountIds(created.roomCode).includes(accountA.id), true);
  const sameAccountPeer = await open(tokenA); peers.push(sameAccountPeer);
  sameAccountPeer.socket.send(JSON.stringify({ type: "join-room", code: created.roomCode, requestId: "same" }));
  assert.equal((await sameAccountPeer.wait("server-error")).code, "same-account");
  const b = await open(tokenB); peers.push(b);
  b.socket.send(JSON.stringify({ type: "join-room", code: created.roomCode, requestId: "join" }));
  await b.wait("room-joined");
  assert.deepEqual(new Set(server.roomManager.getParticipantAccountIds(created.roomCode)), new Set([accountA.id, accountB.id]));
  assert.deepEqual(server.roomManager.rooms.get(created.roomCode).startRatings, { [accountA.id]: 1200, [accountB.id]: 1200 });
  a.socket.send(JSON.stringify({ type: "rating-change", winnerId: accountA.id, delta: 999, requestId: "forged-rating" }));
  assert.equal((await a.wait("server-error")).code, "unknown-message-type");
});

test("PostgreSQL stores account, session, and one atomic Elo result across store instances", {
  skip: (() => {
    const value = process.env.TEST_DATABASE_URL;
    if (!value) return "Set TEST_DATABASE_URL to run isolated PostgreSQL integration tests";
    try {
      return /(?:^|[_-])test(?:$|[_-])/i.test(new URL(value).pathname)
        ? false
        : "TEST_DATABASE_URL database name must include 'test' as a safety check";
    } catch { return "TEST_DATABASE_URL must be a PostgreSQL URL"; }
  })()
}, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `cw_test_${randomUUID().replaceAll("-", "")}`;
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, max: 3, options: `-c search_path=${schema}` });
  // Explicit SET also supports isolated PostgreSQL-compatible test servers
  // which do not apply startup `options` (the application does not need this).
  pool.on("connect", client => { void client.query(`SET search_path TO ${schema}`); });
  try {
    const store = new AccountStore({ pool });
    await store.initialize();
    const a = (await store.register({ username: "AccountA", password: "long-test-pass-A" })).account;
    const b = (await store.register({ username: "AccountB", password: "long-test-pass-B" })).account;
    assert.equal((await store.register({ username: "accounta", password: "long-test-pass-A" })).code, "username-taken");
    assert.equal((await store.authenticate({ username: "AccountA", password: "wrong-password" })), null);
    assert.equal((await store.authenticate({ username: "AccountA", password: "long-test-pass-A" })).id, a.id);
    const token = await store.createSession(a.id);
    const delta = calculateElo(1200, 1200);
    await Promise.all([
      store.recordRatedMatch({ matchId: "test-match-1", winnerId: a.id, loserId: b.id, ratingsAtStart: { [a.id]: 1200, [b.id]: 1200 } }),
      store.recordRatedMatch({ matchId: "test-match-1", winnerId: a.id, loserId: b.id, ratingsAtStart: { [a.id]: 1200, [b.id]: 1200 } })
    ]);
    const restartedStore = new AccountStore({ pool });
    assert.equal((await restartedStore.getSession(token)).username, "AccountA");
    assert.equal((await restartedStore.getById(a.id)).rating, 1200 + delta);
    assert.equal((await restartedStore.getById(a.id)).wins, 1);
    assert.equal((await restartedStore.getById(b.id)).rating, 1200 - delta);
    assert.equal((await restartedStore.leaderboard())[0].username, "AccountA");
    const storedToken = (await pool.query(`SELECT token_hash FROM cw_sessions WHERE account_id=$1`, [a.id])).rows[0].token_hash;
    assert.notEqual(storedToken.toString("base64url"), token);
    await Promise.all([
      store.recordRatedMatch({ matchId: "test-match-2", winnerId: a.id, loserId: b.id, ratingsAtStart: { [a.id]: 1200, [b.id]: 1200 } }),
      store.recordRatedMatch({ matchId: "test-match-3", winnerId: b.id, loserId: a.id, ratingsAtStart: { [a.id]: 1200, [b.id]: 1200 } })
    ]);
    assert.equal((await restartedStore.getById(a.id)).wins, 2);
    assert.equal((await restartedStore.getById(b.id)).wins, 1);

    // Exercise the actual HTTP and WebSocket handlers with real SQL, password
    // hashing and sessions, instead of a permissive fake account store.
    const server = createMultiplayerServer({ host: "127.0.0.1", port: 0, cleanupIntervalMs: 0,
      allowedOrigins: new Set([ORIGIN]), accountStore: store });
    const address = await server.listen();
    const base = `http://127.0.0.1:${address.port}`;
    const sockets = [];
    const post = (path, body, cookie = "") => fetch(`${base}/api/auth/${path}`, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-cw-request": "1", cookie },
      body: JSON.stringify(body)
    });
    const open = async cookie => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin: ORIGIN, headers: { cookie } });
      sockets.push(socket);
      await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      const messages = [];
      socket.on("message", raw => messages.push(JSON.parse(raw.toString())));
      return { socket, send: m => socket.send(JSON.stringify(m)), async next(type) {
        for (let i = 0; i < 200; i += 1) {
          const index = messages.findIndex(m => m.type === type);
          if (index >= 0) return messages.splice(index, 1)[0];
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error(`Missing ${type}`);
      } };
    };
    try {
      const cookies = [], ids = [];
      for (const username of ["HttpPlayerA", "HttpPlayerB"]) {
        const response = await post("register", { username, password: "temporary-test-password" });
        assert.equal(response.status, 201);
        cookies.push(response.headers.get("set-cookie").split(";")[0]);
        ids.push((await response.json()).account.id);
      }
      const host = await open(cookies[0]);
      const guest = await open(cookies[1]);
      host.send({ type: "create-room", settings: { freeStartingPositions: false, randomEvents: false, unlimitedTime: true } });
      const room = await host.next("room-created");
      guest.send({ type: "join-room", code: room.roomCode });
      await guest.next("room-joined");
      await host.next("room-ready");
      host.send({ type: "command", command: { type: "resign" } });
      await host.next("rating-updated");
      await guest.next("rating-updated");
      assert.equal((await restartedStore.getById(ids[0])).rating, 1184);
      assert.equal((await restartedStore.getById(ids[1])).rating, 1216);
      host.send({ type: "command", command: { type: "resign" } });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal((await restartedStore.getById(ids[1])).wins, 1);
      assert.equal((await post("login", { username: "HttpPlayerA", password: "wrong-password" })).status, 401);
      const closed = new Promise(resolve => host.socket.once("close", resolve));
      assert.equal((await post("logout", {}, cookies[0])).status, 200);
      await closed;
      assert.equal(await store.getSession(cookies[0].split("=")[1]), null);
      const login = await post("login", { username: "HttpPlayerA", password: "temporary-test-password" });
      assert.equal(login.status, 200);
      assert.equal((await login.json()).account.rating, 1184);
    } finally {
      for (const socket of sockets) socket.terminate();
      await server.close();
    }
  } finally {
    await pool.end();
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
  }
});
