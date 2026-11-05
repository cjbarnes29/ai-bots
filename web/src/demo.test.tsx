import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, defaultProviders, makeModel, makeProvider } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path: string) {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

const demoProvider = () => makeProvider({ id: "demo", displayName: "Demo AI (simulated, built in)", kind: "local", simulated: true, keyEnv: null, keyConfigured: true, baseUrlEditable: false, freePolicyLabel: "Simulated" });
const withDemo = (extra: Parameters<typeof createFakeApi>[1] = {}) => createFakeApi([], { providers: [...defaultProviders(), demoProvider()], ...extra });

describe("Dashboard: demo mode and the AI overview", () => {
  it("offers the demo, says plainly that it is simulated, and sets it up on one press", async () => {
    const api = withDemo();
    renderApp(api, "/");
    const demo = within(await screen.findByRole("region", { name: "Demo mode" }));
    expect(demo.getByText("Simulated")).toBeInTheDocument();
    expect(demo.getByText(/not a real AI/)).toBeInTheDocument();
    await userEvent.click(demo.getByRole("button", { name: "Set up the demo" }));
    expect(await demo.findByRole("link", { name: "Demo: Researcher" })).toBeInTheDocument();
    expect(demo.getByRole("link", { name: "Demo: Research, write, review" })).toBeInTheDocument();
    expect(demo.queryByRole("button", { name: "Set up the demo" })).not.toBeInTheDocument(); // everything exists now
    expect(api.writes().some((w) => w.path.endsWith("/api/demo/setup"))).toBe(true);
  });

  it("never counts the simulated provider as a connected AI", async () => {
    const api = withDemo();
    renderApp(api, "/");
    const demo = within(await screen.findByRole("region", { name: "Demo mode" }));
    await userEvent.click(demo.getByRole("button", { name: "Set up the demo" }));
    await demo.findByRole("link", { name: "Demo: Writer" });
    expect(await screen.findByText(/No real AI is connected/)).toBeInTheDocument();
    const card = screen.getByText("AI providers").closest("a") as HTMLElement;
    expect(within(card).getByText(`0 of ${defaultProviders().length} connected`)).toBeInTheDocument(); // only the real providers count; the demo is not one of them
  });

  it("shows the routing strategy, with real and simulated providers kept apart", async () => {
    const api = withDemo();
    api.llm.routing.preferred = { general: "groq/llama" };
    renderApp(api, "/");
    const strategy = within(await screen.findByLabelText("Routing strategy"));
    expect(strategy.getByText(/Automatic routing is on/)).toBeInTheDocument();
    expect(strategy.getByText(/Demo AI is used only if you tick it/)).toBeInTheDocument();
    expect(strategy.getByText(/general → groq\/llama/)).toBeInTheDocument();
  });
});

describe("Settings > Model routing: practical controls", () => {
  it("reorders providers, sets a first choice per task and a default model, and lists availability", async () => {
    const api = withDemo({ models: [makeModel({ providerId: "groq", modelId: "llama-x", enabled: true, callable: true }), makeModel({ providerId: "gemini", modelId: "flash", enabled: false, callable: false, blockedReason: "No key yet." })] });
    renderApp(api, "/settings/ai-models");
    await screen.findByText("Automatic routing is on");
    const section = within(screen.getByRole("region", { name: "Model routing" }));

    const order = within(await section.findByLabelText("Provider order"));
    expect(order.getAllByText(/Preferred|Backup/)[0]).toHaveTextContent("Preferred");
    await userEvent.click(order.getByRole("button", { name: "Move Groq up" }));
    await waitFor(() => expect(api.llm.routing.providerOrder.slice(0, 2)).toEqual(["groq", "gemini"]));

    await userEvent.selectOptions(section.getByLabelText("First choice for Coding"), "groq/llama-x");
    await waitFor(() => expect(api.llm.routing.preferred).toEqual({ coding: "groq/llama-x" }));
    await userEvent.selectOptions(section.getByLabelText("First choice for Coding"), "");
    await waitFor(() => expect(api.llm.routing.preferred).toEqual({}));

    await userEvent.selectOptions(section.getByLabelText("Model for new agents"), "groq/llama-x");
    await waitFor(() => expect(api.llm.routing.defaultModel).toBe("groq/llama-x"));

    const avail = within(section.getByLabelText("Model availability"));
    expect(avail.getByText("Ready")).toBeInTheDocument();
    expect(avail.getByText(/Not usable: No key yet/)).toBeInTheDocument();
    await userEvent.click(avail.getByRole("checkbox", { name: "Never choose groq/llama-x automatically" }));
    await waitFor(() => expect(api.llm.routing.excludedModels).toEqual(["groq/llama-x"]));
  });

  it("shows a model that is resting after a rate limit, with the time left, instead of calling it ready", async () => {
    const api = withDemo({ models: [makeModel({ providerId: "groq", modelId: "llama-x", enabled: true, callable: true })] });
    api.llm.cooldowns = [{ ref: "groq/llama-x", secondsLeft: 45 }];
    renderApp(api, "/settings/ai-models");
    await screen.findByText("Automatic routing is on");
    const avail = within(within(screen.getByRole("region", { name: "Model routing" })).getByLabelText("Model availability"));
    expect(await avail.findByText("Resting after a rate limit, back in about 45 seconds")).toBeInTheDocument();
    expect(avail.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("states what works with the simulated provider and what needs real API access", async () => {
    renderApp(withDemo(), "/settings/ai-models");
    await screen.findByText("Automatic routing is on");
    const section = within(screen.getByRole("region", { name: "Model routing" }));
    expect(section.getByText(/Works with the simulated Demo AI/)).toBeInTheDocument();
    expect(section.getByText(/Needs real API access/)).toBeInTheDocument();
    expect(section.getByText(/None of that has been tested against a real provider yet/)).toBeInTheDocument();
  });
});

describe("Integrations Center: what each service needs", () => {
  it("separates local services from ones that need your account, and gives a next step", async () => {
    const api = createFakeApi();
    Object.assign(api.ext.connectors[0]!, { group: "Communication", secrets: [{ name: "TELEGRAM_BOT_TOKEN", description: "Telegram bot token", saved: false }], notReady: "paste the bot token first." });
    renderApp(api, "/integrations");
    const tg = within((await screen.findByRole("heading", { level: 3, name: "Telegram" })).closest("li") as HTMLElement);
    expect(tg.getByText("Needs your own account or token")).toBeInTheDocument();
    expect(tg.getByText(/there is no simulated version of this service/)).toBeInTheDocument();
  });

  it("answers 'which services do I need?' with the current state and whether a real AI is needed", async () => {
    const api = createFakeApi();
    renderApp(api, "/integrations");
    const helper = within(await screen.findByRole("region", { name: "Which services do I need?" }));
    await userEvent.selectOptions(helper.getByLabelText("What do you want to do?"), "Search and read my email");
    expect(await helper.findByText(/Also needs a real AI provider/)).toBeInTheDocument();
    await userEvent.selectOptions(helper.getByLabelText("What do you want to do?"), "Just explore how agents and workflows work");
    expect(await helper.findByText("No service is needed.")).toBeInTheDocument();
  });
});

describe("Workflows: understanding a failed run", () => {
  it("names the box where the run stopped and marks simulated runs", async () => {
    const api = withDemo();
    api.ext.wfRuns.push({
      id: "r1", workflowId: "w1", workflowName: "Demo: Where did it fail?", workflowVersion: 1, status: "failed", trigger: "manual", input: "anything", error: null, createdAt: new Date().toISOString(), finishedAt: null,
      steps: [
        { nodeId: "first", label: "Step that works", type: "bot_task", status: "completed", output: "[SIMULATED RESPONSE - no real AI was used]\nhi", error: null, attempts: 1, refKind: null, refId: null, decidedBy: null },
        { nodeId: "broken", label: "Step that fails", type: "bot_task", status: "failed", output: null, error: "Simulated failure", attempts: 1, refKind: null, refId: null, decidedBy: null },
      ],
    });
    renderApp(api, "/workflows");
    const sec = within(await screen.findByRole("region", { name: "Workflows" }));
    expect(await sec.findByText(/Stopped at the box "Step that fails"/)).toBeInTheDocument();
    expect(sec.getByText("Simulated AI")).toBeInTheDocument();
    await userEvent.click(sec.getByRole("button", { name: /Demo: Where did it fail\?/ }));
    expect(sec.getByText(/Started with: anything/)).toBeInTheDocument();
    expect(sec.getByText(/Simulated failure/)).toBeInTheDocument();
  });
});
