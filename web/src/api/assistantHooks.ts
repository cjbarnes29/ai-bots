import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// ---- AI Assistant: locate/open, controlled editing (safe / review / restricted), suggestions (backend: src/assistant) ----
export interface Candidate {
  kind: "project" | "workflow" | "agent" | "conversation" | "task" | "approval" | "document" | "note" | "decision" | "page";
  id: string;
  title: string;
  subtitle: string;
  botId?: string;
  to?: string;
}
export interface ActionView {
  id: string;
  kind: string;
  level: "safe" | "review" | "restricted";
  status: "proposed" | "applied" | "rejected" | "undone" | "failed" | "refused";
  targetKind: string;
  targetId: string;
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  undoable: boolean;
}
export type Interpretation =
  | { kind: "none"; handled: false }
  | { kind: "action"; handled: true; message: string; action?: ActionView; link?: { label: string; to: string }; choices?: string[] }
  | { kind: "explain"; handled: true; message: string; link?: { label: string; to: string } }
  | { kind: "overview"; handled: true; message: string; links: { label: string; to: string }[] }
  | { kind: "locate"; handled: true; entity: string | null; resolution: "single" | "multiple" | "none"; openNow: boolean; candidates: Candidate[]; message: string; understood: string };
export interface Suggestion {
  id: string;
  kind: "attention" | "problem" | "improvement" | "automation";
  severity: "high" | "normal" | "low";
  text: string;
  to?: string;
  ask?: string;
}

export function useInterpret() {
  return useMutation({ mutationFn: (text: string) => api<Interpretation>("POST", "/api/assistant/interpret", { text }) });
}
export function useSuggestions() {
  return useQuery({ queryKey: ["assistant", "suggestions"], queryFn: async () => (await api<{ suggestions: Suggestion[] }>("GET", "/api/assistant/suggestions")).suggestions, refetchInterval: 30_000 });
}
export function useAssistantActions() {
  return useQuery({ queryKey: ["assistant", "actions"], queryFn: async () => (await api<{ actions: ActionView[] }>("GET", "/api/assistant/actions")).actions });
}
export function useActionDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: string; op: "confirm" | "reject" | "undo" }) => api<{ message?: string; action?: ActionView }>("POST", `/api/assistant/actions/${a.id}/${a.op}`),
    onSettled: () => qc.invalidateQueries(),
  });
}

/** Where a located thing opens. One place (see also hubHooks.where). */
export function whereCandidate(c: Candidate): string {
  switch (c.kind) {
    case "project":
      return `/projects/${c.id}`;
    case "workflow":
      return `/workflows?open=${c.id}`;
    case "agent":
      return `/bots/${c.id}`;
    case "conversation":
      return c.botId ? `/bots/${c.botId}?tab=chat&conversation=${c.id}` : "/inbox";
    case "task":
      return `/tasks/${c.id}`;
    case "approval":
      return `/approvals?focus=${c.id}`;
    case "decision":
      return `/decisions?open=${c.id}`;
    case "document":
      return `/knowledge?doc=${c.id}`;
    case "note":
      return "/knowledge";
    case "page":
      return c.to ?? "/";
  }
}
