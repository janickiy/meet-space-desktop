const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SshInstallerController } = require('../dist/ssh/controller');
const { InstallerBundle, canonicalJson, sha256, installPhases } = require('../dist/ssh/protocol');
const { hostKeyFromBytes } = require('../dist/ssh/transport');
const { SshError } = require('../dist/ssh/types');
const bundleRoot = path.join(__dirname, '../resources/server-installer/v1');
const manifest = InstallerBundle.fromDirectory(bundleRoot).manifest;
const endpoint = { host: 'vps.example.com', port: 22, user: 'root' };
const options = { domain: 'meet.example.com', publicIpv4: '8.8.8.8', acmeEmail: '' };
const keyBytes = Buffer.concat([Buffer.from([0,0,0,11]), Buffer.from('ssh-ed25519'), Buffer.from([0,0,0,32]), Buffer.alloc(32, 1)]);
const pin = hostKeyFromBytes(keyBytes);
const credentials = { kind: 'password', password: 'only-in-memory-fixture-secret' };
function probe() { return JSON.stringify({ protocol: 'MSPF2', kernel: 'Linux', arch: 'aarch64', cpu: 4, uid: 0, distro: 'ubuntu', distroVersion: '24.04', ramKiB: 8*1048576, diskKiB: 30*1048576, sudo: 'root', docker: 'missing', dockerAccess: false, compose: 'missing', existingContainers: false, existingPaths: false, tcpPorts: [22], udpPorts: [], domainIps: ['8.8.8.8'], hostIps: ['8.8.8.8'], firewall: 'unknown', complete: true }); }
function planFixture(selectedOptions = options) {
  const now = Math.floor(Date.now()/1000);
  const p = { schema: 1, installerVersion: '1.0.0', releaseVersion: manifest.version, commit: manifest.commit, backendTag: manifest.backendTag, releaseSha256: sha256(canonicalJson(manifest)), runnerSha256: manifest.runnerSha256, options, platform: { os:'ubuntu', osVersion:'24.04', arch:'arm64', cpus:4, memoryKiB:8*1048576 }, root:'/opt/meetspace', project:'meetspace', docker:{installed:false}, dockerPackages:manifest.dockerPackagesByUbuntu['24.04'].arm64, dnsAddresses:['8.8.8.8'], existingJobId:null, existingPlanHash:null, issuedAt:now, expiresAt:now+900, actions:['install-docker','fetch-verified-source','build-and-pin-images','generate-secrets','private-volumes','backup-and-migrate','acme-https-wss','authenticated-turn','readiness'], resourceProfile:'standard' };
  p.options = selectedOptions;
  return { ...p, hash:sha256(canonicalJson(p)) };
}
async function fixture(t) {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(),'meetspace-ssh-controller-'));
  const calls=[], owned=[], plans=[], requests=[]; let statusState='running', error;
  const transport={
    async inspect(){calls.push('inspect');return pin},
    async probe(e,c,p,d,signal){calls.push('probe');owned.push(c);if(error)throw error;return probe()},
    async installer(e,c,p,payload,signal){
      const encoded=/base64\.b64decode\('([A-Za-z0-9+/=]+)'\)/.exec(payload.toString())[1];
      const {action,request}=JSON.parse(Buffer.from(encoded,'base64'));calls.push(action);requests.push({action,request});owned.push(c);if(error)throw error;
      if(action==='plan'){const result=planFixture(request.options);plans.push(result);return JSON.stringify({protocol:'MSI1',ok:true,result})}
      const plan=plans.at(-1)??planFixture();
      return JSON.stringify({protocol:'MSI1',ok:true,result:{jobId:request.jobId,planHash:request.planHash??request.confirmedPlanHash,commit:plan.commit,domain:plan.options.domain,releaseVersion:plan.releaseVersion,state:statusState,phase:statusState==='completed'?'readiness':'images',completedPhases:statusState==='completed'?[...installPhases]:['docker','source'],events:[]}})
    },dispose(){calls.push('dispose')},
  };
  const controller=new SshInstallerController({storageDir,bundleRoot,transport});await controller.load();
  t.after(async()=>{controller.dispose();await fs.rm(storageDir,{recursive:true,force:true})});
  return {controller,transport,calls,requests,owned,storageDir,setError:e=>error=e,setState:s=>statusState=s};
}
async function planned(f){
  let s=await f.controller.invoke('discover',{endpoint});assert.equal(s.identity.trusted,false);
  s=await f.controller.invoke('acceptHostKey',{fingerprint:s.identity.fingerprint});assert.equal(s.identity.trusted,true);
  s=await f.controller.invoke('preflight',{domain:options.domain,credentials});assert.equal(s.preflight.ready,true);
  s=await f.controller.invoke('plan',{options});assert.ok(s.plan,JSON.stringify(s.error));return s;
}

test('explicit pin confirmation precedes credentials; native state and disk never serialize secrets',async t=>{
  const f=await fixture(t);
  let s=await f.controller.invoke('discover',{endpoint});
  s=await f.controller.invoke('preflight',{domain:options.domain,credentials});assert.equal(s.error.code,'UNTRUSTED_HOST');assert.deepEqual(f.calls,['inspect']);
  s=await planned(f);assert.equal(s.hasCredentials,true);assert.equal(s.plan.json,undefined);assert.ok(!JSON.stringify(s).includes(credentials.password));
  for(const name of await fs.readdir(f.storageDir))assert.ok(!(await fs.readFile(path.join(f.storageDir,name),'utf8')).includes(credentials.password));
});

test('SMTP password is apply-only and never persisted in plans, recovery tickets or public state', async t => {
  const f = await fixture(t); await planned(f);
  const smtp = {host:'smtp.example.com',port:587,from:'meetings@example.com',username:'meetings@example.com',tlsMode:'starttls'};
  const plannedState = await f.controller.invoke('plan', {options:{...options,smtp}});
  assert.deepEqual(plannedState.plan.options.smtp,smtp);
  const request = {confirmedPlanHash:plannedState.plan.hash,confirmDockerInstall:true,acceptAcmeTerms:true};
  for (const smtpPassword of [undefined,'','invalid\nsecret']) {
    const rejected = await f.controller.invoke('apply', {...request,smtpPassword});
    assert.equal(rejected.error.code,'INPUT');
    assert.equal(f.calls.includes('apply'),false);
  }
  const secret = 'private-SMTP-test-password';
  const applied = await f.controller.invoke('apply', {...request,smtpPassword:secret});
  assert.equal(applied.status.state,'running');
  assert.equal(f.requests.find(item=>item.action==='apply').request.smtpPassword,secret);
  for (const entry of f.requests.filter(item=>item.action==='plan')) assert.equal(JSON.stringify(entry).includes(secret),false);
  assert.equal(JSON.stringify(applied).includes(secret),false);
  for (const name of await fs.readdir(f.storageDir)) assert.equal((await fs.readFile(path.join(f.storageDir,name),'utf8')).includes(secret),false);
});
test('discover invalidates prior unticketed plan and auth; apply requires independent explicit plan consent',async t=>{
  const f=await fixture(t), s=await planned(f);
  const rejected=await f.controller.invoke('apply',{confirmedPlanHash:s.plan.hash,acceptAcmeTerms:true});assert.equal(rejected.error.code,'CONFIRMATION');assert.ok(!f.calls.includes('apply'));
  const changed=await f.controller.invoke('discover',{endpoint:{...endpoint,host:'other.example.com'}});
  assert.equal(changed.plan,undefined);assert.equal(changed.hasCredentials,false);
  assert.ok(f.owned[0].password.every(x=>x===0));
});
test('public ticket is saved before remote apply, survives detach/reload; duplicate apply is rejected',async t=>{
  const f=await fixture(t), s=await planned(f);
  const original=f.transport.installer;
  f.transport.installer=async(...args)=>{const saved=JSON.parse(await fs.readFile(path.join(f.storageDir,'ssh-install-ticket.json'),'utf8'));assert.match(saved.jobId,/^[a-f0-9-]{36}$/);assert.ok(!JSON.stringify(saved).includes(credentials.password));return original(...args)};
  let applied=await f.controller.invoke('apply',{confirmedPlanHash:s.plan.hash,confirmDockerInstall:true,acceptAcmeTerms:true});assert.equal(applied.status.state,'running');
  const duplicate=await f.controller.invoke('apply',{confirmedPlanHash:s.plan.hash,confirmDockerInstall:true,acceptAcmeTerms:true});assert.equal(duplicate.error.code,'PENDING_JOB');assert.equal(f.calls.filter(x=>x==='apply').length,1);
  const detached=await f.controller.invoke('detach');assert.equal(detached.hasCredentials,false);assert.equal(detached.ticket.jobId,applied.ticket.jobId);
  const reloaded=new SshInstallerController({storageDir:f.storageDir,bundleRoot,transport:f.transport});await reloaded.load();t.after(()=>reloaded.dispose());
  assert.equal(reloaded.state().ticket.jobId,applied.ticket.jobId);assert.equal(reloaded.state().hasCredentials,false);assert.equal(reloaded.state().identity.trusted,true);
  const missing=await reloaded.invoke('status');assert.equal(missing.error.code,'CREDENTIALS');
  f.setState('completed');const done=await reloaded.invoke('status',{credentials});assert.equal(done.phase,'completed');assert.equal(done.hasCredentials,false);
});
test('auth failure and detach scrub owned credential buffers; changed key cannot be blindly accepted',async t=>{
  const f=await fixture(t);await planned(f);f.setError(new SshError('AUTH','SSH-сервер отклонил пароль или ключ.'));
  let s=await f.controller.invoke('preflight',{domain:options.domain});assert.equal(s.hasCredentials,false);assert.ok(f.owned.every(c=>c.password.every(x=>x===0)));
  f.setError(new SshError('HOST_KEY_CHANGED','Ключ изменился.'));
  s=await f.controller.invoke('preflight',{domain:options.domain,credentials});assert.equal(s.identity.trusted,false);
  s=await f.controller.invoke('acceptHostKey',{fingerprint:pin.fingerprint,replaceChanged:true});assert.equal(s.error.code,'HOST_KEY');
});
test('abort during pending probe cannot restore stale state after detach',async t=>{
  const f=await fixture(t);await planned(f);
  let resolve;f.transport.probe=()=>new Promise(r=>resolve=r);
  const pending=f.controller.invoke('preflight',{domain:options.domain});await Promise.resolve();
  const detached=await f.controller.invoke('detach');assert.equal(detached.hasCredentials,false);
  resolve(probe());const finished=await pending;assert.equal(finished.busy,false);assert.equal(finished.hasCredentials,false);assert.equal(finished.phase,detached.phase);
});


test('detach while persisting a recovery ticket prevents a later remote apply', async t => {
  const f=await fixture(t), s=await planned(f), vault=require('../dist/session/vault');
  const original=vault.atomicWrite;let release,started;
  const waiting=new Promise(resolve=>started=resolve);
  vault.atomicWrite=async(filename,value)=>{if(filename.endsWith('ssh-install-ticket.json')){started();await new Promise(resolve=>release=resolve)}return original(filename,value)};
  try {
    const pending=f.controller.invoke('apply',{confirmedPlanHash:s.plan.hash,confirmDockerInstall:true,acceptAcmeTerms:true});
    await waiting;await f.controller.invoke('detach');release();await pending;
    assert.equal(f.calls.includes('apply'),false);assert.equal(f.controller.state().hasCredentials,false);
    const saved=JSON.parse(await fs.readFile(path.join(f.storageDir,'ssh-install-ticket.json'),'utf8'));assert.equal(saved.planHash,s.plan.hash);
  } finally {vault.atomicWrite=original}
});
