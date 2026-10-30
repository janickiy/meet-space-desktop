import path from "node:path";

export function parseMacDmgArguments(args) {
  if (args.length === 1 && args[0] === "--help") return null;
  if (!["arm64", "x64"].includes(args[0])) throw new Error("An explicit macOS architecture is required");
  if (args.length === 1) return { arch: args[0], release: false };
  if (args.length !== 4 || args[1] !== "--release" || args[2] !== "--config" ||
      !path.isAbsolute(args[3]) || /[\u0000-\u001f\u007f]/.test(args[3])) throw new Error("Use arch [--release --config absolute.json]");
  return { arch: args[0], release: true, configPath: args[3] };
}

export function macDmgArtifact({ version, sourceTreeSha256, arch, release = false }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta(?:\.\d+)?)?$/.test(version) ||
      !/^[a-f0-9]{64}$/.test(sourceTreeSha256) || !["x64", "arm64"].includes(arch) || typeof release !== "boolean")
    throw new Error("Invalid macOS artifact identity");
  const mode = release ? "release" : "test";
  return { relativeDirectory: `${version}/${sourceTreeSha256}/${arch}/${mode}`,
    filename: `MeetSpace-${version}-darwin-${arch}${release ? "" : "-test"}.dmg`, mode };
}

export function assertMacDmgEvidence(evidence, expected) {
  if (!evidence || evidence.format !== "dmg" || evidence.arch !== expected.arch || evidence.version !== expected.version ||
      evidence.sourceTreeSha256 !== expected.sourceTreeSha256 || evidence.mode !== expected.mode ||
      evidence.file !== expected.filename || !Number.isSafeInteger(evidence.size) || evidence.size < 1024 ||
      !/^[a-f0-9]{64}$/.test(evidence.sha256) || evidence.imageVerified !== true || evidence.mountedPayloadVerified !== true ||
      evidence.published !== false || evidence.distributionReady !== false ||
      (expected.mode === "test" && (evidence.signing !== "disabled" || evidence.notarization !== "not-performed")) ||
      (expected.mode === "release" && (evidence.signing !== "verified-developer-id" || evidence.notarization !== "accepted-stapled")))
    throw new Error("Invalid macOS DMG verification evidence");
  return evidence;
}
