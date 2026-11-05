import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { DecisionDraft } from "./workHooks";

// ---- Decisions: collaboration, versions and the execution record ----
export interface OptionVersion {
  version: number;
  at: string;
  by: "owner" | "bot";
  botName: string | null;
  text: { title: string; details: string; pros: string; cons: string };
  changes: { field: string; before: string; after: string }[];
  hash: string;
}
export interface ConsensusView {
  state: "consensus" | "unresolved" | "insufficient";
  optionId: string | null;
  optionTitle: string | null;
  supporters: string[];
  objectors: { bot: string; stance: string; reasoning: string; optionId: string }[];
  missing: string[];
  roundsDone: number;
  recommendation: { optionId: string; title: string; reason: string } | null;
  note: string;
}
export interface ExecutionRow {
  botId: string;
  botName: string;
  duty: string;
  startState: string;
  taskId: string | null;
  instructionSent: string | null;
  matchesApprovedVersion: boolean;
  approvedVersion: number | null;
  approvedHash: string | null;
  status: string | null;
  result: string | null;
  error: string | null;
}
export function useOptionVersions(decisionId: string, optionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["decisions", "versions", decisionId, optionId],
    enabled,
    queryFn: () => api<{ versions: OptionVersion[]; approved: { optionId: string; version: number; hash: string } | null }>("GET", `/api/decisions/${decisionId}/options/${optionId}/versions`),
  });
}
export function useConsensus(decisionId: string) {
  return useQuery({
    queryKey: ["decisions", "consensus", decisionId],
    queryFn: () => api<{ consensus: ConsensusView; outcome: { kind: string; note: string; at: string } | null }>("GET", `/api/decisions/${decisionId}/consensus`),
  });
}
export function useExecution(decisionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["decisions", "execution", decisionId],
    enabled,
    refetchInterval: 4000,
    queryFn: () => api<{ execution: ExecutionRow[]; approved: { version: number; hash: string } | null }>("GET", `/api/decisions/${decisionId}/execution`),
  });
}
export type DecisionEdit =
  | { op: "editOption"; id: string; optionId: string; patch: { title?: string; details?: string; pros?: string; cons?: string } }
  | { op: "addOption"; id: string; option: { title: string; details?: string; pros?: string; cons?: string } }
  | { op: "removeOption"; id: string; optionId: string }
  | { op: "note"; id: string; ownerNote: string }
  | { op: "collaborate"; id: string }
  | { op: "approveWith"; id: string; assignments: { botId: string; duty: string }[] }
  | { op: "assign"; id: string; botId: string; duty: string };
export function useDecisionEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: DecisionEdit) => {
      switch (a.op) {
        case "editOption": return api("PATCH", `/api/decisions/${a.id}/options/${a.optionId}`, a.patch);
        case "addOption": return api("POST", `/api/decisions/${a.id}/options`, a.option);
        case "removeOption": return api("DELETE", `/api/decisions/${a.id}/options/${a.optionId}`);
        case "note": return api("PATCH", `/api/decisions/${a.id}`, { ownerNote: a.ownerNote });
        case "collaborate": return api("POST", `/api/decisions/${a.id}/collaborate`);
        case "approveWith": return api("POST", `/api/decisions/${a.id}/approve`, { assignments: a.assignments });
        case "assign": return api("POST", `/api/decisions/${a.id}/assignments`, { botId: a.botId, duty: a.duty });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["decisions"] }),
  });
}

// ---- Groups ----
export interface GroupMember { botId: string; botName: string; role: string; responsibility: string | null }
export interface GroupInfo {
  id: string;
  name: string;
  description: string;
  avatar: string;
  kind: "general" | "division" | "project";
  division: string | null;
  projectId: string | null;
  coordinatorBotId: string | null;
  participationMode: string;
  maxRounds: number;
  paused: boolean;
  archived: boolean;
  members: GroupMember[];
}
export interface GroupMessage { id: number; senderKind: string; senderName: string; visibility: string; kind: string; content: string; taskId: string | null; createdAt: string }
export interface GroupEvent { id: number; kind: string; from: string | null; to: string | null; at: string; detail: Record<string, unknown> }
export function useGroupStatus() {
  return useQuery({ queryKey: ["groups", "status"], queryFn: () => api<{ enabled: boolean; participationModes: string[]; divisions: { key: string; name: string }[] }>("GET", "/api/groups/status") });
}
export function useGroups(archived: boolean, enabled: boolean) {
  return useQuery({ queryKey: ["groups", "list", archived], enabled, queryFn: async () => (await api<{ groups: GroupInfo[] }>("GET", `/api/groups?archived=${archived ? 1 : 0}`)).groups });
}
export function useGroup(id: string | null) {
  return useQuery({ queryKey: ["groups", "one", id], enabled: id !== null, queryFn: async () => (await api<{ group: GroupInfo }>("GET", `/api/groups/${id}`)).group });
}
export function useGroupMessages(id: string | null) {
  return useQuery({ queryKey: ["groups", "messages", id], enabled: id !== null, refetchInterval: 4000, queryFn: async () => (await api<{ messages: GroupMessage[] }>("GET", `/api/groups/${id}/messages`)).messages });
}
export function useGroupActivity(id: string | null) {
  return useQuery({
    queryKey: ["groups", "activity", id],
    enabled: id !== null,
    refetchInterval: 6000,
    queryFn: () => api<{ events: GroupEvent[]; tasks: { id: string; botName: string; status: string; instruction: string }[] }>("GET", `/api/groups/${id}/activity`),
  });
}
export type GroupAct =
  | { op: "enable"; on: boolean }
  | { op: "create"; body: { name: string; description?: string; kind?: string; division?: string; projectId?: string; participationMode?: string; botIds?: string[] } }
  | { op: "update"; id: string; patch: Record<string, unknown> }
  | { op: "archive"; id: string; on: boolean }
  | { op: "addMember"; id: string; botId: string; role?: string }
  | { op: "removeMember"; id: string; botId: string }
  | { op: "duty"; id: string; botId: string; duty: string }
  | { op: "post"; id: string; content: string; directToBotId?: string | null }
  | { op: "handoff"; id: string; fromBotId: string; toBotId: string; instruction: string; sourceTaskId?: string }
  | { op: "recommend"; id: string; question: string }
  | { op: "escalate"; id: string; draftId: string; title?: string };
export function useGroupAct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: GroupAct) => {
      switch (a.op) {
        case "enable": return api("PUT", "/api/groups/enabled", { on: a.on });
        case "create": return api("POST", "/api/groups", a.body);
        case "update": return api("PATCH", `/api/groups/${a.id}`, a.patch);
        case "archive": return api("PUT", `/api/groups/${a.id}/archive`, { on: a.on });
        case "addMember": return api("POST", `/api/groups/${a.id}/members`, { botId: a.botId, ...(a.role ? { role: a.role } : {}) });
        case "removeMember": return api("DELETE", `/api/groups/${a.id}/members/${a.botId}`);
        case "duty": return api("PUT", `/api/groups/${a.id}/responsibilities`, { botId: a.botId, duty: a.duty });
        case "post": return api("POST", `/api/groups/${a.id}/messages`, { content: a.content, ...(a.directToBotId ? { directToBotId: a.directToBotId } : {}) });
        case "handoff": return api("POST", `/api/groups/${a.id}/handoffs`, { fromBotId: a.fromBotId, toBotId: a.toBotId, instruction: a.instruction, ...(a.sourceTaskId ? { sourceTaskId: a.sourceTaskId } : {}) });
        case "recommend": return api<{ draft: DecisionDraft }>("POST", `/api/groups/${a.id}/recommendations`, { question: a.question });
        case "escalate": return api("POST", `/api/groups/${a.id}/escalate`, { draftId: a.draftId, ...(a.title ? { title: a.title } : {}) });
      }
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

// ---- Workforce: organisation and board ----
export interface BoardNode { id: string; kind: string; refId: string; label: string; status: string; lane: number; sub?: string; divisions: string[]; detail: Record<string, unknown>; link: string | null }
export interface BoardEdge { id: string; from: string; to: string; kind: string }
export interface BoardData { nodes: BoardNode[]; edges: BoardEdge[]; counts: Record<string, number>; truncated: string[]; groupsEnabled: boolean; generatedAt: string; note: string }
export interface Organization {
  manager: { name: string; note: string; specialists: string[] };
  groupsEnabled: boolean;
  divisions: { key: string; name: string; groupId: string | null; dedicated: { id: string; name: string }[]; shared: { id: string; name: string }[]; temporary: { id: string; name: string; expiresAt: string | null; purpose: string | null }[] }[];
  unplaced: { id: string; name: string; status: string }[];
}
export type Layouts = Record<string, { positions: Record<string, { x: number; y: number }>; filters: Record<string, string> }>;
export function useOrganization() {
  return useQuery({ queryKey: ["workforce", "org"], queryFn: () => api<Organization>("GET", "/api/workforce/organization") });
}
export function useBoard() {
  return useQuery({ queryKey: ["workforce", "board"], refetchInterval: 8000, queryFn: () => api<BoardData>("GET", "/api/workforce/board") });
}
export function useNodeActivity(kind: string | null, id: string | null) {
  return useQuery({
    queryKey: ["workforce", "activity", kind, id],
    enabled: !!kind && !!id,
    queryFn: () => api<{ history: { at: string; text: string }[] }>("GET", `/api/workforce/activity?kind=${kind}&id=${encodeURIComponent(id!)}`),
  });
}
export function useLayouts() {
  return useQuery({ queryKey: ["workforce", "layouts"], queryFn: async () => (await api<{ layouts: Layouts }>("GET", "/api/workforce/layouts")).layouts });
}
export type WorkforceAct =
  | { op: "place"; botId: string; kind: string; divisions: string[]; expiresInHours?: number; purpose?: string }
  | { op: "clear"; botId: string }
  | { op: "saveLayout"; name: string; positions: Record<string, { x: number; y: number }>; filters: Record<string, string> }
  | { op: "deleteLayout"; name: string };
export function useWorkforceAct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: WorkforceAct) => {
      switch (a.op) {
        case "place": return api("PUT", `/api/workforce/bots/${a.botId}`, { kind: a.kind, divisions: a.divisions, ...(a.expiresInHours ? { expiresInHours: a.expiresInHours } : {}), ...(a.purpose ? { purpose: a.purpose } : {}) });
        case "clear": return api("DELETE", `/api/workforce/bots/${a.botId}`);
        case "saveLayout": return api("PUT", "/api/workforce/layouts", { name: a.name, positions: a.positions, filters: a.filters });
        case "deleteLayout": return api("DELETE", `/api/workforce/layouts?name=${encodeURIComponent(a.name)}`);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workforce"] }),
  });
}
