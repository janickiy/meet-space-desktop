// Real Electron + the repository's Pion SFU. Synthetic devices and local TURN only.
// Bundles the existing shared client into a disposable fixture, never a second UI.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");

function run(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: "inherit", ...options });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("SFU test subprocess timed out")); }, 120_000);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`SFU subprocess failed: ${code ?? signal}`));
    });
  });
}

(async () => {
  const repository = path.resolve(__dirname, "../..");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-sfu-"));
  try {
    const executable = path.join(directory, process.platform === "win32" ? "pion-fixture.exe" : "pion-fixture");
    await run("go", ["build", "-o", executable, "./desktop/tests/fixtures/pion-sfu"], { cwd: repository });
    const frontendRequire = createRequire(path.join(repository, "frontend/package.json"));
    const { build } = await import(pathToFileURL(frontendRequire.resolve("vite")).href);
    const rendererRoot = path.join(directory, "renderer");
    await fs.mkdir(rendererRoot);
    await build({ configFile: false, root: path.join(repository, "frontend"), logLevel: "warn", define: { __DESKTOP_BUILD__: "true" },
      build: { outDir: rendererRoot, emptyOutDir: false, minify: false, target: "es2022",
        lib: { entry: path.join(repository, "frontend/src/media.ts"), name: "MeetSpaceMedia", formats: ["iife"], fileName: () => "media.js" } },
    });
    await fs.writeFile(path.join(rendererRoot, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace synthetic SFU fixture</title></head><body><script src="/media.js"></script></body></html>');
    const environment = { ...process.env };
    delete environment.MEETSPACE_DESKTOP_DEV;
    delete environment.MEETSPACE_DEV_CSP_NONCE;
    for (const relay of [false, true]) {
      const userDataDir = path.join(directory, relay ? "relay-profile" : "direct-profile");
      await fs.mkdir(userDataDir);
      const configPath = path.join(directory, relay ? "relay.json" : "direct.json");
      await fs.writeFile(configPath, JSON.stringify({ executable, rendererRoot, userDataDir, relay }));
      await run(require("electron"), [path.join(__dirname, "sfu-electron.cjs"), configPath], { env: environment });
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
