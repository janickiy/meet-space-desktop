const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
(async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'meetspace-native-shell-'));
  try{
    const profile=path.join(directory,'profile'),renderer=path.join(directory,'renderer');
    await fs.mkdir(profile);await fs.mkdir(renderer);
    await fs.writeFile(path.join(renderer,'index.html'),'<!doctype html><html><head><meta charset="utf-8"></head><body>MeetSpace native window fixture</body></html>');
    const route='/meetings/11111111-2222-4333-8444-555555555555/join';
    const environment={...process.env};delete environment.MEETSPACE_DESKTOP_DEV;delete environment.MEETSPACE_DEV_CSP_NONCE;
    const run=async(phase,ready)=>{
      const config=path.join(directory,phase+'.json');await fs.writeFile(config,JSON.stringify({profile,renderer,phase,expectedRoute:route}));
      return new Promise((resolve,reject)=>{
        const child=spawn(require('electron'),[path.join(__dirname,'native-shell-electron.cjs'),config,...(phase==='secondary'?['meetspace://open'+route]:[])],{env:environment,stdio:['ignore','pipe','pipe']});
        let output='';child.stdout.on('data',data=>{const text=data.toString();output+=text;process.stdout.write(text);if(text.includes('NATIVE_SHELL_READY'))ready?.();});child.stderr.on('data',data=>{const text=data.toString();if(text.startsWith('Native shell Electron verification failed: '))process.stderr.write(text);});
        const timer=setTimeout(()=>{child.kill();reject(Error('native_shell_timeout'));},40000);
        child.once('error',error=>{clearTimeout(timer);reject(error)});
        child.once('exit',code=>{clearTimeout(timer);code===0?resolve(output):reject(Error('native_shell_process_failed'))});
      });
    };
    let primaryReady;const ready=new Promise(resolve=>{primaryReady=resolve});
    const primary=run('first',primaryReady);
    await Promise.race([ready,primary.then(()=>{throw Error('primary_exited_before_ready')})]);
    await run('secondary');await primary;await run('restart');
    console.log(JSON.stringify({result:'PASS',platform:process.platform,arch:process.arch,windowsRuntimeTested:process.platform==='win32'}));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1});
