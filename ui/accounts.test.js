import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AccountsClient, resolveAccountApiBase, submitAccountCredentials } from "./accounts.js";
import ru from "./locale-ru.js";
import en from "./locale-en.js";

test("account entry labels make sign-in and profile access clear in both locales", () => {
  assert.equal(ru["account.guestHeader"], "Войти / Регистрация");
  assert.equal(ru["account.guestDetail"], "Рейтинг и профиль");
  assert.equal(en["account.guestHeader"], "Sign in / Register");
  assert.equal(en["account.guestDetail"], "Rating and profile");
});

test("account API always uses the same-origin API route regardless of multiplayer host", () => {
  assert.equal(resolveAccountApiBase(), "/api");
  assert.equal(resolveAccountApiBase("wss://multiplayer.example.test/ws"), "/api");
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

test("account fetch uses the browser global receiver for login, registration, and profile requests", async () => {
  const calls = [];
  const client = new AccountsClient({
    fetchImpl: async function (url, options) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      calls.push({ url, method: options.method });
      return { ok: true, status: 200, json: async () => ({ account: null, entries: [] }) };
    }
  });
  await client.login("Alice", "a-long-test-password");
  await client.register("Alice", "a-long-test-password");
  await client.me();
  await client.leaderboard();
  await client.logout();
  assert.deepEqual(calls, [
    { url: "/api/auth/login", method: "POST" },
    { url: "/api/auth/register", method: "POST" },
    { url: "/api/me", method: "GET" },
    { url: "/api/leaderboard", method: "GET" },
    { url: "/api/auth/logout", method: "POST" }
  ]);
});

test("non-JSON HTTP errors keep their HTTP meaning instead of becoming a network error", async () => {
  for (const [status, code] of [[401, "invalid-credentials"], [409, "username-taken"], [429, "account-service-unavailable"], [502, "account-service-unavailable"], [503, "account-service-unavailable"]]) {
    const client = new AccountsClient({ fetchImpl: async () => ({
      ok: false, status,
      json: async () => { throw new SyntaxError("Not JSON"); }
    }) });
    await assert.rejects(client.login("Alice", "a-long-test-password"), new RegExp(code));
  }
});

test("Render hibernation responses are distinct from account attempt limits on every account route", async () => {
  for (const action of ["me", "leaderboard", "login", "register"]) {
    let calls = 0;
    const client = new AccountsClient({ fetchImpl: async () => {
      calls += 1;
      return new Response("Too Many Requests\n", {
        status: 429, headers: { "x-render-routing": "hibernate-rate-limited", "content-type": "text/plain" }
      });
    } });
    await assert.rejects(client[action]("Alice", "a-long-test-password"), /^Error: account-service-starting$/);
    assert.equal(calls, 1);
  }
});

test("hosting HTML 429 is unavailable while the API's JSON 429 remains an attempt limit", async () => {
  const responses = [
    [new Response("<!doctype html><title>Just a moment</title>", { status: 429 }), "account-service-unavailable"],
    [Response.json({ error: "rate-limited" }, { status: 429 }), "rate-limited"]
  ];
  for (const [response, code] of responses) {
    const client = new AccountsClient({ fetchImpl: async () => response });
    await assert.rejects(client.register("Alice", "a-long-test-password"), new RegExp(`^Error: ${code}$`));
  }
});

test("invalid form credentials never spend an API attempt and can be corrected for either form", async () => {
  for (const method of ["login", "register"]) {
    const calls = [], errors = [], loading = [];
    const client = new AccountsClient({ fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json({ account: { username: "Alice", rating: 1200 } });
    } });
    const options = {
      event: { preventDefault() {} }, client, method,
      onError: error => errors.push(error.message), onLoading: value => loading.push(value)
    };
    for (const [username, password, code] of [
      ["player@example.com", "a-long-test-password", "invalid-username"],
      ["a", "a-long-test-password", "invalid-username"],
      ["Игрок", "a-long-test-password", "invalid-username"],
      ["Alice", "short", "invalid-password-length"]
    ]) {
      assert.equal(await submitAccountCredentials({ ...options, username, password }), false);
      assert.equal(errors.at(-1), code);
      assert.equal(calls.length, 0);
      assert.equal(loading.at(-1), false);
    }
    assert.equal(await submitAccountCredentials({ ...options, username: " Alice ", password: "a-long-test-password" }), true);
    assert.deepEqual(calls, [{ url: `/api/auth/${method}`, body: { username: "Alice", password: "a-long-test-password" } }]);
  }
});

test("a form can retry after a hosting failure without an automatic duplicate POST", async () => {
  for (const method of ["login", "register"]) {
    let calls = 0;
    const errors = [], loading = [];
    const client = new AccountsClient({ fetchImpl: async () => ++calls === 1
      ? new Response("Too Many Requests", { status: 429, headers: { "x-render-routing": "hibernate-rate-limited" } })
      : Response.json({ account: { username: "Alice", rating: 1200 } }) });
    const options = {
      event: { preventDefault() {} }, client, method, username: "Alice", password: "a-long-test-password",
      onError: error => errors.push(error.message), onLoading: value => loading.push(value)
    };
    assert.equal(await submitAccountCredentials(options), false);
    assert.equal(calls, 1);
    assert.equal(await submitAccountCredentials(options), true);
    assert.equal(calls, 2);
    assert.deepEqual(errors, ["account-service-starting"]);
    assert.deepEqual(loading, [true, false, true, false]);
  }
});

test("overlapping profile and leaderboard reads share requests and failures allow a fresh read", async () => {
  const calls = [], resolvers = [];
  const client = new AccountsClient({ fetchImpl: url => new Promise(resolve => { calls.push(url); resolvers.push(resolve); }) });
  const reads = [client.me(), client.me(), client.leaderboard(), client.leaderboard()];
  assert.deepEqual(calls, ["/api/me", "/api/leaderboard"]);
  resolvers[0](Response.json({ account: null }));
  resolvers[1](new Response("Unavailable", { status: 503 }));
  const results = await Promise.allSettled(reads);
  assert.deepEqual(results.map(result => result.status), ["fulfilled", "fulfilled", "rejected", "rejected"]);
  const retry = client.leaderboard();
  assert.equal(calls.length, 3);
  resolvers[2](Response.json({ entries: [] }));
  assert.deepEqual(await retry, { entries: [] });
});

test("changing an account session never reuses a pending read from the previous session", async () => {
  for (const method of ["login", "register", "logout"]) {
    const resolvers = [];
    const client = new AccountsClient({ fetchImpl: url => url.endsWith("/me")
      ? new Promise(resolve => resolvers.push(resolve))
      : Promise.resolve(Response.json({ account: { username: "Alice" } })) });
    const stale = client.me();
    await client[method]("Alice", "a-long-test-password");
    const fresh = client.me();
    assert.equal(resolvers.length, 2);
    resolvers[0](Response.json({ account: null }));
    await stale;
    assert.equal(client.me(), fresh);
    resolvers[1](Response.json({ account: { username: "Alice" } }));
    assert.equal((await fresh).account.username, "Alice");
  }
});

test("account client uses the existing routes through a relative same-origin API base", async () => {
  const calls = [];
  const client = new AccountsClient({
    baseUrl: resolveAccountApiBase(),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ account: null, entries: [] }) };
    }
  });
  await client.register("Alice", "a-long-test-password");
  await client.login("Alice", "a-long-test-password");
  await client.logout();
  await client.me();
  await client.leaderboard();
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method || "GET"]), [
    ["/api/auth/register", "POST"],
    ["/api/auth/login", "POST"],
    ["/api/auth/logout", "POST"],
    ["/api/me", "GET"],
    ["/api/leaderboard", "GET"]
  ]);
  assert.ok(calls.every(({ options }) => options.credentials === "include"));
});

test("login and registration forms submit the entered credentials and always release loading state", async () => {
  for (const method of ["login", "register"]) {
    const calls = [];
    const loading = [];
    const account = { username: "Alice", rating: 1200 };
    let prevented = false;
    const success = await submitAccountCredentials({
      event: { preventDefault() { prevented = true; } },
      client: { async [method](username, password) { calls.push({ username, password }); return { account }; } },
      method,
      username: "Alice",
      password: "a-long-test-password",
      onLoading: (value) => loading.push(value),
      onSuccess: (result) => assert.deepEqual(result.account, account)
    });
    assert.equal(success, true);
    assert.equal(prevented, true);
    assert.deepEqual(calls, [{ username: "Alice", password: "a-long-test-password" }]);
    assert.deepEqual(loading, [true, false]);
  }
});

test("login and registration submission each reach fetch exactly once through AccountsClient", async () => {
  for (const method of ["login", "register"]) {
    const calls = [];
    const client = new AccountsClient({
      baseUrl: "https://multiplayer.example.test/api",
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: method === "register" ? 201 : 200, json: async () => ({ account: { username: "Alice", rating: 1200 } }) };
      }
    });
    const succeeded = await submitAccountCredentials({
      event: { preventDefault() {} }, client, method, username: "Alice", password: "a-long-test-password"
    });
    assert.equal(succeeded, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://multiplayer.example.test/api/auth/${method}`);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.credentials, "include");
    assert.equal(calls[0].options.headers["x-cw-request"], "1");
    assert.deepEqual(JSON.parse(calls[0].options.body), { username: "Alice", password: "a-long-test-password" });
  }
});

test("account failure is shown to the form and a later submission can succeed", async () => {
  let attempts = 0;
  const errors = [];
  const loading = [];
  const client = { async login() { if (++attempts === 1) throw new Error("invalid-credentials"); return { account: { username: "Alice" } }; } };
  const options = {
    event: { preventDefault() {} }, client, method: "login", username: "Alice", password: "wrong-or-correct",
    onLoading: (value) => loading.push(value), onError: (error) => errors.push(error.message)
  };
  assert.equal(await submitAccountCredentials(options), false);
  let signedIn = null;
  assert.equal(await submitAccountCredentials({ ...options, onSuccess: (result) => { signedIn = result.account; } }), true);
  assert.deepEqual(errors, ["invalid-credentials"]);
  assert.deepEqual(signedIn, { username: "Alice" });
  assert.deepEqual(loading, [true, false, true, false]);
});

test("API HTTP errors preserve server codes and network failures remain distinguishable", async () => {
  for (const [status, code] of [[401, "invalid-credentials"], [409, "username-taken"], [429, "rate-limited"], [503, "accounts-unavailable"]]) {
    const client = new AccountsClient({ baseUrl: "https://accounts.example.test/api", fetchImpl: async () => ({ ok: false, status, json: async () => ({ error: code }) }) });
    await assert.rejects(client.login("user", "password"), new RegExp(code));
  }
  const offline = new AccountsClient({ baseUrl: "https://accounts.example.test/api", fetchImpl: async () => { throw new TypeError("offline"); } });
  await assert.rejects(offline.login("user", "password"), /offline/);
});

test("auth tabs are non-submitting controls and exactly one constrained form is initially visible", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("./script.js", import.meta.url), "utf8");
  const auth = html.match(/<section id="account-auth-forms"[\s\S]*?<\/section>/)?.[0];
  assert.ok(auth);
  assert.match(auth, /id="account-login-tab"[^>]*type="button"/);
  assert.match(auth, /id="account-register-tab"[^>]*type="button"/);
  assert.match(auth, /id="account-login-form"[^>]*role="tabpanel"/);
  assert.match(auth, /id="account-register-form"[^>]*hidden/);
  assert.equal((auth.match(/<form\b/g) || []).length, 2);
  assert.equal((auth.match(/name="username"[^>]*required/g) || []).length, 2);
  assert.equal((auth.match(/name="password"[^>]*minlength="10"[^>]*required/g) || []).length, 2);
  assert.match(script, /accountLoginForm\.addEventListener\("submit"/);
  assert.match(script, /accountRegisterForm\.addEventListener\("submit"/);
  assert.match(html, /script\.js\?v=cascade-package17/);
  assert.doesNotMatch(html, /script\.js\?v=account-entry1/);
});

test("auth tabs, loading labels, and server error messages are localized in Russian and English", () => {
  for (const locale of [ru, en]) {
    assert.ok(locale["account.loginTab"]);
    assert.ok(locale["account.registerTab"]);
    assert.ok(locale["account.loading.login"]);
    assert.ok(locale["account.loading.register"]);
    for (const code of ["invalid-credentials", "username-taken", "rate-limited", "accounts-unavailable", "network", "invalid-request", "invalid-username", "invalid-password-length", "account-service-starting"]) {
      assert.ok(locale[`account.error.${code}`]);
    }
  }
});
