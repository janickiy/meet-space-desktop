const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-ssh-ui-'));
  try {
    await new Promise((resolve, reject) => {
      const env = {...process.env}; delete env.MEETSPACE_DESKTOP_DEV; delete env.MEETSPACE_DEV_CSP_NONCE;
      const child = spawn(require('electron'), [path.join(__dirname, 'electron-ssh.cjs'), directory], {stdio:'inherit', env});
      const timeout = setTimeout(() => {child.kill(); reject(new Error('SSH UI timeout'));}, 90000);
      child.once('error', e => {clearTimeout(timeout); reject(e);});
      child.once('exit', code => {clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('SSH UI failed'));});
    });
  } finally {await fs.rm(directory, {recursive:true,force:true});}
})().catch(e => {console.error(e.message);process.exitCode=1;});
