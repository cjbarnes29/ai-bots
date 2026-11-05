import { traitsOf } from "./rank.js";

/**
 * What a model can do beyond writing text, as honest tri-state facts. "unknown" is the default: a model is NOT assumed to have a capability
 * because a name looks plausible. A requirement is met only when the level is "yes" AND this app can actually use the capability today.
 * The levels come from the model's name and the context size the provider listed (a rule of thumb, shown as such); the owner's own knowledge always wins
 * because requirements are only a filter for automatic routing: a bot given an explicit model keeps it.
 */
export const CAPABILITIES = ["text", "image_input", "audio_input", "audio_output", "tool_calling", "structured_output", "long_context", "coding", "vision"] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type Level = "yes" | "no" | "unknown";
export type CapabilityMap = Record<Capability, Level>;

export const CAPABILITY_LABEL: Record<Capability, string> = {
  text: "text",
  image_input: "picture input",
  audio_input: "audio input",
  audio_output: "audio output",
  tool_calling: "tool calling",
  structured_output: "structured (JSON) output",
  long_context: "long context (100k tokens or more)",
  coding: "coding",
  vision: "vision (reading pictures)",
};

/** What THIS app can send or use today. Pictures, audio and native tool calling are not wired to any provider (all capability flags are off). */
export const APP_CAN_USE: Record<Capability, boolean> = {
  text: true,
  image_input: false,
  vision: false,
  audio_input: false,
  audio_output: false,
  tool_calling: false,
  structured_output: true, // replies are parsed and validated by our own code
  long_context: true,
  coding: true,
};

export interface ModelFacts {
  modelId: string;
  displayName?: string;
  contextWindow: number | null;
}

export function capabilitiesOf(m: ModelFacts): CapabilityMap {
  const text = `${m.modelId} ${m.displayName ?? ""}`.toLowerCase();
  const sees = /(vision|(^|[-_/ ])vl([-_: ]|$)|llava|pixtral|gpt-4o|moondream|minicpm-v|gemini)/.test(text) ? "yes" : "unknown";
  const hears = /(gemini|whisper|audio)/.test(text) ? "yes" : "unknown";
  const long: Level = m.contextWindow !== null ? (m.contextWindow >= 100_000 ? "yes" : "no") : /gemini/.test(text) ? "yes" : "unknown";
  return {
    text: "yes",
    image_input: sees,
    vision: sees,
    audio_input: hears,
    audio_output: "unknown",
    tool_calling: "unknown",
    structured_output: "unknown",
    long_context: long,
    coding: traitsOf(m.modelId, m.displayName ?? "").coding ? "yes" : "unknown",
  };
}

/** Does the model meet every requirement? `missing` explains, in plain words, what stops it. */
export function meets(m: ModelFacts, required: readonly Capability[]): { ok: boolean; missing: string[] } {
  const caps = capabilitiesOf(m);
  const missing: string[] = [];
  for (const c of required) {
    if (!APP_CAN_USE[c]) missing.push(`${CAPABILITY_LABEL[c]} is not usable by this app yet`);
    else if (caps[c] !== "yes") missing.push(`${CAPABILITY_LABEL[c]} is ${caps[c] === "no" ? "not supported" : "not confirmed"}`);
  }
  return { ok: missing.length === 0, missing };
}
