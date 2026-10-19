// Test evidence only. Production backend sources live in the external Go cache.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const backendModule = Object.freeze({
  path: "github.com/janickiy/meet-space",
  version: "v0.0.0-20261013170743-66e482c9701b",
  commit: "66e482c9701b6c13f58bc93aee8d9f5cf932dd34",
});
const fixtureRelativePath = "desktop/tests/fixtures/pion-sfu";
const fixtureDirectory = (repository) => path.join(repository, fixtureRelativePath);
// A parent checkout's go.work or GOFLAGS must not replace the pinned backend.
const goEnvironment = () => ({ ...process.env, GOWORK: "off", GOFLAGS: "-mod=readonly" });

async function ordinaryFile(filename) {
  if (!(await fs.lstat(filename)).isFile()) throw Error("Pion source evidence requires ordinary files");
  return fs.readFile(filename);
}

function validateDownloadedModule(downloaded, lock) {
  const expected = (suffix) => lock.split(/\r?\n/).find(line =>
    line.startsWith(`${backendModule.path} ${backendModule.version}${suffix} `))?.split(" ")[2];
  if (downloaded.Path !== backendModule.path || downloaded.Version !== backendModule.version ||
      !expected("") || !expected("/go.mod") || downloaded.Sum !== expected("") || downloaded.GoModSum !== expected("/go.mod") ||
      !path.isAbsolute(downloaded.Dir ?? "") || !path.isAbsolute(downloaded.GoMod ?? "") || downloaded.Error || downloaded.Replace)
    throw Error("Pinned Pion backend module/checksum mismatch");
  if (downloaded.Origin?.Hash && downloaded.Origin.Hash !== backendModule.commit)
    throw Error("Pinned Pion backend commit mismatch");
  return { ...backendModule, sum: downloaded.Sum, goModSum: downloaded.GoModSum };
}

async function backendSourceInputs(repository) {
  const directory = fixtureDirectory(repository);
  const moduleBytes = await ordinaryFile(path.join(directory, "go.mod"));
  const lockBytes = await ordinaryFile(path.join(directory, "go.sum"));
  let downloaded;
  try {
    const result = await execute("go", ["mod", "download", "-json", `${backendModule.path}@${backendModule.version}`],
      { cwd: directory, env: goEnvironment(), timeout: 240_000, maxBuffer: 1024 * 1024 });
    downloaded = JSON.parse(result.stdout);
    const selected = await execute("go", ["list", "-m", "-json", backendModule.path],
      { cwd: directory, env: goEnvironment(), timeout: 240_000, maxBuffer: 1024 * 1024 });
    validateDownloadedModule(JSON.parse(selected.stdout), lockBytes.toString("utf8"));
  } catch { throw Error("Cannot resolve the checksum-locked external Pion backend; install Go and allow module downloads"); }
  const identity = validateDownloadedModule(downloaded, lockBytes.toString("utf8"));
  const names = ["go.mod", "go.sum"];
  async function walk(relative) {
    for (const entry of await fs.readdir(path.join(downloaded.Dir, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile() && entry.name.endsWith(".go")) names.push(name);
      else if (entry.isSymbolicLink()) throw new Error("Go source evidence cannot follow symlinks");
    }
  }
  await walk("internal");
  const files = [];
  for (const name of [...new Set(names)].sort()) {
    const bytes = await ordinaryFile(path.join(downloaded.Dir, name));
    files.push({ path: `backend/${name}`, sha256: sha256(bytes), bytes: bytes.length });
  }
  for (const name of ["go.mod", "go.sum", "main.go"]) {
    const bytes = await ordinaryFile(path.join(directory, name));
    files.push({ path: `${fixtureRelativePath}/${name}`, sha256: sha256(bytes), bytes: bytes.length });
  }
  // Resolving/building a test may download into the Go cache, never edit locks.
  if (!moduleBytes.equals(await ordinaryFile(path.join(directory, "go.mod"))) ||
      !lockBytes.equals(await ordinaryFile(path.join(directory, "go.sum")))) throw Error("Pion fixture dependency locks changed");
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {
    schemaVersion: 2,
    scope: "Pinned external backend module (go.mod, go.sum and internal Go sources), local test driver and its frozen dependency module; no backend sources in the desktop checkout",
    backendModule: identity,
    sourceTreeSha256: sha256(JSON.stringify({ backendModule: identity, files })),
    files,
  };
}

async function buildPionFixture(repository, executable) {
  if (!path.isAbsolute(executable)) throw Error("Absolute Pion fixture output required");
  await new Promise((resolve, reject) => {
    const child = spawn("go", ["build", "-mod=readonly", "-trimpath", "-o", executable, "."],
      { cwd: fixtureDirectory(repository), env: goEnvironment(), stdio: "inherit" });
    let expired = false, hardKill;
    const timer = setTimeout(() => {
      expired = true; child.kill("SIGTERM"); hardKill = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, 240_000);
    const clear = () => { clearTimeout(timer); clearTimeout(hardKill); };
    child.once("error", () => { clear(); reject(Error("Cannot start the Go Pion fixture build")); });
    child.once("exit", (code, signal) => {
      clear();
      code === 0 && !expired ? resolve() : reject(Error(`Pion fixture build failed: ${code ?? signal}${expired ? " after deadline" : ""}`));
    });
  });
}

async function verifyPionFixture(executable, inputs) {
  if (!path.isAbsolute(executable)) throw Error("Fixture path must be absolute");
  const supplied = JSON.parse(await ordinaryFile(executable + ".source-inputs.json"));
  if (supplied.backendSourceTreeSha256 !== inputs.sourceTreeSha256 || supplied.platform !== process.platform || supplied.arch !== process.arch ||
      supplied.binarySha256 !== sha256(await ordinaryFile(executable)))
    throw Error("Prebuilt Pion fixture source/architecture/checksum mismatch");
}
module.exports = { backendSourceInputs, buildPionFixture, verifyPionFixture, validateDownloadedModule, backendModule, sha256 };
