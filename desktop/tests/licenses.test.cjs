"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, mkdir, writeFile, rm } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const generator = import(pathToFileURL(path.join(__dirname, "../scripts/generate-third-party-notices.mjs")));
async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "meetspace-license-test-"));
  const pkg = async (name, data, license) => {
    const directory = name ? path.join(root, "node_modules", name) : root;
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: name || "fixture", version: "1.0.0", ...data }));
    if (license !== undefined) await writeFile(path.join(directory, "LICENSE"), license);
  };
  try { await run(root, pkg); } finally { await rm(root, { recursive: true, force: true }); }
}

test("license inventory includes transitive runtime and installed peers, without unrelated build tools", async () => fixture(async (root, pkg) => {
  await pkg("", { dependencies: { "fixture-a": "1.0.0" }, devDependencies: { "build-only": "1.0.0" } });
  await pkg("fixture-a", { dependencies: { "fixture-b": "1.0.0" }, peerDependencies: { "fixture-peer": "1.0.0", "missing-optional": "1" },
    peerDependenciesMeta: { "missing-optional": { optional: true } } }, "Fixture A full license\n");
  await pkg("fixture-b", {}, "Fixture B full license\n");
  await pkg("fixture-peer", {}, "Fixture peer full license\n");
  await pkg("build-only", {}, "Build tool not shipped\n");
  const result = await (await generator).collectLicenseComponents([{ directory: root, scope: "test" }]);
  assert.deepEqual(result.map(item => item.name), ["fixture-a", "fixture-b", "fixture-peer"]);
  assert.equal(result[0].licenses[0].text, "Fixture A full license\n");
  assert.match(result[0].licenses[0].sha256, /^[a-f0-9]{64}$/);
}));

test("missing required dependency or missing license blocks notices instead of inventing rights", async () => fixture(async (root, pkg) => {
  await pkg("", { dependencies: { "fixture-missing-license": "1.0.0" } });
  await assert.rejects((await generator).collectLicenseComponents([{ directory: root, scope: "test" }]), /Required installed dependency is missing/);
  await pkg("fixture-missing-license", { license: "MIT" });
  await assert.rejects((await generator).collectLicenseComponents([{ directory: root, scope: "test" }]), /No license text found/);
}));

test("license file contents and order are deterministic, compound notices remain intact", async () => fixture(async (root, pkg) => {
  await pkg("", { dependencies: { "fixture-compound": "1.0.0" } });
  await pkg("fixture-compound", { license: "ISC" }, "ISC text\n\nIncluded component MIT text\n");
  const collect = () => generator.then(module => module.collectLicenseComponents([{ directory: root, scope: "test" }]));
  assert.deepEqual(await collect(), await collect());
  assert.match((await collect())[0].licenses[0].text, /Included component MIT text/);
}));
