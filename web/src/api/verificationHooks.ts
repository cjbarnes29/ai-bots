import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

// ---- Independent result verification (backend: src/verification). Read-only. ----
export type VerificationStatus = "verified" | "unverified" | "waiting" | "contradicted" | "not_applicable";
export interface VerificationView {
  status: VerificationStatus;
  summary: string;
  evidence: number;
  tasks: number;
  checks: { kind: string; outcome: "pass" | "fail" | "note"; detail: string }[];
}
export function useChainVerification(taskId: string, enabled: boolean) {
  return useQuery({ queryKey: ["verification", taskId], queryFn: async () => (await api<{ verification: VerificationView }>("GET", `/api/tasks/${taskId}/chain-verification`)).verification, enabled, retry: false, refetchInterval: enabled ? 10_000 : false });
}

export interface ManagerVerificationView {
  runId: string;
  runStatus: string;
  checkedAt: string;
  completion: { total: number; completed: number; pending: number; running: number; failed: number; skipped: number };
  coverageComplete: boolean;
  finalSummary: { status: "unverified"; summary: string };
  supporting: Omit<VerificationView, "tasks">;
  steps: { id: string; status: string; binding: "valid" | "none" | "missing" | "invalid" | "limit"; originLink?: "agreed" | "none" | "conflict"; reason: string; taskId?: string; duplicateOf?: string }[];
  chains: { taskId: string; verification: VerificationView }[];
}

export function useManagerVerification(runId: string, runStatus: string, enabled: boolean) {
  return useQuery({ queryKey: ["manager-verification", runId, runStatus],
    queryFn: async () => (await api<{ verification: ManagerVerificationView }>("GET", `/api/manager/runs/${runId}/verification`)).verification,
    enabled, retry: false, staleTime: 0, refetchInterval: enabled ? 10_000 : false });
}

export interface WorkflowVerificationView {
  runId: string;
  workflowId: string;
  workflowVersion: number;
  runStatus: string;
  checkedAt: string;
  coverageComplete: boolean;
  completion: { total: number; pending: number; running: number; waiting: number; completed: number; failed: number; skipped: number };
  outputAssessment: { status: "unverified"; summary: string };
  supporting: Omit<VerificationView, "tasks">;
  steps: { nodeId: string; type: string; label: string; status: string; binding: "structural" | "valid" | "unbound" | "missing" | "invalid" | "ambiguous" | "unchecked" | "uncertain" | "limit"; reason: string; sourceKind?: "task" | "approval" | "manager"; sourceId?: string }[];
  sources: { kind: "task" | "approval"; id: string; verification: Omit<VerificationView, "tasks"> }[];
  unlinkedAttempts: { total: number; ids: string[]; truncated: boolean };
}

export function useWorkflowVerification(runId: string, runStatus: string, enabled: boolean) {
  return useQuery({ queryKey: ["workflow-verification", runId, runStatus],
    queryFn: async () => (await api<{ verification: WorkflowVerificationView }>("GET", `/api/workflows/runs/${runId}/verification`)).verification,
    enabled, retry: false, staleTime: 0, refetchInterval: enabled ? 10_000 : false });
}
