import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { checkStrength, hashPassphrase, parsePassphraseRecord, verifyPassphrase } from "./passphrase.js";

/**
 * Command line for the Guardian. The passphrase is typed hidden and never put on the command line or in a log.
 *   npm run guardian:passphrase        set (or change) the owner passphrase
 *   npm run guardian:ctl -- status | pause | stop | lockdown | resume | unlock | journal
 */
const dir = resolve(process.env["GUARDIAN_DIR"] ?? "data/guardian");
const url = process.env["GUARDIAN_URL"] ?? `http://127.0.0.1:${process.env["GUARDIAN_PORT"] ?? 3100}`;

function ask(question: string, hidden: boolean): Promise<string> {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const anyRl = rl as unknown as { _writeToOutput: (s: string) => void };
    const original = anyRl._writeToOutput.bind(rl);
    process.stdout.write(question);
    if (hidden) anyRl._writeToOutput = () => undefined;
    else anyRl._writeToOutput = original;
    rl.question("", (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      done(answer);
    });
  });
}

async function setPassphrase(): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "passphrase.json");
  const existing = existsSync(file) ? parsePassphraseRecord(readFileSync(file, "utf8")) : null;
  if (existing) {
    const current = await ask("Current passphrase: ", true);
    if (!verifyPassphrase(current, existing)) {
      console.error("That is not the current passphrase. Nothing was changed.");
      process.exitCode = 1;
      return;
    }
  }
  const first = await ask("New passphrase (12+ characters, a few unrelated words is good): ", true);
  const weak = checkStrength(first);
  if (weak) {
    console.error(weak);
    process.exitCode = 1;
    return;
  }
  if (first !== (await ask("Type it again: ", true))) {
    console.error("The two entries did not match. Nothing was changed.");
    process.exitCode = 1;
    return;
  }
  writeFileSync(file, JSON.stringify(hashPassphrase(first)), "utf8");
  console.log("The owner passphrase is set. Only a salted hash is stored. Do not store the passphrase in the project folder, the vault or any file an agent can read.");
}

async function send(body: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(`${url}/v1/command`, { method: "POST", headers: { "content-type": "application/json", "x-awp-guardian": "1" }, body: JSON.stringify(body) });
    const out = (await res.json()) as Record<string, unknown>;
    delete out["token"]; // never print the decision-window token
    console.log(JSON.stringify(out, null, 2));
    if (!res.ok) process.exitCode = 1;
  } catch {
    console.error(`Cannot reach the Guardian at ${url}. Is it running? (npm run guardian)`);
    process.exitCode = 1;
  }
}

const cmd = process.argv[2];
if (cmd === "set-passphrase") await setPassphrase();
else if (cmd === "status" || cmd === "pause" || cmd === "stop" || cmd === "lockdown") await send({ cmd });
else if (cmd === "resume" || cmd === "unlock") await send({ cmd, passphrase: await ask("Owner passphrase: ", true) });
else if (cmd === "journal") {
  try {
    console.log(JSON.stringify(await (await fetch(`${url}/v1/journal`)).json(), null, 2));
  } catch {
    console.error(`Cannot reach the Guardian at ${url}.`);
    process.exitCode = 1;
  }
} else {
  console.error("Usage: set-passphrase | status | pause | stop | lockdown | resume | unlock | journal");
  process.exitCode = 1;
}
