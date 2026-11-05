import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";

/**
 * What the Guardian can do to the world, as small replaceable pieces. Tests use fakes for every one of these: no test ever
 * touches a real process, VM or firewall rule.
 */
export interface AdapterResult {
  ok: boolean;
  detail: string;
}

export interface VmAdapter {
  suspend(): Promise<AdapterResult>;
  stop(hard: boolean): Promise<AdapterResult>;
}

export interface NetAdapter {
  block(): Promise<AdapterResult>;
  unblock(): Promise<AdapterResult>;
}

export type Runner = (file: string, args: string[], timeoutMs: number) => Promise<{ code: number; output: string }>;

export const realRunner: Runner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, output: `${stdout}${stderr}`.trim().slice(0, 500) });
    });
  });

/**
 * Stops ONE virtual machine with VMware's own command line tool. The machine file is fixed in the Guardian's settings and is never taken
 * from a request. NOT VERIFIED against a real VM: none exists yet, and these commands have only been exercised with a fake runner.
 */
export class VmrunAdapter implements VmAdapter {
  constructor(
    private readonly vmrunPath: string,
    private readonly vmxPath: string,
    private readonly run: Runner = realRunner,
  ) {
    if (!isAbsolute(vmrunPath) || !/vmrun\.exe$/i.test(vmrunPath)) throw new Error("The vmrun path must be an absolute path to vmrun.exe.");
    if (!isAbsolute(vmxPath) || !/\.vmx$/i.test(vmxPath) || /["\r\n]/.test(vmxPath)) throw new Error("The VM file must be an absolute path to a .vmx file.");
  }

  private async vmrun(verb: "suspend" | "stop", mode: "hard" | "soft"): Promise<AdapterResult> {
    const r = await this.run(this.vmrunPath, ["-T", "ws", verb, this.vmxPath, mode], 60_000);
    return { ok: r.code === 0, detail: r.code === 0 ? `vmrun ${verb} ${mode} succeeded` : `vmrun ${verb} ${mode} failed (exit ${r.code}): ${r.output}` };
  }

  suspend(): Promise<AdapterResult> {
    return this.vmrun("suspend", "soft");
  }

  stop(hard: boolean): Promise<AdapterResult> {
    return this.vmrun("stop", hard ? "hard" : "soft");
  }
}

/**
 * Turns ONE pre-made Windows Firewall block rule on or off. The owner creates the rule once (reviewed script, administrator needed);
 * the Guardian only flips it by its fixed name. Needs administrator rights to work. NOT VERIFIED: never run against the real firewall.
 */
export class FirewallRuleAdapter implements NetAdapter {
  constructor(
    private readonly ruleName: string,
    private readonly run: Runner = realRunner,
  ) {
    if (!/^[A-Za-z0-9 _.-]{1,80}$/.test(ruleName)) throw new Error("The firewall rule name may only use letters, digits, spaces, dots, dashes and underscores.");
  }

  private async set(enable: boolean): Promise<AdapterResult> {
    const r = await this.run("netsh", ["advfirewall", "firewall", "set", "rule", `name=${this.ruleName}`, "new", `enable=${enable ? "yes" : "no"}`], 20_000);
    return { ok: r.code === 0, detail: r.code === 0 ? `firewall rule "${this.ruleName}" ${enable ? "enabled" : "disabled"}` : `netsh failed (exit ${r.code}): ${r.output}` };
  }

  block(): Promise<AdapterResult> {
    return this.set(true);
  }

  unblock(): Promise<AdapterResult> {
    return this.set(false);
  }
}
