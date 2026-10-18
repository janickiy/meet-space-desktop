// Trusted test entry; all Linux native integration and permission APIs are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const WebSocket = require('ws');
const { app, BrowserWindow, Menu } = require('electron');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const secondary = process.argv.includes('--secondary');
app.setPath('userData', config.profile); app.setPath('sessionData', config.profile);
const { startApp } = require('../dist/main.js');
const { createNodeHttpsTransport } = require('../dist/network/transport.js');
const { createCertificates, PASSWORD, CONFERENCE } = require('./fixtures/https-fixture.cjs');
const { createAssetsFixture, asset } = require('./fixtures/assets-fixture.cjs');
const exec = promisify(execFile), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, label, timeout = 15000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await predicate()) return; await sleep(100); } throw new Error('condition_timeout: ' + label); };
const hash = value => createHash('sha256').update(value).digest('hex');
async function bus(args) { const { stdout } = await exec('/usr/bin/busctl', ['--user', '--json=short', '--timeout=2', '--', ...args], { timeout: 3000, maxBuffer: 128 * 1024 }); return JSON.parse(stdout); }
const method = async (name, signature, ...args) => (await bus(['call', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', name, ...(signature ? [signature, ...args] : [])])).data[0];
async function trayInventory() {
  const exists = await method('NameHasOwner', 's', 'org.kde.StatusNotifierWatcher');
  if (!exists) return { watcherPresent: false, hostRegistered: false, ownItems: [], hosts: [] };
  const owner = await method('GetNameOwner', 's', 'org.kde.StatusNotifierWatcher');
  const watcherPid = await method('GetConnectionUnixProcessID', 's', owner);
  const hostRegistered = (await bus(['get-property', 'org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.kde.StatusNotifierWatcher', 'IsStatusNotifierHostRegistered'])).data === true;
  const registered = (await bus(['get-property', 'org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems'])).data;
  assert.ok(Array.isArray(registered) && registered.length <= 128);
  const names = await method('ListNames'); assert.ok(Array.isArray(names));
  const hosts = [];
  for (const name of names.filter(value => /^org\.(?:kde|freedesktop)\.StatusNotifierHost[-.]/.test(value)).slice(0, 16)) { try { const hostOwner = await method('GetNameOwner', 's', name); hosts.push({ name, pid: await method('GetConnectionUnixProcessID', 's', hostOwner) }); } catch {} }
  const ownItems = [];
  for (const item of registered.slice(0, 32)) {
    if (typeof item !== 'string') continue;
    const slash = item.indexOf('/'), service = slash < 0 ? item : item.slice(0, slash), objectPath = slash < 0 ? '/StatusNotifierItem' : item.slice(slash);
    try { const itemOwner = await method('GetNameOwner', 's', service), pid = await method('GetConnectionUnixProcessID', 's', itemOwner); if (pid === process.pid) ownItems.push({ service, objectPath, pid }); } catch {}
  }
  return { watcherPresent: true, watcherPid, hostRegistered, ownItems, hosts, registeredItemCount: registered.length };
}
async function menuExport(item) {
  const menuPath = (await bus(['get-property', item.service, item.objectPath, 'org.kde.StatusNotifierItem', 'Menu'])).data;
  assert.equal(typeof menuPath, 'string');
  const layout = await bus(['call', item.service, menuPath, 'com.canonical.dbusmenu', 'GetLayout', 'iias', '0', '-1', '4', 'label', 'enabled', 'visible', 'children-display']);
  const text = JSON.stringify(layout), labels = ['Открыть MeetSpace', 'Скрыть в трей', 'Выход из MeetSpace'].filter(label => text.includes(label));
  assert.equal(labels.length, 3, 'actual exported DBus menu contains production actions');
  return { objectPath: menuPath, labels, boundedLayoutBytes: Buffer.byteLength(text), layoutSha256: hash(text), interaction: 'read-only GetLayout; no external DBus Event or fake menu APIs' };
}
const report = { schemaVersion: 1, result: 'FAIL', phase: config.phase, platform: process.platform, arch: process.arch, kernel: os.release(), versions: process.versions,
  sourceInputs: config.sourceInputs, buildMetadata: config.buildMetadata, harnessInputs: config.harnessInputs, nativeApiTestDoubles: [], productionRequests: 0,
  fixtureBoundary: 'Trusted test entry and disposable local HTTPS/SSE assets only; production auth/server is not used. Real main/preload/Tray/Notification/dialog/DBus.',
  checks: {}, events: [], physicalDesktopAcceptance: false, packageFormatAcceptance: false };
let window, fixture, certificates, expectedQuit = false, quitSeen = false, failureHandled = false, stage = 'initialize', token, lastState, progressTimer;
const persist = (target = config.resultPath) => fs.writeFileSync(target, JSON.stringify({ ...report, stage, state: lastState }, null, 2) + '\n');
const js = source => window.webContents.executeJavaScript(source, true);
const call = (name, ...args) => js(`window.meetspaceDesktop[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
async function update(status) { stage = status; await js(`window.__integration.status=${JSON.stringify(status)};void 0`); persist(config.progressPath); console.log('LINUX_INTEGRATION_STAGE ' + status); }
async function disposeLocal() { if (fixture) { await call('closeStream', 'stage05-notifications').catch(() => {}); await call('setNotificationContext', { token: null, route: '/app', soundEnabled: false }).catch(() => {}); await fixture.close(); fixture = null; } if (certificates) { await certificates.close(); certificates = null; } }
async function succeedQuit(reason, close = false) { await disposeLocal(); report.quitReason = reason; expectedQuit = true; report.result = 'PASS'; await update('awaiting-real-quit-cleanup'); void call(close ? 'close' : 'quit').catch(() => {}); }
async function fail(error) { if (failureHandled || secondary) return; failureHandled = true; clearInterval(progressTimer); report.result = 'FAIL'; report.failure = { message: error.message, stack: error.stack }; persist(); console.error('Linux integration fixture failed: ' + error.message); try { await disposeLocal(); } catch {} app.exit(1); }
app.once('before-quit', () => { if (secondary || !window || window.isDestroyed()) return; setTimeout(() => { void js('window.__integration.quitSeen').then(value => { quitSeen = value === true; }).catch(() => {}); }, 35); });
app.on('will-quit', () => {
  if (secondary || failureHandled) return;
  clearInterval(progressTimer);
  try { assert.equal(expectedQuit, true, 'quit is expected at a completed integration boundary'); assert.equal(quitSeen, true, 'real renderer receives quit lifecycle cleanup'); report.checks.quitLifecycleCleanup = 'PASS'; report.result = 'PASS'; persist(); console.log(JSON.stringify({ result: report.result, phase: config.phase, report: config.resultPath })); }
  catch (error) { report.result = 'FAIL'; report.failure = { message: error.message }; persist(); process.exitCode = 1; }
});
(async () => {
  assert.equal(process.platform, 'linux'); assert.equal(app.commandLine.hasSwitch('no-sandbox'), false);
  if (!secondary && ['notifications', 'downloads', 'external'].includes(config.phase)) { certificates = await createCertificates(); fixture = await createAssetsFixture(certificates); fixture.broker.dispose(); }
  window = await startApp({ show: true, userDataDir: config.profile, rendererRoot: config.rendererRoot, ...(fixture ? { brokerOptions: { transport: createNodeHttpsTransport({ ca: certificates.ca, timeoutMs: 5000 }), createSocket: (url, protocols, options) => new WebSocket(url, protocols, { ...options, ca: certificates.ca, rejectUnauthorized: true }) } } : {}) });
  if (secondary) { assert.equal(window, null, 'actual second process reuses existing instance'); return; }
  assert.ok(window); if (process.env.XDG_SESSION_TYPE === 'wayland') assert.equal(window.isVisible(), true, 'production initial Wayland visibility');
  window.setTitle('MeetSpace Stage05 ' + config.phase); window.focus();
  const preferences = window.webContents.getLastWebPreferences(); for (const [key, value] of Object.entries({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true })) assert.equal(preferences[key], value);
  assert.equal(await js("typeof require === 'undefined' && typeof process === 'undefined' && typeof Buffer === 'undefined'"), true);
  report.sandbox = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, rendererNodeAbsent: true, noSandboxSwitch: false }; report.checks.realProductionSandbox = 'PASS';
  report.runtime = await call('getRuntimeInfo'); report.initialPreferences = await call('getNativePreferences');
  for (const event of ['show', 'hide', 'minimize', 'restore', 'close']) window.on(event, () => report.events.push({ type: event, at: new Date().toISOString() }));
  progressTimer = setInterval(() => { if (window?.isDestroyed()) return; void js('JSON.parse(JSON.stringify(window.__integration))').then(value => { lastState = value; persist(config.progressPath); }).catch(() => {}); }, 250);
  const deadline = Date.now() + config.timeoutMs;
  await update('ready'); if (config.phase !== 'baseline') console.log('LINUX_INTEGRATION_READY ' + JSON.stringify({ pid: process.pid, phase: config.phase, progress: config.progressPath }));
  if (config.phase === 'baseline') {
    await until(async () => (await call('getNativePreferences')).trayStatus === 'unavailable', 'real no-watcher resolves unavailable');
    report.tray = await trayInventory(); assert.equal(report.tray.watcherPresent, false); assert.equal((await call('getNativePreferences')).trayAvailable, false);
    await assert.rejects(call('setNativePreferences', { closeToTray: true }));
    await assert.rejects(call('setNativePreferences', { startAtLogin: true }));
    const submenu = Menu.getApplicationMenu().items.find(item => item.label === 'MeetSpace').submenu;
    const hide = submenu.items.find(item => item.label === 'Скрыть в трей'); assert.equal(hide.enabled, false); hide.click(); assert.equal(window.isVisible(), true);
    report.checks.noWatcherCannotStrandWindow = 'PASS'; report.menuCallbackBoundary = 'programmatic application menu callback only, not a CUA UI click';
    const foreign = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve(__dirname, '../dist/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, session: window.webContents.session } });
    try { await foreign.loadURL('app://meetspace/'); await assert.rejects(foreign.webContents.executeJavaScript('window.meetspaceDesktop.getNativePreferences()')); } finally { foreign.destroy(); }
    report.checks.foreignSenderRejected = 'PASS';
    for (const url of ['javascript:alert(1)', 'file:///tmp/fixture', 'https://off-origin.invalid/', 'https://user:password@untrusted.invalid/', 'data:text/plain,fixture']) await assert.rejects(call('openExternal', url));
    report.checks.unsafeExternalUrlsRejected = 'PASS';
    await until(() => js(`window.__integration.routes.includes(${JSON.stringify(config.coldRoute)})`), 'actual cold route delivery');
    await call('minimize'); await until(() => window.isMinimized(), 'native minimize without quitting'); report.checks.minimizeKeepsProcessAlive = 'PASS';
    console.log('LINUX_INTEGRATION_READY ' + JSON.stringify({ pid: process.pid, phase: config.phase, progress: config.progressPath }));
    await until(() => fs.existsSync(config.controlPath) && JSON.parse(fs.readFileSync(config.controlPath)).secondariesComplete, 'real warm/invalid secondary processes', 30000);
    await until(() => js(`window.__integration.routes.includes(${JSON.stringify(config.warmRoute)})`), 'actual warm route delivery');
    await until(() => window.isVisible() && !window.isMinimized(), 'second instance restores minimized primary');
    const routes = await js('window.__integration.routes'); assert.deepEqual(routes, [config.coldRoute, config.warmRoute]); report.routes = routes; report.checks.coldWarmSecondInstanceDeepLinks = 'PASS';
    await succeedQuit('normal close without usable tray', true); return;
  }
  if (fixture) {
    await call('addServer', { origin: fixture.api.origin, label: 'Stage05 local fixture' }); const servers = await call('listServers'); assert.equal(servers.storageAvailable, true, 'actual protected OS credential store');
    await call('selectServer', servers.items.find(item => item.origin === fixture.api.origin).id);
    const login = await call('http', { id: 'stage05-login', method: 'POST', path: '/api/v1/auth/login', responseType: 'json', body: { email: fixture.api.users[0].email, password: PASSWORD } }); assert.equal(login.status, 200); token = login.body.accessToken;
    report.checks.localFixtureAuthenticationAndOsStorage = 'PASS';
  }
  if (config.phase === 'external') {
    for (const url of ['javascript:alert(1)', 'file:///tmp/fixture', 'https://off-origin.invalid/', fixture.api.origin.replace('https://', 'https://user:password@') + '/path']) await assert.rejects(call('openExternal', url));
    assert.equal(fs.existsSync(config.externalMarker), false, 'rejected URL never reached actual handler');
    const approved = fixture.api.origin + '/safe-external-fixture'; await call('openExternal', approved);
    await until(() => fs.existsSync(config.externalMarker), 'actual xdg-open/GIO handler marker', 15000);
    const marker = JSON.parse(fs.readFileSync(config.externalMarker)); assert.deepEqual(marker.args, [approved]);
    report.checks.realXdgOpenGioHandler = 'PASS'; report.externalBoundary = 'Actual shell.openExternal/xdg-open/GIO to test-only XDG MIME desktop handler; no installed browser/default user handler changed';
    await succeedQuit('external URI fixture complete'); return;
  }
  let trayPhase = 'await-opt-in', previousVisible = true, noticeRoute, cancelDone = false, saveDone = false;
  if (config.phase === 'tray') {
    await until(async () => (await call('getNativePreferences')).trayAvailable, 'verified real StatusNotifier host and own registration', 20000);
    report.tray = await trayInventory(); assert.equal(report.tray.hostRegistered, true); assert.ok(report.tray.ownItems.length > 0, 'real watcher owns fixture item PID'); report.exportedMenu = await menuExport(report.tray.ownItems[0]);
    report.trayMenuInteractionEvidence = 'Operator drives actual native tray menu through CUA. Harness independently observes visibility/quit and actual read-only DBus export; it does not synthesize or send menu events.';
    report.checks.realStatusNotifierOwnPidAndMenuExport = 'PASS'; await update('root-opt-in-close-button');
  } else if (config.phase === 'notifications') {
    report.notificationServer = { capabilities: await bus(['call', 'org.freedesktop.Notifications', '/org/freedesktop/Notifications', 'org.freedesktop.Notifications', 'GetCapabilities']), information: await bus(['call', 'org.freedesktop.Notifications', '/org/freedesktop/Notifications', 'org.freedesktop.Notifications', 'GetServerInformation']) };
    await call('setNotificationContext', { token, route: '/app', soundEnabled: false }); await call('openStream', { id: 'stage05-notifications', token });
    await until(() => fixture.api.streams.size > 0 && fixture.preferenceReads >= 2, 'real authenticated fixture SSE/preferences'); await update('root-send-native-notification-button');
  } else if (config.phase === 'downloads') await update('root-save-cancel-button');
  while (Date.now() < deadline) {
    const actions = await js('window.__integration.actions.splice(0)');
    for (const action of actions) {
      if (config.phase === 'tray' && action === 'enable-close') { await call('setNativePreferences', { closeToTray: true }); await call('close'); await until(() => !window.isVisible(), 'explicit close-to-tray hides actual window'); trayPhase = 'await-root-show'; previousVisible = false; report.checks.optInCloseHidesWithoutQuit = 'PASS'; await update('root-native-tray-menu-show'); }
      if (config.phase === 'tray' && action === 'programmatic-menu') {
        const submenu = Menu.getApplicationMenu().items.find(item => item.label === 'MeetSpace').submenu; submenu.items.find(item => item.label === 'Скрыть в трей').click(); assert.equal(window.isVisible(), false); submenu.items.find(item => item.label === 'Открыть MeetSpace').click(); assert.equal(window.isVisible(), true); report.programmaticMenuBoundary = 'Application Menu callbacks exercise production NativeShell; this is not native panel menu click acceptance';
      }
      if (config.phase === 'notifications' && action === 'notify') {
        assert.equal(noticeRoute, undefined, 'one bounded test notice');
        // Human interaction can outlive this fixture transport's 5s idle limit.
        // Reopen the real guarded stream and observe fresh headers before emitting.
        await call('closeStream', 'stage05-notifications');
        await until(() => fixture.api.streams.size === 0, 'previous fixture SSE closed');
        await js("window.__stage05StreamEvents=[];window.meetspaceDesktop.onTransportEvent(event=>{if(event.kind==='stream'&&event.id==='stage05-notifications'&&window.__stage05StreamEvents.length<100){window.__stage05StreamEvents.push({type:event.type,status:typeof event.status==='number'?event.status:null,bytecount:typeof event.data?.byteLength==='number'?event.data.byteLength:0})}});void 0");
        await call('openStream', { id: 'stage05-notifications', token });
        await until(async () => fixture.api.streams.size === 1 && await js("window.__stage05StreamEvents.some(event=>event.type==='headers'&&event.status===200)"), 'fresh authenticated SSE headers before manual notification');
        const id = randomUUID(); noticeRoute = `/conferences/${CONFERENCE}/join`; await call('minimize');
        fixture.api.notify({ id, version: 1, type: 'notification.created', userId: fixture.api.users[0].id, data: { notification: { id, version: 1, userId: fixture.api.users[0].id, type: 'conference.invited', createdAt: new Date().toISOString(), payload: { conferenceId: CONFERENCE } } } });
        await until(() => js("window.__stage05StreamEvents.some(event=>event.type==='chunk'&&event.bytecount>0)"), 'actual notification SSE chunk reaches renderer');
        report.notificationSseEvents = await js('window.__stage05StreamEvents');
        report.notificationSent = { idSha256: hash(id), safeGenericBody: true, soundEnabled: false }; await update('root-actual-notification-click');
      }
      if (config.phase === 'notifications' && action === 'notice-seen') { await js('window.__integration.operatorNoticeSeen=true;void 0'); }
      if (config.phase === 'downloads' && action === 'cancel-save') {
        const before = fixture.contentReads; await update('root-cancel-real-save-dialog'); const result = await call('saveAsset', { id: 'stage05-save-cancel', token, asset }); assert.deepEqual(result, { cancelled: true, saved: false }); assert.equal(fixture.contentReads, before); cancelDone = true; report.checks.realSaveCancelReadsNoContent = 'PASS'; await update('root-save-bytes-button');
      }
      if (config.phase === 'downloads' && action === 'save') {
        assert.equal(cancelDone, true); assert.equal(fs.existsSync(config.savePath), false); await update('root-save-real-dialog-target-' + config.savePath); const result = await call('saveAsset', { id: 'stage05-save-bytes', token, asset }); assert.deepEqual(result, { cancelled: false, saved: true }); const bytes = fs.readFileSync(config.savePath); assert.deepEqual(bytes, fixture.bytes); saveDone = true; report.download = { bytes: bytes.length, sha256: hash(bytes), expectedSha256: hash(fixture.bytes), realDialog: true, targetIsUniqueOwnedTemporaryFile: true }; report.checks.realSaveDialogExactBytes = 'PASS'; await update('root-finish-downloads-button');
      }
      if (action === 'finish' && config.phase === 'notifications') { const state = await js('window.__integration'); assert.equal(state.operatorNoticeSeen, true); assert.ok(noticeRoute && state.routes.includes(noticeRoute), 'real native notice click routes trusted main window'); assert.equal(window.isVisible(), true); report.checks.realNotificationClickRouteActivation = 'PASS'; await succeedQuit('notification fixture complete'); return; }
      if (action === 'finish' && config.phase === 'downloads') { assert.ok(cancelDone && saveDone); await succeedQuit('real file dialog fixture complete'); return; }
    }
    if (config.phase === 'tray') {
      const visible = window.isVisible(), prefs = await call('getNativePreferences');
      if (trayPhase === 'await-root-show' && visible && !previousVisible) { report.checks.nativeTrayMenuShow = 'PASS'; trayPhase = 'await-root-hide'; await update('root-native-tray-menu-hide'); }
      else if (trayPhase === 'await-root-hide' && !visible && previousVisible) { report.checks.nativeTrayMenuHide = 'PASS'; trayPhase = 'await-host-loss'; await update('root-remove-only-scoped-tray-host'); }
      else if (trayPhase === 'await-host-loss' && !prefs.trayAvailable && visible) { report.afterLoss = await trayInventory(); assert.equal(prefs.closeToTray, false); report.checks.watcherLossReopensHiddenWindow = 'PASS'; trayPhase = 'await-host-return'; await update('root-restore-only-scoped-tray-host'); }
      else if (trayPhase === 'await-host-return' && prefs.trayAvailable) { report.afterReturn = await trayInventory(); expectedQuit = true; report.result = 'PASS'; report.quitReason = 'root actual native tray menu Quit'; trayPhase = 'await-root-quit'; await update('root-native-tray-menu-quit'); }
      previousVisible = visible;
    }
    await sleep(100);
  }
  throw new Error('bounded interactive integration deadline');
})().catch(fail);
