import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { DEVICE_COOKIE } from "./access.js";
import { DEVICE_LIMITS, type DeviceService } from "./devices.js";

const pairSchema = z.strictObject({ code: z.string().min(4).max(40), name: z.string().min(1).max(60) });
const COOKIE_MAX_AGE_S = Math.floor(DEVICE_LIMITS.idleExpiryMs / 1000);

export async function registerRemoteRoutes(app: FastifyInstance, devices: DeviceService, remoteHosts: string[], now: () => number): Promise<void> {
  // Pairing attempts from outside are also slowed down: at most 20 a minute, whatever the code.
  let window = { start: 0, count: 0 };

  app.get("/api/session", async (req) => {
    const { mode, device } = req.access;
    return {
      mode,
      remoteEnabled: remoteHosts.length > 0,
      remoteHosts: mode === "local" ? remoteHosts : [],
      paired: mode === "local" ? null : device !== null,
      device: device ? { id: device.id, name: device.name } : null,
    };
  });

  // Only the PC can make a pairing code.
  app.post("/api/devices/pairing", async (req) => {
    if (req.access.mode !== "local") throw new AppError(403, "owner_only", "A pairing code can only be made on the PC.");
    if (remoteHosts.length === 0) {
      throw new AppError(409, "remote_off", "Remote access is switched off. Set REMOTE_HOSTS in your .env file (see docs/PHONE-AND-REMOTE.md), then restart.");
    }
    const pairing = devices.startPairing();
    return { ...pairing, link: `https://${remoteHosts[0]}/?pair=${pairing.code}` };
  });

  // The phone sends the code and receives its secret as a protected cookie (never in the page).
  app.post("/api/devices/pair", async (req, reply) => {
    if (req.access.mode !== "remote") throw new AppError(409, "not_remote", "Pairing is only for a phone connecting through Tailscale.");
    const t = now();
    if (t - window.start > 60_000) window = { start: t, count: 0 };
    if (++window.count > 20) throw new AppError(429, "too_many_attempts", "Too many attempts. Wait a minute.");
    const body = pairSchema.parse(req.body);
    const { device, token } = devices.pair(body.code, body.name, req.headers["user-agent"] ?? null);
    reply.header("set-cookie", `${DEVICE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_S}`);
    return { device: { id: device.id, name: device.name } };
  });

  app.get("/api/devices", async (req) => {
    if (req.access.mode !== "local") throw new AppError(403, "owner_only", "The device list is shown on the PC.");
    return { devices: devices.list() };
  });

  // The PC can revoke any device; a phone can only sign itself out.
  app.delete<{ Params: { id: string } }>("/api/devices/:id", async (req) => {
    const { mode, device } = req.access;
    if (mode === "remote" && device?.id !== req.params.id) throw new AppError(403, "owner_only", "A phone can only sign itself out.");
    return { device: devices.revoke(req.params.id, mode === "local" ? "owner" : `device:${device?.name}`) };
  });

  app.post("/api/devices/signout", async (req, reply) => {
    const { mode, device } = req.access;
    if (mode !== "remote" || !device) throw new AppError(409, "not_remote", "Only a paired phone can sign out.");
    devices.revoke(device.id, `device:${device.name}`);
    reply.header("set-cookie", `${DEVICE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    return { ok: true };
  });
}
