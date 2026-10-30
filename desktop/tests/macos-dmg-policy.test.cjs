const test = require('node:test');
const assert = require('node:assert/strict');
const hash = 'a'.repeat(64);
test('DMG CLI separates unsigned test from reviewed release and rejects ambiguous commands', async () => {
  const {parseMacDmgArguments:parse}=await import('../scripts/macos-dmg-policy.mjs');
  assert.deepEqual(parse(['arm64']),{arch:'arm64',release:false});
  assert.deepEqual(parse(['x64','--release','--config','/fixture/public-config.json']),{arch:'x64',release:true,configPath:'/fixture/public-config.json'});
  assert.equal(parse(['--help']),null);
  for(const args of [[],['all'],['universal'],['x64','--release'],['arm64','--config','/config'],['x64','--release','--config','relative'],['arm64','--publish','always']])assert.throws(()=>parse(args));
});
test('DMG identity uses immutable source/architecture/mode namespaces and rejects unsafe inputs',async()=>{
  const {macDmgArtifact:artifact}=await import('../scripts/macos-dmg-policy.mjs');
  const base={version:'0.2.1-beta',sourceTreeSha256:hash,arch:'arm64'};
  assert.deepEqual(artifact(base),{relativeDirectory:`0.2.1-beta/${hash}/arm64/test`,filename:'MeetSpace-0.2.1-beta-darwin-arm64-test.dmg',mode:'test'});
  assert.equal(artifact({...base,arch:'x64',release:true}).filename,'MeetSpace-0.2.1-beta-darwin-x64.dmg');
  for(const patch of [{version:'../1.0.0'},{version:'latest'},{version:'01.0.0'},{sourceTreeSha256:'../out'},{arch:'universal'},{release:'yes'}])assert.throws(()=>artifact({...base,...patch}));
});
test('DMG evidence cannot claim unsigned outputs are notarized or distribution ready',async()=>{
  const {assertMacDmgEvidence:verify}=await import('../scripts/macos-dmg-policy.mjs');
  const expected={arch:'arm64',version:'0.2.1-beta',sourceTreeSha256:hash,mode:'test',filename:'MeetSpace-0.2.1-beta-darwin-arm64-test.dmg'};
  const value={...expected,format:'dmg',file:expected.filename,size:2048,sha256:hash,imageVerified:true,mountedPayloadVerified:true,published:false,distributionReady:false,signing:'disabled',notarization:'not-performed'};
  assert.equal(verify(value,expected),value);
  for(const patch of [{arch:'x64'},{sourceTreeSha256:'b'.repeat(64)},{size:0},{sha256:'bad'},{mountedPayloadVerified:false},{published:true},{distributionReady:true},{notarization:'accepted-stapled'},{signing:'verified-developer-id'}])assert.throws(()=>verify({...value,...patch},expected));
  const release={...expected,mode:'release'};
  assert.throws(()=>verify({...value,mode:'release'},release));
  verify({...value,mode:'release',signing:'verified-developer-id',notarization:'accepted-stapled'},release);
});
