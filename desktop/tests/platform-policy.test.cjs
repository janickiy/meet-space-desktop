"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createHostPlatform } = require("../dist/platform");

const host = (platform, env = {}, extra = {}) => createHostPlatform({ platform, arch: "x64", osRelease: "6.8.0-60-generic", packaged: true, env, ...extra });

test("Windows host policy preserves packaged startup, tray, placement and system audio", () => {
  const value = host("win32", { XDG_SESSION_TYPE: "wayland", XDG_CURRENT_DESKTOP: "GNOME" });
  assert.equal(value.desktopSession, "not-applicable");
  assert.equal(value.desktopEnvironment, "not-applicable");
  assert.deepEqual(value.nativeFeatures, { startup: true, absoluteWindowPosition: true, tray: "native" });
  assert.equal(value.capture.systemAudio, true);
  assert.equal(host("win32", {}, { packaged: false }).nativeFeatures.startup, false);
  assert.match(value.messages.startupUnavailable, /Windows/);
});

test("macOS host policy preserves tray and absolute geometry without enabling Windows features", () => {
  const value = host("darwin");
  assert.deepEqual(value.nativeFeatures, { startup: false, absoluteWindowPosition: true, tray: "native" });
  assert.equal(value.capture.systemAudio, false);
  assert.match(value.messages.startupUnavailable, /macOS/);
});

test("Linux session policy detects X11 and Wayland while keeping an unknown host conservative", () => {
  for (const [env, expected, positioned] of [
    [{ XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }, "x11", true],
    [{ XDG_SESSION_TYPE: "WAYLAND", WAYLAND_DISPLAY: "wayland-0" }, "wayland", false],
    [{ WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":1" }, "wayland", false],
    [{ DISPLAY: ":0" }, "x11", true],
    [{}, "unknown", false],
    [{ XDG_SESSION_TYPE: "x11", WAYLAND_DISPLAY: "wayland-0" }, "x11", false],
  ]) {
    const value = host("linux", env);
    assert.equal(value.desktopSession, expected);
    assert.equal(value.nativeFeatures.absoluteWindowPosition, positioned);
    assert.equal(value.nativeFeatures.startup, false);
    assert.equal(value.nativeFeatures.tray, "unverified");
    assert.equal(value.capture.systemAudio, false);
    assert.match(value.messages.startupUnavailable, /Linux/);
    assert.match(value.messages.systemAudioUnavailable, /Linux/);
  }
});

test("host metadata returns only bounded desktop identifiers, with no raw environment", () => {
  for (const [desktop, expected] of [["ubuntu:GNOME", "gnome"], ["KDE", "kde"], ["X-Cinnamon", "cinnamon"],
    ["XFCE", "xfce"], ["MATE", "mate"], ["LXQt", "lxqt"], ["private-user-desktop", "unknown"]])
    assert.equal(host("linux", { XDG_CURRENT_DESKTOP: desktop }).desktopEnvironment, expected);
  const value = host("linux", { XDG_CURRENT_DESKTOP: "/home/private-user/session", PRIVATE_TOKEN: "secret" }, { osRelease: "unsafe\nprivate" });
  assert.equal(value.osRelease, "unknown");
  assert.equal(JSON.stringify(value).includes("private-user"), false);
  assert.equal(JSON.stringify(value).includes("secret"), false);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.nativeFeatures), true);
  assert.equal(Object.isFrozen(value.capture), true);
  assert.equal(Object.isFrozen(value.messages), true);
  assert.throws(() => host("freebsd"), /unsupported_platform/);
  assert.throws(() => host("linux", {}, { arch: "ia32" }), /unsupported_platform/);
});
