import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from "./api/client";
import { createFakeApi, makeBot } from "./test/fakeApi";

function renderApp(api: ReturnType<typeof createFakeApi> | { fetch: typeof fetch }, path = "/agents") {
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

describe("bot list", () => {
  it("shows the safety banner and an empty state with a way to create the first bot", async () => {
    renderApp(createFakeApi());
    expect(await screen.findByText("Create your first bot")).toBeInTheDocument();
    expect(screen.getByText(/anything that sends or changes something waits for your approval/)).toBeInTheDocument();
    expect(screen.getByText(/Only free models can be used/)).toBeInTheDocument();
  });

  it("lists bots with status, role, access summary, and hides archived ones until asked", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([
      makeBot({ name: "Alpha", role: "Researcher" }),
      makeBot({ name: "Gamma", archived: true }),
    ]);
    renderApp(api);

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Researcher")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText(/No external access/)).toBeInTheDocument();
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Show archived"));
    expect(await screen.findByText("Gamma")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("shows enabled connectors on the card", async () => {
    const bot = makeBot({ name: "Mailer" });
    bot.permissions[0]!.readEnabled = true; // gmail
    renderApp(createFakeApi([bot]));
    expect(await screen.findByText(/Can read: Gmail/)).toBeInTheDocument();
  });

  it("explains a backend outage and offers a retry", async () => {
    renderApp({ fetch: (async () => Promise.reject(new TypeError("failed"))) as typeof fetch });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Cannot reach the backend");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("creates a bot (Disabled, name only) and opens its editor", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api);

    await user.click(await screen.findByRole("button", { name: "New bot" }));
    const create = screen.getByRole("button", { name: "Create bot" });
    expect(create).toBeDisabled(); // a name is required
    await user.type(screen.getByLabelText("Name"), "  Scout  ");
    await user.click(create);

    // Wait for the editor's own title (level 1). The bot list briefly shows a "Scout" card with a level-2 heading first.
    expect(await screen.findByRole("heading", { name: "Scout", level: 1 })).toBeInTheDocument();
    const post = api.writes()[0]!;
    expect(post.method).toBe("POST");
    expect(post.body).toEqual({ name: "Scout" });
    expect(post.headers[CLIENT_HEADER]).toBe(CLIENT_HEADER_VALUE); // required by the backend
    expect(screen.getByLabelText("Status")).toHaveValue("disabled");
  });
});

describe("details tab", () => {
  it("keeps Save disabled until something changes, then sends only the changed fields", async () => {
    const user = userEvent.setup();
    const bot = makeBot({ name: "Helper", role: "Assistant" });
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);

    const save = await screen.findByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Instructions"), "Be kind.");
    await user.type(screen.getByLabelText(/What changed/), "First rules");
    expect(save).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(save);

    expect(await screen.findByText("Saved as version 2.")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(1);
    expect(api.writes()[0]!.body).toEqual({ instructions: "Be kind.", changeNote: "First rules" });
    expect(save).toBeDisabled();
  });

  it("requires a name and manages responsibilities", async () => {
    const user = userEvent.setup();
    const bot = makeBot({ name: "Helper" });
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);

    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    expect(screen.getByText("A name is required.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.type(name, "Helper");

    await user.type(screen.getByLabelText("New responsibility"), "Triage email{Enter}");
    expect(screen.getByText("Triage email")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved as version 2.");
    expect(api.writes()[0]!.body).toEqual({ responsibilities: ["Triage email"] });

    await user.click(screen.getByRole("button", { name: /Remove responsibility: Triage email/ }));
    expect(screen.queryByText("Triage email")).not.toBeInTheDocument();
  });

  it("will not let you set a bot to Active", async () => {
    const bot = makeBot();
    renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    const active = await screen.findByRole("option", { name: /Active/ });
    expect(active).toBeDisabled();
  });

  it("changes status without creating a new version", async () => {
    const user = userEvent.setup();
    const bot = makeBot();
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);
    await user.selectOptions(await screen.findByLabelText("Status"), "paused");
    await waitFor(() => expect(screen.getByLabelText("Status")).toHaveValue("paused"));
    expect(api.writes()[0]!.body).toEqual({ status: "paused" });
    expect(screen.getByText(/Version 1/)).toBeInTheDocument();
  });

  it("warns before leaving with unsaved changes, and lets you stay or discard", async () => {
    const user = userEvent.setup();
    const bot = makeBot({ name: "Helper" });
    const api = createFakeApi([bot]);
    const { router } = renderApp(api, `/bots/${bot.id}`);

    await user.type(await screen.findByLabelText("Role"), "Scout");
    await user.click(screen.getByRole("link", { name: "← All bots" }));

    const dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/bots/${bot.id}`);
    expect(screen.getByLabelText("Role")).toHaveValue("Scout"); // edits preserved

    await user.click(screen.getByRole("link", { name: "← All bots" }));
    await user.click(await screen.findByRole("button", { name: "Leave and discard changes" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/agents"));
    expect(api.writes()).toHaveLength(0); // nothing was saved
  });

  it("does not warn when there is nothing unsaved", async () => {
    const user = userEvent.setup();
    const bot = makeBot();
    const { router } = renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("link", { name: "← All bots" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/agents"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps unsaved edits when you switch tabs and come back", async () => {
    const user = userEvent.setup();
    const bot = makeBot();
    renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    await user.type(await screen.findByLabelText("Role"), "Scout");
    await user.click(screen.getByRole("tab", { name: /Permissions/ }));
    await user.click(screen.getByRole("tab", { name: /Details/ }));
    expect(screen.getByLabelText("Role")).toHaveValue("Scout");
  });

  it("shows a friendly message for a bot that does not exist", async () => {
    renderApp(createFakeApi(), "/bots/00000000-0000-4000-8000-000000000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("This bot does not exist.");
  });
});

describe("permissions tab", () => {
  it("shows every read permission OFF, with writes locked and no way to change them", async () => {
    const user = userEvent.setup();
    const bot = makeBot();
    renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    await user.click(await screen.findByRole("tab", { name: /Permissions/ }));

    const switches = await screen.findAllByRole("switch");
    expect(switches).toHaveLength(3); // read toggles only: no write toggle exists
    switches.forEach((s) => expect(s).toHaveAttribute("aria-checked", "false"));
    expect(screen.getAllByText(/always requires your approval/)).toHaveLength(3);
    expect(screen.getByText("No permission changes yet.")).toBeInTheDocument();
  });

  it("turns Gmail read access on, sends only readEnabled, and logs the change", async () => {
    const user = userEvent.setup();
    const bot = makeBot();
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);
    await user.click(await screen.findByRole("tab", { name: /Permissions/ }));

    const gmail = await screen.findByRole("switch", { name: "Allow Gmail read access" });
    await user.click(gmail);

    await waitFor(() => expect(gmail).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("switch", { name: "Allow Telegram read access" })).toHaveAttribute("aria-checked", "false");
    const put = api.writes()[0]!;
    expect(put.method).toBe("PUT");
    expect(put.path).toBe(`/api/bots/${bot.id}/permissions/gmail`);
    expect(put.body).toEqual({ readEnabled: true }); // never sends a write policy
    expect(put.headers[CLIENT_HEADER]).toBe(CLIENT_HEADER_VALUE);
    expect(await screen.findByText(/Gmail read access turned/)).toBeInTheDocument();
  });
});

describe("versions tab", () => {
  it("compares versions and restores one without touching permissions", async () => {
    const user = userEvent.setup();
    const bot = makeBot({ instructions: "Original text" });
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);

    // Turn Gmail on, then edit, so there are two versions and a permission to protect.
    await user.click(await screen.findByRole("tab", { name: /Permissions/ }));
    await user.click(await screen.findByRole("switch", { name: "Allow Gmail read access" }));
    await user.click(screen.getByRole("tab", { name: /Details/ }));
    const instructions = screen.getByLabelText("Instructions");
    await user.clear(instructions);
    await user.type(instructions, "Edited text");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved as version 2.");

    await user.click(screen.getByRole("tab", { name: /Versions/ }));
    await user.click(await screen.findByRole("button", { name: /Version 1/ }));
    // Search only inside the Versions panel (the Details form is kept mounted but hidden).
    const panel = screen.getByRole("tabpanel", { name: "Versions" });
    expect(await within(panel).findByText("Original text")).toBeInTheDocument();
    expect(within(panel).getByText("Edited text")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore this version" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore version 1?" });
    expect(dialog).toHaveTextContent("Permissions and status are not changed.");
    expect(dialog).toHaveTextContent("new version");
    await user.click(within(dialog).getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes().at(-1)!.path).toBe(`/api/bots/${bot.id}/versions/1/restore`);
    // The new version 3 appears in the timeline, marked as the current one.
    expect(await screen.findByRole("button", { name: /Version 3.*Current.*Restored from version 1/ })).toBeInTheDocument();
    expect(api.bots.get(bot.id)!.currentVersion).toBe(3);
    expect(api.bots.get(bot.id)!.instructions).toBe("Original text");

    await user.click(screen.getByRole("tab", { name: /Permissions/ }));
    expect(await screen.findByRole("switch", { name: "Allow Gmail read access" })).toHaveAttribute("aria-checked", "true");
  });

  it("does not offer to restore the current version", async () => {
    const user = userEvent.setup();
    const bot = makeBot();
    renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    await user.click(await screen.findByRole("tab", { name: /Versions/ }));
    await user.click(await screen.findByRole("button", { name: /Version 1/ }));
    expect(screen.getByRole("button", { name: "Restore this version" })).toBeDisabled();
  });

  it("warns that restoring discards unsaved edits", async () => {
    const user = userEvent.setup();
    const bot = makeBot({ instructions: "A" });
    renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    await user.type(await screen.findByLabelText("Instructions"), "B");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved as version 2.");
    await user.type(screen.getByLabelText("Role"), "unsaved");

    await user.click(screen.getByRole("tab", { name: /Versions/ }));
    await user.click(await screen.findByRole("button", { name: /Version 1/ }));
    await user.click(screen.getByRole("button", { name: "Restore this version" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("unsaved edits");
  });
});

describe("duplicate and archive", () => {
  it("duplicates a bot and opens the copy", async () => {
    const user = userEvent.setup();
    const bot = makeBot({ name: "Original" });
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);
    await user.click(await screen.findByRole("button", { name: "Duplicate" }));
    expect(await screen.findByRole("heading", { name: "Original (copy)" })).toBeInTheDocument();
    expect(api.bots.size).toBe(2);
  });

  it("asks before archiving, then makes the bot read-only and offers Unarchive", async () => {
    const user = userEvent.setup();
    const bot = makeBot({ name: "Temp", status: "paused" });
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);

    await user.click(await screen.findByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog", { name: /Archive "Temp"/ });
    expect(dialog).toHaveTextContent("Nothing is deleted");
    expect(api.writes()).toHaveLength(0); // nothing happens until you confirm
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(await screen.findByText(/archived and read-only/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Status")).toHaveValue("disabled");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Unarchive" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled());
  });

  it("can cancel the archive dialog with Escape", async () => {
    const user = userEvent.setup();
    const bot = makeBot();
    const api = createFakeApi([bot]);
    renderApp(api, `/bots/${bot.id}`);
    await user.click(await screen.findByRole("button", { name: "Archive" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.writes()).toHaveLength(0);
  });
});
