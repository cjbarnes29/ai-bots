import { z } from "zod";

/**
 * Delegation limits. Defaults are deliberately small so a chain of bots cannot burn through a
 * free tier: 8 model calls per task chain = the first bot's 2 calls + 3 teammates x 2 calls.
 */
export const DEFAULT_DELEGATION_LIMITS = {
  /** How many levels deep a chain may go (the first task is level 0). */
  maxDepth: 2,
  /** How many teammates one task may hand work to. */
  maxSubtasksPerTask: 3,
  /** Total tasks in one chain, including the first. */
  maxTasksPerChain: 5,
  /** Total model calls in one chain. */
  maxLlmCallsPerChain: 8,
  /** Longest instruction, in characters. */
  maxInstructionChars: 4000,
  /**
   * How many independent chains (separately started tasks) may run at the same time. 1 = one after another, as before. Work INSIDE one chain stays in order.
   * Never more than the model service allows at once ("simultaneous cloud requests" minus one, which keeps a slot free for chat).
   */
  maxParallelChains: 1,
} as const;

export type DelegationLimits = { [K in keyof typeof DEFAULT_DELEGATION_LIMITS]: number };

/** Hard ceilings: the dashboard can raise a limit, but never past these. */
export const delegationLimitsUpdateSchema = z
  .strictObject({
    maxDepth: z.number().int().min(0).max(4),
    maxSubtasksPerTask: z.number().int().min(1).max(6),
    maxTasksPerChain: z.number().int().min(1).max(15),
    maxLlmCallsPerChain: z.number().int().min(1).max(30),
    maxInstructionChars: z.number().int().min(50).max(20_000),
    maxParallelChains: z.number().int().min(1).max(6),
  })
  .partial();

export type DelegationLimitsUpdate = z.infer<typeof delegationLimitsUpdateSchema>;

export function mergeDelegationLimits(overrides: DelegationLimitsUpdate | null): DelegationLimits {
  return { ...DEFAULT_DELEGATION_LIMITS, ...(overrides ?? {}) } as DelegationLimits;
}

/** The longest result stored for a task (anything longer is cut, and the cut is noted). */
export const MAX_RESULT_CHARS = 20_000;
