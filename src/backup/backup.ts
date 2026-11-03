import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * A safe copy of the database (and the vault key that unlocks its saved keys). Run it by hand: `npm run backup`.
 * The copy is made with SQLite's own VACUUM INTO, so it is consistent even while the app is running, and it never
 * changes the original. It refuses to overwrite an existing backup.
 */
export interface BackupResult {
  folder: string;
  files: string[];
}

export function stamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function backupDatabase(dbPath: string, outRoot: string, now: Date = new Date()): BackupResult {
  const source = resolve(dbPath);
  if (!existsSync(source)) throw new Error(`There is no database at ${source}.`);
  const folder = join(resolve(outRoot), stamp(now));
  if (existsSync(folder)) throw new Error(`The backup folder ${folder} already exists. Wait a second and try again.`);
  mkdirSync(folder, { recursive: true });

  const files: string[] = [];
  const target = join(folder, "app.db");
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  files.push("app.db");

  const key = join(dirname(source), "vault.key");
  if (existsSync(key)) {
    copyFileSync(key, join(folder, "vault.key"));
    files.push("vault.key");
  }
  return { folder, files };
}

/** Existing backups, newest first (for the printed hint). */
export function listBackups(outRoot: string): string[] {
  const root = resolve(outRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => statSync(join(root, n)).isDirectory())
    .sort()
    .reverse();
}
