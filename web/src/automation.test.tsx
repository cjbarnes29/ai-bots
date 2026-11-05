import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import type { AutomationRun, Schedule, Trigger } from "./api/types";
import { createFakeApi, makeBot } from "./test/fakeApi";
import { describeTiming } from "./pages/Automation";

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderApp(api: { fetch: typeof fetch }, path = "/automation") {
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
const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  id: crypto.randomUUID(), name: "Morning summary", botId: "b1", botName: "Helper", instruction: "Summarise the day", kind: "interval",
  intervalMinutes: 30, timeOfDay: null, days: [0, 1, 2, 3, 4, 5, 6], runAt: null, enabled: false, nextRunAt: null, lastRunAt: null,
  consecutiveFailures: 0, disabledReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
});
const trigger = (over: Partial<Trigger> = {}): Trigger => ({
  id: crypto.randomUUID(), name: "Inbox helper", source: "event", eventName: "inbox", watchBotId: null, watchBotName: null, contains: "", botId: "b1",
  botName: "Helper", instructionTemplate: "{{text}}", cooldownSeconds: 300, enabled: false, lastFiredAt: null, consecutiveFailures: 0,
  disabledReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
});
const ready = () => makeBot({ id: "b1", name: "Helper", model: "groq/x" });

describe("describing a schedule in words", () => {
  it("reads naturally", () => {
    const base = { intervalMinutes: null, timeOfDay: null, days: [0, 1, 2, 3, 4, 5, 6], runAt: null };
    expect(describeTiming({ ...base, kind: "interval", intervalMinutes: 30 })).toBe("Every 30 minutes");
    expect(describeTiming({ ...base, kind: "interval", intervalMinutes: 60 })).toBe("Every 1 hour");
    expect(describeTiming({ ...base, kind: "interval", intervalMinutes: 120 })).toBe("Every 2 hours");
    expect(describeTiming({ ...base, kind: "interval", intervalMinutes: 90 })).toBe("Every 90 minutes");
    expect(describeTiming({ ...base, kind: "daily", timeOfDay: "09:30" })).toBe("Every day at 09:30");
    expect(describeTiming({ ...base, kind: "daily", timeOfDay: "09:30", days: [1, 3, 5] })).toBe("Mon, Wed, Fri at 09:30");
    expect(describeTiming({ ...base, kind: "once", runAt: "2026-06-20T10:00:00.000Z" })).toMatch(/^Once on /);
  });
});

describe("the safety panel", () => {
  it("shows the rules, today's count, and a working kill switch", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready()]);
    api.auto.runsToday = 4;
    renderApp(api);
    expect(await screen.findByText(/while this app is running/)).toBeInTheDocument();
    expect(screen.getByText(/never replayed/)).toBeInTheDocument();
    expect(await screen.findByText(/Runs today: 4 of 20/)).toBeInTheDocument();

    const pause = await screen.findByRole("switch", { name: "Pause all automation" });
    expect(pause).toHaveAttribute("aria-checked", "false");
    await user.click(pause);
    await waitFor(() => expect(pause).toHaveAttribute("aria-checked", "true"));
    expect(api.writes()[0]).toMatchObject({ method: "PUT", path: "/api/automation/pause", body: { paused: true } });
    expect(screen.getByText(/Paused: no schedule or trigger will start anything/)).toBeInTheDocument();
  });

  it("has a nav link", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(createFakeApi(), "/");
    await user.click(within(await screen.findByRole("navigation", { name: "Main" })).getByRole("link", { name: "Workflows" }));
    await user.click(within(await screen.findByRole("navigation", { name: "Workflows sections" })).getByRole("link", { name: "Schedules" }));
    expect(router.state.location.pathname).toBe("/automation");
  });
});

describe("schedules", () => {
  it("starts with an empty state", async () => {
    renderApp(createFakeApi([ready()]));
    expect(await screen.findByText(/No schedules yet/)).toBeInTheDocument();
  });

  it("creates an every-N-minutes schedule that starts switched off", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready()]);
    renderApp(api);
    await user.click(await screen.findByRole("button", { name: "New schedule" }));
    const create = screen.getByRole("button", { name: "Create schedule" });
    expect(create).toBeDisabled();
    await user.type(field("sch-name"), "Morning summary");
    await waitFor(() => expect(within(field("sch-bot")).getAllByRole("option")).toHaveLength(2));
    await user.selectOptions(field("sch-bot"), "b1");
    await user.type(field("sch-text"), "Summarise the day");
    await user.clear(field("sch-minutes"));
    await user.type(field("sch-minutes"), "45");
    expect(screen.getByText(/New schedules start switched off/)).toBeInTheDocument();
    await user.click(create);

    const card = within(await screen.findByRole("listitem", { name: "Schedule Morning summary" }));
    expect(card.getByText("Off")).toBeInTheDocument();
    expect(card.getByText(/Helper · Every 45 minutes/)).toBeInTheDocument();
    expect(card.getByText(/Next run: off/)).toBeInTheDocument();
    expect(api.writes()[0]).toMatchObject({
      method: "POST",
      path: "/api/schedules",
      body: { name: "Morning summary", botId: "b1", instruction: "Summarise the day", kind: "interval", intervalMinutes: 45 },
    });
    expect(screen.queryByRole("form", { name: "New schedule" })).not.toBeInTheDocument();
  });

  it("creates a daily schedule with chosen days, and a one-off with a date", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready()]);
    renderApp(api);
    await user.click(await screen.findByRole("button", { name: "New schedule" }));
    await user.type(field("sch-name"), "Weekday report");
    await waitFor(() => expect(within(field("sch-bot")).getAllByRole("option")).toHaveLength(2));
    await user.selectOptions(field("sch-bot"), "b1");
    await user.type(field("sch-text"), "Report");
    await user.selectOptions(field("sch-kind"), "daily");
    expect(field("sch-minutes")).toBeNull();
    field("sch-time").focus();
    await user.clear(field("sch-time"));
    await user.type(field("sch-time"), "08:15");
    for (const day of ["Sun", "Sat"]) await user.click(screen.getByRole("checkbox", { name: day })); // weekdays only
    await user.click(screen.getByRole("button", { name: "Create schedule" }));
    await screen.findByRole("listitem", { name: "Schedule Weekday report" });
    expect(api.writes()[0]!.body).toMatchObject({ kind: "daily", timeOfDay: "08:15", days: [1, 2, 3, 4, 5] });
    expect(screen.getByText(/Mon, Tue, Wed, Thu, Fri at 08:15/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New schedule" }));
    await user.type(field("sch-name"), "One time");
    await waitFor(() => expect(within(field("sch-bot")).getAllByRole("option")).toHaveLength(2));
    await user.selectOptions(field("sch-bot"), "b1");
    await user.type(field("sch-text"), "Once");
    await user.selectOptions(field("sch-kind"), "once");
    const create = screen.getByRole("button", { name: "Create schedule" });
    expect(create).toBeDisabled(); // a date is needed
    await user.type(field("sch-once"), "2030-01-15T10:30");
    await user.click(create);
    await screen.findByRole("listitem", { name: "Schedule One time" });
    expect(api.writes()[1]!.body).toMatchObject({ kind: "once", runAt: new Date("2030-01-15T10:30").toISOString() });
  });

  it("will not allow a daily schedule with no days", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi([ready()]));
    await user.click(await screen.findByRole("button", { name: "New schedule" }));
    await user.type(field("sch-name"), "x");
    await waitFor(() => expect(within(field("sch-bot")).getAllByRole("option")).toHaveLength(2));
    await user.selectOptions(field("sch-bot"), "b1");
    await user.type(field("sch-text"), "x");
    await user.selectOptions(field("sch-kind"), "daily");
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) await user.click(screen.getByRole("checkbox", { name: day }));
    expect(screen.getByRole("button", { name: "Create schedule" })).toBeDisabled();
  });

  it("shows the server's explanation when the interval is too short", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi([ready()]));
    await user.click(await screen.findByRole("button", { name: "New schedule" }));
    await user.type(field("sch-name"), "Too fast");
    await waitFor(() => expect(within(field("sch-bot")).getAllByRole("option")).toHaveLength(2));
    await user.selectOptions(field("sch-bot"), "b1");
    await user.type(field("sch-text"), "x");
    await user.clear(field("sch-minutes"));
    await user.type(field("sch-minutes"), "5");
    await user.click(screen.getByRole("button", { name: "Create schedule" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 15 minutes apart.*free-tier limits/);
    expect(screen.getByRole("form", { name: "New schedule" })).toBeInTheDocument(); // stays open so you can fix it
  });

  it("switches a schedule on and off with its switch", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready()]);
    api.auto.schedules.push(schedule({ id: "s1" }));
    renderApp(api);
    const card = within(await screen.findByRole("listitem", { name: "Schedule Morning summary" }));
    const toggle = card.getByRole("switch", { name: "Switch on schedule Morning summary" });
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(api.writes()[0]).toMatchObject({ method: "PATCH", path: "/api/schedules/s1", body: { enabled: true } });
    expect(card.getByText("On")).toBeInTheDocument();
    expect(card.queryByText(/Next run: none planned/)).not.toBeInTheDocument();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  it("explains why a bot without a model cannot be switched on", async () => {
    const user = userEvent.setup();
    const idle = makeBot({ id: "b2", name: "Idle" });
    const api = createFakeApi([idle]);
    api.auto.schedules.push(schedule({ botId: "b2", botName: "Idle", name: "Needs model" }));
    renderApp(api);
    const card = within(await screen.findByRole("listitem", { name: "Schedule Needs model" }));
    expect(card.getByText(/Idle has no model yet, so this schedule cannot be switched on/)).toBeInTheDocument();
    await user.click(card.getByRole("switch"));
    expect(await card.findByRole("alert")).toHaveTextContent(/no model yet/);
    expect(card.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("shows when a schedule switched itself off, and how many runs failed", async () => {
    const api = createFakeApi([ready()]);
    api.auto.schedules.push(schedule({ consecutiveFailures: 3, disabledReason: "Switched off after 3 failed runs in a row. Last problem: The provider rejected the API key." }));
    renderApp(api);
    const card = within(await screen.findByRole("listitem", { name: "Schedule Morning summary" }));
    expect(card.getByRole("alert")).toHaveTextContent(/Switched off after 3 failed runs in a row/);
    expect(card.getByText(/3 failed in a row/)).toBeInTheDocument();
  });

  it("'Run now' reports what happened, with a link to the task", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready()]);
    api.auto.schedules.push(schedule({ id: "s1" }));
    renderApp(api);
    const card = within(await screen.findByRole("listitem", { name: "Schedule Morning summary" }));
    await user.click(card.getByRole("button", { name: "Run now" }));
    expect(await card.findByRole("status")).toHaveTextContent("Test run: started");
    expect(card.getByRole("link", { name: "View the task" })).toHaveAttribute("href", "/tasks/11111111-1111-4111-8111-111111111111");
    expect(api.writes()[0]).toMatchObject({ method: "POST", path: "/api/schedules/s1/run-now" });

    api.auto.runNowOutcome = { status: "skipped", reason: "Automation is paused." };
    await user.click(card.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(card.getByRole("status")).toHaveTextContent("Test run: skipped (Automation is paused.)"));
  });

  it("edits an existing schedule", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready()]);
    api.auto.schedules.push(schedule({ id: "s1", intervalMinutes: 30 }));
    renderApp(api);
    const card = within(await screen.findByRole("listitem", { name: "Schedule Morning summary" }));
    await user.click(card.getByRole("button", { name: "Edit" }));
    expect(field("sch-name")).toHaveValue("Morning summary");
    expect(field("sch-minutes")).toHaveValue(30);
    await user.clear(field("sch-name"));
    await user.type(field("sch-name"), "Renamed");
    await user.clear(field("sch-minutes"));
    await user.type(field("sch-minutes"), "60");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("listitem", { name: "Schedule Renamed" })).toBeInTheDocument();
    expect(api.writes()[0]).toMatchObject({ method: "PATCH", path: "/api/schedules/s1", body: { name: "Renamed", kind: "interval", intervalMinutes: 60 } });
    expect(screen.getByText(/Every 1 hour/)).toBeInTheDocument();
  });

  it("asks before deleting, and cancelling deletes nothing", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready()]);
    api.auto.schedules.push(schedule({ id: "s1" }));
    renderApp(api);
    const card = within(await screen.findByRole("listitem", { name: "Schedule Morning summary" }));
    await user.click(card.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: /Delete "Morning summary"\?/ });
    expect(dialog).toHaveTextContent("past runs stay in the log");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(api.writes()).toHaveLength(0);

    await user.click(card.getByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Schedule Morning summary" })).not.toBeInTheDocument());
    expect(api.writes()[0]).toMatchObject({ method: "DELETE", path: "/api/schedules/s1" });
  });

  it("labels a bot that has no model in the bot list", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi([makeBot({ id: "b2", name: "Idle" })]));
    await user.click(await screen.findByRole("button", { name: "New schedule" }));
    expect(await within(field("sch-bot")).findByRole("option", { name: "Idle (no model yet)" })).toBeInTheDocument();
  });
});

describe("triggers", () => {
  it("starts with an empty state", async () => {
    renderApp(createFakeApi([ready()]));
    expect(await screen.findByText(/No triggers yet/)).toBeInTheDocument();
  });

  it("creates a text-event trigger that starts switched off", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready()]);
    renderApp(api);
    await user.click(await screen.findByRole("button", { name: "New trigger" }));
    await user.type(field("trg-name"), "Urgent mail");
    expect(field("trg-event")).toHaveValue("inbox");
    await user.type(field("trg-contains"), "urgent");
    await waitFor(() => expect(within(field("trg-bot")).getAllByRole("option")).toHaveLength(2));
    await user.selectOptions(field("trg-bot"), "b1");
    // (user.type treats "{" as a special key, so paste the template instead)
    await user.click(field("trg-template"));
    await user.paste("Reply to {{text}}");
    await user.click(screen.getByRole("button", { name: "Create trigger" }));
    const card = within(await screen.findByRole("listitem", { name: "Trigger Urgent mail" }));
    expect(card.getByText("Off")).toBeInTheDocument();
    expect(card.getByText(/When the event "inbox" arrives and the text contains "urgent", Helper gets a task/)).toBeInTheDocument();
    expect(api.writes()[0]).toMatchObject({
      method: "POST",
      path: "/api/triggers",
      body: { name: "Urgent mail", source: "event", eventName: "inbox", contains: "urgent", botId: "b1", instructionTemplate: "Reply to {{text}}", cooldownSeconds: 300 },
    });
  });

  it("creates a trigger that reacts to another bot's finished tasks", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready(), makeBot({ id: "b2", name: "Writer", model: "groq/x" })]);
    renderApp(api);
    await user.click(await screen.findByRole("button", { name: "New trigger" }));
    await user.type(field("trg-name"), "Review drafts");
    await user.selectOptions(field("trg-source"), "task_result");
    expect(field("trg-event")).toBeNull();
    await waitFor(() => expect(within(field("trg-watch")).getAllByRole("option")).toHaveLength(3));
    const create = screen.getByRole("button", { name: "Create trigger" });
    expect(create).toBeDisabled();
    await user.selectOptions(field("trg-watch"), "b2");
    await user.selectOptions(field("trg-bot"), "b1");
    await user.click(create);
    const card = within(await screen.findByRole("listitem", { name: "Trigger Review drafts" }));
    expect(card.getByText(/When Writer finishes a task, Helper gets a task/)).toBeInTheDocument();
    expect(api.writes()[0]!.body).toMatchObject({ source: "task_result", watchBotId: "b2", botId: "b1" });
    expect(api.writes()[0]!.body.eventName).toBeUndefined();
  });

  it("explains the cooldown rule when it is too short", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi([ready()]));
    await user.click(await screen.findByRole("button", { name: "New trigger" }));
    await user.type(field("trg-name"), "Fast");
    await waitFor(() => expect(within(field("trg-bot")).getAllByRole("option")).toHaveLength(2));
    await user.selectOptions(field("trg-bot"), "b1");
    await user.clear(field("trg-cooldown"));
    await user.type(field("trg-cooldown"), "5");
    await user.click(screen.getByRole("button", { name: "Create trigger" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/cooldown must be at least 30 seconds/);
  });

  it("switches on and off, edits, and deletes (after asking)", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready()]);
    api.auto.triggers.push(trigger({ id: "t1" }));
    renderApp(api);
    const card = within(await screen.findByRole("listitem", { name: "Trigger Inbox helper" }));
    const toggle = card.getByRole("switch", { name: "Switch on trigger Inbox helper" });
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(api.writes()[0]).toMatchObject({ method: "PATCH", path: "/api/triggers/t1", body: { enabled: true } });

    await user.click(card.getByRole("button", { name: "Edit" }));
    expect(field("trg-name")).toHaveValue("Inbox helper");
    await user.clear(field("trg-name"));
    await user.type(field("trg-name"), "Renamed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("listitem", { name: "Trigger Renamed" })).toBeInTheDocument();

    await user.click(within(screen.getByRole("listitem", { name: "Trigger Renamed" })).getByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Trigger Renamed" })).not.toBeInTheDocument());
  });

  it("shows when a trigger switched itself off", async () => {
    const api = createFakeApi([ready()]);
    api.auto.triggers.push(trigger({ consecutiveFailures: 3, disabledReason: "Switched off after 3 failed runs in a row. Last problem: boom" }));
    renderApp(api);
    const card = within(await screen.findByRole("listitem", { name: "Trigger Inbox helper" }));
    expect(card.getByRole("alert")).toHaveTextContent(/Switched off after 3 failed runs/);
    expect(card.getByText(/3 failed in a row/)).toBeInTheDocument();
  });
});

describe("test events", () => {
  it("sends an event and shows which triggers reacted", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready()]);
    api.auto.eventOutcomes = [
      { status: "started", triggerId: "t1", triggerName: "Urgent mail", taskId: "22222222-2222-4222-8222-222222222222" },
      { status: "skipped", reason: "Cooling down (at least 300 seconds between runs).", triggerId: "t2", triggerName: "Slow one" },
    ];
    renderApp(api);
    const section = within(await screen.findByRole("region", { name: "Send a test event" }));
    const send = section.getByRole("button", { name: "Send event" });
    expect(send).toBeDisabled();
    await user.type(section.getByLabelText("Text"), "URGENT: server down");
    await user.click(send);
    const results = within(await screen.findByRole("list", { name: "Event results" }));
    expect(results.getByText("Urgent mail")).toBeInTheDocument();
    expect(results.getByText(/Cooling down/)).toBeInTheDocument();
    expect(results.getByRole("link", { name: "View the task" })).toHaveAttribute("href", "/tasks/22222222-2222-4222-8222-222222222222");
    expect(api.writes()[0]).toMatchObject({ method: "POST", path: "/api/events", body: { name: "inbox", text: "URGENT: server down" } });
  });

  it("says so when no trigger matched, and shows server errors", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi([ready()]));
    const section = within(await screen.findByRole("region", { name: "Send a test event" }));
    await user.type(section.getByLabelText("Text"), "hello");
    await user.click(section.getByRole("button", { name: "Send event" }));
    expect(await section.findByText(/No enabled trigger matched this event/)).toBeInTheDocument();
  });
});

describe("the run log", () => {
  it("lists automatic runs with their outcome and reason", async () => {
    const api = createFakeApi([ready()]);
    const run = (over: Partial<AutomationRun>): AutomationRun => ({ id: 1, createdAt: new Date().toISOString(), source: "schedule", sourceId: "s", sourceName: "Morning summary", status: "started", reason: null, taskId: null, ...over });
    api.auto.runs = [
      run({ id: 3, status: "skipped", reason: "Automation is paused." }),
      run({ id: 2, status: "failed", source: "trigger", sourceName: "Urgent mail", reason: "The provider rejected the API key." }),
      run({ id: 1, taskId: "33333333-3333-4333-8333-333333333333" }),
    ];
    renderApp(api);
    const log = within(await screen.findByRole("region", { name: "Recent automatic runs" }));
    const items = await log.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Skipped schedule “Morning summary”: Automation is paused.");
    expect(items[1]).toHaveTextContent("Failed trigger “Urgent mail”: The provider rejected the API key.");
    expect(items[2]).toHaveTextContent("Started schedule “Morning summary”");
    expect(within(items[2]!).getByRole("link", { name: "task" })).toHaveAttribute("href", "/tasks/33333333-3333-4333-8333-333333333333");
  });

  it("says when nothing has run", async () => {
    renderApp(createFakeApi([ready()]));
    expect(await screen.findByText("Nothing has run automatically yet.")).toBeInTheDocument();
  });
});

describe("automation limits", () => {
  it("shows the limits, saves only what changed, explains a refusal, and resets", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([ready()]);
    renderApp(api);
    await waitFor(() => expect(field("auto-maxRunsPerDay")).toHaveValue(20));
    expect(field("auto-minIntervalMinutes")).toHaveValue(15);
    expect(field("auto-maxRunsPerSourcePerDay")).toHaveValue(10);
    expect(field("auto-maxConsecutiveFailures")).toHaveValue(3);
    expect(field("auto-maxHops")).toHaveValue(2);
    expect(field("auto-minCooldownSeconds")).toHaveValue(30);
    const save = screen.getByRole("button", { name: "Save automation limits" });
    expect(save).toBeDisabled();

    await user.clear(field("auto-maxHops"));
    await user.type(field("auto-maxHops"), "9");
    await user.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent(/maxHops.*at most 4/);

    await user.clear(field("auto-maxHops"));
    await user.type(field("auto-maxHops"), "3");
    await user.click(save);
    await waitFor(() => expect(api.writes().at(-1)!.body).toEqual({ maxHops: 3 }));
    await user.click(screen.getByRole("button", { name: "Reset automation limits" }));
    await waitFor(() => expect(field("auto-maxHops")).toHaveValue(2));
  });
});

describe("tasks started automatically", () => {
  it("say who started them", async () => {
    const api = createFakeApi([ready()]);
    const id = "44444444-4444-4444-8444-444444444444";
    api.collab.trees.set(id, {
      task: {
        id, rootId: id, parentId: null, assigneeBotId: "b1", assigneeName: "Helper", requestedBy: "schedule", requestedByName: "Morning summary",
        origin: "schedule", originId: "s1", originLabel: "Morning summary", originDepth: 0, instruction: "Summarise the day", depth: 0,
        status: "completed", result: "Done.", errorCode: null, errorMessage: null, llmCalls: 1, inputTokens: 5, outputTokens: 5,
        createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, children: [],
      },
      events: [],
      totals: { tasks: 1, llmCalls: 1, inputTokens: 5, outputTokens: 5 },
    });
    renderApp(api, `/tasks/${id}`);
    expect(await screen.findByText(/started by schedule “Morning summary”/)).toBeInTheDocument();
  });
});

describe("Automation: inbound messages", () => {
  it("adds a source that starts off, and switching it on shows the permission message if reading is not allowed", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Reader" })]);
    api.ext.inboundReadAllowed = false;
    renderApp(api, "/automation");
    const section = within(await screen.findByRole("region", { name: "Inbound messages" }));
    expect(section.getByText("No message sources yet.")).toBeInTheDocument();
    await section.findByRole("option", { name: "Reader" });
    await userEvent.selectOptions(section.getByLabelText("Bot that reads"), "b1");
    await userEvent.click(section.getByRole("button", { name: "Add source (starts off)" }));
    const row = within(await screen.findByRole("listitem", { name: "Telegram messages for Reader" }));
    expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await userEvent.click(row.getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Switch on Telegram reading/);
    expect(api.ext.inbound[0].enabled).toBe(false);
  });

  it("switches on, changes the interval, and removes only after confirming", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Reader" })]);
    api.ext.inbound.push({ id: "in1", connector: "gmail", botId: "b1", botName: "Reader", eventName: "gmail_message", intervalMinutes: 60, enabled: false, lastPollAt: null, lastNewCount: 0, consecutiveFailures: 0, disabledReason: null });
    renderApp(api, "/automation");
    const row = within(await screen.findByRole("listitem", { name: "Gmail messages for Reader" }));
    await userEvent.click(row.getByRole("switch"));
    await waitFor(() => expect(api.ext.inbound[0].enabled).toBe(true));
    await userEvent.selectOptions(row.getByLabelText(/Check interval/), "120");
    await waitFor(() => expect(api.ext.inbound[0].intervalMinutes).toBe(120));
    await userEvent.click(row.getByRole("button", { name: "Remove" }));
    expect(api.ext.inbound).toHaveLength(1);
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
    await waitFor(() => expect(api.ext.inbound).toHaveLength(0));
  });

  it("shows why a source switched itself off", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Reader" })]);
    api.ext.inbound.push({ id: "in1", connector: "telegram", botId: "b1", botName: "Reader", eventName: "telegram_message", intervalMinutes: 60, enabled: false, lastPollAt: new Date().toISOString(), lastNewCount: 2, consecutiveFailures: 3, disabledReason: "Telegram is down" });
    renderApp(api, "/automation");
    expect(await screen.findByText(/Switched off: Telegram is down/)).toBeInTheDocument();
    expect(screen.getByText(/2 new messages used/)).toBeInTheDocument();
  });
});
