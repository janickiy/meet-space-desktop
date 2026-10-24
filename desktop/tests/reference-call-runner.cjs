// Isolated visual/control QA; intentionally separate from the broad design suite.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-reference-call-'));
  try {
    const env = { ...process.env };
    delete env.MEETSPACE_DESKTOP_DEV;
    delete env.MEETSPACE_DEV_CSP_NONCE;
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(__dirname, 'reference-call-electron.cjs'), profile], { env, stdio: 'inherit' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Call UI QA exceeded 120 seconds')); }, 120000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Call UI QA failed (${code ?? signal})`)); });
    });
  } finally {
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
