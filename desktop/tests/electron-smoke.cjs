const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, Menu, nativeTheme } = require("electron");
const { startApp } = require("../dist/main.js");

(async () => {
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "meetspace-foundation-smoke-"),
  );
  const wayland = process.platform === "linux" &&
    (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);
  let window;
  try {
    window = await startApp({
      show: wayland,
      userDataDir,
      rendererRoot: path.resolve(__dirname, "../renderer"),
    });
    assert.ok(window, "single instance starts");
    // Production startup must map the Wayland surface itself. Manually showing
    // it here would conceal a broken initial-window lifecycle.
    if (wayland) {
      assert.equal(window.isVisible(), true, "Wayland startup displays the loaded window");
      window.focus();
    }
    const menu = Menu.getApplicationMenu();
    assert.ok(menu && menu.items.some((item) => item.label === "MeetSpace"));
    assert.equal(
      menu.items.some((item) => /help|electron|learn more/i.test(item.label)),
      false,
      "default Electron external-link menu is absent",
    );
    const preferences = window.webContents.getLastWebPreferences();
    for (const [name, value] of Object.entries({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    }))
      assert.equal(preferences[name], value, name);
    const state = await window.webContents.executeJavaScript(`(async () => {
      const info = await window.meetspaceDesktop.getRuntimeInfo();
      const updates = await Promise.all(['getUpdateState', 'checkUpdates', 'downloadUpdate', 'cancelUpdate', 'installUpdate'].map(method => window.meetspaceDesktop[method]()));
      const api = await fetch('/api/v1/auth/me');
      let externalDenied = false, remoteDenied = false;
      try { await window.meetspaceDesktop.openExternal('https://evil.invalid/'); }
      catch { externalDenied = true; }
      try { await fetch('https://meeting.janickiy.com/version.json'); }
      catch { remoteDenied = true; }
      const script = document.createElement('script');
      script.textContent = 'window.__inlineSmokeEscape = true';
      document.head.append(script);
      return {
        text: document.body.innerText, info, updates, apiStatus: api.status,
        hasNode: typeof require !== 'undefined' || typeof process !== 'undefined',
        bridgeVersion: window.meetspaceDesktop.bridgeVersion,
        externalDenied, remoteDenied, inlineExecuted: window.__inlineSmokeEscape === true,
        secrets: [localStorage, sessionStorage].some(store =>
          Object.keys(store).some(key => /session|token/i.test(key)))
      };
    })()`);
    assert.match(state.text, /MeetSpace/);
    assert.match(state.text, /серверу/);
    assert.equal(state.hasNode, false);
    assert.equal(state.bridgeVersion, 6);
    assert.equal(state.info.capabilities.serverConnection, true);
    assert.equal(state.info.arch, process.arch);
    assert.equal(state.apiStatus, 403);
    assert.equal(state.externalDenied, true);
    assert.equal(state.remoteDenied, true);
    assert.equal(state.inlineExecuted, false);
    assert.equal(state.secrets, false);
    for (const update of state.updates) {
      assert.equal(update.enabled, false);
      assert.equal(update.phase, "disabled");
      assert.equal(update.code, "update_not_configured");
    }
    await assert.rejects(fs.stat(path.join(userDataDir, "updates")), { code: "ENOENT" });

    const originalURL = window.webContents.getURL();
    await window.webContents.executeJavaScript(`
      window.open('https://evil.invalid/');
      window.location.assign('https://evil.invalid/');
    `);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(
      window.webContents.getURL(),
      originalURL,
      "foreign navigation is blocked",
    );
    await fs.mkdir(path.resolve(__dirname, "../artifacts"), {
      recursive: true,
    });
    for (const theme of ["dark", "light"]) {
      nativeTheme.themeSource = theme;
      // React and native media-query delivery can take longer under a software
      // virtual display. Wait for the required result with a finite deadline.
      const deadline = Date.now() + 15000;
      while (
        (await window.webContents.executeJavaScript(
          "document.documentElement.dataset.theme",
        )) !== theme &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.documentElement.dataset.theme",
        ),
        theme,
        "system appearance change",
      );
      const capture = await window.webContents.capturePage();
      await fs.writeFile(
        path.resolve(
          __dirname,
          `../artifacts/foundation-${process.platform}-${process.arch}-${theme}.png`,
        ),
        capture.toPNG(),
      );
    }
    for (const zoom of [1.25, 1.5, 2]) {
      window.webContents.setZoomFactor(zoom);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        await window.webContents.executeJavaScript(
          "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
        ),
        true,
        "foundation has no horizontal overflow at page zoom " + zoom,
      );
    }
    window.webContents.setZoomFactor(1);
    const beganLoading = new Promise((resolve) =>
      window.webContents.once("did-start-loading", resolve),
    );
    const finishedLoading = new Promise((resolve) =>
      window.webContents.once("did-finish-load", resolve),
    );
    window.webContents.reload();
    await beganLoading;
    app.emit(
      "open-url",
      { preventDefault() {} },
      "meetspace://open/i/" + "a".repeat(32),
    );
    await finishedLoading;
    const routeDeadline = Date.now() + 15000;
    while (
      (await window.webContents.executeJavaScript("window.location.pathname")) !==
        "/i/" + "a".repeat(32) &&
      Date.now() < routeDeadline
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      await window.webContents.executeJavaScript("window.location.pathname"),
      "/i/" + "a".repeat(32),
      "deep link survives renderer reload",
    );
    console.log(
      JSON.stringify({
        result: "PASS",
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        checks: [
          "local renderer",
          "native application menu without default external links",
          "sandbox/Node isolation",
          "typed IPC",
          "all five update IPC operations remain disabled without touching update cache",
          "external URL rejection",
          "remote network blocked",
          "CSP inline rejection",
          "navigation/window-open blocked",
          "direct API requests denied",
          "no stored credentials",
          "system light/dark appearance",
          "page zoom without horizontal overflow",
          "deep link queued during reload",
        ],
      }),
    );
    window.destroy();
    await fs.rm(userDataDir, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error("Electron foundation smoke failed:", error.message);
    if (window && !window.isDestroyed()) window.destroy();
    await fs.rm(userDataDir, { recursive: true, force: true });
    app.exit(1);
  }
})().catch(() => app.exit(1));
