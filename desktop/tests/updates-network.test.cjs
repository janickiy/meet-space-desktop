// Actual local TLS + Ed25519 + SHA512; Windows Authenticode and process launch
// are explicitly injected seams, not a claim of Windows update acceptance.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const https=require('node:https');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createCertificates}=require('./fixtures/https-fixture.cjs');
const {updateFixture}=require('./fixtures/updates-fixture.cjs');
const {createNodeHttpsTransport}=require('../dist/network/transport.js');
const {NativeUpdates}=require('../dist/updates.js');
let certificates;before(async()=>{certificates=await createCertificates();});after(async()=>certificates?.close());
async function setup(t,overrides={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'meetspace-update-test-'));
  const f=updateFixture(),seen=[],peers=new Set(),events=[],verified=[],launched=[];
  const controls={slow:false,hold:false,redirect:false,tamper:false,badLength:false,badEncoding:false,badSignature:false,badCurrent:false,metadataInvalid:false,payload:f.payload};
  const server=https.createServer({key:certificates.key,cert:certificates.cert},(request,response)=>{
    seen.push({url:request.url,headers:{...request.headers}});
    if(controls.hold)return;
    if(controls.redirect){response.writeHead(302,{Location:'https://unrequested.invalid/evil.exe'});response.end();return;}
    if(request.url.endsWith('/latest.json')){const envelope=f.envelope(controls.payload);if(controls.metadataInvalid)envelope.signature='A'.repeat(86)+'==';response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(envelope));return;}
    const bytes=Buffer.from(f.bytes);if(controls.tamper)bytes[0]^=255;
    response.writeHead(200,{'Content-Length':bytes.length+(controls.badLength?1:0),'Content-Type':'application/octet-stream',...(controls.badEncoding?{'Content-Encoding':'gzip'}:{})});
    let offset=0;const pump=()=>{if(response.destroyed)return;if(offset===bytes.length){response.end();return;}const end=Math.min(bytes.length,offset+16384);response.write(bytes.subarray(offset,end));offset=end;setTimeout(pump,controls.slow?15:0);};pump();
  });
  server.on('connection',socket=>{peers.add(socket);socket.once('close',()=>peers.delete(socket));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));f.trust.feedBaseUrl=`https://127.0.0.1:${server.address().port}/`;
  const currentExecutable=path.join(directory,'running.exe');await fs.writeFile(currentExecutable,'test-only current executable');
  const options={trust:f.trust,packaged:true,platform:'win32',arch:'x64',osRelease:'10.0.22631',currentVersion:'0.6.0',currentExecutable,
    cacheDir:path.join(directory,'updates'),autoCheck:false,transport:createNodeHttpsTransport({ca:certificates.ca,timeoutMs:500}),emit:value=>events.push(value),
    verifySignature:async(filename,_trust,signal)=>{assert.equal(signal.aborted,false);verified.push(filename);if((filename===currentExecutable&&controls.badCurrent)||(filename!==currentExecutable&&controls.badSignature))throw new Error('update_signature_invalid');},
    launchInstaller:async filename=>{launched.push(filename);},...overrides};
  const updates=new NativeUpdates(options);t.after(async()=>{await updates.dispose();for(const peer of peers)peer.destroy();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  return{...f,controls,updates,options,seen,events,verified,launched,directory};
}
async function until(predicate){for(let n=0;n<200;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.ok(predicate(),'bounded condition reached');}

test('disabled, unsigned, unpackaged and unsupported builds never request update metadata or download files',async t=>{
  for(const overrides of [{trust:{enabled:false}},{packaged:false},{platform:'darwin'},{arch:'ia32'},{arch:'arm64',osRelease:'10.0.19045'}]){
    const c=await setup(t,overrides);assert.equal((await c.updates.initialize()).phase,'disabled');
    await c.updates.check();await c.updates.download();await c.updates.install();assert.equal(c.seen.length,0);
    assert.equal(await fs.stat(c.options.cacheDir).catch(()=>null),null);
  }
  const c=await setup(t);c.controls.badCurrent=true;assert.equal((await c.updates.initialize()).code,'update_signature_invalid');await c.updates.check();assert.equal(c.seen.length,0);
});

test('signed metadata, exact bytes and signature gate produce ready, then fresh verification before explicit launch',async t=>{
  const c=await setup(t);assert.equal((await c.updates.initialize()).phase,'idle');
  assert.equal((await c.updates.check()).phase,'available');assert.equal(c.seen.length,1);assert.equal(c.launched.length,0);
  assert.equal((await c.updates.download()).phase,'ready');assert.equal(c.launched.length,0);
  const downloaded=(await fs.readdir(c.options.cacheDir)).find(name=>name.endsWith('.exe'));assert.ok(downloaded);
  assert.deepEqual(await fs.readFile(path.join(c.options.cacheDir,downloaded)),c.bytes);
  assert.equal((await c.updates.install()).phase,'installing');assert.equal(c.launched.length,1);
  assert.ok(c.verified.filter(file=>file!==c.options.currentExecutable).length===2,'download and install both verify installer signature');
  for(const request of c.seen)for(const header of ['authorization','cookie','origin','sec-fetch-site'])assert.equal(request.headers[header],undefined);
  await c.updates.dispose();assert.ok(await fs.stat(c.launched[0]),'launched installer is not removed during quit');
  assert.equal((await c.updates.cancel()).phase,'installing');
});

test('invalid manifest, redirect, corrupt payload and unsigned installer are rejected without a launch',async t=>{
  const c=await setup(t);await c.updates.initialize();c.controls.metadataInvalid=true;
  assert.equal((await c.updates.check()).code,'update_manifest_signature_invalid');assert.equal(c.seen.filter(r=>r.url.endsWith('.exe')).length,0);
  c.controls.metadataInvalid=false;c.controls.redirect=true;assert.equal((await c.updates.check()).code,'redirect_not_allowed');
  c.controls.redirect=false;await c.updates.check();c.controls.tamper=true;
  assert.equal((await c.updates.download()).code,'update_integrity_invalid');assert.deepEqual(await fs.readdir(c.options.cacheDir),[]);
  c.controls.tamper=false;await c.updates.check();c.controls.badSignature=true;
  assert.equal((await c.updates.download()).code,'update_signature_invalid');assert.deepEqual(await fs.readdir(c.options.cacheDir),[]);assert.equal(c.launched.length,0);
  c.controls.badSignature=false;
  for(const flag of ['badLength','badEncoding']){
    await c.updates.check();c.controls[flag]=true;
    assert.equal((await c.updates.download()).code,'update_integrity_invalid');assert.deepEqual(await fs.readdir(c.options.cacheDir),[]);c.controls[flag]=false;
  }
});

test('installer tampering or changed signed feed after download cannot be installed',async t=>{
  const c=await setup(t);await c.updates.initialize();await c.updates.check();await c.updates.download();
  const installer=path.join(c.options.cacheDir,(await fs.readdir(c.options.cacheDir))[0]);await fs.writeFile(installer,Buffer.alloc(c.bytes.length));
  assert.equal((await c.updates.install()).code,'update_integrity_invalid');assert.equal(c.launched.length,0);
  await c.updates.check();await c.updates.download();c.controls.payload={...c.payload,version:'0.8.0',installer:{...c.payload.installer,file:'MeetSpace-0.8.0-win-x64-setup.exe'}};
  assert.equal((await c.updates.install()).code,'update_changed');assert.deepEqual(await fs.readdir(c.options.cacheDir),[]);assert.equal(c.launched.length,0);
});

test('concurrent checks coalesce; cancellation fences pending TLS work, stale events and partial files',async t=>{
  const c=await setup(t);await c.updates.initialize();c.controls.hold=true;
  const first=c.updates.check(),second=c.updates.check();assert.equal(first,second);await until(()=>c.seen.length===1);
  const count=c.events.length,cancelling=c.updates.cancel();
  assert.equal(c.updates.cancel(),cancelling);await assert.rejects(c.updates.check(),/update_busy/);
  await cancelling;await first;assert.equal(c.updates.state().phase,'idle');
  assert.equal(c.events.slice(count).some(event=>['available','error'].includes(event.phase)),false);
  c.controls.hold=false;await c.updates.check();c.controls.slow=true;const pending=c.updates.download();
  await until(()=>c.events.some(event=>event.phase==='downloading'&&event.percent>0));await c.updates.cancel();await pending;
  assert.deepEqual(await fs.readdir(c.options.cacheDir),[]);assert.equal(c.updates.state().phase,'idle');assert.equal(c.launched.length,0);
});

test('an expired, replayed older or different-architecture signed manifest never reaches download',async t=>{
  const c=await setup(t);await c.updates.initialize();await c.updates.check();
  c.controls.payload={...c.payload,version:'0.6.1',installer:{...c.payload.installer,file:'MeetSpace-0.6.1-win-x64-setup.exe'}};
  assert.equal((await c.updates.check()).code,'update_rollback_denied');
  c.controls.payload={...c.payload,arch:'arm64'};assert.equal((await c.updates.check()).code,'update_architecture_invalid');
  c.controls.payload={...c.payload,expiresAt:new Date(Date.now()-1000).toISOString()};assert.equal((await c.updates.check()).code,'update_manifest_expired');
  assert.equal(c.seen.some(item=>item.url.endsWith('.exe')),false);
});

test('shutdown during verification cannot resurrect state, emit updates, or launch an installer',async t=>{
  let release,entered;const held=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const c=await setup(t,{verifySignature:async()=>{entered();await held;}});const initialize=c.updates.initialize();await started;
  await c.updates.dispose();const eventCount=c.events.length;release();await initialize;
  assert.equal(c.seen.length,0);assert.equal(c.events.length,eventCount);assert.equal(c.launched.length,0);
});
