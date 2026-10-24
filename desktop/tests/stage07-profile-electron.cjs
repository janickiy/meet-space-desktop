// Actual shared production React renderer, main and preload. Test-only observation,
// synthetic TLS server and power events; never imported or packaged by production.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { app, ipcMain, powerMonitor } = require('electron');
const WebSocket = require('ws');
const { PASSWORD } = require('./fixtures/https-fixture.cjs');
const { DIRECT } = require('./fixtures/product-fixture.cjs');
const { collectLinuxProcessMetrics } = require('./helpers/linux-process-metrics.cjs');
const { observeRendererJank } = require('./helpers/renderer-jank-observer.cjs');
const profileStartedAt = performance.now();
const config = JSON.parse(syncFs.readFileSync(process.argv[2], 'utf8'));
app.setPath('userData', config.userDataDir); app.setPath('sessionData', config.userDataDir);
v8.setFlagsFromString('--expose_gc');
const collectMain = vm.runInNewContext('gc');
const owned = {};
// Observe existing instances through methods. No extra production exports/IPC.
for (const [module, name, method, key] of [
  ['broker', 'MeetSpaceBroker', 'initialize', 'broker'],
  ['downloads', 'NativeAssets', 'initialize', 'assets'],
  ['updates', 'NativeUpdates', 'initialize', 'updates'],
  ['native-shell', 'NativeShell', 'configureWindow', 'shell'],
  ['native-notifications', 'NativeNotifications', 'setIdentity', 'notifications'],
]) {
  const prototype = require(`../dist/${module}.js`)[name].prototype;
  const original = prototype[method];
  prototype[method] = function (...args) { owned[key] = this; return original.apply(this, args); };
}
const timers = new Map();
const originalTimers = { setTimeout, clearTimeout, setInterval, clearInterval };
for (const kind of ['Timeout', 'Interval']) {
  global[`set${kind}`] = (callback, delay, ...args) => {
    const application = new Error().stack.includes(path.resolve(__dirname, '../dist') + path.sep);
    let handle;
    handle = originalTimers[`set${kind}`]((...values) => {
      if (kind === 'Timeout') timers.delete(handle);
      callback(...values);
    }, delay, ...args);
    if (application) timers.set(handle, kind);
    return handle;
  };
  global[`clear${kind}`] = handle => { timers.delete(handle); originalTimers[`clear${kind}`](handle); };
}
const { startApp } = require('../dist/main.js');
const { createNodeHttpsTransport } = require('../dist/network/transport.js');
const sleep = ms => new Promise(resolve => originalTimers.setTimeout(resolve, ms));
const sockets = new Set();
let socketsCreated = 0, socketsClosed = 0;
const evidenceDir = config.evidenceDir ?? path.resolve(__dirname, '../artifacts');
const report = { schemaVersion: 1, phase: config.phase, collectedAt: new Date().toISOString(),
  platform: process.platform, arch: process.arch, electron: process.versions.electron, chromium: process.versions.chrome,
  sourceTreeSha256: config.sourceTreeSha256,
  scope: 'Actual main/preload/shared React UI; parent-process disposable HTTPS/WSS/SSE fixture; synthetic power events',
  windowsRuntimeTested: process.platform === 'win32', samples: [], checks: [], notMeasured: ['Windows HANDLE count', 'physical sleep/wake', 'camera/microphone/screen devices', 'physical-machine idle CPU'],
};
let window, jankObserver;
const watchdog = originalTimers.setTimeout(() => { console.error('Profile watchdog'); app.exit(1); }, 225_000);
const listeners = emitter => Object.fromEntries(emitter.eventNames().filter(name => typeof name === 'string').sort().map(name => [name, emitter.listenerCount(name)]));
const size = value => value?.size ?? 0;
const resources = () => ({ brokerOperations: size(owned.broker.operations), brokerSockets: size(owned.broker.sockets),
  brokerStreams: size(owned.broker.streams), nativeWs: sockets.size, assetJobs: size(owned.assets.jobs), mediaLeases: size(owned.assets.media),
  appTimers: timers.size, visibleNotifications: size(owned.notifications?.visible), windows: require('electron').BrowserWindow.getAllWindows().length,
  tray: !!owned.shell.tray && !owned.shell.tray.isDestroyed(), listeners: { app: listeners(app), power: listeners(powerMonitor),
    ipc: listeners(ipcMain), window: listeners(window), webContents: listeners(window.webContents) } });
const lsof = pids => {
  if (process.platform !== 'darwin') return { status: 'NOT_MEASURED', reason: 'This diagnostic uses macOS lsof' };
  try {
    const output = execFileSync('/usr/sbin/lsof', ['-nP', '-Fpf', '-p', pids.join(',')], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const counts = {}; let pid;
    for (const line of output.split('\n')) { if (/^p\d+$/.test(line)) { pid = line.slice(1); counts[pid] = 0; } else if (/^f\d+/.test(line) && pid) counts[pid]++; }
    return { status: 'MEASURED', counts, total: Object.values(counts).reduce((a,b) => a+b,0) };
  } catch { return { status: 'NOT_MEASURED', reason: 'lsof unavailable or target process exited' }; }
};
(async () => {
  try {
    await fs.mkdir(evidenceDir, { recursive: true });
    const ca = await fs.readFile(config.caPath);
    window = await startApp({ show: false, rendererRoot: path.resolve(__dirname, '../renderer'), brokerOptions: {
      transport: createNodeHttpsTransport({ ca, timeoutMs: 2000 }),
      createSocket: (url, protocols, options) => { const socket = new WebSocket(url, protocols, { ...options, ca, rejectUnauthorized: true });
        socketsCreated++; sockets.add(socket); socket.once('close', () => { socketsClosed++; sockets.delete(socket); }); return socket; },
    } });
    assert.ok(window);
    const execute = code => window.webContents.executeJavaScript(code, true);
    const until = async (predicate, label, timeout = 12000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) { if (await predicate()) return; await sleep(30); }
      throw new Error(`Profile: ${label}`);
    };
    const visible = text => until(() => execute(`document.body.innerText.includes(${JSON.stringify(text)})`), `UI missing ${text}`);
    const click = selector => execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const field = (selector, value) => execute(`(() => {const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    // Pace actual browser history commits: unpaced IPC navigation can hit
    // Chromium's same-document navigation flood limit, unlike a human session.
    const route = async value => { await sleep(180); window.webContents.send('meetspace:route', value); await until(() => execute(`location.pathname === ${JSON.stringify(value)}`), 'route'); };
    const bridge = (method, ...args) => execute(`window.meetspaceDesktop[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
    const idleConnections = () => until(() => owned.broker.operations.size === 0 && owned.broker.sockets.size === 1 && owned.broker.streams.size === 1 && sockets.size === 1, 'one account WS and one notification SSE');
    await visible('Подключиться к серверу');
    report.startup = { harnessToConnectScreenMs: performance.now() - profileStartedAt,
      scope: 'Instrumented main start to shared React connection screen; existing filesystem cache, not cold-boot performance' };
    if (config.visible) { window.show(); jankObserver = await observeRendererJank(window.webContents); }
    else report.jank = { status: 'NOT_MEASURED', reason: 'Hidden window RAF is throttled; use --visible in a dedicated display' };
    await field('#desktop-server-origin', config.alpha.origin);
    await click('.desktop-server-form button[type=submit]');
    await until(() => execute('!!document.querySelector("#email")'), 'login screen');
    await field('#email', config.alpha.email); await field('#password', PASSWORD); await click('#auth-form button[type=submit]');
    await route('/personal'); await visible('Product direct private message'); await idleConnections();
    const chatCycle = async () => { await route(`/personal/${DIRECT}`); await visible('Product server message'); await route('/personal'); await visible('Product direct private message'); };
    for (let i = 0; i < 10; i++) await chatCycle();
    const debug = window.webContents.debugger;
    const attach = async () => { if (!debug.isAttached()) debug.attach('1.3'); await debug.sendCommand('Performance.enable'); };
    await attach();
    const snapshot = async label => {
      collectMain(); await debug.sendCommand('HeapProfiler.collectGarbage'); await sleep(150);
      const rendererHeap = await debug.sendCommand('Runtime.getHeapUsage');
      const dom = await debug.sendCommand('Memory.getDOMCounters');
      const processes = app.getAppMetrics().map(item => ({ pid: item.pid, type: item.type, name: item.name,
        workingSetKiB: item.memory.workingSetSize, peakWorkingSetKiB: item.memory.peakWorkingSetSize,
        cpuPercent: item.cpu.percentCPUUsage, cumulativeCPUUsage: item.cpu.cumulativeCPUUsage }));
      const sample = { label, socketsCreated, socketsClosed, resources: resources(), mainHeap: v8.getHeapStatistics(), mainMemory: process.memoryUsage(), rendererHeap, dom,
        processes, fd: process.platform === 'linux' ? collectLinuxProcessMetrics(processes) : lsof(processes.map(item => item.pid)),
        jank: jankObserver ? await jankObserver.snapshot() : null };
      report.samples.push(sample);
      console.log(JSON.stringify({ phase: config.phase, checkpoint: label, mainHeapBytes: sample.mainMemory.heapUsed,
        rendererHeapBytes: rendererHeap.usedSize, dom, resources: { ...sample.resources, listeners: undefined }, processCount: processes.length, fd: sample.fd }));
    };
    const heaps = async label => {
      collectMain();
      const mainPath = path.join(evidenceDir, `stage07-${config.phase}-${label}-main.heapsnapshot`);
      v8.writeHeapSnapshot(mainPath);
      const rendererPath = path.join(evidenceDir, `stage07-${config.phase}-${label}-renderer.heapsnapshot`);
      const handle = syncFs.openSync(rendererPath, 'w', 0o600);
      const onChunk = (_event, method, params) => { if (method === 'HeapProfiler.addHeapSnapshotChunk') syncFs.writeSync(handle, params.chunk); };
      debug.on('message', onChunk);
      try { await debug.sendCommand('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); }
      finally { debug.removeListener('message', onChunk); syncFs.closeSync(handle); }
    };
    await sleep(2500); await snapshot('warmup'); await heaps('warmup');
    for (let i=1; i<=100; i++) { await chatCycle(); if (i%25===0) { await idleConnections(); await sleep(350); await snapshot(`chat-${i}`); } }
    await sleep(2500); await snapshot('settled'); await heaps('settled');
    report.chatReconnects = { created: report.samples.at(-1).socketsCreated-report.samples[0].socketsCreated,
      closed: report.samples.at(-1).socketsClosed-report.samples[0].socketsClosed };
    report.checks.push('100 actual shared React personal chat open/close cycles after 10 warmup cycles');
    const initial = report.samples[0].resources, settled = report.samples.at(-1).resources;
    assert.deepEqual(settled, initial, 'Application-owned resources and event listeners return to warmup');
    report.checks.push('Application-owned maps, sockets, streams, timers, tray, window and EventEmitter listeners return to warmup counts');
    // Fresh metadata socket/SSE capabilities exercise main open/close independently of React.
    const marker = owned.broker.identity.marker;
    for (let i=0; i<100; i++) {
      const id = `profile-${i}`;
      await bridge('openSocket', { id, kind: 'account', token: marker });
      await until(() => owned.broker.sockets.get(id)?.socket?.readyState === WebSocket.OPEN, 'extra socket open');
      await bridge('closeSocket', id);
      await bridge('openStream', { id, token: marker });
      await bridge('closeStream', id);
    }
    await idleConnections(); report.checks.push('100 additional typed IPC native WSS/SSE open/close cycles');
    if (jankObserver) report.jank = { status: 'MEASURED', ...(await jankObserver.stop()),
      scope: 'Instrumented mapped renderer, including forced GC and heap capture; display/backend must be recorded separately; not physical smoothness acceptance' };
    // Stop the RAF observer before quiet CPU measurement so it cannot drive repaint work.
    // CPU is per logical core over a fixed 5 s quiet interval; system noise may vary.
    const cpuBefore = app.getAppMetrics(); await sleep(5000); const cpuAfter = app.getAppMetrics();
    report.idleCPU = { seconds: 5, processes: cpuAfter.map(item => {
      const before = cpuBefore.find(x => x.pid===item.pid);
      return { type: item.type, pid: item.pid, percentOneCore: before ? (item.cpu.cumulativeCPUUsage-before.cpu.cumulativeCPUUsage)/5*100 : null };
    }) };
    const epoch = owned.broker.epoch;
    powerMonitor.emit('suspend'); powerMonitor.emit('resume'); await idleConnections();
    assert.ok(owned.broker.epoch > epoch); report.checks.push('Synthetic suspend/resume invalidates old connections and shared UI reconnects');
    const crashed = new Promise(resolve => window.webContents.once('render-process-gone', resolve));
    window.webContents.forcefullyCrashRenderer(); await crashed;
    await until(() => !owned.broker.sockets.size && !owned.broker.streams.size && !owned.assets.jobs.size && !sockets.size, 'renderer crash releases native resources');
    window.webContents.reload(); await visible('Product direct private message'); await idleConnections(); await attach();
    report.checks.push('Actual Chromium renderer crash releases native resources; reload restores auth and realtime');
    const servers = await bridge('addServer', { origin: config.beta.origin, label: 'QA second server' });
    const betaId = servers.items.find(item=>item.origin===config.beta.origin).id;
    await bridge('selectServer', betaId);
    await until(() => !owned.broker.sockets.size && !owned.broker.streams.size && !sockets.size, 'server switch detaches Alpha');
    assert.equal(owned.broker.identity, null);
    await visible('Войти'); report.checks.push('Server switch releases native connections and removes previous identity');
    report.result = 'PASS';
    await fs.writeFile(path.join(evidenceDir, `stage07-profile-${config.phase}.json`), JSON.stringify(report, null, 2)+'\n');
    console.log(JSON.stringify({result: report.result, checks: report.checks, idleCPU: report.idleCPU}));
    originalTimers.clearTimeout(watchdog); app.quit();
  } catch (error) {
    report.result='FAIL'; report.error=error.message;
    await fs.writeFile(path.join(evidenceDir, `stage07-profile-${config.phase}.json`), JSON.stringify(report, null, 2)+'\n');
    console.error(error.stack); originalTimers.clearTimeout(watchdog); app.exit(1);
  }
})();
