import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repository = fileURLToPath(new URL("../../..", import.meta.url));
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error("Cannot inspect source checkout");
  return result.stdout;
}

/** Exact file bytes, not just HEAD: local test builds may intentionally be dirty. */
export async function sourceInputs(root = repository, requireClean = false) {
  const sourceCommit = git(root, ["rev-parse", "HEAD"]).trim();
  // Published installers are build outputs, including when checked out as LFS
  // pointers. Rebuilding them must not change source identity or cleanliness.
  const sourceDirty =
    git(root, [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude)desktop/artifacts",
    ]).length !== 0;
  if (!/^[a-f0-9]{40}$/.test(sourceCommit) || (requireClean && sourceDirty))
    throw new Error("Release requires a clean committed checkout");
  // A local test build may include deletions which have not been staged yet.
  // Git's cached list still contains those paths; bind the files in this
  // working tree while retaining the mandatory lock checks below.
  const deleted = new Set(
    git(root, [
      "ls-files",
      "--deleted",
      "-z",
      "--",
      "frontend",
      "desktop",
      ".github/workflows",
    ])
      .split("\0")
      .filter(Boolean),
  );
  const names = [
    ...new Set(
      git(root, [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        "frontend",
        "desktop",
        ".github/workflows",
      ])
        .split("\0")
        .filter(
          (name) =>
            name &&
            !deleted.has(name) &&
            !name.startsWith("desktop/artifacts/"),
        ),
    ),
  ].sort();
  const files = [];
  for (const name of names) {
    if (
      name.includes("\\") ||
      name.split("/").some((part) => part === "..") ||
      !/^(frontend|desktop|\.github\/workflows)\//.test(name)
    )
      throw new Error("Unexpected source path");
    const filename = path.join(root, name);
    const info = await lstat(filename);
    if (!info.isFile())
      throw new Error(`Source inputs must be ordinary files: ${name}`);
    const bytes = await readFile(filename);
    files.push({ path: name, sha256: sha256(bytes), bytes: bytes.length });
  }
  for (const lock of [
    "frontend/package-lock.json",
    "desktop/package-lock.json",
  ])
    if (!files.some((file) => file.path === lock))
      throw new Error(`Missing frozen dependency lock: ${lock}`);
  return {
    schemaVersion: 1,
    sourceCommit,
    sourceDirty,
    sourceTreeSha256: sha256(JSON.stringify(files)),
    files,
  };
}

export async function writeSourceInputs(output, requireClean = false) {
  const value = await sourceInputs(repository, requireClean);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(value, null, 2) + "\n");
  return value;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const output = process.argv[2];
  if (!output || process.argv.slice(3).some((arg) => arg !== "--require-clean"))
    throw new Error("Usage: source-inputs.mjs output.json [--require-clean]");
  const inputs = await writeSourceInputs(
    path.resolve(output),
    process.argv.includes("--require-clean"),
  );
  console.log(
    JSON.stringify({
      sourceCommit: inputs.sourceCommit,
      sourceDirty: inputs.sourceDirty,
      sourceTreeSha256: inputs.sourceTreeSha256,
      files: inputs.files.length,
    }),
  );
}
