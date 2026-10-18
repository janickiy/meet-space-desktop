"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { createHostPlatform } = require("../dist/platform");

function fixture(platform, env = {}, { savedCloseToTray = true, trayFails = false, trayAvailable = false, startupProvider } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meetspace-platform-shell-"));
  const saved = { bounds: { x: 120, y: 130, width: 1000, height: 700 }, maximized: false };
  fs.writeFileSync(path.join(directory, "desktop-state.json"), JSON.stringify({ version: 1, window: saved,
    preferences: { closeToTray: savedCloseToTray, nativeNotifications: true } }));
  const screen = new EventEmitter(), window = new EventEmitter();
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  screen.getPrimaryDisplay = () => ({ workArea });
  screen.getAllDisplays = () => [{ workArea }];
  const calls = { hide: 0, quit: 0, shown: 0, focused: 0, loginSet: [], bounds: [], sizes: [], tray: null, preferences: [], monitorDisposed: false };
  let trayChanged;
  const trayMonitor = { available: () => trayAvailable, start(fn) { trayChanged = fn; }, dispose() { calls.monitorDisposed = true; } };
  let visible = true, destroyed = false, normalBounds = { ...saved.bounds }, login = false, maximized = false;
  Object.assign(window, {
    isDestroyed: () => destroyed, isFullScreen: () => false, isMaximized: () => maximized, isMinimized: () => false,
    isVisible: () => visible, getNormalBounds: () => ({ ...normalBounds }), setMinimumSize() {},
    setBounds(bounds) { calls.bounds.push(bounds); normalBounds = { ...bounds }; },
    setSize(width, height) { calls.sizes.push({ width, height }); normalBounds = { ...normalBounds, width, height }; },
    maximize() { maximized = true; }, unmaximize() { maximized = false; },
    hide() { visible = false; }, show() { visible = true; calls.shown++; }, focus() { calls.focused++; },
  });
  class FakeTray extends EventEmitter {
    constructor() { super(); if (trayFails) throw new Error("tray unavailable"); this.dead = false; calls.tray = this; }
    isDestroyed() { return this.dead; }
    destroy() { this.dead = true; }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
  }
  const electron = {
    app: { getPath: () => directory, getAppPath: () => path.join(__dirname, ".."), isPackaged: true,
      getLoginItemSettings: () => ({ openAtLogin: login, executableWillLaunchAtLogin: login }),
      setLoginItemSettings(value) { calls.loginSet.push(value); login = value.openAtLogin; } },
    screen, Tray: FakeTray, Menu: { buildFromTemplate: value => value },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, Notification: { isSupported: () => true },
  };
  const filename = path.resolve(__dirname, "../dist/native-shell.js"), moduleValue = { exports: {} };
  const requireLocal = Module.createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { exports: moduleValue.exports, module: moduleValue,
    require: name => name === "electron" ? electron : requireLocal(name), process, Buffer, setTimeout, clearTimeout }, { filename });
  const shell = new moduleValue.exports.NativeShell({ window: () => window, quit: () => calls.quit++, hide: () => calls.hide++,
    preferencesChanged(value) { calls.preferences.push(value); }, trayMonitor, startupProvider,
    hostPlatform: createHostPlatform({ platform, arch: "x64", osRelease: "6.8.0", packaged: true, env }) });
  return { shell, window, screen, calls, saved,
    setTrayAvailable(value) { trayAvailable = value; trayChanged?.(value); },
    moveTo(bounds) { normalBounds = { ...bounds }; },
    close() { let prevented = false; window.emit("close", { preventDefault() { prevented = true; } }); return prevented; },
    dispose() { shell.dispose(); destroyed = true; window.emit("closed"); fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

test("Linux cannot disappear into a constructed but unverified tray, including a saved preference", () => {
  for (const trayFails of [false, true]) {
    const value = fixture("linux", { XDG_SESSION_TYPE: "x11" }, { trayFails });
    try {
      value.shell.configureWindow(value.window);
      const preferences = value.shell.preferences();
      assert.equal(preferences.trayAvailable, false);
      assert.equal(preferences.closeToTray, false);
      assert.equal(preferences.startupSupported, false);
      assert.equal(preferences.startAtLogin, false);
      value.shell.hide();
      assert.equal(value.window.isVisible(), true);
      assert.equal(value.calls.hide, 0);
      assert.throws(() => value.shell.updatePreferences({ closeToTray: true }), /tray_unavailable/);
      assert.throws(() => value.shell.updatePreferences({ startAtLogin: true }), /startup_unavailable/);
      assert.equal(value.calls.loginSet.length, 0);
      assert.equal(value.close(), true);
      assert.equal(value.calls.quit, 1);
      assert.equal(value.window.isVisible(), true);
      if (value.calls.tray) assert.equal(value.calls.tray.menu.find(item => item.label === "Скрыть в трей").enabled, false);
      value.shell.show();
      assert.equal(value.calls.shown, 1);
      assert.equal(value.calls.focused, 1);
    } finally { value.dispose(); }
    assert.equal(value.screen.eventNames().length, 0);
  }
});

test("Linux registered tray can hide explicitly and losing the host recovers the hidden window", () => {
  const value = fixture("linux", { XDG_SESSION_TYPE: "wayland" }, { savedCloseToTray: false });
  try {
    value.shell.configureWindow(value.window);
    assert.equal(value.shell.preferences().trayStatus, "checking");
    value.setTrayAvailable(true);
    assert.equal(value.shell.preferences().trayAvailable, true);
    assert.equal(value.shell.preferences().closeToTray, false, "availability is not opt-in");
    value.shell.updatePreferences({ closeToTray: true });
    value.close();
    assert.equal(value.window.isVisible(), false);
    value.setTrayAvailable(false);
    assert.equal(value.window.isVisible(), true, "a hidden app remains reachable after extension shutdown");
    assert.equal(value.shell.preferences().trayStatus, "unavailable");
    assert.equal(value.shell.preferences().closeToTray, false);
    assert.equal(value.calls.preferences.at(-1).trayAvailable, false);
    assert.equal(value.calls.tray.menu.find(item => item.label === "Скрыть в трей").enabled, false);
    value.close();
    assert.equal(value.calls.quit, 1, "close without the host must quit");
  } finally { value.dispose(); }
  assert.equal(value.calls.monitorDisposed, true);
});

test("Linux startup uses only its opt-in provider and never Windows login APIs", () => {
  let enabled = false;
  const changes = [];
  const startupProvider = { status: () => ({ supported: true, enabled }), setEnabled(value) { enabled = value; changes.push(value); } };
  const value = fixture("linux", {}, { startupProvider });
  try {
    assert.equal(value.shell.preferences().startupSupported, true);
    assert.equal(value.shell.preferences().startAtLogin, false);
    assert.deepEqual(changes, [], "construction and reads never register autostart");
    assert.equal(value.shell.updatePreferences({ startAtLogin: true }).startAtLogin, true);
    assert.equal(value.shell.updatePreferences({ startAtLogin: false }).startAtLogin, false);
    assert.deepEqual(changes, [true, false]);
    assert.deepEqual(value.calls.loginSet, []);
    assert.throws(() => value.shell.updatePreferences({ startAtLogin: "yes" }), /invalid_request/);
  } finally { value.dispose(); }
});

test("Windows keeps exact geometry, explicit close-to-tray, login registration and normal quit", () => {
  const value = fixture("win32");
  try {
    value.shell.configureWindow(value.window);
    assert.deepEqual({ ...value.shell.windowOptions() }, { ...value.saved.bounds, minWidth: 900, minHeight: 640 });
    assert.equal(value.shell.preferences().trayAvailable, true);
    assert.equal(value.shell.preferences().closeToTray, true);
    assert.equal(value.close(), true);
    assert.equal(value.calls.hide, 1);
    assert.equal(value.calls.quit, 0);
    assert.equal(value.window.isVisible(), false);
    value.calls.tray.emit("click");
    assert.equal(value.window.isVisible(), true);
    value.shell.updatePreferences({ startAtLogin: true });
    assert.equal(value.shell.preferences().startAtLogin, true);
    assert.deepEqual(JSON.parse(JSON.stringify(value.calls.loginSet)), [{ openAtLogin: true, enabled: true, path: process.execPath, args: [] }]);
    value.moveTo({ x: -5000, y: -4000, width: 4000, height: 2500 });
    value.screen.emit("display-removed");
    assert.equal(value.calls.bounds.length, 1);
    assert.equal(value.calls.sizes.length, 0);
    value.shell.prepareQuit();
    assert.equal(value.close(), false);
  } finally { value.dispose(); }
});

test("Wayland and unknown Linux sessions restore size without claiming global window placement", () => {
  for (const env of [{ XDG_SESSION_TYPE: "wayland" }, {}]) {
    const value = fixture("linux", env);
    try {
      value.shell.configureWindow(value.window);
      assert.deepEqual({ ...value.shell.windowOptions() }, { width: 1000, height: 700, minWidth: 900, minHeight: 640 });
      value.moveTo({ x: -5000, y: -4000, width: 4000, height: 2500 });
      value.screen.emit("display-metrics-changed");
      assert.equal(value.calls.bounds.length, 0);
      assert.deepEqual(value.calls.sizes, [{ width: 1920, height: 1080 }]);
      value.window.maximize();
      value.moveTo({ x: -5000, y: -4000, width: 4000, height: 2500 });
      value.screen.emit("display-removed");
      assert.equal(value.calls.sizes.length, 1, "compositor keeps control of a maximized window");
    } finally { value.dispose(); }
  }
});

test("Linux X11 retains position restoration while unavailable Windows tray falls back to quit", () => {
  const linux = fixture("linux", { XDG_SESSION_TYPE: "x11" });
  const windows = fixture("win32", {}, { trayFails: true });
  try {
    assert.deepEqual({ ...linux.shell.windowOptions() }, { ...linux.saved.bounds, minWidth: 900, minHeight: 640 });
    windows.shell.configureWindow(windows.window);
    assert.equal(windows.shell.preferences().trayAvailable, false);
    assert.equal(windows.close(), true);
    assert.equal(windows.calls.quit, 1);
    windows.shell.hide();
    assert.equal(windows.window.isVisible(), true);
  } finally { linux.dispose(); windows.dispose(); }
});
