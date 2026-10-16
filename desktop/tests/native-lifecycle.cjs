"use strict";
// Stage07 local lifecycle counters. No Electron process or native OS popup is started.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const Module = require("node:module");
const { EventEmitter, getEventListeners } = require("node:events");
const { randomUUID, createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { NativeNotifications } = require("../dist/native-notifications.js");
const { createCertificates } = require("./fixtures/https-fixture.cjs");
const { createAssetsFixture, asset } = require("./fixtures/assets-fixture.cjs");
const root = path.resolve(__dirname, "../..");
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function collect() { for (let i = 0; i < 3; i++) { await nextTurn(); global.gc(); } await nextTurn(); }
function timers() {
  const active = new Set(); let peak = 0, created = 0;
  return { active, get peak() { return peak; }, get created() { return created; },
    setTimeout(callback, delay, ...args) { const timer = setTimeout(() => { active.delete(timer); callback(...args); }, delay); active.add(timer); peak = Math.max(peak, active.size); created++; return timer; },
    clearTimeout(timer) { active.delete(timer); clearTimeout(timer); },
  };
}
function instrumented(name, clock, dependencies = {}) {
  const filename = path.join(__dirname, "../dist", `${name}.js`), exports = {};
  const requireLocal = Module.createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { exports, module: { exports }, __filename: filename, __dirname: path.dirname(filename),
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : requireLocal(name),
    process, Buffer, Error, URL, TextEncoder, TextDecoder, Request, Response, ReadableStream, queueMicrotask,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, console,
  }, { filename });
  return exports;
}

async function shellProfile() {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "meetspace-shell-lifecycle-"));
  const clock = timers(), screen = new EventEmitter(), refs = [];
  const workArea = { x: 0, y: 0, width: 1280, height: 900 };
  screen.getPrimaryDisplay = () => ({ workArea }); screen.getAllDisplays = () => [{ workArea }];
  let liveTray = 0, current = null, peakScreenListeners = 0;
  class FakeTray extends EventEmitter {
    constructor() { super(); this.dead = false; liveTray++; }
    setToolTip() {} setContextMenu() {} isDestroyed() { return this.dead; }
    destroy() { if (!this.dead) { this.dead = true; liveTray--; } }
  }
  const { NativeShell } = instrumented("native-shell", clock, { electron: {
    app: { getPath: () => directory, getAppPath: () => path.join(root, "desktop"), isPackaged: false },
    Menu: { buildFromTemplate: template => template }, nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    Notification: { isSupported: () => true }, screen, Tray: FakeTray,
  } });
  const shell = new NativeShell({ window: () => current, quit() {}, hide() {}, preferencesChanged() {} });
  function cycle() {
    const window = new EventEmitter(); let destroyed = false;
    Object.assign(window, { isDestroyed: () => destroyed, isFullScreen: () => false, isMaximized: () => false,
      isMinimized: () => false, isVisible: () => true, getNormalBounds: () => workArea,
      setMinimumSize() {}, setBounds() {}, maximize() {}, unmaximize() {} });
    refs.push(new WeakRef(window)); current = window; shell.configureWindow(window);
    for (let i = 0; i < 10; i++) { window.emit("move"); window.emit("resize"); }
    peakScreenListeners = Math.max(peakScreenListeners, screen.listenerCount("display-removed") + screen.listenerCount("display-metrics-changed"));
    assert.equal(clock.active.size, 1, "move/resize debounce is bounded to one timer");
    screen.emit("display-metrics-changed");
    destroyed = true; window.emit("closed"); current = null;
    assert.equal(clock.active.size, 0);
    assert.equal(screen.listenerCount("display-removed") + screen.listenerCount("display-metrics-changed"), 0);
  }
  try {
    for (let i = 0; i < 10; i++) cycle();
    await collect(); const before = { timers: clock.active.size, screenListeners: screen.eventNames().reduce((count, name) => count + screen.listenerCount(name), 0) };
    for (let i = 0; i < 100; i++) cycle();
    shell.dispose(); shell.dispose();
    await collect();
    const retainedWindows = refs.filter(ref => ref.deref()).length;
    assert.equal(retainedWindows, 0, "closed test window objects are collectable"); assert.equal(liveTray, 0);
    return { environment: "EventEmitter window/screen/Tray adapters; production NativeShell and filesystem persistence code", warmupCycles: 10, measuredCycles: 100,
      before, after: { timers: clock.active.size, screenListeners: screen.eventNames().length, liveTrayAdapters: liveTray, retainedWindowAdaptersAfterGC: retainedWindows },
      peakGeometryTimers: clock.peak, peakScreenListeners, debounceEventsPerCycle: 20 };
  } finally { shell.dispose(); await fsp.rm(directory, { recursive: true, force: true }); }
}

async function captureProfile() {
  const clock = timers(); const { MediaPermissions } = instrumented("media-permissions", clock);
  const source = { id: "screen:fixture:0", name: "Synthetic source", thumbnail: { toDataURL: () => "data:image/png;base64,dGVzdA==" } };
  const contents = { isDestroyed: () => false }; let frame = { url: "app://meetspace/" }, lookup;
  let preview = true, lastRequest, callbackCount = 0, grants = 0, cancelled = 0, lateSettled = 0, expired = 0;
  const permissions = new MediaPermissions({ owner: () => ({ contents, frame }), development: false, platform: "win32", timeoutMs: 5,
    getSources: async thumbnails => { preview = thumbnails; return lookup ? lookup.promise : [source]; },
    emit: event => { if (event.type === "request") lastRequest = event; },
  });
  async function cycle(index) {
    const before = callbackCount, mode = index % 4;
    lookup = mode === 2 ? deferred() : null;
    const display = permissions.display({ frame, securityOrigin: "app://meetspace", userGesture: true, videoRequested: true, audioRequested: true },
      streams => { callbackCount++; if (streams) grants++; else cancelled++; });
    if (mode === 2) { permissions.cancel(); const delayed = lookup; lookup = null; delayed.resolve([source]); await display; lateSettled++; }
    else {
      await display;
      if (mode === 0) {
        await permissions.select({ requestId: lastRequest.requestId, sourceId: lastRequest.sources[0].id, systemAudio: false });
        assert.equal(preview, false);
      } else if (mode === 1) { frame = { url: "app://meetspace/" }; permissions.cancel(); permissions.cancel(); }
      else { await pause(10); expired++; }
    }
    assert.equal(callbackCount - before, 1, "every request settles once, including cancellation and timeout");
    assert.equal(permissions.pending, null); assert.equal(clock.active.size, 0);
  }
  for (let i = 0; i < 12; i++) await cycle(i);
  const before = { pending: Number(permissions.pending !== null), timers: clock.active.size };
  const start = { grants, cancelled, lateSettled, expired };
  for (let i = 0; i < 100; i++) await cycle(i);
  permissions.cancel();
  return { environment: "Production permission controller; synthetic source enumeration and callbacks, no OS capture", warmupCycles: 12, measuredCycles: 100,
    before, after: { pending: Number(permissions.pending !== null), timers: clock.active.size }, peakTimers: clock.peak,
    selected: grants - start.grants, cancelled: cancelled - start.cancelled, lateEnumerationsIgnored: lateSettled - start.lateSettled, timeouts: expired - start.expired };
}

async function notificationProfile() {
  const active = new Set(), refs = []; let created = 0, closed = 0, peakVisible = 0, peakSeen = 0, routes = 0;
  const userId = "10000000-0000-4000-8000-000000000001", conversationId = "20000000-0000-4000-8000-000000000001";
  const now = Date.parse("2026-10-14T00:00:00Z");
  const clickObsolete = handles => { for (const handle of handles) handle.emit("click"); handles.length = 0; };
  const notices = new NativeNotifications({ supported: () => true, isFocused: () => false, navigate: () => { routes++; }, clock: () => now,
    create: () => {
      const handle = new EventEmitter(); refs.push(new WeakRef(handle)); created++;
      handle.show = () => active.add(handle);
      handle.close = () => { if (active.delete(handle)) closed++; handle.emit("close"); };
      return handle;
    },
  });
  function activate(index) {
    notices.setIdentity({ profileId: index.toString(16).padStart(32, "0"), userId });
    notices.setPreferences({ invitation: true, reminder: true, recording: true, summary: true });
    notices.setContext({ route: "/personal", soundEnabled: true });
  }
  function deliver() {
    const id = randomUUID();
    notices.observe({ version: 1, id, type: "notification.created", data: { notification: { id, userId, version: 1, type: "chat.message",
      createdAt: new Date(now).toISOString(), readAt: null, payload: { conversationId, conversationType: "direct", messageId: randomUUID() } } } });
    peakVisible = Math.max(peakVisible, notices.visible.size); peakSeen = Math.max(peakSeen, notices.seen.size);
  }
  for (let i = 0; i < 10; i++) { activate(i); for (let n = 0; n < 20; n++) deliver(); notices.setIdentity(null); }
  await collect(); const before = { visible: notices.visible.size, dedup: notices.seen.size, activeAdapters: active.size };
  const startCreated = created, startClosed = closed;
  for (let i = 0; i < 100; i++) {
    activate(i + 10); for (let n = 0; n < 20; n++) deliver();
    const obsolete = [...active];
    // Equivalent service cleanup called by renderer document/crash paths, followed by identity invalidation.
    notices.setContext(null); notices.setIdentity(null);
    clickObsolete(obsolete); // Keep temporary strong references out of this async frame's GC checkpoint.
    assert.equal(routes, 0, "stale OS click callbacks cannot navigate after a reset");
    assert.equal(active.size, 0); assert.equal(notices.visible.size, 0); assert.equal(notices.seen.size, 0);
  }
  activate(1000); for (let i = 0; i < 600; i++) deliver();
  assert.equal(notices.visible.size, 8); assert.equal(notices.seen.size, 512);
  notices.dispose(); notices.dispose(); await collect();
  const retainedHandles = refs.filter(ref => ref.deref()).length;
  assert.equal(retainedHandles, 0, "closed EventEmitter notification adapters are collectable");
  assert.equal(active.size, 0); assert.equal(notices.blocked.size + notices.readThrough.size + notices.seen.size + notices.visible.size, 0);
  return { environment: "Production notification policy with EventEmitter OS adapters; no actual notification centre delivery", warmupCycles: 10,
    measuredCycles: 100, messagesPerCycle: 20, additionalBurst: 600, before,
    after: { visible: notices.visible.size, dedup: notices.seen.size, activeAdapters: active.size, retainedAdaptersAfterGC: retainedHandles },
    createdDuringMeasurement: created - startCreated, closedDuringMeasurement: closed - startClosed, peakVisible, peakSeen, staleNavigations: routes };
}

async function assetProfile() {
  const certificates = await createCertificates(); let fixture;
  const clock = timers(), { NativeAssets } = instrumented("downloads", clock);
  const leases = new Set(), leaseRefs = []; let authorized = 0, released = 0, completed = 0, aborted = 0, saved = 0, saveCancelled = 0;
  let peakJobs = 0, peakMedia = 0, peakRequests = 0, progressId = null, cancelOnProgress = false;
  try {
    fixture = await createAssetsFixture(certificates);
    const authorize = fixture.broker.authorizeAsset.bind(fixture.broker);
    const broker = { nativeIdentity: token => fixture.broker.nativeIdentity(token), cancel: id => fixture.broker.cancel(id),
      authorizeAsset: async input => {
        const lease = await authorize(input), release = lease.release; authorized++; leases.add(lease); leaseRefs.push(new WeakRef(lease));
        lease.release = () => { if (leases.delete(lease)) released++; release(); };
        return lease;
      } };
    const destination = path.join(fixture.directory, "saved.mp4");
    const assets = new NativeAssets({ broker, cacheDir: path.join(fixture.directory, "cache"), chooseSavePath: async () => destination,
      emit: () => { if (cancelOnProgress && progressId) { const id = progressId; progressId = null; assets.cancel(id); } } });
    await assets.initialize();
    const input = () => ({ id: randomUUID(), token: fixture.marker, asset });
    const sample = () => {
      peakJobs = Math.max(peakJobs, assets.jobs.size); peakMedia = Math.max(peakMedia, assets.media.size);
      peakRequests = Math.max(peakRequests, [...assets.media.values()].reduce((sum, entry) => sum + entry.requests.size, 0));
    };
    const cleared = () => {
      assert.equal(assets.jobs.size, 0); assert.equal(assets.media.size, 0); assert.equal(clock.active.size, 0);
      assert.equal(leases.size, 0); assert.equal(fixture.broker.operations.size, 0);
    };
    async function cycle(index) {
      const opened = await assets.open(input()); sample();
      const request = new Request(opened.url, index % 2 ? {} : { headers: { Range: "bytes=32768-65535" } });
      const response = await assets.handleMedia(request); sample();
      if (index % 2) {
        assert.equal(response.status, 200); const rejected = assert.rejects(response.arrayBuffer());
        assets.reset(); await rejected; aborted++;
      } else {
        assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 32768); completed++; assets.close(opened.id);
      }
      await nextTurn(); cleared();
      assert.equal(getEventListeners(request.signal, "abort").length, 0, "Range request abort listener detached");
      const saveInput = input(); cancelOnProgress = Boolean(index % 2); progressId = saveInput.id;
      if (cancelOnProgress) { await assert.rejects(assets.save(saveInput), /request_cancelled|stale_request/); saveCancelled++; }
      else { assert.equal((await assets.save(saveInput)).saved, true); saved++; }
      progressId = null; cancelOnProgress = false; cleared();
      assert.equal((await fsp.readdir(fixture.directory)).some(name => name.endsWith(".part")), false);
      // The fixture records requests for assertions; clear its diagnostic histories before heap measurement.
      fixture.seen.length = 0; fixture.api.requests.length = 0;
    }
    await pause(10); for (let i = 0; i < 10; i++) await cycle(i);
    await collect(); const before = { jobs: assets.jobs.size, media: assets.media.size, timers: clock.active.size, leases: leases.size, brokerOperations: fixture.broker.operations.size };
    const heapBefore = process.memoryUsage().heapUsed;
    const start = { authorized, released, completed, aborted, saved, saveCancelled };
    for (let i = 0; i < 100; i++) await cycle(i);
    // Exercise dispose with an active, unread stream, not just an already-empty service.
    const openAtDispose = await assets.open(input()); const requestAtDispose = new Request(openAtDispose.url);
    const responseAtDispose = await assets.handleMedia(requestAtDispose); sample();
    const rejectedAtDispose = assert.rejects(responseAtDispose.arrayBuffer());
    await assets.dispose(); await rejectedAtDispose; await assets.dispose();
    assert.equal(getEventListeners(requestAtDispose.signal, "abort").length, 0);
    assert.equal(assets.jobs.size + assets.media.size + leases.size + fixture.broker.operations.size, 0);
    fixture.seen.length = 0; fixture.api.requests.length = 0;
    await pause(20); await collect(); const heapAfter = process.memoryUsage().heapUsed;
    const livingLeaseRefs = leaseRefs.filter(ref => ref.deref()).map(ref => ref.deref());
    const liveAbortListeners = livingLeaseRefs.reduce((sum, lease) => sum + getEventListeners(lease.signal, "abort").length, 0);
    assert.equal(liveAbortListeners, 0);
    assert.equal(await fsp.stat(path.join(fixture.directory, "cache")).catch(() => null), null);
    return { result: clock.active.size === 0 ? "PASS" : "FAIL", environment: "Production NativeAssets + broker + Node HTTPS transport, two trusted local TLS fixture servers; real disk writes", warmupCycles: 10, measuredCycles: 100,
      before, after: { jobs: assets.jobs.size, media: assets.media.size, timers: clock.active.size, leases: leases.size,
        brokerOperations: fixture.broker.operations.size, abortListenersOnStillReachableLeases: liveAbortListeners, partialFiles: 0, cacheDirectories: 0 },
      completedRanges: completed - start.completed, abortedStreams: aborted - start.aborted, savedFiles: saved - start.saved,
      cancelledSaves: saveCancelled - start.saveCancelled, extraActiveStreamDisposed: 1,
      authorizedLeases: authorized - start.authorized, releasedLeases: released - start.released, peakJobs, peakMedia, peakConcurrentStreamRequests: peakRequests,
      peakPlaybackTimers: clock.peak, nodeHarnessHeapAfterGC: { beforeBytes: heapBefore, afterBytes: heapAfter, deltaBytes: heapAfter - heapBefore,
        limitation: "Whole Node fixture process, not Electron main/renderer; one endpoint delta is not evidence of a retained-object leak" } };
  } finally { await fixture?.close(); await certificates.close(); }
}

(async () => {
  if (!global.gc) throw new Error("Run this diagnostic with node --expose-gc; GC measurements must be explicit");
  const sources = Object.fromEntries(["native-shell", "native-notifications", "media-permissions", "downloads"].map(name => [name, {
    sourceSha256: sha256(fs.readFileSync(path.join(root, "desktop/src", `${name}.ts`))),
    compiledSha256: sha256(fs.readFileSync(path.join(root, "desktop/dist", `${name}.js`))),
  }]));
  const report = { schemaVersion: 1, collectedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.version,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), sources,
    scope: "Local Node native-service lifecycle baseline with explicit adapters; Windows runtime and Electron process metrics NOT_MEASURED", profile: {} };
  report.profile.shell = await shellProfile(); report.profile.capture = await captureProfile();
  report.profile.notifications = await notificationProfile(); report.profile.assets = await assetProfile();
  report.result = Object.values(report.profile).some(value => value.result === "FAIL") ? "FAIL" : "PASS";
  const filename = path.join(root, "desktop/artifacts/stage07-native-lifecycle.json");
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  await fsp.writeFile(filename, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "PASS") process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
