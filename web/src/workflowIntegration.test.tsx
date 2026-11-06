import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

const telegram = {
  id: "telegram", label: "Telegram", group: "Communication", status: "ready", notReady: null, testable: true, lastCheckAt: null, lastCheckOk: null, lastCheckText: null, lastUsedAt: null, secrets: [], agents: [], help: [],
  actions: [{ name: "send_message", kind: "write", description: "Send a message" }, { name: "read_messages", kind: "read", description: "Read recent messages" }],
};
const gmail = { ...telegram, id: "gmail", label: "Gmail", notReady: "Connect Gmail first.", actions: [{ name: "send_message", kind: "write", description: "Send mail" }] };

function renderApp() {
  const base = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
  const validations: unknown[] = [];
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/integrations")) return new Response(JSON.stringify({ integrations: [telegram, gmail], paused: false }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/workflows/validate")) validations.push(JSON.parse(String(init?.body ?? "{}")));
    return base.fetch(input, init);
  }) as typeof fetch);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/workflows"] })} />
    </QueryClientProvider>,
  );
  return { validations };
}

describe("Workflow editor: outside action box", () => {
  it("offers the box, lists services (marking one that is not set up) and says a write waits for approval", async () => {
    renderApp();
    const sec = within(await screen.findByRole("region", { name: "Workflows" }));
    await userEvent.click(sec.getByRole("button", { name: "New workflow" }));
    const ed = within(await screen.findByRole("group", { name: "Workflow editor" }));
    await userEvent.click(ed.getByRole("button", { name: "Add Outside action" }));
    const service = await ed.findByLabelText("Service");
    expect(within(service).getByRole("option", { name: "Gmail (not set up)" })).toBeInTheDocument();
    await userEvent.selectOptions(service, "telegram");
    const action = ed.getByLabelText("Action");
    expect(within(action).getByRole("option", { name: "read_messages (read)" })).toBeInTheDocument();
    await userEvent.selectOptions(action, "send_message");
    expect(ed.getByRole("note")).toHaveTextContent(/stops here until you approve this on the Approvals page/);
    await userEvent.selectOptions(action, "read_messages");
    expect(ed.getByRole("note")).toHaveTextContent(/only if this agent is allowed to read/);
  });

  it("sends the chosen service, action and fields to the server's check, with numbers and true/false typed", async () => {
    const { validations } = renderApp();
    const sec = within(await screen.findByRole("region", { name: "Workflows" }));
    await userEvent.click(sec.getByRole("button", { name: "New workflow" }));
    const ed = within(await screen.findByRole("group", { name: "Workflow editor" }));
    await userEvent.click(ed.getByRole("button", { name: "Add Outside action" }));
    await userEvent.selectOptions(await ed.findByLabelText("Service"), "telegram");
    await userEvent.selectOptions(ed.getByLabelText("Action"), "send_message");
    await userEvent.type(ed.getByLabelText("Action fields"), "chat = sam{enter}count = 3{enter}loud = true");
    await vi.waitFor(() => {
      const last = validations.at(-1) as { graph: { nodes: { type: string; connector?: string; action?: string; args?: unknown }[] } };
      const box = last.graph.nodes.find((n) => n.type === "integration")!;
      expect(box).toMatchObject({ connector: "telegram", action: "send_message", args: { chat: "sam", count: 3, loud: true } });
    }, { timeout: 3000 });
  });
});
