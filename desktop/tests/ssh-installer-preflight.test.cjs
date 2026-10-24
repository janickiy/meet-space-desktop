const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzePreflight, PREFLIGHT_COMMAND } = require('../dist/ssh/preflight');
const { validateEndpoint, normalizeDomain, ownCredentials, destroyCredentials } = require('../dist/ssh/types');
function probe(changes = {}) {
  return JSON.stringify({ protocol: 'MSPF2', kernel: 'Linux', arch: 'aarch64', cpu: 4, uid: 0, distro: 'ubuntu', distroVersion: '24.04', ramKiB: 8 * 1048576, diskKiB: 30 * 1048576, sudo: 'root', docker: 'missing', dockerAccess: false, compose: 'missing', existingContainers: null, existingPaths: false, tcpPorts: [22], udpPorts: [], domainIps: ['8.8.8.8'], hostIps: ['8.8.8.8'], firewall: 'unknown', complete: true, ...changes });
}
test('preflight blocks unsupported OS/resources/privileges and occupied ports, permits planned Docker installation', () => {
  const ready = analyzePreflight('meet.example.com', probe(), 'vps.example.com');
  assert.equal(ready.ready, true); assert.equal(ready.checks.find(x => x.id === 'docker').level, 'warn');
  for (const changes of [{ distro: 'debian' }, { distroVersion: '20.04' }, { arch: 'mips' }, { cpu: 1 }, { ramKiB: 1024 }, { diskKiB: 1024 }, { sudo: 'unavailable' }, { tcpPorts: [443] }, { udpPorts: [49160] }]) assert.equal(analyzePreflight('meet.example.com', probe(changes), 'vps.example.com').ready, false);
});
test('existing installation permits read-only signed plan classification and retains explicit warning', () => {
  const report = analyzePreflight('meet.example.com', probe({ existingPaths: true, tcpPorts: [443], udpPorts: [49160] }), 'vps.example.com');
  assert.equal(report.ready, true); assert.equal(report.checks.find(x => x.id === 'existing-install').level, 'warn');
});
test('malformed, duplicate, unbounded or control-bearing probe output fails closed', () => {
  for (const output of [probe().slice(0, -1), '{}', probe({ cpu: '4' }), probe({ hostIps: ['attacker.example'] }), probe({ kernel: 'Linux\nforged' }), probe().replace('"protocol":"MSPF2"', '"protocol":"MSPF2","protocol":"MSPF2"'), 'x'.repeat(65537)]) assert.throws(() => analyzePreflight('meet.example.com', output, 'vps.example.com'), { code: 'INVALID_RESPONSE' });
});
test('endpoint and domain validators reject command/path injection and normalize IDN, credentials are owned and wiped', () => {
  for (const host of ['$(id)', 'host; id', 'host\nx', 'https://host', '127.0.0.999', '[fe80::1%en0]']) assert.throws(() => validateEndpoint({ host, port: 22, user: 'root' }));
  for (const domain of ['$(id).example', '1.2.3.4', 'localhost', 'https://meet.example.com', 'meet.example.com/path']) assert.throws(() => normalizeDomain(domain));
  assert.equal(normalizeDomain('Пример.рф'), 'xn--e1afmkfd.xn--p1ai');
  const owned = ownCredentials({ kind: 'password', password: 'test-secret' }); destroyCredentials(owned); assert.ok(owned.password.every(x => x === 0));
  assert.match(PREFLIGHT_COMMAND, /^LC_ALL=C \/usr\/bin\/python3 -c '/); assert.ok(PREFLIGHT_COMMAND.includes('json.load(sys.stdin)')); assert.ok(!PREFLIGHT_COMMAND.includes('shell=True'));
});


test('recovery disk allowance follows the signed runner while preserving fresh-install minimum', () => {
  const report = changes => analyzePreflight('meet.example.com', probe(changes), 'vps.example.com');
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
  const level = compose => analyzePreflight('meet.example.com', probe({ compose }), 'vps.example.com').checks.find(x => x.id === 'compose').level;
  for (const version of ['2.0.0', 'v2.39.4', '5.6.0', 'v5.6.0', '5.6.0-beta.1', '2.0.0+build.7']) assert.equal(level(version), 'pass');
  for (const version of ['1.29.2', 'v1.29.2', '5.6', '5.6.0 extra', 'not-a-version', 'missing']) assert.equal(level(version), 'warn');
});

test('public IPv4 is derived from authenticated host resolution, never from the future domain', () => {
  const resolved = analyzePreflight('meet.example.com', probe({ hostIps: ['8.8.8.8', '8.8.8.8', '2001:4860:4860::8888'], domainIps: ['1.1.1.1'] }), 'vps.example.com');
  assert.equal(resolved.publicIpv4, '8.8.8.8');
  assert.equal(resolved.checks.find(check => check.id === 'public-ipv4').level, 'pass');
  assert.equal(resolved.checks.find(check => check.id === 'dns').level, 'warn');
  const literal = analyzePreflight('meet.example.com', probe(), '8.8.8.8');
  assert.equal(literal.publicIpv4, '8.8.8.8');
  for (const [host, hostIps] of [
    ['vps.example.com', []], ['vps.example.com', ['1.1.1.1', '8.8.8.8']],
    ['1.1.1.1', ['8.8.8.8']], ['10.0.0.1', ['8.8.8.8']],
    ['2001:4860:4860::8888', ['8.8.8.8']], ['vps.example.com', ['::ffff:8.8.8.8']],
  ]) {
    const report = analyzePreflight('meet.example.com', probe({ hostIps }), host);
    assert.equal(report.publicIpv4, undefined, `${host}: ${hostIps}`);
    assert.equal(report.ready, false);
    assert.equal(report.checks.find(check => check.id === 'public-ipv4').level, 'blocked');
  }
  // An overfull DNS result must fail closed, not become a unique IP after truncation.
  assert.throws(() => analyzePreflight('meet.example.com', probe({ hostIps: Array.from({ length: 9 }, (_, i) => `8.8.8.${i + 1}`) }), 'vps.example.com'), { code: 'INVALID_RESPONSE' });
});

test('automatic address selection rejects non-global and multicast IPv4 ranges at their boundaries', () => {
  const blocked = ['0.0.0.0', '0.255.255.255', '10.0.0.1', '100.64.0.0', '100.127.255.255', '127.0.0.1', '169.254.0.0', '169.254.255.255', '172.16.0.0', '172.31.255.255', '192.0.0.0', '192.0.0.8', '192.0.0.11', '192.0.0.255', '192.0.2.1', '192.88.99.1', '192.168.0.1', '198.18.0.0', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.0', '239.255.255.255', '240.0.0.0', '255.255.255.255'];
  for (const ip of blocked) {
    const report = analyzePreflight('meet.example.com', probe({ hostIps: [ip] }), ip);
    assert.equal(report.publicIpv4, undefined, ip); assert.equal(report.ready, false, ip);
  }
  for (const ip of ['78.17.198.175', '8.8.8.8', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '192.0.0.9', '192.0.0.10', '198.17.255.255', '198.20.0.0', '223.255.255.255']) {
    assert.equal(analyzePreflight('meet.example.com', probe({ hostIps: [ip] }), ip).publicIpv4, ip);
  }
});
