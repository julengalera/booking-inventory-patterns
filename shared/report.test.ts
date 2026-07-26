import { describe, expect, it } from "vitest";

import { reportLine } from "./report.js";

// The exact line format is load-bearing: it appears verbatim in READMEs and
// posts, so a silent formatting change would corrupt the published evidence.
describe("reportLine", () => {
  it("formats the canonical narrative line", () => {
    expect(
      reportLine(
        {
          capacity: 1,
          "concurrent requests": 50,
          "confirmed bookings": 2,
        },
        "DOUBLE BOOKING",
      ),
    ).toBe(
      "capacity: 1 · concurrent requests: 50 · confirmed bookings: 2 ← DOUBLE BOOKING",
    );
  });

  it("omits the verdict arrow when there is no verdict", () => {
    expect(reportLine({ rounds: 10, oversells: 0 })).toBe(
      "rounds: 10 · oversells: 0",
    );
  });
});
