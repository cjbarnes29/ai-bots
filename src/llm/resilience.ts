/**
 * Stops calling a provider that keeps failing. After `failureThreshold` failures in a row it
 * refuses calls for `openMs`; then it allows one trial call.
 */
export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(private readonly now: () => number) {}

  /** Milliseconds until calls are allowed again (0 = allowed now). */
  blockedForMs(): number {
    return Math.max(0, this.openUntil - this.now());
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openUntil = 0;
  }

  recordFailure(threshold: number, openMs: number): void {
    this.failures += 1;
    if (this.failures >= threshold) {
      this.openUntil = this.now() + openMs;
      this.failures = 0;
    }
  }

  /** Opens the breaker immediately (used when a provider reports a cost on a free model). */
  trip(openMs: number): void {
    this.openUntil = this.now() + openMs;
  }
}

/** A tiny "take a slot or fail" counter. Used to cap simultaneous requests. */
export class Semaphore {
  private inUse = 0;

  tryAcquire(max: number): boolean {
    if (this.inUse >= max) return false;
    this.inUse += 1;
    return true;
  }

  release(): void {
    this.inUse = Math.max(0, this.inUse - 1);
  }
}
