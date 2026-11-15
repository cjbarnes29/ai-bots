# Owner checklist: connect Gemini (free plan only)

Written for: you, the owner. Prepared 2026-11-15 (D-120). **Claude has not contacted Google, created a key, or seen any key.** Gemini stays **NOT VERIFIED (NV-3)** until you do the steps below and one real reply is recorded. The app already has a full in-app guide (`web/src/lib/integrationGuides.ts`, shown in the Integrations Center); this page is the short version plus the approvals Claude needs from you.

## Rules that protect you
- **Free only.** Never add a payment card or billing to the Google project that holds this key. The wizard asks you to confirm billing is off. This app never turns billing on.
- **Never paste the key in a chat message** (not to Claude, not anywhere). Paste it only into the app's Gemini wizard, which stores it encrypted on this PC and never shows it again.
- **Privacy on the free plan:** Google may use free-plan prompts to improve its products. Send only fictional or non-private text while testing.
- Claude will never ask you for, read, print or log the key.

## Your steps (about 5 minutes)
1. Open https://aistudio.google.com/ and sign in with your Google account (accept terms if asked).
2. Open https://aistudio.google.com/app/apikey and choose **Create API key**. If it asks for a project, let it create a new one. Do not attach billing.
3. Copy the key (it starts with `AIza`). Keep it private.
4. In the app: **Integrations Center** > **Connect** on **Google Gemini** > paste the key > confirm "no billing" > run the wizard's **Test connection**.
5. Tell Claude "Gemini connected" (nothing else; never the key).

## What Claude needs from you before any real request
Each real request to Google needs your approval of its exact count (`CLAUDE.md` section 5). Proposed, for you to approve or change:

| Request | Count | Why |
|---|---|---|
| The wizard's Test connection (lists models; no tokens) | 1 | Shows the key works |
| One test message: "Reply with: Gemini connection successful." | 1 | NV-3 evidence: one real reply with the model recorded |
| **Total** | **2 Google requests** | Nothing else: no map, website or email request, nothing sent anywhere |

Switching between providers (P-42, up to 6 more Google requests) is a separate approval and is not included.

## How Claude will report it
What the real model replied, which model answered, what the usage record shows, and what was **not** observed (other models, other prompts, quotas, speed). One sample is not proof. Results go to `docs/DECISION-BOARD.md` NV-3 only if the reply really arrived.

## What is NOT known
Google's current free limits and terms were **not checked** by Claude (checking them is itself an outside request and needs a separate approved count). The app's own request limits (`src/llm/limits.ts`) stay as approved; do not raise them without checking Google's real quota.

## If something goes wrong
A rejected key, "billing" warning, rate limit or error: do not retry many times. Tell Claude the error message (never the key). The app reports provider errors in plain words and falls back only to other free models you enabled.
