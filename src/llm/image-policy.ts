import type { ImagePart, ProviderPlugin } from "./types.js";

/**
 * The one place that decides whether a picture may be sent to a model provider. Defaults protect the owner's screen:
 *  - a provider that does not declare vision support never gets pictures;
 *  - a PRIVATE picture (anything from an application window, which can show mail, messages, accounts, files) goes only to a provider that runs on
 *    this PC. Never to Gemini, Groq, OpenRouter or any free cloud tier, whose terms may let the provider keep or train on it;
 *  - a PUBLIC picture may go to a cloud provider only if the owner explicitly switched that on, and the free-only gate still applies on top;
 *  - nothing here selects a provider, buys anything or switches to a paid model.
 */
export interface ImagePolicySettings {
  /** Owner's explicit switch for PUBLIC pictures to cloud providers. Off by default. */
  cloudImages: boolean;
}
export type ImageDecision = { allowed: true } | { allowed: false; reason: string };

export function decideImages(plugin: Pick<ProviderPlugin, "kind" | "displayName" | "capabilities">, images: ImagePart[], settings: ImagePolicySettings = { cloudImages: false }): ImageDecision {
  if (images.length === 0) return { allowed: true };
  if (!plugin.capabilities?.vision) return { allowed: false, reason: `${plugin.displayName} is not set up to receive pictures.` };
  const isPrivate = images.some((i) => i.sensitivity !== "public");
  if (plugin.kind !== "local") {
    if (isPrivate) return { allowed: false, reason: `A picture of an application window is private and stays on this PC. It is not sent to ${plugin.displayName}.` };
    if (!settings.cloudImages) return { allowed: false, reason: "Sending pictures to cloud providers is switched off." };
  }
  return { allowed: true };
}
