import { askForProof, currentProof, PROOF_HEADER } from "../lib/ownerProof";
/** The backend rejects any request that changes data unless it carries this header. */
export const CLIENT_HEADER = "x-awp-client";
export const CLIENT_HEADER_VALUE = "dashboard";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }

  /** A short, human-readable description, including any field problems. */
  get friendly(): string {
    if (this.issues.length === 0) return this.message;
    return `${this.message}: ${this.issues.map((i) => `${i.path || "request"} ${i.message}`).join("; ")}`;
  }
}

/**
 * Sends a request. If the server says an owner proof is needed (the Guardian is configured and this change is an owner act), the passphrase
 * dialog opens once, and the request is sent again with the proof if the owner entered it.
 */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await send<T>(method, path, body);
  } catch (e) {
    if (e instanceof ApiError && e.code === "proof_required" && (await askForProof())) return send<T>(method, path, body);
    throw e;
  }
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { [CLIENT_HEADER]: CLIENT_HEADER_VALUE };
  const proof = currentProof();
  if (proof) headers[PROOF_HEADER] = proof;
  if (body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "network_error", "Cannot reach the backend. Is it running?");
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON (e.g. a proxy error page) */
    }
  }

  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; message?: string; issues?: { path: string; message: string }[] };
    if (res.status >= 500 && !e.message) {
      throw new ApiError(res.status, "backend_unavailable", "The backend did not respond correctly. Is it running?");
    }
    throw new ApiError(res.status, e.error ?? "error", e.message ?? `Request failed (${res.status})`, e.issues ?? []);
  }
  return data as T;
}
