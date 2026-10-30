"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { MacOSScreenAccess } = require("../dist/platform/macos-screen-access");

test("screen access construction does not query or request native consent", () => {
  let reads = 0;
  const bridge = {
    getMediaAccessStatus(kind) { reads++; assert.equal(kind, "screen"); return "denied"; },
    askForMediaAccess() { throw new Error("screen consent must be requested by getSources"); },
  };
  const access = new MacOSScreenAccess(bridge);
  assert.equal(reads, 0);
  assert.equal(access.status(), "denied");
  assert.equal(access.canSelect(), false);
  assert.equal(reads, 2);
});

test("only granted screen permission allows custom-picker selection", () => {
  for (const status of ["not-determined", "granted", "denied", "restricted", "unknown"]) {
    const access = new MacOSScreenAccess({ getMediaAccessStatus(kind) { assert.equal(kind, "screen"); return status; } });
    assert.equal(access.status(), status);
    assert.equal(access.canSelect(), status === "granted", status);
  }
});

test("unexpected screen status and native exceptions fail closed", () => {
  for (const status of [undefined, null, "unrecognized", "GRANTED", "", true, 1, {}, ["granted"]]) {
    const access = new MacOSScreenAccess({ getMediaAccessStatus() { return status; } });
    assert.equal(access.status(), "unknown");
    assert.equal(access.canSelect(), false);
  }
  const access = new MacOSScreenAccess({ getMediaAccessStatus() { throw new Error("unavailable"); } });
  assert.equal(access.status(), "unknown");
  assert.equal(access.canSelect(), false);
});

test("first-use denial, later consent and revocation are observed without caching", () => {
  let status = "denied";
  const access = new MacOSScreenAccess({ getMediaAccessStatus() { return status; } });
  assert.equal(access.canSelect(), false);
  // Enumeration, owned by the caller, may request first-use consent.
  status = "granted";
  assert.equal(access.canSelect(), true);
  status = "denied";
  assert.equal(access.canSelect(), false);
  status = "granted";
  assert.equal(access.canSelect(), true);
});
