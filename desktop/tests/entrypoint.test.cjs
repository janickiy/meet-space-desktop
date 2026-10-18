"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

const desktop = path.resolve(__dirname, "..");

async function packageEntry() {
  const metadata = JSON.parse(await fs.readFile(path.join(desktop, "package.json"), "utf8"));
  assert.equal(metadata.main, "dist/entry.js");
  const filename = require.resolve(path.join(desktop, metadata.main));
  return { metadata, filename, source: await fs.readFile(filename, "utf8") };
}

// Exercise the compiled package entry with the loader condition that exposed the
// regression. This is a bootstrap unit test, not a native Electron runtime test.
async function executeEntry(startApp, requireMain) {
  const entry = await packageEntry();
  const calls = { starts: [], dialogs: [], quits: 0, logs: [] };
  const module = { exports: {} };
  const requireStub = (name) => {
    if (name === "./main") return { startApp: (...args) => {
      calls.starts.push(args);
      return startApp(...args);
    } };
    if (name === "electron") return {
      app: { quit: () => { calls.quits++; } },
      dialog: { showErrorBox: (...args) => { calls.dialogs.push(args); } },
    };
    throw new Error("Unexpected bootstrap dependency: " + name);
  };
  requireStub.main = requireMain;
  vm.runInNewContext(entry.source, {
    require: requireStub,
    module,
    exports: module.exports,
    __filename: entry.filename,
    __dirname: path.dirname(entry.filename),
    console: Object.fromEntries(["log", "info", "warn", "error", "debug"].map(name => [name, (...args) => calls.logs.push(args)])),
  }, { filename: entry.filename, timeout: 1000 });
  await new Promise(setImmediate);
  return calls;
}

test("compiled package entry starts once when Electron does not assign it to require.main", async () => {
  for (const requireMain of [undefined, { filename: "/electron/default_app.asar/main.js" }]) {
    const calls = await executeEntry(async () => ({}), requireMain);
    assert.deepEqual(calls.starts, [[]], "ordinary startup must use production defaults exactly once");
    assert.deepEqual(calls.dialogs, []);
    assert.equal(calls.quits, 0);
    assert.deepEqual(calls.logs, []);
  }
});

test("package entry handles rejected startup without exposing private exception details", async () => {
  const secret = "https://private-server.invalid/session?token=private-startup-token";
  const calls = await executeEntry(async () => { throw new Error(secret); }, undefined);
  assert.deepEqual(calls.starts, [[]]);
  assert.deepEqual(calls.dialogs, [["MeetSpace", "Не удалось запустить приложение. Проверьте установку и повторите запуск."]]);
  assert.equal(calls.quits, 1);
  assert.deepEqual(calls.logs, []);
  assert.equal(JSON.stringify(calls).includes(secret), false);
});

test("artifact verification requires the compiled package entry and its application module", async () => {
  const { metadata, filename } = await packageEntry();
  assert.equal(path.relative(desktop, filename).replaceAll(path.sep, "/"), metadata.main);
  assert.equal(require.resolve(path.join(path.dirname(filename), "main.js")), path.join(desktop, "dist/main.js"));
  const verifier = await fs.readFile(path.join(desktop, "scripts/verify-artifacts.mjs"), "utf8");
  assert.match(verifier, /for \(const required of \[[\s\S]*?"\/dist\/entry\.js"[\s\S]*?"\/dist\/main\.js"[\s\S]*?\]\)/);
  assert.match(verifier, /packagedMetadata\.main !== "dist\/entry\.js"/);
});
