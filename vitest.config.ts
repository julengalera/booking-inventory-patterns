import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every test file shares one database and asserts global invariants, so the
    // files must run sequentially. The parallelism that matters is INSIDE each
    // test (via runConcurrently), not across Vitest workers.
    fileParallelism: false,

    // Lock-based concurrency tests take seconds, not milliseconds.
    testTimeout: 20_000,

    // The default reporter hides console output from passing tests, but the
    // narrative lines the tests print ARE the product of this repo — `npm test`
    // must show the double booking happen. Verbose also lists every test name,
    // and the names are written to read as documentation.
    reporters: ["verbose"],

    // Runs ONCE before the whole suite: waits for Postgres and applies
    // db/schema.sql from scratch, so every run starts from an identical, empty
    // database. See shared/globalSetup.ts.
    globalSetup: ["./shared/globalSetup.ts"],
  },
});
