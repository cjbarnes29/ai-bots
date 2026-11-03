import { AppError } from "../errors.js";
import type { AgentRuntime, RuntimeResult } from "./types.js";

/** A placeholder. OpenClaw is not installed; it can be added later behind this same interface. */
export class OpenClawRuntime implements AgentRuntime {
  readonly id = "openclaw";
  readonly toolsEnabled = false as const;

  async run(): Promise<RuntimeResult> {
    throw new AppError(
      409,
      "runtime_not_installed",
      "This bot uses the OpenClaw runtime, which is not installed. Switch the bot to the built-in engine to chat.",
    );
  }
}
