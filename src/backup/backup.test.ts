import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { backupDatabase, listBackups, stamp } from "./backup.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "awp-backup-"));
  const dbPath = join(dir, "data", "app.db");
  const db = openDatabase(dbPath);
  db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES ('b1', 'Keep me', 't', 't')").run();
  return { dir, dbPath, db, out: join(dir, "backups") };
}

describe("backup", () => {
  it("copies the database (while it is open) and the vault key, and the copy is a working database with the same data", () => {
    const { dbPath, db, out, dir } = setup();
    writeFileSync(join(dir, "data", "vault.key"), "KEYBYTES");
    const result = backupDatabase(dbPath, out, new Date(2026, 0, 2, 3, 4, 5));
    expect(result.folder).toBe(join(out, "2026-01-02_030405"));
    expect(result.files).toEqual(["app.db", "vault.key"]);
    expect(readFileSync(join(result.folder, "vault.key"), "utf8")).toBe("KEYBYTES");
    const copy = openDatabase(join(result.folder, "app.db"));
    expect(copy.prepare("SELECT name FROM bots").all().map((r) => r["name"])).toEqual(["Keep me"]);
    copy.close();
    db.close();
  });

  it("never changes the original and works without a vault key", () => {
    const { dbPath, db, out } = setup();
    db.close();
    const before = readFileSync(dbPath);
    const result = backupDatabase(dbPath, out, new Date(2026, 5, 1, 1, 1, 1));
    expect(result.files).toEqual(["app.db"]);
    expect(readFileSync(dbPath).equals(before)).toBe(true);
  });

  it("refuses to overwrite a backup, and says plainly when there is no database", () => {
    const { dbPath, db, out, dir } = setup();
    db.close();
    const when = new Date(2026, 5, 1, 1, 1, 1);
    backupDatabase(dbPath, out, when);
    expect(() => backupDatabase(dbPath, out, when)).toThrow(/already exists/);
    expect(() => backupDatabase(join(dir, "nope.db"), out)).toThrow(/no database/);
    expect(existsSync(join(dir, "nope.db"))).toBe(false); // looking did not create one
    expect(listBackups(out)).toEqual([stamp(when)]);
  });
});
