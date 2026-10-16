// Invoked only by integration-runner.cjs. The fixture UI and custom CA never ship.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("ws");
const { app, safeStorage } = require("electron");
// Set Chromium's profile before app readiness and before importing the app entry.
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.ok(path.isAbsolute(config.userDataDir));
app.setPath("userData", config.userDataDir);
app.setPath("sessionData", config.userDataDir);
const { startApp } = require("../dist/main.js");
const { createNodeHttpsTransport } = require("../dist/network/transport.js");
const { PASSWORD } = require("./fixtures/https-fixture.cjs");

(async () => {
  assert.ok(["first", "restart"].includes(config.phase));
  const ca = fs.readFileSync(config.caPath);
  const window = await startApp({
    show: false, userDataDir: config.userDataDir, rendererRoot: config.rendererRoot,
    brokerOptions: {
      transport: createNodeHttpsTransport({ ca, timeoutMs: 3000 }),
      createSocket: (url, protocols, options) => new WebSocket(url, protocols, { ...options, ca, rejectUnauthorized: true }),
    },
  });
  assert.ok(window);
  assert.equal(safeStorage.isEncryptionAvailable(), true, "real OS protected storage must be available");
  let sequence = 0;
  const call = (method, ...args) => window.webContents.executeJavaScript(`window.meetspaceDesktop[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
  const http = (method, resource, body, token) => call("http", { id: `electron-${++sequence}`, method,
    path: `/api/v1${resource}`, responseType: "json", ...(body === undefined ? {} : { body }), ...(token ? { token } : {}) });
  const until = async (script, description) => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(script)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(description);
  };
  assert.equal((await call("getRuntimeInfo")).capabilities.serverConnection, true);
  assert.equal(await window.webContents.executeJavaScript("window.meetspaceDesktop.bridgeVersion"), 5);
  assert.equal(await window.webContents.executeJavaScript("typeof require === 'undefined' && typeof process === 'undefined'"), true);
  if (config.phase === "first") {
    await call("addServer", { origin: config.alpha.origin, label: "Integration Alpha" });
    await call("addServer", { origin: config.beta.origin, label: "Integration Beta" });
    const state = await call("listServers");
    assert.equal(state.storageAvailable, true);
    await call("selectServer", state.items.find((item) => item.origin === config.alpha.origin).id);
    const login = await http("POST", "/auth/login", { email: config.alpha.email, password: PASSWORD });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, config.alpha.email);
    assert.equal(login.body.accessToken.includes("fixture-jwt-"), false);
    await assert.rejects(call("http", { id: "forbidden-url", method: "GET", path: "https://evil.invalid/api/v1/auth/me", responseType: "json" }));
    await window.webContents.executeJavaScript(`
      const script = document.createElement('script');
      script.textContent = 'window.__untrustedInlineRan = true';
      document.head.append(script);
    `);
    assert.equal(await window.webContents.executeJavaScript("window.__untrustedInlineRan === true"), false);
  } else {
    const state = await call("listServers");
    assert.equal(state.items.length, 2);
    const alphaId = state.items.find((item) => item.origin === config.alpha.origin).id;
    const betaId = state.items.find((item) => item.origin === config.beta.origin).id;
    assert.equal(state.selectedId, alphaId);
    const restored = await http("POST", "/auth/refresh", { userId: config.alpha.userId });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.user.email, config.alpha.email);
    const marker = restored.body.accessToken;
    const current = await http("GET", "/auth/me", undefined, marker);
    assert.equal(current.body.user.email, config.alpha.email);
    await window.webContents.executeJavaScript("window.__fixtureEvents = []; window.__fixtureUnsubscribe = window.meetspaceDesktop.onTransportEvent(event => window.__fixtureEvents.push(event)); void 0");
    await call("openSocket", { id: "ipc-account", kind: "account", token: marker });
    await call("openStream", { id: "ipc-notifications", token: marker });
    await until("window.__fixtureEvents.some(e => e.kind === 'socket' && e.type === 'message') && window.__fixtureEvents.some(e => e.kind === 'stream' && e.type === 'chunk')", "WSS/SSE events reach the isolated renderer through IPC");
    await call("closeSocket", "ipc-account");
    await call("closeStream", "ipc-notifications");
    await call("selectServer", betaId);
    const absent = await http("POST", "/auth/refresh", { userId: config.beta.userId });
    assert.equal(absent.status, 401, "same UUID on another server does not restore the previous server's account");
    const betaLogin = await http("POST", "/auth/login", { email: config.beta.email, password: PASSWORD });
    assert.equal(betaLogin.body.user.email, config.beta.email);
    const stale = await http("GET", "/conferences", undefined, marker).catch(() => null);
    assert.ok(stale === null || stale.status !== 200);
    await call("selectServer", alphaId);
    const alphaAgain = await http("POST", "/auth/refresh", { userId: config.alpha.userId });
    await http("POST", "/auth/logout", { userId: config.alpha.userId }, alphaAgain.body.accessToken);
    const afterLogout = await http("POST", "/auth/refresh", { userId: config.alpha.userId }).catch(() => null);
    assert.ok(afterLogout === null || afterLogout.status === 401);
    await window.webContents.executeJavaScript("window.__fixtureUnsubscribe()");
  }
  assert.equal(await window.webContents.executeJavaScript("localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ''"), true);
  console.log(JSON.stringify({ result: "PASS", phase: config.phase, platform: process.platform, arch: process.arch,
    electron: process.versions.electron, osProtectedStorage: true, rendererNodeAccess: false }));
  window.destroy();
  app.quit();
})().catch((error) => { console.error("Electron integration assertion failed:", error.message); app.exit(1); });
