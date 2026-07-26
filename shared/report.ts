/**
 * Narrative test output.
 *
 * The proof methodology of this repo requires test output that tells the story
 * on its own, because it gets pasted verbatim into READMEs and posts:
 *
 *   capacity: 1 · concurrent requests: 50 · confirmed bookings: 2 ← DOUBLE BOOKING
 *
 * One tiny formatter keeps that line identical everywhere instead of each test
 * hand-rolling its own string.
 */

/**
 * Format facts as `label: value` pairs joined by ` · `, with an optional
 * verdict appended as ` ← VERDICT`.
 *
 * Facts are passed as a plain object: JavaScript guarantees insertion order
 * for string keys, so the line reads in exactly the order the caller wrote.
 */
export function reportLine(
  facts: Record<string, string | number>,
  verdict?: string,
): string {
  const body = Object.entries(facts)
    .map(([label, value]) => `${label}: ${value}`)
    .join(" · ");
  return verdict === undefined ? body : `${body} ← ${verdict}`;
}
