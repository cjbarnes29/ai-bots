import type { GuideLink, Tutorial, TutorialStep } from "./integrationGuides";

/**
 * The Integration Setup Center's content for outside services (2026-11-04): one entry per connector, with what it does, what it needs,
 * how to set it up, which credential it uses (with a format check) and how to disconnect. Plain data, no secrets.
 * The credentials themselves only ever go to the existing encrypted vault (PUT /api/vault/:name); nothing here stores or shows a value.
 * Official links were chosen from the services' own documentation sites; they were NOT opened during development (no external requests).
 */
export type Category = "Messaging and Communication" | "Google Services and Email" | "Development Tools" | "Productivity Services" | "Automation and Webhooks" | "Advanced Integrations (MCP)" | "On this PC";

/** The order the Integration Setup Center shows (AI Providers come first, from integrationGuides.ts). */
export const CATEGORY_ORDER: Category[] = ["Messaging and Communication", "Google Services and Email", "Development Tools", "Productivity Services", "Automation and Webhooks", "Advanced Integrations (MCP)", "On this PC"];

export interface FieldCheck {
  error: string | null;
  warning: string | null;
}

export interface CredentialField {
  /** The vault name (never the value). */
  secret: string;
  label: string;
  /** Plain words: what this is and where it comes from. */
  help: string;
  required: boolean;
  kind: "secret" | "address";
  placeholder?: string;
  check?: (value: string) => FieldCheck;
}

export interface ServiceGuide {
  id: string;
  name: string;
  category: Category;
  mark: string;
  description: string;
  /** Examples of what bots can do with it. */
  allows: string[];
  difficulty: "Easy" | "Moderate" | "Advanced" | "Nothing to set up";
  auth: "Bot token" | "Access token" | "Integration secret" | "Google sign-in (OAuth)" | "Webhook address" | "Server address (+ optional token)" | "No sign-in";
  /** The sign-in method in one simple sentence. */
  authExplain: string;
  links: GuideLink[];
  requirements: string[];
  /** The step-by-step instructions on the service's side. */
  instructions: { text: string; link?: GuideLink; copy?: { label: string; value: string } }[];
  fields: CredentialField[];
  /** Google services: the sign-in itself happens on Google's page (existing OAuth routes). */
  oauth?: "gmail" | "gworkspace";
  /** What "Test connection" does for this service. */
  testNote: string;
  troubleshooting: { problem: string; fix: string }[];
  /** What Disconnect removes from the vault, and what to do on the service's side. */
  disconnect: { secrets: string[]; note: string };
  /** Local tools: where they are configured instead. */
  configure?: { label: string; to: string };
}

const clean = (v: string) => v.trim();
const basic = (v: string, what: string): FieldCheck | null => {
  const t = clean(v);
  if (!t) return { error: `Paste the ${what} first.`, warning: null };
  if (/\s/.test(t)) return { error: `The ${what} contains a space or line break. Copy it again without extra characters.`, warning: null };
  return null;
};

export const checkTelegramToken = (v: string): FieldCheck =>
  basic(v, "token") ?? (/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(clean(v)) ? { error: null, warning: null } : { error: "A Telegram bot token looks like 123456789:AA… (numbers, a colon, then letters). Copy the whole token from BotFather's message.", warning: null });

export const checkGithubToken = (v: string): FieldCheck => {
  const b = basic(v, "token");
  if (b) return b;
  const t = clean(v);
  if (t.length < 20) return { error: "That is too short to be a GitHub token.", warning: null };
  if (t.startsWith("github_pat_")) return { error: null, warning: null };
  if (/^gh[pousr]_/.test(t)) return { error: null, warning: "This looks like a classic token. A fine-grained token (starting with github_pat_) limited to chosen repositories is safer." };
  return { error: null, warning: "GitHub tokens usually start with github_pat_. Check that you copied the token itself." };
};

export const checkNotionSecret = (v: string): FieldCheck => {
  const b = basic(v, "secret");
  if (b) return b;
  const t = clean(v);
  if (t.length < 20) return { error: "That is too short to be a Notion integration secret.", warning: null };
  return /^(ntn_|secret_)/.test(t) ? { error: null, warning: null } : { error: null, warning: "Notion integration secrets usually start with ntn_ or secret_. Check that you copied the right value." };
};

/** The same rule the backend applies (safeEndpoint): https, or http only on this PC, never with a name or password inside. */
export function checkEndpoint(v: string, service: string): FieldCheck {
  const t = clean(v);
  if (!t) return { error: `Paste the ${service} address first.`, warning: null };
  if (/^(npx|node|python|uvx|docker|cmd|powershell)\b/i.test(t) || /\.(exe|cmd|bat|ps1|py|js)$/i.test(t)) {
    return { error: "That is a command that starts a program on this PC. Only addresses (https://…) are supported; local-program servers are not.", warning: null };
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { error: "That is not a web address. It should start with https://", warning: null };
  }
  if (u.username || u.password) return { error: "The address must not contain a user name or password. Put a token in the optional token box instead.", warning: null };
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol === "https:") return { error: null, warning: null };
  if (u.protocol === "http:" && local) return { error: null, warning: null };
  if (u.protocol === "http:") return { error: "Plain http is only allowed for a server on this PC (localhost). Use the https address.", warning: null };
  return { error: "Only https:// addresses (or http://localhost) are supported.", warning: null };
}

const n8nCheck = (v: string): FieldCheck => {
  const r = checkEndpoint(v, "webhook");
  if (r.error) return r;
  return /\/webhook(-test)?\//.test(clean(v)) ? (/\/webhook-test\//.test(clean(v)) ? { error: null, warning: "This is n8n's TEST address: it only works while you press 'Listen for test event' in n8n. Use the Production URL for normal use." } : r) : { error: null, warning: "n8n webhook addresses usually contain /webhook/. Check that you copied the Production URL of the Webhook node." };
};

const optionalToken = (v: string): FieldCheck => (clean(v) === "" ? { error: null, warning: null } : (basic(v, "token") ?? { error: null, warning: null }));

const GOOGLE_CLIENT_FIELDS: CredentialField[] = [
  { secret: "GOOGLE_CLIENT_ID", label: "Google client ID", help: "From your own Google Cloud project (Credentials page). It ends in .apps.googleusercontent.com. Shared by Gmail and Google Workspace.", required: true, kind: "secret", placeholder: "…apps.googleusercontent.com", check: (v) => basic(v, "client ID") ?? (clean(v).endsWith(".apps.googleusercontent.com") ? { error: null, warning: null } : { error: null, warning: "Google client IDs end in .apps.googleusercontent.com. Check that you copied the Client ID, not the secret." }) },
  { secret: "GOOGLE_CLIENT_SECRET", label: "Google client secret", help: "Shown next to the client ID when you create it (it usually starts with GOCSPX-). It is NOT your Google password.", required: true, kind: "secret", placeholder: "GOCSPX-…", check: (v) => basic(v, "client secret") ?? (clean(v).length < 10 ? { error: "That is too short to be a client secret.", warning: null } : { error: null, warning: null }) },
];

const GOOGLE_SETUP = (apis: { name: string; href: string }[]): ServiceGuide["instructions"] => [
  { text: "Open the Google Cloud console with your Google account and create a project (free). Do not add billing.", link: { label: "Open Google Cloud credentials", href: "https://console.cloud.google.com/apis/credentials" } },
  ...apis.map((a) => ({ text: `Turn on the ${a.name}.`, link: { label: `Open the ${a.name} page`, href: a.href } })),
  { text: "Set up the consent screen (type External, add your own address as a test user).", link: { label: "Google's consent-screen guide", href: "https://developers.google.com/workspace/guides/configure-oauth-consent" } },
  { text: "Create credentials: OAuth client ID, application type Desktop app. Copy the Client ID and the Client secret.", link: { label: "Google's credentials guide", href: "https://developers.google.com/workspace/guides/create-credentials" } },
  { text: "Come back here and paste both into the next step. You do this only once: Gmail and Google Workspace share them." },
];

export const SERVICE_GUIDES: ServiceGuide[] = [
  {
    id: "telegram",
    name: "Telegram",
    category: "Messaging and Communication",
    mark: "Tg",
    description: "Lets bots send Telegram messages through your own Telegram bot, and read messages people send to it.",
    allows: ["Send you a message when a task finishes", "Post to a channel your bot is in (after your approval)", "Read messages sent to your bot (if you switch reading on)"],
    difficulty: "Easy",
    auth: "Bot token",
    authExplain: "A bot token is a password for a Telegram bot you create yourself with BotFather. It is not your Telegram account password.",
    links: [{ label: "Open BotFather in Telegram", href: "https://t.me/BotFather" }, { label: "Telegram's guide to bot tokens", href: "https://core.telegram.org/bots/tutorial#obtain-your-bot-token" }],
    requirements: ["The Telegram app (phone or computer) and your Telegram account", "About 3 minutes"],
    instructions: [
      { text: "Open BotFather in Telegram (the official bot that makes bots; it has a blue check mark).", link: { label: "Open BotFather", href: "https://t.me/BotFather" } },
      { text: "Send it this command, then answer its two questions (a display name, then a user name ending in bot).", copy: { label: "Command for BotFather", value: "/newbot" } },
      { text: "BotFather replies with a token like 123456789:AA… Copy the whole token." },
      { text: "Come back here and paste it into the next step." },
    ],
    fields: [{ secret: "TELEGRAM_BOT_TOKEN", label: "Telegram bot token", help: "The token BotFather sent you.", required: true, kind: "secret", placeholder: "123456789:AA…", check: checkTelegramToken }],
    testNote: "Asks Telegram who the bot is (getMe). Nothing is sent to anyone.",
    troubleshooting: [
      { problem: "Telegram did not accept the token", fix: "Copy the token again from BotFather (send /mybots, choose your bot, API Token). If you revoked it, use the new one." },
      { problem: "It says the token does not look right", fix: "A token is numbers, a colon, then letters, with no spaces, for example 123456789:AAH…" },
      { problem: "Messages do not arrive in a group", fix: "Add your bot to the group first. Bots can only message chats they are in or that started a chat with them." },
    ],
    disconnect: { secrets: ["TELEGRAM_BOT_TOKEN"], note: "The token is deleted from this PC. To switch the bot off completely, send /revoke to BotFather." },
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "Google Services and Email",
    mark: "Gm",
    description: "Lets bots search and read your email, and send email after you approve each one. You sign in on Google's own page: your password never reaches this app.",
    allows: ["Find the latest invoice from a supplier", "Summarise unread mail", "Draft a reply and send it after your approval"],
    difficulty: "Moderate",
    auth: "Google sign-in (OAuth)",
    authExplain: "OAuth means you sign in on Google's own page and Google gives this app a limited permission. Never type your Gmail password anywhere in this app.",
    links: [{ label: "Google Cloud console", href: "https://console.cloud.google.com/apis/credentials" }, { label: "Remove access later (Google account)", href: "https://myaccount.google.com/permissions" }],
    requirements: ["Your Google account", "A free Google Cloud project (one-time setup, about 10 minutes)", "No payment card"],
    instructions: GOOGLE_SETUP([{ name: "Gmail API", href: "https://console.cloud.google.com/apis/library/gmail.googleapis.com" }]),
    fields: GOOGLE_CLIENT_FIELDS,
    oauth: "gmail",
    testNote: "Asks Gmail which address is signed in. No email is read or sent.",
    troubleshooting: [
      { problem: "Google says the app is not verified", fix: "Choose Advanced, then continue: it is your own Google Cloud project, used only by you." },
      { problem: "It worked, then stopped after about a week", fix: "While the consent screen is in Testing, Google ends the sign-in after about 7 days. Press Sign in with Google again." },
      { problem: "Google says redirect_uri_mismatch", fix: "Use an OAuth client of type Desktop app, or add the redirect address shown in the sign-in step to the client." },
      { problem: "Access denied or a permission is missing", fix: "Sign in again and tick every permission Google asks for (read mail, send mail)." },
    ],
    disconnect: { secrets: ["GMAIL_REFRESH_TOKEN"], note: "The Gmail sign-in is deleted from this PC (the shared Google client stays for Google Workspace). Also remove the app at myaccount.google.com/permissions." },
  },
  {
    id: "gworkspace",
    name: "Google Workspace",
    category: "Google Services and Email",
    mark: "Gw",
    description: "Lets bots read your Drive files, Docs, Sheets and Slides (as text), calendar and tasks, and create new documents, events and tasks after your approval. Nothing can be deleted or shared.",
    allows: ["Find a document in Drive and summarise it", "Add a calendar event (after your approval)", "Create a task list item"],
    difficulty: "Moderate",
    auth: "Google sign-in (OAuth)",
    authExplain: "You sign in on Google's own page; this app receives a limited permission and never your password. It uses the same Google client as Gmail.",
    links: [{ label: "Google Cloud console", href: "https://console.cloud.google.com/apis/credentials" }, { label: "Remove access later (Google account)", href: "https://myaccount.google.com/permissions" }],
    requirements: ["Your Google account", "The same free Google Cloud project as Gmail (or a new one)", "No payment card"],
    instructions: GOOGLE_SETUP([
      { name: "Google Drive API", href: "https://console.cloud.google.com/apis/library/drive.googleapis.com" },
      { name: "Google Calendar API", href: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" },
      { name: "Google Tasks API", href: "https://console.cloud.google.com/apis/library/tasks.googleapis.com" },
    ]),
    fields: GOOGLE_CLIENT_FIELDS,
    oauth: "gworkspace",
    testNote: "Asks Google Drive which account is signed in. No file is read or changed.",
    troubleshooting: [
      { problem: "Google says this sign-in is not allowed", fix: "Turn on the Drive, Calendar and Tasks APIs in the project, then sign in again and accept every permission." },
      { problem: "It stopped after about a week", fix: "While the consent screen is in Testing, sign-ins end after about 7 days. Sign in again." },
      { problem: "Google Forms do not work", fix: "Google Forms is not supported." },
    ],
    disconnect: { secrets: ["GOOGLE_WORKSPACE_REFRESH_TOKEN"], note: "The Google Workspace sign-in is deleted from this PC (the shared Google client stays for Gmail). Also remove the app at myaccount.google.com/permissions." },
  },
  {
    id: "github",
    name: "GitHub",
    category: "Development Tools",
    mark: "GH",
    description: "Lets bots read issues, pull requests and files in the repositories you choose, and open issues or comment after your approval.",
    allows: ["Summarise the open issues of a project", "Read a README or config file", "Open an issue (after your approval)"],
    difficulty: "Moderate",
    auth: "Access token",
    authExplain: "A fine-grained personal access token is a limited password you create on GitHub. You choose exactly which repositories and actions it allows.",
    links: [{ label: "Create a fine-grained token on GitHub", href: "https://github.com/settings/personal-access-tokens/new" }, { label: "GitHub's guide to access tokens", href: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" }],
    requirements: ["A GitHub account", "About 5 minutes"],
    instructions: [
      { text: "Open GitHub's page for a new fine-grained token.", link: { label: "Create a fine-grained token", href: "https://github.com/settings/personal-access-tokens/new" } },
      { text: "Name it AI Workforce and choose an expiry (90 days is a good balance)." },
      { text: "Repository access: choose Only select repositories, and pick only the ones bots should see." },
      { text: "Permissions (the minimum): Contents: Read-only; Pull requests: Read-only; Issues: Read-only. Choose Issues: Read and write ONLY if bots should open issues or comment (each one still waits for your approval). Leave everything else at No access." },
      { text: "Press Generate token and copy it straight away (GitHub shows it only once). It starts with github_pat_." },
    ],
    fields: [{ secret: "GITHUB_TOKEN", label: "GitHub token", help: "The fine-grained token you just created.", required: true, kind: "secret", placeholder: "github_pat_…", check: checkGithubToken }],
    testNote: "Asks GitHub which account the token belongs to. Nothing is read from or changed in any repository.",
    troubleshooting: [
      { problem: "GitHub did not accept the saved token", fix: "The token may have expired or been deleted. Create a new one and replace it here." },
      { problem: "GitHub says the token is not allowed to do that", fix: "Edit the token on GitHub: add the repository, or give the permission the bot needs (for example Issues: Read and write)." },
      { problem: "A repository cannot be found", fix: "The token only sees the repositories you selected. Add the repository to the token." },
    ],
    disconnect: { secrets: ["GITHUB_TOKEN"], note: "The token is deleted from this PC. Also delete it on GitHub (Settings, Developer settings, Personal access tokens)." },
  },
  {
    id: "notion",
    name: "Notion",
    category: "Productivity Services",
    mark: "No",
    description: "Lets bots search and read the Notion pages you share with it, and create pages or add text after your approval.",
    allows: ["Read meeting notes and summarise them", "Add a summary to a page (after your approval)", "Create a new page under a project page"],
    difficulty: "Moderate",
    auth: "Integration secret",
    authExplain: "An internal integration secret is a password for a small Notion app you create. It can only see the pages you explicitly share with it.",
    links: [{ label: "Open Notion integrations", href: "https://www.notion.so/profile/integrations" }, { label: "Notion's guide to integrations", href: "https://developers.notion.com/docs/create-a-notion-integration" }],
    requirements: ["A Notion account (you must be able to add integrations in the workspace)", "About 5 minutes"],
    instructions: [
      { text: "Open Notion's integrations page and create a new integration of type Internal. Name it AI Workforce and pick your workspace.", link: { label: "Open Notion integrations", href: "https://www.notion.so/profile/integrations" } },
      { text: "Capabilities: Read content. Add Insert content only if bots should create pages or add text (each change still waits for your approval). No user information is needed." },
      { text: "Copy the Internal Integration Secret (it starts with ntn_)." },
      { text: "Share pages with it: open each page bots may use, choose the ... menu, then Connections, and add AI Workforce. Sub-pages are included. Pages you do not share stay invisible." },
    ],
    fields: [{ secret: "NOTION_TOKEN", label: "Notion integration secret", help: "The Internal Integration Secret of the integration you created.", required: true, kind: "secret", placeholder: "ntn_…", check: checkNotionSecret }],
    testNote: "Asks Notion which integration the secret belongs to. No page is read or changed.",
    troubleshooting: [
      { problem: "Notion did not accept the secret", fix: "Copy the secret again from the integration's page (Show, then Copy), or create a new one." },
      { problem: "The bot finds no pages", fix: "Share the pages with the integration (page ... menu, Connections). Only shared pages are visible." },
      { problem: "Creating a page is refused", fix: "Give the integration the Insert content capability, and share the parent page with it." },
    ],
    disconnect: { secrets: ["NOTION_TOKEN"], note: "The secret is deleted from this PC. Also remove the integration in Notion's integrations page, or remove its page connections." },
  },
  {
    id: "n8n",
    name: "n8n",
    category: "Automation and Webhooks",
    mark: "n8",
    description: "Lets bots start ONE n8n workflow you choose, by calling its webhook address with a short text. Each start waits for your approval.",
    allows: ["Start a workflow that updates a spreadsheet", "Hand a finished summary to your own automation"],
    difficulty: "Advanced",
    auth: "Webhook address",
    authExplain: "A webhook address is a private web link that starts a workflow when something calls it. Keep it private: anyone with it can start the workflow.",
    links: [{ label: "n8n's Webhook node guide", href: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/" }, { label: "n8n website", href: "https://n8n.io/" }],
    requirements: ["An n8n you run (n8n cloud or self-hosted)", "A workflow that starts with a Webhook node (method POST)"],
    instructions: [
      { text: "In n8n, open the workflow and add a Webhook node as its first step. Set the HTTP method to POST.", link: { label: "n8n's Webhook node guide", href: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/" } },
      { text: "The bot sends JSON with a field named text. Use it in the next nodes, for example {{$json.body.text}}.", copy: { label: "Field the bot sends", value: "{{$json.body.text}}" } },
      { text: "Activate the workflow, then copy the Production URL of the Webhook node (it contains /webhook/)." },
      { text: "Paste it into the next step. It must start with https:// (or http://localhost if n8n runs on this PC)." },
    ],
    fields: [{ secret: "N8N_WEBHOOK_URL", label: "n8n webhook address (Production URL)", help: "The only thing bots can start. https, or http://localhost when n8n runs on this PC.", required: true, kind: "address", placeholder: "https://…/webhook/…", check: n8nCheck }],
    testNote: "The address is checked here (format, https). It is NOT called, because calling it would really start your workflow.",
    troubleshooting: [
      { problem: "n8n refused the request (404)", fix: "The workflow is not active, or you copied the Test URL. Activate it and use the Production URL." },
      { problem: "It says the address is not allowed", fix: "Use https://. Plain http is only accepted for an n8n running on this PC (localhost)." },
      { problem: "The workflow receives no text", fix: "Read the field body.text in the node after the Webhook node." },
    ],
    disconnect: { secrets: ["N8N_WEBHOOK_URL"], note: "The address is deleted from this PC. To be sure nobody else can use it, deactivate the workflow or change its webhook path in n8n." },
  },
  {
    id: "mcp",
    name: "MCP server",
    category: "Advanced Integrations (MCP)",
    mark: "MC",
    description: "Connects ONE Model Context Protocol server over the web. Bots can list its tools freely; running a tool always waits for your approval.",
    allows: ["Use a company knowledge-base server", "Run a tool from a server you trust (after approval each time)"],
    difficulty: "Advanced",
    auth: "Server address (+ optional token)",
    authExplain: "MCP is a standard way for AI apps to use tools on a server. You give the server's web address and, if it needs one, an access token.",
    links: [{ label: "Model Context Protocol website", href: "https://modelcontextprotocol.io/" }, { label: "MCP connection types (transports)", href: "https://modelcontextprotocol.io/specification/2025-03-26/basic/transports" }],
    requirements: ["An MCP server reachable over https (\"streamable HTTP\"), or one running on this PC at http://localhost", "Its access token, if it asks for one"],
    instructions: [
      { text: "Supported: servers that speak MCP over HTTP (streamable HTTP), at an https:// address, or http://localhost on this PC." },
      { text: "NOT supported: servers that are started as a local program (stdio, for example 'npx some-mcp-server'). Starting programs for bots is deliberately not allowed here. Run such a server behind an HTTP bridge you trust, or do not use it." },
      { text: "Get the server's address from its documentation or administrator (it often ends in /mcp)." },
      { text: "If the server needs a token, ask its administrator for one with the least access possible." },
    ],
    fields: [
      { secret: "MCP_SERVER_URL", label: "Server address", help: "https://…, or http://localhost when the server runs on this PC.", required: true, kind: "address", placeholder: "https://example.com/mcp", check: (v) => checkEndpoint(v, "MCP server") },
      { secret: "MCP_SERVER_TOKEN", label: "Access token", help: "Only if the server asks for one. Sent as a Bearer token.", required: false, kind: "secret", check: optionalToken },
    ],
    testNote: "Connects and asks the server for its list of tools. No tool is run.",
    troubleshooting: [
      { problem: "The MCP server did not accept the saved token", fix: "Check the token with the server's administrator and replace it here." },
      { problem: "Could not reach the MCP server", fix: "Check the address, that the server is running, and that it speaks MCP over HTTP (not stdio)." },
      { problem: "It refuses a command like npx …", fix: "Local-program (stdio) servers are not supported. Use a server that offers an https address." },
    ],
    disconnect: { secrets: ["MCP_SERVER_URL", "MCP_SERVER_TOKEN"], note: "The address and token are deleted from this PC." },
  },
  // ---- tools that run on this PC: no sign-in; configured on their own pages ----
  { id: "pc", name: "PC (PowerShell tools)", category: "On this PC", mark: "PC", description: "Lets approved bots run a short list of developer commands in project folders you choose.", allows: ["Run the tests of a project", "Check a build"], difficulty: "Nothing to set up", auth: "No sign-in", authExplain: "Nothing to sign in to: you choose folders and commands on this PC.", links: [], requirements: ["A project folder"], instructions: [{ text: "Add a workspace folder in the PC Control Center, then allow the PC agent on a bot's Permissions tab." }], fields: [], testNote: "Checks that the PC agent is ready. Nothing runs.", troubleshooting: [{ problem: "Not set up", fix: "Add a workspace folder in the PC Control Center." }], disconnect: { secrets: [], note: "" }, configure: { label: "Open the PC Control Center", to: "/pc" } },
  { id: "documents", name: "Documents", category: "On this PC", mark: "Dc", description: "Lets bots create Word, Excel, PowerPoint and PDF files and charts in your workspace folder.", allows: ["Turn a summary into a Word document", "Make a chart from numbers"], difficulty: "Nothing to set up", auth: "No sign-in", authExplain: "Nothing to sign in to.", links: [], requirements: ["A workspace folder"], instructions: [{ text: "Choose a workspace folder in the PC Control Center." }], fields: [], testNote: "Checks that the folder is ready. Nothing is written.", troubleshooting: [{ problem: "Not set up", fix: "Choose a workspace folder in the PC Control Center." }], disconnect: { secrets: [], note: "" }, configure: { label: "Open the PC Control Center", to: "/pc" } },
  { id: "memory", name: "Memory", category: "On this PC", mark: "Me", description: "Notes bots can remember, kept on this PC.", allows: ["Remember your preferences", "Share notes between bots you choose"], difficulty: "Nothing to set up", auth: "No sign-in", authExplain: "Nothing to sign in to.", links: [], requirements: [], instructions: [{ text: "Manage notes on the Knowledge page." }], fields: [], testNote: "Checks that memory is ready.", troubleshooting: [], disconnect: { secrets: [], note: "" }, configure: { label: "Open Knowledge", to: "/knowledge" } },
  { id: "browser", name: "Browser", category: "On this PC", mark: "Br", description: "Lets bots read public web pages (no sign-in, no scripts).", allows: ["Read a public article", "Check a public price list"], difficulty: "Nothing to set up", auth: "No sign-in", authExplain: "Nothing to sign in to.", links: [], requirements: [], instructions: [{ text: "Switch web reading on for a bot on its Permissions tab." }], fields: [], testNote: "It is only tested when a bot reads a page.", troubleshooting: [], disconnect: { secrets: [], note: "" }, configure: { label: "Open your bots", to: "/agents" } },
  { id: "desktop", name: "Desktop applications", category: "On this PC", mark: "Ap", description: "Lets bots operate programs you approved, one approved plan at a time.", allows: ["Fill in a form in an approved program", "Save a file into an approved folder"], difficulty: "Nothing to set up", auth: "No sign-in", authExplain: "Nothing to sign in to: you approve programs and folders.", links: [], requirements: ["An approved program and folder"], instructions: [{ text: "Approve the program and its folder on the Access page." }], fields: [], testNote: "It is tested when a bot uses a program.", troubleshooting: [], disconnect: { secrets: [], note: "" }, configure: { label: "Open Access", to: "/access" } },
  { id: "business", name: "Business Workforce", category: "On this PC", mark: "Bw", description: "Lead files for the Business Workforce, kept on this PC.", allows: ["Save approved leads to a spreadsheet"], difficulty: "Nothing to set up", auth: "No sign-in", authExplain: "Nothing to sign in to.", links: [], requirements: [], instructions: [{ text: "Use the Business Workforce page." }], fields: [], testNote: "Checks that the lead files are ready.", troubleshooting: [], disconnect: { secrets: [], note: "" }, configure: { label: "Open Business Workforce", to: "/business" } },
];

export const serviceGuide = (id: string | undefined) => SERVICE_GUIDES.find((g) => g.id === id);

/** Plain-language explanation of a failed connection test, by the reason the backend gives. */
export function explainFailure(reason: string | undefined, guide: ServiceGuide | undefined): string {
  switch (reason) {
    case "auth_rejected":
      return `${guide?.name ?? "The service"} did not accept what you saved. Copy it again from the service (no spaces) and replace it in the Sign in step.`;
    case "unreachable":
      return "The service could not be reached. Check your internet connection and the address, then test again.";
    case "insufficient_permission":
      return "What you saved works, but it is not allowed to do this. Give it the missing permission on the service's side.";
    case "not_configured":
      return "Something is still missing. Finish the Sign in step first.";
    default:
      return "The check did not succeed. The details below say why; the troubleshooting list may help.";
  }
}

/** The same content as a step-by-step tutorial (used by /integrations/guide/:id). */
export function serviceTutorial(g: ServiceGuide): Tutorial {
  const steps: TutorialStep[] = [
    { title: "What it does", text: [g.description, ...g.allows.map((a) => `Example: ${a}.`)] },
    { title: "What you need", text: g.requirements.length ? g.requirements : ["Nothing special."] },
    {
      title: "Set it up",
      text: g.instructions.length ? ["Follow these steps:"] : [],
      numbered: g.instructions.map((i) => i.text),
      links: g.instructions.flatMap((i) => (i.link ? [i.link] : [])).concat(g.links).filter((l, i, a) => a.findIndex((x) => x.href === l.href) === i),
      copy: g.instructions.flatMap((i) => (i.copy ? [i.copy] : [])),
    },
    { title: "Connect it", text: [g.authExplain, g.fields.length ? `You will paste: ${g.fields.map((f) => `${f.label}${f.required ? "" : " (optional)"}`).join(", ")}. It is stored encrypted on this PC and never shown again.` : "There is nothing to paste."], appLink: g.configure ?? { label: `Start the ${g.name} wizard`, to: `/integrations/setup/${g.id}` } },
    { title: "Test it", text: [g.testNote] },
    { title: "Disconnect", text: [g.disconnect.note || "Switch it off for a bot on that bot's Permissions tab."] },
  ];
  return { id: g.id, title: `Connect ${g.name}`, summary: g.description, steps, troubleshooting: g.troubleshooting };
}
