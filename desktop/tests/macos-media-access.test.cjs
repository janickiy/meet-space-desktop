"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { MacOSMediaAccess } = require("../dist/platform/macos-media-access");

function fixture(initial = {}) {
  const statuses = { camera: "not-determined", microphone: "not-determined", ...initial };
  const calls = [];
  const bridge = {
    getMediaAccessStatus(kind) { return statuses[kind]; },
    async askForMediaAccess(kind) { calls.push(kind); statuses[kind] = "granted"; return true; },
  };
  return { access: new MacOSMediaAccess(bridge), statuses, calls, bridge };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("macOS media checks cover every TCC status without prompting", () => {
  for (const kind of ["camera", "microphone"]) {
    for (const status of ["not-determined", "granted", "denied", "restricted", "unknown"]) {
      const value = fixture({ [kind]: status });
      assert.equal(value.access.status(kind), status);
      assert.equal(value.access.check([kind]), ["not-determined", "granted"].includes(status), `${kind}: ${status}`);
      assert.deepEqual(value.calls, []);
    }
  }
});

test("granted devices and empty display-only requests require no native prompt", async () => {
  const value = fixture({ camera: "granted", microphone: "granted" });
  assert.equal(value.access.check([]), true);
  assert.equal(await value.access.ensure([]), true);
  assert.equal(await value.access.ensure(["camera", "microphone"]), true);
  assert.deepEqual(value.calls, []);
});

test("first use asks only requested devices and observes confirmed consent", async () => {
  for (const kind of ["camera", "microphone"]) {
    const value = fixture();
    assert.equal(await value.access.ensure([kind, kind]), true);
    assert.deepEqual(value.calls, [kind]);
    assert.equal(await value.access.ensure([kind]), true);
    assert.deepEqual(value.calls, [kind], "granted access is not requested again");
  }
  const value = fixture();
  assert.equal(await value.access.ensure(["microphone", "camera"]), true);
  assert.deepEqual(value.calls, ["microphone", "camera"]);
});

test("denied, restricted and unknown TCC status fail closed without re-prompting", async () => {
  for (const status of ["denied", "restricted", "unknown"]) {
    const value = fixture({ camera: status });
    assert.equal(await value.access.ensure(["camera"]), false);
    assert.equal(await value.access.ensure(["microphone", "camera"]), false);
    assert.deepEqual(value.calls, [], "an already blocked device prevents unnecessary prompts for the other device");
  }
});

test("native refusal does not prompt the next device or retry a denied permission", async () => {
  const value = fixture();
  value.bridge.askForMediaAccess = async kind => { value.calls.push(kind); value.statuses[kind] = "denied"; return false; };
  assert.equal(await value.access.ensure(["microphone", "camera"]), false);
  assert.equal(await value.access.ensure(["microphone"]), false);
  assert.deepEqual(value.calls, ["microphone"]);
});

test("concurrent overlapping requests share one prompt per media kind", async () => {
  const value = fixture(), microphone = deferred(), camera = deferred();
  value.bridge.askForMediaAccess = kind => { value.calls.push(kind); return kind === "microphone" ? microphone.promise : camera.promise; };
  const both = value.access.ensure(["microphone", "camera"]);
  const mic = value.access.ensure(["microphone"]);
  const cam = value.access.ensure(["camera"]);
  await Promise.resolve();
  assert.deepEqual(value.calls, ["microphone", "camera"]);
  value.statuses.microphone = "granted";
  microphone.resolve(true);
  assert.equal(await mic, true);
  value.statuses.camera = "granted";
  camera.resolve(true);
  assert.deepEqual(await Promise.all([both, cam]), [true, true]);
  assert.deepEqual(value.calls, ["microphone", "camera"]);
});

test("status and prompt exceptions fail closed and release the in-flight request", async () => {
  const value = fixture();
  value.bridge.getMediaAccessStatus = () => { throw new Error("unavailable"); };
  assert.equal(value.access.status("camera"), "unknown");
  assert.equal(value.access.check(["camera"]), false);
  assert.equal(await value.access.ensure(["camera"]), false);
  assert.deepEqual(value.calls, []);

  value.bridge.getMediaAccessStatus = kind => value.statuses[kind];
  for (const rejection of ["sync", "async"]) {
    value.bridge.askForMediaAccess = kind => {
      value.calls.push(kind);
      if (rejection === "sync") throw new Error("unavailable");
      return Promise.reject(new Error("unavailable"));
    };
    assert.deepEqual(await Promise.all([value.access.ensure(["camera"]), value.access.ensure(["camera"])]), [false, false]);
  }
  assert.deepEqual(value.calls, ["camera", "camera"], "failed requests are coalesced and do not block future attempts");
  value.bridge.askForMediaAccess = async kind => { value.calls.push(kind); value.statuses[kind] = "granted"; return true; };
  assert.equal(await value.access.ensure(["camera"]), true);
});

test("an affirmative request response alone cannot override a blocked or unknown status", async () => {
  for (const status of ["not-determined", "denied", "restricted", "unknown"]) {
    const value = fixture();
    value.bridge.askForMediaAccess = async kind => { value.statuses[kind] = status; return true; };
    assert.equal(await value.access.ensure(["camera"]), false, status);
  }
});

test("consent revoked while the other device prompt is open is not cached", async () => {
  const value = fixture({ microphone: "granted" }), camera = deferred();
  value.bridge.askForMediaAccess = () => camera.promise;
  const request = value.access.ensure(["microphone", "camera"]);
  await Promise.resolve();
  value.statuses.microphone = "denied";
  value.statuses.camera = "granted";
  camera.resolve(true);
  assert.equal(await request, false);
  assert.equal(await value.access.ensure(["microphone"]), false);
});

test("malformed media types cannot broaden access to screen or trigger prompts", async () => {
  const value = fixture();
  for (const types of [undefined, null, "camera", ["screen"], ["audio"], ["camera", "invalid"], [null]]) {
    assert.equal(value.access.check(types), false);
    assert.equal(await value.access.ensure(types), false);
  }
  value.bridge.getMediaAccessStatus = () => "unrecognized-status";
  assert.equal(value.access.status("camera"), "unknown");
  assert.equal(value.access.status("screen"), "unknown");
  assert.deepEqual(value.calls, []);
});
