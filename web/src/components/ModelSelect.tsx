import { Link } from "react-router-dom";
import type { ModelView } from "../api/types";
import { FREE_LABELS } from "./FreeBadge";

/** A short reason a model can't be picked right now (the full reason is in Settings). */
export function shortReason(model: ModelView): string {
  if (model.freeStatus === "blocked") return "blocked, not free";
  if (model.availability === "not_installed") return "not installed";
  if (model.availability === "removed") return "no longer listed";
  if (!model.enabled) return "switched off in Settings";
  return "provider not ready";
}

function label(model: ModelView): string {
  const parts = [model.displayName, FREE_LABELS[model.freeStatus]];
  if (model.isLlama) parts.push("Llama");
  return parts.join(" · ");
}

interface Props {
  id: string;
  value: string | null;
  models: ModelView[];
  disabled?: boolean;
  onChange: (ref: string | null) => void;
}

/**
 * Pick a bot's provider and model in one dropdown, grouped by provider. Models that cannot be
 * used right now are shown greyed out with the reason. Only usable models can be chosen.
 */
export function ModelSelect({ id, value, models, disabled, onChange }: Props) {
  const providers = [...new Map(models.map((m) => [m.providerId, m.providerName])).entries()];
  const known = value === null || models.some((m) => m.ref === value);

  return (
    <div>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">No model chosen</option>
        {!known && value !== null && (
          <option value={value} disabled>
            {value} (not in the catalog)
          </option>
        )}
        {providers.map(([providerId, providerName]) => (
          <optgroup key={providerId} label={providerName}>
            {models
              .filter((m) => m.providerId === providerId)
              .map((m) => (
                <option key={m.ref} value={m.ref} disabled={!m.callable && m.ref !== value}>
                  {m.callable ? label(m) : `${label(m)} (unavailable: ${shortReason(m)})`}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {models.length === 0 && (
        <p className="hint">
          No models yet.{" "}
          <Link to="/settings" className="text-indigo-700 underline dark:text-indigo-400">
            Connect a provider in Settings
          </Link>
          .
        </p>
      )}
    </div>
  );
}
