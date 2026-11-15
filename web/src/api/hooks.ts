import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { FINAL_TASK_STATUSES } from "./types";
import type { RegistryView, EvaluationResult, RecMode, RecView, DemoStatus, AccessApps, AccessFolders, GrantPreviewInfo, GrantRequest, GuardianView, BusinessInstallResult, BusinessLead, BusinessStatus, BusinessTeamStatus, IntegrationEntry, LeadStatus, StagedBatch, VerifyResponse, MemoryNote, BotMemorySettings, WfGraph, WfOverview, WfProblem, PcOverview, SkillInfo, SkillTestResult, SkillVersionInfo, ToolInfo, ManagerOverview, ManagerSettingsInfo, RoutingConfig, RoutingView, DeviceInfo, GmailStatus, InboundSourceInfo, MonitorOverview, PairingCode, SessionInfo,
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
  TryModelResult,
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
  appAutomation?: boolean;
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

/** The setup wizard's test chat: one short message to one model. The backend applies every normal check (pause, free-only, caps). */
export function useTryModel() {
  const refresh = useRefreshLlm();
  return useMutation({
    mutationFn: (input: { id: number; message: string }) => api<TryModelResult>("POST", `/api/llm/models/${input.id}/try`, { message: input.message }),
    onSettled: refresh,
  });
}

export function useOwnerVerifyModel() {
  const refresh = useRefreshLlm();
  return useMutation({
    mutationFn: async (input: { id: number; verified: boolean }) =>
      (await api<{ model: ModelView }>("PUT", `/api/llm/models/${input.id}/owner-verified`, { verified: input.verified, iUnderstand: true })).model,
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
    mutationFn: async (input: { message: string; conversationId: string | null; projectId?: string | null; attachmentIds?: string[]; useKnowledge?: boolean }) =>
      api<ChatReply>("POST", `/api/bots/${botId}/chat`, {
        message: input.message,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(!input.conversationId && input.projectId ? { projectId: input.projectId } : {}),
        ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
        ...(input.useKnowledge ? { useKnowledge: true } : {}),
      }),
    // Usage numbers change after every call, whether it worked or not.
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ["chat", botId] }), qc.invalidateQueries({ queryKey: ["llm"] }), qc.invalidateQueries({ queryKey: ["knowledge"] })]),
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
    mutationFn: async (input: { botId: string; instruction: string; projectId?: string; saveToWorkspace?: boolean }) =>
      (await api<{ task: TaskRecord }>("POST", `/api/bots/${input.botId}/tasks`, { instruction: input.instruction, ...(input.projectId ? { projectId: input.projectId, saveToWorkspace: input.saveToWorkspace ?? true } : {}) })).task,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["tasks"] }), qc.invalidateQueries({ queryKey: ["llm"] }), qc.invalidateQueries({ queryKey: ["projects"] })]),
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
export function useGuardianStatus() {
  return useQuery({
    queryKey: ["guardian", "status"],
    queryFn: () => api<GuardianView>("GET", "/api/guardian/status"),
    refetchInterval: 3000,
  });
}

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

/** Resolve an older deep link through the existing read endpoint, without another approval store. */
export function useApprovalById(id: string | null) {
  return useQuery({ queryKey: ["approvals", "by-id", id], queryFn: async () => (await api<{ approval: Approval }>("GET", `/api/approvals/${id}`)).approval, enabled: !!id, retry: false, refetchInterval: WATCH });
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

export function useIntegrations() {
  return useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<{ integrations: IntegrationEntry[]; paused: boolean }>("GET", "/api/integrations"),
    refetchInterval: WATCH,
  });
}

export function useVerifyIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<VerifyResponse>("POST", `/api/integrations/${id}/verify`, {}),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["integrations"] }), qc.invalidateQueries({ queryKey: ["audit"] })]),
  });
}

// ---- Business Workforce
export function useBusinessStatus() {
  return useQuery({ queryKey: ["business", "status"], queryFn: () => api<BusinessStatus>("GET", "/api/business/status"), refetchInterval: WATCH });
}

export function useSetBusinessExternal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api<BusinessStatus>("PUT", "/api/business/external", { enabled }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["business"] }), qc.invalidateQueries({ queryKey: ["audit"] })]),
  });
}

export function useBusinessLeads(filters: { status?: string; priority?: string; q?: string }) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  const qs = params.toString();
  return useQuery({
    queryKey: ["business", "leads", qs],
    queryFn: () => api<{ total: number; leads: BusinessLead[] }>("GET", `/api/business/leads${qs ? `?${qs}` : ""}`),
    refetchInterval: WATCH,
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: { status?: LeadStatus; notes?: string; confirmNoWebsite?: boolean } }) => api<{ lead: BusinessLead }>("PUT", `/api/business/leads/${input.id}`, input.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["business"] }),
  });
}

export function useStagedBatches() {
  return useQuery({ queryKey: ["business", "batches"], queryFn: async () => (await api<{ batches: StagedBatch[] }>("GET", "/api/business/batches")).batches, refetchInterval: WATCH });
}

export function useStagedBatch(id: string | null) {
  return useQuery({
    queryKey: ["business", "batch", id],
    enabled: id !== null,
    queryFn: () => api<{ id: string; label: string; rowsHash: string; leads: BusinessLead[] }>("GET", `/api/business/batches/${id}`),
  });
}

export function useBusinessTeam() {
  return useQuery({ queryKey: ["business", "team"], queryFn: () => api<BusinessTeamStatus>("GET", "/api/business/team"), refetchInterval: WATCH });
}

export function useInstallBusinessTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<BusinessInstallResult>("POST", "/api/business/team", {}),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["business"] }), qc.invalidateQueries({ queryKey: ["bots"] }), qc.invalidateQueries({ queryKey: ["workflows"] })]),
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

export function useGmailStatus() {
  return useQuery({ queryKey: ["gmail", "status"], queryFn: () => api<GmailStatus>("GET", "/api/gmail/status"), refetchInterval: WATCH });
}

export function useStartGmailSignIn() {
  return useMutation({ mutationFn: async () => (await api<{ url: string }>("POST", "/api/gmail/oauth/start", {})).url });
}

export function useSendGmailTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (botId: string) => api<{ to: string; approvalId: string }>("POST", "/api/gmail/test-email", { botId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["approvals"] }),
  });
}

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: () => api<SessionInfo>("GET", "/api/session"), refetchInterval: 60_000 });
}

export function usePair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string; name: string }) => api<{ device: { id: string; name: string } }>("POST", "/api/devices/pair", input),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useStartPairing() {
  return useMutation({ mutationFn: () => api<PairingCode>("POST", "/api/devices/pairing", {}) });
}

export function useDevices(enabled: boolean) {
  return useQuery({ queryKey: ["devices"], enabled, queryFn: async () => (await api<{ devices: DeviceInfo[] }>("GET", "/api/devices")).devices, refetchInterval: WATCH });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api("DELETE", `/api/devices/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }) });
}

export function useSignOutDevice() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api("POST", "/api/devices/signout", {}), onSuccess: () => qc.invalidateQueries() });
}

export function useMonitor() {
  return useQuery({ queryKey: ["monitor"], queryFn: () => api<MonitorOverview>("GET", "/api/monitor/overview"), refetchInterval: WATCH });
}

export function useInbound() {
  return useQuery({
    queryKey: ["inbound"],
    queryFn: () => api<{ sources: InboundSourceInfo[]; limits: { minIntervalMinutes: number } }>("GET", "/api/inbound"),
    refetchInterval: WATCH,
  });
}

export function useCreateInbound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { connector: "telegram" | "gmail"; botId: string }) => api<{ source: InboundSourceInfo }>("POST", "/api/inbound", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbound"] }),
  });
}

export function useUpdateInbound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: { enabled?: boolean; intervalMinutes?: number } }) => api<{ source: InboundSourceInfo }>("PATCH", `/api/inbound/${input.id}`, input.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbound"] }),
  });
}

export function useDeleteInbound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("DELETE", `/api/inbound/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbound"] }),
  });
}

export function useRouting() {
  return useQuery({ queryKey: ["llm", "routing"], queryFn: () => api<RoutingView>("GET", "/api/llm/routing"), refetchInterval: WATCH });
}

export function useUpdateRouting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<RoutingConfig>) => api<RoutingView>("PUT", "/api/llm/routing", patch),
    onSuccess: (view) => qc.setQueryData(["llm", "routing"], view),
  });
}

export function useRefreshAllProviders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<RoutingView & { results: { id: string; ok: boolean; message: string; models: number }[] }>("POST", "/api/llm/routing/refresh-all", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm"] }),
  });
}

export function useAssignRouting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<RoutingView & { changed: number }>("POST", "/api/llm/routing/assign", {}),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["llm"] }), qc.invalidateQueries({ queryKey: ["bots"] })]),
  });
}

export function useManager() {
  return useQuery({ queryKey: ["manager"], queryFn: () => api<ManagerOverview>("GET", "/api/manager"), refetchInterval: 3000 });
}

export function useStartManagerRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { goal: string; budget?: { maxModelCalls?: number } }) => api("POST", "/api/manager/runs", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manager"] }),
  });
}

export function useCancelManagerRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("POST", `/api/manager/runs/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manager"] }),
  });
}

export function useUpdateManagerSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ManagerSettingsInfo>) => api("PUT", "/api/manager/settings", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manager"] }),
  });
}

export function useTools() {
  return useQuery({ queryKey: ["tools"], queryFn: async () => (await api<{ tools: ToolInfo[] }>("GET", "/api/tools")).tools, refetchInterval: 30_000 });
}

export function useRefreshTools() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api<{ tools: ToolInfo[] }>("POST", "/api/tools/refresh", {})).tools,
    onSuccess: (tools) => qc.setQueryData(["tools"], tools),
  });
}

export function useSkills(archived: boolean) {
  return useQuery({ queryKey: ["skills", { archived }], queryFn: async () => (await api<{ skills: SkillInfo[] }>("GET", `/api/skills?archived=${archived ? 1 : 0}`)).skills });
}

export function useSkill(id: string) {
  return useQuery({ queryKey: ["skills", "one", id], queryFn: async () => (await api<{ skill: SkillInfo & { versions: SkillVersionInfo[] } }>("GET", `/api/skills/${id}`)).skill });
}

const useSkillMutation = <V, R = unknown>(fn: (v: V) => Promise<R>) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["skills"] }), qc.invalidateQueries({ queryKey: ["capabilities"] })]) });
};

export const useCreateSkill = () => useSkillMutation((body: { name: string; description: string; instructions: string; requiredTools: string[] }) => api("POST", "/api/skills", body));
export const useUpdateSkill = () => useSkillMutation((v: { id: string; patch: Record<string, unknown> }) => api("PATCH", `/api/skills/${v.id}`, v.patch));
export const useDuplicateSkill = () => useSkillMutation((id: string) => api("POST", `/api/skills/${id}/duplicate`, {}));
export const useArchiveSkill = () => useSkillMutation((v: { id: string; archived: boolean }) => api("POST", `/api/skills/${v.id}/${v.archived ? "archive" : "unarchive"}`, {}));
export const useRestoreSkillVersion = () => useSkillMutation((v: { id: string; version: number }) => api("POST", `/api/skills/${v.id}/restore`, { version: v.version }));
export const useImportSkill = () => useSkillMutation((file: unknown) => api("POST", "/api/skills/import", file));

export function useTestSkill() {
  return useMutation({ mutationFn: async (v: { id: string; input: string }) => (await api<{ result: SkillTestResult }>("POST", `/api/skills/${v.id}/test`, { input: v.input })).result });
}

export function useBotCapabilities(botId: string) {
  return useQuery({ queryKey: ["capabilities", botId], queryFn: () => api<{ skills: string[]; tools: string[] }>("GET", `/api/bots/${botId}/capabilities`) });
}

export function useSetBotSkills(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) => api("PUT", `/api/bots/${botId}/skills`, { skillIds }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["capabilities", botId] }), qc.invalidateQueries({ queryKey: ["skills"] })]),
  });
}

export function useSetBotTools(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (toolIds: string[]) => api("PUT", `/api/bots/${botId}/tools`, { toolIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["capabilities", botId] }),
  });
}

export function usePc() {
  return useQuery({ queryKey: ["pc"], queryFn: () => api<PcOverview>("GET", "/api/pc"), refetchInterval: 4000 });
}

const usePcMutation = <V,>(fn: (v: V) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["pc"] }), qc.invalidateQueries({ queryKey: ["tools"] })]) });
};
export const useAddWorkspace = () => usePcMutation((path: string) => api("POST", "/api/pc/workspaces", { path }));
export const useRemoveWorkspace = () => usePcMutation((path: string) => api("POST", "/api/pc/workspaces/remove", { path }));
export const usePcStop = () => usePcMutation(() => api("POST", "/api/pc/stop", {}));
export const usePcResume = () => usePcMutation(() => api("POST", "/api/pc/resume", {}));
export const useStopServer = () => usePcMutation((id: string) => api("POST", `/api/pc/servers/${id}/stop`, {}));

export function useBotPc(botId: string) {
  return useQuery({ queryKey: ["bot-pc", botId], queryFn: async () => (await api<{ grants: string[] }>("GET", `/api/bots/${botId}/pc`)).grants });
}

export function useSetBotPc(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grants: string[]) => api("PUT", `/api/bots/${botId}/pc`, { grants }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot-pc", botId] }),
  });
}

// ---- workflows (Stage 6)
export function useDemo() {
  return useQuery({ queryKey: ["demo"], queryFn: () => api<DemoStatus>("GET", "/api/demo") });
}

export function useSetupDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<DemoStatus>("POST", "/api/demo/setup"),
    onSuccess: (view) => {
      qc.setQueryData(["demo"], view);
      return Promise.all([qc.invalidateQueries({ queryKey: ["llm"] }), qc.invalidateQueries({ queryKey: ["bots"] }), qc.invalidateQueries({ queryKey: ["workflows"] })]);
    },
  });
}

export function useWorkflows(archived = false) {
  return useQuery({ queryKey: ["workflows", { archived }], queryFn: () => api<WfOverview>("GET", `/api/workflows?archived=${archived ? 1 : 0}`), refetchInterval: 5_000 });
}

const useWfMutation = <V, R = unknown>(fn: (v: V) => Promise<R>) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }) });
};

export const useValidateWorkflow = () => useMutation({ mutationFn: async (graph: WfGraph) => (await api<{ problems: WfProblem[] }>("POST", "/api/workflows/validate", { graph })).problems });
export const useCreateWorkflow = () => useWfMutation((v: { name: string; graph: WfGraph }) => api("POST", "/api/workflows", v));
export const useUpdateWorkflow = () => useWfMutation((v: { id: string; patch: { name?: string; graph?: WfGraph } }) => api("PATCH", `/api/workflows/${v.id}`, v.patch));
export const useWorkflowAction = () => useWfMutation((v: { id: string; action: "enable" | "disable" | "archive" | "unarchive" | "duplicate" }) => api("POST", `/api/workflows/${v.id}/${v.action}`, {}));
export const useRunWorkflow = () => useWfMutation((v: { id: string; input: string }) => api("POST", `/api/workflows/${v.id}/run`, { input: v.input }));
export const useCancelWorkflowRun = () => useWfMutation((runId: string) => api("POST", `/api/workflows/runs/${runId}/cancel`, {}));
export const useWorkflowStep = () => useWfMutation((v: { runId: string; nodeId: string; action: "approve" | "reject" | "retry" }) => api("POST", `/api/workflows/runs/${v.runId}/steps/${v.nodeId}/${v.action}`, {}));

// ---- integrations (Stage 7)
export function useGworkspaceStatus() {
  return useQuery({ queryKey: ["gworkspace", "status"], queryFn: () => api<GmailStatus>("GET", "/api/gworkspace/status"), refetchInterval: WATCH });
}
export function useStartGworkspaceSignIn() {
  return useMutation({ mutationFn: async () => (await api<{ url: string }>("POST", "/api/gworkspace/oauth/start", {})).url });
}
export interface BotIntegrations {
  enabled: string[];
  available: { id: string; label: string; actions: { name: string; kind: "read" | "write" }[] }[];
}
export function useBotIntegrations(botId: string) {
  return useQuery({ queryKey: ["integrations", botId], queryFn: () => api<BotIntegrations>("GET", `/api/bots/${botId}/integrations`) });
}
export function useSetBotIntegrations(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectors: string[]) => api<BotIntegrations>("PUT", `/api/bots/${botId}/integrations`, { connectors }),
    onSuccess: (data) => qc.setQueryData(["integrations", botId], data),
  });
}

// ---- memory and knowledge (Stage 8)
export function useMemoryNotes(scope: "shared" | "bot", botId: string, archived: boolean, q: string) {
  return useQuery({
    queryKey: ["memory", scope, botId, archived, q],
    enabled: scope === "shared" || botId !== "",
    queryFn: async () => (await api<{ notes: MemoryNote[] }>("GET", `/api/memory?scope=${scope}${scope === "bot" ? `&botId=${botId}` : ""}&archived=${archived ? 1 : 0}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`)).notes,
  });
}
const useMemoryMutation = <V, R = unknown>(fn: (v: V) => Promise<R>) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["memory"] }) });
};
export const useCreateNote = () => useMemoryMutation((v: { scope: "shared" | "bot"; botId?: string; title: string; content: string; tags: string[]; pinned: boolean }) => api("POST", "/api/memory", v));
export const useUpdateNote = () => useMemoryMutation((v: { id: string; patch: Partial<Pick<MemoryNote, "title" | "content" | "tags" | "pinned">> }) => api("PATCH", `/api/memory/${v.id}`, v.patch));
export const useNoteAction = () => useMemoryMutation((v: { id: string; action: "archive" | "unarchive" | "share" }) => api("POST", `/api/memory/${v.id}/${v.action}`, {}));
export function useBotMemory(botId: string) {
  return useQuery({ queryKey: ["memory-settings", botId], queryFn: async () => (await api<{ settings: BotMemorySettings }>("GET", `/api/bots/${botId}/memory`)).settings });
}
export function useSetBotMemory(botId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<BotMemorySettings>) => (await api<{ settings: BotMemorySettings }>("PUT", `/api/bots/${botId}/memory`, patch)).settings,
    onSuccess: (s) => qc.setQueryData(["memory-settings", botId], s),
  });
}

// ---- Application and folder access ----
export function useAccessApps() {
  return useQuery({ queryKey: ["access", "apps"], queryFn: () => api<AccessApps>("GET", "/api/access/applications") });
}
const useAccessMutation = <V, R = unknown>(fn: (v: V) => Promise<R>) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["access"] }) });
};
export const useScanApps = () => useAccessMutation(() => api<AccessApps>("POST", "/api/access/applications/scan", {}));
export const useSessionApproveApp = () => useAccessMutation((v: { id: string; capabilities: string[] }) => api("POST", `/api/access/applications/${v.id}/session`, { capabilities: v.capabilities }));
export const useSetApp = () =>
  useAccessMutation((v: { id: string; level: "approved" | "trusted"; capabilities: string[]; expiresInDays?: number | null; reviewInDays?: number | null }) => {
    const { id, ...body } = v;
    return api("PUT", `/api/access/applications/${id}`, body);
  });
export const useRevokeApp = () => useAccessMutation((id: string) => api("POST", `/api/access/applications/${id}/revoke`, {}));
export const useRevokeAllApps = () => useAccessMutation(() => api("POST", "/api/access/applications/revoke-all", {}));

export function useAccessFolders() {
  return useQuery({ queryKey: ["access", "folders"], queryFn: () => api<AccessFolders>("GET", "/api/access/folders"), refetchInterval: 10_000 });
}
export const usePreviewGrant = () => useMutation({ mutationFn: (v: GrantRequest) => api<GrantPreviewInfo>("POST", "/api/access/folders/preview", v) });
export const useGrantFolder = () => useAccessMutation((v: GrantRequest) => api("POST", "/api/access/folders", v));
export const useRevokeFolder = () => useAccessMutation((id: string) => api("POST", `/api/access/folders/${id}/revoke`, {}));
export const useRevokeAllFolders = () => useAccessMutation(() => api("POST", "/api/access/folders/revoke-all", {}));
export const useCheckFolder = () => useAccessMutation((v: { path: string; op: string; subject?: string }) => api<{ allowed: boolean; reason?: string }>("POST", "/api/access/check", v));
export function useAccessLog() {
  return useQuery({ queryKey: ["access", "log"], queryFn: async () => (await api<{ events: AuditEvent[] }>("GET", "/api/access/log")).events, refetchInterval: 10_000 });
}

// ---- Desktop control (UI Automation + OCR) ----
export interface DesktopStatus {
  engine: { uia: boolean; ocr: boolean; ocrLanguage: string | null; powershell: string } | null;
  problem: string | null;
  sessions: { session: string; app: string; name: string }[];
  cloudScreenText: boolean;
}
export function useDesktopStatus() {
  return useQuery({ queryKey: ["desktop", "status"], queryFn: () => api<DesktopStatus>("GET", "/api/desktop/status"), refetchInterval: 8000 });
}
export function useDesktopLog() {
  return useQuery({ queryKey: ["desktop", "log"], queryFn: async () => (await api<{ events: AuditEvent[] }>("GET", "/api/desktop/log")).events, refetchInterval: 8000 });
}
export function useSetDesktopCloudText() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (on: boolean) => api("PUT", "/api/desktop/settings", { cloudScreenText: on }), onSuccess: () => qc.invalidateQueries({ queryKey: ["desktop"] }) });
}

// ---- Recommended settings
export function useRecommendations() {
  return useQuery({ queryKey: ["recommendations"], queryFn: () => api<RecView>("GET", "/api/recommendations") });
}

/** Applying or restoring changes real settings, so everything that shows them is refreshed afterwards. */
function useRecMutation<V>(fn: (v: V) => Promise<RecView>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (view) => {
      qc.setQueryData(["recommendations"], view);
      return Promise.all([qc.invalidateQueries({ queryKey: ["llm"] }), qc.invalidateQueries({ queryKey: ["desktop"] })]);
    },
  });
}
export const useSetRecMode = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (mode: RecMode) => api<RecView>("PUT", "/api/recommendations/mode", { mode }), onSuccess: (view) => qc.setQueryData(["recommendations"], view) });
};
export const useApplyRecommendations = () => useRecMutation((ids: string[]) => api<RecView>("POST", "/api/recommendations/apply", { ids }));
export const useRestoreRecommendation = () => useRecMutation((historyId: string) => api<RecView>("POST", "/api/recommendations/restore", { historyId }));

// ---- Model registry
export function useRegistry() {
  return useQuery({ queryKey: ["llm", "registry"], queryFn: () => api<RegistryView>("GET", "/api/llm/registry") });
}
/** Sends REAL requests to a provider (owner-started, with an approved request count). Everything about models is refreshed afterwards. */
export function useEvaluateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ref: string; tests: string[]; approvedRequests: number }) => api<{ result: EvaluationResult }>("POST", "/api/llm/registry/evaluate", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm"] }),
  });
}
