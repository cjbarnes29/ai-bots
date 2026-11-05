/* Shared helpers for tests only. Nothing here is used by the running application. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { LlmError } from "./errors.js";
import type { CompletionRequest, CompletionResult, LlmProvider, ModelInfo } from "./types.js";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from "../security.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------- a real local HTTP server that imitates an AI provider ----------

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  /** Send this text as-is instead of JSON. */
  raw?: string;
  headers?: Record<string, string>;
  delayMs?: number;
  /** Close the connection without answering. */
  destroy?: boolean;
}

export type FakeHandler = (req: RecordedRequest) => FakeReply;

export const defaultHandler: FakeHandler = (req) => {
  if (req.method === "GET" && req.url.endsWith("/models")) {
    return { body: { data: [{ id: "fake-model-1" }, { id: "fake-model-2" }] } };
  }
  return {
    body: {
      choices: [{ message: { role: "assistant", content: "Hello from the fake provider" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    },
  };
};

export interface FakeServer {
  /** e.g. http://127.0.0.1:PORT/v1 */
  baseUrl: string;
  requests: RecordedRequest[];
  setHandler(handler: FakeHandler): void;
  close(): Promise<void>;
}

export async function startFakeProviderServer(initial: FakeHandler = defaultHandler): Promise<FakeServer> {
  let handler = initial;
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      let body: any = undefined;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = text;
      }
      const recorded: RecordedRequest = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body };
      requests.push(recorded);
      const reply = handler(recorded);
      const send = () => {
        if (reply.destroy) {
          req.socket.destroy();
          return;
        }
        res.writeHead(reply.status ?? 200, { "content-type": "application/json", ...(reply.headers ?? {}) });
        res.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    setHandler: (h) => {
      handler = h;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// ---------- a scripted stand-in for a provider (service-level tests) ----------

export const OK_RESULT: CompletionResult = {
  text: "Hello from the scripted provider",
  inputTokens: 10,
  outputTokens: 5,
  finishReason: "stop",
  costReportedMicro: null,
  toolCallsIgnored: false,
};

export class ScriptedProvider implements LlmProvider {
  calls: CompletionRequest[] = [];
  /** Each call takes the next item. A LlmError is thrown; anything else is returned. When empty: OK_RESULT. */
  script: (CompletionResult | LlmError | (() => Promise<CompletionResult>))[] = [];
  models: ModelInfo[] = [];
  listError: LlmError | null = null;

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(request);
    const next = this.script.shift();
    if (next instanceof LlmError) throw next;
    if (typeof next === "function") return next();
    return next ?? OK_RESULT;
  }

  async listModels(): Promise<ModelInfo[]> {
    if (this.listError) throw this.listError;
    return this.models;
  }
}

export function modelInfo(id: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
  return { id, displayName: id, contextWindow: null, priceInput: null, priceOutput: null, ...overrides };
}

// ---------- switching a test bot on ----------

type AnyCall = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown) => Promise<{ status: number; body: any }>;

/**
 * Tests only: switches a just-created bot on (status "active") through the normal API, exactly as the owner does on the bot's Details tab.
 * Bots now run only when switched on. A bot without a model, or a failed creation, is returned unchanged (it stays off).
 */
export async function switchOn(call: AnyCall, created: { status: number; body: any }): Promise<{ status: number; body: any }> {
  const bot = created.body?.bot;
  if (created.status >= 400 || !bot?.id || !bot.model) return created;
  const res = await call("PATCH", `/api/bots/${bot.id}`, { status: "active" });
  if (res.status >= 400) throw new Error(`Could not switch the test bot on (${res.status}): ${JSON.stringify(res.body)}`);
  return { status: created.status, body: { ...created.body, bot: res.body.bot } };
}

// ---------- calling the API in tests ----------

export function makeCaller(app: FastifyInstance) {
  return async function call(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    url: string,
    payload?: unknown,
  ): Promise<{ status: number; body: any }> {
    const res = await app.inject({
      method,
      url,
      payload: payload as object | undefined,
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
    });
    return { status: res.statusCode, body: res.body ? res.json() : undefined };
  };
}
