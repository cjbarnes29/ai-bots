import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";
import type { Approval } from "./api/types";
import { QueryStatus } from "./components/ui/QueryStatus";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function mount(path: string, api: ReturnType<typeof createFakeApi>, override?: (url: URL) => Response | null) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    return override?.(url) ?? api.fetch(input, init);
  });
  vi.stubGlobal("fetch", fetch);
  const q = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={q}><RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} /></QueryClientProvider>);
  return Object.assign(fetch, { queryClient: q });
}
const request = (id = crypto.randomUUID()): Approval => ({ id, botId: "b1", botName: "Synthetic helper", taskId: null, connector: "telegram", connectorLabel: "Telegram", action: "send_message", summary: "Synthetic older request", args: { chat: "1234", text: "مرحبا — sample\n" + "longword".repeat(60) }, status: "pending", result: null, error: null, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), decidedAt: null, decidedBy: null, executedAt: null });

describe("honest query states", () => {
  it("shows cached data as stale after a refresh failure", () => {
    render(<QueryStatus query={{ data: [], isPending: false, isError: true, dataUpdatedAt: 1000 }} label="requests" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Showing the last available data");
  });
  it("distinguishes loading from failed initial reads", () => {
    const view = render(<QueryStatus query={{ data: undefined, isPending: true, isError: false, dataUpdatedAt: 0 }} label="requests" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading requests");
    view.rerender(<QueryStatus query={{ data: undefined, isPending: false, isError: true, dataUpdatedAt: 0 }} label="requests" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load requests");
  });
  it("does not call failed approval/history/audit reads empty", async () => {
    mount("/approvals", createFakeApi(), url => ["/api/approvals", "/api/audit", "/api/external/status"].includes(url.pathname) ? json({ error: "synthetic_unavailable", message: "Synthetic outage" }, 503) : null);
    expect(await screen.findByText(/Status unavailable: outside-action/)).toBeInTheDocument();
    expect(screen.queryByText("Nothing is waiting for approval.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing decided/)).not.toBeInTheDocument();
    expect(screen.queryByText("Outside actions are allowed (each write still needs your approval).")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause all outside actions" })).toBeDisabled();
  });
  it("does not show an all-clear on a failed workflow source", async () => {
    mount("/", createFakeApi([makeBot()]), url => url.pathname === "/api/workflows" ? json({ error: "synthetic_outage", message: "Synthetic" }, 503) : null);
    expect(await screen.findByText(/Could not load recent workflows/)).toBeInTheDocument();
    expect(screen.queryByText(/Everything looks fine/)).not.toBeInTheDocument();
  });
  it("does not keep an empty workflow success message after a failed refresh", async () => {
    let failed = false;
    const f = mount("/", createFakeApi([makeBot()]), url => url.pathname === "/api/workflows" ? failed ? json({ error: "synthetic_outage", message: "Synthetic" }, 503) : json({ workflows: [], waiting: [], runs: [], limits: {} }) : null);
    await screen.findByText("No workflow has run yet.");
    failed = true;
    await act(async () => { await f.queryClient.refetchQueries({ queryKey: ["workflows"] }); });
    expect(await screen.findByText(/Could not load recent workflows/)).toBeInTheDocument();
    expect(screen.queryByText("No workflow has run yet.")).not.toBeInTheDocument();
  });
  it("keeps sampled workflow failures out of the server-wide failure metric", async () => {
    const api = createFakeApi([makeBot()]);
    api.ext.monitor.tasks.failed24h = 2;
    api.ext.monitor.approvals.failed24h = 3;
    mount("/", api, url => url.pathname === "/api/workflows" ? json({ workflows: [], waiting: [], runs: [], limits: {} }) : null);
    const card = (await screen.findByText("Failures (24 h)")).closest("a")!;
    expect(await within(card).findByText("5")).toBeInTheDocument();
    expect(within(card).getByText(/sampled workflows shown separately/)).toBeInTheDocument();
    expect(screen.getByText(/Among latest 0 runs/)).toBeInTheDocument();
  });
});

describe("capped approval lists and focused reads", () => {
  it("fetches an unloaded focused request once and uses the existing decision path", async () => {
    const api = createFakeApi();
    const r = request(); api.ext.approvals.push(r);
    const fetch = mount(`/approvals?focus=${r.id}`, api, url => url.pathname === "/api/approvals" ? json({ approvals: [] }) : null);
    const card = await screen.findByRole("listitem", { name: "Approval request: Synthetic older request" });
    expect(screen.getAllByRole("listitem", { name: /Approval request:/ })).toHaveLength(1);
    expect(screen.getByText(/Showing 0 latest requests; 1 waiting in total/)).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith(`/api/approvals/${r.id}`))).toBe(true);
    await userEvent.click(within(card).getByRole("button", { name: "Approve…" }));
    expect(api.writes()).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.writes()).toHaveLength(0);
    await userEvent.click(within(card).getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(r.status).toBe("denied"));
    expect(api.writes().filter(w => w.path.endsWith("/deny"))).toHaveLength(1);
    expect(api.writes().filter(w => w.path.endsWith("/approve"))).toHaveLength(0);
  });
  it("does not refetch a focus already in a loaded list", async () => {
    const api = createFakeApi(); const r = request(); api.ext.approvals.push(r);
    const fetch = mount(`/approvals?focus=${r.id}`, api);
    await screen.findByRole("listitem", { name: /Approval request:/ });
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith(`/api/approvals/${r.id}`))).toBe(false);
  });
  it("rejects invalid focus syntax without a per-request read", async () => {
    const fetch = mount("/approvals?focus=invalid", createFakeApi());
    expect(await screen.findByRole("alert", { name: "" })).toHaveTextContent("focused request ID is invalid");
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/api/approvals/invalid"))).toBe(false);
  });
  it("discloses a capped loaded list rather than claiming all approvals are visible", async () => {
    const api = createFakeApi(); api.ext.approvals.push(request(), request());
    mount("/approvals", api, url => url.pathname === "/api/approvals" && url.searchParams.get("status") === "pending" ? json({ approvals: [api.ext.approvals[0]] }) : null);
    expect(await screen.findByText(/Showing 1 latest requests; 2 waiting in total/)).toBeInTheDocument();
    expect(screen.getByText("2 waiting in total")).toBeInTheDocument();
  });
});
