// Executes the real application with an isolated renderer and user profile.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

(async () => {
  const outputDir = path.resolve(process.argv[2] || path.join(__dirname, "../artifacts/linux-stage02-20261018"));
  const resultPath = path.join(outputDir, `platform-${process.platform}-${process.arch}.json`);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-platform-electron-"));
  try {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.rm(resultPath, { force: true });
    const profile = path.join(directory, "profile");
    const renderer = path.join(directory, "renderer");
    await fs.mkdir(profile);
    await fs.mkdir(renderer);
    await fs.writeFile(path.join(renderer, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace platform fixture</title></head><body>MeetSpace isolated platform fixture</body></html>');
    const configPath = path.join(directory, "config.json");
    await fs.writeFile(configPath, JSON.stringify({ profile, renderer, resultPath, savePath: path.join(directory, "Сохранённая запись.mp4") }));
    const environment = { ...process.env };
    delete environment.MEETSPACE_DESKTOP_DEV;
    delete environment.MEETSPACE_DEV_CSP_NONCE;
    delete environment.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = spawn(require("electron"), [path.join(__dirname, "platform-electron.cjs"), configPath], { env: environment, stdio: "inherit" });
      const timer = setTimeout(() => { child.kill(); reject(new Error("platform_electron_timeout")); }, 85000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`platform_electron_failed (${code ?? signal})`));
      });
    });
    const report = JSON.parse(await fs.readFile(resultPath, "utf8"));
    assert.equal(report.result, "PASS");
    assert.equal(report.platform, process.platform);
    assert.equal(report.arch, process.arch);
    console.log(JSON.stringify({ result: report.result, platform: report.platform, arch: report.arch, fileSave: report.checks.fileSave, report: resultPath }));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error("Platform Electron runner failed: " + error.message); process.exitCode = 1; });
