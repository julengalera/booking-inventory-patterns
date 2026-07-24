import { describe, expect, it } from "vitest";
import { runConcurrently } from "./concurrency.js";

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("runConcurrently", () => {
  it("releases all calls so they genuinely overlap in time", async () => {
    const n = 25;
    let running = 0;
    let peak = 0;

    await runConcurrently(n, async () => {
      running++;
      peak = Math.max(peak, running);
      // Hold the overlap open so every call is inside this section at once.
      await delay(20);
      running--;
    });

    // If the calls truly overlapped, at some instant all N were running
    // simultaneously. A loop of un-barriered awaits would peak well below N.
    expect(peak).toBe(n);
  });

  it("settles every result instead of short-circuiting on the first rejection", async () => {
    const n = 10;

    const results = await runConcurrently(n, async (i) => {
      if (i % 2 === 0) throw new Error(`boom ${i}`);
      return i;
    });

    expect(results).toHaveLength(n);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);
  });
});
