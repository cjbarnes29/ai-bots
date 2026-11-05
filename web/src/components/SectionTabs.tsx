import { Link, useLocation } from "react-router-dom";
import { sectionFor, tabFor } from "./shell/nav";

/**
 * The second level of navigation: the pages of the section you are in. It is drawn from the same list as the sidebar (`shell/nav.ts`),
 * so there is one place to change. A section with one page shows no tab bar; the breadcrumb already says where you are.
 */
export function SectionTabs() {
  const { pathname } = useLocation();
  const section = sectionFor(pathname);
  if (!section || section.tabs.length < 2) return null;
  const current = tabFor(section, pathname);
  return (
    <nav aria-label={`${section.label} sections`} className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 pb-px dark:border-slate-800">
      {section.tabs.map((t) => {
        const on = t === current;
        return (
          <Link
            key={t.to}
            to={t.to}
            aria-current={on ? "page" : undefined}
            className={`awp-hover whitespace-nowrap rounded-t-md px-3 py-3 text-sm font-medium ${
              on ? "border-b-2 border-indigo-600 text-indigo-700 dark:text-indigo-300" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
