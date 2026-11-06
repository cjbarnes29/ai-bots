import type { Level } from "../../lib/interfaceLevel";
import type { IconName } from "../Icon";

export interface NavTab {
  to: string;
  label: string;
  /** Path prefixes that keep this tab highlighted (a task page still belongs to the Tasks tab). */
  match: string[];
}

/**
 * The seven headings the menu is grouped under (owner decision 2026-11-06). They are captions only: every one of the 12 entries below still exists,
 * keeps its address, its level and its tabs, and a heading is shown only when at least one of its entries is listed at the current interface level.
 * The order of the entries did not change (the AI Assistant stays first, D-077), so each heading covers a run of neighbouring entries.
 */
export const HEADINGS = [
  { id: "assistant", label: "Global Assistant" },
  { id: "inbox", label: "Inbox" },
  { id: "projects", label: "Projects" },
  { id: "workflow", label: "Workflow Studio" },
  { id: "business", label: "Business Workforce" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
] as const;
export type HeadingId = (typeof HEADINGS)[number]["id"];
export const headingLabel = (id: HeadingId): string => HEADINGS.find((h) => h.id === id)!.label;

export interface NavEntry {
  /** The heading this entry is listed under. */
  heading: HeadingId;
  to: string;
  label: string;
  icon: IconName;
  /** Path prefixes that keep this section highlighted. The longest matching prefix across all sections wins. */
  match: string[];
  /** The lowest interface level at which this section is listed in the menu (D-079). It is never removed: its address, search and the assistant still reach it. */
  level: Level;
  /** Shown in the phone's bottom bar. Everything else is under "More" there. */
  primary: boolean;
  /** The pages that belong to this section. Every page that existed before the redesign is still reachable at its old address. */
  tabs: NavTab[];
}

/**
 * The one list the sidebar, the tablet rail, the phone bar, the "More" sheet, the section tabs and the breadcrumbs are all drawn from.
 * Grouped by the owner (D-075), then corrected by D-077: the AI Assistant is the first item and its own workspace; Projects, Tasks & history and Decisions & approvals are their own items. No route was removed or renamed, only grouped.
 */
export const NAV: NavEntry[] = [
  // The main entry point: a permanent chat workspace, never a panel inside another section.
  { heading: "assistant", to: "/assistant", label: "AI Assistant", level: "simple", icon: "chat", match: ["/assistant"], primary: true, tabs: [] },
  { heading: "inbox", to: "/", label: "Dashboard", level: "simple", icon: "dashboard", match: [], primary: true, tabs: [] },
  { heading: "projects", to: "/projects", label: "Projects", level: "simple", icon: "briefcase", match: ["/projects"], primary: true, tabs: [] },
  {
    heading: "workflow", to: "/workflows",
    label: "Workflows", level: "intermediate",
    icon: "workflow",
    match: ["/workflows", "/automation"],
    primary: false,
    tabs: [
      { to: "/workflows", label: "Workflow Studio", match: ["/workflows"] },
      { to: "/automation", label: "Schedules", match: ["/automation"] },
    ],
  },
  {
    heading: "business", to: "/agents",
    label: "AI Agents", level: "intermediate",
    icon: "agents",
    match: ["/agents", "/bots", "/studio", "/groups", "/workforce"],
    primary: false,
    tabs: [
      { to: "/agents", label: "Agents & Teams", match: ["/agents", "/bots"] },
      { to: "/studio", label: "Bot Studio", match: ["/studio"] },
      { to: "/groups", label: "Groups", match: ["/groups"] },
      { to: "/workforce", label: "Workforce", match: ["/workforce"] },
    ],
  },
  {
    heading: "business", to: "/knowledge",
    label: "Knowledge Center", level: "intermediate",
    icon: "book",
    match: ["/knowledge"],
    primary: false,
    tabs: [{ to: "/knowledge", label: "Shared notes", match: ["/knowledge"] }],
  },
  {
    heading: "activity", to: "/tasks",
    label: "Tasks & history", level: "intermediate",
    icon: "activity",
    match: ["/tasks", "/monitor", "/inbox"],
    primary: false,
    tabs: [
      { to: "/tasks", label: "Tasks", match: ["/tasks"] },
      { to: "/monitor", label: "Activity & Logs", match: ["/monitor"] },
      { to: "/inbox", label: "Inbox", match: ["/inbox"] },
    ],
  },
  {
    heading: "activity", to: "/approvals",
    label: "Decisions & approvals", level: "simple",
    icon: "approvals",
    match: ["/approvals", "/decisions"],
    primary: true,
    tabs: [
      { to: "/approvals", label: "Approvals", match: ["/approvals"] },
      { to: "/decisions", label: "Decisions", match: ["/decisions"] },
    ],
  },
  {
    heading: "settings", to: "/models",
    label: "AI Models", level: "advanced",
    icon: "cpu",
    match: ["/models", "/settings/ai-models", "/usage"],
    primary: false,
    tabs: [{ to: "/models", label: "Providers & models", match: ["/models", "/settings/ai-models", "/usage"] }],
  },
  {
    heading: "settings", to: "/integrations",
    label: "Apps & Integrations", level: "advanced",
    icon: "plug",
    match: ["/integrations", "/pc", "/access", "/business", "/capabilities"],
    primary: false,
    tabs: [
      { to: "/integrations", label: "Integrations Center", match: ["/integrations"] },
      { to: "/pc", label: "PC Control Center", match: ["/pc"] },
      { to: "/capabilities", label: "Capabilities", match: ["/capabilities"] },
      { to: "/access", label: "Access", match: ["/access"] },
      { to: "/business", label: "Business Workforce", match: ["/business"] },
    ],
  },
  { heading: "settings", to: "/creative", label: "Creative Studio", level: "advanced", icon: "palette", match: ["/creative"], primary: false, tabs: [] },
  { heading: "settings", to: "/settings", label: "Settings", level: "advanced", icon: "settings", match: ["/settings"], primary: false, tabs: [] },
];

const covers = (prefix: string, pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The section a path belongs to. The longest matching prefix wins, so /settings/ai-models is AI Models while the rest of /settings is Settings. */
export function sectionFor(pathname: string): NavEntry | undefined {
  if (pathname === "/") return NAV.find((e) => e.to === "/");
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
