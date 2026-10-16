// Prepare a reviewed feed locally; this tool has no upload, push or publish API.
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { readReleaseConfig } from "./build-context.mjs";
import { sourceInputs } from "./ci/source-inputs.mjs";
import { validateReleaseReadiness } from "./release-policy.mjs";
import { signReleaseManifest } from "./sign-update-manifest.mjs";

export async function prepareRelease({
  configPath,
  readinessPath,
  artifactRoot,
  privateKeyFile,
  outputRoot,
}) {
  for (const filename of [
    configPath,
    readinessPath,
    artifactRoot,
    privateKeyFile,
    outputRoot,
  ])
    if (typeof filename !== "string" || !path.isAbsolute(filename))
      throw new Error("Absolute release paths are required");
  const config = await readReleaseConfig(configPath);
  const info = await lstat(readinessPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
    throw new Error("Invalid readiness report");
  const report = JSON.parse(await readFile(readinessPath, "utf8"));
  await validateReleaseReadiness(report, { artifactRoot, config });
  const source = await sourceInputs(
    fileURLToPath(new URL("../..", import.meta.url)),
    true,
  );
  if (
    source.sourceCommit !== report.sourceCommit ||
    source.sourceTreeSha256 !== report.sourceTreeSha256
  )
    throw new Error("Release source changed after acceptance");
  const publishedAt = new Date(),
    expiresAt = new Date(publishedAt.getTime() + 7 * 86400000);
  const manifests = [];
  for (const artifact of report.artifacts) {
    const payload = {
      schemaVersion: 1,
      appId: config.updateTrust.appId,
      channel: "stable",
      arch: artifact.arch,
      version: report.version,
      publishedAt: publishedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      installer: {
        file: path.basename(artifact.file),
        size: artifact.size,
        sha512: artifact.sha512,
      },
    };
    const manifest = await signReleaseManifest({
      config,
      report,
      payload,
      artifactRoot,
      privateKeyFile,
    });
    manifests.push({ artifact, manifest });
  }
  // All release gates, signatures and keys pass before creating output.
  try {
    await lstat(outputRoot);
    throw new Error("Release output already exists");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const parent = path.dirname(outputRoot);
  await mkdir(parent, { recursive: true });
  if ((await lstat(parent)).isSymbolicLink())
    throw new Error("Release parent must not be a symlink");
  const temporary = await mkdtemp(path.join(parent, ".meetspace-release-"));
  try {
    for (const { artifact, manifest } of manifests) {
      const directory = path.join(temporary, "stable", `win-${artifact.arch}`);
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, path.basename(artifact.file));
      await cp(path.join(artifactRoot, artifact.file), destination, {
        errorOnExist: true,
        force: false,
      });
      const bytes = await readFile(destination);
      if (
        bytes.length !== artifact.size ||
        createHash("sha512").update(bytes).digest("base64") !== artifact.sha512
      )
        throw new Error("Release copy failed integrity verification");
      await writeFile(
        `${destination}.sha256`,
        `${artifact.sha256}  ${path.basename(artifact.file)}\n`,
        { flag: "wx" },
      );
      await writeFile(
        path.join(directory, "latest.json"),
        JSON.stringify(manifest, null, 2) + "\n",
        { flag: "wx" },
      );
    }
    await writeFile(
      path.join(temporary, "readiness.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
    await writeFile(
      path.join(temporary, "PUBLICATION.txt"),
      "LOCAL PREPARATION ONLY. Nothing has been uploaded.\nUpload versioned installers and checksums to the reviewed HTTPS feed first.\nVerify downloaded bytes and HTTPS without redirects; atomically replace latest.json last.\nManifest validity is seven days: renew the signed manifest before expiry.\nUse short cache lifetime for latest.json; do not redirect or change the reviewed feed origin.\n",
      { flag: "wx" },
    );
    await rename(temporary, outputRoot);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { version: report.version, outputRoot, published: false };
}
async function main() {
  const names = {
    "--config": "configPath",
    "--readiness": "readinessPath",
    "--artifact-root": "artifactRoot",
    "--key-file": "privateKeyFile",
    "--output-root": "outputRoot",
  };
  const args = process.argv.slice(2),
    input = {};
  if (args.length !== 10)
    throw new Error(
      "Use release.mjs --config <absolute.json> --readiness <absolute.json> --artifact-root <absolute-directory> --key-file <external-private-key> --output-root <new-absolute-directory>",
    );
  for (let index = 0; index < args.length; index += 2) {
    const name = names[args[index]];
    if (!name || Object.hasOwn(input, name))
      throw new Error("Invalid release arguments");
    input[name] = args[index + 1];
  }
  console.log(JSON.stringify(await prepareRelease(input)));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error(
      "Release preparation blocked: reviewed signing trust, clean source, both signed installers and all three real Windows acceptance reports are required. Nothing was published.",
    );
    process.exitCode = 1;
  });
