import type { FreeStatus } from "../api/types";

export const FREE_LABELS: Record<FreeStatus, string> = {
  verified_free: "Verified free",
  free_tier: "Free tier",
  blocked: "Blocked (paid)",
};

const STYLES: Record<FreeStatus, string> = {
  verified_free: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  free_tier: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  blocked: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export function FreeBadge({ status }: { status: FreeStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>{FREE_LABELS[status]}</span>;
}
