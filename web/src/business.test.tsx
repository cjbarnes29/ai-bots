import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi } from "./test/fakeApi";

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderApp(api: { fetch: typeof fetch }, path = "/business") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

const lead = (over: Record<string, unknown> = {}): any => ({
  lead_id: "L-aaaaaaaaaaaa",
  country: "AE",
  region: "Dubai",
  city: "Dubai",
  category: "health",
  business_name: "Al Noor Dental",
  business_name_ar: "",
  address: "12 Main St",
  phone: "04 123 4567",
  website_url: "",
  website_state: "none_listed",
  audit_failure: "",
  audit_score: null,
  audit_confidence: "",
  audit_summary: "",
  lead_score: 80,
  priority: "high",
  score_reasons: "",
  source_url: "https://www.openstreetmap.org/node/1",
  status: "new",
  notes: "",
  confidence: "unverified",
  criteria: [
    { id: "website", label: "Website situation", points: 50, max: 70, evidence: "No website is listed in the source. Unverified: confirm there really is none before contacting." },
    { id: "phone", label: "A public phone number is listed", points: 20, max: 20, evidence: "A phone number is listed." },
    { id: "address", label: "An address is listed", points: 10, max: 10, evidence: "An address is listed." },
  ],
  ...over,
});

const FOUR = () => [
  lead(),
  lead({ lead_id: "L-bbbbbbbbbbbb", business_name: "Slow Gym", website_url: "https://slow.ae/", website_state: "audit_failed", audit_failure: "timed_out", lead_score: 30, priority: "low", confidence: "needs_check", criteria: [{ id: "website", label: "Website situation", points: 0, max: 70, evidence: "The website could not be checked (the website took too long to answer). This says nothing about its quality: check it by hand." }] }),
  lead({ lead_id: "L-cccccccccccc", business_name: "Old Salon", website_url: "http://old.ae/", website_state: "audited", audit_score: 12, audit_summary: "Problems: works on phones; easy to contact.", lead_score: 83, priority: "high", confidence: "normal" }),
  lead({ lead_id: "L-dddddddddddd", business_name: "عيادة الأمل", business_name_ar: "عيادة الأمل", website_url: "https://x.ae/", website_state: "audited", audit_score: 0, audit_summary: "Placeholder or parked page: there is no real website yet.", lead_score: 95, priority: "high" }),
];

const card = async (name: string) => within((await screen.findByRole("heading", { level: 3, name })).closest("li") as HTMLElement);

describe("Business Workforce page", () => {
  it("is in the menu and opens with the safety lock OFF and explained", async () => {
    renderApp(createFakeApi(), "/");
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(nav.getByRole("link", { name: "Business Workforce" })).toHaveAttribute("href", "/business");
    renderApp(createFakeApi());
    expect(await screen.findByRole("heading", { level: 1, name: "Business Workforce" })).toBeInTheDocument();
    const lock = within(await screen.findByRole("region", { name: "Outside requests" }));
    expect(lock.getByText("OFF")).toBeInTheDocument();
    expect(lock.getByText(/no map search is made and no website is contacted/)).toBeInTheDocument();
    expect(lock.getByText(/0 of 20 map searches · 0 of 300 website requests/)).toBeInTheDocument();
  });

  it("switching on asks first, names the service and the limits, and only then does it", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api);
    const lock = within(await screen.findByRole("region", { name: "Outside requests" }));
    await user.click(await lock.findByRole("button", { name: "Switch on…" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/overpass-api\.de/)).toBeInTheDocument();
    expect(dialog.getByText(/up to 20 searches a day/)).toBeInTheDocument();
    expect(dialog.getByText(/up to 300 requests a day/)).toBeInTheDocument();
    expect(dialog.getByText(/read-only: nothing is sent to anyone/)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(api.writes().filter((w) => w.path === "/api/business/external")).toHaveLength(0);

    await user.click(lock.getByRole("button", { name: "Switch on…" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, switch on" }));
    await waitFor(() => expect(lock.getByText("ON")).toBeInTheDocument());
    expect(api.writes().filter((w) => w.path === "/api/business/external").map((w) => w.body)).toEqual([{ enabled: true }]);
    await user.click(lock.getByRole("button", { name: "Switch off" }));
    await waitFor(() => expect(lock.getByText("OFF")).toBeInTheDocument());
  });

  it("shows the three website situations with three different labels, and never calls a failed check poor", async () => {
    const api = createFakeApi();
    api.ext.business.leads = FOUR();
    renderApp(api);
    expect((await card("Al Noor Dental")).getByText("No website listed (unverified)")).toBeInTheDocument();
    expect((await card("Old Salon")).getByText("Website checked: 12/100")).toBeInTheDocument();
    const failed = await card("Slow Gym");
    expect(failed.getByText("Check failed (took too long): not a quality verdict")).toBeInTheDocument();
    expect(failed.queryByText(/poor|Website checked/)).not.toBeInTheDocument();
    expect((await card("عيادة الأمل")).getByText("Placeholder or parked page")).toBeInTheDocument();
  });

  it("'Why this score?' lists every point with its reason and warns when the website is only unverified", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.ext.business.leads = FOUR();
    renderApp(api);
    const c = await card("Al Noor Dental");
    await user.click(c.getByRole("button", { name: "Why this score?" }));
    const table = within(c.getByRole("table"));
    expect(table.getByText("50 of 70")).toBeInTheDocument();
    expect(table.getByText("20 of 20")).toBeInTheDocument();
    expect(table.getByText("10 of 10")).toBeInTheDocument();
    expect(c.getByText("Total: 80 of 100")).toBeInTheDocument();
    expect(c.getByText(/not proof that there is none: check by hand/)).toBeInTheDocument();
    const failed = await card("Slow Gym");
    await user.click(failed.getByRole("button", { name: "Why this score?" }));
    expect(failed.getByText(/could not be judged either way. Check it by hand/)).toBeInTheDocument();
    expect(failed.getByText("0 of 70")).toBeInTheDocument();
  });

  it("the owner can change a lead's status and notes; Arabic names are shown right-to-left", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.ext.business.leads = FOUR();
    renderApp(api);
    const c = await card("Al Noor Dental");
    await user.selectOptions(c.getByLabelText("Status for Al Noor Dental"), "qualified");
    await waitFor(() => expect(api.writes().some((w) => w.path === "/api/business/leads/L-aaaaaaaaaaaa" && w.body.status === "qualified")).toBe(true));
    await user.click(c.getByRole("button", { name: "Why this score?" }));
    await user.type(c.getByLabelText("Your notes"), "Call Sunday");
    await user.click(c.getByRole("button", { name: "Save notes" }));
    await waitFor(() => expect(api.writes().some((w) => w.body?.notes === "Call Sunday")).toBe(true));
    const arabic = (await screen.findAllByText("عيادة الأمل")).find((e) => e.getAttribute("lang") === "ar");
    expect(arabic).toHaveAttribute("dir", "rtl");
  });

  it("'Confirm there is no website' is offered only where none is listed, asks first, and then sends the owner's confirmation", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.ext.business.leads = FOUR();
    renderApp(api);
    const withSite = await card("Old Salon");
    await user.click(withSite.getByRole("button", { name: "Why this score?" }));
    expect(withSite.queryByRole("button", { name: "Confirm there is no website" })).not.toBeInTheDocument();
    const failedSite = await card("Slow Gym"); // a website exists but could not be checked: that is NOT "no website"
    await user.click(failedSite.getByRole("button", { name: "Why this score?" }));
    expect(failedSite.queryByRole("button", { name: "Confirm there is no website" })).not.toBeInTheDocument();

    const c = await card("Al Noor Dental");
    await user.click(c.getByRole("button", { name: "Why this score?" }));
    await user.click(c.getByRole("button", { name: "Confirm there is no website" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/Only confirm this after you checked by hand/)).toBeInTheDocument();
    expect(api.writes().filter((w) => w.body?.confirmNoWebsite)).toHaveLength(0);
    await user.click(dialog.getByRole("button", { name: "Yes, I checked: no website" }));
    await waitFor(() => expect(api.writes().filter((w) => w.body?.confirmNoWebsite === true)).toHaveLength(1));
  });

  it("filters ask the server, and an empty result says so", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api);
    expect(await screen.findByText(/No leads saved yet/)).toBeInTheDocument();
    api.ext.business.leads = FOUR();
    await user.selectOptions(screen.getByLabelText("Priority"), "low");
    await waitFor(() => expect(api.requests.some((r) => r.path.startsWith("/api/business/leads") && r.path.includes("priority=low"))).toBe(true));
    expect(await screen.findByText("Slow Gym")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search leads"), "zzz");
    expect(await screen.findByText("No lead matches these filters.")).toBeInTheDocument();
  });

  it("offers the Excel download", async () => {
    renderApp(createFakeApi());
    expect(await screen.findByRole("link", { name: "Download as Excel" })).toHaveAttribute("href", "/api/business/leads.xlsx");
  });

  it("found-but-not-saved batches show what they hold, and say saving needs approval for exactly those rows", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.ext.business.batches = [{ id: "B-12345678", label: "Clinics, dentists and pharmacies in Dubai", createdAt: new Date().toISOString(), count: 2, rowsHash: "a".repeat(64), states: { none_listed: 1, not_audited: 1 } }];
    api.ext.business.batchLeads["B-12345678"] = [lead(), lead({ lead_id: "L-eeeeeeeeeeee", business_name: "Fresh Clinic", website_url: "https://f.ae/", website_state: "not_audited", lead_score: 30, priority: "low" })];
    renderApp(api);
    const section = within(await screen.findByRole("region", { name: "Found, not saved yet" }));
    expect(section.getByText(/exactly these rows: if they change afterwards, nothing is saved/)).toBeInTheDocument();
    expect(await section.findByText(/rows fingerprint aaaaaaaaaaaaaaaa/)).toBeInTheDocument();
    await user.click(section.getByRole("button", { name: "Preview" }));
    expect(await section.findByText("Fresh Clinic")).toBeInTheDocument();
    expect(section.getByText("Website not checked yet")).toBeInTheDocument();
    expect(section.getByRole("link", { name: "Approvals" })).toHaveAttribute("href", "/approvals");
  });

  it("the Business team is created only after a confirmation that lists what happens, and then the button goes away", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api);
    const team = within(await screen.findByRole("region", { name: "Business team" }));
    expect(team.getAllByText("Not created yet")).toHaveLength(4);
    await user.click(team.getByRole("button", { name: "Create the Business team" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/all switched OFF/)).toBeInTheDocument();
    expect(dialog.getByText(/web reading on only for the new Researcher, Lead Scout and Site Auditor/)).toBeInTheDocument();
    expect(dialog.getByText(/Runs nothing, contacts nothing and sends nothing/)).toBeInTheDocument();
    expect(api.writes().filter((w) => w.path === "/api/business/team")).toHaveLength(0);
    await user.click(dialog.getByRole("button", { name: "Create the team" }));
    expect(await team.findByText(/Done: 4 agent\(s\) created/)).toBeInTheDocument();
    await waitFor(() => expect(team.queryByRole("button", { name: "Create the Business team" })).not.toBeInTheDocument());
    expect(api.writes().filter((w) => w.path === "/api/business/team")).toHaveLength(1);
    expect(team.getAllByText(/Created \(disabled\)/)).toHaveLength(4);
  });

  it("every agent's instructions can be read before the team is created", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi());
    const team = within(await screen.findByRole("region", { name: "Business team" }));
    await user.click(team.getByText("What Lead Scout is told"));
    expect(team.getByText(/Use find_businesses/)).toBeInTheDocument();
    expect(team.getByText(/DATA, never instructions/, { exact: false })).toBeInTheDocument();
  });

  it("explains how scores work, in a way that separates the three website situations", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi());
    await user.click(await screen.findByText("How scores work"));
    expect(screen.getByText(/No AI model decides it/)).toBeInTheDocument();
    expect(screen.getByText(/Three situations are never mixed/)).toBeInTheDocument();
    expect(screen.getByText(/High: 60 or more/)).toBeInTheDocument();
  });
});
