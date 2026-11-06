import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./client";

// ---- Project hub and context links (backend: src/project-hub). Read-only: nothing here changes data or grants anything. ----

export interface HubAgent {
  botId: string;
  name: string;
  archived: boolean;
  roles: string[];
  tasks: number;
  conversations: number;
  lastAt: string | null;
}
export interface Hub {
  project: { id: string; name: string; description: string; archived: boolean };
  conversations: { id: string; botId: string; botName: string; title: string; createdAt: string; lastAt: string }[];
  tasks: { id: string; rootId: string; botId: string; botName: string; instruction: string; status: string; errorMessage: string | null; createdAt: string; finishedAt: string | null }[];
  agents: HubAgent[];
  workflows: { id: string; name: string; lastRun: { id: string; status: string; error: string | null; at: string } | null }[];
  decisions: { id: string; title: string; status: string; updatedAt: string }[];
  approvals: { id: string; botId: string; botName: string; taskId: string | null; connector: string; action: string; summary: string; status: string; createdAt: string }[];
  outputs: { approvalId: string; connector: string; action: string; path: string | null; status: string; botName: string; taskId: string | null; at: string }[];
  notes: { id: string; title: string }[];
  attention: { kind: "approval" | "failed_task" | "decision" | "failed_run"; id: string; text: string }[];
  progress: { total: number; completed: number; running: number; pending: number; failed: number };
}
export type RelatedKind = "conversation" | "task" | "approval" | "decision" | "workflow" | "bot";
export interface Related {
  kind: RelatedKind;
  id: string;
  project: { id: string; name: string } | null;
  bot: { id: string; name: string } | null;
  conversation: { id: string; botId: string; title: string } | null;
  task: { id: string; rootId: string; status: string; error: string | null } | null;
  approval: { id: string; status: string; summary: string } | null;
  workflow: { id: string; name: string } | null;
  decision: { id: string; title: string } | null;
}

export function useProjectHub(id: string | null) {
  return useQuery({ queryKey: ["hub", id], enabled: id !== null, refetchInterval: 8000, queryFn: () => api<Hub>("GET", `/api/projects/${id}/hub`) });
}
export function useRelated(kind: RelatedKind, id: string | null | undefined) {
  return useQuery({ queryKey: ["related", kind, id], enabled: !!id, retry: false, queryFn: () => api<Related>("GET", `/api/related/${kind}/${encodeURIComponent(String(id))}`) });
}
export function useBotProjects(botId: string) {
  return useQuery({ queryKey: ["bot-projects", botId], retry: false, queryFn: () => api<{ projects: { id: string; name: string; via: string[] }[] }>("GET", `/api/bots/${botId}/projects`) });
}

// ---- Global search (backend: src/project-hub/search.ts). Names and titles only; read-only. ----
export type SearchKind = "project" | "agent" | "conversation" | "task" | "workflow" | "decision" | "approval" | "note" | "schedule";
export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  botId?: string;
}
export function useSearch(q: string) {
  const text = q.trim();
  return useQuery({
    queryKey: ["search", text],
    enabled: text.length >= 2,
    retry: false,
    staleTime: 5000,
    queryFn: () => api<{ query: string; hits: SearchHit[]; tooShort: boolean }>("GET", `/api/search?q=${encodeURIComponent(text)}`),
  });
}
export const HIT_LABEL: Record<SearchKind, string> = { project: "Project", agent: "Agent", conversation: "Conversation", task: "Task", workflow: "Workflow", decision: "Decision", approval: "Approval", note: "Note", schedule: "Schedule" };

/** Where each kind of thing is opened in the dashboard. One place, so every link in the app agrees. */
export const where = {
  project: (id: string, tab?: string) => `/projects/${id}${tab ? `?tab=${tab}` : ""}`,
  agent: (id: string) => `/bots/${id}`,
  conversation: (botId: string, conversationId: string) => `/bots/${botId}?tab=chat&conversation=${conversationId}`,
  task: (id: string) => `/tasks/${id}`,
  approval: (id: string) => `/approvals?focus=${id}`,
  decision: (id: string) => `/decisions?open=${id}`,
  assistant: (projectId?: string) => (projectId ? `/assistant?project=${projectId}` : "/assistant"),
  workflow: (id: string) => `/workflows?open=${id}`,
  workflowRun: (runId: string) => `/workflows?run=${runId}`,
};

/** Where a search hit opens. Workflows, notes and schedules have no page of their own, so they open their section. */
export function whereHit(h: SearchHit): string {
  switch (h.kind) {
    case "project":
      return where.project(h.id);
    case "agent":
      return where.agent(h.id);
    case "conversation":
      return h.botId ? where.conversation(h.botId, h.id) : "/inbox";
    case "task":
      return where.task(h.id);
    case "workflow":
      return `/workflows?open=${h.id}`;
    case "decision":
      return where.decision(h.id);
    case "approval":
      return where.approval(h.id);
    case "note":
      return "/knowledge";
    case "schedule":
      return "/automation";
  }
}

// ---- Workflow drafting for the AI Assistant (backend: src/workflows/draft.ts). A draft is NEVER saved by the server. ----
export interface WorkflowDraftResult {
  draft: { name: string; graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } };
  warnings: string[];
  saved: false;
  model: string;
}
export function useDraftWorkflow() {
  return useMutation({
    mutationFn: (v: string | { description: string; revise?: WorkflowDraftResult["draft"] }) => api<WorkflowDraftResult>("POST", "/api/workflows/draft", typeof v === "string" ? { description: v } : v),
  });
}
