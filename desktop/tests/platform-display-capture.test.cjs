const test = require("node:test");
const assert = require("node:assert/strict");
const { displayCaptureMode } = require("../dist/platform/display-capture.js");
const policy = options => displayCaptureMode({ platform: "linux", electronVersion: "44.7.1", chromiumVersion: "152.0.7977.149", ...options });

test("canonical Wayland uses the pinned PipeWire path even for an Xwayland application window", () => {
  for (const ozonePlatform of [undefined, "wayland", "x11", "auto"])
    assert.equal(policy({ env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" }, ozonePlatform }), "portal");
});

test("canonical X11 retains the explicit application picker and never infers portal consent", () => {
  assert.equal(policy({ env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" } }), "picker");
  assert.equal(policy({ env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0", XDG_CURRENT_DESKTOP: "GNOME" } }), "picker");
});

test("missing, normalized-only or contradictory Linux session evidence fails closed", () => {
  for (const env of [{}, { DISPLAY: ":0" }, { WAYLAND_DISPLAY: "wayland-0" },
    { XDG_SESSION_TYPE: "Wayland", WAYLAND_DISPLAY: "wayland-0" },
    { XDG_SESSION_TYPE: " wayland ", WAYLAND_DISPLAY: "wayland-0" },
    { XDG_SESSION_TYPE: "wayland-extra", WAYLAND_DISPLAY: "wayland-0" },
    { XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" }, { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "" },
    { XDG_SESSION_TYPE: "x11", DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0" },
    { XDG_SESSION_TYPE: "tty", DISPLAY: ":0" }, { XDG_SESSION_TYPE: "x11", DISPLAY: "" }])
    assert.equal(policy({ env }), "unavailable", JSON.stringify(env));
});

test("Linux runtime upgrades require a deliberate backend predicate audit", () => {
  const env = { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" };
  assert.equal(policy({ env, electronVersion: "45.0.0" }), "unavailable");
  assert.equal(policy({ env, chromiumVersion: "153.0.0.0" }), "unavailable");
});

test("Windows and macOS selection policies are unaffected by Linux session evidence and runtime gate", () => {
  for (const platform of ["win32", "darwin"])
    assert.equal(policy({ platform, electronVersion: "other", chromiumVersion: "other", env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" } }), "picker");
  assert.equal(policy({ platform: "freebsd" }), "unavailable");
});
