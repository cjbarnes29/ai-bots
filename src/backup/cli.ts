import { backupDatabase, listBackups } from "./backup.js";

// npm run backup  ->  copies data/app.db (and data/vault.key) into data/backups/<date_time>/
const dbPath = process.env["DATABASE_PATH"] ?? "data/app.db";
const outRoot = process.argv[2] ?? "data/backups";
try {
  const result = backupDatabase(dbPath, outRoot);
  console.log(`Backup saved in ${result.folder}`);
  console.log(`Files: ${result.files.join(", ")}`);
  if (result.files.includes("vault.key")) {
    console.log("Keep vault.key together with app.db, and keep both private: without the key the saved passwords cannot be read, and anyone with both can read them.");
  }
  console.log(`Backups so far: ${listBackups(outRoot).length}`);
  console.log("To restore: stop the app, then copy app.db (and vault.key) from a backup folder back into the data folder.");
} catch (e) {
  console.error(e instanceof Error ? e.message : "Backup failed.");
  process.exitCode = 1;
}
