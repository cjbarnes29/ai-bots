import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";

type Status = "available" | "partial" | "not-connected";

interface Area {
  title: string;
  icon: IconName;
  status: Status;
  text: string;
  link?: { to: string; label: string };
}

const BADGE: Record<Status, { text: string; style: string }> = {
  available: { text: "Works today", style: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  partial: { text: "Partly works", style: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  "not-connected": { text: "Not connected", style: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

/**
 * Only what the backend really does is marked as working. Image, video and audio need a service that is free, verified and approved by
 * the owner; none is connected (docs/PROGRESS.md), and there is no FFmpeg on this PC. So those cards say so and have no button.
 */
const AREAS: Area[] = [
  {
    title: "Documents and charts",
    icon: "book",
    status: "partial",
    text: "A bot with the document permission can write Word, PDF, Excel, CSV, PowerPoint, web pages and SVG charts into a folder you have allowed. Each file goes through the folder gate and your approval. There is no editor here yet: you ask the bot in its chat or in a task.",
    link: { to: "/agents", label: "Open Agents" },
  },
  {
    title: "Content drafting",
    icon: "agents",
    status: "available",
    text: "Scripts, captions, outlines and posts written by your bots with free models, saved as notes or project results. Nothing is published anywhere without your approval.",
    link: { to: "/projects", label: "Open Projects" },
  },
  {
    title: "Image generation",
    icon: "palette",
    status: "not-connected",
    text: "No image service is connected. A free, verified service would need your approval first.",
  },
  {
    title: "Video editing",
    icon: "workflow",
    status: "not-connected",
    text: "No video editor or renderer is connected, and this PC has no FFmpeg. Installing one needs your separate approval.",
  },
  {
    title: "Audio and music",
    icon: "activity",
    status: "not-connected",
    text: "No audio or music service is connected. Windows speech was chosen as the first option for later (decision D-016), not yet built.",
  },
  {
    title: "Creative automation",
    icon: "clock",
    status: "partial",
    text: "Workflows and schedules can run drafting tasks on a timetable. They can only use the parts above that work today.",
    link: { to: "/workflows", label: "Open Workflows" },
  },
];

export function Creative() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Creative Studio</h1>
        <p className="hint">
          This workspace shows what can be created today and what is not connected yet. Nothing here pretends to work: a card without a button has no feature behind it.
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {AREAS.map((a) => (
          <li key={a.title} className="card awp-lift flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <span className="flex items-center gap-2 font-semibold">
                <Icon name={a.icon} className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
                {a.title}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[a.status].style}`}>{BADGE[a.status].text}</span>
            </div>
            <p className="flex-1 text-sm text-slate-600 dark:text-slate-400">{a.text}</p>
            {a.link && (
              <Link to={a.link.to} className="btn-secondary self-start">
                {a.link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
