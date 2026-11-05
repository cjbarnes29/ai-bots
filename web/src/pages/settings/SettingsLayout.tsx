import { useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { CATEGORIES, SETTING_INDEX, categoryById } from "./categories";

/**
 * Settings: nine categories instead of one long page. Wide screens show the category list beside the content; on a phone the list is
 * the first screen and a category opens on its own screen with a way back. The search box looks through the whole list of settings.
 */
export function SettingsLayout() {
  const { category } = useParams();
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = words.length
    ? SETTING_INDEX.filter((e) => {
        const hay = `${e.label} ${e.where} ${e.words}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
    : [];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          aria-label="Search settings"
          placeholder="Search settings, e.g. dark mode, Gmail, phone"
          className="min-h-11 pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {words.length > 0 ? (
        <section aria-label="Search results" className="space-y-2">
          {results.length === 0 ? (
            <p role="status" className="hint">
              No setting matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <ul className="card divide-y divide-slate-200 py-1 dark:divide-slate-800">
              {results.map((r) => (
                <li key={r.label}>
                  <Link to={r.to} className="flex min-h-12 items-center gap-3 px-1 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{r.label}</span>
                      <span className="hint !mt-0 block">{r.where}</span>
                    </span>
                    <Icon name="next" className="h-4 w-4 text-slate-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
          <nav aria-label="Settings categories" className={category ? "hidden lg:block" : "block"}>
            <ul className="card divide-y divide-slate-200 p-1 dark:divide-slate-800 lg:divide-y-0">
              {CATEGORIES.map((c) => {
                const on = c.id === category;
                return (
                  <li key={c.id}>
                    <Link
                      to={`/settings/${c.id}`}
                      aria-current={on ? "page" : undefined}
                      className={`awp-hover flex min-h-12 items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                        on ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" : "hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      <span>{c.label}</span>
                      <Icon name="next" className="h-4 w-4 text-slate-400 lg:hidden" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className={category ? "block min-w-0" : "hidden min-w-0 lg:block"}>
            <Outlet />
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsHome() {
  return (
    <div className="card space-y-1">
      <h2 className="text-lg font-semibold">Choose a category</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        The defaults are safe, so most people never need to change anything here. Use the search box to find a specific setting.
      </p>
    </div>
  );
}

export function SettingsCategoryPage() {
  const { category } = useParams();
  const c = categoryById(category);
  if (!c) {
    return (
      <div className="card space-y-3">
        <p>That settings page does not exist.</p>
        <Link to="/settings" className="btn-secondary">
          Back to Settings
        </Link>
      </div>
    );
  }
  return (
    <div key={c.id} className="awp-fade-in space-y-6">
      <div className="space-y-1">
        <Link to="/settings" className="inline-flex min-h-11 items-center gap-1 text-sm text-indigo-700 hover:underline dark:text-indigo-400 lg:hidden">
          <Icon name="back" className="h-4 w-4" /> All settings
        </Link>
        <h2 className="text-xl font-bold">{c.label}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{c.description}</p>
      </div>
      {c.content()}
    </div>
  );
}
