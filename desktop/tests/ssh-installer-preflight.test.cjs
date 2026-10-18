const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzePreflight, PREFLIGHT_COMMAND } = require('../dist/ssh/preflight');
const { validateEndpoint, normalizeDomain, ownCredentials, destroyCredentials } = require('../dist/ssh/types');
function probe(changes = {}) {
  return JSON.stringify({ protocol: 'MSPF2', kernel: 'Linux', arch: 'aarch64', cpu: 4, uid: 0, distro: 'ubuntu', distroVersion: '24.04', ramKiB: 8 * 1048576, diskKiB: 30 * 1048576, sudo: 'root', docker: 'missing', dockerAccess: false, compose: 'missing', existingContainers: null, existingPaths: false, tcpPorts: [22], udpPorts: [], domainIps: ['203.0.113.10'], hostIps: ['203.0.113.10'], firewall: 'unknown', complete: true, ...changes });
}
test('preflight blocks unsupported OS/resources/privileges and occupied ports, permits planned Docker installation', () => {
  const ready = analyzePreflight('meet.example.com', probe());
  assert.equal(ready.ready, true); assert.equal(ready.checks.find(x => x.id === 'docker').level, 'warn');
  for (const changes of [{ distro: 'debian' }, { distroVersion: '20.04' }, { arch: 'mips' }, { cpu: 1 }, { ramKiB: 1024 }, { diskKiB: 1024 }, { sudo: 'unavailable' }, { tcpPorts: [443] }, { udpPorts: [49160] }]) assert.equal(analyzePreflight('meet.example.com', probe(changes)).ready, false);
});
test('existing installation permits read-only signed plan classification and retains explicit warning', () => {
  const report = analyzePreflight('meet.example.com', probe({ existingPaths: true, tcpPorts: [443], udpPorts: [49160] }));
  assert.equal(report.ready, true); assert.equal(report.checks.find(x => x.id === 'existing-install').level, 'warn');
});
test('malformed, duplicate, unbounded or control-bearing probe output fails closed', () => {
  for (const output of [probe().slice(0, -1), '{}', probe({ cpu: '4' }), probe({ hostIps: ['attacker.example'] }), probe({ kernel: 'Linux\nforged' }), probe().replace('"protocol":"MSPF2"', '"protocol":"MSPF2","protocol":"MSPF2"'), 'x'.repeat(65537)]) assert.throws(() => analyzePreflight('meet.example.com', output), { code: 'INVALID_RESPONSE' });
});
test('endpoint and domain validators reject command/path injection and normalize IDN, credentials are owned and wiped', () => {
  for (const host of ['$(id)', 'host; id', 'host\nx', 'https://host', '127.0.0.999', '[fe80::1%en0]']) assert.throws(() => validateEndpoint({ host, port: 22, user: 'root' }));
  for (const domain of ['$(id).example', '1.2.3.4', 'localhost', 'https://meet.example.com', 'meet.example.com/path']) assert.throws(() => normalizeDomain(domain));
  assert.equal(normalizeDomain('Пример.рф'), 'xn--e1afmkfd.xn--p1ai');
  const owned = ownCredentials({ kind: 'password', password: 'test-secret' }); destroyCredentials(owned); assert.ok(owned.password.every(x => x === 0));
  assert.match(PREFLIGHT_COMMAND, /^LC_ALL=C \/usr\/bin\/python3 -c '/); assert.ok(PREFLIGHT_COMMAND.includes('json.load(sys.stdin)')); assert.ok(!PREFLIGHT_COMMAND.includes('shell=True'));
});


test('recovery disk allowance follows the signed runner while preserving fresh-install minimum', () => {
  const report = changes => analyzePreflight('meet.example.com', probe(changes));
  const disk = value => value.checks.find(x => x.id === 'disk').level;
  for (const existing of [{ existingPaths: true }, { existingContainers: true }]) {
    for (const gib of [2, 10, 17]) {
      const ready = report({ ...existing, diskKiB: gib * 1048576 });
      assert.equal(ready.ready, true); assert.equal(disk(ready), 'warn');
    }
    const insufficient = report({ ...existing, diskKiB: 2 * 1048576 - 1 });
    assert.equal(insufficient.ready, false); assert.equal(disk(insufficient), 'blocked');
    assert.equal(disk(report({ ...existing, diskKiB: 18 * 1048576 })), 'pass');
  }
  assert.equal(report({ diskKiB: 18 * 1048576 - 1 }).ready, false);
  assert.equal(disk(report({ diskKiB: 18 * 1048576 })), 'pass');
});

test('Compose validation accepts supported semantic majors beyond v2 and warns on malformed/legacy versions', () => {
  const level = compose => analyzePreflight('meet.example.com', probe({ compose })).checks.find(x => x.id === 'compose').level;
  for (const version of ['2.0.0', 'v2.39.4', '5.6.0', 'v5.6.0', '5.6.0-beta.1', '2.0.0+build.7']) assert.equal(level(version), 'pass');
  for (const version of ['1.29.2', 'v1.29.2', '5.6', '5.6.0 extra', 'not-a-version', 'missing']) assert.equal(level(version), 'warn');
});
