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
    logAccountDiagnostic("client-result-await", { method });
    const result = await client[method](username, password);
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
  constructor({ baseUrl = resolveAccountApiBase(), fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
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
    let result;
    try { result = await response.json(); }
    catch {
      logAccountDiagnostic("response-json-error", { url: diagnosticUrl(requestUrl), status: response.status });
      throw new Error("server-error");
    }
    if (!response.ok) throw new Error(result?.error || "server-error");
    return result;
  }

  me() { return this.#request("/me"); }
  leaderboard() { return this.#request("/leaderboard"); }
  register(username, password) {
    logAccountDiagnostic("client-method", { method: "register" });
    return this.#request("/auth/register", { method: "POST", body: { username, password } });
  }
  login(username, password) {
    logAccountDiagnostic("client-method", { method: "login" });
    return this.#request("/auth/login", { method: "POST", body: { username, password } });
  }
  logout() { return this.#request("/auth/logout", { method: "POST", body: {} }); }
}
