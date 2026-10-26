const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  InstallerBundle, InstallFailure, sha256, canonicalJson, jsonObject,
  parseInstallerReply, parseInstallStatus, assertTicketBinding,
  installerBundleNames, installPhases, INSTALLER_COMMAND, LEGACY_INSTALLER_RELEASE_SHA256, PREVIOUS_SOURCE_INSTALLER_RELEASE_SHA256, PREVIOUS_PREBUILT_INSTALLER_RELEASE_SHA256, RECOVERY_INSTALLER_RELEASE_SHA256S,
} = require('../dist/ssh/protocol.js');

const directory = path.join(__dirname, '../resources/server-installer/v1');
const files = () => Object.fromEntries(installerBundleNames.map(name => [name, fs.readFileSync(path.join(directory, name))]));
const bundle = new InstallerBundle(files());
const now = 1792272000;
const options = { domain: 'meet.example.com', publicIpv4: '8.8.8.8', acmeEmail: '' };
const jobId = 'e0b0d6f0-14f6-4c58-a674-9c9665465a62';
const fingerprint = 'SHA256:' + Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '');
const signHash = value => ({ ...value, hash: sha256(canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'hash')))) });

function fixture({ sourceLock = bundle.manifest.sourcePolicy === 'github-latest-stable-v1', platform = '24.04', arch = 'arm64', installed = false, compose = false, buildx = false, selectedBundle = bundle, imageMode, imageRelease } = {}) {
  if (imageMode === 'images') sourceLock = true;
  const manifest = JSON.parse(JSON.stringify(selectedBundle.manifest));
  const lock = {
    repository: 'janickiy/meet-space', channel: imageMode === 'images' ? 'prebuilt' : 'release', ref: 'v1.2.3', version: 'v1.2.3',
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
    options: { ...options, ...(imageMode === undefined ? {} : { imageMode }), ...(imageRelease === undefined ? {} : { imageRelease }) }, platform: { os: 'ubuntu', osVersion: platform, arch, cpus: 4, memoryKiB: 8388608 },
    root: '/opt/meetspace', project: 'meetspace', docker: { installed, installCompose: compose, installBuildx: buildx },
    dockerPackages: manifest.dockerPackagesByUbuntu[platform][arch], dnsAddresses: [options.publicIpv4],
    existingJobId: null, existingPlanHash: null, issuedAt: now, expiresAt: now + 900,
    actions: [...dockerActions, 'fetch-verified-source', imageMode === 'images' ? 'download-verify-load-images' : 'build-and-pin-images', 'generate-secrets', 'private-volumes', 'backup-and-migrate', 'acme-https-wss', 'authenticated-turn', 'readiness'],
    ports: { tcp: [80, 443, 3478, 5349, 50010], udp: ['3478', '50010', '49160-49259'] },
    warnings: ['source-build-not-hermetic', 'docker-firewall-bypass'], resourceProfile: 'standard',
    ...(sourceLock ? { sourceLock: lock, recipeSha256: sha256(canonicalJson(manifest)) } : {}),
    ...(imageMode === 'images' ? { imageLock: { repository: 'janickiy/meet-space', version: lock.version, commit: lock.commit, platform: 'linux/' + arch, url: 'https://github.com/janickiy/meet-space/releases/download/' + lock.version + '/meetspace-' + lock.version + '-linux-' + arch + '.tar.gz', sha256: 'd'.repeat(64), sizeBytes: 1048576, indexSha256: 'e'.repeat(64) } } : {}),
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

test('production bundle keeps pinned RSA trust, audited Android provenance and both signed source recovery recipes', () => {
  const provenance = JSON.parse(fs.readFileSync(path.join(directory, '../provenance.json')));
  assert.equal(provenance.commit, 'bb806e0b75ec720a695347b27d5d22d98a15b9a8');
  assert.deepEqual(fs.readdirSync(directory).sort(), [...installerBundleNames].sort());
  for (const [name, data] of Object.entries(files())) {
    assert.equal(sha256(data), provenance.files[name].sha256);
    assert.equal(data.length, provenance.files[name].bytes);
    assert.equal(/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{20}/.test(data.toString()), false);
  }
  assert.equal(InstallerBundle.fromDirectory(directory).manifest.profile, 'source-v1');
  assert.equal(bundle.manifest.prebuiltPolicy, 'github-prebuilt-v1');
  assert.equal(Object.isFrozen(bundle.manifest), true);
  assert.equal(Object.isFrozen(bundle.manifest.sourceFiles), true);
  for (const hash of RECOVERY_INSTALLER_RELEASE_SHA256S) {
    const recovered = InstallerBundle.legacyRecovery(directory, hash);
    assert.equal(sha256(canonicalJson(recovered.manifest)), hash);
    assert.equal(recovered.manifest.prebuiltPolicy, hash === PREVIOUS_PREBUILT_INSTALLER_RELEASE_SHA256 ? 'github-prebuilt-v1' : undefined);
    assert.equal(recovered.manifest.tlsPolicy, undefined);
  }
});

test('certificate choice is bound to the signed recipe, plan fingerprint, expected options and declared action', () => {
  assert.equal(bundle.manifest.tlsPolicy, 'certificate-choice-v1');
  const base = fixture();
  const selected = { ...options, tlsMode: 'custom', certificateSha256: '7'.repeat(64) };
  const custom = signHash({ ...base, options: selected, actions: base.actions.map(action => action === 'acme-https-wss' ? 'custom-https-wss' : action) });
  assert.deepEqual(bundle.parsePlan(custom, { now, expectedOptions: selected }).options, selected);
  for (const changes of [{ tlsMode: null }, { tlsMode: 'other' }, { tlsMode: 'custom' }, { tlsMode: 'letsencrypt', certificateSha256: '7'.repeat(64) }, { ...selected, acmeEmail: 'user@example.com' }, { ...selected, certificateSha256: '../key' }, { ...selected, privateKey: 'not public' }]) {
    failure(() => bundle.parsePlan(signHash({ ...custom, options: { ...options, ...changes } }), { now }), 'PLAN_INVALID');
  }
  failure(() => bundle.parsePlan(custom, { now, expectedOptions: { ...selected, certificateSha256: '8'.repeat(64) } }), 'PLAN_INVALID');
  failure(() => bundle.parsePlan(custom, { now, expectedOptions: options }), 'PLAN_INVALID');
  failure(() => bundle.parsePlan(signHash({ ...custom, actions: base.actions }), { now }), 'PLAN_INVALID');
  const old = InstallerBundle.legacyRecovery(directory, PREVIOUS_PREBUILT_INSTALLER_RELEASE_SHA256);
  const oldPlan = fixture({ selectedBundle: old });
  failure(() => old.parsePlan(signHash({ ...oldPlan, options: selected, actions: custom.actions }), { now }), 'PLAN_INVALID');
});

test('previous prebuilt saved plans retain their exact original signed recipe and hash', () => {
  const old = InstallerBundle.legacyRecovery(directory, PREVIOUS_PREBUILT_INSTALLER_RELEASE_SHA256);
  const plan = fixture({ selectedBundle: old, imageMode: 'images', imageRelease: 'v1.2.3' });
  const before = canonicalJson(plan);
  const selected = InstallerBundle.forSavedPlan(directory, plan);
  assert.equal(sha256(canonicalJson(selected.manifest)), PREVIOUS_PREBUILT_INSTALLER_RELEASE_SHA256);
  assert.equal(selected.parsePlan(plan, { now }).hash, plan.hash);
  assert.equal(canonicalJson(plan), before);
});

test('saved recovery selects the exact signed legacy recipe without rewriting the plan', () => {
  const legacy = InstallerBundle.fromDirectory(path.join(directory, '..', 'legacy', LEGACY_INSTALLER_RELEASE_SHA256));
  const originalPlan = fixture({ selectedBundle: legacy });
  const originalBytes = canonicalJson(originalPlan);
  failure(() => bundle.parsePlan(originalPlan, { allowExpired: true }), 'PLAN_INVALID');
  const selected = InstallerBundle.forSavedPlan(directory, originalPlan);
  assert.equal(sha256(canonicalJson(selected.manifest)), LEGACY_INSTALLER_RELEASE_SHA256);
  assert.equal(selected.parsePlan(originalPlan, { allowExpired: true }).hash, originalPlan.hash);
  assert.equal(canonicalJson(originalPlan), originalBytes);
  assert.deepEqual(InstallerBundle.forSavedPlan(directory, fixture()).manifest, bundle.manifest);
  for (const releaseSha256 of ['../v1', 'f'.repeat(64), undefined]) {
    failure(() => InstallerBundle.forSavedPlan(directory, signHash({ ...originalPlan, releaseSha256: releaseSha256 ?? null })), 'PLAN_INVALID');
  }
  failure(() => InstallerBundle.forSavedPlan(directory, { ...originalPlan, options: { ...options, domain: 'changed.example.com' } }), 'PLAN_INVALID');
});

test('missing, corrupted or substituted recovery bundles fail closed', t => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'meetspace-recovery-bundles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = path.join(root, 'v1'), legacyPath = path.join(root, 'legacy', LEGACY_INSTALLER_RELEASE_SHA256);
  fs.cpSync(directory, current, { recursive: true });
  const sourceLegacy = path.join(directory, '..', 'legacy', LEGACY_INSTALLER_RELEASE_SHA256);
  const plan = fixture({ selectedBundle: InstallerBundle.fromDirectory(sourceLegacy) });
  failure(() => InstallerBundle.forSavedPlan(current, plan), 'RELEASE_INVALID');
  fs.cpSync(directory, legacyPath, { recursive: true });
  failure(() => InstallerBundle.forSavedPlan(current, plan), 'RELEASE_INVALID');
  fs.cpSync(sourceLegacy, legacyPath, { recursive: true });
  fs.appendFileSync(path.join(legacyPath, 'runner.py'), '\n');
  failure(() => InstallerBundle.forSavedPlan(current, plan), 'RELEASE_INVALID');
  fs.cpSync(sourceLegacy, legacyPath, { recursive: true });
  fs.appendFileSync(path.join(current, 'release.json'), '\n');
  failure(() => InstallerBundle.forSavedPlan(current, plan), 'RELEASE_INVALID');
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

test('prebuilt plans bind release archive, source commit, architecture and consent action for both host architectures', () => {
  for (const arch of ['amd64', 'arm64']) for (const imageRelease of [undefined, 'latest', 'v1.2.3']) {
    const plan = fixture({ arch, imageMode: 'images', imageRelease, installed: true });
    const parsed = bundle.parsePlan(plan, { now, expectedOptions: { ...options, imageMode: 'images', ...(imageRelease ? { imageRelease } : {}) } });
    assert.equal(parsed.imageMode, 'images');
    assert.equal(parsed.sourceSelection, 'prebuilt: v1.2.3');
    assert.equal(parsed.commit, plan.imageLock.commit);
    assert.equal(parsed.imageArchiveSha256, plan.imageLock.sha256);
    assert.equal(parsed.imageArchiveBytes, plan.imageLock.sizeBytes);
    assert.ok(parsed.actions.includes('download-verify-load-images'));
    assert.ok(!parsed.actions.includes('build-and-pin-images'));
    assert.equal(parsed.installDocker, false);
    assert.equal(parsed.json, canonicalJson(plan));
    assert.equal(InstallerBundle.forSavedPlan(directory, plan).parsePlan(plan, { allowExpired: true }).hash, plan.hash);
  }
});

test('rehashing cannot switch prebuilt mode, release, digest bindings, architecture or allow unbounded archive metadata', () => {
  const mutations = [
    p => { p.options.imageMode = 'source'; },
    p => { p.options.imageMode = 'prebuilt'; },
    p => { delete p.options.imageMode; },
    p => { p.options.imageRelease = 'v9.0.0'; },
    p => { p.options.imageRelease = '../latest'; },
    p => { p.options.imageRelease = null; },
    p => { delete p.imageLock; },
    p => { p.imageLock.extra = 'untrusted'; },
    p => { p.imageLock.repository = 'attacker/project'; },
    p => { p.imageLock.version = 'latest'; },
    p => { p.imageLock.commit = 'f'.repeat(40); },
    p => { p.imageLock.platform = 'linux/amd64'; },
    p => { p.imageLock.url = p.imageLock.url.replace('github.com', 'attacker.invalid'); },
    p => { p.imageLock.sha256 = 'not-a-digest'; },
    p => { p.imageLock.indexSha256 = 'not-a-digest'; },
    p => { p.imageLock.sizeBytes = 0; },
    p => { p.imageLock.sizeBytes = 2 * 1024 ** 3 + 1; },
    p => { p.imageLock.sizeBytes = '1048576'; },
    p => { p.sourceLock.channel = 'release'; },
    p => { delete p.sourceLock; },
    p => { p.recipeSha256 = 'f'.repeat(64); },
    p => { p.actions[p.actions.indexOf('download-verify-load-images')] = 'build-and-pin-images'; },
    p => { p.docker.installBuildx = true; },
  ];
  for (const mutate of mutations) {
    const changed = fixture({ imageMode: 'images' }); mutate(changed);
    failure(() => bundle.parsePlan(signHash(changed), { now }), 'PLAN_INVALID');
  }
  failure(() => bundle.parsePlan(fixture({ imageMode: 'images' }), { now, expectedOptions: options }), 'PLAN_INVALID');
  failure(() => bundle.parsePlan(fixture(), { now, expectedOptions: { ...options, imageMode: 'images' } }), 'PLAN_INVALID');
});

test('source defaults and both shipped source recipes stay recoverable without adding fields or changing their hash', () => {
  for (const selectedBundle of [bundle, ...RECOVERY_INSTALLER_RELEASE_SHA256S.map(hash => InstallerBundle.legacyRecovery(directory, hash))]) {
    const value = fixture({ selectedBundle, sourceLock: false });
    const before = canonicalJson(value);
    const recovered = InstallerBundle.forSavedPlan(directory, value).parsePlan(value, { now, expectedOptions: { ...options, imageMode: 'source' } });
    assert.equal(recovered.imageMode, 'source');
    assert.equal(recovered.options.imageMode, undefined);
    assert.equal(recovered.imageArchiveSha256, undefined);
    assert.equal(recovered.json, before);
    assert.equal(recovered.hash, value.hash);
    assert.equal(canonicalJson(value), before);
  }
  const sourceWithArchive = fixture(); sourceWithArchive.imageLock = fixture({ imageMode: 'images' }).imageLock;
  failure(() => bundle.parsePlan(signHash(sourceWithArchive), { now }), 'PLAN_INVALID');
  failure(() => bundle.parsePlan(fixture({ imageMode: 'source', imageRelease: 'latest' }), { now }), 'PLAN_INVALID');
  const legacy = InstallerBundle.legacyRecovery(directory, PREVIOUS_SOURCE_INSTALLER_RELEASE_SHA256);
  failure(() => legacy.parsePlan(fixture({ selectedBundle: legacy, imageMode: 'images' }), { now }), 'PLAN_INVALID');
  failure(() => InstallerBundle.legacyRecovery(directory, '../v1'), 'RELEASE_INVALID');
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
