"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const filename = path.join(__dirname, "../dist/acceptance.js");
const compiled = fs.readFileSync(filename, "utf8");
const localRequire = Module.createRequire(filename);
function load(overrides = {}) {
  const exports = {};
  let touched = false;
  const app = { isPackaged: true, setPath() { touched = true; }, on() { touched = true; } };
  vm.runInNewContext(compiled, { exports, module: { exports },
    require: name => name === "electron" ? { app } : localRequire(name),
    process: { platform: "win32", argv: ["MeetSpace.exe", `--meetspace-desktop-acceptance=${"a".repeat(43)}`], ...overrides },
    setTimeout, clearTimeout, console,
  }, { filename });
  return { api: exports, touched: () => touched };
}
const build = { releaseMode: "test", trustedRelease: false, sourceCommit: "b".repeat(40), version: "0.6.0" };
const nonce = "c".repeat(43);
const flag = `--meetspace-desktop-acceptance=${nonce}`;

test("installed acceptance never enables for release, trust-enabled, development, or a foreign platform", () => {
  const { api } = load();
  assert.equal(api.acceptanceNonce(["app", flag], build, true, "win32"), nonce);
  assert.equal(api.acceptanceNonce(["app", flag], {...build,version:"0.1.0-beta"}, true, "win32"), nonce);
  for (const candidate of [{ ...build, releaseMode: "release" }, { ...build, releaseMode: null }, { ...build, trustedRelease: true },
    { ...build, sourceCommit: "not-a-commit" }, { ...build, version: "0.6.0; command" },
    { ...build, version: "0.1.0 beta" }, { ...build, version: "0.1.0-beta-test" }])
    assert.equal(api.acceptanceNonce(["app", flag], candidate, true, "win32"), null);
  assert.equal(api.acceptanceNonce(["app", flag], build, false, "win32"), null);
  for (const platform of ["darwin", "linux", "win64"])
    assert.equal(api.acceptanceNonce(["app", flag], build, true, platform), null);
  for (const candidate of [{ ...build, releaseMode: "release" }, { ...build, trustedRelease: true }]) {
    const blocked = load();
    assert.equal(blocked.api.prepareWindowsAcceptance(candidate), null);
    assert.equal(blocked.touched(), false, "A refused flag cannot mutate profile paths or app listeners");
  }
});

test("acceptance input is a single bounded opaque nonce, never a path, URL, script or environment option", () => {
  const { api } = load();
  for (const argv of [[], [flag, flag], [flag, "--meetspace-desktop-acceptance-other=x"],
    ["--meetspace-desktop-acceptance", nonce], ["--meetspace-desktop-acceptance="],
    ["--meetspace-desktop-acceptance=" + "x".repeat(44)], ["--meetspace-desktop-acceptance=../" + "x".repeat(40)],
    ["--meetspace-desktop-acceptance=https://example.org/"], [flag + "\n"], [flag + "="]])
    assert.equal(api.acceptanceNonce(argv, build, true, "win32"), null, JSON.stringify(argv));
  assert.equal(load({ argv: ["app"], env: { MEETSPACE_DESKTOP_ACCEPTANCE: nonce } }).api.prepareWindowsAcceptance(build), null);
  assert.equal(api.ACCEPTANCE_LINK, "meetspace://open/meetings/33333333-3333-4333-8333-333333333333/join");
});
