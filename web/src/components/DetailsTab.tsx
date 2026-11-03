import { useEffect, useMemo, useState } from "react";
import { useBlocker } from "react-router-dom";
import { ApiError } from "../api/client";
import { useModels, useUpdateBot } from "../api/hooks";
import type { Bot, Runtime, UpdateBotInput } from "../api/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ModelSelect } from "./ModelSelect";

// These limits mirror the backend's rules.
const LIMITS = { name: 80, role: 200, personality: 5000, instructions: 20000, responsibility: 300, items: 50 };
const TEMPERATURE = { min: 0, max: 2, default: 0.7 };
const MAX_TOKENS = { min: 1, max: 4096, default: 1024 };

interface FormState {
  name: string;
  role: string;
  personality: string;
  instructions: string;
  responsibilities: string[];
  runtime: Runtime;
  model: string | null;
  /** Kept as text while typing. Empty = use the default. */
  temperature: string;
  maxOutputTokens: string;
}

function toForm(bot: Bot): FormState {
  return {
    name: bot.name,
    role: bot.role,
    personality: bot.personality,
    instructions: bot.instructions,
    responsibilities: bot.responsibilities,
    runtime: bot.runtime,
    model: bot.model,
    temperature: bot.temperature === null ? "" : String(bot.temperature),
    maxOutputTokens: bot.maxOutputTokens === null ? "" : String(bot.maxOutputTokens),
  };
}

/** Returns the number, null (empty = default), or "invalid". */
function parseNumber(text: string, min: number, max: number, integer: boolean): number | null | "invalid" {
  if (text.trim() === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) return "invalid";
  return n;
}

/** Only the fields that actually changed are sent to the backend. */
function changesBetween(bot: Bot, form: FormState): UpdateBotInput {
  const out: UpdateBotInput = {};
  if (form.name.trim() !== bot.name) out.name = form.name.trim();
  if (form.role.trim() !== bot.role) out.role = form.role.trim();
  if (form.personality !== bot.personality) out.personality = form.personality;
  if (form.instructions !== bot.instructions) out.instructions = form.instructions;
  if (JSON.stringify(form.responsibilities) !== JSON.stringify(bot.responsibilities)) {
    out.responsibilities = form.responsibilities;
  }
  if (form.runtime !== bot.runtime) out.runtime = form.runtime;
  if (form.model !== bot.model) out.model = form.model;
  const temperature = parseNumber(form.temperature, TEMPERATURE.min, TEMPERATURE.max, false);
  if (temperature !== "invalid" && temperature !== bot.temperature) out.temperature = temperature;
  const maxTokens = parseNumber(form.maxOutputTokens, MAX_TOKENS.min, MAX_TOKENS.max, true);
  if (maxTokens !== "invalid" && maxTokens !== bot.maxOutputTokens) out.maxOutputTokens = maxTokens;
  return out;
}

interface Props {
  bot: Bot;
  hidden: boolean;
  onDirtyChange: (dirty: boolean) => void;
}

export function DetailsTab({ bot, hidden, onDirtyChange }: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(bot));
  const [note, setNote] = useState("");
  const [newItem, setNewItem] = useState("");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const update = useUpdateBot(bot.id);
  const models = useModels();

  // Reset the form when a different version of the bot arrives (after saving or restoring).
  // A status change does not change the version, so it never wipes your edits.
  useEffect(() => {
    setForm(toForm(bot));
    setNote("");
  }, [bot.id, bot.currentVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const changes = useMemo(() => changesBetween(bot, form), [bot, form]);
  const dirty = Object.keys(changes).length > 0;
  const nameMissing = form.name.trim() === "";
  const temperatureInvalid = parseNumber(form.temperature, TEMPERATURE.min, TEMPERATURE.max, false) === "invalid";
  const maxTokensInvalid = parseNumber(form.maxOutputTokens, MAX_TOKENS.min, MAX_TOKENS.max, true) === "invalid";
  const hasInvalidField = nameMissing || temperatureInvalid || maxTokensInvalid;
  const readOnly = bot.archived;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // Warn before leaving the page (closing the tab, refreshing) with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Warn before navigating to another screen inside the app.
  const blocker = useBlocker(dirty);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setSavedMessage(null);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const addItem = () => {
    const text = newItem.trim();
    if (!text || form.responsibilities.length >= LIMITS.items) return;
    set("responsibilities", [...form.responsibilities, text]);
    setNewItem("");
  };

  const save = () => {
    if (!dirty || hasInvalidField) return;
    const body: UpdateBotInput = { ...changes };
    if (note.trim()) body.changeNote = note.trim();
    update.mutate(body, {
      onSuccess: (saved) => setSavedMessage(`Saved as version ${saved.currentVersion}.`),
    });
  };

  const error = update.error instanceof ApiError ? update.error.friendly : update.error ? "Could not save." : null;

  return (
    <div hidden={hidden} role="tabpanel" aria-label="Details" className="space-y-5">
      {readOnly && (
        <p className="rounded-md bg-slate-200 p-3 text-sm dark:bg-slate-800">
          This bot is archived and read-only. Unarchive it to make changes.
        </p>
      )}

      <fieldset disabled={readOnly} className="space-y-5">
        <div>
          <label htmlFor="bot-name" className="label">
            Name
          </label>
          <input
            id="bot-name"
            value={form.name}
            maxLength={LIMITS.name}
            onChange={(e) => set("name", e.target.value)}
            aria-invalid={nameMissing}
          />
          {nameMissing && <p className="mt-1 text-xs text-red-600">A name is required.</p>}
        </div>

        <div>
          <label htmlFor="bot-role" className="label">
            Role
          </label>
          <input
            id="bot-role"
            value={form.role}
            maxLength={LIMITS.role}
            placeholder="e.g. Email triage assistant"
            onChange={(e) => set("role", e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="bot-personality" className="label">
            Personality
          </label>
          <textarea
            id="bot-personality"
            rows={3}
            value={form.personality}
            maxLength={LIMITS.personality}
            placeholder="How should this bot sound? e.g. Friendly, concise, never pushy."
            onChange={(e) => set("personality", e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="bot-instructions" className="label">
            Instructions
          </label>
          <textarea
            id="bot-instructions"
            rows={8}
            value={form.instructions}
            maxLength={LIMITS.instructions}
            placeholder="The main rulebook for this bot."
            onChange={(e) => set("instructions", e.target.value)}
          />
          <p className="hint">
            {form.instructions.length.toLocaleString()} / {LIMITS.instructions.toLocaleString()} characters
          </p>
        </div>

        <div>
          <span className="label">Responsibilities</span>
          {form.responsibilities.length === 0 && <p className="hint">No responsibilities yet.</p>}
          <ul className="space-y-2">
            {form.responsibilities.map((item, index) => (
              <li key={`${index}-${item}`} className="flex items-center gap-2">
                <span className="flex-1 rounded-md bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">{item}</span>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={`Remove responsibility: ${item}`}
                  onClick={() =>
                    set(
                      "responsibilities",
                      form.responsibilities.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input
              aria-label="New responsibility"
              value={newItem}
              maxLength={LIMITS.responsibility}
              placeholder="Add a responsibility"
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addItem();
                }
              }}
            />
            <button type="button" className="btn-secondary" onClick={addItem} disabled={!newItem.trim()}>
              Add
            </button>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="bot-runtime" className="label">
              Runtime
            </label>
            <select id="bot-runtime" value={form.runtime} onChange={(e) => set("runtime", e.target.value as Runtime)}>
              <option value="builtin">Built-in engine</option>
              <option value="openclaw">OpenClaw (optional, not installed)</option>
            </select>
            <p className="hint">Only saves your preference for now. Nothing runs until Phase 2.</p>
          </div>
          <div>
            <label htmlFor="bot-model" className="label">
              AI model
            </label>
            <ModelSelect
              id="bot-model"
              value={form.model}
              models={models.data ?? []}
              disabled={readOnly}
              onChange={(ref) => set("model", ref)}
            />
            <p className="hint">Each bot uses its own provider and model. Only free models are available.</p>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="bot-temperature" className="label">
              Temperature (creativity)
            </label>
            <input
              id="bot-temperature"
              type="number"
              step="0.1"
              min={TEMPERATURE.min}
              max={TEMPERATURE.max}
              value={form.temperature}
              placeholder={`${TEMPERATURE.default} (default)`}
              aria-invalid={temperatureInvalid}
              onChange={(e) => set("temperature", e.target.value)}
            />
            {temperatureInvalid ? (
              <p className="mt-1 text-xs text-red-600">Enter a number from {TEMPERATURE.min} to {TEMPERATURE.max}, or leave empty.</p>
            ) : (
              <p className="hint">0 = focused and predictable, 2 = very creative. Empty uses {TEMPERATURE.default}.</p>
            )}
          </div>
          <div>
            <label htmlFor="bot-max-tokens" className="label">
              Max reply length (tokens)
            </label>
            <input
              id="bot-max-tokens"
              type="number"
              step="1"
              min={MAX_TOKENS.min}
              max={MAX_TOKENS.max}
              value={form.maxOutputTokens}
              placeholder={`${MAX_TOKENS.default.toLocaleString()} (default)`}
              aria-invalid={maxTokensInvalid}
              onChange={(e) => set("maxOutputTokens", e.target.value)}
            />
            {maxTokensInvalid ? (
              <p className="mt-1 text-xs text-red-600">
                Enter a whole number from {MAX_TOKENS.min} to {MAX_TOKENS.max.toLocaleString()}, or leave empty.
              </p>
            ) : (
              <p className="hint">
                About 4 characters per token. The most allowed is {MAX_TOKENS.max.toLocaleString()}. Empty uses{" "}
                {MAX_TOKENS.default.toLocaleString()}.
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="bot-note" className="label">
            What changed? (optional)
          </label>
          <input
            id="bot-note"
            value={note}
            maxLength={500}
            placeholder="A short note for the version history"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={save} disabled={!dirty || hasInvalidField || update.isPending || readOnly}>
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
        {dirty && !readOnly && <span className="text-sm text-amber-700 dark:text-amber-400">Unsaved changes</span>}
        {!dirty && savedMessage && (
          <span role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            {savedMessage}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {blocker.state === "blocked" && (
        <ConfirmDialog
          title="Leave without saving?"
          confirmLabel="Leave and discard changes"
          cancelLabel="Keep editing"
          danger
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        >
          <p>You have unsaved changes to this bot. If you leave now, they will be lost.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
