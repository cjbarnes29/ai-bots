import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeProvider } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path: string) {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

const card = async (name: string) => within((await screen.findByRole("heading", { level: 3, name })).closest("li") as HTMLElement);

function twoServices() {
  const api = createFakeApi();
  Object.assign(api.ext.connectors[0]!, { group: "Communication", secrets: [{ name: "TELEGRAM_BOT_TOKEN", description: "Telegram bot token", saved: true }], help: ["Create a bot with @BotFather."] });
  Object.assign(api.ext.connectors[1]!, { group: "Communication", notReady: "press Connect Gmail in the Integrations Center to sign in.", agents: [{ id: "b1", name: "Mailer" }] });
  return api;
}

describe("Integrations Center: the services catalog", () => {
  it("shows an honest status for each service: saved credentials are 'ready, not tested', never 'verified'", async () => {
    renderApp(twoServices(), "/integrations");
    const tg = await card("Telegram");
    expect(tg.getByText("Ready, not tested yet")).toBeInTheDocument();
    expect(tg.queryByText("Verified")).not.toBeInTheDocument();
    const gm = await card("Gmail");
    expect(gm.getByText("Not set up")).toBeInTheDocument();
    expect(gm.getByText(/press Connect Gmail in the Integrations Center to sign in/)).toBeInTheDocument();
  });

  it("Test connection says Verified only after the check succeeded, and remembers when", async () => {
    const user = userEvent.setup();
    const api = twoServices();
    renderApp(api, "/integrations");
    const tg = await card("Telegram");
    await user.click(tg.getByRole("button", { name: "Test connection for Telegram" }));
    expect(await tg.findByText("Verified: Pretend account answered")).toBeInTheDocument();
    await waitFor(() => expect(tg.getByText("Verified")).toBeInTheDocument());
    expect(api.writes().filter((w) => w.path === "/api/integrations/telegram/verify")).toHaveLength(1);
  });

  it("a failed check is shown as failed with the reason; 'not testable' stays at ready", async () => {
    const user = userEvent.setup();
    const api = twoServices();
    api.ext.verifyOutcome["telegram"] = { result: "failed", message: "Telegram did not accept the bot token." };
    renderApp(api, "/integrations");
    const tg = await card("Telegram");
    await user.click(tg.getByRole("button", { name: "Test connection for Telegram" }));
    expect(await tg.findByText("Check failed: Telegram did not accept the bot token.")).toBeInTheDocument();
    await waitFor(() => expect(tg.getByText("Check failed")).toBeInTheDocument());

    api.ext.verifyOutcome["telegram"] = { result: "not_testable", message: "This service cannot be tested without doing something real." };
    await user.click(tg.getByRole("button", { name: "Test connection for Telegram" }));
    expect(await tg.findByText(/cannot be tested without doing something real/)).toBeInTheDocument();
  });

  it("a service that needs no sign-in never claims to have saved credentials", async () => {
    const api = twoServices();
    api.ext.connectors.push({ id: "memory", label: "Memory", group: "On this PC and the web", secrets: [], actions: [] } as never);
    api.ext.connectors.push({ id: "browser", label: "Browser", group: "On this PC and the web", secrets: [], testable: false, actions: [] } as never);
    renderApp(api, "/integrations");
    expect((await card("Memory")).getByText("Nothing to sign in to. Press Test connection to check it.")).toBeInTheDocument();
    expect((await card("Browser")).getByText("Nothing to sign in to. It is only tested when an agent uses it.")).toBeInTheDocument();
    expect((await card("Browser")).queryByText(/Credentials are saved/)).not.toBeInTheDocument();
  });

  it("a service that is not set up explains why when tested", async () => {
    const user = userEvent.setup();
    renderApp(twoServices(), "/integrations");
    const gm = await card("Gmail");
    await user.click(gm.getByRole("button", { name: "Test connection for Gmail" }));
    expect(await gm.findByText(/Check failed: Not set up yet: press Connect Gmail/)).toBeInTheDocument();
  });

  it("Details lists what agents can do (automatic vs ask first), which agents may use it, and troubleshooting", async () => {
    const user = userEvent.setup();
    const api = twoServices();
    api.ext.connectors[1]!.actions = [
      { name: "search", kind: "read", description: "Search mail" },
      { name: "send_message", kind: "write", description: "Send an email" },
    ] as never;
    renderApp(api, "/integrations");
    const gm = await card("Gmail");
    await user.click(gm.getByRole("button", { name: "Details" }));
    const caps = within(gm.getByRole("region", { name: "What Gmail can do" }));
    expect(caps.getByText("Automatic (read)").parentElement).toHaveTextContent("Search mail");
    expect(caps.getByText("Ask first (write)").parentElement).toHaveTextContent("Send an email");
    expect(within(gm.getByRole("region", { name: "Agents allowed to use Gmail" })).getByRole("link", { name: "Mailer" })).toHaveAttribute("href", "/bots/b1");
    expect(gm.getByText(/Last used by an agent: never/)).toBeInTheDocument();

    const tg = await card("Telegram");
    await user.click(tg.getByRole("button", { name: "Details" }));
    expect(tg.getByText("Create a bot with @BotFather.")).toBeInTheDocument();
  });

  it("Disconnect and Remove ask first, then remove the saved credential", async () => {
    const user = userEvent.setup();
    const api = twoServices();
    api.ext.secrets.push({ name: "TELEGRAM_BOT_TOKEN", description: "Telegram bot token", inVault: true, inEnv: false, updatedAt: null } as never);
    renderApp(api, "/integrations");
    const tg = await card("Telegram");
    await user.click(tg.getByRole("button", { name: "Details" }));
    await user.click(tg.getByRole("button", { name: "Remove" }));
    expect(api.writes().filter((w) => w.method === "DELETE")).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.writes().some((w) => w.method === "DELETE" && w.path === "/api/vault/TELEGRAM_BOT_TOKEN")).toBe(true));
  });
});

describe("AI Models: the guided provider setup", () => {
  const noKey = () => createFakeApi([], { providers: [makeProvider({ keyConfigured: false }), makeProvider({ id: "ollama", displayName: "Ollama (local)", kind: "local", keyEnv: null, keyConfigured: false, requiresFreeConfirmation: false, baseUrl: "http://127.0.0.1:11434", baseUrlEditable: true, dailyRequestCap: null })] });

  it("walks one provider through key, free-plan confirmation, test and models, and only then says Connected", async () => {
    const user = userEvent.setup();
    const api = noKey();
    api.ext.secrets.push({ name: "GEMINI_API_KEY", description: "API key for Google Gemini", inVault: false, inEnv: false, updatedAt: null } as never);
    renderApp(api, "/settings/ai-models");
    const guide = within(await screen.findByRole("region", { name: "Connect an AI provider" }));
    expect(guide.getByText(/Not connected yet/)).toBeInTheDocument();
    expect(guide.getByRole("checkbox", { name: /Use Google Gemini/ })).toBeDisabled();
    expect(guide.getByRole("button", { name: "Test connection" })).toBeDisabled();

    await user.type(guide.getByLabelText("Google Gemini key"), "AIzaFAKE0123456789");
    await user.click(guide.getByRole("button", { name: "Save key" }));
    expect(await guide.findByText(/A key is saved \(GEMINI_API_KEY\)/)).toBeInTheDocument();

    await user.click(guide.getByRole("checkbox", { name: /no billing/ }));
    await waitFor(() => expect(guide.getByRole("checkbox", { name: /Use Google Gemini/ })).toBeEnabled());
    await user.click(guide.getByRole("checkbox", { name: /Use Google Gemini/ }));
    await waitFor(() => expect(guide.getByRole("button", { name: "Test connection" })).toBeEnabled());
    expect(guide.queryByText(/^Connected/)).not.toBeInTheDocument(); // not yet: nothing has been tested

    await user.click(guide.getByRole("button", { name: "Test connection" }));
    expect(await guide.findByText(/Connected: last successful test/)).toBeInTheDocument();
    await user.click(guide.getByRole("button", { name: "Fetch models" }));
    await waitFor(() => expect(api.writes().some((w) => w.path === "/api/llm/providers/gemini/refresh-models")).toBe(true));
  });

  it("a failed test is not shown as connected, and says why in plain words", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([], { providers: [makeProvider({ enabled: true, freeConfirmed: true })] });
    api.llm.testResult["gemini"] = { status: "auth_failed", message: "The provider rejected the API key. Check the key." };
    renderApp(api, "/settings/ai-models");
    const guide = within(await screen.findByRole("region", { name: "Connect an AI provider" }));
    await user.click(guide.getByRole("button", { name: "Test connection" }));
    expect(await guide.findByText("The provider rejected the API key. Check the key.")).toBeInTheDocument();
    expect(guide.queryByText(/^Connected/)).not.toBeInTheDocument();
    expect(guide.getByText(/Not connected yet/)).toBeInTheDocument();
    expect(guide.getByRole("button", { name: "Fetch models" })).toBeDisabled(); // models wait for a working connection
  });

  it("explains that the daily cap is the app's own limit and shows what is left", async () => {
    renderApp(createFakeApi([], { providers: [makeProvider({ requestsToday: 12 })] }), "/settings/ai-models");
    const guide = within(await screen.findByRole("region", { name: "Connect an AI provider" }));
    expect(guide.getByLabelText("Free capacity today")).toHaveTextContent("Requests today: 12 of the app's safety cap of 50 (38 left)");
    expect(guide.getByLabelText("Free capacity today")).toHaveTextContent(/not the provider's quota/);
  });

  it("a local provider needs no key", async () => {
    const user = userEvent.setup();
    renderApp(noKey(), "/settings/ai-models");
    const guide = within(await screen.findByRole("region", { name: "Connect an AI provider" }));
    await user.selectOptions(guide.getByLabelText("Provider"), "ollama");
    expect(await guide.findByText(/No key is needed/)).toBeInTheDocument();
  });
});
