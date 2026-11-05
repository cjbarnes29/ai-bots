import type { FastifyInstance } from "fastify";

/**
 * The Manager's view of the Guardian. The Manager can LOOK (is everything allowed to run?) and CHECK a proof token the owner got from
 * the Guardian. It cannot resume, unlock, stop or change anything: the Guardian does not accept those from here (they need the
 * owner's passphrase, which the Manager never sees), and this class does not even have methods for them.
 *
 * It fails CLOSED: if the Guardian stops answering, nothing new starts. If no Guardian is configured at all (GUARDIAN_URL not set), the
 * app behaves exactly as before and says so on the dashboard. That is the supervised-development default; see docs/GUARDIAN.md.
 */
export interface GuardianGate {
  /** Why new work must not start right now, in plain language, or null when it may. */
  held(): string | null;
  /** Is this decision-window token valid (the owner entered the passphrase at the Guardian within the last 10 minutes)? */
  checkProof(token: string): Promise<boolean>;
  view(): GuardianView;
}

export interface GuardianView {
  configured: boolean;
  url: string | null;
  reachable: boolean;
  state: string | null;
  reason: string | null;
  held: string | null;
  tier: string | null;
  passphraseSet: boolean | null;
  presence: { monitoring: boolean; healthy: boolean; locked: boolean | null; idleMinutes: number | null; idleLimitMinutes: number } | null;
  /** True when owner-only changes need the passphrase proof. */
  protectsOwnerActions: boolean;
}

const REASONS: Record<string, string> = {
  session_locked: "the Windows session is locked",
  idle_15_minutes: "there has been no keyboard or mouse input for 15 minutes",
  owner: "the owner paused it",
  owner_stop: "the owner pressed STOP",
  owner_lockdown: "the owner locked it down",
  presence_unavailable: "the presence monitor is not working",
  restart: "the Guardian was restarted",
  first_start: "the Guardian was just started for the first time",
  unlocked: "it was unlocked and has not been resumed yet",
};

export function describeHold(state: string, reason: string): string {
  const why = REASONS[reason] ?? reason;
  return `The AI Workforce is ${state === "RUN" ? "running" : state.toLowerCase()} because ${why}. Nothing new starts until the owner resumes it at the Guardian page.`;
}

export interface GuardianLinkOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  pollMs?: number;
  /** After this long without an answer the Guardian counts as not responding. */
  staleMs?: number;
}

interface StatusBody {
  ok: boolean;
  tier?: string;
  state?: string;
  reason?: string;
  passphraseSet?: boolean;
  presence?: GuardianView["presence"];
}

export class GuardianLink implements GuardianGate {
  private last: { at: number; body: StatusBody } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly f: typeof fetch;
  private readonly now: () => number;
  private readonly staleMs: number;

  constructor(
    private readonly url: string,
    private readonly o: GuardianLinkOptions = {},
  ) {
    this.f = o.fetchFn ?? fetch;
    this.now = o.now ?? Date.now;
    this.staleMs = o.staleMs ?? 10_000;
  }

  /** Asks the Guardian once. A failure is simply "no answer": the freshness check does the rest. */
  async refresh(): Promise<void> {
    try {
      const res = await this.f(`${this.url}/v1/status`, { signal: AbortSignal.timeout(1500) });
      const body = (await res.json()) as StatusBody;
      if (res.ok && body.ok && typeof body.state === "string") this.last = { at: this.now(), body };
    } catch {
      /* not reachable */
    }
  }

  start(pollMs = this.o.pollMs ?? 2000): void {
    this.stop();
    this.timer = setInterval(() => void this.refresh(), pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private fresh(): StatusBody | null {
    return this.last && this.now() - this.last.at <= this.staleMs ? this.last.body : null;
  }

  held(): string | null {
    const s = this.fresh();
    if (!s) return "The Guardian is not responding, so nothing new will start. Start it (npm run guardian) or remove GUARDIAN_URL to run without it.";
    if (s.state === "RUN") return null;
    return describeHold(s.state ?? "PAUSED", s.reason ?? "unknown");
  }

  async checkProof(token: string): Promise<boolean> {
    if (typeof token !== "string" || token.length < 10 || token.length > 100) return false;
    try {
      const res = await this.f(`${this.url}/v1/command`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-awp-guardian": "1" },
        body: JSON.stringify({ cmd: "check_proof", token }),
        signal: AbortSignal.timeout(1500),
      });
      const body = (await res.json()) as { ok?: boolean; valid?: boolean };
      return res.ok && body.ok === true && body.valid === true;
    } catch {
      return false; // fail closed
    }
  }

  view(): GuardianView {
    const s = this.fresh();
    return {
      configured: true,
      url: this.url,
      reachable: s !== null,
      state: s?.state ?? null,
      reason: s?.reason ?? null,
      held: this.held(),
      tier: s?.tier ?? null,
      passphraseSet: s?.passphraseSet ?? null,
      presence: s?.presence ?? null,
      protectsOwnerActions: true,
    };
  }
}

export const UNCONFIGURED_VIEW: GuardianView = { configured: false, url: null, reachable: false, state: null, reason: null, held: null, tier: null, passphraseSet: null, presence: null, protectsOwnerActions: false };

export async function registerGuardianRoutes(app: FastifyInstance, guardian: GuardianGate | undefined): Promise<void> {
  // Read-only. A phone may look; changing anything happens at the Guardian itself.
  app.get("/api/guardian/status", async () => (guardian ? guardian.view() : UNCONFIGURED_VIEW));
}
