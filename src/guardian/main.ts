import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FirewallRuleAdapter, VmrunAdapter } from "./adapters.js";
import { GuardianCore } from "./core.js";
import { Journal } from "./journal.js";
import { newLeaseKey } from "./lease.js";
import { PowerShellPresence } from "./presence.js";
import { ProcessTreeGuard, WindowsProcessTable } from "./process-tree.js";
import { createGuardianServer } from "./server.js";

/**
 * Starts the Guardian (Tier A). Settings come from environment variables; all are optional:
 *   GUARDIAN_DIR            where it keeps its files (default: data/guardian)
 *   GUARDIAN_PORT           its own port on 127.0.0.1 (default 3100)
 *   GUARDIAN_APP_PORT       the Manager's port, used to find the Manager's process (default: PORT or 3000)
 *   GUARDIAN_ORIGINS        dashboard addresses that may talk to it (default: localhost / 127.0.0.1 on ports 3000 and 5173)
 *   GUARDIAN_PRESENCE       "off" switches presence monitoring off (development only; it is logged and shown everywhere)
 *   GUARDIAN_IDLE_MINUTES   minutes without input before PAUSE (default 15; the owner-approved value)
 *   GUARDIAN_VMRUN, GUARDIAN_VMX     vmrun.exe and the ONE VM file to suspend/stop (not used until a VM exists)
 *   GUARDIAN_FIREWALL_RULE  name of the pre-made firewall block rule to switch on at STOP/LOCKDOWN (administrator needed; not used yet)
 */
const dir = resolve(process.env["GUARDIAN_DIR"] ?? "data/guardian");
const port = Number(process.env["GUARDIAN_PORT"] ?? 3100);
const appPort = Number(process.env["GUARDIAN_APP_PORT"] ?? process.env["PORT"] ?? 3000);
const origins = (process.env["GUARDIAN_ORIGINS"] ?? "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const presenceOff = (process.env["GUARDIAN_PRESENCE"] ?? "on").toLowerCase() === "off";
const idleMinutes = Math.max(1, Number(process.env["GUARDIAN_IDLE_MINUTES"] ?? 15) || 15);

mkdirSync(dir, { recursive: true });
const journal = new Journal(join(dir, "journal.jsonl"));
const keyFile = join(dir, "lease.key");
if (!existsSync(keyFile)) writeFileSync(keyFile, newLeaseKey().toString("base64"), "utf8");
const leaseKey = Buffer.from(readFileSync(keyFile, "utf8"), "base64");

const presence = presenceOff ? null : new PowerShellPresence();
presence?.start();
if (presenceOff) journal.append("presence_monitoring_off", { note: "switched off by GUARDIAN_PRESENCE=off" });

const vmrun = process.env["GUARDIAN_VMRUN"];
const vmx = process.env["GUARDIAN_VMX"];
const rule = process.env["GUARDIAN_FIREWALL_RULE"];

const core = new GuardianCore({
  dir,
  now: Date.now,
  journal,
  tree: new ProcessTreeGuard(new WindowsProcessTable(appPort), process.pid),
  vm: vmrun && vmx ? new VmrunAdapter(vmrun, vmx) : null,
  net: rule ? new FirewallRuleAdapter(rule) : null,
  presence,
  presenceRequired: !presenceOff,
  leaseKey,
  idleLimitMs: idleMinutes * 60_000,
});

const server = createGuardianServer({ core, journal, allowedOrigins: origins });
server.listen(port, "127.0.0.1", () => {
  console.log(`Guardian (Tier A, development and supervised testing only) is listening on http://127.0.0.1:${port}`);
  console.log(`State: ${core.status().state}. Passphrase set: ${core.passphraseSet() ? "yes" : "NO - run: npm run guardian:passphrase"}`);
  if (presenceOff) console.log("WARNING: presence monitoring is OFF.");
});

const timer = setInterval(() => void core.tick(), 5000);
const shutdown = () => {
  clearInterval(timer);
  presence?.stop();
  journal.append("guardian_stopped", {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
