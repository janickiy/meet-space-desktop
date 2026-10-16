import { createHash, createPublicKey } from "node:crypto";
import { readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";

const APP_ID = "com.janickiy.meetspace.desktop";
const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
const fail = (message) => {
  throw new Error(`Release blocked: ${message}`);
};
function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail(`invalid ${label}`);
}
function list(value, validate) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 4 &&
    new Set(value).size === value.length &&
    value.every(validate)
  );
}
function https(value, directory = false) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f\\%]/.test(value)
  )
    fail("invalid HTTPS configuration");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.hostname.endsWith(".") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== value ||
    url.pathname.includes("//") ||
    (directory && !url.pathname.endsWith("/"))
  )
    fail("invalid HTTPS configuration");
  return value;
}
/** Validates before any certificate or manifest private key is accessed. */
export function validateReleaseConfig(value) {
  exact(
    value,
    ["schemaVersion", "licenseReviewed", "signing", "updateTrust"],
    "release configuration",
  );
  exact(
    value.signing,
    ["mode", "certificateSha1", "timestampUrl"],
    "signing configuration",
  );
  const trust = value.updateTrust;
  exact(
    trust,
    [
      "schemaVersion",
      "enabled",
      "appId",
      "channel",
      "feedBaseUrl",
      "publisherNames",
      "signingCertThumbprints",
      "manifestPublicKeys",
    ],
    "update trust",
  );
  if (value.schemaVersion !== 1 || value.licenseReviewed !== true)
    fail("application license must be reviewed");
  if (
    !["store", "pfx"].includes(value.signing.mode) ||
    !/^[A-F0-9]{40}$/.test(value.signing.certificateSha1)
  )
    fail("signing identity is not configured");
  https(value.signing.timestampUrl);
  if (
    trust.schemaVersion !== 1 ||
    trust.enabled !== true ||
    trust.appId !== APP_ID ||
    trust.channel !== "stable"
  )
    fail("release updates must have reviewed production trust");
  https(trust.feedBaseUrl, true);
  if (
    !list(
      trust.publisherNames,
      (name) =>
        typeof name === "string" &&
        /^CN=.+/.test(name) &&
        name.length <= 1024 &&
        !/[\u0000-\u001f\u007f]/.test(name),
    ) ||
    !list(
      trust.signingCertThumbprints,
      (thumb) => typeof thumb === "string" && /^[A-F0-9]{40}$/.test(thumb),
    ) ||
    !list(
      trust.manifestPublicKeys,
      (pem) =>
        typeof pem === "string" &&
        pem.startsWith("-----BEGIN PUBLIC KEY-----") &&
        pem.length < 4096 &&
        !pem.includes("PRIVATE KEY"),
    )
  )
    fail("missing publisher, certificate or manifest public key");
  if (!trust.signingCertThumbprints.includes(value.signing.certificateSha1))
    fail("signing certificate is outside the updater allowlist");
  const keyIds = trust.manifestPublicKeys.map((pem) => {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519")
      fail("manifest key must be Ed25519");
    return hash(key.export({ type: "spki", format: "der" }));
  });
  if (new Set(keyIds).size !== keyIds.length) fail("duplicate manifest keys");
  return {
    schemaVersion: 1,
    licenseReviewed: true,
    signing: {
      mode: value.signing.mode,
      certificateSha1: value.signing.certificateSha1,
      timestampUrl: value.signing.timestampUrl,
    },
    updateTrust: {
      schemaVersion: 1,
      enabled: true,
      appId: APP_ID,
      channel: "stable",
      feedBaseUrl: trust.feedBaseUrl,
      publisherNames: [...trust.publisherNames],
      signingCertThumbprints: [...trust.signingCertThumbprints],
      manifestPublicKeys: [...trust.manifestPublicKeys],
    },
  };
}
export const releaseConfigSha256 = (config) =>
  hash(JSON.stringify(validateReleaseConfig(config)));

async function artifactBytes(root, relative) {
  if (
    typeof relative !== "string" ||
    relative.length > 240 ||
    !/^[A-Za-z0-9._/-]+$/.test(relative) ||
    path.posix.isAbsolute(relative) ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail("unsafe artifact path");
  const base = await realpath(root),
    filename = path.join(base, relative);
  let parent = base;
  for (const part of relative.split("/")) {
    parent = path.join(parent, part);
    if ((await lstat(parent)).isSymbolicLink())
      fail("artifact symlinks are forbidden");
  }
  if (!(await lstat(filename)).isFile())
    fail("artifact must be an ordinary file");
  const real = await realpath(filename);
  if (!real.startsWith(base + path.sep)) fail("artifact escaped its directory");
  return readFile(real);
}
function signature(value, trust, selectedThumbprint) {
  if (
    !value ||
    value.status !== "Valid" ||
    value.signatureType !== "Authenticode" ||
    value.timestamped !== true ||
    !trust.publisherNames.includes(value.subject) ||
    value.thumbprint?.toUpperCase() !== selectedThumbprint ||
    typeof value.path !== "string" ||
    !path.win32.isAbsolute(value.path)
  )
    fail("actual trusted Authenticode and timestamp evidence is required");
}
const checks = [
  "install",
  "launch",
  "singleInstance",
  "uninstall",
  "sandboxBridgeCsp",
  "protocol",
  "shortcuts",
  "noAutomaticStartup",
  "protocolShellLaunch",
  "manualProductAcceptance",
];
/** Reports must come from protected, trusted jobs; JSON alone is not an attestation.
 * This independently binds their claims to the exact installer bytes and reviewed
 * external trust config. The Windows verifier creates signature reports on Windows.
 */
export async function validateReleaseReadiness(
  report,
  { artifactRoot, config, now = Date.now() },
) {
  const reviewed = validateReleaseConfig(config);
  if (
    !report ||
    report.schemaVersion !== 1 ||
    report.sourceDirty !== false ||
    !/^[a-f0-9]{40}$/.test(report.sourceCommit) ||
    !/^[a-f0-9]{64}$/.test(report.sourceTreeSha256) ||
    report.configSha256 !== releaseConfigSha256(reviewed) ||
    typeof report.version !== "string" ||
    !/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(
      report.version,
    ) ||
    report.version.split(".").some((part) => Number(part) > 65535)
  )
    fail("invalid clean-source release provenance");
  if (
    !Array.isArray(report.artifacts) ||
    report.artifacts.length !== 2 ||
    new Set(report.artifacts.map((item) => item.arch)).size !== 2
  )
    fail("both native installer architectures are required");
  for (const item of report.artifacts) {
    const machine = { x64: "0x8664", arm64: "0xaa64" }[item.arch];
    if (
      !machine ||
      item.payloadMachine !== machine ||
      item.embeddedPayloadVerified !== true ||
      item.releaseMode !== "release" ||
      item.appId !== APP_ID ||
      item.sourceDirty !== false ||
      item.sourceCommit !== report.sourceCommit ||
      item.sourceTreeSha256 !== report.sourceTreeSha256 ||
      path.posix.basename(item.file ?? "") !==
        `MeetSpace-${report.version}-win-${item.arch}-setup.exe`
    )
      fail(
        "installer is not a verified native production build of this source",
      );
    const bytes = await artifactBytes(artifactRoot, item.file);
    if (
      item.size !== bytes.length ||
      item.sha256 !== hash(bytes) ||
      item.sha512 !== hash(bytes, "sha512", "base64")
    )
      fail("installer digest/size mismatch");
    signature(
      item.signatures?.installer,
      reviewed.updateTrust,
      reviewed.signing.certificateSha1,
    );
    signature(
      item.signatures?.payload,
      reviewed.updateTrust,
      reviewed.signing.certificateSha1,
    );
    const integrity = item.integrity;
    if (
      integrity?.embeddedResourceVerified !== true ||
      integrity.algorithm !== "SHA256" ||
      !/^[a-f0-9]{64}$/.test(integrity.headerSha256) ||
      integrity.fuses?.runAsNode !== false ||
      integrity.fuses?.nodeOptions !== false ||
      integrity.fuses?.inspect !== false ||
      integrity.fuses?.asarIntegrity !== true ||
      integrity.fuses?.onlyLoadAsar !== true
    )
      fail(
        "signed EXE must authenticate its ASAR and enforce hardened Electron fuses",
      );
  }
  if (
    !Array.isArray(report.runtime) ||
    report.runtime.length !== 3 ||
    new Set(report.runtime.map((item) => item.target)).size !== 3
  )
    fail("the complete native Windows client matrix is required");
  for (const target of ["win10-22h2-x64", "win11-x64", "win11-arm64"]) {
    const item = report.runtime.find((item) => item.target === target),
      arch = target.endsWith("arm64") ? "arm64" : "x64";
    const installer = report.artifacts.find((item) => item.arch === arch);
    if (
      !item ||
      item.schemaVersion !== 1 ||
      item.result !== "PASS" ||
      item.testBuild !== false ||
      item.platform !== "win32" ||
      item.sourceCommit !== report.sourceCommit ||
      item.version !== report.version ||
      item.installerSha256 !== installer.sha256 ||
      item.osArchitecture !== arch ||
      item.processArchitecture !== arch ||
      item.nativeArchitectureVerified !== true ||
      !Number.isInteger(item.osBuild) ||
      (target.startsWith("win10")
        ? item.osBuild !== 19045
        : item.osBuild < 22000) ||
      item.osProductType !== 1 ||
      checks.some((check) => item.checks?.[check] !== true)
    )
      fail(`missing signed native acceptance: ${target}`);
    const collected = Date.parse(item.collectedAt);
    if (
      !Number.isFinite(collected) ||
      collected > now + 300000 ||
      now - collected > 30 * 86400000
    )
      fail(`stale or invalid acceptance: ${target}`);
  }
  return report;
}
