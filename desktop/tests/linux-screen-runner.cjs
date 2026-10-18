// Real Linux capture acceptance fixture. No fake source, permission or portal APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');

function renderer() {
  const config = JSON.parse(document.querySelector('#config').textContent);
  const state = window.__screenTest = { schemaVersion: 1, scenario: config.scenario, selectedKind: config.selectedKind,
    started: false, pending: false, granted: false, error: null, events: [], frames: {}, tracks: [], operatorPortalGone: false,
    stopReason: null, finished: false, loopback: null, elapsedMs: 0 };
  const startedAt = performance.now();
  const status = document.querySelector('#status');
  const button = id => document.querySelector('#' + id);
  let stream, remoteStream, localVideo, remoteVideo, left, right, requestId, cancelAt, sourceTimer;
  const boundedError = error => ({ name: String(error?.name || 'Error').slice(0, 80), message: String(error?.message || error).slice(0, 300) });
  const settings = track => Object.fromEntries(Object.entries(track.getSettings()).filter(([key]) => ['width', 'height', 'frameRate', 'displaySurface', 'cursor', 'logicalSurface', 'resizeMode'].includes(key)));
  const update = () => {
    state.elapsedMs = Math.round(performance.now() - startedAt);
    if (stream) state.tracks = stream.getTracks().map(track => ({ kind: track.kind, readyState: track.readyState, enabled: track.enabled, muted: track.muted, settings: settings(track) }));
    status.textContent = JSON.stringify(state, null, 2);
    button('start').disabled = state.started;
    button('stop').disabled = !stream || stream.getTracks().every(track => track.readyState === 'ended');
    button('finish').disabled = state.pending || (stream && stream.getTracks().some(track => track.readyState !== 'ended'));
  };
  function pattern(canvas) {
    const context = canvas.getContext('2d'); let count = 0;
    setInterval(() => { const w = canvas.width, h = canvas.height; const colors = ['#e51b35', '#19d04d', '#1558e8', '#ffd920'];
      colors.forEach((color, i) => { context.fillStyle = color; context.fillRect(i * w / 4, 0, w / 4, h); });
      context.fillStyle = '#fff'; context.fillRect((count * 17) % (w - 70), h * .3, 70, 90);
      context.fillStyle = '#111'; context.font = 'bold 36px sans-serif'; context.fillText('MeetSpace safe pattern ' + (++count), 18, h - 25);
    }, 100);
  }
  pattern(document.querySelector('canvas'));
  function observe(video, label) {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const hashes = new Set(); const summary = state.frames[label] = { callbacks: 0, uniqueHashes: 0, nonBlackFraction: 0, saturatedFraction: 0, redFraction: 0, greenFraction: 0, blueFraction: 0, yellowFraction: 0 };
    const next = () => {
      if (!video.srcObject) return;
      if (video.videoWidth && video.videoHeight) {
        context.drawImage(video, 0, 0, 64, 36); const data = context.getImageData(0, 0, 64, 36).data;
        let hash = 2166136261, nonBlack = 0, saturated = 0, red = 0, green = 0, blue = 0, yellow = 0;
        for (let i = 0; i < data.length; i += 4) { const r = data[i], g = data[i + 1], b = data[i + 2];
          hash = Math.imul(hash ^ r ^ (g << 8) ^ (b << 16), 16777619);
          if (Math.max(r, g, b) > 30) nonBlack++; if (Math.max(r, g, b) - Math.min(r, g, b) > 70) saturated++;
          if (r > 130 && r > g * 1.5 && r > b * 1.4) red++;
          if (g > 120 && g > r * 1.3 && g > b * 1.3) green++;
          if (b > 130 && b > r * 1.5 && b > g * 1.3) blue++;
          if (r > 140 && g > 120 && b < 100) yellow++;
        }
        hashes.add((hash >>> 0).toString(16)); summary.callbacks++; summary.uniqueHashes = hashes.size;
        const pixels = 64 * 36;
        for (const [key, value] of Object.entries({ nonBlackFraction: nonBlack, saturatedFraction: saturated, redFraction: red, greenFraction: green, blueFraction: blue, yellowFraction: yellow })) summary[key] = Math.max(summary[key], value / pixels);
        summary.width = video.videoWidth; summary.height = video.videoHeight;
      }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(next); else setTimeout(next, 100);
    };
    next();
  }
  const play = async input => { const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.playsInline = true; video.srcObject = input; await video.play(); return video; };
  const gathered = pc => new Promise((resolve, reject) => { if (pc.iceGatheringState === 'complete') return resolve(); const timeout = setTimeout(() => reject(new Error('ice_gathering_timeout')), 12000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timeout); resolve(); } }); });
  async function loopback(input) {
    left = new RTCPeerConnection({ iceServers: [] }); right = new RTCPeerConnection({ iceServers: [] });
    remoteStream = new MediaStream(); right.ontrack = event => remoteStream.addTrack(event.track);
    for (const track of input.getVideoTracks()) left.addTrack(track, input);
    await left.setLocalDescription(await left.createOffer()); await gathered(left);
    await right.setRemoteDescription(left.localDescription); await right.setLocalDescription(await right.createAnswer()); await gathered(right);
    await left.setRemoteDescription(right.localDescription);
    remoteVideo = await play(remoteStream); observe(remoteVideo, 'remoteDecoded');
    state.loopback = { implementation: 'real RTCPeerConnection host ICE, no SFU, no signaling/network server', senderState: left.connectionState, receiverState: right.connectionState, inboundVideo: [] };
    sourceTimer = setInterval(async () => { if (!right || right.connectionState === 'closed') return;
      const rows = []; for (const item of (await right.getStats()).values()) if (item.type === 'inbound-rtp' && item.kind === 'video') rows.push({ bytesReceived: item.bytesReceived, framesDecoded: item.framesDecoded, packetsReceived: item.packetsReceived, frameWidth: item.frameWidth, frameHeight: item.frameHeight });
      state.loopback = { ...state.loopback, senderState: left.connectionState, receiverState: right.connectionState, inboundVideo: rows }; update();
    }, 500);
  }
  function release(reason) {
    state.stopReason ||= reason;
    for (const track of stream?.getTracks() || []) track.stop();
    for (const track of remoteStream?.getTracks() || []) track.stop();
    for (const video of [localVideo, remoteVideo]) if (video) { video.pause(); video.srcObject = null; }
    clearInterval(sourceTimer); left?.close(); right?.close();
    state.cleanup = { localTracksEnded: !stream || stream.getTracks().every(t => t.readyState === 'ended'), remoteTracksEnded: !remoteStream || remoteStream.getTracks().every(t => t.readyState === 'ended'), peerConnectionsClosed: (!left || left.connectionState === 'closed') && (!right || right.connectionState === 'closed'), videoSourcesReleased: [localVideo, remoteVideo].every(v => !v || !v.srcObject) };
    update();
  }
  window.meetspaceDesktop.onDisplayCaptureEvent(event => {
    state.events.push({ type: event.type, atMs: Math.round(performance.now() - startedAt), sourceCount: event.sources?.length, sourceKinds: event.sources ? { screen: event.sources.filter(source => source.kind === 'screen').length, window: event.sources.filter(source => source.kind === 'window').length } : undefined });
    requestId = event.requestId;
    if (event.type === 'portal' && config.scenario === 'late-choice') setTimeout(async () => { cancelAt = performance.now(); state.applicationCancelledAtMs = Math.round(cancelAt - startedAt); await window.meetspaceDesktop.cancelDisplaySource(event.requestId); update(); }, 2500);
    if (event.type === 'request') { const choices = button('choices'); choices.replaceChildren(); for (const source of event.sources) { const item = document.createElement('button'); item.textContent = source.kind + ': ' + source.name; item.onclick = () => window.meetspaceDesktop.selectDisplaySource({ requestId: event.requestId, sourceId: source.id, systemAudio: false }).catch(error => { state.selectionError = boundedError(error); update(); }); choices.append(item); } }
    update();
  });
  button('start').onclick = async () => {
    state.started = true; state.pending = true; update();
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 12, max: 15 } }, audio: false }); state.granted = true; state.liveTracks = stream.getTracks().map(track => ({ kind: track.kind, readyState: track.readyState, settings: settings(track) }));
      for (const track of stream.getTracks()) track.addEventListener('ended', () => { state.externalEndedAtMs = Math.round(performance.now() - startedAt); release('external-track-ended'); });
      localVideo = await play(stream); observe(localVideo, 'local'); await loopback(stream);
    } catch (error) { state.error = boundedError(error); release('request-rejected'); }
    finally { state.pending = false; update(); }
  };
  button('stop').onclick = () => release('application-stop');
  button('cancel').onclick = async () => { if (requestId) { state.applicationCancelledAtMs = Math.round(performance.now() - startedAt); await window.meetspaceDesktop.cancelDisplaySource(requestId); } update(); };
  button('portal-gone').onclick = () => { state.operatorPortalGone = true; update(); };
  button('finish').onclick = () => { state.finished = true; update(); };
  window.__screenTestStop = () => release('fixture-timeout-cleanup');
  setInterval(update, 500); update();
}
function pattern() {
  const canvas = document.querySelector('canvas'), context = canvas.getContext('2d'); let count = 0;
  setInterval(() => { const colors = ['#e51b35', '#19d04d', '#1558e8', '#ffd920']; colors.forEach((color, i) => { context.fillStyle = color; context.fillRect(i * 240, 0, 240, 560); }); context.fillStyle = '#fff'; context.fillRect((count * 17) % 880, 150, 80, 100); context.fillStyle = '#111'; context.font = 'bold 36px sans-serif'; context.fillText('MeetSpace safe pattern ' + (++count), 20, 520); }, 100);
}

(async () => {
  assert.equal(process.platform, 'linux', 'Linux-only real capture fixture');
  const output = path.resolve(process.argv[2] || path.join(__dirname, '../artifacts/linux-screen'));
  const scenario = process.argv[3] || 'window-app-stop';
  assert.ok(['window-app-stop', 'monitor-app-stop', 'window-external-stop', 'window-source-gone', 'cancel', 'late-choice'].includes(scenario));
  const autoX11 = process.argv.includes('--auto-x11');
  if (autoX11) assert.ok(process.env.XDG_SESSION_TYPE === 'x11' && process.env.DISPLAY && !process.env.WAYLAND_DISPLAY, 'automatic selection is restricted to genuine fixture X11');
  await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-linux-screen-'));
  const resultPath = path.join(output, scenario + '.json');
  const profile = path.join(directory, 'profile'), rendererRoot = path.join(directory, 'renderer'); await fs.mkdir(profile); await fs.mkdir(rendererRoot);
  const config = { scenario, selectedKind: scenario.startsWith('monitor') ? 'screen' : 'window', autoX11, profile, rendererRoot, resultPath, progressPath: path.join(output, scenario + '-progress.json'), timeoutMs: 240000 };
  const htmlConfig = JSON.stringify({ scenario, selectedKind: config.selectedKind }).replaceAll('<', '\\u003c');
  await fs.writeFile(path.join(rendererRoot, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace Stage04 Capture Controls</title><link rel="stylesheet" href="screen.css"></head><body><h1>MeetSpace Stage04 — ${scenario}</h1><p>Only the Ubuntu safe pattern window or Ubuntu test monitor. No recordings are saved.</p><div><button id="start">1 Start capture</button><button id="stop">2 Stop in application</button><button id="cancel">Cancel pending request</button><button id="portal-gone">3 Operator: portal indicator gone</button><button id="finish">4 Finish case</button></div><div id="choices"></div><canvas width="960" height="300"></canvas><pre id="status"></pre><script id="config" type="application/json">${htmlConfig}</script><script src="screen.js"></script></body></html>`);
  await fs.writeFile(path.join(rendererRoot, 'screen.js'), `(${renderer.toString()})();`);
  await fs.writeFile(path.join(rendererRoot, 'screen.css'), 'body{font:18px sans-serif;margin:16px;background:#eef2fa;color:#102030}button{font:16px sans-serif;margin:4px;padding:12px}canvas{display:block;width:100%;max-height:220px;margin:12px 0}pre{font:13px monospace;white-space:pre-wrap;max-height:280px;overflow:auto}');
  await fs.writeFile(path.join(rendererRoot, 'pattern.html'), '<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace Stage04 Pattern</title><link rel="stylesheet" href="screen.css"></head><body><h1>MeetSpace Stage04 safe window</h1><canvas width="960" height="560"></canvas><script src="pattern.js"></script></body></html>');
  await fs.writeFile(path.join(rendererRoot, 'pattern.js'), `(${pattern.toString()})();`);
  const sources = [];
  for (const name of ['linux-screen-runner.cjs', 'linux-screen-electron.cjs']) { const bytes = await fs.readFile(path.join(__dirname, name)); sources.push({ path: 'desktop/tests/' + name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
  config.harnessInputs = sources;
  try { config.buildMetadata = JSON.parse(await fs.readFile(path.join(__dirname, '../dist/build-provenance.json'), 'utf8')); config.sourceInputs = JSON.parse(await fs.readFile(path.join(__dirname, '../dist/source-inputs.json'), 'utf8')); } catch (error) { throw new Error('Real build provenance and source manifest are required: ' + error.message); }
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify(config));
  const environment = { ...process.env }; for (const key of ['MEETSPACE_DESKTOP_DEV', 'MEETSPACE_DEV_CSP_NONCE', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) delete environment[key];
  try {
    await new Promise((resolve, reject) => { const child = spawn(require('electron'), [path.join(__dirname, 'linux-screen-electron.cjs'), path.join(directory, 'config.json')], { env: environment, stdio: 'inherit' }); const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('screen fixture outer timeout')); }, config.timeoutMs + 15000); child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`screen fixture failed (${code ?? signal}), see ${resultPath}`)); }); });
    const report = JSON.parse(await fs.readFile(resultPath, 'utf8')); assert.equal(report.result, 'PASS'); console.log(JSON.stringify({ result: report.result, scenario, report: resultPath }));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
