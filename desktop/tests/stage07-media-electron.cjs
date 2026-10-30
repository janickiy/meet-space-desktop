// Measurements of real shared modules. HTTPS endpoint fixtures are synthetic;
// Chromium capture/PC, Pion SFU, native broker/preload and React are real.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const WebSocket = require("ws");
const { app } = require("electron");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
app.setPath("userData", config.userDataDir);
app.setPath("sessionData", config.userDataDir);
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
const { startApp } = require("../dist/main.js");
const { createNodeHttpsTransport } = require("../dist/network/transport.js");
const {
  createCertificates,
  createFixture,
  PASSWORD,
} = require("./fixtures/https-fixture.cjs");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  let window, certificates, fixture, pump;
  let runtimeError = null,
    delivery = Promise.resolve();
  const pending = new Map();
  const commands = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const engine = spawn(config.executable, [], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = readline.createInterface({ input: engine.stdout });
  lines.on("line", (raw) => {
    try {
      const value = JSON.parse(raw);
      if (value.ready) return readyResolve(value);
      if (value.clientId && value.event) {
        delivery = delivery.then(() =>
          window.webContents.executeJavaScript(
            `window.__stage07.handleMedia(${JSON.stringify(value.event)}); void 0`,
          ),
        );
        delivery.catch((error) => {
          runtimeError = error;
        });
      } else if (value.id && pending.has(value.id)) {
        const waiter = pending.get(value.id);
        pending.delete(value.id);
        value.ok
          ? waiter.resolve(value.result)
          : waiter.reject(new Error("Pion fixture request failed"));
      } else if (value.ok === false)
        runtimeError = new Error(
          `Pion fixture signal failed: ${commands.get(value.id)?.action ?? "unknown"} ${value.error}`,
        );
      if (value.id && typeof value.ok === "boolean") commands.delete(value.id);
    } catch {
      runtimeError = new Error("Pion fixture malformed envelope");
    }
  });
  engine.once("error", readyReject);
  const rpc = (action) =>
    new Promise((resolve, reject) => {
      const id = randomUUID();
      pending.set(id, { resolve, reject });
      engine.stdin.write(
        JSON.stringify({ id, clientId: "a", action, data: {} }) + "\n",
      );
    });
  const watchdog = setTimeout(() => {
    console.error("Stage07 lifecycle timeout");
    engine.kill();
    app.exit(1);
  }, 420000);
  const checkpoints = [];
  try {
    await ready;
    certificates = await createCertificates();
    fixture = await createFixture({
      name: "stage07",
      certificates,
      ui: true,
      handleRequest: ({ url, send, response }) => {
        if (url.pathname.endsWith("/messages")) {
          send(response, 200, {
            items: [],
            nextCursor: null,
            unreadCount: 0,
            lastReadMessageId: null,
          });
          return true;
        }
        if (url.pathname.endsWith("/chat/read")) {
          send(response, 200, {
            item: { lastReadMessageId: null, unreadCount: 0 },
          });
          return true;
        }
        if (url.pathname === "/api/v1/notifications/preferences") {
          send(response, 200, {
            invitation: true,
            reminder: true,
            recording: true,
            summary: true,
          });
          return true;
        }
      },
    });
    window = await startApp({
      mediaAccess: require('./fixtures/synthetic-media-access.cjs').syntheticMediaAccess,
      show: false,
      rendererRoot: config.rendererRoot,
      userDataDir: config.userDataDir,
      brokerOptions: {
        transport: createNodeHttpsTransport({
          ca: certificates.ca,
          timeoutMs: 3000,
        }),
        createSocket: (url, protocols, options) =>
          new WebSocket(url, protocols, {
            ...options,
            ca: certificates.ca,
            rejectUnauthorized: true,
          }),
      },
    });
    const js = (code) => window.webContents.executeJavaScript(code, true);
    window.webContents.on("console-message", (details) => {
      if (details.level === "error")
        console.error("fixture renderer:", details.message);
    });
    window.webContents.debugger.attach("1.3");
    const cdp = (method, args = {}) =>
      window.webContents.debugger.sendCommand(method, args);
    await js(`(() => {
      const s = window.__stage07 = {outgoing:[], clients:[], peers:[], tracks:[], timers:new Map(), createdPeers:0, closedPeers:0, captures:0};
      const rawSetTimeout=window.setTimeout.bind(window),rawClearTimeout=window.clearTimeout.bind(window),rawSetInterval=window.setInterval.bind(window),rawClearInterval=window.clearInterval.bind(window);
      window.setTimeout=(callback,ms,...args)=>{let id=rawSetTimeout(()=>{s.timers.delete(id);callback(...args)},ms);s.timers.set(id,{type:'timeout',ms});return id};
      window.clearTimeout=id=>{s.timers.delete(id);rawClearTimeout(id)};
      window.setInterval=(callback,ms,...args)=>{let id=rawSetInterval(callback,ms,...args);s.timers.set(id,{type:'interval',ms});return id};
      window.clearInterval=id=>{s.timers.delete(id);rawClearInterval(id)};
      const RawPeer=window.RTCPeerConnection;
      window.RTCPeerConnection=new Proxy(RawPeer,{construct(Target,args){const pc=Reflect.construct(Target,args);s.peers.push(new WeakRef(pc));s.createdPeers++;const close=pc.close.bind(pc);let closed=false;pc.close=()=>{if(!closed){closed=true;s.closedPeers++}close()};return pc}});
      const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async(...args)=>{const stream=await gum(...args);s.captures++;for(const track of stream.getTracks())s.tracks.push(new WeakRef(track));return stream};
      s.metrics=()=>({createdPeers:s.createdPeers,closedPeers:s.closedPeers,captures:s.captures,livePeers:s.peers.filter(ref=>ref.deref()?.connectionState!=='closed'&&ref.deref()).length,
        liveTracks:s.tracks.filter(ref=>ref.deref()?.readyState==='live').length,retainedClients:s.clients.filter(ref=>ref.deref()).length,
        timers:[...s.timers.values()],...s.queryMetrics?.()});
    })()`);
    await js(
      `new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/lifecycle.js';script.onload=resolve;script.onerror=()=>reject(Error('fixture bundle failed'));document.body.append(script)})`,
    );
    await js(
      `(async()=>{const b=window.meetspaceDesktop;const servers=await b.addServer({origin:${JSON.stringify(fixture.origin)}});await b.selectServer(servers.items[0].id);await b.http({id:crypto.randomUUID(),method:'POST',path:'/api/v1/auth/login',body:{email:${JSON.stringify(fixture.users[0].email)},password:${JSON.stringify(PASSWORD)}},responseType:'json',token:null});window.__stage07.bootstrap()})()`,
    );
    const waitFor = async (operation, label, ms = 20000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (runtimeError) throw runtimeError;
        if (await operation()) return;
        await delay(15);
      }
      throw new Error(`Stage07 timeout: ${label}`);
    };
    await waitFor(
      () => js("window.__stage07.authenticated === true"),
      "AuthProvider fixture session restore",
    );
    let pumping = false;
    pump = setInterval(async () => {
      if (pumping) return;
      pumping = true;
      try {
        for (const command of await js("window.__stage07.outgoing.splice(0)")) {
          commands.set(command.id, { action: command.action });
          engine.stdin.write(JSON.stringify(command) + "\n");
        }
      } catch (error) {
        runtimeError = error;
      } finally {
        pumping = false;
      }
    }, 10);
    const mediaCycle = async () => {
      await js("window.__stage07.startMedia()");
      await waitFor(
        () => js("window.__stage07.mediaSettled()"),
        "real Pion/Chromium ICE connection and media.ready acknowledgement",
      );
      await js("window.__stage07.stopMedia(); void 0");
      await waitFor(async () => {
        const v = await rpc("stats");
        return (
          v.peers === 0 &&
          v.rooms === 0 &&
          v.tracks === 0 &&
          v.subscriptions === 0
        );
      }, "Pion release");
      assert.equal(
        await js(
          "window.__stage07.metrics().liveTracks + window.__stage07.metrics().livePeers",
        ),
        0,
      );
    };
    const chatCycle = async () => {
      await js("window.__stage07.toggleChat(true); void 0");
      await waitFor(
        async () =>
          fixture.sockets.size === 1 &&
          (await js(
            "window.__stage07.chatMounted && window.__stage07.queryMetrics().activeQueryFetches === 0 && !!document.querySelector('textarea')",
          )),
        "shared chat and real WSS account channel",
      );
      await js("window.__stage07.toggleChat(false); void 0");
      await waitFor(
        async () =>
          fixture.sockets.size === 0 &&
          (await js(
            "!window.__stage07.chatMounted && window.__stage07.queryMetrics().queryObservers === 0",
          )),
        "chat cleanup",
      );
    };
    async function checkpoint(label) {
      await delay(300);
      await cdp("HeapProfiler.collectGarbage");
      await delay(100);
      await cdp("HeapProfiler.collectGarbage");
      const heap = await cdp("Runtime.getHeapUsage"),
        dom = await cdp("Memory.getDOMCounters");
      const metrics = await js("window.__stage07.metrics()");
      const heapFile = path.join(config.evidence, `${label}.heapsnapshot`),
        stream = fs.createWriteStream(heapFile);
      const receive = (_event, method, params) => {
        if (method === "HeapProfiler.addHeapSnapshotChunk")
          stream.write(params.chunk);
      };
      window.webContents.debugger.on("message", receive);
      try {
        await cdp("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
      } finally {
        window.webContents.debugger.removeListener("message", receive);
        await new Promise((resolve) => stream.end(resolve));
      }
      const snapshot = JSON.parse(await fsp.readFile(heapFile, "utf8"));
      const fields = snapshot.snapshot.meta.node_fields,
        types = snapshot.snapshot.meta.node_types[0],
        stride = fields.length;
      const counts = {};
      const wanted = new Set([
        "ConferenceMediaClient",
        "RTCPeerConnection",
        "MediaStreamTrack",
        "MediaStream",
        "DesktopSocket",
        "QueryObserver",
        "InfiniteQueryObserver",
      ]);
      for (let i = 0; i < snapshot.nodes.length; i += stride) {
        const name =
          snapshot.strings[snapshot.nodes[i + fields.indexOf("name")]];
        if (types[snapshot.nodes[i]] === "object" && wanted.has(name))
          counts[name] = (counts[name] || 0) + 1;
      }
      const point = {
        label,
        heap,
        dom,
        metrics,
        retainedObjects: counts,
        sfu: await rpc("stats"),
        accountSockets: fixture.sockets.size,
        processMetrics: app.getAppMetrics().map((item) => ({
          type: item.type,
          pid: item.pid,
          cpu: item.cpu,
          memory: item.memory,
        })),
      };
      checkpoints.push(point);
      await fsp.writeFile(
        path.join(config.evidence, "checkpoints.json"),
        JSON.stringify(checkpoints, null, 2),
      );
      console.log(
        JSON.stringify({
          checkpoint: label,
          heapUsed: heap.usedSize,
          dom,
          metrics,
          retainedObjects: counts,
        }),
      );
    }
    if (!config.regressionOnly) {
      for (let i = 0; i < 10; i++) {
        await mediaCycle();
        await chatCycle();
      }
      await checkpoint("warmup-10");
      for (let i = 0; i < 100; i++) {
        await mediaCycle();
        if ((i + 1) % 25 === 0) console.log(`media cycles ${i + 1}/100`);
      }
      await checkpoint("media-100");
      for (let i = 0; i < 100; i++) {
        await chatCycle();
        if ((i + 1) % 25 === 0) console.log(`chat cycles ${i + 1}/100`);
      }
      await checkpoint("chat-100");
      for (const point of checkpoints) {
        assert.equal(point.metrics.livePeers, 0);
        assert.equal(point.metrics.liveTracks, 0);
        assert.equal(point.metrics.retainedClients, 0);
        assert.equal(point.metrics.createdPeers, point.metrics.closedPeers);
        assert.equal(point.accountSockets, 0);
        assert.equal(
          point.dom.jsEventListeners,
          checkpoints[0].dom.jsEventListeners,
        );
        assert.equal(
          point.metrics.timers.length,
          checkpoints[0].metrics.timers.length,
        );
      }
    }
    if (!config.regressionOnly) {
      await delay(3000);
      await checkpoint("settled");
      await js("window.__stage07.teardown(); void 0");
      await checkpoint("teardown");
      assert.equal(checkpoints.at(-1).metrics.timers.length, 0);
      await js("window.__stage07.bootstrap(); void 0");
      await waitFor(
        () => js("window.__stage07.authenticated === true"),
        "fresh auth tree for isolated route regression",
      );
    }
    await js("window.__stage07.toggleChat(true); void 0");
    await waitFor(
      async () =>
        fixture.sockets.size === 1 &&
        (await js("window.__stage07.queryMetrics().activeQueryFetches===0")),
      "chat remains mounted for navigation regression",
    );
    const count = (method, path) =>
      fixture.requests.filter(
        (item) => item.method === method && item.path === path,
      ).length;
    const beforeRouting = {
      sockets: count("UPGRADE", "/api/v1/ws"),
      summaries: count("GET", "/api/v1/conversations"),
    };
    for (let i = 0; i < 100; i++) {
      const route =
        i % 2 ? "/personal/55555555-5555-4555-8555-555555555555" : "/personal";
      await js(`window.__stage07.navigate(${JSON.stringify(route)}); void 0`);
      await waitFor(
        () => js(`window.__stage07.pathname===${JSON.stringify(route)}`),
        "current router location",
      );
    }
    await delay(250);
    const routeRegression = {
      changes: 100,
      newAccountSockets: count("UPGRADE", "/api/v1/ws") - beforeRouting.sockets,
      extraSummaryFetches:
        count("GET", "/api/v1/conversations") - beforeRouting.summaries,
    };
    assert.equal(
      routeRegression.newAccountSockets,
      0,
      "navigation must not reconnect the global account channel",
    );
    assert.equal(
      routeRegression.extraSummaryFetches,
      0,
      "navigation must not re-fetch reconnect snapshots",
    );
    const folder = "77777777-7777-4777-8777-777777777777";
    await js(`window.__stage07.navigate('/folders/${folder}'); void 0`);
    await waitFor(
      () => js(`window.__stage07.pathname==='/folders/${folder}'`),
      "latest event route",
    );
    for (const socket of fixture.sockets)
      socket.send(
        JSON.stringify({ type: "folder.deleted", data: { folderId: folder } }),
      );
    await waitFor(
      () => js("window.__stage07.pathname==='/folders'"),
      "server event uses current navigation callback",
    );
    routeRegression.latestEventNavigation = true;
    await js(
      `window.__stage07.login(${JSON.stringify(fixture.users[1].email)},${JSON.stringify(PASSWORD)})`,
    );
    await waitFor(
      async () =>
        fixture.sockets.size === 0 &&
        (await js(
          `window.__stage07.userId===${JSON.stringify(fixture.users[1].id)} && !window.__stage07.chatMounted`,
        )),
      "real account replacement clears the previous keyed AuthProvider tree",
    );
    // AuthProvider deliberately remounts children on identity replacement. Reopen
    // the chat in that fresh tree instead of mistaking safe teardown for failure.
    await js("window.__stage07.toggleChat(true); void 0");
    await waitFor(
      () => fixture.sockets.size === 1,
      "new account opens its own channel",
    );
    assert.equal(
      count("UPGRADE", "/api/v1/ws") - beforeRouting.sockets,
      1,
      "identity replacement reconnects exactly once",
    );
    routeRegression.identityReplacement = true;
    await js("window.__stage07.toggleChat(false); void 0");
    await waitFor(
      () => fixture.sockets.size === 0,
      "identity socket cleanup on unmount",
    );
    routeRegression.unmountCleanup = true;
    console.log(JSON.stringify({ routeRegression }));
    await js("window.__stage07.teardown(); void 0");
    await delay(100);
    const identityTimers = await js("window.__stage07.metrics().timers");
    // QueryClient.clear during keyed identity teardown can leave detached
    // observers' default five-minute GC timeouts. Record that bounded retention
    // separately; the comparable lifecycle teardown above must have zero timers.
    assert.ok(identityTimers.length <= 6);
    assert.ok(
      identityTimers.every(
        (timer) => timer.type === "timeout" && timer.ms === 300000,
      ),
    );
    routeRegression.identityTeardownPendingQueryGcTimers =
      identityTimers.length;
    routeRegression.queryGcDelayMs = 300000;
    clearInterval(pump);
    pump = undefined;
    await window.loadURL("app://meetspace/");
    await js(
      `new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/web-lifecycle.js';script.onload=resolve;script.onerror=()=>reject(Error('web regression bundle failed'));document.body.append(script)})`,
    );
    await waitFor(
      () =>
        js(
          "window.__webStage07.created===1 && window.__webStage07.summaries>=1",
        ),
      "web hook initial socket",
    );
    for (let i = 0; i < 100; i++) {
      const route =
        i % 2 ? "/personal/55555555-5555-4555-8555-555555555555" : "/personal";
      await js(
        `window.__webStage07.navigate(${JSON.stringify(route)}); void 0`,
      );
    }
    await delay(100);
    assert.equal(
      await js("window.__webStage07.created"),
      1,
      "web navigation keeps its account socket",
    );
    assert.equal(
      await js("window.__webStage07.tickets"),
      1,
      "web navigation keeps its original ticket-backed connection",
    );
    await js(`window.__webStage07.navigate('/folders/${folder}'); void 0`);
    await js(
      `window.__webStage07.event({type:'folder.deleted',data:{folderId:'${folder}'}}); void 0`,
    );
    await waitFor(
      () => js("window.__webStage07.pathname==='/folders'"),
      "web event uses latest navigation callback",
    );
    await js(
      "window.__webStage07.setIdentity('22222222-2222-4222-8222-222222222222'); void 0",
    );
    await waitFor(
      () =>
        js("window.__webStage07.created===2&&window.__webStage07.closed===1"),
      "web identity cleanup",
    );
    await js("window.__webStage07.finish(); void 0");
    assert.equal(
      await js("window.__webStage07.closed"),
      2,
      "web unmount closes the new identity socket",
    );
    const webRegression = {
      routeChanges: 100,
      socketCreations: 2,
      socketClosures: 2,
      latestEventNavigation: true,
      identityReplacement: true,
      unmountCleanup: true,
      transport: "synthetic fetch/WebSocket, actual Chromium React/router hook",
    };
    const result = {
      result: "PASS",
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      measuredMediaCycles: config.regressionOnly ? 0 : 100,
      measuredChatCycles: config.regressionOnly ? 0 : 100,
      warmupCyclesEach: config.regressionOnly ? 0 : 10,
      realPion: true,
      realChromium: true,
      physicalDevices: false,
      realWSS: true,
      actualSharedChatComponent: true,
      fullAppNavigation: false,
      productionBackend: false,
      windowsRuntimeTested: process.platform === "win32",
      checkpoints,
    };
    result.routeRegression = routeRegression;
    result.webRegression = webRegression;
    await fsp.writeFile(
      path.join(config.evidence, "result.json"),
      JSON.stringify(result, null, 2),
    );
  } finally {
    clearTimeout(watchdog);
    clearInterval(pump);
    if (window && !window.isDestroyed()) window.destroy();
    lines.close();
    engine.stdin.end();
    engine.kill("SIGTERM");
    await fixture?.close();
    await certificates?.close();
  }
  app.exit(0);
})().catch((error) => {
  console.error("Stage07 lifecycle failed:", error.message);
  app.exit(1);
});
