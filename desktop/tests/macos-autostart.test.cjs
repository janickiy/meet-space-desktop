"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createMacOSAutostart } = require("../dist/platform/macos-autostart.js");

function fixture(patch = {}) {
  const native = { status: "not-registered", openAtLogin: false };
  const reads = [], writes = [];
  const bridge = {
    getLoginItemSettings(options) { reads.push(options); return { ...native }; },
    setLoginItemSettings(options) { writes.push(options); native.status = options.openAtLogin ? "enabled" : "not-registered"; native.openAtLogin = options.openAtLogin; },
  };
  const options = { platform: "darwin", packaged: true, appId: "com.janickiy.meetspace.desktop.test",
    homeDir: "/Users/qa", execPath: "/Applications/MeetSpace.app/Contents/MacOS/MeetSpace",
    appPath: "/Applications/MeetSpace.app/Contents/Resources/app.asar", canonicalPath: value => value, bridge, ...patch };
  return { native, reads, writes, bridge, options, provider: createMacOSAutostart(options) };
}

test("macOS startup construction/status are read-only, and explicit changes are reversible/idempotent", () => {
  const value = fixture();
  assert.deepEqual(value.reads, []); assert.deepEqual(value.writes, []);
  assert.deepEqual(value.provider.status(), { supported: true, enabled: false });
  assert.deepEqual(value.writes, []);
  value.provider.setEnabled(true); value.provider.setEnabled(true);
  assert.deepEqual(value.provider.status(), { supported: true, enabled: true });
  value.provider.setEnabled(false); value.provider.setEnabled(false);
  assert.deepEqual(value.provider.status(), { supported: true, enabled: false });
  assert.deepEqual(value.writes, [{ type: "mainAppService", openAtLogin: true }, { type: "mainAppService", openAtLogin: false }]);
  assert.ok(value.reads.every(read => JSON.stringify(read) === '{"type":"mainAppService"}'));
});

test("macOS startup accepts installed system/user Applications bundles and both trusted identities", () => {
  for (const root of ["/Applications", "/Users/qa/Applications"]) for (const appId of ["com.janickiy.meetspace.desktop", "com.janickiy.meetspace.desktop.test"]) {
    const value = fixture({ appId, execPath: root + "/MeetSpace.app/Contents/MacOS/MeetSpace", appPath: root + "/MeetSpace.app/Contents/Resources/app.asar" });
    assert.deepEqual(value.provider.status(), { supported: true, enabled: false });
    assert.deepEqual(value.writes, []);
  }
});

test("non-Mac, unpackaged, foreign identity and transient bundles never reach native login settings", () => {
  for (const patch of [{ platform: "linux" }, { platform: "win32" }, { packaged: false }, { appId: "foreign.app" },
    ...["/Volumes/MeetSpace", "/tmp", "/private/var/folders/AppTranslocation", "/Users/qa/Downloads", "/work/artifacts"].map(root => ({
      execPath: root + "/MeetSpace.app/Contents/MacOS/MeetSpace", appPath: root + "/MeetSpace.app/Contents/Resources/app.asar" })),
    { execPath: "/Applications/MeetSpace.app/Contents/MacOS/../MacOS/MeetSpace" },
    { execPath: "relative/MeetSpace" }, { appPath: "/Applications/MeetSpace.app/Contents/Resources/foreign.asar" },
    { appPath: "/Applications/Other.app/Contents/Resources/app.asar" }, { homeDir: "/Users/qa\nother" },
    { canonicalPath: () => { throw new Error("missing file"); } },
    { canonicalPath: value => value.replace("/Applications/", "/Volumes/Disk/") }]) {
    const value = fixture(patch);
    assert.equal(value.provider.status().supported, false, JSON.stringify(patch));
    assert.throws(() => value.provider.setEnabled(true), /startup_unavailable/);
    assert.deepEqual(value.reads, []); assert.deepEqual(value.writes, []);
  }
});

test("macOS startup status follows OS approval/revocation without cached local preferences", () => {
  const value = fixture();
  value.native.status = "enabled"; value.native.openAtLogin = true;
  assert.equal(value.provider.status().enabled, true);
  value.native.status = "requires-approval";
  assert.deepEqual(value.provider.status(), { supported: true, enabled: false, reason: "approval-required" });
  assert.throws(() => value.provider.setEnabled(true), /startup_unavailable/);
  assert.deepEqual(value.writes, [], "approval must be completed in system Settings without registration retries");
  value.provider.setEnabled(false);
  assert.deepEqual(value.writes, [{ type: "mainAppService", openAtLogin: false }], "pending service can be explicitly removed");
  assert.equal(value.provider.status().enabled, false);
});

test("unknown/contradictory native states and read failures do not claim startup support", () => {
  for (const native of [{ status: "not-found", openAtLogin: false }, { status: "enabled", openAtLogin: false },
    { status: "not-registered", openAtLogin: true }, { status: "unknown", openAtLogin: true }, { status: "enabled", openAtLogin: "true" }]) {
    const value = fixture(); Object.assign(value.native, native);
    assert.deepEqual(value.provider.status(), { supported: false, enabled: false, reason: "unavailable" });
    assert.throws(() => value.provider.setEnabled(true), /startup_unavailable/); assert.deepEqual(value.writes, []);
  }
  const value = fixture(); value.bridge.getLoginItemSettings = () => { throw new Error("native details"); };
  assert.deepEqual(value.provider.status(), { supported: false, enabled: false, reason: "unavailable" });
  assert.throws(() => value.provider.setEnabled(true), /^Error: startup_unavailable$/);
});

test("registration must be confirmed by OS readback and does not persist false success", () => {
  for (const outcome of ["silent-failure", "approval-required", "throws"]) {
    const value = fixture();
    value.bridge.setLoginItemSettings = options => {
      value.writes.push(options);
      if (outcome === "throws") throw new Error("native registration details");
      if (outcome === "approval-required") { value.native.status = "requires-approval"; value.native.openAtLogin = true; }
    };
    assert.throws(() => value.provider.setEnabled(true), /^Error: startup_unavailable$/);
    assert.equal(value.provider.status().enabled, false);
    assert.deepEqual(value.writes, [{ type: "mainAppService", openAtLogin: true }]);
  }
});

test("malformed opt-in values never mutate login items", () => {
  const value = fixture();
  for (const enabled of [undefined, null, 1, "true", {}, []]) assert.throws(() => value.provider.setEnabled(enabled), /invalid_request/);
  assert.deepEqual(value.reads, []); assert.deepEqual(value.writes, []);
});
