// Test entry: production ConferenceMediaClient + actual Chromium/Pion/TURN.
// Peers share one owned renderer. The bounded local driver replaces API
// signaling only; this is not a multi-account production-server test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { app } = require("electron");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
app.setPath("userData", config.userDataDir);
app.setPath("sessionData", config.userDataDir);
// Fake capture traverses real permission handlers; consent bypass is not used.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
const { startApp } = require("../dist/main.js");

(async () => {
  const started = Date.now();
  let window, interval, closing = false, runtimeFailure = null;
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const args = ["--max-peers", String(config.participants), ...(config.relay ? ["--relay"] : [])];
  const engine = spawn(config.executable, args, { stdio: ["pipe", "pipe", "inherit"] });
  let delivery = Promise.resolve();
  const lines = readline.createInterface({ input: engine.stdout });
  lines.on("line", (line) => {
    try {
      const value = JSON.parse(line);
      if (value.ready) { readyResolve(value); return; }
      if (value.clientId && value.event) {
        delivery = delivery.then(() => window.webContents.executeJavaScript(
          "window.__sfu.clients[" + JSON.stringify(value.clientId) + "]?.handle(" + JSON.stringify(value.event) + "); void 0"));
        delivery.catch((error) => { runtimeFailure = error; });
      } else if (value.id && pending.has(value.id)) {
        const waiter = pending.get(value.id); pending.delete(value.id); clearTimeout(waiter.timer);
        value.ok ? waiter.resolve(value.result) : waiter.reject(new Error("SFU fixture: " + (value.error || "request_failed")));
      } else if (value.ok === false) runtimeFailure = new Error("SFU signaling: " + (value.error || "request_failed"));
    } catch { runtimeFailure = new Error("Malformed SFU fixture envelope"); }
  });
  engine.once("error", readyReject);
  engine.once("exit", () => { if (!closing) { runtimeFailure = new Error("SFU process exited unexpectedly"); readyReject(runtimeFailure); } });
  const rpc = (action) => new Promise((resolve, reject) => {
    const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(new Error("SFU driver request timeout")); }, 10_000);
    pending.set(id, { resolve, reject, timer });
    engine.stdin.write(JSON.stringify({ id, clientId: "observer", action, data: {} }) + "\n");
  });
  const watchdog = setTimeout(() => { console.error("Electron SFU case exceeded 210 seconds"); engine.kill(); app.exit(1); }, 210_000);
  try {
    const readyState = await ready;
    assert.equal(readyState.maxPeers, config.participants);
    const wayland = process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);
    window = await startApp({ show: wayland, userDataDir: config.userDataDir, rendererRoot: config.rendererRoot });
    assert.ok(window);
    if (wayland) assert.equal(window.isVisible(), true, "production startup maps the Wayland surface");
    const prefs = window.webContents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    const js = (code) => window.webContents.executeJavaScript(code, true);
    const setup = () => {
      const s = window.__sfu = { clients: {}, views: {}, outgoing: [], peers: [], tracks: [], videos: new Map() };
      const RealPeer = window.RTCPeerConnection;
      window.RTCPeerConnection = new Proxy(RealPeer, { construct(Target, args) {
        const pc = Reflect.construct(Target, args); s.peers.push(pc); return pc;
      } });
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await capture(...args); s.tracks.push(...stream.getTracks()); return stream;
      };
      s.make = (id) => {
        s.clients[id] = new MeetSpaceMedia.ConferenceMediaClient((action, data) => {
          const request = crypto.randomUUID(); s.outgoing.push({ id: request, clientId: id, action, data }); return request;
        }, (view) => {
          s.views[id] = view;
          const active = new Set(view.remoteStreams.map(remote => id + ":" + remote.id));
          for (const [key, video] of s.videos) if (key.startsWith(id + ":") && !active.has(key)) {
            video.pause(); video.srcObject = null; video.remove(); s.videos.delete(key);
          }
          for (const remote of view.remoteStreams) {
            const key = id + ":" + remote.id;
            let video = s.videos.get(key);
            if (!video) {
              video = document.createElement("video"); video.muted = true; video.autoplay = true; video.playsInline = true;
              document.body.append(video); s.videos.set(key, video);
            }
            if (video.srcObject !== remote.stream) { video.srcObject = remote.stream; video.play().catch(() => {}); }
          }
        });
      };
      s.stats = async (ids) => Promise.all(ids.map(async id => {
        // Associate PCs by the real local sender tracks, not private client fields.
        const own = new Set(s.views[id]?.localStream?.getTracks().map(t => t.id) || []);
        const pc = s.peers.find(p => p.connectionState !== "closed" && p.getSenders().some(sender => sender.track && own.has(sender.track.id)));
        if (!pc) return { id, state: "missing", incoming: [] };
        const report = await pc.getStats(), items = [...report.values()];
        const transport = items.find(item => item.type === "transport" && item.selectedCandidatePairId);
        const pair = transport && report.get(transport.selectedCandidatePairId), local = pair && report.get(pair.localCandidateId);
        const incoming = items.filter(item => item.type === "inbound-rtp").map(item => ({
          id: item.id, kind: item.kind, bytes: item.bytesReceived || 0, packets: item.packetsReceived || 0,
          frames: item.framesDecoded || 0, samples: item.totalSamplesReceived || 0, codec: report.get(item.codecId)?.mimeType || ""
        }));
        return { id, state: pc.connectionState, ice: pc.iceConnectionState, route: local?.candidateType, mediaPeerId: s.views[id]?.mediaPeerId, incoming };
      }));
    };
    await js("(" + setup.toString() + ")()");
    let pumping = false;
    interval = setInterval(async () => {
      if (pumping || !window || window.isDestroyed()) return;
      pumping = true;
      try { for (const command of await js("window.__sfu.outgoing.splice(0)")) engine.stdin.write(JSON.stringify(command) + "\n"); }
      catch (error) { runtimeFailure = error; }
      finally { pumping = false; }
    }, 10);
    const waitFor = async (operation, description, milliseconds = 35_000) => {
      const deadline = Date.now() + milliseconds;
      while (Date.now() < deadline) {
        if (runtimeFailure) throw runtimeFailure;
        const result = await operation(); if (result) return result;
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      const states = await js("Object.fromEntries(Object.entries(window.__sfu.views).map(([id,v])=>[id,{error:v.error,connectionState:v.connectionState,iceState:v.iceState,negotiationState:v.negotiationState,remoteStreams:v.remoteStreams.length}]))");
      throw new Error(description + ": " + JSON.stringify(states));
    };
    const activeTracks = (peer, kind) => peer.incoming.filter(t => t.kind === kind && t.bytes > 1000 && t.packets > 0 &&
      (kind === "audio" ? t.codec.toLowerCase() === "audio/opus" : t.codec.toLowerCase() === "video/vp8" && t.frames > 3));
    const checkMedia = (ids) => waitFor(async () => {
      const stats = await js("window.__sfu.stats(" + JSON.stringify(ids) + ")"), remoteCount = ids.length - 1;
      return stats.length === ids.length && stats.every(peer => peer.state === "connected" &&
        (config.relay ? peer.route === "relay" : peer.route !== "relay") &&
        activeTracks(peer, "audio").length === remoteCount && activeTracks(peer, "video").length === remoteCount) ? stats : null;
    }, "Every current Chromium peer must receive Opus/decoded VP8 from every other peer");
    const ids = Array.from({ length: config.participants }, (_, i) => "peer" + (i + 1));
    // Two initial publishers, then late joining peers through the same client.
    await js("Promise.all(" + JSON.stringify(ids.slice(0, 2)) + ".map(id=>{window.__sfu.make(id);return window.__sfu.clients[id].start(true)}))");
    await checkMedia(ids.slice(0, 2));
    for (let i = 2; i < ids.length; i++) {
      await js("window.__sfu.make(" + JSON.stringify(ids[i]) + ");window.__sfu.clients[" + JSON.stringify(ids[i]) + "].start(true)");
      await checkMedia(ids.slice(0, i + 1));
    }
    const mediaStats = await checkMedia(ids), activeEngine = await rpc("stats");
    assert.equal(activeEngine.peers, ids.length); assert.equal(activeEngine.tracks, ids.length * 2);
    assert.equal(activeEngine.subscriptions, ids.length * (ids.length - 1) * 2);
    assert.ok(activeEngine.packets > 0 && activeEngine.bytes > 0);
    if (config.relay) assert.ok(activeEngine.turnAllocations >= ids.length, "Every current peer needs a real TURN allocation");
    const leaving = ids.at(-1), previousPeerId = mediaStats.find(peer => peer.id === leaving).mediaPeerId;
    await js("window.__sfu.clients[" + JSON.stringify(leaving) + "].stop();void 0");
    const leaveState = await waitFor(async () => {
      const s = await rpc("stats");
      return s.peers === ids.length - 1 && s.tracks === (ids.length - 1) * 2 &&
        s.subscriptions === (ids.length - 1) * (ids.length - 2) * 2 ? s : null;
    }, "Leaving peer must release its publications/subscriptions");
    await checkMedia(ids.slice(0, -1));
    const closedAfterLeave = await js("window.__sfu.peers.filter(pc=>pc.connectionState==='closed').length");
    assert.equal(closedAfterLeave, 1);
    await js("window.__sfu.make(" + JSON.stringify(leaving) + ");window.__sfu.clients[" + JSON.stringify(leaving) + "].start(true)");
    const rejoined = await checkMedia(ids);
    assert.notEqual(rejoined.find(peer => peer.id === leaving).mediaPeerId, previousPeerId, "Rejoin must create a fresh SFU mediaPeerId");
    const growingStats = await waitFor(async () => {
      const current = await checkMedia(ids);
      return current.every(peer => {
        const before = rejoined.find(old => old.id === peer.id);
        return [...activeTracks(peer, "audio"), ...activeTracks(peer, "video")].every(track => {
          const old = before.incoming.find(t => t.id === track.id);
          return !old || track.bytes > old.bytes && (track.kind !== "video" || track.frames > old.frames);
        });
      }) ? current : null;
    }, "After rejoin every active remote RTP stream must have new/growing counters");
    const rejoinedEngine = await rpc("stats");
    assert.equal(rejoinedEngine.peers, ids.length); assert.equal(rejoinedEngine.tracks, ids.length * 2);
    assert.equal(rejoinedEngine.subscriptions, ids.length * (ids.length - 1) * 2);
    if (config.relay) assert.ok(rejoinedEngine.turnAllocations >= ids.length);
    await js("Object.values(window.__sfu.clients).forEach(client=>client.stop());void 0");
    const finalEngine = await waitFor(async () => {
      const s = await rpc("stats");
      return s.peers === 0 && s.rooms === 0 && s.tracks === 0 && s.subscriptions === 0 && s.turnAllocations === 0 ? s : null;
    }, "Final SFU peers/rooms/tracks/subscriptions and TURN allocations must all be zero");
    const resources = await js("({capturedTracks:window.__sfu.tracks.length,localTracksEnded:window.__sfu.tracks.every(t=>t.readyState==='ended'),createdPeers:window.__sfu.peers.length,peerConnectionsClosed:window.__sfu.peers.every(pc=>pc.connectionState==='closed'),retainedVideoElements:window.__sfu.videos.size})");
    assert.equal(resources.localTracksEnded, true); assert.equal(resources.peerConnectionsClosed, true); assert.equal(resources.retainedVideoElements, 0);
    const result = { result: "PASS", participants: ids.length, relay: config.relay, elapsedMs: Date.now() - started,
      electron: process.versions.electron, platform: process.platform, arch: process.arch, session: process.env.XDG_SESSION_TYPE || "unknown",
      ...config.fixtureEvidence, mediaStats, activeEngine, leaveState, rejoinedEngine, growingStats, finalEngine, resources,
      checks: ["all n-1 remote Opus and decoded VP8 streams per current peer", "selected relay and real TURN allocations when forced", "late join", "stop/leave/fresh-client rejoin", "new mediaPeerId and all-stream counter growth after rejoin", "complete PC/capture/SFU/TURN cleanup"],
      syntheticDevices: true, physicalDevicesTested: false, physicalSleepTested: false, productionApiAuthenticationTested: false,
      scope: "Independent ConferenceMediaClient instances in one owned sandboxed renderer; production Pion engine, local signaling driver, no production service" };
    fs.writeFileSync(config.reportPath, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ result: "PASS", participants: result.participants, relay: result.relay, elapsedMs: result.elapsedMs, finalEngine, resources }));
  } finally {
    closing = true; clearTimeout(watchdog); clearInterval(interval);
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error("SFU fixture closing")); }
    pending.clear();
    if (window && !window.isDestroyed()) window.destroy();
    lines.close(); engine.stdin.end(); engine.kill("SIGTERM");
  }
  app.exit(0);
})().catch((error) => { console.error("Electron SFU integration failed:", error.message); app.exit(1); });
