"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createApplicationMenu, createMacOSDockMenu } = require("../dist/platform/application-menu");

function fixture(platform, trayAvailable = false) {
  const calls = [];
  const menu = createApplicationMenu({ platform, trayAvailable,
    show: () => calls.push("show"), hide: () => calls.push("hide"),
    close: () => calls.push("close"), quit: () => calls.push("quit"),
  });
  const items = menu.flatMap(group => [group, ...(group.submenu ?? [])]);
  return { menu, items, calls };
}

test("macOS Cmd+W closes through window policy while Cmd+Q explicitly requests safe quit", () => {
  const value = fixture("darwin");
  const close = value.items.find(item => item.id === "meetspace-close-window");
  const quit = value.items.find(item => item.id === "meetspace-quit");
  assert.equal(close.accelerator, "Command+W");
  assert.equal(quit.accelerator, "CommandOrControl+Q");
  assert.equal(close.role, undefined, "Electron must execute our close callback rather than a role override");
  assert.equal(quit.role, undefined, "quit uses the shared cleanup callback");
  close.click();
  assert.deepEqual(value.calls, ["close"]);
  quit.click();
  assert.deepEqual(value.calls, ["close", "quit"]);
  value.items.find(item => item.label === "Открыть MeetSpace").click();
  assert.deepEqual(value.calls, ["close", "quit", "show"]);
});

test("macOS has native app roles and no tray-dependent hide item", () => {
  const value = fixture("darwin", false);
  assert.equal(value.menu[0].label, "MeetSpace");
  const appItems = value.menu[0].submenu;
  for (const role of ["about", "services", "hide", "hideOthers", "unhide"])
    assert.ok(appItems.some(item => item.role === role), role);
  assert.deepEqual(appItems.find(item => item.role === "services").submenu, []);
  assert.equal(value.items.some(item => item.id === "meetspace-hide-to-tray"), false);
  assert.equal(appItems.find(item => item.role === "hide").enabled, undefined);
});

test("Windows and Linux preserve explicit tray availability and independent safe quit", () => {
  for (const platform of ["win32", "linux"]) for (const trayAvailable of [false, true]) {
    const value = fixture(platform, trayAvailable);
    const hide = value.items.find(item => item.id === "meetspace-hide-to-tray");
    assert.equal(hide.label, "Скрыть в трей");
    assert.equal(hide.enabled, trayAvailable);
    assert.equal(value.items.some(item => item.id === "meetspace-close-window"), false);
    hide.click();
    value.items.find(item => item.id === "meetspace-quit").click();
    assert.deepEqual(value.calls, ["hide", "quit"]);
  }
});

test("all menus keep edit, zoom and fullscreen without remote links, reload or developer tools", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const value = fixture(platform);
    for (const role of ["undo", "redo", "cut", "copy", "paste", "selectAll", "resetZoom", "zoomIn", "zoomOut", "togglefullscreen", "windowMenu"])
      assert.ok(value.items.some(item => item.role === role), `${platform}: ${role}`);
    assert.equal(value.items.some(item => ["help", "reload", "forceReload", "toggleDevTools"].includes(item.role)), false);
    assert.equal(value.items.some(item => /https?:|electron/i.test(item.label ?? "")), false);
  }
});

test("macOS Dock exposes only owned open, hide and safe quit actions", () => {
  for (const visible of [false, true]) {
    const calls = [];
    const menu = createMacOSDockMenu({ visible, show: () => calls.push("show"),
      hide: () => calls.push("hide"), quit: () => calls.push("quit") });
    assert.equal(menu.length, 4);
    assert.equal(menu.find(item => item.id === "meetspace-native-hide").enabled, visible);
    for (const id of ["open", "hide", "quit"]) menu.find(item => item.id === `meetspace-native-${id}`).click();
    assert.deepEqual(calls, ["show", "hide", "quit"]);
    assert.equal(menu.some(item => item.role || item.submenu || item.accelerator), false);
  }
});
