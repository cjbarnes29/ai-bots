import { useState } from "react";
import { ApplicationsPanel } from "../components/access/ApplicationsPanel";
import { DesktopPanel } from "../components/access/DesktopPanel";
import { FoldersPanel } from "../components/access/FoldersPanel";

type Tab = "folders" | "applications" | "desktop";

/**
 * Access: the two separate questions "may the AI use this program?" and "may the AI touch this folder?". Approving one never approves the other.
 */
export function Access() {
  const [tab, setTab] = useState<Tab>("folders");
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Access</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Two separate questions. <strong>Folders:</strong> which places on this PC may the AI Workforce read or change? <strong>Applications:</strong> which programs may
          it open or operate? Everything is off until you say yes, you can take any approval back at once, and every decision is recorded. Changes need your owner passphrase
          when the Guardian is running.
        </p>
      </div>
      <div role="tablist" aria-label="Access" className="flex gap-2">
        {(["folders", "applications", "desktop"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "btn-primary" : "btn-secondary"} onClick={() => setTab(t)}>
            {t === "folders" ? "Folders" : t === "applications" ? "Applications" : "Desktop control"}
          </button>
        ))}
      </div>
      {tab === "folders" ? <FoldersPanel /> : tab === "applications" ? <ApplicationsPanel /> : <DesktopPanel />}
    </div>
  );
}
