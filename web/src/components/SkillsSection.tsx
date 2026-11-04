import { useState } from "react";
import { ApiError } from "../api/client";
import {
  useArchiveSkill,
  useCreateSkill,
  useDuplicateSkill,
  useImportSkill,
  useRestoreSkillVersion,
  useSkill,
  useSkills,
  useTestSkill,
  useTools,
  useUpdateSkill,
} from "../api/hooks";
import type { SkillInfo } from "../api/types";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

function SkillForm({ initial, onDone, onCancel }: { initial?: SkillInfo; onDone: () => void; onCancel: () => void }) {
  const tools = useTools();
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [needs, setNeeds] = useState<string[]>(initial?.requiredTools ?? []);
  const [note, setNote] = useState("");
  const busy = create.isPending || update.isPending;
  const error = errorText(create.error ?? update.error);

  const save = () => {
    const body = { name, description, instructions, requiredTools: needs };
    if (initial) update.mutate({ id: initial.id, patch: { ...body, ...(note ? { changeNote: note } : {}) } }, { onSuccess: onDone });
    else create.mutate(body, { onSuccess: onDone });
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
      <label className="block text-sm">
        <span className="label">Skill name</span>
        <input aria-label="Skill name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="w-full" />
      </label>
      <label className="block text-sm">
        <span className="label">What it is for (one line)</span>
        <input aria-label="Skill description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} className="w-full" />
      </label>
      <label className="block text-sm">
        <span className="label">Instructions the bot will follow</span>
        <textarea aria-label="Skill instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} maxLength={6000} className="w-full" />
      </label>
      <fieldset className="text-sm">
        <legend className="label">Tools this skill needs (optional)</legend>
        <div className="flex flex-wrap gap-3">
          {(tools.data ?? []).map((t) => (
            <label key={t.id} className="flex items-center gap-1">
              <input type="checkbox" checked={needs.includes(t.id)} onChange={(e) => setNeeds(e.target.checked ? [...needs, t.id] : needs.filter((x) => x !== t.id))} />
              {t.name}
              {t.status !== "available" ? <span className="hint"> (not available)</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      {initial && (
        <label className="block text-sm">
          <span className="label">What did you change? (optional)</span>
          <input aria-label="Change note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="w-full" />
        </label>
      )}
      <p className="hint">Never put keys or passwords in a skill. They are refused, and secrets belong in the vault.</p>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !name.trim() || !instructions.trim()} onClick={save}>
          {initial ? "Save as a new version" : "Create skill"}
        </button>
        <button className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SkillDetails({ skill }: { skill: SkillInfo }) {
  const detail = useSkill(skill.id);
  const restore = useRestoreSkillVersion();
  const test = useTestSkill();
  const [sample, setSample] = useState("");
  const [exported, setExported] = useState<string | null>(null);
  const { data } = detail;

  return (
    <div className="mt-2 space-y-3 border-t border-slate-200 pt-2 dark:border-slate-800">
      <details>
        <summary className="cursor-pointer text-sm font-medium">Versions ({data?.versions.length ?? skill.version})</summary>
        <ul className="mt-1 space-y-1 text-sm">
          {(data?.versions ?? []).map((v) => (
            <li key={v.version} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Version {v.version}
                {v.changeNote ? ` · ${v.changeNote}` : ""} · {new Date(v.createdAt).toLocaleString()}
              </span>
              {v.version !== skill.version && (
                <button className="underline" disabled={restore.isPending} onClick={() => restore.mutate({ id: skill.id, version: v.version })}>
                  Restore this version
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
      <div className="space-y-1">
        <label className="block text-sm">
          <span className="label">Try this skill on a sample request</span>
          <textarea aria-label="Sample request" value={sample} onChange={(e) => setSample(e.target.value)} rows={2} maxLength={2000} className="w-full" />
        </label>
        <button className="btn-secondary" disabled={!sample.trim() || test.isPending} onClick={() => test.mutate({ id: skill.id, input: sample })}>
          {test.isPending ? "Trying…" : "Try it (one model call)"}
        </button>
        {test.data && (
          <div role="status" className="space-y-1 text-sm">
            {test.data.note && <p className="text-amber-800 dark:text-amber-300">{test.data.note}</p>}
            <p className="whitespace-pre-wrap rounded-md bg-slate-100 p-2 [overflow-wrap:anywhere] dark:bg-slate-800">{test.data.output}</p>
            <p className="hint">{test.data.tokens} tokens used.</p>
          </div>
        )}
        {errorText(test.error) && <p role="alert" className="text-sm text-red-700">{errorText(test.error)}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ExportButton id={skill.id} onText={setExported} />
      </div>
      {exported && (
        <textarea aria-label="Exported skill file" readOnly value={exported} rows={6} className="w-full font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  );
}

function ExportButton({ id, onText }: { id: string; onText: (t: string) => void }) {
  return (
    <button
      className="btn-secondary"
      onClick={async () => {
        const res = await fetch(`/api/skills/${id}/export`);
        const json = (await res.json()) as { file?: unknown };
        onText(JSON.stringify(json.file, null, 2));
      }}
    >
      Export (copy as text)
    </button>
  );
}

/** Settings > Skills. Reusable instructions for bots: create, edit with full history, duplicate, import, export, try, archive. */
export function SkillsSection() {
  const skills = useSkills(false);
  const archived = useSkills(true);
  const duplicate = useDuplicateSkill();
  const archive = useArchiveSkill();
  const update = useUpdateSkill();
  const importSkill = useImportSkill();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const list = skills.data ?? [];
  const old = (archived.data ?? []).filter((s) => s.archived);

  const doImport = () => {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(pasted);
    } catch {
      return setImportError("That is not a skill file (it could not be read).");
    }
    importSkill.mutate(parsed, { onSuccess: () => setPasted("") });
  };

  return (
    <section aria-label="Skills" className="card space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Skill library</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          A skill is a reusable set of instructions you can give to bots (on a bot's Permissions tab). Skills are only text: they cannot run anything or give a bot a tool. Every edit is kept as a version.
        </p>
      </div>
      {list.length === 0 && editing !== "new" && <p className="hint">No skills yet.</p>}
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id} aria-label={`Skill ${s.name}`} className="rounded-md border border-slate-200 p-2 dark:border-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {s.name} <span className="hint">v{s.version}</span>
                  {s.imported && <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-900 dark:bg-violet-950 dark:text-violet-200">imported</span>}
                  {!s.enabled && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-800">off</span>}
                </p>
                <p className="hint [overflow-wrap:anywhere]">{s.description || "No description."}</p>
                {s.missingTools.length > 0 && <p className="text-xs text-amber-800 dark:text-amber-300">Needs {s.missingTools.map((m) => m.name).join(", ")} (not available)</p>}
                <p className="hint">{s.assignedBots.length} bot{s.assignedBots.length === 1 ? "" : "s"} use it</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" aria-label={`${s.enabled ? "Switch off" : "Switch on"} ${s.name}`} onClick={() => update.mutate({ id: s.id, patch: { enabled: !s.enabled } })}>
                  {s.enabled ? "Switch off" : "Switch on"}
                </button>
                <button className="btn-secondary" onClick={() => setEditing(s.id)}>
                  Edit
                </button>
                <button className="btn-secondary" onClick={() => duplicate.mutate(s.id)}>
                  Duplicate
                </button>
                <button className="btn-secondary" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  {open === s.id ? "Close" : "More"}
                </button>
                <button className="btn-secondary" onClick={() => archive.mutate({ id: s.id, archived: true })}>
                  Archive
                </button>
              </div>
            </div>
            {editing === s.id && <SkillForm initial={s} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />}
            {open === s.id && <SkillDetails skill={s} />}
          </li>
        ))}
      </ul>

      {editing === "new" ? (
        <SkillForm onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
      ) : (
        <button className="btn-primary" onClick={() => setEditing("new")}>
          New skill
        </button>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-medium">Import a skill</summary>
        <div className="mt-2 space-y-2">
          <p className="hint">Paste an exported skill file. It arrives switched OFF and given to nobody, so you can read it first.</p>
          <textarea aria-label="Skill file to import" value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} className="w-full font-mono text-xs" />
          <button className="btn-secondary" disabled={!pasted.trim() || importSkill.isPending} onClick={doImport}>
            Import
          </button>
          {(importError || errorText(importSkill.error)) && (
            <p role="alert" className="text-sm text-red-700">
              {importError ?? errorText(importSkill.error)}
            </p>
          )}
        </div>
      </details>

      {old.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Archived skills ({old.length})</summary>
          <ul className="mt-1 space-y-1 text-sm">
            {old.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                {s.name}
                <button className="underline" onClick={() => archive.mutate({ id: s.id, archived: false })}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {errorText(duplicate.error ?? archive.error ?? update.error) && (
        <p role="alert" className="text-sm text-red-700">
          {errorText(duplicate.error ?? archive.error ?? update.error)}
        </p>
      )}
    </section>
  );
}
