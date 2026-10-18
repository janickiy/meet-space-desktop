// Isolated API fixture lives in the parent, outside the measured Electron heap.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createCertificates, createFixture } = require('./fixtures/https-fixture.cjs');
const { createProductFixture } = require('./fixtures/product-fixture.cjs');
(async () => {
  const phase = process.argv[2];
  if (!['baseline', 'after'].includes(phase)) throw new Error('Expected baseline or after');
  let evidenceDir, visible = false, executable = require('electron');
  for (const argument of process.argv.slice(3)) {
    if (argument === '--visible') visible = true;
    else if (argument.startsWith('--evidence=')) evidenceDir = argument.slice('--evidence='.length);
    else if (argument.startsWith('--electron=')) executable = argument.slice('--electron='.length);
    else throw new Error(`Unknown profile argument: ${argument}`);
  }
  if (!path.isAbsolute(executable)) throw new Error('Electron executable must be an absolute path');
  let sourceInputs, sourceBefore;
  if (evidenceDir) {
    if (!path.isAbsolute(evidenceDir)) throw new Error('Evidence directory must be an absolute path');
    ({ sourceInputs } = await import(pathToFileURL(path.resolve(__dirname, '../scripts/ci/source-inputs.mjs')).href));
    sourceBefore = await sourceInputs(path.resolve(__dirname, '../..'));
    await fs.mkdir(path.dirname(evidenceDir), { recursive: true });
    await fs.mkdir(evidenceDir); // Explicit outputs are exclusive: preserve earlier measurements.
    await fs.writeFile(path.join(evidenceDir, 'source-inputs.json'), JSON.stringify(sourceBefore, null, 2) + '\n', { flag: 'wx' });
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-stage07-profile-'));
  let certificates, fixture, beta, preserveProfile = false;
  try {
    certificates = await createCertificates();
    fixture = await createProductFixture(certificates);
    beta = await createFixture({ name: 'profile-beta', certificates });
    const caPath = path.join(directory, 'ca.pem');
    await fs.writeFile(caPath, certificates.ca);
    const configPath = path.join(directory, 'config.json');
    await fs.writeFile(configPath, JSON.stringify({ phase, caPath, evidenceDir, visible, sourceTreeSha256: sourceBefore?.sourceTreeSha256, userDataDir: path.join(directory, 'profile'),
      alpha: { origin: fixture.origin, email: fixture.users[0].email }, beta: { origin: beta.origin } }));
    const env = { ...process.env };
    delete env.MEETSPACE_DESKTOP_DEV; delete env.MEETSPACE_DEV_CSP_NONCE; delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [path.join(__dirname, 'stage07-profile-electron.cjs'), configPath], { env, stdio: 'inherit' });
      let expired = false, hardKill, reapDeadline;
      const clearTimers = () => { clearTimeout(timer); clearTimeout(hardKill); clearTimeout(reapDeadline); };
      const timer = setTimeout(() => {
        expired = true;
        child.kill('SIGTERM');
        hardKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
        reapDeadline = setTimeout(() => {
          preserveProfile = true;
          clearTimers();
          reject(new Error('Stage07 profile child did not exit after timeout; private temporary profile preserved'));
        }, 10_000);
      }, 240_000);
      child.once('error', error => { clearTimers(); preserveProfile = !!child.pid; reject(error); });
      child.once('exit', (code, signal) => {
        clearTimers();
        if (expired) reject(new Error(`Stage07 profile deadline exceeded; child exited ${code ?? signal}`));
        else code === 0 ? resolve() : reject(new Error(`Stage07 profile exited ${code ?? signal}`));
      });
    });
    if (fixture.sockets.size || fixture.streams.size || beta.sockets.size || beta.streams.size)
      throw new Error('Native transports retained after app quit');
    if (sourceBefore) {
      const sourceAfter = await sourceInputs(path.resolve(__dirname, '../..'));
      if (sourceAfter.sourceTreeSha256 !== sourceBefore.sourceTreeSha256) throw new Error('Profile sources changed during measurement');
    }
  } catch (error) {
    if (evidenceDir) await fs.writeFile(path.join(evidenceDir, 'runner-failure.json'), JSON.stringify({ result: 'FAIL',
      error: error.message, temporaryProfilePreserved: preserveProfile, ...(preserveProfile ? { temporaryDirectory: directory } : {}) }, null, 2) + '\n', { flag: 'wx' });
    throw error;
  } finally {
    await fixture?.close(); await beta?.close(); await certificates?.close();
    if (!preserveProfile) await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
