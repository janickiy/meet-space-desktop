const assert = require("node:assert/strict");
const test = require("node:test");
const { AppInfo } = require("app-builder-lib/out/appInfo");
const { getWindowsInstallationDirName } = require("app-builder-lib/out/targets/targetUtil");
const { UUID } = require("builder-util-runtime");
const config = require("../electron-builder.config.cjs");
const metadata = require("../package.json");

test("Windows setup, installed apps and shortcuts display MeetSpace", () => {
  const app = new AppInfo({ config, metadata }, null, config.win);
  assert.equal(app.productName, "MeetSpace");
  assert.equal(config.nsis.uninstallDisplayName, "MeetSpace");
  assert.equal(config.nsis.shortcutName, "MeetSpace");
  assert.equal(config.nsis.createDesktopShortcut, true);
  assert.equal(config.nsis.createStartMenuShortcut, true);
});

test("Windows branding preserves the test-channel upgrade, executable and profile", () => {
  const app = new AppInfo({ config, metadata }, null, config.win);
  const nsisNamespace = UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3");
  assert.equal(config.nsis.guid || UUID.v5(app.id, nsisNamespace), "086d5621-c3b8-5441-ac99-32e4c7de953d");
  assert.equal(app.productFilename, "MeetSpace");
  assert.equal(getWindowsInstallationDirName(app, true), "MeetSpace");
  const packaged = { ...metadata, ...config.extraMetadata };
  assert.equal(packaged.productName || packaged.name, "meetspace-desktop");
});
