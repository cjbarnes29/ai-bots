import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { FINAL_TASK_STATUSES } from "./types";
import type {
  Bot,
  BotVersion,
  ChatMessageRecord,
  ChatReply,
  Connector,
  Conversation,
  CreateBotInput,
  DelegationAuditEntry,
  DelegationLimitsResponse,
  RootSummary,
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
