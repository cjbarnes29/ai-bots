import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { TabPanel, Tabs } from "../components/ui/Tabs";

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

type TabId = "overview" | "documents" | "drafting" | "media";
const TAB_LABEL: Record<TabId, string> = { overview: "Overview", documents: "Documents", drafting: "Content drafting", media: "Image, video & audio" };

function Steps({ title, steps }: { title: string; steps: { text: string; to?: string; link?: string }[] }) {
  return (
    <section aria-label={title} className="card space-y-3">
      <h2 className="font-semibold">{title}</h2>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        {steps.map((s) => (
          <li key={s.text}>
            {s.text}
            {s.to && (
              <>
                {" "}
                <Link to={s.to} className="underline">
                  {s.link}
                </Link>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function AreaCards({ areas }: { areas: Area[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {areas.map((a, i) => (
        <li key={a.title} className="card awp-lift awp-stagger flex flex-col gap-3" style={{ "--i": i } as CSSProperties}>
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
  );
}

export function Creative() {
  const [tab, setTab] = useState<TabId>("overview");
  const media = AREAS.filter((a) => a.status === "not-connected");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Creative Studio</h1>
        <p className="hint">
          This workspace shows what can be created today and what is not connected yet. Nothing here pretends to work: a card without a button has no feature behind it.
        </p>
      </div>
      <Tabs label="Creative areas" value={tab} onChange={setTab} tabs={(Object.keys(TAB_LABEL) as TabId[]).map((id) => ({ id, label: TAB_LABEL[id] }))} />
      <TabPanel label={TAB_LABEL[tab]}>
        {tab === "overview" && <AreaCards areas={AREAS} />}
        {tab === "documents" && (
          <>
            <Steps
              title="Make a document today"
              steps={[
                { text: "Approve a folder the files may go in.", to: "/access", link: "Open Access" },
                { text: "On the agent's Permissions tab, switch on documents.", to: "/agents", link: "Open Agents" },
                { text: 'Ask the agent in its chat or give it a task, for example "Make a spreadsheet of these costs".' },
                { text: "The file is created only after you approve the request.", to: "/approvals", link: "Open Approvals" },
              ]}
            />
            <p className="hint">Formats: Word, PDF, Excel, CSV, PowerPoint, web page and SVG chart. There is no editor in this app; open the file in your own program.</p>
          </>
        )}
        {tab === "drafting" && (
          <Steps
            title="Draft content today"
            steps={[
              { text: "Create an agent with a role such as Writer.", to: "/agents", link: "Open Agents" },
              { text: "Put the work in a project so agents share notes and results.", to: "/projects", link: "Open Projects" },
              { text: "Give the agent a task; it uses a free model and saves the result in the project." },
              { text: "Keep what you like as a shared note.", to: "/knowledge", link: "Open Knowledge Center" },
            ]}
          />
        )}
        {tab === "media" && (
          <>
            <p className="hint">These three have no service behind them. Connecting one needs your approval first (free and verified services only; nothing is bought for you).</p>
            <AreaCards areas={media} />
          </>
        )}
      </TabPanel>
    </div>
  );
}
