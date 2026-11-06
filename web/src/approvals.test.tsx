import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import type { Approval } from "./api/types";
import { createFakeApi, makeBot } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path = "/approvals") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const request = (over: Partial<Approval> = {}): Approval => ({
  id: crypto.randomUUID(), botId: "b1", botName: "Helper", taskId: null, connector: "telegram", connectorLabel: "Telegram", action: "send_message",
  summary: 'Send "Hello Sam" to sam', args: { chat: "sam", text: "Hello Sam\nSecond line" }, status: "pending", result: null, error: null,
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), decidedAt: null, decidedBy: null, executedAt: null, ...over,
});

describe("the Approvals page", () => {
  it("says plainly when nothing is connected or waiting", async () => {
    const api = createFakeApi();
    api.ext.connectors = [];
    renderApp(api);
    expect(await screen.findByText(/Nothing is waiting for approval/)).toBeInTheDocument();
    expect(screen.getByText(/No connections \(Gmail, Telegram, browser\) are installed yet/)).toBeInTheDocument();
  });

  it("says when a connection still needs its token", async () => {
    const api = createFakeApi();
    (api.ext.connectors[0] as any).notReady = "paste the bot token in the Integrations Center first.";
    renderApp(api);
    expect(await screen.findByText(/not set up yet: paste the bot token in the Integrations Center first/)).toBeInTheDocument();
  });

  it("shows the exact content of a waiting request, and nothing runs until you confirm", async () => {
    const api = createFakeApi();
    const r = request();
    api.ext.approvals.push(r);
    renderApp(api);
    const card = await screen.findByRole("listitem", { name: /Approval request/ });
    expect(within(card).getByText("sam")).toBeInTheDocument();
    expect(within(card).getByText(/Hello Sam/, { selector: "dd" })).toBeInTheDocument();
    expect(within(card).getByText(/Second line/, { selector: "dd" })).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "Approve…" }));
    expect(api.writes()).toHaveLength(0); // only a confirmation box so far
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.writes()).toHaveLength(0);
    expect(r.status).toBe("pending");
  });

  it("approving after confirming sends one request and moves it to the history", async () => {
    const api = createFakeApi();
    const r = request();
    api.ext.approvals.push(r);
    renderApp(api);
    await userEvent.click(await screen.findByRole("button", { name: "Approve…" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, do it once" }));
    await waitFor(() => expect(r.status).toBe("executed"));
    expect(api.writes().filter((w) => w.path.endsWith("/approve"))).toHaveLength(1);
    expect(await screen.findByRole("listitem", { name: /Past request/ })).toHaveTextContent("Done");
    expect(screen.getByText(/Nothing is waiting for approval/)).toBeInTheDocument();
  });

  it("denying never runs it", async () => {
    const api = createFakeApi();
    const r = request();
    api.ext.approvals.push(r);
    renderApp(api);
    await userEvent.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(() => expect(r.status).toBe("denied"));
    expect(r.executedAt).toBeNull();
    expect(api.writes().some((w) => w.path.endsWith("/approve"))).toBe(false);
  });

  it("shows why an approved action failed", async () => {
    const api = createFakeApi();
    api.ext.approvals.push(request());
    api.ext.executeError = "Telegram refused the message";
    renderApp(api);
    await userEvent.click(await screen.findByRole("button", { name: "Approve…" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, do it once" }));
    expect(await screen.findByText(/Telegram refused the message/)).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("the pause switch stops outside actions, and an approval attempt then shows the reason", async () => {
    const api = createFakeApi();
    const r = request();
    api.ext.approvals.push(r);
    renderApp(api);
    await userEvent.click(await screen.findByRole("button", { name: "Pause all outside actions" }));
    expect(await screen.findByText(/PAUSED: no outside action can be requested or approved/)).toBeInTheDocument();
    expect(api.ext.paused).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Approve…" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, do it once" }));
    expect(await screen.findByText(/All outside actions are paused\. Switch/)).toBeInTheDocument();
    expect(r.status).toBe("pending");
    await userEvent.click(screen.getByRole("button", { name: "Allow outside actions again" }));
    await waitFor(() => expect(api.ext.paused).toBe(false));
  });

  it("every change carries the client header", async () => {
    const api = createFakeApi();
    api.ext.approvals.push(request());
    renderApp(api);
    await userEvent.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes().every((w) => w.headers["x-awp-client"] === "dashboard")).toBe(true);
  });

  it("the menu shows how many requests are waiting", async () => {
    const api = createFakeApi();
    api.ext.approvals.push(request(), request());
    renderApp(api, "/");
    expect(await screen.findByRole("link", { name: /^Decisions & approvals, 2 waiting$/ })).toBeInTheDocument();
  });

  it("shows the security log", async () => {
    const api = createFakeApi();
    api.ext.audit.push({ id: 1, createdAt: new Date().toISOString(), kind: "approval.executed", actor: "owner", botId: null, detail: {} });
    renderApp(api);
    expect(await screen.findByText("approval.executed")).toBeInTheDocument();
  });
});

describe("the secrets vault panel (Settings)", () => {
  const KEY = "gsk_SUPERSECRETVALUE0123456789abcdef";

  it("saves a key, empties the box, and never shows the value again", async () => {
    const api = createFakeApi();
    renderApp(api, "/integrations");
    const box = await screen.findByLabelText("New value for GEMINI_API_KEY");
    expect(box).toHaveAttribute("type", "password");
    await userEvent.type(box, KEY);
    await userEvent.click(within(box.closest("form") as HTMLElement).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.ext.stored.get("GEMINI_API_KEY")).toBe(KEY));
    expect(await screen.findByText(/Saved in the vault/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("New value for GEMINI_API_KEY")).toHaveValue(""));
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(screen.getByLabelText("New value for GEMINI_API_KEY").closest("li")).toHaveTextContent("Replace the saved key");
  });

  it("will not save an empty key", async () => {
    const api = createFakeApi();
    renderApp(api, "/integrations");
    const box = await screen.findByLabelText("New value for GEMINI_API_KEY");
    expect(within(box.closest("form") as HTMLElement).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("removing asks first, and then deletes the stored key", async () => {
    const api = createFakeApi();
    api.ext.secrets[0]!.inVault = true;
    api.ext.stored.set("GEMINI_API_KEY", KEY);
    renderApp(api, "/integrations");
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(api.writes()).toHaveLength(0);
    const dialogButtons = screen.getAllByRole("button", { name: "Remove" });
    await userEvent.click(dialogButtons[dialogButtons.length - 1]!);
    await waitFor(() => expect(api.ext.stored.has("GEMINI_API_KEY")).toBe(false));
  });
});

// Since the 2026-11-04 redesign the Gmail sign-in lives in the Gmail wizard (Integrations Center > Gmail > Connect, step "Sign in").
const atGmailStep = (step: number) => localStorage.setItem("awp.setup.service.gmail", JSON.stringify({ step, done: Array.from({ length: step }, (_, i) => i) }));

describe("the Gmail sign-in (Gmail wizard)", () => {
  it("cannot start signing in until the client ID and secret are saved", async () => {
    const api = createFakeApi();
    atGmailStep(3);
    renderApp(api, "/integrations/setup/gmail");
    expect(await screen.findByText("Not set up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeDisabled();
    expect(screen.getByText(/127\.0\.0\.1:3000\/api\/gmail\/oauth\/callback/)).toBeInTheDocument();
  });

  it("opens Google's sign-in page in a new tab once the client is saved, and shows Connected afterwards", async () => {
    const api = createFakeApi();
    api.ext.secrets.find((s) => s.name === "GOOGLE_CLIENT_ID")!.inVault = true;
    api.ext.secrets.find((s) => s.name === "GOOGLE_CLIENT_SECRET")!.inVault = true;
    const open = vi.fn();
    vi.stubGlobal("open", open);
    atGmailStep(3);
    renderApp(api, "/integrations/setup/gmail");
    expect(await screen.findByText("Ready to sign in")).toBeInTheDocument();
    expect(screen.getByText(/Read your email/)).toBeInTheDocument(); // the permissions are explained before signing in
    expect(screen.getByText(/Send email as you \(every email waits for your approval first\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://accounts.example.test/auth?state=abc", "_blank", "noopener"));
    expect(api.writes().filter((w) => w.path === "/api/gmail/oauth/start")).toHaveLength(1);
    expect(api.writes().every((w) => w.headers["x-awp-client"] === "dashboard")).toBe(true);
    api.ext.gmail.connected = true;
    expect(await screen.findByText("Connected", {}, { timeout: 8000 })).toBeInTheDocument();
  }, 20_000);
});

describe("Send test email to myself (Gmail wizard, last step)", () => {
  it("is hidden until Gmail is connected, then queues a test for the chosen bot and points to Approvals", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Mailer" })]);
    api.ext.secrets.find((s) => s.name === "GOOGLE_CLIENT_ID")!.inVault = true;
    api.ext.secrets.find((s) => s.name === "GOOGLE_CLIENT_SECRET")!.inVault = true;
    atGmailStep(5);
    renderApp(api, "/integrations/setup/gmail");
    expect(await screen.findByText(/Gmail: /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send test email to myself" })).not.toBeInTheDocument();
    api.ext.gmail.connected = true;
    const button = await screen.findByRole("button", { name: "Send test email to myself" }, { timeout: 8000 });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(await screen.findByText(/owner@example\.com/)).toBeInTheDocument();
    expect(within(screen.getByText(/Queued a test email/).closest("p")!).getByRole("link", { name: "Approvals" })).toHaveAttribute("href", "/approvals");
    const posts = api.writes().filter((w) => w.path === "/api/gmail/test-email");
    expect(posts).toHaveLength(1);
    expect(Object.keys(posts[0]!.body as object)).toEqual(["botId"]); // the address is never sent from the page
  }, 20_000);
});
