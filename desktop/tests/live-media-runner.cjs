// Opt-in live acceptance test. Supply a PRIVATE JSON file; never credentials in argv/env.
// Usage: node tests/live-media-runner.cjs /absolute/path/to/private-input.json
// The server retains a finished test-room history entry. No invitations or recording.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");

(async () => {
  if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw new Error("private_input_path_required");
  const credentialsPath = process.argv[2];
  const info = await fs.stat(credentialsPath);
  if (!info.isFile() || info.size > 8192) throw new Error("invalid_private_input");
  const repository = path.resolve(__dirname, "../..");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-live-media-"));
  try {
    const frontendRequire = createRequire(path.join(repository, "frontend/package.json"));
    const { build } = await import(pathToFileURL(frontendRequire.resolve("vite")).href);
    const rendererRoot = path.join(directory, "renderer");
    await fs.mkdir(rendererRoot);
    await build({ configFile: false, root: path.join(repository, "frontend"), logLevel: "silent", define: { __DESKTOP_BUILD__: "true" },
      build: { outDir: rendererRoot, emptyOutDir: false, minify: false, target: "es2022",
        lib: { entry: path.join(repository, "frontend/src/media.ts"), name: "MeetSpaceMedia", formats: ["iife"], fileName: () => "media.js" } } });
    await fs.writeFile(path.join(rendererRoot, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace synthetic live media test</title></head><body><p>Synthetic test source</p><canvas width="640" height="360"></canvas><script src="/media.js"></script></body></html>');
    const userDataDir = path.join(directory, "profile");
    await fs.mkdir(userDataDir);
    const configPath = path.join(directory, "config.json");
    await fs.writeFile(configPath, JSON.stringify({ credentialsPath, userDataDir, rendererRoot }), { mode: 0o600 });
    const environment = { ...process.env };
    delete environment.MEETSPACE_DESKTOP_DEV;
    delete environment.MEETSPACE_DEV_CSP_NONCE;
    await new Promise((resolve, reject) => {
      const child = spawn(require("electron"), [path.join(__dirname, "live-media-electron.cjs"), configPath], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
      // Chromium/native diagnostics can contain private URLs. Only our fixed-prefix JSON is emitted.
      let buffer = "";
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        if (buffer.length > 65536) { buffer = ""; return; }
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          if (line.startsWith("MEETSPACE_LIVE_RESULT ")) console.log(line.slice(22));
          else if (line.startsWith("MEETSPACE_LIVE_STAGE ")) console.log(line.slice(21));
        }
      });
      child.stderr.resume();
      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("live_test_timeout_cleanup_unconfirmed")); }, 300_000);
      child.once("error", () => { clearTimeout(timer); reject(new Error("live_process_failed")); });
      child.once("exit", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("live_test_failed_see_sanitized_result")); });
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  const allowed = new Set(["private_input_path_required", "invalid_private_input", "live_test_timeout_cleanup_unconfirmed", "live_process_failed", "live_test_failed_see_sanitized_result"]);
  console.error(allowed.has(error.message) ? error.message : "live_test_setup_failed");
  process.exitCode = 1;
});
