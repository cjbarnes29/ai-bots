# connectors

What bots may reach outside this PC. Every connector sits behind the approval gate (`src/approvals`): reads need the per-bot read permission,
writes always need the owner's approval, and each action's arguments are checked against a strict schema before anything is asked or run.

| Connector | File | Reads (need per-bot permission) | Writes (always need approval) | Set-up the owner does |
|---|---|---|---|---|
| Telegram | `telegram.ts` | read_messages | send_message | Bot token from @BotFather, pasted in Settings |
| Gmail | `gmail.ts` | search_messages, read_message | send_message | Own Google OAuth client (ID + secret in Settings), then "Connect Gmail" |
| Browser | `browser/` | read_page | submit_form | Nothing |

Gmail: OAuth 2.0 with PKCE, one-time `state`, loopback redirect to this PC; only read + send scopes; only the refresh token is stored (vault).
Browser: public https only, ports 443 only, no IP-number addresses, no private/internal names; the name is looked up and EVERY answer must be a public
address, then the connection is pinned to that checked address; every redirect is re-checked; POST is never redirected; no cookies, no scripts,
1 MB / 15 s limits. It is a page reader, not a full browser (no JavaScript, no logins).
