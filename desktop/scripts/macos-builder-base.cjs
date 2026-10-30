const shared = require("../electron-builder.config.cjs");
module.exports = (arch, output) => ({
  appId: "com.janickiy.meetspace.desktop.test", productName: "MeetSpace", executableName: "MeetSpace",
  copyright: shared.copyright, protocols: shared.protocols, asar: true, npmRebuild: false,
  directories: { output, buildResources: "resources" },
  files: [...shared.files, "resources/macos/TrayTemplate.png", "resources/macos/TrayTemplate@2x.png"],
  extraResources: shared.extraResources.map(item => ({ ...item })),
  extraMetadata: { productName: "MeetSpace" }, publish: null, forceCodeSigning: false,
  mac: {
    target: [{ target: "dir", arch: [arch] }], icon: "resources/macos/icon.icns",
    category: "public.app-category.social-networking", minimumSystemVersion: "15.0", darkModeSupport: true,
    extendInfo: {
      NSHighResolutionCapable: true,
      NSCameraUsageDescription: "MeetSpace использует камеру для видеосвязи и проверки видео перед встречей.",
      NSMicrophoneUsageDescription: "MeetSpace использует микрофон для общения на встречах и проверки звука.",
      NSScreenCaptureUsageDescription: "MeetSpace использует запись экрана для демонстрации выбранного экрана или окна участникам встречи.",
    },
    identity: null, notarize: false,
  },
});
