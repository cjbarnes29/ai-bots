import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Approvals } from "./pages/Approvals";

/** D-125: approved requests whose outcome was never recorded. Fake fetch only; nothing real is contacted. */
const body = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const ID = "11111111-1111-4111-8111-111111111111";
const unknown = (over: Record<string, unknown> = {}) => ({
  id: ID, botId: "b1", botName: "Atlas", taskId: null, connector: "telegram", connectorLabel: "Telegram", action: "send_message", summary: "Send a hello message",
  args: { chat: "sam", text: "hello" }, status: "approved", result: null, error: null, createdAt: "2026-11-15T10:00:00Z", expiresAt: "2026-11-16T10:00:00Z", decidedAt: "2026-11-15T10:01:00Z", decidedBy: "owner", executedAt: null, reconciliation: null, ...over,
});
type Call = { url: string; method: string; value: any };
const clients: QueryClient[] = [];
afterEach(() => { clients.forEach((c) => c.clear()); clients.length = 0; });

function setup(over: (c: Call) => Response | undefined = () => undefined, items: unknown[] = [unknown()]) {
  const calls: Call[] = [];
  let list = items;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Call = { url: String(input), method: init?.method ?? "GET", value: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const o = over(c);
    if (o) return o;
    if (c.url === "/api/approvals/uncertain") return body({ approvals: list });
    if (c.url.endsWith("/reconcile") && c.method === "POST") {
      list = list.map((a: any) => ({ ...a, reconciliation: { outcome: c.value.outcome, at: "2026-11-15T10:10:00Z" } }));
      return body({ approval: list[0] });
    }
    if (c.url.startsWith("/api/external/status")) return body({ paused: false, pendingCount: 0, connectors: [] });
    if (c.url.startsWith("/api/approvals")) return body({ approvals: [] });
    if (c.url.startsWith("/api/audit")) return body({ events: [] });
    return body({ ok: true });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><Approvals /></MemoryRouter></QueryClientProvider>);
  return calls;
}
const section = async () => within(await screen.findByRole("region", { name: /Outcome unknown/ }));
const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

describe("Outcome unknown (approvals)", () => {
  it("explains plainly that it may or may not have happened and was not sent again", async () => {
    setup();
    const s = await section();
    const card = await s.findByRole("listitem", { name: "Outcome unknown: Send a hello message" });
    expect(within(card).getByText(/may or may not have happened/)).toBeInTheDocument();
    expect(within(card).getByText("It was not sent again.")).toBeInTheDocument();
    expect(within(card).getByText("hello")).toBeInTheDocument(); // the exact content is shown
    expect(within(card).queryByRole("button", { name: /Approve|Deny/ })).not.toBeInTheDocument();
  });
  it("records what happened with one request and shows it as the owner's own statement", async () => {
    const calls = setup();
    const s = await section();
    await userEvent.click(await s.findByRole("button", { name: "It did happen" }));
    expect(posts(calls).map((c) => [c.url, c.value])).toEqual([[`/api/approvals/${ID}/reconcile`, { outcome: "did_happen" }]]);
    expect(await s.findByText(/You recorded: it did happen\./)).toBeInTheDocument();
    expect(s.getByText(/your statement; it is not checked by the platform/)).toBeInTheDocument();
    expect(s.queryByRole("button", { name: "It did not happen" })).not.toBeInTheDocument(); // a definite answer is final
  });
  it("lets 'I cannot tell' be replaced by a definite answer later", async () => {
    setup(() => undefined, [unknown({ reconciliation: { outcome: "cannot_tell", at: "2026-11-15T10:05:00Z" } })]);
    const s = await section();
    expect(await s.findByText(/You recorded: you cannot tell\./)).toBeInTheDocument();
    expect(s.getByRole("button", { name: "It did happen" })).toBeEnabled();
    expect(s.getByRole("button", { name: "It did not happen" })).toBeEnabled();
    expect(s.queryByRole("button", { name: "I cannot tell" })).not.toBeInTheDocument();
  });
  it("shows an API refusal in words and keeps the buttons", async () => {
    setup((c) => (c.url.endsWith("/reconcile") ? body({ error: "owner_only", message: "This can only be changed on the PC." }, 403) : undefined));
    const s = await section();
    await userEvent.click(await s.findByRole("button", { name: "It did not happen" }));
    expect(await s.findByRole("alert")).toBeInTheDocument();
    expect(s.getByRole("button", { name: "It did not happen" })).toBeEnabled();
  });
  it("says nothing is missing only after a successful empty read", async () => {
    setup(() => undefined, []);
    const s = await section();
    expect(await s.findByText("No approved request is missing its outcome.")).toBeInTheDocument();
  });
  it("shows a failed read as a failure with Retry, never as 'nothing is missing'", async () => {
    setup((c) => (c.url === "/api/approvals/uncertain" ? body({ error: "x", message: "down" }, 503) : undefined));
    const s = await section();
    expect(await s.findByText(/Could not load requests with an unknown outcome/)).toBeInTheDocument();
    expect(s.getByRole("button", { name: "Retry the unknown-outcome list" })).toBeEnabled();
    expect(s.queryByText("No approved request is missing its outcome.")).not.toBeInTheDocument();
  });
  it("uses 44 px buttons and states what recording does and does not do", async () => {
    setup();
    const s = await section();
    for (const name of ["It did happen", "It did not happen", "I cannot tell"]) expect((await s.findByRole("button", { name })).className).toContain("min-h-11");
    expect(s.getByText(/changes nothing outside and sends nothing/)).toBeInTheDocument();
  });
});
