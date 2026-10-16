import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  validateReleaseConfig,
  releaseConfigSha256,
} from "./release-policy.mjs";

export function sourceDateEpoch(value, fallback) {
  const candidate = value === undefined ? String(fallback) : value;
  if (typeof candidate !== "string" || !/^[0-9]{1,11}$/.test(candidate))
    throw new Error("Invalid SOURCE_DATE_EPOCH");
  const number = Number(candidate);
  if (
    !Number.isSafeInteger(number) ||
    number < 315532800 ||
    number > Math.floor(Date.now() / 1000) + 300
  )
    throw new Error("Invalid SOURCE_DATE_EPOCH");
  return number;
}
export async function readReleaseConfig(filename) {
  if (!filename || !path.isAbsolute(filename))
    throw new Error("An absolute reviewed release configuration is required");
  const bytes = await readFile(filename);
  if (bytes.length > 32768)
    throw new Error("Release configuration is too large");
  return validateReleaseConfig(JSON.parse(bytes.toString("utf8")));
}
export function makeBuildProvenance({
  pkg,
  inputs,
  epoch,
  releaseMode = "test",
  config,
  hostPlatform = process.platform,
  hostArch = process.arch,
}) {
  if (
    !["test", "release"].includes(releaseMode) ||
    !/^\d+\.\d+\.\d+(?:-beta(?:\.\d+)?)?$/.test(pkg.version)
  )
    throw new Error("Invalid build mode/version");
  if (releaseMode === "release" && pkg.version.includes("-"))
    throw new Error("The stable release channel requires a stable version");
  if (releaseMode === "release" && (inputs.sourceDirty || !config))
    throw new Error(
      "Signed builds require clean committed source and reviewed trust",
    );
  return {
    schemaVersion: 2,
    releaseMode,
    appId:
      releaseMode === "release"
        ? "com.janickiy.meetspace.desktop"
        : "com.janickiy.meetspace.desktop.test",
    sourceCommit: inputs.sourceCommit,
    sourceDirty: inputs.sourceDirty,
    sourceTreeSha256: inputs.sourceTreeSha256,
    buildVersion: pkg.version + (releaseMode === "test" ? "-test" : ""),
    buildTime: new Date(epoch * 1000).toISOString().replace(".000Z", "Z"),
    sourceDateEpoch: epoch,
    buildHostPlatform: hostPlatform,
    buildHostArch: hostArch,
    ...(config ? { releaseConfigSha256: releaseConfigSha256(config) } : {}),
  };
}
