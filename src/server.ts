import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { GuardianLink } from "./guardian-link.js";
import { parseRemoteHosts } from "./remote/access.js";
import { dashboardAvailable } from "./remote/dashboard.js";

// Phase 1: bots can be created and edited, but nothing can run them yet.
// No AI model calls, no integrations.
const port = Number(process.env["PORT"] ?? 3000);
const dbPath = process.env["DATABASE_PATH"] ?? "data/app.db";
const dashboardOrigins = (process.env["DASHBOARD_ORIGINS"] ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Phone access is OFF unless REMOTE_HOSTS lists your Tailscale name(s), e.g. REMOTE_HOSTS=my-pc.tail1234.ts.net
const remote = parseRemoteHosts(process.env["REMOTE_HOSTS"]);
if (remote.rejected.length > 0) console.warn(`REMOTE_HOSTS ignored (must be a *.ts.net name): ${remote.rejected.join(", ")}`);
// The built dashboard (npm --prefix web run build) is served from the same address, if it exists.
const dashboardDir = fileURLToPath(new URL("../web/dist", import.meta.url));

// The Guardian (see docs/GUARDIAN.md). Set GUARDIAN_URL (for example http://127.0.0.1:3100) to put the AI Workforce under it. Without it the app
// runs as before and the dashboard says that owner actions are not protected.
const guardianUrl = process.env["GUARDIAN_URL"]?.trim();
const guardian = guardianUrl ? new GuardianLink(guardianUrl.replace(/\/+$/, "")) : undefined;
if (guardian) {
  await guardian.refresh();
  guardian.start();
  console.log(guardian.held() === null ? "Guardian: connected, running." : `Guardian: ${guardian.held()}`);
} else console.warn("Guardian: NOT configured (GUARDIAN_URL is not set). Owner approvals are not protected against scripts on this PC and nothing pauses when you leave.");

const app = await buildApp({ dbPath, logger: true, capabilityPollMs: 60_000, dashboardOrigins, remoteHosts: remote.hosts, ...(guardian ? { guardian } : {}), ...(dashboardAvailable(dashboardDir) ? { dashboardDir } : {}) });

// 127.0.0.1 = reachable from this PC only (not from your network).
await app.listen({ port, host: "127.0.0.1" });

// Schedules only run while the app is running. Nothing is replayed after it has been off.
// The clock looks for due schedules every 30 seconds (AUTOMATION_TICK_MS exists only so tests can run faster;
// it never goes below 1 second and changes no limit).
app.automation.start(Math.max(1000, Number(process.env["AUTOMATION_TICK_MS"] ?? 30_000) || 30_000));
