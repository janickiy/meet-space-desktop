export const MACOS_TEST_IDENTITY = Object.freeze({
  appId: "com.janickiy.meetspace.desktop.test",
  productName: "MeetSpace",
  minimumSystemVersion: "15.0",
});

// Check the actual packaged plist before camera, microphone or screen capture.
// ScreenCaptureKit's current Apple documentation requests a screen purpose;
// descriptions explain access, but never replace the user's TCC consent.
// Keep these in sync with the builder policy.
export const MACOS_MEDIA_USAGE_DESCRIPTIONS = Object.freeze({
  NSCameraUsageDescription: "MeetSpace использует камеру для видеосвязи и проверки видео перед встречей.",
  NSMicrophoneUsageDescription: "MeetSpace использует микрофон для общения на встречах и проверки звука.",
  NSScreenCaptureUsageDescription: "MeetSpace использует запись экрана для демонстрации выбранного экрана или окна участникам встречи.",
});

export function parseMacArguments(args, { dev = false } = {}) {
  if (args.length === 1 && args[0] === "--help") return null;
  if (!["x64", "arm64"].includes(args[0]) ||
      !(args.length === 1 || (dev && args.length === 2 && args[1] === "--smoke")))
    throw new Error(`Use ${dev ? "dev" : "package"}-macos.mjs x64|arm64${dev ? " [--smoke]" : ""}`);
  return { arch: args[0], smoke: dev && args[1] === "--smoke" };
}

export function validateMacTarget({ arch, platform = process.platform, hostArch = process.arch, dev = false }) {
  if (platform !== "darwin" || !["x64", "arm64"].includes(arch) || !["x64", "arm64"].includes(hostArch))
    throw new Error("macOS builds require a Mac and an explicit x64 or arm64 target");
  if (dev && hostArch !== arch)
    throw new Error("macOS dev requires Node and Electron for the requested architecture; a cross-built .app is not a native runtime test");
  return { arch, crossBuilt: hostArch !== arch };
}

// A test driver cannot accidentally discover or use release credentials from
// its parent shell. It does not run signing/notarization commands itself.
export function macTestEnvironment(environment, arch) {
  const clean = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/^(?:CSC_|WIN_CSC_|APPLE_|MEETSPACE_(?:RELEASE|MACOS_OUTPUT|BUILD_MODE|BUILD_TARGET|TARGET_ARCH|DESKTOP_DEV|DEV_CSP_NONCE))/.test(key) &&
    !["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "ELECTRON_BUILDER_COMPRESSION_LEVEL"].includes(key)));
  return { ...clean, MEETSPACE_BUILD_MODE: "test", MEETSPACE_BUILD_TARGET: "darwin",
    MEETSPACE_TARGET_ARCH: arch, CSC_IDENTITY_AUTO_DISCOVERY: "false", TZ: "UTC" };
}

// This stage emits separate thin binaries. Inspect the Mach-O header instead
// of trusting a filename or a directory label; do not claim Rosetta as Intel QA.
export function inspectMachO(bytes, expectedArch) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf)
    throw new Error("Expected a thin 64-bit Mach-O executable");
  const arch = ({ 0x01000007: "x64", 0x0100000c: "arm64" })[bytes.readUInt32LE(4)];
  if (!arch || arch !== expectedArch) throw new Error("Wrong Mach-O architecture");
  return arch;
}

export function validateMacPlist(plist, version, { release = false } = {}) {
  if (plist.CFBundleIdentifier !== (release ? "com.janickiy.meetspace.desktop" : MACOS_TEST_IDENTITY.appId) ||
      plist.CFBundleDisplayName !== MACOS_TEST_IDENTITY.productName ||
      plist.CFBundleExecutable !== MACOS_TEST_IDENTITY.productName ||
      plist.CFBundleShortVersionString !== version ||
      plist.LSMinimumSystemVersion !== MACOS_TEST_IDENTITY.minimumSystemVersion ||
      plist.NSHighResolutionCapable !== true || plist.NSRequiresAquaSystemAppearance !== false ||
      !Object.entries(MACOS_MEDIA_USAGE_DESCRIPTIONS).every(([key, value]) => plist[key] === value) ||
      !plist.CFBundleURLTypes?.some((item) => item.CFBundleURLSchemes?.includes("meetspace")))
    throw new Error("macOS .app identity, version, Retina, theme, media permission or URL metadata mismatch");
}
