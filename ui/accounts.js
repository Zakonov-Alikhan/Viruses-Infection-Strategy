import { resolveMultiplayerUrl } from "./multiplayer.js";

export function resolveAccountApiBase(webSocketUrl = resolveMultiplayerUrl()) {
  const url = new URL(webSocketUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/api";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export class AccountsClient {
  constructor({ baseUrl = resolveAccountApiBase(), fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async #request(path, { method = "GET", body } = {}) {
    const headers = {};
    if (method !== "GET") {
      headers["content-type"] = "application/json";
      headers["x-cw-request"] = "1";
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: "include",
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error("server-error"); }
    if (!response.ok) throw new Error(result?.error || "server-error");
    return result;
  }

  me() { return this.#request("/me"); }
  leaderboard() { return this.#request("/leaderboard"); }
  register(username, password) { return this.#request("/auth/register", { method: "POST", body: { username, password } }); }
  login(username, password) { return this.#request("/auth/login", { method: "POST", body: { username, password } }); }
  logout() { return this.#request("/auth/logout", { method: "POST", body: {} }); }
}
