import { CONNECTORS, type Bot, type BotContent, type BotVersion, type PermissionAuditEntry } from "../api/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
}

export function makeBot(overrides: Partial<Bot> = {}): Bot {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: "Helper",
    role: "",
    personality: "",
    instructions: "",
    responsibilities: [],
    runtime: "builtin",
    model: null,
    status: "disabled",
    currentVersion: 1,
    archived: false,
    createdAt: now,
    updatedAt: now,
    permissions: CONNECTORS.map((connector) => ({
      connector,
      readEnabled: false,
      writePolicy: "approval_required" as const,
      updatedAt: now,
    })),
    ...overrides,
  };
}

function contentOf(b: BotContent): BotContent {
  return {
    name: b.name,
    role: b.role,
    personality: b.personality,
    instructions: b.instructions,
    responsibilities: b.responsibilities,
    runtime: b.runtime,
    model: b.model,
  };
}

/**
 * A tiny in-memory imitation of the real backend, used only by tests.
 * It follows the same rules (versions, restore, archive, permissions, no activation).
 */
export function createFakeApi(initial: Bot[] = []) {
  const bots = new Map<string, Bot>();
  const versions = new Map<string, BotVersion[]>();
  const audit = new Map<string, PermissionAuditEntry[]>();
  const requests: RecordedRequest[] = [];
  let auditId = 1;

  const addVersion = (b: Bot, note: string | null, restoredFrom: number | null = null) => {
    const list = versions.get(b.id) ?? [];
    list.unshift({ ...contentOf(b), version: b.currentVersion, changeNote: note, restoredFrom, createdAt: new Date().toISOString() });
    versions.set(b.id, list);
  };

  const seed = (b: Bot, note = "Created") => {
    bots.set(b.id, b);
    addVersion(b, note);
  };
  initial.forEach((b) => seed(b));

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const err = (status: number, error: string, message: string) => json({ error, message }, status);

  const handle = (method: string, path: string, body: any): Response => {
    const url = new URL(path, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); // ["api","bots",id,...]
    const id = parts[2];
    const bot = id ? bots.get(id) : undefined;

    if (parts[0] !== "api" || parts[1] !== "bots") return err(404, "not_found", "Not found");

    if (!id) {
      if (method === "GET") {
        const all = url.searchParams.get("includeArchived") === "true";
        return json({ bots: [...bots.values()].filter((b) => all || !b.archived) });
      }
      if (method === "POST") {
        if (!body?.name?.trim()) return json({ error: "validation_error", message: "Invalid input", issues: [{ path: "name", message: "required" }] }, 400);
        const b = makeBot({ ...body, name: body.name.trim() });
        seed(b, body.changeNote ?? "Created");
        return json({ bot: b }, 201);
      }
    }
    if (!bot) return err(404, "bot_not_found", "Bot not found");
    const sub = parts[3];

    if (!sub) {
      if (method === "GET") return json({ bot });
      if (method === "DELETE") {
        bot.archived = true;
        bot.status = "disabled";
        return json({ bot });
      }
      if (method === "PATCH") {
        if (bot.archived) return err(409, "bot_archived", "This bot is archived. Unarchive it first.");
        if (body.status === "active") return err(409, "activation_not_available", "Bots cannot be activated yet.");
        const { status, changeNote, ...content } = body;
        const before = JSON.stringify(contentOf(bot));
        Object.assign(bot, content);
        if (JSON.stringify(contentOf(bot)) !== before) {
          bot.currentVersion += 1;
          addVersion(bot, changeNote ?? null);
        }
        if (status) bot.status = status;
        return json({ bot });
      }
    }
    if (sub === "unarchive" && method === "POST") {
      bot.archived = false;
      return json({ bot });
    }
    if (sub === "duplicate" && method === "POST") {
      const copy = makeBot({ ...contentOf(bot), name: `${bot.name} (copy)` });
      seed(copy, `Duplicated from "${bot.name}"`);
      return json({ bot: copy }, 201);
    }
    if (sub === "versions") {
      const list = versions.get(bot.id) ?? [];
      if (!parts[4] && method === "GET") return json({ versions: list });
      const n = Number(parts[4]);
      if (parts[5] === "restore" && method === "POST") {
        const old = list.find((v) => v.version === n);
        if (!old) return err(404, "version_not_found", "Version not found");
        Object.assign(bot, contentOf(old));
        bot.currentVersion += 1;
        addVersion(bot, `Restored from version ${n}`, n);
        return json({ bot });
      }
    }
    if (sub === "permissions") {
      if (parts[4] === "audit" && method === "GET") return json({ audit: audit.get(bot.id) ?? [] });
      if (!parts[4] && method === "GET") return json({ permissions: bot.permissions });
      if (parts[4] && method === "PUT") {
        const p = bot.permissions.find((x) => x.connector === parts[4]);
        if (!p) return err(404, "connector_not_found", "Unknown connector");
        if (body.readEnabled !== p.readEnabled) {
          const list = audit.get(bot.id) ?? [];
          list.unshift({
            id: auditId++,
            connector: p.connector,
            field: "read_enabled",
            oldValue: p.readEnabled,
            newValue: body.readEnabled,
            actor: "local-user",
            createdAt: new Date().toISOString(),
          });
          audit.set(bot.id, list);
          p.readEnabled = body.readEnabled;
        }
        return json({ permissions: bot.permissions });
      }
    }
    return err(404, "not_found", "Not found");
  };

  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const path = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path, headers, body });
    return handle(method, path, body);
  };

  return {
    fetch: fetchImpl,
    requests,
    bots,
    /** Requests that are not plain reads. */
    writes: () => requests.filter((r) => r.method !== "GET"),
  };
}
