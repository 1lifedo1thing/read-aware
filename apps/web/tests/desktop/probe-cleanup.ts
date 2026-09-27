/**
 * Runs a probe body and then its cleanup, which may itself assert that nothing
 * leaked. A cleanup failure fails an otherwise passing probe, but it never
 * replaces the body's own failure: when both fail, the AggregateError keeps the
 * body's error first so the evidence names the original problem.
 */
export async function withProbeCleanup<T>(run: () => Promise<T>, cleanup: () => Promise<void> | void): Promise<T> {
  let result: T;
  try {
    result = await run();
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Probe failed and its cleanup failed too");
    }
    throw error;
  }
  await cleanup();
  return result;
}
