import { Link, useLocation } from "react-router-dom";
import { sectionFor, tabFor } from "./nav";

/** Where you are: Section / page. Shown on every page except the dashboard; the last item is the current page and is not a link. */
export function Breadcrumbs() {
  const { pathname } = useLocation();
  const section = sectionFor(pathname);
  if (!section || pathname === "/") return null;
  const tab = tabFor(section, pathname);
  const crumbs: { label: string; to?: string }[] = [{ label: "Home", to: "/" }, { label: section.label, to: tab ? section.to : undefined }];
  if (tab) crumbs.push({ label: tab.label, to: pathname === tab.to ? undefined : tab.to });
  return (
    <nav aria-label="Breadcrumb" className="mb-3 hidden text-xs text-slate-500 dark:text-slate-400 sm:block">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            {c.to ? (
              <Link to={c.to} className="awp-hover hover:text-slate-900 dark:hover:text-white">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-slate-700 dark:text-slate-200">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
