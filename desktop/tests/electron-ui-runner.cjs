// Parent owns the disposable profile so Chromium can finish shutdown before cleanup.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

(async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "meetspace-electron-ui-"),
  );
  try {
    await new Promise((resolve, reject) => {
      const environment = { ...process.env };
      delete environment.MEETSPACE_DESKTOP_DEV;
      delete environment.MEETSPACE_DEV_CSP_NONCE;
      const child = spawn(
        require("electron"),
        [path.join(__dirname, "electron-ui.cjs"), directory],
        { stdio: "inherit", env: environment },
      );
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Shared UI Electron process exceeded 70 seconds"));
      }, 70_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        code === 0
          ? resolve()
          : reject(
              new Error(
                `Shared UI Electron process failed (${code ?? signal})`,
              ),
            );
      });
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
