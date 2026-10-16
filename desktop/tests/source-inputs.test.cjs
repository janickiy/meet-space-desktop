const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("source provenance binds exact bytes and frozen locks, not merely a commit label", async (t) => {
  const { sourceInputs } = await import("../scripts/ci/source-inputs.mjs");
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "meetspace-source-inputs-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const git = (args) =>
    execFileSync("git", args, { cwd: directory, stdio: "ignore" });
  git(["init"]);
  for (const workspace of ["frontend", "desktop"]) {
    await fs.mkdir(path.join(directory, workspace));
    await fs.writeFile(
      path.join(directory, workspace, "package-lock.json"),
      "{}\n",
    );
  }
  await fs.writeFile(
    path.join(directory, "desktop", "source.ts"),
    "const version = 1;\n",
  );
  git(["add", "."]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "fixture",
  ]);
  const clean = await sourceInputs(directory, true);
  assert.equal(clean.sourceDirty, false);
  assert.equal(clean.files.length, 3);
  assert.deepEqual(await sourceInputs(directory, true), clean);
  await fs.writeFile(
    path.join(directory, "desktop", "source.ts"),
    "const version = 2;\n",
  );
  const changed = await sourceInputs(directory);
  assert.equal(changed.sourceCommit, clean.sourceCommit);
  assert.notEqual(changed.sourceTreeSha256, clean.sourceTreeSha256);
  assert.equal(changed.sourceDirty, true);
  await assert.rejects(sourceInputs(directory, true), /clean committed/);
  await fs.unlink(path.join(directory, "frontend", "package-lock.json"));
  await assert.rejects(
    sourceInputs(directory),
    /ENOENT|frozen dependency lock/,
  );
});
