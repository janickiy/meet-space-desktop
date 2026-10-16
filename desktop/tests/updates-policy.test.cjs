const {test}=require('node:test');
const assert=require('node:assert/strict');
const {generateKeyPairSync}=require('node:crypto');
const {parseUpdateTrust,verifyUpdateManifest,updateFeedUrl,updateInstallerUrl,compareUpdateVersions}=require('../dist/updates-policy.js');
const {validateWindowsSignature,windowsSignatureCommand,verifyWindowsSignature}=require('../dist/updates-signature.js');
const {updateFixture}=require('./fixtures/updates-fixture.cjs');
const encoded=value=>Buffer.from(JSON.stringify(value));

test('update trust defaults disabled and rejects runtime-style URLs, test identity, absent pins and wrong key types',()=>{
  const f=updateFixture();assert.equal(parseUpdateTrust({enabled:false}),null);assert.deepEqual(parseUpdateTrust(f.trust),f.trust);
  for(const change of [{enabled:false},{feedBaseUrl:'http://updates.fixture.invalid/'},{feedBaseUrl:'https://user:password@updates.fixture.invalid/'},
    {feedBaseUrl:'https://updates.fixture.invalid/?backend=arbitrary'},{feedBaseUrl:'https://updates.fixture.invalid/%2e%2e/'},
    {feedBaseUrl:'https://updates.fixture.invalid/without-slash'},{publisherNames:['MeetSpace']},{signingCertThumbprints:[]},
    {appId:'com.janickiy.meetspace.desktop.test'},{manifestPublicKeys:[generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'pem'}).toString()]},
    {manifestPublicKeys:[f.trust.manifestPublicKeys[0],f.trust.manifestPublicKeys[0]]},{environmentFeed:true}])
    assert.throws(()=>parseUpdateTrust({...f.trust,...change}),/update_configuration_invalid/);
  assert.throws(()=>parseUpdateTrust({enabled:false,feedBaseUrl:f.trust.feedBaseUrl}),/update_configuration_invalid/);
});

test('a real Ed25519 manifest binds file hash, size, arch, version and immutable HTTPS namespace',()=>{
  const f=updateFixture('https://updates.fixture.invalid/product/'),payload=verifyUpdateManifest(encoded(f.envelope()),f.trust,'x64','0.6.0');
  assert.equal(payload.version,'0.7.0');
  assert.equal(updateFeedUrl(f.trust,'x64'),'https://updates.fixture.invalid/product/stable/win-x64/latest.json');
  assert.equal(updateInstallerUrl(f.trust,payload),'https://updates.fixture.invalid/product/stable/win-x64/MeetSpace-0.7.0-win-x64-setup.exe');
  const altered=f.envelope();altered.payload=Buffer.from(JSON.stringify({...f.payload,version:'9.0.0'})).toString('base64');
  assert.throws(()=>verifyUpdateManifest(encoded(altered),f.trust,'x64','0.6.0'),/update_manifest_signature_invalid/);
  const other=generateKeyPairSync('ed25519');assert.throws(()=>verifyUpdateManifest(encoded(f.envelope(f.payload,other.privateKey)),f.trust,'x64','0.6.0'),/update_manifest_signature_invalid/);
  const unknown=f.envelope();unknown.keyId='b'.repeat(64);assert.throws(()=>verifyUpdateManifest(encoded(unknown),f.trust,'x64','0.6.0'),/update_manifest_signature_invalid/);
});

test('even correctly signed malformed, stale, rollback, cross-architecture and executable-path payloads fail closed',()=>{
  const f=updateFixture();
  const cases=[{version:'0.5.0',installer:{...f.payload.installer,file:'MeetSpace-0.5.0-win-x64-setup.exe'}},
    {version:'0.7.0-beta.1'},{arch:'arm64'},{expiresAt:new Date(Date.now()-1).toISOString()},
    {publishedAt:new Date(Date.now()+600000).toISOString()},{expiresAt:new Date(Date.now()+8*86400000).toISOString()},
    {installer:{...f.payload.installer,file:'https://evil.invalid/update.exe'}},{installer:{...f.payload.installer,file:'../update.exe'}},
    {installer:{...f.payload.installer,size:0}},{installer:{...f.payload.installer,sha512:'not-a-sha512'}}];
  for(const change of cases)assert.throws(()=>verifyUpdateManifest(encoded(f.envelope({...f.payload,...change})),f.trust,'x64','0.6.0'),/^Error: update_/);
  assert.equal(compareUpdateVersions('1.10.0','1.9.9'),1);assert.equal(compareUpdateVersions('1.0.0','1.0.0'),0);
  const extra=f.envelope();extra.url='https://evil.invalid';assert.throws(()=>verifyUpdateManifest(encoded(extra),f.trust,'x64','0.6.0'),/update_manifest_invalid/);
  assert.throws(()=>verifyUpdateManifest(Buffer.alloc(65537),f.trust,'x64','0.6.0'),/update_manifest_invalid/);
});

test('signature report requires full publisher, certificate pin, timestamp, embedded signature and exact path',()=>{
  const f=updateFixture(),filename='C:\\Program Files\\MeetSpace\\MeetSpace.exe';
  const good={path:filename,status:'Valid',signatureType:'Authenticode',subject:f.trust.publisherNames[0],thumbprint:'A'.repeat(40),timestamped:true};
  assert.equal(validateWindowsSignature(good,filename,f.trust).status,'Valid');
  for(const delta of [{status:'NotSigned'},{status:'UnknownError'},{subject:'CN=MeetSpace Test Fixture'},{thumbprint:'B'.repeat(40)},
    {timestamped:false},{signatureType:'Catalog'},{path:'C:\\other.exe'},{path:undefined},{subject:undefined}])
    assert.throws(()=>validateWindowsSignature({...good,...delta},filename,f.trust),/update_signature_invalid/);
});

test('PowerShell verifier uses a fixed encoded command, literal environment path and fails closed off Windows',async()=>{
  const filename="C:\\Users\\test\\odd';Invoke-Expression calc;'.exe",command=windowsSignatureCommand(filename,'C:\\Windows');
  assert.equal(command.executable,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  const script=Buffer.from(command.args.at(-1),'base64').toString('utf16le');
  assert.equal(script.includes(filename),false);assert.ok(script.includes('-LiteralPath $env:MEETSPACE_UPDATE_VERIFY_PATH'));
  assert.equal(command.env.MEETSPACE_UPDATE_VERIFY_PATH,filename);assert.equal(command.env.PSModulePath,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  for(const root of [undefined,'powershell.exe','\\\\server\\Windows','C:\\Windows\\..\\other'])assert.throws(()=>windowsSignatureCommand(filename,root),/update_signature_invalid/);
  if(process.platform!=='win32')await assert.rejects(verifyWindowsSignature(filename,updateFixture().trust,new AbortController().signal),/update_signature_invalid/);
});

test('signature process adapter rejects missing PowerShell, verifier failure, invalid JSON and stderr without fallback',async t=>{
  // Explicit OS/process seam exercises the production adapter contract. No
  // Windows signature is asserted or executed by this portable test.
  const childProcess=require('node:child_process'),filesystem=require('node:fs/promises');
  const platform=Object.getOwnPropertyDescriptor(process,'platform'),priorRoot=process.env.SystemRoot;
  Object.defineProperty(process,'platform',{value:'win32',configurable:true});process.env.SystemRoot='C:\\Windows';
  t.after(()=>{Object.defineProperty(process,'platform',platform);if(priorRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=priorRoot;});
  t.mock.method(filesystem,'lstat',async()=>({isFile:()=>true,isSymbolicLink:()=>false}));
  const {readWindowsSignature}=require('../dist/updates-signature.js'),f=updateFixture(),filename='C:\\Fixture\\MeetSpace.exe';
  let failure={error:Object.assign(new Error('missing verifier'),{code:'ENOENT'}),stdout:'',stderr:''},calls=0;
  t.mock.method(childProcess,'execFile',(exe,args,options,callback)=>{
    calls++;assert.equal(exe,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');assert.equal(options.shell,false);
    assert.equal(options.timeout,20000);assert.equal(options.maxBuffer,16384);assert.equal(options.env.MEETSPACE_UPDATE_VERIFY_PATH,filename);
    queueMicrotask(()=>callback(failure.error,failure.stdout,failure.stderr));return {};
  });
  for(const item of [failure,{error:new Error('timeout'),stdout:'',stderr:''},{error:null,stdout:'not JSON',stderr:''},
    {error:null,stdout:'null',stderr:''},{error:null,stdout:'{}',stderr:'verifier warning'}]){
    failure=item;await assert.rejects(readWindowsSignature(filename,f.trust,new AbortController().signal),/update_signature_invalid/);
  }
  assert.equal(calls,5,'one bounded invocation per request, never a fallback');
  failure={error:null,stdout:JSON.stringify({path:filename,status:'Valid',signatureType:'Authenticode',subject:f.trust.publisherNames[0],thumbprint:'A'.repeat(40),timestamped:true}),stderr:''};
  assert.equal((await readWindowsSignature(filename,f.trust,new AbortController().signal)).path,filename);
});
