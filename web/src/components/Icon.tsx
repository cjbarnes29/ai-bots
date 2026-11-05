/** A small set of line icons, drawn here so no icon library is needed. Decorative: the text next to them carries the meaning. */
const PATHS = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
  agents: "M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2 M10 11a4 4 0 100-8 4 4 0 000 8z M21 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75",
  workflow: "M4 4h6v6H4z M14 14h6v6h-6z M10 7h4a3 3 0 013 3v4",
  plug: "M9 2v6 M15 2v6 M6 8h12v4a6 6 0 01-12 0z M12 18v4",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v5l3 2",
  approvals: "M12 21a9 9 0 100-18 9 9 0 000 18z M8 12l3 3 5-6",
  pc: "M3 4h18v12H3z M8 20h8 M12 16v4",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  settings: "M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M20 18h0 M16 4v4 M10 10v4 M18 16v4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4",
  briefcase: "M3 8h18v12H3z M8 8V5a2 2 0 012-2h4a2 2 0 012 2v3 M3 13h18",
  more: "M5 12h0 M12 12h0 M19 12h0",
  close: "M6 6l12 12 M18 6L6 18",
  back: "M15 18l-6-6 6-6",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16z M21 21l-4.3-4.3",
  next: "M9 18l6-6-6-6",
  cpu: "M6 6h12v12H6z M9 9h6v6H9z M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4",
  palette: "M12 3a9 9 0 100 18c1.5 0 2-1 2-2 0-1.5-1-1.5-1-3s1-2 2.5-2H18a3 3 0 003-3c0-4.4-4-8-9-8z M7.5 11h0 M10 7.5h0 M14.5 7.5h0",
  book: "M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4z M20 4h-6a3 3 0 00-3 3v13a2 2 0 012-2h7z",
  sidebar: "M3 4h18v16H3z M9 4v16",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
