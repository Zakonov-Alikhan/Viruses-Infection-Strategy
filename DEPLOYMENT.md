# First public deployment on Render

This prototype uses two separate Render Web Services:

1. A Go service that serves the browser client and publishes a small runtime configuration script.
2. A Node.js service that serves `/health` and accepts WebSocket upgrades at `/ws`.

Deploy the Node service first so its public URL is available when configuring the Go service. The URLs below are placeholders: use the actual addresses Render assigns after creating each service.

## Go web client

- **Root directory:** repository root
- **Build command:** `go build -o viruses-web .`
- **Start command:** `./viruses-web`
- **Health check path:** `/`
- **Environment variables:**
  - `VIRUSES_MULTIPLAYER_URL` = `wss://<actual-node-service>.onrender.com/ws`
  - `PORT` is supplied by Render. The app listens on `0.0.0.0:$PORT`.

`/runtime-config.js` exposes only the configured WebSocket URL to the browser and is sent with `Cache-Control: no-store`. Do not put credentials or tokens in this URL.

## Node.js multiplayer service

- **Root directory:** repository root
- **Build command:** `npm ci`
- **Start command:** `npm run start:multiplayer`
- **Health check path:** `/health`
- **Environment variables:**
  - `PORT` is supplied by Render. The server uses it unless `MULTIPLAYER_PORT` is explicitly set.
  - `NODE_ENV` = `production` (sets the external bind default and requires an explicit Origin allow-list).
  - `MULTIPLAYER_HOST` = `0.0.0.0`
  - `MULTIPLAYER_ALLOWED_ORIGINS` = `https://<actual-go-service>.onrender.com`
  - `MULTIPLAYER_TRUST_PROXY` = `true` so the room request limiter can use the client address forwarded by Render's proxy.

Use exact web origins in `MULTIPLAYER_ALLOWED_ORIGINS`, comma-separated if you have more than one, for example the Render domain and a custom domain. Do not include paths or trailing slashes. The server rejects a missing or non-allow-listed `Origin` on WebSocket upgrades.

## After both services start

1. Copy the Node service's assigned HTTPS origin and set the Go service's `VIRUSES_MULTIPLAYER_URL` to its `wss://` address ending in `/ws`.
2. Copy the Go service's assigned HTTPS origin and add it to the Node service's `MULTIPLAYER_ALLOWED_ORIGINS`.
3. Redeploy both services after changing their environment variables.
4. Open the Go service URL, create a private room, and join from a second browser or device using the invitation code.
5. Confirm the Node service `/health` returns HTTP 200 and the browser Network panel shows a successful WebSocket upgrade to `/ws`.

The Go service uses Render's `PORT` and binds to `0.0.0.0`, as required for public web services. Render routes public HTTP and WebSocket traffic for each service through that service's one configured port. The application uses the same Node HTTP server for `/health` and WebSocket upgrades.

## Prototype limits

- Rooms, rate-limit counters, player connections, and clocks live in one Node process. A process restart or deploy loses active matches; multiple instances do not share rooms and are not supported.
- Reconnection works only while the same process still has the room and its temporary reconnect window has not expired.
- The reconnect token is a bearer secret kept in browser session storage and sent only in the private WebSocket room-created/joined response or a resume command. It is not part of invitation URLs, room broadcasts, or server log messages. Use HTTPS/WSS in production.
- Origin filtering reduces browser-based cross-site access, but it is not player authentication. Room codes are private invitations, not accounts or strong identity. Rate limiting is in-memory and per client address; it is not a substitute for edge protection or abuse monitoring.
- There is no persistence, account system, rating, or recovery after a server restart.

## Render references

- [Web Services: port binding and WebSocket support](https://render.com/docs/web-services)
- [WebSockets: connection lifecycle and instance shutdown](https://render.com/docs/websocket)
- [Health Checks](https://render.com/docs/health-checks)
