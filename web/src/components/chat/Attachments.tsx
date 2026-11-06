import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FILE_ACCEPT, fmtSize, sourceLabel, uploadFile, useKAction, useKFacets, type ChatAttachment, type KDoc, type KSource } from "../../api/knowledgeHooks";
import { ApiError } from "../../api/client";
import { useProjects } from "../../api/workHooks";

export interface Staged {
  key: string;
  file: File;
  progress: number;
  state: "uploading" | "ready" | "error";
  message: string;
  doc?: KDoc;
  previewUrl?: string;
}
export type RetentionMode = "temporary" | "knowledge" | "project" | "collection";
export interface Retention {
  mode: RetentionMode;
  projectId: string;
  collectionId: string;
}

/** The files chosen for the next message, their upload progress, and where the owner wants them kept. Nothing is ever kept beyond "temporary" unless the owner picked another place. */
export function useStaging(defaultProjectId: string | null) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [retention, setRetention] = useState<Retention>({ mode: "temporary", projectId: defaultProjectId ?? "", collectionId: "" });
  const retentionRef = useRef(retention);
  retentionRef.current = retention;
  const patch = (key: string, p: Partial<Staged>) => setStaged((s) => s.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const add = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setStaged((s) => [...s, { key, file, progress: 0, state: "uploading", message: "" }].slice(0, 8) as Staged[]);
      // A picture preview is a data: URL (the app's Content Security Policy allows img-src 'self' data: only, so a blob: URL would be blocked).
      if (file.type.startsWith("image/") && file.size <= 2 * 1024 * 1024) {
        const reader = new FileReader();
        reader.onload = () => patch(key, { previewUrl: String(reader.result) });
        reader.readAsDataURL(file);
      }
      const r = retentionRef.current;
      const missing = (r.mode === "project" && !r.projectId) ? "Choose a project first." : r.mode === "collection" && !r.collectionId ? "Choose a collection first." : "";
      if (missing) {
        patch(key, { state: "error", message: missing });
        continue;
      }
      void uploadFile<{ document: KDoc }>("/api/chat-attachments", file, { retention: r.mode, ...(r.mode === "project" ? { projectId: r.projectId } : {}), ...(r.mode === "collection" ? { collectionId: r.collectionId } : {}) }, (f) => patch(key, { progress: f }))
        .then((res) => patch(key, { state: "ready", doc: res.document, message: res.document.status === "ready" ? "" : res.document.statusDetail }))
        .catch((e) => patch(key, { state: "error", message: e instanceof ApiError ? e.friendly : "The upload failed." }));
    }
  };
  const remove = (key: string) => setStaged((s) => s.filter((x) => x.key !== key));
  const clear = () => setStaged([]);
  return { staged, add, remove, clear, retention, setRetention, uploading: staged.some((x) => x.state === "uploading"), ids: staged.filter((x) => x.state === "ready" && x.doc).map((x) => x.doc!.id) };
}

export function RetentionPicker({ value, onChange }: { value: Retention; onChange: (r: Retention) => void }) {
  const projects = useProjects(false, "");
  const facets = useKFacets();
  return (
    <fieldset className="space-y-1 rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700">
      <legend className="px-1 text-xs font-semibold">Where should new files be kept?</legend>
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="sr-only">Keep new files</span>
          <select aria-label="Keep new files" value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as RetentionMode })}>
            <option value="temporary">Only for this chat (temporary)</option>
            <option value="knowledge">Save to the Knowledge Center</option>
            <option value="project">Save to a project</option>
            <option value="collection">Add to a collection</option>
          </select>
        </label>
        {value.mode === "project" && (
          <select aria-label="Project for new files" value={value.projectId} onChange={(e) => onChange({ ...value, projectId: e.target.value })}>
            <option value="">Choose a project…</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {value.mode === "collection" && (
          <select aria-label="Collection for new files" value={value.collectionId} onChange={(e) => onChange({ ...value, collectionId: e.target.value })}>
            <option value="">Choose a collection…</option>
            {(facets.data?.collections ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="hint text-xs">{value.mode === "temporary" ? "Temporary files stay with this conversation. They are not added to the Knowledge Center unless you choose to keep them." : "These files will also appear in the Knowledge Center."}</p>
    </fieldset>
  );
}

const ICON: Record<string, string> = { pdf: "PDF", docx: "DOC", xlsx: "XLS", csv: "CSV", txt: "TXT", md: "MD", json: "JSON", xml: "XML" };

export function StagedList({ staged, onRemove }: { staged: Staged[]; onRemove: (key: string) => void }) {
  if (staged.length === 0) return null;
  return (
    <ul aria-label="Files to send" className="space-y-1">
      {staged.map((s) => (
        <li key={s.key} className="flex items-center gap-2 rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700">
          {s.previewUrl ? <img src={s.previewUrl} alt={`Preview of ${s.file.name}`} className="h-10 w-10 rounded object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded bg-slate-200 text-xs font-bold dark:bg-slate-700">{ICON[s.file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "FILE"}</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {s.file.name} <span className="hint">({fmtSize(s.file.size)})</span>
            </p>
            {s.state === "uploading" && <progress className="w-full" max={1} value={s.progress} aria-label={`Uploading ${s.file.name}`} />}
            {s.state === "ready" && <p className="hint text-xs">{s.doc?.status === "ready" ? "Ready to send" : (s.message || "Stored; its content cannot be read")} · {s.doc?.scope === "temporary" ? "temporary" : s.doc?.scope === "project" ? `project: ${s.doc.projectName}` : "saved in the Knowledge Center"}</p>}
            {s.state === "error" && <p className="text-xs text-red-700 dark:text-red-300">{s.message}</p>}
          </div>
          <button type="button" className="min-h-11 min-w-11 text-slate-600" aria-label={`Remove ${s.file.name}`} onClick={() => onRemove(s.key)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AttachButton({ onFiles, disabled }: { onFiles: (f: FileList) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" multiple accept={FILE_ACCEPT} className="sr-only" aria-label="Attach files" onChange={(e) => e.target.files && (onFiles(e.target.files), (e.target.value = ""))} />
      <button type="button" className="btn-secondary" disabled={disabled} onClick={() => ref.current?.click()}>
        Attach files
      </button>
    </>
  );
}

/** Files that were sent with a message (shown under it), with where each one lives and a way to keep a temporary one. */
export function MessageAttachments({ items }: { items: ChatAttachment[] }) {
  const act = useKAction();
  if (items.length === 0) return null;
  return (
    <ul aria-label="Attached files" className="mt-1 flex flex-wrap justify-end gap-1">
      {items.map((a) => (
        <li key={a.id} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-left text-xs dark:border-slate-600 dark:bg-slate-900">
          <span className="font-medium [overflow-wrap:anywhere]">{a.filename}</span> <span className="hint">({fmtSize(a.size)})</span>
          <span className="block hint">{a.status !== "ready" ? (a.status === "unsupported" ? "not readable" : a.status) : a.scope === "temporary" ? "temporary" : a.scope === "project" ? `project: ${a.projectName}` : "in the Knowledge Center"}</span>
          {a.scope === "temporary" && (
            <button type="button" className="mt-1 min-h-11 text-indigo-700 underline dark:text-indigo-300" disabled={act.isPending} onClick={() => act.mutate({ op: "scope", id: a.id, scope: "global" })}>
              Keep in the Knowledge Center
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** What an answer was given from. [A1] is an attached file, [K1] a Knowledge Center passage; a source the answer text refers to is marked “cited”. */
export function MessageSources({ items }: { items: KSource[] }) {
  if (items.length === 0) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer font-medium">
        Sources ({items.length}) · {items.filter((s) => s.cited).length} cited in the answer
      </summary>
      <ul aria-label="Sources" className="mt-1 space-y-1">
        {items.map((s) => (
          <li key={s.n} className="rounded-md border border-slate-200 p-1.5 dark:border-slate-700">
            <span className="font-semibold">[{sourceLabel(s)}]</span>{" "}
            <Link className="text-indigo-700 underline dark:text-indigo-300" to={`/knowledge?doc=${s.docId}`}>
              {s.title}
            </Link>
            {s.cited ? <span className="ml-1 rounded bg-emerald-100 px-1 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">cited</span> : <span className="ml-1 hint">not cited</span>}
            <p className="hint [overflow-wrap:anywhere]">{s.snippet}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
