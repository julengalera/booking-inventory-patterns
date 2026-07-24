/**
 * Concurrency test helper.
 *
 * The whole repo hinges on making races reproducible, and you cannot reproduce
 * a race if your "concurrent" calls do not actually overlap. Firing N promises
 * in a loop is not enough: the event loop can finish the first calls before the
 * last ones even start, so they never contend.
 *
 * `runConcurrently` fixes that with a start barrier: every call is registered as
 * waiting on the SAME promise, and only once all N are parked do we release them
 * together, as close to simultaneously as a single-threaded runtime allows.
 */

/**
 * Release `n` calls against a single start barrier so they truly overlap, then
 * settle every result (fulfilled AND rejected) for the caller to count.
 *
 * Nothing is thrown: an oversell test needs to see how many calls succeeded
 * versus failed, so we never short-circuit on the first rejection.
 */
export function runConcurrently<T>(
  n: number,
  fn: (i: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });

  // Register all N calls as waiting on the barrier BEFORE releasing it, so that
  // none of them can start early.
  const runs = Array.from({ length: n }, (_, i) => barrier.then(() => fn(i)));

  // Everyone is parked on the barrier; drop it and let them go at once.
  release();

  return Promise.allSettled(runs);
}
