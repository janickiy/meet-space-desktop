import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { constants as fsConstants } from "node:fs";
import {
  chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath,
  rename, rm, rmdir, writeFile,
} from "node:fs/promises";
import path from "node:path";
import { sourceInputs } from "./ci/source-inputs.mjs";
import { artifactFilename, LINUX_PACKAGE_FORMATS, validateLinuxTarget, writeNewReceipt } from "./linux-package-policy.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const BUILDER_VERSION = "26.17.0";
const APPIMAGE_UTIL_UPSTREAM_SHA256 = "70cdc560883573fa65246fbea08dd923a4905dc147769995ceb7257658a9980c";
const APPIMAGE_LAUNCHER_STATEMENT = "    const appRunContent = generateAppRunScript(finalConfig);";

/** Accept only the exact reviewed upstream utility, or precisely this transform. */
export function appImageLauncherTransform(bytes, launcher, version) {
  if (version !== BUILDER_VERSION || typeof launcher !== "string" ||
      !launcher.startsWith("#!/bin/sh\n") || launcher.length > 32768)
    throw new Error("Unreviewed AppImage builder or launcher");
  const replacement = `    const appRunContent = ${JSON.stringify(launcher)};`;
  let original = Buffer.from(bytes).toString("utf8");
  if (hash(original) !== APPIMAGE_UTIL_UPSTREAM_SHA256) {
    if (original.split(replacement).length !== 2)
      throw new Error("Unrecognized AppImage builder source; install the frozen dependencies again");
    original = original.replace(replacement, APPIMAGE_LAUNCHER_STATEMENT);
    if (hash(original) !== APPIMAGE_UTIL_UPSTREAM_SHA256)
      throw new Error("Unrecognized AppImage builder source");
  }
  if (original.split(APPIMAGE_LAUNCHER_STATEMENT).length !== 2)
    throw new Error("AppImage launcher transform no longer applies exactly once");
  const source = Buffer.from(original.replace(APPIMAGE_LAUNCHER_STATEMENT, replacement));
  return {
    source,
    changed: !source.equals(Buffer.from(bytes)),
    evidence: {
      package: "app-builder-lib",
      version,
      transform: "meetspace-fail-closed-appimage-launcher-v1",
      upstreamSha256: APPIMAGE_UTIL_UPSTREAM_SHA256,
      patchedSha256: hash(source),
      launcherSha256: hash(launcher),
    },
  };
}

async function prepareAppImageLauncher() {
  const filename = require.resolve("app-builder-lib/out/targets/appimage/appImageUtil.js");
  const info = await lstat(filename);
  const launcherFile = path.join(desktop, "resources/linux/AppRun.sh");
  const launcherInfo = await lstat(launcherFile);
  if (!info.isFile() || info.isSymbolicLink() || !launcherInfo.isFile() || launcherInfo.isSymbolicLink())
    throw new Error("AppImage tooling and launcher must be ordinary files");
  const metadata = JSON.parse(await readFile(require.resolve("app-builder-lib/package.json"), "utf8"));
  const result = appImageLauncherTransform(
    await readFile(filename), await readFile(launcherFile, "utf8"), metadata.version,
  );
  if (result.changed) {
    const temporary = `${filename}.meetspace-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, result.source, { flag: "wx", mode: info.mode & 0o777 });
      await rename(temporary, filename);
    } finally { await rm(temporary, { force: true }); }
  }
  return result.evidence;
}

export function parsePackagingArguments(args) {
  if (args.length === 1 && args[0] === "--help") return null;
  const arch = args[0];
  if (!["x64", "arm64"].includes(arch) ||
      ![1, 3].includes(args.length) || (args.length === 3 && args[1] !== "--formats"))
    throw new Error("Use package-linux.mjs x64|arm64 [--formats deb,rpm,AppImage]");
  const formats = args.length === 3 ? args[2].split(",") : [...LINUX_PACKAGE_FORMATS];
  return validateLinuxTarget({ arch, formats });
}

async function ordinaryOwnedDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) ||
      info.uid !== process.getuid() || await realpath(directory) !== directory)
    throw new Error("Linux artifact directories must be ordinary, owned and non-writable by others");
}

const formatDirectories = Object.freeze({ deb: "DEB", rpm: "RPM", AppImage: "AppImage" });
const sharedReceipts = ["source-inputs.json", "linux-packaging-build.json", "linux-artifact-verification.json"];

async function ordinaryOwnedFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o022) || info.uid !== process.getuid())
    throw new Error("Linux artifact inputs must be ordinary, owned and non-writable by others");
}

/** Publish the already-verified set without replacing an existing format build. */
export async function publishLinuxArtifacts({ artifactRoot, stage, version, sourceSha256, arch, formats }) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || !Array.isArray(formats) || !formats.length ||
      new Set(formats).size !== formats.length)
    throw new Error("Invalid Linux artifact publication identity");
  const outputs = formats.map((format) => ({
    format,
    name: artifactFilename({ version, arch, format }),
    directory: path.join(artifactRoot, "linux", formatDirectories[format], version, sourceSha256, arch),
  }));
  await ordinaryOwnedDirectory(artifactRoot);
  await ordinaryOwnedDirectory(stage);
  // Inspect every input before creating any destination. A staged symlink must
  // never become an apparently verified, published file through copyFile.
  for (const name of [...sharedReceipts, ...outputs.flatMap(({ name }) => [name, `${name}.sha256`, `${name}.sha512`])])
    await ordinaryOwnedFile(path.join(stage, name));
  for (const { directory } of outputs) {
    // Walk one owned directory at a time, rather than recursively creating
    // paths through an unchecked symlink or directory writable by others.
    let parent = artifactRoot;
    for (const component of path.relative(artifactRoot, path.dirname(directory)).split(path.sep)) {
      parent = path.join(parent, component);
      try { await mkdir(parent, { mode: 0o755 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      await ordinaryOwnedDirectory(parent);
    }
    try {
      await lstat(directory);
      throw new Error("An immutable artifact directory already exists for this source, format and architecture");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  // Reserve every requested format before copying a byte. mkdir is the
  // exclusive no-replace primitive, including if another producer races us.
  const reserved = [];
  try {
    for (const { directory } of outputs) {
      await mkdir(directory, { mode: 0o700 });
      reserved.push(directory);
    }
  } catch (error) {
    for (const directory of reserved.reverse()) await rmdir(directory).catch(() => {});
    throw error;
  }
  for (const { name, directory } of outputs) {
    for (const file of [name, `${name}.sha256`, `${name}.sha512`, ...sharedReceipts])
      await copyFile(path.join(stage, file), path.join(directory, file), fsConstants.COPYFILE_EXCL);
  }
  // The common verification report describes the full verified staging set.
  // Preserve its exact bytes and distinguish that scope from this directory's
  // single package format in a newly-created publication receipt.
  for (const { format, directory } of outputs)
    await writeNewReceipt(path.join(directory, "linux-publication.json"), JSON.stringify({
      schemaVersion: 2, sourceTreeSha256: sourceSha256, arch, format, formats: [format],
      verifiedFormats: [...formats], verifiedStaging: stage, immutableDirectory: directory,
      overwriteAllowed: false,
    }, null, 2) + "\n");
  for (const { directory } of outputs) await chmod(directory, 0o755);
  return outputs.map(({ format, directory }) => ({ format, directory }));
}

async function main() {
  const request = parsePackagingArguments(process.argv.slice(2));
  if (!request) {
    console.log("Usage: node scripts/package-linux.mjs x64|arm64 [--formats deb,rpm,AppImage]\nNative Linux process required. Both x64 and ARM64 support deb,rpm,AppImage.\nInternal test packages only; automatic updates and publication stay disabled.");
    return;
  }
  const { arch, formats } = request;
  const repository = await realpath(path.resolve(desktop, ".."));
  const artifactRoot = path.join(repository, "desktop/artifacts");
  await mkdir(artifactRoot, { recursive: true });
  await ordinaryOwnedDirectory(artifactRoot);
  const lock = path.join(artifactRoot, ".linux-packaging-lock");
  await mkdir(lock, { mode: 0o700 });
  let stage;
  try {
    await writeNewReceipt(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, arch }) + "\n");
    const environment = { ...process.env, MEETSPACE_BUILD_MODE: "test", MEETSPACE_TARGET_ARCH: arch,
      MEETSPACE_RELEASE_CONFIG: "", CSC_IDENTITY_AUTO_DISCOVERY: "false", TZ: "UTC" };
    for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "ELECTRON_BUILDER_COMPRESSION_LEVEL", "MEETSPACE_DESKTOP_DEV", "MEETSPACE_DEV_CSP_NONCE", "MEETSPACE_LINUX_OUTPUT"])
      delete environment[key];
    const run = (args) => {
      const result = spawnSync(process.execPath, args, { cwd: desktop, stdio: "inherit", env: environment });
      if (result.error || result.status !== 0)
        throw new Error(`Linux packaging command failed${result.status === null ? "" : ` (${result.status})`}`);
    };
    run([path.join(desktop, "scripts/build.mjs")]);
    const manifestPath = path.join(desktop, "dist/source-inputs.json");
    const manifestBytes = await readFile(manifestPath);
    const inputs = JSON.parse(manifestBytes);
    const provenance = JSON.parse(await readFile(path.join(desktop, "dist/build-provenance.json"), "utf8"));
    const pkg = JSON.parse(await readFile(path.join(desktop, "package.json"), "utf8"));
    if (!/^\d+\.\d+\.\d+-beta(?:\.\d+)?$/.test(pkg.version) ||
        !/^[a-f0-9]{64}$/.test(inputs.sourceTreeSha256) || provenance.sourceTreeSha256 !== inputs.sourceTreeSha256 ||
        provenance.releaseMode !== "test" || provenance.appId !== "com.janickiy.meetspace.desktop.test" ||
        provenance.buildHostPlatform !== "linux" || provenance.buildHostArch !== arch ||
        provenance.buildVersion !== `${pkg.version}-test` ||
        JSON.stringify(inputs) !== JSON.stringify(await sourceInputs(repository)))
      throw new Error("Linux packaging inputs do not match the current native test build");
    stage = await mkdtemp(path.join(artifactRoot, `.linux-staging-${inputs.sourceTreeSha256}-${arch}-`));
    await chmod(stage, 0o700);
    environment.MEETSPACE_LINUX_OUTPUT = stage;
    environment.SOURCE_DATE_EPOCH = String(provenance.sourceDateEpoch);
    const appImageLauncher = formats.includes("AppImage") ? await prepareAppImageLauncher() : null;
    run([require.resolve("electron-builder/out/cli/cli.js"), "--config", "electron-builder.linux.config.cjs",
      "--linux", ...formats, `--${arch}`, "--publish", "never"]);
    if (JSON.stringify(inputs) !== JSON.stringify(await sourceInputs(repository)) ||
        !manifestBytes.equals(await readFile(manifestPath)))
      throw new Error("Linux packaging source changed during the build");
    const frozenManifest = path.join(stage, "source-inputs.json");
    await copyFile(manifestPath, frozenManifest);
    await writeNewReceipt(path.join(stage, "linux-packaging-build.json"), JSON.stringify({
      schemaVersion: 1, platform: process.platform, arch, node: process.version,
      glibcBuildRuntime: process.report.getReport().header.glibcVersionRuntime ?? null,
      electron: pkg.devDependencies.electron, builder: pkg.devDependencies["electron-builder"],
      version: pkg.version, releaseMode: "test", sourceCommit: inputs.sourceCommit,
      sourceDirty: inputs.sourceDirty, sourceTreeSha256: inputs.sourceTreeSha256,
      formats, appImageLauncher, appImageToolset: formats.includes("AppImage") ? (arch === "arm64" ? "1.0.3" : "0.0.0") : null,
      automaticUpdates: false, published: false,
      maintainerIdentity: "MeetSpace <janickiy@mail.ru>",
    }, null, 2) + "\n");
    run([path.join(desktop, "scripts/verify-linux-artifacts.mjs"), "--directory", stage, "--arch", arch,
      "--formats", formats.join(","), "--source-sha256", inputs.sourceTreeSha256, "--manifest", frozenManifest]);
    const outputs = await publishLinuxArtifacts({ artifactRoot, stage, version: pkg.version,
      sourceSha256: inputs.sourceTreeSha256, arch, formats });
    // Only this invocation's private staging is removed. Builder intermediates
    // and unpacked trees are not part of the published distribution folders.
    await rm(stage, { recursive: true });
    stage = undefined;
    for (const { format, directory } of outputs)
      console.log(`Verified Linux ${format} test artifacts: ${directory}`);
  } catch (error) {
    if (stage) console.error(`Unpublished staging retained for inspection: ${stage}`);
    throw error;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
