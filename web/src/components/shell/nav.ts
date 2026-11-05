import type { IconName } from "../Icon";

export interface NavTab {
  to: string;
  label: string;
  /** Path prefixes that keep this tab highlighted (a task page still belongs to the Tasks tab). */
  match: string[];
}

export interface NavEntry {
  to: string;
  label: string;
  icon: IconName;
  /** Path prefixes that keep this section highlighted. The longest matching prefix across all sections wins. */
  match: string[];
  /** Shown in the phone's bottom bar. Everything else is under "More" there. */
  primary: boolean;
  /** The pages that belong to this section. Every page that existed before the redesign is still reachable at its old address. */
  tabs: NavTab[];
}

/**
 * The one list the sidebar, the tablet rail, the phone bar, the "More" sheet, the section tabs and the breadcrumbs are all drawn from.
 * Nine sections (owner decision D-075); no route was removed or renamed, only grouped.
 */
export const NAV: NavEntry[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", match: [], primary: true, tabs: [] },
  {
    to: "/agents",
    label: "AI Agents",
    icon: "agents",
    match: ["/agents", "/bots", "/studio", "/groups", "/workforce"],
    primary: true,
    tabs: [
      { to: "/agents", label: "Agents & Teams", match: ["/agents", "/bots"] },
      { to: "/studio", label: "Bot Studio", match: ["/studio"] },
      { to: "/groups", label: "Groups", match: ["/groups"] },
      { to: "/workforce", label: "Workforce", match: ["/workforce"] },
    ],
  },
  {
    to: "/workflows",
    label: "Workflows",
    icon: "workflow",
    match: ["/workflows", "/automation", "/decisions", "/projects"],
    primary: true,
    tabs: [
      { to: "/workflows", label: "Workflow Studio", match: ["/workflows"] },
      { to: "/automation", label: "Schedules", match: ["/automation"] },
      { to: "/decisions", label: "Decisions", match: ["/decisions"] },
      { to: "/projects", label: "Projects", match: ["/projects"] },
    ],
  },
  {
    to: "/models",
    label: "AI Models",
    icon: "cpu",
    match: ["/models", "/settings/ai-models", "/usage"],
    primary: false,
    tabs: [{ to: "/models", label: "Providers & models", match: ["/models", "/settings/ai-models", "/usage"] }],
  },
  {
    to: "/integrations",
    label: "Apps & Integrations",
    icon: "plug",
    match: ["/integrations", "/pc", "/access", "/business"],
    primary: false,
    tabs: [
      { to: "/integrations", label: "Integrations Center", match: ["/integrations"] },
      { to: "/pc", label: "PC Control Center", match: ["/pc"] },
      { to: "/access", label: "Access", match: ["/access"] },
      { to: "/business", label: "Business Workforce", match: ["/business"] },
    ],
  },
  { to: "/creative", label: "Creative Studio", icon: "palette", match: ["/creative"], primary: false, tabs: [] },
  {
    to: "/knowledge",
    label: "Knowledge Center",
    icon: "book",
    match: ["/knowledge"],
    primary: false,
    tabs: [{ to: "/knowledge", label: "Shared notes", match: ["/knowledge"] }],
  },
  {
    to: "/monitor",
    label: "Monitoring",
    icon: "activity",
    match: ["/monitor", "/tasks", "/approvals", "/inbox"],
    primary: true,
    tabs: [
      { to: "/monitor", label: "Activity & Logs", match: ["/monitor"] },
      { to: "/tasks", label: "Tasks", match: ["/tasks"] },
      { to: "/approvals", label: "Approvals", match: ["/approvals"] },
      { to: "/inbox", label: "Inbox", match: ["/inbox"] },
    ],
  },
  { to: "/settings", label: "Settings", icon: "settings", match: ["/settings"], primary: false, tabs: [] },
];

const covers = (prefix: string, pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The section a path belongs to. The longest matching prefix wins, so /settings/ai-models is AI Models while the rest of /settings is Settings. */
export function sectionFor(pathname: string): NavEntry | undefined {
  if (pathname === "/") return NAV[0];
  let best: { entry: NavEntry; len: number } | undefined;
  for (const entry of NAV) {
    for (const m of entry.match) {
      if (covers(m, pathname) && (!best || m.length > best.len)) best = { entry, len: m.length };
    }
  }
  return best?.entry;
}

export function isActive(entry: NavEntry, pathname: string): boolean {
  return sectionFor(pathname) === entry;
}

export function tabFor(entry: NavEntry, pathname: string): NavTab | undefined {
  return entry.tabs.find((t) => t.match.some((m) => covers(m, pathname)));
}
