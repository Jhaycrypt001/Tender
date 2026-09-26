import type { Logger } from "../lib/logger.js";

/**
 * Runs `fn` repeatedly, `intervalMs` after each run FINISHES — never
 * overlapping itself. A thrown error is logged and the loop carries on.
 */
export function startLoop(name: string, intervalMs: number, fn: () => Promise<unknown>, logger: Logger) {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> | undefined;
  let stopped = false;

  const run = async () => {
    running = fn().catch((err: unknown) => logger.error({ err, loop: name }, "loop iteration failed"));
    await running;
    if (!stopped) timer = setTimeout(run, intervalMs);
  };
  void run();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
