"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { MediaPermissions } = require("../dist/media-permissions.js");
const { MacOSScreenAccess } = require("../dist/platform/macos-screen-access.js");

const origin = "app://meetspace";
const source = () => ({ id: "window:42:0", name: "Safe test window",
  thumbnail: { toDataURL: () => "data:image/png;base64,dGVzdA==" } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture({ status = () => "granted", getSources = async () => [source()], callback } = {}) {
  const contents = { isDestroyed: () => false };
  const frame = { url: `${origin}/conferences/test` };
  const events = [], grants = [];
  const controller = new MediaPermissions({ owner: () => ({ contents, frame }), development: false,
    platform: "darwin", displayMode: () => "picker", getSources,
    screenAccess: new MacOSScreenAccess({ getMediaAccessStatus: status }),
    emit: event => events.push(event) });
  const display = () => controller.display({ frame, securityOrigin: origin, userGesture: true,
    videoRequested: true, audioRequested: false }, streams => {
    grants.push(streams); callback?.(streams);
  });
  return { controller, display, grants, events };
}

test("native macOS enumeration rejection is denied only when native access is unavailable", async () => {
  for (const status of ["denied", "restricted", "unknown", "granted"]) {
    const f = fixture({ status: () => status,
      getSources: async () => { throw new Error("private native error: window title"); } });
    await f.display();
    assert.deepEqual(f.grants, [null]);
    assert.deepEqual(f.events.map(event => event.type), [status === "granted" ? "error" : "denied"]);
    assert.deepEqual(Object.keys(f.events[0]).sort(), ["requestId", "type"]);
    assert.ok(!JSON.stringify(f.events).includes("private native error"));
  }
});

test("a vanished Electron callback does not replace macOS denial or leave a pending request", async () => {
  let granted = false;
  const f = fixture({ status: () => granted ? "granted" : "denied",
    callback: () => { throw new Error("request document no longer exists"); } });
  await f.display();
  assert.deepEqual(f.grants, [null]);
  assert.deepEqual(f.events.map(event => event.type), ["denied"]);
  granted = true;
  await f.display();
  assert.equal(f.events[1].type, "request", "a later request can open its own picker");
  f.controller.cancel();
  assert.deepEqual(f.grants, [null, null]);
  assert.deepEqual(f.events.map(event => event.type), ["denied", "request", "cancelled"]);
});

test("cancelled macOS native prompt keeps its enumeration lease until late rejection settles", async () => {
  const native = deferred();
  let reads = 0, granted = false;
  const f = fixture({ status: () => granted ? "granted" : "denied",
    getSources: () => ++reads === 1 ? native.promise : Promise.resolve([source()]) });
  const first = f.display();
  f.controller.cancel();
  await f.display();
  assert.equal(reads, 1, "a replacement cannot inherit Electron's coalesced old enumeration");
  assert.deepEqual(f.grants, [null, null]);
  native.reject(new Error("old native consent failed"));
  await first;
  assert.deepEqual(f.events.map(event => event.type), ["cancelled"], "late native denial has no effect on the new document");
  granted = true;
  await f.display();
  assert.equal(reads, 2);
  assert.equal(f.events[1].type, "request");
  f.controller.cancel();
  assert.deepEqual(f.grants, [null, null, null]);
});

test("cancellation during macOS source refresh cannot turn a late rejection into a second terminal callback", async () => {
  const refresh = deferred();
  const f = fixture({ getSources: previews => previews ? Promise.resolve([source()]) : refresh.promise });
  await f.display();
  const event = f.events[0];
  const choosing = f.controller.select({ requestId: event.requestId, sourceId: event.sources[0].id, systemAudio: false });
  f.controller.cancel();
  refresh.reject(new Error("selected source is gone"));
  await assert.rejects(choosing, /capture_source_unavailable/);
  assert.deepEqual(f.grants, [null]);
  assert.deepEqual(f.events.map(item => item.type), ["request", "cancelled"]);
});
