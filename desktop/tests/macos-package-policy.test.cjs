const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");

async function configuration({ platform = "darwin", arch = "arm64", mode = "test", output = "/tmp/meetspace-mac-policy-unused", target = "darwin" } = {}) {
  const filename = path.resolve(__dirname, "../electron-builder.macos.config.cjs");
  const context = { module: { exports: {} }, require: createRequire(filename), process: {
    platform, env: { MEETSPACE_TARGET_ARCH: arch, MEETSPACE_BUILD_MODE: mode, MEETSPACE_MACOS_OUTPUT: output, MEETSPACE_BUILD_TARGET: target },
  } };
  vm.runInNewContext(await fs.readFile(filename, "utf8"), context, { filename });
  return JSON.parse(JSON.stringify(context.module.exports()));
}

test("macOS commands reject implicit targets and unsupported packaging/dev arguments", async () => {
  const { parseMacArguments } = await import("../scripts/macos-package-policy.mjs");
  assert.deepEqual(parseMacArguments(["arm64"]), { arch: "arm64", smoke: false });
  assert.deepEqual(parseMacArguments(["x64", "--smoke"], { dev: true }), { arch: "x64", smoke: true });
  assert.equal(parseMacArguments(["--help"]), null);
  for (const args of [[], ["all"], ["universal"], ["x64", "--signed"], ["arm64", "--mac", "dmg"], ["x64", "--smoke"], ["arm64", "--publish", "always"], ["--help", "x64"]])
    assert.throws(() => parseMacArguments(args));
  assert.throws(() => parseMacArguments(["arm64", "--smoke", "--smoke"], { dev: true }));
});

test("macOS targets distinguish cross-packaging from a matching runtime", async () => {
  const { validateMacTarget } = await import("../scripts/macos-package-policy.mjs");
  assert.equal(validateMacTarget({ arch: "x64", platform: "darwin", hostArch: "arm64" }).crossBuilt, true);
  assert.equal(validateMacTarget({ arch: "arm64", platform: "darwin", hostArch: "arm64", dev: true }).crossBuilt, false);
  for (const wrong of [
    { platform: "linux", arch: "arm64", hostArch: "arm64" },
    { platform: "win32", arch: "x64", hostArch: "x64" },
    { platform: "darwin", arch: "universal", hostArch: "arm64" },
    { platform: "darwin", arch: "x64", hostArch: "arm64", dev: true },
  ]) assert.throws(() => validateMacTarget(wrong));
});

for (const arch of ["x64", "arm64"]) test(`real builder accepts the ${arch} unpacked macOS test policy without Windows hooks`, async () => {
  const config = await configuration({ arch });
  const { validateConfiguration } = require("app-builder-lib/out/util/config/config.js");
  await validateConfiguration(config, { isEnabled: false });
  const { AppInfo } = require("app-builder-lib/out/appInfo.js");
  const pkg = JSON.parse(await fs.readFile(path.resolve(__dirname, "../package.json"), "utf8"));
  const info = new AppInfo({ config, metadata: { ...pkg, ...config.extraMetadata } }, undefined, config.mac);
  assert.equal(info.productFilename, "MeetSpace");
  assert.equal(config.appId, "com.janickiy.meetspace.desktop.test");
  assert.deepEqual(config.mac.target, [{ target: "dir", arch: [arch] }]);
  assert.equal(config.mac.minimumSystemVersion, "15.0");
  assert.equal(config.mac.darkModeSupport, true);
  assert.equal(config.mac.extendInfo.NSHighResolutionCapable, true);
  const { MACOS_MEDIA_USAGE_DESCRIPTIONS } = await import("../scripts/macos-package-policy.mjs");
  for (const [key, value] of Object.entries(MACOS_MEDIA_USAGE_DESCRIPTIONS))
    assert.equal(config.mac.extendInfo[key], value);
  assert.equal(config.mac.extendInfo.NSSystemAudioCaptureUsageDescription, undefined);
  // Electron's base plist has an NSAudioCaptureUsageDescription. We do not
  // introduce or override it to imply that system-audio sharing is supported.
  assert.equal(config.mac.extendInfo.NSAudioCaptureUsageDescription, undefined);
  assert.equal(config.mac.entitlements, undefined);
  assert.equal(config.mac.entitlementsInherit, undefined);
  assert.equal(config.mac.hardenedRuntime, undefined);
  assert.equal(config.mac.identity, null);
  assert.equal(config.mac.notarize, false);
  assert.equal(config.publish, null);
  assert.equal(config.forceCodeSigning, false);
  assert.equal(config.npmRebuild, false);
  for (const key of ["afterPack", "afterSign", "win", "nsis", "linux", "dmg", "pkg", "mas"])
    assert.equal(config[key], undefined);
  assert.ok(config.files.includes("resources/macos/TrayTemplate.png"));
  assert.ok(config.files.includes("resources/macos/TrayTemplate@2x.png"));
  assert.ok(config.files.includes("!node_modules/**/*.node"));
  assert.equal(config.extraResources.length, 4);
});

test("macOS builder configuration fails closed outside the reviewed test driver", async () => {
  for (const wrong of [{ platform: "win32" }, { platform: "linux" }, { arch: "universal" }, { mode: "release" }, { output: "relative" }, { output: "" }, { target: "win32" }])
    await assert.rejects(configuration(wrong), /macOS unpacked test packaging driver/);
});

test("test build environment does not inherit signing, release or executable injection settings", async () => {
  const { macTestEnvironment } = await import("../scripts/macos-package-policy.mjs");
  const env = macTestEnvironment({ PATH: "/fixture/bin", CSC_LINK: "secret", APPLE_API_KEY: "secret", WIN_CSC_KEY_PASSWORD: "secret",
    MEETSPACE_RELEASE_CONFIG: "/private/config", MEETSPACE_BUILD_MODE: "release", MEETSPACE_MACOS_OUTPUT: "/elsewhere",
    NODE_OPTIONS: "--require /tmp/foreign.cjs", ELECTRON_RUN_AS_NODE: "1", MEETSPACE_DESKTOP_DEV: "1" }, "arm64");
  assert.deepEqual(env, { PATH: "/fixture/bin", MEETSPACE_BUILD_MODE: "test", MEETSPACE_BUILD_TARGET: "darwin", MEETSPACE_TARGET_ARCH: "arm64", CSC_IDENTITY_AUTO_DISCOVERY: "false", TZ: "UTC" });
});

test("Mach-O architecture check rejects mislabeled, universal and truncated headers", async () => {
  const { inspectMachO } = await import("../scripts/macos-package-policy.mjs");
  for (const [arch, cpu] of [["x64", 0x01000007], ["arm64", 0x0100000c]]) {
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf); header.writeUInt32LE(cpu, 4);
    assert.equal(inspectMachO(header, arch), arch);
    assert.throws(() => inspectMachO(header, arch === "x64" ? "arm64" : "x64"), /Wrong Mach-O/);
  }
  for (const header of [Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(32), Buffer.from("cafebabe".repeat(8), "hex")])
    assert.throws(() => inspectMachO(header, "arm64"), /thin 64-bit Mach-O/);
});

test("Info.plist verification requires the stable test identity, macOS 15, Retina, camera/mic/screen purposes and custom protocol", async () => {
  const { validateMacPlist, MACOS_MEDIA_USAGE_DESCRIPTIONS } = await import("../scripts/macos-package-policy.mjs");
  const plist = { CFBundleIdentifier: "com.janickiy.meetspace.desktop.test", CFBundleDisplayName: "MeetSpace", CFBundleExecutable: "MeetSpace",
    CFBundleShortVersionString: "0.2.1-beta", LSMinimumSystemVersion: "15.0", NSHighResolutionCapable: true,
    NSRequiresAquaSystemAppearance: false, CFBundleURLTypes: [{ CFBundleURLSchemes: ["meetspace"] }], ...MACOS_MEDIA_USAGE_DESCRIPTIONS };
  validateMacPlist(plist, "0.2.1-beta");
  // A purpose string inherited from Electron is metadata, not a permission
  // grant. Its presence must not prevent packaging the video-only screen path.
  validateMacPlist({ ...plist, NSAudioCaptureUsageDescription: "This app needs access to audio capture" }, "0.2.1-beta");
  for (const mutation of [{ CFBundleIdentifier: "com.janickiy.meetspace.desktop" }, { LSMinimumSystemVersion: "13.0" }, { NSHighResolutionCapable: false },
    { CFBundleDisplayName: "MeetSpace Test" }, { CFBundleShortVersionString: "9.9.9" }, { CFBundleURLTypes: [] }])
    assert.throws(() => validateMacPlist({ ...plist, ...mutation }, "0.2.1-beta"));
  for (const key of Object.keys(MACOS_MEDIA_USAGE_DESCRIPTIONS)) {
    const missing = { ...plist };
    delete missing[key];
    assert.throws(() => validateMacPlist(missing, "0.2.1-beta"), /media permission/);
    for (const invalid of ["", " ", true, "TODO"])
      assert.throws(() => validateMacPlist({ ...plist, [key]: invalid }, "0.2.1-beta"), /media permission/);
  }
});

test("checked-in macOS artwork matches the approved SVG and contains all Retina icon sizes", async () => {
  const root = path.resolve(__dirname, "../resources/macos");
  const metadata = JSON.parse(await fs.readFile(path.join(root, "source.json"), "utf8"));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(await fs.readFile(path.resolve(root, metadata.source))), metadata.sourceSha256);
  for (const [name, digest] of Object.entries(metadata.files)) assert.equal(hash(await fs.readFile(path.join(root, name))), digest);
  for (const [name, pixels] of [["TrayTemplate.png", 18], ["TrayTemplate@2x.png", 36]]) {
    const png = await fs.readFile(path.join(root, name));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), pixels); assert.equal(png.readUInt32BE(20), pixels);
    assert.equal(png[25], 6, "RGBA with template transparency");
  }
  const icns = await fs.readFile(path.join(root, "icon.icns"));
  assert.equal(icns.subarray(0, 4).toString(), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  const types = new Set();
  for (let offset = 8; offset < icns.length;) {
    types.add(icns.subarray(offset, offset + 4).toString());
    const length = icns.readUInt32BE(offset + 4);
    assert.ok(length >= 8 && offset + length <= icns.length);
    offset += length;
  }
  // iconutil emits ARGB ic04/ic05 for the 16/32 1x slots, PNG for
  // the larger/Retina slots. Require all ten source representations.
  for (const type of ["ic04", "ic05", "ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14"])
    assert.ok(types.has(type), `missing ICNS representation ${type}`);
});
