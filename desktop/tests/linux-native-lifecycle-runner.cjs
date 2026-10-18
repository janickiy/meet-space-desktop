// Existing 100-cycle native harness, isolated output + Linux SNI disposal profile.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),Module=require('node:module');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const evidence=process.argv[2];
if(!global.gc)throw Error('Use node --expose-gc');
if(!evidence||!path.isAbsolute(evidence))throw Error('absolute NEW evidence path required');
const pause=()=>new Promise(resolve=>setImmediate(resolve));
async function collect(){for(let i=0;i<3;i++){await pause();global.gc();}}
(async()=>{
  await fsp.mkdir(path.dirname(evidence),{recursive:true});await fsp.mkdir(evidence);
  const original=path.join(root,'desktop/tests/native-lifecycle.cjs');
  let source=await fsp.readFile(original,'utf8');
  const marker='const filename = path.join(root, "desktop/artifacts/stage07-native-lifecycle.json");';
  if(source.split(marker).length!==2)throw Error('Original native harness drift');
  source=source.replace(marker,'const filename = '+JSON.stringify(path.join(evidence,'native-services.json'))+';');
  const wrapper=path.join(evidence,'native-observer.cjs');
  await fsp.writeFile(wrapper,'const Module=require("node:module"),path=require("node:path");const original='+JSON.stringify(original)+';const loaded=new Module(original,module);loaded.filename=original;loaded.paths=Module._nodeModulePaths(path.dirname(original));loaded._compile('+JSON.stringify(source)+',original);\n',{flag:'wx'});
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--expose-gc',wrapper],{cwd:root,stdio:'inherit'});let hard,expired=false;
    const deadline=setTimeout(()=>{expired=true;child.kill('SIGTERM');hard=setTimeout(()=>child.kill('SIGKILL'),3000);},120000);
    child.once('error',error=>{clearTimeout(deadline);clearTimeout(hard);reject(error);});
    child.once('exit',code=>{clearTimeout(deadline);clearTimeout(hard);code===0&&!expired?resolve():reject(Error('Native child exit '+code));});});
  const base=JSON.parse(await fsp.readFile(path.join(evidence,'native-services.json'),'utf8'));assert.equal(base.result,'PASS');
  const {LinuxStatusNotifierMonitor}=require(path.join(root,'desktop/dist/platform/status-notifier.js'));
  const refs=[];let callbacks=0,queries=0,aborted=0;
  async function cycle(index){
    let release;const pending=new Promise(resolve=>{release=resolve;});
    const monitor=new LinuxStatusNotifierMonitor({pid:123,intervalMs:5,deadlineMs:50,query:async(_args,signal)=>{queries++;signal.addEventListener('abort',()=>{aborted++;},{once:true});return pending;}});
    refs.push(new WeakRef(monitor));monitor.start(()=>{callbacks++;});monitor.dispose();monitor.dispose();
    release({type:'s',data:[':1.20']});await pause();await pause();
    assert.equal(monitor.available(),false);assert.equal(monitor.timer,null);assert.equal(monitor.inFlight,null);
  }
  for(let i=0;i<110;i++)await cycle(i);
  await collect();assert.equal(callbacks,0);assert.equal(aborted,110);assert.equal(refs.filter(ref=>ref.deref()).length,0);
  const linux={result:'PASS',scope:'Production LinuxStatusNotifierMonitor with deliberately delayed synthetic D-Bus adapter; no real panel or Linux GUI',warmup:10,measuredCycles:100,queries,aborted,lateCallbacks:callbacks,retainedMonitorsAfterGc:0};
  await fsp.writeFile(path.join(evidence,'linux-sni-lifecycle.json'),JSON.stringify(linux,null,2)+'\n',{flag:'wx'});
  await fsp.writeFile(path.join(evidence,'result.json'),JSON.stringify({result:'PASS',nativeServices:base.result,linuxStatusNotifier:linux,platform:process.platform,arch:process.arch},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(linux));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
