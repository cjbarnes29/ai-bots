import type { IconName } from "../Icon";

export interface NavEntry {
  to: string;
  label: string;
  icon: IconName;
  /** Path prefixes that keep this entry highlighted (a task page still belongs to Activity & Logs). */
  match: string[];
  /** Shown in the phone's bottom bar. Everything else is under "More" there. */
  primary: boolean;
}

/** The one list the sidebar, the tablet rail, the phone bar and the "More" sheet are all drawn from. */
export const NAV: NavEntry[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", match: [], primary: true },
  { to: "/agents", label: "Agents & Teams", icon: "agents", match: ["/agents", "/bots", "/knowledge"], primary: true },
  { to: "/workflows", label: "Workflow Studio", icon: "workflow", match: ["/workflows"], primary: true },
  { to: "/approvals", label: "Approvals", icon: "approvals", match: ["/approvals"], primary: true },
  { to: "/integrations", label: "Integrations Center", icon: "plug", match: ["/integrations"], primary: false },
  { to: "/automation", label: "Schedules", icon: "clock", match: ["/automation"], primary: false },
  { to: "/pc", label: "PC Control Center", icon: "pc", match: ["/pc"], primary: false },
  { to: "/monitor", label: "Activity & Logs", icon: "activity", match: ["/monitor", "/tasks"], primary: false },
  { to: "/settings", label: "Settings", icon: "settings", match: ["/settings", "/usage"], primary: false },
];

export function isActive(entry: NavEntry, pathname: string): boolean {
  if (entry.to === "/") return pathname === "/";
  return entry.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
