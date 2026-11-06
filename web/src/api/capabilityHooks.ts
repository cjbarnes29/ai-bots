import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// ---- Capability registry (backend: src/capabilities). Read-only: nothing here changes a setting, grants anything or approves anything. ----
export type LevelName = "installed" | "configured" | "authenticated" | "operational" | "tested" | "verified";
export type LevelState = "yes" | "no" | "unknown" | "n/a";
export type CapState = "available" | "unverified" | "partial" | "needs_setup" | "unavailable";
export interface Capability {
  id: string;
  name: string;
  group: "tool" | "model" | "integration" | "permission" | "authentication" | "environment" | "agent" | "workflow";
  description: string;
  levels: Record<LevelName, { state: LevelState; evidence: string }>;
  reached: LevelName | null;
  state: CapState;
  stateReason: string;
  cost: string;
  costNote: string;
  missing: string[];
  needsOwner: string[];
  limits: string[];
}
export interface CapabilityView {
  capabilities: Capability[];
  summary: { total: number; byState: Record<CapState, number>; verified: number; headline: string };
  checkedAt: string;
  supervisedOnly: true;
}
export interface CapabilityChangeRow {
  id: number;
  at: string;
  kind: string;
  detail: { added?: number; removed?: number; changed?: number; count?: number; changes?: { id: string; name: string; kind: "added" | "removed" | "changed"; from?: string; to?: string; aspects: string[] }[] };
}

export const LEVEL_ORDER: LevelName[] = ["installed", "configured", "authenticated", "operational", "tested", "verified"];

export function useCapabilities() {
  return useQuery({ queryKey: ["capabilities"], queryFn: () => api<CapabilityView>("GET", "/api/capabilities"), refetchInterval: 15_000 });
}
export function useCapabilityChanges() {
  return useQuery({ queryKey: ["capabilities", "changes"], queryFn: async () => (await api<{ changes: CapabilityChangeRow[] }>("GET", "/api/capabilities/changes?limit=30")).changes, refetchInterval: 15_000 });
}
export function useRescanCapabilities() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<CapabilityView>("POST", "/api/capabilities/refresh"), onSuccess: () => qc.invalidateQueries({ queryKey: ["capabilities"] }) });
}

export interface VmReadiness {
  ready: false;
  summary: string;
  steps: { id: string; title: string; state: "met" | "not_done" | "unknown"; evidence: string; needsOwnerApproval: boolean; where: string }[];
  sizing: { hostRamGb: number; hostCpuThreads: number; vmRamGb: number; vmCpus: number; note: string };
  approvalOrder: string[];
}
export function useVmReadiness() {
  return useQuery({ queryKey: ["capabilities", "vm-readiness"], queryFn: async () => (await api<{ readiness: VmReadiness }>("GET", "/api/capabilities/vm-readiness")).readiness, retry: false });
}
