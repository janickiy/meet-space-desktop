// Ignored diagnostic runner; exclusive evidence, shared production code, no product writes.
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {createRequire} = require('node:module');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');
const repository = path.resolve(__dirname, '../..');
const desktopRequire = createRequire(path.join(repository,'desktop/package.json'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
function run(binary,args,options,deadline) {
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,options); let expired=false, hardKill;
    const timer=setTimeout(()=>{expired=true;child.kill('SIGTERM');hardKill=setTimeout(()=>child.kill('SIGKILL'),5000);},deadline);
    child.once('error',error=>{clearTimeout(timer);clearTimeout(hardKill);reject(error);});
    child.once('exit',(code,signal)=>{clearTimeout(timer);clearTimeout(hardKill);code===0&&!expired?resolve({code,signal}):reject(Error(`Diagnostic subprocess exited ${code??signal}${expired?' after deadline':''}`));});
  });
}
(async()=>{
  const evidenceArg=process.argv[2], phase=process.argv[3];
  if(!evidenceArg||!path.isAbsolute(evidenceArg)||!['identity','server','reconnect'].includes(phase))
    throw Error('Usage: node lifecycle-runner.cjs /absolute/NEW-evidence-dir identity|server|reconnect [--cycles=100] [--skip-gc-wait] [--electron=/absolute/pinned-electron]');
  let cycles=100, gcWait=true, electronExecutable=desktopRequire('electron');
  for(const arg of process.argv.slice(4)) {
    if(arg.startsWith('--cycles=')) cycles=Number(arg.slice(9));
    else if(arg==='--skip-gc-wait') gcWait=false;
    else if(arg.startsWith('--electron=')) electronExecutable=arg.slice(11);
    else throw Error('Unknown argument');
  }
  if(!Number.isSafeInteger(cycles)||cycles<1||cycles>200) throw Error('cycles must be 1..200');
  if(!path.isAbsolute(electronExecutable)) throw Error('Electron executable must be absolute');
  if(sha256(await fs.readFile(electronExecutable))!==sha256(await fs.readFile(desktopRequire('electron')))) throw Error('Electron override differs from pinned installed runtime');
  const evidence=path.resolve(evidenceArg);
  await fs.mkdir(path.dirname(evidence),{recursive:true});
  await fs.mkdir(evidence); // Existing output is always rejected, preserving earlier evidence.
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'meetspace-linux-stage07-lifecycle-'));
  const descriptor={schemaVersion:1,phase,cycles,gcWait,collectedAt:new Date().toISOString(),repository,platform:process.platform,arch:process.arch,node:process.version};
  let sourceInputs, cleaned=false;
  try {
    ({sourceInputs}=await import(pathToFileURL(path.join(repository,'desktop/scripts/ci/source-inputs.mjs')).href));
    const before=await sourceInputs(repository);
    await fs.writeFile(path.join(evidence,'source-inputs.json'),JSON.stringify(before,null,2)+'\n',{flag:'wx'});
    descriptor.sourceTreeSha256=before.sourceTreeSha256;
    const helpers=[];
    for(const name of ['desktop/tests/linux-lifecycle-runner.cjs','desktop/tests/linux-lifecycle-electron.cjs','frontend/scripts/linux-lifecycle-renderer.tsx']) helpers.push({name,sha256:sha256(await fs.readFile(path.join(repository,name)))});
    const compiled=[];
    for(const name of ['main.js','preload.js','broker.js','native-shell.js','platform/status-notifier.js']) compiled.push({path:'desktop/dist/'+name,sha256:sha256(await fs.readFile(path.join(repository,'desktop/dist',name)))});
    await fs.writeFile(path.join(evidence,'run-inputs.json'),JSON.stringify({...descriptor,helpers,compiled},null,2)+'\n',{flag:'wx'});
    const frontendRequire=createRequire(path.join(repository,'frontend/package.json'));
    const {build}=await import(pathToFileURL(frontendRequire.resolve('vite')).href);
    const rendererRoot=path.join(temporary,'renderer'); await fs.mkdir(rendererRoot);
    await build({configFile:false,root:path.join(repository,'frontend'),logLevel:'warn',
      resolve:{alias:{'@app':path.join(repository,'frontend/src')},dedupe:['react','react-dom','react-router','@tanstack/react-query','@tanstack/query-core']},
      define:{__DESKTOP_BUILD__:'true','process.env.NODE_ENV':'"production"'},
      build:{outDir:rendererRoot,emptyOutDir:false,minify:false,target:'es2022',
        rolldownOptions:{onwarn(warning,warn){if(warning.code!=='MODULE_LEVEL_DIRECTIVE')warn(warning);}},
        lib:{entry:path.join(repository,'frontend/scripts/linux-lifecycle-renderer.tsx'),name:'LinuxStage07Lifecycle',formats:['iife'],fileName:()=> 'lifecycle.js'}}});
    await fs.writeFile(path.join(rendererRoot,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><title>MeetSpace isolated lifecycle fixture</title></head><body><div id="root"></div></body></html>');
    const userDataDir=path.join(temporary,'profile'); await fs.mkdir(userDataDir);
    const configPath=path.join(temporary,'config.json');
    await fs.writeFile(configPath,JSON.stringify({...descriptor,evidence,rendererRoot,userDataDir}));
    const env={...process.env};
    for(const key of ['MEETSPACE_DESKTOP_DEV','MEETSPACE_DEV_CSP_NONCE','ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_EXTRA_CA_CERTS'])delete env[key];
    const exit=await run(electronExecutable,[path.join(__dirname,'linux-lifecycle-electron.cjs'),configPath],{cwd:repository,env,stdio:'inherit'},(phase==='identity'?1200000:phase==='server'?900000:600000));
    const result=JSON.parse(await fs.readFile(path.join(evidence,'result.json'),'utf8'));
    if(result.result!=='PASS')throw Error('Electron result failed');
    const after=await sourceInputs(repository);
    if(after.sourceTreeSha256!==before.sourceTreeSha256)throw Error('Source changed during test');
    await fs.rm(temporary,{recursive:true,force:true}); cleaned=true;
    await fs.writeFile(path.join(evidence,'completion.json'),JSON.stringify({result:'PASS',...exit,sourceUnchanged:true,sourceTreeSha256:after.sourceTreeSha256,temporaryDataRemoved:true},null,2)+'\n',{flag:'wx'});
  } catch(error) {
    await fs.writeFile(path.join(evidence,'runner-failure.json'),JSON.stringify({result:'FAIL',error:String(error.message)},null,2)+'\n',{flag:'wx'}).catch(()=>{});throw error;
  } finally {if(!cleaned) await fs.rm(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
