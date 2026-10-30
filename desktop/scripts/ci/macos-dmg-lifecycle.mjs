// Disposable file-copy lifecycle acceptance. Does not install to real /Applications,
// register Login Items/protocols or read an existing user profile.
import assert from "node:assert/strict";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
const [dmg, output, consent, previousApp] = process.argv.slice(2);
assert.equal(process.platform, "darwin");
assert.ok(path.isAbsolute(dmg || "") && path.isAbsolute(output || "") && consent === "--disposable");
assert.ok(dmg.endsWith(".dmg") && (await lstat(dmg)).isFile() && !(await lstat(dmg)).isSymbolicLink());
const manifest = JSON.parse(await readFile(path.join(path.dirname(dmg), "macos-artifacts.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(await readFile(dmg)), manifest.sha256);
const root = await mkdtemp(path.join(os.tmpdir(), "meetspace-dmg-lifecycle-"));
const mount = path.join(root, "mount"), installation = path.join(root, "Applications/MeetSpace.app"), profile = path.join(root, "profile");
const report = { schemaVersion: 1, result: "FAIL", platform: process.platform, hostArch: process.arch, artifactArch: manifest.arch,
  artifactSha256: manifest.sha256, sourceTreeSha256: manifest.sourceTreeSha256, disposableFileLifecycleOnly: true,
  nativeLaunchTested: false, versionUpgradeTested: false, userProfileMutated: false, checks: {} };
let mounted = false;
function run(file, args) {
  const result = spawnSync(file, args, { encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("Disposable lifecycle native tool failed");
}
try {
  await mkdir(mount); await mkdir(profile);
  const marker = Buffer.from('Disposable settings: preserve on application replacement/removal.\n');
  await writeFile(path.join(profile, "settings-sentinel.txt"), marker);
  run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, dmg]); mounted = true;
  const app = path.join(mount, "MeetSpace.app");
  const asar = bundle => path.join(bundle, "Contents/Resources/app.asar");
  const expected = hash(await readFile(asar(app)));
  assert.equal(expected, manifest.mountedAsarSha256);
  if (previousApp) {
    assert.ok(path.isAbsolute(previousApp) && previousApp.endsWith(".app") && (await lstat(previousApp)).isDirectory());
    await cp(previousApp, installation, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    report.previousPayloadSha256 = hash(await readFile(asar(installation)));
  }
  for (const phase of ["installOrReplace", "reinstall"]) {
    await rm(installation, { recursive: true, force: true });
    await cp(app, installation, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    assert.equal(hash(await readFile(asar(installation))), expected);
    assert.equal((await realpath(installation)).startsWith(await realpath(root) + path.sep), true);
    assert.deepEqual(await readFile(path.join(profile, "settings-sentinel.txt")), marker);
    report.checks[phase] = true;
  }
  await rm(installation, { recursive: true });
  await assert.rejects(lstat(installation), { code: "ENOENT" });
  assert.deepEqual(await readFile(path.join(profile, "settings-sentinel.txt")), marker);
  report.checks.uninstallPreservesDisposableData = true;
  report.result = "PASS";
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally {
  if (mounted) run("/usr/bin/hdiutil", ["detach", mount]);
  await rm(root, { recursive: true, force: true });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ result: report.result, output }));
}
