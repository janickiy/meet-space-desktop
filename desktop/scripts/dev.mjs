import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const frontend = path.resolve(desktop, "../frontend");
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--smoke")) {
  throw new Error("Only the optional --smoke argument is supported; the development URL is fixed.");
}
const electronEntry = args[0] === "--smoke" ? path.join(desktop, "tests/electron-smoke.cjs") : desktop;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const require = createRequire(import.meta.url);
const electronPath = require("electron");
const url = "http://127.0.0.1:5173";
const devEnv = {
  ...process.env,
  MEETSPACE_DESKTOP_DEV: "1",
  MEETSPACE_DEV_CSP_NONCE: randomBytes(24).toString("hex"),
};

// Never attach the privileged shell to a pre-existing server on the dev port.
await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", () => reject(new Error("Port 5173 is already in use. Stop that server before desktop dev.")));
  probe.listen(5173, "127.0.0.1", () => probe.close(resolve));
});
const compiled = spawnSync(npm, ["run", "build:main"], {
  cwd: desktop,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (compiled.error || compiled.status !== 0) process.exit(compiled.status || 1);

const vite = spawn(process.execPath, [
  path.join(frontend, "node_modules/vite/bin/vite.js"),
  "--mode", "desktop", "--host", "127.0.0.1", "--port", "5173", "--strictPort",
], { cwd: frontend, stdio: ["ignore", "pipe", "pipe"], env: devEnv });
let electron;
let stopping = false;
let timeout;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  clearTimeout(timeout);
  electron?.kill();
  vite.kill();
  process.exitCode = code;
};
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
vite.once("error", (error) => { console.error(error.message); stop(1); });
vite.once("exit", (code) => { if (!stopping) stop(code || 1); });
vite.stderr.on("data", (chunk) => process.stderr.write(chunk));
timeout = setTimeout(() => {
  console.error("Vite did not become ready within 30 seconds.");
  stop(1);
}, 30000);
let output = "";
vite.stdout.on("data", async (chunk) => {
  process.stdout.write(chunk);
  output = (output + chunk.toString()).slice(-4096);
  if (electron || stopping || !output.includes(url)) return;
  clearTimeout(timeout);
  // The URL is fixed in main.ts; an arbitrary URL is never passed to Electron.
  electron = spawn(electronPath, [electronEntry], {
    cwd: desktop,
    stdio: "inherit",
    env: devEnv,
  });
  electron.once("error", (error) => { console.error(error.message); stop(1); });
  electron.once("exit", (code, signal) => stop(code ?? (signal ? 1 : 0)));
});
process.once("exit", () => { clearTimeout(timeout); electron?.kill(); vite.kill(); });
