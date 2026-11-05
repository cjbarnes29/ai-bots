import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from "./api/client";
import { DEFAULT_LIMITS, EMPTY_USAGE, createFakeApi, makeBot, makeModel, makeProvider } from "./test/fakeApi";

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderApp(api: { fetch: typeof fetch }, path = "/") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const card = (name: string) => screen.getByRole("listitem", { name });

describe("navigation", () => {
  it("has links to Dashboard, Agents & Teams and Settings", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(createFakeApi());
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    await user.click(nav.getByRole("link", { name: "Settings" }));
    expect(router.state.location.pathname).toBe("/settings");
    await user.click(nav.getByRole("link", { name: "Agents & Teams" }));
    expect(router.state.location.pathname).toBe("/agents");
    await user.click(nav.getByRole("link", { name: "Dashboard" }));
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("Settings: safety", () => {
  it("shows free-only mode as locked ON, with no control to change it", async () => {
    renderApp(createFakeApi(), "/settings/ai-models");
    expect(await screen.findByText(/Free-only mode:/)).toHaveTextContent("ON (locked)");
    expect(screen.getByText(/No paid models, no paid fallbacks, no automatic billing/)).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /free-only/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /free-only/i })).not.toBeInTheDocument();
  });

  it("the pause switch stops all AI calls", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api, "/settings/ai-models");
    const pause = await screen.findByRole("switch", { name: "Pause all AI calls" });
    expect(pause).toHaveAttribute("aria-checked", "false");
    await user.click(pause);
    await waitFor(() => expect(pause).toHaveAttribute("aria-checked", "true"));
    expect(api.writes()[0]).toMatchObject({ method: "PUT", path: "/api/llm/pause", body: { paused: true } });
    expect(screen.getByText(/Paused: no bot can reach any model/)).toBeInTheDocument();
    await user.click(pause);
    await waitFor(() => expect(pause).toHaveAttribute("aria-checked", "false"));
  });
});

describe("Settings: providers", () => {
  it("lists the four providers: Gemini, Groq, OpenRouter and Ollama, and nothing else", async () => {
    renderApp(createFakeApi(), "/settings/ai-models");
    const section = within(await screen.findByRole("region", { name: "Providers" }));
    const names = (await section.findAllByRole("heading", { level: 3 })).map((h) => h.textContent);
    expect(names).toEqual(["Google Gemini", "Groq", "OpenRouter", "Ollama (local)"]);
    expect(screen.queryByText(/Together AI/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/OmniRoute/i)).not.toBeInTheDocument();
  });

  it("shows cloud or local, and the key status without ever showing a key", async () => {
    const api = createFakeApi([], { providers: [makeProvider({ keyConfigured: false }), makeProvider({ id: "groq", displayName: "Groq", keyEnv: "GROQ_API_KEY", keyConfigured: true }), makeProvider({ id: "ollama", displayName: "Ollama (local)", kind: "local", keyEnv: null, requiresFreeConfirmation: false, baseUrlEditable: true, baseUrl: "http://127.0.0.1:11434/v1", dailyRequestCap: null })] });
    renderApp(api, "/settings/ai-models");
    const gemini = within(await screen.findByRole("listitem", { name: "Google Gemini" }));
    expect(gemini.getByText("Cloud")).toBeInTheDocument();
    expect(gemini.getByText("Key missing")).toBeInTheDocument();
    expect(gemini.getByText(/GEMINI_API_KEY=your-key/)).toBeInTheDocument();
    const groq = within(card("Groq"));
    expect(groq.getByText(/found in the vault or your .env file \(GROQ_API_KEY\)/)).toBeInTheDocument();
    const ollama = within(card("Ollama (local)"));
    expect(ollama.getByText("Local")).toBeInTheDocument();
    expect(ollama.getByText(/No key needed/)).toBeInTheDocument();
  });

  it("a cloud provider cannot be switched on until you confirm there is no billing", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api, "/settings/ai-models");
    const gemini = within(await screen.findByRole("listitem", { name: "Google Gemini" }));
    const enable = gemini.getByRole("switch", { name: "Enable Google Gemini" });
    expect(enable).toBeDisabled();

    await user.click(gemini.getByRole("checkbox", { name: /I confirm my Google Gemini account has no billing/ }));
    await waitFor(() => expect(enable).toBeEnabled());
    expect(api.writes()[0]!.body).toEqual({ freeConfirmed: true });

    await user.click(enable);
    await waitFor(() => expect(enable).toHaveAttribute("aria-checked", "true"));
    expect(api.writes()[1]!.body).toEqual({ enabled: true });

    // Withdrawing the confirmation switches the provider off again.
    await user.click(gemini.getByRole("checkbox", { name: /I confirm/ }));
    await waitFor(() => expect(enable).toHaveAttribute("aria-checked", "false"));
    expect(enable).toBeDisabled();
  });

  it("OpenRouter and Ollama need no billing confirmation", async () => {
    renderApp(createFakeApi(), "/settings/ai-models");
    for (const name of ["OpenRouter", "Ollama (local)"]) {
      const c = within(await screen.findByRole("listitem", { name }));
      expect(c.queryByRole("checkbox", { name: /no billing/ })).not.toBeInTheDocument();
      expect(c.getByRole("switch", { name: `Enable ${name}` })).toBeEnabled();
    }
  });

  it("'Test connection' shows the result, including failures, in plain words", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.llm.testResult["groq"] = { status: "auth_failed", message: "The provider rejected the API key. Check the key in your .env file." };
    api.llm.testResult["ollama"] = { status: "unreachable", message: "Could not reach the provider. Check that it is running." };
    renderApp(api, "/settings/ai-models");

    const gemini = within(await screen.findByRole("listitem", { name: "Google Gemini" }));
    expect(gemini.getByText("Not tested yet")).toBeInTheDocument();
    await user.click(gemini.getByRole("button", { name: "Test connection" }));
    expect(await gemini.findByText("Connected")).toBeInTheDocument();

    const groq = within(card("Groq"));
    await user.click(groq.getByRole("button", { name: "Test connection" }));
    expect(await groq.findByText("Key rejected")).toBeInTheDocument();
    expect(groq.getByText(/rejected the API key/)).toBeInTheDocument();

    const ollama = within(card("Ollama (local)"));
    await user.click(ollama.getByRole("button", { name: "Test connection" }));
    expect(await ollama.findByText("Unreachable")).toBeInTheDocument();
  });

  it("edits the daily request cap, and the local provider may have none", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api, "/settings/ai-models");
    const gemini = within(await screen.findByRole("listitem", { name: "Google Gemini" }));
    expect(field("cap-gemini")).toHaveValue(50);
    expect(gemini.queryByRole("button", { name: "Save cap" })).not.toBeInTheDocument();
    await user.clear(field("cap-gemini"));
    await user.type(field("cap-gemini"), "20");
    await user.click(gemini.getByRole("button", { name: "Save cap" }));
    await waitFor(() => expect(field("cap-gemini")).toHaveValue(20));
    expect(api.writes()[0]!.body).toEqual({ dailyRequestCap: 20 });

    expect(field("cap-ollama")).toHaveValue(null);
    await user.type(field("cap-ollama"), "5");
    await user.click(within(card("Ollama (local)")).getByRole("button", { name: "Save cap" }));
    await waitFor(() => expect(api.writes().at(-1)!.body).toEqual({ dailyRequestCap: 5 }));
    await user.clear(field("cap-ollama"));
    await user.click(within(card("Ollama (local)")).getByRole("button", { name: "Save cap" }));
    await waitFor(() => expect(api.writes().at(-1)!.body).toEqual({ dailyRequestCap: null }));
  });

  it("only the local provider has an editable address, and it must stay on this PC", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api, "/settings/ai-models");
    await screen.findByRole("listitem", { name: "Google Gemini" });
    expect(document.getElementById("url-gemini")).toBeNull();
    expect(document.getElementById("url-groq")).toBeNull();
    expect(document.getElementById("url-openrouter")).toBeNull();

    const ollama = within(card("Ollama (local)"));
    await user.clear(field("url-ollama"));
    await user.type(field("url-ollama"), "http://example.com:11434/v1");
    await user.click(ollama.getByRole("button", { name: "Save address" }));
    expect(await ollama.findByRole("alert")).toHaveTextContent(/must be on this PC/);

    await user.clear(field("url-ollama"));
    await user.type(field("url-ollama"), "http://localhost:11500/v1");
    await user.click(ollama.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(field("url-ollama")).toHaveValue("http://localhost:11500/v1"));
    expect(ollama.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Settings: models", () => {
  it("explains there are no models yet", async () => {
    renderApp(createFakeApi(), "/settings/ai-models");
    expect(await screen.findByText(/No models yet\. Click/)).toBeInTheDocument();
  });

  it("'Refresh models' lists models with free badges, a Llama tag and availability", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.llm.refreshable["groq"] = [makeModel({ providerId: "groq", modelId: "llama-3.1-8b-instant", displayName: "llama-3.1-8b-instant", isLlama: true })];
    api.llm.refreshable["openrouter"] = [
      makeModel({ providerId: "openrouter", modelId: "meta-llama/llama-3.3-70b-instruct:free", displayName: "Llama 3.3 70B (free)", freeStatus: "verified_free", isLlama: true }),
    ];
    api.llm.refreshable["ollama"] = [makeModel({ providerId: "ollama", modelId: "llama3.1:8b", displayName: "Llama 3.1 8B (local)", freeStatus: "verified_free", availability: "not_installed", isLlama: true })];
    renderApp(api, "/settings/ai-models");

    for (const name of ["Groq", "OpenRouter", "Ollama (local)"]) {
      await user.click(within(await screen.findByRole("listitem", { name })).getByRole("button", { name: "Refresh models" }));
    }
    const models = within(await screen.findByRole("region", { name: "Models" }));
    expect(await models.findByText("llama-3.1-8b-instant")).toBeInTheDocument();
    expect(models.getByText("Free tier")).toBeInTheDocument();
    expect(models.getAllByText("Verified free", { selector: "span.rounded-full" })).toHaveLength(2); // OpenRouter and Ollama
    expect(models.getAllByText("Llama")).toHaveLength(3);
    expect(models.getByText("Not installed")).toBeInTheDocument();
    expect(models.getByText("groq/llama-3.1-8b-instant")).toBeInTheDocument();
  });

  it("refreshing a cloud provider with no key shows the reason", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([], { providers: [makeProvider({ keyConfigured: false })] });
    renderApp(api, "/settings/ai-models");
    const gemini = within(await screen.findByRole("listitem", { name: "Google Gemini" }));
    await user.click(gemini.getByRole("button", { name: "Refresh models" }));
    expect(await gemini.findByRole("alert")).toHaveTextContent(/No API key found/);
  });

  it("a model's switch changes whether it can be used; blocked models cannot be switched on", async () => {
    const user = userEvent.setup();
    const ok = makeModel({ providerId: "groq", modelId: "fast-one", displayName: "Fast one", enabled: false, callable: false, blockedReason: "This model is switched off. Enable it in Settings." });
    const paid = makeModel({ providerId: "openrouter", modelId: "paid-one", displayName: "Paid one", freeStatus: "blocked", enabled: false, callable: false, blockedReason: "This model is blocked: it is paid." });
    const api = createFakeApi([], { models: [ok, paid] });
    renderApp(api, "/settings/ai-models");

    const models = within(await screen.findByRole("region", { name: "Models" }));
    expect(await models.findByText(/Can't be used yet: This model is switched off/)).toBeInTheDocument();
    expect(models.getByText("Blocked (paid)")).toBeInTheDocument();
    expect(models.getByRole("switch", { name: "Enable model Paid one" })).toBeDisabled();

    await user.click(models.getByRole("switch", { name: "Enable model Fast one" }));
    await waitFor(() => expect(models.getByRole("switch", { name: "Enable model Fast one" })).toHaveAttribute("aria-checked", "true"));
    expect(api.writes()[0]).toMatchObject({ method: "PATCH", path: `/api/llm/models/${ok.id}`, body: { enabled: true } });
    expect(api.writes()).toHaveLength(1);
  });
});

describe("Settings: limits", () => {
  it("shows the approved limits", async () => {
    renderApp(createFakeApi(), "/settings/advanced");
    await screen.findByRole("region", { name: "Limits" });
    await waitFor(() => expect(field("limit-globalDailyRequests")).toHaveValue(100));
    expect(field("limit-globalMonthlyRequests")).toHaveValue(2000);
    expect(field("limit-globalDailyTokens")).toHaveValue(200000);
    expect(field("limit-globalMonthlyTokens")).toHaveValue(2000000);
    expect(field("limit-botDailyRequests")).toHaveValue(30);
    expect(field("limit-botMonthlyRequests")).toHaveValue(600);
    expect(field("limit-botDailyTokens")).toHaveValue(50000);
    expect(field("limit-maxOutputTokensDefault")).toHaveValue(1024);
    expect(field("limit-maxPromptTokens")).toHaveValue(12000);
    expect(field("limit-maxConcurrentCloud")).toHaveValue(2);
    expect(screen.getByText(/No reply can ever be longer than 4,096 tokens/)).toBeInTheDocument();
  });

  it("saves only what changed, and warns about unsaved edits", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api, "/settings/advanced");
    await waitFor(() => expect(field("limit-botDailyRequests")).toHaveValue(30));
    const save = screen.getByRole("button", { name: "Save limits" });
    expect(save).toBeDisabled();

    await user.clear(field("limit-botDailyRequests"));
    await user.type(field("limit-botDailyRequests"), "12");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(save);
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());
    expect(api.writes()[0]).toMatchObject({ method: "PUT", path: "/api/llm/limits", body: { botDailyRequests: 12 } });
    expect(field("limit-botDailyRequests")).toHaveValue(12);
  });

  it("shows the server's explanation when a value is not allowed", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi(), "/settings/advanced");
    await waitFor(() => expect(field("limit-maxOutputTokensDefault")).toHaveValue(1024));
    await user.clear(field("limit-maxOutputTokensDefault"));
    await user.type(field("limit-maxOutputTokensDefault"), "5000");
    await user.click(screen.getByRole("button", { name: "Save limits" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/maxOutputTokensDefault.*4096/);
  });

  it("resets to the approved defaults", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.llm.status.limits = { ...DEFAULT_LIMITS, botDailyRequests: 5 };
    renderApp(api, "/settings/advanced");
    await waitFor(() => expect(field("limit-botDailyRequests")).toHaveValue(5));
    await user.click(screen.getByRole("button", { name: "Reset to the approved defaults" }));
    await waitFor(() => expect(field("limit-botDailyRequests")).toHaveValue(30));
    expect(api.writes()[0]).toMatchObject({ method: "POST", path: "/api/llm/limits/reset" });
  });
});

describe("bot editor: model, temperature and max tokens", () => {
  const models = () => [
    makeModel({ providerId: "gemini", modelId: "gemini-x", displayName: "Gemini X" }),
    makeModel({ providerId: "groq", modelId: "llama-3.1-8b-instant", displayName: "Llama 3.1 8B", isLlama: true }),
    makeModel({ providerId: "ollama", modelId: "llama3.1:8b", displayName: "Llama local", freeStatus: "verified_free", availability: "not_installed", callable: false, enabled: true }),
    makeModel({ providerId: "openrouter", modelId: "paid", displayName: "Paid model", freeStatus: "blocked", enabled: false, callable: false }),
  ];

  it("offers models grouped by provider, with free badges, and greys out the ones that cannot be used", async () => {
    const bot = makeBot();
    renderApp(createFakeApi([bot], { models: models() }), `/bots/${bot.id}`);
    const select = await screen.findByLabelText("AI model");
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    expect(within(select).getByRole("group", { name: "Google Gemini" })).toBeInTheDocument();
    expect(within(select).getByRole("group", { name: "Groq" })).toBeInTheDocument();

    const usable = within(select).getByRole("option", { name: "Llama 3.1 8B · Free tier · Llama" });
    expect(usable).toBeEnabled();
    expect(within(select).getByRole("option", { name: /Llama local · Verified free \(unavailable: not installed\)/ })).toBeDisabled();
    expect(within(select).getByRole("option", { name: /Paid model · Blocked \(paid\) \(unavailable: blocked, not free\)/ })).toBeDisabled();
  });

  it("choosing a model saves 'provider/model' on the bot; 'No model chosen' clears it", async () => {
    const user = userEvent.setup();
    const bot = makeBot();
    const api = createFakeApi([bot], { models: models() });
    renderApp(api, `/bots/${bot.id}`);
    const select = await screen.findByLabelText("AI model");
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));

    await user.selectOptions(select, "groq/llama-3.1-8b-instant");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved as version 2.");
    expect(api.writes()[0]!.body).toEqual({ model: "groq/llama-3.1-8b-instant" });

    await user.selectOptions(screen.getByLabelText("AI model"), "");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved as version 3.");
    expect(api.writes()[1]!.body).toEqual({ model: null });
  });

  it("points to Settings when no models exist yet", async () => {
    const bot = makeBot();
    renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    expect(await screen.findByRole("link", { name: "Connect a provider in Settings" })).toHaveAttribute("href", "/settings/ai-models");
  });

  it("shows a saved model that has left the catalog instead of hiding it", async () => {
    const bot = makeBot({ model: "groq/old-model" });
    renderApp(createFakeApi([bot], { models: models() }), `/bots/${bot.id}`);
    expect(await screen.findByRole("option", { name: "groq/old-model (not in the catalog)" })).toBeInTheDocument();
  });

  it("saves temperature and max reply length as numbers, and empty means 'use the default'", async () => {
    const user = userEvent.setup();
    const bot = makeBot();
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);
    expect(await screen.findByLabelText(/Temperature/)).toHaveAttribute("placeholder", "0.7 (default)");
    expect(screen.getByLabelText(/Max reply length/)).toHaveAttribute("placeholder", "1,024 (default)");

    await user.type(screen.getByLabelText(/Temperature/), "1.2");
    await user.type(screen.getByLabelText(/Max reply length/), "300");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved as version 2.");
    expect(api.writes()[0]!.body).toEqual({ temperature: 1.2, maxOutputTokens: 300 });

    await user.clear(screen.getByLabelText(/Temperature/));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved as version 3.");
    expect(api.writes()[1]!.body).toEqual({ temperature: null });
  });

  it("explains invalid values and will not save them", async () => {
    const user = userEvent.setup();
    const bot = makeBot();
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);
    const save = await screen.findByRole("button", { name: "Save changes" });

    await user.type(screen.getByLabelText(/Temperature/), "3");
    expect(screen.getByText(/Enter a number from 0 to 2/)).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText(/Temperature/));
    expect(save).toBeDisabled(); // nothing changed any more

    await user.type(screen.getByLabelText(/Max reply length/), "5000");
    expect(screen.getByText(/whole number from 1 to 4,096/)).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText(/Max reply length/));
    await user.type(screen.getByLabelText(/Max reply length/), "4096");
    expect(save).toBeEnabled();
    expect(api.writes()).toHaveLength(0);
  });

  it("version history shows the model, temperature and max length that changed", async () => {
    const user = userEvent.setup();
    const bot = makeBot();
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);
    await user.type(await screen.findByLabelText(/Temperature/), "1.5");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved as version 2.");
    await user.click(screen.getByRole("tab", { name: /Versions/ }));
    await user.click(await screen.findByRole("button", { name: /^Version 1/ }));
    const panel = screen.getByRole("tabpanel", { name: "Versions" });
    expect(await within(panel).findByText("Temperature")).toBeInTheDocument();
    expect(within(panel).getByText("1.5")).toBeInTheDocument();
    expect(within(panel).getByText("(default)")).toBeInTheDocument();
  });
});

describe("test chat", () => {
  const readyBot = (over = {}) => makeBot({ name: "Scout", model: "groq/llama-3.1-8b-instant", currentVersion: 1, status: "active", ...over });

  it("a switched-off bot explains how to switch it on instead of failing on Send", async () => {
    const user = userEvent.setup();
    const bot = readyBot({ status: "disabled" });
    renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    await user.click(await screen.findByRole("tab", { name: "Chat" }));
    expect(await screen.findByText(/This bot is switched off. Set its Status \(top right\) to Active/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("asks you to choose a model first", async () => {
    const user = userEvent.setup();
    const bot = makeBot({ name: "Scout" });
    renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    await user.click(await screen.findByRole("tab", { name: "Chat" }));
    expect(await screen.findByText(/Choose a model for this bot on the Details tab first/)).toBeInTheDocument();
    expect(screen.getByLabelText("Your message")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("explains that the bot has no tools and can't take actions", async () => {
    const user = userEvent.setup();
    const bot = readyBot();
    renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    await user.click(await screen.findByRole("tab", { name: "Chat" }));
    expect(await screen.findByText(/has no tools and can't take any action/)).toBeInTheDocument();
    expect(screen.getByText("groq/llama-3.1-8b-instant")).toBeInTheDocument();
    expect(screen.getByText(/don't type anything private/)).toBeInTheDocument();
  });

  it("sends a message, shows the reply with provider, model and token counts, and keeps the conversation", async () => {
    const user = userEvent.setup();
    const bot = readyBot();
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);
    await user.click(await screen.findByRole("tab", { name: "Chat" }));

    await user.type(await screen.findByLabelText("Your message"), "Hello bot");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Echo: Hello bot")).toBeInTheDocument();
    expect(screen.getByText(/groq\/llama-3\.1-8b-instant · 21 tokens in, 9 out/)).toBeInTheDocument();
    expect(screen.getByLabelText("Your message")).toHaveValue("");
    const first = api.writes()[0]!;
    expect(first).toMatchObject({ method: "POST", path: `/api/bots/${bot.id}/chat`, body: { message: "Hello bot" } });
    expect(first.headers[CLIENT_HEADER]).toBe(CLIENT_HEADER_VALUE);

    // The second message continues the same conversation.
    await user.type(screen.getByLabelText("Your message"), "Again");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Echo: Again")).toBeInTheDocument();
    expect(api.writes()[1]!.body.conversationId).toBeTruthy();
    expect(screen.getByText("Echo: Hello bot")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Conversation")).getAllByRole("option")).toHaveLength(2);
  });

  it("shows 'thinking' while waiting, and Ctrl+Enter sends", async () => {
    const user = userEvent.setup();
    const bot = readyBot();
    const api = createFakeApi([bot]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    renderApp(
      {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).endsWith("/chat")) await gate;
          return api.fetch(input, init);
        }) as typeof fetch,
      },
      `/bots/${bot.id}`,
    );
    await user.click(await screen.findByRole("tab", { name: "Chat" }));
    await user.type(await screen.findByLabelText("Your message"), "Slow one");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(await screen.findByText("Scout is thinking…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    release();
    expect(await screen.findByText("Echo: Slow one")).toBeInTheDocument();
    expect(screen.queryByText("Scout is thinking…")).not.toBeInTheDocument();
  });

  it("shows a reached limit in plain words and keeps what you typed", async () => {
    const user = userEvent.setup();
    const bot = readyBot();
    const api = createFakeApi([bot]);
    api.llm.chatQueue.push(
      () =>
        new Response(JSON.stringify({ error: "llm_limit_exceeded", message: "Daily (this bot) request limit reached (30/30). It resets at midnight." }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
    );
    renderApp(api, `/bots/${bot.id}`);
    await user.click(await screen.findByRole("tab", { name: "Chat" }));
    await user.type(await screen.findByLabelText("Your message"), "Please reply");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Daily (this bot) request limit reached (30/30). It resets at midnight.");
    expect(screen.getByLabelText("Your message")).toHaveValue("Please reply");
    expect(screen.queryByText("Scout is thinking…")).not.toBeInTheDocument();
  });

  it("links to Settings when the problem is fixed there", async () => {
    const user = userEvent.setup();
    const bot = readyBot();
    const api = createFakeApi([bot]);
    api.llm.chatQueue.push(
      () => new Response(JSON.stringify({ error: "llm_blocked_by_policy", message: "This model is switched off. Enable it in Settings." }), { status: 409, headers: { "content-type": "application/json" } }),
    );
    renderApp(api, `/bots/${bot.id}`);
    await user.click(await screen.findByRole("tab", { name: "Chat" }));
    await user.type(await screen.findByLabelText("Your message"), "Hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings/ai-models");
  });

  it("shows a warning when a provider reports a cost", async () => {
    const user = userEvent.setup();
    const bot = readyBot();
    const api = createFakeApi([bot]);
    api.llm.chatQueue.push((botId, body) => {
      const msg = { id: 1, role: "assistant", content: "ok", botVersion: 1, providerId: "groq", modelId: "x", inputTokens: 1, outputTokens: 1, tokensEstimated: false, createdAt: new Date().toISOString() };
      return new Response(
        JSON.stringify({ conversationId: crypto.randomUUID(), userMessage: { ...msg, id: 2, role: "user", content: body.message }, assistantMessage: msg, warning: "The provider reported a cost for x. It has been blocked automatically." }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    renderApp(api, `/bots/${bot.id}`);
    await user.click(await screen.findByRole("tab", { name: "Chat" }));
    await user.type(await screen.findByLabelText("Your message"), "Hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/blocked automatically/);
  });

  it("opens an earlier conversation, and can start a new one", async () => {
    const user = userEvent.setup();
    const bot = readyBot();
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);
    await user.click(await screen.findByRole("tab", { name: "Chat" }));
    await user.type(await screen.findByLabelText("Your message"), "First topic");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Echo: First topic");

    await user.click(screen.getByRole("button", { name: "Start a new conversation" }));
    expect(screen.queryByText("Echo: First topic")).not.toBeInTheDocument();
    expect(screen.getByText("Say hello to start the conversation.")).toBeInTheDocument();

    const select = screen.getByLabelText("Conversation");
    await user.selectOptions(select, within(select).getByRole("option", { name: /First topic/ }));
    expect(await screen.findByText("Echo: First topic")).toBeInTheDocument();
  });

  it("is disabled for archived bots and bots that use the uninstalled OpenClaw runtime", async () => {
    const user = userEvent.setup();
    const archived = readyBot({ name: "Old", archived: true });
    const claw = readyBot({ name: "Claw", runtime: "openclaw" });
    const api = createFakeApi([archived, claw]);
    const { router } = renderApp(api, `/bots/${archived.id}`);
    await user.click(await screen.findByRole("tab", { name: "Chat" }));
    // (The hidden Details panel also mentions archiving, so look only inside the Chat panel.)
    const chat = within(await screen.findByRole("tabpanel", { name: "Chat" }));
    expect(await chat.findByText(/This bot is archived/)).toBeInTheDocument();
    expect(chat.getByRole("button", { name: "Send" })).toBeDisabled();

    await router.navigate(`/bots/${claw.id}`);
    await user.click(await screen.findByRole("tab", { name: "Chat" }));
    const clawChat = within(await screen.findByRole("tabpanel", { name: "Chat" }));
    expect(await clawChat.findByText(/OpenClaw runtime, which is not installed/)).toBeInTheDocument();
    expect(clawChat.getByLabelText("Your message")).toBeDisabled();
  });

  it("warns that chat uses the saved bot when there are unsaved edits", async () => {
    const user = userEvent.setup();
    const bot = readyBot();
    renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    await user.type(await screen.findByLabelText("Role"), "Scout");
    await user.click(screen.getByRole("tab", { name: "Chat" }));
    expect(await screen.findByText(/You have unsaved edits on the Details tab/)).toBeInTheDocument();
  });
});

describe("Usage page", () => {
  it("shows empty states before any call, and a $0 cost", async () => {
    renderApp(createFakeApi(), "/settings/ai-models");
    expect(await screen.findByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(await screen.findByText(/Cost reported by providers this month: \$0\.0000/)).toBeInTheDocument();
    expect(screen.getByText(/should always stay at \$0/)).toBeInTheDocument();
    expect(screen.getByText("No failed or blocked calls.")).toBeInTheDocument();
    expect(screen.getAllByText("No calls yet.")).toHaveLength(3);
  });

  it("shows totals, limit meters, and per-day, per-bot and per-model tables", async () => {
    const usage = {
      ...EMPTY_USAGE,
      today: { requests: 7, tokens: 1500 },
      todayCloud: { requests: 5, tokens: 1200 },
      month: { requests: 40, tokens: 9000 },
      monthCloud: { requests: 30, tokens: 8000 },
      byDay: [{ day: "2026-06-15", ok: 6, errors: 1, blocked: 2, tokens: 1500 }],
      byBot: [{ botId: "b1", botName: "Scout", requests: 7, tokens: 1500 }],
      byModel: [{ providerId: "groq", modelId: "llama-3.1-8b-instant", requests: 7, tokens: 1500, errors: 1 }],
      recentProblems: [{ createdAt: new Date().toISOString(), status: "error", errorCode: "rate_limited", providerId: "groq", modelId: "llama-3.1-8b-instant", botName: "Scout", note: null }],
    };
    renderApp(createFakeApi([], { usage }), "/settings/ai-models");
    expect(await screen.findByText("Today, all providers")).toBeInTheDocument();
    const meter = await screen.findByRole("progressbar", { name: "Requests today (all bots)" });
    expect(meter).toHaveAttribute("aria-valuenow", "5");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(screen.getByRole("progressbar", { name: "Tokens this month (all bots)" })).toHaveAttribute("aria-valuemax", "2000000");
    const byDay = within(screen.getByRole("region", { name: "By day" }));
    expect(byDay.getByText("2026-06-15")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "By bot" })).getByText("Scout")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "By model" })).getByText("groq/llama-3.1-8b-instant")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Recent problems" })).getByText(/rate_limited/)).toBeInTheDocument();
  });

  it("raises an alert if a provider ever reported a cost", async () => {
    renderApp(createFakeApi([], { usage: { ...EMPTY_USAGE, reportedCostMicroThisMonth: 1500 } }), "/settings/ai-models");
    expect(await screen.findByText(/Cost reported by providers this month: \$0\.0015/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/blocked automatically/);
  });

  it("can change how many days are shown", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api, "/settings/ai-models");
    await user.selectOptions(await screen.findByLabelText("Show the last"), "30");
    await waitFor(() => expect(api.requests.some((r) => r.path === "/api/llm/usage?days=30")).toBe(true));
  });
});

describe("Settings: OmniRoute gateway", () => {
  it("shows OmniRoute with its default address, a vault key, the free-only rule and a daily cap", async () => {
    const api = createFakeApi([], {
      providers: [
        makeProvider({ id: "omniroute", displayName: "OmniRoute (gateway)", keyEnv: "OMNIROUTE_API_KEY", keyConfigured: false, requiresFreeConfirmation: false, baseUrlEditable: true, baseUrl: "http://127.0.0.1:20128/v1", dailyRequestCap: 40, freePolicyLabel: "Only explicit models that OmniRoute itself lists at a price of exactly 0 (never auto, combos or fallbacks)" }),
      ],
    });
    renderApp(api, "/settings/ai-models");
    const card = within(await screen.findByRole("listitem", { name: "OmniRoute (gateway)" }));
    expect(card.getByText(/never auto, combos or fallbacks/)).toBeInTheDocument();
    expect(card.getByLabelText(/Address/)).toHaveValue("http://127.0.0.1:20128/v1");
    expect(card.getByText(/OMNIROUTE_API_KEY=your-key/)).toBeInTheDocument();
    expect(card.getByText(/Paste it under Keys and tokens/)).toBeInTheDocument();
  });
});

describe("Settings: confirming an unpriced gateway model", () => {
  const unpriced = () => makeModel({ providerId: "omniroute", modelId: "mystery/unknown-price", displayName: "mystery/unknown-price", freeStatus: "blocked", freeSource: "Blocked: OmniRoute pricing could not be verified as free: it did not list both an input price and an output price", enabled: false, callable: false, ownerOverridable: true, blockedReason: "blocked" });

  it("asks you to confirm in plain words first, and nothing changes until you do", async () => {
    const api = createFakeApi([], { models: [unpriced(), makeModel({ providerId: "omniroute", modelId: "paid/x", displayName: "paid/x", freeStatus: "blocked", enabled: false, callable: false, ownerOverridable: false })] });
    renderApp(api, "/settings/ai-models");
    const row = within(await screen.findByText("mystery/unknown-price").then((e) => e.closest("li") as HTMLElement));
    expect(screen.getAllByRole("button", { name: /I confirm this model is free/ })).toHaveLength(1); // only the unpriced one
    await userEvent.click(row.getByRole("button", { name: /I confirm this model is free/ }));
    expect(screen.getByText(/OmniRoute does not say what this model costs/)).toBeInTheDocument();
    expect(api.writes().filter((w) => w.path.includes("owner-verified"))).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.writes().filter((w) => w.path.includes("owner-verified"))).toHaveLength(0);
  });

  it("confirming marks it as yours, and it can be withdrawn", async () => {
    const api = createFakeApi([], { models: [unpriced()] });
    renderApp(api, "/settings/ai-models");
    await userEvent.click(await screen.findByRole("button", { name: /I confirm this model is free/ }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, I checked: it is free" }));
    expect(await screen.findByText(/You confirmed this model is free\./)).toBeInTheDocument();
    expect(api.writes().find((w) => w.path.includes("owner-verified"))?.body).toMatchObject({ verified: true, iUnderstand: true });
    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(screen.queryByText(/You confirmed this model is free\./)).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: /I confirm this model is free/ })).toBeInTheDocument();
  });
});
