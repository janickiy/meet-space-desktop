import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await test("attachments accept archives and office documents with consistent MIME on every OS", async () => {
  const policy = await compileModule("src/attachmentPolicy.ts", true);
  for (const [name, mimeType] of [
    ["Архив.ZIP", "application/zip"],
    ["backup.tar.gz", "application/gzip"],
    ["backup.gzip", "application/gzip"],
    ["backup.tar.bz2", "application/x-bzip2"],
    ["backup.bzip2", "application/x-bzip2"],
    ["backup.7z", "application/x-7z-compressed"],
    ["backup.rar", "application/vnd.rar"],
    ["backup.tar.xz", "application/x-xz"],
    ["backup.zst", "application/zstd"],
    ["backup.lzma", "application/x-lzma"],
    ["backup.lz4", "application/x-lz4"],
    ["backup.cpio", "application/x-cpio"],
    ["backup.lzh", "application/x-lzh-compressed"],
    [
      "Документ.DOCX",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    ["document.doc", "application/msword"],
    [
      "table.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    [
      "slides.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    ["document.odt", "application/vnd.oasis.opendocument.text"],
    ["table.ods", "application/vnd.oasis.opendocument.spreadsheet"],
    ["slides.odp", "application/vnd.oasis.opendocument.presentation"],
    ["document.rtf", "application/rtf"],
    ["notes.md", "text/markdown"],
    ["book.epub", "application/epub+zip"],
    ["image.jpg", "image/jpeg"],
    ["table.csv", "text/csv"],
    ["table.tsv", "text/tab-separated-values"],
    ["document.pages", "application/vnd.apple.pages"],
    ["table.numbers", "application/vnd.apple.numbers"],
    ["slides.key", "application/vnd.apple.keynote"],
    ["backup.lz", "application/x-lzip"],
    ["document.docm", "application/vnd.ms-word.document.macroenabled.12"],
  ]) {
    for (const type of [
      "",
      "application/octet-stream",
      "application/x-unknown",
    ]) {
      const file = new File(["content"], name, { type });
      assert.equal(policy.validateAttachment(file), null, name);
      assert.equal(policy.attachmentMimeType(file), mimeType, name);
    }
  }
  const accept = policy.attachmentAccept.split(",");
  assert.equal(new Set(accept).size, accept.length);
  for (const extension of [
    "zip",
    "gzip",
    "bzip2",
    "7z",
    "rar",
    "tar",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "odt",
    "rtf",
  ])
    assert.ok(accept.includes(`.${extension}`), extension);
});

await test("expanded attachments retain size limits and reject unsupported final extensions", async () => {
  const policy = await compileModule("src/attachmentPolicy.ts", true);
  for (const size of [1, policy.attachmentLimit])
    assert.equal(policy.validateAttachment({ name: "backup.zip", size }), null);
  for (const size of [0, -1, NaN, Infinity, 0.5, policy.attachmentLimit + 1])
    assert.match(
      policy.validateAttachment({ name: "backup.zip", size }),
      /Размер/,
    );
  for (const name of [
    "program.exe",
    "backup.zip.exe",
    "document.docx.js",
    "document.html",
    "backup.zip.",
    "zip",
    "backup.zip ",
  ])
    assert.match(
      policy.validateAttachment({ name, size: 1 }),
      /Можно прикрепить/,
      name,
    );
});

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
    // Output selection is serialized before playback; wait for the operation,
    // rather than depending on its previous one-microtask implementation.
    await new Promise((resolve) => setImmediate(resolve));
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
  for (const fixed of [
    "https://janickiy.com/",
    "https://letsencrypt.org/repository/",
  ]) {
    assert.equal(urls.externalServiceURL(fixed), fixed);
  }
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
    "https://janickiy.com",
    "https://janickiy.com/private",
    "https://janickiy.com/?redirect=elsewhere",
    "https://janickiy.com/#fragment",
    "https://janickiy.com.evil.invalid/",
    "https://letsencrypt.org/",
    "https://letsencrypt.org/repository/?redirect=elsewhere",
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

const nativePreferences = await compileModule(
  "src/platform/nativePreferences.ts",
  true,
);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

await test("native preferences serialize refresh and changes and reject an older read", async () => {
  const calls = [];
  const values = [],
    errors = [],
    busy = [];
  const controller = nativePreferences.createNativePreferencesController(
    {
      getNativePreferences() {
        const pending = deferred();
        calls.push({ kind: "get", ...pending });
        return pending.promise;
      },
      setNativePreferences(input) {
        const pending = deferred();
        calls.push({ kind: "set", input, ...pending });
        return pending.promise;
      },
    },
    {
      value: (v) => values.push(v),
      error: (e) => errors.push(e),
      busy: (v) => busy.push(v),
    },
  );
  controller.refresh();
  controller.refresh();
  controller.refresh();
  controller.update({ closeToTray: false });
  assert.equal(calls.length, 1, "no set overlaps a pending get");
  calls[0].resolve({ closeToTray: true, trayStatus: "checking" });
  await settle();
  assert.deepEqual(
    values,
    [],
    "old polling result cannot undo the pending user intent",
  );
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["get", "set"],
  );
  assert.deepEqual(calls[1].input, { closeToTray: false });
  const saved = {
    closeToTray: false,
    trayAvailable: true,
    trayStatus: "available",
  };
  calls[1].resolve(saved);
  await settle();
  assert.deepEqual(values, [saved]);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["get", "set", "get"],
    "many refresh events coalesce into one subsequent read",
  );
  calls[2].resolve(saved);
  await settle();
  assert.equal(busy.at(-1), false);
  assert.deepEqual(errors, []);
  controller.dispose();
});

await test("native preference mutations retain order and disposal suppresses late results and errors", async () => {
  const calls = [],
    observed = [];
  const controller = nativePreferences.createNativePreferencesController(
    {
      getNativePreferences() {
        throw new Error("unexpected read");
      },
      setNativePreferences(input) {
        const pending = deferred();
        calls.push({ input, ...pending });
        return pending.promise;
      },
    },
    {
      value: (v) => observed.push(v),
      error: (e) => observed.push(e),
      busy: () => {},
    },
  );
  controller.update({ startAtLogin: true });
  controller.update({ startAtLogin: false });
  assert.equal(calls.length, 1);
  calls[0].resolve({ startAtLogin: true });
  await settle();
  assert.deepEqual(observed, []);
  assert.deepEqual(
    calls.map((call) => call.input),
    [{ startAtLogin: true }, { startAtLogin: false }],
  );
  controller.dispose();
  calls[1].reject(new Error("late native error"));
  await settle();
  controller.refresh();
  controller.update({ startAtLogin: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(observed, []);
});

await test("failed native preference change releases busy state and a later refresh recovers", async () => {
  const pending = deferred(),
    errors = [],
    values = [],
    busy = [];
  const controller = nativePreferences.createNativePreferencesController(
    {
      getNativePreferences: async () => ({
        startAtLogin: false,
        startupReason: "conflict",
      }),
      setNativePreferences: () => pending.promise,
    },
    {
      value: (v) => values.push(v),
      error: (e) => errors.push(e),
      busy: (v) => busy.push(v),
    },
  );
  controller.update({ startAtLogin: true });
  const failure = new Error("native failed");
  pending.reject(failure);
  await settle();
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(busy, [true, false]);
  controller.refresh();
  await settle();
  assert.deepEqual(values, [
    { startAtLogin: false, startupReason: "conflict" },
  ]);
  controller.dispose();
});

await test("native preference observation polls only while visible and removes timers and listeners", () => {
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  let nextID = 0,
    reads = 0;
  const timers = new Map();
  const host = Object.assign(new EventTarget(), {
    setInterval(callback, ms) {
      assert.equal(ms, 5000);
      timers.set(++nextID, callback);
      return nextID;
    },
    clearInterval(id) {
      timers.delete(id);
    },
  });
  const stop = nativePreferences.watchNativePreferences(
    () => reads++,
    page,
    host,
  );
  assert.equal(reads, 1);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(reads, 2);
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  host.dispatchEvent(new Event("focus"));
  assert.equal(reads, 2);
  assert.equal(timers.size, 0);
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  host.dispatchEvent(new Event("focus"));
  assert.equal(reads, 4);
  assert.equal(timers.size, 1);
  stop();
  host.dispatchEvent(new Event("focus"));
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(reads, 4);
  assert.equal(timers.size, 0);
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
  host: {
    session: "not-applicable",
    secureStorage: { available: true, backend: "dpapi", reason: "available" },
    supports: {
      startup: true,
      absoluteWindowPosition: true,
      systemAudio: true,
    },
  },
};

function bridge(overrides = {}) {
  return {
    bridgeVersion: 6,
    getRuntimeInfo: async () => runtimeInfo,
    openExternal: async () => {},
    onRoute: () => () => {},
    minimize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
    quit: async () => {},
    getUpdateState: async () => ({
      enabled: false,
      phase: "disabled",
      currentVersion: "0.6.0",
    }),
    getSshInstallerState: async () => ({
      busy: false,
      phase: "idle",
      hasCredentials: false,
    }),
    sshInstaller: async () => ({
      busy: false,
      phase: "idle",
      hasCredentials: false,
    }),
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
    bridge({ bridgeVersion: 5 }),
    bridge({ getRuntimeInfo: undefined }),
    bridge({ openExternal: "not a function" }),
    bridge({ onRoute: null }),
    bridge({ close: false }),
  ]) {
    window.meetspaceDesktop = invalid;
    await assert.rejects(desktopPlatform.getRuntimeInfo(), /unavailable/);
  }
});

for (const method of ["getSshInstallerState", "sshInstaller"]) {
  await test(`desktop adapter rejects a bridge missing ${method}`, async () => {
    let runtimeCalls = 0;
    window.meetspaceDesktop = bridge({
      [method]: undefined,
      getRuntimeInfo: async () => {
        runtimeCalls++;
        return runtimeInfo;
      },
    });
    await assert.rejects(desktopPlatform.getRuntimeInfo(), /unavailable/);
    assert.equal(runtimeCalls, 0);
  });
}

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

await test("desktop adapter rejects missing or malformed host metadata", async () => {
  const { host } = runtimeInfo;
  const invalidHosts = [
    undefined,
    null,
    {},
    { ...host, session: undefined },
    { ...host, session: "xwayland" },
    { ...host, session: "wayland" },
    { ...host, secureStorage: undefined },
    { ...host, secureStorage: null },
    { ...host, secureStorage: {} },
    { ...host, secureStorage: { ...host.secureStorage, available: undefined } },
    { ...host, secureStorage: { ...host.secureStorage, available: "true" } },
    { ...host, secureStorage: { ...host.secureStorage, backend: undefined } },
    { ...host, secureStorage: { ...host.secureStorage, backend: "plaintext" } },
    { ...host, secureStorage: { ...host.secureStorage, reason: undefined } },
    { ...host, secureStorage: { ...host.secureStorage, reason: "trusted" } },
    {
      ...host,
      secureStorage: {
        available: true,
        backend: "basic_text",
        reason: "available",
      },
    },
    {
      ...host,
      secureStorage: {
        available: true,
        backend: "unknown",
        reason: "available",
      },
    },
    {
      ...host,
      secureStorage: { ...host.secureStorage, reason: "unavailable" },
    },
    { ...host, secureStorage: { ...host.secureStorage, available: false } },
    {
      ...host,
      secureStorage: {
        ...host.secureStorage,
        available: false,
        reason: "insecure-backend",
      },
    },
    { ...host, supports: undefined },
    { ...host, supports: null },
    { ...host, supports: {} },
    ...["startup", "absoluteWindowPosition", "systemAudio"].flatMap((key) => [
      { ...host, supports: { ...host.supports, [key]: undefined } },
      { ...host, supports: { ...host.supports, [key]: "true" } },
    ]),
  ];
  for (const invalid of invalidHosts) {
    window.meetspaceDesktop = bridge({
      getRuntimeInfo: async () => ({ ...runtimeInfo, host: invalid }),
    });
    await assert.rejects(desktopPlatform.getRuntimeInfo(), /Unsupported/);
  }
  window.meetspaceDesktop = bridge({
    getRuntimeInfo: async () => ({ ...runtimeInfo, platform: "linux" }),
  });
  await assert.rejects(desktopPlatform.getRuntimeInfo(), /Unsupported/);
  window.meetspaceDesktop = bridge();
});

await test("desktop adapter accepts host metadata for Linux session and storage availability", async () => {
  for (const host of [
    {
      session: "x11",
      secureStorage: {
        available: true,
        backend: "gnome-libsecret",
        reason: "available",
      },
      supports: {
        startup: false,
        absoluteWindowPosition: true,
        systemAudio: false,
      },
    },
    {
      session: "wayland",
      secureStorage: {
        available: false,
        backend: "basic_text",
        reason: "insecure-backend",
      },
      supports: {
        startup: false,
        absoluteWindowPosition: false,
        systemAudio: false,
      },
    },
    {
      session: "unknown",
      secureStorage: {
        available: false,
        backend: "unknown",
        reason: "unavailable",
      },
      supports: {
        startup: false,
        absoluteWindowPosition: false,
        systemAudio: false,
      },
    },
  ]) {
    const info = { ...runtimeInfo, platform: "linux", host };
    window.meetspaceDesktop = bridge({ getRuntimeInfo: async () => info });
    assert.deepEqual(await desktopPlatform.getRuntimeInfo(), info);
  }
  window.meetspaceDesktop = bridge();
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

await test("external links retain web navigation and require trusted desktop clicks before allowlisted dispatch", async () => {
  const links = await compileModule("src/platform/externalLink.ts", true);
  const opened = [];
  window.meetspaceDesktop = bridge({
    openExternal: async (url) => {
      opened.push(url);
    },
  });
  function click(isTrusted = true, defaultPrevented = false) {
    return {
      isTrusted,
      defaultPrevented,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
  }
  const web = click();
  assert.equal(
    links.externalLinkClick(
      web,
      false,
      "https://other.invalid/",
      desktopPlatform.openExternal,
    ),
    undefined,
  );
  assert.equal(
    web.prevented,
    false,
    "web retains the actual href and target behavior",
  );
  const synthetic = click(false);
  assert.equal(
    links.externalLinkClick(
      synthetic,
      true,
      "https://janickiy.com/",
      desktopPlatform.openExternal,
    ),
    undefined,
  );
  assert.equal(synthetic.prevented, true);
  const cancelled = click(true, true);
  assert.equal(
    links.externalLinkClick(
      cancelled,
      true,
      "https://janickiy.com/",
      desktopPlatform.openExternal,
    ),
    undefined,
  );
  assert.deepEqual(opened, []);
  const trusted = click();
  await links.externalLinkClick(
    trusted,
    true,
    "https://janickiy.com/",
    desktopPlatform.openExternal,
  );
  assert.equal(trusted.prevented, true);
  assert.deepEqual(opened, ["https://janickiy.com/"]);
  const rejected = click();
  await assert.rejects(
    links.externalLinkClick(
      rejected,
      true,
      "https://other.invalid/",
      desktopPlatform.openExternal,
    ),
  );
  assert.equal(rejected.prevented, true);
  assert.deepEqual(
    opened,
    ["https://janickiy.com/"],
    "foreign chat domains never reach the native bridge",
  );
  const launchFailure = new Error("browser unavailable");
  await assert.rejects(
    links.externalLinkClick(click(), true, "https://janickiy.com/", () => {
      throw launchFailure;
    }),
    (error) => error === launchFailure,
  );
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
  for (const [name, type] of [
    ["backup.zip", "application/zip"],
    ["backup.tar.gz", "application/gzip"],
    ["backup.bz2", "application/x-bzip2"],
    [
      "document.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  ]) {
    await apiModule.uploadAttachment(
      "https://meeting.janickiy.com/api/v1/conversations/test/attachments/test/content",
      new File(["attachment"], name, { type: "application/octet-stream" }),
      () => {},
      new AbortController().signal,
    );
    assert.equal(requests.at(-1).contentType, type);
    assert.ok(requests.at(-1).bytes instanceof Uint8Array);
  }
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
