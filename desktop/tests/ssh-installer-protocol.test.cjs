const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  InstallerBundle, InstallFailure, sha256, canonicalJson, jsonObject,
  parseInstallerReply, parseInstallStatus, assertTicketBinding,
  installerBundleNames, installPhases, INSTALLER_COMMAND,
} = require('../dist/ssh/protocol.js');

const directory = path.join(__dirname, '../resources/server-installer/v1');
const files = () => Object.fromEntries(installerBundleNames.map(name => [name, fs.readFileSync(path.join(directory, name))]));
const bundle = new InstallerBundle(files());
const now = 1792272000;
const options = { domain: 'meet.example.com', publicIpv4: '8.8.8.8', acmeEmail: '' };
const jobId = 'e0b0d6f0-14f6-4c58-a674-9c9665465a62';
const fingerprint = 'SHA256:' + Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '');
const signHash = value => ({ ...value, hash: sha256(canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'hash')))) });

function fixture({ sourceLock = bundle.manifest.sourcePolicy === 'github-latest-stable-v1', platform = '24.04', arch = 'arm64', installed = false, compose = false, buildx = false } = {}) {
  const manifest = JSON.parse(JSON.stringify(bundle.manifest));
  const lock = {
    repository: 'janickiy/meet-space', channel: 'release', ref: 'v1.2.3', version: 'v1.2.3',
    commit: 'a'.repeat(40), builtAt: '2026-10-18T00:00:00Z',
    sourceUrl: 'https://codeload.github.com/janickiy/meet-space/tar.gz/' + 'a'.repeat(40),
    sourceSha256: 'b'.repeat(64), sourceFiles: Object.fromEntries(Object.keys(manifest.sourceFiles).map(name => [name, 'c'.repeat(64)])),
  };
  let release = manifest;
  if (sourceLock) {
    release = { ...manifest, backendTag: lock.ref };
    for (const key of ['version', 'commit', 'builtAt', 'sourceUrl', 'sourceSha256', 'sourceFiles']) release[key] = lock[key];
    release.dockerfiles = Object.fromEntries(Object.entries(manifest.dockerfiles).map(([name, entry]) => [name, { ...entry, sha256: lock.sourceFiles[entry.path] }]));
  }
  const dockerActions = !installed ? ['install-docker'] : [...(compose ? ['install-compose'] : []), ...(buildx ? ['install-buildx'] : [])];
  if (!dockerActions.length) dockerActions.push('reuse-docker');
  return signHash({
    schema: 1, installerVersion: '1.0.0', releaseVersion: release.version, commit: release.commit,
    backendTag: release.backendTag, releaseSha256: sha256(canonicalJson(release)), runnerSha256: manifest.runnerSha256,
    options: { ...options }, platform: { os: 'ubuntu', osVersion: platform, arch, cpus: 4, memoryKiB: 8388608 },
    root: '/opt/meetspace', project: 'meetspace', docker: { installed, installCompose: compose, installBuildx: buildx },
    dockerPackages: manifest.dockerPackagesByUbuntu[platform][arch], dnsAddresses: [options.publicIpv4],
    existingJobId: null, existingPlanHash: null, issuedAt: now, expiresAt: now + 900,
    actions: [...dockerActions, 'fetch-verified-source', 'build-and-pin-images', 'generate-secrets', 'private-volumes', 'backup-and-migrate', 'acme-https-wss', 'authenticated-turn', 'readiness'],
    ports: { tcp: [80, 443, 3478, 5349, 50010], udp: ['3478', '50010', '49160-49259'] },
    warnings: ['source-build-not-hermetic', 'docker-firewall-bypass'], resourceProfile: 'standard',
    ...(sourceLock ? { sourceLock: lock, recipeSha256: sha256(canonicalJson(manifest)) } : {}),
  });
}
function ticket(plan = bundle.parsePlan(fixture(), { now })) {
  return { endpoint: { host: 'vps.example.com', port: 22, user: 'root' }, hostFingerprint: fingerprint, plan, jobId, planHash: plan.existingPlanHash ?? plan.hash };
}
function status(t = ticket()) {
  return { jobId: t.jobId, planHash: t.planHash, commit: t.plan.commit, domain: t.plan.options.domain,
    releaseVersion: t.plan.version, state: 'running', phase: 'images', completedPhases: ['docker', 'source'],
    events: [{ sequence: 1, phase: null, state: 'running', errorCode: null }, { sequence: 2, phase: 'images', state: 'running', errorCode: null }] };
}
const failure = (fn, code) => assert.throws(fn, error => error instanceof InstallFailure && error.code === code);

test('production bundle retains upstream bytes/provenance and verifies pinned RSA trust', () => {
  const provenance = JSON.parse(fs.readFileSync(path.join(directory, '../provenance.json')));
  assert.equal(provenance.commit, '9789b64ecc28fe265d4a059d36912db39ab0c2eb');
  assert.equal(provenance.modified, false);
  assert.deepEqual(fs.readdirSync(directory).sort(), [...installerBundleNames].sort());
  for (const [name, data] of Object.entries(files())) {
    assert.equal(sha256(data), provenance.files[name].sha256);
    assert.equal(data.length, provenance.files[name].bytes);
    assert.equal(data.includes(Buffer.from('PRIVATE KEY')), false);
  }
  assert.equal(InstallerBundle.fromDirectory(directory).manifest.profile, 'source-v1');
  assert.equal(Object.isFrozen(bundle.manifest), true);
  assert.equal(Object.isFrozen(bundle.manifest.sourceFiles), true);
});

test('any public bundle substitution, extra file, unsafe size or fake signing key fails closed', () => {
  for (const name of installerBundleNames) {
    const changed = files(); changed[name] = Buffer.concat([changed[name], Buffer.from('\n')]);
    failure(() => new InstallerBundle(changed), 'RELEASE_INVALID');
  }
  failure(() => new InstallerBundle({ ...files(), 'extra.py': Buffer.from('print(1)') }), 'RELEASE_INVALID');
  const missing = files(); delete missing['docker.asc']; failure(() => new InstallerBundle(missing), 'RELEASE_INVALID');
  failure(() => new InstallerBundle({ ...files(), 'runner.py': Buffer.alloc(262145) }), 'RELEASE_INVALID');
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const replaced = files(); replaced['trust-root.pem'] = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'pem' }));
  replaced['release.sig'] = crypto.sign('RSA-SHA256', replaced['release.json'], pair.privateKey);
  failure(() => new InstallerBundle(replaced), 'RELEASE_INVALID');
});

test('bootstrap uses a fixed command and data-only base64, bounds payload and owns bundle buffers', () => {
  const owned = files(), isolated = new InstallerBundle(owned); owned['runner.py'].fill(0);
  const request = { options: { domain: "x');__import__('os').system('touch /tmp/unsafe')#", publicIpv4: '8.8.8.8' } };
  const payload = isolated.payload('plan', request).toString();
  assert.equal(payload.includes(request.options.domain), false);
  const match = /base64\.b64decode\('([A-Za-z0-9+/=]+)'\)/.exec(payload); assert.ok(match);
  const decoded = JSON.parse(Buffer.from(match[1], 'base64'));
  assert.deepEqual(decoded.request, request); assert.equal(decoded.action, 'plan');
  assert.equal(sha256(Buffer.from(decoded.bundle['runner.py'], 'base64')), bundle.manifest.runnerSha256);
  assert.equal(payload.split('\n').length, 7);
  assert.equal(INSTALLER_COMMAND, 'if [ "$(id -u)" = 0 ]; then exec /usr/bin/python3 -; else exec sudo -n /usr/bin/python3 -; fi');
  for (const action of ['renew', 'worker', 'status;id']) failure(() => bundle.payload(action, {}), 'INVALID_REQUEST');
  failure(() => bundle.payload('plan', { data: 'x'.repeat(262145) }), 'INVALID_REQUEST');
});

test('strict response JSON rejects duplicates, non-UTF8, unsafe integers, trailing syntax and deep nesting', () => {
  for (const raw of ['[]', '{"ok":true,"ok":false}', '{"nested":{"a":1,"a":2}}', '{"n":9007199254740993}', '{"n":1.5}', '{"a":1,}', '{"a":[1,]}', '{} trailing', Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]), '{"a":' + '['.repeat(40) + '0' + ']'.repeat(40) + '}']) {
    failure(() => jsonObject(raw), 'INVALID_RESPONSE');
  }
  failure(() => jsonObject(' '.repeat(262145)), 'RESPONSE_LIMIT');
  assert.equal(jsonObject('{"escaped":"\\u0022","value":-3,"nested":[false,null]}').escaped, '"');
  assert.equal(canonicalJson({ z: 'Привет😀\x7f', a: [true, null, 42] }), '{"a":[true,null,42],"z":"\\u041f\\u0440\\u0438\\u0432\\u0435\\u0442\\ud83d\\ude00\\u007f"}');
});

test('MSI1 responses expose only a result object or a bounded fixed code', () => {
  assert.equal(parseInstallerReply('{"protocol":"MSI1","ok":true,"result":{"accepted":true}}').accepted, true);
  failure(() => parseInstallerReply('{"protocol":"MSI1","ok":false,"errorCode":"DNS_MISMATCH"}'), 'DNS_MISMATCH');
  for (const value of [{ protocol: 'MSI2', ok: true, result: {} }, { protocol: 'MSI1', ok: 'true', result: {} }, { protocol: 'MSI1', ok: true, result: [] }, { protocol: 'MSI1', ok: false, errorCode: 'password leaked!' }]) {
    failure(() => parseInstallerReply(JSON.stringify(value)), 'INVALID_RESPONSE');
  }
});

test('signed source plan freezes upstream selection, architecture, recipe and OS Docker package matrix', () => {
  const dynamic = bundle.manifest.sourcePolicy === 'github-latest-stable-v1';
  for (const platform of ['22.04', '24.04']) for (const arch of ['amd64', 'arm64']) {
    const parsed = bundle.parsePlan(fixture({ platform, arch }), { now, expectedOptions: options });
    assert.equal(parsed.version, dynamic ? 'v1.2.3' : bundle.manifest.version);
    assert.equal(parsed.commit, dynamic ? 'a'.repeat(40) : bundle.manifest.commit);
    assert.equal(parsed.architecture, arch); assert.equal(parsed.installDocker, true);
    assert.equal(parsed.sourceSelection, dynamic ? 'release: v1.2.3' : undefined);
    assert.equal(parsed.sourceSha256, dynamic ? 'b'.repeat(64) : bundle.manifest.sourceSha256);
  }
  const plugins = bundle.parsePlan(fixture({ installed: true, compose: true, buildx: true }), { now });
  assert.equal(plugins.installDockerPluginsOnly, true); assert.deepEqual(plugins.missingDockerPlugins, ['Compose', 'Buildx']);
  assert.equal(bundle.parsePlan(fixture({ installed: true }), { now }).installDocker, false);
  assert.equal(bundle.parsePlan(fixture({ sourceLock: false }), { now }).commit, bundle.manifest.commit);
  if (!dynamic) failure(() => bundle.parsePlan(fixture({ sourceLock: true }), { now }), 'PLAN_INVALID');
});

test('public SMTP settings are bound to the confirmed plan and never accept a password', () => {
  const smtp = {host:'smtp.example.com',port:465,from:'meetings@example.com',username:'meetings@example.com',tlsMode:'tls'};
  const value = fixture(); value.options.smtp = smtp;
  const expectedOptions = {...options,smtp};
  assert.deepEqual(bundle.parsePlan(signHash(value),{now,expectedOptions}).options.smtp,smtp);
  failure(()=>bundle.parsePlan(signHash(value),{now,expectedOptions:{...options,smtp:{...smtp,host:'other.example.com'}}}),'PLAN_INVALID');
  for (const invalid of [{...smtp,password:'forbidden'}, {...smtp,tlsMode:'none'}, {...smtp,port:0}, {...smtp,username:''}, {...smtp,from:'x\nBCC: y'}, {...smtp,host:'smtp.example.com;id'}]) {
    failure(()=>bundle.parsePlan(signHash({...value,options:{...options,smtp:invalid}}),{now}),'PLAN_INVALID');
  }
});

test('rehashing cannot hide a changed source lock, recipe, install target, Docker package pin or consent action', () => {
  const lockMutations = [
    value => { value.sourceLock.repository = 'attacker/project'; },
    value => { value.sourceLock.sourceUrl = 'https://evil.example/payload.tar.gz'; },
    value => { value.sourceLock.commit = 'b'.repeat(40); },
    value => { value.sourceLock.sourceFiles['unknown.sh'] = 'c'.repeat(64); },
    value => { value.sourceLock.version = 'v9.9.9'; },
    value => { value.sourceLock.channel = 'prerelease'; },
    value => { value.recipeSha256 = 'f'.repeat(64); },
  ];
  for (const mutate of lockMutations) {
    const changed = JSON.parse(JSON.stringify(fixture({ sourceLock: true }))); mutate(changed);
    failure(() => bundle.parsePlan(signHash(changed), { now }), 'PLAN_INVALID');
  }
  const mutations = [
    value => { value.releaseSha256 = 'f'.repeat(64); },
    value => { value.runnerSha256 = 'f'.repeat(64); },
    value => { value.root = '/etc'; },
    value => { value.project = 'other'; },
    value => { value.platform.os = 'debian'; },
    value => { value.platform.osVersion = '26.04'; },
    value => { value.dockerPackages['docker-ce'] = 'latest'; },
    value => { value.options.domain = 'x;id.example.com'; },
    value => { value.resourceProfile = 'unlimited'; },
    value => { value.actions = value.actions.filter(action => action !== 'install-docker'); },
    value => { value.expiresAt += 10000; },
    value => { value.existingJobId = '../traversal'; value.existingPlanHash = 'd'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const changed = JSON.parse(JSON.stringify(fixture())); mutate(changed);
    failure(() => bundle.parsePlan(signHash(changed), { now }), 'PLAN_INVALID');
  }
  const altered = fixture(); altered.options.domain = 'other.example.com';
  failure(() => bundle.parsePlan(altered, { now }), 'PLAN_INVALID');
  failure(() => bundle.parsePlan(signHash(altered), { now, expectedOptions: options }), 'PLAN_INVALID');
});

test('plans expire after fifteen minutes, permit bounded clock skew and explicitly allow saved recovery', () => {
  const value = fixture();
  failure(() => bundle.parsePlan(value, { now: now + 901 }), 'PLAN_EXPIRED');
  failure(() => bundle.parsePlan(value, { now: now - 31 }), 'PLAN_EXPIRED');
  assert.equal(bundle.parsePlan(value, { now: now - 30 }).hash, value.hash);
  assert.equal(bundle.parsePlan(value, { now: now + 100000, allowExpired: true }).hash, value.hash);
});

test('ticket binds retry/recovery to exact SSH endpoint, fingerprint, plan and UUID-v4', () => {
  const t = ticket(); assertTicketBinding(t, t.endpoint, t.hostFingerprint);
  failure(() => assertTicketBinding(t, { ...t.endpoint, host: 'other.example.com' }), 'TICKET_INVALID');
  failure(() => assertTicketBinding(t, t.endpoint, 'SHA256:' + 'x'.repeat(43)), 'TICKET_INVALID');
  for (const delta of [{ jobId: '../bad' }, { planHash: 'd'.repeat(64) }, { hostFingerprint: 'MD5:weak' }]) failure(() => assertTicketBinding({ ...t, ...delta }), 'TICKET_INVALID');
  const existing = fixture(); existing.existingJobId = jobId; existing.existingPlanHash = 'd'.repeat(64);
  const restored = ticket(bundle.parsePlan(signHash(existing), { now })); assertTicketBinding(restored);
  assert.equal(restored.planHash, 'd'.repeat(64));
});

test('status rejects cross-job/domain/commit replies and exposes bounded ordered safe progress', () => {
  const t = ticket(); const valid = parseInstallStatus(status(t), t);
  assert.equal(valid.phase, 'images'); assert.equal(valid.events[0].phase, 'queued'); assert.equal(valid.terminal, false);
  for (const delta of [{ jobId: crypto.randomUUID() }, { planHash: 'd'.repeat(64) }, { domain: 'other.example.com' }, { commit: 'd'.repeat(40) }, { releaseVersion: 'v9.9.9' }, { phase: 'secret token!' }, { errorCode: 'details leaked' }, { state: 'unknown' }, { state: 'completed' }, { completedPhases: ['source', 'docker'] }, { events: Array(65).fill({ sequence: 1, state: 'running' }) }, { events: [{ sequence: 2, state: 'running' }, { sequence: 1, state: 'running' }] }]) {
    failure(() => parseInstallStatus({ ...status(t), ...delta }, t), 'INVALID_RESPONSE');
  }
  const completed = parseInstallStatus({ ...status(t), state: 'completed', phase: 'readiness', completedPhases: [...installPhases] }, t);
  assert.equal(completed.terminal, true);
});
