const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { MacOSUpdates } = require('../dist/platform/macos-updates');
const { publicKey } = generateKeyPairSync('ed25519');
const trust={schemaVersion:1,enabled:true,appId:'com.janickiy.meetspace.desktop',channel:'stable',teamId:'AB12CD34EF',
  feedBaseUrl:'https://release.fixture.invalid/desktop/',manifestPublicKeys:[publicKey.export({type:'spki',format:'pem'}).toString()]};
function fixture(change={}) {
 const events=[];
 const updater=new MacOSUpdates({trust:{enabled:false},packaged:true,platform:'darwin',arch:'arm64',currentVersion:'1.0.0',emit:s=>events.push(s),...change});
 return {updater,events};
}

test('Mac test builds and missing trust cannot start a downloader or enable update operations',async()=>{
 for(const disabled of [{enabled:false},{schemaVersion:1,enabled:false}]) {
  const {updater,events}=fixture({trust:disabled});
  for(const name of ['initialize','check','download','install','cancel']) {
   const state=await updater[name](); assert.equal(state.enabled,false); assert.equal(state.phase,'disabled'); assert.equal(state.code,'update_not_configured');
  }
  assert.equal(events.length,1,'reads and blocked actions do not schedule repeated work');
  const copy=updater.state(); copy.enabled=true;
  assert.equal(updater.state().enabled,false);
  await updater.dispose();
 }
});

test('even plausible configured release trust cannot enable Mac updates before signed native ZIP/feed acceptance',async()=>{
 const {updater}=fixture({trust});
 for(const name of ['initialize','check','download','install','cancel'])
  assert.deepEqual(await updater[name](),{enabled:false,phase:'disabled',currentVersion:'1.0.0',code:'update_macos_acceptance_required'});
 await updater.dispose();
});

test('Mac gate rejects wrong host, unpackaged identity, architecture, version and malformed trust without exposing configuration text',async()=>{
 const cases=[ [{platform:'win32'},'update_unsupported_platform'],[{arch:'ia32'},'update_architecture_invalid'],
  [{packaged:false},'update_untrusted_build'],[{currentVersion:'1.0.0-beta'},'update_version_invalid'],
  [{trust:{...trust,feedBaseUrl:'http://private.invalid/?secret=hidden'}},'update_configuration_invalid'] ];
 for(const [change,code] of cases) {
  const {updater,events}=fixture({trust,...change});
  assert.equal((await updater.initialize()).code,code);
  assert.equal(JSON.stringify(events).includes('secret='),false);
  assert.equal(JSON.stringify(events).includes('PRIVATE KEY'),false);
  await updater.dispose();
 }
});

test('Mac gate has no lifecycle emissions after dispose and listener errors cannot authorize installation',async()=>{
 const {updater}=fixture({trust,emit(){throw new Error('UI exception');}});
 assert.equal((await updater.initialize()).enabled,false);
 await updater.dispose(); await updater.dispose();
 for(const name of ['initialize','check','download','install','cancel']) await assert.rejects(updater[name](),/update_cancelled/);
 assert.equal(updater.state().enabled,false);
});
