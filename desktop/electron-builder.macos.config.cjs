// Local, unsigned .app for explicit ARM64/Intel targets.
// Distribution, Developer ID, notarization and update feeds belong to stage 06.
const path = require("node:path");
const base = require("./scripts/macos-builder-base.cjs");

module.exports = () => {
  const arch = process.env.MEETSPACE_TARGET_ARCH;
  const output = process.env.MEETSPACE_MACOS_OUTPUT;
  if (process.platform !== "darwin" || !["x64", "arm64"].includes(arch) ||
      process.env.MEETSPACE_BUILD_MODE !== "test" ||
      process.env.MEETSPACE_BUILD_TARGET !== "darwin" ||
      !output || !path.isAbsolute(output))
    throw new Error("Use the macOS unpacked test packaging driver");

  // Select common payload fields deliberately. The Windows normalizer edits PE
  // files and must not run as an afterPack or afterSign hook on macOS.
  return base(arch, output);
};
