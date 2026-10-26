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
  const auth = html.match(/<section id="account-auth-forms"[\s\S]*?<\/section>/)?.[0];
  assert.ok(auth);
  assert.match(auth, /id="account-login-tab"[^>]*type="button"/);
  assert.match(auth, /id="account-register-tab"[^>]*type="button"/);
  assert.match(auth, /id="account-login-form"[^>]*role="tabpanel"/);
  assert.match(auth, /id="account-register-form"[^>]*hidden/);
  assert.equal((auth.match(/<form\b/g) || []).length, 2);
  assert.equal((auth.match(/name="username"[^>]*required/g) || []).length, 2);
  assert.equal((auth.match(/name="password"[^>]*minlength="10"[^>]*required/g) || []).length, 2);
});

test("auth tabs, loading labels, and server error messages are localized in Russian and English", () => {
  for (const locale of [ru, en]) {
    assert.ok(locale["account.loginTab"]);
    assert.ok(locale["account.registerTab"]);
    assert.ok(locale["account.loading.login"]);
    assert.ok(locale["account.loading.register"]);
    for (const code of ["invalid-credentials", "username-taken", "rate-limited", "accounts-unavailable", "network", "invalid-request"]) {
      assert.ok(locale[`account.error.${code}`]);
    }
  }
});
