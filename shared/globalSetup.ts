/**
 * Vitest global setup: prepare the database exactly once before the whole suite.
 *
 * It waits for Postgres to accept connections, then applies db/schema.sql from
 * scratch. The schema file drops and recreates the `public` schema, so every
 * run — local or CI — starts from an identical, empty database with no leftover
 * rows from a previous run. This is why the 90-second quickstart is only two
 * commands: `docker compose up -d` then `npm test`, with no "apply the schema"
 * step in between.
 *
 * A one-off Client is used here, not the shared pool from db.ts, on purpose:
 * global setup runs in a different process than the test workers, and a single
 * connection that opens, applies the schema, and closes is the honest tool for
 * a one-shot job — nothing to leak, nothing left open.
 */

import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import pg from "pg";

import { DATABASE_URL } from "./db.js";

const { Client } = pg;

// Resolve relative to THIS file, not the current working directory, so the
// setup works no matter where `npm test` is invoked from.
const SCHEMA_PATH = new URL("../db/schema.sql", import.meta.url);

// Postgres inside the container can still be starting up even after the port is
// open, so we retry the connection rather than failing on the first refusal.
// `docker compose up --wait` already gates on the healthcheck; this retry is the
// belt-and-braces that lets `npm test` stand on its own when it does not.
const CONNECT_ATTEMPTS = 30;
const CONNECT_RETRY_MS = 1000;

async function connect(): Promise<pg.Client> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
    const client = new Client({ connectionString: DATABASE_URL });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      // The connect failed, so this client is dead; make sure it is closed
      // before we build a fresh one on the next attempt.
      await client.end().catch(() => {});
      if (attempt < CONNECT_ATTEMPTS) await sleep(CONNECT_RETRY_MS);
    }
  }
  throw new Error(
    `Could not connect to Postgres at ${DATABASE_URL} after ${CONNECT_ATTEMPTS} attempts. ` +
      `Is it running? Try: docker compose up -d\n` +
      `Last error: ${String(lastError)}`,
  );
}

export default async function setup(): Promise<void> {
  const schema = await readFile(SCHEMA_PATH, "utf8");
  const client = await connect();
  try {
    await client.query(schema);
  } finally {
    await client.end();
  }
  console.log("✔ schema applied — database ready");
}
