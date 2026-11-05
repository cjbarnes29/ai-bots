/**
 * Remembers where the person is in a setup wizard or tutorial, so they can close the page and resume later. Stored in this browser only
 * (localStorage) and holds step numbers only, never a key or any other secret. The real configuration (keys, switches, models) is stored
 * by the backend; a wizard also works out which steps are done from that real state.
 */
export interface Progress {
  step: number;
  done: number[];
}

const PREFIX = "awp.setup.";

export function loadProgress(id: string): Progress {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + id);
    const v = raw ? (JSON.parse(raw) as Partial<Progress>) : null;
    const step = typeof v?.step === "number" && v.step >= 0 && v.step < 50 ? Math.floor(v.step) : 0;
    const done = Array.isArray(v?.done) ? v!.done.filter((n): n is number => typeof n === "number" && n >= 0 && n < 50) : [];
    return { step, done: [...new Set(done)] };
  } catch {
    return { step: 0, done: [] };
  }
}

export function saveProgress(id: string, p: Progress): void {
  try {
    globalThis.localStorage?.setItem(PREFIX + id, JSON.stringify({ step: p.step, done: [...new Set(p.done)].sort((a, b) => a - b) }));
  } catch {
    /* storage full or blocked: resuming is a convenience only */
  }
}

export function clearProgress(id: string): void {
  try {
    globalThis.localStorage?.removeItem(PREFIX + id);
  } catch {
    /* ignore */
  }
}
