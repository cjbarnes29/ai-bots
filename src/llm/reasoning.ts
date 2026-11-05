/**
 * Reasoning-block protection. Some models print their internal reasoning in front of the answer, wrapped in tags such as <thought>...</thought>
 * (Gemma, Gemini "thinking"), <think>...</think> (Qwen, DeepSeek, gpt-oss through some gateways) or <reasoning>...</reasoning>.
 * That text is never an answer: it must not be shown to the owner, stored as the bot's reply, or counted as a success.
 *
 * Rules (so that legitimate content is not damaged):
 *  - Only blocks at the VERY START of the reply (after whitespace) are treated as reasoning. A tag that appears later, or inside a code block or an
 *    explanation about HTML, is the model's real content and is left exactly as written.
 *  - Blocks may be nested (depth is counted); several blocks in a row are all removed.
 *  - A block that never closes means the whole reply is reasoning that was cut off (typically by the length limit): nothing usable remains.
 *  - Some reasoning families (Qwen, DeepSeek, gpt-oss) print the reasoning with no opening tag and only a closing "</think>". That form is recognised ONLY for
 *    those model families, because for any other model a stray closing tag is more likely to be real content.
 * Reasoning-only or empty results are reported so the caller can fail the call (bad_output) instead of recording a success.
 */
export interface ReasoningResult {
  /** The reply without its reasoning. */
  text: string;
  /** At least one reasoning block was removed. */
  removed: boolean;
  /** There was reasoning but nothing else (or the block never closed): no usable answer. */
  reasoningOnly: boolean;
  /** A reasoning block was opened and never closed. */
  incomplete: boolean;
}

const NAMES = "thought|thinking|think|reasoning|reflection";
const OPEN = new RegExp(`^<(${NAMES})(\\s[^>]*)?>`, "i");
const ANY_TAG = new RegExp(`<(/?)(${NAMES})(\\s[^>]*)?>`, "gi");
/** Model families that may print reasoning followed by a lone closing tag. */
const HEADLESS_FAMILIES = /(qwen|deepseek|r1|gpt-oss|reason|think|qwq|magistral|phi-4-reasoning)/i;

/** Index just after the tag that closes the block opened at the start of `s` (depth counted), or -1 when it never closes. */
function endOfBlock(s: string): number {
  ANY_TAG.lastIndex = 0;
  let depth = 0;
  for (let m = ANY_TAG.exec(s); m !== null; m = ANY_TAG.exec(s)) {
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
    if (depth < 0) return -1; // cannot happen when the string starts with an opening tag
  }
  return -1;
}

export function stripReasoning(input: string, modelId = ""): ReasoningResult {
  let rest = input.trimStart();
  let removed = false;
  let incomplete = false;

  // Reasoning with a lone closing tag (no opening tag), for the model families that do this.
  if (HEADLESS_FAMILIES.test(modelId) && !OPEN.test(rest)) {
    const close = new RegExp(`</(${NAMES})>`, "i").exec(rest);
    const firstOpen = new RegExp(`<(${NAMES})(\\s[^>]*)?>`, "i").exec(rest);
    if (close && (!firstOpen || firstOpen.index > close.index)) {
      rest = rest.slice(close.index + close[0].length).trimStart();
      removed = true;
    }
  }

  for (;;) {
    if (!OPEN.test(rest)) break;
    const end = endOfBlock(rest);
    removed = true;
    if (end === -1) {
      incomplete = true;
      rest = "";
      break;
    }
    rest = rest.slice(end).trimStart();
  }
  const text = removed ? rest.trim() : input;
  return { text, removed, reasoningOnly: removed && text === "", incomplete };
}
