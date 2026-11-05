import type { IntegrationEntry } from "../api/types";

/** Where an integration can work. "local" = no outside account; "account" = needs the owner's own account or token. No integration has a simulated mode. */
export type Scope = "local" | "account";

export function scopeOf(e: IntegrationEntry): Scope {
  return e.secrets.length === 0 ? "local" : "account";
}

export const SCOPE_CHIP: Record<Scope, { label: string; tone: string }> = {
  local: { label: "Works on this PC, no account", tone: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  account: { label: "Needs your own account or token", tone: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
};

/** One concrete next step, from the state the server reported. Never claims more than was checked. */
export function nextStep(e: IntegrationEntry): string {
  if (e.status === "verified") return "Nothing to do. It was checked successfully; agents can use it once you switch it on for them.";
  if (e.status === "failed") return "Read the error under Test connection, fix the credential or setting, then test again.";
  if (e.status === "ready") return e.testable ? "Press Test connection to check it for real." : "It cannot be tested safely; it is first used when an agent runs an action, and anything that writes will ask you.";
  if (scopeOf(e) === "local") return e.notReady ? "Finish the one setup step described above, then it is ready to use." : "Choose where it may work, then use it.";
  return "Press Connect and follow the steps. This needs your own account or token; there is no simulated version of this service.";
}

export interface Goal {
  id: string;
  title: string;
  /** Integration ids that must be usable. */
  needs: string[];
  /** Also needs a real AI provider (the Demo AI cannot do the thinking part). */
  needsRealAi: boolean;
  note: string;
}

export const GOALS: Goal[] = [
  { id: "files", title: "Organise or inspect files in a folder", needs: ["pc"], needsRealAi: false, note: "The PC agent works inside a workspace folder you add and approve under Access. Reading and listing need no AI; asking an agent to decide what to do does." },
  { id: "docs", title: "Create Word, Excel, PowerPoint or PDF files", needs: ["documents", "pc"], needsRealAi: true, note: "An agent writes the content (real AI), then the documents tool saves it into an approved workspace folder after you approve." },
  { id: "web", title: "Read public web pages and summarise them", needs: ["browser"], needsRealAi: true, note: "Public https pages only; no sign-in." },
  { id: "mail", title: "Search and read my email", needs: ["gmail"], needsRealAi: true, note: "Drafting an email is not built; sending always asks you first." },
  { id: "drive", title: "Look at Drive, Calendar and Tasks", needs: ["gworkspace"], needsRealAi: true, note: "Uses the same Google client as Gmail." },
  { id: "chat", title: "Talk to an agent from Telegram", needs: ["telegram"], needsRealAi: true, note: "Replies go out only after you approve them." },
  { id: "code", title: "Follow GitHub issues", needs: ["github"], needsRealAi: true, note: "A read-only token is enough to start." },
  { id: "notes", title: "Keep notes in Notion", needs: ["notion"], needsRealAi: true, note: "Only pages you shared with the integration are visible." },
  { id: "auto", title: "Start an n8n automation", needs: ["n8n"], needsRealAi: false, note: "Starting it always asks you first. Use a test workflow, never a production one." },
  { id: "tools", title: "Use tools from an MCP server", needs: ["mcp"], needsRealAi: false, note: "Listing tools is automatic; running a tool always asks you." },
  { id: "explore", title: "Just explore how agents and workflows work", needs: [], needsRealAi: false, note: "Use the demo below: it needs nothing." },
];
