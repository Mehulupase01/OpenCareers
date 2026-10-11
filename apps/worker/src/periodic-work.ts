export function startPeriodicWork(
  intervalMs: number,
  work: () => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  if (!Number.isInteger(intervalMs) || intervalMs < 20 || intervalMs > 60000)
    throw new Error("Periodic work interval is outside its bound.");
  let stopped = false;
  let busy = false;
  let pending: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped || busy) return;
    busy = true;
    pending = Promise.resolve()
      .then(work)
      .then(() => undefined)
      .catch((error: unknown) => {
        try {
          onError(error);
        } catch {
          /* Diagnostics must not strand the single-flight slot. */
        }
      })
      .finally(() => {
        busy = false;
      });
  }, intervalMs);
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pending;
    },
  };
}
