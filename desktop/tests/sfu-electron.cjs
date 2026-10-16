// Test entry only: real Chromium media and shared ConferenceMediaClient, local Go SFU.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { app } = require("electron");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
app.setPath("userData", config.userDataDir);
app.setPath("sessionData", config.userDataDir);
// Fake physical devices still traverse the production permission handlers.
// Deliberately do not use use-fake-ui-for-media-stream, which would bypass consent.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
const { startApp } = require("../dist/main.js");

(async () => {
  let window, interval;
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const engine = spawn(config.executable, config.relay ? ["--relay"] : [], { stdio: ["pipe", "pipe", "inherit"] });
  let delivery = Promise.resolve();
  let runtimeFailure = null;
  const lines = readline.createInterface({ input: engine.stdout });
  lines.on("line", (line) => {
    try {
      const value = JSON.parse(line);
      if (value.ready) { readyResolve(value); return; }
      if (value.clientId && value.event) {
        delivery = delivery.then(() => window.webContents.executeJavaScript(
          `window.__sfu.clients[${JSON.stringify(value.clientId)}].handle(${JSON.stringify(value.event)}); void 0`));
        delivery.catch((error) => { runtimeFailure = error; });
      } else if (value.id && pending.has(value.id)) {
        const waiter = pending.get(value.id); pending.delete(value.id);
        value.ok ? waiter.resolve(value.result) : waiter.reject(new Error(`SFU fixture: ${value.error || "request_failed"}`));
      } else if (value.ok === false) {
        runtimeFailure = new Error(`SFU signaling: ${value.error || "request_failed"}`);
      }
    } catch { runtimeFailure = new Error("Malformed SFU fixture envelope"); }
  });
  engine.once("error", readyReject);
  engine.once("exit", (code) => { if (code !== 0) runtimeFailure = new Error("SFU process exited unexpectedly"); });
  const rpc = (action, data = {}, clientId = "a") => new Promise((resolve, reject) => {
    const id = randomUUID(); pending.set(id, { resolve, reject });
    engine.stdin.write(JSON.stringify({ id, clientId, action, data }) + "\n");
  });
  const watchdog = setTimeout(() => { console.error("Electron SFU test exceeded 90 seconds"); engine.kill(); app.exit(1); }, 90_000);
  try {
    await ready;
    window = await startApp({ show: false, userDataDir: config.userDataDir, rendererRoot: config.rendererRoot });
    assert.ok(window);
    const js = (code) => window.webContents.executeJavaScript(code, true);
    await js(`(() => {
      const s = window.__sfu = { clients: {}, views: {}, outgoing: [], peers: [], tracks: [], videos: new Map() };
      const RealPeer = window.RTCPeerConnection;
      window.RTCPeerConnection = new Proxy(RealPeer, { construct(Target, args) {
        const pc = Reflect.construct(Target, args); s.peers.push(pc); return pc;
      }});
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await capture(...args); s.tracks.push(...stream.getTracks()); return stream;
      };
      for (const clientId of ['a', 'b']) s.clients[clientId] = new MeetSpaceMedia.ConferenceMediaClient(
        (action, data) => { const id = crypto.randomUUID(); s.outgoing.push({ id, clientId, action, data }); return id; },
        (view) => {
          s.views[clientId] = view;
          for (const remote of view.remoteStreams) {
            const key = clientId + remote.id;
            let video = s.videos.get(key);
            if (!video) { video = document.createElement('video'); video.muted = true; video.autoplay = true; document.body.append(video); s.videos.set(key, video); }
            if (video.srcObject !== remote.stream) { video.srcObject = remote.stream; video.play().catch(() => {}); }
          }
        });
      s.stats = async () => Promise.all(s.peers.map(async pc => {
        const report = await pc.getStats(); const items = [...report.values()];
        const transport = items.find(item => item.type === 'transport' && item.selectedCandidatePairId);
        const pair = transport && report.get(transport.selectedCandidatePairId);
        const local = pair && report.get(pair.localCandidateId);
        const incoming = items.filter(item => item.type === 'inbound-rtp').map(item => ({
          kind: item.kind, bytes: item.bytesReceived || 0, frames: item.framesDecoded || 0,
          codec: report.get(item.codecId)?.mimeType || ''
        }));
        return { state: pc.connectionState, ice: pc.iceConnectionState, route: local?.candidateType, incoming };
      }));
    })()`);
    let pumping = false;
    interval = setInterval(async () => {
      if (pumping || !window || window.isDestroyed()) return;
      pumping = true;
      try {
        const commands = await js("window.__sfu.outgoing.splice(0)");
        for (const command of commands) engine.stdin.write(JSON.stringify(command) + "\n");
      } catch (error) { runtimeFailure = error; }
      finally { pumping = false; }
    }, 10);
    const waitFor = async (operation, description, milliseconds = 25_000) => {
      const deadline = Date.now() + milliseconds;
      while (Date.now() < deadline) {
        if (runtimeFailure) throw runtimeFailure;
        const result = await operation();
        if (result) return result;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const states = await js("Object.fromEntries(Object.entries(window.__sfu.views).map(([key,v])=>[key,{error:v.error,connectionState:v.connectionState,iceState:v.iceState,negotiationState:v.negotiationState,remoteStreams:v.remoteStreams.length}]))");
      throw new Error(`${description}: ${JSON.stringify(states)}`);
    };
    await js("Promise.all(Object.values(window.__sfu.clients).map(client => client.start(true)))");
    const mediaStats = await waitFor(async () => {
      const stats = await js("window.__sfu.stats()");
      if (stats.length !== 2) return null;
      return stats.every(item => item.state === "connected" &&
        item.incoming.some(track => track.kind === "audio" && track.bytes > 1000 && track.codec.toLowerCase() === "audio/opus") &&
        item.incoming.some(track => track.kind === "video" && track.frames > 3 && track.codec.toLowerCase() === "video/vp8") &&
        (!config.relay || item.route === "relay")) ? stats : null;
    }, "Both actual Chromium clients must receive decoded Opus/VP8 through Pion SFU");
    const activeEngine = await rpc("stats");
    assert.equal(activeEngine.peers, 2);
    assert.ok(activeEngine.packets > 0 && activeEngine.bytes > 0);
    if (config.relay) assert.ok(activeEngine.turnAllocations >= 2, "Both peers require real TURN allocations");
    assert.equal(await js("window.__sfu.tracks.length"), 4);
    await js("Object.values(window.__sfu.clients).forEach(client => client.stop()); void 0");
    await waitFor(() => js("window.__sfu.outgoing.length === 0"), "Leave signaling must flush");
    await waitFor(async () => {
      const stats = await rpc("stats");
      return stats && stats.peers === 0 && stats.rooms === 0 && stats.tracks === 0 && stats.subscriptions === 0 ? stats : null;
    }, "Pion SFU must release both peers, tracks, subscriptions and room");
    assert.equal(await js("window.__sfu.tracks.every(track => track.readyState === 'ended') && window.__sfu.peers.every(pc => pc.connectionState === 'closed')"), true);
    console.log(JSON.stringify({ result: "PASS", relay: config.relay, participants: 2,
      electron: process.versions.electron, platform: process.platform, arch: process.arch,
      mediaStats, activeEngine, localTracksEnded: true, peerConnectionsClosed: true, sfuPeers: 0,
      syntheticDevices: true, stagingTested: false, windowsRuntimeTested: false }));
  } finally {
    clearTimeout(watchdog);
    clearInterval(interval);
    if (window && !window.isDestroyed()) window.destroy();
    lines.close();
    engine.stdin.end();
    engine.kill("SIGTERM");
  }
  app.exit(0);
})().catch((error) => { console.error("Electron SFU integration failed:", error.message); app.exit(1); });
