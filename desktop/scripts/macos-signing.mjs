import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { lstat, mkdtemp, open, readFile, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MACOS_RELEASE_APP_ID, MACOS_ENTITLEMENTS, validateMacReleaseConfig } from "./macos-release-policy.mjs";
import { inspectMachO, MACOS_MEDIA_USAGE_DESCRIPTIONS } from "./macos-package-policy.mjs";

const blocked = reason => { throw new Error(`macOS release blocked: ${reason}`); };
const validPath = value => typeof value === "string" && path.isAbsolute(value) && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value);
const json = text => { try { return JSON.parse(text); } catch { blocked("native tool returned invalid JSON"); } };
function nativeRun(file, args, options = {}) {
  return spawnSync(file, args, { encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
    timeout: options.timeoutMs ?? 120000, windowsHide: true });
}
function context(options) {
  if ((options.platform ?? process.platform) !== "darwin") blocked("signing and notarization require macOS");
  const config = validateMacReleaseConfig(options.config);
  if (options.keychainPath !== undefined && !validPath(options.keychainPath)) blocked("invalid signing keychain path");
  const keychain = options.keychainPath ? ["--keychain", options.keychainPath] : [];
  const execute = async (file, args, timeoutMs) => {
    const result = await (options.run ?? nativeRun)(file, args, { timeoutMs });
    // External tool output can contain account/keychain diagnostics. It is never
    // copied to thrown errors or CI logs; callers receive bounded public proof.
    if (!result || result.error || result.status !== 0 || typeof result.stdout !== "string" ||
        typeof result.stderr !== "string" || result.stdout.length + result.stderr.length > 2 * 1024 * 1024)
      blocked("native signing or notarization command failed");
    return { stdout: result.stdout, stderr: result.stderr };
  };
  return { config, keychain, execute };
}
async function ordinaryArtifact(filename, extension) {
  if (!validPath(filename) || !filename.endsWith(extension)) blocked("invalid artifact path");
  const stat = await lstat(filename);
  if (stat.isSymbolicLink() || (extension === ".app" ? !stat.isDirectory() : !stat.isFile())) blocked("artifact must be ordinary");
  return realpath(filename);
}

export function validateMacSignatureDetails(text, config, { runtime = true, identifier } = {}) {
  const reviewed = validateMacReleaseConfig(config);
  if (typeof text !== "string" || text.length > 65536 ||
      !new RegExp(`(?:^|\\n)TeamIdentifier=${reviewed.signing.teamId}(?:\\r?\\n|$)`).test(text) ||
      !new RegExp(`(?:^|\\n)Authority=Developer ID Application: [^\\r\\n]+ \\(${reviewed.signing.teamId}\\)(?:\\r?\\n|$)`).test(text) ||
      !/(?:^|\n)Timestamp=[^\r\n]+/.test(text) || /(?:^|\n)Timestamp=(?:none|not set|unavailable|false)(?:\r?\n|$)/i.test(text) ||
      (runtime && !/^CodeDirectory .*flags=0x[0-9a-f]+\([^\r\n]*\bruntime\b[^\r\n]*\)/m.test(text)) ||
      (identifier && !text.split(/\r?\n/).includes(`Identifier=${identifier}`))) blocked("Developer ID, Team ID, timestamp or Hardened Runtime evidence mismatch");
  return { teamId: reviewed.signing.teamId, developerId: true, timestamped: true, hardenedRuntime: runtime };
}

export function validateMacEntitlements(value, { required = true } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => MACOS_ENTITLEMENTS[key] !== true || value[key] !== true) ||
      (required && !Object.entries(MACOS_ENTITLEMENTS).every(([key, expected]) => value[key] === expected)))
    blocked("unexpected signed entitlements");
  return { ...value };
}

/** Exact leaf fingerprint is checked after signing, not just selected before it. */
async function signedTarget(filename, scope, { runtime = true, identifier, entitlements = false } = {}) {
  await scope.execute("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", filename]);
  const details = await scope.execute("/usr/bin/codesign", ["--display", "--verbose=4", filename]);
  const proof = validateMacSignatureDetails(details.stderr + "\n" + details.stdout, scope.config, { runtime, identifier });
  const directory = await mkdtemp(path.join(os.tmpdir(), "meetspace-cert-proof-"));
  try {
    const prefix = path.join(directory, "leaf-");
    await scope.execute("/usr/bin/codesign", ["--display", "--extract-certificates", prefix, filename]);
    const certificate = new X509Certificate(await readFile(prefix + "0"));
    if (certificate.fingerprint.replaceAll(":", "").toUpperCase() !== scope.config.signing.certificateSha1)
      blocked("signed certificate fingerprint mismatch");
    proof.certificateSha1 = scope.config.signing.certificateSha1;
  } finally { await rm(directory, { recursive: true, force: true }); }
  if (entitlements) {
    const signed = await scope.execute("/usr/bin/codesign", ["--display", "--entitlements", "-", "--xml", filename]);
    const xml = signed.stdout.slice(signed.stdout.indexOf("<?xml"));
    if ((!xml.startsWith("<?xml") && entitlements !== "optional") || xml.length > 32768) blocked("signed entitlements missing");
    const { createRequire } = await import("node:module");
    const plist = createRequire(import.meta.url)("plist");
    let value = {};
    try { if (xml.startsWith("<?xml")) value = plist.parse(xml); }
    catch { blocked("invalid signed entitlements"); }
    proof.entitlements = validateMacEntitlements(value, { required: entitlements !== "optional" });
  }
  return proof;
}

async function header(filename) {
  const file = await open(filename, "r");
  try { const bytes = Buffer.alloc(32); const { bytesRead } = await file.read(bytes, 0, bytes.length, 0); return bytes.subarray(0, bytesRead); }
  finally { await file.close(); }
}

async function physicalMachOFiles(app) {
  const files = [], pending = [{ directory: app, depth: 0 }];
  let inspected = 0;
  while (pending.length) {
    const { directory, depth } = pending.pop();
    if (depth > 24) blocked("bundle nesting exceeds verification bound");
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (++inspected > 25000) blocked("bundle file count exceeds verification bound");
      const filename = path.join(directory, item.name);
      // Electron frameworks use version symlinks. Their physical versioned
      // targets are visited independently; links are never followed here.
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) pending.push({ directory: filename, depth: depth + 1 });
      else if (item.isFile()) {
        const bytes = await header(filename);
        if (bytes.length >= 4 && [0xfeedfacf, 0xfeedface, 0xcefaedfe, 0xcffaedfe,
          0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(bytes.readUInt32LE(0))) files.push({ filename, bytes });
      }
    }
  }
  return files;
}

export async function verifyMacSigningIdentity(options) {
  const scope = context(options);
  const args = ["find-identity", "-v", "-p", "codesigning", ...(options.keychainPath ? [options.keychainPath] : [])];
  const { stdout } = await scope.execute("/usr/bin/security", args);
  const lines = stdout.split(/\r?\n/).filter(line => line.includes(scope.config.signing.certificateSha1));
  if (lines.length !== 1 || !new RegExp(`^[ ]*\\d+\\) ${scope.config.signing.certificateSha1} "Developer ID Application: [^"\\r\\n]+ \\(${scope.config.signing.teamId}\\)"$`).test(lines[0]))
    blocked("the reviewed Developer ID Application identity is unavailable");
  return { certificateSha1: scope.config.signing.certificateSha1, teamId: scope.config.signing.teamId, identityAvailable: true };
}

export async function verifyMacSignature(options) {
  const scope = context(options), app = await ordinaryArtifact(options.app, ".app");
  if (!["x64", "arm64"].includes(options.arch)) blocked("explicit architecture required");
  const metadata = await scope.execute("/usr/bin/plutil", ["-convert", "json", "-o", "-", path.join(app, "Contents/Info.plist")]);
  const plist = json(metadata.stdout);
  if (plist.CFBundleIdentifier !== MACOS_RELEASE_APP_ID || plist.CFBundleExecutable !== "MeetSpace" ||
      plist.CFBundleDisplayName !== "MeetSpace" || plist.LSMinimumSystemVersion !== "15.0" ||
      !Object.entries(MACOS_MEDIA_USAGE_DESCRIPTIONS).every(([key, value]) => plist[key] === value) ||
      (options.version !== undefined && plist.CFBundleShortVersionString !== options.version)) blocked("signed app metadata mismatch");
  await scope.execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const proof = await signedTarget(app, scope, { identifier: MACOS_RELEASE_APP_ID, entitlements: true });
  const binary = path.join(app, "Contents/MacOS/MeetSpace");
  inspectMachO(await header(binary), options.arch);
  const frameworks = path.join(app, "Contents/Frameworks");
  const targets = [path.join(frameworks, "Electron Framework.framework")];
  const frameworkBinary = path.join(frameworks, "Electron Framework.framework/Versions/A/Electron Framework");
  inspectMachO(await header(frameworkBinary), options.arch);
  const helpers = [];
  for (const item of await readdir(frameworks, { withFileTypes: true })) {
    if (!/^MeetSpace Helper(?: \([A-Za-z ]+\))?\.app$/.test(item.name)) continue;
    if (!item.isDirectory() || item.isSymbolicLink()) blocked("invalid helper bundle");
    const helper = path.join(frameworks, item.name), executable = path.join(helper, "Contents/MacOS", item.name.slice(0, -4));
    inspectMachO(await header(executable), options.arch);
    helpers.push({ name: item.name, ...(await signedTarget(helper, scope, { entitlements: true })) });
  }
  if (helpers.length < 3) blocked("signed Electron helpers are missing");
  for (const target of targets) await signedTarget(target, scope, { runtime: false });
  const binaries = [];
  for (const { filename, bytes } of await physicalMachOFiles(app)) {
    inspectMachO(bytes, options.arch);
    const signed = await signedTarget(filename, scope, { runtime: false, entitlements: "optional" });
    binaries.push({ file: path.relative(app, filename), certificateSha1: signed.certificateSha1, teamId: signed.teamId });
  }
  return { signed: true, arch: options.arch, appId: MACOS_RELEASE_APP_ID, version: plist.CFBundleShortVersionString,
    ...proof, helpers, binaries, deepVerification: true, nativeRuntimeTested: false };
}

export async function signMacDmg(options) {
  const scope = context(options), dmg = await ordinaryArtifact(options.dmg, ".dmg");
  await verifyMacSigningIdentity(options);
  await scope.execute("/usr/bin/codesign", ["--force", "--sign", scope.config.signing.certificateSha1, "--timestamp", ...scope.keychain, dmg]);
  return signedTarget(dmg, scope, { runtime: false });
}

export async function notarizeMacArtifact(options) {
  const scope = context(options);
  if (!["app", "dmg"].includes(options.kind)) blocked("unsupported notarization artifact");
  const artifact = await ordinaryArtifact(options.artifact, options.kind === "app" ? ".app" : ".dmg");
  // Never submit an unsigned/ad-hoc/foreign-identity artifact for notarization.
  await scope.execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", artifact]);
  await signedTarget(artifact, scope, { runtime: options.kind === "app", identifier: options.kind === "app" ? MACOS_RELEASE_APP_ID : undefined });
  let temporary;
  try {
    let submission = artifact;
    if (options.kind === "app") {
      temporary = await mkdtemp(path.join(os.tmpdir(), "meetspace-notary-"));
      submission = path.join(temporary, "MeetSpace-notary.zip");
      await scope.execute("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", artifact, submission]);
    }
    const result = await scope.execute("/usr/bin/xcrun", ["notarytool", "submit", submission,
      "--keychain-profile", scope.config.notarization.keychainProfile, ...scope.keychain, "--wait", "--output-format", "json"], 25 * 60_000);
    const response = json(result.stdout);
    if (!response || response.status !== "Accepted" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(response.id)) blocked("notarization was not accepted");
    await scope.execute("/usr/bin/xcrun", ["stapler", "staple", "-v", artifact]);
    await scope.execute("/usr/bin/xcrun", ["stapler", "validate", "-v", artifact]);
    const gatekeeper = await scope.execute("/usr/sbin/spctl", ["--assess", "--verbose=2", "--type", options.kind === "app" ? "execute" : "open",
      ...(options.kind === "dmg" ? ["--context", "context:primary-signature"] : []), artifact]);
    const evidence = gatekeeper.stdout + "\n" + gatekeeper.stderr;
    if (!/: accepted(?:\r?\n|$)/.test(evidence) || !/(?:^|\n)source=Notarized Developer ID(?:\r?\n|$)/.test(evidence)) blocked("Gatekeeper did not accept a notarized Developer ID artifact");
    return { kind: options.kind, notarization: "Accepted", submissionId: response.id, stapled: true, stapleValidated: true, gatekeeperAccepted: true };
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}
