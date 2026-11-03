import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type {
  Bot,
  BotVersion,
  Connector,
  CreateBotInput,
  Permission,
  PermissionAuditEntry,
  UpdateBotInput,
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
