import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Pool } from "pg";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "cw_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SCRYPT_OPTIONS = Object.freeze({ N: 1 << 15, r: 8, p: 1, keyLength: 64 });
let dummyPasswordHashPromise;

function getDummyPasswordHash() {
  dummyPasswordHashPromise ??= hashPassword("invalid-account-password-dummy");
  return dummyPasswordHashPromise;
}

export function normalizeUsername(value) {
  if (typeof value !== "string") return null;
  const username = value.trim();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return null;
  return { username, normalized: username.toLowerCase() };
}

export function calculateElo(ratingA, ratingB) {
  const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  return Math.round(32 * (1 - expectedA));
}

export function sessionCookie(token, { secure = process.env.NODE_ENV === "production" } = {}) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie({ secure = process.env.NODE_ENV === "production" } = {}) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function readSessionCookie(header = "") {
  for (const field of header.split(";")) {
    const [name, ...rest] = field.trim().split("=");
    if (name === SESSION_COOKIE) {
      const token = rest.join("=");
      return /^[A-Za-z0-9_-]{40,64}$/.test(token) ? token : null;
    }
  }
  return null;
}

function hashSession(token) {
  return createHash("sha256").update(token).digest();
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_OPTIONS.keyLength, {
    N: SCRYPT_OPTIONS.N, r: SCRYPT_OPTIONS.r, p: SCRYPT_OPTIONS.p,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, nText, rText, pText, saltText, expectedText] = String(encoded).split("$");
  const N = Number(nText), r = Number(rText), p = Number(pText);
  if (algorithm !== "scrypt" || N !== SCRYPT_OPTIONS.N || r !== SCRYPT_OPTIONS.r || p !== SCRYPT_OPTIONS.p) return false;
  let salt, expected;
  try {
    salt = Buffer.from(saltText, "base64url");
    expected = Buffer.from(expectedText, "base64url");
  } catch { return false; }
  if (salt.length !== 16 || expected.length !== SCRYPT_OPTIONS.keyLength) return false;
  const actual = Buffer.from(await scrypt(password, salt, expected.length, {
    N, r, p, maxmem: 64 * 1024 * 1024
  }));
  return timingSafeEqual(actual, expected);
}

const MIGRATION_URL = new URL("./migrations/001_accounts_ratings.sql", import.meta.url);

export class AccountStore {
  constructor({ pool, databaseUrl = process.env.DATABASE_URL, now = () => new Date() } = {}) {
    if (!pool && !databaseUrl) throw new Error("DATABASE_URL is required for account storage");
    this.pool = pool ?? new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 30_000 });
    this.ownsPool = !pool;
    this.now = now;
  }

  async initialize() {
    const migration = await readFile(MIGRATION_URL, "utf8");
    await this.pool.query(migration);
    await this.pool.query(`DELETE FROM cw_sessions WHERE expires_at <= now()`);
  }

  async register({ username: rawUsername, password }) {
    const name = normalizeUsername(rawUsername);
    if (!name || typeof password !== "string" || password.length < 10 || password.length > 128) {
      return { ok: false, code: "invalid-registration" };
    }
    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    try {
      const result = await this.pool.query(
        `INSERT INTO cw_accounts (id, username, username_normalized, password_hash)
         VALUES ($1, $2, $3, $4) RETURNING id, username, rating, wins, losses, created_at`,
        [id, name.username, name.normalized, passwordHash]
      );
      return { ok: true, account: result.rows[0] };
    } catch (error) {
      if (error?.code === "23505") return { ok: false, code: "username-taken" };
      throw error;
    }
  }

  async authenticate({ username: rawUsername, password }) {
    const name = normalizeUsername(rawUsername);
    if (!name || typeof password !== "string" || password.length > 128) {
      await verifyPassword(typeof password === "string" && password.length <= 128 ? password : "invalid-password-placeholder", await getDummyPasswordHash());
      return null;
    }
    const result = await this.pool.query(
      `SELECT id, username, password_hash, rating, wins, losses, created_at
       FROM cw_accounts WHERE username_normalized = $1`, [name.normalized]
    );
    const encoded = result.rows[0]?.password_hash ?? await getDummyPasswordHash();
    const validPassword = await verifyPassword(password, encoded);
    if (!result.rowCount || !validPassword) return null;
    const { password_hash: _passwordHash, ...account } = result.rows[0];
    return account;
  }

  async createSession(accountId) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_SECONDS * 1000);
    await this.pool.query(
      `INSERT INTO cw_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3)`,
      [hashSession(token), accountId, expiresAt]
    );
    return token;
  }

  async getSession(token) {
    const result = await this.pool.query(
      `SELECT a.id, a.username, a.rating, a.wins, a.losses, a.created_at
       FROM cw_sessions s JOIN cw_accounts a ON a.id = s.account_id
       WHERE s.token_hash = $1 AND s.expires_at > $2`, [hashSession(token), this.now()]
    );
    return result.rows[0] ?? null;
  }

  async deleteSession(token) {
    await this.pool.query(`DELETE FROM cw_sessions WHERE token_hash = $1`, [hashSession(token)]);
  }

  async getById(id) {
    const result = await this.pool.query(
      `SELECT id, username, rating, wins, losses, created_at FROM cw_accounts WHERE id = $1`, [id]
    );
    return result.rows[0] ?? null;
  }

  async getRatings(ids) {
    if (!ids.length) return {};
    const result = await this.pool.query(`SELECT id, rating FROM cw_accounts WHERE id = ANY($1::uuid[])`, [ids]);
    return Object.fromEntries(result.rows.map(({ id, rating }) => [id, Number(rating)]));
  }

  async leaderboard(limit = 100) {
    const result = await this.pool.query(
      `SELECT username, rating, wins, losses FROM cw_accounts
       ORDER BY rating DESC, wins DESC, username_normalized ASC LIMIT $1`,
      [Math.max(1, Math.min(100, limit))]
    );
    return result.rows.map((row, index) => ({ rank: index + 1, ...row }));
  }

  async recordRatedMatch({ matchId, winnerId, loserId, ratingsAtStart }) {
    if (!winnerId || !loserId || winnerId === loserId) return { recorded: false, reason: "not-rated" };
    const winnerStart = Number(ratingsAtStart?.[winnerId]);
    const loserStart = Number(ratingsAtStart?.[loserId]);
    if (!Number.isFinite(winnerStart) || !Number.isFinite(loserStart)) return { recorded: false, reason: "missing-rating-snapshot" };
    const delta = calculateElo(winnerStart, loserStart);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO cw_rated_matches (match_id, winner_id, loser_id, winner_rating_before, loser_rating_before, rating_delta)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (match_id) DO NOTHING RETURNING match_id`,
        [matchId, winnerId, loserId, winnerStart, loserStart, delta]
      );
      if (!inserted.rowCount) {
        await client.query("COMMIT");
        return { recorded: false, reason: "already-recorded" };
      }
      const ratingUpdates = [
        { id: winnerId, change: delta, wins: 1, losses: 0 },
        { id: loserId, change: -delta, wins: 0, losses: 1 }
      ].sort((a, b) => a.id.localeCompare(b.id));
      for (const update of ratingUpdates) {
        await client.query(
          `UPDATE cw_accounts SET rating = rating + $1, wins = wins + $2, losses = losses + $3 WHERE id = $4`,
          [update.change, update.wins, update.losses, update.id]
        );
      }
      await client.query("COMMIT");
      return { recorded: true, delta };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }
}

export function createAccountStoreFromEnv(env = process.env) {
  return env.DATABASE_URL ? new AccountStore({ databaseUrl: env.DATABASE_URL }) : null;
}
