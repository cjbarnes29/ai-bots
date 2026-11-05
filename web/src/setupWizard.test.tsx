import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { checkKey, PROVIDER_GUIDES } from "./lib/integrationGuides";
import { createFakeApi, defaultProviders, makeBot, makeModel } from "./test/fakeApi";

/* The easy AI setup: provider cards, Connect wizards, tutorials and the AI setup assistant. Fake API only: no provider is contacted. */
type Api = ReturnType<typeof createFakeApi>;
function renderAt(api: Api, path: string) {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}
const fresh = () => createFakeApi([], { providers: defaultProviders().map((p) => (p.kind === "cloud" ? { ...p, keyConfigured: false } : p)) });
const next = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => user.click(await screen.findByRole("button", { name: name.source === "Start" ? "Start →" : name }));

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("Integration Center: AI provider cards", () => {
  it("shows Gemini, Groq, OpenRouter and Ollama with what a beginner needs, and official links only", async () => {
    renderAt(fresh(), "/integrations");
    for (const g of PROVIDER_GUIDES) {
      const card = within(await screen.findByRole("listitem", { name: `${g.name} provider` }));
      expect(card.getByText(g.description)).toBeInTheDocument();
      expect(card.getByText(g.difficulty)).toBeInTheDocument();
      expect(card.getByText(g.keyRequired ? "Required" : "Not needed")).toBeInTheDocument();
      expect(card.getByText(g.runs === "local" ? "On this PC" : "Over the internet")).toBeInTheDocument();
      expect(card.getByRole("link", { name: `Connect ${g.name}` })).toHaveAttribute("href", `/integrations/connect/${g.id}`);
      expect(card.getByRole("link", { name: `Setup tutorial for ${g.name}` })).toHaveAttribute("href", `/integrations/guide/${g.id}`);
      const site = card.getByRole("link", { name: /Website/ });
      expect(site).toHaveAttribute("href", g.links.website);
      expect(site).toHaveAttribute("target", "_blank");
      expect(site).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(await card.findByText(/^(Not connected|Set up, not tested yet)$/)).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "Step-by-step guides" })).toBeInTheDocument();
  });

  it("every link is an official https page of that provider, never a search result", () => {
    const hosts: Record<string, RegExp> = { gemini: /^(aistudio\.google\.com|ai\.google\.dev)$/, groq: /^(groq\.com|console\.groq\.com)$/, openrouter: /^openrouter\.ai$/, ollama: /^(ollama\.com|docs\.ollama\.com)$/ };
    for (const g of PROVIDER_GUIDES) {
      for (const href of Object.values(g.links)) {
        const u = new URL(href!);
        expect(u.protocol).toBe("https:");
        expect(u.hostname).toMatch(hosts[g.id]!);
        expect(href).not.toMatch(/google\.com\/search|bing\.com|search\?/);
      }
    }
    expect(PROVIDER_GUIDES.find((g) => g.id === "gemini")!.links).toMatchObject({ website: "https://aistudio.google.com/", keys: "https://aistudio.google.com/app/apikey", docs: "https://ai.google.dev/gemini-api/docs/get-started" });
    expect(PROVIDER_GUIDES.find((g) => g.id === "groq")!.links).toMatchObject({ website: "https://groq.com/", keys: "https://console.groq.com/keys", docs: "https://console.groq.com/docs/quickstart" });
    expect(PROVIDER_GUIDES.find((g) => g.id === "openrouter")!.links).toMatchObject({ website: "https://openrouter.ai/", keys: "https://openrouter.ai/keys", docs: "https://openrouter.ai/docs/quickstart" });
    expect(PROVIDER_GUIDES.find((g) => g.id === "ollama")!.links).toMatchObject({ website: "https://ollama.com/", download: "https://ollama.com/download/windows", library: "https://ollama.com/library", docs: "https://docs.ollama.com/" });
  });
});

describe("key check", () => {
  const gemini = PROVIDER_GUIDES[0]!;
  it("blocks what cannot be a key and only warns about an unexpected start", () => {
    expect(checkKey("", gemini).error).toMatch(/Paste/);
    expect(checkKey("AIza with spaces inside the key 123", gemini).error).toMatch(/space/);
    expect(checkKey("AIzaShort", gemini).error).toMatch(/too short/);
    expect(checkKey("https://aistudio.google.com/app/apikey", gemini).error).toBeTruthy();
    const odd = checkKey("xyz0123456789012345678901234567890", gemini);
    expect(odd.error).toBeNull();
    expect(odd.warning).toMatch(/usually start with AIza/);
    expect(checkKey("  AIzaSyFAKE0123456789012345678901234  ", gemini)).toEqual({ error: null, warning: null });
  });
});

describe("Gemini Connect wizard", () => {
  it("guides from introduction to models: official links, secure key entry, free-plan confirmation, test, automatic model discovery", async () => {
    const user = userEvent.setup();
    const api = fresh();
    api.llm.refreshable["gemini"] = [makeModel({ providerId: "gemini", modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", contextWindow: 1_000_000, capabilities: { text: "yes", long_context: "yes", coding: "unknown", vision: "unknown", image_input: "unknown", audio_input: "unknown", audio_output: "unknown", tool_calling: "unknown", structured_output: "unknown" } })];
    renderAt(api, "/integrations/connect/gemini");

    expect(await screen.findByRole("heading", { name: "What is Google Gemini?" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 8")).toBeInTheDocument();
    await next(user, /Start/);
    expect(screen.getByRole("link", { name: /Open Google Gemini/ })).toHaveAttribute("href", "https://aistudio.google.com/");
    await next(user, /I am signed in/);
    expect(screen.getByRole("link", { name: /Open the API keys page/ })).toHaveAttribute("href", "https://aistudio.google.com/app/apikey");
    expect(screen.getByText("Create an API key.")).toBeInTheDocument();
    await next(user, /I copied my key/);

    // STEP 4: secure input with show/hide and validation
    const input = screen.getByPlaceholderText("AIza…");
    expect(input).toHaveAttribute("type", "password");
    await user.type(input, "AIza bad");
    expect(screen.getByRole("alert")).toHaveTextContent(/space/);
    expect(screen.getByRole("button", { name: "Next →" })).toBeDisabled();
    await user.clear(input);
    const KEY = "AIzaSyFAKEKEYFORTESTS0123456789abcdef";
    await user.type(input, KEY);
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByText(/That looks like a Google Gemini key/)).toBeInTheDocument();
    await next(user, /Next/);

    // STEP 5: connect needs the no-billing confirmation; the key goes to the vault only
    const connect = screen.getByRole("button", { name: "Connect" });
    expect(connect).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /no billing/ }));
    await user.click(connect);
    expect(await screen.findByRole("heading", { name: "Test the connection" })).toBeInTheDocument();
    expect(api.ext.stored.get("GEMINI_API_KEY")).toBe(KEY);
    expect(api.llm.providers.get("gemini")).toMatchObject({ enabled: true, freeConfirmed: true, keyConfigured: true });
    expect(document.body.textContent).not.toContain(KEY); // never shown again

    // STEP 6: test
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Connected\. Connected\. The provider lists 3 models\./)).toBeInTheDocument();
    await next(user, /Next/);

    // STEP 7: models are found by themselves
    expect(await screen.findByText(/Found 1 models/)).toBeInTheDocument();
    await next(user, /Next/);

    // STEP 8: done, models chosen with switches, no identifiers typed
    expect(await screen.findByRole("heading", { name: "Google Gemini is connected" })).toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: "Use Gemini 2.5 Flash" });
    expect(screen.getByText("Over the internet")).toBeInTheDocument();
    expect(screen.getByText("good at long documents")).toBeInTheDocument();
    expect(screen.getByText(/reads about 1000k tokens at once/)).toBeInTheDocument();
    expect(box).not.toBeChecked();
    await user.click(box);
    await waitFor(() => expect(api.llm.models.find((m) => m.modelId === "gemini-2.5-flash")!.enabled).toBe(true));
    expect(screen.getByRole("link", { name: /Set up automatic AI/ })).toHaveAttribute("href", "/integrations/ai-setup");
  }, 30_000);

  it("resumes where the person left off, and shows a failed test with what to do", async () => {
    const user = userEvent.setup();
    const api = fresh();
    api.llm.testResult["gemini"] = { status: "auth_failed", message: "The provider rejected the API key." };
    localStorage.setItem("awp.setup.wizard.gemini", JSON.stringify({ step: 5, done: [0, 1, 2, 3, 4] }));
    api.llm.providers.set("gemini", { ...api.llm.providers.get("gemini")!, keyConfigured: true, enabled: true, freeConfirmed: true });
    renderAt(api, "/integrations/connect/gemini");
    expect(await screen.findByRole("heading", { name: "Test the connection" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Not connected: The provider rejected the API key/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "troubleshooting list" })).toHaveAttribute("href", "/integrations/guide/gemini");
    expect(screen.getByRole("button", { name: "Next →" })).toBeDisabled();
  });

  it("Disconnect switches it off and deletes the saved key after confirmation", async () => {
    const user = userEvent.setup();
    const api = fresh();
    api.ext.stored.set("GEMINI_API_KEY", "AIzaSyFAKE");
    api.ext.secrets.find((s) => s.name === "GEMINI_API_KEY")!.inVault = true;
    api.llm.providers.set("gemini", { ...api.llm.providers.get("gemini")!, keyConfigured: true, enabled: true, freeConfirmed: true, status: "connected" });
    api.llm.models.push(makeModel({ providerId: "gemini", modelId: "g1" }));
    renderAt(api, "/integrations/connect/gemini");
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(api.llm.providers.get("gemini")).toMatchObject({ enabled: false, keyConfigured: false }));
    expect(api.ext.stored.has("GEMINI_API_KEY")).toBe(false);
  });
});

describe("Ollama guided setup", () => {
  it("download link, detection of the local service, connect (also allowed for routing), models, test chat, local vs billed cloud models", async () => {
    const user = userEvent.setup();
    const api = fresh();
    api.llm.routing.allowedProviders = ["gemini", "groq", "openrouter"]; // the owner's real setting that used to leave Ollama out
    api.llm.testResult["ollama"] = { status: "unreachable", message: "Could not reach the provider." };
    api.llm.refreshable["ollama"] = [
      makeModel({ providerId: "ollama", modelId: "llama3.2:3b", displayName: "llama3.2:3b", freeStatus: "verified_free", freeSource: "Runs locally on this PC" }),
      makeModel({ providerId: "ollama", modelId: "gpt-oss:120b-cloud", displayName: "gpt-oss:120b-cloud", freeStatus: "blocked", freeSource: "Runs on Ollama's servers and is billed per token, so it is not free" }),
    ];
    renderAt(api, "/integrations/connect/ollama");
    await next(user, /Start/);
    expect(screen.getByRole("link", { name: /Download Ollama for Windows/ })).toHaveAttribute("href", "https://ollama.com/download/windows");
    await next(user, /I downloaded it/);
    await next(user, /It is installed/);

    // detection: not running, then running (checked by itself)
    expect(await screen.findByText(/Ollama is not running yet/)).toBeInTheDocument();
    expect(screen.getByText("http://localhost:11434")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next →" })).toBeDisabled();
    api.llm.testResult["ollama"] = { status: "connected", message: "Connected." };
    await user.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("Ollama is running.")).toBeInTheDocument();
    await next(user, /Next/);

    // model download is only explained, never done by the app
    expect(screen.getByText("ollama pull llama3.2:3b")).toBeInTheDocument();
    await next(user, /I downloaded a model/);

    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("heading", { name: "Find your models" })).toBeInTheDocument();
    expect(api.llm.providers.get("ollama")!.enabled).toBe(true);
    expect(api.llm.routing.allowedProviders).toContain("ollama");

    await user.click(screen.getByRole("button", { name: "Find models" }));
    expect(await screen.findByText(/Found 1 downloaded model/)).toBeInTheDocument();
    const billed = screen.getByRole("checkbox", { name: "Use gpt-oss:120b-cloud" });
    expect(billed).toBeDisabled();
    expect(screen.getByText(/billed: never used/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Use llama3.2:3b" }));
    await waitFor(() => expect(api.llm.models.find((m) => m.modelId === "llama3.2:3b")!.callable).toBe(true));
    await next(user, /Next/);

    await user.click(await screen.findByRole("button", { name: "Send test message" }));
    expect(await screen.findByText("Hello from llama3.2:3b.")).toBeInTheDocument();
    expect(api.llm.tried).toEqual([{ id: api.llm.models.find((m) => m.modelId === "llama3.2:3b")!.id, message: "Say hello in one short sentence." }]);
  }, 30_000);
});

describe("tutorials", () => {
  it("one step at a time, back and next, troubleshooting, and it resumes after leaving", async () => {
    const user = userEvent.setup();
    renderAt(fresh(), "/integrations/guide/groq");
    expect(await screen.findByRole("heading", { name: "1. What you are setting up" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByRole("heading", { name: "3. Create your API key" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the API keys page/ })).toHaveAttribute("href", "https://console.groq.com/keys");
    await user.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByRole("heading", { name: "2. Create an account" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Troubleshooting/ }));
    expect(screen.getByText("The test says the key was rejected")).toBeInTheDocument();
    cleanup();
    renderAt(fresh(), "/integrations/guide/groq");
    expect(await screen.findByRole("heading", { name: "2. Create an account" })).toBeInTheDocument();
  });

  it("covers desktop programs, file access, webhooks and outside services, each with what, needs, setup, test and disconnect", async () => {
    for (const id of ["desktop-apps", "file-access", "webhooks", "external-services"]) {
      const { tutorialById } = await import("./lib/integrationGuides");
      const t = tutorialById(id)!;
      const titles = t.steps.map((s) => s.title.toLowerCase()).join(" | ");
      expect(titles).toMatch(/what it does/);
      expect(titles).toMatch(/what you need/);
      expect(titles).toMatch(/test/);
      expect(titles).toMatch(/disconnect/);
    }
    renderAt(fresh(), "/integrations/guide/ollama");
    const user = userEvent.setup();
    for (let i = 0; i < 4; i++) await user.click(await screen.findByRole("button", { name: "Next →" }));
    expect(screen.getByRole("button", { name: "Copy Download command (about 2 GB)" })).toBeInTheDocument();
  });
});

describe("AI setup assistant", () => {
  it("recommended settings in one click, then a default model, a first choice per task, fallback and bots", async () => {
    const user = userEvent.setup();
    const off = makeBot({ name: "Writer", model: null });
    const api = createFakeApi([off], { models: [makeModel({ providerId: "gemini", modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" })] });
    api.llm.routing.maxAttempts = 1;
    renderAt(api, "/integrations/ai-setup");
    await user.click(await screen.findByRole("button", { name: "Use the recommended settings" }));
    expect(await screen.findByText(/Recommended settings saved/)).toBeInTheDocument();
    expect(api.llm.routing).toMatchObject({ enabled: true, autoAssignNewBots: true, maxAttempts: 3, defaultModel: null });
    expect([...api.bots.values()][0]!.model).toBe("auto/general");

    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Default model for new bots" }), "gemini/gemini-2.5-flash");
    await waitFor(() => expect(api.llm.routing.defaultModel).toBe("gemini/gemini-2.5-flash"));

    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "First choice for Coding" }), "gemini/gemini-2.5-flash");
    await waitFor(() => expect(api.llm.routing.preferred).toEqual({ coding: "gemini/gemini-2.5-flash" }));

    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Models to try" }), "4");
    await waitFor(() => expect(api.llm.routing.maxAttempts).toBe(4));

    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.click(await screen.findByRole("button", { name: "Switch Writer on" }));
    await waitFor(() => expect([...api.bots.values()][0]!.status).toBe("active"));
  }, 30_000);
});

describe("fixes", () => {
  it("routing settings list Ollama too, and warn when it is switched on but left out", async () => {
    const api = fresh();
    api.llm.providers.set("ollama", { ...api.llm.providers.get("ollama")!, enabled: true });
    api.llm.routing.allowedProviders = ["gemini"];
    renderAt(api, "/settings/ai-models");
    const routing = within(await screen.findByRole("region", { name: "Model routing" }));
    await waitFor(() => expect(routing.getAllByRole("checkbox").map((c) => c.closest("label")?.textContent)).toContain("Ollama (local) (on this PC)"));
    expect(routing.getByRole("checkbox", { name: "Ollama (local) (on this PC)" })).not.toBeChecked();
    expect(routing.getByText(/is switched on but not ticked here, so automatic routing never uses it/)).toBeInTheDocument();
  });

  it("a bot with a model can be set to Active; without a model the option explains what to do", async () => {
    const user = userEvent.setup();
    const ready = makeBot({ name: "Ready", model: "auto/general" });
    const api = createFakeApi([ready]);
    renderAt(api, `/bots/${ready.id}`);
    await user.selectOptions(await screen.findByLabelText("Status"), "active");
    await waitFor(() => expect(api.bots.get(ready.id)!.status).toBe("active"));
    cleanup();
    const bare = makeBot({ name: "Bare", model: null });
    renderAt(createFakeApi([bare]), `/bots/${bare.id}`);
    expect(await screen.findByRole("option", { name: "Active (choose a model first)" })).toBeDisabled();
  });
});
