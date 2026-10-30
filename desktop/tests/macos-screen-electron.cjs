const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { app, BrowserWindow, screen, systemPreferences } = require('electron');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(process.platform, 'darwin');
for (const flag of ['no-sandbox', 'use-fake-device-for-media-stream', 'use-fake-ui-for-media-stream']) assert.equal(app.commandLine.hasSwitch(flag), false);
app.setPath('userData', config.profile); app.setPath('sessionData', config.profile);
const { startApp } = require('../dist/main.js');
const { MacOSScreenAccess } = require('../dist/platform/macos-screen-access.js');
const access = new MacOSScreenAccess(systemPreferences);
const report = { result: 'FAIL', platform: process.platform, arch: process.arch, osVersion: process.getSystemVersion(), electron: process.versions.electron,
  scenario: config.scenario, permissionIdentity: 'development Electron app', nativeCaptureTestDoubles: [], recordingsSaved: false,
  productionServerRequests: 0, nativeIntelTested: false, systemAudioTested: false, sourceChoice: 'explicit UI choice restricted to fixture safe window',
  scope: 'production capture handlers/preload; dedicated fixture renderer; real local WebRTC host-ICE loopback without SFU' };
report.testHarnessSha256 = {
  electron: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  runner: createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'macos-screen-runner.cjs'))).digest('hex'),
};
const write = (name, value) => fs.writeFileSync(path.join(config.output, name), JSON.stringify(value, null, 2) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
function placement(window) {
  const bounds = window.getBounds(), display = screen.getDisplayMatching(bounds);
  return { display, evidence: { windowBounds: bounds, displayIndex: screen.getAllDisplays().findIndex(item => item.id === display.id),
    displayBounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor, internal: display.internal } };
}
let owner, patternWindow;
(async () => {
  try {
    owner = await startApp({ show: true, userDataDir: config.profile, rendererRoot: config.rendererRoot }); assert.ok(owner);
    report.before = access.status();
    const preferences = owner.webContents.getLastWebPreferences();
    for (const [key, value] of Object.entries({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true })) assert.equal(preferences[key], value, key);
    report.sandbox = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true };
    const displays = screen.getAllDisplays();
    report.displays = displays.map(d => ({ bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, rotation: d.rotation, internal: d.internal }));
    try { report.sourceTreeSha256 = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/build-provenance.json'), 'utf8')).sourceTreeSha256; } catch { /* A main-only development build may have no provenance. */ }
    const firstDisplay = displays.find(display => display.internal) || screen.getPrimaryDisplay();
    const targetDisplay = displays.find(display => !display.internal && display.id !== firstDisplay.id);
    const area = firstDisplay.workArea, targetArea = targetDisplay?.workArea || area;
    const width = Math.min(1000, area.width - 32, targetArea.width - 64);
    const height = Math.min(680, area.height - 128, targetArea.height - 128);
    assert.ok(width >= 400 && height >= 300, 'fixture must fit on the available displays');
    owner.setTitle('MeetSpace macOS capture controls'); owner.setMinimumSize(600, 640);
    owner.setBounds({ x: area.x + 16, y: area.y + 16, width: 650, height: Math.min(800, area.height - 32) });
    patternWindow = new BrowserWindow({ title: 'MeetSpace macOS safe pattern',
      x: area.x + area.width - width - 16, y: area.y + 96, width, height,
      webPreferences: { session: owner.webContents.session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    await patternWindow.loadURL('app://meetspace/pattern.html');
    patternWindow.setTitle('MeetSpace macOS safe pattern'); owner.focus();
    const initialPlacement = placement(patternWindow);
    assert.equal(initialPlacement.display.id, firstDisplay.id, 'safe pattern starts on the intended display');
    assert.ok(contains(area, initialPlacement.evidence.windowBounds), 'safe pattern is fully within the initial work area');
    report.initialWindowPlacement = initialPlacement.evidence;
    console.log('MACOS_SCREEN_READY ' + JSON.stringify({ pid: process.pid, scenario: config.scenario, progress: path.join(config.output, config.scenario + '-progress.json') }));
    const deadline = Date.now() + 165000;
    let sourceClosed = false, passedFrames = false, movedAtFrames = null, destinationSeenAtFrames = null, moveVerified = false;
    while (Date.now() < deadline) {
      const state = await owner.webContents.executeJavaScript('JSON.parse(JSON.stringify(window.__screenProbe))');
      report.after = access.status(); write(config.scenario + '-progress.json', { ...report, state });
      if (state.events.some(e => e.type === 'denied') && !state.pending) {
        assert.equal(state.granted, false); assert.deepEqual(state.frames, {});
        report.result = 'NOT_RUN'; report.reason = 'native_screen_permission_unavailable'; report.state = state; break;
      }
      if (config.scenario === 'cancel' && state.started && !state.pending && state.error) {
        assert.ok(['NotAllowedError', 'AbortError'].includes(state.error.name)); assert.equal(state.granted, false); assert.deepEqual(state.frames, {});
        report.result = 'PASS'; report.state = state; break;
      }
      if (config.scenario !== 'cancel' && state.started && !state.pending && !state.granted &&
          (state.error || state.events.some(event => event.type === 'cancelled'))) {
        throw new Error('Native capture request ended before a source was granted: ' + (state.error?.name || 'cancelled'));
      }
      const local = state.frames.local, remote = state.frames.remoteDecoded;
      if (local?.callbacks >= 12 && remote?.callbacks >= 8 && remote.uniqueHashes >= 3 && state.received?.some(s => s.framesDecoded >= 5 && s.bytesReceived > 0)) {
        for (const sample of [local, remote]) { assert.ok(sample.nonBlackFraction > .2); assert.ok(sample.saturatedFraction > .03); }
        passedFrames = true;
        if (config.scenario === 'window-source-gone' && !sourceClosed) { sourceClosed = true; patternWindow.destroy(); report.sourceWindowClosed = true; }
        else if (config.scenario === 'window-app-stop' && !state.cleanup) await owner.webContents.executeJavaScript("window.__stopScreenProbe('application-stop')");
        else if (config.scenario === 'window-multi-display' && !state.cleanup) {
          if (!targetDisplay) { report.result = 'NOT_RUN'; report.reason = 'second_physical_display_unavailable'; report.state = state; break; }
          assert.ok(firstDisplay.internal && firstDisplay.scaleFactor > 1, 'multi-display case starts on internal Retina');
          if (movedAtFrames === null) {
            movedAtFrames = remote.callbacks;
            const beforeMove = placement(patternWindow);
            assert.equal(beforeMove.display.id, firstDisplay.id, 'capture still starts on the initial display');
            report.firstDisplayCapture = { local: { ...local }, remote: { ...remote }, placement: beforeMove.evidence };
            // Keep the DIP size fixed: a pixel-size change must come from display scale, not resizing.
            patternWindow.setBounds({ x: targetArea.x + 32, y: targetArea.y + 32,
              width: beforeMove.evidence.windowBounds.width, height: beforeMove.evidence.windowBounds.height });
            const destination = placement(patternWindow);
            assert.equal(destination.display.id, targetDisplay.id, 'safe pattern actually moved to the intended external display');
            assert.notEqual(destination.display.id, beforeMove.display.id, 'destination differs from the initial display');
            assert.ok(contains(targetArea, destination.evidence.windowBounds), 'safe pattern is fully within the destination work area');
            assert.equal(destination.evidence.windowBounds.width, beforeMove.evidence.windowBounds.width, 'DIP width is unchanged');
            assert.equal(destination.evidence.windowBounds.height, beforeMove.evidence.windowBounds.height, 'DIP height is unchanged');
            report.destinationWindowPlacement = destination.evidence;
            report.movedSafeWindowToSecondDisplay = true;
          } else if (remote.callbacks >= movedAtFrames + 12) {
            const destination = placement(patternWindow);
            assert.equal(destination.display.id, targetDisplay.id, 'safe pattern remains on the external display');
            assert.ok(contains(targetArea, destination.evidence.windowBounds), 'captured window remains within the destination');
            const first = report.firstDisplayCapture;
            const scaleChanged = destination.display.scaleFactor !== first.placement.scaleFactor;
            const sizesChanged = [local, remote].every((sample, index) => {
              const previous = index === 0 ? first.local : first.remote;
              return sample.width !== previous.width && sample.height !== previous.height;
            });
            if (scaleChanged && !sizesChanged) { await sleep(350); continue; }
            assert.equal(local.width, remote.width, 'local and decoded destination widths agree');
            assert.equal(local.height, remote.height, 'local and decoded destination heights agree');
            if (destinationSeenAtFrames === null) destinationSeenAtFrames = remote.callbacks;
            if (remote.callbacks < destinationSeenAtFrames + 12) { await sleep(350); continue; }
            report.secondDisplayCapture = { local: { ...local }, remote: { ...remote }, placement: destination.evidence };
            report.destinationVerification = { additionalDecodedCallbacks: remote.callbacks - movedAtFrames,
              decodedCallbacksAfterDestinationSizeObserved: remote.callbacks - destinationSeenAtFrames,
              unchangedDipSize: true, scaleChanged, pixelSizeChanged: sizesChanged };
            moveVerified = true;
            await owner.webContents.executeJavaScript("window.__stopScreenProbe('application-stop')");
          }
        }
      }
      if (passedFrames && state.cleanup) {
        if (config.scenario === 'window-multi-display') assert.ok(moveVerified, 'multi-display capture must be verified before PASS');
        assert.ok(Object.values(state.cleanup).every(Boolean), 'all local/remote tracks, peers and media elements released');
        assert.equal(state.error, undefined);
        assert.equal(state.stopReason, config.scenario === 'window-source-gone' ? 'external-track-ended' : 'application-stop');
        report.result = 'PASS'; report.state = state; break;
      }
      await sleep(350);
    }
    if (report.result === 'FAIL') throw new Error('Native screen case did not complete before timeout');
  } catch (error) { report.failure = { name: error.name, message: error.message }; }
  finally {
    try {
      if (owner && !owner.isDestroyed()) {
        await owner.webContents.executeJavaScript("window.__stopScreenProbe?.('fixture-cleanup')");
        report.afterCleanup = await owner.webContents.executeJavaScript('JSON.parse(JSON.stringify(window.__screenProbe))');
        assert.ok(Object.values(report.afterCleanup.cleanup).every(Boolean), 'final teardown released media');
      }
    } catch (error) { report.cleanupError = error.message; report.result = 'FAIL'; }
    patternWindow?.destroy();
    write(config.scenario + '.json', report);
    console.log(JSON.stringify({ result: report.result, scenario: config.scenario, report: path.join(config.output, config.scenario + '.json'), reason: report.reason }));
    app.exit(report.result === 'FAIL' ? 1 : 0);
  }
})();
