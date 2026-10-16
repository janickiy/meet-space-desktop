// Imported only by the Windows signed-candidate path. No automatic publication.
module.exports = async () => {
  if (
    process.platform !== "win32" ||
    process.env.MEETSPACE_BUILD_MODE !== "release"
  )
    throw new Error("Signed packaging requires Windows release mode");
  const { readReleaseConfig } = await import("./scripts/build-context.mjs");
  const { releaseConfigSha256 } = await import("./scripts/release-policy.mjs");
  const config = await readReleaseConfig(process.env.MEETSPACE_RELEASE_CONFIG);
  const provenance = require("./dist/build-provenance.json");
  if (
    provenance.releaseMode !== "release" ||
    provenance.sourceDirty ||
    provenance.releaseConfigSha256 !== releaseConfigSha256(config)
  )
    throw new Error("Build does not match reviewed signing trust");
  const test = require("./electron-builder.config.cjs");
  const arch = process.env.MEETSPACE_TARGET_ARCH;
  if (!["x64", "arm64"].includes(arch))
    throw new Error("Native architecture must be explicit");
  const signtoolOptions = {
    signingHashAlgorithms: ["sha256"],
    publisherName: config.updateTrust.publisherNames,
    timeStampServer: config.signing.timestampUrl,
    rfc3161TimeStampServer: config.signing.timestampUrl,
    ...(config.signing.mode === "store"
      ? { certificateSha1: config.signing.certificateSha1 }
      : {}),
  };
  return {
    ...test,
    appId: "com.janickiy.meetspace.desktop",
    productName: "MeetSpace",
    extraMetadata: { description: "MeetSpace desktop for Windows" },
    directories: { ...test.directories, output: `artifacts/signed/${arch}` },
    artifactName: "MeetSpace-${version}-win-${arch}-setup.${ext}",
    files: test.files.filter((file) => !file.includes("TEST-BUILD")),
    extraResources: test.extraResources.filter(
      (item) => !item.from.includes("TEST-LICENSE"),
    ),
    forceCodeSigning: true,
    publish: null,
    electronFuses: {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    },
    afterSign: "./scripts/normalize-package.cjs",
    win: { ...test.win, signExecutable: true, signtoolOptions },
    nsis: {
      ...test.nsis,
      shortcutName: "MeetSpace",
      uninstallDisplayName: "MeetSpace",
      license: "resources/APP-LICENSE.txt",
    },
  };
};
