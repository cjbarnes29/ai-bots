/**
 * What kind of model something is, so a specialised model (speech, image, embedding, safety filter, realtime, computer control...) is never offered as a
 * general chat model, and every model the provider lists is still recorded, with the reason it is or is not a chat model.
 *
 * The decision uses what the provider says when it says anything (Gemini lists the operations a model supports; Groq says whether a model is active),
 * and otherwise the model's id. The id rules are rules of thumb and are labelled as such; a model with an unrecognised id is "chat" only if the provider's
 * own data does not say otherwise, and it still has to pass verification before it is routed.
 */
export const MODEL_KINDS = [
  "chat",
  "reasoning",
  "coding",
  "vision_chat",
  "image_generation",
  "video_generation",
  "speech_synthesis",
  "transcription",
  "audio_other",
  "embedding",
  "safety",
  "realtime",
  "computer_use",
  "agentic_system",
  "other",
] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export const CHAT_KINDS: readonly ModelKind[] = ["chat", "reasoning", "coding", "vision_chat"];

export const KIND_LABEL: Record<ModelKind, string> = {
  chat: "General chat",
  reasoning: "Reasoning",
  coding: "Coding",
  vision_chat: "Chat with picture input",
  image_generation: "Image generation",
  video_generation: "Video generation",
  speech_synthesis: "Speech synthesis",
  transcription: "Transcription",
  audio_other: "Audio",
  embedding: "Embedding",
  safety: "Safety filter",
  realtime: "Live / realtime",
  computer_use: "Computer control",
  agentic_system: "Built-in agent system",
  other: "Other / specialised",
};

/** The few fields of a provider's own listing the registry keeps (all scalars; nothing else is stored). */
export interface NativeInfo {
  active?: boolean | null;
  ownedBy?: string | null;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  methods?: string[] | null;
  thinking?: boolean | null;
  description?: string | null;
  version?: string | null;
}

export interface Classified {
  kind: ModelKind;
  chatCapable: boolean;
  modalities: { input: string[]; output: string[] };
  /** Why the app believes this (the provider's listing, or the id). */
  basis: string;
}

const lower = (s: string) => s.toLowerCase();

export function classifyModel(modelId: string, native: NativeInfo = {}): Classified {
  const id = lower(modelId.replace(/^models\//, ""));
  const methods = (native.methods ?? []).map(lower);
  const has = (m: string) => methods.includes(lower(m));
  const make = (kind: ModelKind, basis: string, input: string[] = ["text"], output: string[] = ["text"]): Classified => ({ kind, chatCapable: CHAT_KINDS.includes(kind), modalities: { input, output }, basis });

  // 1. What the provider says the model can do.
  if (methods.length > 0) {
    if (has("embedContent") || has("batchEmbedContents") || has("embedText")) return make("embedding", "the provider lists embedding operations", ["text"], ["vector"]);
    if (has("predict") || has("predictLongRunning")) {
      if (/veo/.test(id)) return make("video_generation", "the provider lists prediction operations (video model)", ["text", "image"], ["video"]);
      return make("image_generation", "the provider lists prediction operations only", ["text"], ["image"]);
    }
    if (has("bidiGenerateContent") && !has("generateContent")) return make("realtime", "the provider lists live (streaming) operations only", ["text", "audio", "video"], ["text", "audio"]);
    if (!has("generateContent") && !has("generateMessage") && !has("countTokens")) return make("other", "the provider does not list a text-generation operation");
  }
  if (native.active === false) return { ...make("other", "the provider marks the model inactive"), chatCapable: false };

  // 2. The id.
  if (/embed/.test(id)) return make("embedding", "id contains \"embed\"", ["text"], ["vector"]);
  if (/transcri|speech-to-text|(^|[-_/])stt([-_/]|$)|whisper|(^|[-_/])asr([-_/]|$)/.test(id)) return make("transcription", "id names a transcription model", ["audio"], ["text"]);
  if (/veo/.test(id)) return make("video_generation", "id names a video model", ["text", "image"], ["video"]);
  if (/lyria|music/.test(id)) return make("audio_other", "id names a music-generation model", ["text"], ["audio"]);
  if (/imagen|banana|image-generation|-image($|-)|flash-image|gemini-.*-image/.test(id)) return make("image_generation", "id names an image model", ["text", "image"], ["image"]);
  if (/tts|text-to-speech|orpheus|playai|speech/.test(id)) return make("speech_synthesis", "id names a speech-synthesis model", ["text"], ["audio"]);
  if (/live|native-audio|realtime/.test(id)) return make("realtime", "id names a live / realtime model", ["text", "audio", "video"], ["text", "audio"]);
  if (/computer[-_ ]?use|robotics/.test(id)) return make("computer_use", "id names a computer-control or robotics model");
  if (/(^|[-_/])guard|safeguard|moderation/.test(id)) return make("safety", "id names a safety / moderation model");
  if (/compound|deep-research|(^|[-_/])agent([-_/]|$)/.test(id)) return make("agentic_system", "id names a built-in agent system (it runs its own tools)");
  if (/audio/.test(id)) return make("audio_other", "id names an audio model", ["audio", "text"], ["text", "audio"]);
  if (/(^|[-_/])aqa([-_/]|$)/.test(id)) return make("other", "id names the attributed-question-answering model");
  if (/coder|codestral|devstral|starcoder|codegemma/.test(id)) return make("coding", "id names a coding model");
  if (/vision|(^|[-_/ ])vl([-_: ]|$)|llava|pixtral|llama-4|scout|maverick|gemini|gemma-3|gemma-4/.test(id) && !/guard/.test(id)) {
    const reasoning = /thinking|gpt-oss|r1|qwq|reasoning|qwen3|gemma-4|-pro/.test(id) || native.thinking === true;
    return make(reasoning ? "reasoning" : "vision_chat", reasoning ? "id or provider says it reasons" : "id suggests picture input", ["text", "image"]);
  }
  if (/thinking|gpt-oss|r1|qwq|reasoning|qwen3/.test(id) || native.thinking === true) return make("reasoning", "id or provider says it reasons");
  return make("chat", methods.length > 0 ? "the provider lists text generation" : "no specialised marker in the id (a rule of thumb)");
}

/** Can the app use this kind for chat and tasks? (Picture input is not wired into the app yet, so vision_chat is used as plain chat.) */
export const isChatKind = (k: ModelKind): boolean => CHAT_KINDS.includes(k);
