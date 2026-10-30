const path = require("node:path");
const base = require("./scripts/macos-builder-base.cjs");
module.exports = async () => {
  const env = process.env, arch = env.MEETSPACE_TARGET_ARCH, output = env.MEETSPACE_MACOS_OUTPUT;
  if (process.platform !== "darwin" || env.MEETSPACE_BUILD_MODE !== "release" || env.MEETSPACE_BUILD_TARGET !== "darwin" ||
      !["x64", "arm64"].includes(arch) || !output || !path.isAbsolute(output))
    throw new Error("Use the reviewed macOS release driver");
  const { readMacReleaseConfig, macSigningBuilderOptions } = await import("./scripts/macos-release-policy.mjs");
  const reviewed = await readMacReleaseConfig(env.MEETSPACE_RELEASE_CONFIG);
  const config = base(arch, output);
  return { ...config, appId: "com.janickiy.meetspace.desktop", forceCodeSigning: true,
    files: config.files.filter(item => item !== "resources/TEST-BUILD.txt"),
    extraResources: config.extraResources.filter(item => item.to !== "TEST-LICENSE.txt"),
    electronFuses: { ...require("./scripts/macos-fuses.cjs").MACOS_RELEASE_FUSES },
    mac: { ...config.mac, ...macSigningBuilderOptions(reviewed, { keychainPath: env.MEETSPACE_MACOS_KEYCHAIN }), notarize: false } };
};
