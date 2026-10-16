// Isolated API fixture lives in the parent, outside the measured Electron heap.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createCertificates, createFixture } = require('./fixtures/https-fixture.cjs');
const { createProductFixture } = require('./fixtures/product-fixture.cjs');
(async () => {
  const phase = process.argv[2];
  if (!['baseline', 'after'].includes(phase)) throw new Error('Expected baseline or after');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-stage07-profile-'));
  let certificates, fixture, beta;
  try {
    certificates = await createCertificates();
    fixture = await createProductFixture(certificates);
    beta = await createFixture({ name: 'profile-beta', certificates });
    const caPath = path.join(directory, 'ca.pem');
    await fs.writeFile(caPath, certificates.ca);
    const configPath = path.join(directory, 'config.json');
    await fs.writeFile(configPath, JSON.stringify({ phase, caPath, userDataDir: path.join(directory, 'profile'),
      alpha: { origin: fixture.origin, email: fixture.users[0].email }, beta: { origin: beta.origin } }));
    const env = { ...process.env };
    delete env.MEETSPACE_DESKTOP_DEV; delete env.MEETSPACE_DEV_CSP_NONCE; delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(__dirname, 'stage07-profile-electron.cjs'), configPath], { env, stdio: 'inherit' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Stage07 profile deadline exceeded')); }, 240_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Stage07 profile exited ${code}`)); });
    });
    if (fixture.sockets.size || fixture.streams.size || beta.sockets.size || beta.streams.size)
      throw new Error('Native transports retained after app quit');
  } finally {
    await fixture?.close(); await beta?.close(); await certificates?.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
