// Real main/preload, OS credential metadata and sandboxed renderer IPC. Only
// native dialog/browser launch results are replaced in this trusted test entry.
// HTTPS/WSS uses a disposable local CA; production certificate policy is intact.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const syncFs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const WebSocket = require("ws");
const { app, BrowserWindow, dialog, shell, safeStorage } = require("electron");
const config = JSON.parse(syncFs.readFileSync(process.argv[2], "utf8"));
for (const key of ["profile", "renderer", "resultPath", "savePath"]) assert.ok(path.isAbsolute(config[key]));
app.setPath("userData", config.profile);
app.setPath("sessionData", config.profile);
const { startApp } = require("../dist/main.js"); // Scheme registration precedes readiness.
const { createNodeHttpsTransport } = require("../dist/network/transport.js");
const { createCertificates, PASSWORD } = require("./fixtures/https-fixture.cjs");
const { createAssetsFixture, asset } = require("./fixtures/assets-fixture.cjs");

let stage = "initialize";
const report = {
  schemaVersion: 1, result: "FAIL", platform: process.platform, arch: process.arch,
  osRelease: os.release(), electron: process.versions.electron, chromium: process.versions.chrome,
  node: process.versions.node, fixtureOnly: true, productionRequests: 0,
  physicalDesktopAcceptance: false,
  nativeUiTestDoubles: ["dialog.showSaveDialog", "shell.openExternal"],
  checks: {},
};
const persist = () => syncFs.writeFileSync(config.resultPath, JSON.stringify(report, null, 2) + "\n");
const watchdog = setTimeout(() => { report.stage = stage; report.failure = "timeout"; persist(); app.exit(1); }, 80000);

(async () => {
  let certificates, fixture, window, foreign;
  const originalSaveDialog = dialog.showSaveDialog;
  const originalOpenExternal = shell.openExternal;
  const dialogCalls = [], externalCalls = [];
  let saveChoice = null;
  dialog.showSaveDialog = async (owner, options) => {
    assert.equal(owner, window, "save dialog belongs to the trusted main window");
    assert.equal(options.title, "Сохранить файл MeetSpace");
    assert.equal(options.buttonLabel, "Сохранить");
    assert.equal(options.defaultPath, "recording.mp4");
    assert.equal(path.basename(options.defaultPath), options.defaultPath);
    assert.deepEqual(options.properties, ["showOverwriteConfirmation", "createDirectory"]);
    assert.deepEqual(Object.keys(options).sort(), ["buttonLabel", "defaultPath", "properties", "title"]);
    dialogCalls.push({ ownerId: owner.id, title: options.title, suggestedBasename: options.defaultPath });
    return saveChoice ? { canceled: false, filePath: saveChoice } : { canceled: true, filePath: "" };
  };
  shell.openExternal = async (...args) => { externalCalls.push(args); };
  try {
    stage = "local-fixture";
    certificates = await createCertificates();
    fixture = await createAssetsFixture(certificates);
    fixture.broker.dispose(); // Its helper identity is never used by the application.
    stage = "real-main-preload";
    window = await startApp({
      show: false, userDataDir: config.profile, rendererRoot: config.renderer,
      brokerOptions: {
        transport: createNodeHttpsTransport({ ca: certificates.ca, timeoutMs: 3000 }),
        createSocket: (url, protocols, options) => new WebSocket(url, protocols, { ...options, ca: certificates.ca, rejectUnauthorized: true }),
      },
    });
    assert.ok(window, "isolated real main instance starts");
    const js = source => window.webContents.executeJavaScript(source);
    const call = (method, ...args) => js(`window.meetspaceDesktop[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
    const denied = async (method, args, code) => {
      const result = await js(`(async () => { try {
        await window.meetspaceDesktop[${JSON.stringify(method)}](...${JSON.stringify(args)});
        return { rejected: false };
      } catch (error) { return { rejected: true, message: error.message }; } })()`);
      assert.equal(result.rejected, true, method);
      const messages = {
        invalid_request: "Некорректный запрос.",
        secure_storage_unavailable: "Защищённое хранилище системы недоступно. Повторите запуск приложения.",
      };
      if (code) assert.equal(result.message, messages[code], method);
    };
    stage = "sandbox-and-contract";
    const preferences = window.webContents.getLastWebPreferences();
    for (const [key, expected] of Object.entries({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false })) assert.equal(preferences[key], expected, key);
    assert.equal(app.commandLine.hasSwitch("no-sandbox"), false);
    const surface = await js(`({ version: window.meetspaceDesktop.bridgeVersion,
      frozen: Object.isFrozen(window.meetspaceDesktop),
      hasNode: typeof require !== 'undefined' || typeof process !== 'undefined' || typeof Buffer !== 'undefined',
      keys: Object.keys(window.meetspaceDesktop).sort(),
      forbidden: ['invoke', 'ipcRenderer', 'exec', 'spawn', 'readFile', 'writeFile', 'ssh', 'sftp', 'shell'].some(key => key in window.meetspaceDesktop) })`);
    assert.equal(surface.version, 6);
    assert.equal(surface.frozen, true);
    assert.equal(surface.hasNode, false);
    assert.equal(surface.forbidden, false);
    const expectedMethods = ["getRuntimeInfo", "openExternal", "onRoute", "minimize", "toggleMaximize", "close", "quit", "getUpdateState", "getSshInstallerState", "sshInstaller", "checkUpdates", "downloadUpdate", "cancelUpdate", "installUpdate", "getNativePreferences", "setNativePreferences", "setNotificationContext", "saveAsset", "openRecordingMedia", "closeRecordingMedia", "cancelAsset", "listServers", "probeServer", "addServer", "selectServer", "removeServer", "http", "abortRequest", "openStream", "closeStream", "openSocket", "sendSocket", "closeSocket", "onTransportEvent", "onDisplayCaptureEvent", "selectDisplaySource", "cancelDisplaySource"];
    assert.deepEqual(surface.keys, ["bridgeVersion", ...expectedMethods].sort());
    report.sandboxEvidence = {
      configured: { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity },
      rendererNodeAbsent: true,
      linuxKernelEnforcement: "not-inspected-by-this-harness",
    };
    report.checks.sandboxAndContract = "PASS";

    stage = "real-host-metadata";
    const runtime = await call("getRuntimeInfo");
    const nativePreferences = await call("getNativePreferences");
    assert.equal(runtime.platform, process.platform);
    assert.equal(runtime.arch, process.arch);
    assert.equal(runtime.isPackaged, app.isPackaged);
    assert.deepEqual(runtime.capabilities, { serverConnection: true, windowControls: true });
    assert.equal(runtime.host.supports.startup, nativePreferences.startupSupported);
    for (const supported of Object.values(runtime.host.supports)) assert.equal(typeof supported, "boolean");
    const encrypted = safeStorage.isEncryptionAvailable();
    if (process.platform === "linux") {
      const backend = safeStorage.getSelectedStorageBackend();
      const names = { gnome_libsecret: "gnome-libsecret", kwallet: "kwallet", kwallet5: "kwallet5", kwallet6: "kwallet6", basic_text: "basic_text" };
      assert.equal(runtime.host.secureStorage.backend, names[backend] || "unknown");
      assert.equal(runtime.host.secureStorage.available, encrypted && !!names[backend] && backend !== "basic_text");
      if (backend === "basic_text") assert.equal(runtime.host.secureStorage.reason, "insecure-backend");
      assert.equal(runtime.host.supports.startup, false);
      assert.equal(runtime.host.supports.systemAudio, false);
      assert.equal(nativePreferences.trayAvailable, false);
      assert.equal(nativePreferences.closeToTray, false);
      assert.equal(nativePreferences.startAtLogin, false);
      assert.ok(["x11", "wayland", "unknown"].includes(runtime.host.session));
      if (runtime.host.session !== "x11" || process.env.WAYLAND_DISPLAY?.trim()) assert.equal(runtime.host.supports.absoluteWindowPosition, false);
    } else {
      assert.equal(runtime.host.session, "not-applicable");
      assert.equal(runtime.host.secureStorage.backend, process.platform === "win32" ? "dpapi" : "keychain");
      assert.equal(runtime.host.secureStorage.available, encrypted);
      assert.equal(runtime.host.supports.systemAudio, process.platform === "win32");
    }
    assert.equal(runtime.host.secureStorage.available, runtime.host.secureStorage.reason === "available");
    report.host = runtime.host;
    report.nativePreferences = nativePreferences;
    report.checks.realHostMetadata = "PASS";

    stage = "csp-inline-and-network";
    const requestsBeforeCsp = fixture.api.requests.length;
    const csp = await js(`(async () => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective));
      const script = document.createElement('script'); script.textContent = 'window.__platformInlineEscape = true'; document.head.append(script);
      const networkDenied = await fetch(${JSON.stringify(fixture.api.origin + "/version")}).then(() => false, () => true);
      await new Promise(resolve => setTimeout(resolve, 50));
      return { networkDenied, inlineExecuted: window.__platformInlineEscape === true, violations };
    })()`);
    assert.equal(csp.inlineExecuted, false);
    assert.equal(csp.networkDenied, true);
    assert.ok(csp.violations.some(value => value.startsWith("script-src")));
    assert.ok(csp.violations.includes("connect-src"));
    assert.equal(fixture.api.requests.length, requestsBeforeCsp);
    report.checks.cspInlineAndNetwork = "PASS";

    stage = "typed-native-settings";
    for (const input of [{ closeToTray: "true" }, { nativeNotifications: 1 }, { startAtLogin: null }, { path: config.savePath }, { nativeNotifications: false, command: "ignored" }]) {
      await denied("setNativePreferences", [input], "invalid_request");
    }
    assert.deepEqual(await call("getNativePreferences"), nativePreferences);
    report.checks.invalidSettingsRejected = "PASS";

    stage = "selected-local-server";
    await call("addServer", { origin: fixture.api.origin, label: "Local platform fixture" });
    const servers = await call("listServers");
    await call("selectServer", servers.items.find(item => item.origin === fixture.api.origin).id);
    assert.equal(servers.storageAvailable, runtime.host.secureStorage.available);
    stage = "external-link-authority";
    for (const url of ["https://off-origin.invalid/", "javascript:alert(1)", "file:///tmp/platform-test", "data:text/plain,fixture", fixture.api.origin.replace("https://", "https://user:password@") + "/app", { url: fixture.api.origin, command: "ignored" }]) await assert.rejects(call("openExternal", url));
    assert.equal(externalCalls.length, 0, "rejected links never reach the OS");
    await call("openExternal", fixture.api.origin + "/app");
    assert.deepEqual(externalCalls, [[fixture.api.origin + "/app"]]);
    report.checks.externalLinkAuthority = "PASS";

    stage = "asset-input-authority";
    const malformed = [
      { path: config.savePath }, { filePath: config.savePath }, { url: fixture.origin + "/bucket/recording.mp4" },
      { overwrite: true }, { asset: { ...asset, path: config.savePath } },
      { asset: { ...asset, url: fixture.origin + "/bucket/recording.mp4" } },
    ];
    for (const extra of malformed) await denied("saveAsset", [{ id: "invalid-platform-asset", token: "desktop-session:untrusted", asset, ...extra }], "invalid_request");
    assert.equal(dialogCalls.length, 0);
    report.checks.rendererAssetAuthorityRejected = "PASS";

    stage = "foreign-window-sender";
    foreign = new BrowserWindow({ show: false, webPreferences: { session: window.webContents.session, preload: path.resolve(__dirname, "../dist/preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    await foreign.loadURL("app://meetspace/");
    const beforeForeign = fixture.api.requests.length;
    for (const source of ["window.meetspaceDesktop.getRuntimeInfo()", "window.meetspaceDesktop.getNativePreferences()", `window.meetspaceDesktop.saveAsset(${JSON.stringify({ id: "foreign-platform-asset", token: "desktop-session:untrusted", asset })})`]) await assert.rejects(foreign.webContents.executeJavaScript(source), /Operation is not allowed/);
    assert.equal(dialogCalls.length, 0);
    assert.equal(fixture.api.requests.length, beforeForeign);
    foreign.destroy(); foreign = null;
    report.checks.foreignWindowSenderRejected = "PASS";

    stage = "protected-file-save";
    if (runtime.host.secureStorage.available) {
      const login = await call("http", { id: "platform-fixture-login", method: "POST", path: "/api/v1/auth/login", responseType: "json", body: { email: fixture.api.users[0].email, password: PASSWORD } });
      assert.equal(login.status, 200);
      assert.match(login.body.accessToken, /^desktop-session:[a-f0-9-]{36}$/);
      assert.equal(JSON.stringify(login.body).includes("fixture-jwt-"), false);
      const input = id => ({ id, token: login.body.accessToken, asset });
      const readsBeforeCancel = fixture.contentReads;
      assert.deepEqual(await call("saveAsset", input("platform-cancel")), { cancelled: true, saved: false });
      assert.equal(fixture.contentReads, readsBeforeCancel);
      assert.equal(dialogCalls.length, 1);
      saveChoice = config.savePath;
      assert.deepEqual(await call("saveAsset", input("platform-save")), { cancelled: false, saved: true });
      assert.deepEqual(await fs.readFile(config.savePath), fixture.bytes);
      assert.equal(dialogCalls.length, 2);
      assert.equal(fixture.contentReads, readsBeforeCancel + 1);
      assert.equal((await fs.readdir(path.dirname(config.savePath))).some(name => name.endsWith(".part")), false);
      for (const entry of fixture.seen) for (const name of ["authorization", "cookie", "origin", "sec-fetch-site"]) assert.equal(entry.headers[name], undefined);
      const vault = await fs.readFile(path.join(config.profile, "sessions.encrypted"));
      for (const secret of [PASSWORD, ...fixture.api.tokens.keys(), ...fixture.api.sessions.keys()]) assert.equal(vault.includes(Buffer.from(secret)), false);
      report.checks.fileSave = { result: "PASS", dialogOwnerAndOptions: true, cancellationDownloadsNothing: true, actualBytes: fixture.bytes.length, privateTemporaryFileRemoved: true, protectedVault: true };
    } else {
      await denied("http", [{ id: "platform-storage-denied", method: "POST", path: "/api/v1/auth/login", responseType: "json", body: { email: fixture.api.users[0].email, password: PASSWORD } }], "secure_storage_unavailable");
      report.checks.fileSave = { result: "SKIPPED", reason: "secure_storage_unavailable", backend: runtime.host.secureStorage.backend };
      report.checks.unavailableStorageFailsClosed = "PASS";
    }
    report.checks.realMainPreload = "PASS";
    report.result = "PASS";
  } finally {
    foreign?.destroy();
    // Keep the main window alive until local sockets are closed on Linux.
    await fixture?.close();
    await certificates?.close();
    dialog.showSaveDialog = originalSaveDialog;
    shell.openExternal = originalOpenExternal;
    window?.destroy();
  }
  clearTimeout(watchdog);
  persist();
  console.log(JSON.stringify({ result: report.result, platform: report.platform, arch: report.arch, checks: report.checks }));
  app.exit(0);
})().catch(error => {
  clearTimeout(watchdog);
  report.result = "FAIL";
  report.stage = stage;
  report.failure = error.code || error.name;
  persist();
  console.error("Platform Electron integration failed at " + stage + ": " + error.message);
  app.exit(1);
});
