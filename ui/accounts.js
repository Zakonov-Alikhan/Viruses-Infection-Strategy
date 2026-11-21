function accountDiagnosticsEnabled() {
  return ["localhost", "127.0.0.1"].includes(globalThis.location?.hostname);
}

export function logAccountDiagnostic(stage, details = {}) {
  if (!accountDiagnosticsEnabled()) return;
  const allowedKeys = new Set(["method", "formId", "url", "baseUrl", "origin", "status", "errorType", "errorCode", "description", "loading", "authenticated", "fetchAvailable"]);
  const safeDetails = Object.fromEntries(Object.entries(details).flatMap(([key, value]) => {
    if (!allowedKeys.has(key)) return [];
    if (key === "url" || key === "baseUrl") return [[key, diagnosticUrl(value)]];
    if (key === "origin") {
      try { return [[key, new URL(value).origin]]; } catch { return [[key, "<invalid-origin>"]]; }
    }
    if (key === "status" && Number.isFinite(value)) return [[key, value]];
    if (["loading", "authenticated", "fetchAvailable"].includes(key) && typeof value === "boolean") return [[key, value]];
    if (key === "errorCode") return [[key, typeof value === "string" && /^[a-z0-9-]{1,64}$/i.test(value) ? value : "unknown"]];
    if (key === "errorType") return [[key, typeof value === "string" && /^[A-Za-z]{1,32}$/.test(value) ? value : "Error"]];
    if (typeof value === "string") return [[key, value.slice(0, 100)]];
    return [];
  }));
  console.debug(`[CW auth] ${stage} ${JSON.stringify(safeDetails)}`);
}

function diagnosticUrl(value) {
  try {
    const url = new URL(value, globalThis.location?.origin || "http://localhost");
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

export function resolveAccountApiBase() {
  return "/api";
}

export async function submitAccountCredentials({
  event,
  client,
  method,
  username,
  password,
  onLoading = () => {},
  onSuccess = () => {},
  onError = () => {}
}) {
  logAccountDiagnostic("submit-handler-enter", { method });
  event.preventDefault();
  if (!["login", "register"].includes(method)) throw new TypeError("Unsupported account action");
  onLoading(true);
  try {
    const normalizedUsername = typeof username === "string" ? username.trim() : "";
    if (!/^[A-Za-z0-9_]{3,24}$/.test(normalizedUsername)) throw new Error("invalid-username");
    if (typeof password !== "string" || password.length < 10 || password.length > 128) {
      throw new Error("invalid-password-length");
    }
    logAccountDiagnostic("client-result-await", { method });
    const result = await client[method](normalizedUsername, password);
    logAccountDiagnostic("ui-result-success", { method });
    onSuccess(result);
    return true;
  } catch (error) {
    logAccountDiagnostic("ui-result-error", {
      method,
      errorType: error?.name || "Error",
      errorCode: error instanceof Error ? error.message : "unknown"
    });
    onError(error);
    return false;
  } finally {
    onLoading(false);
  }
}

export class AccountsClient {
  #pendingReads = new Map();

  constructor({ baseUrl = resolveAccountApiBase(), fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl;
    // Native browser fetch requires Window/Worker as its receiver. Calling an
    // unbound copy as an AccountsClient method fails before sending a request.
    this.fetchImpl = fetchImpl.bind(globalThis);
    logAccountDiagnostic("client-configured", {
      baseUrl: diagnosticUrl(baseUrl),
      origin: globalThis.location?.origin || "<unknown>",
      fetchAvailable: typeof this.fetchImpl === "function"
    });
  }

  async #request(path, { method = "GET", body } = {}) {
    const headers = {};
    if (method !== "GET") {
      headers["content-type"] = "application/json";
      headers["x-cw-request"] = "1";
    }
    const requestUrl = `${this.baseUrl}${path}`;
    logAccountDiagnostic("fetch-start", { url: diagnosticUrl(requestUrl), method });
    let response;
    try {
      response = await this.fetchImpl(requestUrl, {
        method,
        headers,
        credentials: "include",
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch (error) {
      logAccountDiagnostic("fetch-exception", {
        url: diagnosticUrl(requestUrl),
        method,
        errorType: error?.name || "Error",
        description: error?.name === "TypeError" ? "Fetch rejected before an HTTP response (network, CORS, or invalid URL)." : "Fetch rejected before an HTTP response."
      });
      throw error;
    }
    logAccountDiagnostic("fetch-response", { url: diagnosticUrl(requestUrl), method, status: response.status });
    // Render's sleeping-service limit is not a failed-password limit. Its
    // response can be plain text or HTML, even for GET /me and /leaderboard.
    const serviceStarting = response.status === 429
      && response.headers?.get("x-render-routing") === "hibernate-rate-limited";
    const httpErrorCode = serviceStarting ? "account-service-starting" : {
      401: "invalid-credentials",
      409: "username-taken",
      429: "account-service-unavailable",
      502: "account-service-unavailable",
      503: "account-service-unavailable",
      504: "account-service-unavailable"
    }[response.status] || "server-error";
    let result;
    try { result = await response.json(); }
    catch {
      logAccountDiagnostic("response-json-error", { url: diagnosticUrl(requestUrl), status: response.status });
      throw new Error(response.ok ? "server-error" : httpErrorCode);
    }
    if (!response.ok) throw new Error(serviceStarting ? httpErrorCode : result?.error || httpErrorCode);
    return result;
  }

  #read(path) {
    let pending = this.#pendingReads.get(path);
    if (!pending) {
      pending = this.#request(path).finally(() => {
        if (this.#pendingReads.get(path) === pending) this.#pendingReads.delete(path);
      });
      this.#pendingReads.set(path, pending);
    }
    return pending;
  }

  async #changeSession(path, body) {
    const result = await this.#request(path, { method: "POST", body });
    // An in-flight read from the previous session must not be reused after
    // login/logout. Existing UI version checks discard its eventual result.
    this.#pendingReads.clear();
    return result;
  }

  me() { return this.#read("/me"); }
  leaderboard() { return this.#read("/leaderboard"); }
  register(username, password) {
    logAccountDiagnostic("client-method", { method: "register" });
    return this.#changeSession("/auth/register", { username, password });
  }
  login(username, password) {
    logAccountDiagnostic("client-method", { method: "login" });
    return this.#changeSession("/auth/login", { username, password });
  }
  logout() { return this.#changeSession("/auth/logout", {}); }
}
