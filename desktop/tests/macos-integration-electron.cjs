// Real production main/preload/NativeShell; local authenticated broker fixtures.
// Notification routing policy is additionally exercised with explicitly fake handles.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { app, BrowserWindow, Menu, Notification } = require('electron');
const config = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
assert.equal(process.platform, 'darwin');
app.setName('MeetSpace'); app.setPath('userData', config.profile); app.setPath('sessionData', config.profile);
if (process.argv.includes('--secondary')) {
  const acquired = app.requestSingleInstanceLock();
  if (acquired) app.releaseSingleInstanceLock();
  app.exit(acquired ? 2 : 0);
} else {
  const { startApp } = require('../dist/main.js');
  const { createNodeHttpsTransport } = require('../dist/network/transport.js');
  const { NativeNotifications } = require('../dist/native-notifications.js');
  const { createCertificates, createFixture, PASSWORD } = require('./fixtures/https-fixture.cjs');
  const report = { result: 'FAIL', platform: process.platform, arch: process.arch, osVersion: process.getSystemVersion(),
    electron: process.versions.electron, packaged: false, productionRequests: 0, physicalMediaCapture: false,
    syntheticCanvasCapture: true, realLocalWebRTC: true, sfuTested: false,
    loginItemsMutated: false, physicalLoginTested: false, nativeNotificationDelivery: 'NOT_VERIFIED', checks: [] };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await fn()) return; await pause(40); }
    throw new Error('Condition timeout: ' + label);
  };
  let window, certificates, a, b, child, nativeNotice, policy, stage = 'initialize', requests = 0;
  const watchdog = setTimeout(() => { console.error('Native integration timeout at ' + stage); app.exit(1); }, 90000);
  (async () => {
    try {
      report.testHarnessSha256 = createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
      report.sourceTreeSha256 = JSON.parse(await fs.readFile(path.join(__dirname, '../dist/build-provenance.json'), 'utf8')).sourceTreeSha256;
      certificates = await createCertificates();
      const counts = { a: 7, b: 3 };
      const fixture = name => createFixture({ name: 'stage05-' + name, certificates, ui: true,
        handleRequest: async ({ response, url, send }) => {
          if (url.pathname === '/api/v1/notifications/preferences') {
            send(response, 200, { invitation: true, reminder: true, recording: true, summary: true }); return true;
          }
          if (url.pathname === '/api/v1/notifications') {
            send(response, 200, { items: [], nextCursor: null, unreadCount: counts[name] }); return true;
          }
          return false;
        } });
      a = await fixture('a'); b = await fixture('b');
      const transport = createNodeHttpsTransport({ ca: certificates.ca, timeoutMs: 3000 });
      const allowed = new Set([a.origin, b.origin]);
      window = await startApp({ show: true, userDataDir: config.profile, rendererRoot: config.renderer,
        brokerOptions: { transport: { request(input) {
          assert.ok(allowed.has(new URL(input.url).origin), 'only disposable local origins'); requests++;
          return transport.request(input);
        } } } });
      assert.ok(window);
      for (const [key, value] of Object.entries({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }))
        assert.equal(window.webContents.getLastWebPreferences()[key], value, key);
      assert.equal(app.commandLine.hasSwitch('no-sandbox'), false);
      assert.equal(window.webContents.backgroundThrottling, false);
      const js = source => window.webContents.executeJavaScript(source, true);
      await until(() => js('Array.isArray(window.__routes)'), 'safe fixture ready');
      const invoke = (name, ...args) => js(`window.meetspaceDesktop[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
      let sequence = 0;
      const http = (method, endpoint, marker, body) => invoke('http', { id: 'native-stage05-' + (++sequence), method,
        path: '/api/v1' + endpoint, responseType: 'json', ...(marker ? { token: marker } : {}), ...(body === undefined ? {} : { body }) });
      const login = async source => {
        const state = await invoke('addServer', { origin: source.origin, label: 'Disposable stage05' });
        const id = state.items.find(item => item.origin === source.origin).id;
        await invoke('selectServer', id);
        const response = await http('POST', '/auth/login', undefined, { email: source.users[0].email, password: PASSWORD });
        assert.equal(response.status, 200); return { marker: response.body.accessToken, id };
      };
      stage = 'dock-and-menus';
      assert.ok(app.dock);
      const dock = app.dock.getMenu(); assert.ok(dock, 'native Dock menu exists');
      report.dockMenuLabels = dock.items.filter(item => item.type !== 'separator').map(item => item.label);
      assert.ok(dock.items.some(item => item.label === 'Открыть MeetSpace'));
      assert.ok(dock.items.some(item => item.label === 'Выход из MeetSpace'));
      window.close(); await until(() => !window.isVisible(), 'red close hides');
      assert.equal(window.isDestroyed(), false);
      dock.items.find(item => item.label === 'Открыть MeetSpace').click();
      await until(() => window.isVisible(), 'Dock open restores');
      const primaryId = window.id;
      const close = Menu.getApplicationMenu().getMenuItemById('meetspace-close-window'); assert.ok(close);
      close.click(); await until(() => !window.isVisible(), 'CmdW action hides');
      app.emit('activate'); await until(() => window.isVisible(), 'Dock activate restores');
      assert.equal(window.id, primaryId);
      report.checks.push('Real native Dock menu, red close, CmdW action and Dock activate retain and restore one sandboxed window');
      stage = 'deep-links-and-secondary';
      const invalid = ['https://evil.invalid/', 'meetspace://open/i/' + 'a'.repeat(32) + '?token=secret',
        'meetspace://open/i/%2e%2e', 'meetspace://evil/i/' + 'a'.repeat(32), 'meetspace://open/settings'];
      const before = await js('window.__routes.length');
      for (const link of invalid) app.emit('open-url', { preventDefault() {} }, link);
      await pause(150); assert.equal(await js('window.__routes.length'), before);
      window.close();
      await new Promise((resolve, reject) => {
        child = spawn(process.execPath, [__filename, process.argv[2], '--secondary', 'meetspace://open/i/' + 'a'.repeat(32)], { stdio: 'ignore' });
        child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('secondary lock exit ' + code)));
      });
      await until(() => window.isVisible(), 'secondary restores primary');
      await until(() => js("location.pathname === '/i/' + 'a'.repeat(32)"), 'secondary validated link');
      assert.equal(BrowserWindow.getAllWindows().length, 1); assert.equal(window.id, primaryId);
      app.emit('open-url', { preventDefault() {} }, 'meetspace://open/conferences/11111111-1111-4111-8111-111111111111/join');
      await until(() => js("location.pathname === '/conferences/11111111-1111-4111-8111-111111111111/join'"), 'open-url validated link');
      report.checks.push('Actual second process single-instance lock and route delivery; valid open-url; malformed origin/query/path links rejected');
      stage = 'dock-recreate-destroyed-window';
      window.destroy();
      const reopen = app.dock.getMenu().getMenuItemById('meetspace-native-open'); assert.ok(reopen);
      reopen.click(); reopen.click();
      await until(() => BrowserWindow.getAllWindows().length === 1 && BrowserWindow.getAllWindows()[0].id !== primaryId, 'Dock recreates exactly one destroyed window');
      window = BrowserWindow.getAllWindows()[0];
      await until(() => js('Array.isArray(window.__routes)'), 'recreated safe renderer ready');
      assert.equal(window.isVisible(), true);
      report.checks.push('Two Dock open callbacks recreate one destroyed window with a fresh sandboxed fixture renderer');
      stage = 'background-call-and-end';
      await js('window.__startIntegrationMedia()');
      await until(() => js('window.__mediaSnapshot().decodedFrames >= 5 && window.__mediaSnapshot().uniqueHashes >= 2'), 'local synthetic WebRTC decoded frames');
      const activeMedia = await js('window.__mediaSnapshot()');
      window.close(); await until(() => !window.isVisible(), 'background call window hidden');
      await until(() => js(`window.__mediaSnapshot().decodedFrames >= ${activeMedia.decodedFrames + 5}`), 'decoding continues while window hidden');
      const hiddenMedia = await js('window.__mediaSnapshot()');
      assert.equal(hiddenMedia.localLive, true); assert.equal(hiddenMedia.remoteLive, true); assert.equal(hiddenMedia.connected, true);
      await js("window.__stopIntegrationMedia('end-call')");
      const endedMedia = await js('window.__mediaSnapshot()');
      assert.ok(Object.values(endedMedia.cleanup).every(Boolean));
      report.mediaLifecycle = { scope: 'Synthetic canvas video and real local WebRTC host-ICE; no Pion/SFU, physical devices or system permissions',
        beforeHide: activeMedia, whileHidden: hiddenMedia, afterEndCall: endedMedia };
      report.checks.push('Synthetic own-canvas video keeps decoding across native window close/hide; explicit end-call releases both streams, peers, videos and paint timer');
      stage = 'badge-auth-boundaries';
      const identityA = await login(a);
      await http('GET', '/notifications', identityA.marker);
      await until(() => app.dock.getBadge() === '7', 'authenticated unread reaches Dock');
      await invoke('setNotificationContext', { token: identityA.marker, route: '/app', soundEnabled: false });
      await http('GET', '/notifications/preferences', identityA.marker);
      await invoke('openStream', { id: 'stage05-notifications', token: identityA.marker });
      await until(() => a.streams.size === 1, 'authenticated incoming SSE stream');
      window.close(); await until(() => !window.isVisible(), 'hidden fixture');
      const noticeId = randomUUID();
      a.notify({ id: noticeId, version: 1, type: 'notification.created', data: { notification: {
        id: noticeId, version: 1, userId: a.users[0].id, type: 'chat.message', createdAt: new Date().toISOString(), readAt: null,
        payload: { conversationId: '55555555-5555-4555-8555-555555555555', conversationType: 'direct', messageId: randomUUID() },
      } } });
      await until(() => js("window.__events.some(e=>e.kind==='stream'&&e.id==='stage05-notifications'&&e.type==='chunk')"), 'incoming event reaches hidden renderer');
      counts.a = 8; await http('GET', '/notifications', identityA.marker);
      await until(() => app.dock.getBadge() === '8', 'hidden renderer updates badge');
      const identityB = await login(b);
      assert.equal(app.dock.getBadge(), '', 'server switch clears old unread before new server fetch');
      await until(() => a.streams.size === 0, 'server switch closes previous authenticated notification stream');
      await assert.rejects(http('GET', '/notifications', identityA.marker));
      await http('GET', '/notifications', identityB.marker);
      await until(() => app.dock.getBadge() === '3', 'new server unread');
      await http('POST', '/auth/logout', identityB.marker, { userId: b.users[0].id });
      assert.equal(app.dock.getBadge(), '', 'logout clears Dock badge');
      await assert.rejects(invoke('setNotificationContext', { token: identityB.marker, route: '/app', soundEnabled: true }));
      report.checks.push('Real authenticated HTTPS/SSE broker and IPC deliver an incoming event and update Dock badge while hidden; server switch closes old stream; server switch and logout clear badge and reject stale identity');
      stage = 'notification-policy';
      const handles = [], routes = [], unread = [];
      policy = new NativeNotifications({ supported: () => true, isFocused: () => false,
        create(options) { const handle = new EventEmitter(); handle.options = options; handle.show = () => handles.push(handle);
          handle.close = () => { handle.closed = true; handle.emit('close'); }; return handle; },
        navigate: route => routes.push(route), onUnread: count => unread.push(count) });
      const userId = a.users[0].id;
      const bind = profileId => { policy.setIdentity({ profileId, userId }); policy.setPreferences({ invitation:true,reminder:true,recording:true,summary:true });
        policy.setContext({ route: '/app', soundEnabled: false }); };
      const notice = () => { const id = randomUUID(); return { id, version:1, type:'notification.created', data:{ notification:{id,version:1,userId,
        type:'chat.message',createdAt:new Date().toISOString(),readAt:null,payload:{conversationId:'55555555-5555-4555-8555-555555555555',conversationType:'direct',messageId:randomUUID()}} } }; };
      bind('a'.repeat(32)); policy.observe(notice()); assert.equal(handles.length, 1);
      assert.equal(handles[0].options.body, 'Новое сообщение в личном чате');
      handles[0].emit('click'); assert.equal(routes.length, 1);
      policy.observe(notice()); const old = handles[1]; policy.setUnreadCount(9);
      policy.setIdentity(null); assert.equal(old.closed, true); assert.equal(unread.at(-1), 0);
      old.emit('click'); assert.equal(routes.length, 1);
      bind('b'.repeat(32)); policy.observe(notice()); const current = handles[2];
      policy.dispose(); current.emit('click'); assert.equal(routes.length, 1); assert.equal(current.closed, true);
      report.notificationPolicy = { handleBackend: 'explicit in-memory fake Notification handles', osDeliveryTested: false,
        checks: ['incoming static text', 'click internal route', 'logout closes and clears unread', 'old click invalidated', 'profile switch', 'dispose clears notices'] };
      stage = 'native-notification-attempt';
      report.nativeNotificationSupported = Notification.isSupported();
      const deliveryEvents = [];
      if (report.nativeNotificationSupported) {
        nativeNotice = new Notification({ title: 'MeetSpace', body: 'Проверка уведомлений macOS', silent: true });
        nativeNotice.on('show', () => deliveryEvents.push('show'));
        nativeNotice.on('failed', () => deliveryEvents.push('failed'));
        nativeNotice.on('close', () => deliveryEvents.push('close'));
        nativeNotice.show(); await pause(2000); nativeNotice.close();
      }
      report.nativeNotificationEvents = deliveryEvents;
      report.nativeNotificationDelivery = deliveryEvents.includes('show') ? 'SHOW_EVENT_ONLY_VISUAL_NOT_VERIFIED' : 'NOT_VERIFIED_UNSIGNED_DEVELOPMENT_IDENTITY';
      stage = 'explicit-quit';
      await js('window.__startIntegrationMedia()');
      await until(() => js('window.__mediaSnapshot().decodedFrames >= 3'), 'second local WebRTC before quit');
      let cleanupSignal = false;
      app.once('before-quit', () => { setTimeout(() => { void js("({signal:window.__events.some(e=>e.kind==='lifecycle'&&e.type==='quit'),media:window.__mediaSnapshot()})").then(value => { cleanupSignal = value.signal; report.quitMediaSnapshot = value.media; }); }, 50); });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Quit cleanup timeout')), 5000);
        app.once('will-quit', event => { event.preventDefault(); clearTimeout(timeout); resolve(); });
        Menu.getApplicationMenu().getMenuItemById('meetspace-quit').click();
      });
      assert.equal(cleanupSignal, true); assert.equal(window.isDestroyed(), true); assert.equal(app.dock.getBadge(), '');
      assert.equal(report.quitMediaSnapshot.stopReason, 'quit'); assert.ok(Object.values(report.quitMediaSnapshot.cleanup).every(Boolean));
      report.checks.push('Explicit CmdQ callback sends shared-client quit lifecycle, destroys retained window and clears Dock badge');
      report.localFixtureRequests = requests; report.result = 'PASS';
    } catch (error) { report.stage = stage; report.failure = error.message; console.error('macOS integration failed at ' + stage + ': ' + error.message); }
    finally {
      clearTimeout(watchdog); child?.kill(); nativeNotice?.close(); policy?.dispose();
      if (a) await a.close(); if (b) await b.close(); if (certificates) await certificates.close();
      await fs.writeFile(path.join(config.output, 'macos-integration.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report)); app.exit(report.result === 'PASS' ? 0 : 1);
    }
  })();
}
