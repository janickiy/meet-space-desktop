// Disposable directory-package smoke, not an installer/package-format test.
// Uses a bounded localhost Node inspector observer on its OWN copied test runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const net = require('node:net');
const WebSocket = require('ws');
const exec = promisify(execFile), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = value => createHash('sha256').update(value).digest('hex');
async function ownedDirectory(config) {
  const home = await fs.realpath(os.homedir()), directory = path.resolve(config.directory), info = await fs.lstat(directory);
  assert.equal(path.dirname(directory), home, 'own copied package is a direct HOME child');
  assert.ok(/^\.meetspace-stage05-package-[A-Za-z0-9_-]+$/.test(path.basename(directory)));
  assert.equal(info.isSymbolicLink(), false); assert.equal(info.isDirectory(), true); assert.equal(info.uid, process.getuid());
  assert.equal(await fs.realpath(directory), directory);
  assert.equal(config.runtime, path.join(directory, 'runtime')); assert.equal(config.appRoot, path.join(directory, 'runtime/resources/app'));
  assert.equal(config.helper, path.join(directory, 'runtime/chrome-sandbox')); assert.equal(config.executable, path.join(directory, 'runtime/MeetSpace')); assert.equal(config.xdg, path.join(directory, 'xdg'));
  for (const name of [config.runtime, config.appRoot, config.xdg]) { const stat = await fs.lstat(name); assert.equal(stat.isDirectory(), true); assert.equal(stat.isSymbolicLink(), false); assert.equal(await fs.realpath(name), name); }
  return directory;
}
async function prepare(output) {
  assert.equal(process.platform, 'linux');
  await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.homedir()), '.meetspace-stage05-package-'));
  const runtime = path.join(directory, 'runtime'), appRoot = path.join(runtime, 'resources/app');
  const source = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'dist/source-inputs.json'), 'utf8'));
  const provenance = JSON.parse(await fs.readFile(path.join(source, 'dist/build-provenance.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  assert.equal(provenance.releaseMode, 'test'); assert.equal(provenance.appId, 'com.janickiy.meetspace.desktop.test'); assert.equal(provenance.buildVersion, pkg.version + '-test');
  await fs.cp('/opt/electron', runtime, { recursive: true, preserveTimestamps: true });
  await fs.rm(path.join(runtime, 'resources/default_app.asar'), { force: true });
  await fs.mkdir(appRoot, { recursive: true });
  for (const name of ['package.json', 'dist', 'renderer', 'resources']) await fs.cp(path.join(source, name), path.join(appRoot, name), { recursive: true, preserveTimestamps: true });
  const policy = require('../scripts/runtime-policy.cjs');
  for (const name of policy.runtimePackages) await fs.cp(path.join(source, 'node_modules', name), path.join(appRoot, 'node_modules', name), { recursive: true, preserveTimestamps: true,
    filter: from => { const relative = path.relative(path.join(source, 'node_modules'), from).replaceAll(path.sep, '/'); return !relative.endsWith('.node') && !/^ssh2\/(?:test|examples|util)(?:\/|$)/.test(relative) && !/^ssh2\/lib\/protocol\/crypto\/(?:src|build)(?:\/|$)/.test(relative) && relative !== 'ssh2/lib/protocol/crypto/binding.gyp'; } });
  const executable = path.join(runtime, 'MeetSpace'); await fs.rename(path.join(runtime, 'electron'), executable);
  const xdg = path.join(directory, 'xdg'); for (const name of ['config', 'data', 'cache', 'state']) await fs.mkdir(path.join(xdg, name), { recursive: true, mode: 0o700 });
  const helper = path.join(runtime, 'chrome-sandbox');
  const config = { schemaVersion: 1, directory, runtime, appRoot, executable, helper, xdg, output, sourceInputs: { sourceTreeSha256: manifest.sourceTreeSha256, fileCount: manifest.files.length }, provenance,
    copiedPackageJsonSha256: digest(await fs.readFile(path.join(appRoot, 'package.json'))), copiedMainEntry: pkg.main,
    runtimePackages: Object.fromEntries(await Promise.all(policy.runtimePackages.map(async name => [name, JSON.parse(await fs.readFile(path.join(appRoot, 'node_modules', name, 'package.json'), 'utf8')).version]))),
    officialRuntime: { version: (await fs.readFile(path.join('/opt/electron', 'version'), 'utf8')).trim(), originalSandboxSha256: digest(await fs.readFile('/opt/electron/chrome-sandbox')), copiedSandboxSha256: digest(await fs.readFile(helper)) } };
  const configPath = path.join(output, 'packaged-directory-config.json'); await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  // The caller applies only this own copy's normal helper ownership via approved root guest-agent execution.
  console.log(JSON.stringify({ status: 'PREPARED_NEEDS_TARGETED_ROOT_HELPER', configPath, helper, requestedUid: 0, requestedGid: 0, requestedMode: '4755', originalRuntimeUntouched: true }));
}
async function run(configPath) {
  assert.equal(process.platform, 'linux');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  await ownedDirectory(config);
  assert.equal(await fs.realpath(config.helper), config.helper);
  const helper = await fs.stat(config.helper); assert.equal(helper.uid, 0); assert.equal(helper.gid, 0); assert.equal(helper.mode & 0o7777, 0o4755);
  assert.equal(digest(await fs.readFile(config.helper)), config.officialRuntime.originalSandboxSha256);
  const environment = { ...process.env, XDG_CONFIG_HOME: path.join(config.xdg, 'config'), XDG_DATA_HOME: path.join(config.xdg, 'data'), XDG_CACHE_HOME: path.join(config.xdg, 'cache'), XDG_STATE_HOME: path.join(config.xdg, 'state') };
  for (const key of ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_OVERRIDE_DIST_PATH', 'CHROME_DEVEL_SANDBOX', 'MEETSPACE_DESKTOP_DEV', 'MEETSPACE_DEV_CSP_NONCE', 'NODE_EXTRA_CA_CERTS']) delete environment[key];
  const report = { schemaVersion: 1, result: 'FAIL', sourceInputs: config.sourceInputs, copiedBuildProvenance: config.provenance, runtimePackages: config.runtimePackages, officialRuntime: config.officialRuntime,
    scope: 'Copied official runtime with resources/app; actual packaged entry/identity and real IPC/XDG/GIO. No installer, deb/rpm/AppImage or actual-login acceptance.',
    observerBoundary: 'Own test package only, Node inspector bound127.0.0.1:0. Does not count as ordinary entry without observer acceptance. No production hook or fake native API.', rendererSandboxDisabled: false, actualUserConfigOrDefaultsChanged: false, checks: {} };
  let child, socket, inspectorUrl, exited = false, exitCode, stderr = '', sequence = 0; let watchdog;
  const waitForExit = async milliseconds => { const end = Date.now() + milliseconds; while (!exited && Date.now() < end) await sleep(50); return exited; };
  const stopOwnChild = async () => { if (!child || exited) return; child.kill('SIGTERM'); if (await waitForExit(5000)) return; child.kill('SIGKILL'); if (!await waitForExit(5000)) throw new Error('copied_package_still_alive_runtime_retained'); }; const pending = new Map();
  const resultPath = path.join(config.output, 'packaged-directory.json');
  const write = () => syncFs.writeFileSync(resultPath, JSON.stringify(report, null, 2) + '\n');
  const request = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('bounded_inspector_request_timeout')); }, 8000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 7000 }); if (result.exceptionDetails) throw new Error('inspector_expression_failed: ' + result.exceptionDetails.text); return result.result.value; };
  const electron = `process.getBuiltinModule('module').createRequire(${JSON.stringify(config.executable)})('electron')`;
  const inspect = expression => evaluate(`(async()=>{const{app,BrowserWindow}=${electron};const window=BrowserWindow.getAllWindows()[0];${expression}})()`);
  const ipc = (name, ...args) => inspect(`return await window.webContents.executeJavaScript(${JSON.stringify(`window.meetspaceDesktop[${JSON.stringify(name)}](...${JSON.stringify(args)})`)});`);
  try {
    child = spawn(config.executable, ['--inspect=127.0.0.1:0'], { cwd: config.runtime, env: environment, stdio: ['ignore', 'ignore', 'pipe'] }); report.mainPid = child.pid;
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-16000); const match = stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/); if (match) inspectorUrl = match[1]; });
    child.once('exit', code => { exited = true; exitCode = code; }); watchdog = setTimeout(() => { void stopOwnChild().catch(() => {}); }, 110000); child.once('error', error => { exited = true; report.spawnError = error.message; });
    const deadline = Date.now() + 90000;
    while (!inspectorUrl && !exited && Date.now() < deadline) await sleep(50);
    assert.ok(inspectorUrl, 'own localhost inspector opened'); const parsed = new URL(inspectorUrl); assert.equal(parsed.hostname, '127.0.0.1');
    socket = new WebSocket(inspectorUrl, { handshakeTimeout: 5000 }); await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.on('message', bytes => { const value = JSON.parse(bytes.toString()), entry = pending.get(value.id); if (!entry) return; pending.delete(value.id); value.error ? entry.reject(new Error(value.error.message)) : entry.resolve(value.result); });
    let bootstrap;
    while (Date.now() < deadline && !exited) {
      bootstrap = await evaluate(`({entryCached:!!process.getBuiltinModule('module')._cache[${JSON.stringify(config.appRoot + '/dist/entry.js')}],entryLoaded:process.getBuiltinModule('module')._cache[${JSON.stringify(config.appRoot + '/dist/entry.js')}]?.loaded===true})`);
      if (bootstrap.entryLoaded) break; await sleep(50);
    }
    assert.equal(bootstrap?.entryLoaded, true, 'exact copied package entry is loaded before inspector requires Electron'); report.bootstrapReadiness = bootstrap;
    let snapshot;
    while (Date.now() < deadline && !exited) {
      snapshot = await inspect("return {ready:app.isReady(),packaged:app.isPackaged,version:app.getVersion(),appPath:app.getAppPath(),userData:app.getPath('userData'),window:window?{visible:window.isVisible(),loading:window.webContents.isLoading(),url:window.webContents.getURL(),sandbox:window.webContents.getLastWebPreferences().sandbox}:null};");
      if (snapshot.ready && snapshot.window?.visible && !snapshot.window.loading) break; await sleep(150);
    }
    assert.ok(snapshot?.window?.visible && snapshot.window.url.startsWith('app://')); assert.equal(snapshot.packaged, true); assert.equal(snapshot.window.sandbox, true); assert.equal(snapshot.appPath, config.appRoot); assert.ok(snapshot.userData.startsWith(path.join(config.xdg, 'config') + '/'));
    report.packagedRuntime = snapshot; const runtime = await ipc('getRuntimeInfo'); assert.equal(runtime.isPackaged, true); assert.equal(runtime.host.supports.startup, true); report.runtime = runtime;
    const initial = await ipc('getNativePreferences'); assert.equal(initial.startupSupported, true); assert.equal(initial.startAtLogin, false);
    await ipc('setNativePreferences', { startAtLogin: true }); assert.equal((await ipc('getNativePreferences')).startAtLogin, true);
    const desktop = path.join(config.xdg, 'config/autostart', config.provenance.appId + '.desktop'), enabled = await fs.readFile(desktop, 'utf8'); assert.ok(enabled.includes('Hidden=false\n')); assert.ok(enabled.includes(config.executable)); report.checks.realPackagedIpcAutostartOptIn = 'PASS';
    await inspect("globalThis.__meetspaceStage05SecondInstances=0;app.on('second-instance',()=>{globalThis.__meetspaceStage05SecondInstances++});return true;");
    await ipc('minimize');
    let minimized = false; for (let attempt = 0; attempt < 50; attempt++) { minimized = await inspect('return window.isMinimized();'); if (minimized) break; await sleep(100); } assert.equal(minimized, true);
    await exec('/usr/bin/gio', ['launch', desktop], { env: environment, timeout: 15000, maxBuffer: 65536 });
    let reactivated = false; for (let attempt = 0; attempt < 100; attempt++) { reactivated = await inspect('return globalThis.__meetspaceStage05SecondInstances>=1&&window.isVisible()&&!window.isMinimized();'); if (reactivated) break; await sleep(100); } assert.equal(reactivated, true, 'real GIO Exec launches exact copied package and reuses primary');
    report.checks.realGioExecSecondInstanceRestore = 'PASS';
    await ipc('setNativePreferences', { startAtLogin: false }); assert.equal((await ipc('getNativePreferences')).startAtLogin, false); const disabled = await fs.readFile(desktop, 'utf8'); assert.equal(disabled, enabled.replace('Hidden=false', 'Hidden=true')); report.checks.realPackagedIpcAutostartOptOut = 'PASS'; report.desktopEntry = { enabledSha256: digest(enabled), disabledSha256: digest(disabled), argv: 'validated executable only, no arguments', actualLoginTested: false };
    // Sending the real quit IPC closes the inspector transport as part of process exit.
    void ipc('quit').catch(() => {}); socket.close();
    for (let attempt = 0; attempt < 100 && !exited; attempt++) await sleep(100);
    assert.equal(exited, true); assert.equal(exitCode, 0);
    report.inspectorPortClosed = await new Promise(resolve => { const probe = net.connect({ host: '127.0.0.1', port: +parsed.port }); probe.setTimeout(1000); probe.once('error', () => { probe.destroy(); resolve(true); }); probe.once('connect', () => { probe.destroy(); resolve(false); }); probe.once('timeout', () => { probe.destroy(); resolve(false); }); }); assert.equal(report.inspectorPortClosed, true);
    report.checks.realQuitAndInspectorClosed = 'PASS'; report.result = 'PASS';
  } catch (error) { report.failure = { message: error.message, stack: error.stack }; throw error; }
  finally {
    clearTimeout(watchdog); socket?.terminate(); for (const item of pending.values()) item.reject(new Error('observer_closed')); pending.clear();
    try { await stopOwnChild(); } catch (error) { report.result = 'FAIL'; report.cleanupFailure = error.message; report.ownProcessExited = false; report.ownCopiedDirectoryRemoved = false; write(); throw error; }
    report.ownProcessExited = exited; report.cleanupScope = 'Only own copied package and XDG dirs removed; source/official /opt/electron untouched';
    try { await ownedDirectory(config); await fs.rm(config.directory, { recursive: true, force: true }); report.ownCopiedDirectoryRemoved = !syncFs.existsSync(config.directory); }
    catch (error) { report.result = 'FAIL'; report.cleanupFailure = error.message; report.ownCopiedDirectoryRemoved = false; write(); throw error; }
    if (!exited) { report.result = 'FAIL'; report.cleanupFailure = 'own package did not exit'; } write(); console.log(JSON.stringify({ result: report.result, report: resultPath }));
  }
}
(async () => { const mode = process.argv[2], target = path.resolve(process.argv[3] || path.join(__dirname, '../artifacts/linux-packaged-directory')); if (mode === 'prepare') await prepare(target); else if (mode === 'run') await run(target); else throw new Error('Usage: node linux-packaged-directory-runner.cjs prepare OUTPUT | run CONFIG'); })().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
