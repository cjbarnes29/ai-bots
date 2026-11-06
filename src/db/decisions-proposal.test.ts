import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";

/**
 * Migration 019_decisions (revision 3), approved by the owner on 2026-11-05 (board P-24 / D-058) and installed UNCHANGED from docs/proposals/019_decisions.sql.
 * These tests keep proving what the database itself enforces; they run on throw-away in-memory databases built by the real migration runner.
 */
export const PROPOSAL_019 = fileURLToPath(new URL("../../docs/proposals/019_decisions.sql", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("./migrations/", import.meta.url));
const T = "2026-11-05T00:00:00Z";

export function dbWith019() {
  const db = openDatabase(":memory:");
  db.exec(`INSERT INTO bots (id, name, status, created_at, updated_at) VALUES ('b1','Researcher','active','${T}','${T}'),('b2','Writer','active','${T}','${T}'),('b3','Outsider','active','${T}','${T}')`);
  return db;
}
const fails = (fn: () => unknown, re: RegExp) => expect(fn).toThrow(re);
const task = (db: ReturnType<typeof dbWith019>, id: string, bot = "b1") =>
  db.exec(`INSERT INTO tasks (id, root_id, assignee_bot_id, requested_by, instruction, depth, status, created_at) VALUES ('${id}','${id}','${bot}','user','x',0,'completed','${T}')`);
function decision(db: ReturnType<typeof dbWith019>, id = "d1") {
  db.exec(`INSERT INTO decisions (id, title, created_at, updated_at) VALUES ('${id}','Which market?','${T}','${T}')`);
  db.exec(`INSERT INTO decision_participants (decision_id, bot_id, added_by, added_at) VALUES ('${id}','b1','system','${T}'),('${id}','b2','system','${T}')`);
  const opt = (oid: string, pos: number, bot: string | null = "b1") =>
    db.exec(`INSERT INTO decision_options (id, decision_id, position, title, proposed_by_bot_id, created_at, updated_at) VALUES ('${oid}','${id}',${pos},'Option ${pos}',${bot ? `'${bot}'` : "NULL"},'${T}','${T}')`);
  opt(`${id}o1`, 1);
  opt(`${id}o2`, 2, "b2");
  return { o1: `${id}o1`, o2: `${id}o2` };
}
const approve = (db: ReturnType<typeof dbWith019>, id = "d1", opt = `${id}o1`) => {
  db.exec(`UPDATE decisions SET chosen_option_id='${opt}', chosen_by='owner', status='chosen', updated_at='${T}' WHERE id='${id}'`);
  db.exec(`UPDATE decisions SET status='approved', approved_by='owner', approved_at='${T}', updated_at='${T}' WHERE id='${id}'`);
};
const history = (db: ReturnType<typeof dbWith019>, id = "d1") => (db.prepare("SELECT actor, action, detail FROM decision_revisions WHERE decision_id = ? ORDER BY id").all(id) as { actor: string; action: string; detail: string }[]);

/** A database built from every migration BEFORE 019 (the schema as the live app had it), to prove 019 only adds. */
function schemaBefore019(): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql") && x < "019").sort()) d.exec(readFileSync(`${MIGRATIONS}/${f}`, "utf8"));
  return d;
}

describe("migration 019 (revision 3, applied): what the database itself enforces", () => {
  it("the installed migration is byte-identical to the approved revision 3 and is recorded by the runner", () => {
    expect(readFileSync(`${MIGRATIONS}/019_decisions.sql`, "utf8")).toBe(readFileSync(PROPOSAL_019, "utf8"));
    expect(openDatabase(":memory:").prepare("SELECT version FROM schema_migrations WHERE version = '019_decisions.sql'").get()).toBeTruthy();
  });

  it("adds only new objects and leaves every existing one unchanged", () => {
    const base = schemaBefore019();
    const snap = (d: typeof base) => new Map((d.prepare("SELECT type || name AS k, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all() as { k: string; sql: string }[]).map((r) => [r.k, r.sql]));
    const before = snap(base);
    const after = snap(dbWith019());
    expect([...before].filter(([k, v]) => after.get(k) !== v)).toEqual([]);
    expect(after.size).toBeGreaterThan(before.size + 30);
  });

  it("only the owner can choose or approve: those columns can hold nothing else, and a bot cannot approve its own proposal", () => {
    const db = dbWith019();
    const { o1 } = decision(db);
    fails(() => db.exec(`UPDATE decisions SET chosen_option_id='${o1}', chosen_by='b1', status='chosen' WHERE id='d1'`), /CHECK/);
    fails(() => db.exec(`UPDATE decisions SET chosen_option_id='${o1}', status='chosen' WHERE id='d1'`), /CHECK/); // chosen without chosen_by
    db.exec(`UPDATE decisions SET chosen_option_id='${o1}', chosen_by='owner', status='chosen', updated_at='${T}' WHERE id='d1'`);
    fails(() => db.exec(`UPDATE decisions SET status='approved', approved_by='b1', approved_at='${T}' WHERE id='d1'`), /CHECK/);
    fails(() => db.exec("UPDATE decisions SET status='approved', approved_by='owner' WHERE id='d1'"), /CHECK/); // no approved_at
    db.exec(`UPDATE decisions SET status='approved', approved_by='owner', approved_at='${T}', updated_at='${T}' WHERE id='d1'`);
    // and a history row for those acts under a bot's name is refused outright
    for (const action of ["chosen", "approved", "rejected", "option_edited", "option_removed"]) {
      fails(() => db.exec(`INSERT INTO decision_revisions (decision_id, actor, bot_id, action, created_at) VALUES ('d1','bot','b1','${action}','${T}')`), /Only the owner/);
    }
  });

  it("the history of a decision is written by the database: creation of options, choice, approval and every option edit with the old text", () => {
    const db = dbWith019();
    const { o1 } = decision(db);
    db.exec(`UPDATE decision_options SET title='Option one, better', edited_by_owner=1, updated_at='${T}' WHERE id='${o1}'`);
    approve(db);
    const h = history(db);
    expect(h.map((r) => r.action)).toEqual(["created", "participant_added", "participant_added", "option_added", "option_added", "option_edited", "chosen", "status", "approved"]);
    const edit = JSON.parse(h.find((r) => r.action === "option_edited")!.detail);
    expect(edit.before.title).toBe("Option 1");
    expect(edit.after.title).toBe("Option one, better");
    expect(h.find((r) => r.action === "approved")!.actor).toBe("owner");
    expect(h.find((r) => r.action === "option_added")!.actor).toBe("bot"); // the bot's own proposal is attributed to the bot
  });

  it("bots cannot edit an option; a participant is required to propose one; the history cannot be rewritten or deleted", () => {
    const db = dbWith019();
    const { o1 } = decision(db);
    fails(() => db.exec(`UPDATE decision_options SET title='Sneaky' WHERE id='${o1}'`), /Only the owner can edit/);
    fails(() => db.exec(`UPDATE decision_options SET proposed_by_bot_id='b2' WHERE id='${o1}'`), /cannot be moved or re-attributed/);
    fails(() => db.exec(`INSERT INTO decision_options (id, decision_id, position, title, proposed_by_bot_id, created_at, updated_at) VALUES ('x','d1',3,'t','b3','${T}','${T}')`), /Only a bot that was asked/);
    fails(() => db.exec("UPDATE decision_revisions SET actor='owner'"), /append-only/);
    fails(() => db.exec("DELETE FROM decision_revisions"), /append-only/);
    fails(() => db.exec("DELETE FROM decisions"), /never deleted/);
    fails(() => db.exec("DELETE FROM decision_options"), /not deleted/);
    fails(() => db.exec("DELETE FROM decision_participants"), /kept as history/);
  });

  it("an approved decision is frozen: options, the chosen option and the question cannot change, and status never goes back", () => {
    const db = dbWith019();
    const { o1, o2 } = decision(db);
    approve(db);
    fails(() => db.exec(`UPDATE decision_options SET title='Changed', edited_by_owner=1 WHERE id='${o1}'`), /keeps its options exactly as approved/);
    fails(() => db.exec(`UPDATE decision_options SET removed_at='${T}', edited_by_owner=1 WHERE id='${o2}'`), /exactly as approved/);
    fails(() => db.exec(`INSERT INTO decision_options (id, decision_id, position, title, created_at, updated_at) VALUES ('n','d1',5,'t','${T}','${T}')`), /only be added while the decision is open/);
    fails(() => db.exec(`UPDATE decisions SET chosen_option_id='${o2}' WHERE id='d1'`), /keeps the option that was approved/);
    fails(() => db.exec("UPDATE decisions SET question='different' WHERE id='d1'"), /cannot be changed/);
    fails(() => db.exec("UPDATE decisions SET status='open' WHERE id='d1'"), /not allowed/);
    fails(() => db.exec("UPDATE decisions SET status='chosen' WHERE id='d1'"), /not allowed/);
    fails(() => db.exec("UPDATE decisions SET status='rejected' WHERE id='d1'"), /not allowed/);
  });

  it("the chosen option must belong to the decision; a decision cannot skip straight to approved or done", () => {
    const db = dbWith019();
    decision(db);
    const other = decision(db, "d2");
    fails(() => db.exec(`UPDATE decisions SET chosen_option_id='${other.o1}', chosen_by='owner', status='chosen' WHERE id='d1'`), /chosen option must be/);
    fails(() => db.exec("UPDATE decisions SET status='approved', approved_by='owner', approved_at='x' WHERE id='d1'"), /not allowed|CHECK/);
    fails(() => db.exec("UPDATE decisions SET status='done' WHERE id='d1'"), /not allowed/);
  });

  it("a task is started at most once per assignment: claim, then start; the task id is set once and unique", () => {
    const db = dbWith019();
    decision(db);
    fails(() => db.exec(`INSERT INTO decision_assignments (decision_id, bot_id, duty, created_at) VALUES ('d1','b1','Research','${T}')`), /only assigned for a decision the owner approved/);
    approve(db);
    fails(() => db.exec(`INSERT INTO decision_assignments (decision_id, bot_id, duty, created_at) VALUES ('d1','b3','Spy','${T}')`), /participating bot/);
    db.exec(`INSERT INTO decision_assignments (decision_id, bot_id, duty, created_at) VALUES ('d1','b1','Research','${T}'),('d1','b2','Write','${T}')`);
    fails(() => db.exec(`INSERT INTO decision_assignments (decision_id, bot_id, duty, created_at) VALUES ('d1','b1','Again','${T}')`), /UNIQUE|PRIMARY/);
    fails(() => db.exec("UPDATE decision_assignments SET start_state='started' WHERE bot_id='b1'"), /cannot be started twice/); // cannot skip the claim
    db.exec("UPDATE decision_assignments SET start_state='starting' WHERE bot_id='b1'");
    fails(() => db.exec("UPDATE decision_assignments SET start_state='started' WHERE bot_id='b1'"), /CHECK/); // started needs a task id
    task(db, "t1");
    db.exec("UPDATE decision_assignments SET start_state='started', task_id='t1' WHERE bot_id='b1'");
    fails(() => db.exec("UPDATE decision_assignments SET start_state='starting' WHERE bot_id='b1'"), /cannot be started twice/);
    fails(() => db.exec("UPDATE decision_assignments SET start_state='not_started', task_id=NULL WHERE bot_id='b1'"), /cannot be (started twice|replaced)/);
    task(db, "t2");
    fails(() => db.exec("UPDATE decision_assignments SET task_id='t2' WHERE bot_id='b1'"), /cannot be replaced/);
    db.exec("UPDATE decision_assignments SET start_state='starting' WHERE bot_id='b2'");
    // one task, one assignment: a second decision's assignment of the same bot cannot take t1 either
    const other = decision(db, "d2");
    void other;
    approve(db, "d2");
    db.exec(`INSERT INTO decision_assignments (decision_id, bot_id, duty, created_at) VALUES ('d2','b1','Research again','${T}')`);
    db.exec("UPDATE decision_assignments SET start_state='starting' WHERE decision_id='d2'");
    fails(() => db.exec("UPDATE decision_assignments SET start_state='started', task_id='t1' WHERE decision_id='d2'"), /UNIQUE/);
    db.exec("UPDATE decision_assignments SET start_state='not_started' WHERE decision_id='d2'");
    db.exec("UPDATE decision_assignments SET start_state='not_started' WHERE bot_id='b2'"); // a failed start releases the claim
    fails(() => db.exec("UPDATE decision_assignments SET duty='Something else' WHERE bot_id='b1'"), /cannot be changed after/);
    fails(() => db.exec("DELETE FROM decision_assignments"), /kept as history/);
  });

  it("a report is written once per real task and kind, only by the assigned bot, only for its own task, only after approval", () => {
    const db = dbWith019();
    decision(db);
    const rep = (bot: string, kind: string, taskId: string | null, msg = "m") =>
      db.exec(`INSERT INTO decision_reports (decision_id, bot_id, kind, message, task_id, created_at) VALUES ('d1','${bot}','${kind}','${msg}',${taskId ? `'${taskId}'` : "NULL"},'${T}')`);
    fails(() => rep("b1", "progress", null), /only accepted for an approved decision|Only a bot assigned/);
    approve(db);
    db.exec(`INSERT INTO decision_assignments (decision_id, bot_id, duty, created_at) VALUES ('d1','b1','Research','${T}'),('d1','b2','Write','${T}')`);
    task(db, "t1", "b1");
    task(db, "t2", "b2");
    db.exec("UPDATE decision_assignments SET start_state='starting' WHERE bot_id='b1'");
    db.exec("UPDATE decision_assignments SET start_state='started', task_id='t1' WHERE bot_id='b1'");
    db.exec("UPDATE decision_assignments SET start_state='starting' WHERE bot_id='b2'");
    db.exec("UPDATE decision_assignments SET start_state='started', task_id='t2' WHERE bot_id='b2'");
    fails(() => rep("b3", "progress", null), /Only a bot assigned/);
    fails(() => rep("b1", "done", null), /CHECK/); // a result needs a real task
    fails(() => rep("b1", "done", "t2"), /only point at the task that was started/); // another bot's task
    rep("b1", "done", "t1");
    fails(() => rep("b1", "done", "t1"), /UNIQUE/); // no duplicate report
    rep("b1", "blocked", "t1", "first");
    fails(() => rep("b1", "blocked", "t1", "again"), /UNIQUE/);
    rep("b1", "progress", null, "half way");
    rep("b1", "question", null, "which budget?");
    expect(history(db).filter((r) => r.action === "reported")).toHaveLength(4);
    fails(() => db.exec("UPDATE decision_reports SET message='changed'"), /append-only/);
    fails(() => db.exec("DELETE FROM decision_reports"), /append-only/);
  });

  it("bots may disagree, constructively: a stance needs a reason, an alternative names one, limits stop an argument", () => {
    const db = dbWith019();
    const { o1, o2 } = decision(db);
    const view = (bot: string, option: string, stance: string, reasoning: string, extra = "NULL, NULL, 1") =>
      db.exec(`INSERT INTO decision_views (decision_id, option_id, bot_id, stance, reasoning, alternative_option_id, reply_to_view_id, round, created_at) VALUES ('d1','${option}','${bot}','${stance}','${reasoning}',${extra},'${T}')`);
    const REASON = "The Dubai market is crowded and our budget is small, so margins would suffer.";
    fails(() => view("b2", o1, "oppose", "no"), /CHECK/); // a bare "no" is refused
    fails(() => view("b3", o1, "concern", REASON), /Only a bot that was asked/);
    fails(() => view("b2", o1, "alternative", REASON), /CHECK/); // an alternative must name one
    fails(() => view("b2", o1, "oppose", REASON, `'${o2}', NULL, 1`), /CHECK/); // and only the alternative stance may
    view("b2", o1, "oppose", REASON);
    view("b2", o1, "alternative", REASON, `'${o2}', NULL, 2`);
    fails(() => view("b2", o1, "support", REASON), /UNIQUE/); // one view per bot, option and round
    const first = (db.prepare("SELECT id FROM decision_views WHERE bot_id='b2' AND round=1").get() as { id: number }).id;
    fails(() => view("b2", o2, "support", REASON, `NULL, ${first}, 1`), /cannot reply to its own view/);
    view("b1", o1, "support", REASON, `NULL, ${first}, 1`); // answering a colleague is fine
    fails(() => db.exec(`INSERT INTO decision_views (decision_id, option_id, bot_id, stance, reasoning, round, created_at) VALUES ('d1','${o1}','b1','concern','${REASON}',3,'${T}')`), /CHECK/); // at most two rounds
    fails(() => db.exec("UPDATE decision_views SET stance='support'"), /append-only/);
    expect(history(db).filter((r) => r.action === "view" && r.actor === "bot")).toHaveLength(3);
    // views never decide: they cannot change the decision, and after approval no more are accepted
    expect(db.prepare("SELECT status, chosen_option_id FROM decisions WHERE id='d1'").get()).toMatchObject({ status: "open", chosen_option_id: null });
    approve(db);
    fails(() => view("b1", o2, "concern", REASON), /before the decision is approved/);
  });

  it("a view, its alternative and its reply must belong to the same decision; a decision takes at most 5 bots", () => {
    const db = dbWith019();
    const a = decision(db);
    const b = decision(db, "d2");
    fails(() => db.exec(`INSERT INTO decision_views (decision_id, option_id, bot_id, stance, reasoning, created_at) VALUES ('d1','${b.o1}','b1','concern','${"r".repeat(30)}','${T}')`), /same decision/);
    for (let i = 3; i <= 6; i++) db.exec(`INSERT INTO bots (id, name, status, created_at, updated_at) VALUES ('x${i}','Bot ${i}','active','${T}','${T}')`);
    for (let i = 3; i <= 5; i++) db.exec(`INSERT INTO decision_participants (decision_id, bot_id, added_by, added_at) VALUES ('d1','x${i}','owner','${T}')`);
    fails(() => db.exec(`INSERT INTO decision_participants (decision_id, bot_id, added_by, added_at) VALUES ('d1','x6','owner','${T}')`), /At most 5 bots/);
    // 5 bots x 2 options x 2 rounds = 20 views is the most the unique index allows, which is under the 30-view cap
    let n = 0;
    for (const bot of ["b1", "b2", "x3", "x4", "x5"]) for (const o of [a.o1, a.o2]) for (const round of [1, 2]) {
      db.exec(`INSERT INTO decision_views (decision_id, option_id, bot_id, stance, reasoning, round, created_at) VALUES ('d1','${o}','${bot}','support','${"r".repeat(30)}',${round},'${T}')`);
      n++;
    }
    expect(n).toBe(20);
  });

  it("status changes are recorded with who and what; unknown actions and non-JSON details are refused", () => {
    const db = dbWith019();
    decision(db);
    fails(() => db.exec(`INSERT INTO decision_revisions (decision_id, actor, action, created_at) VALUES ('d1','owner','magic','${T}')`), /CHECK/);
    fails(() => db.exec(`INSERT INTO decision_revisions (decision_id, actor, action, detail, created_at) VALUES ('d1','owner','note','not json','${T}')`), /CHECK/);
    db.exec(`UPDATE decisions SET status='rejected', owner_note='Not now', updated_at='${T}' WHERE id='d1'`);
    const last = history(db).at(-1)!;
    expect(last).toMatchObject({ actor: "owner", action: "rejected" });
    expect(JSON.parse(last.detail)).toEqual({ from: "open", to: "rejected", note: "Not now" });
    db.exec(`UPDATE decisions SET status='open', updated_at='${T}' WHERE id='d1'`); // reopening is allowed and is recorded
    expect(history(db).at(-1)!.action).toBe("status");
  });
});

// ======================================================================================================================
// Revision 3: one regression test for every correction found in the owner's review of revision 2 (docs/MIGRATION-019-REVIEW.md)
describe("revision 3 regression tests", () => {
  const rep = (db: ReturnType<typeof dbWith019>, bot: string, kind: string, taskId: string | null, msg = "m", d = "d1") =>
    db.exec(`INSERT INTO decision_reports (decision_id, bot_id, kind, message, task_id, created_at) VALUES ('${d}','${bot}','${kind}','${msg}',${taskId ? `'${taskId}'` : "NULL"},'${T}')`);
  it("C1: INSERT OR REPLACE cannot rewrite history, a report, an option or a decision (the connection runs with recursive_triggers on)", () => {
    const db = dbWith019();
    expect((db.prepare("PRAGMA recursive_triggers").get() as { recursive_triggers: number }).recursive_triggers).toBe(1);
    decision(db);
    approve(db);
    const first = (db.prepare("SELECT id FROM decision_revisions WHERE decision_id='d1' ORDER BY id LIMIT 1").get() as { id: number }).id;
    fails(() => db.exec(`INSERT OR REPLACE INTO decision_revisions (id, decision_id, actor, action, detail, created_at) VALUES (${first},'d1','owner','note','{"forged":true}','${T}')`), /append-only/);
    fails(() => db.exec(`INSERT OR REPLACE INTO decisions (id, title, created_at, updated_at) VALUES ('d1','Replaced','${T}','${T}')`), /never deleted/);
    fails(() => db.exec(`INSERT OR REPLACE INTO decision_options (id, decision_id, position, title, created_at, updated_at) VALUES ('d1o9','d1',1,'Replaced',  '${T}','${T}')`), /not deleted|exactly as approved|only be added/);
    startedAssignmentOn(db);
    rep(db, "b1", "done", "t1", "original");
    fails(() => db.exec(`INSERT OR REPLACE INTO decision_reports (decision_id, bot_id, kind, message, task_id, created_at) VALUES ('d1','b1','done','REWRITTEN','t1','${T}')`), /append-only/);
    expect((db.prepare("SELECT message FROM decision_reports").all() as { message: string }[]).map((r) => r.message)).toEqual(["original"]);
    expect((db.prepare("SELECT title, status FROM decisions WHERE id='d1'").get() as { title: string; status: string })).toEqual({ title: "Which market?", status: "approved" });
    // tables that never had delete triggers are unaffected by the setting
    db.exec("INSERT OR REPLACE INTO owner_free_models (provider_id, model_id, confirmed_at) VALUES ('p','m','x')");
    db.exec("INSERT OR REPLACE INTO owner_free_models (provider_id, model_id, confirmed_at) VALUES ('p','m','y')");
  });
  function startedAssignmentOn(db: ReturnType<typeof dbWith019>) {
    task(db, "t1", "b1");
    db.exec(`INSERT INTO decision_assignments (decision_id, bot_id, duty, created_at) VALUES ('d1','b1','Research','${T}')`);
    db.exec("UPDATE decision_assignments SET start_state='starting' WHERE bot_id='b1'");
    db.exec("UPDATE decision_assignments SET start_state='started', task_id='t1' WHERE bot_id='b1'");
  }

  it("C2: a decision can only be inserted as a fresh open decision (no approved-on-arrival, no made-up chosen option)", () => {
    const db = dbWith019();
    fails(() => db.exec(`INSERT INTO decisions (id,title,status,chosen_option_id,chosen_by,approved_by,approved_at,created_at,updated_at) VALUES ('x','T','approved','nonexistent','owner','owner','${T}','${T}','${T}')`), /starts open/);
    fails(() => db.exec(`INSERT INTO decisions (id,title,status,chosen_option_id,chosen_by,created_at,updated_at) VALUES ('y','T','open','whatever','owner','${T}','${T}')`), /starts open/);
    fails(() => db.exec(`INSERT INTO decisions (id,title,approved_at,created_at,updated_at) VALUES ('z','T','${T}','${T}','${T}')`), /starts open/);
    db.exec(`INSERT INTO decisions (id,title,created_at,updated_at) VALUES ('ok','T','${T}','${T}')`);
    expect((db.prepare("SELECT COUNT(*) AS n FROM decisions").get() as { n: number }).n).toBe(1);
  });

  it("C3: an option is removed only by the owner, never while chosen, and never comes back", () => {
    const db = dbWith019();
    const { o1, o2 } = decision(db);
    fails(() => db.exec(`UPDATE decision_options SET removed_at='${T}', updated_at='${T}' WHERE id='${o2}'`), /Only the owner can remove/); // no owner mark
    db.exec(`UPDATE decisions SET chosen_option_id='${o1}', chosen_by='owner', status='chosen', updated_at='${T}' WHERE id='d1'`);
    fails(() => db.exec(`UPDATE decision_options SET removed_at='${T}', edited_by_owner=1, updated_at='${T}' WHERE id='${o1}'`), /chosen option cannot be removed/);
    db.exec(`UPDATE decision_options SET removed_at='${T}', edited_by_owner=1, updated_at='${T}' WHERE id='${o2}'`);
    fails(() => db.exec(`UPDATE decision_options SET removed_at=NULL, updated_at='${T}' WHERE id='${o2}'`), /stays removed/);
    fails(() => db.exec(`UPDATE decision_options SET removed_at='2027-01-01T00:00:00Z' WHERE id='${o2}'`), /stays removed/);
    // the one removal that happened is recorded once, as the owner's
    expect(history(db).filter((r) => r.action === "option_removed")).toHaveLength(1);
    // after the choice is cleared the formerly chosen option can be removed
    db.exec(`UPDATE decisions SET chosen_option_id=NULL, chosen_by=NULL, status='open', updated_at='${T}' WHERE id='d1'`);
    db.exec(`UPDATE decision_options SET removed_at='${T}', edited_by_owner=1, updated_at='${T}' WHERE id='${o1}'`);
  });

  it("C4: an assignment's task must be a root task of that same bot", () => {
    const db = dbWith019();
    decision(db);
    approve(db);
    db.exec(`INSERT INTO decision_assignments (decision_id, bot_id, duty, created_at) VALUES ('d1','b1','Research','${T}')`);
    task(db, "theirs", "b2");
    db.exec(`INSERT INTO tasks (id, root_id, parent_id, assignee_bot_id, requested_by, instruction, depth, status, created_at) VALUES ('child','theirs','theirs','b1','b2','sub',1,'completed','${T}')`);
    task(db, "mine", "b1");
    db.exec("UPDATE decision_assignments SET start_state='starting' WHERE bot_id='b1'");
    fails(() => db.exec("UPDATE decision_assignments SET start_state='started', task_id='theirs' WHERE bot_id='b1'"), /must be a task of that bot/); // another bot's task
    fails(() => db.exec("UPDATE decision_assignments SET start_state='started', task_id='child' WHERE bot_id='b1'"), /must be a task of that bot/); // a sub-task, not a started-from-outside task
    fails(() => db.exec("UPDATE decision_assignments SET start_state='started', task_id='nope' WHERE bot_id='b1'"), /must be a task of that bot|FOREIGN KEY/);
    db.exec("UPDATE decision_assignments SET start_state='started', task_id='mine' WHERE bot_id='b1'");
  });

  it("C5: creation, title, note, project and participants are all in the history, written by the database, and a participant cannot be re-pointed", () => {
    const db = dbWith019();
    decision(db);
    db.exec(`INSERT INTO projects (id,name,created_at,updated_at) VALUES ('p1','Biz','${T}','${T}')`);
    db.exec(`UPDATE decisions SET title='A better title', owner_note='Wait for Q3', project_id='p1', updated_at='${T}' WHERE id='d1'`);
    const h = history(db);
    expect(h[0]).toMatchObject({ action: "created", actor: "owner" });
    expect(h.filter((r) => r.action === "participant_added")).toHaveLength(2);
    const by = (a: string) => JSON.parse(h.find((r) => r.action === a)!.detail);
    expect(by("retitled")).toEqual({ before: "Which market?", after: "A better title" });
    expect(by("note")).toEqual({ before: "", after: "Wait for Q3" });
    expect(by("project_linked")).toEqual({ before: null, after: "p1" });
    // changing nothing writes nothing
    const n = history(db).length;
    db.exec(`UPDATE decisions SET title='A better title', updated_at='${T}' WHERE id='d1'`);
    expect(history(db)).toHaveLength(n);
    // history of a bot-raised decision names the bot
    db.exec(`INSERT INTO decisions (id,title,raised_by_bot_id,created_at,updated_at) VALUES ('d9','By a bot','b1','${T}','${T}')`);
    expect(history(db, "d9")[0]).toMatchObject({ action: "created", actor: "bot" });
    // participants
    fails(() => db.exec("UPDATE decision_participants SET bot_id='b3' WHERE bot_id='b1'"), /cannot be changed/);
    fails(() => db.exec("UPDATE decision_participants SET reason='rewritten'"), /cannot be changed/);
  });

  it("R1: a bot is limited to 20 progress notes and questions per decision; results and failures are not affected", () => {
    const db = dbWith019();
    decision(db);
    approve(db);
    db.exec(`INSERT INTO decision_assignments (decision_id, bot_id, duty, created_at) VALUES ('d1','b1','d','${T}'),('d1','b2','d','${T}')`);
    for (let i = 0; i < 20; i++) rep(db, "b1", i % 2 ? "question" : "progress", null, `note ${i}`);
    fails(() => rep(db, "b1", "progress", null, "one too many"), /reached its limit/);
    fails(() => rep(db, "b1", "question", null, "one too many"), /reached its limit/);
    rep(db, "b2", "progress", null, "another bot is unaffected");
  });

  it("R2: an alternative is a different option, and a view cannot be about a removed option", () => {
    const db = dbWith019();
    const { o1, o2 } = decision(db);
    const REASON = "The first option is too expensive for the budget we have this quarter.";
    const view = (option: string, alt: string | null) =>
      db.exec(`INSERT INTO decision_views (decision_id, option_id, bot_id, stance, reasoning, alternative_option_id, created_at) VALUES ('d1','${option}','b1',${alt ? "'alternative'" : "'support'"},'${REASON}',${alt ? `'${alt}'` : "NULL"},'${T}')`);
    fails(() => view(o1, o1), /CHECK/);
    db.exec(`UPDATE decision_options SET removed_at='${T}', edited_by_owner=1, updated_at='${T}' WHERE id='${o2}'`);
    fails(() => view(o2, null), /still on the table/);
    fails(() => view(o1, o2), /still on the table/);
    view(o1, null);
  });

  it("the cap of 30 views per decision is reachable (12 options, 5 bots) and enforced", () => {
    const db = dbWith019();
    decision(db);
    for (let i = 3; i <= 5; i++) {
      db.exec(`INSERT INTO bots (id,name,status,created_at,updated_at) VALUES ('x${i}','X','active','${T}','${T}')`);
      db.exec(`INSERT INTO decision_participants (decision_id,bot_id,added_by,added_at) VALUES ('d1','x${i}','owner','${T}')`);
    }
    for (let i = 3; i <= 12; i++) db.exec(`INSERT INTO decision_options (id,decision_id,position,title,created_at,updated_at) VALUES ('d1o${i}','d1',${i},'O','${T}','${T}')`);
    let accepted = 0;
    let stopped = "";
    outer: for (const bot of ["b1", "b2", "x3", "x4", "x5"]) for (let o = 1; o <= 12; o++) for (const round of [1, 2]) {
      try {
        db.exec(`INSERT INTO decision_views (decision_id,option_id,bot_id,stance,reasoning,round,created_at) VALUES ('d1','d1o${o}','${bot}','support','${"r".repeat(25)}',${round},'${T}')`);
        accepted++;
      } catch (e) {
        stopped = (e as Error).message;
        break outer;
      }
    }
    expect(accepted).toBe(30);
    expect(stopped).toMatch(/limit of views/);
  });

  it("revision 3 still adds only new objects to the existing schema (75)", () => {
    const base = schemaBefore019();
    const snap = (d: typeof base) => new Map((d.prepare("SELECT type || name AS k, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all() as { k: string; sql: string }[]).map((r) => [r.k, r.sql]));
    const before = snap(base);
    const through019 = new DatabaseSync(":memory:"); // every migration up to and including 019 (020 is later and adds its own objects)
    through019.exec("PRAGMA foreign_keys = ON");
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql") && x <= "019_decisions.sql").sort()) through019.exec(readFileSync(`${MIGRATIONS}/${f}`, "utf8"));
    const after = snap(through019);
    expect([...before].filter(([k, v]) => after.get(k) !== v)).toEqual([]);
    // (the migration runner's own bookkeeping table is not part of 019)
    expect([...after.keys()].filter((k) => !before.has(k) && k !== "tableschema_migrations" && !k.startsWith("indexsqlite_autoindex_schema_migrations")).length).toBe(75);
  });
});
