import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { SERVICE_GUIDES, checkEndpoint, checkGithubToken, checkNotionSecret, checkTelegramToken } from "./lib/serviceGuides";
import { createFakeApi } from "./test/fakeApi";

/* The Integration Setup Center redesign (2026-11-04). Fake API only: no service is contacted. */
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
const SECRET_NAMES = ["GITHUB_TOKEN", "NOTION_TOKEN", "N8N_WEBHOOK_URL", "MCP_SERVER_URL", "MCP_SERVER_TOKEN", "GMAIL_REFRESH_TOKEN", "GOOGLE_WORKSPACE_REFRESH_TOKEN"];
/** A fake backend with every outside service installed, like the real one. */
function everything(): Api {
  const api = createFakeApi();
  // like the real backend: a service with nothing saved yet is "not set up"
  for (const [id, label] of [["gworkspace", "Google Workspace"], ["github", "GitHub"], ["notion", "Notion"], ["n8n", "n8n"], ["mcp", "MCP server"], ["pc", "PC (PowerShell tools)"]] as const) api.ext.connectors.push({ id, label, actions: [], ...(id === "pc" ? {} : { notReady: "nothing saved yet." }) } as never);
  for (const name of SECRET_NAMES) if (!api.ext.secrets.some((s) => s.name === name)) api.ext.secrets.push({ name, description: name, inVault: false, inEnv: false, updatedAt: null });
  return api;
}
const at = (id: string, step: number) => localStorage.setItem(`awp.setup.service.${id}`, JSON.stringify({ step, done: Array.from({ length: step }, (_, i) => i) }));

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("the Integrations Center page", () => {
  it("shows categorized cards in the requested order, and no credential box until a service is chosen", async () => {
    renderAt(everything(), "/integrations");
    const order = ["AI Providers", "Messaging and Communication", "Google Services and Email", "Development Tools", "Productivity Services", "Automation and Webhooks", "Advanced Integrations (MCP)", "On this PC"];
    for (const name of order) expect(await screen.findByRole("heading", { level: 2, name })).toBeInTheDocument();
    const positions = order.map((n) => screen.getByRole("heading", { level: 2, name: n }));
    for (let i = 1; i < positions.length; i++) expect(positions[i - 1]!.compareDocumentPosition(positions[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the long list of keys is folded away under Advanced
    const advanced = screen.getByText(/Advanced: every saved key/).closest("details")!;
    expect(advanced.open).toBe(false);
    // (the search box is not a credential field; every other input must be inside Advanced)
    for (const input of document.querySelectorAll("input:not([type=search])")) expect(advanced.contains(input)).toBe(true);
  });

  it("each service card shows what it is, what it allows, difficulty, sign-in method, Connect and a tutorial", async () => {
    renderAt(everything(), "/integrations");
    const card = within((await screen.findByRole("heading", { level: 3, name: "GitHub" })).closest("li")!);
    expect(card.getByText(/Lets bots read issues, pull requests and files/)).toBeInTheDocument();
    expect(card.getByText(/For example:/)).toBeInTheDocument();
    expect(card.getByText("Moderate")).toBeInTheDocument();
    expect(card.getByText("Access token")).toBeInTheDocument();
    expect(card.getByRole("link", { name: "Connect GitHub" })).toHaveAttribute("href", "/integrations/setup/github");
    expect(card.getByRole("link", { name: "Setup tutorial for GitHub" })).toHaveAttribute("href", "/integrations/guide/github");
    expect(card.queryByRole("button", { name: "Disconnect GitHub" })).not.toBeInTheDocument(); // nothing saved yet
    const pc = within((await screen.findByRole("heading", { level: 3, name: "PC (PowerShell tools)" })).closest("li")!);
    expect(pc.getByRole("link", { name: "Configure PC (PowerShell tools)" })).toHaveAttribute("href", "/pc");
  });

  it("Disconnect on a card asks first and removes only that service's own saved values (Gmail keeps the shared Google client)", async () => {
    const user = userEvent.setup();
    const api = everything();
    for (const n of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"]) {
      api.ext.secrets.find((s) => s.name === n)!.inVault = true;
      api.ext.stored.set(n, "x");
    }
    Object.assign(api.ext.connectors.find((c: any) => c.id === "gmail")!, { secrets: [{ name: "GOOGLE_CLIENT_ID", description: "", saved: true }, { name: "GOOGLE_CLIENT_SECRET", description: "", saved: true }, { name: "GMAIL_REFRESH_TOKEN", description: "", saved: true }] });
    renderAt(api, "/integrations");
    const card = within((await screen.findByRole("heading", { level: 3, name: "Gmail" })).closest("li")!);
    await user.click(card.getByRole("button", { name: "Disconnect Gmail" }));
    expect(api.writes().filter((w) => w.method === "DELETE")).toHaveLength(0);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(api.writes().filter((w) => w.method === "DELETE").map((w) => w.path)).toEqual(["/api/vault/GMAIL_REFRESH_TOKEN"]));
    expect(api.ext.stored.has("GOOGLE_CLIENT_ID")).toBe(true);
  });
});

describe("Telegram wizard: introduction to done", () => {
  it("guides through BotFather, checks the token, stores it encrypted only, tests, and remembers progress without the token", async () => {
    const user = userEvent.setup();
    const api = everything();
    renderAt(api, "/integrations/setup/telegram");
    expect(await screen.findByText("Step 1 of 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start →" }));
    expect(screen.getByRole("heading", { name: "Requirements" })).toBeInTheDocument();
    expect(screen.getByText(/not your Telegram account password/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getAllByRole("link", { name: /Open BotFather/ })[0]).toHaveAttribute("href", "https://t.me/BotFather");
    expect(screen.getByText("/newbot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Command for BotFather" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByRole("heading", { name: "Requirements" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.click(screen.getByRole("button", { name: "I have what I need →" }));

    // sign-in step: required label, format check, encrypted save, box emptied, never shown again
    expect(screen.getByText("(required)")).toBeInTheDocument();
    const box = screen.getByLabelText(/Telegram bot token/, { selector: "input" });
    expect(box).toHaveAttribute("type", "password");
    await user.type(box, "not-a-token");
    expect(screen.getByRole("alert")).toHaveTextContent(/123456789:AA/);
    expect(screen.getByRole("button", { name: "Save securely" })).toBeDisabled();
    await user.clear(box);
    const TOKEN = "123456789:AAFakeTokenForTestsOnly_abcdefghij";
    await user.type(box, TOKEN);
    await user.click(screen.getByRole("button", { name: "Save securely" }));
    expect(await screen.findByText("Saved securely.")).toBeInTheDocument();
    expect(api.ext.stored.get("TELEGRAM_BOT_TOKEN")).toBe(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN); // progress only, never credentials
    expect(screen.getByText("Saved (encrypted)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next →" }));

    // test
    await user.click(screen.getByRole("button", { name: "Test connection for Telegram" }));
    expect(await screen.findByText(/It works\. Pretend account answered/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next →" }));
    expect(await screen.findByText(/Telegram: Connected and verified/)).toBeInTheDocument();

    // resume later at the same step
    cleanup();
    renderAt(api, "/integrations/setup/telegram");
    expect(await screen.findByText("Step 6 of 6")).toBeInTheDocument();
  }, 30_000);

  it("a failed test is explained in plain words with the service's troubleshooting", async () => {
    const user = userEvent.setup();
    const api = everything();
    api.ext.verifyOutcome["telegram"] = { result: "failed", message: "Telegram did not accept the bot token.", reason: "auth_rejected" } as never;
    api.ext.secrets.find((s) => s.name === "TELEGRAM_BOT_TOKEN")!.inVault = true;
    at("telegram", 4);
    renderAt(api, "/integrations/setup/telegram");
    await user.click(await screen.findByRole("button", { name: "Test connection for Telegram" }));
    expect(await screen.findByText(/Telegram did not accept what you saved/)).toBeInTheDocument();
    expect(screen.getByText(/Details: Telegram did not accept the bot token/)).toBeInTheDocument();
    expect(screen.getByText(/send \/mybots/)).toBeInTheDocument();
  });

  it("an existing saved token is kept, shown only as saved, and can be replaced", async () => {
    const user = userEvent.setup();
    const api = everything();
    api.ext.secrets.find((s) => s.name === "TELEGRAM_BOT_TOKEN")!.inVault = true;
    api.ext.stored.set("TELEGRAM_BOT_TOKEN", "111111111:OLDOLDOLDOLDOLDOLDOLDOLDOLD");
    at("telegram", 3);
    renderAt(api, "/integrations/setup/telegram");
    expect(await screen.findByText("Saved (encrypted)")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Telegram bot token/, { selector: "input" })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("OLDOLD");
    expect(screen.getByRole("button", { name: "Next →" })).toBeEnabled(); // nothing to re-enter
    await user.click(screen.getByRole("button", { name: "Replace Telegram bot token" }));
    await user.type(screen.getByLabelText(/Telegram bot token/, { selector: "input" }), "222222222:NEWNEWNEWNEWNEWNEWNEWNEWNEW");
    await user.click(screen.getByRole("button", { name: "Save securely" }));
    await waitFor(() => expect(api.ext.stored.get("TELEGRAM_BOT_TOKEN")).toBe("222222222:NEWNEWNEWNEWNEWNEWNEWNEWNEW"));
  });
});

describe("every service has a working wizard with official links and the right sign-in step", () => {
  for (const g of SERVICE_GUIDES.filter((x) => !x.configure)) {
    it(`${g.name}: six steps, https official links, and its own credential boxes only`, async () => {
      const user = userEvent.setup();
      renderAt(everything(), `/integrations/setup/${g.id}`);
      expect(await screen.findByText("Step 1 of 6")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Start →" }));
      await user.click(screen.getByRole("button", { name: "Next →" }));
      for (const a of screen.getAllByRole("link").filter((l) => l.getAttribute("target") === "_blank")) expect(a.getAttribute("href")).toMatch(/^https:\/\//);
      await user.click(screen.getByRole("button", { name: "I have what I need →" }));
      expect(screen.getByRole("heading", { level: 2, name: g.oauth ? "Sign in" : "Connect" })).toBeInTheDocument();
      for (const f of g.fields) expect(screen.getByText(f.label)).toBeInTheDocument();
      const others = SERVICE_GUIDES.filter((x) => x.id !== g.id && !g.fields.some((f) => x.fields.some((y) => y.secret === f.secret))).flatMap((x) => x.fields.map((f) => f.label));
      for (const label of others) expect(screen.queryByText(label)).not.toBeInTheDocument();
      if (g.oauth) {
        expect(screen.getByRole("region", { name: `${g.name} sign-in` })).toBeInTheDocument();
        expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument(); // never the Google password
      }
    });
  }
});

describe("addresses and tokens are checked before saving", () => {
  it("MCP: refuses local-program commands and plain http to the internet, accepts https and localhost; the token is optional", async () => {
    expect(checkEndpoint("npx @some/mcp-server", "MCP server").error).toMatch(/local-program servers are not/);
    expect(checkEndpoint("C:\\tools\\server.exe", "MCP server").error).toBeTruthy();
    expect(checkEndpoint("http://example.com/mcp", "MCP server").error).toMatch(/Plain http/);
    expect(checkEndpoint("https://user:pw@example.com/mcp", "MCP server").error).toMatch(/user name or password/);
    expect(checkEndpoint("https://example.com/mcp", "MCP server").error).toBeNull();
    expect(checkEndpoint("http://localhost:8080/mcp", "MCP server").error).toBeNull();
    const user = userEvent.setup();
    at("mcp", 3);
    renderAt(everything(), "/integrations/setup/mcp");
    expect(await screen.findByText("(optional)")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Server address/, { selector: "input" }), "npx some-mcp");
    expect(screen.getByRole("alert")).toHaveTextContent(/local-program servers are not/);
    expect(screen.getByRole("button", { name: "Save securely" })).toBeDisabled();
  });

  it("n8n: warns about the test address, and the test step explains why the webhook is not called", async () => {
    const user = userEvent.setup();
    const api = everything();
    at("n8n", 3);
    renderAt(api, "/integrations/setup/n8n");
    await user.type(await screen.findByLabelText(/n8n webhook address/, { selector: "input" }), "https://n8n.example.com/webhook-test/abc");
    expect(screen.getByText(/TEST address/)).toBeInTheDocument();
    cleanup();
    api.ext.secrets.find((s) => s.name === "N8N_WEBHOOK_URL")!.inVault = true;
    api.ext.verifyOutcome["n8n"] = { result: "not_testable", message: "cannot be tested" };
    at("n8n", 4);
    renderAt(api, "/integrations/setup/n8n");
    await user.click(await screen.findByRole("button", { name: "Test connection for n8n" }));
    expect(await screen.findByText(/The address looks right\. It is not called now/)).toBeInTheDocument();
  });

  it("token checks: Telegram shape, GitHub fine-grained preferred, Notion prefix", () => {
    expect(checkTelegramToken("123456789:AAabcdefghijklmnopqrstuvwxyz").error).toBeNull();
    expect(checkTelegramToken("123:abc").error).toBeTruthy();
    expect(checkGithubToken("github_pat_11ABCDEFGHIJKLMNOPQRSTUV").warning).toBeNull();
    expect(checkGithubToken("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345").warning).toMatch(/fine-grained/);
    expect(checkNotionSecret("ntn_ABCDEFGHIJKLMNOPQRSTUVWXYZ").warning).toBeNull();
    expect(checkNotionSecret("xyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ").warning).toMatch(/ntn_/);
  });
});

describe("GitHub: minimum permissions, save, disconnect and reconnect", () => {
  it("explains the least permissions, saves, disconnects from the last step, and can connect again", async () => {
    const user = userEvent.setup();
    const api = everything();
    at("github", 2);
    renderAt(api, "/integrations/setup/github");
    expect(await screen.findByText(/Only select repositories/)).toBeInTheDocument();
    expect(screen.getByText(/Contents: Read-only; Pull requests: Read-only; Issues: Read-only/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "I have what I need →" }));
    await user.type(screen.getByLabelText(/GitHub token/, { selector: "input" }), "github_pat_11FAKEFAKEFAKEFAKEFAKE00");
    await user.click(screen.getByRole("button", { name: "Save securely" }));
    await waitFor(() => expect(api.ext.stored.has("GITHUB_TOKEN")).toBe(true));
    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.click(screen.getByRole("button", { name: "Skip the test →" }));
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(api.ext.stored.has("GITHUB_TOKEN")).toBe(false));
    // reconnect
    at("github", 3);
    cleanup();
    renderAt(api, "/integrations/setup/github");
    await user.type(await screen.findByLabelText(/GitHub token/, { selector: "input" }), "github_pat_11AGAINAGAINAGAINAGAIN00");
    await user.click(screen.getByRole("button", { name: "Save securely" }));
    await waitFor(() => expect(api.ext.stored.get("GITHUB_TOKEN")).toBe("github_pat_11AGAINAGAINAGAINAGAIN00"));
  }, 30_000);
});

describe("Notion: sharing pages is explained", () => {
  it("tells the person to share each page with the integration", async () => {
    at("notion", 2);
    renderAt(everything(), "/integrations/setup/notion");
    expect(await screen.findByText(/choose the \.\.\. menu, then Connections/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open Notion integrations/ })[0]).toHaveAttribute("href", "https://www.notion.so/profile/integrations");
  });
});

describe("tutorials for every service", () => {
  it("each service has a step-by-step tutorial with what, needs, setup, connect, test and disconnect", async () => {
    const { tutorialById } = await import("./lib/integrationGuides");
    for (const g of SERVICE_GUIDES) {
      const t = tutorialById(g.id)!;
      expect(t.steps.map((s) => s.title)).toEqual(["What it does", "What you need", "Set it up", "Connect it", "Test it", "Disconnect"]);
    }
  });
});
