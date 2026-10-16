// Actual permission/IPC lifecycle; synthetic source enumeration prevents OS screen
// prompts. Successful capture below uses a separate own-tab test handler only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const WebSocket = require("ws");
const { app, BrowserWindow, desktopCapturer, powerMonitor } = require("electron");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
app.setPath("userData", config.userDataDir);
app.setPath("sessionData", config.userDataDir);
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
const originalSources = desktopCapturer.getSources;
let enumerations = 0;
desktopCapturer.getSources = async () => {
  enumerations++;
  return [{ id: "window:synthetic:0", name: "Synthetic source only", display_id: "", appIcon: null,
    thumbnail: { toDataURL: () => "data:image/png;base64,dGVzdA==" } }];
};
const { MediaPermissions } = require("../dist/media-permissions.js");
const permissionTrace = [];
for (const method of ["check", "request", "display"]) {
  const original = MediaPermissions.prototype[method];
  MediaPermissions.prototype[method] = function (...args) {
    const result = original.apply(this, args);
    const details = method === "request" ? args[2] : args[3];
    permissionTrace.push(method === "display"
      ? { method, gesture: args[0].userGesture }
      : { method, permission: args[1], allowed: result,
        ownerMatches: args[0] === this.options.owner()?.contents,
        isMainFrame: details.isMainFrame, mediaTypes: details.mediaTypes,
        hasEmbeddingOrigin: Boolean(details.embeddingOrigin) });
    return result;
  };
}
const { startApp } = require("../dist/main.js");
const { createNodeHttpsTransport } = require("../dist/network/transport.js");
const { createCertificates, createFixture, PASSWORD } = require("./fixtures/https-fixture.cjs");

(async () => {
  let certificates, server, window, foreign;
  const checks = [];
  try {
    certificates = await createCertificates();
    server = await createFixture({ name: "media", certificates, notifyOnConnect: true });
    window = await startApp({ show: false, userDataDir: config.userDataDir, rendererRoot: config.rendererRoot,
      brokerOptions: { transport: createNodeHttpsTransport({ ca: certificates.ca, timeoutMs: 3000 }),
        createSocket: (url, protocols, options) => new WebSocket(url, protocols, { ...options, ca: certificates.ca, rejectUnauthorized: true }) } });
    const js = (code, gesture = false) => window.webContents.executeJavaScript(code, gesture);
    const call = (method, ...args) => js(`window.meetspaceDesktop[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
    const until = async (predicate, description) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const state = await js("({displayResult:window.__displayResult,displayEvents:window.__displayEvents.map(e=>e.type),focused:document.hasFocus(),activation:navigator.userActivation.isActive})");
      throw new Error(`${description}: ${JSON.stringify(state)}, enumerations=${enumerations}, permissions=${JSON.stringify(permissionTrace.slice(-8))}`);
    };
    await js("window.__events=[]; window.__displayEvents=[]; window.meetspaceDesktop.onTransportEvent(e=>window.__events.push(e)); window.meetspaceDesktop.onDisplayCaptureEvent(e=>window.__displayEvents.push(e)); void 0");
    // Run before any executeJavaScript(..., true): transient activation may outlive
    // a previous call and would make a later no-gesture probe accidentally valid.
    const noGesture = await js("Promise.race([navigator.mediaDevices.getDisplayMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return 'granted'},e=>e.name),new Promise(r=>setTimeout(()=>r('capture_timeout'),5000))])");
    assert.ok(["InvalidStateError", "NotAllowedError", "AbortError"].includes(noGesture), `Unexpected no-activation result: ${noGesture}`);
    assert.equal(enumerations, 0);
    checks.push("display request without user activation denied before source enumeration");
    const devices = await js("navigator.mediaDevices.getUserMedia({audio:true,video:true}).then(s=>{const kinds=s.getTracks().map(t=>t.kind).sort();s.getTracks().forEach(t=>t.stop());return {kinds,ended:s.getTracks().every(t=>t.readyState==='ended')}})", true);
    assert.deepEqual(devices, { kinds: ["audio", "video"], ended: true });
    checks.push("production permission handlers permit fake camera/microphone only in owned trusted window");
    foreign = new BrowserWindow({ show: false, webPreferences: { session: window.webContents.session,
      nodeIntegration: false, contextIsolation: true, sandbox: true } });
    await foreign.loadURL("app://meetspace/");
    const denied = await foreign.webContents.executeJavaScript("navigator.mediaDevices.getUserMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return 'granted'},e=>e.name)", true);
    assert.equal(denied, "NotAllowedError");
    foreign.destroy(); foreign = null;
    checks.push("foreign WebContents sharing the trusted origin/session is denied");
    const beginDisplay = () => js("window.__displayResult=null; navigator.mediaDevices.getDisplayMedia({video:true,audio:false}).then(s=>{s.getTracks().forEach(t=>t.stop());window.__displayResult='granted'},e=>{window.__displayResult=e.name}); void 0", true);
    await beginDisplay();
    await until(() => js("window.__displayEvents.some(e=>e.type==='request')"), "Picker event must cross isolated preload");
    const first = await js("window.__displayEvents.find(e=>e.type==='request')");
    assert.notEqual(first.sources[0].id, "window:synthetic:0");
    await assert.rejects(call("selectDisplaySource", { requestId: first.requestId, sourceId: "window:synthetic:0", systemAudio: false }));
    await call("cancelDisplaySource", first.requestId);
    await until(() => js("window.__displayResult !== null"), "Picker cancellation must settle browser capture request");
    assert.ok(["NotAllowedError", "AbortError"].includes(await js("window.__displayResult")));
    checks.push("production picker IPC emits opaque IDs and rejects forged selection; cancellation settles capture");
    await call("addServer", { origin: server.origin, label: "Media lifecycle fixture" });
    const profiles = await call("listServers");
    await call("selectServer", profiles.items[0].id);
    const login = await call("http", { id: "media-login", method: "POST", path: "/api/v1/auth/login",
      body: { email: server.users[0].email, password: PASSWORD }, responseType: "json" });
    assert.equal(login.status, 200);
    await call("openSocket", { id: "media-socket", kind: "account", token: login.body.accessToken });
    await call("openStream", { id: "media-stream", token: login.body.accessToken });
    await until(() => js("window.__events.some(e=>e.kind==='socket'&&e.type==='message')&&window.__events.some(e=>e.kind==='stream'&&e.type==='chunk')"), "WSS and SSE must be established before power event");
    await beginDisplay();
    await until(() => js("window.__displayEvents.filter(e=>e.type==='request').length===2"), "Second picker request must be pending");
    powerMonitor.emit("suspend");
    await until(() => js("window.__events.some(e=>e.kind==='lifecycle'&&e.type==='suspend')&&window.__events.some(e=>e.kind==='socket'&&e.id==='media-socket'&&e.type==='close'&&e.code===1012)&&window.__events.some(e=>e.kind==='stream'&&e.id==='media-stream'&&e.type==='error')&&['NotAllowedError','AbortError'].includes(window.__displayResult)"), "Native suspend event must cancel picker, WSS and SSE and notify the renderer");
    powerMonitor.emit("resume");
    await until(() => js("window.__events.some(e=>e.kind==='lifecycle'&&e.type==='resume')"), "Resume event must reach renderer");
    await call("openSocket", { id: "media-after-resume", kind: "account", token: login.body.accessToken });
    await until(() => js("window.__events.some(e=>e.kind==='socket'&&e.id==='media-after-resume'&&e.type==='message')"), "Broker must reconnect after power events");
    checks.push("simulated native power events cancel capture/WSS/SSE and allow credential-preserving reconnect");

    // Separate supported-API smoke: this bypasses source selection only within this
    // test, captures the synthetic application tab, and never captures the desktop.
    window.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
      assert.equal(request.frame, window.webContents.mainFrame);
      assert.equal(request.userGesture, true);
      callback({ video: request.frame });
    });
    const captured = await js("navigator.mediaDevices.getDisplayMedia({video:true,audio:false}).then(s=>{const t=s.getVideoTracks()[0];const value={live:t.readyState==='live',kind:t.kind};s.getTracks().forEach(track=>track.stop());return {...value,ended:t.readyState==='ended'}})", true);
    assert.deepEqual(captured, { live: true, kind: "video", ended: true });
    checks.push("separate own-tab synthetic handler exercises real getDisplayMedia track creation and cleanup");
    console.log(JSON.stringify({ result: "PASS", checks, platform: process.platform, arch: process.arch,
      electron: process.versions.electron, physicalDevicesUsed: false, desktopPixelsCaptured: false,
      physicalSleepTested: false, windowsRuntimeTested: false }));
  } finally {
    desktopCapturer.getSources = originalSources;
    if (foreign && !foreign.isDestroyed()) foreign.destroy();
    if (window && !window.isDestroyed()) window.destroy();
    if (server) await server.close();
    if (certificates) await certificates.close();
  }
  app.quit();
})().catch((error) => { console.error("Electron media policy test failed:", error.message); app.exit(1); });
