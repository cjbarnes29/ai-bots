import { z } from "zod";
import type { ActionSpec, ConnectorDefinition } from "../connectors/types.js";
import { DiscoveryLimitError, DISCOVERY_LIMITS } from "./discovery.js";
import { AllowanceUsedUpError, ExternalDisabledError } from "./audit.js";
import { CATEGORY_IDS } from "./markets.js";
import { proposalFacts } from "./proposal.js";
import { BUSINESS_LIMITS, fit, lineFor, siteWords, type BusinessService } from "./service.js";
import { LEAD_STATUSES } from "./leads.js";

/**
 * The Business Workforce connector: what an agent can ask for.
 *
 *   find_businesses  READ   look up small businesses in the map data (staged in memory, nothing saved)
 *   audit_batch      READ   check the websites of up to ten staged leads (read-only homepage checks)
 *   show_batch       READ   see a staged batch again
 *   list_leads       READ   the saved leads
 *   proposal_facts   READ   plain facts about one saved lead, for writing a proposal
 *   save_leads       WRITE  save a staged batch to the leads file. ALWAYS waits for the owner's approval, and the approval is bound
 *                           to the batch and to a hash of its exact rows.
 *
 * The two actions that reach the outside (find_businesses, audit_batch) are refused unless the owner has switched outside requests on.
 * An agent needs the same "web reading" switch as the browser for the reads. Nothing here sends, publishes or contacts anyone.
 */
const batchId = z.string().regex(/^B-[0-9a-f]{8}$/, "must be a batch id from find_businesses");
const hash = z.string().regex(/^[0-9a-f]{64}$/, "must be the 64-character rowsHash shown with the batch");
const leadId = z.string().regex(/^L-[0-9a-f]{12}$/, "must be a lead id from list_leads");
const OUTSIDE = new Set(["find_businesses", "audit_batch"]);

export function createBusinessConnector(svc: BusinessService): ConnectorDefinition {
  const budget = BUSINESS_LIMITS.resultChars;

  /** The best rows first, as many lines as fit in the result budget. */
  const table = (rows: import("./leads.js").Lead[], max = 15): string => {
    const sorted = [...rows].sort((x, y) => (y.lead_score ?? -1) - (x.lead_score ?? -1));
    const { text } = fit(sorted.slice(0, max).map(lineFor), budget - 900);
    const shown = text ? text.split("\n").length : 0;
    const more = rows.length - shown;
    return `${text}${more > 0 ? `\n(+${more} more not shown)` : ""}`;
  };

  const actions: Record<string, ActionSpec> = {
    find_businesses: {
      kind: "read",
      description: `Look up small businesses in public map data (country, optional emirate, category, up to ${DISCOVERY_LIMITS.maxResults}). Prefer ONE category per search: "all" asks the free map service for everything at once and may time out. Results are staged, not saved. Categories: ${CATEGORY_IDS.join(", ")}, all`,
      args: z.strictObject({
        market: z.string().max(4).default("AE"),
        region: z.string().max(40).optional(),
        category: z.string().max(20).default("all"),
        limit: z.number().int().min(1).max(DISCOVERY_LIMITS.maxResults).default(DISCOVERY_LIMITS.defaultResults),
      }),
      summarize: (a) => `Look up ${String(a["category"])} businesses in ${String(a["region"] ?? "all of " + String(a["market"]))} (read-only map search)`,
      timeoutMs: 120_000,
      execute: async (a) => {
        try {
          const r = await svc.findBusinesses({ market: String(a["market"]), region: a["region"] as string | undefined, category: String(a["category"]), limit: Number(a["limit"]) });
          const head = svc.header(`Batch ${r.batch.id} (${r.batch.label}): ${r.batch.rows.length} businesses, ${r.added} new, ${r.known} already known${r.fromCache ? " (answered from memory, no new request)" : ""}.\nrowsHash: ${svc.hashOf(r.batch)}`);
          const tail = "Next: audit_batch {batchId} checks listed websites; save_leads {batchId, rowsHash} asks the owner to approve saving. A business with no website listed is NOT proven to have none.";
          return `${head}\n${table(r.batch.rows)}\n${tail}`.slice(0, budget + 400);
        } catch (e) {
          if (e instanceof ExternalDisabledError) throw new Error(e instanceof AllowanceUsedUpError ? e.message : svc.refusal()!);
          throw e;
        }
      },
    },

    audit_batch: {
      kind: "read",
      description: `Check the websites of up to ${BUSINESS_LIMITS.auditsPerCall} staged leads that have a website address (read-only homepage checks). A failed check is reported as a failure, never as a poor website`,
      args: z.strictObject({ batchId, max: z.number().int().min(1).max(BUSINESS_LIMITS.auditsPerCall).default(BUSINESS_LIMITS.auditsPerCall) }),
      summarize: (a) => `Check up to ${String(a["max"])} websites in batch ${String(a["batchId"])} (read-only)`,
      timeoutMs: 180_000,
      execute: async (a) => {
        try {
          const r = await svc.auditBatch(String(a["batchId"]), Number(a["max"]));
          const failed = r.batch.rows.filter((l) => l.website_state === "audit_failed").length;
          const head = svc.header(`Batch ${r.batch.id}: checked ${r.checked} website(s) now; ${r.remaining} listed website(s) still unchecked; ${failed} check(s) FAILED (a failed check says nothing about quality).${r.stoppedByLimit ? " Stopped early: a daily limit was reached or outside requests were switched off." : ""}\nrowsHash: ${svc.hashOf(r.batch)}`);
          return `${head}\n${table(r.batch.rows)}`.slice(0, budget + 400);
        } catch (e) {
          if (e instanceof ExternalDisabledError) throw new Error(e instanceof AllowanceUsedUpError ? e.message : svc.refusal()!);
          throw e;
        }
      },
    },

    show_batch: {
      kind: "read",
      description: "Show a staged batch again, with its current rowsHash",
      args: z.strictObject({ batchId }),
      summarize: (a) => `Show batch ${String(a["batchId"])}`,
      execute: async (a) => {
        const b = svc.staging.get(String(a["batchId"]));
        if (!b) throw new Error("That batch is not available any more (it may have expired or the app restarted). Run the search again.");
        const states = new Map<string, number>();
        for (const l of b.rows) states.set(l.website_state, (states.get(l.website_state) ?? 0) + 1);
        const counts = [...states.entries()].map(([k, n]) => `${k}: ${n}`).join(", ");
        return `${svc.header(`Batch ${b.id} (${b.label}): ${b.rows.length} businesses (${counts}).\nrowsHash: ${svc.hashOf(b)}`)}\n${table(b.rows)}`.slice(0, budget + 400);
      },
    },

    save_leads: {
      kind: "write",
      description: "Save a staged batch to the leads file (CSV). ALWAYS needs the owner's approval. The approval covers exactly the rows with this rowsHash; if they change, nothing is saved",
      args: z.strictObject({ batchId, rowsHash: hash }),
      summarize: (a) => {
        const b = svc.staging.get(String(a["batchId"]));
        if (!b) return `Save batch ${String(a["batchId"])} to the leads file (the batch is no longer available)`;
        const match = svc.hashOf(b) === a["rowsHash"] ? "" : " [WARNING: the batch has changed since this was requested; it will NOT be saved]";
        const high = b.rows.filter((l) => l.priority === "high").length;
        const names = b.rows.slice(0, 3).map((l) => l.business_name.slice(0, 30)).join(", ");
        return `Save ${b.rows.length} leads (${high} high priority) from "${b.label}" to the leads file: ${names}${b.rows.length > 3 ? ", ..." : ""}${match}`;
      },
      execute: async (a) => {
        const r = await svc.saveBatch(String(a["batchId"]), String(a["rowsHash"]));
        return `Saved to the leads file: ${r.added} added, ${r.updated} updated, ${r.duplicates} skipped as duplicates.`;
      },
    },

    list_leads: {
      kind: "read",
      description: `List the saved leads, best first (up to 15). Optional filters: status (${LEAD_STATUSES.join(", ")}), priority (high, medium, low)`,
      args: z.strictObject({ status: z.enum(LEAD_STATUSES).optional(), priority: z.enum(["high", "medium", "low"]).optional(), limit: z.number().int().min(1).max(15).default(10) }),
      summarize: (a) => `List saved leads${a["status"] ? ` with status ${String(a["status"])}` : ""}${a["priority"] ? ` and priority ${String(a["priority"])}` : ""}`,
      execute: async (a) => {
        const rows = svc.listLeads({ status: a["status"] as string | undefined, priority: a["priority"] as string | undefined });
        if (rows.length === 0) return "No saved leads match.";
        const { text } = fit(rows.slice(0, Number(a["limit"])).map((l, i) => `${lineFor(l, i)} | id ${l.lead_id}`), budget - 600);
        return `${svc.header(`${rows.length} saved lead(s):`)}\n${text}`;
      },
    },

    proposal_facts: {
      kind: "read",
      description: "Plain facts about one saved lead (what is wrong or missing, in simple words, and suggested services) for writing a proposal in English. Contains no price",
      args: z.strictObject({ leadId }),
      summarize: (a) => `Read the facts for lead ${String(a["leadId"])}`,
      execute: async (a) => {
        const lead = svc.store.read().rows.find((l) => l.lead_id === a["leadId"]);
        if (!lead) throw new Error("No saved lead has that id. Use list_leads first.");
        return `${svc.header("")}\n${proposalFacts(lead)}`.slice(0, budget);
      },
    },
  };

  return {
    id: "business",
    label: "Business Workforce",
    actions,
    // Only the two actions that reach the outside are refused while the lock is off; the local ones always work.
    authorize: (_botId, action) => (OUTSIDE.has(action) ? svc.refusal() : null),
  };
}

export { DiscoveryLimitError, siteWords };
