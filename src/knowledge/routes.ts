import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { MAX_UPLOAD_BYTES } from "./extract.js";
import type { KnowledgeService } from "./service.js";

const uuid = z.string().uuid();
const id = (v: unknown, code = "document_not_found", msg = "That document does not exist.") => {
  const p = uuid.safeParse(v);
  if (!p.success) throw new AppError(404, code, msg);
  return p.data;
};
/** A file travels as base64 inside JSON (no multipart package). 8 MB of file is about 11 MB of text. */
const BODY_LIMIT = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4096;
const fileBody = {
  filename: z.string().min(1).max(200),
  contentBase64: z.string().min(1),
};
const decode = (b64: string): Buffer => {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new AppError(400, "bad_file_data", "The file data was not valid.");
  return Buffer.from(b64, "base64");
};
const scopeEnum = z.enum(["global", "project", "temporary"]);

/**
 * Knowledge Center and chat attachments. Reading is open like the rest of the dashboard; changing, moving to another place or hiding a document is an
 * owner act (a phone is refused, see remote/access.ts). The assistant never calls the delete route: it has no way to.
 */
export async function registerKnowledgeRoutes(app: FastifyInstance, k: KnowledgeService): Promise<void> {
  app.post("/api/knowledge/docs", { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const b = z
      .strictObject({
        ...fileBody,
        title: z.string().max(200).optional(),
        scope: z.enum(["global", "project"]).default("global"),
        projectId: uuid.nullable().optional(),
        collectionId: uuid.nullable().optional(),
        folder: z.string().max(120).optional(),
        category: z.string().max(60).optional(),
        tags: z.array(z.string().max(60)).max(30).optional(),
        allowDuplicate: z.boolean().optional(),
      })
      .parse(req.body);
    const out = k.upload({ filename: b.filename, bytes: decode(b.contentBase64), title: b.title, scope: b.scope, projectId: b.projectId, collectionId: b.collectionId, folder: b.folder, category: b.category, tags: b.tags, allowDuplicate: b.allowDuplicate });
    reply.code(out.duplicateOf ? 200 : 201);
    return { document: out.doc, duplicate: out.duplicateOf !== null };
  });

  app.get("/api/knowledge/docs", async (req) => {
    const q = z
      .object({
        scope: z.enum(["global", "project"]).optional(),
        projectId: uuid.optional(),
        collectionId: uuid.optional(),
        folder: z.string().max(120).optional(),
        category: z.string().max(60).optional(),
        tag: z.string().max(60).optional(),
        status: z.enum(["queued", "processing", "ready", "failed", "unsupported"]).optional(),
        q: z.string().max(100).optional(),
        deleted: z.enum(["0", "1"]).optional(),
      })
      .parse(req.query);
    return { documents: k.list({ ...q, deleted: q.deleted === "1" }) };
  });
  app.get("/api/knowledge/facets", async () => ({ ...k.facets(), collections: k.collections() }));
  app.get<{ Params: { id: string } }>("/api/knowledge/docs/:id", async (req) => k.preview(id(req.params.id)));
  app.get<{ Params: { id: string } }>("/api/knowledge/docs/:id/image", async (req) => {
    const o = k.original(id(req.params.id));
    if (!o.mime.startsWith("image/") || o.bytes.length > 3 * 1024 * 1024) throw new AppError(404, "no_preview", "There is no picture preview for this file.");
    return { dataUrl: `data:${o.mime};base64,${o.bytes.toString("base64")}` };
  });
  app.get<{ Params: { id: string } }>("/api/knowledge/docs/:id/original", async (req, reply) => {
    const o = k.original(id(req.params.id));
    reply.header("content-type", "application/octet-stream").header("content-disposition", `attachment; filename="${o.filename.replace(/[^A-Za-z0-9._ -]/g, "_")}"`).header("x-content-type-options", "nosniff");
    return reply.send(o.bytes);
  });
  app.patch<{ Params: { id: string } }>("/api/knowledge/docs/:id", async (req) => {
    const b = z.strictObject({ title: z.string().max(200).optional(), tags: z.array(z.string().max(60)).max(30).optional(), category: z.string().max(60).optional(), folder: z.string().max(120).optional(), collectionId: uuid.nullable().optional() }).parse(req.body);
    return { document: k.update(id(req.params.id), { ...(b.title !== undefined ? { title: b.title } : {}), ...(b.tags !== undefined ? { tags: b.tags } : {}), ...(b.category !== undefined ? { category: b.category } : {}), ...(b.folder !== undefined ? { folder: b.folder } : {}), ...(b.collectionId !== undefined ? { collectionId: b.collectionId } : {}) }).doc };
  });
  app.put<{ Params: { id: string } }>("/api/knowledge/docs/:id/scope", async (req) => {
    const b = z.strictObject({ scope: scopeEnum, projectId: uuid.nullable().optional(), collectionId: uuid.nullable().optional() }).parse(req.body);
    return { document: k.setScope(id(req.params.id), b.scope, b.projectId, b.collectionId).doc };
  });
  app.post<{ Params: { id: string } }>("/api/knowledge/docs/:id/reprocess", async (req) => ({ document: k.reprocess(id(req.params.id)) }));
  app.delete<{ Params: { id: string } }>("/api/knowledge/docs/:id", async (req) => (k.remove(id(req.params.id), z.strictObject({ confirmTitle: z.string() }).parse(req.body).confirmTitle), { ok: true }));
  app.post<{ Params: { id: string } }>("/api/knowledge/docs/:id/restore", async (req) => ({ document: k.restore(id(req.params.id)) }));

  app.get("/api/knowledge/collections", async () => ({ collections: k.collections() }));
  app.post("/api/knowledge/collections", async (req, reply) => {
    const b = z.strictObject({ name: z.string().max(80), description: z.string().max(500).optional() }).parse(req.body);
    reply.code(201);
    return { collection: k.createCollection(b.name, b.description) };
  });
  app.delete<{ Params: { id: string } }>("/api/knowledge/collections/:id", async (req) => (k.removeCollection(id(req.params.id, "collection_not_found", "That collection does not exist.")), { ok: true }));

  app.get("/api/knowledge/search", async (req) => {
    const q = z.object({ q: z.string().max(200).default(""), projectId: uuid.optional(), collectionId: uuid.optional(), tag: z.string().max(60).optional() }).parse(req.query);
    return { query: q.q, hits: k.search(q.q, { projectId: q.projectId, collectionId: q.collectionId, tag: q.tag }) };
  });

  // ---- chat attachments: the file is stored under the owner's chosen retention. Temporary means it stays invisible to the Knowledge Center.
  app.post("/api/chat-attachments", { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const b = z.strictObject({ ...fileBody, retention: z.enum(["temporary", "knowledge", "project", "collection"]).default("temporary"), projectId: uuid.nullable().optional(), collectionId: uuid.nullable().optional() }).parse(req.body);
    if (b.retention === "project" && !b.projectId) throw new AppError(400, "project_required", "Choose a project to keep this file in.");
    if (b.retention === "collection" && !b.collectionId) throw new AppError(400, "collection_required", "Choose a collection to keep this file in.");
    const scope = b.retention === "temporary" ? "temporary" : b.retention === "project" ? "project" : "global";
    const out = k.upload({ filename: b.filename, bytes: decode(b.contentBase64), scope, projectId: b.projectId, collectionId: b.retention === "collection" ? b.collectionId : undefined, allowDuplicate: true });
    reply.code(201);
    return { document: out.doc };
  });
  app.delete<{ Params: { id: string } }>("/api/chat-attachments/:id", async (req) => (k.discardPending(id(req.params.id)), { ok: true }));
  app.get<{ Params: { id: string; conversationId: string } }>("/api/bots/:id/conversations/:conversationId/attachments", async (req) => ({ attachments: k.attachmentsOf(id(req.params.conversationId, "conversation_not_found", "Conversation not found")) }));
  app.get<{ Params: { id: string; conversationId: string } }>("/api/bots/:id/conversations/:conversationId/sources", async (req) => ({ sources: k.sourcesOf(id(req.params.conversationId, "conversation_not_found", "Conversation not found")) }));
}
