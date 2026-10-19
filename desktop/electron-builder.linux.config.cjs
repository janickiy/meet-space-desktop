// Internal Linux packages use the shared desktop payload and their own identity.
// This configuration is deliberately separate from the Windows installer path.
const path = require("node:path");
const windows = require("./electron-builder.config.cjs");

module.exports = () => {
  const arch = process.env.MEETSPACE_TARGET_ARCH;
  const output = process.env.MEETSPACE_LINUX_OUTPUT;
  if (
    process.platform !== "linux" ||
    !["x64", "arm64"].includes(arch) ||
    process.arch !== arch ||
    !output ||
    !path.isAbsolute(output) ||
    process.env.MEETSPACE_BUILD_MODE !== "test"
  )
    throw new Error("Use the native Linux test packaging driver");

  const packageOptions = {
    packageName: "meetspace-desktop-test",
    // AppImage always adds its own %U; keeping this per installed format avoids
    // deepAssign retaining a global %u when AppImage supplies an empty array.
    executableArgs: ["%u"],
    afterInstall: "resources/linux/after-install.sh",
    afterRemove: "resources/linux/after-remove.sh",
    maintainer: "MeetSpace <janickiy@mail.ru>",
  };
  return {
    appId: "com.janickiy.meetspace.desktop.test",
    // The SUID sandbox cannot launch subprocesses from an installation path
    // containing spaces. Keep the filesystem name separate from display names.
    productName: "meetspace-desktop-test",
    executableName: "meetspace-test",
    copyright: windows.copyright,
    protocols: windows.protocols,
    asar: windows.asar,
    npmRebuild: windows.npmRebuild,
    directories: { output, buildResources: "resources" },
    files: [...windows.files],
    extraResources: windows.extraResources.map((item) => ({ ...item })),
    extraMetadata: {
      productName: "MeetSpace Test",
      desktopName: "com.janickiy.meetspace.desktop.test.desktop",
      homepage: "https://janickiy.com/",
      description: "MeetSpace desktop — internal Linux test build",
    },
    artifactName: "MeetSpace-${version}-linux-${arch}-test.${ext}",
    publish: null,
    afterPack: "./scripts/normalize-linux-package.cjs",
    linux: {
      executableName: "meetspace-test",
      icon: "resources/icon.png",
      syncDesktopName: true,
      category: "Network;VideoConference",
      target: ["deb", "rpm", "AppImage"],
      desktop: {
        entry: {
          Name: "MeetSpace Test",
          Terminal: "false",
          StartupNotify: "true",
          "X-MeetSpace-Build": "internal-test",
        },
      },
    },
    deb: {
      ...packageOptions,
      packageCategory: "net",
      compression: "xz",
      recommends: [],
      depends: [
        "libc6 (>= 2.35)",
        "libgtk-3-0 | libgtk-3-0t64",
        "libnotify4",
        "libnss3",
        "libnspr4",
        "libxss1",
        "libxtst6",
        "libatspi2.0-0 | libatspi2.0-0t64",
        "libuuid1",
        "libsecret-1-0",
        // A versioned dependency excludes unversioned compatibility providers
        // such as the OSS shim, which cannot satisfy Chromium's ALSA ABI.
        "libasound2t64 (>= 1.2.2) | libasound2 (>= 1.2.2)",
        "libgbm1",
        "libdrm2",
        "libx11-6",
        "libxcb1",
        "libxcomposite1",
        "libxdamage1",
        "libxext6",
        "libxfixes3",
        "libxrandr2",
        "libcups2 | libcups2t64",
        "libglib2.0-0 | libglib2.0-0t64",
        "libdbus-1-3",
        "systemd",
        "xdg-utils",
        "ca-certificates",
      ],
    },
    rpm: {
      ...packageOptions,
      packageCategory: "Applications/Internet",
      compression: "xz",
      depends: [
        "glibc >= 2.35",
        "gtk3",
        "libnotify",
        "nss",
        "nspr",
        "libXScrnSaver",
        "libXtst",
        "at-spi2-core",
        "libuuid",
        "libsecret",
        "alsa-lib",
        "mesa-libgbm",
        "libdrm",
        "libX11",
        "libxcb",
        "libXcomposite",
        "libXdamage",
        "libXext",
        "libXfixes",
        "libXrandr",
        "cups-libs",
        "glib2",
        "dbus-libs",
        "systemd",
        "xdg-utils",
        "ca-certificates",
      ],
    },
    appImage: {
      // Upstream's legacy default adds an unsafe argument to the desktop entry.
      // The driver separately replaces its fallback launcher with our own file.
      executableArgs: [],
      license: "resources/TEST-LICENSE.txt",
    },
  };
};
