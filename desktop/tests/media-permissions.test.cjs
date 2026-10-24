const test = require("node:test");
const assert = require("node:assert/strict");
const { MediaPermissions } = require("../dist/media-permissions.js");
const origin = "app://meetspace";
const thumbnail = { toDataURL: () => "data:image/png;base64,dGVzdA==" };
const source = (id = "window:42:0") => ({ id, name: "Test\nwindow", thumbnail });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function fixture(options = {}) {
  const contents = { isDestroyed: () => false };
  const frame = { url: `${origin}/conferences/test` };
  let currentOwner = { contents, frame };
  const events = [], grants = [], calls = [];
  const controller = new MediaPermissions({ owner: () => currentOwner, development: false,
    platform: "win32", displayMode: () => "picker", getSources: async (previews) => { calls.push(previews); return [source()]; },
    emit: (event) => events.push(event), ...options });
  const request = (changes = {}) => ({ frame, securityOrigin: origin,
    userGesture: true, videoRequested: true, audioRequested: false, ...changes });
  const display = (changes = {}) => controller.display(request(changes), (streams) => grants.push(streams));
  return { controller, contents, frame, events, grants, calls, request, display,
    setOwner: (value) => { currentOwner = value; },
    choice: (systemAudio = false) => {
      const event = events.findLast((event) => event.type === "request");
      return { requestId: event.requestId, sourceId: event.sources[0].id, systemAudio };
    },
  };
}

test("camera/microphone permissions require the owned trusted main document", () => {
  const f = fixture();
  const details = { isMainFrame: true, requestingUrl: `${origin}/`, securityOrigin: origin, mediaTypes: ["audio", "video"], mediaType: "video" };
  assert.equal(f.controller.request(f.contents, "media", details), true);
  assert.equal(f.controller.check(f.contents, "media", origin, details), true);
  for (const patch of [{ isMainFrame: false }, { requestingUrl: "https://evil.invalid/" }, { securityOrigin: "app://evil" }]) {
    assert.equal(f.controller.request(f.contents, "media", { ...details, ...patch }), false);
    assert.equal(f.controller.check(f.contents, "media", origin, { ...details, ...patch }), false);
  }
  for (const contents of [null, { isDestroyed: () => false }])
    assert.equal(f.controller.check(contents, "media", origin, details), false);
  assert.equal(f.controller.check(f.contents, "media", "https://evil.invalid", details), false);
  assert.equal(f.controller.check(f.contents, "media", origin, { ...details, embeddingOrigin: origin }), true);
  assert.equal(f.controller.check(f.contents, "media", origin, { ...details, embeddingOrigin: "https://evil.invalid" }), false);
  // Electron 44 sends mediaTypes:[] before invoking its separate display handler.
  assert.equal(f.controller.request(f.contents, "media", { ...details, mediaTypes: [] }), true);
  assert.equal(f.controller.request(f.contents, "media", { ...details, mediaTypes: undefined }), false);
  assert.equal(f.controller.request(f.contents, "media", { ...details, mediaTypes: ["screen"] }), false);
  for (const permission of ["geolocation", "notifications", "usb", "openExternal", "midi", "fileSystem", "unknown"])
    assert.equal(f.controller.request(f.contents, permission, details), false);
  f.frame.url = "https://evil.invalid/";
  assert.equal(f.controller.request(f.contents, "media", details), false);
});

test("invitation copying grants only sanitized writes from the owned main document", () => {
  const f = fixture();
  const permission = "clipboard-sanitized-write";
  const details = { isMainFrame: true, requestingUrl: `${origin}/conferences/test`, securityOrigin: origin };
  assert.equal(f.controller.request(f.contents, permission, details), true);
  assert.equal(f.controller.check(f.contents, permission, origin, details), true);
  for (const denied of ["clipboard-read", "deprecated-sync-clipboard-read", "clipboard-write", "unknown"]) {
    assert.equal(f.controller.request(f.contents, denied, details), false);
    assert.equal(f.controller.check(f.contents, denied, origin, details), false);
  }
  for (const patch of [{ isMainFrame: false }, { requestingUrl: "https://evil.invalid/" }, { securityOrigin: "app://evil" }]) {
    assert.equal(f.controller.request(f.contents, permission, { ...details, ...patch }), false);
    assert.equal(f.controller.check(f.contents, permission, origin, { ...details, ...patch }), false);
  }
  assert.equal(f.controller.check(f.contents, permission, "https://evil.invalid", details), false);
  assert.equal(f.controller.check(f.contents, permission, origin, { ...details, embeddingOrigin: "https://evil.invalid" }), false);
  const foreign = { isDestroyed: () => false };
  assert.equal(f.controller.request(foreign, permission, details), false);
  assert.equal(f.controller.check(foreign, permission, origin, details), false);
  f.setOwner(null);
  assert.equal(f.controller.request(f.contents, permission, details), false);
  assert.equal(f.controller.check(f.contents, permission, origin, details), false);
});

test("development permission is restricted to the explicit loopback Vite origin", () => {
  const f = fixture({ development: true });
  f.frame.url = "http://127.0.0.1:5173/";
  const details = { isMainFrame: true, requestingUrl: f.frame.url, mediaTypes: ["audio"] };
  assert.equal(f.controller.request(f.contents, "media", details), true);
  for (const requestingUrl of [origin, "http://localhost:5173/", "http://127.0.0.1:5174/", "https://127.0.0.1:5173/"])
    assert.equal(f.controller.request(f.contents, "media", { ...details, requestingUrl }), false);
});

test("Linux camera, microphone and speaker permissions use the document-scoped policy", () => {
  // The permission policy is intentionally independent of X11/Wayland and CPU
  // architecture. Neither session metadata nor a platform label grants access.
  const f = fixture({ platform: "linux" });
  const details = { isMainFrame: true, requestingUrl: `${origin}/settings`, securityOrigin: origin };
  for (const mediaTypes of [["audio"], ["video"], ["audio", "video"]])
    assert.equal(f.controller.request(f.contents, "media", { ...details, mediaTypes }), true);
  for (const mediaType of ["audio", "video", "unknown"])
    assert.equal(f.controller.check(f.contents, "media", origin, { ...details, mediaType }), true);
  for (const mediaType of ["screen", "audiooutput", "microphone", "camera", "invalid"])
    assert.equal(f.controller.check(f.contents, "media", origin, { ...details, mediaType }), false);
  for (const mediaTypes of [["audio", "screen"], ["audiooutput"], ["camera"], ["microphone"]])
    assert.equal(f.controller.request(f.contents, "media", { ...details, mediaTypes }), false);

  assert.equal(f.controller.request(f.contents, "speaker-selection", details), true);
  assert.equal(f.controller.check(f.contents, "speaker-selection", origin, details), true);
  for (const patch of [{ isMainFrame: false }, { requestingUrl: undefined }, { requestingUrl: "about:blank" },
    { requestingUrl: "https://meeting.example/" }, { securityOrigin: "https://meeting.example" }]) {
    assert.equal(f.controller.request(f.contents, "speaker-selection", { ...details, ...patch }), false);
    assert.equal(f.controller.check(f.contents, "speaker-selection", origin, { ...details, ...patch }), false);
  }
  assert.equal(f.controller.check(f.contents, "speaker-selection", origin,
    { ...details, embeddingOrigin: "https://meeting.example" }), false);
  for (const permission of ["usb", "serial", "hid", "bluetooth", "local-network", "unknown"])
    assert.equal(f.controller.request(f.contents, permission, details), false);
});

test("media and output grants disappear with the owner and do not transfer to another window", () => {
  const f = fixture({ platform: "linux" });
  const details = { isMainFrame: true, requestingUrl: `${origin}/`, securityOrigin: origin,
    mediaTypes: ["audio", "video"], mediaType: "audio" };
  const foreign = { isDestroyed: () => false };
  for (const permission of ["media", "speaker-selection"]) {
    assert.equal(f.controller.request(foreign, permission, details), false);
    assert.equal(f.controller.check(foreign, permission, origin, details), false);
    assert.equal(f.controller.check(null, permission, origin, details), false);
  }
  const replacement = { contents: foreign, frame: { url: `${origin}/` } };
  f.setOwner(replacement);
  for (const permission of ["media", "speaker-selection"]) {
    assert.equal(f.controller.request(f.contents, permission, details), false);
    assert.equal(f.controller.check(f.contents, permission, origin, details), false);
    assert.equal(f.controller.request(foreign, permission, details), true);
    assert.equal(f.controller.check(foreign, permission, origin, details), true);
  }
  replacement.contents.isDestroyed = () => true;
  assert.equal(f.controller.request(foreign, "media", details), false);
  assert.equal(f.controller.check(foreign, "speaker-selection", origin, details), false);
  f.setOwner(null);
  assert.equal(f.controller.request(f.contents, "media", details), false);
  assert.equal(f.controller.check(f.contents, "speaker-selection", origin, details), false);
});

test("display capture denies foreign frames, missing activation and audio-only requests before enumeration", async () => {
  const f = fixture();
  for (const patch of [{ userGesture: false }, { frame: null }, { frame: { url: `${origin}/` } },
    { securityOrigin: "https://evil.invalid" }, { videoRequested: false, audioRequested: true }])
    await f.display(patch);
  assert.equal(f.calls.length, 0);
  assert.equal(f.events.length, 0);
  assert.deepEqual(f.grants, [null, null, null, null, null]);
});

test("picker exposes opaque bounded IDs and grants only an explicit fresh source", async () => {
  const f = fixture();
  await f.display();
  const request = f.events[0];
  assert.equal(request.type, "request");
  assert.match(request.requestId, /^[a-f0-9-]{36}$/);
  assert.notEqual(request.sources[0].id, "window:42:0");
  assert.equal(request.sources[0].name, "Testwindow");
  assert.equal(request.systemAudioAvailable, false);
  assert.deepEqual(f.grants, []);
  await f.controller.select(f.choice());
  assert.deepEqual(f.calls, [true, false]);
  assert.equal(f.grants[0].video.id, "window:42:0");
  assert.equal(f.grants[0].audio, undefined);
  assert.equal(f.events[1].type, "cancelled");
  await assert.rejects(f.controller.select(f.choice()), /stale_request/);
  assert.equal(f.grants.length, 1);
});

test("system audio requires Windows, an audio request and an explicit opt-in", async () => {
  for (const [platform, audioRequested, systemAudio, expected] of [
    ["win32", true, true, "loopback"], ["win32", true, false, undefined],
    ["win32", false, true, "denied"], ["darwin", true, true, "denied"],
    ["linux", true, true, "denied"], ["linux", true, false, undefined],
  ]) {
    const f = fixture({ platform });
    try {
      await f.display({ audioRequested });
      if (expected === "denied") {
        await assert.rejects(f.controller.select(f.choice(systemAudio)), /operation_not_allowed/);
        assert.equal(f.grants.length, 0);
      } else {
        await f.controller.select(f.choice(systemAudio));
        assert.equal(f.grants[0].audio, expected);
      }
    } finally { f.controller.cancel(); }
  }
});

test("forged source IDs and malformed choices never receive a grant", async () => {
  const f = fixture();
  try {
    await f.display();
    for (const patch of [{ sourceId: "window:42:0" }, { sourceId: "not-listed" }, { systemAudio: true }])
      await assert.rejects(f.controller.select({ ...f.choice(), ...patch }), /operation_not_allowed/);
    for (const value of [null, [], { ...f.choice(), extra: true }, { ...f.choice(), systemAudio: "true" }])
      await assert.rejects(f.controller.select(value), /invalid_request/);
    assert.equal(f.grants.length, 0);
  } finally { f.controller.cancel(); }
});

test("a disappeared window cannot silently fall back to another source", async () => {
  const f = fixture({ getSources: async (previews) => [source(previews ? "window:42:0" : "window:43:0")] });
  await f.display();
  await assert.rejects(f.controller.select(f.choice()), /capture_source_unavailable/);
  assert.deepEqual(f.grants, [null]);
  assert.equal(f.events.at(-1).type, "cancelled");
});

test("navigation/profile/logout cancellation settles once and ignores late enumeration", async () => {
  const lookup = deferred();
  const f = fixture({ getSources: () => lookup.promise });
  const task = f.display();
  f.controller.cancel();
  f.controller.cancel();
  lookup.resolve([source()]);
  await task;
  assert.deepEqual(f.grants, [null]);
  assert.deepEqual(f.events.map((event) => event.type), ["cancelled"]);
});

test("concurrent requests do not replace the existing consent callback", async () => {
  const f = fixture();
  await f.display();
  await f.display();
  assert.deepEqual(f.grants, [null]);
  assert.equal(f.events.filter((event) => event.type === "request").length, 1);
  const selection = f.choice();
  f.controller.cancelRequest("different-request");
  await f.controller.select(selection);
  assert.equal(f.grants[1].video.id, "window:42:0");
});

test("pending consent expires and source refresh cannot resurrect an obsolete document", async () => {
  const f = fixture({ timeoutMs: 20 });
  await f.display();
  const old = f.choice();
  await new Promise((resolve) => setTimeout(resolve, 35));
  await assert.rejects(f.controller.select(old), /stale_request/);
  assert.deepEqual(f.grants, [null]);

  const refresh = deferred();
  const g = fixture({ getSources: (previews) => previews ? Promise.resolve([source()]) : refresh.promise });
  await g.display();
  const choosing = g.controller.select(g.choice());
  g.controller.cancel();
  g.setOwner({ contents: g.contents, frame: { url: `${origin}/` } });
  refresh.resolve([source()]);
  await assert.rejects(choosing, /stale_request/);
  assert.deepEqual(g.grants, [null]);
});

test("Wayland portal uses one enumeration and grants only its consented video source", async () => {
  const lookup = deferred();
  const calls = [];
  const f = fixture({ platform: "linux", displayMode: () => "portal", getSources: previews => { calls.push(previews); return lookup.promise; } });
  const pending = f.display({ audioRequested: true });
  assert.deepEqual(calls, [false]);
  assert.equal(f.events[0].type, "portal");
  assert.deepEqual(Object.keys(f.events[0]).sort(), ["requestId", "type"]);
  assert.deepEqual(f.grants, []);
  await assert.rejects(f.controller.select({ requestId: f.events[0].requestId, sourceId: "window:42:0", systemAudio: false }), /operation_not_allowed/);
  lookup.resolve([source()]);
  await pending;
  assert.equal(f.grants.length, 1);
  assert.equal(f.grants[0].video.id, "window:42:0");
  assert.equal(f.grants[0].audio, undefined);
  assert.deepEqual(calls, [false]);
  assert.deepEqual(f.events.map(event => event.type), ["portal", "cancelled"]);
  assert.equal(f.events[0].requestId, f.events[1].requestId);
});

test("portal rejects empty, ambiguous and unexpected mappings without a custom-picker fallback", async () => {
  for (const sources of [[], [source("screen:1:0")], [source(), source("window:43:0")], [source("invalid")]]) {
    const f = fixture({ platform: "linux", displayMode: () => "portal", getSources: async () => sources });
    await f.display();
    assert.deepEqual(f.grants, [null]);
    assert.deepEqual(f.events.map(event => event.type), ["portal", "cancelled"]);
  }
  const denied = fixture({ platform: "linux", displayMode: () => "portal", getSources: async () => { throw new Error("portal denied or cancelled"); } });
  await denied.display();
  assert.deepEqual(denied.grants, [null]);
});

test("cancelled portal keeps an enumeration lease so another request cannot reuse its late consent", async () => {
  const lookup = deferred();
  let enumerations = 0;
  const f = fixture({ platform: "linux", displayMode: () => "portal", getSources: () => {
    enumerations++; return enumerations === 1 ? lookup.promise : Promise.resolve([source("window:99:0")]);
  } });
  const pending = f.display();
  const id = f.events[0].requestId;
  f.controller.cancelRequest(id);
  await f.display();
  assert.equal(enumerations, 1);
  assert.deepEqual(f.grants, [null, null]);
  lookup.resolve([source("window:42:0")]);
  await pending;
  assert.deepEqual(f.grants, [null, null]);
  await f.display();
  assert.equal(enumerations, 2);
  assert.equal(f.grants[2].video.id, "window:99:0");
});

test("portal timeout and owner replacement reject late results and settle the callback once", async () => {
  for (const cause of ["timeout", "navigation"]) {
    const lookup = deferred();
    const f = fixture({ platform: "linux", displayMode: () => "portal", timeoutMs: 20, getSources: () => lookup.promise });
    const pending = f.display();
    if (cause === "timeout") await new Promise(resolve => setTimeout(resolve, 35));
    else { f.controller.cancel(); f.setOwner({ contents: f.contents, frame: { url: `${origin}/new` } }); }
    lookup.resolve([source()]);
    await pending;
    assert.deepEqual(f.grants, [null]);
    assert.deepEqual(f.events.map(event => event.type), ["portal", "cancelled"]);
  }
});

test("unverified Linux capture mode fails closed before enumeration with a bounded unavailable event", async () => {
  for (const displayMode of [undefined, () => "unavailable"]) {
    const f = fixture({ platform: "linux", displayMode });
    await f.display();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.grants, [null]);
    assert.equal(f.events[0].type, "unavailable");
    assert.deepEqual(Object.keys(f.events[0]).sort(), ["requestId", "type"]);
  }
});

test("a custom picker with one source still requires an explicit fresh selection", async () => {
  const f = fixture({ platform: "linux" });
  await f.display();
  assert.deepEqual(f.grants, []);
  assert.equal(f.events[0].type, "request");
  await f.controller.select(f.choice());
  assert.deepEqual(f.calls, [true, false]);
  assert.equal(f.grants.length, 1);
});
