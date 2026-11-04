/**
 * What commands a bot may ask the PC to run, decided by RULES, never by trusting text. A command is never a shell string: it is a program
 * name from a short list plus a list of arguments, each of which must pass these rules. Anything not clearly allowed is refused with a reason.
 *
 * Tiers: EXECUTE runs the safe developer commands below. INSTALL adds packages (always with install scripts turned off). ADMIN does not exist in
 * this build: nothing here can raise privileges. Destructive git commands, deleting programs, shells, `-e`/`-c` code flags, downloads and
 * global installs are simply not on the lists.
 */
export const PC_GRANTS = ["read", "execute", "modify", "install", "admin"] as const;
export type PcGrant = (typeof PC_GRANTS)[number];

export const ACTION_GRANT: Record<string, PcGrant> = {
  list_dir: "read",
  read_file: "read",
  system_status: "read",
  make_dir: "modify",
  write_file: "modify",
  delete_path: "modify",
  run_command: "execute",
  start_server: "execute",
  install_dependencies: "install",
};

export const PROGRAMS = ["node", "npm", "git", "python", "adb", "code"] as const;
export type Program = (typeof PROGRAMS)[number];

/** Letters, digits and a few harmless symbols. No quotes, no `& | < > ^ % ! $ ` ; { } [ ]`, so nothing can break out into a shell. */
export const SAFE_ARG = /^[A-Za-z0-9_.,:@/\\=+#~-]{1,300}$/;
/** Only for a commit message: also allows spaces and a few punctuation marks. */
export const SAFE_MESSAGE = /^[A-Za-z0-9 _.,:;@/()+=#'?-]{1,200}$/;
const SAFE_WORD = /^[A-Za-z0-9_.-]{1,100}$/;
const SCRIPT_NAME = /^[A-Za-z0-9:_-]{1,60}$/;

export type CommandCheck = { ok: true; program: Program; argv: string[]; display: string; pathArgs: string[]; messageIndexes: number[] } | { ok: false; reason: string };

const no = (reason: string): CommandCheck => ({ ok: false, reason });
const yes = (program: Program, argv: string[], pathArgs: string[] = [], messageIndexes: number[] = []): CommandCheck => ({
  ok: true,
  program,
  argv,
  pathArgs,
  messageIndexes,
  display: [program, ...argv.map((a, i) => (messageIndexes.includes(i) ? `"${a}"` : a))].join(" "),
});

const isFlag = (a: string) => a.startsWith("-");
const looksLikePath = (a: string) => /[\\/]/.test(a) || /^\.{1,2}$/.test(a) || /\.[A-Za-z0-9]{1,5}$/.test(a);

function checkNode(args: string[]): CommandCheck {
  const [first, ...rest] = args;
  if (!first) return no("Say which script to run, for example: node build.js");
  if (first === "--version") return args.length === 1 ? yes("node", args) : no("--version takes nothing after it.");
  if (first === "--test") return rest.every((a) => !isFlag(a) && SAFE_ARG.test(a)) ? yes("node", args, rest) : no("Only test file names may follow --test.");
  if (isFlag(first)) return no("Node flags such as -e, --eval, -r or --import run code that is not in a file, so they are not allowed. Run a script file instead.");
  if (!/\.(c|m)?js$/i.test(first)) return no("Only .js, .mjs and .cjs script files can be run with node.");
  if (rest.some((a) => !SAFE_ARG.test(a) && !SAFE_WORD.test(a))) return no("A script argument has characters that are not allowed.");
  return yes("node", args, [first]);
}

function checkNpm(args: string[]): CommandCheck {
  const [sub, ...rest] = args;
  if (sub === "--version" && rest.length === 0) return yes("npm", args);
  if (sub === "test" || sub === "ls" || sub === "list" || sub === "outdated") return rest.length === 0 ? yes("npm", args) : no(`"npm ${sub}" takes no extra arguments here.`);
  if (sub === "audit") return rest.length === 0 ? yes("npm", args) : no('Only plain "npm audit" is allowed (it never changes anything).');
  if (sub === "run") {
    const [script, ...extra] = rest;
    if (!script || !SCRIPT_NAME.test(script)) return no('Name the package.json script, for example: npm run build');
    if (extra.length > 0) {
      if (extra[0] !== "--" || extra.slice(1).some((a) => !SAFE_ARG.test(a))) return no('Extra arguments must come after "--" and use plain characters.');
    }
    return yes("npm", args);
  }
  if (sub === "install" || sub === "i" || sub === "ci" || sub === "add" || sub === "uninstall" || sub === "update") return no("Installing needs the separate Install permission (use install_dependencies).");
  if (sub === "exec" || sub === "x" || sub === "init" || sub === "publish" || sub === "login" || sub === "config" || sub === "link") return no(`"npm ${sub}" is not allowed.`);
  return no("That npm command is not on the allowed list (run, test, ls, outdated, audit, --version).");
}

const GIT_FLAGS: Record<string, string[]> = {
  status: ["-s", "--short", "-b", "--branch", "--porcelain"],
  log: ["--oneline", "--stat", "--graph", "-p", "--name-only"],
  diff: ["--stat", "--staged", "--cached", "--name-only", "--name-status"],
  show: ["--stat", "--oneline", "--name-only"],
  branch: ["--list", "-a", "-v", "--show-current"],
  add: ["-A", "--all", "-u"],
};

function checkGit(args: string[]): CommandCheck {
  const [sub, ...rest] = args;
  if (sub === "--version" && rest.length === 0) return yes("git", args);
  if (!sub) return no("Say which git command, for example: git status");
  if (sub === "init") return rest.length === 0 ? yes("git", args) : no("git init takes nothing after it.");
  if (sub === "commit") {
    // exactly: git commit -m "<message>"
    if (rest.length === 2 && rest[0] === "-m" && SAFE_MESSAGE.test(rest[1]!)) return yes("git", args, [], [2]);
    if (rest.length === 3 && rest[0] === "-a" && rest[1] === "-m" && SAFE_MESSAGE.test(rest[2]!)) return yes("git", args, [], [3]);
    return no('Commits must look like: git commit -m "message" (plain words, no quotes inside).');
  }
  if (sub === "checkout" || sub === "switch") {
    const name = rest.length === 2 && rest[0] === "-b" ? rest[1] : rest.length === 1 ? rest[0] : undefined;
    return name && !isFlag(name) && SAFE_WORD.test(name) ? yes("git", args) : no(`Use: git ${sub} <branch name> (or -b <new name>). Forcing is not allowed.`);
  }
  if (sub === "stash") return rest.length === 0 || (rest.length === 1 && ["list", "push", "pop"].includes(rest[0]!)) ? yes("git", args) : no("Only git stash, stash list, stash push and stash pop are allowed.");
  const allowed = GIT_FLAGS[sub];
  if (!allowed) {
    return no(`"git ${sub}" is not allowed here. Push, pull, fetch, clone, reset, clean, rebase, merge and config are not available, so nothing can leave this PC or be thrown away.`);
  }
  const pathArgs: string[] = [];
  let sawDashDash = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--") {
      sawDashDash = true;
      continue;
    }
    if (isFlag(a) && !sawDashDash) {
      if (a === "-n" && sub === "log" && /^\d{1,3}$/.test(rest[i + 1] ?? "")) {
        i++;
        continue;
      }
      if (/^-\d{1,3}$/.test(a) && sub === "log") continue;
      if (!allowed.includes(a)) return no(`The option ${a} is not allowed for git ${sub}.`);
      continue;
    }
    if (!SAFE_ARG.test(a)) return no("A name or path has characters that are not allowed.");
    if (looksLikePath(a)) pathArgs.push(a);
  }
  return yes("git", args, pathArgs);
}

function checkPython(args: string[]): CommandCheck {
  const [first, ...rest] = args;
  if (!first) return no("Say which script to run, for example: python tool.py");
  if (first === "--version") return args.length === 1 ? yes("python", args) : no("--version takes nothing after it.");
  if (first === "-m") {
    const [mod, ...more] = rest;
    if ((mod === "pytest" || mod === "unittest") && more.every((a) => !isFlag(a) && SAFE_ARG.test(a))) return yes("python", args, more);
    return no("Only python -m pytest and python -m unittest are allowed.");
  }
  if (isFlag(first)) return no("Python flags such as -c run code that is not in a file, so they are not allowed. Run a script file instead.");
  if (!/\.py$/i.test(first)) return no("Only .py script files can be run with python.");
  if (rest.some((a) => !SAFE_ARG.test(a))) return no("A script argument has characters that are not allowed.");
  return yes("python", args, [first]);
}

function checkAdb(args: string[]): CommandCheck {
  return args.length === 1 && (args[0] === "version" || args[0] === "devices") ? yes("adb", args) : no("Only adb version and adb devices are allowed.");
}

function checkCode(args: string[]): CommandCheck {
  return args.length === 1 && !isFlag(args[0]!) && SAFE_ARG.test(args[0]!) ? yes("code", args, [args[0]!]) : no("Use: code <folder or file> (opens it in VS Code).");
}

export function checkCommand(program: string, args: string[]): CommandCheck {
  if (!(PROGRAMS as readonly string[]).includes(program)) return no(`"${program}" is not an approved program. Approved: ${PROGRAMS.join(", ")}.`);
  if (args.length > 20) return no("Too many arguments (20 at most).");
  if (args.some((a) => typeof a !== "string" || a.length === 0 || a.length > 300 || /[\u0000-\u001f]/.test(a))) return no("An argument is empty, too long, or has control characters.");
  switch (program as Program) {
    case "node":
      return checkNode(args);
    case "npm":
      return checkNpm(args);
    case "git":
      return checkGit(args);
    case "python":
      return checkPython(args);
    case "adb":
      return checkAdb(args);
    case "code":
      return checkCode(args);
  }
}

// ---- installing ----
// A name must start with a letter or digit: a leading "-" would be read as an option such as -g (global install).
const NPM_PACKAGE = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(@[A-Za-z0-9.^~<>=*-]{1,30})?$/;
const PIP_PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}(==[A-Za-z0-9.]{1,20})?$/;

export type InstallCheck = { ok: true; program: Program; argv: string[]; display: string } | { ok: false; reason: string };

/** Package installs: only named packages from the public registries, never a URL, a path or a git address, never global, and install scripts are always off. */
export function checkInstall(manager: "npm" | "pip", packages: string[], dev: boolean): InstallCheck {
  if (packages.length > 10) return { ok: false, reason: "At most 10 packages at a time." };
  if (manager === "npm") {
    for (const p of packages) {
      if (!NPM_PACKAGE.test(p) || /^(file|git|http|https|link|github):/i.test(p)) return { ok: false, reason: `"${p}" is not a plain package name (optionally with @version).` };
    }
    const argv = packages.length === 0 ? ["ci", "--ignore-scripts"] : ["install", "--ignore-scripts", ...(dev ? ["--save-dev"] : []), ...packages];
    return { ok: true, program: "npm", argv, display: `npm ${argv.join(" ")}` };
  }
  if (packages.length === 0) return { ok: false, reason: "Name at least one Python package." };
  for (const p of packages) if (!PIP_PACKAGE.test(p)) return { ok: false, reason: `"${p}" is not a plain package name (optionally name==version).` };
  const argv = ["-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:", ...packages];
  return { ok: true, program: "python", argv, display: `python ${argv.join(" ")}` };
}
