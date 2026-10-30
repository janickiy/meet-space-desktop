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
const { createMacOSAutostart } = require("../dist/platform/macos-autostart");

function fixture(platform, env = {}, { savedCloseToTray = true, trayFails = false, trayAvailable = false,
  emptyImage = false, dockFails = false, packaged = true, appPath = path.join(__dirname, ".."), startupProvider } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meetspace-platform-shell-"));
  const saved = { bounds: { x: 120, y: 130, width: 1000, height: 700 }, maximized: false };
  fs.writeFileSync(path.join(directory, "desktop-state.json"), JSON.stringify({ version: 1, window: saved,
    preferences: { closeToTray: savedCloseToTray, nativeNotifications: true } }));
  const screen = new EventEmitter(), window = new EventEmitter();
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  screen.getPrimaryDisplay = () => ({ workArea });
  screen.getAllDisplays = () => [{ workArea }];
  const calls = { hide: 0, quit: 0, shown: 0, focused: 0, loginSet: [], bounds: [], sizes: [], tray: null, preferences: [], monitorDisposed: false,
    imagePath: null, templateImage: false, dockBadges: [], dockMenus: [] };
  let trayChanged;
  const trayMonitor = { available: () => trayAvailable, start(fn) { trayChanged = fn; }, dispose() { calls.monitorDisposed = true; } };
  let visible = true, destroyed = false, normalBounds = { ...saved.bounds }, login = false, maximized = false;
  Object.assign(window, {
    isDestroyed: () => destroyed, isFullScreen: () => false, isMaximized: () => maximized, isMinimized: () => false,
    isVisible: () => visible, getNormalBounds: () => ({ ...normalBounds }), setMinimumSize() {},
    setBounds(bounds) { calls.bounds.push(bounds); normalBounds = { ...bounds }; },
    setSize(width, height) { calls.sizes.push({ width, height }); normalBounds = { ...normalBounds, width, height }; },
    maximize() { maximized = true; }, unmaximize() { maximized = false; },
    hide() { visible = false; window.emit("hide"); }, show() { visible = true; calls.shown++; window.emit("show"); }, focus() { calls.focused++; },
  });
  class FakeTray extends EventEmitter {
    constructor() { super(); if (trayFails) throw new Error("tray unavailable"); this.dead = false; calls.tray = this; }
    isDestroyed() { return this.dead; }
    destroy() { this.dead = true; }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
  }
  const electron = {
    app: { getPath: () => directory, getAppPath: () => appPath, isPackaged: packaged,
      dock: { setBadge(value) { if (dockFails) throw new Error("Dock unavailable"); calls.dockBadges.push(value); },
        setMenu(value) { if (dockFails) throw new Error("Dock unavailable"); calls.dockMenus.push(value); } },
      getLoginItemSettings: () => ({ openAtLogin: login, executableWillLaunchAtLogin: login }),
      setLoginItemSettings(value) { calls.loginSet.push(value); login = value.openAtLogin; } },
    screen, Tray: FakeTray, Menu: { buildFromTemplate: value => value },
    nativeImage: { createFromPath(filename) { calls.imagePath = filename; return { resize: () => ({}), isEmpty: () => emptyImage,
      setTemplateImage(value) { calls.templateImage = value; } }; } }, Notification: { isSupported: () => true },
  };
  const filename = path.resolve(__dirname, "../dist/native-shell.js"), moduleValue = { exports: {} };
  const requireLocal = Module.createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { exports: moduleValue.exports, module: moduleValue, __dirname: path.dirname(filename),
    require: name => name === "electron" ? electron : requireLocal(name), process, Buffer, setTimeout, clearTimeout }, { filename });
  const shell = new moduleValue.exports.NativeShell({ window: () => window, quit: () => calls.quit++, hide: () => calls.hide++,
    preferencesChanged(value) { calls.preferences.push(value); }, trayMonitor, startupProvider,
    hostPlatform: createHostPlatform({ platform, arch: "x64", osRelease: "6.8.0", packaged, env }) });
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

test("macOS NativeShell uses its actual startup adapter, preserves approval state and never calls Windows login APIs", () => {
  const native = { status: "not-registered", openAtLogin: false }, changes = [], reads = [];
  const bridge = {
    getLoginItemSettings(options) { reads.push(options); return { ...native }; },
    setLoginItemSettings(options) {
      changes.push(options);
      native.status = options.openAtLogin ? "enabled" : "not-registered";
      native.openAtLogin = options.openAtLogin;
    },
  };
  const startupProvider = createMacOSAutostart({ platform: "darwin", packaged: true,
    appId: "com.janickiy.meetspace.desktop.test", execPath: "/Applications/MeetSpace.app/Contents/MacOS/MeetSpace",
    appPath: "/Applications/MeetSpace.app/Contents/Resources/app.asar", homeDir: "/Users/qa",
    canonicalPath: value => value, bridge });
  const value = fixture("darwin", {}, { startupProvider });
  try {
    assert.equal(value.shell.preferences().startupSupported, true);
    assert.equal(value.shell.preferences().startAtLogin, false);
    assert.deepEqual(changes, [], "construction/status never registers login items");
    assert.equal(value.shell.updatePreferences({ startAtLogin: true }).startAtLogin, true);
    assert.equal(value.shell.updatePreferences({ startAtLogin: false }).startAtLogin, false);
    assert.deepEqual(changes, [{ type: "mainAppService", openAtLogin: true }, { type: "mainAppService", openAtLogin: false }]);
    assert.deepEqual(value.calls.loginSet, [], "NativeShell must not fall through to Windows path/args registration");
    assert.equal(value.calls.preferences.at(-1).startAtLogin, false);

    // A system-side approval change is reflected on the next read, without local cache.
    native.status = "requires-approval"; native.openAtLogin = true;
    assert.equal(value.shell.preferences().startupSupported, true);
    assert.equal(value.shell.preferences().startAtLogin, false);
    assert.equal(value.shell.preferences().startupReason, "approval-required");
    assert.throws(() => value.shell.updatePreferences({ startAtLogin: true }), /startup_unavailable/);
    assert.equal(changes.length, 2, "awaiting approval is not repeatedly registered");
    assert.equal(value.shell.updatePreferences({ startAtLogin: false }).startupReason, undefined);
    assert.deepEqual(changes.at(-1), { type: "mainAppService", openAtLogin: false }, "pending approval remains explicitly removable");

    bridge.setLoginItemSettings = options => {
      changes.push(options); native.status = "requires-approval"; native.openAtLogin = true;
    };
    assert.throws(() => value.shell.updatePreferences({ startAtLogin: true }), /startup_unavailable/);
    assert.equal(value.shell.preferences().startupReason, "approval-required", "rejected mutation is discoverable by settings polling");
    assert.equal(value.shell.preferences().startAtLogin, false);
    assert.deepEqual(value.calls.loginSet, []);
    assert.ok(reads.every(item => JSON.stringify(item) === '{"type":"mainAppService"}'));
    assert.throws(() => value.shell.updatePreferences({ startAtLogin: "true" }), /invalid_request/);
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

test("macOS close keeps the same window alive without depending on the tray or a saved close preference", () => {
  for (const trayFails of [false, true]) for (const savedCloseToTray of [false, true]) {
    const value = fixture("darwin", {}, { trayFails, savedCloseToTray });
    try {
      value.shell.configureWindow(value.window);
      assert.equal(value.shell.preferences().trayAvailable, !trayFails, "tray capability still reflects the real icon");
      assert.equal(value.shell.preferences().startupSupported, false, "Login Items remain outside this stage");
      assert.equal(value.close(), true);
      assert.equal(value.calls.quit, 0);
      assert.equal(value.calls.hide, 1, "closing cancels pending display selection once");
      assert.equal(value.window.isVisible(), false);
      assert.equal(value.window.isDestroyed(), false, "background renderer and current session survive");
      value.shell.show();
      assert.equal(value.window.isVisible(), true, "Dock/deep-link activation can restore the same window");
      assert.equal(value.calls.focused, 1);
      value.shell.hide();
      assert.equal(value.window.isVisible(), false, "explicit hide also works without the menu bar icon");
      assert.equal(value.calls.hide, 2);
      value.shell.prepareQuit();
      assert.equal(value.close(), false, "explicit quit can close instead of entering the hide loop");
      assert.equal(value.calls.hide, 2);
      assert.deepEqual(value.calls.loginSet, []);
    } finally { value.dispose(); }
    assert.equal(value.screen.eventNames().length, 0);
  }
});

test("macOS native Hide cancels a pending picker and uses a template image without changing saved preferences", () => {
  const value = fixture("darwin", {}, { savedCloseToTray: false });
  try {
    value.shell.configureWindow(value.window);
    assert.match(value.calls.imagePath, /resources[/\\]macos[/\\]TrayTemplate\.png$/);
    assert.equal(value.calls.templateImage, true);
    value.window.hide(); // Native Cmd+H does not call NativeShell.hide().
    assert.equal(value.calls.hide, 1);
    assert.equal(value.calls.quit, 0);
    value.window.show();
    value.window.hide();
    assert.equal(value.calls.hide, 2, "a later native Hide cancels a new request");
    value.shell.show();
    value.calls.tray.menu.find(item => item.label === "Скрыть MeetSpace").click();
    assert.equal(value.calls.hide, 3);
    assert.equal(value.shell.preferences().closeToTray, false, "macOS policy does not overwrite a user's local toggle");
    value.calls.tray.menu.find(item => item.label === "Выход из MeetSpace").click();
    assert.equal(value.calls.quit, 1, "tray Quit uses the explicit safe-quit callback");
  } finally { value.dispose(); }
});

test("macOS tray resources resolve from compiled app in development and app bundle when packaged", () => {
  for (const packaged of [false, true]) {
    const appPath = path.join(os.tmpdir(), "meetspace-test-entry-root");
    const value = fixture("darwin", {}, { packaged, appPath });
    try {
      assert.equal(value.calls.imagePath, path.join(packaged ? appPath : path.resolve(__dirname, ".."),
        "resources/macos/TrayTemplate.png"));
      assert.equal(value.calls.templateImage, true);
      assert.equal(value.shell.preferences().trayAvailable, true);
    } finally { value.dispose(); }
  }
});

test("a missing macOS tray image does not create a blank tray or block window lifecycle", () => {
  const value = fixture("darwin", {}, { emptyImage: true });
  try {
    value.shell.configureWindow(value.window);
    assert.equal(value.calls.tray, null);
    assert.equal(value.calls.templateImage, false);
    assert.equal(value.shell.preferences().trayAvailable, false);
    assert.equal(value.close(), true);
    assert.equal(value.window.isVisible(), false);
    assert.equal(value.calls.quit, 0);
    value.shell.show();
    assert.equal(value.window.isVisible(), true);
  } finally { value.dispose(); }
});

test("macOS Dock stays reachable without a menu bar icon and routes actions through safe lifecycle", () => {
  const value = fixture("darwin", {}, { trayFails: true });
  try {
    value.shell.configureWindow(value.window);
    const visibleMenu = value.calls.dockMenus.at(-1);
    assert.equal(visibleMenu.find(item => item.id === "meetspace-native-hide").enabled, true);
    visibleMenu.find(item => item.id === "meetspace-native-hide").click();
    assert.equal(value.window.isVisible(), false);
    assert.equal(value.calls.hide, 1);
    const hiddenMenu = value.calls.dockMenus.at(-1);
    assert.equal(hiddenMenu.find(item => item.id === "meetspace-native-hide").enabled, false);
    hiddenMenu.find(item => item.id === "meetspace-native-open").click();
    assert.equal(value.window.isVisible(), true);
    assert.equal(value.calls.shown, 1);
    assert.equal(value.calls.focused, 1);
    hiddenMenu.find(item => item.id === "meetspace-native-quit").click();
    assert.equal(value.calls.quit, 1);
    value.shell.prepareQuit();
    assert.equal(value.calls.dockMenus.at(-1).length, 0);
    visibleMenu.find(item => item.id === "meetspace-native-open").click();
    visibleMenu.find(item => item.id === "meetspace-native-quit").click();
    assert.equal(value.calls.shown, 1, "late native actions cannot restore a quitting application");
    assert.equal(value.calls.quit, 1);
  } finally { value.dispose(); }
});

test("macOS Dock badge clamps unread counts and clears on account reset and disposal", () => {
  const value = fixture("darwin");
  value.shell.configureWindow(value.window);
  const staleMenu = value.calls.dockMenus.at(-1);
  assert.deepEqual(value.calls.dockBadges, [""], "construction clears stale aggregate state");
  value.shell.setUnread(7);
  value.shell.setUnread(7);
  value.shell.setUnread(10000);
  value.shell.setUnread(0); // Existing notification identity reset/logout callback.
  value.shell.setUnread(2);
  value.shell.setUnread(NaN);
  value.shell.setUnread(-1);
  value.shell.setUnread(1.5);
  value.shell.setUnread(3);
  value.dispose();
  assert.deepEqual(value.calls.dockBadges, ["", "7", "9999", "", "2", "", "3", ""]);
  assert.equal(value.calls.dockMenus.at(-1).length, 0);
  const badges = value.calls.dockBadges.length, menus = value.calls.dockMenus.length;
  value.shell.setUnread(5); value.shell.show(); value.shell.hide(); value.shell.dispose();
  staleMenu.find(item => item.id === "meetspace-native-quit").click();
  assert.equal(value.calls.dockBadges.length, badges);
  assert.equal(value.calls.dockMenus.length, menus);
  assert.equal(value.calls.shown, 0);
  assert.equal(value.calls.quit, 0);
});

test("unavailable macOS Dock methods cannot break hiding, unread updates or safe quit", () => {
  const value = fixture("darwin", {}, { dockFails: true, trayFails: true });
  try {
    value.shell.configureWindow(value.window);
    value.shell.setUnread(8);
    assert.equal(value.close(), true);
    assert.equal(value.window.isVisible(), false);
    value.shell.show();
    assert.equal(value.window.isVisible(), true);
    value.shell.prepareQuit();
    assert.equal(value.close(), false);
  } finally { value.dispose(); }
});

test("Windows and Linux never call macOS Dock APIs", () => {
  for (const platform of ["win32", "linux"]) {
    const value = fixture(platform);
    value.shell.configureWindow(value.window);
    value.shell.setUnread(9);
    value.shell.setUnread(0);
    value.dispose();
    assert.deepEqual(value.calls.dockBadges, []);
    assert.deepEqual(value.calls.dockMenus, []);
  }
});
