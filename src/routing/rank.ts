import type { RouteClass } from "./config.js";

/**
 * How well a model suits a kind of task. This is a plain, explainable rule of thumb based on the model's name (the free providers do not
 * publish quality scores): code-trained models for coding, large or "reasoning" models for research, small and fast ones for light work.
 * It only orders models that are ALREADY allowed; it can never make a blocked model usable.
 */
export interface ModelTraits {
  coding: boolean;
  reasoning: boolean;
  small: boolean;
  large: boolean;
  billions: number | null;
}

export function traitsOf(modelId: string, displayName = ""): ModelTraits {
  const text = `${modelId} ${displayName}`.toLowerCase();
  const size = /(\d+(?:\.\d+)?)\s*b(?![a-z])/.exec(text);
  const billions = size ? Number(size[1]) : null;
  const coding = /(code|coder|codestral|devstral|starcoder|codegemma|granite-code)/.test(text);
  const reasoning = /(reason|thinking|\br1\b|deepseek-r1|\bo1\b|\bo3\b|qwq|magistral)/.test(text);
  const small = (billions !== null && billions <= 9) || /(flash-lite|\bflash\b|\bmini\b|\blite\b|instant|\bsmall\b|\bnano\b|\btiny\b|haiku)/.test(text);
  const large = (billions !== null && billions >= 30) || /(\bpro\b|\bultra\b|\blarge\b|opus|405b|\bmax\b)/.test(text) || reasoning;
  return { coding, reasoning, small, large: large && !small, billions };
}

export function scoreFor(cls: RouteClass, t: ModelTraits): number {
  switch (cls) {
    case "light":
      return (t.small ? 3 : 0) + (t.large ? -2 : 0) + (t.billions !== null && t.billions <= 4 ? 1 : 0);
    case "coding":
      return (t.coding ? 5 : 0) + (t.large ? 1 : 0) + (t.small ? -1 : 0);
    case "research":
      return (t.large ? 3 : 0) + (t.reasoning ? 2 : 0) + (t.small ? -2 : 0);
    case "general":
      return (t.small ? 0.5 : 0) + (!t.small && !t.large ? 1.5 : 0) + (t.large ? 1 : 0) + (t.coding ? -2 : 0);
  }
}
