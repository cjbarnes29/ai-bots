import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useBots, useCreateBot } from "../api/hooks";
import { useBotModes, useBotTemplates, useCreateFromTemplate, useDraftBot, useExportBot, useImportBot, useImportPreview, useSetBotMode, type ImportCheckInfo } from "../api/studioHooks";

const err = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
type Tab = "templates" | "describe" | "import" | "modes";
const TABS: [Tab, string][] = [
  ["templates", "Templates"],
  ["describe", "Describe a bot"],
  ["import", "Import / export"],
  ["modes", "Operating modes"],
];
const alertCls = "text-sm text-red-700 dark:text-red-300";

/**
 * Bot Studio: ways to make and manage bots on top of the existing Agent Manager. Everything created here is an ordinary bot: disabled, no model,
 * every permission off. Nothing here grants a permission; a mode can only limit what a bot may ask for.
 */
export function BotStudio() {
  const [tab, setTab] = useState<Tab>("templates");
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Bot Studio</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Start a bot from a template, describe one and let the AI draft it, or import one from a file. <strong>Every new bot starts switched off, with no model and every permission off.</strong> You
          decide what it may do afterwards, on its own page.
        </p>
      </div>
      <div role="tablist" aria-label="Bot Studio" className="flex flex-wrap gap-2">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "btn-primary" : "btn-secondary"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "templates" && <Templates />}
      {tab === "describe" && <Describe />}
      {tab === "import" && <ImportExport />}
      {tab === "modes" && <Modes />}
    </div>
  );
}

function Templates() {
  const tpl = useBotTemplates();
  const create = useCreateFromTemplate();
  const nav = useNavigate();
  const groups = [...new Set((tpl.data ?? []).map((t) => t.category))];
  return (
    <section aria-label="Templates" className="space-y-4">
      {err(create.error) && (
        <p role="alert" className={alertCls}>
          {err(create.error)}
        </p>
      )}
      {groups.map((g) => (
        <div key={g} className="space-y-2">
          <h2 className="text-lg font-semibold">{g}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(tpl.data ?? [])
              .filter((t) => t.category === g)
              .map((t) => (
                <li key={t.id} aria-label={t.name} className="card space-y-2">
                  <h3 className="font-semibold">{t.name}</h3>
                  <p className="text-sm">{t.role}</p>
                  {t.suggests.length > 0 && <p className="hint">Usually needs you to allow: {t.suggests.join(", ")}. Nothing is allowed automatically.</p>}
                  <button className="btn-secondary" disabled={create.isPending} onClick={() => create.mutate({ id: t.id }, { onSuccess: (r) => nav(`/bots/${r.bot.id}`) })}>
                    Create from this template
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Describe() {
  const draft = useDraftBot();
  const create = useCreateBot();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [edit, setEdit] = useState<{ name: string; role: string; personality: string; instructions: string } | null>(null);
  const d = draft.data;
  return (
    <section aria-label="Describe a bot" className="card space-y-3">
      <p className="text-sm">
        Describe the job in a sentence or two. The AI proposes a draft; <strong>nothing is saved until you read it and press Save</strong>. Do not put passwords or keys in the description: it is sent to a model.
      </p>
      <textarea aria-label="Describe the bot's job" rows={4} className="w-full" value={text} onChange={(e) => setText(e.target.value)} placeholder="A helper that reads my supplier emails and drafts polite replies for me to check" />
      <button
        className="btn-primary"
        disabled={text.trim().length < 10 || draft.isPending}
        onClick={() => draft.mutate({ description: text }, { onSuccess: (r) => setEdit({ name: r.draft.name, role: r.draft.role, personality: r.draft.personality, instructions: r.draft.instructions }) })}
      >
        {draft.isPending ? "Drafting..." : "Draft this bot"}
      </button>
      {err(draft.error) && (
        <p role="alert" className={alertCls}>
          {err(draft.error)}
        </p>
      )}
      {d && edit && (
        <div aria-label="Draft" className="space-y-2 rounded-md border border-slate-300 p-3 dark:border-slate-600">
          <p className="font-semibold">Draft (not saved). Edit anything, then save.</p>
          {d.warnings.map((w) => (
            <p key={w} className="hint">
              {w}
            </p>
          ))}
          {(["name", "role", "personality", "instructions"] as const).map((k) => (
            <label key={k} className="block text-sm">
              <span className="label">{k[0]!.toUpperCase() + k.slice(1)}</span>
              {k === "name" || k === "role" ? (
                <input aria-label={`Draft ${k}`} className="w-full" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
              ) : (
                <textarea aria-label={`Draft ${k}`} rows={k === "instructions" ? 8 : 3} className="w-full" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
              )}
            </label>
          ))}
          <p className="hint">Responsibilities proposed: {d.draft.responsibilities.join("; ")}</p>
          <button
            className="btn-primary"
            disabled={create.isPending || !edit.name.trim()}
            onClick={() => create.mutate({ name: edit.name, role: edit.role, personality: edit.personality, instructions: edit.instructions, responsibilities: d.draft.responsibilities }, { onSuccess: (b) => nav(`/bots/${b.id}`) })}
          >
            Save as a new bot (starts switched off)
          </button>
          {err(create.error) && (
            <p role="alert" className={alertCls}>
              {err(create.error)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ImportExport() {
  const bots = useBots(false);
  const exp = useExportBot();
  const preview = useImportPreview();
  const imp = useImportBot();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [shown, setShown] = useState<ImportCheckInfo | null>(null);
  return (
    <section aria-label="Import and export" className="space-y-4">
      <div className="card space-y-2">
        <h2 className="text-lg font-semibold">Export a bot</h2>
        <p className="text-sm">The file contains the bot&apos;s description and instructions only. It never contains permissions, models, history or secrets.</p>
        <ul className="space-y-1">
          {(bots.data ?? []).map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{b.name}</span>
              <button className="btn-secondary" aria-label={`Export ${b.name}`} onClick={() => exp.mutate(b.id, { onSuccess: (f) => setText(JSON.stringify(f, null, 2)) })}>
                Export
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="card space-y-2">
        <h2 className="text-lg font-semibold">Import a bot</h2>
        <p className="text-sm">Paste a bot file. It is checked first; a file with permissions, models, keys or unknown fields is refused. The new bot starts switched off with every permission off.</p>
        <textarea
          aria-label="Bot file"
          rows={10}
          className="w-full font-mono text-xs"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setShown(null);
          }}
        />
        <button className="btn-secondary" disabled={!text.trim() || preview.isPending} onClick={() => preview.mutate(text, { onSuccess: setShown })}>
          Check the file
        </button>
        {err(preview.error) && (
          <p role="alert" className={alertCls}>
            {err(preview.error)}
          </p>
        )}
        {shown && !shown.ok && (
          <ul role="alert" className={`list-disc pl-5 ${alertCls}`}>
            {shown.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {shown?.ok && shown.bot && (
          <div aria-label="Import preview" className="space-y-1 text-sm">
            <p>
              <strong>{shown.bot.name}</strong>: {shown.bot.role}
            </p>
            {shown.warnings.map((w) => (
              <p key={w} className="text-amber-800 dark:text-amber-300">
                {w}
              </p>
            ))}
            <button className="btn-primary" disabled={imp.isPending} onClick={() => imp.mutate(text, { onSuccess: (r) => nav(`/bots/${r.bot.id}`) })}>
              Import as a new bot (starts switched off)
            </button>
          </div>
        )}
        {err(imp.error) && (
          <p role="alert" className={alertCls}>
            {err(imp.error)}
          </p>
        )}
      </div>
    </section>
  );
}

function Modes() {
  const modes = useBotModes();
  const bots = useBots(false);
  const set = useSetBotMode();
  return (
    <section aria-label="Operating modes" className="card space-y-3">
      <p className="text-sm">
        {modes.data?.note ?? "A mode only limits what a bot may ask for."} A bot with no mode behaves as it did before. Changing a mode never gives a bot a permission.
      </p>
      <ul className="list-disc pl-5 text-sm">
        {(modes.data?.modes ?? []).map((m) => (
          <li key={m.id}>
            <strong>{m.label}:</strong> {m.description}
          </li>
        ))}
      </ul>
      {err(set.error) && (
        <p role="alert" className={alertCls}>
          {err(set.error)}
        </p>
      )}
      <ul className="space-y-2">
        {(bots.data ?? []).map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{b.name}</span>
            <select aria-label={`Mode for ${b.name}`} value={modes.data?.assignments[b.id] ?? ""} onChange={(e) => set.mutate({ id: b.id, mode: e.target.value || null })}>
              <option value="">No mode (as before)</option>
              {(modes.data?.modes ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}
