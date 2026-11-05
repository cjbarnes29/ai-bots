import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// ---- Inbox and Projects (backend: src/inbox, src/projects). Bots can never post here; the owner only reads and organises. ----

export type InboxView = "all" | "unread" | "pinned" | "archived";

export interface InboxItem {
  conversationId: string;
  botId: string;
  botName: string;
  title: string;
  originalTitle: string;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  unread: number;
  lastMessage: { id: number; role: string; preview: string; createdAt: string } | null;
  lastActivityAt: string;
}
export interface InboxList {
  items: InboxItem[];
  unreadTotal: number;
  heldBack: number;
}
export interface InboxMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sender: "owner" | "bot";
  botId: string;
  initiated: boolean;
  kind: string | null;
  importance: string | null;
  source: { kind: string; id: string } | null;
}
export interface InboxThread {
  conversationId: string;
  botId: string;
  title: string;
  messages: InboxMessage[];
}
export interface InboxPrefs {
  notify: "all" | "important" | "none";
  maxPerHour: number;
  own: boolean;
}

export function useInbox(view: InboxView, q: string) {
  const qs = new URLSearchParams({ view });
  if (q.trim()) qs.set("q", q.trim());
  return useQuery({ queryKey: ["inbox", "list", view, q.trim()], queryFn: () => api<InboxList>("GET", `/api/inbox?${qs}`) });
}
export function useInboxThread(id: string | null) {
  return useQuery({ queryKey: ["inbox", "thread", id], enabled: id !== null, queryFn: () => api<InboxThread>("GET", `/api/inbox/${id}/messages`) });
}
export function useInboxPrefs() {
  return useQuery({ queryKey: ["inbox", "prefs"], queryFn: () => api<InboxPrefs>("GET", "/api/inbox/preferences") });
}
export function useSetInboxPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { notify?: InboxPrefs["notify"]; maxPerHour?: number }) => api<InboxPrefs>("PUT", "/api/inbox/preferences", p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export type InboxAction = "pin" | "mute" | "archive" | "hide" | "restore" | "read" | "rename";
/** One mutation for every small inbox change; the list and thread are refetched afterwards. */
export function useInboxAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, on, title }: { id: string; action: InboxAction; on?: boolean; title?: string }) => {
      if (action === "pin" || action === "mute" || action === "archive") return api("PUT", `/api/inbox/${id}/${action}`, { on: on ?? true });
      if (action === "rename") return api("PUT", `/api/inbox/${id}/rename`, { title: title ?? "" });
      return api("POST", `/api/inbox/${id}/${action}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export interface ProjectView {
  id: string;
  name: string;
  description: string;
  instructions: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  counts: Record<string, number>;
}
export interface ProjectItem {
  kind: string;
  id: string;
  pinned: boolean;
  addedAt: string;
  title: string | null;
}

export function useProjects(archived: boolean, q: string) {
  const qs = new URLSearchParams({ archived: archived ? "1" : "0" });
  if (q.trim()) qs.set("q", q.trim());
  return useQuery({ queryKey: ["projects", "list", archived, q.trim()], queryFn: async () => (await api<{ projects: ProjectView[] }>("GET", `/api/projects?${qs}`)).projects });
}
export function useProject(id: string | null) {
  return useQuery({ queryKey: ["projects", "one", id], enabled: id !== null, queryFn: () => api<{ project: ProjectView; items: ProjectItem[] }>("GET", `/api/projects/${id}`) });
}
export function useProjectAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { op: "create"; name: string; description?: string; instructions?: string } | { op: "update"; id: string; name?: string; description?: string; instructions?: string } | { op: "archive"; id: string; on: boolean } | { op: "delete"; id: string; confirmName: string } | { op: "link"; id: string; kind: string; itemId: string } | { op: "unlink"; id: string; kind: string; itemId: string } | { op: "pin"; id: string; kind: string; itemId: string; on: boolean }) => {
      switch (a.op) {
        case "create": return api("POST", "/api/projects", { name: a.name, ...(a.description ? { description: a.description } : {}), ...(a.instructions ? { instructions: a.instructions } : {}) });
        case "update": return api("PATCH", `/api/projects/${a.id}`, { ...(a.name !== undefined ? { name: a.name } : {}), ...(a.description !== undefined ? { description: a.description } : {}), ...(a.instructions !== undefined ? { instructions: a.instructions } : {}) });
        case "archive": return api("PUT", `/api/projects/${a.id}/archive`, { on: a.on });
        case "delete": return api("DELETE", `/api/projects/${a.id}`, { confirmName: a.confirmName });
        case "link": return api("POST", `/api/projects/${a.id}/items`, { kind: a.kind, id: a.itemId });
        case "unlink": return api("DELETE", `/api/projects/${a.id}/items`, { kind: a.kind, id: a.itemId });
        case "pin": return api("PUT", `/api/projects/${a.id}/items/pin`, { kind: a.kind, id: a.itemId, on: a.on });
      }
    },
    onSuccess: (_data, vars) => {
      // A deleted project must not be refetched by the detail panel that is still on screen.
      if (vars.op === "delete") qc.removeQueries({ queryKey: ["projects", "one", vars.id] });
      return qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

// ---- Decisions (backend: src/decisions). Only the owner chooses, approves or rejects; the screen never sends a bot as the actor. ----
export type DecisionStatus = "open" | "chosen" | "approved" | "in_progress" | "done" | "rejected" | "archived";
export interface DecisionSummary {
  id: string;
  projectId: string | null;
  title: string;
  question: string;
  status: DecisionStatus;
  chosenOptionId: string | null;
  ownerNote: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  options: number;
  assignments: number;
  done: number;
}
export interface DecisionView {
  id: number;
  optionId: string;
  botId: string;
  botName: string;
  stance: string;
  reasoning: string;
  round: number;
}
export interface DecisionOption {
  id: string;
  title: string;
  details: string;
  pros: string;
  cons: string;
  proposedBy: { botId: string; botName: string } | null;
  editedByOwner: boolean;
  views: DecisionView[];
  disagreement: boolean;
}
export interface DecisionDetail extends Omit<DecisionSummary, "options" | "assignments" | "done"> {
  project: { id: string; name: string } | null;
  options: DecisionOption[];
  participants: { botId: string; botName: string; reason: string }[];
  assignments: { botId: string; botName: string; duty: string; startState: string; taskId: string | null; stuck: boolean }[];
  reports: { id: number; botName: string; kind: string; message: string; taskId: string | null }[];
  history: { id: number; actor: string; action: string }[];
}
export interface DecisionDraft {
  draftId: string;
  question: string;
  notice: string | null;
  bots: { botId: string; botName: string; reason: string; problem: string | null; options: { title: string; details: string; pros: string; cons: string }[] }[];
}

export function useDecisions(status: DecisionStatus | "") {
  return useQuery({ queryKey: ["decisions", "list", status], queryFn: async () => (await api<{ decisions: DecisionSummary[] }>("GET", `/api/decisions${status ? `?status=${status}` : ""}`)).decisions });
}
export function useDecision(id: string | null) {
  return useQuery({ queryKey: ["decisions", "one", id], enabled: id !== null, queryFn: async () => (await api<{ decision: DecisionDetail }>("GET", `/api/decisions/${id}`)).decision });
}
export function useInquire() {
  return useMutation({ mutationFn: async (question: string) => (await api<{ draft: DecisionDraft }>("POST", "/api/decisions/inquire", { question })).draft });
}
export type DecisionAct =
  | { op: "fromDraft"; draftId: string }
  | { op: "choose"; id: string; optionId: string | null; note?: string }
  | { op: "review" | "approve" | "reopen" | "archive"; id: string }
  | { op: "reject"; id: string; note?: string }
  | { op: "startAssignment" | "repairAssignment"; id: string; botId: string };
export function useDecisionAct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: DecisionAct) => {
      switch (a.op) {
        case "fromDraft": return api<{ decision: DecisionDetail }>("POST", "/api/decisions", { draftId: a.draftId });
        case "choose": return api("PUT", `/api/decisions/${a.id}/choice`, { optionId: a.optionId, ...(a.note ? { note: a.note } : {}) });
        case "reject": return api("POST", `/api/decisions/${a.id}/reject`, a.note ? { note: a.note } : {});
        case "startAssignment": return api("POST", `/api/decisions/${a.id}/assignments/${a.botId}/start`);
        case "repairAssignment": return api("POST", `/api/decisions/${a.id}/assignments/${a.botId}/repair`);
        default: return api("POST", `/api/decisions/${a.id}/${a.op}`, a.op === "approve" ? {} : undefined);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["decisions"] }),
  });
}
