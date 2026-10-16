const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-media-"));
  try {
    const rendererRoot = path.join(directory, "renderer");
    const userDataDir = path.join(directory, "profile");
    await Promise.all([fs.mkdir(rendererRoot), fs.mkdir(userDataDir)]);
    await fs.writeFile(path.join(rendererRoot, "index.html"), "<!doctype html><html><head><meta charset=utf-8><title>Synthetic MeetSpace media test</title></head><body><h1>Synthetic capture fixture</h1><p>No desktop or physical camera capture.</p></body></html>");
    const config = path.join(directory, "config.json");
    await fs.writeFile(config, JSON.stringify({ rendererRoot, userDataDir }));
    const env = { ...process.env };
    delete env.MEETSPACE_DESKTOP_DEV;
    delete env.MEETSPACE_DEV_CSP_NONCE;
    await new Promise((resolve, reject) => {
      const child = spawn(require("electron"), [path.join(__dirname, "media-electron.cjs"), config], { stdio: "inherit", env });
      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Media harness timed out")); }, 60_000);
      child.once("error", reject);
      child.once("exit", (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Media harness failed: ${code ?? signal}`)); });
    });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
