import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** TEST SUPPORT ONLY. Compiles the disposable test application into a temporary folder with the compiler that ships with Windows (.NET Framework). */
const CSC = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
const WPF = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF";

export function buildTestApp(outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  const src = resolve(dirname(fileURLToPath(import.meta.url)), "AwpTestApp.cs");
  const exe = join(outDir, "AwpTestApp.exe");
  const r = spawnSync(CSC, ["/nologo", "/target:winexe", `/out:${exe}`, `/lib:${WPF}`,"/r:PresentationFramework.dll", "/r:PresentationCore.dll", "/r:WindowsBase.dll", "/r:System.Xaml.dll", src], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`The test application did not compile: ${r.stdout}${r.stderr}`);
  return exe;
}
