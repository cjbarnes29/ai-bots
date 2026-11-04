import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSecretFileName, resolveInRoots, validateRoot } from "./paths.js";
import { checkCommand, checkInstall } from "./policy.js";
import { cleanEnvironment } from "./runner.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ok = (program: string, args: string[]) => {
  const r = checkCommand(program, args);
  expect(r.ok, `${program} ${args.join(" ")} should be allowed${r.ok ? "" : ": " + r.reason}`).toBe(true);
  return r as Extract<ReturnType<typeof checkCommand>, { ok: true }>;
};
const refused = (program: string, args: string[]) => {
  const r = checkCommand(program, args);
  expect(r.ok, `${program} ${args.join(" ")} should be refused`).toBe(false);
  return (r as { reason: string }).reason;
};

describe("which commands are allowed", () => {
  it.each([
    ["node", ["--version"]],
    ["node", ["build.js"]],
    ["node", ["tools/build.mjs", "--fast", "out"]],
    ["node", ["--test", "a.test.js"]],
    ["npm", ["--version"]],
    ["npm", ["test"]],
    ["npm", ["ls"]],
    ["npm", ["audit"]],
    ["npm", ["run", "build"]],
    ["npm", ["run", "test:unit", "--", "--watch=false"]],
    ["git", ["--version"]],
    ["git", ["status"]],
    ["git", ["status", "-s", "-b"]],
    ["git", ["log", "--oneline", "-n", "5"]],
    ["git", ["log", "-5"]],
    ["git", ["diff", "--stat"]],
    ["git", ["diff", "--staged", "--", "src/a.ts"]],
    ["git", ["add", "."]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "-m", "Add the login page (v2)"]],
    ["git", ["checkout", "-b", "feature-one"]],
    ["git", ["switch", "main"]],
    ["git", ["stash", "list"]],
    ["git", ["init"]],
    ["python", ["--version"]],
    ["python", ["tool.py", "--n", "3"]],
    ["python", ["-m", "pytest", "tests"]],
    ["adb", ["devices"]],
    ["code", ["myproject"]],
  ])("allows %s %j", (program, args) => {
    ok(program, args);
  });

  it("shows the exact command, quoting only the commit message", () => {
    expect(ok("git", ["commit", "-m", "Fix typo"]).display).toBe('git commit -m "Fix typo"');
    expect(ok("npm", ["run", "build"]).display).toBe("npm run build");
  });

  it.each([
    ["powershell", ["-Command", "Get-Process"]],
    ["cmd", ["/c", "dir"]],
    ["bash", ["-c", "ls"]],
    ["curl", ["http://example.com"]],
    ["rm", ["-rf", "x"]],
    ["del", ["x"]],
    ["format", ["c:"]],
    ["sudo", ["ls"]],
    ["node", ["-e", "process.exit()"]],
    ["node", ["--eval", "1"]],
    ["node", ["-p", "1"]],
    ["node", ["-r", "evil.js", "a.js"]],
    ["node", ["--import", "evil.mjs", "a.js"]],
    ["node", ["script.txt"]],
    ["node", []],
    ["python", ["-c", "print(1)"]],
    ["python", ["-m", "http.server"]],
    ["python", ["-m", "pip", "install", "x"]],
    ["python", ["tool.txt"]],
    ["npm", ["install"]],
    ["npm", ["i", "left-pad"]],
    ["npm", ["ci"]],
    ["npm", ["exec", "cowsay"]],
    ["npm", ["x", "cowsay"]],
    ["npm", ["publish"]],
    ["npm", ["config", "set", "x", "y"]],
    ["npm", ["run"]],
    ["npm", ["run", "build; calc"]],
    ["npm", ["run", "build", "--force"]],
    ["npm", ["audit", "fix"]],
    ["npm", ["test", "extra"]],
    ["git", ["push"]],
    ["git", ["pull"]],
    ["git", ["fetch"]],
    ["git", ["clone", "https://example.com/r.git"]],
    ["git", ["reset", "--hard"]],
    ["git", ["clean", "-fd"]],
    ["git", ["rebase", "main"]],
    ["git", ["merge", "x"]],
    ["git", ["config", "user.name", "x"]],
    ["git", ["remote", "add", "o", "http://x"]],
    ["git", ["branch", "-D", "main"]],
    ["git", ["branch", "-d", "x"]],
    ["git", ["checkout", "-f", "main"]],
    ["git", ["checkout", "--force", "main"]],
    ["git", ["checkout", "--", "."]],
    ["git", ["status", "--exec=calc"]],
    ["git", ["log", "--output=x.txt"]],
    ["git", ["-c", "core.pager=calc", "status"]],
    ["git", ["--git-dir=x", "status"]],
    ["git", ["commit", "--amend"]],
    ["git", ["commit", "-m"]],
    ["git", ["commit", "-m", 'He said "hi"']],
    ["git", ["commit", "-m", "x & calc"]],
    ["git", ["commit", "-m", "$(calc)"]],
    ["git", ["stash", "drop"]],
    ["adb", ["shell", "ls"]],
    ["adb", ["install", "app.apk"]],
    ["code", ["--install-extension", "x"]],
    ["code", ["a", "b"]],
  ])("refuses %s %j", (program, args) => {
    const reason = refused(program, args);
    expect(reason.length).toBeGreaterThan(10); // always says why, in words
  });

  it.each(["a;b", "a&b", "a|b", "a`b`", "$(x)", "%PATH%", "a>b", "a<b", "a^b", "a!b", 'a"b', "a'b", "a\nb", "a b", "a{b}", "a[b]", "~;"])("refuses an argument with shell characters: %j", (arg) => {
    for (const program of ["node", "npm", "git", "python"]) {
      const args = program === "npm" ? ["run", "build", "--", arg] : program === "git" ? ["add", arg] : [`a.${program === "python" ? "py" : "js"}`, arg];
      expect(checkCommand(program, args).ok, `${program} ${JSON.stringify(arg)}`).toBe(false);
    }
  });

  it("limits the number and length of arguments, and refuses empty ones", () => {
    refused("node", ["a.js", ...Array.from({ length: 20 }, () => "x")]);
    refused("node", ["a.js", ""]);
    refused("node", ["a.js", "x".repeat(301)]);
  });
});

describe("installing packages", () => {
  it("npm: named packages only, scripts always off, never global", () => {
    const one = checkInstall("npm", ["left-pad", "@types/node@22.1.0"], false);
    expect(one).toMatchObject({ ok: true, program: "npm", argv: ["install", "--ignore-scripts", "left-pad", "@types/node@22.1.0"] });
    expect((checkInstall("npm", ["vitest"], true) as any).argv).toEqual(["install", "--ignore-scripts", "--save-dev", "vitest"]);
    expect((checkInstall("npm", [], false) as any).argv).toEqual(["ci", "--ignore-scripts"]);
    for (const r of [checkInstall("npm", ["a"], false), checkInstall("npm", [], false)]) expect((r as any).argv).toContain("--ignore-scripts");
    expect(JSON.stringify([checkInstall("npm", ["a"], false), checkInstall("npm", [], false)])).not.toMatch(/-g|--global/);
  });

  it.each(["https://evil.example/x.tgz", "http://x/y", "git+https://github.com/a/b", "github:a/b", "file:../x", "link:../x", "../local", "./local", "C:\\evil", "a b", "a;b", "-g", "--global", "pkg@https://x", "UPPER"])("npm refuses %s", (pkg) => {
    expect(checkInstall("npm", [pkg], false).ok).toBe(false);
  });

  it("pip: named packages (optionally pinned) only, wheels only", () => {
    expect(checkInstall("pip", ["requests==2.32.0"], false)).toMatchObject({ ok: true, program: "python" });
    expect((checkInstall("pip", ["requests"], false) as any).argv).toEqual(["-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:", "requests"]);
    expect(checkInstall("pip", [], false).ok).toBe(false);
    for (const p of ["git+https://x", "../x", "-r", "--index-url=http://evil", "a;b", "http://x"]) expect(checkInstall("pip", [p], false).ok, p).toBe(false);
  });

  it("at most ten packages", () => {
    expect(checkInstall("npm", Array.from({ length: 11 }, (_, i) => `p${i}`), false).ok).toBe(false);
  });
});

describe("where files may be touched", () => {
  const base = mkdtempSync(join(tmpdir(), "awp-paths-"));
  const root = join(base, "workspace");
  const outside = join(base, "outside");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "TOP SECRET");

  it("accepts a real folder and refuses unsafe ones, saying why", () => {
    expect(validateRoot(root).ok).toBe(true);
    const why = (p: string, forbidden: string[] = []) => (validateRoot(p, forbidden) as any).reason as string;
    expect(why("")).toMatch(/full path/);
    expect(why("relative/folder")).toMatch(/full path/);
    expect(why(join(base, "does-not-exist"))).toMatch(/does not exist/);
    expect(why(join(root, "src", "..", "..", "workspace", "nope"))).toMatch(/does not exist/);
    expect(why(process.platform === "win32" ? "C:\\" : "/")).toMatch(/whole drive/);
    expect(why(homedir())).toMatch(/whole user folder/);
    expect(why(process.platform === "win32" ? "C:\\Windows" : "/etc")).toMatch(/System folders/);
    expect(why(root, [base])).toMatch(/this app's own files/); // inside a forbidden folder
    expect(why(base, [root])).toMatch(/this app's own files/); // contains a forbidden folder
  });

  it("allows paths inside the workspace, relative or absolute, that do not exist yet", () => {
    for (const p of ["src", "src/new.ts", join(root, "src", "a", "b.txt"), ".", "new-folder/file.md"]) {
      const r = resolveInRoots([root], p, root);
      expect(r.ok, p).toBe(true);
    }
  });

  it.each(["..", "../outside/secret.txt", "src/../../outside", "\\\\server\\share\\x", "https://example.com/x", "", "a\u0000b"])("refuses a path that escapes or is not a path: %j", (p) => {
    expect(resolveInRoots([root], p, root).ok).toBe(false);
  });

  it("refuses absolute paths elsewhere, and everything when no workspace is set", () => {
    expect(resolveInRoots([root], join(outside, "secret.txt"), root)).toMatchObject({ ok: false, reason: expect.stringMatching(/outside the workspace/) });
    expect(resolveInRoots([], "x", root)).toMatchObject({ ok: false, reason: expect.stringMatching(/No workspace folder/) });
  });

  it("a shortcut (link or junction) inside the workspace cannot lead outside", () => {
    const link = join(root, "sneaky");
    try {
      symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return; // this system does not allow links: nothing to test
    }
    expect(resolveInRoots([root], "sneaky", root)).toMatchObject({ ok: false, reason: expect.stringMatching(/leads outside/) });
    expect(resolveInRoots([root], "sneaky/secret.txt", root).ok).toBe(false);
    expect(resolveInRoots([root], "sneaky/new-file.txt", root).ok).toBe(false);
  });

  it.each([".env", ".env.local", "vault.key", "app.db", "app.db-wal", "data.sqlite", "id_rsa", "id_ed25519.pub", "server.pem", "my.key", "cert.pfx", ".npmrc", ".git-credentials", "credentials.json", "secrets.yml"])("refuses files that hold secrets: %s", (name) => {
    expect(isSecretFileName(name)).toBe(true);
    expect(resolveInRoots([root], `src/${name}`, root)).toMatchObject({ ok: false, reason: expect.stringMatching(/holds secrets/) });
  });

  it.each(["index.ts", "README.md", "package.json", "environment.ts", "keyboard.js", "dbutils.ts"])("allows ordinary names: %s", (name) => {
    expect(isSecretFileName(name)).toBe(false);
  });
});

describe("what a started program can see", () => {
  it("only a short list of ordinary settings, never keys, tokens or this app's variables", () => {
    const env = cleanEnvironment({ PATH: "/bin", SystemRoot: "C:\\Windows", GEMINI_API_KEY: "AIzaSy...", GROQ_API_KEY: "gsk_x", TELEGRAM_BOT_TOKEN: "1:x", OMNIROUTE_API_KEY: "k", DATABASE_PATH: "data/app.db", REMOTE_HOSTS: "x.ts.net", RANDOM_SECRET: "s" } as any);
    expect(Object.keys(env).sort()).toEqual(["CI", "PATH", "SystemRoot", "npm_config_update_notifier"].sort());
  });
});
