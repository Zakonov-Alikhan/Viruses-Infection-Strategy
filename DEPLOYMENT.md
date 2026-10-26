# First public deployment on Render (Free)

The repository includes a Render Blueprint in `render.yaml`. It defines two Web Services and one PostgreSQL database, all on Render's **Free** plan in the same region. Both web services use the `codex/online-multiplayer` branch:

1. `viruses-infection-strategy` (Go), serving the browser client and runtime configuration.
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
  - Render supplies `PORT`. The app listens on `0.0.0.0:$PORT`.

`/runtime-config.js` exposes only the configured WebSocket URL to the browser and is sent with `Cache-Control: no-store`. Do not put credentials or tokens in this URL.

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

The Node service also serves account endpoints at `/api`. The browser derives this API origin from the configured WebSocket URL, so no database credential or extra runtime secret is exposed to the client. The account API uses the same exact `MULTIPLAYER_ALLOWED_ORIGINS` list and credentialed CORS.

For custom domains, serve the Go site and Node API/WebSocket under the same registrable domain (for example, `play.example.com` and `api.example.com`); unrelated sites can have their cross-site cookies blocked by browser privacy settings.

Routes are `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, and `GET /api/leaderboard`. Mutating requests require the browser's JSON request header and an allow-listed Origin. Sessions use a 30-day HttpOnly cookie; only its SHA-256 digest is stored. Passwords use Node's scrypt password KDF (N=32768, r=8, p=1, 64-byte derived key) with a random 16-byte salt. Elo starts at 1200 with K=32 and is committed with the match result in one PostgreSQL transaction.

The Blueprint provisions `viruses-accounts-db` on Free and supplies its private connection string to the Node service. The service applies the repeatable schema in `server/migrations/001_accounts_ratings.sql` at startup. If `DATABASE_URL` is absent, guests and online rooms still work, while account/profile/leaderboard API requests return `503 accounts-unavailable`.

This Free database is for a temporary public test only. Render says Free Postgres expires 30 days after creation, becomes inaccessible then, and is deleted with its data after a further 14-day grace period; it has no backups. Do not store account data here that you need to keep. No paid plan is configured or required by this Blueprint.

To enable the online board editor, set `MULTIPLAYER_ADMIN_SECRET` to a randomly generated, private value in the Node service dashboard. The editor asks for the secret over the WebSocket connection; the server authorizes only that connection. The secret is not stored in browser storage, and an administrator must enter it again after reconnecting. Without this setting, regular online players cannot use board-edit commands.

## Set the cross-service addresses

After Render assigns both hostnames, configure:

- On the **Go website** service, `VIRUSES_MULTIPLAYER_URL` = `wss://<Node hostname>/ws`.
- On the **Node game** service, `MULTIPLAYER_ALLOWED_ORIGINS` = `https://<Go hostname>`.

Use exact Render hostnames, without angle brackets. The allowed Origin must not include a path or trailing slash. Keep `NODE_ENV=production`, `MULTIPLAYER_HOST=0.0.0.0`, and `MULTIPLAYER_TRUST_PROXY=true`; do not disable Origin checks. Save the variables and redeploy both services.

## Verify the deployment

1. Open `https://<Go hostname>/` and confirm the game loads.
2. Open `https://<Go hostname>/runtime-config.js`; it should contain the public `wss://<Node hostname>/ws` address and no secret.
3. Open `https://<Node hostname>/health`; expect HTTP 200.
4. Create a private room in one browser and join from a second browser or device using its invitation code.
5. Confirm the browser Network panel shows a successful WebSocket upgrade to `wss://<Node hostname>/ws`; make moves in both directions and confirm the server clocks update and a timeout ends the game.

The Go and Node services both use Render's `PORT` and bind to `0.0.0.0`. Render routes public HTTP and WebSocket traffic through the service's configured port. The Node app uses the same HTTP server for `/health` and WebSocket upgrades.

## Prototype limits

- Rooms, rate-limit counters, player connections, and clocks live in one Node process. A process restart or deploy loses active matches; multiple instances do not share rooms and are not supported.
- Reconnection works only while the same process still has the room and its temporary reconnect window has not expired.
- The reconnect token is a bearer secret kept in browser session storage and sent only in the private WebSocket room-created/joined response or a resume command. It is not part of invitation URLs, room broadcasts, or server log messages. Use HTTPS/WSS in production.
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
