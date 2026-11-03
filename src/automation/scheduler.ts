import type { AutomationService } from "./service.js";

/**
 * The clock. While the app is running it looks for due schedules every 30 seconds.
 * It is only started by the real server, never by tests (they call `tick()` themselves),
 * and nothing runs while the app is stopped.
 */
export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: AutomationService,
    /** Also run on every tick (inbound message checks). Its failures never reach the clock. */
    private readonly extra?: () => Promise<unknown>,
  ) {}

  start(everyMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), everyMs);
    this.timer.unref(); // never keeps the app alive on its own
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Runs everything that is due now. Returns how many runs started. A failure here never crashes the app. */
  tick(): number {
    try {
      void this.extra?.().catch(() => undefined);
      return this.service.tick();
    } catch {
      return 0;
    }
  }
}
