// Starts the backend and the dashboard together. Press Ctrl+C to stop both.
import { execSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const services = [
  { name: "backend ", cwd: root },
  { name: "dashboard", cwd: resolve(root, "web") },
];

const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      // /T also stops the programs that npm started; /F forces it.
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {
      /* already stopped */
    }
  }
  process.exit(code);
}

for (const svc of services) {
  const child = spawn("npm run dev", { cwd: svc.cwd, shell: true, env: process.env });
  children.push(child);
  const prefix = `[${svc.name}] `;
  const relay = (stream, out) =>
    stream.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) out.write(prefix + line + "\n");
    });
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`${prefix}stopped unexpectedly (code ${code}). Stopping everything.`);
      stopAll(1);
    }
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

console.log("\nStarting the AI Workforce Platform...");
console.log("When you see both servers ready, open:  http://127.0.0.1:5173");
console.log("Press Ctrl+C to stop everything.\n");
