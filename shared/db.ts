/**
 * The database connection layer.
 *
 * Every pattern in this repo runs raw SQL against real PostgreSQL — the driver
 * is the whole point, so it is `pg` (node-postgres) with no ORM in the way. This
 * module owns the single shared connection pool and the two thin wrappers the
 * patterns reach for: `withClient` (borrow a connection, always return it) and
 * `withTransaction` (BEGIN / COMMIT / ROLLBACK done correctly, every time).
 */

import pg from "pg";
import type { PoolClient } from "pg";

// `pg` ships as CommonJS, so under NodeNext ESM its exports arrive on the
// default import rather than as named bindings.
const { Pool } = pg;

/**
 * Where the tests connect. Defaults to the disposable Postgres that
 * `docker compose up` starts (see docker-compose.yml); override with
 * DATABASE_URL if port 5432 is already taken locally.
 */
export const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgres://booking:booking@localhost:5432/booking_patterns";

/**
 * The shared pool.
 *
 * `max` sits comfortably above the concurrency the tests generate (up to ~50
 * simultaneous booking attempts): each concurrent request must hold its OWN
 * real connection, or the "race" would just be requests queuing behind a small
 * pool instead of genuinely contending in the database.
 *
 * `allowExitOnIdle` lets the Node process exit once every connection is idle,
 * so `vitest run` finishes cleanly without a manual pool.end() dance at the end
 * of the suite.
 */
export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 60,
  allowExitOnIdle: true,
});

// A pooled connection can fail while sitting idle (e.g. Postgres restarts).
// node-postgres emits that as an 'error' event; without a listener it would
// crash the process. For a disposable test database, logging and moving on is
// the honest response — the pool discards the broken client on its own.
pool.on("error", (error) => {
  console.error("Unexpected error on an idle database client:", error);
});

/**
 * Borrow a connection from the pool, run `fn` with it, and ALWAYS return it —
 * even if `fn` throws. Leaking connections is the classic way a pool of 60
 * silently becomes a pool of 0 under load.
 */
export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Run `fn` inside a transaction: BEGIN first, COMMIT if it returns, ROLLBACK and
 * re-throw if it does not. The connection is always released back to the pool.
 *
 * The patterns lean on this constantly — an atomic read-then-write is only
 * atomic if the whole thing lives in one transaction on one connection.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
