import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { VaultService } from "./service.js";

const setSchema = z.strictObject({ value: z.string().max(10_000) });
const nameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);

/**
 * The vault API. Note what is NOT here: nothing ever returns a stored value. You can add, replace or remove a
 * secret, and see whether it is set, but the value cannot be read back through the API or the dashboard.
 */
export async function registerVaultRoutes(app: FastifyInstance, vault: VaultService): Promise<void> {
  app.get("/api/vault", async () => ({ secrets: vault.list() }));

  app.put<{ Params: { name: string } }>("/api/vault/:name", async (req) => {
    const name = nameSchema.parse(req.params.name);
    return { secrets: vault.set(name, setSchema.parse(req.body).value) };
  });

  app.delete<{ Params: { name: string } }>("/api/vault/:name", async (req) => {
    return { secrets: vault.delete(nameSchema.parse(req.params.name)) };
  });
}
