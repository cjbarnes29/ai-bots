/**
 * Screen interpretation behind one interface, so a small LOCAL vision model can be added later without touching the engine.
 * Today only the first implementation exists. Nothing here installs software, downloads a model or contacts a provider.
 *
 *  1. UI Automation (primary): structured controls, no picture needed. Used by the engine's inspect / click / type steps.
 *  2. Windows OCR (secondary): text and positions from a picture of ONE window that exists only for the length of the call (engine "read_screen").
 *  3. Local vision model (future, NOT installed): would answer questions about a picture ("which button closes this dialog?").
 *     It may only run on this PC (a "private" picture is never sent anywhere else, see src/llm/image-policy.ts) and only after testing shows
 *     that 1 and 2 are not enough. Requirements, limits and the install decision are in docs/DESKTOP-ENGINE.md section 9.
 */
export interface ScreenQuestion {
  /** What the worker wants to know. */
  question: string;
}
export interface ScreenAnswer {
  answer: string;
  source: "ui-automation" | "ocr" | "local-vision";
}
export interface ScreenInterpreter {
  readonly kind: ScreenAnswer["source"];
  /** null = ready; otherwise the plain-language reason it cannot be used (for example "no local vision model is installed"). */
  unavailable(): string | null;
}

export const localVisionInterpreter: ScreenInterpreter = {
  kind: "local-vision",
  unavailable: () => "No local vision model is installed. Installing one needs the owner's approval, and is only worth considering if UI Automation and OCR prove insufficient (docs/DESKTOP-ENGINE.md).",
};
