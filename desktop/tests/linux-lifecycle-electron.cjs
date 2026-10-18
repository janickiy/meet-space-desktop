// Test-only orchestration of actual shared AuthProvider and native transport.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const desktopRequire=createRequire(path.join(config.repository,'desktop/package.json'));
const {app,BrowserWindow}=desktopRequire('electron'),WebSocket=desktopRequire('ws');
const {createCertificates,createFixture,PASSWORD}=desktopRequire('./tests/fixtures/https-fixture.cjs');
const {createNodeHttpsTransport}=desktopRequire('./dist/network/transport.js');
app.setPath('userData',config.userDataDir);app.setPath('sessionData',config.userDataDir);
const owned={};
for(const [file,name,method,key]of[['broker','MeetSpaceBroker','initialize','broker'],['native-shell','NativeShell','configureWindow','shell']]){
  const prototype=desktopRequire('./dist/'+file+'.js')[name].prototype,original=prototype[method];
  prototype[method]=function(...args){owned[key]=this;return original.apply(this,args);};
}
const {startApp}=desktopRequire('./dist/main.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let window,certificates,alpha,beta,watchdog;
const checkpoints=[],clientSockets=new Set();let socketsCreated=0,socketsClosed=0;
const report={schemaVersion:1,result:'RUNNING',phase:config.phase,requestedCycles:config.cycles,sourceTreeSha256:config.sourceTreeSha256,
  platform:process.platform,arch:process.arch,electron:process.versions.electron,chromium:process.versions.chrome,
  scope:'Existing production AuthProvider/MessageThread/usePersonalRealtime/DesktopSessionGate in isolated React harness; actual main/preload/HTTPS/WSS. Not full application UI.',
  physicalDevices:false,productionServer:false,checks:[],checkpoints};
function write(name,value){return fsp.writeFile(path.join(config.evidence,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
const bounded=(promise,label,ms=30000)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Timeout: '+label)),ms);
  Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
});
let rendererOperation=0;
const js=async code=>{const operation=++rendererOperation;try{return await bounded(window.webContents.executeJavaScript(code,true),'renderer operation '+operation);}catch(error){throw Error('Renderer operation '+operation+' failed: '+error.message);}};
async function until(predicate,label,ms=30000){const deadline=Date.now()+ms;while(Date.now()<deadline){if(await predicate())return;await delay(30);}throw Error('Timeout: '+label);}
function resources(){return {nativeSockets:clientSockets.size,socketsCreated,socketsClosed,brokerSockets:owned.broker?.sockets.size??0,
  brokerStreams:owned.broker?.streams.size??0,brokerOperations:owned.broker?.operations.size??0,windows:BrowserWindow.getAllWindows().length,
  fixtureSockets:(alpha?.sockets.size??0)+(beta?.sockets.size??0),fixtureStreams:(alpha?.streams.size??0)+(beta?.streams.size??0),epoch:owned.broker?.epoch};}
function proc(){if(process.platform!=='linux')return {status:'NOT_MEASURED',reason:'Linux proc sampler only'};
  return {status:'MEASURED',processes:app.getAppMetrics().map(item=>{try {const base='/proc/'+item.pid,status=fs.readFileSync(base+'/status','utf8');
    return {pid:item.pid,type:item.type,fd:fs.readdirSync(base+'/fd').length,threads:fs.readdirSync(base+'/task').length,
      rssKB:Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]??0),stat:fs.readFileSync(base+'/stat','utf8')};}catch{return {pid:item.pid,type:item.type,status:'EXITED_OR_DENIED'};}})};}
async function checkpoint(label,{heap=false}={}){
  await delay(150);await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');await delay(100);await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
  const point={label,at:new Date().toISOString(),rendererHeap:await window.webContents.debugger.sendCommand('Runtime.getHeapUsage'),
    dom:await window.webContents.debugger.sendCommand('Memory.getDOMCounters'),metrics:await js('window.__lifecycleQA.metrics()'),resources:resources(),proc:proc(),
    processMetrics:app.getAppMetrics().map(({pid,type,cpu,memory})=>({pid,type,cpu,memory}))};
  if(heap){const stream=fs.createWriteStream(path.join(config.evidence,label+'.heapsnapshot'),{flags:'wx'});let streamError;
    stream.on('error',error=>{streamError=error;});const receive=(_event,method,params)=>{if(method==='HeapProfiler.addHeapSnapshotChunk')stream.write(params.chunk);};
    window.webContents.debugger.on('message',receive);
    try{await window.webContents.debugger.sendCommand('HeapProfiler.takeHeapSnapshot',{reportProgress:false});}
    finally{window.webContents.debugger.removeListener('message',receive);await new Promise(resolve=>stream.end(resolve));}
    if(streamError)throw streamError;
  }
  checkpoints.push(point);await write(label+'.json',point);
  console.log(JSON.stringify({checkpoint:label,heap:point.rendererHeap.usedSize,metrics:point.metrics,resources:point.resources}));return point;
}
async function fixture(name){return createFixture({name,certificates,ui:true,handleRequest:({url,send,response})=>{
  if(url.pathname.endsWith('/messages')){send(response,200,{items:[],nextCursor:null,unreadCount:0,lastReadMessageId:null});return true;}
  if(url.pathname.endsWith('/chat/read')){send(response,200,{item:{lastReadMessageId:null,unreadCount:0}});return true;}
  if(url.pathname==='/api/v1/notifications/preferences'){send(response,200,{invitation:true,reminder:true,recording:true,summary:true});return true;}
}});}
async function login(server,index){await js(`window.__lifecycleQA.login(${JSON.stringify(server.users[index].email)},${JSON.stringify(PASSWORD)})`);
  await until(()=>js(`window.__lifecycleQA.authenticated&&window.__lifecycleQA.userId===${JSON.stringify(server.users[index].id)}`),'real AuthProvider login');}
async function openChat(server){await js('window.__lifecycleQA.toggleChat(true);void 0');
  await until(async()=>server.sockets.size===1&&(await js('window.__lifecycleQA.chatMounted&&window.__lifecycleQA.queryMetrics().activeQueryFetches===0&&!!document.querySelector("textarea")')),'shared chat and real WSS');
  assert.equal(resources().fixtureSockets,1);assert.equal(resources().nativeSockets,1);}
async function closed(){await until(()=>resources().fixtureSockets===0&&resources().nativeSockets===0&&resources().brokerSockets===0&&resources().brokerStreams===0&&resources().brokerOperations===0,'old transports fully closed');}
(async()=>{
  watchdog=setTimeout(()=>{console.error('Lifecycle overall deadline');app.exit(1);},config.phase==='identity'?1140000:config.phase==='server'?840000:540000);
  try{
    certificates=await createCertificates();alpha=await fixture('stage07-alpha');beta=await fixture('stage07-beta');
    window=await startApp({show:false,rendererRoot:config.rendererRoot,userDataDir:config.userDataDir,brokerOptions:{transport:createNodeHttpsTransport({ca:certificates.ca,timeoutMs:5000}),
      createSocket:(url,protocols,options)=>{const socket=new WebSocket(url,protocols,{...options,ca:certificates.ca,rejectUnauthorized:true});socketsCreated++;clientSockets.add(socket);socket.once('close',()=>{socketsClosed++;clientSockets.delete(socket);});return socket;}}});
    assert.ok(window);window.webContents.on('console-message',details=>{if(details.level==='error')console.error('fixture renderer:',details.message);});window.webContents.debugger.attach('1.3');
    await js(`(()=>{const s=window.__lifecycleQA={outgoing:[],timers:new Map()};
      const original={setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),setInterval:window.setInterval.bind(window),clearInterval:window.clearInterval.bind(window)};
      for(const kind of ['Timeout','Interval']){window['set'+kind]=(callback,ms,...args)=>{let id=original['set'+kind]((...values)=>{if(kind==='Timeout')s.timers.delete(id);callback(...values)},ms,...args);s.timers.set(id,{kind,ms,scheduledAt:performance.now()});return id};window['clear'+kind]=id=>{s.timers.delete(id);original['clear'+kind](id)};}
      s.metrics=()=>({timers:[...s.timers.values()],...s.queryMetrics?.()});})()`);
    await js(`new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/lifecycle.js';script.onload=resolve;script.onerror=()=>reject(Error('lifecycle bundle load'));document.body.append(script)})`);
    const servers=await js(`(async()=>{const b=window.meetspaceDesktop;await b.addServer({origin:${JSON.stringify(alpha.origin)}});return b.addServer({origin:${JSON.stringify(beta.origin)}});})()`);
    const alphaId=servers.items.find(item=>item.origin===alpha.origin).id,betaId=servers.items.find(item=>item.origin===beta.origin).id;
    await js(`window.meetspaceDesktop.selectServer(${JSON.stringify(alphaId)})`);await js('window.__lifecycleQA.bootstrap();void 0');
    await until(()=>js('window.__lifecycleQA.authMounted&&!window.__lifecycleQA.authLoading'),'shared AuthProvider initial restore');
    await login(alpha,0);await openChat(alpha);await checkpoint('warmup',{heap:true});
    if(config.phase==='identity'){
      for(let i=1;i<=config.cycles;i++){
        await login(alpha,i%2);await closed();assert.equal(await js('window.__lifecycleQA.chatMounted'),false);await openChat(alpha);
        if(i%25===0||i===config.cycles)await checkpoint('account-'+i);
      }
      report.checks.push(`${config.cycles} real AuthProvider account replacements close previous keyed chat/socket`);
      for(let i=1;i<=config.cycles;i++){
        await js('window.__lifecycleQA.logout()');await closed();assert.equal(await js('window.__lifecycleQA.userId'),null);
        await login(alpha,i%2);await openChat(alpha);if(i%25===0||i===config.cycles)await checkpoint('logout-login-'+i);
      }
      report.checks.push(`${config.cycles} real AuthProvider logout/login cycles release old native transports`);
    }else if(config.phase==='server'){
      for(let i=1;i<=config.cycles;i++){
        const server=i%2?beta:alpha,id=i%2?betaId:alphaId,oldKey=await js('window.__lifecycleQA.profileKey'),epoch=owned.broker.epoch;
        await js(`window.meetspaceDesktop.selectServer(${JSON.stringify(id)})`);
        await until(()=>js(`window.__lifecycleQA.profileKey!==${JSON.stringify(oldKey)}&&window.__lifecycleQA.authMounted&&!window.__lifecycleQA.authLoading`),'real DesktopSessionGate generation remount');
        await closed();assert.ok(owned.broker.epoch>epoch);assert.equal(await js('window.__lifecycleQA.chatMounted'),false);
        await login(server,i%2);await openChat(server);if(i%25===0||i===config.cycles)await checkpoint('server-'+i);
      }
      report.checks.push(`${config.cycles} real DesktopSessionGate server changes recreate keyed providers and close previous native connections`);
    }else if(config.phase==='reconnect'){
      const before=socketsCreated;
      for(let i=1;i<=config.cycles;i++){
        const old=[...alpha.sockets];assert.equal(old.length,1);for(const socket of old)socket.close(1012,'qa_restart');
        await until(()=>old.every(socket=>!alpha.sockets.has(socket)),'old WSS close');
        await until(()=>alpha.sockets.size===1&&clientSockets.size===1&&socketsCreated===before+i,'production retry/backoff fresh WSS');
        await until(()=>js('window.__lifecycleQA.queryMetrics().activeQueryFetches===0'),'reconnect snapshots settled');
        if(i%25===0||i===config.cycles)await checkpoint('reconnect-'+i);
      }
      report.checks.push(`${config.cycles} server-initiated WSS disruptions reconnect once through unmodified production backoff`);
    }
    await js('window.__lifecycleQA.teardown();void 0');await closed();const after=await checkpoint('teardown',{heap:true});
    assert.equal(after.metrics.queryObservers,0);assert.equal(after.metrics.activeQueryFetches,0);
    const timers=after.metrics.timers;assert.ok(timers.every(timer=>timer.kind==='Timeout'&&timer.ms===300000),'only bounded Query GC timers may remain');
    report.queryGc={pendingBeforeWait:timers.length,detachedBeforeWait:after.metrics.detachedQueries,actualWaitPerformed:false};
    if(config.gcWait&&config.phase==='identity'){
      const start=performance.now(),deadline=start+301000;
      while(performance.now()<deadline){await delay(Math.min(30000,deadline-performance.now()));console.log(JSON.stringify({queryGcWaiting:true,elapsedMs:Math.round(performance.now()-start)}));}
      const collected=await checkpoint('after-actual-query-gc',{heap:true});report.queryGc={...report.queryGc,actualWaitPerformed:true,elapsedMs:performance.now()-start,pendingAfterWait:collected.metrics.timers.length,detachedAfterWait:collected.metrics.detachedQueries};
      assert.equal(collected.metrics.timers.length,0);assert.equal(collected.metrics.detachedQueries,0);assert.equal(collected.metrics.retainedQueries,0);
      report.checks.push('Actual elapsed five-minute browser Query GC boundary releases detached queries after identity changes');
    }
    report.result='PASS';await write('result.json',report);await alpha.close();await beta.close();await certificates.close();
    clearTimeout(watchdog);app.quit();
  }catch(error){report.result='FAIL';report.error=String(error.message);await write('result.json',report).catch(()=>{});console.error(error.stack);await alpha?.close();await beta?.close();await certificates?.close();clearTimeout(watchdog);app.exit(1);}
})();
