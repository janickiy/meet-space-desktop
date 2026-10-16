// Explicitly invoked live test entry. Never ship this file or persist/log account input.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { app, BrowserWindow, protocol, session, net, safeStorage } = require("electron");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
app.setPath("userData", config.userDataDir);
app.setPath("sessionData", config.userDataDir);
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
// Deliberately no fake-ui/media-permission bypass and no TLS/certificate overrides.
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false, allowServiceWorkers: false,
} }]);
const { MeetSpaceBroker } = require("../dist/broker.js");
const { createElectronTransport } = require("../dist/network/transport.js");
const { MediaPermissions } = require("../dist/media-permissions.js");
const { serveAppRequest } = require("../dist/protocol.js");
const { isAppUrl, contentSecurityPolicy } = require("../dist/security.js");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition) => { if (!condition) throw new Error("assertion_failed"); };

(async () => {
  let stage = "private_input", room = null, inviteCode = null, roomStarted = false, pumping = false, pump;
  let runtimeFailure = false, cleaning = false, forcedRelay = false;
  const peers = [];
  const blockedActions = new Set();
  const checks = { login: false, roomCreated: false, opusVp8: false, muteRestore: false,
    screenVideo: false, membershipRejoin: false, moderationMute: false, moderationCamera: false,
    waitingRoomAdmission: false, forcedRelay: false, turnAvailable: false,
    localTracksEnded: false, peerConnectionsClosed: false, remoteCleanup: false };
  const report = { result: "FAIL", platform: process.platform, arch: process.arch,
    electron: process.versions.electron, participants: 2, syntheticDevices: true,
    syntheticOwnWindowCapture: true, isDesktopBundle: true,
    forcedRelayPolicySource: "not_used", defaultServerPolicies: [],
    windowsRuntimeTested: process.platform === "win32", checks };
  // Current public Join requires an invitation for new membership; valid invitations
  // bypass the queue for both accounts and guests. Do not fake a waiting admission.
  report.notRun = ["waiting_room_public_invite_join_bypasses_queue"];
  const setStage = (name) => { stage = name; console.log("MEETSPACE_LIVE_STAGE " + JSON.stringify({ stage })); };
  const waitFor = async (fn, milliseconds = 25000, ignoreRuntime = false) => {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      if (!ignoreRuntime && runtimeFailure) throw new Error("runtime_failure");
      const value = await fn(); if (value) return value;
      await pause(60);
    }
    throw new Error("condition_timeout");
  };
  const js = (peer, code) => peer.window.webContents.executeJavaScript(code, true);
  const request = async (peer, method, route, body) => {
    const response = await peer.broker.http({ id: randomUUID(), method, path: "/api/v1" + route,
      responseType: "json", ...(body !== undefined ? { body } : {}), ...(peer.token ? { token: peer.token } : {}) });
    if (response.status < 200 || response.status >= 300) {
      const error = new Error("http_error"); error.status = response.status; throw error;
    }
    return response.body;
  };
  const flush = async () => {
    if (pumping) return;
    pumping = true;
    try {
      for (const peer of peers) {
        if (!peer.window || peer.window.isDestroyed() || !peer.initialized || !peer.socketOpen) continue;
        const outgoing = await js(peer, "window.__live.outgoing.splice(0)");
        for (const item of outgoing) peer.broker.socketSend(peer.socketId, JSON.stringify({ version: 1,
          id: item.id, type: item.action, conferenceId: room, timestamp: new Date().toISOString(), data: item.data }));
      }
    } catch { if (!cleaning) runtimeFailure = true; }
    finally { pumping = false; }
  };
  const setupWindow = async (peer, index) => {
    const rendererSession = session.fromPartition("live-renderer-" + randomUUID());
    const permissions = new MediaPermissions({
      owner: () => peer.window && !peer.window.isDestroyed() ? { contents: peer.window.webContents, frame: peer.window.webContents.mainFrame } : null,
      development: false, platform: process.platform, getSources: async () => [], emit() {},
    });
    rendererSession.setPermissionCheckHandler((contents, permission, origin, details) => permissions.check(contents, permission, origin, details));
    rendererSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(permissions.request(contents, permission, details)));
    // This test ONLY shares its own synthetic page. It never enumerates/captures the desktop.
    // Production picker/security is covered by the separate Electron permission suite.
    rendererSession.setDisplayMediaRequestHandler((details, callback) => {
      const trusted = details.userGesture && details.videoRequested && details.frame === peer.window.webContents.mainFrame && isAppUrl(details.securityOrigin);
      callback(trusted ? { video: peer.window.webContents.mainFrame } : null);
    });
    rendererSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAppUrl(details.url) }));
    rendererSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: {
      ...details.responseHeaders, "Content-Security-Policy": [contentSecurityPolicy(false)], "X-Content-Type-Options": ["nosniff"], "Referrer-Policy": ["no-referrer"],
    } }));
    rendererSession.on("will-download", (event) => event.preventDefault());
    rendererSession.protocol.handle("app", (request) => serveAppRequest(request, config.rendererRoot));
    peer.window = new BrowserWindow({ show: false, width: 720, height: 480, webPreferences: {
      session: rendererSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false,
    } });
    peer.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    peer.window.webContents.on("will-navigate", (event) => event.preventDefault());
    peer.window.webContents.on("will-attach-webview", (event) => event.preventDefault());
    await peer.window.loadURL("app://meetspace/");
    await js(peer, `(() => {
      const s = window.__live = { outgoing: [], peers: [], tracks: [], videos: new Map(), candidateCounts: new WeakMap(), view: null, client: null };
      const RealPeer = window.RTCPeerConnection;
      window.RTCPeerConnection = new Proxy(RealPeer, { construct(Target, args) {
        const pc = Reflect.construct(Target, args); s.peers.push(pc);
        const counts = { host: 0, srflx: 0, prflx: 0, relay: 0, unknown: 0 };
        s.candidateCounts.set(pc, counts);
        pc.addEventListener('icecandidate', event => {
          if (!event.candidate) return;
          const type = event.candidate.type;
          counts[['host','srflx','prflx','relay'].includes(type) ? type : 'unknown']++;
        });
        return pc;
      }});
      for (const name of ['getUserMedia','getDisplayMedia']) {
        const original = navigator.mediaDevices[name].bind(navigator.mediaDevices);
        navigator.mediaDevices[name] = async (...args) => { const stream = await original(...args); s.tracks.push(...stream.getTracks()); return stream; };
      }
      s.create = () => {
        s.client = new MeetSpaceMedia.ConferenceMediaClient(
          (action, data) => { const id = crypto.randomUUID(); s.outgoing.push({id, action, data}); return id; },
          (view) => { s.view = view; for (const remote of view.remoteStreams) {
            let video = s.videos.get(remote.id);
            if (!video) { video = document.createElement('video'); video.muted = true; video.autoplay = true; document.body.append(video); s.videos.set(remote.id, video); }
            if (video.srcObject !== remote.stream) { video.srcObject = remote.stream; video.play().catch(() => {}); }
          }});
      };
      s.stats = async () => {
        const pc = s.peers.findLast(item => item.connectionState !== 'closed');
        if (!pc) return null;
        const report = await pc.getStats(), values = [...report.values()];
        const transport = values.find(item => item.type === 'transport' && item.selectedCandidatePairId);
        const pair = transport && report.get(transport.selectedCandidatePairId), local = pair && report.get(pair.localCandidateId);
        const remote = pair && report.get(pair.remoteCandidateId);
        const types = ['host','srflx','prflx','relay'];
        const counts = s.candidateCounts.get(pc);
        const policy = pc.getConfiguration().iceTransportPolicy;
        return { state: pc.connectionState, route: types.includes(local?.candidateType) ? local.candidateType : 'unknown',
          remoteRoute: types.includes(remote?.candidateType) ? remote.candidateType : 'unknown',
          configuredIceTransportPolicy: ['all','relay'].includes(policy) ? policy : 'unknown',
          gatheredLocalCandidateTypes: types.filter(type => counts[type] > 0), gatheredLocalCandidateCounts: { ...counts },
          selectedRelayProtocol: ['udp','tcp','tls'].includes(local?.relayProtocol) ? local.relayProtocol : undefined,
          activePeerIsCurrent: pc === s.client?.pc, activePeerConnections: s.peers.filter(item => item.connectionState !== 'closed').length,
          incoming: values.filter(item => item.type === 'inbound-rtp').map(item => ({
          kind: item.kind, bytes: item.bytesReceived || 0, frames: item.framesDecoded || 0, codec: report.get(item.codecId)?.mimeType || ''
        })) };
      };
      s.counters = async () => {
        const pc = s.peers.findLast(item => item.connectionState !== 'closed');
        if (!pc) return {};
        const screens = new Set((s.view?.remoteStreams || []).filter(remote => remote.screen)
          .flatMap(remote => remote.stream.getVideoTracks().filter(track => track.readyState === 'live').map(track => track.id)));
        const report = await pc.getStats();
        return Object.fromEntries([...report.values()].filter(item => item.type === 'inbound-rtp').map(item => [s.peers.indexOf(pc) + ':' + item.id, {
          kind: item.kind, bytes: item.bytesReceived || 0, frames: item.framesDecoded || 0,
          screen: screens.has(item.trackIdentifier), codec: report.get(item.codecId)?.mimeType || ''
        }]));
      };
      s.diagnostics = async () => ({ stats: await s.stats(),
        connection: s.view?.connectionState, ice: s.view?.iceState, negotiation: s.view?.negotiationState,
        microphone: !!s.view?.microphoneEnabled, camera: !!s.view?.cameraEnabled, screen: !!s.view?.screenSharing,
        localLiveTracks: s.tracks.filter(track => track.readyState === 'live').length,
        remoteStreams: s.view?.remoteStreams.length || 0,
        remoteScreens: s.view?.remoteStreams.filter(remote => remote.screen).length || 0 });
      const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
      s.animation = setInterval(() => { context.fillStyle = 'hsl(' + (Date.now()/30%360) + ',75%,50%)'; context.fillRect(0,0,640,360); }, 100);
      s.create();
    })()`);
    peer.initialized = true;
  };
  const openSocket = async (peer) => {
    peer.socketId = randomUUID(); peer.socketOpen = false;
    await peer.broker.socketOpen({ id: peer.socketId, kind: "conference", conferenceId: room, clientId: randomUUID(), token: peer.token });
    await waitFor(() => peer.socketOpen, 15000);
  };
  const waitMedia = async (relay = false) => waitFor(async () => {
    const stats = await Promise.all(peers.map(peer => js(peer, "window.__live.stats()")));
    return stats.every(item => item && item.state === "connected" && (!relay || item.route === "relay") &&
      item.incoming.some(track => track.kind === "audio" && track.bytes > 1000 && track.codec.toLowerCase() === "audio/opus") &&
      item.incoming.some(track => track.kind === "video" && track.frames > 3 && track.codec.toLowerCase() === "video/vp8")) ? stats : null;
  }, 35000);
  const stopMedia = async (subset = peers) => {
    const leftCounts = subset.map(peer => peer.leftCount);
    for (const peer of subset) await js(peer, "window.__live.client.stop(); void 0");
    await waitFor(() => subset.every((peer, index) => peer.leftCount > leftCounts[index]), 10000, cleaning);
    await Promise.all(subset.map(peer => peer.delivery));
  };
  const snapshot = (subset) => Promise.all(subset.map(peer => js(peer, "window.__live.counters()")));
  const waitGrowth = async (subset, before, kinds = ["audio", "video"], screenOnly = false) => {
    await waitFor(async () => {
      const after = await snapshot(subset);
      return after.every((counters, index) => kinds.every(kind => Object.entries(counters).some(([id, value]) => {
        const previous = before[index][id] || { bytes: 0, frames: 0 };
        return value.kind === kind && (!screenOnly || value.screen) && value.bytes - previous.bytes > 2000 &&
          (kind !== "video" || value.frames - previous.frames > 3) &&
          value.codec.toLowerCase() === (kind === "audio" ? "audio/opus" : "video/vp8");
      })));
    }, 20000);
  };
  const moderate = async (action, blocked) => {
    if (blocked) blockedActions.add(action); // Also restore if the response is lost after server commit.
    const result = await request(peers[0], "POST", "/conferences/" + room + "/participants/" + peers[1].participantId + "/moderation", { action, blocked });
    const field = action === "mute" ? "microphoneBlocked" : "cameraBlocked";
    assert(result?.item?.[field] === blocked);
    if (!blocked) blockedActions.delete(action);
    await waitFor(() => peers[1].policy?.[field] === blocked, 15000);
    await peers[1].delivery;
  };
  try {
    const file = fs.statSync(config.credentialsPath);
    assert(file.isFile() && file.size <= 8192);
    const input = JSON.parse(fs.readFileSync(config.credentialsPath, "utf8"));
    assert(input.origin === "https://meeting.janickiy.com" && Array.isArray(input.accounts) && input.accounts.length === 2);
    assert(input.accounts.every(account => account && typeof account.email === "string" && account.email.length <= 320 && typeof account.password === "string" && account.password.length > 0 && account.password.length <= 4096));
    assert(input.accounts[0].email.toLowerCase() !== input.accounts[1].email.toLowerCase());
    await app.whenReady();
    assert(safeStorage.isEncryptionAvailable());
    for (let index = 0; index < 2; index++) {
      setStage("account_" + (index + 1) + "_probe");
      const peer = { broker: null, token: null, userId: null, window: null, leftCount: 0, delivery: Promise.resolve(), logoutComplete: false, joined: false, policy: null, protocolError: null };
      peers.push(peer);
      const native = createElectronTransport(net, session.fromPartition("live-native-" + randomUUID()));
      peer.broker = new MeetSpaceBroker({
        storageDir: path.join(config.userDataDir, "account-" + index),
        cipher: { isAvailable: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(Buffer.from(value)) },
        transport: { request: async (request) => {
          const response = await native.request(request);
          if (new URL(request.url).pathname === "/api/v1/auth/logout" && (response.status >= 200 && response.status < 300 || response.status === 401)) peer.logoutComplete = true;
          return response;
        } },
        emit: (event) => {
          if (event.kind !== "socket" || event.id !== peer.socketId) return;
          if (event.type === "open") peer.socketOpen = true;
          if ((event.type === "error" || event.type === "close") && !cleaning) runtimeFailure = true;
          if (event.type !== "message" || !peer.initialized) return;
          try {
            const envelope = JSON.parse(event.data);
            if (envelope.type === "media.joined") {
              peer.mediaPeerId = envelope.data?.mediaPeerId;
              const policy = ["all", "relay"].includes(envelope.data?.iceTransportPolicy) ? envelope.data.iceTransportPolicy : "missing";
              if (!report.defaultServerPolicies.includes(policy)) report.defaultServerPolicies.push(policy);
              const urls = (envelope.data?.iceServers || []).flatMap(server => Array.isArray(server.urls) ? server.urls : [server.urls]);
              checks.turnAvailable ||= urls.some(url => typeof url === "string" && /^turns?:/.test(url));
              if (forcedRelay) envelope.data.iceTransportPolicy = "relay";
            }
            if (envelope.type === "media.policy" && envelope.data?.mediaPeerId === peer.mediaPeerId) peer.policy = envelope.data.policy;
            if (envelope.type === "error") {
              const safeCodes = new Set(["media_unavailable", "invalid_media_signal", "media_unauthorized", "media_ownership_lost", "media_limit_exceeded", "media_peer_not_found", "media_negotiation_conflict", "screen_sharing_conflict", "media_policy_blocked", "forbidden"]);
              peer.protocolError = safeCodes.has(envelope.data?.code) ? envelope.data.code : "protocol_error";
            }
            if (envelope.type === "media.left") peer.leftCount++;
            peer.delivery = peer.delivery.then(() => js(peer, `window.__live.client.handle(${JSON.stringify(envelope)}); void 0`));
            peer.delivery.catch(() => { if (!cleaning) runtimeFailure = true; });
          } catch { if (!cleaning) runtimeFailure = true; }
        },
      });
      await peer.broker.initialize();
      const probe = await peer.broker.probeServer(input.origin);
      if (index === 0) report.serverVersion = probe.version;
      await peer.broker.addServer({ origin: input.origin, label: "Temporary live acceptance profile" });
      await peer.broker.selectServer(peer.broker.serversState().items[0].id);
      // Exactly one password request for each supplied account. No automatic login retry.
      setStage("account_" + (index + 1) + "_login_once");
      const login = await request(peer, "POST", "/auth/login", input.accounts[index]);
      input.accounts[index].password = "";
      assert(typeof login?.accessToken === "string" && login.accessToken.startsWith("desktop-session:") && typeof login.user?.id === "string");
      peer.token = login.accessToken; peer.userId = login.user.id;
      setStage("account_" + (index + 1) + "_renderer");
      await setupWindow(peer, index);
    }
    checks.login = true;
    setStage("create_unique_room");
    const created = await request(peers[0], "POST", "/conferences", { title: "Desktop media acceptance " + new Date().toISOString() + " " + randomUUID().slice(0, 8), waitingRoomEnabled: false });
    assert(typeof created?.item?.id === "string");
    room = created.item.id; inviteCode = created.item.inviteCode; checks.roomCreated = true;
    assert(typeof inviteCode === "string" && /^[A-Za-z0-9_-]{32}$/.test(inviteCode));
    await request(peers[0], "POST", "/conferences/" + room + "/start"); roomStarted = true;
    for (let index = 0; index < peers.length; index++) {
      const joined = await request(peers[index], "POST", "/conferences/" + room + "/join", index ? { inviteCode } : {});
      assert(joined?.item?.admissionState === "admitted"); peers[index].joined = true; peers[index].participantId = joined.item.id;
      await openSocket(peers[index]);
    }
    pump = setInterval(() => { void flush(); }, 20);
    setStage("two_peer_opus_vp8");
    await Promise.all(peers.map(peer => js(peer, "window.__live.client.start(true)")));
    report.initialMedia = await waitMedia(); checks.opusVp8 = true;
    setStage("mute_restore");
    await js(peers[0], "window.__live.client.changeSource('microphone', false)");
    await waitFor(() => js(peers[0], "!window.__live.view.microphoneEnabled && !window.__live.view.controlBusy"));
    await pause(1500); // Let RTP already in flight drain before measuring the restoration.
    const mutedBaseline = await snapshot([peers[1]]);
    await js(peers[0], "window.__live.client.changeSource('microphone', true)");
    await waitFor(() => js(peers[0], "window.__live.view.microphoneEnabled && !window.__live.view.controlBusy"));
    await waitGrowth([peers[1]], mutedBaseline, ["audio"]); checks.muteRestore = true;
    setStage("synthetic_window_screen_video");
    peers[0].window.show(); peers[0].window.focus();
    await waitFor(() => js(peers[0], "document.hasFocus()"), 5000);
    const screenBaseline = await snapshot([peers[1]]);
    await js(peers[0], "window.__live.client.startScreen()");
    await waitFor(() => js(peers[0], "window.__live.view.screenSharing && !window.__live.view.controlBusy"));
    // Match the live remote screen track, not retired camera SSRC counters.
    await waitGrowth([peers[1]], screenBaseline, ["video"], true);
    await js(peers[0], "window.__live.client.stopScreen()");
    await waitFor(() => js(peers[0], "!window.__live.view.screenSharing && !window.__live.view.controlBusy"));
    checks.screenVideo = true;
    peers[0].window.hide();
    setStage("participant_leave_and_rejoin");
    await stopMedia([peers[1]]);
    peers[1].broker.socketClose(peers[1].socketId); peers[1].socketOpen = false;
    await request(peers[1], "POST", "/conferences/" + room + "/leave"); peers[1].joined = false;
    await pause(1500);
    const rejoinBaseline = await snapshot(peers);
    await request(peers[1], "POST", "/conferences/" + room + "/join", { inviteCode }); peers[1].joined = true;
    await js(peers[1], "window.__live.create(); void 0");
    await openSocket(peers[1]);
    await js(peers[1], "window.__live.client.start(true)");
    await waitMedia(); await waitGrowth(peers, rejoinBaseline); checks.membershipRejoin = true;
    for (const [action, source, field, resultKey, kind] of [
      ["mute", "microphone", "microphoneEnabled", "moderationMute", "audio"],
      ["camera", "camera", "cameraEnabled", "moderationCamera", "video"],
    ]) {
      setStage("moderation_" + action + "_block_restore");
      await moderate(action, true);
      await waitFor(() => js(peers[1], `!window.__live.view.${field} && !window.__live.view.controlBusy`));
      await js(peers[1], `window.__live.client.changeSource(${JSON.stringify(source)}, true)`);
      assert(await js(peers[1], `!window.__live.view.${field}`));
      await pause(1500);
      const policyBaseline = await snapshot([peers[0]]);
      await moderate(action, false);
      await js(peers[1], `window.__live.client.changeSource(${JSON.stringify(source)}, true)`);
      await waitFor(() => js(peers[1], `window.__live.view.${field} && !window.__live.view.controlBusy`));
      await waitGrowth([peers[0]], policyBaseline, [kind]); checks[resultKey] = true;
    }
    if (checks.turnAvailable) {
      setStage("forced_relay_both_peers");
      await stopMedia(); forcedRelay = true; report.forcedRelayPolicySource = "test-client-override";
      await Promise.all(peers.map(peer => js(peer, "window.__live.create(); window.__live.client.start(true)")));
      report.relayMedia = await waitMedia(true); checks.forcedRelay = true;
    }
    if (!checks.turnAvailable) report.notRun.push("production_forced_relay_no_turn_advertised");
    report.result = report.notRun.length ? "PARTIAL" : "PASS";
  } catch (error) {
    report.failedStage = stage;
    const codes = new Set(["assertion_failed", "runtime_failure", "condition_timeout", "http_error", "tls_error", "dns_error", "network_timeout", "network_unavailable", "incompatible_server", "invalid_response", "secure_storage_unavailable", "authentication_required", "stale_session", "request_limit", "socket_unavailable"]);
    report.failureCode = codes.has(error?.message) ? error.message : "test_operation_failed";
    if (Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599) report.httpStatus = error.status;
    report.diagnostics = await Promise.all(peers.map(async peer => {
      try {
        const detail = await Promise.race([js(peer, "window.__live.diagnostics()"), pause(2000).then(() => ({ available: false }))]);
        return { socketOpen: !!peer.socketOpen, protocolError: peer.protocolError, ...detail };
      }
      catch { return { available: false }; }
    }));
  } finally {
    cleaning = true;
    setStage("cleanup_own_room_and_sessions");
    const cleanupFailures = [];
    for (const peer of peers) {
      if (peer.initialized && !peer.window.isDestroyed()) {
        try { await js(peer, "window.__live.client.stop(); clearInterval(window.__live.animation); void 0"); } catch { cleanupFailures.push("local_stop"); }
      }
    }
    await pause(150); await flush();
    try {
      checks.localTracksEnded = peers.filter(peer => peer.initialized).length > 0 && (await Promise.all(peers.filter(peer => peer.initialized).map(peer => js(peer, "window.__live.tracks.every(track => track.readyState === 'ended')")))).every(Boolean);
      checks.peerConnectionsClosed = peers.filter(peer => peer.initialized).length > 0 && (await Promise.all(peers.filter(peer => peer.initialized).map(peer => js(peer, "window.__live.peers.every(pc => pc.connectionState === 'closed')")))).every(Boolean);
      if (peers.some(peer => peer.initialized) && (!checks.localTracksEnded || !checks.peerConnectionsClosed)) cleanupFailures.push("local_resources");
    } catch { cleanupFailures.push("local_resources"); }
    clearInterval(pump);
    if (room && peers[1]?.participantId && peers[0]?.token) {
      for (const action of blockedActions) {
        try {
          await request(peers[0], "POST", "/conferences/" + room + "/participants/" + peers[1].participantId + "/moderation", { action, blocked: false });
        } catch { cleanupFailures.push("policy_restore"); }
      }
    }
    for (const peer of peers) {
      if (peer.socketId) peer.broker.socketClose(peer.socketId);
      if (room && peer.joined) {
        try { await request(peer, "POST", "/conferences/" + room + "/leave"); peer.joined = false; } catch { cleanupFailures.push("room_leave"); }
      }
    }
    if (room && peers[0]?.token) {
      try { await request(peers[0], "POST", "/conferences/" + room + (roomStarted ? "/finish" : "/cancel")); } catch { cleanupFailures.push("room_finish"); }
    }
    for (const peer of peers) {
      if (peer.token) {
        try {
          await request(peer, "POST", "/auth/logout", { userId: peer.userId }); peer.token = null;
          await waitFor(() => peer.logoutComplete, 20000, true);
        } catch { cleanupFailures.push("remote_logout"); }
      }
      peer.broker?.dispose();
      if (peer.window && !peer.window.isDestroyed()) peer.window.destroy();
    }
    checks.remoteCleanup = cleanupFailures.length === 0;
    report.roomHistoryRetained = !!room;
    if (cleanupFailures.length) { report.result = "FAIL"; report.cleanupFailures = [...new Set(cleanupFailures)]; }
    console.log("MEETSPACE_LIVE_RESULT " + JSON.stringify(report));
  }
  app.exit(report.result === "PASS" || report.result === "PARTIAL" ? 0 : 1);
})().catch(() => { console.log('MEETSPACE_LIVE_RESULT {"result":"FAIL","failedStage":"unhandled_setup","remoteCleanup":"unconfirmed"}'); app.exit(1); });
