const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { backendModule, validateDownloadedModule, verifyPionFixture, sha256 } = require("./fixtures/pion-source-inputs.cjs");

test("Pion dependency identity rejects replacements, commit drift and missing or mismatched locks", () => {
  const sums = { Sum: "h1:module-fixture-checksum", GoModSum: "h1:mod-fixture-checksum" };
  const lock = `${backendModule.path} ${backendModule.version} ${sums.Sum}\n${backendModule.path} ${backendModule.version}/go.mod ${sums.GoModSum}\n`;
  const downloaded = { Path: backendModule.path, Version: backendModule.version, ...sums,
    Dir: path.resolve("cache/backend"), GoMod: path.resolve("cache/backend/go.mod"), Origin: { Hash: backendModule.commit } };
  assert.deepEqual(validateDownloadedModule(downloaded, lock), { ...backendModule, sum: sums.Sum, goModSum: sums.GoModSum });
  for (const change of [
    { Replace: { Dir: path.resolve("unverified-backend") } }, { Path: "example.invalid/another" }, { Version: "v0.0.0-other" },
    { Origin: { Hash: "0".repeat(40) } }, { Sum: "h1:other" }, { GoModSum: "h1:other" }, { Dir: "relative" },
  ]) assert.throws(() => validateDownloadedModule({ ...downloaded, ...change }, lock), /mismatch/);
  assert.throws(() => validateDownloadedModule(downloaded, ""), /mismatch/);
});

test("prebuilt Pion fixture requires exact source, native architecture and executable bytes", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-pion-policy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, "pion-fixture");
  const bytes = Buffer.from("synthetic executable bytes");
  await fs.writeFile(executable, bytes);
  const inputs = { sourceTreeSha256: "a".repeat(64) };
  const proof = { backendSourceTreeSha256: inputs.sourceTreeSha256, platform: process.platform, arch: process.arch, binarySha256: sha256(bytes) };
  const write = (value) => fs.writeFile(executable + ".source-inputs.json", JSON.stringify(value));
  await write(proof);
  await verifyPionFixture(executable, inputs);
  for (const change of [{ backendSourceTreeSha256: "b".repeat(64) }, { platform: "unverified" }, { arch: "unverified" }, { binarySha256: "c".repeat(64) }]) {
    await write({ ...proof, ...change });
    await assert.rejects(verifyPionFixture(executable, inputs), /mismatch/);
  }
  await write(proof);
  await fs.appendFile(executable, "tampered");
  await assert.rejects(verifyPionFixture(executable, inputs), /mismatch/);
});
