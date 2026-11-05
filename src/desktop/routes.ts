import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditLog } from "../audit/audit.js";
import type { DesktopBridge } from "./bridge.js";
import type { DesktopEngine } from "./engine.js";

/** Read-only status and record for the dashboard, plus the one owner-only switch (screen text for cloud models, off by default). */
export interface DesktopRouteDeps {
  bridge: DesktopBridge;
  engine: DesktopEngine;
  audit: AuditLog;
  getCloudText: () => boolean;
  setCloudText: (on: boolean) => void;
}

export async function registerDesktopRoutes(app: FastifyInstance, d: DesktopRouteDeps): Promise<void> {
  app.get("/api/desktop/status", async () => {
    let engineInfo: { uia: boolean; ocr: boolean; ocrLanguage: string | null; powershell: string } | null = null;
    let problem: string | null = null;
    if (process.platform !== "win32") problem = "Desktop control is only available on Windows.";
    else {
      try {
        const s = await d.bridge.status();
        engineInfo = { uia: s.uia, ocr: s.ocr, ocrLanguage: s.ocrLanguage, powershell: s.powershell };
      } catch (e) {
        problem = e instanceof Error ? e.message : "The Windows host did not start.";
      }
    }
    return { engine: engineInfo, problem, sessions: d.engine.sessionInfo(), cloudScreenText: d.getCloudText() };
  });
  app.get("/api/desktop/log", async () => ({ events: d.audit.listPrefix("desktop.", 100) }));
  app.put("/api/desktop/settings", async (req) => {
    const b = z.strictObject({ cloudScreenText: z.boolean() }).parse(req.body);
    d.setCloudText(b.cloudScreenText);
    d.audit.record("desktop.setting", { cloudScreenText: b.cloudScreenText }, { actor: "owner" });
    return { cloudScreenText: d.getCloudText() };
  });
}
