import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { FINAL_TASK_STATUSES } from "./types";
import type {
  Bot,
  BotVersion,
  ChatMessageRecord,
  ChatReply,
  AutomationRun,
  Approval,
  AuditEvent,
  ExternalStatus,
  SecretStatus,
  AutomationStatus,
  Connector,
  Conversation,
  CreateBotInput,
  DelegationAuditEntry,
  DelegationLimitsResponse,
  EventOutcome,
  RootSummary,
  RunOutcome,
  Schedule,
  ScheduleInput,
  Trigger,
  TriggerInput,
  TaskRecord,
  TaskTree,
  TeamMember,
  LimitsMap,
  LlmStatus,
  ModelView,
  Permission,
  PermissionAuditEntry,
  ProviderView,
  UpdateBotInput,
  UsageSummary,
} from "./types";

export function useBots(includeArchived: boolean) {
  return useQuery({
    queryKey: ["bots", { includeArchived }],
    queryFn: async () =>
      (await api<{ bots: Bot[] }>("GET", `/api/bots?includeArchived=${includeArchived}`)).bots,
  });
}

export function useBot(id: string) {
  return useQuery({
    queryKey: ["bot", id],
    queryFn: async () => (await api<{ bot: Bot }>("GET", `/api/bots/${id}`)).bot,
  });
}

export function useVersions(id: string) {
  return useQuery({
    queryKey: ["bot", id, "versions"],
    queryFn: async () => (await api<{ versions: BotVersion[] }>("GET", `/api/bots/${id}/versions`)).versions,
  });
}

export function useAudit(id: string) {
  return useQuery({
    queryKey: ["bot", id, "audit"],
    queryFn: async () =>
      (await api<{ audit: PermissionAuditEntry[] }>("GET", `/api/bots/${id}/permissions/audit`)).audit,
  });
}

/** After any change, everything about bots is refetched so screens never show stale data. */
function useRefreshAfter() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["bots"] }).then(() => qc.invalidateQueries({ queryKey: ["bot"] }));
}

export function useCreateBot() {
  const refresh = useRefreshAfter();
  return useMutation({
    mutationFn: async (input: CreateBotInput) => (await api<{ bot: Bot }>("POST", "/api/bots", input)).bot,
    onSuccess: refresh,
  });
}

export function useUpdateBot(id: string) {
  const refresh = useRefreshAfter();
  return useMutation({
    mutationFn: async (input: UpdateBotInput) => (await api<{ bot: Bot }>("PATCH", `/api/bots/${id}`, input)).bot,
    onSuccess: refresh,
  });
}

export function useArchiveBot() {
  const refresh = useRefreshAfter();
  return useMutation({
    mutationFn: async (id: string) => (await api<{ bot: Bot }>("DELETE", `/api/bots/${id}`)).bot,
    onSuccess: refresh,
  });
}

export function useUnarchiveBot() {
  const refresh = useRefreshAfter();
  return useMutation({
    mutationFn: async (id: string) => (await api<{ bot: Bot }>("POST", `/api/bots/${id}/unarchive`)).bot,
    onSuccess: refresh,
  });
}

export function useDuplicateBot() {
  const refresh = useRefreshAfter();
  return useMutation({
    mutationFn: async (id: string) => (await api<{ bot: Bot }>("POST", `/api/bots/${id}/duplicate`)).bot,
    onSuccess: refresh,
  });
}

export function useRestoreVersion(id: string) {
  const refresh = useRefreshAfter();
  return useMutation({
    mutationFn: async (version: number) =>
      (await api<{ bot: Bot }>("POST", `/api/bots/${id}/versions/${version}/restore`)).bot,
    onSuccess: refresh,
  });
}

export function useSetReadPermission(id: string) {
  const refresh = useRefreshAfter();
  return useMutation({
    mutationFn: async (input: { connector: Connector; readEnabled: boolean }) =>
      (
        await api<{ permissions: Permission[] }>("PUT", `/api/bots/${id}/permissions/${input.connector}`, {
          readEnabled: input.readEnabled,
        })
      ).permissions,
    onSuccess: refresh,
  });
}

// ---------------- AI models (Phase 2) ----------------

/** Everything under ["llm"] is refetched after any change to providers, models, limits or usage. */
function useRefreshLlm() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["llm"] });
}

export function useLlmStatus() {
  return useQuery({ queryKey: ["llm", "status"], queryFn: () => api<LlmStatus>("GET", "/api/llm/status") });
}

export function useProviders() {
  return useQuery({
    queryKey: ["llm", "providers"],
    queryFn: async () => (await api<{ providers: ProviderView[] }>("GET", "/api/llm/providers")).providers,
  });
}

export function useModels() {
  return useQuery({
    queryKey: ["llm", "models"],
    queryFn: async () => (await api<{ models: ModelView[] }>("GET", "/api/llm/models")).models,
  });
}

export function useUsage(days: number) {
  return useQuery({
    queryKey: ["llm", "usage", days],
    queryFn: async () => (await api<{ usage: UsageSummary }>("GET", `/api/llm/usage?days=${days}`)).usage,
  });
}

export interface ProviderPatch {
  enabled?: boolean;
  freeConfirmed?: boolean;
  dailyRequestCap?: number | null;
  baseUrl?: string;
}

export function usePatchProvider() {
  const refresh = useRefreshLlm();
  return useMutation({
    mutationFn: async (input: { id: string; patch: ProviderPatch }) =>
      (await api<{ provider: ProviderView }>("PATCH", `/api/llm/providers/${input.id}`, input.patch)).provider,
    onSuccess: refresh,
  });
}

export function useTestProvider() {
  const refresh = useRefreshLlm();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api<{ provider: ProviderView }>("POST", `/api/llm/providers/${id}/test`)).provider,
    onSuccess: refresh,
    onError: refresh,
  });
}

export function useRefreshModels() {
  const refresh = useRefreshLlm();
  return useMutation({
    mutationFn: async (id: string) =>
      api<{ provider: ProviderView; models: ModelView[] }>("POST", `/api/llm/providers/${id}/refresh-models`),
    onSuccess: refresh,
    onError: refresh,
  });
}

export function usePatchModel() {
  const refresh = useRefreshLlm();
  return useMutation({
    mutationFn: async (input: { id: number; enabled: boolean }) =>
      (await api<{ model: ModelView }>("PATCH", `/api/llm/models/${input.id}`, { enabled: input.enabled })).model,
    onSuccess: refresh,
  });
}

export function useUpdateLimits() {
  const refresh = useRefreshLlm();
  return useMutation({
    mutationFn: async (limits: LimitsMap) => api<LlmStatus>("PUT", "/api/llm/limits", limits),
    onSuccess: refresh,
  });
}

export function useResetLimits() {
  const refresh = useRefreshLlm();
  return useMutation({
    mutationFn: async () => api<LlmStatus>("POST", "/api/llm/limits/reset"),
    onSuccess: refresh,
  });
}

export function useSetPaused() {
  const refresh = useRefreshLlm();
  return useMutation({
    mutationFn: async (paused: boolean) => api<LlmStatus>("PUT", "/api/llm/pause", { paused }),
    onSuccess: refresh,
  });
}

// ---------------- Test chat ----------------

export function useConversations(botId: string) {
  return useQuery({
    queryKey: ["chat", botId, "conversations"],
    queryFn: async () =>
      (await api<{ conversations: Conversation[] }>("GET", `/api/bots/${botId}/conversations`)).conversations,
  });
}

export function useMessages(botId: string, conversationId: string | null) {
  return useQuery({
    queryKey: ["chat", botId, "messages", conversationId],
    enabled: conversationId !== null,
    queryFn: async () =>
      (
        await api<{ messages: ChatMessageRecord[] }>(
          "GET",
          `/api/bots/${botId}/conversations/${conversationId}/messages`,
        )
      ).messages,
  });
}

export function useSendChat(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { message: string; conversationId: string | null }) =>
      api<ChatReply>("POST", `/api/bots/${botId}/chat`, {
        message: input.message,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      }),
    // Usage numbers change after every call, whether it worked or not.
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ["chat", botId] }), qc.invalidateQueries({ queryKey: ["llm"] })]),
  });
}

// ---------------- Collaboration (Phase 3) ----------------

export function useTeam(botId: string) {
  return useQuery({
    queryKey: ["team", botId],
    queryFn: () => api<{ targets: TeamMember[]; audit: DelegationAuditEntry[] }>("GET", `/api/bots/${botId}/delegation`),
  });
}

export function useSetTeam(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetBotIds: string[]) =>
      api<{ targets: TeamMember[]; audit: DelegationAuditEntry[] }>("PUT", `/api/bots/${botId}/delegation`, { targetBotIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team"] }),
  });
}

/** While any task is still working, look again every 1.5 seconds. */
export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: async () => (await api<{ tasks: RootSummary[] }>("GET", "/api/tasks")).tasks,
    refetchInterval: (query) =>
      query.state.data?.some((t) => !FINAL_TASK_STATUSES.includes(t.status)) ? 1500 : false,
  });
}

export function useTaskTree(id: string) {
  return useQuery({
    queryKey: ["tasks", id],
    queryFn: () => api<TaskTree>("GET", `/api/tasks/${id}`),
    refetchInterval: (query) =>
      query.state.data && !FINAL_TASK_STATUSES.includes(query.state.data.task.status) ? 1500 : false,
  });
}

export function useSubmitTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { botId: string; instruction: string }) =>
      (await api<{ task: TaskRecord }>("POST", `/api/bots/${input.botId}/tasks`, { instruction: input.instruction })).task,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["tasks"] }), qc.invalidateQueries({ queryKey: ["llm"] })]),
  });
}

export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api<{ task: TaskRecord }>("POST", `/api/tasks/${id}/cancel`)).task,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useDelegationLimits() {
  return useQuery({
    queryKey: ["delegation-limits"],
    queryFn: () => api<DelegationLimitsResponse>("GET", "/api/delegation/limits"),
  });
}

export function useUpdateDelegationLimits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (limits: Record<string, number>) => api<DelegationLimitsResponse>("PUT", "/api/delegation/limits", limits),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["delegation-limits"] }),
  });
}

export function useResetDelegationLimits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<DelegationLimitsResponse>("POST", "/api/delegation/limits/reset"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["delegation-limits"] }),
  });
}

// ---------------- Automation (Phase 4) ----------------
// The clock runs in the background, so these look again every 5 seconds while the page is open.

const WATCH = 5000;

export function useAutomationStatus() {
  return useQuery({
    queryKey: ["automation", "status"],
    queryFn: () => api<AutomationStatus>("GET", "/api/automation/status"),
    refetchInterval: WATCH,
  });
}

export function useSchedules() {
  return useQuery({
    queryKey: ["automation", "schedules"],
    queryFn: async () => (await api<{ schedules: Schedule[] }>("GET", "/api/schedules")).schedules,
    refetchInterval: WATCH,
  });
}

export function useTriggers() {
  return useQuery({
    queryKey: ["automation", "triggers"],
    queryFn: async () => (await api<{ triggers: Trigger[] }>("GET", "/api/triggers")).triggers,
    refetchInterval: WATCH,
  });
}

export function useAutomationRuns(limit = 30) {
  return useQuery({
    queryKey: ["automation", "runs", limit],
    queryFn: async () => (await api<{ runs: AutomationRun[] }>("GET", `/api/automation/runs?limit=${limit}`)).runs,
    refetchInterval: WATCH,
  });
}

function useRefreshAutomation() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["automation"] }), qc.invalidateQueries({ queryKey: ["tasks"] })]);
}

export function useSetAutomationPaused() {
  const refresh = useRefreshAutomation();
  return useMutation({
    mutationFn: (paused: boolean) => api<AutomationStatus>("PUT", "/api/automation/pause", { paused }),
    onSuccess: refresh,
  });
}

export function useUpdateAutomationLimits() {
  const refresh = useRefreshAutomation();
  return useMutation({
    mutationFn: (limits: Record<string, number>) => api<AutomationStatus>("PUT", "/api/automation/limits", limits),
    onSuccess: refresh,
  });
}

export function useResetAutomationLimits() {
  const refresh = useRefreshAutomation();
  return useMutation({
    mutationFn: () => api<AutomationStatus>("POST", "/api/automation/limits/reset"),
    onSuccess: refresh,
  });
}

export function useCreateSchedule() {
  const refresh = useRefreshAutomation();
  return useMutation({
    mutationFn: async (input: ScheduleInput) => (await api<{ schedule: Schedule }>("POST", "/api/schedules", input)).schedule,
    onSuccess: refresh,
  });
}

export function useUpdateSchedule() {
  const refresh = useRefreshAutomation();
  return useMutation({
    mutationFn: async (input: { id: string; patch: ScheduleInput }) =>
      (await api<{ schedule: Schedule }>("PATCH", `/api/schedules/${input.id}`, input.patch)).schedule,
    onSuccess: refresh,
  });
}

export function useDeleteSchedule() {
  const refresh = useRefreshAutomation();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/schedules/${id}`),
    onSuccess: refresh,
  });
}

export function useRunScheduleNow() {
  const refresh = useRefreshAutomation();
  return useMutation({
    mutationFn: async (id: string) => (await api<{ outcome: RunOutcome }>("POST", `/api/schedules/${id}/run-now`)).outcome,
    onSettled: refresh,
  });
}

export function useCreateTrigger() {
  const refresh = useRefreshAutomation();
  return useMutation({
    mutationFn: async (input: TriggerInput) => (await api<{ trigger: Trigger }>("POST", "/api/triggers", input)).trigger,
    onSuccess: refresh,
  });
}

export function useUpdateTrigger() {
  const refresh = useRefreshAutomation();
  return useMutation({
    mutationFn: async (input: { id: string; patch: TriggerInput }) =>
      (await api<{ trigger: Trigger }>("PATCH", `/api/triggers/${input.id}`, input.patch)).trigger,
    onSuccess: refresh,
  });
}

export function useDeleteTrigger() {
  const refresh = useRefreshAutomation();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/triggers/${id}`),
    onSuccess: refresh,
  });
}

export function useSendEvent() {
  const refresh = useRefreshAutomation();
  return useMutation({
    mutationFn: async (input: { name: string; text: string }) =>
      (await api<{ outcomes: EventOutcome[] }>("POST", "/api/events", input)).outcomes,
    onSettled: refresh,
  });
}

// ---- Approvals, outside actions, secrets vault ----
export function useExternalStatus() {
  return useQuery({
    queryKey: ["external", "status"],
    queryFn: () => api<ExternalStatus>("GET", "/api/external/status"),
    refetchInterval: WATCH,
  });
}

export function useApprovals(pendingOnly: boolean) {
  return useQuery({
    queryKey: ["approvals", pendingOnly ? "pending" : "all"],
    queryFn: async () => (await api<{ approvals: Approval[] }>("GET", `/api/approvals${pendingOnly ? "?status=pending" : "?limit=100"}`)).approvals,
    refetchInterval: WATCH,
  });
}

function useRefreshApprovals() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["approvals"] }), qc.invalidateQueries({ queryKey: ["external"] }), qc.invalidateQueries({ queryKey: ["audit"] })]);
}

export function useApprove() {
  const refresh = useRefreshApprovals();
  return useMutation({
    mutationFn: async (id: string) => (await api<{ approval: Approval }>("POST", `/api/approvals/${id}/approve`)).approval,
    onSettled: refresh,
  });
}

export function useDeny() {
  const refresh = useRefreshApprovals();
  return useMutation({
    mutationFn: async (input: { id: string; reason?: string }) =>
      (await api<{ approval: Approval }>("POST", `/api/approvals/${input.id}/deny`, input.reason ? { reason: input.reason } : {})).approval,
    onSettled: refresh,
  });
}

export function useSetExternalPaused() {
  const refresh = useRefreshApprovals();
  return useMutation({
    mutationFn: (paused: boolean) => api<{ paused: boolean }>("PUT", "/api/external/pause", { paused }),
    onSuccess: refresh,
  });
}

export function useSecurityLog(limit = 50) {
  return useQuery({
    queryKey: ["audit", limit],
    queryFn: async () => (await api<{ events: AuditEvent[] }>("GET", `/api/audit?limit=${limit}`)).events,
    refetchInterval: WATCH,
  });
}

export function useSecrets() {
  return useQuery({
    queryKey: ["vault"],
    queryFn: async () => (await api<{ secrets: SecretStatus[] }>("GET", "/api/vault")).secrets,
  });
}

export function useSetSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; value: string }) =>
      (await api<{ secrets: SecretStatus[] }>("PUT", `/api/vault/${input.name}`, { value: input.value })).secrets,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["vault"] }), qc.invalidateQueries({ queryKey: ["llm"] }), qc.invalidateQueries({ queryKey: ["audit"] })]),
  });
}

export function useDeleteSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => (await api<{ secrets: SecretStatus[] }>("DELETE", `/api/vault/${name}`)).secrets,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["vault"] }), qc.invalidateQueries({ queryKey: ["llm"] }), qc.invalidateQueries({ queryKey: ["audit"] })]),
  });
}
