/**
 * The naive implementation: check-then-act.
 *
 * This is the version that passes code review. Read the capacity, count the
 * confirmed bookings, insert only if a unit is left — every step correct on
 * its own, and it even runs inside a transaction. Yet two guests can book the
 * last room.
 *
 * The flaw: between OUR read and OUR write, someone else's write can land.
 * The transaction does not prevent that. Under READ COMMITTED (Postgres'
 * default) each request counts only COMMITTED bookings, so two concurrent
 * requests both count the same state, both pass the check, both insert, both
 * commit — and nothing re-checks the count at COMMIT time. A transaction
 * buys atomicity (all-or-nothing), not mutual exclusion.
 *
 * The injectable `delay` sits exactly in that read→write window so tests can
 * widen it and make the race fire deterministically in CI. Production has the
 * same window — just narrower — which makes the bug probabilistic there, not
 * absent.
 */

import { withTransaction } from "../../shared/db.js";

/** Injected between the availability check and the insert (the race window). */
export type DelayHook = () => Promise<void>;

const noDelay: DelayHook = () => Promise.resolve();

/**
 * The check WORKED: the room-night was genuinely full when we looked. Thrown
 * (rather than returned) so a settled-results count cleanly splits attempts
 * into booked vs turned-away.
 */
export class SoldOutError extends Error {
  constructor(roomTypeId: number, night: string) {
    super(`No availability for room type ${roomTypeId} on ${night}`);
    this.name = "SoldOutError";
  }
}

/**
 * Book one unit of `roomTypeId` for `night`, returning the new booking id.
 * Throws SoldOutError when no availability is left — or so it believes.
 */
export async function book(
  roomTypeId: number,
  night: string,
  guestRef: string,
  delay: DelayHook = noDelay,
): Promise<string> {
  return withTransaction(async (client) => {
    const inventory = await client.query<{ total_capacity: number }>(
      `SELECT total_capacity
         FROM room_type_inventory
        WHERE room_type_id = $1 AND night = $2`,
      [roomTypeId, night],
    );
    const found = inventory.rows[0];
    if (!found) {
      throw new Error(`No inventory for room type ${roomTypeId} on ${night}`);
    }

    // Availability is derived, never cached: capacity minus confirmed bookings.
    const counted = await client.query<{ confirmed: number }>(
      `SELECT count(*)::int AS confirmed
         FROM bookings
        WHERE room_type_id = $1 AND night = $2 AND status = 'confirmed'`,
      [roomTypeId, night],
    );
    const confirmed = counted.rows[0]!.confirmed;

    if (confirmed >= found.total_capacity) {
      throw new SoldOutError(roomTypeId, night);
    }

    // ── The race window ──────────────────────────────────────────────────
    // From here on, the check above is STALE. Any other request that read the
    // same count is about to insert too, and nothing will stop it.
    await delay();

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bookings (room_type_id, night, guest_ref)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [roomTypeId, night, guestRef],
    );
    return inserted.rows[0]!.id;
  });
}
