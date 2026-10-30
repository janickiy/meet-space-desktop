const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
(async () => {
  const evidenceDirectory = process.argv[2];
  if (process.argv.length > 3 || (evidenceDirectory && !path.isAbsolute(evidenceDirectory)))
    throw new Error("Usage: electron-product-runner.cjs [absolute-evidence-directory]");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-product-ui-"));
  try {
    const environment = { ...process.env };
    delete environment.MEETSPACE_DESKTOP_DEV; delete environment.MEETSPACE_DEV_CSP_NONCE;
    await new Promise((resolve, reject) => {
      const child = spawn(require("electron"), [path.join(__dirname, "electron-product.cjs"), directory, ...(evidenceDirectory ? [evidenceDirectory] : [])], { stdio: "inherit", env: environment });
      const timer = setTimeout(() => { child.kill(); reject(new Error("Product UI exceeded 180 seconds")); }, 180000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Product UI failed (${code ?? signal})`)); });
    });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
