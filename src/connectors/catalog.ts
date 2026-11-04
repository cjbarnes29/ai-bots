import type { FastifyInstance } from "fastify";
import type { ActionGate } from "../approvals/service.js";
import type { AuditLog } from "../audit/audit.js";
import { AppError } from "../errors.js";
import type { VaultService } from "../vault/service.js";
import type { ConnectorDefinition, ConnectorRegistry } from "./types.js";

/**
 * The Integrations Center's one list of outside services, and the "Test connection" check behind it.
 *
 * Honest by construction: a service is only "verified" after a real, harmless check succeeded (see ConnectorDefinition.verify).
 * Saved credentials alone are "ready, not tested". Nothing here ever returns a secret value, only whether one is saved.
 * No schema is involved: the last check and the last use are read back from the audit log.
 */
export type IntegrationStatus = "not_set_up" | "ready" | "verified" | "failed";

const GROUP: Record<string, string> = {
  gmail: "Communication",
  telegram: "Communication",
  gworkspace: "Google",
  github: "Developer and automation",
  notion: "Developer and automation",
  n8n: "Developer and automation",
  mcp: "Developer and automation",
  browser: "On this PC and the web",
  pc: "On this PC and the web",
  documents: "On this PC and the web",
  memory: "On this PC and the web",
};

/** Services that run on this PC and need no sign-in: "Test connection" only confirms they are ready, with no network call. */
const LOCAL: Record<string, string> = {
  pc: "The PC agent runs on this computer. Nothing to sign in to.",
  documents: "Document files are created on this computer. Nothing to sign in to.",
  memory: "Notes are kept on this computer. Nothing to sign in to.",
};

const HELP: Record<string, string[]> = {
  gmail: [
    "Press Connect Gmail and accept both permissions (read mail, send mail).",
    "If Google says the app is not verified, choose Advanced and continue: it is your own Google Cloud project.",
    "While the Google consent screen is in Testing, the sign-in expires after about 7 days. Press Connect Gmail again.",
  ],
  gworkspace: ["It uses the same Google client as Gmail. Turn on the Drive, Calendar and Tasks APIs in the same Google Cloud project, then Connect.", "Sign in again if Google says the permission was refused."],
  telegram: ["Create a bot with @BotFather and save its token.", "If the token is rejected, copy it again, with no spaces."],
  github: ["Use a fine-grained token limited to the repositories you want agents to see.", "A rejected token usually expired or lost its permissions."],
  notion: ["Create an internal integration and share only the pages you want agents to use with it."],
  n8n: ["Save the webhook address of the one n8n workflow agents may start. It cannot be tested without starting it, so it is not testable here."],
  mcp: ["Save the address of one MCP server. Listing its tools is a read; running a tool always waits for your approval."],
  browser: ["Public https pages only, no sign-in and no JavaScript. It is tested when an agent reads a page."],
  pc: ["Add a project folder in the PC Control Center first."],
};

const REASONS: [RegExp, string][] = [
  [/did not accept|rejected|sign in again|Connect .* in (the Integrations Center|Settings)|not connected|sign-in/i, "auth_rejected"],
  [/could not reach|took too long|timed out|network/i, "unreachable"],
  [/not allowed|permission/i, "insufficient_permission"],
];
const reasonFor = (message: string) => REASONS.find(([re]) => re.test(message))?.[1] ?? "failed";

export interface CatalogDeps {
  app: FastifyInstance;
  registry: ConnectorRegistry;
  vault: VaultService;
  audit: AuditLog;
  gate: ActionGate;
  /** Which agents may use this service. null means "not decided per agent here" (PC, documents, memory). */
  agentsFor: (connectorId: string) => { id: string; name: string }[] | null;
  verifyTimeoutMs?: number;
}

export async function registerIntegrationCatalog(d: CatalogDeps): Promise<void> {
  const timeoutMs = d.verifyTimeoutMs ?? 15_000;
  const secretValue = (name: string) => d.vault.resolve(name);
  const notReady = (c: ConnectorDefinition) => (c.notReady ? c.notReady({ secret: secretValue }) : null);

  const entry = (c: ConnectorDefinition) => {
    const reason = notReady(c);
    const check = d.audit.latest(["integration.verified", "integration.verify_failed"], [`"id":"${c.id}"`]);
    let status: IntegrationStatus = reason ? "not_set_up" : "ready";
    if (!reason && check) status = check.kind === "integration.verified" ? "verified" : "failed";
    const used = d.audit.latest(["approval.executed"], [`"action":"${c.id}.`]);
    const read = d.audit.latest(["external.read"], [`"action":"${c.id}.`, `"ok":true`]);
    const lastUsedAt = [used?.createdAt, read?.createdAt].filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
    return {
      id: c.id,
      label: c.label,
      group: GROUP[c.id] ?? "Other",
      status,
      notReady: reason,
      testable: Boolean(c.verify) || c.id in LOCAL,
      lastCheckAt: check?.createdAt ?? null,
      lastCheckOk: check ? check.kind === "integration.verified" : null,
      lastCheckText: check ? String(check.detail["summary"] ?? check.detail["message"] ?? "") : null,
      lastUsedAt,
      secrets: (c.secrets ?? []).map((s) => ({ name: s.name, description: s.description, saved: secretValue(s.name) !== null })),
      actions: Object.entries(c.actions).map(([name, a]) => ({ name, kind: a.kind, description: a.description })),
      agents: d.agentsFor(c.id),
      help: HELP[c.id] ?? [],
    };
  };

  d.app.get("/api/integrations", async () => ({ integrations: d.registry.list().map(entry), paused: d.gate.isPaused() }));

  d.app.post<{ Params: { id: string } }>("/api/integrations/:id/verify", async (req) => {
    const c = d.registry.get(req.params.id);
    if (!c) throw new AppError(404, "not_found", "No such service.");
    const local = c.id in LOCAL;
    if (!local && d.gate.isPaused()) throw new AppError(409, "external_paused", "All outside actions are paused. Switch them back on before testing a connection.");

    const reason = notReady(c);
    if (reason) {
      const message = `Not set up yet: ${reason}`;
      d.audit.record("integration.verify_failed", { id: c.id, reason: "not_configured", message }, { actor: "owner" });
      return { result: "failed", reason: "not_configured", message };
    }
    if (local) {
      const summary = LOCAL[c.id]!;
      d.audit.record("integration.verified", { id: c.id, summary, local: true }, { actor: "owner" });
      return { result: "verified", summary };
    }
    if (!c.verify) return { result: "not_testable", message: "This service cannot be tested without doing something real, so it is not tested here. It is only shown as ready." };

    try {
      const ok = await Promise.race([
        c.verify({ secret: secretValue }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The service took too long to answer.")), timeoutMs).unref()),
      ]);
      d.audit.record("integration.verified", { id: c.id, summary: ok.summary }, { actor: "owner" });
      return { result: "verified", summary: ok.summary, ...(ok.account ? { account: ok.account } : {}) };
    } catch (err) {
      let message = err instanceof Error ? err.message : "The check failed.";
      // Belt and braces: no saved secret value may ever appear in the answer or the log.
      for (const s of c.secrets ?? []) {
        const v = secretValue(s.name);
        if (v && v.length >= 6) message = message.split(v).join("[redacted]");
      }
      message = message.slice(0, 300);
      const why = reasonFor(message);
      d.audit.record("integration.verify_failed", { id: c.id, reason: why, message }, { actor: "owner" });
      return { result: "failed", reason: why, message };
    }
  });
}
