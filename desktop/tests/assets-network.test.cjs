const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createCertificates}=require('./fixtures/https-fixture.cjs');
const {createAssetsFixture,asset,CONFERENCE,RECORDING,ATTACHMENT}=require('./fixtures/assets-fixture.cjs');
const {NativeAssets}=require('../dist/downloads.js');
const {createNodeHttpsTransport}=require('../dist/network/transport.js');
let certificates;
before(async()=>{certificates=await createCertificates();});after(async()=>certificates?.close());
async function setup(t,options={}){
  const f=await createAssetsFixture(certificates);const events=[];
  const selected=path.join(f.directory,'saved.mp4');let choice=selected;
  const assets=new NativeAssets({broker:f.broker,cacheDir:path.join(f.directory,'media'),chooseSavePath:async()=>choice,emit:event=>events.push(event),...options});
  await assets.initialize();t.after(async()=>{await assets.dispose();await f.close();});
  let index=0;return{...f,get metadataReads(){return f.metadataReads;},get contentReads(){return f.contentReads;},assets,events,selected,
    input:()=>({id:`asset-${++index}`,token:f.marker,asset}),choose:value=>choice=value};
}
async function until(predicate){for(let n=0;n<200;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(predicate(),'bounded condition reached');}

test('fresh authorized file IDs save exact bytes atomically; external storage receives no bearer, cookie, Origin or Fetch Metadata',async t=>{
  const c=await setup(t);await fs.writeFile(c.selected,'previous');
  assert.deepEqual(await c.assets.save(c.input()),{cancelled:false,saved:true});
  assert.deepEqual(await fs.readFile(c.selected),c.bytes);
  assert.equal(c.metadataReads,1);assert.equal(c.seen.length,1);
  for(const name of ['authorization','cookie','origin','sec-fetch-site'])assert.equal(c.seen[0].headers[name],undefined);
  assert.equal((await fs.readdir(c.directory)).some(name=>name.endsWith('.part')),false);
  assert.equal(c.events.at(-1).received,c.bytes.length);
  const publicResponse=await c.http('GET',`/conferences/${CONFERENCE}/recordings/${RECORDING}`,undefined,c.marker);
  assert.equal(publicResponse.body.item.files[0].uuid,asset.fileId);
  assert.equal(publicResponse.body.item.files[0].url,undefined,'renderer receives IDs, not recording capabilities');
});

test('native Save cancellation makes no storage request; invalid renderer authority is rejected before any dialog',async t=>{
  const c=await setup(t);c.choose(null);
  assert.deepEqual(await c.assets.save(c.input()),{cancelled:true,saved:false});assert.equal(c.contentReads,0);
  await assert.rejects(c.assets.save({...c.input(),destination:c.selected}),/invalid_request/);
  await assert.rejects(c.assets.save({...c.input(),asset:{...asset,url:c.origin}}),/invalid_request/);
  assert.equal(c.metadataReads,1);
});

test('signed URL expiry retries one fresh authorization; denied access, oversized files and redirects cannot overwrite destination',async t=>{
  const c=await setup(t);c.controls.expireOnce=true;
  await c.assets.save(c.input());assert.equal(c.metadataReads,2);assert.equal(c.contentReads,2);
  await fs.writeFile(c.selected,'keep');c.controls.redirect=true;
  await assert.rejects(c.assets.save(c.input()),/redirect_not_allowed/);assert.equal(await fs.readFile(c.selected,'utf8'),'keep');
  c.controls.redirect=false;c.controls.size=2*1024*1024*1024+1;
  await assert.rejects(c.assets.save(c.input()),/asset_too_large/);
  c.controls.denied=true;await assert.rejects(c.assets.save(c.input()),/asset_access_denied/);
  assert.equal(await fs.readFile(c.selected,'utf8'),'keep');
  assert.equal((await fs.readdir(c.directory)).some(name=>name.endsWith('.part')),false);
});

test('mid-transfer cancel and logout terminate disk writes and preserve the previously selected file',async t=>{
  const c=await setup(t);c.controls.slow=true;await fs.writeFile(c.selected,'keep');
  const input=c.input(),pending=c.assets.save(input);const rejected=assert.rejects(pending,/request_cancelled|stale_request/);
  await until(()=>c.events.length>0);c.assets.cancel(input.id);await rejected;
  assert.equal(await fs.readFile(c.selected,'utf8'),'keep');
  const second=c.assets.save(c.input());const logoutRejected=assert.rejects(second,/request_cancelled|stale_request|authentication_required/);
  await until(()=>c.contentReads===2);await c.http('POST','/auth/logout',{},c.marker);await logoutRejected;
  assert.equal((await fs.readdir(c.directory)).some(name=>name.endsWith('.part')),false);
});

test('group attachment content is fetched only from its exact authenticated API route, with no auth cookies',async t=>{
  const c=await setup(t);
  await c.assets.save({...c.input(),asset:{kind:'attachment',scope:'conversation',scopeId:CONFERENCE,attachmentId:ATTACHMENT,filename:'../../document.mp4'}});
  assert.deepEqual(await fs.readFile(c.selected),c.bytes);
  const content=c.api.requests.findLast(entry=>entry.path.endsWith('/content'));
  assert.match(content.headers.authorization,/^Bearer fixture-jwt-/);assert.equal(content.headers.cookie,undefined);
  assert.equal(c.seen.length,0);
});

test('opaque playback uses fresh authorizations and strict Range/HEAD streaming without writing a media cache',async t=>{
  const c=await setup(t),opened=await c.assets.open(c.input());
  assert.match(opened.url,/^app:\/\/meetspace\/native-media\/[A-Za-z0-9_-]{43}$/);
  assert.equal(c.contentReads,0,'open only reads authorized metadata');
  assert.equal(await fs.stat(path.join(c.directory,'media')).catch(()=>null),null,'no recording cache directory');
  const ranged=await c.assets.handleMedia(new Request(opened.url,{headers:{Range:'bytes=32768-65535'}}));
  assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-range'),`bytes 32768-65535/${c.bytes.length}`);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),c.bytes.subarray(32768,65536));
  const headed=await c.assets.handleMedia(new Request(opened.url,{method:'HEAD'}));assert.equal(headed.status,200);
  assert.equal(headed.headers.get('content-length'),String(c.bytes.length));assert.equal((await headed.arrayBuffer()).byteLength,0);
  assert.equal(c.metadataReads,3,'open and each request reauthorize');
  const invalid=await c.assets.handleMedia(new Request(opened.url,{headers:{Range:'bytes=0-1,3-4'}}));assert.equal(invalid.status,416);
  c.assets.close(opened.id);assert.equal((await c.assets.handleMedia(new Request(opened.url))).status,404);
});

test('revoked permission or malformed storage Range cannot expose media; logout aborts an unread backpressured stream',async t=>{
  const c=await setup(t);const first=await c.assets.open(c.input());c.controls.denied=true;
  assert.equal((await c.assets.handleMedia(new Request(first.url))).status,403);assert.equal(c.contentReads,0);
  c.controls.denied=false;const second=await c.assets.open(c.input());c.controls.wrongRange=true;
  assert.equal((await c.assets.handleMedia(new Request(second.url,{headers:{Range:'bytes=0-10'}}))).status,403);
  c.controls.wrongRange=false;c.controls.slow=true;const third=await c.assets.open(c.input());
  const response=await c.assets.handleMedia(new Request(third.url));assert.equal(response.status,200);
  await new Promise(resolve=>setTimeout(resolve,70));await c.http('POST','/auth/logout',{},c.marker);
  await assert.rejects(response.arrayBuffer());
  assert.equal((await c.assets.handleMedia(new Request(third.url))).status,404);
});

test('startup removes only legacy owned media cache names and retains unrelated files',async t=>{
  const c=await setup(t),dir=path.join(c.directory,'legacy');await fs.mkdir(dir);
  const old='meetspace-media-11111111-1111-4111-8111-111111111111.cache';
  await fs.writeFile(path.join(dir,old),'old sensitive bytes');await fs.writeFile(path.join(dir,'keep.txt'),'keep');
  const fresh=new NativeAssets({broker:c.broker,cacheDir:dir,chooseSavePath:async()=>null,emit:()=>{}});
  await fresh.initialize();assert.deepEqual(await fs.readdir(dir),['keep.txt']);await fresh.dispose();
});

test('native sink backpressure suspends network-idle timeout; explicit abort still interrupts a paused sink',async t=>{
  const c=await setup(t);const lease=await c.broker.authorizeAsset(c.input());lease.release();
  const transport=createNodeHttpsTransport({ca:certificates.ca,timeoutMs:60});
  const {signed}=require('./fixtures/assets-fixture.cjs');
  let received=0,first=true;
  await transport.request({url:signed(c.origin),method:'GET',headers:{},signal:new AbortController().signal,maxResponseBytes:1024,
    onChunk:async bytes=>{if(first){first=false;await new Promise(resolve=>setTimeout(resolve,150));}received+=bytes.length;}});
  assert.equal(received,c.bytes.length,'deliberate sink pause longer than network timeout does not truncate bytes');
  const controller=new AbortController();let entered;
  const inside=new Promise(resolve=>entered=resolve);let unblock;
  const held=new Promise(resolve=>unblock=resolve);
  const pending=transport.request({url:signed(c.origin),method:'GET',headers:{},signal:controller.signal,maxResponseBytes:1024,
    onChunk:async()=>{entered();await held;}});
  const cancelled=assert.rejects(pending,/request_cancelled/);await inside;controller.abort();await cancelled;unblock();
});

test('authoritative notification hooks recover preferences on SSE reconnect and redact native credentials',async t=>{
  const c=await createAssetsFixture(certificates,{initialPreferencesFail:true});t.after(()=>c.close());
  await until(()=>c.preferenceReads===1);await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(c.preferences.length,0,'failed preference read stays fail-closed');
  assert.equal(c.identities.at(-1).userId,c.api.users[0].id);
  c.controls.initialPreferencesFail=false;await c.broker.streamOpen({id:'observed-stream',token:c.marker});
  await until(()=>c.preferences.length===1&&c.api.streams.size===1);
  c.api.notify({event:'notification.created',accessToken:[...c.api.tokens.keys()][0],data:{type:'recording'}});
  await until(()=>c.notifications.length===1);
  for(const secret of c.api.tokens.keys())assert.equal(JSON.stringify([c.identities,c.preferences,c.notifications]).includes(secret),false);
  await c.http('POST','/auth/logout',{},c.marker);assert.equal(c.identities.at(-1),null);
});

test('development media CORS allows only the fixed local renderer; production retains same-origin protection',async t=>{
  const c=await setup(t,{development:true}),opened=await c.assets.open(c.input());
  for(const origin of ['https://evil.invalid','http://localhost:5173','http://127.0.0.1:5174','null','app://meetspace']){
    const result=await c.assets.handleMedia(new Request(opened.url,{headers:{Origin:origin,Range:'bytes=0-3'}}));
    assert.equal(result.status,403);assert.notEqual(result.headers.get('access-control-allow-origin'),origin);
  }
  assert.equal(c.contentReads,0,'foreign origins are denied before authorization or storage');
  const allowed=await c.assets.handleMedia(new Request(opened.url,{headers:{Origin:'http://127.0.0.1:5173',Range:'bytes=0-3'}}));
  assert.equal(allowed.status,206);assert.deepEqual(Buffer.from(await allowed.arrayBuffer()),c.bytes.subarray(0,4));
  assert.equal(allowed.headers.get('access-control-allow-origin'),'http://127.0.0.1:5173');
  assert.equal(allowed.headers.get('cross-origin-resource-policy'),'cross-origin');assert.equal(allowed.headers.get('vary'),'Origin');
  assert.equal(allowed.headers.get('access-control-allow-credentials'),null);
  const prod=await setup(t),production=await prod.assets.open(prod.input());
  assert.equal((await prod.assets.handleMedia(new Request(production.url,{headers:{Origin:'http://127.0.0.1:5173'}}))).status,403);
  const response=await prod.assets.handleMedia(new Request(production.url,{headers:{Origin:'app://meetspace',Range:'bytes=0-3'}}));
  assert.equal(response.status,206);await response.arrayBuffer();
  assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
});
