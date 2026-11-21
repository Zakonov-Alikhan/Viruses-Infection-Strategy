# First public deployment on Render (Free)

The repository includes a Render Blueprint in `render.yaml`. It defines two Web Services and one PostgreSQL database, all on Render's **Free** plan in the same region. Both web services use the `codex/online-multiplayer` branch:

1. `viruses-infection-strategy` (Go), serving the browser client, runtime configuration, HTTP API proxy and WebSocket proxy.
2. `viruses-multiplayer` (Node.js), serving `/health` and WebSocket upgrades at `/ws`.
3. `viruses-accounts-db` (PostgreSQL), backing account sessions and ratings.

The Blueprint uses `sync: false` for the two address settings because Render Blueprint YAML cannot combine a service's generated hostname with a `wss://` scheme, `/ws` path, or `https://` Origin. Render will ask for these values during setup (or they can be entered in each service's Environment page after the first deployment). Use the actual hostnames assigned by Render; do not enter localhost addresses.

Both services are configured in Oregon. Change both `region` values together if another shared Render region is preferable.

## Create the Blueprint

1. Push this branch to GitHub and open Render Dashboard.
2. Choose **New → Blueprint**, select the existing GitHub repository and branch `codex/online-multiplayer`, then select the repository's `render.yaml`.
3. Confirm that both services and the database show **Free** and Oregon before creating them. Do not select a paid plan or add paid resources.
4. Render asks for values marked `sync: false` during the first Blueprint setup. Enter these temporary, deliberately non-routable values so the services can be created: `VIRUSES_MULTIPLAYER_URL=wss://example.invalid/ws` and `MULTIPLAYER_ALLOWED_ORIGINS=https://example.invalid`. The site and multiplayer connection will not work until you replace them with the real service hostnames below.
5. Wait for the Node service to deploy and copy its assigned HTTPS hostname, then set both service variables to their final values and redeploy as described below.

If GitHub access is not connected to Render, connect the repository from Render Dashboard; do not paste GitHub or Render credentials into chat.

## Go web client

- **Root directory:** repository root
- **Build command:** `go build -o viruses-web .`
- **Start command:** `./viruses-web`
- **Health check path:** `/`
- **Environment variables:**
  - `VIRUSES_MULTIPLAYER_URL` = `wss://<actual-node-service>.onrender.com/ws`
  - `VIRUSES_API_URL` = `https://viruses-multiplayer.onrender.com` (verified with the Node service's `/health`; set the HTTPS origin only, without `/api`)
  - Render supplies `PORT`. The app listens on `0.0.0.0:$PORT`.

`/runtime-config.js` gives the browser the relative WebSocket path `/ws` and is sent with `Cache-Control: no-store`. `VIRUSES_MULTIPLAYER_URL` remains the Go proxy's server-side upstream address. Do not put credentials or tokens in either URL.
`SUPPORT_CARD_NUMBER` is a public display value configured on the Go website service and supplied by this Blueprint. Runtime config publishes only its digit-only value (13–19 digits) for the support card. If the service already exists, sync the Blueprint or set this variable in the Go service's Environment settings, then verify `/runtime-config.js`. Do not place the value in application JavaScript, URLs, logs, or analytics. It is not a credential and is never used for payment processing.
Account requests use relative `/api/...` paths and the game WebSocket uses `/ws`, both on the Go site's origin. Go forwards the original Origin and account cookie to Node, which validates them. Both proxy targets are fixed by server environment; clients cannot override them. This lets the same HttpOnly cookie authenticate the profile and the player's room seat, even when Go and Node have unrelated Render hostnames.

## Node.js multiplayer service

- **Root directory:** repository root
- **Build command:** `npm ci`
- **Start command:** `npm run start:multiplayer`
- **Health check path:** `/health`
- **Environment variables:**
  - Render supplies `PORT`. The server uses it unless `MULTIPLAYER_PORT` is explicitly set; leave `MULTIPLAYER_PORT` unset.
  - `NODE_ENV` = `production` (sets the external bind default and requires an explicit Origin allow-list).
  - `MULTIPLAYER_HOST` = `0.0.0.0`
  - `MULTIPLAYER_ALLOWED_ORIGINS` = `https://<actual-go-service>.onrender.com`
  - `DATABASE_URL` = supplied by the Blueprint from the private connection string of `viruses-accounts-db` (do not expose it to the Go site or browser)
  - `MULTIPLAYER_TRUST_PROXY` = `true` so the room request limiter can use the client address forwarded by Render's proxy.
  - `MULTIPLAYER_ADMIN_SECRET` = optional high-entropy secret used to authorize the board editor. Set it only in the Node service's private Environment settings. If unset, online board editing stays unavailable. Never put this value in `render.yaml`, the Go service environment, client runtime configuration, invitation links, or logs.

Use exact web origins in `MULTIPLAYER_ALLOWED_ORIGINS`, comma-separated if you have more than one, for example the Render domain and a custom domain. Do not include paths or trailing slashes. The server rejects a missing or non-allow-listed `Origin` on WebSocket upgrades.

The Node service also serves account endpoints at `/api`. Requests reach it through the Go service's same-origin `/api/` proxy, which preserves the original `Origin` header so the Node API's existing allow-list and request verification remain active. No database credential or API URL is exposed to the browser.

For a custom domain, add the Go site's new origin to the Node allow-list. The browser still connects only to the Go origin, so no shared cookie domain or third-party-cookie permission is needed.

Routes are `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, and `GET /api/leaderboard`. Mutating requests require the browser's JSON request header and an allow-listed Origin. Sessions use a 30-day HttpOnly, SameSite=Lax cookie (Secure in production); only its SHA-256 digest is stored. Passwords use Node's scrypt password KDF (N=32768, r=8, p=1, 64-byte derived key) with a random 16-byte salt. Logout and session rotation close the old session's authenticated sockets. The UI also opens a fresh handshake after login.

Elo starts at 1200 with K=32. Both players must be signed into distinct accounts before joining the match; guest/local/AI games do not change ratings. The server winner determines equal positive/negative rating updates, committed with the unique match ID in one PostgreSQL transaction. Duplicate finish commands cannot apply it twice. A rematch waits for the previous rating write, then reads the updated starting ratings. Signing in during an existing guest match does not retroactively make it rated.

The Blueprint provisions `viruses-accounts-db` on Free and supplies its private connection string to the Node service. The service applies the repeatable schema in `server/migrations/001_accounts_ratings.sql` at startup. If `DATABASE_URL` is absent, guests and online rooms still work, while account/profile/leaderboard API requests return `503 accounts-unavailable`.

This Free database is for a temporary public test only. Render says Free Postgres expires 30 days after creation, becomes inaccessible then, and is deleted with its data after a further 14-day grace period; it has no backups. Do not store account data here that you need to keep. No paid plan is configured or required by this Blueprint.

To enable the online board editor, set `MULTIPLAYER_ADMIN_SECRET` to a randomly generated, private value in the Node service dashboard. The editor asks for the secret over the WebSocket connection; the server authorizes only that connection. The secret is not stored in browser storage, and an administrator must enter it again after reconnecting. Without this setting, regular online players cannot use board-edit commands.

## Set the cross-service addresses

After Render assigns both hostnames, configure:

- On the **Go website** service, `VIRUSES_MULTIPLAYER_URL` = `wss://<Node hostname>/ws`.
- On the **Go website** service, `VIRUSES_API_URL` = `https://viruses-multiplayer.onrender.com` (verified Node hostname; HTTP API origin only; do not use `wss://` or append `/ws` or `/api`).
- On the **Node game** service, `MULTIPLAYER_ALLOWED_ORIGINS` = `https://<Go hostname>`.

Use exact Render hostnames, without angle brackets. The allowed Origin must not include a path or trailing slash. Keep `NODE_ENV=production`, `MULTIPLAYER_HOST=0.0.0.0`, and `MULTIPLAYER_TRUST_PROXY=true`; do not disable Origin checks. Save the variables and redeploy both services.

For local development, run Node on port 3001 and set `VIRUSES_API_URL=http://127.0.0.1:3001` in the Go process environment. If `VIRUSES_MULTIPLAYER_URL` is unset, Go uses this same existing Node service's `/ws`; an explicit WebSocket upstream takes precedence. For example: `$env:VIRUSES_API_URL = 'http://127.0.0.1:3001'; go run .`. Keep the Node allowed Origin set to `http://127.0.0.1:3000` (a development default). Use the same hostname consistently in the browser; localhost and 127.0.0.1 have separate cookies.

SQL integration tests require `TEST_DATABASE_URL` pointing exclusively to an isolated PostgreSQL database whose name includes `test`. The tests create/drop their own schema and exercise registration, password verification, cookie sessions, WebSocket seat identity, rating transactions and duplicate protection. Never point this variable at production. The browser flow can be checked against a temporary local database; no production test accounts are required.

### Account errors during a Free service wake-up

On 2026-11-22 a public `GET /api/me` returned HTTP 429, `Content-Type: text/plain` and `X-Render-Routing: hibernate-rate-limited`. This is a Render routing response, not the Node API's login/register attempt limiter (that limiter returns JSON `{"error":"rate-limited"}` and does not apply to GET `/api/me` or `/api/leaderboard`). A hosting HTML challenge or non-JSON 429 must not be described as too many password attempts. The client reports the explicit hibernation response as a service wake-up and other non-JSON 429 responses as temporary service unavailability. Overlapping reads share a request; credential POSTs are never retried automatically.

Free service sleep is a hosting constraint, not an authentication failure. Wait for service startup and retry once; if it persists, inspect both existing services' Events/logs and workspace usage in Render Dashboard, using the response's `Rndr-Id` when contacting Render support. Do not disable Origin checks, delete accounts, or raise password-attempt limits to address this response. No paid resource or plan change is made by these code changes. See [Free service spin-down behavior](https://render.com/docs/free#spinning-down-on-idle).

## Verify the deployment

1. Open `https://<Go hostname>/` and confirm the game loads.
2. Open `https://<Go hostname>/runtime-config.js`; the WebSocket value should be `/ws`, with no upstream host or secret.
3. Open `https://<Node hostname>/health`; expect HTTP 200.
4. Create a private room in one browser and join from a second browser or device using its invitation code.
5. Confirm Network shows a successful WebSocket upgrade to `wss://<Go hostname>/ws`; make moves in both directions and confirm the server clocks update and a timeout ends the game.
6. With two authorized test accounts in an isolated local environment, finish a match and confirm one rating rises and the other falls, the leaderboard updates, and logout/login retains the result. Repeating a finish command must not award it twice.

The Go and Node services both use Render's `PORT` and bind to `0.0.0.0`. Render routes public HTTP and WebSocket traffic through the service's configured port. The Node app uses the same HTTP server for `/health` and WebSocket upgrades.

## Prototype limits

- Rooms, rate-limit counters, player connections, and clocks live in one Node process. A process restart or deploy loses active matches; multiple instances do not share rooms and are not supported.
- Reconnection works only while the same process still has the room and its temporary reconnect window has not expired.
- The reconnect token is a bearer secret kept in browser local storage (with migration/fallback from session storage), with a separate entry per room and an in-memory copy per tab. It is sent only in the private WebSocket room-created/joined response or a resume command, never in invitation URLs, room broadcasts, or logs. Use HTTPS/WSS in production.
- Returning to the menu or opening a local mode preserves recovery credentials. “Leave room” clears that room's credentials. A server-confirmed missing/expired room clears its saved token; a temporary connection failure does not. The server still enforces its two-minute disconnection grace period and five-minute waiting-room lifetime.
- A valid room token and matching account can replace a lingering connection after refresh. The previous tab receives `session-replaced` and stops reconnecting; its late close or queued moves cannot take over the new connection. A guest seat can be resumed after login without changing the seat's original account or rated status. Server ping/pong checks detect silent connection loss.
- Origin filtering reduces browser-based cross-site access, but it is not player authentication. Room codes are private invitations, not accounts or strong identity. Rate limiting is in-memory and per client address; it is not a substitute for edge protection or abuse monitoring.
- Rooms, clocks, and active game state remain in memory and are lost on restart. Account records, sessions, and ratings use PostgreSQL when `DATABASE_URL` is configured.
- Free Web Services can sleep after inactivity and take time to wake. The available free instance hours are shared within the Render workspace; monitor usage if other free services are running there. Free services have no persistent disk, and Render may restart them. The game rooms are in memory, so an idle sleep/restart can end active matches.
- Render's free usage is subject to its current quotas and policies. Avoid adding a payment method or selecting paid resources. If the workspace's included free usage is exhausted, Render may suspend services/builds; any paid usage or upgrade must be explicitly avoided.

## Render references

- [Web Services: port binding and WebSocket support](https://render.com/docs/web-services)
- [WebSockets: connection lifecycle and instance shutdown](https://render.com/docs/websocket)
- [Health Checks](https://render.com/docs/health-checks)
- [Blueprint specification](https://render.com/docs/blueprint-spec)
- [Free instance limits](https://render.com/docs/free)
