// The parent owns the profile until Chromium and the single-instance probe exit.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

(async () => {
  if (process.platform !== "darwin") throw new Error("macOS integration requires a native Mac");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-macos-ui-"));
  const output = path.resolve(process.argv[2] || path.join(__dirname, "../artifacts/macos-stage02"));
  try {
    await fs.mkdir(output, { recursive: true });
    const env = { ...process.env };
    for (const name of ["ELECTRON_RUN_AS_NODE", "MEETSPACE_DESKTOP_DEV", "MEETSPACE_DEV_CSP_NONCE"]) delete env[name];
    await new Promise((resolve, reject) => {
      const child = spawn(require("electron"), [path.join(__dirname, "macos-ui.cjs"), profile, output], { env, stdio: "inherit" });
      const timer = setTimeout(() => { child.kill(); reject(new Error("macOS UI timeout")); }, 90000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("macOS UI failed: " + code)); });
    });
  } finally { await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
