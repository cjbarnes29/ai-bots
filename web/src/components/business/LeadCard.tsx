import { useState } from "react";
import { ApiError } from "../../api/client";
import { useUpdateLead } from "../../api/hooks";
import type { BusinessLead, LeadStatus } from "../../api/types";
import { ConfirmDialog } from "../ConfirmDialog";

/**
 * One lead. Three different website situations are shown with three different labels and styles, and a failed check is never shown
 * as a poor website: "no website listed" is unverified, "check failed" says nothing about quality, "checked" shows the audit score.
 */
const FAILURE_WORDS: Record<string, string> = {
  dns_failed: "name not found",
  timed_out: "took too long",
  connection_failed: "could not connect",
  tls_certificate_invalid: "certificate not valid",
  http_error: "error page",
  not_a_web_page: "not a web page",
  too_large: "page too large",
  blocked_address: "not a public website",
  bad_address: "bad address",
  redirect_loop: "too many redirects",
  limit_reached: "daily limit reached",
};

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  medium: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  low: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
};

export function websiteChip(l: BusinessLead): { text: string; style: string } {
  switch (l.website_state) {
    case "none_listed":
      return { text: "No website listed (unverified)", style: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" };
    case "confirmed_none":
      return { text: "Owner confirmed: no website", style: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200" };
    case "not_audited":
      return { text: "Website not checked yet", style: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200" };
    case "audited":
      return /^Placeholder or parked/.test(l.audit_summary)
        ? { text: "Placeholder or parked page", style: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" }
        : { text: `Website checked: ${l.audit_score ?? "?"}/100${l.audit_confidence === "low" ? " (low confidence)" : ""}`, style: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" };
    case "audit_failed":
      return { text: `Check failed (${FAILURE_WORDS[l.audit_failure] ?? "failed"}): not a quality verdict`, style: "border border-dashed border-slate-400 bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-200" };
  }
}

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  qualified: "Qualified",
  proposal_drafted: "Proposal drafted",
  contacted: "Contacted",
  won: "Won",
  lost: "Lost",
  discarded: "Discarded",
};

export function LeadCard({ lead: l, statuses }: { lead: BusinessLead; statuses: LeadStatus[] }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(l.notes);
  const [confirming, setConfirming] = useState(false);
  const update = useUpdateLead();
  const chip = websiteChip(l);
  const error = update.error instanceof ApiError ? update.error.friendly : update.error ? "That did not work." : null;
  const detailsId = `lead-${l.lead_id}`;

  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold [overflow-wrap:anywhere]">{l.business_name}</h3>
          {l.business_name_ar && (
            <p lang="ar" dir="rtl" className="text-sm text-slate-600 dark:text-slate-400">
              {l.business_name_ar}
            </p>
          )}
          <p className="hint">
            {[l.category, l.city || l.region].filter(Boolean).join(" · ")}
            {l.phone ? ` · ${l.phone}` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_STYLE[l.priority || "low"]}`}>
          {l.priority ? `${l.priority[0]!.toUpperCase()}${l.priority.slice(1)} priority` : "No score"} · {l.lead_score ?? "–"}
        </span>
      </div>

      <p>
        <span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${chip.style}`}>{chip.text}</span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Status for {l.business_name}</span>
          <select aria-label={`Status for ${l.business_name}`} className="w-auto" value={l.status} disabled={update.isPending} onChange={(e) => update.mutate({ id: l.lead_id, patch: { status: e.target.value as LeadStatus } })}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-secondary min-h-11" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide the score" : "Why this score?"}
        </button>
      </div>

      {open && (
        <div id={detailsId} className="space-y-3 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">How the score of {l.business_name} was made</caption>
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1 pr-2 font-medium">Reason</th>
                <th className="py-1 pr-2 font-medium">Points</th>
              </tr>
            </thead>
            <tbody>
              {l.criteria.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                  <td className="py-1 pr-2">
                    <span className="font-medium">{c.label}</span>
                    <span className="hint block">{c.evidence}</span>
                  </td>
                  <td className="whitespace-nowrap py-1 pr-2">
                    {c.points} of {c.max}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="font-medium">Total: {l.lead_score ?? "–"} of 100</p>
          {l.confidence === "unverified" && <p className="rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">No website is listed in the source. That is not proof that there is none: check by hand before contacting.</p>}
          {l.confidence === "needs_check" && <p className="rounded-md bg-slate-100 p-2 dark:bg-slate-800">The website could not be judged either way. Check it by hand.</p>}
          {l.audit_summary && <p>Website check: {l.audit_summary}</p>}
          {l.address && <p>Address: {l.address}</p>}
          {l.website_url && (
            <p className="[overflow-wrap:anywhere]">
              Website address: <span className="font-mono text-xs">{l.website_url}</span>
            </p>
          )}
          {l.source_url && (
            <p>
              <a href={l.source_url} target="_blank" rel="noopener noreferrer" className="underline">
                Open the map record
              </a>
            </p>
          )}

          <div className="space-y-2">
            <label className="label" htmlFor={`${detailsId}-notes`}>
              Your notes
            </label>
            <textarea id={`${detailsId}-notes`} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary min-h-11" disabled={notes === l.notes || update.isPending} onClick={() => update.mutate({ id: l.lead_id, patch: { notes } })}>
                Save notes
              </button>
              {l.website_state === "none_listed" && !l.website_url && (
                <button type="button" className="btn-secondary min-h-11" onClick={() => setConfirming(true)}>
                  Confirm there is no website
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          title="Confirm there is no website?"
          confirmLabel="Yes, I checked: no website"
          busy={update.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => update.mutate({ id: l.lead_id, patch: { confirmNoWebsite: true } }, { onSettled: () => setConfirming(false) })}
        >
          <p>Only confirm this after you checked by hand, for example with a web search, that {l.business_name} really has no website. The score goes up when you confirm it.</p>
        </ConfirmDialog>
      )}
    </li>
  );
}
