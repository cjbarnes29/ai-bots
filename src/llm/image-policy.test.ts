import { describe, expect, it } from "vitest";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";
import { decideImages } from "./image-policy.js";
import type { ImagePart } from "./types.js";

const priv: ImagePart = { mime: "image/png", dataBase64: "AAAA", sensitivity: "private" };
const pub: ImagePart = { ...priv, sensitivity: "public" };
const local = { kind: "local" as const, displayName: "Local", capabilities: { vision: true } };
const cloud = { kind: "cloud" as const, displayName: "Cloud", capabilities: { vision: true } };

describe("picture policy", () => {
  it("sends nothing to a provider that does not declare vision", () => {
    expect(decideImages({ kind: "local", displayName: "L" }, [priv]).allowed).toBe(false);
  });
  it("keeps private pictures on this PC: never to a cloud provider, whatever the switches say", () => {
    expect(decideImages(cloud, [priv], { cloudImages: true }).allowed).toBe(false);
    expect(decideImages(local, [priv]).allowed).toBe(true);
  });
  it("sends public pictures to the cloud only when the owner switched it on", () => {
    expect(decideImages(cloud, [pub]).allowed).toBe(false);
    expect(decideImages(cloud, [pub], { cloudImages: true }).allowed).toBe(true);
    expect(decideImages(cloud, [pub, priv], { cloudImages: true }).allowed).toBe(false);
  });
});

describe("the adapter and pictures / tools", () => {
  const sent: any[] = [];
  const mk = (capabilities: { vision?: boolean; toolCalling?: boolean }) =>
    new OpenAiCompatibleProvider({
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: null,
      plugin: { normalizeModelId: (x) => x, isTextModel: () => true, capabilities },
      redact: (t) => t,
      fetchImpl: (async (_u: any, init: any) => {
        sent.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), { status: 200 });
      }) as any,
    });
  const req = (over: Record<string, unknown> = {}) => ({ model: "m", messages: [{ role: "user" as const, content: "hi", images: [priv] }], temperature: 0, maxOutputTokens: 10, timeoutMs: 1000, ...over });

  it("refuses a message with a picture unless the provider supports it AND the policy approved it", async () => {
    sent.length = 0;
    await expect(mk({}).complete(req({ imagesApproved: true }))).rejects.toThrow(/Pictures are not sent/);
    await expect(mk({ vision: true }).complete(req())).rejects.toThrow(/Pictures are not sent/);
    expect(sent).toHaveLength(0);
    await mk({ vision: true }).complete(req({ imagesApproved: true }));
    expect(sent[0].messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });
  it("sends only role and content of text messages, and offers tools only to providers that declare them", async () => {
    sent.length = 0;
    const tools = [{ name: "t", description: "d", parameters: { type: "object" } }];
    await mk({}).complete(req({ messages: [{ role: "user", content: "hi", secretExtra: "x" }], tools }));
    expect(sent[0].messages[0]).toEqual({ role: "user", content: "hi" });
    expect(sent[0].tools).toBeUndefined();
    await mk({ toolCalling: true }).complete(req({ messages: [{ role: "user", content: "hi" }], tools }));
    expect(sent[1].tools[0].function.name).toBe("t");
  });
});
