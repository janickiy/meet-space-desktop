import { spawnSync } from "node:child_process";
import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";

/** Electron 44 downloads lazily; npm ci alone does not create the verifier's reference dist. */
export async function prepareLinuxElectronReference({ desktop, arch, environment }) {
  if (!["x64", "arm64"].includes(arch)) throw new Error("Invalid Electron reference architecture");
  const root = path.join(desktop, "node_modules/electron");
  const pkg = JSON.parse(await readFile(path.join(desktop, "package.json"), "utf8"));
  const installed = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(installed.version) || installed.version !== pkg.devDependencies.electron)
    throw new Error("Electron reference package differs from the exact project pin; run npm ci");
  const env = { ...environment, ELECTRON_INSTALL_PLATFORM: "linux", ELECTRON_INSTALL_ARCH: arch };
  // Use the npm package's bundled checksums and local dist, even if the shell
  // previously used a different runtime/target. The payload itself is not run.
  for (const key of ["ELECTRON_OVERRIDE_DIST_PATH", "electron_use_remote_checksums", "npm_config_electron_use_remote_checksums",
    "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE"])
    delete env[key];
  const result = spawnSync(process.execPath, [path.join(root, "install.js")], {
    cwd: desktop, env, stdio: "inherit",
  });
  if (result.error || result.status !== 0)
    throw new Error("Cannot prepare the pinned Linux Electron reference runtime");
  const dist = path.join(root, "dist");
  if ((await readFile(path.join(dist, "version"), "utf8")).trim().replace(/^v/, "") !== installed.version)
    throw new Error("Electron reference runtime version mismatch");
  for (const name of ["electron", "chrome-sandbox"]) {
    const filename = path.join(dist, name), info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Electron reference must contain ordinary runtime files");
    const handle = await open(filename), header = Buffer.alloc(20);
    try {
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== header.length || header.toString("hex", 0, 6) !== "7f454c460201" ||
          header.readUInt16LE(18) !== (arch === "arm64" ? 183 : 62))
        throw new Error("Electron reference runtime architecture mismatch; install fresh native dependencies");
    } finally { await handle.close(); }
  }
}
