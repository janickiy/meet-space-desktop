// Trusted test entry: production capture policy and preload, actual OS portal/X11.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const name of ['profile', 'rendererRoot', 'resultPath', 'progressPath']) assert.ok(path.isAbsolute(config[name]));
app.setPath('userData', config.profile); app.setPath('sessionData', config.profile);
const { startApp } = require('../dist/main.js');
const report = { schemaVersion: 1, result: 'FAIL', scope: 'real local display capture and local WebRTC encode/decode; no server, account or saved video', platform: process.platform, arch: process.arch, kernel: os.release(), versions: process.versions, scenario: config.scenario, selectedKind: config.selectedKind, selectedKindEvidence: 'operator case label; displaySurface is recorded separately and does not prove portal source kind', harnessInputs: config.harnessInputs, buildMetadata: config.buildMetadata, sourceInputs: config.sourceInputs ? { sourceTreeSha256: config.sourceInputs.sourceTreeSha256, fileCount: config.sourceInputs.files.length } : null, physicalDisplayAcceptance: false, nativeCaptureTestDoubles: [], productionRequests: 0, checks: {}, environment: Object.fromEntries(['XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'WAYLAND_DISPLAY', 'DISPLAY'].map(key => [key, process.env[key] || null])) };
let window, patternWindow, finished = false;
function portalObjects() {
  if (process.env.XDG_SESSION_TYPE !== 'wayland') return { available: false, reason: 'not-wayland' };
  try { const output = execFileSync('gdbus', ['introspect', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop/session', '--recurse'], { encoding: 'utf8', timeout: 2000, maxBuffer: 65536 }); return { available: true, namespaceNodeCount: (output.match(/\bnode /g) || []).length, namespaceSha256: createHash('sha256').update(output).digest('hex'), scope: 'public session namespace only, no tokens or paths persisted' }; } catch (error) { return { available: false, reason: String(error.message).slice(0, 160) }; }
}
const write = (name, data) => fs.writeFileSync(name, JSON.stringify(data, null, 2) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function finish(error) {
  if (finished) return; finished = true;
  if (error) report.failure = { message: error.message, stack: error.stack };
  try { if (window && !window.isDestroyed()) { await window.webContents.executeJavaScript('window.__screenTestStop?.()'); report.afterCleanup = await window.webContents.executeJavaScript('JSON.parse(JSON.stringify(window.__screenTest))'); } } catch (cleanupError) { report.cleanupError = cleanupError.message; }
  patternWindow?.destroy(); report.patternWindowClosed = !patternWindow || patternWindow.isDestroyed();
  write(config.resultPath, report); console.log(JSON.stringify({ result: report.result, scenario: config.scenario, report: config.resultPath }));
  if (window && !window.isDestroyed()) window.close();
  setTimeout(() => app.exit(report.result === 'PASS' ? 0 : 1), 500);
}
(async () => {
  assert.equal(process.platform, 'linux'); assert.equal(app.commandLine.hasSwitch('no-sandbox'), false);
  window = await startApp({ show: true, userDataDir: config.profile, rendererRoot: config.rendererRoot }); assert.ok(window);
  if (process.env.XDG_SESSION_TYPE === 'wayland') assert.equal(window.isVisible(), true, 'real production Wayland initial visibility');
  window.setTitle('MeetSpace Stage04 Capture Controls'); window.setSize(1100, 850); window.focus();
  const preferences = window.webContents.getLastWebPreferences();
  for (const [key, value] of Object.entries({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true })) assert.equal(preferences[key], value, key);
  report.sandbox = { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity, noSandboxSwitch: false, rendererNodeAbsent: await window.webContents.executeJavaScript("typeof require === 'undefined' && typeof process === 'undefined' && typeof Buffer === 'undefined'") };
  assert.equal(report.sandbox.rendererNodeAbsent, true);
  report.displays = screen.getAllDisplays().map(display => ({ bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor, rotation: display.rotation, internal: display.internal }));
  patternWindow = new BrowserWindow({ title: 'MeetSpace Stage04 Pattern', width: 1000, height: 720, show: true, webPreferences: { session: window.webContents.session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  patternWindow.on('closed', () => { report.patternClosedAt = new Date().toISOString(); });
  await patternWindow.loadURL('app://meetspace/pattern.html'); window.focus();
  if (config.autoX11) { patternWindow.setPosition(20, 20); window.setPosition(250, 160); window.focus(); }
  report.portalObjectsBefore = portalObjects(); report.startedAt = new Date().toISOString(); report.checks.productionSandbox = 'PASS';
  console.log('SCREEN_FIXTURE_READY ' + JSON.stringify({ pid: process.pid, scenario: config.scenario, selectedKind: config.selectedKind, progress: config.progressPath }));
  let selected = false, autoStopped = false;
  const deadline = Date.now() + config.timeoutMs;
  if (config.autoX11) await window.webContents.executeJavaScript("document.querySelector('#start').click()", true);
  while (!finished) {
    assert.ok(Date.now() < deadline, 'bounded interactive screen fixture timeout');
    assert.ok(!window.isDestroyed(), 'control window remains alive');
    const state = await window.webContents.executeJavaScript('JSON.parse(JSON.stringify(window.__screenTest))');
    write(config.progressPath, { ...report, state });
    if (config.autoX11 && !selected && state.events.some(event => event.type === 'request')) {
      const text = config.selectedKind === 'screen' ? 'screen:' : 'window: MeetSpace Stage04 Pattern';
      selected = await window.webContents.executeJavaScript(`(() => { const item = [...document.querySelectorAll('#choices button')].find(button => button.textContent.startsWith(${JSON.stringify(text)})); if (!item) return false; item.click(); return true; })()`, true);
      assert.equal(selected, true, 'real X11 app picker has requested fixture source');
    }
    const remote = state.frames.remoteDecoded;
    if (config.autoX11 && !autoStopped && remote?.callbacks >= 12 && remote.uniqueHashes >= 4) { autoStopped = true; await window.webContents.executeJavaScript("document.querySelector('#stop').click(); document.querySelector('#finish').click()", true); }
    if (state.granted && !report.portalObjectsDuring) report.portalObjectsDuring = portalObjects();
    if (state.finished) {
      report.state = state;
      assert.ok(state.started && !state.pending, 'capture request completed');
      assert.equal(state.events.some(event => event.type === 'unavailable'), false, 'real session is supported');
      if (process.env.XDG_SESSION_TYPE === 'wayland') assert.ok(state.events.some(event => event.type === 'portal'), 'production native portal event');
      if (['cancel', 'late-choice'].includes(config.scenario)) {
        assert.equal(state.granted, false); assert.ok(['NotAllowedError', 'AbortError'].includes(state.error?.name), 'actual request rejection');
        assert.deepEqual(state.frames, {}); if (config.scenario === 'late-choice') { assert.ok(state.applicationCancelledAtMs >= 0); assert.ok(state.elapsedMs - state.applicationCancelledAtMs >= 5000, 'late selection observation is bounded but not immediate'); }
        report.checks.noGrantNoFrames = 'PASS';
      } else {
        assert.equal(state.granted, true); assert.equal(state.error, null);
        for (const label of ['local', 'remoteDecoded']) { const frame = state.frames[label]; assert.ok(frame?.callbacks >= 8, label + ' real frames'); assert.ok(frame.uniqueHashes >= 3, label + ' changing content'); assert.ok(frame.nonBlackFraction > .2 && frame.saturatedFraction > .015, label + ' nonblack colored safe content'); for (const color of ['redFraction', 'greenFraction', 'blueFraction', 'yellowFraction']) assert.ok(frame[color] > .003, label + ' safe pattern ' + color); }
        assert.ok(state.loopback?.inboundVideo.some(item => item.framesDecoded >= 5 && item.bytesReceived > 0), 'real WebRTC remote video decoded');
        assert.ok(state.tracks.length > 0 && state.tracks.every(track => track.readyState === 'ended'));
        if (['window-external-stop', 'window-source-gone'].includes(config.scenario)) { assert.equal(state.stopReason, 'external-track-ended'); assert.ok(state.externalEndedAtMs >= 0); }
        else assert.equal(state.stopReason, 'application-stop');
        if (config.scenario === 'window-source-gone') assert.ok(report.patternClosedAt, 'selected fixture source really closed');
        report.checks.realCaptureFrames = 'PASS'; report.checks.realWebRtcEncodeDecode = 'PASS';
      }
      assert.ok(state.cleanup?.localTracksEnded && state.cleanup.remoteTracksEnded && state.cleanup.peerConnectionsClosed && state.cleanup.videoSourcesReleased, 'all owned tracks, peer connections and media elements released');
      report.checks.applicationMediaCleanup = 'PASS';
      if (process.env.XDG_SESSION_TYPE === 'wayland') { assert.equal(state.operatorPortalGone, true, 'operator separately verifies native capture indicator/session gone'); report.portalTerminalObservation = { source: 'explicit operator UI confirmation after observing GNOME/KDE capture indicator', indicatorGone: true, callbackNullAloneIsNotProof: true, portalSessionObjectInspection: 'not asserted' }; }
      await sleep(1500); report.portalObjectsAfter = portalObjects();
      if (report.portalObjectsBefore.available && report.portalObjectsAfter.available) { assert.equal(report.portalObjectsAfter.namespaceNodeCount, report.portalObjectsBefore.namespaceNodeCount, 'public portal session namespace returns to baseline'); report.checks.publicPortalNamespaceCleanup = 'PASS'; }
      report.result = 'PASS'; await finish(); return;
    }
    await sleep(500);
  }
})().catch(finish);
