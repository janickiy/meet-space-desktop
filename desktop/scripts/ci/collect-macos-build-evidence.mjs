import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { sourceInputs, sha256 } from "./source-inputs.mjs";
import { inspectMachO } from "../macos-package-policy.mjs";

const repository = fileURLToPath(new URL("../../..", import.meta.url));
const fail = () => { throw new Error("macOS CI evidence requires unchanged clean source and a matching native Mac"); };

/** A target label or a thin output binary alone cannot prove native execution. */
export function validateMacOSCIHost(host) {
  if (!host || host.platform !== "darwin" || !["x64", "arm64"].includes(host.targetArch) ||
      host.arch !== host.targetArch || host.uname !== (host.targetArch === "arm64" ? "arm64" : "x86_64") ||
      host.translated !== false || host.hardwareArm64 !== (host.targetArch === "arm64")) fail();
  return { platform: "darwin", arch: host.targetArch, nativeArchitectureVerified: true, rosetta: false };
}

export function validateMacOSCIInputs(before, after) {
  if (!before || !after || before.sourceDirty !== false || after.sourceDirty !== false ||
      !/^[a-f0-9]{40}$/.test(before.sourceCommit) || !/^[a-f0-9]{64}$/.test(before.sourceTreeSha256) ||
      before.sourceCommit !== after.sourceCommit || before.sourceTreeSha256 !== after.sourceTreeSha256) fail();
  return { sourceCommit: after.sourceCommit, sourceTreeSha256: after.sourceTreeSha256, sourceDirty: false };
}

function execute(command, args, { optional = false, cwd = repository, maxBuffer = 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer });
  if (result.error || result.signal || (!optional && result.status !== 0)) throw new Error("Cannot collect macOS CI toolchain evidence");
  return { status: result.status, stdout: result.stdout.trim() };
}

export async function collectMacOSBuildEvidence(output, targetArch) {
  if (!path.isAbsolute(output) || process.platform !== "darwin") fail();
  const translated = execute("/usr/sbin/sysctl", ["-in", "sysctl.proc_translated"], { optional: true });
  const hardware = execute("/usr/sbin/sysctl", ["-in", "hw.optional.arm64"], { optional: true });
  // This sysctl is absent on native Intel Macs; it is 1 on Apple Silicon.
  if (!["", "0", "1"].includes(translated.stdout) || !["", "0", "1"].includes(hardware.stdout)) fail();
  const host = validateMacOSCIHost({ platform: process.platform, arch: process.arch, targetArch,
    uname: execute("/usr/bin/uname", ["-m"]).stdout,
    translated: translated.stdout === "1", hardwareArm64: hardware.stdout === "1" });
  const before = JSON.parse(await readFile(path.join(output, "source-inputs.json"), "utf8"));
  const source = validateMacOSCIInputs(before, await sourceInputs(repository, true));
  const electronRoot = path.join(repository, "desktop/node_modules/electron");
  const electronExecutable = await realpath(path.join(electronRoot, "dist/Electron.app/Contents/MacOS/Electron"));
  inspectMachO((await readFile(electronExecutable)).subarray(0, 32), targetArch);
  const toolchain = {
    node: process.version, npm: execute("npm", ["--version"]).stdout,
    macOS: execute("/usr/bin/sw_vers", ["-productVersion"]).stdout,
    macOSBuild: execute("/usr/bin/sw_vers", ["-buildVersion"]).stdout,
    xcode: execute("/usr/bin/xcodebuild", ["-version"]).stdout,
    electron: JSON.parse(await readFile(path.join(electronRoot, "package.json"), "utf8")).version,
    electronBuilder: JSON.parse(await readFile(path.join(repository, "desktop/node_modules/electron-builder/package.json"), "utf8")).version,
  };
  const sboms = [];
  await mkdir(output, { recursive: true });
  for (const workspace of ["frontend", "desktop"]) for (const scope of ["production", "all"]) {
    const result = execute("npm", ["sbom", "--sbom-format", "cyclonedx", ...(scope === "production" ? ["--omit", "dev"] : [])],
      { cwd: path.join(repository, workspace), maxBuffer: 32 * 1024 * 1024 });
    const bom = JSON.parse(result.stdout);
    if (bom.bomFormat !== "CycloneDX") throw new Error("Invalid macOS CI SBOM");
    const file = `${workspace}-${scope}.cdx.json`, bytes = JSON.stringify(bom, null, 2) + "\n";
    await writeFile(path.join(output, file), bytes, { flag: "wx" });
    sboms.push({ file, sha256: sha256(bytes) });
  }
  const report = { schemaVersion: 1, ...host, ...source, toolchain, sboms,
    collectedAt: new Date().toISOString(), runnerImage: process.env.ImageOS || null,
    runnerImageVersion: process.env.ImageVersion || null, githubRunId: process.env.GITHUB_RUN_ID || null,
    scope: "Native architecture build inputs and dependency inventories. No claim of physical media, complete macOS matrix, login acceptance or bit-identical signed/notarized DMG output." };
  await writeFile(path.join(output, "build-inputs.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2) throw new Error("Use collect-macos-build-evidence.mjs <absolute-evidence-directory> x64|arm64");
  collectMacOSBuildEvidence(args[0], args[1]).catch(() => {
    console.error("macOS CI evidence failed; unchanged clean source, native toolchain and frozen dependencies are required");
    process.exitCode = 1;
  });
}
