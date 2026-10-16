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
    platform: "win32", getSources: async (previews) => { calls.push(previews); return [source()]; },
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

test("development permission is restricted to the explicit loopback Vite origin", () => {
  const f = fixture({ development: true });
  f.frame.url = "http://127.0.0.1:5173/";
  const details = { isMainFrame: true, requestingUrl: f.frame.url, mediaTypes: ["audio"] };
  assert.equal(f.controller.request(f.contents, "media", details), true);
  for (const requestingUrl of [origin, "http://localhost:5173/", "http://127.0.0.1:5174/", "https://127.0.0.1:5173/"])
    assert.equal(f.controller.request(f.contents, "media", { ...details, requestingUrl }), false);
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
