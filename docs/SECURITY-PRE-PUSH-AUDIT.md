# Pre-push secret audit (redacted)

Written for: you, the owner, before the first GitHub push. Date 2026-11-20. **Read-only audit: no project file was changed or deleted, no history was rewritten, nothing was pushed.** No value below is printed in full: samples show the first 4 characters and a length only.

## Result in one line
**No real credential, token, password or private key was found in the 821 tracked files or in all 110 commits.** Every match is a dummy test value, a variable name or a placeholder. This is a pattern-and-shape audit, not proof of absence (see "Limits").

## What was scanned
- All 821 tracked files (working tree), and every added line in all 110 commits on all branches (`git log --all -p`).
- Patterns: Google API keys (`AIza`), Groq (`gsk_`), OpenAI/Anthropic-style (`sk-`), GitHub (`ghp_`, `github_pat_`), Slack, AWS, Hugging Face, Telegram bot tokens, Google OAuth (`GOCSPX-`, `ya29.`, `1//`), JWTs, Stripe, SendGrid, npm, Tailscale, private-key blocks, URLs with a password, and "key/secret/token/password = long string" assignments.
- Each key-shaped hit was classified by shape (length, distinct characters, alphabet or digit sequences, readable words such as fake/test). Real keys are random; every hit failed that test.

## Findings by file
| Severity | File(s) | What it is | Action |
|---|---|---|---|
| None (real) | `scripts/e2e/gemini-real.mjs` L88 | A deliberately invalid key for the fallback test: lowercase, hyphenated words, not a real key shape. The script reads the real key only from the `GEMINI_API_KEY` environment variable and stops if it is unset | None |
| None | about 45 `*.test.ts(x)` files (`AIza…`, `gsk_…`, `ghp_…`, Telegram-shaped values) | Dummy fixtures, mostly `ABCDEF…`/`A1B2C3…` sequences, used to test that secrets are redacted and refused | None |
| None | `src/connectors/gmail.test.ts`, `integrations.test.ts` | `GOCSPX-Fake…`, `ya29.Fake…`, `1//0gFake…` test constants | None |
| None | `src/llm/plugins/*.ts`, `web/src/lib/serviceGuides.ts`, `src/vault/vault.test.ts` | Environment-variable NAMES (`GEMINI_API_KEY`, …), not values | None |
| None | `src/connectors/gmail.ts`, `*netfetch*`, `api.test.ts`, `browser.test.ts` | Public OAuth URL and `user:pass@` placeholders for URL-handling tests | None |
| None | `.env.example` | All key fields are blank; the file says never to put real keys in it | None |
| Info | `.gitignore` (uncommitted change) | Adds `.codex-remote-attachments/` and `.commit-review/` (phone screenshots, 90 MB of review exports). Ignore rules confirmed for `.env`, `data/`, `.claude/`, `node_modules/` | Commit the change before pushing so those folders cannot be added by accident |
| Info | `AGENTS.md` (untracked) | Copy of the project instructions. No secrets, no personal data. It says "There is no remote", but `origin` is set | Decide whether to track it; update that line if so |

## Privacy notes (not credentials)
- The Windows user name `carlou` appears 17 times in 17 tracked files (local paths in `docs/evidence/*.json`, a few docs, one script). Low severity: it reveals a PC account name, not a login. Recommended: decide if you are happy with that in a public repo; if not, replace with a neutral path in those files in a normal commit (history would still contain it).
- No real email address is tracked. Test addresses use `example.com`. Phone numbers in tests are synthetic (`+971 4 123 4567`, `0501234567`).
- All 110 commits use the GitHub no-reply address `cjbarnes29@users.noreply.github.com`; no private email is exposed.
- 61+ screenshots under `docs/evidence/` (daily-use, approvals, verification) are tracked. They come from fake-service runs, but I did not view every image. Look through them once before making the repository public.
- `docs/evidence/real-*.json` come from real provider runs (counts, timings, redacted text). I found no key or Authorization header in them.

## What was checked and is safe
- `.env`, `*.db`, `*.sqlite`, `*.pem`, `*.key`, `data/`, `.claude/` are ignored and none was ever tracked (only `.env.example` ever appeared in history under a secret-like name).
- The remote `origin` (`github.com/cjbarnes29/ai-bots`) shows no branches yet, so this will be a first push.

## Fixes made
None were needed. No code, test or tracked file was changed, so no test run applies. The `.gitignore` edit and `AGENTS.md` were already in your working tree.

## Limits (NOT verified)
- Pattern and shape checks can miss a secret in an unusual format, inside an image, or inside a binary. I did not view the images or decode any archive.
- I did not run a dedicated scanner such as gitleaks or trufflehog (none installed; installing one needs your approval).
- Ignored local files (for example your real `data/` database and vault key) were not opened. They are not part of the repository, but never copy them into it.
- Same-user tamper protection and the real Gemini key's safety are outside this audit.

## Recommended steps before the first push (all need your say-so)
1. Commit the `.gitignore` change on its own.
2. Decide on `AGENTS.md` and the `carlou` path mentions.
3. Skim `docs/evidence/**/*.png` once, then push yourself (or ask me and say so in that message).
4. Never rewrite history unless a real secret is ever found; this audit found none.
