// Real Electron/shared client + repository Pion SFU and ephemeral local TURN.
// Usage: node tests/sfu-runner.cjs [evidence-dir] [--peers=2,3,4,5]
//        [--routes=direct,relay] [--fixture=/absolute/prebuilt/pion-fixture]
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");
const { backendSourceInputs, sha256 } = require("./fixtures/pion-source-inputs.cjs");

function run(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: "inherit", ...options });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("SFU test subprocess timed out")); }, 240_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error("SFU subprocess failed: " + (code ?? signal)));
    });
  });
}

(async () => {
  const repository = path.resolve(__dirname, "../..");
  let evidence = path.join(repository, "desktop/artifacts/sfu-current"), fixture;
  let participants = [2, 3, 4, 5], routes = ["direct", "relay"], hasOutput = false;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--peers=")) participants = arg.slice(8).split(",").map(Number);
    else if (arg.startsWith("--routes=")) routes = arg.slice(9).split(",");
    else if (arg.startsWith("--fixture=")) fixture = arg.slice(10);
    else if (!arg.startsWith("--") && !hasOutput) { evidence = path.resolve(arg); hasOutput = true; }
    else throw new Error("Unknown SFU harness argument");
  }
  if (!participants.length || participants.some(n => !Number.isInteger(n) || n < 2 || n > 5) || new Set(participants).size !== participants.length ||
      !routes.length || routes.some(route => !["direct", "relay"].includes(route)) || new Set(routes).size !== routes.length ||
      (fixture && !path.isAbsolute(fixture))) throw new Error("Invalid SFU harness cases or fixture path");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-sfu-"));
  await fs.mkdir(evidence, { recursive: true });
  await fs.rm(path.join(evidence, "result.json"), { force: true });
  const results = [];
  try {
    const { sourceInputs } = await import(pathToFileURL(path.join(repository, "desktop/scripts/ci/source-inputs.mjs")).href);
    const commonInputs = await sourceInputs(repository);
    const backendInputs = await backendSourceInputs(repository);
    await fs.writeFile(path.join(evidence, "source-inputs.json"), JSON.stringify(commonInputs, null, 2) + "\n");
    await fs.writeFile(path.join(evidence, "backend-source-inputs.json"), JSON.stringify(backendInputs, null, 2) + "\n");
    const executable = fixture || path.join(directory, process.platform === "win32" ? "pion-fixture.exe" : "pion-fixture");
    if (fixture) {
      const supplied = JSON.parse(await fs.readFile(fixture + ".source-inputs.json", "utf8"));
      if (supplied.backendSourceTreeSha256 !== backendInputs.sourceTreeSha256 || supplied.platform !== process.platform || supplied.arch !== process.arch ||
          supplied.binarySha256 !== sha256(await fs.readFile(fixture))) throw new Error("Prebuilt Pion fixture source/architecture/checksum mismatch");
    } else await run("go", ["build", "-trimpath", "-o", executable, "./desktop/tests/fixtures/pion-sfu"], { cwd: repository });
    const fixtureEvidence = { platform: process.platform, arch: process.arch, binarySha256: sha256(await fs.readFile(executable)),
      backendSourceTreeSha256: backendInputs.sourceTreeSha256, commonSourceTreeSha256: commonInputs.sourceTreeSha256, prebuilt: !!fixture };
    await fs.writeFile(path.join(evidence, "fixture.json"), JSON.stringify(fixtureEvidence, null, 2) + "\n");
    const frontendRequire = createRequire(path.join(repository, "frontend/package.json"));
    const { build } = await import(pathToFileURL(frontendRequire.resolve("vite")).href);
    const rendererRoot = path.join(directory, "renderer");
    await fs.mkdir(rendererRoot);
    await build({ configFile: false, root: path.join(repository, "frontend"), logLevel: "warn", define: { __DESKTOP_BUILD__: "true" },
      build: { outDir: rendererRoot, emptyOutDir: false, minify: false, target: "es2022",
        lib: { entry: path.join(repository, "frontend/src/media.ts"), name: "MeetSpaceMedia", formats: ["iife"], fileName: () => "media.js" } },
    });
    await fs.writeFile(path.join(rendererRoot, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace synthetic SFU fixture</title></head><body><script src="/media.js"></script></body></html>');
    const environment = { ...process.env };
    for (const name of ["MEETSPACE_DESKTOP_DEV", "MEETSPACE_DEV_CSP_NONCE", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS"]) delete environment[name];
    for (const count of participants) for (const route of routes) {
      const name = count + "-" + route, userDataDir = path.join(directory, name + "-profile");
      await fs.mkdir(userDataDir);
      const reportPath = path.join(evidence, name + ".json"), configPath = path.join(directory, name + ".json");
      await fs.rm(reportPath, { force: true });
      await fs.writeFile(configPath, JSON.stringify({ executable, rendererRoot, userDataDir, relay: route === "relay", participants: count, reportPath, fixtureEvidence }));
      await run(require("electron"), [path.join(__dirname, "sfu-electron.cjs"), configPath], { env: environment });
      results.push(JSON.parse(await fs.readFile(reportPath, "utf8")));
    }
    const after = await sourceInputs(repository), backendAfter = await backendSourceInputs(repository);
    if (after.sourceTreeSha256 !== commonInputs.sourceTreeSha256 || backendAfter.sourceTreeSha256 !== backendInputs.sourceTreeSha256) throw new Error("Source changed during SFU validation");
    const result = { result: "PASS", ...fixtureEvidence, cases: results.map(({ participants, relay, result, elapsedMs }) => ({ participants, relay, result, elapsedMs })),
      syntheticDevices: true, physicalDevicesTested: false, productionSignalingAuthenticationTested: false, hardwareSleepTested: false, windowsRuntimeTested: process.platform === "win32" };
    await fs.writeFile(path.join(evidence, "result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
