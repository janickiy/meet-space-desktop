// Real desktop broker + renderer + bundled audio, using only a local HTTPS fixture.
// Run with Electron after build: electron tests/notification-sound-electron.cjs <empty-profile> <report.json>
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { app } = require('electron');
const WebSocket = require('ws');
const { createCertificates, createFixture, PASSWORD, USER_A } = require('./fixtures/https-fixture.cjs');
const { createNodeHttpsTransport } = require('../dist/network/transport.js');
const { startApp } = require('../dist/main.js');
const profile = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
app.setPath('userData', profile); app.setPath('sessionData', profile);
let window, fixture, cert;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('notification sound timeout'); app.exit(1); }, 60000);
(async () => {
  cert = await createCertificates();
  fixture = await createFixture({ name: 'sound', certificates: cert, ui: true,
    handleRequest: ({ response, url, send }) => {
      if (url.pathname === '/api/v1/notifications/preferences') {
        // Production currently omits the optional summary category.
        send(response, 200, { invitation: true, reminder: true, recording: true, email: false, push: false }); return true;
      }
      if (url.pathname === '/api/v1/integrations/capabilities') {
        send(response, 200, { email: 'noop', push: 'noop', calendar: 'noop', calendarOAuthConfigured: false, mockConnectAllowed: false }); return true;
      }
      return false;
    } });
  const transport = createNodeHttpsTransport({ ca: cert.ca, timeoutMs: 3000 });
  const guard = url => assert.equal(new URL(url).origin.replace('wss:', 'https:'), fixture.origin);
  window = await startApp({ show: false, userDataDir: profile,
    rendererRoot: path.resolve(__dirname, '../../frontend/dist-desktop'),
    brokerOptions: {
      transport: { request: input => { guard(input.url); return transport.request(input); } },
      createSocket: (url, protocols, options) => { guard(url); return new WebSocket(url, protocols, { ...options, ca: cert.ca }); },
    } });
  const js = code => window.webContents.executeJavaScript(code);
  const until = async (predicate, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await predicate()) return; await delay(30); }
    throw new Error(label);
  };
  const exists = selector => until(() => js(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const field = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const instrument = () => js(`(()=>{
    window.__soundPlays=[]; window.__soundErrors=[]; window.__soundNotices=[]; window.__accountEvents=[];
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){return play.call(this).then(()=>{if(!this.muted)window.__soundPlays.push({src:this.currentSrc,sinkId:this.sinkId,volume:this.volume});},error=>{window.__soundErrors.push(error.name);throw error;});};
    window.meetspaceDesktop.onTransportEvent(event=>{
      if(event.kind==='notification-sound')window.__soundNotices.push(event.id);
      if(event.kind==='socket'&&event.type==='message')window.__accountEvents.push(JSON.parse(event.data).id);
    });
  })()`);
  await instrument();
  await exists('.reference-onboarding-intro .button'); await click('.reference-onboarding-intro .button');
  await exists('#desktop-server-origin'); await field('#desktop-server-origin', fixture.origin); await click('.desktop-server-form button[type=submit]');
  await exists('#email'); await field('#email', fixture.users[0].email); await field('#password', PASSWORD); await click('#auth-form button[type=submit]');
  await exists('.sidebar'); await until(() => fixture.streams.size > 0 && fixture.sockets.size > 0, 'notification and account streams');
  await delay(300); window.hide();
  const conversations = { direct: '55555555-5555-4555-8555-555555555555', group: '66666666-6666-4666-8666-666666666666' };
  const notice = (type = 'direct') => { const id = randomUUID(); return { version: 1, id, type: 'notification.created', data: { notification: {
    id, userId: USER_A, version: 1, type: 'chat.message', readAt: null, createdAt: new Date().toISOString(),
    payload: { conversationId: conversations[type], conversationType: type, messageId: randomUUID() },
  } } }; };
  const first = notice(); fixture.notify(first);
  await until(() => window.webContents.isCurrentlyAudible(), 'actual audible playback while window hidden');
  await until(() => js('window.__soundPlays.length === 1'), 'exactly one app tone');
  fixture.notify(first); fixture.notify(notice()); await delay(400);
  assert.equal(await js('window.__soundPlays.length'), 1, 'duplicate and burst stay silent');
  await delay(1100);
  fixture.notify(notice('group'));
  await until(() => js('window.__soundPlays.length === 2'), 'group chat app tone');
  const initialPlays = await js('window.__soundPlays');

  // Replace the document while hidden: session restore must not need another
  // click, and the new account player must receive the native sound command.
  await delay(1100);
  const oldStreams = [...fixture.streams];
  window.webContents.reload();
  await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  await exists('.sidebar');
  await until(() => fixture.streams.size > 0 && fixture.sockets.size > 0 && oldStreams.every(stream => !fixture.streams.has(stream)), 'restored account streams');
  await instrument();
  assert.equal(await js('navigator.userActivation.hasBeenActive'), false, 'restored document has no user gesture');
  assert.equal(window.isVisible(), false);
  for (const [index, type] of ['group', 'direct'].entries()) {
    if (index) await delay(1100);
    fixture.notify(notice(type));
    await until(() => js(`window.__soundPlays.length === ${index + 1}`), `${type} tone after hidden session restore`);
    await until(() => window.webContents.isCurrentlyAudible(), `${type} actual audio after hidden session restore`);
  }

  const mute = async (type, enabled) => {
    const id = randomUUID();
    const event = { version: 1, id, type: 'conversation.preferences.updated', timestamp: new Date().toISOString(),
      data: { conversationId: conversations[type], type, userId: USER_A, item: { id: conversations[type], notificationsEnabled: enabled } } };
    for (const socket of fixture.sockets) socket.send(JSON.stringify(event));
    await until(() => js(`window.__accountEvents.includes(${JSON.stringify(id)})`), `${type} mute observed by native broker`);
  };
  await delay(1100);
  for (const type of ['direct', 'group']) {
    await mute(type, false); fixture.notify(notice(type));
  }
  await delay(350);
  assert.equal(await js('window.__soundPlays.length'), 2, 'per-chat mute suppresses both direct and group sound');
  assert.equal(await js('window.__soundNotices.length'), 2, 'muted chat never authorizes renderer audio');
  for (const type of ['direct', 'group']) await mute(type, true);

  window.webContents.send('meetspace:route', '/app/settings'); await exists('.reference-settings-page');
  await js(`[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.trim()==='Уведомления').click()`);
  await exists('.preferences-fieldset');
  const toggleSound = () => js(`[...document.querySelectorAll('.preference-option')].find(e=>e.textContent.includes('Звуковой сигнал')).querySelector('input').click()`);
  await toggleSound(); await delay(150); fixture.notify(notice()); await delay(350);
  assert.equal(await js('window.__soundPlays.length'), 2, 'disabled sound');
  await toggleSound(); await delay(150); fixture.notify(notice('group'));
  await until(() => js('window.__soundPlays.length === 3'), 'group sound after re-enable');
  const plays = [...initialPlays, ...await js('window.__soundPlays')];
  assert.ok(plays.every(p => p.src.includes('device-tone') && p.volume === 0.35));
  assert.deepEqual(await js('window.__soundErrors'), []);
  await fs.writeFile(output, JSON.stringify({ ok: true, platform: process.platform, arch: process.arch, hiddenWindowAudible: true,
    directAndGroupChat: true, restoredHiddenSessionWithoutGesture: true, duplicateAndBurstSuppressed: true,
    perChatMute: true, muteToggle: true, plays }, null, 2));
  console.log(JSON.stringify({ ok: true, output }));
})().catch(async error => {
  console.error(error.stack); process.exitCode = 1;
  const diagnostics = window ? await window.webContents.executeJavaScript(`(async()=>({errors:[...document.querySelectorAll('.error-notice')].map(e=>e.textContent),
    soundErrors:window.__soundErrors,soundNotices:window.__soundNotices?.length,plays:window.__soundPlays,
    visible:document.visibilityState,userActivation:navigator.userActivation.hasBeenActive,runtime:await window.meetspaceDesktop.getRuntimeInfo()}))()`).catch(() => null) : null;
  await fs.writeFile(output, JSON.stringify({ ok: false, error: error.message, diagnostics }));
}).finally(async () => {
  clearTimeout(timeout); if (window) window.destroy(); if (fixture) await fixture.close(); if (cert) await cert.close(); app.exit(process.exitCode || 0);
});
