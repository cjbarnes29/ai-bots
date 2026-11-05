import type { AccessService } from "../access/service.js";
import type { ActionSpec, ConnectorDefinition } from "../connectors/types.js";
import type { PcService } from "../connectors/pc/service.js";
import { DesktopEngine, type RunResult } from "./engine.js";
import { redactSensitive } from "./redact.js";
import { describeStep, isDestructive, runSchema, targetSchema, type RunRequest } from "./steps.js";
import { z } from "zod";

/**
 * The desktop engine as a connector, so it sits behind the same gates as everything else the Manager's workers can do:
 *  - list_applications (read): which programs the owner approved, and what for. The Manager/worker names the required application from this list.
 *  - inspect (read): the controls of one window of a session the engine started (names and types only, never field contents).
 *  - run_steps (write): a bounded plan of steps. It ALWAYS waits for the owner's approval, which shows every step (typed text only as a length).
 * The bot needs the PC agent's "read" permission for the reads and "execute" for run_steps. Every step is checked again against the application
 * approval, the folder permissions and the Guardian when it runs, not only when the plan was approved.
 *
 * Screen text (field contents read on purpose, OCR) is returned to a worker only if that worker's model runs on this PC, or the owner switched on
 * "allow screen text for cloud models" (off by default). Otherwise those parts are withheld from the result.
 */
export interface DesktopConnectorDeps {
  engine: DesktopEngine;
  access: AccessService;
  pc: PcService;
  /** Does this bot's model run on this PC (Ollama)? Unknown or automatic routing counts as NOT local. */
  modelIsLocal: (botId: string) => boolean;
  cloudScreenText: () => boolean;
  guardHeld: () => string | null;
  prepare: () => Promise<void>;
}

const WITHHELD = "(withheld: this worker's model is not on this PC, and screen text is not sent to cloud models unless the owner allows it)";

function present(r: RunResult, allowText: boolean): string {
  const lines = r.results.map((x) => {
    let line = `${x.index + 1}. [${x.status}${x.status === "ok" ? `, ${x.evidence}` : ""}] ${x.step} - ${x.detail}`;
    const data = x.data;
    if (data && data["private"] === true) {
      line += allowText ? `\n   ${redactSensitive(JSON.stringify({ ...data, private: undefined })).slice(0, 2500)}` : `\n   ${WITHHELD}`;
    } else if (data?.["dialog"]) line += `\n   ${JSON.stringify(data["dialog"])}`;
    return line;
  });
  return [`${r.summary}`, r.session ? `Session: ${r.session} (pass it as "session" to continue)` : "No session is open.", ...lines].join("\n").slice(0, 7000);
}

export function createDesktopConnector(d: DesktopConnectorDeps): ConnectorDefinition {
  let running = false;
  const actions: Record<string, ActionSpec> = {
    list_applications: {
      kind: "read",
      description: "List the applications the owner approved for desktop control, with their ids and what you may do with each (open, view, control, close). Programs not on this list cannot be used",
      args: z.strictObject({}),
      summarize: () => "List the applications approved for desktop control",
      execute: async () => {
        const apps = d.access.view().apps.filter((a) => (a.level === "approved" || a.level === "trusted" || a.session) && a.level !== "protected");
        if (apps.length === 0) return "No application is approved for desktop control yet. The owner approves programs under Access > Applications.";
        return apps.map((a) => `${a.id}  ${a.name}  (${a.level}${a.session ? ", this session" : ""}; may: ${(a.approval?.capabilities ?? a.session?.capabilities ?? []).join(", ")})`).join("\n");
      },
    },
    inspect: {
      kind: "read",
      description: "List the controls (buttons, fields, menus) of a window of an application you started, by name and type. Field contents are never shown, only their length",
      args: z.strictObject({ session: z.string().regex(/^s[0-9a-f]{12}$/), window: z.strictObject({ titleContains: z.string().min(1).max(120) }).optional() }),
      summarize: (a) => `Inspect the controls of session ${String(a["session"])}`,
      execute: async (a) => {
        await d.prepare();
        const v = await d.engine.inspect(String(a["session"]), a["window"] as { titleContains: string } | undefined);
        const rows = v.controls.slice(0, 120).map((c) => `${c.type}${c.automationId ? `#${c.automationId}` : ""} "${c.name ?? ""}"${c.secret ? " [secret field]" : ""}${c.valueLength ? ` (${c.valueLength} chars)` : ""}${c.toggle ? ` [${c.toggle}]` : ""}${c.enabled ? "" : " [disabled]"}`);
        return `Window "${v.window.title ?? ""}"${v.window.fileDialog ? " (a file dialog: use the file_dialog step)" : ""}${v.truncated ? " (list cut short)" : ""}\n${rows.join("\n")}`;
      },
    },
    run_steps: {
      kind: "write",
      timeoutMs: 240_000,
      description:
        "Operate an approved application with a plan of up to 25 steps. Start with {do:'launch', app:<id from list_applications>}. Steps: launch, wait_window, click, toggle, select, focus, type, keys, read, read_screen (local OCR), file_dialog (save/open through the program's own dialog, only in folders the owner approved), close_window, release. " +
        "A target is {name|nameContains|automationId, type?, index?}. Add 'expect' to a click/keys step to PROVE the result (a window title or a control value); without it the step is reported as not verified. Steps that replace text or discard work need overwrite/discard AND allowDestructive:true. " +
        "The run stops at the first problem, at a dialog it did not expect, or when the Guardian pauses. Continue a run later with its session id.",
      args: runSchema as unknown as ActionSpec["args"],
      summarize: (a) => {
        const req = a as unknown as RunRequest;
        const destructive = req.steps.some(isDestructive);
        return `${destructive ? "IRREVERSIBLE STEPS INCLUDED. " : ""}Operate the desktop: ${req.steps.map((s, i) => `${i + 1}) ${describeStep(s)}`).join("; ")}`.slice(0, 1800);
      },
      execute: async (a, ctx) => {
        if (running) throw new Error("Another desktop plan is running right now. Wait for it to finish.");
        const held = d.guardHeld();
        if (held) throw new Error(`Stopped by the Guardian: ${held}`);
        running = true;
        try {
          await d.prepare();
          const req = a as unknown as RunRequest;
          const result = await d.engine.run(req);
          const allowText = !!ctx.botId && (d.modelIsLocal(ctx.botId) || d.cloudScreenText());
          return present(result, allowText);
        } finally {
          running = false;
        }
      },
    },
  };
  void targetSchema;
  return {
    id: "desktop",
    label: "Desktop applications (approved programs, UI Automation, local OCR)",
    actions,
    notReady: () => {
      if (process.platform !== "win32") return "desktop control is only available on Windows.";
      if (d.pc.isStopped()) return "the PC agent is stopped (emergency stop).";
      const held = d.guardHeld();
      return held ? `the Guardian holds everything: ${held}` : null;
    },
    authorize: (botId, action) => {
      const need = action === "run_steps" ? "execute" : "read";
      return d.pc.hasGrant(botId, need) ? null : `This bot does not have the PC "${need}" permission, which desktop control uses. The owner can give it on the bot's Permissions tab.`;
    },
  };
}
