const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const desktop = path.resolve(__dirname, "..");
const helper = import(pathToFileURL(path.join(desktop, "scripts/prepare-linux-electron.mjs")).href);

async function fixture(t, failure = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-electron-reference-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const electron = path.join(root, "node_modules/electron");
  const version = JSON.parse(await fs.readFile(path.join(desktop, "node_modules/electron/package.json"))).version;
  await fs.mkdir(electron, { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ devDependencies: { electron: version } }));
  await fs.writeFile(path.join(electron, "package.json"), JSON.stringify({ version }));
  // Exercise the actual pinned vendor installer. Only network and ZIP extraction
  // are inert adapters; no downloaded Electron or application is executed.
  for (const name of ["install.js", "checksums.json"])
    await fs.copyFile(path.join(desktop, "node_modules/electron", name), path.join(electron, name));
  for (const name of ["@electron/get", "@electron-internal/extract-zip"])
    await fs.mkdir(path.join(root, "node_modules", name), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules/@electron/get/index.js"), `
    const fs = require('node:fs');
    module.exports.downloadArtifact = async (options) => {
      fs.appendFileSync('download.jsonl', JSON.stringify(options) + '\\n');
      ${failure ? "throw new Error('fixture download unavailable');" : "return options.arch;"}
    };
  `);
  await fs.writeFile(path.join(root, "node_modules/@electron-internal/extract-zip/index.js"), `
    const fs = require('node:fs/promises'), path = require('node:path');
    module.exports.extract = async (arch, {dir}) => {
      await fs.mkdir(dir, {recursive:true});
      const header = Buffer.alloc(64); header.write('7f454c460201', 0, 'hex');
      header.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18);
      for (const name of ['electron','chrome-sandbox']) await fs.writeFile(path.join(dir,name), header);
      await fs.writeFile(path.join(dir,'version'), ${JSON.stringify(version)});
    };
  `);
  return { root, electron, version, prepare: (arch, environment = {}) => helper.then(({prepareLinuxElectronReference}) =>
    prepareLinuxElectronReference({ desktop: root, arch, environment: { ...process.env, ...environment } })) };
}

for (const arch of ["x64", "arm64"]) test(`fresh ${arch} dependencies materialize the pinned Linux reference before verification, then reuse it`, async (t) => {
  const f = await fixture(t);
  await assert.rejects(fs.readFile(path.join(f.electron, "dist/chrome-sandbox")), { code: "ENOENT" });
  await f.prepare(arch, { ELECTRON_INSTALL_PLATFORM: "win32", ELECTRON_INSTALL_ARCH: "ia32",
    npm_config_platform: "darwin", npm_config_arch: "x64", ELECTRON_OVERRIDE_DIST_PATH: path.join(f.root, "outside"),
    electron_use_remote_checksums: "1", npm_config_electron_use_remote_checksums: "1" });
  const download = JSON.parse((await fs.readFile(path.join(f.root, "download.jsonl"), "utf8")).trim());
  assert.equal(download.platform, "linux");
  assert.equal(download.arch, arch);
  assert.equal(download.version, f.version);
  assert.match(download.checksums[`electron-v${f.version}-linux-${arch}.zip`], /^[a-f0-9]{64}$/);
  const first = await fs.readFile(path.join(f.electron, "dist/chrome-sandbox"));
  await assert.rejects(fs.lstat(path.join(f.root, "outside")), { code: "ENOENT" });
  await f.prepare(arch);
  assert.deepEqual(await fs.readFile(path.join(f.electron, "dist/chrome-sandbox")), first);
  assert.equal((await fs.readFile(path.join(f.root, "download.jsonl"), "utf8")).trim().split("\n").length, 1);
});

test("failed reference download stops preparation without accepting an absent dist", async (t) => {
  const f = await fixture(t, true);
  await assert.rejects(f.prepare("arm64"), /Cannot prepare the pinned Linux Electron reference/);
  await assert.rejects(fs.lstat(path.join(f.electron, "dist")), { code: "ENOENT" });
});

test("wrong cached architecture or dependency version cannot become the verifier reference", async (t) => {
  const f = await fixture(t);
  await f.prepare("x64");
  // Vendor isInstalled only checks version and executable path, not ELF arch.
  await assert.rejects(f.prepare("arm64"), /architecture mismatch/);
  await fs.writeFile(path.join(f.root, "package.json"), JSON.stringify({ devDependencies: { electron: "0.0.0" } }));
  await assert.rejects(f.prepare("x64"), /differs from the exact project pin/);
  assert.equal((await fs.readFile(path.join(f.root, "download.jsonl"), "utf8")).trim().split("\n").length, 1);
});
