import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import type { Capability, CapabilityView } from "./api/capabilityHooks";
import { NAV } from "./components/shell/nav";
import { createFakeApi } from "./test/fakeApi";

const L = (state: "yes" | "no" | "unknown" | "n/a", evidence = "because") => ({ state, evidence });
const cap = (o: Partial<Capability> & { id: string; name: string }): Capability => ({
  group: "tool",
  description: "",
  levels: { installed: L("yes"), configured: L("yes"), authenticated: L("n/a"), operational: L("unknown"), tested: L("no"), verified: L("no") },
  reached: "configured",
  state: "unverified",
  stateReason: "Set up, but nobody has seen it work yet.",
  cost: "free",
  costNote: "",
  missing: [],
  needsOwner: [],
  limits: [],
  ...o,
});

function view(caps: Capability[]): CapabilityView {
  const byState = { available: 0, unverified: 0, partial: 0, needs_setup: 0, unavailable: 0 };
  for (const c of caps) byState[c.state]++;
  return { capabilities: caps, summary: { total: caps.length, byState, verified: 0, headline: `${byState.available} working, ${byState.unverified} set up but unproven.` }, checkedAt: "2026-11-06T10:00:00Z", supervisedOnly: true };
}

function renderPage(initial: Capability[], changes: unknown[] = []) {
  const state = { caps: initial, rescans: 0, changes };
  const base = createFakeApi([]);
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/capabilities/changes")) return json({ changes: state.changes });
    if (url.includes("/api/capabilities/refresh") && method === "POST") {
      state.rescans++;
      return json(view(state.caps));
    }
    if (url.includes("/api/capabilities")) return json(view(state.caps));
    return base.fetch(input, init);
  }) as typeof fetch;
  vi.stubGlobal("fetch", fetchImpl);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/capabilities"] })} />
    </QueryClientProvider>,
  );
  return { state, queryClient };
}

describe("Capabilities page", () => {
  it("has one h1, is reachable from the navigation list, and is not a separate hand-kept feature list", async () => {
    renderPage([cap({ id: "node", name: "Node.js", state: "available" })]);
    expect(await screen.findByRole("heading", { level: 1, name: "Capabilities" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(NAV.some((e) => e.tabs.some((t) => t.to === "/capabilities"))).toBe(true);
  });

  it("shows all six levels for each item and never turns 'not known' into 'yes'", async () => {
    renderPage([cap({ id: "telegram", name: "Telegram", group: "integration", state: "unverified" })]);
    const card = within(await screen.findByRole("listitem", { name: "Telegram" }));
    for (const l of ["installed", "configured", "authenticated", "operational", "tested", "verified"]) expect(card.getByText(new RegExp(`^${l}:`))).toBeInTheDocument();
    expect(card.getByText("operational: not known")).toBeInTheDocument();
    expect(card.getByText("tested: no")).toBeInTheDocument();
    expect(card.getByText("Set up, not proven")).toBeInTheDocument();
    expect(card.queryByText("Working")).not.toBeInTheDocument();
  });

  it("groups by kind, filters by state, and shows what is missing and what needs the owner", async () => {
    renderPage([
      cap({ id: "node", name: "Node.js", state: "available", levels: { installed: L("yes"), configured: L("yes"), authenticated: L("n/a"), operational: L("yes"), tested: L("no"), verified: L("no") } }),
      cap({ id: "gmail", name: "Gmail", group: "integration", state: "needs_setup", stateReason: "Connect Gmail first.", missing: ["Connect Gmail first."], needsOwner: ["Set it up in the Integrations Center."] }),
      cap({ id: "agent:1", name: "Alpha", group: "agent", state: "unverified" }),
    ]);
    expect(await screen.findByRole("region", { name: "Tools and programs" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Connected services" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Agents" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/^Show/), "needs_setup");
    expect(screen.queryByRole("listitem", { name: "Node.js" })).not.toBeInTheDocument();
    const gmail = within(screen.getByRole("listitem", { name: "Gmail" }));
    await userEvent.click(gmail.getByText("Details"));
    expect(gmail.getByText("What needs you")).toBeInTheDocument();
    expect(gmail.getByText("Set it up in the Integrations Center.")).toBeInTheDocument();
  });

  it("'Check again now' rescans, and a thing that registers itself appears without any edit to a list", async () => {
    const { state, queryClient } = renderPage([cap({ id: "node", name: "Node.js", state: "available" })]);
    await screen.findByRole("listitem", { name: "Node.js" });
    state.caps = [...state.caps, cap({ id: "agent:new", name: "Brand new agent", group: "agent" })];
    await userEvent.click(screen.getByRole("button", { name: "Check again now" }));
    await waitFor(() => expect(state.rescans).toBe(1));
    await queryClient.invalidateQueries({ queryKey: ["capabilities"] });
    expect(await screen.findByRole("listitem", { name: "Brand new agent" })).toBeInTheDocument();
  });

  it("lists recent changes in plain words, including removals", async () => {
    renderPage([cap({ id: "node", name: "Node.js", state: "available" })], [{ id: 1, at: "2026-11-06T10:00:00Z", kind: "capability.changed", detail: { changes: [{ id: "agent:1", name: "Alpha", kind: "removed", aspects: [] }, { id: "model-provider:groq", name: "Groq (AI models)", kind: "changed", from: "available", to: "needs_setup", aspects: ["authentication"] }] } }]);
    const region = within(await screen.findByRole("region", { name: "Recent changes" }));
    expect(await region.findByText("Gone: Alpha")).toBeInTheDocument();
    expect(region.getByText(/Groq \(AI models\): authentication changed \(Working → Needs setting up\)/)).toBeInTheDocument();
  });

  it("states the supervised-only rule", async () => {
    renderPage([cap({ id: "node", name: "Node.js", state: "available" })]);
    expect(await screen.findByText(/under your supervision/)).toBeInTheDocument();
  });
});

describe("Assistant capability answer", () => {
  it("shows what works, what is only partly or unproven, what cannot be done, and when it was read", async () => {
    const { ResultsPanel } = await import("./components/assistant/AssistantPanels");
    const { MemoryRouter } = await import("react-router-dom");
    render(
      <MemoryRouter>
        <ResultsPanel
          onClear={() => undefined}
          results={[{ id: "1", asked: "what can you do?", reply: { kind: "capabilities", handled: true, message: "Here is what I can do right now.", checkedAt: "2026-11-06T10:00:00Z", can: ["Node.js"], partly: ["Telegram: set up, but never seen working."], cannot: ["Video generation: Not built yet."], needsYou: ["Connect Gmail."], link: { label: "Open the Capabilities page", to: "/capabilities" } } }]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Here is what I can do right now.")).toBeInTheDocument();
    expect(screen.getByText("Working now (1)")).toBeInTheDocument();
    expect(screen.getByText("Node.js")).toBeVisible();
    expect(screen.getByText("Partly, or set up but not proven (1)")).toBeInTheDocument();
    expect(screen.getByText("Cannot do (and what is missing) (1)")).toBeInTheDocument();
    expect(screen.getByText(/Read from the live capability list/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the Capabilities page" })).toHaveAttribute("href", "/capabilities");
  });
});
