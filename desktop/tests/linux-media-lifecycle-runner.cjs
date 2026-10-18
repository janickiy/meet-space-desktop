// Extension of the established stage07 real Chromium/Pion lifecycle runner.
// Usage: node tests/linux-media-lifecycle-runner.cjs /absolute/NEW-evidence-dir
//        [--cycles=100] [--electron=/absolute/pinned-electron] [--fixture=/absolute/pion-fixture]
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const desktopRequire = Module.createRequire(path.join(root, 'desktop/package.json'));
const {backendSourceInputs} = require('./fixtures/pion-source-inputs.cjs');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async () => {
  const evidence = process.argv[2];
  let cycles = 100, electronExecutable = desktopRequire('electron'), fixture;
  if (!evidence || !path.isAbsolute(evidence)) throw Error('Absolute NEW evidence path required');
  for (const arg of process.argv.slice(3)) {
    if (arg.startsWith('--cycles=')) cycles = Number(arg.slice(9));
    else if (arg.startsWith('--electron=')) electronExecutable = arg.slice(11);
    else if (arg.startsWith('--fixture=')) fixture = arg.slice(10);
    else throw Error('Unknown argument');
  }
  if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 200) throw Error('cycles must be 1..200');
  if (!path.isAbsolute(electronExecutable) || digest(electronExecutable) !== digest(desktopRequire('electron')))
    throw Error('Electron override differs from pinned installed runtime');
  const backendInputs = await backendSourceInputs(root);
  if (fixture) {
    if (!path.isAbsolute(fixture)) throw Error('Fixture path must be absolute');
    const proof = JSON.parse(fs.readFileSync(fixture + '.source-inputs.json', 'utf8'));
    if (proof.backendSourceTreeSha256 !== backendInputs.sourceTreeSha256 || proof.platform !== process.platform ||
        proof.arch !== process.arch || proof.binarySha256 !== digest(fixture)) throw Error('Prebuilt Pion fixture source/architecture/checksum mismatch');
  }
  fs.mkdirSync(path.dirname(evidence), {recursive: true});
  fs.mkdirSync(evidence, {mode: 0o700}); // Reject reuse, preserving earlier baseline/after outputs.
  const original = path.join(root, 'desktop/tests/stage07-media-runner.cjs');
  let source = fs.readFileSync(original, 'utf8');
  const changes = [
    ['"frontend/scripts/stage07-lifecycle-renderer.tsx"', '"frontend/scripts/linux-media-lifecycle-renderer.tsx"'],
    ['path.join(__dirname, "stage07-media-electron.cjs")', JSON.stringify(path.join(__dirname, 'linux-media-lifecycle-electron.cjs'))],
    ['regressionOnly: process.argv.includes("--regression-only"),', 'regressionOnly: true, extendedCycles: ' + cycles + ','],
    ['require("electron"),', JSON.stringify(electronExecutable) + ','],
  ];
  for (const [before, after] of changes) {
    if (source.split(before).length !== 2) throw Error('Original runner drift: ' + before);
    source = source.replace(before, after);
  }
  if (fixture) {
    const start = source.indexOf('    const executable = path.join(');
    const end = source.indexOf('    const frontendRequire = createRequire(', start);
    if (start < 0 || end < 0) throw Error('Original Go build block drift');
    source = source.slice(0, start) + '    const executable = ' + JSON.stringify(fixture) + ';\n' + source.slice(end);
  }
  // Wait for subprocess exit before deleting temporary data after a deadline.
  const runStart = source.indexOf('async function run(binary, args, options = {}) {');
  const runEnd = source.indexOf('(async () => {', runStart);
  if (runStart < 0 || runEnd < 0) throw Error('Original subprocess helper drift');
  const boundedRun = `async function run(binary, args, options = {}) {
    await new Promise((resolve, reject) => {
      const child = spawn(binary, args, {stdio: "inherit", ...options});
      let expired = false, hardKill;
      const timer = setTimeout(() => {
        expired = true; child.kill("SIGTERM"); hardKill = setTimeout(() => child.kill("SIGKILL"), 5000);
      }, 480000);
      child.once("error", error => {clearTimeout(timer); clearTimeout(hardKill); reject(error);});
      child.once("exit", (code, signal) => {
        clearTimeout(timer); clearTimeout(hardKill);
        code === 0 && !expired ? resolve() : reject(Error("Lifecycle subprocess failed: " + (code ?? signal) + (expired ? " after deadline" : "")));
      });
    });
  }
  `;
  source = source.slice(0, runStart) + boundedRun + source.slice(runEnd);
  fs.writeFileSync(path.join(evidence, 'backend-source-inputs.json'), JSON.stringify(backendInputs, null, 2) + '\n', {flag: 'wx'});
  const files = ['desktop/tests/stage07-media-runner.cjs', 'desktop/tests/stage07-media-electron.cjs',
    'desktop/tests/linux-media-lifecycle-runner.cjs', 'desktop/tests/linux-media-lifecycle-electron.cjs',
    'frontend/scripts/linux-media-lifecycle-renderer.tsx', 'desktop/dist/main.js', 'desktop/dist/preload.js'];
  fs.writeFileSync(path.join(evidence, 'harness-extension-inputs.json'), JSON.stringify({cycles, electronSha256: digest(electronExecutable),
    fixtureSha256: fixture ? digest(fixture) : null, files: files.map(file => ({file, sha256: digest(path.join(root, file))})),
    scope: 'Camera/microphone replacement and synthetic display start/stop on real Chromium fake capture tracks and Pion; no OS portal or physical devices'}, null, 2) + '\n', {flag: 'wx'});
  const loaded = new Module(original, module);
  loaded.filename = original; loaded.paths = Module._nodeModulePaths(path.dirname(original)); loaded._compile(source, original);
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
