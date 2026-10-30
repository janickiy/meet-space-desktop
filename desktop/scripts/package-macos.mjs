import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { sourceInputs } from "./ci/source-inputs.mjs";
import { MACOS_TEST_IDENTITY, inspectMachO, macTestEnvironment, parseMacArguments, validateMacPlist, validateMacTarget } from "./macos-package-policy.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function checkMachO(filename, arch) {
  const file = await open(filename, "r");
  try {
    const bytes = Buffer.alloc(32);
    await file.read(bytes, 0, bytes.length, 0);
    return inspectMachO(bytes, arch);
  } finally { await file.close(); }
}

export async function verifyMacApp(app, arch, pkg, provenance) {
  const result = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error("Cannot read packaged macOS Info.plist");
  validateMacPlist(JSON.parse(result.stdout), pkg.version, { release: provenance.releaseMode === "release" });
  const binaries = ["Contents/MacOS/MeetSpace", "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"];
  const frameworks = path.join(app, "Contents/Frameworks");
  for (const entry of await readdir(frameworks)) {
    if (/^MeetSpace Helper.*\.app$/.test(entry)) {
      const name = entry.slice(0, -4);
      binaries.push(`Contents/Frameworks/${entry}/Contents/MacOS/${name}`);
    }
  }
  if (binaries.length < 5) throw new Error("Packaged macOS Electron helpers are missing");
  for (const filename of binaries) await checkMachO(path.join(app, filename), arch);
  const fuses = provenance.releaseMode === "release"
    ? await require("./macos-fuses.cjs").verifyMacReleaseFuses(path.join(app, "Contents/MacOS/MeetSpace")) : undefined;

  const asar = path.join(app, "Contents/Resources/app.asar");
  const { extractFile, listPackage } = require("@electron/asar");
  const entries = listPackage(asar).map((entry) => entry.replace(/^\//, ""));
  if (provenance.releaseMode === "release" && entries.some(entry => entry === "resources/TEST-BUILD.txt" || entry === "dist/acceptance.js"))
    throw new Error("Test-only marker or acceptance hook in macOS release payload");
  if (entries.some((entry) => /\.node$/.test(entry) || /node_modules\/(?:cpu-features|nan|buildcheck)(?:\/|$)/.test(entry)))
    throw new Error("Unexpected native accelerator in macOS payload");
  for (const filename of ["dist/entry.js", "dist/main.js", "dist/preload.js", "renderer/index.html",
    "dist/build-provenance.json", "dist/update-trust.json", "dist/source-inputs.json",
    "resources/macos/TrayTemplate.png", "resources/macos/TrayTemplate@2x.png"]) {
    if (sha256(extractFile(asar, filename)) !== sha256(await readFile(path.join(desktop, filename))))
      throw new Error(`Packaged macOS payload mismatch: ${filename}`);
  }
  const trust = JSON.parse(extractFile(asar, "dist/update-trust.json").toString());
  if (trust.enabled !== false || !["test", "release"].includes(provenance.releaseMode) ||
      provenance.appId !== (provenance.releaseMode === "release" ? "com.janickiy.meetspace.desktop" : MACOS_TEST_IDENTITY.appId))
    throw new Error("macOS packages require the matching identity with updates disabled pending signed acceptance");
  for (const filename of ["THIRD_PARTY_NOTICES.txt", "third-party-licenses.json", "APP-LICENSE.txt", ...(provenance.releaseMode === "test" ? ["TEST-LICENSE.txt"] : [])]) {
    if (sha256(await readFile(path.join(app, "Contents/Resources", filename))) !== sha256(await readFile(path.join(desktop, "resources", filename))))
      throw new Error(`Missing or changed bundled notice: ${filename}`);
  }
  if (provenance.releaseMode === "release") {
    try { await lstat(path.join(app, "Contents/Resources/TEST-LICENSE.txt")); throw new Error("Test license in macOS release bundle"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { binaries, asarSha256: sha256(await readFile(asar)), ...(fuses ? { fuses } : {}) };
}

export async function packageMacApp(arch, { releaseConfigPath } = {}) {
  const args = parseMacArguments([arch]);
  const target = validateMacTarget(args);
  const repository = await realpath(path.resolve(desktop, ".."));
  const root = path.join(repository, "desktop/artifacts");
  await mkdir(root, { recursive: true });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o022))
    throw new Error("macOS artifact directory must be owned, ordinary and non-writable by others");
  const lock = path.join(root, ".macos-packaging-lock");
  await mkdir(lock, { mode: 0o700 });
  try {
    const env = macTestEnvironment(process.env, args.arch);
    if (releaseConfigPath) {
      const { readMacReleaseConfig } = await import("./macos-release-policy.mjs");
      await readMacReleaseConfig(releaseConfigPath);
      await sourceInputs(repository, true);
      env.MEETSPACE_BUILD_MODE = "release";
      env.MEETSPACE_RELEASE_CONFIG = releaseConfigPath;
      if (process.env.MEETSPACE_MACOS_KEYCHAIN) {
        env.MEETSPACE_MACOS_KEYCHAIN = process.env.MEETSPACE_MACOS_KEYCHAIN;
        env.CSC_KEYCHAIN = process.env.MEETSPACE_MACOS_KEYCHAIN;
      }
    }
    const run = (commandArgs) => {
      const result = spawnSync(process.execPath, commandArgs, { cwd: desktop, stdio: "inherit", env });
      if (result.error || result.status !== 0) throw new Error("macOS packaging command failed");
    };
    run([path.join(desktop, "scripts/build.mjs")]);
    const pkg = JSON.parse(await readFile(path.join(desktop, "package.json"), "utf8"));
    const provenance = JSON.parse(await readFile(path.join(desktop, "dist/build-provenance.json"), "utf8"));
    if (provenance.buildHostPlatform !== "darwin" || provenance.buildHostArch !== process.arch ||
        provenance.releaseMode !== (releaseConfigPath ? "release" : "test") ||
        provenance.buildVersion !== pkg.version + (releaseConfigPath ? "" : "-test") || provenance.builderPatch ||
        provenance.sourceTreeSha256 !== (await sourceInputs(repository)).sourceTreeSha256)
      throw new Error("macOS build provenance does not match this checkout");
    const output = await mkdtemp(path.join(root, `macos-stage02-${args.arch}-`));
    await chmod(output, 0o700);
    env.MEETSPACE_MACOS_OUTPUT = output;
    env.SOURCE_DATE_EPOCH = String(provenance.sourceDateEpoch);
    run([require.resolve("electron-builder/out/cli/cli.js"), "--config", releaseConfigPath ? "electron-builder.macos.release.config.cjs" : "electron-builder.macos.config.cjs",
      "--mac", "dir", `--${args.arch}`, "--publish", "never"]);
    const app = path.join(output, args.arch === "arm64" ? "mac-arm64" : "mac", "MeetSpace.app");
    const verification = await verifyMacApp(app, args.arch, pkg, provenance);
    if (provenance.sourceTreeSha256 !== (await sourceInputs(repository)).sourceTreeSha256)
      throw new Error("Sources changed during macOS packaging; rebuild before testing");
    const receipt = {
      schemaVersion: 1, stage: releaseConfigPath ? "06" : "02", version: pkg.version, arch: args.arch, crossBuilt: target.crossBuilt,
      app, appId: provenance.appId, minimumSystemVersion: "15.0", sourceTreeSha256: provenance.sourceTreeSha256,
      ...verification, signing: releaseConfigPath ? "candidate-requires-verification" : "disabled", notarization: "not-performed", runtimeTest: "not-performed",
      distributionReady: false,
    };
    await writeFile(path.join(output, "macos-unpacked-verification.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(`Verified unpacked macOS ${args.arch} test app: ${app}`);
    if (target.crossBuilt) console.log("Cross-built artifact only; native Intel/Apple Silicon runtime acceptance was not performed.");
    return { ...receipt, output, provenance };
  } finally { await rm(lock, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseMacArguments(process.argv.slice(2));
  if (args) packageMacApp(args.arch).catch((error) => { console.error(error.message); process.exitCode = 1; });
  else console.log("Use package-macos.mjs x64|arm64 on macOS. Creates a local unpacked test .app.");
}
