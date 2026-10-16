import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Compile the actual production modules with both build flags; no backend fixtures.
async function compileModule(entry, desktop, extraExports = "") {
  const result = await build({
    configFile: false,
    root: frontendRoot,
    logLevel: "silent",
    define: { __DESKTOP_BUILD__: JSON.stringify(desktop) },
    plugins: extraExports
      ? [
          {
            name: "test-entry-exports",
            transform(code, id) {
              if (id === resolve(frontendRoot, entry))
                return code + "\n" + extraExports;
            },
          },
        ]
      : [],
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve(frontendRoot, entry), formats: ["es"] },
    },
  });
  const output = Array.isArray(result) ? result[0].output : result.output;
  const entryChunk = output.find(
    (part) => part.type === "chunk" && part.isEntry,
  );
  assert.ok(entryChunk, "Expected an in-memory production entry module");
  return import(
    "data:text/javascript;base64," +
      Buffer.from(entryChunk.code).toString("base64")
  );
}

function memoryStore() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function installBrowserStores() {
  const sessionStorage = memoryStore();
  const localStorage = memoryStore();
  Object.assign(globalThis, {
    sessionStorage,
    localStorage,
    window: { sessionStorage, localStorage },
  });
  return { sessionStorage, localStorage };
}

await test("desktop refuses and purges browser JWT persistence", async () => {
  const session = {
    token: "synthetic-session-fixture",
    expiresAt: Date.now() + 60_000,
  };
  const api = await compileModule("src/utils.ts", true);
  const { sessionStorage, localStorage } = installBrowserStores();
  sessionStorage.setItem(api.SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(api.SESSION_KEY, JSON.stringify(session));
  assert.equal(api.readSession(), null);
  assert.equal(sessionStorage.getItem(api.SESSION_KEY), null);
  assert.equal(localStorage.getItem(api.SESSION_KEY), null);
  api.saveSession(session);
  assert.equal(sessionStorage.getItem(api.SESSION_KEY), null);
  assert.equal(localStorage.getItem(api.SESSION_KEY), null);

  localStorage.setItem(api.SESSION_KEY, JSON.stringify(session));
  Object.defineProperty(window, "sessionStorage", {
    get() {
      throw new Error("Browser storage denied");
    },
  });
  assert.doesNotThrow(() => api.saveSession(session));
  assert.equal(localStorage.getItem(api.SESSION_KEY), null);
});

await test("web session persistence and logout remain available", async () => {
  const session = {
    token: "synthetic-session-fixture",
    expiresAt: Date.now() + 60_000,
  };
  const api = await compileModule("src/utils.ts", false);
  const { sessionStorage, localStorage } = installBrowserStores();
  api.saveSession(session);
  assert.equal(api.readSession()?.token, session.token);
  assert.equal(localStorage.getItem(api.SESSION_KEY), null);
  api.saveSession(null);
  assert.equal(sessionStorage.getItem(api.SESSION_KEY), null);
});

await test("desktop notification sound never allocates browser audio or a second player", async () => {
  const module = await compileModule("src/notificationSound.ts", true);
  const originalAudio = globalThis.Audio;
  globalThis.Audio = class {
    constructor() {
      throw new Error("Duplicate desktop sound");
    }
  };
  try {
    const sound = module.createNotificationSound("fixture-user");
    assert.doesNotThrow(() => sound.notify("fixture-event"));
    assert.doesNotThrow(() => sound.dispose());
    assert.doesNotThrow(() => sound.notify("after-disposal"));
  } finally {
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  }
});

await test("web notification sound retains preference gating, dedup and audio cleanup", async () => {
  const module = await compileModule("src/notificationSound.ts", false);
  const originalAudio = globalThis.Audio;
  const stores = installBrowserStores();
  globalThis.window = Object.assign(new EventTarget(), stores);
  const players = [];
  globalThis.Audio = class {
    plays = 0;
    pauses = 0;
    loads = 0;
    constructor() {
      players.push(this);
    }
    play() {
      this.plays++;
      return Promise.resolve();
    }
    pause() {
      this.pauses++;
    }
    removeAttribute(name) {
      assert.equal(name, "src");
    }
    load() {
      this.loads++;
    }
  };
  try {
    const sound = module.createNotificationSound("fixture-user");
    assert.equal(players.length, 1);
    sound.notify("fixture-event");
    sound.notify("fixture-event");
    await Promise.resolve();
    assert.equal(players[0].plays, 1);
    localStorage.setItem(
      "meet.devices.v1:fixture-user",
      JSON.stringify({ notificationSounds: false }),
    );
    sound.notify("muted-event");
    await Promise.resolve();
    assert.equal(players[0].plays, 1);
    sound.dispose();
    sound.notify("after-disposal");
    assert.equal(players[0].plays, 1);
    assert.equal(players[0].pauses, 1);
    assert.equal(players[0].loads, 1);
  } finally {
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  }
});

await test("renderer links require the selected HTTPS service and safe application routes", async () => {
  const urls = await compileModule("src/platform/urls.ts", false);
  assert.equal(
    urls.externalServiceURL("https://meeting.janickiy.com/"),
    "https://meeting.janickiy.com/",
  );
  for (const url of [
    "http://meeting.janickiy.com/",
    "https://evil.invalid/",
    "https://meeting.janickiy.com.evil.invalid/",
    "https://user:pass@meeting.janickiy.com/",
    "https://meeting.janickiy.com/\\evil",
    "HTTPS://meeting.janickiy.com/",
    "https://meeting.janickiy.com:443/",
    "https://meeting.janickiy.com/%2e%2e/secret",
    "https://meeting.janickiy.com/%2fsecret",
    "https://meeting.janickiy.com/#fragment",
    "javascript:alert(1)",
    "https://meeting.janickiy.com/" + "a".repeat(2048),
  ]) {
    assert.throws(() => urls.externalServiceURL(url));
  }
  const invitation = "/i/" + "A".repeat(32);
  assert.equal(urls.desktopRoute(invitation), invitation);
  for (const route of [
    "//evil.invalid/",
    "/api/v1/auth/me",
    "/../api/v1/auth/me",
    "/i/short",
    "/personal/" + "-".repeat(36),
    "/app#secret",
    42,
  ]) {
    assert.equal(urls.desktopRoute(route), undefined);
  }
});

const { desktopPlatform } = await compileModule(
  "src/platform/desktop.ts",
  true,
);
const runtimeInfo = {
  platform: "win32",
  arch: "arm64",
  appVersion: "0.1.0",
  isPackaged: true,
  capabilities: { serverConnection: true, windowControls: true },
};

function bridge(overrides = {}) {
  return {
    bridgeVersion: 5,
    getRuntimeInfo: async () => runtimeInfo,
    openExternal: async () => {},
    onRoute: () => () => {},
    minimize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
    quit: async () => {},
    getUpdateState: async () => ({ enabled: false, phase: "disabled", currentVersion: "0.6.0" }),
    checkUpdates: async () => ({}),
    downloadUpdate: async () => ({}),
    cancelUpdate: async () => ({}),
    installUpdate: async () => ({}),
    getNativePreferences: async () => ({}),
    setNativePreferences: async () => ({}),
    setNotificationContext: async () => {},
    saveAsset: async () => ({ cancelled: false, saved: true }),
    openRecordingMedia: async () => ({}),
    closeRecordingMedia: async () => {},
    cancelAsset: async () => {},
    listServers: async () => ({
      items: [],
      selectedId: null,
      generation: 0,
      storageAvailable: true,
    }),
    probeServer: async () => {},
    addServer: async () => {},
    selectServer: async () => {},
    removeServer: async () => {},
    http: async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    }),
    abortRequest: async () => {},
    openStream: async () => {},
    closeStream: async () => {},
    openSocket: async () => {},
    sendSocket: async () => {},
    closeSocket: async () => {},
    onDisplayCaptureEvent: () => () => {},
    selectDisplaySource: async () => {},
    cancelDisplaySource: async () => {},
    onTransportEvent: () => () => {},
    ...overrides,
  };
}

await test("desktop adapter rejects missing and incompatible bridge shapes", async () => {
  globalThis.window = {};
  await assert.rejects(desktopPlatform.getRuntimeInfo(), /unavailable/);
  for (const invalid of [
    bridge({ bridgeVersion: 1 }),
    bridge({ getRuntimeInfo: undefined }),
    bridge({ openExternal: "not a function" }),
    bridge({ onRoute: null }),
    bridge({ close: false }),
  ]) {
    window.meetspaceDesktop = invalid;
    await assert.rejects(desktopPlatform.getRuntimeInfo(), /unavailable/);
  }
});

await test("desktop adapter fails closed on unknown runtime capabilities", async () => {
  window.meetspaceDesktop = bridge({
    getRuntimeInfo: async () => ({
      ...runtimeInfo,
      capabilities: { serverConnection: false, windowControls: true },
    }),
  });
  await assert.rejects(desktopPlatform.getRuntimeInfo(), /Unsupported/);
  window.meetspaceDesktop = bridge();
  assert.deepEqual(await desktopPlatform.getRuntimeInfo(), runtimeInfo);
});

await test("desktop route events are validated and listeners can unsubscribe", () => {
  let emit;
  let unsubscribed = false;
  window.meetspaceDesktop = bridge({
    onRoute(handler) {
      emit = handler;
      return () => {
        unsubscribed = true;
      };
    },
  });
  const received = [];
  const unsubscribe = desktopPlatform.onRoute((route) => received.push(route));
  emit("/api/v1/auth/me");
  emit("//evil.invalid");
  emit(42);
  const invitation = "/i/" + "A".repeat(32);
  emit(invitation);
  assert.deepEqual(received, [invitation]);
  unsubscribe();
  assert.equal(unsubscribed, true);
});

await test("desktop external link rejection happens before invoking the bridge", async () => {
  const opened = [];
  window.meetspaceDesktop = bridge({
    openExternal: async (url) => {
      opened.push(url);
    },
  });
  await assert.rejects(desktopPlatform.openExternal("https://evil.invalid/"));
  assert.deepEqual(opened, []);
  await desktopPlatform.openExternal("https://meeting.janickiy.com/");
  assert.deepEqual(opened, ["https://meeting.janickiy.com/"]);
});

await test("desktop development refuses API traffic and supplies CSP nonces", async () => {
  const previousNonce = process.env.MEETSPACE_DEV_CSP_NONCE;
  process.env.MEETSPACE_DEV_CSP_NONCE = randomBytes(24).toString("hex");
  let server;
  try {
    server = await createServer({
      root: frontendRoot,
      configFile: resolve(frontendRoot, "vite.config.ts"),
      mode: "desktop",
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== "string");
    assert.equal(address.address, "127.0.0.1");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const method of ["GET", "POST"]) {
      const response = await fetch(origin + "/api/v1/auth/refresh", { method });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await response.json()).status, "failed");
    }
    const html = await (await fetch(origin + "/")).text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(
      (match) => match[0],
    );
    assert.ok(scripts.length > 0);
    assert.ok(
      scripts.every((script) =>
        script.includes(`nonce="${process.env.MEETSPACE_DEV_CSP_NONCE}"`),
      ),
    );
    assert.ok(html.includes('property="csp-nonce"'));
    assert.equal(server.config.server.proxy, undefined);
    assert.equal(server.config.define.__CLIENT_TELEMETRY_ENABLED__, false);
    assert.equal(server.config.define.__DESKTOP_BUILD__, true);
  } finally {
    await server?.close();
    if (previousNonce === undefined) delete process.env.MEETSPACE_DEV_CSP_NONCE;
    else process.env.MEETSPACE_DEV_CSP_NONCE = previousNonce;
  }
});

await test("desktop server origins and public auth markers stay profile scoped", async () => {
  const api = await compileModule(
    "src/utils.ts",
    true,
    'export { setDesktopServer, serviceOrigin } from "./platform/urls";',
  );
  installBrowserStores();
  const code = "A".repeat(32);
  api.setDesktopServer({ id: "server-a", origin: "https://first.invalid" });
  api.markLogout();
  api.announceAccount("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  assert.equal(api.hasLogoutMarker(), true);
  assert.equal(api.inviteLink(code), `https://first.invalid/i/${code}`);
  assert.equal(api.inviteCode(`https://first.invalid/i/${code}`), code);
  assert.equal(api.inviteCode(`https://other.invalid/i/${code}`), null);
  api.setDesktopServer({
    id: "server-b",
    origin: "https://second.invalid:8443",
  });
  assert.equal(api.hasLogoutMarker(), false);
  assert.equal(api.selectedAccountID(), undefined);
  assert.equal(api.serviceOrigin(), "https://second.invalid:8443");
  api.setDesktopServer({ id: "server-a", origin: "https://first.invalid" });
  assert.equal(api.hasLogoutMarker(), true);
  assert.equal(api.selectedAccountID(), "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
});

const transport = await compileModule("src/platform/transport.ts", true);
function transportFixture(overrides = {}) {
  const listeners = new Set();
  const opened = [],
    cancelled = [];
  globalThis.window = {
    setTimeout,
    meetspaceDesktop: bridge({
      onTransportEvent(handler) {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
      openSocket: async (request) => {
        opened.push(request);
      },
      closeSocket: async (id) => {
        cancelled.push(id);
      },
      openStream: async (request) => {
        opened.push(request);
      },
      closeStream: async (id) => {
        cancelled.push(id);
      },
      ...overrides,
    }),
  };
  return {
    listeners,
    opened,
    cancelled,
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

await test("native HTTP preserves status/bytes and sends only an identity marker", async () => {
  let sent;
  transportFixture({
    http: async (request) => {
      sent = request;
      return {
        status: 200,
        headers: { "content-type": "image/png" },
        body: new Uint8Array([1, 2, 3]),
      };
    },
  });
  const response = await transport.desktopRequest({
    method: "GET",
    path: "/api/v1/conversations/group/avatar",
    responseType: "binary",
    token: "desktop-session:fixture",
  });
  assert.equal(sent.token, "desktop-session:fixture");
  assert.equal(sent.path, "/api/v1/conversations/group/avatar");
  assert.equal(Object.hasOwn(sent, "headers"), false);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
});

await test("native HTTP abort rejects promptly and removes progress subscriptions", async () => {
  let requestId, aborted;
  const fixture = transportFixture({
    http: (request) => {
      requestId = request.id;
      return new Promise(() => {});
    },
    abortRequest: async (id) => {
      aborted = id;
    },
  });
  const controller = new AbortController();
  const result = transport.desktopRequest(
    { method: "GET", path: "/api/v1/auth/me", responseType: "json" },
    controller.signal,
    () => {},
  );
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(aborted, requestId);
  assert.equal(fixture.listeners.size, 0);
});

await test("native uploads use bounded bytes and request-scoped progress", async () => {
  let sent;
  const progress = [];
  const fixture = transportFixture({
    http: async (request) => {
      sent = request;
      fixture.emit({ kind: "progress", id: "other", percent: 25 });
      fixture.emit({ kind: "progress", id: request.id, percent: 75 });
      return { status: 204, headers: {}, body: null };
    },
  });
  const response = await transport.desktopRequest(
    {
      method: "PUT",
      path: "/api/v1/conversations/test/attachments/test/content",
      file: new Blob(["bytes"]),
      responseType: "json",
    },
    undefined,
    (value) => progress.push(value),
  );
  assert.equal(response.status, 204);
  assert.deepEqual(progress, [75]);
  assert.ok(sent.bytes instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(sent.bytes), "bytes");
  assert.equal(fixture.listeners.size, 0);
  await assert.rejects(
    transport.desktopRequest({
      method: "PUT",
      path: "/api/v1/unused",
      file: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]),
      responseType: "json",
    }),
    /upload_too_large/,
  );
});

await test("native SSE preserves chunks for the shared parser and cleans up on cancellation", async () => {
  const fixture = transportFixture();
  const controller = new AbortController();
  const pending = transport.desktopNotificationStream(
    "desktop-session:fixture",
    controller.signal,
  );
  const { id, token } = fixture.opened[0];
  assert.equal(token, "desktop-session:fixture");
  fixture.emit({
    kind: "stream",
    id,
    type: "headers",
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  const response = await pending;
  const reader = response.body.getReader();
  fixture.emit({
    kind: "stream",
    id,
    type: "chunk",
    data: new TextEncoder().encode('data: {"type":"notification"}\n\n'),
  });
  assert.equal(
    new TextDecoder().decode((await reader.read()).value),
    'data: {"type":"notification"}\n\n',
  );
  controller.abort();
  await assert.rejects(reader.read(), { name: "AbortError" });
  assert.equal(fixture.listeners.size, 0);
  assert.deepEqual(fixture.cancelled, [id]);
});

await test("native SSE overflow fails closed instead of growing a renderer queue", async () => {
  const fixture = transportFixture();
  const pending = transport.desktopNotificationStream(
    "desktop-session:fixture",
    new AbortController().signal,
  );
  const { id } = fixture.opened[0];
  fixture.emit({
    kind: "stream",
    id,
    type: "headers",
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  const response = await pending;
  fixture.emit({
    kind: "stream",
    id,
    type: "chunk",
    data: new Uint8Array(256 * 1024 + 1),
  });
  await assert.rejects(response.body.getReader().read(), /stream_overflow/);
  assert.equal(fixture.listeners.size, 0);
});

if (!globalThis.CloseEvent)
  globalThis.CloseEvent = class extends Event {
    constructor(type, init) {
      super(type);
      Object.assign(this, init);
    }
  };
await test("native sockets preserve event lifecycle and carry no renderer URL or ticket", async () => {
  const sent = [],
    messages = [],
    closed = [];
  const fixture = transportFixture({
    sendSocket: async (...args) => {
      sent.push(args);
    },
  });
  const socket = new transport.DesktopSocket({
    kind: "conference",
    conferenceId: "conference",
    clientId: "client",
    token: "desktop-session:fixture",
  });
  socket.onmessage = (event) => messages.push(event.data);
  socket.onclose = (event) => closed.push([event.code, event.reason]);
  assert.throws(() => socket.send("early"), { name: "InvalidStateError" });
  await Promise.resolve();
  const request = fixture.opened[0];
  assert.equal(Object.hasOwn(request, "url"), false);
  assert.equal(Object.hasOwn(request, "ticket"), false);
  fixture.emit({ kind: "socket", id: request.id, type: "open" });
  assert.equal(socket.readyState, 1);
  fixture.emit({
    kind: "socket",
    id: request.id,
    type: "message",
    data: '{"type":"snapshot"}',
  });
  socket.send('{"type":"heartbeat"}');
  assert.deepEqual(messages, ['{"type":"snapshot"}']);
  assert.deepEqual(sent, [[request.id, '{"type":"heartbeat"}']]);
  assert.throws(() => socket.send("x".repeat(65537)), /backpressure/);
  fixture.emit({
    kind: "socket",
    id: request.id,
    type: "close",
    code: 1008,
    reason: "authentication_revoked",
  });
  assert.deepEqual(closed, [[1008, "authentication_revoked"]]);
  assert.equal(socket.readyState, 3);
  assert.equal(fixture.listeners.size, 0);
});

await test("aborting a not-yet-opened native socket never dispatches an open", async () => {
  const fixture = transportFixture();
  const controller = new AbortController();
  const socket = new transport.DesktopSocket(
    { kind: "account", token: "desktop-session:fixture" },
    controller.signal,
  );
  controller.abort();
  await Promise.resolve();
  assert.equal(socket.readyState, 3);
  assert.equal(fixture.opened.length, 0);
  assert.equal(fixture.listeners.size, 0);
});

await test("shared desktop API routes REST/upload through native transport and preserves private recovery", async () => {
  const apiModule = await compileModule("src/api.ts", true);
  let recovered = 0;
  const requests = [];
  transportFixture({
    http: async (request) => {
      requests.push(request);
      if (request.token === "old-marker")
        return { status: 401, headers: {}, body: { message: "expired" } };
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { user: { id: "fixture-user" } },
      };
    },
  });
  apiModule.configureAuth("old-marker", async () => {
    recovered++;
    apiModule.configureAuth("new-marker");
    return true;
  });
  assert.equal((await apiModule.api.me()).user.id, "fixture-user");
  assert.equal(recovered, 1);
  assert.deepEqual(
    requests.map((request) => request.token),
    ["old-marker", "new-marker"],
  );
  assert.ok(requests.every((request) => request.path === "/api/v1/auth/me"));
  assert.equal(apiModule.getAccessToken(), "new-marker");
  const progress = [];
  await apiModule.uploadAttachment(
    "https://meeting.janickiy.com/api/v1/conversations/test/attachments/test/content",
    new File(["attachment"], "test.txt", { type: "text/plain" }),
    (value) => progress.push(value),
    new AbortController().signal,
  );
  assert.equal(requests.at(-1).method, "PUT");
  assert.equal(requests.at(-1).token, "new-marker");
  assert.ok(requests.at(-1).bytes instanceof Uint8Array);
  assert.deepEqual(progress, [100]);
  await assert.rejects(
    apiModule.uploadAttachment(
      "https://other.invalid/api/v1/conversations/test/attachments/test/content",
      new File(["no"], "test.txt"),
      () => {},
      new AbortController().signal,
    ),
    { status: 502 },
  );
});
