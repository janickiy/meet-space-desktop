const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SshInstallerController } = require('../dist/ssh/controller');
const { InstallerBundle, canonicalJson, sha256, installPhases, LEGACY_INSTALLER_RELEASE_SHA256, PREVIOUS_SOURCE_INSTALLER_RELEASE_SHA256 } = require('../dist/ssh/protocol');
const { hostKeyFromBytes } = require('../dist/ssh/transport');
const { SshError } = require('../dist/ssh/types');
const bundleRoot = path.join(__dirname, '../resources/server-installer/v1');
const manifest = InstallerBundle.fromDirectory(bundleRoot).manifest;
const endpoint = { host: 'vps.example.com', port: 22, user: 'root' };
const options = { domain: 'meet.example.com', publicIpv4: '8.8.8.8', acmeEmail: '' };
const keyBytes = Buffer.concat([Buffer.from([0,0,0,11]), Buffer.from('ssh-ed25519'), Buffer.from([0,0,0,32]), Buffer.alloc(32, 1)]);
const pin = hostKeyFromBytes(keyBytes);
const credentials = { kind: 'password', password: 'only-in-memory-fixture-secret' };
function probe(changes = {}) { return JSON.stringify({ protocol: 'MSPF2', kernel: 'Linux', arch: 'aarch64', cpu: 4, uid: 0, distro: 'ubuntu', distroVersion: '24.04', ramKiB: 8*1048576, diskKiB: 30*1048576, sudo: 'root', docker: 'missing', dockerAccess: false, compose: 'missing', existingContainers: false, existingPaths: false, tcpPorts: [22], udpPorts: [], domainIps: ['8.8.8.8'], hostIps: ['8.8.8.8'], firewall: 'unknown', complete: true, ...changes }); }
function planFixture(selectedOptions = options, recipe = InstallerBundle.fromDirectory(bundleRoot).manifest) {
  const prebuilt = selectedOptions.imageMode === 'images';
  const sourceLock = { repository: 'janickiy/meet-space', channel: 'prebuilt', ref: 'v1.2.3', version: 'v1.2.3', commit: 'a'.repeat(40), builtAt: '2026-10-24T00:00:00Z', sourceUrl: 'https://codeload.github.com/janickiy/meet-space/tar.gz/' + 'a'.repeat(40), sourceSha256: 'b'.repeat(64), sourceFiles: recipe.sourceFiles };
  const manifest = prebuilt ? { ...recipe, backendTag: sourceLock.ref, ...Object.fromEntries(['version','commit','builtAt','sourceUrl','sourceSha256','sourceFiles'].map(key => [key,sourceLock[key]])) } : recipe;
  const now = Math.floor(Date.now()/1000);
  const p = { schema: 1, installerVersion: '1.0.0', releaseVersion: manifest.version, commit: manifest.commit, backendTag: manifest.backendTag, releaseSha256: sha256(canonicalJson(manifest)), runnerSha256: manifest.runnerSha256, options, platform: { os:'ubuntu', osVersion:'24.04', arch:'arm64', cpus:4, memoryKiB:8*1048576 }, root:'/opt/meetspace', project:'meetspace', docker:{installed:false}, dockerPackages:manifest.dockerPackagesByUbuntu['24.04'].arm64, dnsAddresses:[selectedOptions.publicIpv4], existingJobId:null, existingPlanHash:null, issuedAt:now, expiresAt:now+900, actions:['install-docker','fetch-verified-source','build-and-pin-images','generate-secrets','private-volumes','backup-and-migrate','acme-https-wss','authenticated-turn','readiness'], resourceProfile:'standard' };
  p.options = selectedOptions;
  if (prebuilt) {
    p.sourceLock = sourceLock; p.recipeSha256 = sha256(canonicalJson(recipe));
    p.imageLock = { repository: 'janickiy/meet-space', version: sourceLock.version, commit: sourceLock.commit, platform: 'linux/arm64', url: 'https://github.com/janickiy/meet-space/releases/download/v1.2.3/meetspace-v1.2.3-linux-arm64.tar.gz', sha256: 'd'.repeat(64), indexSha256: 'e'.repeat(64), sizeBytes: 1048576 };
    p.actions[p.actions.indexOf('build-and-pin-images')] = 'download-verify-load-images';
  }
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
      const {action,request,bundle}=JSON.parse(Buffer.from(encoded,'base64'));calls.push(action);requests.push({action,request,releaseSha256:sha256(Buffer.from(bundle['release.json'],'base64'))});owned.push(c);if(error)throw error;
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
async function trusted(f) {
  await f.controller.invoke('discover', { endpoint });
  await f.controller.invoke('acceptHostKey', { fingerprint: pin.fingerprint });
  const state = await f.controller.invoke('preflight', { domain: options.domain, credentials });
  assert.equal(state.preflight.ready, true);
}
const decodePayload = payload => JSON.parse(Buffer.from(/base64\.b64decode\('([A-Za-z0-9+/=]+)'\)/.exec(payload.toString())[1], 'base64'));
const reply = result => JSON.stringify({ protocol: 'MSI1', ok: true, result });
const remoteFailure = errorCode => JSON.stringify({ protocol: 'MSI1', ok: false, errorCode });

test('planning without an IPv4 input derives it from a fresh authenticated preflight', async t => {
  const f = await fixture(t); await trusted(f);
  const { publicIpv4, ...automatic } = options;
  const state = await f.controller.invoke('plan', { options: automatic });
  assert.equal(state.error, undefined);
  assert.equal(state.preflight.publicIpv4, publicIpv4);
  assert.deepEqual(f.requests.find(item => item.action === 'plan').request.options, options);
  assert.equal(f.calls.filter(call => call === 'probe').length, 2);
  assert.equal(state.plan.options.publicIpv4, publicIpv4);
  f.transport.probe = async () => probe({ hostIps: ['1.1.1.1'], domainIps: ['1.1.1.1'] });
  const changed = await f.controller.invoke('plan', { options: automatic });
  assert.equal(changed.error, undefined);
  assert.equal(changed.plan.options.publicIpv4, '1.1.1.1');
  assert.equal(f.requests.at(-1).request.options.publicIpv4, '1.1.1.1');
});

test('renderer IPv4 overrides and changed or ambiguous host resolution cannot reach the installer', async t => {
  for (const publicIpv4 of ['1.1.1.1', '10.0.0.1', 'bad', '', null, 8]) {
    const f = await fixture(t); await trusted(f);
    const state = await f.controller.invoke('plan', { options: { ...options, publicIpv4 } });
    assert.equal(state.error.code, 'INPUT'); assert.equal(f.calls.includes('plan'), false);
  }
  for (const hostIps of [[], ['10.0.0.1'], ['8.8.8.8', '1.1.1.1']]) {
    const f = await fixture(t); await trusted(f);
    f.transport.probe = async () => probe({ hostIps });
    const state = await f.controller.invoke('plan', { options });
    assert.equal(state.error.code, 'PREFLIGHT_REQUIRED'); assert.equal(state.preflight.ready, false);
    assert.equal(state.preflight.publicIpv4, undefined); assert.equal(state.plan, undefined);
    assert.equal(f.calls.includes('plan'), false);
  }
  const f = await fixture(t); await trusted(f);
  f.transport.probe = async () => probe({ hostIps: ['1.1.1.1'] });
  const state = await f.controller.invoke('plan', { options });
  assert.equal(state.error.code, 'INPUT'); assert.equal(f.calls.includes('plan'), false);
});

test('failed rechecks invalidate unticketed plans and cannot reuse an earlier detected address', async t => {
  for (const action of ['preflight', 'plan']) {
    const f = await fixture(t); await planned(f);
    f.transport.probe = async () => { throw new SshError('NETWORK', 'fixture'); };
    const state = await f.controller.invoke(action, action === 'preflight' ? { domain: options.domain } : { options });
    assert.equal(state.error.code, 'NETWORK'); assert.equal(state.preflight, undefined); assert.equal(state.plan, undefined);
    const calls = f.requests.length;
    const retry = await f.controller.invoke('plan', { options, credentials });
    assert.equal(retry.error.code, 'PREFLIGHT_REQUIRED'); assert.equal(f.requests.length, calls);
  }
});

function legacyExistingPlan(recipeHash = PREVIOUS_SOURCE_INSTALLER_RELEASE_SHA256) {
  const old = InstallerBundle.legacyRecovery(bundleRoot, recipeHash);
  const plan = planFixture(options, old.manifest);
  plan.existingJobId = 'e0b0d6f0-14f6-4c58-a674-9c9665465a62';
  plan.existingPlanHash = 'a'.repeat(64);
  plan.hash = sha256(canonicalJson(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'hash'))));
  return plan;
}

test('read-only plan fallback rediscovers a legacy job and binds subsequent control to its original recipe', async t => {
  const f = await fixture(t); await trusted(f);
  const original = f.transport.installer, observed = [], plan = legacyExistingPlan();
  f.transport.installer = async (...args) => {
    const message = decodePayload(args[3]);
    observed.push({ action: message.action, release: sha256(Buffer.from(message.bundle['release.json'], 'base64')) });
    assert.deepEqual(args[0], endpoint); assert.equal(args[2].fingerprint, pin.fingerprint);
    if (message.action === 'plan') return observed.length === 1 ? remoteFailure('PLAN_CHANGED') : reply(plan);
    return original(...args);
  };
  const state = await f.controller.invoke('plan', { options });
  assert.equal(state.error, undefined);
  assert.equal(state.ticket.jobId, plan.existingJobId);
  assert.equal(state.ticket.planHash, plan.existingPlanHash);
  assert.deepEqual(observed, [
    { action: 'plan', release: sha256(canonicalJson(manifest)) },
    { action: 'plan', release: PREVIOUS_SOURCE_INSTALLER_RELEASE_SHA256 },
  ]);
  const rejected = await f.controller.invoke('apply', { confirmedPlanHash: state.plan.hash, acceptAcmeTerms: true, confirmDockerInstall: true });
  assert.equal(rejected.error.code, 'PENDING_JOB');
  const resumed = await f.controller.invoke('resume', { confirmedPlanHash: plan.existingPlanHash });
  assert.equal(resumed.error, undefined);
  assert.equal(observed.at(-1).release, PREVIOUS_SOURCE_INSTALLER_RELEASE_SHA256);
  assert.equal(observed.some(item => item.action === 'apply'), false);
  const saved = JSON.parse(await fs.readFile(path.join(f.storageDir, 'ssh-install-ticket.json'), 'utf8'));
  assert.equal(saved.plan.releaseSha256, PREVIOUS_SOURCE_INSTALLER_RELEASE_SHA256);
  await f.controller.invoke('detach');
  const restored = new SshInstallerController({ storageDir: f.storageDir, bundleRoot, transport: f.transport });
  t.after(() => restored.dispose()); await restored.load();
  const checked = await restored.invoke('status', { credentials });
  assert.equal(checked.error, undefined);
  assert.equal(observed.at(-1).release, PREVIOUS_SOURCE_INSTALLER_RELEASE_SHA256);
});

test('older source job can be rediscovered after both newer recipes reject it without changing its options or hash', async t => {
  const f = await fixture(t); await trusted(f);
  const plan = legacyExistingPlan(LEGACY_INSTALLER_RELEASE_SHA256), observed = [];
  f.transport.installer = async (...args) => {
    const message = decodePayload(args[3]);
    const recipeHash = sha256(Buffer.from(message.bundle['release.json'], 'base64'));
    observed.push({ recipeHash, request: message.request });
    if (recipeHash !== LEGACY_INSTALLER_RELEASE_SHA256) return remoteFailure('PLAN_CHANGED');
    assert.equal(message.request.options.imageMode, undefined);
    return reply(plan);
  };
  const state = await f.controller.invoke('plan', { options: { ...options, imageMode: 'source' } });
  assert.equal(state.error, undefined);
  assert.equal(state.plan.imageMode, 'source');
  assert.equal(state.ticket.planHash, plan.existingPlanHash);
  assert.deepEqual(observed.map(item => item.recipeHash), [sha256(canonicalJson(manifest)), PREVIOUS_SOURCE_INSTALLER_RELEASE_SHA256, LEGACY_INSTALLER_RELEASE_SHA256]);
});

test('explicit prebuilt selection sends only public options and preserves its frozen archive across apply and recovery', async t => {
  const f = await fixture(t); await trusted(f);
  const selected = { ...options, imageMode: 'images', imageRelease: 'v1.2.3' };
  const state = await f.controller.invoke('plan', { options: selected });
  assert.equal(state.error, undefined);
  assert.equal(state.plan.imageMode, 'images');
  assert.equal(state.plan.imageArchiveSha256, 'd'.repeat(64));
  assert.equal(state.plan.imageArchiveBytes, 1048576);
  assert.deepEqual(f.requests.find(item => item.action === 'plan').request.options, selected);
  const applied = await f.controller.invoke('apply', { confirmedPlanHash: state.plan.hash, confirmDockerInstall: true, acceptAcmeTerms: true });
  assert.equal(applied.error, undefined);
  const saved = JSON.parse(await fs.readFile(path.join(f.storageDir, 'ssh-install-ticket.json'), 'utf8'));
  assert.equal(saved.plan.options.imageMode, 'images');
  assert.equal(saved.plan.imageLock.version, 'v1.2.3');
  assert.equal(saved.plan.hash, state.plan.hash);
  await f.controller.invoke('detach');
  const reloaded = new SshInstallerController({ storageDir: f.storageDir, bundleRoot, transport: f.transport });
  t.after(() => reloaded.dispose()); await reloaded.load();
  assert.equal(reloaded.state().plan.imageMode, 'images');
  assert.equal(reloaded.state().plan.imageArchiveSha256, saved.plan.imageLock.sha256);
  const resumed = await reloaded.invoke('resume', { credentials, confirmedPlanHash: saved.planHash });
  assert.equal(resumed.error, undefined);
  assert.equal(f.requests.filter(item => item.action === 'plan').length, 1);
});

test('invalid image choices fail before plan dispatch and prebuilt failure never falls back to source', async t => {
  for (const selection of [{ imageMode: 'prebuilt' }, { imageMode: null }, { imageMode: 'images', imageRelease: '../latest' }, { imageMode: 'source', imageRelease: 'latest' }, { imageRelease: 'v1.2.3' }]) {
    const f = await fixture(t); await trusted(f);
    const state = await f.controller.invoke('plan', { options: { ...options, ...selection } });
    assert.equal(state.error.code, 'INPUT'); assert.equal(f.calls.includes('plan'), false);
  }
  for (const code of ['PLAN_CHANGED', 'EXISTING_INSTALLATION', 'PREBUILT_UNAVAILABLE', 'PREBUILT_INVALID', 'PREBUILT_DOWNLOAD_FAILED']) {
    const f = await fixture(t); await trusted(f); let calls = 0;
    f.transport.installer = async () => { calls++; return remoteFailure(code); };
    const state = await f.controller.invoke('plan', { options: { ...options, imageMode: 'images', imageRelease: 'latest' } });
    assert.equal(state.error.code, code); assert.equal(calls, 1); assert.equal(state.ticket, undefined);
  }
});

test('legacy fallback rejects fresh installs and invalid or changed-option recovery plans', async t => {
  for (const mutate of [
    plan => { plan.existingJobId = null; plan.existingPlanHash = null; },
    plan => { plan.options = { ...plan.options, domain: 'other.example.com' }; },
    plan => { plan.runnerSha256 = 'f'.repeat(64); },
  ]) {
    const f = await fixture(t); await trusted(f);
    const plan = legacyExistingPlan(); mutate(plan);
    plan.hash = sha256(canonicalJson(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'hash'))));
    let calls = 0;
    f.transport.installer = async () => ++calls === 1 ? remoteFailure('EXISTING_INSTALLATION') : reply(plan);
    const state = await f.controller.invoke('plan', { options });
    assert.equal(state.error.code, 'PLAN_INVALID'); assert.equal(state.ticket, undefined); assert.equal(state.plan, undefined);
    assert.equal(calls, 2);
    assert.equal((await f.controller.invoke('apply', { confirmedPlanHash: plan.hash, acceptAcmeTerms: true, confirmDockerInstall: true })).error.code, 'CONFIRMATION');
    assert.equal(calls, 2);
  }
});

test('plan fallback never follows network, changed-host-key or other installer errors', async t => {
  for (const error of [new SshError('NETWORK', 'fixture'), new SshError('HOST_KEY_CHANGED', 'fixture'), 'PLAN_EXPIRED', 'RELEASE_INVALID']) {
    const f = await fixture(t); await trusted(f); let calls = 0;
    f.transport.installer = async () => { calls++; if (typeof error === 'string') return remoteFailure(error); throw error; };
    const state = await f.controller.invoke('plan', { options });
    assert.equal(calls, 1); assert.equal(state.ticket, undefined);
    assert.equal(state.error.code, typeof error === 'string' ? error : error.code);
    if (error.code === 'HOST_KEY_CHANGED') { assert.equal(state.identity.trusted, false); assert.equal(state.hasCredentials, false); }
  }
});

test('a changed legacy plan is still rejected after the current recipe mismatch', async t => {
  const f = await fixture(t); await trusted(f); let calls = 0;
  f.transport.installer = async () => { calls++; return remoteFailure('PLAN_CHANGED'); };
  const state = await f.controller.invoke('plan', { options });
  assert.equal(calls, 3); assert.equal(state.error.code, 'PLAN_CHANGED');
  assert.equal(state.ticket, undefined); assert.equal(state.plan, undefined);
});

test('detach stops fallback before dispatch or prevents a late legacy plan from restoring stale state', async t => {
  for (const waitOnLegacy of [false, true]) {
    const f = await fixture(t); await trusted(f);
    let calls = 0, release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    f.transport.installer = async () => {
      calls++;
      if (waitOnLegacy && calls === 1) return remoteFailure('EXISTING_INSTALLATION');
      started(); return new Promise(resolve => { release = resolve; });
    };
    const pending = f.controller.invoke('plan', { options });
    await waiting; const detached = await f.controller.invoke('detach');
    release(waitOnLegacy ? reply(legacyExistingPlan()) : remoteFailure('EXISTING_INSTALLATION'));
    const state = await pending;
    assert.equal(calls, waitOnLegacy ? 2 : 1);
    assert.equal(state.ticket, undefined); assert.equal(state.plan, undefined); assert.equal(state.hasCredentials, false);
    assert.equal(state.phase, detached.phase); assert.equal(state.busy, false);
  }
});

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

test('an existing legacy ticket survives an app update and keeps its signed bundle for status, resume and cancel', async t => {
  const f = await fixture(t); await planned(f);
  const legacy = InstallerBundle.fromDirectory(path.join(bundleRoot, '..', 'legacy', LEGACY_INSTALLER_RELEASE_SHA256));
  const plan = planFixture(options, legacy.manifest);
  // Recovery may happen long after the original fifteen-minute approval window.
  plan.issuedAt -= 86400; plan.expiresAt -= 86400;
  plan.hash = sha256(canonicalJson(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'hash'))));
  const saved = { schema: 1, endpoint, hostFingerprint: pin.fingerprint, jobId: 'e0b0d6f0-14f6-4c58-a674-9c9665465a62', planHash: plan.hash, plan };
  const filename = path.join(f.storageDir, 'ssh-install-ticket.json');
  const originalBytes = JSON.stringify(saved);
  await fs.writeFile(filename, originalBytes);
  const restored = new SshInstallerController({ storageDir: f.storageDir, bundleRoot, transport: f.transport });
  t.after(() => restored.dispose()); await restored.load();
  assert.equal(restored.state().error, undefined);
  assert.equal(restored.state().ticket.planHash, plan.hash);
  assert.equal(restored.state().hasCredentials, false);
  const checked = await restored.invoke('status', { credentials });
  assert.equal(checked.status.state, 'running');
  await restored.invoke('detach');
  const resumed = await restored.invoke('resume', { credentials, confirmedPlanHash: plan.hash });
  assert.equal(resumed.status.state, 'running');
  await restored.invoke('cancel');
  for (const entry of f.requests.filter(item => ['status', 'resume', 'cancel'].includes(item.action))) {
    assert.equal(entry.releaseSha256, LEGACY_INSTALLER_RELEASE_SHA256);
    assert.equal(entry.request.planHash, plan.hash);
  }
  assert.equal(await fs.readFile(filename, 'utf8'), originalBytes);
  await restored.invoke('forget', { confirm: true });
  await restored.invoke('discover', { endpoint });
  await restored.invoke('preflight', { domain: options.domain, credentials });
  const fresh = await restored.invoke('plan', { options });
  assert.equal(fresh.error, undefined);
  assert.equal(f.requests.at(-1).action, 'plan');
  assert.equal(f.requests.at(-1).releaseSha256, sha256(canonicalJson(manifest)));
});

test('unknown or changed saved recipes cannot trigger an installer request', async t => {
  const f = await fixture(t); await planned(f);
  const plan = planFixture(); plan.releaseSha256 = 'f'.repeat(64);
  plan.hash = sha256(canonicalJson(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'hash'))));
  await fs.writeFile(path.join(f.storageDir, 'ssh-install-ticket.json'), JSON.stringify({ schema: 1, endpoint, hostFingerprint: pin.fingerprint, jobId: 'e0b0d6f0-14f6-4c58-a674-9c9665465a62', planHash: plan.hash, plan }));
  const restored = new SshInstallerController({ storageDir: f.storageDir, bundleRoot, transport: f.transport });
  t.after(() => restored.dispose()); await restored.load();
  assert.equal(restored.state().error.code, 'STORAGE');
  assert.equal(restored.state().ticket, undefined);
  assert.equal(f.requests.some(item => ['status', 'resume', 'cancel'].includes(item.action)), false);
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
