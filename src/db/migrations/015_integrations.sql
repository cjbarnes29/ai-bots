-- Stage 7: integrations (GitHub, Notion, n8n, MCP, Google Workspace). Which bots may READ through which integration.
-- Writes never use this table: every write always needs the owner's approval.
CREATE TABLE integration_access (
  bot_id     TEXT NOT NULL REFERENCES bots(id),
  connector  TEXT NOT NULL CHECK (connector IN ('github', 'notion', 'n8n', 'mcp', 'gworkspace')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, connector)
);
