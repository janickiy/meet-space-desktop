// Opt-in hardware probe. Saves metadata only, never video or microphone recordings.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
(async () => {
  if (process.platform !== "darwin" || process.argv[2] !== "--physical") throw new Error("Use macos-devices-runner.cjs --physical [evidence-dir] on a Mac");
  const output = path.resolve(process.argv[3] || path.join(__dirname, "../artifacts/macos-stage03/devices"));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-macos-devices-"));
  try {
    const profile = path.join(temporary, "profile"), renderer = path.join(temporary, "renderer");
    await fs.mkdir(output, { recursive: true }); await fs.mkdir(profile); await fs.mkdir(renderer);
    await fs.writeFile(path.join(renderer, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace: проверка устройств macOS</title></head><body><h1>Проверка встроенной камеры и микрофона MacBook</h1><p>Записи не сохраняются. После проверки прозвучит один короткий сигнал в динамиках.</p></body></html>');
    const config = path.join(temporary, "config.json");
    await fs.writeFile(config, JSON.stringify({ profile, renderer, output }));
    const env = { ...process.env };
    for (const key of ["ELECTRON_RUN_AS_NODE", "MEETSPACE_DESKTOP_DEV", "MEETSPACE_DEV_CSP_NONCE"]) delete env[key];
    await new Promise((resolve, reject) => {
      const child = spawn(require("electron"), [path.join(__dirname, "macos-devices-electron.cjs"), config], { env, stdio: "inherit" });
      const timer = setTimeout(() => { child.kill(); reject(new Error("Native device probe exceeded 120 seconds")); }, 120000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("Device probe failed: " + code)); });
    });
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
