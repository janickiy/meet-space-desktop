const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { AsyncTaskManager } = require("builder-util");
const nsisLang = require("app-builder-lib/out/targets/nsis/nsisLang.js");
const { NsisScriptGenerator } = require("app-builder-lib/out/targets/nsis/nsisScriptGenerator.js");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function sources() {
  const api = await import("../scripts/prepare-builder.mjs");
  const installed = await fs.readFile(require.resolve("app-builder-lib/out/targets/nsis/NsisTarget.js"));
  const patched = api.patchBuilderSource(installed, api.BUILDER_VERSION).source;
  // Reconstruct only the exact audited upstream fixture if a build has already
  // applied the patch. The checksum ensures this test is not silently inventing it.
  let upstream = patched.toString("utf8");
  for (const name of ["messages.yml", "assistedMessages.yml"]) {
    const invocation = `(0, nsisLang_1.addCustomMessageFileInclude)("${name}", packager, scriptGenerator, langConfigurator)`;
    upstream = upstream.replace(`await ${invocation};`, `taskManager.addTask(${invocation});`);
  }
  assert.equal(digest(upstream), api.BUILDER_UPSTREAM_SHA256);
  return { api, upstream, patched };
}

function actualHeaderMethod(source, include) {
  const text = source.toString();
  const start = text.indexOf("    async computeCommonInstallerScriptHeader() {");
  const end = text.indexOf("    async computeFinalScript(", start);
  assert.ok(start > 0 && end > start);
  // Execute the actual pinned method body with only filesystem/network boundary
  // seams. The builder's real task manager, language options and script emitter run.
  const Header = vm.runInNewContext(`(class Header {\n${text.slice(start, end)}\n})`, {
    path,
    nsisScriptGenerator_1: { NsisScriptGenerator },
    nsisLang_1: { ...nsisLang, addCustomMessageFileInclude: include },
    builder_util_1: { AsyncTaskManager, statOrNull: async () => null },
    nsisUtil_1: { nsisTemplatesDir: "/fixture/templates" },
    windows_1: { getNsisPluginsPath: async () => "/fixture/plugins" },
  });
  const instance = new Header();
  instance.options = { oneClick: false };
  instance.isUnicodeEnabled = true;
  instance.isPortable = false;
  instance.packager = { config: {}, info: { cancellationToken: { cancelled: false }, buildResourcesDir: "/fixture/resources" },
    getResource: async () => "/fixture/reproducible.nsh" };
  return () => instance.computeCommonInstallerScriptHeader();
}

test("builder repair accepts only exact pinned source, is idempotent and rejects drift", async () => {
  const { api, upstream, patched } = await sources();
  const first = api.patchBuilderSource(upstream, "26.17.0"), second = api.patchBuilderSource(first.source, "26.17.0");
  assert.equal(first.changed, true); assert.equal(second.changed, false);
  assert.deepEqual(first.source, patched); assert.deepEqual(second.source, patched);
  assert.deepEqual(second.evidence, { package: "app-builder-lib", version: "26.17.0", patch: "serialize-nsis-language-includes-v1", sourceSha256: api.BUILDER_PATCHED_SHA256 });
  for (const [bytes, version] of [[upstream + "\n", "26.17.0"], [patched.toString().replace("messages.yml", "unknown.yml"), "26.17.0"], [upstream, "26.17.1"], [patched, "26.17.1"]])
    assert.throws(() => api.patchBuilderSource(bytes, version), /Unsupported|Unrecognized/);
});

test("actual upstream method exhibits reversed includes under controlled latency; patched method serializes them", async () => {
  const { upstream, patched } = await sources();
  for (const [source, fixed] of [[upstream, false], [patched, true]]) {
    let release;
    const firstRead = new Promise(resolve => { release = resolve; }), started = [];
    const run = actualHeaderMethod(source, async (name, _packager, generator) => {
      started.push(name);
      if (name === "messages.yml") await firstRead;
      generator.include(name);
    });
    const pending = run();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, fixed ? ["messages.yml"] : ["messages.yml", "assistedMessages.yml"]);
    release();
    const result = await pending;
    const messages = result.indexOf('!include "messages.yml"'), assisted = result.indexOf('!include "assistedMessages.yml"');
    assert.ok(messages >= 0 && assisted >= 0);
    assert.equal(messages < assisted, fixed);
    assert.ok(result.includes('!include "/fixture/reproducible.nsh"'));
    assert.ok(result.includes('!addplugindir /x86-unicode'));
  }
});

test("patched method preserves branch behavior and fails when language generation fails", async () => {
  const { patched } = await sources();
  const started = [];
  const run = actualHeaderMethod(patched, async name => {
    started.push(name);
    throw new Error("fixture language read failed");
  });
  await assert.rejects(run(), /fixture language read failed/);
  assert.deepEqual(started, ["messages.yml"], "later language generation cannot run after failed prerequisite");
});

test("read-only evidence does not silently prepare an unpatched installation", async () => {
  const { api } = await sources();
  const filename = require.resolve("app-builder-lib/out/targets/nsis/NsisTarget.js");
  const before = await fs.readFile(filename);
  if (digest(before) === api.BUILDER_UPSTREAM_SHA256) await assert.rejects(api.readBuilderEvidence(), /not prepared/);
  else assert.equal((await api.readBuilderEvidence()).sourceSha256, api.BUILDER_PATCHED_SHA256);
  assert.deepEqual(await fs.readFile(filename), before);
});
