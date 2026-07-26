/**
 * The proof for pattern 1 (double-booking).
 *
 * Methodology: the naive test asserts the bug OCCURS — more confirmed bookings
 * than capacity — within an attempt budget. The race window is widened to
 * RACE_WINDOW_MS via the injectable delay hook, so with the start barrier it
 * fires on the first round; the budget exists so the assertion is about the
 * race, not about lucky scheduling. The fix tests (next increments) will run
 * the SAME load and assert the invariant `confirmed <= capacity` every round.
 */

import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runConcurrently } from "../../shared/concurrency.js";
import { withClient } from "../../shared/db.js";
import { reportLine } from "../../shared/report.js";
import { book as bookNaive, SoldOutError } from "./naive.js";

const CAPACITY = 1;
const CONCURRENT_REQUESTS = 50;
const NIGHT = "2026-08-01";

// Wide enough that all 50 requests read the count before any of them commits;
// production's window is the same shape, only milliseconds wide.
const RACE_WINDOW_MS = 50;
const raceWindow = () => sleep(RACE_WINDOW_MS);

// The naive bug must show up within this many rounds. With the widened window
// it fires on round 1; the budget keeps the test honest, not flaky.
const MAX_ROUNDS = 5;

let propertyId: number;
let roomTypeId: number;

beforeAll(async () => {
  await withClient(async (client) => {
    const property = await client.query<{ id: string }>(
      `INSERT INTO properties (name) VALUES ('Pattern One Hotel') RETURNING id`,
    );
    propertyId = Number(property.rows[0]!.id);

    const roomType = await client.query<{ id: string }>(
      `INSERT INTO room_types (property_id, name)
       VALUES ($1, 'Double Deluxe') RETURNING id`,
      [propertyId],
    );
    roomTypeId = Number(roomType.rows[0]!.id);
  });
});

// Leave the database as we found it: other test files assert global state
// (db.test.ts checks every table starts empty), and files must not depend on
// the order Vitest runs them in.
afterAll(async () => {
  await withClient(async (client) => {
    await client.query(`DELETE FROM bookings WHERE room_type_id = $1`, [
      roomTypeId,
    ]);
    await client.query(
      `DELETE FROM room_type_inventory WHERE room_type_id = $1`,
      [roomTypeId],
    );
    await client.query(`DELETE FROM room_types WHERE id = $1`, [roomTypeId]);
    await client.query(`DELETE FROM properties WHERE id = $1`, [propertyId]);
  });
});

/** Reset the contended room-night to "one unit, nobody booked yet". */
async function resetRoomNight(): Promise<void> {
  await withClient(async (client) => {
    await client.query(`DELETE FROM bookings WHERE room_type_id = $1`, [
      roomTypeId,
    ]);
    await client.query(
      `INSERT INTO room_type_inventory (room_type_id, night, total_capacity)
       VALUES ($1, $2, $3)
       ON CONFLICT (room_type_id, night)
       DO UPDATE SET total_capacity = EXCLUDED.total_capacity, version = 0`,
      [roomTypeId, NIGHT, CAPACITY],
    );
  });
}

/** What the guests actually got: confirmed bookings straight from the table. */
async function countConfirmed(): Promise<number> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM bookings
        WHERE room_type_id = $1 AND night = $2 AND status = 'confirmed'`,
      [roomTypeId, NIGHT],
    );
    return rows[0]!.n;
  });
}

/**
 * SoldOutError is the expected way to lose the race; anything else (SQL error,
 * connection failure) must surface instead of silently deflating the count.
 */
function throwUnexpected(results: PromiseSettledResult<string>[]): void {
  for (const result of results) {
    if (
      result.status === "rejected" &&
      !(result.reason instanceof SoldOutError)
    ) {
      throw result.reason;
    }
  }
}

describe("naive check-then-act", () => {
  it("double-books the last room under concurrent load", async () => {
    let confirmed = 0;
    let round = 0;

    while (round < MAX_ROUNDS) {
      round++;
      await resetRoomNight();

      const results = await runConcurrently(CONCURRENT_REQUESTS, (i) =>
        bookNaive(roomTypeId, NIGHT, `guest-${i}`, raceWindow),
      );
      throwUnexpected(results);

      confirmed = await countConfirmed();
      if (confirmed > CAPACITY) break;
    }

    console.log(
      reportLine(
        {
          capacity: CAPACITY,
          "concurrent requests": CONCURRENT_REQUESTS,
          "confirmed bookings": confirmed,
        },
        confirmed > CAPACITY ? "DOUBLE BOOKING" : "no race this round",
      ),
    );

    // The whole point of the naive version: it oversells.
    expect(confirmed).toBeGreaterThan(CAPACITY);
  });
});
