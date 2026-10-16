import {
  readFile,
  writeFile,
  stat,
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import {
  validateReleaseConfig,
  releaseConfigSha256,
} from "./release-policy.mjs";
import { sourceInputs } from "./ci/source-inputs.mjs";
import { readBuilderEvidence } from "./prepare-builder.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(
  await readFile(path.join(desktop, "package.json"), "utf8"),
);
const args = process.argv.slice(2);
if (
  (args.length > 0 && !["x64", "arm64"].includes(args[0])) ||
  ![0, 1, 3].includes(args.length) ||
  (args.length === 3 && args[1] !== "--signed")
) {
  throw new Error(
    "Usage: verify-artifacts.mjs [x64|arm64] [--signed absolute-release-config.json]",
  );
}
const architectures = args[0] ? [args[0]] : ["x64", "arm64"];
const signed = args.length === 3;
if (
  signed &&
  (process.platform !== "win32" ||
    process.arch !== architectures[0] ||
    !path.isAbsolute(args[2]))
)
  throw new Error(
    "Signed verification requires a native Windows process and an absolute reviewed configuration",
  );
const config = signed
  ? validateReleaseConfig(JSON.parse(await readFile(args[2], "utf8")))
  : null;
const releaseMode = signed ? "release" : "test";
const inputs = await sourceInputs(path.resolve(desktop, ".."), signed);
const builderPatch = await readBuilderEvidence();
const machines = { x64: 0x8664, arm64: 0xaa64 };
const require = createRequire(import.meta.url);
const readWindowsSignature = signed
  ? require("../dist/updates-signature.js").readWindowsSignature
  : null;
const { getPath7za } = require("app-builder-lib/out/toolsets/7zip.js");
const {
  extractFile,
  listPackage,
  statFile,
  getRawHeader,
} = require("@electron/asar");
const { getCurrentFuseWire, FuseV1Options } = require("@electron/fuses");
const { NtExecutable, NtExecutableResource } = require("resedit");
const sevenZip = await getPath7za();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const machineOf = (bytes, label) => {
  if (bytes.toString("ascii", 0, 2) !== "MZ")
    throw new Error(`${label}: missing DOS signature`);
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.toString("ascii", pe, pe + 4) !== "PE\0\0")
    throw new Error(`${label}: missing PE signature`);
  return bytes.readUInt16LE(pe + 4);
};
const dllFiles = async (directory, prefix = "") => {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory())
      found.push(
        ...(await dllFiles(path.join(directory, entry.name), relative)),
      );
    else if (entry.name.toLowerCase().endsWith(".dll")) found.push(relative);
  }
  return found.sort();
};
const certificateSize = (bytes) => {
  const optionalHeader = bytes.readUInt32LE(0x3c) + 24;
  const magic = bytes.readUInt16LE(optionalHeader);
  if (![0x10b, 0x20b].includes(magic))
    throw new Error("Unsupported PE optional header");
  const directory = optionalHeader + (magic === 0x20b ? 112 : 96);
  return bytes.readUInt32LE(directory + 4 * 8 + 4);
};
const entries = [];
for (const arch of architectures) {
  if (!(arch in machines))
    throw new Error(`Unsupported Windows architecture: ${arch}`);
  const output = signed
    ? path.join(desktop, "artifacts", "signed", arch)
    : path.join(desktop, "artifacts");
  const unpacked = arch === "x64" ? "win-unpacked" : "win-arm64-unpacked";
  const executable = path.join(output, unpacked, "MeetSpace.exe");
  const bytes = await readFile(executable);
  const machine = machineOf(bytes, executable);
  if (machine !== machines[arch])
    throw new Error(
      `Wrong payload architecture: ${arch} requested, PE machine 0x${machine.toString(16)}`,
    );
  const artifact = `MeetSpace-${pkg.version}-win-${arch}${signed ? "" : "-test"}-setup.exe`;
  const installerPath = path.join(output, artifact);
  const installer = await readFile(installerPath);
  if (installer.toString("ascii", 0, 2) !== "MZ")
    throw new Error(`Invalid installer: ${artifact}`);
  if (!signed && (certificateSize(bytes) || certificateSize(installer))) {
    throw new Error(
      "Unexpected Authenticode certificate in the explicitly unsigned test build",
    );
  }
  // Inspect the embedded application, not the architecture of the NSIS launcher.
  // NSIS itself may be x86 even when the installed Electron application is ARM64.
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "meetspace-installer-check-"),
  );
  let payloadHash;
  let appAsarHash;
  let provenance;
  let signatures;
  let integrity;
  const licenseFiles = [];
  const payloadDlls = [];
  try {
    const archive = `app-${arch === "x64" ? "64" : "arm64"}.7z`;
    const extract = (input, files, output = temporary, mode = "e") => {
      const result = spawnSync(
        sevenZip,
        [mode, input, `-o${output}`, "-y", ...files],
        { encoding: "utf8" },
      );
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(
          `Installer extraction failed: ${result.stderr || result.stdout}`,
        );
    };
    extract(installerPath, [`$PLUGINSDIR/${archive}`]);
    const payloadDirectory = path.join(temporary, "payload");
    extract(
      path.join(temporary, archive),
      [
        "MeetSpace.exe",
        "resources/app.asar",
        "resources/THIRD_PARTY_NOTICES.txt",
        "resources/third-party-licenses.json",
        "resources/APP-LICENSE.txt",
        "resources/TEST-LICENSE.txt",
        "LICENSE.electron.txt",
        "LICENSES.chromium.html",
        "*.dll",
        "-r",
      ],
      payloadDirectory,
      "x",
    );
    const payload = await readFile(
      path.join(payloadDirectory, "MeetSpace.exe"),
    );
    payloadHash = hash(payload);
    if (payloadHash !== hash(bytes))
      throw new Error(
        "Installer payload differs from verified unpacked executable",
      );
    if (machineOf(payload, "Embedded MeetSpace.exe") !== machines[arch])
      throw new Error("Embedded application architecture differs from target");
    if (signed) {
      signatures = {
        installer: await readWindowsSignature(
          installerPath,
          config.updateTrust,
          new AbortController().signal,
        ),
        payload: await readWindowsSignature(
          path.join(payloadDirectory, "MeetSpace.exe"),
          config.updateTrust,
          new AbortController().signal,
        ),
      };
      for (const signature of Object.values(signatures))
        if (
          signature.thumbprint.toUpperCase() !== config.signing.certificateSha1
        )
          throw new Error(
            "Package was not signed with the reviewed release certificate",
          );
    }
    for (const file of ["LICENSE.electron.txt", "LICENSES.chromium.html"]) {
      const packaged = await readFile(path.join(payloadDirectory, file));
      if (
        packaged.length < 100 ||
        hash(packaged) !==
          hash(await readFile(path.join(output, unpacked, file)))
      )
        throw new Error(`Missing or altered embedded Electron notice: ${file}`);
      licenseFiles.push({
        file,
        bytes: packaged.length,
        sha256: hash(packaged),
      });
    }
    for (const file of await dllFiles(payloadDirectory)) {
      const dll = await readFile(path.join(payloadDirectory, file));
      const dllMachine = machineOf(dll, file);
      if (dllMachine !== machines[arch])
        throw new Error(`${file}: wrong embedded DLL architecture for ${arch}`);
      payloadDlls.push({
        file: file.replaceAll("\\", "/"),
        machine: `0x${dllMachine.toString(16)}`,
        sha256: hash(dll),
      });
    }
    if (!payloadDlls.length)
      throw new Error(
        "Expected native Electron DLLs are missing from installer payload",
      );
    const appAsar = path.join(payloadDirectory, "resources/app.asar");
    appAsarHash = hash(await readFile(appAsar));
    const unpackedAsar = await readFile(
      path.join(output, unpacked, "resources/app.asar"),
    );
    if (appAsarHash !== hash(unpackedAsar))
      throw new Error("Installer app.asar differs from unpacked application");
    if (signed) {
      const wire = await getCurrentFuseWire(
        path.join(payloadDirectory, "MeetSpace.exe"),
      );
      for (const [option, expected] of [
        ["RunAsNode", 48],
        ["EnableNodeOptionsEnvironmentVariable", 48],
        ["EnableNodeCliInspectArguments", 48],
        ["EnableEmbeddedAsarIntegrityValidation", 49],
        ["OnlyLoadAppFromAsar", 49],
      ]) {
        if (wire.version !== "1" || wire[FuseV1Options[option]] !== expected)
          throw new Error(`Signed Electron fuse policy mismatch: ${option}`);
      }
      const resource = NtExecutableResource.from(
        NtExecutable.from(payload, { ignoreCert: true }),
      );
      const entries = resource.entries.filter(
        (entry) => entry.type === "INTEGRITY" && entry.id === "ELECTRONASAR",
      );
      if (entries.length !== 1)
        throw new Error(
          "Signed executable must contain one ASAR integrity resource",
        );
      const records = JSON.parse(Buffer.from(entries[0].bin).toString("utf8"));
      const headerSha256 = hash(getRawHeader(appAsar).headerString);
      if (
        !Array.isArray(records) ||
        records.length !== 1 ||
        records[0].file !== "resources\\app.asar" ||
        records[0].alg !== "SHA256" ||
        records[0].value !== headerSha256
      )
        throw new Error(
          "Signed executable does not authenticate the embedded ASAR header",
        );
      integrity = {
        embeddedResourceVerified: true,
        algorithm: "SHA256",
        headerSha256,
        fuses: {
          runAsNode: false,
          nodeOptions: false,
          inspect: false,
          asarIntegrity: true,
          onlyLoadAsar: true,
        },
      };
    }
    const packagedFiles = listPackage(appAsar).map((file) =>
      file.replaceAll("\\", "/"),
    );
    if (
      packagedFiles.some(
        (file) =>
          /^\/(tests|src)(\/|$)/.test(file) ||
          /\.node$/i.test(file) ||
          (file.startsWith("/node_modules/") &&
            !/^\/node_modules\/ws(\/|$)/.test(file)),
      )
    ) {
      throw new Error(
        "Development files, unapproved dependencies or native addons leaked into packaged app.asar",
      );
    }
    for (const required of [
      "/dist/main.js",
      "/dist/preload.js",
      "/dist/build-provenance.json",
      "/dist/source-inputs.json",
      "/dist/update-trust.json",
      "/renderer/index.html",
      "/renderer/version.json",
    ]) {
      if (!packagedFiles.includes(required))
        throw new Error(`Required package file missing: ${required}`);
    }
    if (packagedFiles.includes("/dist/acceptance.js") !== !signed)
      throw new Error(
        "Test-only Windows diagnostic hook does not match package mode",
      );
    if (signed && packagedFiles.includes("/resources/TEST-BUILD.txt"))
      throw new Error("Unsigned test notice leaked into a production package");
    if (!signed && !packagedFiles.includes("/resources/TEST-BUILD.txt"))
      throw new Error("Unsigned test package notice is missing");
    const packagedTrust = JSON.parse(
      extractFile(appAsar, "dist/update-trust.json").toString("utf8"),
    );
    if (
      JSON.stringify(packagedTrust) !==
      JSON.stringify(config?.updateTrust ?? { enabled: false })
    )
      throw new Error("Packaged update trust differs from reviewed build mode");
    const packagedInputs = JSON.parse(
      extractFile(appAsar, "dist/source-inputs.json").toString("utf8"),
    );
    if (JSON.stringify(packagedInputs) !== JSON.stringify(inputs))
      throw new Error(
        "Installer does not contain the exact current frozen source inputs",
      );
    // electron-builder places extraResources beside app.asar and deliberately
    // excludes their source paths from ASAR, even with an explicit files entry.
    const notices = await readFile(
      path.join(payloadDirectory, "resources/THIRD_PARTY_NOTICES.txt"),
    );
    const licenses = JSON.parse(
      await readFile(
        path.join(payloadDirectory, "resources/third-party-licenses.json"),
        "utf8",
      ),
    );
    if (
      licenses.noticesSha256 !== hash(notices) ||
      licenses.lockfiles?.frontend !==
        hash(
          await readFile(
            path.resolve(desktop, "../frontend/package-lock.json"),
          ),
        ) ||
      licenses.lockfiles?.desktop !==
        hash(await readFile(path.join(desktop, "package-lock.json"))) ||
      !Array.isArray(licenses.components) ||
      licenses.components.length < 1
    )
      throw new Error(
        "Bundled third-party notices do not match frozen dependencies",
      );
    for (const entry of packagedFiles) {
      const file = entry.replace(/^\//, "");
      if (
        !/^(dist|renderer|resources)\//.test(file) ||
        statFile(appAsar, file).files
      )
        continue;
      if (
        hash(extractFile(appAsar, file)) !==
        hash(await readFile(path.join(desktop, file)))
      ) {
        throw new Error(
          `Packaged file differs from the current build: ${file}`,
        );
      }
    }
    for (const file of [
      "THIRD_PARTY_NOTICES.txt",
      "third-party-licenses.json",
      signed ? "APP-LICENSE.txt" : "TEST-LICENSE.txt",
    ]) {
      const actual = await readFile(
        path.join(payloadDirectory, "resources", file),
      );
      if (
        !actual.length ||
        hash(actual) !==
          hash(await readFile(path.join(desktop, "resources", file))) ||
        hash(actual) !==
          hash(await readFile(path.join(output, unpacked, "resources", file)))
      )
        throw new Error(
          `Embedded external license resource differs from reviewed build: ${file}`,
        );
      licenseFiles.push({
        file: `resources/${file}`,
        bytes: actual.length,
        sha256: hash(actual),
      });
    }
    const packagedMetadata = JSON.parse(
      extractFile(appAsar, "package.json").toString("utf8"),
    );
    if (
      packagedMetadata.version !== pkg.version ||
      packagedMetadata.main !== "dist/main.js" ||
      Object.keys(packagedMetadata.dependencies || {}).length !== 1 ||
      packagedMetadata.dependencies.ws !== pkg.dependencies.ws
    ) {
      throw new Error("Unexpected runtime package metadata or dependencies");
    }
    const socketMetadata = JSON.parse(
      extractFile(appAsar, "node_modules/ws/package.json").toString("utf8"),
    );
    if (socketMetadata.version !== pkg.dependencies.ws)
      throw new Error("Unexpected packaged WebSocket dependency version");
    for (const entry of packagedFiles.filter((file) =>
      /^\/node_modules\/ws\/.*\.js$/.test(file),
    )) {
      const file = entry.slice(1);
      if (
        hash(extractFile(appAsar, file)) !==
        hash(await readFile(path.join(desktop, file)))
      ) {
        throw new Error(
          `Packaged WebSocket runtime differs from the pinned local dependency: ${file}`,
        );
      }
    }
    provenance = JSON.parse(
      extractFile(appAsar, "dist/build-provenance.json").toString("utf8"),
    );
    const rendererMetadata = JSON.parse(
      extractFile(appAsar, "renderer/version.json").toString("utf8"),
    );
    if (
      provenance.sourceCommit !== inputs.sourceCommit ||
      provenance.sourceDirty !== inputs.sourceDirty ||
      provenance.sourceTreeSha256 !== inputs.sourceTreeSha256 ||
      JSON.stringify(provenance.builderPatch) !==
        JSON.stringify(builderPatch) ||
      provenance.releaseMode !== releaseMode ||
      provenance.appId !==
        `com.janickiy.meetspace.desktop${signed ? "" : ".test"}` ||
      (signed &&
        (provenance.releaseConfigSha256 !== releaseConfigSha256(config) ||
          provenance.buildHostPlatform !== "win32" ||
          provenance.buildHostArch !== arch)) ||
      provenance.buildVersion !== `${pkg.version}${signed ? "" : "-test"}` ||
      rendererMetadata.version !== provenance.buildVersion ||
      rendererMetadata.commit !== provenance.sourceCommit ||
      rendererMetadata.buildTime !== provenance.buildTime
    ) {
      throw new Error(
        "Renderer and desktop provenance do not identify the same source build",
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const entry = {
    artifact,
    file: `${signed ? arch + "/" : ""}${artifact}`,
    arch,
    sha256: hash(installer),
    sha512: createHash("sha512").update(installer).digest("base64"),
    bytes: (await stat(installerPath)).size,
    size: installer.length,
    payloadMachine: `0x${machine.toString(16)}`,
    payloadSHA256: payloadHash,
    appAsarSHA256: appAsarHash,
    ...provenance,
    platform: "win32",
    requiredOS:
      arch === "x64"
        ? ["Windows 10 22H2 x64 (build 19045)", "Windows 11 x64 (build 22000+)"]
        : ["Windows 11 ARM64 (build 22000+)"],
    payloadDlls,
    licenseFiles,
    embeddedPayloadVerified: true,
    electron: pkg.devDependencies.electron,
    signed,
    ...(signed ? { signatures, integrity } : {}),
    windowsRuntimeTested: false,
  };
  await writeFile(
    path.join(output, `${artifact}.sha256`),
    `${entry.sha256}  ${artifact}\n`,
  );
  await writeFile(
    path.join(output, `${artifact}.json`),
    JSON.stringify(entry, null, 2) + "\n",
  );
  entries.push(entry);
}
console.log(JSON.stringify(entries, null, 2));
