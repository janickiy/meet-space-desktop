import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MACOS_RELEASE_APP_ID = "com.janickiy.meetspace.desktop";
const fail = message => { throw new Error(`macOS release blocked: ${message}`); };
const hash = value => createHash("sha256").update(value).digest("hex");
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(`invalid ${label}`);
}

/** Public reviewed configuration only. Private keys, passwords and API tokens
 * are provisioned to an ephemeral CI keychain and never belong in this file.
 */
export function validateMacReleaseConfig(value) {
  exact(value, ["schemaVersion", "licenseReviewed", "signing", "notarization", "updateTrust"], "configuration");
  exact(value.signing, ["teamId", "certificateSha1"], "signing identity");
  exact(value.notarization, ["keychainProfile"], "notarization profile");
  exact(value.updateTrust, ["schemaVersion", "enabled"], "update trust");
  if (value.schemaVersion !== 1 || value.licenseReviewed !== true) fail("application license must be reviewed");
  if (!/^[A-Z0-9]{10}$/.test(value.signing.teamId) || !/^[A-F0-9]{40}$/.test(value.signing.certificateSha1))
    fail("Developer ID Team ID and certificate fingerprint are required");
  if (typeof value.notarization.keychainProfile !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value.notarization.keychainProfile)) fail("invalid keychain profile name");
  if (value.updateTrust.schemaVersion !== 1 || value.updateTrust.enabled !== false)
    fail("automatic updates require separate signed application and feed acceptance");
  return {
    schemaVersion: 1, licenseReviewed: true,
    signing: { teamId: value.signing.teamId, certificateSha1: value.signing.certificateSha1 },
    notarization: { keychainProfile: value.notarization.keychainProfile },
    updateTrust: { schemaVersion: 1, enabled: false },
  };
}

export const macReleaseConfigSha256 = config => hash(JSON.stringify(validateMacReleaseConfig(config)));

export async function readMacReleaseConfig(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename)) fail("an absolute reviewed configuration path is required");
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) fail("configuration must be a small ordinary file");
  let value;
  try { value = JSON.parse(await readFile(filename, "utf8")); }
  catch { fail("configuration is not valid JSON"); }
  return validateMacReleaseConfig(value);
}

/** Deliberately independent from Windows Authenticode/update configuration. */
export function makeMacBuildProvenance({ pkg, inputs, epoch, config, hostPlatform = process.platform, hostArch = process.arch }) {
  const reviewed = validateMacReleaseConfig(config);
  if (hostPlatform !== "darwin" || !["x64", "arm64"].includes(hostArch)) fail("a native macOS build host is required");
  if (!pkg || !/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})(?:-beta(?:\.(0|[1-9]\d{0,4}))?)?$/.test(pkg.version))
    fail("invalid version");
  if (!inputs || inputs.sourceDirty !== false || !/^[a-f0-9]{40}$/.test(inputs.sourceCommit) || !/^[a-f0-9]{64}$/.test(inputs.sourceTreeSha256))
    fail("clean committed source and an exact source fingerprint are required");
  if (!Number.isSafeInteger(epoch) || epoch < 315532800 || epoch > Math.floor(Date.now() / 1000) + 300) fail("invalid source epoch");
  return {
    schemaVersion: 2, releaseMode: "release", appId: MACOS_RELEASE_APP_ID,
    sourceCommit: inputs.sourceCommit, sourceDirty: false, sourceTreeSha256: inputs.sourceTreeSha256,
    buildVersion: pkg.version, buildTime: new Date(epoch * 1000).toISOString().replace(".000Z", "Z"), sourceDateEpoch: epoch,
    buildHostPlatform: hostPlatform, buildHostArch: hostArch, releaseConfigSha256: macReleaseConfigSha256(reviewed),
  };
}

export const MACOS_ENTITLEMENTS = Object.freeze({
  "com.apple.security.cs.allow-jit": true,
  "com.apple.security.device.camera": true,
  "com.apple.security.device.audio-input": true,
});

/** The builder must receive explicit entitlements instead of its broad default
 * template (which also disables library validation/permits unsigned memory).
 */
export function macSigningBuilderOptions(config) {
  const reviewed = validateMacReleaseConfig(config);
  const resources = fileURLToPath(new URL("../resources/macos/", import.meta.url));
  return {
    identity: reviewed.signing.certificateSha1, hardenedRuntime: true,
    entitlements: path.join(resources, "entitlements.main.plist"),
    entitlementsInherit: path.join(resources, "entitlements.inherit.plist"),
    gatekeeperAssess: false, notarize: false,
  };
}
