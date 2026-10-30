// Production-only Electron capabilities; unsigned test artifacts retain inspector support.
exports.MACOS_RELEASE_FUSES = Object.freeze({ runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true,
  grantFileProtocolExtraPrivileges: false });
exports.verifyMacReleaseFuses = async function (executable) {
  const { getCurrentFuseWire, FuseV1Options } = require("@electron/fuses");
  const { FuseState } = require("@electron/fuses/dist/constants");
  const wire = await getCurrentFuseWire(executable);
  for (const [key, value] of Object.entries(exports.MACOS_RELEASE_FUSES)) {
    const name = key[0].toUpperCase() + key.slice(1);
    if (wire[FuseV1Options[name]] !== (value ? FuseState.ENABLE : FuseState.DISABLE))
      throw new Error("macOS release Electron fuse verification failed");
  }
  return { ...exports.MACOS_RELEASE_FUSES };
};
