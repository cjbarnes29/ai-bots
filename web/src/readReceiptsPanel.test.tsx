import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ResultCheck } from "./components/ResultCheck";
import { WorkflowResultCheck } from "./components/WorkflowResultCheck";
import userEvent from "@testing-library/user-event";

/** D-114: read receipts beside the task check, and the Manager origin wording in the workflow check. Fake fetch only. */
function stub(body: unknown) { vi.stubGlobal("fetch", (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch); }
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const base = { status: "not_applicable", summary: "Nothing to check.", evidence: 0, tasks: 1, checks: [] as unknown[] };
const receipt = { taskId: "t1", connector: "telegram", actionName: "read_messages", at: "2026-11-15T10:00:00.000Z", resultChars: 42 };

describe("task check: outside reads recorded", () => {
  it("shows the panel for a read-only task and says what a receipt does not prove", async () => {
    stub({ verification: { ...base, readReceipts: [receipt] } });
    render(<QueryClientProvider client={client()}><ResultCheck taskId="t1" finished /></QueryClientProvider>);
    expect(await screen.findByRole("region", { name: "Outside reads recorded" })).toBeInTheDocument();
    expect(screen.getByText(/telegram\.read_messages/)).toBeInTheDocument();
    expect(screen.getByText(/42 characters returned/)).toBeInTheDocument();
    expect(screen.getByText(/does not show the agent used what it read/)).toBeInTheDocument();
    expect(screen.queryByText("Confirmed by the platform")).not.toBeInTheDocument();
  });
  it("stays hidden when there is nothing to check and no read", async () => {
    stub({ verification: { ...base, readReceipts: [] } });
    render(<QueryClientProvider client={client()}><ResultCheck taskId="t1" finished /></QueryClientProvider>);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("region", { name: "Result check" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Outside reads recorded" })).not.toBeInTheDocument();
  });
  it("lists receipts next to a normal verdict without changing its label", async () => {
    stub({ verification: { ...base, status: "unverified", summary: "Finished.", readReceipts: [receipt, { ...receipt, actionName: "read_channel" }] } });
    render(<QueryClientProvider client={client()}><ResultCheck taskId="t1" finished /></QueryClientProvider>);
    expect(await screen.findByText("Not checked: the agent's own words")).toBeInTheDocument();
    expect(screen.getByText("Outside reads recorded (2)")).toBeInTheDocument();
  });
  it("works when an older server sends no receipts field", async () => {
    stub({ verification: { ...base, status: "unverified", summary: "Finished." } });
    render(<QueryClientProvider client={client()}><ResultCheck taskId="t1" finished /></QueryClientProvider>);
    expect(await screen.findByText("Not checked: the agent's own words")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Outside reads recorded" })).not.toBeInTheDocument();
  });
});

describe("workflow check: Manager origin wording", () => {
  const wf = (originLink?: "agreed" | "none" | "conflict") => ({ verification: { runId: "run", workflowId: "w", workflowVersion: 1, runStatus: "completed", checkedAt: "2026-11-15T10:00:00.000Z", coverageComplete: false,
    completion: { total: 2, completed: 2, failed: 0, skipped: 0, waiting: 0, pending: 0, running: 0 }, outputAssessment: { status: "unverified", summary: "Not verified." },
    supporting: { status: "unverified", summary: "Scoped.", evidence: 0, checks: [] },
    steps: [{ nodeId: "m", label: "Ask manager", type: "manager", status: "completed", binding: "unbound", reason: "Not inherited.", sourceKind: "manager", sourceId: "mgr-1", ...(originLink ? { originLink } : {}) }], sources: [], unlinkedAttempts: { total: 0, ids: [], truncated: false } } });
  const open = async (body: unknown) => { stub(body); render(<QueryClientProvider client={client()}><MemoryRouter><WorkflowResultCheck runId="run" runStatus="completed" /></MemoryRouter></QueryClientProvider>); await userEvent.click(screen.getByText("Workflow result check")); };
  it.each([
    ["agreed", /agreed both ways \(this box started it\)/],
    ["conflict", /conflicting or duplicated; not linked/],
    ["none", /none \(older run or not recorded\); not linked/],
  ] as const)("says %s in plain words and still states evidence is not inherited", async (link, pattern) => {
    await open(wf(link));
    expect(await screen.findByText(pattern)).toBeInTheDocument();
    expect(screen.getByText(/Its evidence is not inherited/)).toBeInTheDocument();
  });
  it("adds no origin sentence when the server does not report one", async () => {
    await open(wf());
    await screen.findByText(/Referenced Manager run: mgr-1/);
    expect(screen.queryByText(/Origin record/)).not.toBeInTheDocument();
  });
});
