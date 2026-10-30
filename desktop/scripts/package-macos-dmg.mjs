// Explicit test DMGs or protected signed candidates. Never publishes or changes Gatekeeper.
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, rmdir, symlink, utimes, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { packageMacApp, verifyMacApp } from "./package-macos.mjs";
import { sourceInputs } from "./ci/source-inputs.mjs";
import { parseMacDmgArguments, macDmgArtifact, assertMacDmgEvidence } from "./macos-dmg-policy.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const repository = path.resolve(desktop, "..");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function command(executable, args, { input, allowFailure = false } = {}) {
  const result = spawnSync(executable, args, { input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 180000 });
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`macOS tool failed: ${path.basename(executable)}`);
  return result;
}
const plist = xml => JSON.parse(command("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], { input: xml }).stdout);

export async function verifyMacDmg(filename, receipt, pkg) {
  command("/usr/bin/hdiutil", ["verify", filename]);
  const mount = await mkdtemp(path.join(os.tmpdir(), "meetspace-dmg-verify-"));
  let mounted = false;
  try {
    const attachment = command("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, "-plist", filename]);
    mounted = true;
    const info = plist(attachment.stdout);
    const mountedPoints = (info["system-entities"] ?? []).map(entity => entity["mount-point"]).filter(value => typeof value === "string");
    const canonicalMount = await realpath(mount);
    if (!(await Promise.all(mountedPoints.map(value => realpath(value)))).includes(canonicalMount))
      throw new Error("DMG mounted at an unexpected location");
    const app = path.join(mount, "MeetSpace.app");
    const actual = await verifyMacApp(app, receipt.arch, pkg, receipt.provenance);
    if (actual.asarSha256 !== receipt.asarSha256 || await realpath(path.join(mount, "Applications")) !== "/Applications")
      throw new Error("Mounted DMG payload or Applications link mismatch");
    const policy = command("/usr/sbin/spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", filename], { allowFailure: true });
    return { imageVerified: true, mountedPayloadVerified: true,
      gatekeeper: { assessed: !policy.error, accepted: policy.status === 0, distributionAcceptance: false },
      mountedAsarSha256: actual.asarSha256 };
  } finally {
    if (mounted) command("/usr/bin/hdiutil", ["detach", mount]);
    await rmdir(mount);
  }
}

export async function packageMacDmg(args) {
  if (process.platform !== "darwin") throw new Error("DMGs require macOS");
  let config, signing;
  const keychainPath = process.env.MEETSPACE_MACOS_KEYCHAIN;
  if (args.release) {
    const policy = await import("./macos-release-policy.mjs");
    signing = await import("./macos-signing.mjs");
    config = await policy.readMacReleaseConfig(args.configPath);
    await sourceInputs(repository, true);
    await signing.verifyMacSigningIdentity({ config, keychainPath });
  }
  const receipt = await packageMacApp(args.arch, { releaseConfigPath: args.release ? args.configPath : undefined });
  const pkg = JSON.parse(await readFile(path.join(desktop, "package.json"), "utf8"));
  const identity = macDmgArtifact({ version: pkg.version, sourceTreeSha256: receipt.sourceTreeSha256, arch: args.arch, release: args.release });
  const root = path.join(desktop, "artifacts/macos");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== process.getuid() || rootStat.mode & 0o022)
    throw new Error("macOS artifact root must be an owned private directory");
  const destination = path.join(root, identity.relativeDirectory);
  try { await lstat(destination); throw new Error("Immutable macOS artifact output already exists"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if (await realpath(parent) !== parent) throw new Error("macOS artifact parent must not contain symlinks");
  const temporary = await mkdtemp(path.join(parent, ".dmg-staging-"));
  try {
    let signature, notarizedApp, notarizedDmg;
    if (args.release) {
      signature = await signing.verifyMacSignature({ app: receipt.app, arch: args.arch, version: pkg.version, config, keychainPath });
      notarizedApp = await signing.notarizeMacArtifact({ artifact: receipt.app, kind: "app", config, keychainPath });
    }
    const volume = path.join(temporary, "volume");
    await mkdir(volume);
    await cp(receipt.app, path.join(volume, "MeetSpace.app"), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, force: false, errorOnExist: true });
    await symlink("/Applications", path.join(volume, "Applications"));
    await writeFile(path.join(volume, "Установка.txt"), args.release
      ? "MeetSpace\nПеретащите MeetSpace.app в Applications. Перед заменой завершите приложение.\nУдаление приложения не удаляет ваши настройки и данные.\n"
      : "MeetSpace — внутренняя тестовая сборка, без Developer ID и нотариализации.\nНе является готовым публичным релизом. Gatekeeper может отказать в запуске.\nПеретащите MeetSpace.app в Applications. Перед заменой завершите приложение.\nЗамена или удаление приложения не удаляет настройки пользователя.\n");
    const epoch = receipt.provenance.sourceDateEpoch;
    await utimes(path.join(volume, "Установка.txt"), epoch, epoch);
    await utimes(volume, epoch, epoch);
    const dmg = path.join(temporary, identity.filename);
    command("/usr/bin/hdiutil", ["create", "-srcfolder", volume, "-volname", `MeetSpace ${pkg.version}${args.release ? "" : " Test"} ${args.arch}`,
      "-format", "UDZO", "-fs", "HFS+", dmg]);
    if (args.release) {
      await signing.signMacDmg({ dmg, config, keychainPath });
      notarizedDmg = await signing.notarizeMacArtifact({ artifact: dmg, kind: "dmg", config, keychainPath });
    }
    const verification = await verifyMacDmg(dmg, receipt, pkg);
    await rm(volume, { recursive: true, force: true });
    const bytes = await readFile(dmg);
    const evidence = assertMacDmgEvidence({ schemaVersion: 1, stage: "06", format: "dmg", arch: args.arch,
      version: pkg.version, mode: identity.mode, sourceTreeSha256: receipt.sourceTreeSha256, sourceCommit: receipt.provenance.sourceCommit,
      sourceDirty: receipt.provenance.sourceDirty, sourceDateEpoch: epoch, file: identity.filename, size: bytes.length, sha256: digest(bytes),
      ...verification, app: receipt.app, appId: receipt.appId, binaries: receipt.binaries,
      signing: args.release ? "verified-developer-id" : "disabled", notarization: args.release ? "accepted-stapled" : "not-performed",
      ...(args.release ? { signature, notarizedApp, notarizedDmg } : {}),
      distributionReady: false, published: false, nativeRuntimeAcceptance: "not-performed", automaticUpdates: false,
      reproducibility: "Frozen dependencies, exact source bytes and SOURCE_DATE_EPOCH; DMG/signing/notarization bytes are not promised reproducible",
    }, { ...identity, arch: args.arch, version: pkg.version, sourceTreeSha256: receipt.sourceTreeSha256 });
    if ((await sourceInputs(repository, args.release)).sourceTreeSha256 !== receipt.sourceTreeSha256) throw new Error("Sources changed during DMG build");
    await writeFile(path.join(temporary, "SHA256SUMS"), `${evidence.sha256}  ${identity.filename}\n`, { flag: "wx" });
    await writeFile(path.join(temporary, "macos-artifacts.json"), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
    await rename(temporary, destination);
    console.log(JSON.stringify({ result: "PASS", directory: destination, file: path.join(destination, identity.filename), distributionReady: false }));
    return evidence;
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseMacDmgArguments(process.argv.slice(2));
  if (args) packageMacDmg(args).catch(() => { console.error("macOS DMG build blocked. Check configuration, source state, native tools and signing prerequisites; nothing was published."); process.exitCode = 1; });
  else console.log("Use package-macos-dmg.mjs x64|arm64 [--release --config absolute.json]");
}
