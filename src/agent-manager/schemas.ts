import { z } from "zod";
import { CONNECTORS, RUNTIMES, STATUSES } from "./types.js";

export const LIMITS = {
  name: 80,
  role: 200,
  personality: 5_000,
  instructions: 20_000,
  responsibility: 300,
  responsibilities: 50,
  model: 200,
  changeNote: 500,
} as const;

// Every object is "strict": unknown fields are rejected instead of silently ignored.

const contentShape = {
  name: z.string().trim().min(1).max(LIMITS.name),
  role: z.string().trim().max(LIMITS.role),
  personality: z.string().max(LIMITS.personality),
  instructions: z.string().max(LIMITS.instructions),
  responsibilities: z
    .array(z.string().trim().min(1).max(LIMITS.responsibility))
    .max(LIMITS.responsibilities),
  runtime: z.enum(RUNTIMES),
  model: z.string().trim().min(1).max(LIMITS.model).nullable(),
};

const changeNote = z.string().trim().max(LIMITS.changeNote);

/** Creating a bot: only the name is required. New bots always start "disabled". */
export const createBotSchema = z.strictObject({
  name: contentShape.name,
  role: contentShape.role.optional(),
  personality: contentShape.personality.optional(),
  instructions: contentShape.instructions.optional(),
  responsibilities: contentShape.responsibilities.optional(),
  runtime: contentShape.runtime.optional(),
  model: contentShape.model.optional(),
  changeNote: changeNote.optional(),
});

/** Editing a bot: any subset of fields. */
export const updateBotSchema = z.strictObject({
  name: contentShape.name.optional(),
  role: contentShape.role.optional(),
  personality: contentShape.personality.optional(),
  instructions: contentShape.instructions.optional(),
  responsibilities: contentShape.responsibilities.optional(),
  runtime: contentShape.runtime.optional(),
  model: contentShape.model.optional(),
  status: z.enum(STATUSES).optional(),
  changeNote: changeNote.optional(),
});

export const setReadPermissionSchema = z.strictObject({
  readEnabled: z.boolean(),
  // Accepted only so a client that sends it gets a clear answer: it must be this value.
  writePolicy: z.literal("approval_required").optional(),
});

export const connectorParamSchema = z.enum(CONNECTORS);

export const listBotsQuerySchema = z.strictObject({
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export type CreateBotInput = z.infer<typeof createBotSchema>;
export type UpdateBotInput = z.infer<typeof updateBotSchema>;
