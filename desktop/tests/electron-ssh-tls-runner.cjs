const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-ssh-tls-ui-'));
  try {
    const env = { ...process.env }; delete env.MEETSPACE_DESKTOP_DEV; delete env.MEETSPACE_DEV_CSP_NONCE;
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(__dirname, 'electron-ssh-tls.cjs'), directory], { stdio: 'inherit', env });
      const timeout = setTimeout(() => { child.kill(); reject(new Error('SSH TLS UI timeout')); }, 80000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('SSH TLS UI failed')); });
    });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
