import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramConnector } from "../connectors/telegram.js";
import { createGmailConnector } from "../connectors/gmail.js";
import { createGithubConnector, createGoogleWorkspaceConnector, createNotionConnector, createN8nConnector, createMcpConnector } from "../connectors/integrations.js";
import { createDocumentsConnector } from "../connectors/documents.js";
import { createPcConnector } from "../connectors/pc/connector.js";
import { createMemoryConnector } from "../memory/connector.js";
import { createBrowserConnector } from "../connectors/browser/browser.js";
import { ConnectorRegistry, type ResultOperation, type ResultObject } from "../connectors/types.js";
import { copyResultSupport } from "./action-support.js";

// Factories may build declarations, but may not touch a PC, folder, secret, network or memory service.
const dependency = new Proxy({}, { get() { throw new Error("Metadata construction touched a service"); } }) as never;
const definitions = () => [createTelegramConnector(), createGmailConnector(), createGithubConnector(), createGoogleWorkspaceConnector(), createNotionConnector(), createN8nConnector(), createMcpConnector(), createDocumentsConnector(dependency, dependency), createPcConnector(dependency, dependency), createMemoryConnector(dependency), createBrowserConnector({ request: async () => { throw new Error("No network"); }, lookup: async () => { throw new Error("No DNS"); } })];

const expected: [string, string, ResultOperation[], ResultObject[]][] = [
  ["telegram", "send_message", ["send"], ["message"]],
  ["gmail", "send_message", ["send"], ["email", "message"]],
  ["documents", "create_document", ["create", "save", "write"], ["document", "file"]],
  ["documents", "create_spreadsheet", ["create", "save", "write"], ["spreadsheet", "file"]],
  ["documents", "create_presentation", ["create", "save", "write"], ["presentation", "file"]],
  ["documents", "create_chart", ["create", "save", "write"], ["chart", "file"]],
  ["documents", "create_diagram", ["create", "save", "write"], ["diagram", "file"]],
  ["documents", "create_email_draft", ["create", "save", "write"], ["draft", "file"]],
  ["pc", "make_dir", ["create"], ["folder"]],
  ["pc", "write_file", ["create", "save", "write"], ["file"]],
  ["pc", "delete_path", ["remove_to_trash"], ["file", "folder"]],
  ["memory", "remember", ["create", "save"], ["note"]],
  ["github", "create_issue", ["create"], ["issue"]],
  ["github", "comment_issue", ["post_comment", "append"], ["comment"]],
  ["notion", "create_page", ["create", "save"], ["page"]],
  ["notion", "append_text", ["append", "write"], ["page"]],
  ["gworkspace", "drive_create_doc", ["create", "save"], ["document"]],
  ["gworkspace", "calendar_create_event", ["create", "schedule"], ["event"]],
  ["gworkspace", "tasks_create", ["create"], ["task"]],
];

describe("source-owned action support contract", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(expected)("declares only reviewed effects for %s.%s", (connector, action, operations, objects) => {
    const network = vi.fn(() => { throw new Error("No network"); });
    vi.stubGlobal("fetch", network);
    const spec = new ConnectorRegistry(definitions()).action(connector, action)!;
    expect(spec.kind).toBe("write");
    expect(copyResultSupport(spec.resultSupport)).toEqual(operations.map(operation => ({ operation, objects })));
    expect(network).not.toHaveBeenCalled();
  });
  it("leaves every read and generic action without claim-support metadata", () => {
    const registry = new ConnectorRegistry(definitions());
    const reviewed = new Set(expected.map(([c, a]) => `${c}.${a}`));
    for (const connector of registry.list()) for (const [name, spec] of Object.entries(connector.actions)) {
      if (spec.kind === "read" || !reviewed.has(`${connector.id}.${name}`)) expect(spec.resultSupport, `${connector.id}.${name}`).toBeUndefined();
    }
  });
  it("does exact own-property lookups, never inherited or similar names", () => {
    const registry = new ConnectorRegistry(definitions());
    expect(registry.action("gworkspace", "send_message")).toBeUndefined();
    expect(registry.action("gmail", "send_message_extra")).toBeUndefined();
    expect(registry.action("gmail", "toString")).toBeUndefined();
    expect(registry.action("missing", "send_message")).toBeUndefined();
  });
});
