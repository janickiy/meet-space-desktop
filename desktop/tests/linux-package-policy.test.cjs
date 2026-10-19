const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

// Tiny ELF fixtures exercise the ELF structure, not a text search. They are not
// executable binaries and do not count as Linux runtime or artifact acceptance.
function elf({ machine = 62, requirement = "GLIBC_2.35", incidental = "GLIBC_99.0" } = {}) {
  const bytes = Buffer.alloc(1024);
  bytes.write("\x7fELF"); bytes[4] = 2; bytes[5] = 1; bytes[6] = 1;
  bytes.writeUInt16LE(3, 16); bytes.writeUInt16LE(machine, 18); bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(512n, 40); bytes.writeUInt16LE(64, 52); bytes.writeUInt16LE(64, 58); bytes.writeUInt16LE(4, 60); bytes.writeUInt16LE(1, 62);
  const names = Buffer.from("\0.shstrtab\0.dynstr\0.gnu.version_r\0"); names.copy(bytes, 128);
  const strings = Buffer.from(`\0libc.so.6\0${requirement}\0`); strings.copy(bytes, 256);
  bytes.write(incidental, 400);
  const section = (index, name, type, offset, size, link = 0) => {
    const start = 512 + index * 64;
    bytes.writeUInt32LE(name, start); bytes.writeUInt32LE(type, start + 4);
    bytes.writeBigUInt64LE(BigInt(offset), start + 24); bytes.writeBigUInt64LE(BigInt(size), start + 32); bytes.writeUInt32LE(link, start + 40);
  };
  section(1, 1, 3, 128, names.length); section(2, 11, 3, 256, strings.length); section(3, 19, 0x6ffffffe, 320, 32, 2);
  bytes.writeUInt16LE(1, 320); bytes.writeUInt16LE(1, 322); bytes.writeUInt32LE(1, 324); bytes.writeUInt32LE(16, 328);
  bytes.writeUInt32LE(11, 344);
  return bytes;
}
const installed = () => [
  { path: "opt/meetspace-desktop-test", type: "directory", mode: 0o755, uid: 0, gid: 0 },
  { path: "opt/meetspace-desktop-test/chrome-sandbox", type: "file", mode: 0o4755, uid: 0, gid: 0 },
  { path: "opt/meetspace-desktop-test/meetspace-test", type: "file", mode: 0o755, uid: 0, gid: 0 },
];
const desktopEntry = (image = false) => `[Desktop Entry]\nName=MeetSpace Test\nType=Application\nTerminal=false\nExec=${image ? "AppRun %U" : '/opt/meetspace-desktop-test/meetspace-test %u'}\nIcon=meetspace-test\nStartupWMClass=com.janickiy.meetspace.desktop.test\nMimeType=x-scheme-handler/meetspace;\n`;

test("Linux packaging requires native explicit architecture and supported test formats", async () => {
  const api = await import("../scripts/linux-package-policy.mjs");
  assert.deepEqual(api.validateLinuxTarget({ arch: "x64", formats: ["deb", "rpm", "AppImage"], platform: "linux", hostArch: "x64" }).formats, ["deb", "rpm", "AppImage"]);
  assert.deepEqual(api.validateLinuxTarget({ arch: "arm64", formats: ["deb", "rpm", "AppImage"], platform: "linux", hostArch: "arm64" }).formats, ["deb", "rpm", "AppImage"]);
  for (const invalid of [
    { arch: "x64", formats: ["deb"], platform: "darwin", hostArch: "x64" },
    { arch: "arm64", formats: ["deb"], platform: "linux", hostArch: "x64" },
    { arch: "arm64", formats: ["snap"], platform: "linux", hostArch: "arm64" },
    { arch: "arm64", formats: ["rpm", "rpm"], platform: "linux", hostArch: "arm64" },
    { arch: "arm64", formats: ["AppImage"], platform: "darwin", hostArch: "arm64" },
    { arch: "x64", formats: ["deb", "deb"], platform: "linux", hostArch: "x64" },
  ]) assert.throws(() => api.validateLinuxTarget(invalid), /Linux package verification/);
  assert.equal(api.artifactFilename({ version: "0.1.1-beta", arch: "x64", format: "deb" }), "MeetSpace-0.1.1-beta-linux-amd64-test.deb");
  for (const version of ["0.1.1", "../0.1.1-beta", "0.1.1-beta;touch bad"]) assert.throws(() => api.artifactFilename({ version, arch: "x64", format: "deb" }));
});
test("artifact names match the pinned builder's format-specific architecture macro", async () => {
  const { artifactFilename } = await import("../scripts/linux-package-policy.mjs");
  const { Arch, getArtifactArchName } = require("builder-util");
  for (const [arch, format, expected] of [
    ["x64", "deb", "MeetSpace-0.1.1-beta-linux-amd64-test.deb"],
    ["x64", "rpm", "MeetSpace-0.1.1-beta-linux-x86_64-test.rpm"],
    ["x64", "AppImage", "MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage"],
    ["arm64", "deb", "MeetSpace-0.1.1-beta-linux-arm64-test.deb"],
    ["arm64", "rpm", "MeetSpace-0.1.1-beta-linux-aarch64-test.rpm"],
    ["arm64", "AppImage", "MeetSpace-0.1.1-beta-linux-arm64-test.AppImage"],
  ]) {
    const actual = artifactFilename({ version: "0.1.1-beta", arch, format });
    assert.equal(actual, expected);
    assert.equal(actual, `MeetSpace-0.1.1-beta-linux-${getArtifactArchName(Arch[arch], format)}-test.${format}`);
  }
});
test("Electron packaged license references retain exact official distribution filenames", async () => {
  const { electronNoticeReference } = await import("../scripts/linux-package-policy.mjs");
  assert.equal(electronNoticeReference("LICENSE.electron.txt"), "LICENSE");
  assert.equal(electronNoticeReference("LICENSES.chromium.html"), "LICENSES.chromium.html");
  assert.throws(() => electronNoticeReference("../LICENSE"), /unapproved Electron notice/);
});
for (const arch of ["x64", "arm64"]) test(`actual ${arch} builder AppInfo separates a sandbox-safe install path from display names and one URL argument`, async () => {
  const vm = require("node:vm");
  const { createRequire } = require("node:module");
  const filename = path.resolve(__dirname, "../electron-builder.linux.config.cjs");
  const context = { module: { exports: {} }, require: createRequire(filename), process: {
    platform: "linux", arch, env: { MEETSPACE_TARGET_ARCH: arch, MEETSPACE_LINUX_OUTPUT: "/tmp/meetspace-policy-unused", MEETSPACE_BUILD_MODE: "test" },
  } };
  vm.runInNewContext(await fs.readFile(filename, "utf8"), context, { filename });
  const config = context.module.exports();
  assert.deepEqual(Array.from(config.linux.target), ["deb", "rpm", "AppImage"]);
  assert.equal(config.publish, null);
  assert.equal(config.appId, "com.janickiy.meetspace.desktop.test");
  // Check the real builder configuration. An unversioned libasound2 alternative
  // also admits the OSS compatibility shim, which lacks Chromium's ALSA ABI.
  const alsaDependencies = Array.from(config.deb.depends).filter((dependency) => /\blibasound2(?:t64)?\b/.test(dependency));
  assert.deepEqual(alsaDependencies, ["libasound2t64 (>= 1.2.2) | libasound2 (>= 1.2.2)"]);
  const { deepAssign } = require("builder-util-runtime");
  const { AppInfo } = require("app-builder-lib/out/appInfo.js");
  const { LinuxTargetHelper } = require("app-builder-lib/out/targets/LinuxTargetHelper.js");
  const AppImageTarget = require("app-builder-lib/out/targets/appimage/AppImageTarget.js").default;
  const { validateDesktopEntry, LINUX_TEST_IDENTITY } = await import("../scripts/linux-package-policy.mjs");
  const metadata = { ...JSON.parse(await fs.readFile(path.resolve(__dirname, "../package.json"), "utf8")), ...config.extraMetadata };
  const appInfo = new AppInfo({ config, metadata }, undefined, config.linux);
  assert.equal(`/opt/${appInfo.sanitizedProductName}`, "/opt/meetspace-desktop-test");
  assert.equal(`/opt/${appInfo.sanitizedProductName}`, LINUX_TEST_IDENTITY.installDirectory);
  assert.doesNotMatch(appInfo.sanitizedProductName, /\s/);
  assert.equal(appInfo.productFilename, "meetspace-test");
  assert.equal(metadata.productName, "MeetSpace Test");
  const packager = { config, platformSpecificBuildOptions: config.linux, executableName: config.executableName,
    appInfo, info: { metadata }, fileAssociations: [] };
  const helper = new LinuxTargetHelper(packager);
  for (const format of ["deb", "rpm"]) {
    const entry = await helper.computeDesktopEntry(deepAssign({}, config.linux, config[format]));
    const desktop = validateDesktopEntry(entry);
    assert.equal(desktop.Exec, "/opt/meetspace-desktop-test/meetspace-test %u");
    assert.equal(desktop.Name, "MeetSpace Test");
  }
  const image = new AppImageTarget("AppImage", packager, helper, "/tmp/meetspace-policy-unused");
  assert.equal(validateDesktopEntry(await image.desktopEntry.value, { appImage: true }).Exec, "AppRun %U");
});
test("ELF verification reads GLIBC needs, ignores incidental strings and checks architecture", async () => {
  const { inspectElf } = await import("../scripts/linux-package-policy.mjs");
  assert.deepEqual(inspectElf(elf(), { arch: "x64" }).glibcRequirements, ["GLIBC_2.35"]);
  assert.equal(inspectElf(elf({ machine: 183, requirement: "GLIBC_2.17" }), { arch: "arm64" }).machine, 183);
  assert.throws(() => inspectElf(elf({ machine: 183 }), { arch: "x64" }), /wrong ELF architecture/);
  assert.throws(() => inspectElf(elf({ requirement: "GLIBC_2.36" }), { arch: "x64" }), /exceeds GLIBC_2.35/);
  assert.throws(() => inspectElf(elf({ requirement: "GLIBC_2.35.1" }), { arch: "x64" }), /exceeds GLIBC_2.35/);
  assert.throws(() => inspectElf(elf({ requirement: "GLIBC_ABI_DT_RELR" }), { arch: "x64" }), /unsupported GLIBC/);
  assert.throws(() => inspectElf(Buffer.from("not an ELF"), { arch: "x64" }), /damaged ELF/);
});
test("ELF malformed offsets, string references and cyclic chains fail closed", async () => {
  const { inspectElf } = await import("../scripts/linux-package-policy.mjs");
  for (const mutate of [
    (bytes) => bytes.writeBigUInt64LE(9000n, 40),
    (bytes) => bytes.writeBigUInt64LE(9000n, 512 + 3 * 64 + 24),
    (bytes) => bytes.writeUInt32LE(9999, 344),
    (bytes) => bytes.writeUInt32LE(1, 332),
    (bytes) => bytes.writeUInt16LE(2, 322),
    (bytes) => { bytes[5] = 2; },
  ]) {
    const bytes = elf(); mutate(bytes);
    assert.throws(() => inspectElf(bytes, { arch: "x64" }), /Linux package verification/);
  }
});
test("package entries reject traversal, absolute paths, duplicate entries and link ancestor writes", async () => {
  const { archivePath, validateArchiveEntries } = await import("../scripts/linux-package-policy.mjs");
  assert.equal(archivePath("./opt/MeetSpace Test/chrome-sandbox"), "opt/MeetSpace Test/chrome-sandbox");
  for (const invalid of ["../outside", "/etc/passwd", "a/../../outside", "a\\..\\outside", "a\nb", "a//b", "a/./b"]) assert.throws(() => archivePath(invalid), /unsafe/);
  assert.equal(validateArchiveEntries(installed()).size, 3);
  const base = { type: "symlink", mode: 0o755, uid: 0, gid: 0 };
  for (const extra of [
    [{ ...base, path: "evil", link: "../outside" }],
    [{ ...base, path: "evil", link: "/etc" }],
    [{ ...base, path: "evil", link: "opt" }, { path: "evil/file", type: "file", mode: 0o644, uid: 0, gid: 0 }],
    [{ ...installed()[2] }],
  ]) assert.throws(() => validateArchiveEntries([...installed(), ...extra]), /Linux package verification/);
});
test("installed package sandbox ownership and permissions must be exact", async () => {
  const { validateArchiveEntries } = await import("../scripts/linux-package-policy.mjs");
  for (const mutate of [
    (entries) => { entries[1].mode = 0o755; },
    (entries) => { entries[1].uid = 1000; },
    (entries) => { entries[1].gid = 1000; },
    (entries) => { entries[2].mode = 0o777; },
    (entries) => { entries[2].mode = 0o4755; },
  ]) { const entries = installed(); mutate(entries); assert.throws(() => validateArchiveEntries(entries)); }
});
test("desktop metadata preserves one URL argument and never injects sandbox bypasses", async () => {
  const { validateDesktopEntry } = await import("../scripts/linux-package-policy.mjs");
  assert.equal(validateDesktopEntry(desktopEntry()).Exec, "/opt/meetspace-desktop-test/meetspace-test %u");
  assert.equal(validateDesktopEntry(desktopEntry(true), { appImage: true }).Exec, "AppRun %U");
  for (const text of [
    desktopEntry().replace(" %u", " --no-sandbox %u"),
    desktopEntry().replace(" %u", " %U"),
    desktopEntry().replace("Name=MeetSpace Test", "Name=MeetSpace"),
    desktopEntry().replace("Icon=meetspace-test", "Icon=untrusted"),
    desktopEntry() + "Exec=/tmp/evil %u\n",
    desktopEntry().replace("x-scheme-handler/meetspace;", "x-scheme-handler/https;"),
  ]) assert.throws(() => validateDesktopEntry(text));
});
test("DEB/RPM architecture, package name, pre-release ordering and dependencies are inspected", async () => {
  const { validatePackageMetadata } = await import("../scripts/linux-package-policy.mjs");
  const actual = { name: "meetspace-desktop-test", arch: "amd64", version: "0.1.1~beta", release: "1", dependencies: ["libnss3", "libgtk-3-0", "libasound2", "libgbm1", "libxss1"] };
  assert.equal(validatePackageMetadata(actual, { arch: "x64", format: "deb", version: "0.1.1-beta" }), actual);
  for (const mutation of [{ name: "meetspace-desktop" }, { arch: "arm64" }, { version: "0.1.1" }, { release: "2" }, { dependencies: ["libnss3"] }])
    assert.throws(() => validatePackageMetadata({ ...actual, ...mutation }, { arch: "x64", format: "deb", version: "0.1.1-beta" }));
  const rpm = { ...actual, arch: "aarch64", dependencies: ["nss", "gtk3", "alsa-lib", "mesa-libgbm", "libXScrnSaver"] };
  assert.equal(validatePackageMetadata(rpm, { arch: "arm64", format: "rpm", version: "0.1.1-beta" }), rpm);
  for (const wrongArch of ["x86_64", "arm64", "amd64"])
    assert.throws(() => validatePackageMetadata({ ...rpm, arch: wrongArch }, { arch: "arm64", format: "rpm", version: "0.1.1-beta" }), /architecture mismatch/);
  const x64Rpm = { ...rpm, arch: "x86_64" };
  assert.equal(validatePackageMetadata(x64Rpm, { arch: "x64", format: "rpm", version: "0.1.1-beta" }), x64Rpm);
});
test("verification receipts never overwrite files or follow symlinks", async (t) => {
  const { writeNewReceipt, validateArtifactDirectory } = await import("../scripts/linux-package-policy.mjs");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-linux-policy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await validateArtifactDirectory(await fs.realpath(directory));
  const file = path.join(directory, "receipt.json");
  await writeNewReceipt(file, "first\n");
  await assert.rejects(writeNewReceipt(file, "replace\n"), { code: "EEXIST" });
  assert.equal(await fs.readFile(file, "utf8"), "first\n");
  const link = path.join(directory, "link.json");
  await fs.symlink(file, link);
  await assert.rejects(writeNewReceipt(link, "replace\n"), { code: "EEXIST" });
  const linkedDirectory = path.join(directory, "linked-directory");
  await fs.symlink(directory, linkedDirectory, "dir");
  await assert.rejects(validateArtifactDirectory(linkedDirectory), /without symlinks/);
  // path.join normalizes ".." before validation and would test the original
  // valid directory on Linux. Keep the supplied non-canonical spelling intact.
  const canonical = await fs.realpath(directory);
  await assert.rejects(validateArtifactDirectory(`${canonical}${path.sep}..${path.sep}${path.basename(canonical)}`), /without symlinks/);
});
test("DEB control archive rejects additional root code, links and nonempty conffiles", async () => {
  const { validateDebControlEntries } = await import("../scripts/linux-package-policy.mjs");
  const file = (name, script = false) => ({ path: name, type: "file", mode: script ? 0o755 : 0o644, uid: 0, gid: 0, size: 24 });
  const base = [file("control"), file("md5sums"), file("postinst", true), file("postrm", true)];
  assert.equal(validateDebControlEntries([...base, { ...file("conffiles"), size: 0 }]).size, 5);
  for (const name of ["preinst", "prerm", "config", "triggers", "unknown", "nested/postinst"]) {
    assert.throws(() => validateDebControlEntries([...base, file(name, true)]), /unreviewed/);
  }
  for (const extra of [{ ...file("conffiles"), size: 1 }, { ...file("control"), type: "symlink", link: "postinst" }])
    assert.throws(() => validateDebControlEntries([...base, extra]));
  assert.throws(() => validateDebControlEntries(base.filter((entry) => entry.path !== "postrm")), /required DEB control/);
  assert.throws(() => validateDebControlEntries(base.map((entry) => entry.path === "postinst" ? { ...entry, mode: 0o777 } : entry)), /unsafe/);
});
test("RPM root code inventory rejects every unexpected script and trigger even when its body is empty", async () => {
  const { RPM_FORBIDDEN_SCRIPT_TAGS, validateRpmScriptInventory } = await import("../scripts/linux-package-policy.mjs");
  assert.equal(validateRpmScriptInventory([]), true);
  for (const tag of ["PREIN", "PREUN", "PRETRANS", "POSTTRANS", "VERIFYSCRIPT", "TRIGGERSCRIPTS", "FILETRIGGERSCRIPTS", "TRANSFILETRIGGERSCRIPTS"]) {
    assert.ok(RPM_FORBIDDEN_SCRIPT_TAGS.includes(tag));
    assert.throws(() => validateRpmScriptInventory([tag]), /unreviewed RPM/);
  }
});
