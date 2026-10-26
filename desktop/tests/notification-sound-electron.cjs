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
        send(response, 200, { invitation: true, reminder: true, recording: true, summary: true, email: false, push: true }); return true;
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
  await js(`window.__soundPlays=[]; const play=HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play=function(){return play.call(this).then(()=>{if(!this.muted)window.__soundPlays.push({src:this.currentSrc,sinkId:this.sinkId,volume:this.volume});});}; void 0`);
  await exists('.reference-onboarding-intro .button'); await click('.reference-onboarding-intro .button');
  await exists('#desktop-server-origin'); await field('#desktop-server-origin', fixture.origin); await click('.desktop-server-form button[type=submit]');
  await exists('#email'); await field('#email', fixture.users[0].email); await field('#password', PASSWORD); await click('#auth-form button[type=submit]');
  await exists('.sidebar'); await until(() => fixture.streams.size > 0, 'notification stream');
  await delay(300); window.hide();
  const notice = () => { const id = randomUUID(); return { version: 1, id, type: 'notification.created', data: { notification: {
    id, userId: USER_A, version: 1, type: 'chat.message', readAt: null, createdAt: new Date().toISOString(),
    payload: { conversationId: '55555555-5555-4555-8555-555555555555', conversationType: 'direct', messageId: randomUUID() },
  } } }; };
  const first = notice(); fixture.notify(first);
  await until(() => window.webContents.isCurrentlyAudible(), 'actual audible playback while window hidden');
  await until(() => js('window.__soundPlays.length === 1'), 'exactly one app tone');
  fixture.notify(first); fixture.notify(notice()); await delay(400);
  assert.equal(await js('window.__soundPlays.length'), 1, 'duplicate and burst stay silent');
  await delay(1100);
  window.webContents.send('meetspace:route', '/app/settings'); await exists('.reference-settings-page');
  await js(`[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.trim()==='Уведомления').click()`);
  await exists('.preferences-fieldset');
  const toggleSound = () => js(`[...document.querySelectorAll('.preference-option')].find(e=>e.textContent.includes('Звуковой сигнал')).querySelector('input').click()`);
  await toggleSound(); await delay(150); fixture.notify(notice()); await delay(350);
  assert.equal(await js('window.__soundPlays.length'), 1, 'disabled sound');
  await toggleSound(); await delay(150); fixture.notify(notice());
  await until(() => js('window.__soundPlays.length === 2'), 'sound after re-enable');
  const plays = await js('window.__soundPlays');
  assert.ok(plays.every(p => p.src.includes('device-tone') && p.volume === 0.35));
  await fs.writeFile(output, JSON.stringify({ ok: true, platform: process.platform, arch: process.arch, hiddenWindowAudible: true, duplicateAndBurstSuppressed: true, muteToggle: true, plays }, null, 2));
  console.log(JSON.stringify({ ok: true, output }));
})().catch(async error => {
  console.error(error.stack); process.exitCode = 1;
  const diagnostics = window ? await window.webContents.executeJavaScript(`(async()=>({errors:[...document.querySelectorAll('.error-notice')].map(e=>e.textContent),runtime:await window.meetspaceDesktop.getRuntimeInfo()}))()`).catch(() => null) : null;
  await fs.writeFile(output, JSON.stringify({ ok: false, error: error.message, diagnostics }));
}).finally(async () => {
  clearTimeout(timeout); if (window) window.destroy(); if (fixture) await fixture.close(); if (cert) await cert.close(); app.exit(process.exitCode || 0);
});
