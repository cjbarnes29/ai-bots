/** Light / dark / follow-the-device. Kept in this browser only (localStorage); nothing is sent to the server. */
export type ThemeMode = "system" | "light" | "dark";
const KEY = "awp-theme";

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const prefersDark = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function applyTheme(mode: ThemeMode = getThemeMode()): void {
  const dark = mode === "dark" || (mode === "system" && prefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    if (mode === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* private mode: the choice just lasts until the page closes */
  }
  applyTheme(mode);
}

/** Called once at start-up; also follows the device setting while "system" is chosen. */
export function initTheme(): void {
  applyTheme();
  if (typeof window.matchMedia === "function") {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (getThemeMode() === "system") applyTheme("system");
    });
  }
}
