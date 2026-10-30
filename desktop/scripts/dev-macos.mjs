import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { inspectMachO, macTestEnvironment, parseMacArguments, validateMacTarget } from "./macos-package-policy.mjs";

const args = parseMacArguments(process.argv.slice(2), { dev: true });
if (!args) {
  console.log("Use dev-macos.mjs x64|arm64 [--smoke] on a Mac with the matching Node/Electron architecture.");
} else {
  validateMacTarget({ arch: args.arch, dev: true });
  const require = createRequire(import.meta.url);
  const file = await open(require("electron"), "r");
  try {
    const bytes = Buffer.alloc(32);
    await file.read(bytes, 0, bytes.length, 0);
    inspectMachO(bytes, args.arch);
  } finally { await file.close(); }
  const child = spawn(process.execPath,
    [fileURLToPath(new URL("./dev.mjs", import.meta.url)), ...(args.smoke ? ["--smoke"] : [])],
    { stdio: "inherit", env: macTestEnvironment(process.env, args.arch) });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
