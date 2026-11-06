import { useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { FILE_ACCEPT, fmtSize, uploadFile, useKAction, useKDoc, useKDocs, useKFacets, useKImage, useKSearch, type KDoc, type KFilters } from "../../api/knowledgeHooks";
import { useProjects } from "../../api/workHooks";
import { useQueryClient } from "@tanstack/react-query";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : e instanceof Error ? e.message : "That did not work.");
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "");
const STATUS: Record<string, { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  failed: { label: "Failed", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  unsupported: { label: "Stored, not readable", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  processing: { label: "Processing…", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  queued: { label: "Waiting", tone: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};
export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS["queued"]!;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}>{s.label}</span>;
}

interface Pending {
  key: string;
  name: string;
  size: number;
  progress: number;
  state: "uploading" | "done" | "duplicate" | "error";
  message: string;
  file: File;
  doc?: KDoc;
}

/** Uploads: choose or drop several files; each shows its own progress and result. A file already in the Knowledge Center is reported, not stored twice. */
function UploadZone() {
  const qc = useQueryClient();
  const projects = useProjects(false, "");
  const facets = useKFacets();
  const [over, setOver] = useState(false);
  const [rows, setRows] = useState<Pending[]>([]);
  const [scope, setScope] = useState<"global" | "project">("global");
  const [projectId, setProjectId] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [tags, setTags] = useState("");
  const [folder, setFolder] = useState("");
  const [category, setCategory] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const patch = (key: string, p: Partial<Pending>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const send = async (file: File, key: string, allowDuplicate: boolean) => {
    patch(key, { state: "uploading", progress: 0, message: "" });
    try {
      const r = await uploadFile<{ document: KDoc; duplicate: boolean }>(
        "/api/knowledge/docs",
        file,
        { scope, ...(scope === "project" && projectId ? { projectId } : {}), ...(collectionId ? { collectionId } : {}), ...(folder ? { folder } : {}), ...(category ? { category } : {}), ...(tags.trim() ? { tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } : {}), ...(allowDuplicate ? { allowDuplicate: true } : {}) },
        (f) => patch(key, { progress: f }),
      );
      patch(key, r.duplicate ? { state: "duplicate", doc: r.document, message: `Already in the Knowledge Center as “${r.document.title}”.` } : { state: "done", doc: r.document, message: r.document.status === "ready" ? "Added and ready." : r.document.statusDetail || STATUS[r.document.status]?.label || "" });
    } catch (e) {
      patch(key, { state: "error", message: errorText(e) ?? "Failed." });
    } finally {
      void qc.invalidateQueries({ queryKey: ["knowledge"] });
    }
  };
  const add = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setRows((r) => [...r, { key, name: file.name, size: file.size, progress: 0, state: "uploading", message: "", file }]);
      void send(file, key, false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) add(e.dataTransfer.files);
  };
  const blocked = scope === "project" && !projectId;
  return (
    <section aria-label="Upload documents" className="card space-y-3">
      <h2 className="text-lg font-semibold">Add documents</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          Keep them for
          <select className="mt-1 block w-full" value={scope} onChange={(e) => setScope(e.target.value as "global" | "project")}>
            <option value="global">Everything (global knowledge)</option>
            <option value="project">One project</option>
          </select>
        </label>
        {scope === "project" && (
          <label className="text-sm">
            Project
            <select className="mt-1 block w-full" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Choose a project…</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          Collection (optional)
          <select className="mt-1 block w-full" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            <option value="">None</option>
            {(facets.data?.collections ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Tags (comma separated)
          <input className="mt-1 block w-full" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="pricing, uae" />
        </label>
        <label className="text-sm">
          Folder
          <input className="mt-1 block w-full" value={folder} onChange={(e) => setFolder(e.target.value)} maxLength={120} />
        </label>
        <label className="text-sm">
          Category
          <input className="mt-1 block w-full" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} />
        </label>
      </div>
      <div
        role="group"
        aria-label="Drop files here"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={blocked ? (e) => e.preventDefault() : onDrop}
        className={`rounded-lg border-2 border-dashed p-6 text-center ${over ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-slate-300 dark:border-slate-700"}`}
      >
        <p className="text-sm">Drag files here, or</p>
        <input ref={input} type="file" multiple accept={FILE_ACCEPT} aria-label="Choose files to add" className="sr-only" onChange={(e) => e.target.files && (add(e.target.files), (e.target.value = ""))} />
        <button type="button" className="btn-primary mt-2" disabled={blocked} onClick={() => input.current?.click()}>
          Choose files
        </button>
        <p className="hint mt-2 text-xs">PDF, Word (.docx), text, Markdown, CSV, Excel (.xlsx), JSON, XML and pictures. Up to {fmtSize(8 * 1024 * 1024)} each. {blocked ? "Choose a project first." : "Pictures are kept but their content is not read."}</p>
      </div>
      {rows.length > 0 && (
        <ul aria-label="Upload progress" className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium [overflow-wrap:anywhere]">
                  {r.name} <span className="hint">({fmtSize(r.size)})</span>
                </span>
                <span className={r.state === "error" ? "text-red-700 dark:text-red-300" : ""}>{r.state === "uploading" ? `${Math.round(r.progress * 100)}%` : r.state === "error" ? "Failed" : r.state === "duplicate" ? "Duplicate" : "Done"}</span>
              </div>
              {r.state === "uploading" && <progress className="mt-1 w-full" max={1} value={r.progress} aria-label={`Uploading ${r.name}`} />}
              {r.message && <p className={`mt-1 text-xs ${r.state === "error" ? "text-red-700 dark:text-red-300" : "hint"}`}>{r.message}</p>}
              {r.state === "duplicate" && (
                <button type="button" className="btn-secondary mt-1" onClick={() => void send(r.file, r.key, true)}>
                  Add another copy anyway
                </button>
              )}
              {r.state === "error" && (
                <button type="button" className="btn-secondary mt-1" onClick={() => void send(r.file, r.key, false)}>
                  Try again
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useKDoc(id);
  const act = useKAction();
  const facets = useKFacets();
  const projects = useProjects(false, "");
  const d = q.data?.doc;
  const image = useKImage(id, !!d?.isImage);
  const [title, setTitle] = useState<string | null>(null);
  const [tags, setTags] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [moveTo, setMoveTo] = useState("");
  if (q.isLoading) return <p className="hint">Loading…</p>;
  if (!d || !q.data) return <p role="alert">{errorText(q.error) ?? "That document could not be loaded."}</p>;
  const err = errorText(act.error);
  return (
    <section aria-label={`Document ${d.title}`} className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{d.title}</h3>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={d.status} />
        <span className="hint text-xs">
          {d.filename} · {fmtSize(d.size)} · added {when(d.createdAt)}
        </span>
      </div>
      {d.statusDetail && <p className={`text-sm ${d.status === "failed" ? "text-red-700 dark:text-red-300" : ""}`}>{d.status === "failed" ? "Why it failed: " : ""}{d.statusDetail}</p>}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
        <div><dt className="hint">Kept for</dt><dd>{d.scope === "project" ? `Project: ${d.projectName}` : d.scope === "global" ? "Everything" : "This chat only"}</dd></div>
        <div><dt className="hint">Reader</dt><dd>{d.extractor || "none"}</dd></div>
        <div><dt className="hint">Text</dt><dd>{d.textChars.toLocaleString()} characters in {d.chunkCount} parts</dd></div>
        <div><dt className="hint">Processed</dt><dd>{when(d.processedAt) || "not yet"}</dd></div>
        <div><dt className="hint">Fingerprint</dt><dd className="font-mono">{d.sha256.slice(0, 12)}</dd></div>
        <div><dt className="hint">Collection</dt><dd>{d.collectionName ?? "none"}</dd></div>
      </dl>
      {d.isImage && image.data && <img src={image.data.dataUrl} alt={`Preview of ${d.filename}`} className="max-h-64 rounded-md border border-slate-300 dark:border-slate-700" />}
      {q.data.text && (
        <details open className="space-y-1">
          <summary className="cursor-pointer text-sm font-semibold">Preview of the text</summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-100 p-2 text-xs dark:bg-slate-800">{q.data.text}</pre>
          {q.data.truncated && <p className="hint text-xs">Only the start is shown here; the whole text is searchable.</p>}
        </details>
      )}
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          act.mutate({ op: "update", id, patch: { ...(title !== null ? { title } : {}), ...(tags !== null ? { tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } : {}), ...(category !== null ? { category } : {}), ...(folder !== null ? { folder } : {}) } });
        }}
      >
        <label className="text-sm">
          Title
          <input className="mt-1 block w-full" aria-label="Document title" value={title ?? d.title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </label>
        <label className="text-sm">
          Tags (comma separated)
          <input className="mt-1 block w-full" aria-label="Document tags" value={tags ?? d.tags.join(", ")} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="text-sm">
          Category
          <input className="mt-1 block w-full" aria-label="Document category" value={category ?? d.category} onChange={(e) => setCategory(e.target.value)} maxLength={60} />
        </label>
        <label className="text-sm">
          Folder
          <input className="mt-1 block w-full" aria-label="Document folder" value={folder ?? d.folder} onChange={(e) => setFolder(e.target.value)} maxLength={120} />
        </label>
        <label className="text-sm sm:col-span-2">
          Collection
          <select className="mt-1 block w-full" aria-label="Document collection" value={d.collectionId ?? ""} onChange={(e) => act.mutate({ op: "update", id, patch: { collectionId: e.target.value || null } })}>
            <option value="">None</option>
            {(facets.data?.collections ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button className="btn-primary" type="submit" disabled={act.isPending}>
            Save details
          </button>
          <button type="button" className="btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ op: "reprocess", id })}>
            Reprocess
          </button>
          <a className="btn-secondary" href={`/api/knowledge/docs/${id}/original`} download>
            Download the original
          </a>
        </div>
      </form>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Move to
          <select className="mt-1 block" aria-label="Move document to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Choose…</option>
            <option value="global">Everything (global)</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={`project:${p.id}`}>
                Project: {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-secondary" disabled={!moveTo || act.isPending} onClick={() => act.mutate(moveTo === "global" ? { op: "scope", id, scope: "global" } : { op: "scope", id, scope: "project", projectId: moveTo.slice(8) })}>
          Move
        </button>
      </div>
      <details className="space-y-2">
        <summary className="cursor-pointer text-sm font-semibold">Remove this document</summary>
        <p className="hint text-xs">It is hidden and no longer searched; the file is kept, and you can restore it under “Show removed”. Type the title to confirm.</p>
        <input className="block w-full" aria-label="Type the document title to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button type="button" className="btn-secondary" disabled={confirm !== d.title || act.isPending} onClick={() => act.mutate({ op: "delete", id, confirmTitle: confirm }, { onSuccess: onClose })}>
          Remove document
        </button>
      </details>
      {err && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {err}
        </p>
      )}
    </section>
  );
}

function Search({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const hits = useKSearch(q);
  return (
    <section aria-label="Search the documents" className="card space-y-2">
      <label className="block text-sm font-medium">
        Search inside the documents
        <input className="mt-1 block w-full" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Words that appear in the text…" />
      </label>
      {q.trim().length >= 2 && hits.isLoading && <p className="hint">Searching…</p>}
      {q.trim().length >= 2 && hits.data && hits.data.hits.length === 0 && <p className="hint">Nothing in the readable documents matches “{q.trim()}”.</p>}
      <ul className="space-y-2">
        {hits.data?.hits.map((h) => (
          <li key={`${h.docId}-${h.chunkIdx}`} className="rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700">
            <button type="button" className="min-h-11 font-semibold text-indigo-700 underline dark:text-indigo-300" onClick={() => onOpen(h.docId)}>
              {h.title}
            </button>
            <span className="hint text-xs"> · part {h.chunkIdx + 1}</span>
            <p className="mt-1 [overflow-wrap:anywhere]">{h.snippet}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Knowledge Center document workspace: upload, filter, preview, organise, reprocess, search. */
export function Documents() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<KFilters>({ status: params.get("status") ?? undefined });
  const [showRemoved, setShowRemoved] = useState(false);
  const [dupOnly, setDupOnly] = useState(params.get("duplicates") === "1");
  const [newCollection, setNewCollection] = useState("");
  const open = params.get("doc");
  const facets = useKFacets();
  const docs = useKDocs({ ...filters, deleted: showRemoved });
  const act = useKAction();
  const setDoc = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("doc", id);
    else next.delete("doc");
    setParams(next, { replace: true });
  };
  const dupIds = new Set((facets.data?.duplicates ?? []).flatMap((g) => g.docs.map((x) => x.id)));
  const list = (docs.data ?? []).filter((d) => !dupOnly || dupIds.has(d.id));
  const set = (k: keyof KFilters, v: string) => setFilters((f) => ({ ...f, [k]: v || undefined }));
  const status = facets.data?.status ?? {};
  return (
    <div className="space-y-4" aria-label="Documents">
      <UploadZone />
      <div className="flex flex-wrap gap-2 text-xs" aria-label="Processing status">
        {Object.entries(status).map(([k, n]) => (
          <button key={k} type="button" className={`min-h-11 rounded-full border px-3 py-2 ${filters.status === k ? "border-indigo-600" : "border-slate-300 dark:border-slate-700"}`} aria-pressed={filters.status === k} onClick={() => set("status", filters.status === k ? "" : k)}>
            {STATUS[k]?.label ?? k}: {n}
          </button>
        ))}
        {(facets.data?.duplicates.length ?? 0) > 0 && (
          <button type="button" className={`min-h-11 rounded-full border px-3 py-2 ${dupOnly ? "border-indigo-600" : "border-slate-300 dark:border-slate-700"}`} aria-pressed={dupOnly} onClick={() => setDupOnly(!dupOnly)}>
            Duplicates: {facets.data!.duplicates.length}
          </button>
        )}
      </div>
      <Search onOpen={setDoc} />
      <section aria-label="Filters" className="card grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm sm:col-span-2">
          Find by name, file, tag or category
          <input className="mt-1 block w-full" type="search" aria-label="Filter documents" value={filters.q ?? ""} onChange={(e) => set("q", e.target.value)} />
        </label>
        <label className="text-sm">
          Tag
          <select className="mt-1 block w-full" aria-label="Filter by tag" value={filters.tag ?? ""} onChange={(e) => set("tag", e.target.value)}>
            <option value="">Any</option>
            {facets.data?.tags.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Folder
          <select className="mt-1 block w-full" aria-label="Filter by folder" value={filters.folder ?? ""} onChange={(e) => set("folder", e.target.value)}>
            <option value="">Any</option>
            {facets.data?.folders.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Category
          <select className="mt-1 block w-full" aria-label="Filter by category" value={filters.category ?? ""} onChange={(e) => set("category", e.target.value)}>
            <option value="">Any</option>
            {facets.data?.categories.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Collection
          <select className="mt-1 block w-full" aria-label="Filter by collection" value={filters.collectionId ?? ""} onChange={(e) => set("collectionId", e.target.value)}>
            <option value="">Any</option>
            {facets.data?.collections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.documents})</option>)}
          </select>
        </label>
        <label className="text-sm">
          Kept for
          <select className="mt-1 block w-full" aria-label="Filter by scope" value={filters.scope ?? ""} onChange={(e) => set("scope", e.target.value)}>
            <option value="">Everything and projects</option>
            <option value="global">Global knowledge</option>
            <option value="project">Project knowledge</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show removed
        </label>
      </section>
      <section aria-label="Collections" className="card space-y-2">
        <h3 className="font-semibold">Collections</h3>
        <ul className="flex flex-wrap gap-2">
          {facets.data?.collections.length === 0 && <li className="hint text-sm">No collections yet.</li>}
          {facets.data?.collections.map((c) => (
            <li key={c.id} className="flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-sm dark:border-slate-700">
              {c.name} ({c.documents})
              <button type="button" className="min-h-11 min-w-11 text-slate-500" aria-label={`Remove collection ${c.name}`} onClick={() => act.mutate({ op: "removeCollection", id: c.id })}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate({ op: "collection", name: newCollection }, { onSuccess: () => setNewCollection("") });
          }}
        >
          <label className="text-sm">
            New collection
            <input className="mt-1 block" aria-label="New collection name" value={newCollection} maxLength={80} onChange={(e) => setNewCollection(e.target.value)} />
          </label>
          <button className="btn-secondary" type="submit" disabled={!newCollection.trim() || act.isPending}>
            Create collection
          </button>
        </form>
        <p className="hint text-xs">Removing a collection never removes its documents.</p>
        {errorText(act.error) && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {errorText(act.error)}
          </p>
        )}
      </section>
      {open && <Detail id={open} onClose={() => setDoc(null)} />}
      <section aria-label="Document list">
        <h3 className="mb-2 font-semibold">{showRemoved ? "Removed documents" : "Documents"} ({list.length})</h3>
        {docs.isLoading && <p className="hint">Loading…</p>}
        {!docs.isLoading && list.length === 0 && <p className="hint">{(facets.data?.total ?? 0) === 0 && !showRemoved ? "No documents yet. Add some above, then ask the AI Assistant questions about them." : "No documents match these filters."}</p>}
        <ul className="space-y-2">
          {list.map((d) => (
            <li key={d.id} className={`card ${open === d.id ? "ring-2 ring-indigo-500" : ""}`} aria-label={`Document row ${d.title}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button type="button" className="min-h-11 text-left font-semibold [overflow-wrap:anywhere]" aria-label={`Open ${d.title}`} onClick={() => setDoc(d.id)}>
                  {d.title}
                </button>
                <StatusChip status={d.status} />
              </div>
              <p className="hint text-xs">
                {d.filename} · {fmtSize(d.size)} · {when(d.updatedAt)} · {d.scope === "project" ? `Project: ${d.projectName}` : "Global"}
                {d.collectionName ? ` · ${d.collectionName}` : ""}
                {d.folder ? ` · ${d.folder}` : ""}
                {d.category ? ` · ${d.category}` : ""}
              </p>
              {d.statusDetail && d.status !== "ready" && <p className="mt-1 text-xs">{d.statusDetail}</p>}
              {d.tags.length > 0 && (
                <p className="mt-1 flex flex-wrap gap-1">
                  {d.tags.map((t) => (
                    <button key={t} type="button" className="min-h-11 rounded-full bg-slate-200 px-3 text-xs dark:bg-slate-700" onClick={() => set("tag", t)}>
                      {t}
                    </button>
                  ))}
                </p>
              )}
              {showRemoved && (
                <button type="button" className="btn-secondary mt-2" onClick={() => act.mutate({ op: "restore", id: d.id })}>
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
