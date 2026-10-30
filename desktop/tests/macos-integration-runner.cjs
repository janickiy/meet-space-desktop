// Native stage05 acceptance: temporary profile, safe renderer and local HTTPS fixtures only.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
function fixtureRenderer() {
  window.__routes = []; window.__events = [];
  window.meetspaceDesktop.onRoute(route => { window.__routes.push(route); history.pushState({}, '', route); });
  window.meetspaceDesktop.onTransportEvent(event => {
    window.__events.push(event);
    if (event.kind === 'lifecycle' && event.type === 'quit') window.__stopIntegrationMedia?.('quit');
  });
  let local, remote, left, right, timer, localVideo, remoteVideo;
  window.__mediaState = null;
  window.__stopIntegrationMedia = reason => {
    clearInterval(timer); timer = null;
    for (const stream of [local, remote]) stream?.getTracks().forEach(track => track.stop());
    for (const peer of [left, right]) peer?.close();
    for (const video of [localVideo, remoteVideo]) if (video) { video.pause(); video.srcObject = null; }
    if (window.__mediaState) {
      window.__mediaState.stopReason = reason;
      window.__mediaState.cleanup = { localEnded: !local || local.getTracks().every(track => track.readyState === 'ended'),
        remoteEnded: !remote || remote.getTracks().every(track => track.readyState === 'ended'),
        peersClosed: (!left || left.connectionState === 'closed') && (!right || right.connectionState === 'closed'),
        videoReleased: !localVideo?.srcObject && !remoteVideo?.srcObject, timerReleased: timer === null };
    }
  };
  window.__mediaSnapshot = () => ({ ...window.__mediaState, localLive: local?.getTracks().some(track => track.readyState === 'live') ?? false,
    remoteLive: remote?.getTracks().some(track => track.readyState === 'live') ?? false,
    connected: left?.connectionState === 'connected' && right?.connectionState === 'connected' });
  const gathered = peer => new Promise((resolve, reject) => {
    if (peer.iceGatheringState === 'complete') return resolve();
    const timeout = setTimeout(() => reject(new Error('Local ICE timeout')), 7000);
    peer.addEventListener('icegatheringstatechange', () => {
      if (peer.iceGatheringState === 'complete') { clearTimeout(timeout); resolve(); }
    });
  });
  window.__startIntegrationMedia = async () => {
    window.__stopIntegrationMedia('restart');
    const state = window.__mediaState = { source: 'synthetic own canvas', decodedFrames: 0, uniqueHashes: 0, cleanup: null };
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d'); let frame = 0;
    const paint = () => { context.fillStyle = frame++ % 2 ? '#e51b35' : '#19d04d'; context.fillRect(0, 0, 320, 180);
      context.fillStyle = '#1558e8'; context.fillRect(frame * 7 % 240, 45, 80, 80); };
    paint(); timer = setInterval(paint, 120); local = canvas.captureStream(8);
    localVideo ||= document.createElement('video'); remoteVideo ||= document.createElement('video');
    for (const video of [localVideo, remoteVideo]) { video.muted = true; video.width = 320; if (!video.isConnected) document.body.append(video); }
    localVideo.srcObject = local; await localVideo.play();
    left = new RTCPeerConnection({ iceServers: [] }); right = new RTCPeerConnection({ iceServers: [] }); remote = new MediaStream();
    right.ontrack = event => remote.addTrack(event.track);
    for (const track of local.getTracks()) left.addTrack(track, local);
    await left.setLocalDescription(await left.createOffer()); await gathered(left);
    await right.setRemoteDescription(left.localDescription); await right.setLocalDescription(await right.createAnswer()); await gathered(right);
    await left.setRemoteDescription(right.localDescription);
    remoteVideo.srcObject = remote; await remoteVideo.play();
    const sample = document.createElement('canvas'); sample.width = 1; sample.height = 1;
    const pixels = sample.getContext('2d', { willReadFrequently: true }), hashes = new Set();
    const observe = () => {
      if (!remoteVideo.srcObject || state !== window.__mediaState) return;
      pixels.drawImage(remoteVideo, 0, 0, 1, 1);
      hashes.add([...pixels.getImageData(0, 0, 1, 1).data].join(',')); state.decodedFrames++; state.uniqueHashes = hashes.size;
      remoteVideo.requestVideoFrameCallback(observe);
    };
    remoteVideo.requestVideoFrameCallback(observe);
  };
}
(async () => {
  if (process.platform !== 'darwin') throw new Error('This acceptance requires a native Mac');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-macos-integration-'));
  const output = path.resolve(process.argv[2] || path.join(__dirname, '../artifacts/macos-stage05/native'));
  try {
    await fs.mkdir(output, { recursive: true });
    const renderer = path.join(root, 'renderer'); await fs.mkdir(renderer);
    await fs.writeFile(path.join(renderer, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace integration fixture</title></head><body><h1>MeetSpace macOS integration test</h1><p>Disposable local fixture. No camera, microphone, screen capture or production account.</p><script src="fixture.js"></script></body></html>');
    await fs.writeFile(path.join(renderer, 'fixture.js'), '(' + fixtureRenderer.toString() + ')();');
    const config = path.join(root, 'config.json');
    await fs.writeFile(config, JSON.stringify({ profile: path.join(root, 'profile'), renderer, output }));
    const env = { ...process.env };
    for (const name of ['ELECTRON_RUN_AS_NODE', 'MEETSPACE_DESKTOP_DEV', 'MEETSPACE_DEV_CSP_NONCE', 'NODE_OPTIONS']) delete env[name];
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(__dirname, 'macos-integration-electron.cjs'), config], { env, stdio: 'inherit' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Native integration timeout')); }, 100000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Native integration failed: ' + code)); });
    });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
