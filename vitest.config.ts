import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every test file shares one database and asserts global invariants, so the
    // files must run sequentially. The parallelism that matters is INSIDE each
    // test (via runConcurrently), not across Vitest workers.
    fileParallelism: false,

    // Lock-based concurrency tests take seconds, not milliseconds.
    testTimeout: 20_000,

    // A database-applying globalSetup is added in the next increment, once the
    // schema is wired to a running Postgres. The helper smoke test needs no DB.
  },
});
