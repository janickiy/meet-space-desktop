// Opt-in native capture acceptance. Select only the fixture's safe pattern window.
// No screen images, videos, window inventories or account data are written.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

function renderer() {
  const state = window.__screenProbe = { started: false, pending: false, granted: false, events: [], frames: {}, cleanup: null };
  let stream, remote, left, right, currentRequest;
  const localVideo = document.querySelector('#local'), remoteVideo = document.querySelector('#remote');
  const show = () => { document.querySelector('#status').textContent = JSON.stringify(state, null, 2); };
  function observe(video, label) {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36;
    const context = canvas.getContext('2d', { willReadFrequently: true }), hashes = new Set();
    const summary = state.frames[label] = { callbacks: 0, uniqueHashes: 0, nonBlackFraction: 0, saturatedFraction: 0, sizes: [] };
    const sample = () => {
      if (!video.srcObject) return;
      if (video.videoWidth && video.videoHeight) {
        context.drawImage(video, 0, 0, 64, 36);
        const pixels = context.getImageData(0, 0, 64, 36).data;
        let hash = 2166136261, nonBlack = 0, saturated = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
          hash = Math.imul(hash ^ r ^ (g << 8) ^ (b << 16), 16777619);
          if (Math.max(r, g, b) > 30) nonBlack++;
          if (Math.max(r, g, b) - Math.min(r, g, b) > 70) saturated++;
        }
        hashes.add(hash >>> 0); summary.callbacks++; summary.uniqueHashes = hashes.size;
        summary.width = video.videoWidth; summary.height = video.videoHeight;
        const size = video.videoWidth + 'x' + video.videoHeight;
        if (summary.sizes.at(-1) !== size) summary.sizes.push(size);
        summary.nonBlackFraction = Math.max(summary.nonBlackFraction, nonBlack / (64 * 36));
        summary.saturatedFraction = Math.max(summary.saturatedFraction, saturated / (64 * 36));
      }
      video.requestVideoFrameCallback(sample);
    };
    video.requestVideoFrameCallback(sample);
  }
  const gathered = pc => new Promise((resolve, reject) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const timeout = setTimeout(() => reject(new Error('ICE gathering timeout')), 12000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(timeout); resolve(); }
    });
  });
  async function loopback() {
    left = new RTCPeerConnection({ iceServers: [] }); right = new RTCPeerConnection({ iceServers: [] });
    remote = new MediaStream(); right.ontrack = e => remote.addTrack(e.track);
    for (const track of stream.getVideoTracks()) left.addTrack(track, stream);
    await left.setLocalDescription(await left.createOffer()); await gathered(left);
    await right.setRemoteDescription(left.localDescription); await right.setLocalDescription(await right.createAnswer()); await gathered(right);
    await left.setRemoteDescription(right.localDescription);
    remoteVideo.srcObject = remote; await remoteVideo.play(); observe(remoteVideo, 'remoteDecoded');
  }
  function stop(reason) {
    state.stopReason ||= reason;
    state.finalSettings = stream?.getVideoTracks().map(t => { const s = t.getSettings(); return { width: s.width, height: s.height, frameRate: s.frameRate, displaySurface: s.displaySurface }; });
    for (const owned of [stream, remote]) owned?.getTracks().forEach(track => track.stop());
    for (const video of [localVideo, remoteVideo]) { video.pause(); video.srcObject = null; }
    left?.close(); right?.close();
    state.cleanup = { localEnded: !stream || stream.getTracks().every(t => t.readyState === 'ended'),
      remoteEnded: !remote || remote.getTracks().every(t => t.readyState === 'ended'),
      peersClosed: (!left || left.connectionState === 'closed') && (!right || right.connectionState === 'closed'),
      videoReleased: !localVideo.srcObject && !remoteVideo.srcObject };
    show();
  }
  window.__stopScreenProbe = stop;
  window.meetspaceDesktop.onDisplayCaptureEvent(event => {
    state.events.push({ type: event.type, sourceCounts: event.type === 'request' ? {
      screen: event.sources.filter(s => s.kind === 'screen').length,
      window: event.sources.filter(s => s.kind === 'window').length,
    } : undefined });
    currentRequest = event.requestId;
    const choices = document.querySelector('#choices'); choices.replaceChildren();
    if (event.type === 'request') {
      // Test UI intentionally never offers unrelated windows or entire displays.
      for (const source of event.sources.filter(s => s.kind === 'window' && s.name === 'MeetSpace macOS safe pattern')) {
        const button = document.createElement('button'); button.textContent = 'Share safe pattern window';
        button.onclick = () => window.meetspaceDesktop.selectDisplaySource({ requestId: event.requestId, sourceId: source.id, systemAudio: false }).catch(() => {});
        choices.append(button);
      }
    }
    show();
  });
  document.querySelector('#start').onclick = async () => {
    if (state.started) return;
    state.started = true; state.pending = true; show();
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 12, max: 15 } }, audio: false });
      state.granted = true;
      state.settings = stream.getVideoTracks().map(t => { const s = t.getSettings(); return { width: s.width, height: s.height, frameRate: s.frameRate, displaySurface: s.displaySurface }; });
      for (const track of stream.getTracks()) track.addEventListener('ended', () => stop('external-track-ended'));
      localVideo.srcObject = stream; await localVideo.play(); observe(localVideo, 'local'); await loopback();
    } catch (error) { state.error = { name: error.name }; stop('request-rejected'); }
    finally { state.pending = false; show(); }
  };
  document.querySelector('#cancel').onclick = () => { if (currentRequest) void window.meetspaceDesktop.cancelDisplaySource(currentRequest); };
  document.querySelector('#stop').onclick = () => stop('application-stop');
  setInterval(async () => {
    if (right && right.connectionState !== 'closed') {
      state.received = []; for (const stat of (await right.getStats()).values())
        if (stat.type === 'inbound-rtp' && stat.kind === 'video') state.received.push({ bytesReceived: stat.bytesReceived, framesDecoded: stat.framesDecoded });
    }
    show();
  }, 400);
  show();
}

function pattern() {
  const canvas = document.querySelector('canvas'), context = canvas.getContext('2d'); let frame = 0;
  setInterval(() => {
    ['#e51b35', '#19d04d', '#1558e8', '#ffd920'].forEach((color, i) => { context.fillStyle = color; context.fillRect(i * 240, 0, 240, 560); });
    context.fillStyle = '#fff'; context.fillRect((frame * 19) % 880, 130, 80, 100);
    context.fillStyle = '#111'; context.font = 'bold 36px sans-serif'; context.fillText('MeetSpace safe pattern ' + (++frame), 20, 520);
  }, 100);
}

(async () => {
  if (process.platform !== 'darwin' || process.argv[2] !== '--physical') throw new Error('Use macos-screen-runner.cjs --physical [evidence-dir] [window-app-stop|cancel|window-source-gone|window-multi-display] on macOS');
  const output = path.resolve(process.argv[3] || path.join(__dirname, '../artifacts/macos-stage04/native'));
  const scenario = process.argv[4] || 'window-app-stop';
  if (!['window-app-stop', 'cancel', 'window-source-gone', 'window-multi-display'].includes(scenario)) throw new Error('Unknown native screen scenario');
  await fs.mkdir(output, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-macos-screen-'));
  try {
    const rendererRoot = path.join(temporary, 'renderer'), profile = path.join(temporary, 'profile');
    await fs.mkdir(rendererRoot); await fs.mkdir(profile);
    await fs.writeFile(path.join(rendererRoot, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace macOS capture controls</title><link rel="stylesheet" href="screen.css"></head><body><h1>MeetSpace macOS screen test</h1><p>Select only the safe pattern window. No recordings or screenshots are saved. No server is contacted.</p><button id="start">Start capture</button><button id="cancel">Cancel request</button><button id="stop">Stop capture</button><div id="choices"></div><video id="local" muted></video><video id="remote" muted></video><pre id="status"></pre><script src="screen.js"></script></body></html>');
    await fs.writeFile(path.join(rendererRoot, 'screen.js'), '(' + renderer.toString() + ')();');
    await fs.writeFile(path.join(rendererRoot, 'screen.css'), 'body{font:18px sans-serif;background:#eef2fa;color:#102030;margin:18px}button{font:16px sans-serif;margin:6px;padding:12px}video{width:40%;height:170px}pre{font:13px monospace;white-space:pre-wrap}canvas{width:100%;height:auto}');
    await fs.writeFile(path.join(rendererRoot, 'pattern.html'), '<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace macOS safe pattern</title><link rel="stylesheet" href="screen.css"></head><body><canvas width="960" height="560"></canvas><script src="pattern.js"></script></body></html>');
    await fs.writeFile(path.join(rendererRoot, 'pattern.js'), '(' + pattern.toString() + ')();');
    const config = path.join(temporary, 'config.json');
    await fs.writeFile(config, JSON.stringify({ rendererRoot, profile, output, scenario }));
    const env = { ...process.env };
    for (const name of ['ELECTRON_RUN_AS_NODE', 'MEETSPACE_DESKTOP_DEV', 'MEETSPACE_DEV_CSP_NONCE', 'NODE_OPTIONS']) delete env[name];
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(__dirname, 'macos-screen-electron.cjs'), config], { env, stdio: 'inherit' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Native screen probe timeout')); }, 180000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Native screen probe failed: ' + code)); });
    });
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
