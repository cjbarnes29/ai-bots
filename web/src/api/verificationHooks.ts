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
