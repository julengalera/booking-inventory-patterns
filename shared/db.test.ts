import { describe, expect, it } from "vitest";

import { withClient, withTransaction } from "./db.js";

// The four tables pattern 1 needs. If any is missing, the global setup did not
// apply db/schema.sql — the failure should say exactly which table.
const TABLES = ["properties", "room_types", "room_type_inventory", "bookings"];

describe("database wiring", () => {
  it("connects to Postgres", async () => {
    const answer = await withClient(async (client) => {
      const { rows } = await client.query<{ one: number }>("SELECT 1 AS one");
      return rows[0]?.one;
    });
    expect(answer).toBe(1);
  });

  it("has applied the pattern-1 schema: every table exists and is empty", async () => {
    await withClient(async (client) => {
      for (const table of TABLES) {
        // to_regclass returns the table's name if it exists, NULL otherwise —
        // a clean existence check that never throws on a missing relation.
        const exists = await client.query<{ reg: string | null }>(
          "SELECT to_regclass($1) AS reg",
          [`public.${table}`],
        );
        expect(
          exists.rows[0]?.reg,
          `table ${table} should exist`,
        ).not.toBeNull();

        // Table names come from the fixed local allowlist above, never user
        // input, so interpolating them here is safe (params cannot name a table).
        const count = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${table}`,
        );
        expect(count.rows[0]?.n, `table ${table} should start empty`).toBe(0);
      }
    });
  });

  it("commits a successful transaction", async () => {
    const marker = "commit-me";
    const id = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO properties (name) VALUES ($1) RETURNING id",
        [marker],
      );
      return rows[0]!.id;
    });

    // Read it back on a DIFFERENT connection: only a real COMMIT makes the row
    // visible outside the transaction that wrote it.
    const name = await withClient(async (client) => {
      const { rows } = await client.query<{ name: string }>(
        "SELECT name FROM properties WHERE id = $1",
        [id],
      );
      return rows[0]?.name;
    });
    expect(name).toBe(marker);

    // Leave the shared database as pristine as we found it.
    await withClient((client) =>
      client.query("DELETE FROM properties WHERE id = $1", [id]),
    );
  });

  it("rolls back a failed transaction, leaving no trace", async () => {
    const marker = "rollback-me";
    await expect(
      withTransaction(async (client) => {
        await client.query("INSERT INTO properties (name) VALUES ($1)", [
          marker,
        ]);
        // The insert happened, but throwing before COMMIT must undo it.
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const survivors = await withClient(async (client) => {
      const { rows } = await client.query(
        "SELECT 1 FROM properties WHERE name = $1",
        [marker],
      );
      return rows.length;
    });
    expect(survivors).toBe(0);
  });
});
