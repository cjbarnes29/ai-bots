import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path = "/settings/agents") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

const baseSkill = (over: Record<string, unknown> = {}) => ({
  id: "sk1",
  name: "Summaries",
  description: "d",
  instructions: "Summarise.",
  requiredTools: [],
  tags: [],
  enabled: true,
  archived: false,
  imported: false,
  version: 1,
  updatedAt: "",
  versions: [{ version: 1, name: "Summaries", changeNote: "Created", restoredFrom: null, createdAt: new Date().toISOString() }],
  ...over,
});

describe("Settings: Tools", () => {
  it("shows what is available, what needs setup and what does not exist, with the reason", async () => {
    renderApp(createFakeApi());
    const tools = within(await screen.findByRole("region", { name: "Tools" }));
    expect(within(await tools.findByRole("listitem", { name: "Tool Node.js" })).getByText("Available")).toBeInTheDocument();
    expect(within(tools.getByRole("listitem", { name: "Tool Gmail" })).getByText("Needs setup")).toBeInTheDocument();
    const docs = tools.getByRole("listitem", { name: "Tool Documents, spreadsheets and slides" });
    expect(within(docs).getByText("Not available")).toBeInTheDocument();
    expect(within(docs).getByText(/Not built yet/)).toBeInTheDocument();
    expect(within(tools.getByRole("listitem", { name: "Tool PowerShell / PC agent" })).getByText("Needs setup")).toBeInTheDocument();
  });
});

describe("Settings: Skill library", () => {
  it("creates a skill, which then appears in the list", async () => {
    const api = createFakeApi();
    renderApp(api);
    const lib = within(await screen.findByRole("region", { name: "Skills" }));
    expect(await lib.findByText("No skills yet.")).toBeInTheDocument();
    await userEvent.click(lib.getByRole("button", { name: "New skill" }));
    expect(lib.getByRole("button", { name: "Create skill" })).toBeDisabled();
    await userEvent.type(lib.getByLabelText("Skill name"), "Polite emails");
    await userEvent.type(lib.getByLabelText("Skill instructions"), "Greet by name.");
    await userEvent.click(lib.getByRole("button", { name: "Create skill" }));
    expect(await lib.findByRole("listitem", { name: "Skill Polite emails" })).toBeInTheDocument();
    expect(api.writes().find((w) => w.path === "/api/skills")?.body).toMatchObject({ name: "Polite emails", instructions: "Greet by name." });
  });

  it("shows the server message when a skill is refused (a secret in the text)", async () => {
    const api = createFakeApi();
    renderApp(api);
    const lib = within(await screen.findByRole("region", { name: "Skills" }));
    await userEvent.click(await lib.findByRole("button", { name: "New skill" }));
    await userEvent.type(lib.getByLabelText("Skill name"), "Leaky");
    await userEvent.type(lib.getByLabelText("Skill instructions"), "use AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    await userEvent.click(lib.getByRole("button", { name: "Create skill" }));
    expect(await lib.findByRole("alert")).toHaveTextContent(/must not contain keys, tokens or passwords/);
    expect(lib.queryByRole("listitem", { name: "Skill Leaky" })).not.toBeInTheDocument();
  });

  it("edits as a new version, duplicates, switches off, archives and restores", async () => {
    const api = createFakeApi();
    api.ext.skills.push(baseSkill());
    renderApp(api);
    const lib = within(await screen.findByRole("region", { name: "Skills" }));
    let row = within(await lib.findByRole("listitem", { name: "Skill Summaries" }));
    await userEvent.click(row.getByRole("button", { name: "Edit" }));
    const box = lib.getByLabelText("Skill instructions");
    await userEvent.clear(box);
    await userEvent.type(box, "Summarise in 3 bullets.");
    await userEvent.type(lib.getByLabelText("Change note"), "shorter");
    await userEvent.click(lib.getByRole("button", { name: "Save as a new version" }));
    await waitFor(() => expect(api.ext.skills[0].version).toBe(2));
    expect(api.writes().find((w) => w.method === "PATCH")?.body).toMatchObject({ instructions: "Summarise in 3 bullets.", changeNote: "shorter" });

    row = within(await lib.findByRole("listitem", { name: "Skill Summaries" }));
    await userEvent.click(row.getByRole("button", { name: "Duplicate" }));
    expect(await lib.findByRole("listitem", { name: "Skill Copy of Summaries" })).toBeInTheDocument();
    await userEvent.click(row.getByRole("button", { name: "Switch off Summaries" }));
    await waitFor(() => expect(api.ext.skills[0].enabled).toBe(false));
    await userEvent.click(row.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(api.ext.skills[0].archived).toBe(true));
    await userEvent.click(await lib.findByText(/Archived skills \(1\)/));
    await userEvent.click(await lib.findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.ext.skills[0].archived).toBe(false));
  });

  it("tries a skill on a sample and shows the answer and tokens used", async () => {
    const api = createFakeApi();
    api.ext.skills.push(baseSkill({ name: "Echo", instructions: "Echo." }));
    renderApp(api);
    const row = within(await screen.findByRole("listitem", { name: "Skill Echo" }));
    await userEvent.click(row.getByRole("button", { name: "More" }));
    await userEvent.type(await row.findByLabelText("Sample request"), "hello");
    await userEvent.click(row.getByRole("button", { name: /Try it/ }));
    expect(await row.findByText("TESTED: hello")).toBeInTheDocument();
    expect(row.getByText("15 tokens used.")).toBeInTheDocument();
  });

  it("imports a pasted file (arrives switched off) and rejects text that is not a skill file", async () => {
    const api = createFakeApi();
    renderApp(api);
    const lib = within(await screen.findByRole("region", { name: "Skills" }));
    await userEvent.click(await lib.findByText("Import a skill"));
    const box = lib.getByLabelText("Skill file to import");
    await userEvent.click(box);
    await userEvent.paste("not json at all");
    await userEvent.click(lib.getByRole("button", { name: "Import" }));
    expect(await lib.findByRole("alert")).toHaveTextContent(/could not be read/);
    await userEvent.clear(box);
    await userEvent.click(box);
    await userEvent.paste(JSON.stringify({ format: "awp-skill@1", name: "From a friend", description: "", instructions: "Be nice.", requiredTools: [], tags: [] }));
    await userEvent.click(lib.getByRole("button", { name: "Import" }));
    const row = within(await lib.findByRole("listitem", { name: "Skill From a friend" }));
    expect(row.getByText("imported")).toBeInTheDocument();
    expect(row.getByText("off")).toBeInTheDocument();
  });
});

describe("a bot Permissions tab: skills and tools", () => {
  it("gives a bot a skill and a tool, and will not offer an unavailable tool", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Helper" })]);
    api.ext.skills.push(baseSkill());
    renderApp(api, "/bots/b1");
    await userEvent.click(await screen.findByRole("tab", { name: /Permissions/ }));
    const section = within(await screen.findByRole("region", { name: "Skills and tools" }));
    await userEvent.click(await section.findByRole("checkbox", { name: "Summaries" }));
    await waitFor(() => expect(api.ext.botCaps.get("b1")?.skills).toEqual(["sk1"]));
    await userEvent.click(section.getByRole("checkbox", { name: "Node.js" }));
    await waitFor(() => expect(api.ext.botCaps.get("b1")?.tools).toEqual(["node"]));
    expect(section.getByRole("checkbox", { name: /Documents, spreadsheets and slides/ })).toBeDisabled();
    expect(section.queryByRole("checkbox", { name: /PowerShell \/ PC agent/ })).not.toBeInTheDocument(); // the PC agent has its own five permissions
    expect(section.queryByRole("checkbox", { name: "Gmail" })).not.toBeInTheDocument(); // connectors stay with the switches above
  });
});
