import { copyResultSupport } from "./action-support.js";
import type { ActionFact, Check, FileProbe } from "./verify.js";

const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}…` : s;
const CREATED = /^Created (.+?) \(([\d,]+) bytes\)/;

/** Pure observations; caller must establish task/workflow receipt binding BEFORE calling. Never executes an action. */
export function observeActions(actions: ActionFact[], probe: FileProbe): { checks: Check[]; evidence: number; unknown: boolean } {
  const checks: Check[] = [];
  let evidence = 0, unknown = false;
  for (const a of actions) {
    const label = `${a.connector}.${a.action}`;
    if (a.status === "executed") {
      evidence++;
      checks.push({ kind: "action_executed", outcome: "pass", detail: `${label} was approved and ran: ${clip(a.summary, 100)}` });
      if (!copyResultSupport(a.resultSupport)) {
        unknown = true;
        checks.push({ kind: "action_effect_unknown", outcome: "note", detail: `${label} (${a.id}) ran, but its specific effect is not independently classified. This does not confirm a send, save, publication or removal.` });
      }
      const created = CREATED.exec(a.result ?? "");
      if (created) {
        const path = created[1]!;
        const reported = Number(created[2]!.replace(/,/g, ""));
        const p = probe(path);
        if (p.state === "ok" && p.size === reported) {
          evidence++;
          checks.push({ kind: "file_exists", outcome: "pass", detail: `The file exists with the reported size (${reported.toLocaleString()} bytes): ${path}` });
        } else if (p.state === "ok") checks.push({ kind: "file_size_differs", outcome: "fail", detail: `The file exists but is ${p.size.toLocaleString()} bytes, not the ${reported.toLocaleString()} the action reported (it may have been changed since): ${path}` });
        else if (p.state === "missing") checks.push({ kind: "file_missing", outcome: "fail", detail: `The action reported creating a file, but it is not there (moved or deleted since?): ${path}` });
        else checks.push({ kind: "file_unchecked", outcome: "note", detail: `The file could not be checked (${p.reason}), so its existence is not confirmed.` });
      }
    } else if (a.status === "failed") checks.push({ kind: "action_failed", outcome: "fail", detail: `${label} failed: ${clip(a.error ?? "no reason recorded", 160)}` });
    else if (a.status === "pending" || a.status === "approved") checks.push({ kind: "action_waiting", outcome: "note", detail: `${label} is still waiting (${a.status}): ${clip(a.summary, 100)}` });
    else checks.push({ kind: "action_denied", outcome: "note", detail: `${label} was ${a.status}, so it did not happen.` });
  }
  return { checks, evidence, unknown };
}
