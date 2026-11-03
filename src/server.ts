import { buildApp } from "./app.js";

// Phase 1: bots can be created and edited, but nothing can run them yet.
// No AI model calls, no integrations.
const port = Number(process.env["PORT"] ?? 3000);
const dbPath = process.env["DATABASE_PATH"] ?? "data/app.db";
const dashboardOrigins = (process.env["DASHBOARD_ORIGINS"] ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = await buildApp({ dbPath, logger: true, dashboardOrigins });

// 127.0.0.1 = reachable from this PC only (not from your network).
await app.listen({ port, host: "127.0.0.1" });
