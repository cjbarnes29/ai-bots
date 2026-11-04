import { useState } from "react";
import { getThemeMode, setThemeMode, type ThemeMode } from "../../lib/theme";

const CHOICES: { value: ThemeMode; label: string; hint: string }[] = [
  { value: "system", label: "Follow this device", hint: "Light or dark, whichever this device is set to." },
  { value: "light", label: "Light", hint: "" },
  { value: "dark", label: "Dark", hint: "" },
];

/** Appearance. Stored in this browser only, so the PC and the phone can each look the way their owner likes. */
export function ThemeSection() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode);
  return (
    <section aria-labelledby="appearance-heading" className="card space-y-3">
      <h2 id="appearance-heading" className="text-lg font-semibold">
        Appearance
      </h2>
      <fieldset className="space-y-1">
        <legend className="sr-only">Theme</legend>
        {CHOICES.map((c) => (
          <label key={c.value} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="radio"
              name="theme"
              className="h-4 w-4"
              checked={mode === c.value}
              onChange={() => {
                setThemeMode(c.value);
                setMode(c.value);
              }}
            />
            <span>
              {c.label}
              {c.hint && <span className="hint block">{c.hint}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="hint">Saved in this browser only.</p>
    </section>
  );
}
