import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import type { Approval } from "./api/types";
import { forgetProof } from "./lib/ownerProof";
import { createFakeApi } from "./test/fakeApi";

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderApp(api: { fetch: typeof fetch }, path = "/approvals") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}
afterEach(() => forgetProof());

const request = (over: Partial<Approval> = {}): Approval => ({
  id: crypto.randomUUID(), botId: "b1", botName: "Helper", taskId: null, connector: "telegram", connectorLabel: "Telegram", action: "send_message",
  summary: 'Send "Hello Sam" to sam', args: { chat: "sam", text: "Hello Sam" }, status: "pending", result: null, error: null,
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), decidedAt: null, decidedBy: null, executedAt: null, ...over,
});

describe("the Guardian banner", () => {
  it("says plainly that no Guardian is set up (nothing is protected or paused)", async () => {
    renderApp(createFakeApi());
    const note = await screen.findByRole("note", { name: "Guardian status" });
    expect(note).toHaveTextContent(/Guardian not set up/);
    expect(note).toHaveTextContent(/not protected against scripts/);
  });

  it("shows a calm line while the Guardian is running, with the tier limit and the presence reading", async () => {
    const api = createFakeApi();
    api.ext.guardian.configured = true;
    renderApp(api);
    const note = await screen.findByRole("note", { name: "Guardian status" });
    expect(note).toHaveTextContent(/Guardian running \(Tier A: development and supervised testing only\)/);
    expect(note).toHaveTextContent(/idle 2 of 15 min/);
  });

  it("shows a red alert with the reason and a link to the Guardian page when paused, and when it stops answering", async () => {
    const api = createFakeApi();
    api.ext.guardian.configured = true;
    api.ext.guardian.state = "PAUSED";
    renderApp(api);
    const alert = await screen.findByRole("alert", { name: "Guardian status" });
    expect(alert).toHaveTextContent(/Paused: PAUSED/);
    expect(within(alert).getByRole("link", { name: /Open the Guardian page to resume/ })).toHaveAttribute("href", "http://127.0.0.1:3100");
  });

  it("never shows a calm status when the Guardian is unreachable", async () => {
    const api = createFakeApi();
    api.ext.guardian.configured = true;
    api.ext.guardian.reachable = false;
    renderApp(api);
    expect(await screen.findByRole("alert", { name: "Guardian status" })).toHaveTextContent(/Guardian not responding/);
  });
});

describe("the owner passphrase prompt", () => {
  const setup = () => {
    const api = createFakeApi();
    api.ext.guardian.configured = true;
    const r = request();
    api.ext.approvals.push(r);
    return { api, r };
  };
  const approve = async (name = "Approve…") => {
    await userEvent.click(await screen.findByRole("button", { name }));
  };

  it("asks for the passphrase when an approval needs a proof, sends it to the Guardian (not the app), then retries", async () => {
    const { api, r } = setup();
    renderApp(api);
    await approve();
    await userEvent.click(await screen.findByRole("button", { name: "Yes, do it once" }));
    const dialog = await screen.findByRole("dialog", { name: /Owner passphrase needed/ });
    await userEvent.type(within(dialog).getByLabelText("Owner passphrase"), "correct horse battery staple");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(r.status).not.toBe("pending"));
    // the passphrase went only to the Guardian's address, and the app's request carried the proof, not the passphrase
    const sentToApp = api.requests.filter((q) => q.path.startsWith("/api/") && q.method !== "GET");
    expect(JSON.stringify(sentToApp)).not.toContain("correct horse");
    expect(api.requests.some((q) => q.path.startsWith("http://127.0.0.1:3100") === false && q.path.endsWith("/v1/command"))).toBe(false);
    const approves = api.requests.filter((q) => q.path.endsWith("/approve"));
    expect(approves).toHaveLength(2); // first refused, then retried with the proof
    expect(approves[0]!.headers["x-awp-proof"]).toBeUndefined();
    expect(approves[1]!.headers["x-awp-proof"]).toMatch(/^proof-/);
  });

  it("shows the Guardian's message for a wrong passphrase and does not approve", async () => {
    const { api, r } = setup();
    renderApp(api);
    await approve();
    await userEvent.click(await screen.findByRole("button", { name: "Yes, do it once" }));
    const dialog = await screen.findByRole("dialog", { name: /Owner passphrase needed/ });
    await userEvent.type(within(dialog).getByLabelText("Owner passphrase"), "totally wrong passphrase");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/not correct/);
    expect(within(dialog).getByLabelText("Owner passphrase")).toHaveValue(""); // the field is cleared
    expect(r.status).toBe("pending");
  });

  it("says to resume first when the Guardian is paused", async () => {
    const { api } = setup();
    api.ext.guardian.state = "PAUSED";
    renderApp(api);
    await approve();
    await userEvent.click(await screen.findByRole("button", { name: "Yes, do it once" }));
    const dialog = await screen.findByRole("dialog", { name: /Owner passphrase needed/ });
    await userEvent.type(within(dialog).getByLabelText("Owner passphrase"), "correct horse battery staple");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/Resume first/);
  });

  it("cancelling leaves the request pending", async () => {
    const { api, r } = setup();
    renderApp(api);
    await approve();
    await userEvent.click(await screen.findByRole("button", { name: "Yes, do it once" }));
    const dialog = await screen.findByRole("dialog", { name: /Owner passphrase needed/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Owner passphrase needed/ })).toBeNull());
    expect(r.status).toBe("pending");
  });

  it("does not ask at all when no Guardian is configured (the app behaves as before)", async () => {
    const api = createFakeApi();
    const r = request();
    api.ext.approvals.push(r);
    renderApp(api);
    await approve();
    await userEvent.click(await screen.findByRole("button", { name: "Yes, do it once" }));
    await waitFor(() => expect(r.status).not.toBe("pending"));
    expect(screen.queryByRole("dialog", { name: /Owner passphrase needed/ })).toBeNull();
  });
});
