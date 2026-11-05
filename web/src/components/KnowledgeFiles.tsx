import { Link } from "react-router-dom";

const AREAS = [
  {
    title: "Folders your agents may use",
    text: "An agent can read or write a file only inside a folder you approved, and only with the right permission (read, create, edit). Everything else is refused. Approving a program never approves a folder.",
    to: "/access",
    action: "Open Access",
  },
  {
    title: "Project files and results",
    text: "Each project keeps its notes, handovers, results and the files its agents were allowed to read or create, in one shared workspace. It is a view over notes, approvals and tasks, and grants nothing.",
    to: "/projects",
    action: "Open Projects",
  },
  {
    title: "Documents agents can write",
    text: "Word, PDF, Excel, CSV, PowerPoint, web pages and charts. Each file is created only in an approved folder and only after you approve it.",
    to: "/creative",
    action: "Open Creative Studio",
  },
];

/** Where files and documents live. This app does not list or browse files on your PC, so nothing here pretends to; each card points to the place that really handles it. */
export function KnowledgeFiles() {
  return (
    <section aria-label="Files and documents" className="space-y-3">
      <p className="hint">There is no file browser here: the app never lists files on your PC. Files are reached through the folder gate, in the places below.</p>
      <ul className="grid gap-4 md:grid-cols-3">
        {AREAS.map((a, i) => (
          <li key={a.title} className="card awp-lift awp-stagger flex flex-col gap-3" style={{ "--i": i } as React.CSSProperties}>
            <h2 className="font-semibold">{a.title}</h2>
            <p className="flex-1 text-sm text-slate-600 dark:text-slate-400">{a.text}</p>
            <Link to={a.to} className="btn-secondary self-start">
              {a.action}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
