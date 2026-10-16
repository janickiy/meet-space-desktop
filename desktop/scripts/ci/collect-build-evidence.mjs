import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sourceInputs, sha256 } from "./source-inputs.mjs";

const repository = fileURLToPath(new URL("../../..", import.meta.url));
const output = path.resolve(process.argv[2] ?? "desktop/artifacts/ci");
const arch = process.argv[3];
if (
  !["x64", "arm64"].includes(arch) ||
  process.platform !== "win32" ||
  process.arch !== arch
)
  throw new Error(
    "CI evidence requires a native Windows process of the target architecture",
  );
await mkdir(output, { recursive: true });
const before = JSON.parse(
  await readFile(path.join(output, "source-inputs.json"), "utf8"),
);
const after = await sourceInputs(repository, true);
if (
  before.sourceTreeSha256 !== after.sourceTreeSha256 ||
  before.sourceCommit !== after.sourceCommit
)
  throw new Error("Build source changed after input capture");
const sboms = [];
for (const workspace of ["frontend", "desktop"])
  for (const scope of ["production", "all"]) {
    const result = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "sbom",
        "--sbom-format",
        "cyclonedx",
        ...(scope === "production" ? ["--omit", "dev"] : []),
      ],
      {
        cwd: path.join(repository, workspace),
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        shell: process.platform === "win32",
      },
    );
    if (result.error || result.status !== 0)
      throw new Error(`Cannot generate ${workspace} SBOM`);
    const value = JSON.parse(result.stdout);
    if (value.bomFormat !== "CycloneDX") throw new Error("Invalid SBOM output");
    const name = `${workspace}-${scope}.cdx.json`,
      bytes = JSON.stringify(value, null, 2) + "\n";
    await writeFile(path.join(output, name), bytes);
    sboms.push({ file: name, sha256: sha256(bytes) });
  }
const npmVersion = spawnSync("npm.cmd", ["--version"], {
  encoding: "utf8",
  shell: true,
});
if (
  npmVersion.error ||
  npmVersion.status !== 0 ||
  !/^\d+\.\d+\.\d+$/.test(npmVersion.stdout.trim())
)
  throw new Error("Cannot record npm version");
await writeFile(
  path.join(output, "build-inputs.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      npm: npmVersion.stdout.trim(),
      sourceCommit: after.sourceCommit,
      sourceTreeSha256: after.sourceTreeSha256,
      sourceDirty: false,
      runnerImage: process.env.ImageOS ?? "unknown",
      runnerImageVersion: process.env.ImageVersion ?? "unknown",
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      sboms,
      sbomScope:
        "npm dependencies, with production and complete build inventories. Electron is a devDependency but a shipped runtime; see the complete desktop inventory and bundled Electron/Chromium notices for native components.",
      reproducibility:
        "Pinned inputs and exact source hashes; timestamped signatures and installers are not claimed byte-for-byte reproducible.",
    },
    null,
    2,
  ) + "\n",
);
