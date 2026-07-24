-- Schema for pattern 1 (double-booking).
--
-- Applied from scratch by the Vitest global setup before the suite runs, so it
-- is deliberately idempotent: dropping and recreating the `public` schema means
-- every run starts from an identical, empty database. There is no migration
-- tool here on purpose — a disposable, tmpfs-backed test database does not need
-- one; it needs to be reproducible in a single file.
--
-- The schema grows one pattern at a time. Today it holds ONLY what pattern 1
-- needs: properties, room types, per-night inventory, and bookings.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- Properties (hotels). Low-volume configuration data, so a plain, readable
-- identity key is the right fit. GENERATED ALWAYS AS IDENTITY is the SQL
-- standard successor to `serial`: it owns its sequence cleanly and cannot be
-- overwritten by accident.
CREATE TABLE properties (
  id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL
);

-- A sellable category of room within a property (e.g. "Double Deluxe").
CREATE TABLE room_types (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id bigint NOT NULL REFERENCES properties (id),
  name        text   NOT NULL
);

-- One row per room type per night: this row is the unit of contention.
--
-- Availability is NOT stored here as a counter. It is DERIVED at read time as
--   total_capacity - count(confirmed bookings for this room_type + night).
-- That is a deliberate choice: a cached "remaining" counter is its own source
-- of drift bugs (a separate pattern). Pattern 1 keeps the single source of
-- truth in the bookings table and computes availability from it.
--
-- This is the row the two fixes contend over:
--   * fix A (pessimistic) locks it with SELECT ... FOR UPDATE
--   * fix B (optimistic) guards it with the `version` column and a retry loop
-- The `version` column is not designing ahead — it IS pattern 1's fix B.
CREATE TABLE room_type_inventory (
  room_type_id   bigint NOT NULL REFERENCES room_types (id),
  night          date   NOT NULL,
  total_capacity int    NOT NULL CHECK (total_capacity >= 0),
  version        int    NOT NULL DEFAULT 0,
  PRIMARY KEY (room_type_id, night)
);

-- A single confirmed reservation of one unit of a room type for one night.
--
-- Single-night by design: multi-night stays (and the lock-ordering deadlock
-- they invite) belong to a later pattern, so `night` is one date, not a range.
-- A UUID primary key keeps bookings non-enumerable and lets a client generate
-- the id without a round-trip — handy once idempotency keys arrive.
-- gen_random_uuid() is built into Postgres core (13+); no extension needed.
CREATE TABLE bookings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id bigint      NOT NULL REFERENCES room_types (id),
  night        date        NOT NULL,
  guest_ref    text        NOT NULL,
  status       text        NOT NULL DEFAULT 'confirmed',
  created_at   timestamptz NOT NULL DEFAULT now()
);
