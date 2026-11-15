import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerResultCheck } from "./components/ManagerResultCheck";
import type { ManagerVerificationView } from "./api/verificationHooks";

function result(status: ManagerVerificationView["supporting"]["status"] = "verified"): ManagerVerificationView {
  return { runId: "run", runStatus: "completed", checkedAt: "2026-11-15T10:00:00.000Z", completion: { total: 2, completed: 1, pending: 0, running: 0, failed: 0, skipped: 1 }, coverageComplete: true,
    finalSummary: { status: "unverified", summary: "Helper evidence does not verify the final summary." }, supporting: { status, summary: "Synthetic helper evidence only.", evidence: 1, checks: [{ kind: "action_executed", outcome: "pass", detail: "Synthetic action ran." }] },
    steps: [{ id: "s1", status: "completed", binding: "valid", reason: "Linked specialist evidence.", taskId: "task" }, { id: "s2", status: "skipped", binding: "missing", reason: "The specialist task record is missing." }], chains: [] };
}
const clients: QueryClient[] = [];
afterEach(() => { clients.forEach(c => c.clear()); clients.length = 0; vi.useRealTimers(); });
function setup(body = result()) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ verification: body }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><ManagerResultCheck runId="run" runStatus="completed" /></MemoryRouter></QueryClientProvider>);
  return { fetcher, client };
}

describe("Manager evidence panel", () => {
  it("does no check while closed and fetches only on opening", async () => {
    const { fetcher } = setup(); expect(fetcher).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Manager result check"));
    expect(await screen.findByText("Helper evidence: Confirmed by the platform")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0]?.[0]).toBe("/api/manager/runs/run/verification");
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
  });
  it("separates summary truth, helper evidence and completion with valid task links", async () => {
    setup(); await userEvent.click(screen.getByText("Manager result check"));
    expect(await screen.findByRole("heading", { name: "Final summary: Not independently verified" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 steps completed. Run state: completed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View helper task" })).toHaveAttribute("href", "/tasks/task");
    expect(screen.getByText(/Step s2/)).toBeInTheDocument();
    expect(screen.getByText(/The specialist task record is missing/)).toBeInTheDocument();
    expect(screen.getByText(/Checked at/)).toBeInTheDocument();
  });
  it.each(["waiting", "contradicted", "unverified"] as const)("shows the %s helper state without claiming the final is confirmed", async status => {
    setup(result(status)); await userEvent.click(screen.getByText("Manager result check"));
    await screen.findByRole("heading", { name: "Final summary: Not independently verified" });
    expect(screen.queryByText("Helper evidence: Confirmed by the platform")).not.toBeInTheDocument();
    expect(screen.getByText(status === "waiting" ? "Helper evidence: Waiting for your approval" : status === "contradicted" ? "Helper evidence: Contradicted: do not rely on it" : "Helper evidence: Not fully verified")).toBeInTheDocument();
  });
  it("discloses incomplete coverage and keeps details accessible", async () => {
    const body = result("unverified"); body.coverageComplete = false;
    setup(body); await userEvent.click(screen.getByText("Manager result check"));
    expect(await screen.findByText("Coverage is incomplete; some records could not be checked.")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Helper evidence details (1)"));
    expect(screen.getByText("Synthetic action ran.")).toBeVisible();
  });
  it("shows a loading state before evidence arrives", async () => {
    const { fetcher } = setup(); let resolve!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await userEvent.click(screen.getByText("Manager result check"));
    expect(screen.getByText("Checking saved helper evidence…")).toBeInTheDocument();
    expect(screen.queryByText("Helper evidence: Confirmed by the platform")).not.toBeInTheDocument();
    await act(async () => resolve(new Response(JSON.stringify({ verification: result() }))));
    await screen.findByText("Helper evidence: Confirmed by the platform");
  });
  it("shows unavailable on an initial failure and allows a read-only retry", async () => {
    const { fetcher } = setup(); fetcher.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await userEvent.click(screen.getByText("Manager result check"));
    expect(await screen.findByText(/Check unavailable/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh check" }));
    await screen.findByText("Helper evidence: Confirmed by the platform");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("hides cached confirmation during refresh and after a failed refresh", async () => {
    const { fetcher } = setup(); await userEvent.click(screen.getByText("Manager result check"));
    await screen.findByText("Helper evidence: Confirmed by the platform");
    let resolve!: (value: Response) => void; fetcher.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await userEvent.click(screen.getByRole("button", { name: "Refresh check" }));
    expect(await screen.findByText(/Refreshing check; previous evidence/)).toBeInTheDocument();
    expect(screen.queryByText("Helper evidence: Confirmed by the platform")).not.toBeInTheDocument();
    await act(async () => resolve(new Response("{}", { status: 503 })));
    await screen.findByText(/Check unavailable/);
    expect(screen.queryByText("Helper evidence: Confirmed by the platform")).not.toBeInTheDocument();
  });
  it("refreshes while open and stops polling when closed", async () => {
    vi.useFakeTimers(); const { fetcher } = setup();
    const details = screen.getByText("Manager result check").closest("details")!;
    await act(async () => { details.open = true; fireEvent(details, new Event("toggle")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { details.open = false; fireEvent(details, new Event("toggle")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("region", { name: "Manager result check" })).not.toBeInTheDocument();
  });
  it("does not add approval/action controls when opened", async () => {
    setup(); await userEvent.click(screen.getByText("Manager result check"));
    await screen.findByRole("button", { name: "Refresh check" });
    expect(screen.queryByRole("button", { name: /approve|send|retry action/i })).not.toBeInTheDocument();
  });
});
