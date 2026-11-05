import { z } from "zod";
import type { ConnectorDefinition } from "../connectors/types.js";
import type { WorkspaceService } from "./service.js";

/**
 * How an agent gets MORE from its project's workspace than the compact context it was given: read-only, through the same gate as every other read
 * (counted, audited). Only the asking task's own project is visible; the engine offers these actions only to tasks that belong to a project.
 */
export function createWorkspaceConnector(ws: () => WorkspaceService): ConnectorDefinition {
  return {
    id: "workspace",
    label: "Project workspace",
    actions: {
      read_entries: {
        kind: "read",
        description: "Read the full text of workspace entries of this task's project (give their W- numbers)",
        args: z.strictObject({ refs: z.array(z.string().min(8).max(20)).min(1).max(6) }),
        summarize: (a) => `Read workspace entries ${(a["refs"] as string[]).join(", ")}`,
        execute: async (a, ctx) => ws().readEntries(ctx.taskId, a["refs"] as string[]),
      },
      search: {
        kind: "read",
        description: "Search this task's project workspace (one line per matching entry)",
        args: z.strictObject({ query: z.string().min(2).max(200) }),
        summarize: (a) => `Search the project workspace for "${String(a["query"]).slice(0, 80)}"`,
        execute: async (a, ctx) => ws().search(ctx.taskId, String(a["query"])),
      },
    },
  };
}
