import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { Bot } from "./types";

// ---- Bot Studio: templates, import/export, drafts, operating modes ----
export interface BotTemplateInfo {
  id: string;
  category: string;
  name: string;
  role: string;
  personality: string;
  instructions: string;
  responsibilities: string[];
  suggestedMode: string;
  suggests: string[];
}
export interface PortableBotInfo {
  name: string;
  role: string;
  personality: string;
  instructions: string;
  responsibilities: string[];
  temperature: number | null;
  maxOutputTokens: number | null;
}
export interface ImportCheckInfo {
  ok: boolean;
  problems: string[];
  warnings: string[];
  bot: PortableBotInfo | null;
}
export interface DraftInfo {
  draft: PortableBotInfo;
  warnings: string[];
  saved: false;
  model: string;
}
export interface ModeInfo {
  id: string;
  label: string;
  description: string;
}

function useRefreshBots() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["bots"] }), qc.invalidateQueries({ queryKey: ["studio"] })]);
}

export function useBotTemplates() {
  return useQuery({ queryKey: ["studio", "templates"], queryFn: async () => (await api<{ templates: BotTemplateInfo[] }>("GET", "/api/bot-studio/templates")).templates });
}
export function useBotModes() {
  return useQuery({ queryKey: ["studio", "modes"], queryFn: () => api<{ modes: ModeInfo[]; assignments: Record<string, string>; note: string }>("GET", "/api/bot-studio/modes") });
}
export function useCreateFromTemplate() {
  const refresh = useRefreshBots();
  return useMutation({
    mutationFn: (v: { id: string; name?: string }) => api<{ bot: Bot; suggestedMode: string; suggests: string[] }>("POST", `/api/bot-studio/templates/${v.id}/create`, v.name ? { name: v.name } : {}),
    onSuccess: refresh,
  });
}
export const useImportPreview = () => useMutation({ mutationFn: (text: string) => api<ImportCheckInfo>("POST", "/api/bot-studio/import/preview", { text }) });
export function useImportBot() {
  const refresh = useRefreshBots();
  return useMutation({ mutationFn: (text: string) => api<{ bot: Bot; warnings: string[] }>("POST", "/api/bot-studio/import", { text }), onSuccess: refresh });
}
export const useExportBot = () => useMutation({ mutationFn: (id: string) => api<unknown>("GET", `/api/bot-studio/bots/${id}/export`) });
export const useDraftBot = () => useMutation({ mutationFn: (v: { description: string; modelRef?: string }) => api<DraftInfo>("POST", "/api/bot-studio/draft", v) });
export function useSetBotMode() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; mode: string | null }) => api("PUT", `/api/bot-studio/bots/${v.id}/mode`, { mode: v.mode }), onSuccess: () => qc.invalidateQueries({ queryKey: ["studio"] }) });
}
