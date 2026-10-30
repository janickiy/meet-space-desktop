const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("macOS CI rejects target labels, emulated Node and Rosetta as native acceptance", async () => {
  const { validateMacOSCIHost } = await import("../scripts/ci/collect-macos-build-evidence.mjs");
  for (const arch of ["x64", "arm64"]) {
    const host = { platform: "darwin", arch, targetArch: arch, uname: arch === "arm64" ? "arm64" : "x86_64", translated: false, hardwareArm64: arch === "arm64" };
    assert.equal(validateMacOSCIHost(host).nativeArchitectureVerified, true);
    for (const patch of [{ platform: "linux" }, { arch: "riscv64" }, { targetArch: "universal" }, { translated: true },
      { hardwareArm64: arch !== "arm64" }, { uname: "wrong" }, { translated: undefined }])
      assert.throws(() => validateMacOSCIHost({ ...host, ...patch }), /native Mac/);
  }
});

test("macOS CI evidence is bound to exact committed input bytes", async () => {
  const { validateMacOSCIInputs } = await import("../scripts/ci/collect-macos-build-evidence.mjs");
  const source = { sourceDirty: false, sourceCommit: "a".repeat(40), sourceTreeSha256: "b".repeat(64) };
  assert.deepEqual(validateMacOSCIInputs(source, { ...source }), source);
  for (const patch of [{ sourceDirty: true }, { sourceCommit: "c".repeat(40) }, { sourceTreeSha256: "d".repeat(64) }, { sourceCommit: "bad" }]) {
    assert.throws(() => validateMacOSCIInputs(source, { ...source, ...patch }), /unchanged clean source/);
    assert.throws(() => validateMacOSCIInputs({ ...source, ...patch }, source), /unchanged clean source/);
  }
});

test("macOS candidate is isolated from untrusted triggers, uses protected native matrix and publishes nothing", () => {
  const root = path.join(__dirname, "../..");
  const candidate = fs.readFileSync(path.join(root, ".github/workflows/desktop-macos-candidate.yml"), "utf8");
  const build = fs.readFileSync(path.join(root, ".github/workflows/desktop-macos-build.yml"), "utf8");
  for (const workflow of [candidate, build]) {
    assert.match(workflow, /runner: macos-15-intel/);
    assert.match(workflow, /runner: macos-15\n/);
    assert.match(workflow, /contents: read/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /source-inputs\.mjs .*--require-clean/);
    assert.match(workflow, /collect-macos-build-evidence\.mjs/);
    assert.equal(/contents: write|gh release|gh workflow|action-gh-release|curl .*--upload-file|aws s3|rsync /.test(workflow), false);
    const uses = [...workflow.matchAll(/uses: ([^\s]+)/g)].map(match => match[1]);
    assert.ok(uses.length >= 3);
    for (const reference of uses) assert.match(reference, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
  }
  assert.match(candidate, /workflow_dispatch:/);
  assert.equal(/pull_request:|pull_request_target:|workflow_run:|push:/.test(candidate), false);
  assert.match(candidate, /environment: desktop-macos-signing/);
  assert.match(candidate, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
  assert.match(candidate, /trap cleanup EXIT/);
  assert.match(candidate, /security delete-keychain/);
  assert.match(candidate, /notarytool store-credentials/);
  assert.match(candidate, /--release --config/);
  assert.equal(/secrets\./.test(build), false, "unsigned PR jobs have no signing credentials");
});
