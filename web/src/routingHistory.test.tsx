import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RoutingHistory } from "./components/RoutingHistory";

/* eslint-disable @typescript-eslint/no-explicit-any */
function show(body: any) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RoutingHistory />
    </QueryClientProvider>,
  );
}

describe("the dashboard shows which model answers and every switch, from the real record", () => {
  it("shows the model answering now and the switch chain with plain reasons", async () => {
    show({
      current: { general: { ref: "gemini/gemini-2.5-flash", at: "2026-11-05T12:00:00Z" } },
      recent: [
        { at: "2026-11-05T12:00:00Z", class: "general", botId: "b1", answeredBy: "gemini/gemini-2.5-flash", switched: true, attempts: [{ ref: "groq/qwen", outcome: "rate_limited" }, { ref: "gemini/gemini-2.5-flash", outcome: "answered" }] },
        { at: "2026-11-05T11:59:00Z", class: "general", botId: "b1", answeredBy: "groq/qwen", switched: false, attempts: [{ ref: "groq/qwen", outcome: "answered" }] },
      ],
      switches: [],
      note: "Recorded from real routing decisions only. Nothing here is estimated.",
    });
    expect(await screen.findByText(/^general:/, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/last answer/).closest("li")).toHaveTextContent("gemini/gemini-2.5-flash");
    const list = screen.getByRole("list", { name: "Model switches" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1); // only the real switch, not the normal answer
    expect(within(list).getByText(/groq\/qwen \(rate-limited\) → gemini\/gemini-2\.5-flash \(answered\)/)).toBeInTheDocument();
  });

  it("says plainly when nothing has switched, and marks a request no model could answer", async () => {
    show({ current: {}, recent: [{ at: "2026-11-05T12:00:00Z", class: "general", botId: null, answeredBy: null, switched: true, attempts: [{ ref: "groq/qwen", outcome: "timeout" }] }], switches: [], note: "n" });
    expect(await screen.findByText(/No automatic request since the app started/)).toBeInTheDocument();
    expect(screen.getByText(/groq\/qwen \(timed out\)/)).toBeInTheDocument();
    expect(screen.getByText(/no model could answer/)).toBeInTheDocument();
  });

  it("falls back to the switches kept in the audit log after a restart", async () => {
    show({ current: {}, recent: [], switches: [{ createdAt: "2026-11-05T10:00:00Z", detail: { answeredBy: "groq/b", attempts: [{ ref: "groq/a", outcome: "bad_output" }, { ref: "groq/b", outcome: "answered" }] } }], note: "n" });
    expect(await screen.findByText(/groq\/a \(unusable reply\) → groq\/b \(answered\)/)).toBeInTheDocument();
  });
});
