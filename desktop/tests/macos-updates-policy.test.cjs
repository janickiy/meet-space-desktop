const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { parseMacOSUpdateTrust, macOSUpdateFeedUrl, macOSUpdateArchiveUrl, validateMacOSUpdatePayload,
  canonicalizeMacOSUpdatePayload, verifyMacOSUpdateManifest } = require('../dist/platform/macos-updates-policy');
const { updateKeyId } = require('../dist/updates-policy');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ format:'pem',type:'spki' }).toString();
const now = Date.parse('2026-10-28T09:00:00Z');
const trust = parseMacOSUpdateTrust({ schemaVersion:1,enabled:true,appId:'com.janickiy.meetspace.desktop',channel:'stable',
  teamId:'AB12CD34EF',feedBaseUrl:'https://release.fixture.invalid/desktop/',manifestPublicKeys:[pem] });
function payload(change = {}) { return { schemaVersion:1,appId:trust.appId,channel:'stable',platform:'darwin',arch:'arm64',teamId:trust.teamId,
  version:'1.2.3',publishedAt:'2026-10-28T08:00:00Z',expiresAt:'2026-10-29T08:00:00Z',
  archive:{file:'MeetSpace-1.2.3-mac-arm64.zip',size:512,sha256:'a'.repeat(64)},...change }; }
function envelope(value, { key=privateKey, bytes=canonicalizeMacOSUpdatePayload(value), keyId=updateKeyId(pem) }={}) {
  return Buffer.from(JSON.stringify({schemaVersion:1,keyId,payload:bytes.toString('base64'),signature:sign(null,bytes,key).toString('base64')}));
}

test('Mac trust is separate from Windows trust and accepts only canonical reviewed HTTPS plus Team ID and public manifest keys',()=>{
  assert.equal(parseMacOSUpdateTrust({enabled:false}),null);
  assert.equal(parseMacOSUpdateTrust({schemaVersion:1,enabled:false}),null);
  for(const change of [ { enabled:false,feedBaseUrl:trust.feedBaseUrl },{teamId:'bad'}, {schemaVersion:2},
    {appId:'com.janickiy.meetspace.desktop.test'}, {channel:'beta'}, {publisherNames:['CN=Windows']},
    {feedBaseUrl:'http://release.fixture.invalid/'}, {feedBaseUrl:'https://u:p@release.fixture.invalid/'},
    {feedBaseUrl:'https://release.fixture.invalid/path?token=secret'}, {feedBaseUrl:'https://release.fixture.invalid/path'},
    {feedBaseUrl:'https://release.fixture.invalid/%2e/'}, {manifestPublicKeys:[pem,pem]},
    {manifestPublicKeys:[privateKey.export({format:'pem',type:'pkcs8'}).toString()]} ]) {
    assert.throws(()=>parseMacOSUpdateTrust({...trust,...change}),/update_configuration_invalid/);
  }
  const copy=parseMacOSUpdateTrust(trust); copy.manifestPublicKeys.push('mutated');
  assert.equal(trust.manifestPublicKeys.length,1);
});

test('Mac feed and ZIP URL stay in architecture namespace; no DMG, EXE, path or arbitrary URL payload',()=>{
  assert.equal(macOSUpdateFeedUrl(trust,'arm64'),'https://release.fixture.invalid/desktop/stable/darwin-arm64/latest.json');
  assert.equal(macOSUpdateArchiveUrl(trust,payload(),now),'https://release.fixture.invalid/desktop/stable/darwin-arm64/MeetSpace-1.2.3-mac-arm64.zip');
  assert.throws(()=>macOSUpdateFeedUrl(trust,'ia32'),/architecture/);
  for(const file of ['https://evil.invalid/app.zip','../app.zip','MeetSpace-1.2.3-mac-x64.zip','MeetSpace-1.2.3-mac-arm64.dmg','MeetSpace-1.2.3-win-arm64-setup.exe'])
    assert.throws(()=>verifyMacOSUpdateManifest(envelope(payload({archive:{...payload().archive,file}})),trust,'arm64','1.0.0','1.0.0',now),/manifest_invalid/);
});

test('real Ed25519 Mac manifest authenticates exact canonical bytes, architecture, Team ID and production identity',()=>{
  assert.deepEqual(verifyMacOSUpdateManifest(envelope(payload()),trust,'arm64','1.0.0','1.1.0',now),payload());
  for(const change of [{teamId:'ZZ99YY88XX'},{appId:'com.janickiy.meetspace.desktop.test'},{platform:'win32'},{channel:'beta'}])
    assert.throws(()=>verifyMacOSUpdateManifest(envelope(payload(change)),trust,'arm64','1.0.0','1.0.0',now),/manifest_invalid/);
  assert.throws(()=>verifyMacOSUpdateManifest(envelope(payload(),{bytes:Buffer.from(JSON.stringify(payload({extra:true})))}),trust,'arm64','1.0.0','1.0.0',now),/manifest_invalid/);
  assert.throws(()=>verifyMacOSUpdateManifest(envelope(payload()),trust,'x64','1.0.0','1.0.0',now),/architecture_invalid/);
  const pretty=Buffer.from(JSON.stringify(payload(),null,2));
  assert.throws(()=>verifyMacOSUpdateManifest(envelope(payload(),{bytes:pretty}),trust,'arm64','1.0.0','1.0.0',now),/manifest_invalid/);
});

test('Mac manifest rejects tampering, a different signing key, malformed UTF-8, oversized envelopes and noncanonical Base64',()=>{
  const env=JSON.parse(envelope(payload()).toString());
  env.payload=Buffer.from(JSON.stringify(payload({version:'9.9.9'}))).toString('base64');
  assert.throws(()=>verifyMacOSUpdateManifest(Buffer.from(JSON.stringify(env)),trust,'arm64','1.0.0','1.0.0',now),/signature_invalid/);
  const foreign=generateKeyPairSync('ed25519');
  assert.throws(()=>verifyMacOSUpdateManifest(envelope(payload(),{key:foreign.privateKey}),trust,'arm64','1.0.0','1.0.0',now),/signature_invalid/);
  const unpadded=JSON.parse(envelope(payload()).toString()); unpadded.signature=unpadded.signature.slice(0,-2);
  for(const bytes of [Buffer.from(JSON.stringify(unpadded)),Buffer.from([0xff,0xfe]),Buffer.alloc(65537)])
    assert.throws(()=>verifyMacOSUpdateManifest(bytes,trust,'arm64','1.0.0','1.0.0',now),/manifest_invalid/);
});

test('Mac policy rejects expired, future, invalid, overlong and rollback manifests, including highest previously observed version',()=>{
  for(const change of [{expiresAt:'2026-10-28T08:30:00Z'},{publishedAt:'2026-10-28T09:10:00Z'},
    {expiresAt:'2026-11-10T08:00:00Z'},{publishedAt:'invalid'},{expiresAt:'2026-02-31T00:00:00Z'}])
    assert.throws(()=>verifyMacOSUpdateManifest(envelope(payload(change)),trust,'arm64','1.0.0','1.0.0',now),/manifest_(expired|invalid)/);
  assert.throws(()=>verifyMacOSUpdateManifest(envelope(payload()),trust,'arm64','2.0.0','2.0.0',now),/rollback_denied/);
  assert.throws(()=>verifyMacOSUpdateManifest(envelope(payload()),trust,'arm64','1.0.0','1.2.4',now),/rollback_denied/);
  assert.throws(()=>verifyMacOSUpdateManifest(envelope(payload({version:'1.2.3-beta'})),trust,'arm64','1.0.0','1.0.0',now),/version_invalid/);
});

test('Mac archive integrity shape enforces SHA-256 and bounded positive byte count',()=>{
  for(const archive of [{...payload().archive,size:0},{...payload().archive,size:2**31+1},{...payload().archive,size:1.5},
    {...payload().archive,size:'512'},{...payload().archive,sha256:'A'.repeat(64)},{...payload().archive,sha256:'missing'}])
    assert.throws(()=>validateMacOSUpdatePayload(payload({archive}),trust,'arm64',now),/manifest_invalid/);
  assert.throws(()=>macOSUpdateArchiveUrl(trust,payload(),now+10*86400000),/manifest_expired/);
});
