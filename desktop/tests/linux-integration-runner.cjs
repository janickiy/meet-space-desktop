// Actual Linux integration fixtures. Production Tray/Notification/dialog APIs stay intact.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const ownedChildren = new Set();
const exited = child => !child.pid || child.exitCode !== null || child.signalCode !== null;
const waitExit = (child, milliseconds) => new Promise(resolve => { if (exited(child)) return resolve(true); const done = () => { clearTimeout(timer); resolve(true); }; const timer = setTimeout(() => { child.removeListener('exit', done); resolve(exited(child)); }, milliseconds); child.once('exit', done); });
async function stopOwned(child) { if (exited(child)) return; child.kill('SIGTERM'); if (await waitExit(child, 5000)) return; child.kill('SIGKILL'); if (!await waitExit(child, 5000)) throw new Error('owned_fixture_failed_to_exit'); }
async function stopAllOwned() { const results = await Promise.allSettled([...ownedChildren].map(stopOwned)); if (results.some(item => item.status === 'rejected') || [...ownedChildren].some(child => !exited(child))) throw new Error('owned_children_still_alive_profile_retained'); }
function renderer() {
  const state = window.__integration = { routes: [], quitSeen: false, actions: [], operatorNoticeSeen: false };
  window.meetspaceDesktop.onRoute(route => { state.routes.push(route); history.pushState({}, '', route); });
  window.meetspaceDesktop.onTransportEvent(event => { if (event.kind === 'lifecycle' && event.type === 'quit') state.quitSeen = true; });
  for (const button of document.querySelectorAll('button[data-action]')) button.onclick = () => { state.actions.push(button.dataset.action); };
  setInterval(() => { document.querySelector('pre').textContent = JSON.stringify({ ...state, actions: undefined }, null, 2); }, 200);
}
(async () => {
  assert.equal(process.platform, 'linux', 'Linux integration fixture only');
  const output = path.resolve(process.argv[2] || path.join(__dirname, '../artifacts/linux-integration'));
  const phase = process.argv[3] || 'baseline';
  assert.ok(['baseline', 'tray', 'notifications', 'downloads', 'external', 'autostart'].includes(phase));
  await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-linux-integration-'));
  const profile = path.join(directory, 'profile'), rendererRoot = path.join(directory, 'renderer');
  for (const name of ['profile', 'renderer', 'config', 'data', 'cache', 'state', 'data/applications']) await fs.mkdir(path.join(directory, name), { recursive: true, mode: 0o700 });
  const resultPath = path.join(output, phase + '.json');
  const coldRoute = '/meetings/11111111-2222-4333-8444-555555555555/join';
  const warmRoute = '/conferences/22222222-3333-4444-8555-666666666666/join';
  const savePath = path.join(os.tmpdir(), 'meetspace-s5-' + randomUUID().slice(0, 8) + '.mp4');
  const config = { phase, profile, rendererRoot, resultPath, progressPath: path.join(output, phase + '-progress.json'), controlPath: path.join(directory, 'control.json'), coldRoute, warmRoute, savePath,
    externalMarker: path.join(directory, 'external-marker.json'), timeoutMs: phase === 'baseline' || phase === 'external' ? 60000 : 360000 };
  config.buildMetadata = JSON.parse(await fs.readFile(path.join(__dirname, '../dist/build-provenance.json'), 'utf8'));
  const inputs = JSON.parse(await fs.readFile(path.join(__dirname, '../dist/source-inputs.json'), 'utf8'));
  config.sourceInputs = { sourceTreeSha256: inputs.sourceTreeSha256, fileCount: inputs.files.length };
  config.harnessInputs = [];
  for (const name of ['linux-integration-runner.cjs', 'linux-integration-electron.cjs']) { const bytes = await fs.readFile(path.join(__dirname, name)); config.harnessInputs.push({ path: 'desktop/tests/' + name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }); }
  const buttons = phase === 'tray' ? '<button data-action="enable-close">1 Opt in and close to tray</button><button data-action="programmatic-menu">Programmatic application-menu show/hide (not UI click)</button>'
    : phase === 'notifications' ? '<button data-action="notify">1 Send safe native notice and minimize</button><button data-action="notice-seen">2 Operator: actual native notice seen</button><button data-action="finish">3 Finish after clicking native notice</button>'
    : phase === 'downloads' ? '<button data-action="cancel-save">1 Open save chooser — cancel it</button><button data-action="save">2 Save fixture to target below</button><button data-action="finish">3 Finish</button>' : '<button data-action="finish">Finish</button>';
  await fs.writeFile(path.join(rendererRoot, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace Stage05 ${phase}</title><link rel="stylesheet" href="integration.css"></head><body><h1>MeetSpace Stage05 — ${phase}</h1><p>Isolated local fixture. No production account or server. No fake native APIs.</p>${buttons}<p>Download test target: <strong>${savePath}</strong></p><pre>Starting…</pre><script src="integration.js"></script></body></html>`);
  await fs.writeFile(path.join(rendererRoot, 'integration.js'), `(${renderer.toString()})();`);
  await fs.writeFile(path.join(rendererRoot, 'integration.css'), 'body{background:#eef2fa;color:#102030;font:18px sans-serif;margin:20px}button{padding:14px;margin:6px;font:16px sans-serif}pre{font:14px monospace;white-space:pre-wrap}strong{user-select:all}');
  const environment = { ...process.env, XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_DATA_HOME: path.join(directory, 'data'), XDG_CACHE_HOME: path.join(directory, 'cache'), XDG_STATE_HOME: path.join(directory, 'state') };
  for (const key of ['MEETSPACE_DESKTOP_DEV', 'MEETSPACE_DEV_CSP_NONCE', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) delete environment[key];
  // A real GIO desktop handler in test-only XDG dirs. No actual user's MIME defaults change.
  if (phase === 'external') {
    const helper = path.join(directory, 'external-handler.cjs');
    await fs.writeFile(helper, `require('node:fs').writeFileSync(${JSON.stringify(config.externalMarker)},JSON.stringify({args:process.argv.slice(2)}));`);
    const entry = '[Desktop Entry]\nType=Application\nName=MeetSpace safe local URI fixture\nExec="' + process.execPath + '" "' + helper + '" %u\nTerminal=false\nMimeType=x-scheme-handler/https;\n';
    await fs.writeFile(path.join(directory, 'data/applications/meetspace-stage05-uri.desktop'), entry);
    await fs.writeFile(path.join(directory, 'config/mimeapps.list'), '[Default Applications]\nx-scheme-handler/https=meetspace-stage05-uri.desktop\n');
  }
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify(config));
  const run = (secondary = false, link, ready) => new Promise((resolve, reject) => {
    const args = [path.join(__dirname, 'linux-integration-electron.cjs'), path.join(directory, 'config.json'), ...(secondary ? ['--secondary'] : []), ...(link ? [link] : [])];
    const child = spawn(require('electron'), args, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] }); ownedChildren.add(child);
    let stdout = '', stderr = '', announced = false;
    child.stdout.on('data', bytes => { const value = bytes.toString(); stdout += value; process.stdout.write(value); if (!announced && stdout.includes('LINUX_INTEGRATION_READY')) { announced = true; ready?.(); } });
    child.stderr.on('data', bytes => { const value = bytes.toString(); stderr = (stderr + value).slice(-16000); if (value.includes('Linux integration fixture failed')) process.stderr.write(value); });
    const timer = setTimeout(() => { void stopOwned(child).then(() => reject(new Error('linux_integration_outer_timeout')), reject); }, secondary ? 15000 : config.timeoutMs + 15000);
    child.once('error', error => { clearTimeout(timer); if (!child.pid) ownedChildren.delete(child); reject(error); });
    child.once('exit', (code, signal) => { ownedChildren.delete(child); clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`linux_integration_failed (${code ?? signal}); ${stderr.slice(-1500)}`)); });
  });
  let primary;
  try {
    if (phase === 'autostart') {
      await new Promise((resolve, reject) => { const child = spawn(process.execPath, ['--test', path.join(__dirname, 'platform-autostart.test.cjs')], { env: environment, stdio: 'inherit' }); ownedChildren.add(child); const timer = setTimeout(() => { void stopOwned(child).then(() => reject(new Error('autostart_linux_test_timeout')), reject); }, 60000); child.once('error', error => { if (!child.pid) ownedChildren.delete(child); clearTimeout(timer); reject(error); }); child.once('exit', code => { ownedChildren.delete(child); clearTimeout(timer); code === 0 ? resolve() : reject(new Error('autostart_linux_tests_failed')); }); });
      await fs.writeFile(resultPath, JSON.stringify({ result: 'PASS', phase, sourceInputs: config.sourceInputs, scope: 'Production XDG adapter, actual filesystem and GIO harmless executable tests. Not actual login or package-format acceptance.' }, null, 2) + '\n');
    } else if (phase === 'baseline') {
      let announce; const ready = new Promise(resolve => { announce = resolve; }); primary = run(false, 'meetspace://open' + coldRoute, announce); primary.catch(() => {});
      await Promise.race([ready, primary.then(() => { throw new Error('baseline_exited_before_ready'); })]);
      await run(true, 'meetspace://open' + warmRoute);
      await run(true, 'meetspace://open//untrusted.invalid/escape');
      await fs.writeFile(config.controlPath, JSON.stringify({ secondariesComplete: true })); await primary;
    } else await run();
    const report = JSON.parse(await fs.readFile(resultPath, 'utf8')); assert.equal(report.result, 'PASS'); console.log(JSON.stringify({ result: report.result, phase, report: resultPath }));
  } finally {
    await stopAllOwned(); if (primary) await primary.catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
    // Delete only the unique, explicitly owned target. No search of user downloads.
    await fs.rm(savePath, { force: true });
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
