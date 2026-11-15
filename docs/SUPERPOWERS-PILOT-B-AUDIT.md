# Pilot B audit: Superpowers files not reviewed before (results)

Written for: you, the owner, deciding whether Superpowers should ever be switched on for development. Run 2026-11-15 (D-123) under your approval of a ceiling of **10 outside requests** (plan: `docs/SUPERPOWERS-PILOT-B-PLAN.md`). **10 of 10 used, all succeeded, 0 remaining.** Read-only: nothing was installed, cloned, downloaded, run, registered or activated. Pinned commit: `22f0b463e7a5e579904dd6211a520321035526f7` (v7.0.2).

## NOT VERIFIED (read this first)
- **How the files were read:** each file was fetched and passed through a small summarising model. Only the files marked "verbatim" were requested as exact code blocks (hooks.json, run-hook.cmd, plugin.json, package.json, marketplace.json). The other findings (bootstrap skill, start-server.sh, server.cjs, finishing-a-development-branch) are model-written descriptions of those files, **not byte-exact quotations**. Any claim you would rely on must be re-checked against the raw file.
- **Host note:** the tree listing came from `api.github.com` (a GitHub API host), not literally `github.com` or `raw.githubusercontent.com` as the plan wrote. It is public, read-only and counted as request 1.
- **Not read (still unknown):** `skills/subagent-driven-development/*` (delegation defaults and its scripts), `skills/using-git-worktrees`, `skills/dispatching-parallel-agents`, `skills/executing-plans/scripts/*`, `hooks/hooks-cursor.json`, `index.js`, `.opencode/plugins/superpowers.js`, `.pi/extensions/superpowers.ts`, `docs/windows/polyglot-hooks.md`, the other 30+ skill and test files. How a Claude host loads `hooks/hooks.json` from a plugin and whether it auto-updates was NOT read (host behavior).
- Nothing was executed, so **no behavior, Windows compatibility or benefit is observed**. This is a reading, not a security certification.

## Request ledger
| # | URL (at the pinned commit) | Result |
|---|---|---|
| 1 | api.github.com/repos/obra/superpowers/git/trees/22f0b46...?recursive=1 | OK, not truncated |
| 2 | hooks/hooks.json | OK (verbatim) |
| 3 | hooks/run-hook.cmd | OK (verbatim) |
| 4 | .claude-plugin/plugin.json | OK (verbatim) |
| 5 | skills/using-superpowers/SKILL.md | OK (summary) |
| 6 | skills/brainstorming/scripts/start-server.sh | OK (summary) |
| 7 | skills/brainstorming/scripts/server.cjs | OK (summary) |
| 8 | package.json | OK (verbatim) |
| 9 | .claude-plugin/marketplace.json | OK (verbatim) |
| 10 | skills/finishing-a-development-branch/SKILL.md | OK (summary) |

## What each file would do
**Hook registration (`hooks/hooks.json`, verbatim).** One hook, event `SessionStart`, matcher `startup|clear|compact`, runs `run-hook.cmd session-start` synchronously (`async: false`, `shell: bash`). No other hook events. (`hooks-cursor.json` is for Cursor and was not read.)

**Launcher (`hooks/run-hook.cmd`, verbatim).** A Windows/Unix polyglot. On Windows it looks for `bash.exe` in `C:\Program Files\Git\bin`, `C:\Program Files (x86)\Git\bin`, `%LOCALAPPDATA%\Programs\Git\bin`, then on PATH (skipping the Windows WSL launchers), and runs the named hook script with it. **If no bash is found it exits silently.** No file writes, no network, reads only the environment variables it names (`LOCALAPPDATA`, `SystemRoot`, `PATH`, `BASH`). This PC has Git Bash, so the hook would run.

**Manifest (`.claude-plugin/plugin.json`, verbatim).** Metadata only (name, version 7.0.2, author, MIT). It declares no commands, permissions, dependencies or update behavior.

**Bootstrap skill (`using-superpowers`, summary).** Strongly worded: "if you think there is even a 1% chance a skill might apply ... you ABSOLUTELY MUST invoke the skill", and the skill check comes before clarifying questions and code exploration. It also says user instructions (`CLAUDE.md`, `AGENTS.md`, direct requests) take precedence over skills. It does not itself instruct commands, file writes, Git or network use.

**Visual companion (`skills/brainstorming/scripts/start-server.sh` and `server.cjs`, summary).** A local Node server with no npm dependencies. Binds to `127.0.0.1` by default on a random high port (49152-65535); `--host 0.0.0.0` would expose it. Needs a per-session key. **Writes files:** under `/tmp/brainstorm-<pid>-<time>` or, with `--project-dir`, inside the project at `.superpowers/brainstorm/` including `.last-port` and `.last-token`, which persist. Runs in the background by default and keeps running until an idle timeout (default 240 minutes) or its owner process exits (that watchdog is disabled on Windows/MSYS). Browser opening is opt-in (`BRAINSTORM_OPEN`; `BRAINSTORM_OPEN_CMD` is run through a shell). **Network:** the server makes no outbound request, but the page it serves makes the browser load an image from `https://primeradiant.com/...` unless `SUPERPOWERS_DISABLE_TELEMETRY`, `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set. No analytics code was seen in `server.cjs`.

**`package.json` (verbatim).** No scripts (no install/postinstall/prepare/update), no dependencies, no bin. Entry points are for OpenCode and Pi, not Claude.

**`marketplace.json` (verbatim).** Source is `"./"` (the repository itself) with no commit or ref pinned; `version` is descriptive. So a marketplace install tracks whatever revision is fetched, not this audited commit. No auto-update is declared in the file (the host's behavior is unknown).

**`finishing-a-development-branch` (summary).** After you pick an option it runs Git without further prompts: option 1 `git checkout <base>`, **`git pull` (contacts the remote)**, `git merge`, tests, remove the worktree, `git branch -d`; option 2 **`git push -u origin ...` and creates a PR** (publishes to a remote); "discard" (you must type it) runs `git branch -D` and removes the worktree. It asks you to choose the option first.

## Fit with this project's rules
| Upstream behavior | Conflicts with | What would have to happen |
|---|---|---|
| `git push`, PR creation, `git pull`, merges, branch deletion in the finishing skill | `CLAUDE.md` section 4 (no push, no destructive Git, commit only with explicit approval, no remote) | Never enable this skill, or override it so it cannot run those commands |
| "MUST invoke" skill rules before clarifying questions | Owner's working rule (clickable next-step prompts, inspect before changing) | Relies on the skill's own "user instructions take precedence" line; untested |
| Visual companion server, files under the project, browser asset from a third-party host | Free-only/no-outside-request rules; "no real external request without approval"; keep the repo clean | Never start it; if ever used, set the telemetry-disable variables, keep it on 127.0.0.1, use `/tmp` not `--project-dir` |
| Marketplace entry not pinned | Pinned-revision requirement | Install only from a pinned checkout, never from the moving marketplace entry |
| Subagent delegation, worktrees | "No unrequested subagents"; no worktree cleanup without approval | NOT read; assume conflict until read |
| A SessionStart hook injecting the bootstrap skill | Host settings changes are a security-boundary change | Needs its own approval and a disposable test project |

## Conclusion (a judgment, not a certification)
The parts actually read are small and mostly plain: one SessionStart hook with no network or writes, a manifest with no permissions, and no install scripts or dependencies. The risks are in the **skills' behavior** (finishing-branch Git push/merge/delete, forced skill invocation, delegation) and the **visual companion** (background server, files in the project, a third-party image). **Recommendation: do not install the plugin.** Keep using the three local checklists in `docs/dev-aids/` (already done), which take the useful ideas without the risky defaults. If you ever want a trial, it needs a separate plan: a disposable project outside this repository, pinned checkout, telemetry variables set, `finishing-a-development-branch`, worktree, delegation and visual-companion skills disabled, no automatic commits, plus the unread skills read first.

## Not done
No scratch trial, install, activation, model call or Git write. No further outside requests are approved; the 10-request allowance is used up.
