const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
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

test("AppImage packaging generates the reviewed launcher instead of upstream's sandbox fallback", async () => {
  const { launcher, source, appImageLauncherTransform } = await fixture();
  const transformed = appImageLauncherTransform(source, launcher, "26.17.0");
  const writes = new Map();
  const exports = {};
  const noOp = async () => {};
  const filesystem = {
    writeFile: async (filename, bytes) => writes.set(filename, bytes),
    remove: noOp, copyFile: noOp, chmod: noOp, copyDir: noOp,
    readFile: async () => Buffer.from("test runtime"),
    open: async () => ({}), write: noOp, close: noOp,
  };
  const modules = new Map([
    ["builder-util", { Arch: { ia32: 0, x64: 1 }, exists: async () => true, exec: noOp, copyDir: noOp, log: { warn() {} } }],
    ["fs-extra", filesystem],
    ["path", path],
    ["../../toolsets/linux", { getAppImageTools: async () => ({ runtime: "/runtime", mksquashfs: "/mksquashfs", runtimeLibraries: "/libraries" }) }],
    ["./appLauncher", { copyIcons: noOp, copyMimeTypes: async () => null }],
    ["../differentialUpdateInfoBuilder", { appendBlockmap: noOp }],
    ["./AppImageTarget", { APP_RUN_ENTRYPOINT: "AppRun" }],
  ]);
  vm.runInNewContext(transformed.source.toString("utf8"), {
    exports, Buffer,
    require(name) { assert.ok(modules.has(name), `unexpected builder dependency: ${name}`); return modules.get(name); },
  });
  await exports.buildLegacyFuse2AppImage({
    stageDir: "/stage", output: "/test.AppImage", appDir: "/application", arch: 1,
    options: {
      executableName: "meetspace-test", productName: "MeetSpace Test", productFilename: "meetspace-test",
      desktopBaseName: "com.janickiy.meetspace.desktop.test", desktopEntry: "[Desktop Entry]\nExec=AppRun %U\n",
    },
  });
  assert.equal(writes.get("/stage/AppRun"), launcher);
  assert.doesNotMatch(writes.get("/stage/AppRun"), /--no-sandbox|--disable-setuid-sandbox|unshare/);
  assert.match(writes.get("/stage/AppRun"), /exec "\$APPDIR\/meetspace-test" "\$@"/);
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

test("Linux package CLI permits native x64 formats and native ARM64 DEB only", () => {
  assert.deepEqual(parseAs("linux", "x64", ["x64"]), { ok: true, value: { arch: "x64", formats: ["deb", "rpm", "AppImage"] } });
  assert.deepEqual(parseAs("linux", "arm64", ["arm64"]), { ok: true, value: { arch: "arm64", formats: ["deb"] } });
  assert.deepEqual(parseAs("linux", "x64", ["x64", "--formats", "rpm,deb"]), { ok: true, value: { arch: "x64", formats: ["rpm", "deb"] } });
  assert.equal(parseAs("linux", "arm64", ["arm64", "--formats", "AppImage"]).ok, false);
});

test("Linux package CLI rejects cross-builds, duplicate formats and hidden extra arguments", () => {
  for (const [platform, arch, args] of [
    ["darwin", "x64", ["x64"]], ["win32", "arm64", ["arm64"]], ["linux", "arm64", ["x64"]],
    ["linux", "x64", ["x64", "--formats", "deb,deb"]], ["linux", "x64", ["x64", "--formats", ""]],
    ["linux", "x64", ["x64", "--formats", "snap"]], ["linux", "x64", ["x64", "--formats", "deb", "--publish", "always"]],
    ["linux", "x64", []], ["linux", "x64", ["all"]], ["linux", "x64", ["x64", "--signed", "config.json"]],
  ]) assert.equal(parseAs(platform, arch, args).ok, false, JSON.stringify({ platform, arch, args }));
  assert.deepEqual(parseAs("darwin", "arm64", ["--help"]), { ok: true, value: null });
});
