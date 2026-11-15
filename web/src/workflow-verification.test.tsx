import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowResultCheck } from "./components/WorkflowResultCheck";
import type { WorkflowVerificationView } from "./api/verificationHooks";

function result(status: WorkflowVerificationView["supporting"]["status"] = "verified"): WorkflowVerificationView {
  return { runId: "run", workflowId: "workflow", workflowVersion: 3, runStatus: "completed", checkedAt: "2026-11-15T10:00:00.000Z", coverageComplete: true,
    completion: { total: 3, completed: 2, failed: 0, skipped: 1, waiting: 0, pending: 0, running: 0 },
    outputAssessment: { status: "unverified", summary: "Recorded steps do not verify the workflow output." }, supporting: { status, summary: "Synthetic scoped evidence.", evidence: 1, checks: [] },
    steps: [{ nodeId: "task", label: "Helper step", type: "bot_task", status: "completed", binding: "valid", reason: "Bound task evidence.", sourceKind: "task", sourceId: "task-id" },
      { nodeId: "act", label: "Outside action", type: "integration", status: "completed", binding: "valid", reason: "Bound approval.", sourceKind: "approval", sourceId: "approval-id" }],
    sources: [{ kind: "approval", id: "approval-id", verification: { status, evidence: 1, summary: "Recorded execution only.", checks: [{ kind: "action_executed", outcome: "pass", detail: "An approved action has a recorded execution." }] } }], unlinkedAttempts: { total: 0, ids: [], truncated: false } };
}
const clients: QueryClient[] = [];
afterEach(() => { clients.forEach(c => c.clear()); clients.length = 0; vi.useRealTimers(); });
function setup(body = result()) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ verification: body }), { status: 200 })); vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><WorkflowResultCheck runId="run" runStatus="completed" /></MemoryRouter></QueryClientProvider>);
  return { fetcher, client };
}
const open = () => userEvent.click(screen.getByText("Workflow result check"));
describe("Workflow result check", () => {
  it("fetches only on opening and keeps output separate from recorded step evidence", async () => {
    const { fetcher } = setup(); expect(fetcher).not.toHaveBeenCalled(); await open();
    await screen.findByText("Recorded step evidence: Confirmed within the recorded scope");
    expect(screen.getByRole("heading", { name: "Workflow output: Not independently verified" })).toBeInTheDocument();
    expect(screen.getByText("2 of 3 steps completed; 1 skipped, 0 failed, 0 waiting.")).toBeInTheDocument();
    expect(screen.getByText("Saved version 3 · Run state: completed.")).toBeInTheDocument();
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/workflows/runs/run/verification"); expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
  });
  it("links valid task/approval records and shows check time and evidence scope", async () => {
    setup(); await open(); await screen.findByText("Synthetic scoped evidence.");
    expect(screen.getByRole("link", { name: "View task evidence" })).toHaveAttribute("href", "/tasks/task-id");
    expect(screen.getByRole("link", { name: "View approval record" })).toHaveAttribute("href", "/approvals?focus=approval-id");
    expect(screen.getByText(/Checked at/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Recorded evidence details (1)")); expect(screen.getByText("An approved action has a recorded execution.")).toBeVisible();
  });
  it.each(["waiting", "unverified", "contradicted", "not_applicable"] as const)("keeps the %s state truthful", async status => {
    setup(result(status)); await open(); await screen.findByText("Synthetic scoped evidence.");
    expect(screen.queryByText("Recorded step evidence: Confirmed within the recorded scope")).not.toBeInTheDocument();
    expect(screen.getByText("Workflow output: Not independently verified")).toBeInTheDocument();
  });
  it("does not turn invalid or Manager-unbound references into proof links", async () => {
    const body = result("unverified"); body.coverageComplete = false;
    body.steps[0]!.binding = "invalid"; body.steps[1] = { nodeId: "manager", label: "Manager step", type: "manager", status: "completed", binding: "unbound", sourceKind: "manager", sourceId: "manager-id", reason: "No exact workflow backlink." };
    setup(body); await open(); await screen.findByText("Coverage is incomplete; some records or links could not be checked.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument(); expect(screen.getByText(/Its evidence is not inherited/)).toBeInTheDocument();
  });
  it("discloses unlinked prior attempts without confirming them", async () => {
    const body = result("unverified"); body.unlinkedAttempts = { total: 30, ids: ["old-task"], truncated: true };
    setup(body); await open(); expect(await screen.findByText(/30 earlier or unlinked task attempt/)).toHaveTextContent("Only a limited list was inspected.");
  });
  it("shows loading before the first result and no old confirmation during a refresh", async () => {
    const { fetcher } = setup(); let resolve!: (r: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(r => { resolve = r; })); await open();
    expect(screen.getByText("Checking saved workflow evidence…")).toBeInTheDocument();
    await act(async () => resolve(new Response(JSON.stringify({ verification: result() }))));
    await screen.findByText("Recorded step evidence: Confirmed within the recorded scope");
    fetcher.mockImplementationOnce(() => new Promise(r => { resolve = r; })); await userEvent.click(screen.getByRole("button", { name: "Refresh check" }));
    await screen.findByText(/Refreshing check; previous evidence/);
    expect(screen.queryByText("Recorded step evidence: Confirmed within the recorded scope")).not.toBeInTheDocument();
    await act(async () => resolve(new Response("{}", { status: 503 })));
    await screen.findByText(/Check unavailable/); expect(screen.queryByText("Recorded step evidence: Confirmed within the recorded scope")).not.toBeInTheDocument();
  });
  it("shows unavailable after an initial failure and recovers through a read-only retry", async () => {
    const { fetcher } = setup(); fetcher.mockResolvedValueOnce(new Response("{}", { status: 503 })); await open(); await screen.findByText(/Check unavailable/);
    await userEvent.click(screen.getByRole("button", { name: "Refresh check" })); await screen.findByText("Synthetic scoped evidence."); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("polls only while open", async () => {
    vi.useFakeTimers(); const { fetcher } = setup(); const details = screen.getByText("Workflow result check").closest("details")!;
    await act(async () => { details.open = true; fireEvent(details, new Event("toggle")); await vi.advanceTimersByTimeAsync(50); });
    expect(fetcher).toHaveBeenCalledTimes(1); await act(async () => { await vi.advanceTimersByTimeAsync(10_100); }); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { details.open = false; fireEvent(details, new Event("toggle")); await vi.advanceTimersByTimeAsync(20_000); }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("adds no run, retry, approval or send controls", async () => {
    setup(); await open(); await screen.findByText("Synthetic scoped evidence.");
    expect(screen.getAllByRole("button").map(b => b.textContent)).toEqual(["Refresh check"]);
  });
});
