// Real main/preload/shared React, local HTTPS/WSS only. No physical media capture.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, Menu, nativeTheme } = require("electron");
const profile = process.argv[2], output = process.argv[3];
assert.equal(process.platform, "darwin");
assert.ok(path.isAbsolute(profile) && path.isAbsolute(output));
app.setName("MeetSpace");
app.setPath("userData", profile);
app.setPath("sessionData", profile);

if (process.argv.includes("--second-instance-probe")) {
  const acquired = app.requestSingleInstanceLock();
  if (acquired) app.releaseSingleInstanceLock();
  app.exit(acquired ? 2 : 0);
} else {
  const { startApp } = require("../dist/main.js");
  const { createNodeHttpsTransport } = require("../dist/network/transport.js");
  const { createCertificates, createFixture, PASSWORD } = require("./fixtures/https-fixture.cjs");
  const WebSocket = require("ws");
  const report = { result: "FAIL", platform: process.platform, arch: process.arch,
    productVersion: process.getSystemVersion(), electron: process.versions.electron,
    fixtureOnly: true, packaged: false, physicalMediaTested: false, checks: [], captures: [] };
  let stage = "initialize", window, fixture, certificates, probe;
  const watchdog = setTimeout(() => { console.error("macOS UI exceeded time limit at " + stage); app.exit(1); }, 80000);
  const persist = () => fs.writeFile(path.join(output, "macos-ui.json"), JSON.stringify(report, null, 2) + "\n");
  (async () => {
    try {
      certificates = await createCertificates();
      fixture = await createFixture({ name: "macos-ui", certificates, ui: true });
      const transport = createNodeHttpsTransport({ ca: certificates.ca, timeoutMs: 3000 });
      const guard = (url, protocol) => {
        const value = new URL(url), allowed = new URL(fixture.origin);
        assert.equal(value.protocol, protocol); assert.equal(value.host, allowed.host);
      };
      window = await startApp({ show: true, userDataDir: profile, rendererRoot: path.resolve(__dirname, "../renderer"),
        brokerOptions: {
          transport: { request(input) { guard(input.url, "https:"); return transport.request(input); } },
          createSocket(url, protocols, options) { guard(url, "wss:"); return new WebSocket(url, protocols, { ...options, ca: certificates.ca, rejectUnauthorized: true }); },
        } });
      assert.ok(window);
      const js = source => window.webContents.executeJavaScript(source, true);
      const until = async (condition, description) => {
        const end = Date.now() + 8000;
        while (Date.now() < end) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
        throw new Error(description);
      };
      const text = value => until(async () => (await js("document.body.innerText")).includes(value), "Missing " + value);
      const click = selector => js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) throw new Error('Missing enabled control'); e.click(); })()`);
      const field = (selector, value) => js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('Missing field'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); })()`);
      const frame = async () => { await js("document.fonts.ready"); await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"); await new Promise(resolve => setTimeout(resolve, 350)); };
      const capture = async name => {
        await frame();
        const file = path.join(output, name + ".png");
        await fs.writeFile(file, (await window.webContents.capturePage()).toPNG()); report.captures.push(file);
      };
      stage = "sandbox";
      for (const [key, value] of Object.entries({ sandbox:true, contextIsolation:true, nodeIntegration:false, webSecurity:true, webviewTag:false })) assert.equal(window.webContents.getLastWebPreferences()[key], value);
      assert.equal(app.commandLine.hasSwitch("no-sandbox"), false);
      assert.equal(await js("typeof require === 'undefined' && typeof process === 'undefined' && Object.isFrozen(window.meetspaceDesktop)"), true);
      report.checks.push("sandbox, frozen bridge and renderer isolation");
      stage = "connection-themes";
      await text("Начнём с подключения");
      await click(".reference-onboarding-intro .button");
      await text("Подключиться к серверу");
      for (const theme of ["light", "dark"]) {
        nativeTheme.themeSource = theme;
        await until(() => js(`document.documentElement.dataset.theme === '${theme}'`), "system theme");
        await capture("connection-" + theme);
      }
      report.checks.push("system light/dark connection screen with stable frames");
      stage = "fixture-login";
      await field("#desktop-server-origin", fixture.origin);
      await click(".desktop-server-form button[type=submit]");
      await until(() => js("location.pathname === '/login' && !!document.querySelector('#email')"), "Login route");
      await field("#email", fixture.users[0].email);
      await field("#password", PASSWORD);
      await click("#auth-form button[type=submit]");
      await until(() => js("location.pathname === '/app'"), "Authenticated meetings route");
      await text(fixture.users[0].displayName);
      assert.equal(await js("document.querySelector('.workspace-search-trigger kbd, .workspace-search kbd, .workspace-header kbd')?.textContent?.includes('⌘') ?? [...document.querySelectorAll('kbd')].some(e => e.textContent.includes('⌘'))"), true, "Mac search shortcut");
      window.focus();
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: ["meta"] });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "K", modifiers: ["meta"] });
      await until(() => js("!!document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').textContent.includes('Поиск в пространстве')"), "CmdK opens shared search");
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until(() => js("!document.querySelector('[role=dialog]')"), "Escape closes search");
      report.checks.push("Mac shortcut label, Chromium Meta+K opens shared search and Escape closes it");
      await until(() => fixture.sockets.size > 0, "Authenticated WSS");
      assert.equal(await js(`[localStorage,sessionStorage].every(s => Object.keys(s).every(k => !/token|session/i.test(k)))`), true);
      report.checks.push("shared React HTTPS login and authenticated WSS against disposable fixture, no tokens in web storage");
      stage = "routes-and-layout";
      nativeTheme.themeSource = "light";
      for (const route of ["/personal", "/app/settings", "/recordings", "/app"]) {
        window.webContents.send("meetspace:route", route);
        await until(() => js(`location.pathname === ${JSON.stringify(route)}`), route);
        await frame();
        assert.equal(await js("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), true, route);
        await capture("route-" + route.slice(1).replaceAll("/", "-"));
        if (route === "/app/settings") {
          await js("[...document.querySelectorAll('[role=tab]')].find(e => e.textContent.includes('Приложение')).click()");
          await text("Закрытие окна оставляет приложение в Dock");
          assert.equal(await js("!!document.querySelector('.desktop-native-window-behavior') && ![...document.querySelectorAll('.desktop-native-settings label')].some(e => e.textContent.includes('сворачивать в трей'))"), true);
          await capture("settings-macos-application");
        }
      }
      for (const [width,height,zoom] of [[1000,720,1],[1440,900,1],[1000,720,1.5],[1440,900,2]]) {
        window.setContentSize(width,height); window.webContents.setZoomFactor(zoom); await frame();
        assert.equal(await js("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), true, `${width}/${zoom}`);
      }
      window.webContents.setZoomFactor(1);
      report.checks.push("shared chats/settings/recordings/meetings routes, native resizing and zoom 100/150/200%");
      stage = "window-lifecycle";
      const id = window.id, location = await js("location.pathname");
      window.close(); await until(() => !window.isVisible(), "red close hides window");
      assert.equal(window.isDestroyed(), false);
      app.emit("activate"); await until(() => window.isVisible(), "Dock activate restores window");
      assert.equal(window.id,id); assert.equal(await js("location.pathname"),location);
      const fileMenu = Menu.getApplicationMenu().getMenuItemById("meetspace-close-window");
      assert.ok(fileMenu && /W/.test(fileMenu.accelerator)); fileMenu.click();
      await until(() => !window.isVisible(), "CmdW callback hides window");
      stage = "single-instance";
      await new Promise((resolve,reject) => {
        probe = spawn(process.execPath, [__filename, profile, output, "--second-instance-probe"], { stdio:"ignore" });
        probe.once("error",reject); probe.once("exit", code => code===0 ? resolve() : reject(new Error("single instance probe: " + code)));
      });
      await until(() => window.isVisible(), "second process restores existing window");
      assert.equal(BrowserWindow.getAllWindows().length,1);
      assert.equal(window.id,id);
      report.checks.push("red close, menu CmdW, Dock activate, actual second-process lock and one restored window");
      stage = "recreate-window";
      window.destroy();
      app.emit("activate"); app.emit("activate");
      await until(() => BrowserWindow.getAllWindows().length === 1 && BrowserWindow.getAllWindows()[0].id !== id, "recreate one destroyed window");
      window = BrowserWindow.getAllWindows()[0];
      await text(fixture.users[0].displayName);
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      report.checks.push("concurrent Dock activation recreates one destroyed window and restores authenticated shared UI");
      stage = "deep-link";
      window.close();
      app.emit("open-url", {preventDefault(){}}, "meetspace://open/i/" + "a".repeat(32));
      await until(() => window.isVisible(), "deep link reopens hidden window");
      await until(() => js("location.pathname === '/i/' + 'a'.repeat(32)"), "deep link applies");
      report.checks.push("open-url event restores hidden window and routes through validated parser");
      stage = "explicit-quit";
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Explicit quit did not finish cleanup")), 5000);
        app.once("will-quit", event => { event.preventDefault(); clearTimeout(timer); resolve(); });
        Menu.getApplicationMenu().getMenuItemById("meetspace-quit").click();
      });
      assert.equal(window.isDestroyed(), true, "explicit quit closes the retained window");
      report.checks.push("explicit CmdQ menu callback completes application cleanup and destroys window");
      report.result = "PASS";
    } catch (error) { report.stage = stage; report.failure = error.message; console.error("macOS UI failed at " + stage + ": " + error.message); }
    finally {
      clearTimeout(watchdog); probe?.kill();
      if (fixture) await fixture.close(); if (certificates) await certificates.close();
      await persist(); console.log(JSON.stringify(report));
      // The test intercepts will-quit after actual cleanup to persist its result.
      app.exit(report.result === "PASS" ? 0 : 1);
    }
  })();
}
