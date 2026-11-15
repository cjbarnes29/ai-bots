import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

/** Assistant read states (D-105/D-104 findings DU-READ-HELPERS, DU-READ-SUGGESTIONS, DU-REVIEW-LABEL, DU-PHONE-HISTORY). Fake API only. */
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const down = () => json({ error: "synthetic_unavailable", message: "Synthetic read unavailable" }, 503);
const sample = { id: "act1", level: "review", status: "applied", summary: "Rename project", before: { name: "A" }, after: { name: "B" }, undoable: true, error: null };

function setup(handler: (method: string, url: string) => Response | undefined, stored?: Record<string, string>) {
  sessionStorage.clear();
  Object.entries(stored ?? {}).forEach(([k, v]) => sessionStorage.setItem(k, v));
  const base = createFakeApi([makeBot({ name: "Atlas", status: "active", model: "demo/simulated-echo" })]);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const out = handler(init?.method ?? "GET", String(input));
    return out ? Promise.resolve(out) : base.fetch(input, init);
  });
  const router = createMemoryRouter(routes, { initialEntries: ["/assistant"] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
}
const ok = (u: string) => (u.startsWith("/api/assistant/suggestions") ? json({ suggestions: [] }) : u.startsWith("/api/assistant/actions") ? json({ actions: [] }) : undefined);
afterEach(() => sessionStorage.clear());

describe("Assistant read states", () => {
  it("does not say no agent is set up when the agent list failed to load, and offers Retry", async () => {
    setup((m, u) => (u.startsWith("/api/bots") ? down() : ok(u)));
    expect(await screen.findByText(/Could not load your agents/)).toBeInTheDocument();
    expect(screen.getByText(/could not check which agents are ready/)).toBeInTheDocument();
    expect(screen.queryByText(/No agent is ready to chat yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry agents" })).toBeEnabled();
    expect(screen.getByLabelText("Find or open something")).toBeInTheDocument();
  });
  it("still says no agent is ready when the list loaded and is empty", async () => {
    setup((m, u) => (u.startsWith("/api/bots") ? json({ bots: [] }) : ok(u)));
    expect(await screen.findByText(/No agent is ready to chat yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry agents" })).not.toBeInTheDocument();
  });
  it("does not reassure when suggestions failed; Retry is offered; a loaded empty list still reassures", async () => {
    setup((m, u) => (u.startsWith("/api/assistant/suggestions") ? down() : ok(u)));
    expect(await screen.findByText(/Could not load suggestions/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry suggestions" })).toBeEnabled();
    expect(screen.queryByText("Nothing needs attention right now.")).not.toBeInTheDocument();
  });
  it("says nothing needs attention only after a successful empty read", async () => {
    setup((m, u) => ok(u));
    expect(await screen.findByText("Nothing needs attention right now.")).toBeInTheDocument();
    expect(screen.getByText("No changes yet.")).toBeInTheDocument();
  });
  it("does not say 'No changes yet' when the changes list failed", async () => {
    setup((m, u) => (u.startsWith("/api/assistant/actions") ? down() : ok(u)));
    expect(await screen.findByText(/Could not load recent changes/)).toBeInTheDocument();
    expect(screen.queryByText("No changes yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry recent changes" })).toBeEnabled();
  });
  it("orders the side column Changes, Suggestions, Workflows", async () => {
    setup((m, u) => ok(u));
    const changes = await screen.findByRole("region", { name: "Assistant changes" });
    const sugg = screen.getByRole("region", { name: "Suggestions" });
    const wf = screen.getByRole("region", { name: "Workflows from the assistant" });
    expect(changes.compareDocumentPosition(sugg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sugg.compareDocumentPosition(wf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("explains the project choice applies to new conversations only", async () => {
    setup((m, u) => ok(u));
    expect(await screen.findByText("New conversations go in")).toBeInTheDocument();
    expect(screen.getByText(/only sets where a NEW conversation is filed/)).toBeInTheDocument();
  });
  const stored = { "awp-assistant-results": JSON.stringify([{ id: "r1", asked: "rename it", reply: { kind: "action", handled: true, message: "Proposed.", action: sample } }]) };
  it("puts the chat before earlier results and links to them; review label is neutral once applied", async () => {
    setup((m, u) => (u.startsWith("/api/assistant/actions") ? json({ actions: [sample] }) : ok(u)), stored);
    const results = await screen.findByRole("region", { name: "Assistant results" });
    const chat = await screen.findByLabelText(/Your message/i);
    expect(chat.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /Results and review changes \(1\)/ })).toBeInTheDocument();
    expect(await screen.findByText("Review change")).toBeInTheDocument();
    expect(screen.queryByText("Needs your review")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });
  it("shows 'Needs your review' only while a change is actually proposed, with Apply and Reject kept", async () => {
    const proposed = { ...sample, status: "proposed", undoable: false };
    setup((m, u) => (u.startsWith("/api/assistant/actions") ? json({ actions: [proposed] }) : ok(u)), { "awp-assistant-results": JSON.stringify([{ id: "r1", asked: "rename it", reply: { kind: "action", handled: true, message: "Proposed.", action: proposed } }]) });
    expect(await screen.findByText("Needs your review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply this change" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Results and review changes/ }));
  });
});
