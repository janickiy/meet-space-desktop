import path from "node:path";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";

export const LINUX_TEST_IDENTITY = Object.freeze({
  appId: "com.janickiy.meetspace.desktop.test",
  productName: "MeetSpace Test",
  executable: "meetspace-test",
  packageName: "meetspace-desktop-test",
  desktopName: "com.janickiy.meetspace.desktop.test.desktop",
  installDirectory: "/opt/meetspace-desktop-test",
});
export const LINUX_MACHINES = Object.freeze({ x64: 62, arm64: 183 });
export const LINUX_PACKAGE_FORMATS = Object.freeze(["deb", "rpm", "AppImage"]);
// Official appimage@1.0.3, appimage-tools-runtime-20251108.tar.gz. This static
// type-2 runtime has no ELF interpreter or DT_NEEDED libraries. The builder
// copies these exact bytes before the SquashFS and appends its blockmap later.
export const ARM64_APPIMAGE_RUNTIME = Object.freeze({
  toolset: "1.0.3",
  size: 936456,
  sha256: "00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444",
});
const fail = (message) => { throw new Error(`Linux package verification: ${message}`); };

export function validateLinuxTarget({ arch, formats, platform = process.platform, hostArch = process.arch }) {
  if (platform !== "linux" || hostArch !== arch || !(arch in LINUX_MACHINES))
    fail("a native Linux process matching the explicit target architecture is required");
  if (!Array.isArray(formats) || !formats.length || new Set(formats).size !== formats.length ||
      formats.some((format) => !LINUX_PACKAGE_FORMATS.includes(format)))
    fail("unsupported or duplicate package formats");
  return { arch, formats: [...formats] };
}
export function artifactFilename({ version, arch, format }) {
  if (!/^\d+\.\d+\.\d+-beta(?:\.\d+)?$/.test(version) || !(arch in LINUX_MACHINES) ||
      !LINUX_PACKAGE_FORMATS.includes(format))
    fail("invalid test artifact identity");
  const artifactArch = arch === "x64" ? (format === "deb" ? "amd64" : "x86_64") : (format === "rpm" ? "aarch64" : "arm64");
  return `MeetSpace-${version}-linux-${artifactArch}-test.${format}`;
}
export function electronNoticeReference(packagedName) {
  if (packagedName === "LICENSE.electron.txt") return "LICENSE";
  if (packagedName === "LICENSES.chromium.html") return packagedName;
  fail("unapproved Electron notice reference");
}
export function archivePath(value) {
  if (typeof value !== "string" || value.includes("\\") || /[\x00-\x1f\x7f]/.test(value) || path.posix.isAbsolute(value))
    fail("unsafe archive path");
  const parts = value.replace(/^(\.\/)+/, "").replace(/\/+$/, "").split("/");
  if (parts.some((part) => part === ".." || part === "." || !part)) {
    if (parts.length === 1 && !parts[0]) return "";
    fail("unsafe archive path component");
  }
  return parts.join("/");
}
export function validateArchiveEntries(entries, { installed = true } = {}) {
  const seen = new Map();
  for (const entry of entries) {
    const name = archivePath(entry.path);
    if (!name && entry.type === "directory") continue;
    if (!name || seen.has(name) || !["file", "directory", "symlink"].includes(entry.type))
      fail("duplicate or unsupported archive entry");
    if (!Number.isSafeInteger(entry.mode) || entry.mode < 0 || (entry.type !== "symlink" && (entry.mode & 0o022)))
      fail(`writable package entry: ${name}`);
    if (installed && (entry.uid !== 0 || entry.gid !== 0)) fail(`non-root package ownership: ${name}`);
    if (entry.type === "symlink") {
      if (!entry.link || path.posix.isAbsolute(entry.link) || /[\\\x00-\x1f\x7f]/.test(entry.link))
        fail(`unsafe archive link: ${name}`);
      const destination = path.posix.normalize(path.posix.join(path.posix.dirname(name), entry.link));
      if (destination === ".." || destination.startsWith("../")) fail(`escaping archive link: ${name}`);
    }
    seen.set(name, entry);
  }
  for (const name of seen.keys()) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++)
      if (seen.get(parts.slice(0, i).join("/"))?.type === "symlink") fail("archive entry traverses a symlink");
  }
  if (installed) {
    const sandboxPath = `${LINUX_TEST_IDENTITY.installDirectory.slice(1)}/chrome-sandbox`;
    const sandbox = seen.get(sandboxPath);
    if (!sandbox || sandbox.type !== "file" || (sandbox.mode & 0o7777) !== 0o4755)
      fail("chrome-sandbox must be package-owned root:root mode 4755");
    for (const [name, entry] of seen)
      if ((entry.mode & 0o6000) && name !== sandboxPath) fail(`unexpected privileged file: ${name}`);
  }
  return seen;
}

/** Read ELF version-NEED records. Arbitrary strings and version definitions are not requirements. */
export function inspectElf(bytes, { arch, label = "ELF", glibcFloor = "2.35" } = {}) {
  const ensure = (offset, length) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length)
      fail(`${label}: damaged ELF bounds`);
  };
  ensure(0, 64);
  if (bytes.toString("hex", 0, 4) !== "7f454c46" || bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1)
    fail(`${label}: expected ELF64 little-endian`);
  const machine = bytes.readUInt16LE(18);
  if (!(arch in LINUX_MACHINES) || machine !== LINUX_MACHINES[arch]) fail(`${label}: wrong ELF architecture`);
  if (![2, 3].includes(bytes.readUInt16LE(16)) || bytes.readUInt16LE(52) !== 64)
    fail(`${label}: invalid ELF executable/shared library header`);
  const number = (offset) => {
    const value = bytes.readBigUInt64LE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${label}: oversized ELF offset`);
    return Number(value);
  };
  const table = number(40), stride = bytes.readUInt16LE(58), count = bytes.readUInt16LE(60), names = bytes.readUInt16LE(62);
  if (!count || count > 8192 || stride !== 64 || names >= count) fail(`${label}: unsupported/damaged ELF section table`);
  ensure(table, count * stride);
  const sections = Array.from({ length: count }, (_, i) => {
    const start = table + i * stride;
    const section = { name: bytes.readUInt32LE(start), type: bytes.readUInt32LE(start + 4), offset: number(start + 24), size: number(start + 32), link: bytes.readUInt32LE(start + 40) };
    if (section.type !== 8) ensure(section.offset, section.size);
    return section;
  });
  const stringAt = (section, offset) => {
    if (!section || section.type !== 3 || offset >= section.size) fail(`${label}: damaged ELF string reference`);
    const end = bytes.indexOf(0, section.offset + offset);
    if (end < 0 || end >= section.offset + section.size) fail(`${label}: unterminated ELF string`);
    return bytes.toString("utf8", section.offset + offset, end);
  };
  const requirements = new Set();
  for (const section of sections.filter((item) => item.type === 0x6ffffffe)) {
    let cursor = 0, iterations = 0;
    while (true) {
      if (++iterations > 4096 || cursor + 16 > section.size) fail(`${label}: damaged ELF version need`);
      const record = section.offset + cursor, count = bytes.readUInt16LE(record + 2), auxiliary = bytes.readUInt32LE(record + 8), next = bytes.readUInt32LE(record + 12);
      if (bytes.readUInt16LE(record) !== 1 || !count || count > 4096 || auxiliary < 16) fail(`${label}: invalid ELF version need`);
      let auxCursor = cursor + auxiliary;
      for (let i = 0; i < count; i++) {
        if (auxCursor + 16 > section.size) fail(`${label}: damaged ELF version auxiliary`);
        const aux = section.offset + auxCursor;
        requirements.add(stringAt(sections[section.link], bytes.readUInt32LE(aux + 8)));
        const advance = bytes.readUInt32LE(aux + 12);
        if (i + 1 < count && advance < 16) fail(`${label}: invalid ELF version chain`);
        auxCursor += advance;
      }
      if (!next) break;
      if (next < 16) fail(`${label}: cyclic ELF version need`);
      cursor += next;
    }
  }
  const floor = glibcFloor.split(".").map(Number);
  const glibc = [...requirements].filter((name) => name.startsWith("GLIBC_")).sort();
  for (const name of glibc) {
    if (!/^GLIBC_\d+\.\d+(?:\.\d+)?$/.test(name)) fail(`${label}: unsupported GLIBC requirement ${name}`);
    const version = name.slice(6).split(".").map(Number);
    for (let i = 0; i < Math.max(version.length, floor.length); i++) {
      if ((version[i] ?? 0) > (floor[i] ?? 0)) fail(`${label}: ${name} exceeds GLIBC_${glibcFloor}`);
      if ((version[i] ?? 0) < (floor[i] ?? 0)) break;
    }
  }
  const updateSection = sections.find((section) => stringAt(sections[names], section.name) === ".upd_info");
  if (updateSection && bytes.subarray(updateSection.offset, updateSection.offset + updateSection.size).some((byte) => byte !== 0))
    fail(`${label}: embedded AppImage update metadata must be disabled`);
  return { machine, glibcRequirements: glibc, glibcFloor, embeddedUpdateInformation: false };
}

/** ARM64 must use the reviewed static runtime, never the broken libz.so stub. */
export function inspectAppImageRuntime(bytes, { arch }) {
  const result = inspectElf(bytes, { arch, label: "AppImage runtime" });
  if (arch !== "arm64") return result;
  const { size, sha256, toolset } = ARM64_APPIMAGE_RUNTIME;
  if (bytes.length < size || createHash("sha256").update(bytes.subarray(0, size)).digest("hex") !== sha256)
    fail("ARM64 AppImage must use the exact pinned static runtime");
  return { ...result, runtimeToolset: toolset, runtimeSize: size, runtimeSha256: sha256, staticRuntime: true };
}

export function validateDesktopEntry(text, { appImage = false } = {}) {
  if (text.length > 32768 || /[\x00\r]/.test(text)) fail("invalid desktop entry");
  const values = new Map();
  let active = false;
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      if (line !== "[Desktop Entry]" || active || values.size) fail("unexpected desktop entry group");
      active = true; continue;
    }
    if (!active) continue;
    const split = line.indexOf("=");
    if (split < 1) fail("invalid desktop entry field");
    const key = line.slice(0, split), value = line.slice(split + 1);
    if (values.has(key)) fail("duplicate desktop entry field");
    values.set(key, value);
  }
  const expectedExec = appImage ? "AppRun %U" : `${LINUX_TEST_IDENTITY.installDirectory}/${LINUX_TEST_IDENTITY.executable} %u`;
  if (["Actions", "TryExec", "Path", "DBusActivatable", "AutostartCondition", "X-GNOME-Autostart-enabled"].some((key) => values.has(key)))
    fail("unexpected desktop execution or autostart field");
  if (values.get("Type") !== "Application" || values.get("Name") !== LINUX_TEST_IDENTITY.productName ||
      values.get("Exec") !== expectedExec || values.get("Terminal") !== "false" ||
      values.get("Icon") !== LINUX_TEST_IDENTITY.executable || values.get("StartupWMClass") !== LINUX_TEST_IDENTITY.appId ||
      values.get("MimeType") !== "x-scheme-handler/meetspace;" || values.get("Hidden") === "true" || values.get("NoDisplay") === "true")
    fail("desktop identity, URL argument or application metadata mismatch");
  return Object.fromEntries(values);
}
export function validatePackageMetadata(metadata, { arch, format, version }) {
  if (!(arch in LINUX_MACHINES) || !["deb", "rpm"].includes(format)) fail("invalid installed package identity");
  const expectedArch = (format === "deb" ? { x64: "amd64", arm64: "arm64" } : { x64: "x86_64", arm64: "aarch64" })[arch];
  const expectedVersion = version.replaceAll("-", "~");
  if (metadata.name !== LINUX_TEST_IDENTITY.packageName || metadata.arch !== expectedArch || metadata.version !== expectedVersion || metadata.release !== "1")
    fail("package name, version, release or architecture mismatch");
  const dependencies = metadata.dependencies;
  if (!Array.isArray(dependencies) || dependencies.length < 5 || dependencies.some((item) => typeof item !== "string" || /[\x00-\x1f]/.test(item)))
    fail("missing package dependency metadata");
  const joined = dependencies.join("\n");
  for (const requirement of format === "deb" ? [/libnss3/, /libgtk-3-0/, /libasound2/, /libgbm1/, /libxss1/] : [/libnss3\.so|nss/, /libgtk-3\.so|gtk3/, /libasound\.so|alsa-lib/, /libgbm\.so|mesa-libgbm/, /libXss\.so|libXScrnSaver/])
    if (!requirement.test(joined)) fail("required Electron OS dependency missing");
  return metadata;
}
/** Control archives are a separate root-code boundary from the application payload. */
export function validateDebControlEntries(entries) {
  const allowed = new Set(["control", "md5sums", "postinst", "postrm", "conffiles"]), seen = new Map();
  let rootSeen = false;
  for (const entry of entries) {
    const name = archivePath(entry.path);
    if (!name && entry.type === "directory" && !rootSeen) { rootSeen = true; continue; }
    if (!allowed.has(name) || seen.has(name) || entry.type !== "file" || entry.uid !== 0 || entry.gid !== 0 ||
        !Number.isSafeInteger(entry.mode) || (entry.mode & 0o6022) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 16 * 1024 * 1024)
      fail("unreviewed or unsafe DEB control member");
    if (name === "conffiles" && entry.size !== 0) fail("DEB conffiles must be empty");
    if (["postinst", "postrm"].includes(name)) {
      if ((entry.mode & 0o7777) !== 0o755 || !entry.size || entry.size > 32768) fail("DEB maintainer script mode/size mismatch");
    } else if (entry.mode & 0o111) fail("DEB control metadata must not be executable");
    seen.set(name, entry);
  }
  for (const name of ["control", "postinst", "postrm"]) if (!seen.has(name)) fail(`required DEB control member missing: ${name}`);
  return seen;
}
export const RPM_FORBIDDEN_SCRIPT_TAGS = Object.freeze([
  "PREIN", "PREUN", "PRETRANS", "POSTTRANS", "VERIFYSCRIPT", "TRIGGERSCRIPTS", "FILETRIGGERSCRIPTS", "TRANSFILETRIGGERSCRIPTS",
]);
export function validateRpmScriptInventory(unexpectedTags) {
  if (!Array.isArray(unexpectedTags) || unexpectedTags.length) fail("unreviewed RPM maintainer script or trigger");
  return true;
}
export async function validateArtifactDirectory(directory) {
  if (!path.isAbsolute(directory)) fail("artifact directory must be absolute");
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory || (info.mode & 0o022))
    fail("artifact directory must be an ordinary owned non-writable directory without symlinks");
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) fail("artifact directory ownership mismatch");
  return directory;
}
/** Exclusive creation: a verifier must never replace an earlier receipt or follow a link. */
export async function writeNewReceipt(filename, value) {
  const handle = await open(filename, "wx", 0o600);
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
}
