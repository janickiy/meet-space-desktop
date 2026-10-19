const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const desktop = path.resolve(__dirname, "..");
const driverUrl = pathToFileURL(path.join(desktop, "scripts/package-linux.mjs")).href;
const upstreamSha256 = "70cdc560883573fa65246fbea08dd923a4905dc147769995ceb7257658a9980c";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const launcher = await fs.readFile(path.join(desktop, "resources/linux/AppRun.sh"), "utf8");
  let source = await fs.readFile(require.resolve("app-builder-lib/out/targets/appimage/appImageUtil.js"));
  // The local dependency can already contain this reviewed transform following
  // a package build. Recover its exact upstream fixture, then check the pin.
  if (sha256(source) !== upstreamSha256) {
    const inserted = `    const appRunContent = ${JSON.stringify(launcher)};`;
    const text = source.toString("utf8");
    assert.equal(text.split(inserted).length, 2, "only our precise installed transform may be reversed");
    source = Buffer.from(text.replace(inserted, "    const appRunContent = generateAppRunScript(finalConfig);"));
  }
  assert.equal(sha256(source), upstreamSha256, "test fixture must be the exact pinned builder utility");
  return { launcher, source, ...await import(driverUrl) };
}

for (const arch of [1, 3]) test(`AppImage ${arch === 3 ? "ARM64" : "x64"} packaging generates the reviewed launcher instead of upstream's sandbox fallback`, async () => {
  const { launcher, source, appImageLauncherTransform } = await fixture();
  const transformed = appImageLauncherTransform(source, launcher, "26.17.0");
  const writes = new Map();
  const directoryCopies = [];
  const exports = {};
  const noOp = async () => {};
  const filesystem = {
    writeFile: async (filename, bytes) => writes.set(filename, bytes),
    remove: noOp, copyFile: noOp, chmod: noOp, copyDir: noOp,
    readFile: async () => Buffer.from("test runtime"),
    open: async () => ({}), write: noOp, close: noOp,
  };
  const modules = new Map([
    ["builder-util", { Arch: { ia32: 0, x64: 1, arm64: 3 }, exists: async () => true, exec: noOp,
      copyDir: async (source, destination) => directoryCopies.push([source, destination]), log: { warn() {} } }],
    ["fs-extra", filesystem],
    ["path", path],
    ["../../toolsets/linux", { getAppImageTools: async (version, targetArch) => {
      assert.equal(version, "0.0.0");
      assert.equal(targetArch, arch);
      return { runtime: "/runtime", mksquashfs: "/mksquashfs", runtimeLibraries: "/libraries" };
    } }],
    ["./appLauncher", { copyIcons: noOp, copyMimeTypes: async () => null }],
    ["../differentialUpdateInfoBuilder", { appendBlockmap: noOp }],
    ["./AppImageTarget", { APP_RUN_ENTRYPOINT: "AppRun" }],
  ]);
  vm.runInNewContext(transformed.source.toString("utf8"), {
    exports, Buffer,
    require(name) { assert.ok(modules.has(name), `unexpected builder dependency: ${name}`); return modules.get(name); },
  });
  await exports.buildLegacyFuse2AppImage({
    stageDir: "/stage", output: "/test.AppImage", appDir: "/application", arch,
    options: {
      executableName: "meetspace-test", productName: "MeetSpace Test", productFilename: "meetspace-test",
      desktopBaseName: "com.janickiy.meetspace.desktop.test", desktopEntry: "[Desktop Entry]\nExec=AppRun %U\n",
    },
  });
  assert.equal(writes.get("/stage/AppRun"), launcher);
  assert.doesNotMatch(writes.get("/stage/AppRun"), /--no-sandbox|--disable-setuid-sandbox|unshare/);
  assert.match(writes.get("/stage/AppRun"), /exec "\$APPDIR\/meetspace-test" "\$@"/);
  assert.deepEqual(directoryCopies, arch === 3 ? [["/application", "/stage"]] : [["/libraries", "/stage/usr/lib"], ["/application", "/stage"]],
    "ARM64 must not copy the FUSE2 toolset's x64-only support libraries");
  assert.equal(transformed.evidence.upstreamSha256, upstreamSha256);
  assert.equal(transformed.evidence.patchedSha256, sha256(transformed.source));
  assert.equal(transformed.evidence.launcherSha256, sha256(launcher));
});

test("AppImage launcher preparation is idempotent for the exact already-prepared dependency", async () => {
  const { launcher, source, appImageLauncherTransform } = await fixture();
  const first = appImageLauncherTransform(source, launcher, "26.17.0");
  const second = appImageLauncherTransform(first.source, launcher, "26.17.0");
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.deepEqual(second.source, first.source);
  assert.deepEqual(second.evidence, first.evidence);
});

test("AppImage launcher preparation rejects dependency, version and stale-launcher drift", async () => {
  const { launcher, source, appImageLauncherTransform } = await fixture();
  const patched = appImageLauncherTransform(source, launcher, "26.17.0").source;
  assert.throws(() => appImageLauncherTransform(Buffer.concat([source, Buffer.from("\n// drift")]), launcher, "26.17.0"), /Unrecognized/);
  assert.throws(() => appImageLauncherTransform(Buffer.concat([patched, Buffer.from("\n// drift")]), launcher, "26.17.0"), /Unrecognized/);
  assert.throws(() => appImageLauncherTransform(source, launcher, "26.18.0"), /Unreviewed/);
  assert.throws(() => appImageLauncherTransform(patched, launcher + "\n# newly reviewed launcher\n", "26.17.0"), /Unrecognized/);
  for (const invalid of ["", "#!/bin/bash\nexit 0\n", {}, "#!/bin/sh\n" + "x".repeat(32769)])
    assert.throws(() => appImageLauncherTransform(source, invalid, "26.17.0"), /Unreviewed/);
});

// OS/architecture are injected only in a fresh process to exercise pure CLI
// gates on any development host. No packaging or platform acceptance is run.
function parseAs(platform, arch, args) {
  const program = `
    Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}});
    Object.defineProperty(process,'arch',{value:${JSON.stringify(arch)}});
    const {parsePackagingArguments}=await import(${JSON.stringify(driverUrl)});
    try { console.log(JSON.stringify({ok:true,value:parsePackagingArguments(${JSON.stringify(args)})})); }
    catch(error) { console.log(JSON.stringify({ok:false,error:error.message})); }
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", program], { encoding: "utf8" }));
}

test("Linux package CLI permits all three formats for native x64 and native ARM64", () => {
  assert.deepEqual(parseAs("linux", "x64", ["x64"]), { ok: true, value: { arch: "x64", formats: ["deb", "rpm", "AppImage"] } });
  assert.deepEqual(parseAs("linux", "arm64", ["arm64"]), { ok: true, value: { arch: "arm64", formats: ["deb", "rpm", "AppImage"] } });
  assert.deepEqual(parseAs("linux", "x64", ["x64", "--formats", "rpm,deb"]), { ok: true, value: { arch: "x64", formats: ["rpm", "deb"] } });
  assert.deepEqual(parseAs("linux", "arm64", ["arm64", "--formats", "rpm,AppImage"]), { ok: true, value: { arch: "arm64", formats: ["rpm", "AppImage"] } });
});

test("Linux package CLI rejects cross-builds, duplicate formats and hidden extra arguments", () => {
  for (const [platform, arch, args] of [
    ["darwin", "x64", ["x64"]], ["win32", "arm64", ["arm64"]], ["linux", "arm64", ["x64"]],
    ["linux", "x64", ["arm64", "--formats", "rpm,AppImage"]], ["darwin", "arm64", ["arm64", "--formats", "rpm,AppImage"]],
    ["linux", "x64", ["x64", "--formats", "deb,deb"]], ["linux", "x64", ["x64", "--formats", ""]],
    ["linux", "x64", ["x64", "--formats", "snap"]], ["linux", "x64", ["x64", "--formats", "deb", "--publish", "always"]],
    ["linux", "x64", []], ["linux", "x64", ["all"]], ["linux", "x64", ["x64", "--signed", "config.json"]],
  ]) assert.equal(parseAs(platform, arch, args).ok, false, JSON.stringify({ platform, arch, args }));
  assert.deepEqual(parseAs("darwin", "arm64", ["--help"]), { ok: true, value: null });
});

const publicationTest = { skip: typeof process.getuid !== "function" && "Unix ownership policy requires a Unix filesystem host" };

async function publicationFixture(t, arch = "x64") {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-linux-publication-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifactRoot = path.join(root, "artifacts"), stage = path.join(root, "private-stage");
  await fs.mkdir(artifactRoot, { mode: 0o700 });
  await fs.mkdir(stage, { mode: 0o700 });
  const version = "0.1.1-beta", sourceSha256 = "a".repeat(64), formats = ["deb", "rpm", "AppImage"];
  const names = {
    deb: `MeetSpace-0.1.1-beta-linux-${arch === "arm64" ? "arm64" : "amd64"}-test.deb`,
    rpm: `MeetSpace-0.1.1-beta-linux-${arch === "arm64" ? "aarch64" : "x86_64"}-test.rpm`,
    AppImage: `MeetSpace-0.1.1-beta-linux-${arch === "arm64" ? "arm64" : "x86_64"}-test.AppImage`,
  };
  const files = new Map();
  for (const format of formats) {
    const name = names[format], binary = Buffer.from(`inert ${format} package fixture\n`);
    files.set(name, binary);
    files.set(`${name}.sha256`, Buffer.from(`${sha256(binary)}  ${name}\n`));
    files.set(`${name}.sha512`, Buffer.from(`${createHash("sha512").update(binary).digest("hex")}  ${name}\n`));
  }
  files.set("source-inputs.json", Buffer.from(JSON.stringify({ schemaVersion: 1, sourceTreeSha256: sourceSha256 }, null, 4) + "\n"));
  files.set("linux-packaging-build.json", Buffer.from(JSON.stringify({ arch, formats, sourceTreeSha256: sourceSha256 }, null, 2) + "\n"));
  files.set("linux-artifact-verification.json", Buffer.from(JSON.stringify({ result: "PASS", sourceTreeSha256: sourceSha256,
    artifacts: formats.map((format) => ({ format, file: names[format], sha256: sha256(files.get(names[format])) })),
  }, null, 2) + "\n"));
  for (const [name, bytes] of files) await fs.writeFile(path.join(stage, name), bytes, { mode: 0o600 });
  await fs.writeFile(path.join(stage, "builder-debug.yml"), "not a published distribution\n", { mode: 0o600 });
  const directories = Object.fromEntries([["deb", "DEB"], ["rpm", "RPM"], ["AppImage", "AppImage"]]
    .map(([format, folder]) => [format, path.join(artifactRoot, "linux", folder, version, sourceSha256, arch)]));
  return { root, stage, files, names, formats, directories,
    request: { artifactRoot, stage, version, sourceSha256, arch, formats },
    ...await import(driverUrl) };
}

for (const arch of ["x64", "arm64"]) test(`verified ${arch} Linux packages are separated by format without changing aggregate verification evidence`, publicationTest, async (t) => {
  const fixture = await publicationFixture(t, arch);
  const { request, publishLinuxArtifacts, files, names, formats, directories } = fixture;
  const outputs = await publishLinuxArtifacts(request);
  assert.deepEqual(outputs, formats.map((format) => ({ format, directory: directories[format] })));
  for (const format of formats) {
    const directory = directories[format], name = names[format];
    const expected = [name, `${name}.sha256`, `${name}.sha512`, "source-inputs.json", "linux-packaging-build.json", "linux-artifact-verification.json"];
    assert.deepEqual((await fs.readdir(directory)).sort(), [...expected, "linux-publication.json"].sort());
    for (const file of expected) assert.deepEqual(await fs.readFile(path.join(directory, file)), files.get(file));
    const receipt = JSON.parse(await fs.readFile(path.join(directory, "linux-publication.json"), "utf8"));
    assert.equal(receipt.schemaVersion, 2);
    assert.equal(receipt.arch, arch);
    assert.equal(receipt.format, format);
    assert.deepEqual(receipt.formats, [format]);
    assert.deepEqual(receipt.verifiedFormats, formats);
    assert.equal(receipt.immutableDirectory, directory);
    assert.equal(receipt.overwriteAllowed, false);
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o755);
  }
  // A failed later publication remains inspectable; the publisher only reads
  // the verified staging. Its caller removes private builder intermediates.
  for (const [name, bytes] of files) assert.deepEqual(await fs.readFile(path.join(fixture.stage, name)), bytes);
  await assert.rejects(fs.lstat(path.join(request.artifactRoot, "linux", request.version)), { code: "ENOENT" });
});

test("an existing later-format destination prevents all publication and preserves its original bytes", publicationTest, async (t) => {
  const { request, publishLinuxArtifacts, directories } = await publicationFixture(t);
  await fs.mkdir(directories.rpm, { recursive: true });
  const previous = path.join(directories.rpm, "linux-publication.json");
  await fs.writeFile(previous, "previous immutable receipt\n");
  await assert.rejects(publishLinuxArtifacts(request), /immutable artifact directory already exists/);
  assert.equal(await fs.readFile(previous, "utf8"), "previous immutable receipt\n");
  assert.deepEqual(await fs.readdir(directories.rpm), ["linux-publication.json"]);
  for (const format of ["deb", "AppImage"]) await assert.rejects(fs.lstat(directories[format]), { code: "ENOENT" });
});

test("publication never follows an existing symlink destination or format parent", publicationTest, async (t) => {
  for (const symlinkParent of [false, true]) {
    const { root, request, publishLinuxArtifacts, directories } = await publicationFixture(t);
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "keep.txt"), "untouched\n");
    const link = symlinkParent ? path.join(request.artifactRoot, "linux", "RPM") : directories.rpm;
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(outside, link, "dir");
    await assert.rejects(publishLinuxArtifacts(request), /immutable artifact directory already exists|ordinary, owned/);
    assert.deepEqual(await fs.readdir(outside), ["keep.txt"]);
    assert.equal(await fs.readFile(path.join(outside, "keep.txt"), "utf8"), "untouched\n");
    assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
    await assert.rejects(fs.lstat(directories.deb), { code: "ENOENT" });
  }
});

test("incomplete or symlinked staging is rejected before any format destination exists", publicationTest, async (t) => {
  for (const symlinkInput of [false, true]) {
    const { root, stage, request, publishLinuxArtifacts, names } = await publicationFixture(t);
    const input = path.join(stage, symlinkInput ? names.AppImage : "linux-artifact-verification.json");
    await fs.unlink(input);
    if (symlinkInput) {
      const outside = path.join(root, "unverified-package");
      await fs.writeFile(outside, "not a staging package\n", { mode: 0o600 });
      await fs.symlink(outside, input);
    }
    await assert.rejects(publishLinuxArtifacts(request), symlinkInput ? /ordinary, owned/ : { code: "ENOENT" });
    assert.deepEqual(await fs.readdir(request.artifactRoot), []);
  }
});
