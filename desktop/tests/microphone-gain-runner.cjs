// Actual Web Audio and RTC loopback, without opening hardware or playing sound.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const {spawn} = require('node:child_process');
const {createRequire} = require('node:module');
(async()=>{
  const root=path.resolve(__dirname,'../..');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'meetspace-mic-gain-'));
  try {
    const frontendRequire=createRequire(path.join(root,'frontend/package.json'));
    const {build}=await import(pathToFileURL(frontendRequire.resolve('vite')).href);
    await build({configFile:false,root:path.join(root,'frontend'),logLevel:'warn',define:{__DESKTOP_BUILD__:'false'},build:{outDir:temp,emptyOutDir:false,minify:false,lib:{entry:path.join(root,'frontend/src/microphoneGain.ts'),name:'MeetSpaceAudio',formats:['iife'],fileName:()=> 'gain.js'}}});
    await fs.writeFile(path.join(temp,'index.html'),'<script src="gain.js"></script>');
    await new Promise((resolve,reject)=>{
      const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
      const child=spawn(require('electron'),[path.join(__dirname,'microphone-gain-electron.cjs'),temp],{stdio:'inherit',env});
      const timer=setTimeout(()=>{child.kill();reject(Error('Audio test timed out'));},60000);
      child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Audio test failed: '+code));});
    });
  } finally {await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
