import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, CLIENT_HEADER, CLIENT_HEADER_VALUE } from "./client";

// ---- Knowledge Center documents and chat attachments (backend: src/knowledge) ----
export type DocStatus = "queued" | "processing" | "ready" | "failed" | "unsupported";
export type DocScope = "global" | "project" | "temporary";
export interface KDoc {
  id: string;
  title: string;
  filename: string;
  mime: string;
  ext: string;
  size: number;
  sha256: string;
  status: DocStatus;
  statusDetail: string;
  extractor: string;
  scope: DocScope;
  projectId: string | null;
  projectName: string | null;
  collectionId: string | null;
  collectionName: string | null;
  folder: string;
  category: string;
  tags: string[];
  conversationId: string | null;
  textChars: number;
  chunkCount: number;
  isImage: boolean;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}
export interface KCollection {
  id: string;
  name: string;
  description: string;
  documents: number;
  createdAt: string;
}
export interface KFacets {
  folders: string[];
  categories: string[];
  tags: string[];
  status: Record<string, number>;
  total: number;
  duplicates: { sha256: string; docs: { id: string; title: string }[] }[];
  collections: KCollection[];
}
export interface KFilters {
  q?: string;
  status?: string;
  tag?: string;
  folder?: string;
  category?: string;
  collectionId?: string;
  projectId?: string;
  scope?: string;
  deleted?: boolean;
}
export interface KHit {
  docId: string;
  title: string;
  chunkIdx: number;
  snippet: string;
  scope: DocScope;
  projectId: string | null;
}
export interface KSource {
  n: number;
  docId: string;
  title: string;
  chunkIdx: number;
  snippet: string;
  cited: boolean;
  kind: "attachment" | "knowledge";
}
export const sourceLabel = (s: Pick<KSource, "n" | "kind">) => (s.kind === "attachment" ? `A${s.n - 100 + 1}` : `K${s.n}`);

const qs = (o: Record<string, string | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "" && v !== false) p.set(k, v === true ? "1" : String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export function useKDocs(f: KFilters) {
  const key = { ...f };
  return useQuery({ queryKey: ["knowledge", "docs", key], queryFn: async () => (await api<{ documents: KDoc[] }>("GET", `/api/knowledge/docs${qs({ ...f, deleted: f.deleted })}`)).documents, refetchInterval: 8000 });
}
export function useKFacets() {
  return useQuery({ queryKey: ["knowledge", "facets"], queryFn: () => api<KFacets>("GET", "/api/knowledge/facets") });
}
export function useKDoc(id: string | null) {
  return useQuery({ queryKey: ["knowledge", "doc", id], enabled: id !== null, queryFn: () => api<{ doc: KDoc; text: string; truncated: boolean }>("GET", `/api/knowledge/docs/${id}`) });
}
export function useKImage(id: string | null, on: boolean) {
  return useQuery({ queryKey: ["knowledge", "image", id], enabled: id !== null && on, retry: false, queryFn: () => api<{ dataUrl: string }>("GET", `/api/knowledge/docs/${id}/image`) });
}
export function useKSearch(q: string, projectId?: string) {
  const text = q.trim();
  return useQuery({ queryKey: ["knowledge", "search", text, projectId ?? ""], enabled: text.length >= 2, retry: false, queryFn: () => api<{ query: string; hits: KHit[] }>("GET", `/api/knowledge/search${qs({ q: text, projectId })}`) });
}

type Op =
  | { op: "update"; id: string; patch: { title?: string; tags?: string[]; category?: string; folder?: string; collectionId?: string | null } }
  | { op: "scope"; id: string; scope: DocScope; projectId?: string | null; collectionId?: string | null }
  | { op: "reprocess"; id: string }
  | { op: "restore"; id: string }
  | { op: "delete"; id: string; confirmTitle: string }
  | { op: "collection"; name: string; description?: string }
  | { op: "removeCollection"; id: string };
export function useKAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Op) => {
      switch (a.op) {
        case "update":
          return api("PATCH", `/api/knowledge/docs/${a.id}`, a.patch);
        case "scope":
          return api("PUT", `/api/knowledge/docs/${a.id}/scope`, { scope: a.scope, projectId: a.projectId ?? null, collectionId: a.collectionId ?? null });
        case "reprocess":
          return api("POST", `/api/knowledge/docs/${a.id}/reprocess`);
        case "restore":
          return api("POST", `/api/knowledge/docs/${a.id}/restore`);
        case "delete":
          return api("DELETE", `/api/knowledge/docs/${a.id}`, { confirmTitle: a.confirmTitle });
        case "collection":
          return api("POST", "/api/knowledge/collections", { name: a.name, ...(a.description ? { description: a.description } : {}) });
        case "removeCollection":
          return api("DELETE", `/api/knowledge/collections/${a.id}`);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}

export const FILE_ACCEPT = ".pdf,.docx,.txt,.md,.csv,.xlsx,.json,.xml,.png,.jpg,.jpeg,.gif,.webp";
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("The file could not be read."));
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.readAsDataURL(file);
  });
}

/** Sends one file with real upload progress (a fetch cannot report it). Resolves with the parsed answer or rejects with an ApiError. */
export async function uploadFile<T>(url: string, file: File, extra: Record<string, unknown>, onProgress: (fraction: number) => void): Promise<T> {
  if (file.size > MAX_FILE_BYTES) throw new ApiError(413, "file_too_large", `${file.name} is too large (the limit is ${fmtSize(MAX_FILE_BYTES)}).`);
  const body = JSON.stringify({ filename: file.name, contentBase64: await toBase64(file), ...extra });
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", "application/json");
    xhr.setRequestHeader(CLIENT_HEADER, CLIENT_HEADER_VALUE);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, "network", "The upload could not be sent."));
    xhr.onload = () => {
      let j: { error?: string; message?: string } & Record<string, unknown> = {};
      try {
        j = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve(j as T);
      } else reject(new ApiError(xhr.status, String(j.error ?? "error"), String(j.message ?? "The upload failed.")));
    };
    xhr.send(body);
  });
}

// ---- chat: attachments of a conversation and the sources of its answers ----
export interface ChatAttachment extends KDoc {
  messageId: number | null;
}
export function useConversationAttachments(botId: string, conversationId: string | null) {
  return useQuery({ queryKey: ["chat", botId, "attachments", conversationId], enabled: conversationId !== null, queryFn: async () => (await api<{ attachments: ChatAttachment[] }>("GET", `/api/bots/${botId}/conversations/${conversationId}/attachments`)).attachments });
}
export function useConversationSources(botId: string, conversationId: string | null) {
  return useQuery({ queryKey: ["chat", botId, "sources", conversationId], enabled: conversationId !== null, queryFn: async () => (await api<{ sources: Record<string, KSource[]> }>("GET", `/api/bots/${botId}/conversations/${conversationId}/sources`)).sources });
}
export function useDiscardAttachment() {
  return useMutation({ mutationFn: (id: string) => api("DELETE", `/api/chat-attachments/${id}`) });
}
