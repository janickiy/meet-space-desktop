// Static inspection only: no package scripts, AppRun, AppImage runtime or Electron
// payload is executed. Tools are fixed system readers; extraction is private.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { open, readFile, lstat, readlink, readdir, mkdtemp, mkdir, rm, symlink, realpath } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import path from "node:path";
import os from "node:os";
import runtimePolicy from "./runtime-policy.cjs";
import { sourceInputs } from "./ci/source-inputs.mjs";
import { LINUX_TEST_IDENTITY as identity, artifactFilename, archivePath, inspectElf, inspectAppImageRuntime, validateArchiveEntries,
  validateArtifactDirectory, validateDesktopEntry, validateLinuxTarget, validatePackageMetadata, validateDebControlEntries,
  RPM_FORBIDDEN_SCRIPT_TAGS, validateRpmScriptInventory, electronNoticeReference, writeNewReceipt } from "./linux-package-policy.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const digest = (bytes, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding);
const fail = (message) => { throw new Error(`Linux artifact verification: ${message}`); };
const cleanEnvironment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", HOME: "/nonexistent/meetspace-verifier" };
const maximumArchive = 1536 * 1024 * 1024;
async function tool(name, args, output) {
  if (!["dpkg-deb", "rpm", "rpm2cpio", "unsquashfs"].includes(name)) fail("unapproved reader");
  const executable = `/usr/bin/${name}`, info = await lstat(await realpath(executable));
  if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022)) fail(`untrusted system reader: ${name}`);
  const child = spawn(executable, args, { env: cleanEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  let bytes = 0, stderr = "", stderrBytes = 0;
  const chunks = [];
  const limiter = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    if (bytes > (output ? maximumArchive : 16 * 1024 * 1024)) return callback(new Error("reader output limit exceeded"));
    callback(null, chunk);
  } });
  const timer = setTimeout(() => child.kill("SIGKILL"), 180000);
  timer.unref();
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= 65536) stderr += chunk.toString("utf8");
    else child.kill("SIGKILL");
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status, signal) => status === 0 ? resolve() : reject(new Error(`${name} failed (${status ?? signal}): ${stderr.slice(0, 2000)}`)));
  });
  try {
    const consumer = output ? createWriteStream(output, { flags: "wx", mode: 0o600 }) : new Transform({ transform(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
    await Promise.all([done, pipeline(child.stdout, limiter, consumer)]);
    return output ? "" : Buffer.concat(chunks).toString("utf8");
  } catch (error) { child.kill("SIGKILL"); throw error; }
  finally { clearTimeout(timer); }
}
const readAt = async (handle, offset, length) => {
  const bytes = Buffer.alloc(length), { bytesRead } = await handle.read(bytes, 0, length, offset);
  if (bytesRead !== length) fail("truncated package archive");
  return bytes;
};
const zeroString = (bytes) => bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0)).toString("utf8");
function octal(bytes) {
  const value = zeroString(bytes).trim();
  if (!/^[0-7]+$/.test(value)) fail("invalid tar number");
  const result = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(result)) fail("oversized tar number");
  return result;
}
function pax(bytes) {
  const result = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset), size = Number(bytes.toString("ascii", offset, space));
    if (space < offset || !Number.isInteger(size) || size <= space - offset + 2 || offset + size > bytes.length) fail("damaged PAX record");
    const field = bytes.toString("utf8", space + 1, offset + size - 1), equal = field.indexOf("=");
    if (equal < 1 || bytes[offset + size - 1] !== 10) fail("damaged PAX field");
    result[field.slice(0, equal)] = field.slice(equal + 1);
    offset += size;
  }
  return result;
}
/** Parse before writing, retaining ownership/mode from the archive rather than extraction uid. */
export async function readTarEntries(filename) {
  const handle = await open(filename), entries = [];
  try {
    const length = (await handle.stat()).size;
    let offset = 0, extra = {}, longName, longLink, terminated = false;
    while (offset + 512 <= length) {
      const header = await readAt(handle, offset, 512);
      if (header.every((byte) => byte === 0)) {
        if (offset + 1024 > length || !(await readAt(handle, offset + 512, 512)).every((byte) => byte === 0)) fail("missing tar end marker");
        terminated = true; break;
      }
      let checksum = 0;
      for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
      if (checksum !== octal(header.subarray(148, 156))) fail("tar checksum mismatch");
      const size = octal(header.subarray(124, 136)), type = String.fromCharCode(header[156] || 48), dataOffset = offset + 512;
      if (dataOffset + size > length || entries.length > 100000) fail("damaged/oversized tar archive");
      if (["x", "L", "K"].includes(type)) {
        if (size > 65536) fail("oversized tar extension");
        const bytes = await readAt(handle, dataOffset, size);
        if (type === "x") extra = pax(bytes);
        else if (type === "L") longName = zeroString(bytes).replace(/\n$/, "");
        else longLink = zeroString(bytes).replace(/\n$/, "");
      } else {
        if (!["0", "5", "2"].includes(type)) fail(`unsupported tar member type ${type}`);
        const prefix = zeroString(header.subarray(345, 500)), name = zeroString(header.subarray(0, 100));
        const entry = { path: archivePath(extra.path ?? longName ?? (prefix ? `${prefix}/${name}` : name)),
          type: { 0: "file", 5: "directory", 2: "symlink" }[type], size, offset: dataOffset,
          mode: octal(header.subarray(100, 108)), uid: octal(header.subarray(108, 116)), gid: octal(header.subarray(116, 124)),
          ...(type === "2" ? { link: extra.linkpath ?? longLink ?? zeroString(header.subarray(157, 257)) } : {}) };
        if (extra.size && Number(extra.size) !== size) fail("PAX size mismatch");
        entries.push(entry); extra = {}; longName = undefined; longLink = undefined;
      }
      offset = dataOffset + Math.ceil(size / 512) * 512;
    }
    if (!terminated || !entries.length) fail("empty or unterminated tar payload");
    return entries;
  } finally { await handle.close(); }
}
export async function readCpioEntries(filename) {
  const handle = await open(filename), entries = [];
  try {
    const length = (await handle.stat()).size;
    let offset = 0, terminated = false;
    while (offset + 110 <= length) {
      const header = await readAt(handle, offset, 110);
      if (header.toString("ascii", 0, 6) !== "070701") fail("expected newc RPM payload");
      const field = (index) => {
        const text = header.toString("ascii", 6 + index * 8, 14 + index * 8);
        if (!/^[0-9a-fA-F]{8}$/.test(text)) fail("invalid CPIO field");
        return Number.parseInt(text, 16);
      };
      const namesize = field(11), size = field(6), mode = field(1), nlink = field(4);
      if (!namesize || namesize > 4096 || entries.length > 100000) fail("invalid CPIO name/count");
      const nameBytes = await readAt(handle, offset + 110, namesize);
      if (nameBytes[namesize - 1] !== 0) fail("unterminated CPIO name");
      const name = nameBytes.toString("utf8", 0, namesize - 1);
      if (name === "TRAILER!!!") { terminated = true; break; }
      const dataOffset = Math.ceil((offset + 110 + namesize) / 4) * 4;
      if (dataOffset + size > length) fail("truncated CPIO member");
      const type = ({ 0o100000: "file", 0o040000: "directory", 0o120000: "symlink" })[mode & 0o170000];
      if (!type || (type === "file" && nlink !== 1)) fail("unsupported CPIO type/hardlink");
      const entry = { path: archivePath(name), type, offset: dataOffset, size, mode: mode & 0o7777, uid: field(2), gid: field(3) };
      if (type === "symlink") {
        if (size > 4096) fail("oversized CPIO link");
        entry.link = (await readAt(handle, dataOffset, size)).toString("utf8");
      }
      entries.push(entry);
      offset = Math.ceil((dataOffset + size) / 4) * 4;
    }
    if (!terminated || !entries.length) fail("empty or unterminated CPIO payload");
    return entries;
  } finally { await handle.close(); }
}
async function extractEntries(archive, entries, directory) {
  validateArchiveEntries(entries);
  await mkdir(directory, { mode: 0o700 });
  for (const entry of entries) {
    if (!entry.path) continue;
    const filename = path.join(directory, entry.path);
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    if (entry.type === "directory") await mkdir(filename, { recursive: true, mode: 0o700 });
    else if (entry.type === "file") {
      if (entry.size) await pipeline(createReadStream(archive, { start: entry.offset, end: entry.offset + entry.size - 1 }), createWriteStream(filename, { flags: "wx", mode: 0o600 }));
      else { const handle = await open(filename, "wx", 0o600); await handle.close(); }
    }
  }
  // Links are created last; no regular file can traverse one during extraction.
  for (const entry of entries.filter((item) => item.type === "symlink")) await symlink(entry.link, path.join(directory, entry.path));
}
async function filesUnder(directory, prefix = "", inspectionRoot = directory) {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name, filename = path.join(directory, item.name);
    if (!item.isSymbolicLink() && ((await lstat(filename)).mode & 0o022)) fail("writable extracted payload entry");
    if (item.isDirectory()) entries.push(...await filesUnder(filename, relative, inspectionRoot));
    else if (item.isFile()) entries.push(relative);
    else if (item.isSymbolicLink()) {
      const target = await realpath(filename);
      if (!target.startsWith(`${await realpath(inspectionRoot)}${path.sep}`)) fail("extracted link leaves private inspection directory");
    } else fail("unsupported extracted file");
  }
  return entries.sort();
}
async function inspectPayload(directory, { arch, inputs, version, appImage }) {
  const { extractFile, listPackage, statFile } = require("@electron/asar");
  const files = await filesUnder(directory), archives = files.filter((file) => file.endsWith("/resources/app.asar") || file === "resources/app.asar");
  if (archives.length !== 1) fail("one embedded app.asar is required");
  const appRoot = path.dirname(path.dirname(archives[0])), root = path.join(directory, appRoot), asar = path.join(root, "resources/app.asar");
  if (!appImage && appRoot !== identity.installDirectory.slice(1)) fail("unexpected installation directory");
  const native = [];
  for (const relative of await filesUnder(root)) {
    const filename = path.join(root, relative), handle = await open(filename);
    let magic;
    try { magic = await readAt(handle, 0, Math.min(4, (await handle.stat()).size)); } finally { await handle.close(); }
    if (magic.toString("hex") === "7f454c46") {
      const bytes = await readFile(filename), appImageSupportLibrary = appImage && relative.startsWith("usr/lib/");
      if (!appImageSupportLibrary) {
        const expected = await readFile(path.join(desktop, "node_modules/electron/dist", relative === identity.executable ? "electron" : relative));
        if (digest(bytes) !== digest(expected)) fail(`ELF differs from pinned local Electron runtime: ${relative}`);
      }
      native.push({ file: relative, ...inspectElf(bytes, { arch, label: relative }), sha256: digest(bytes),
        origin: appImageSupportLibrary ? "electron-builder AppImage support library; architecture/GLIBC/hash inspected" : "exact pinned local Electron bytes" });
    }
    if (/\.node$/i.test(relative) || /(?:^|\/)(?:app-update\.ya?ml|latest[^/]*\.ya?ml|dev-app-update\.ya?ml)$/.test(relative)) fail("native addon or update feed leaked into payload");
  }
  if (!native.some((file) => file.file === identity.executable) || !native.some((file) => file.file === "chrome-sandbox") || native.length < 5) fail("required Electron ELF payload is missing");
  const packagedFiles = listPackage(asar).map((file) => file.replaceAll("\\", "/"));
  for (const entry of packagedFiles) {
    if (/^\/(?:src|tests)(?:\/|$)/.test(entry) || /\.node$/i.test(entry) || (entry.startsWith("/node_modules/") && !runtimePolicy.runtimePackages.some((name) => entry === `/node_modules/${name}` || entry.startsWith(`/node_modules/${name}/`)))) fail("unapproved source, test, native module or dependency in ASAR");
    const file = entry.slice(1), info = statFile(asar, file);
    if (info.files) continue;
    if (info.link || info.unpacked) fail("ASAR link or unpacked application code is not allowed");
    if (file !== "package.json" && !/^(?:dist|renderer|resources|node_modules)\//.test(file)) fail("unexpected ASAR root file");
    if (/^(?:dist|renderer|resources)\//.test(file) && digest(extractFile(asar, file)) !== digest(await readFile(path.join(desktop, file)))) fail(`ASAR differs from exact compiled build: ${file}`);
    if (file.startsWith("node_modules/") && !file.endsWith("/package.json") && digest(extractFile(asar, file)) !== digest(await readFile(path.join(desktop, file)))) fail(`runtime package bytes changed: ${file}`);
  }
  for (const required of ["dist/entry.js", "dist/main.js", "dist/preload.js", "dist/build-provenance.json", "dist/source-inputs.json", "dist/update-trust.json", "renderer/index.html", "renderer/version.json", "resources/icon.png", "resources/TEST-BUILD.txt", "node_modules/ssh2/lib/protocol/crypto/poly1305.js"])
    if (!packagedFiles.includes(`/${required}`)) fail(`missing application file: ${required}`);
  for (const directory of ["dist", "renderer", "resources/server-installer"]) {
    for (const relative of await filesUnder(path.join(desktop, directory))) {
      if (directory === "dist" && !relative.endsWith(".js") && !["build-provenance.json", "source-inputs.json", "update-trust.json"].includes(relative)) continue;
      if (!packagedFiles.includes(`/${directory}/${relative}`)) fail(`compiled build file omitted from ASAR: ${directory}/${relative}`);
    }
  }
  const json = (file) => JSON.parse(extractFile(asar, file).toString("utf8"));
  if (JSON.stringify(json("dist/update-trust.json")) !== JSON.stringify({ enabled: false })) fail("test build update trust must be disabled");
  if (JSON.stringify(json("dist/source-inputs.json")) !== JSON.stringify(inputs)) fail("packaged source snapshot differs from frozen manifest");
  const provenance = json("dist/build-provenance.json"), renderer = json("renderer/version.json"), metadata = json("package.json");
  if (provenance.releaseMode !== "test" || provenance.appId !== identity.appId || provenance.sourceTreeSha256 !== inputs.sourceTreeSha256 || provenance.sourceCommit !== inputs.sourceCommit || provenance.sourceDirty !== inputs.sourceDirty || provenance.buildVersion !== `${version}-test` || provenance.buildHostPlatform !== "linux" || provenance.buildHostArch !== arch || renderer.version !== provenance.buildVersion || metadata.version !== version || metadata.main !== "dist/entry.js" || metadata.productName !== identity.productName) fail("embedded provenance or build identity mismatch");
  const pkg = JSON.parse(await readFile(path.join(desktop, "package.json"), "utf8")), lock = JSON.parse(await readFile(path.join(desktop, "package-lock.json"), "utf8"));
  if (JSON.stringify(metadata.dependencies) !== JSON.stringify(pkg.dependencies)) fail("runtime dependency declarations changed");
  for (const name of runtimePolicy.runtimePackages) {
    const actual = json(`node_modules/${name}/package.json`), local = JSON.parse(await readFile(path.join(desktop, `node_modules/${name}/package.json`), "utf8"));
    if (actual.version !== lock.packages[`node_modules/${name}`].version) fail(`runtime dependency version changed: ${name}`);
    for (const field of ["name", "main", "type", "exports", "imports", "browser", "dependencies", "optionalDependencies"])
      if (JSON.stringify(actual[field]) !== JSON.stringify(local[field])) fail(`runtime resolution metadata changed: ${name}/${field}`);
  }
  const licenses = [];
  for (const file of ["THIRD_PARTY_NOTICES.txt", "third-party-licenses.json", "APP-LICENSE.txt", "TEST-LICENSE.txt"]) {
    const bytes = await readFile(path.join(root, "resources", file));
    if (!bytes.length || digest(bytes) !== digest(await readFile(path.join(desktop, "resources", file)))) fail(`missing or changed bundled notice: ${file}`);
    licenses.push({ file, bytes: bytes.length, sha256: digest(bytes) });
  }
  const licenseMetadata = JSON.parse(await readFile(path.join(root, "resources/third-party-licenses.json"), "utf8"));
  if (licenseMetadata.noticesSha256 !== licenses.find((item) => item.file === "THIRD_PARTY_NOTICES.txt").sha256 || licenseMetadata.lockfiles.desktop !== digest(await readFile(path.join(desktop, "package-lock.json"))) || licenseMetadata.lockfiles.frontend !== digest(await readFile(path.join(desktop, "../frontend/package-lock.json")))) fail("license metadata does not match frozen lockfiles");
  for (const file of ["LICENSE.electron.txt", "LICENSES.chromium.html"]) {
    const bytes = await readFile(path.join(root, file));
    if (bytes.length < 100 || digest(bytes) !== digest(await readFile(path.join(desktop, "node_modules/electron/dist", electronNoticeReference(file))))) fail(`missing or changed Electron notice: ${file}`);
    licenses.push({ file, bytes: bytes.length, sha256: digest(bytes) });
  }
  const desktopPath = appImage ? files.find((file) => file === identity.desktopName) : `usr/share/applications/${identity.desktopName}`;
  if (!desktopPath) fail("desktop entry is missing");
  const desktopEntry = validateDesktopEntry(await readFile(path.join(directory, desktopPath), "utf8"), { appImage });
  const iconFiles = files.filter((file) => new RegExp(`^usr/share/icons/hicolor/[0-9]+x[0-9]+/apps/${identity.executable}\\.png$`).test(file));
  if (!iconFiles.length) fail("desktop application icon is missing");
  const sourceIcon = await readFile(path.join(desktop, "resources/icon.png")), sourceIconSha256 = digest(sourceIcon);
  const icons = [];
  for (const file of iconFiles) {
    const bytes = await readFile(path.join(directory, file));
    if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") fail("invalid packaged PNG icon");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || width !== height || width > 1024 || !file.includes(`/${width}x${height}/`)) fail("PNG icon dimensions disagree with hicolor directory");
    icons.push({ file, width, height, sha256: digest(bytes) });
  }
  const largestIcon = icons.reduce((largest, icon) => icon.width > largest.width ? icon : largest);
  if (sourceIcon.length < 24 || sourceIcon.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
      largestIcon.width !== sourceIcon.readUInt32BE(16) || largestIcon.height !== sourceIcon.readUInt32BE(20) || largestIcon.sha256 !== sourceIconSha256)
    fail("largest hicolor icon differs from the exact reviewed source PNG");
  const iconLinks = [];
  if (appImage) {
    const largest = Math.max(...icons.map((item) => item.width));
    for (const file of [`${identity.executable}.png`, ".DirIcon"]) {
      const filename = path.join(directory, file), linkInfo = await lstat(filename), target = await readlink(filename);
      if (!linkInfo.isSymbolicLink() || path.isAbsolute(target) || /[\\\x00-\x1f\x7f]/.test(target)) fail("AppImage icon must be a contained relative link");
      const relative = path.relative(directory, await realpath(filename)).split(path.sep).join("/"), original = icons.find((icon) => icon.file === relative && icon.width === largest);
      if (!original || !(await lstat(path.join(directory, relative))).isFile() || digest(await readFile(filename)) !== original.sha256) fail("AppImage icon link does not resolve to the known largest packaged PNG");
      iconLinks.push({ file, target, original: relative, sha256: original.sha256 });
    }
  }
  if (appImage && digest(await readFile(path.join(directory, "AppRun"))) !== digest(await readFile(path.join(desktop, "resources/linux/AppRun.sh")))) fail("AppImage launcher differs from reviewed sandbox-preserving script");
  return { appAsarSha256: digest(await readFile(asar)), native, provenance, desktopEntry, icons, iconLinks,
    sourceIconSha256, licenses,
    updateTrust: { enabled: false }, runtimePackages: [...runtimePolicy.runtimePackages], appImageLauncherVerified: appImage };
}
async function squashOffset(filename) {
  const handle = await open(filename);
  try {
    const length = (await handle.stat()).size;
    let carry = Buffer.alloc(0), found;
    for (let position = 0; position < length; position += 1048576) {
      const bytes = Buffer.concat([carry, await readAt(handle, position, Math.min(1048576, length - position))]);
      let cursor = -1;
      while ((cursor = bytes.indexOf("hsqs", cursor + 1, "ascii")) >= 0) {
        const absolute = position - carry.length + cursor;
        if (absolute + 96 > length) continue;
        const block = await readAt(handle, absolute, 96), blockSize = block.readUInt32LE(12), used = block.readBigUInt64LE(40);
        if (block.readUInt16LE(28) === 4 && blockSize >= 4096 && blockSize <= 1048576 && (blockSize & (blockSize - 1)) === 0 && used > 96n && used <= BigInt(length - absolute)) {
          if (found !== undefined) fail("multiple SquashFS filesystem candidates");
          found = absolute;
        }
      }
      carry = bytes.subarray(Math.max(0, bytes.length - 3));
    }
    if (found === undefined) fail("AppImage SquashFS payload is missing");
    return found;
  } finally { await handle.close(); }
}
async function verifyOne(filename, { format, arch, version, inputs, temporary }) {
  const file = path.basename(filename), info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1024 || info.size > 768 * 1024 * 1024 || (info.mode & 0o022) || info.uid !== process.getuid()) fail("artifact must be an owned ordinary non-writable bounded file");
  const originalDigest = digest(await readFile(filename));
  const expanded = path.join(temporary, format), raw = path.join(temporary, `${format}.payload`);
  let metadata, entries, outerElf;
  if (format === "deb") {
    const output = await tool("dpkg-deb", ["--field", filename, "Package", "Version", "Architecture", "Depends"]);
    const fields = Object.fromEntries(output.trim().split("\n").map((line) => { const split = line.indexOf(": "); return [line.slice(0, split), line.slice(split + 2)]; }));
    metadata = validatePackageMetadata({ name: fields.Package, version: fields.Version, release: "1", arch: fields.Architecture, dependencies: fields.Depends?.split(/,\s*/) }, { arch, format, version });
    await tool("dpkg-deb", ["--fsys-tarfile", filename], raw);
    entries = await readTarEntries(raw);
    await extractEntries(raw, entries, expanded);
    const control = path.join(temporary, "control.tar");
    await tool("dpkg-deb", ["--ctrl-tarfile", filename], control);
    const controls = validateDebControlEntries(await readTarEntries(control)), handle = await open(control);
    try {
      for (const [packaged, source] of [["postinst", "after-install.sh"], ["postrm", "after-remove.sh"]]) {
        const entry = controls.get(packaged);
        if (!entry || entry.size > 32768 || digest(await readAt(handle, entry.offset, entry.size)) !== digest(await readFile(path.join(desktop, "resources/linux", source)))) fail(`maintainer script differs from reviewed source: ${packaged}`);
      }
    } finally { await handle.close(); }
  } else if (format === "rpm") {
    const values = (await tool("rpm", ["--query", "--package", "--queryformat", "%{NAME}\n%{VERSION}\n%{RELEASE}\n%{ARCH}\n", filename])).trim().split("\n");
    const dependencies = (await tool("rpm", ["--query", "--package", "--requires", filename])).trim().split("\n");
    metadata = validatePackageMetadata({ name: values[0], version: values[1], release: values[2], arch: values[3], dependencies }, { arch, format, version });
    for (const [tag, source] of [["POSTIN", "after-install.sh"], ["POSTUN", "after-remove.sh"]]) {
      const actual = await tool("rpm", ["--query", "--package", "--queryformat", `%{${tag}}`, filename]);
      if (actual.trim() !== (await readFile(path.join(desktop, "resources/linux", source), "utf8")).trim()) fail(`RPM script differs from reviewed source: ${tag}`);
    }
    // Presence conditionals reject even an empty script body or trigger array.
    const scriptQuery = RPM_FORBIDDEN_SCRIPT_TAGS.map((tag) => `%|${tag}?{${tag}\n}:{}|`).join("");
    const otherScripts = await tool("rpm", ["--query", "--package", "--queryformat", scriptQuery, filename]);
    validateRpmScriptInventory(otherScripts.split("\n").filter(Boolean));
    await tool("rpm2cpio", [filename], raw);
    entries = await readCpioEntries(raw);
    await extractEntries(raw, entries, expanded);
  } else {
    const bytes = await readFile(filename);
    if (bytes.toString("hex", 8, 11) !== "414902") fail("expected type 2 AppImage");
    outerElf = inspectAppImageRuntime(bytes, { arch });
    const offset = await squashOffset(filename);
    await tool("unsquashfs", ["-no-progress", "-no-xattrs", "-dest", expanded, "-offset", String(offset), filename]);
    metadata = { format: "AppImage", squashfsOffset: offset, fuseRuntimeRequirement: "NOT RUN: launch/FUSE/fallback must be tested on target desktop" };
  }
  const payload = await inspectPayload(expanded, { arch, inputs, version, appImage: format === "AppImage" });
  // Native read-only tools do not alter package bytes. Reopen after inspection.
  const bytes = await readFile(filename);
  const finalInfo = await lstat(filename);
  if (digest(bytes) !== originalDigest || finalInfo.ino !== info.ino || finalInfo.dev !== info.dev || finalInfo.size !== info.size || finalInfo.mtimeMs !== info.mtimeMs) fail("artifact changed during inspection");
  return { file, format, arch, version, size: bytes.length, sha256: digest(bytes), sha512: digest(bytes, "sha512", "base64"),
    sha512Hex: digest(bytes, "sha512"), metadata, ...(outerElf ? { outerElf } : {}), ...(entries ? { archiveMetadata: { entries: entries.length, ownershipVerified: "root:root", sandboxMode: "4755" } } : {}), ...payload };
}
export async function verifyLinuxArtifacts({ directory, arch, formats, sourceSha256, manifest }) {
  validateLinuxTarget({ arch, formats });
  await validateArtifactDirectory(directory);
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || !path.isAbsolute(manifest)) fail("explicit source SHA256 and absolute frozen manifest are required");
  const inputs = JSON.parse(await readFile(manifest, "utf8")), current = await sourceInputs(path.resolve(desktop, ".."));
  if (inputs.sourceTreeSha256 !== sourceSha256 || JSON.stringify(inputs) !== JSON.stringify(current) || digest(JSON.stringify(inputs.files)) !== sourceSha256) fail("source checkout differs from exact frozen manifest");
  const pkg = JSON.parse(await readFile(path.join(desktop, "package.json"), "utf8"));
  const names = formats.map((format) => artifactFilename({ version: pkg.version, arch, format }));
  for (const name of ["linux-artifact-verification.json", ...names.flatMap((name) => [`${name}.sha256`, `${name}.sha512`])]) {
    try { await lstat(path.join(directory, name)); fail("verification receipts already exist; refusing overwrite"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "meetspace-linux-artifact-check-"));
  try {
    const artifacts = [];
    for (let i = 0; i < formats.length; i++) artifacts.push(await verifyOne(path.join(directory, names[i]), { format: formats[i], arch, version: pkg.version, inputs, temporary }));
    if (JSON.stringify(await sourceInputs(path.resolve(desktop, ".."))) !== JSON.stringify(inputs)) fail("source checkout changed during inspection");
    const report = { schemaVersion: 1, result: "PASS", scope: "static artifact inspection; no installer, launcher or desktop runtime execution", releaseMode: "test", version: pkg.version, appId: identity.appId,
      sourceCommit: inputs.sourceCommit, sourceDirty: inputs.sourceDirty, sourceTreeSha256: sourceSha256, verifiedAt: new Date().toISOString(), verifierHost: { platform: process.platform, arch: process.arch, node: process.version, osRelease: os.release() },
      limitations: ["unsigned internal test packages", "updates disabled", "static ELF GLIBC need records <=2.35 do not establish full distribution compatibility", "package installation, login/autostart, protocol associations, AppImage FUSE and desktop acceptance require separate runtime evidence"], artifacts };
    for (const artifact of artifacts) {
      await writeNewReceipt(path.join(directory, `${artifact.file}.sha256`), `${artifact.sha256}  ${artifact.file}\n`);
      await writeNewReceipt(path.join(directory, `${artifact.file}.sha512`), `${artifact.sha512Hex}  ${artifact.file}\n`);
    }
    await writeNewReceipt(path.join(directory, "linux-artifact-verification.json"), JSON.stringify(report, null, 2) + "\n");
    return report;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = {}, allowed = ["--directory", "--arch", "--formats", "--source-sha256", "--manifest"], args = process.argv.slice(2);
  if (args.length !== allowed.length * 2) fail("Usage: verify-linux-artifacts.mjs --directory absolute-staging-dir --arch x64|arm64 --formats deb,rpm,AppImage --source-sha256 64hex --manifest absolute-source-inputs.json");
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || values[args[i]] || !args[i + 1]) fail("invalid or duplicate verifier option");
    values[args[i]] = args[i + 1];
  }
  const report = await verifyLinuxArtifacts({ directory: values["--directory"], arch: values["--arch"], formats: values["--formats"].split(","), sourceSha256: values["--source-sha256"], manifest: values["--manifest"] });
  console.log(JSON.stringify({ result: report.result, sourceTreeSha256: report.sourceTreeSha256, artifacts: report.artifacts.map(({ file, size, sha256 }) => ({ file, size, sha256 })) }));
}
