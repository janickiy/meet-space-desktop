const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { validateTlsCertificate } = require('../dist/ssh/certificate');
const { createCertificateFixture, hasOpenSSL } = require('./fixtures/tls.cjs');

let generated, fixture;
const read = name => generated.read(name);
function input(overrides = {}) { return { ...fixture, ...overrides }; }
function rejected(value, domain = 'meet.example.com', hash) {
  assert.throws(() => validateTlsCertificate(value, domain, hash), error => {
    assert.equal(error.code, 'TLS_CERTIFICATE_INVALID');
    assert.equal(error.message.includes('-----BEGIN'), false);
    assert.equal(error.message.includes('PRIVATE KEY'), false);
    return true;
  });
}

test.before(() => {
  if (!hasOpenSSL) return;
  generated = createCertificateFixture();
  fixture = { fullchain: generated.fullchain, privateKey: generated.privateKey };
});
test.after(() => { generated?.cleanup(); });

const fixtureTest = (name, fn) => test(name, { skip: hasOpenSSL ? false : 'OpenSSL is required to generate ephemeral TLS fixtures' }, fn);

fixtureTest('valid EC chain and private key preserve exact input and bind SHA-256', () => {
  const result = validateTlsCertificate(input(), 'meet.example.com');
  assert.deepEqual(result, { ...fixture, certificateSha256: createHash('sha256').update(fixture.fullchain).digest('hex') });
  assert.deepEqual(validateTlsCertificate(input(), 'meet.example.com', result.certificateSha256), result);
  assert.equal(validateTlsCertificate(input({ fullchain: fixture.fullchain + '\n' }), 'meet.example.com').certificateSha256 === result.certificateSha256, false);
});
fixtureTest('valid RSA certificate and optional root certificate are accepted', () => {
  const result = validateTlsCertificate({ fullchain: read('rsa.pem') + read('intermediate.pem') + read('root.pem'), privateKey: read('rsa.key') }, 'meet.example.com');
  assert.match(result.certificateSha256, /^[a-f0-9]{64}$/);
});
fixtureTest('SAN exact host and one-label wildcard are required', () => {
  assert.ok(validateTlsCertificate(input(), 'chat.team.example.com'));
  rejected(input(), 'other.example.com');
  rejected(input(), 'deep.chat.team.example.com');
  rejected(input(), 'team.example.com');
  rejected(input(), 'meet.example.com;echo');
  rejected(input({ fullchain: read('cnonly.pem') + read('intermediate.pem'), privateKey: read('cnonly.key') }));
});
fixtureTest('mismatched, encrypted or weak private keys fail without disclosing material', () => {
  rejected(input({ privateKey: read('rsa.key') }));
  rejected(input({ privateKey: read('encrypted.key') }));
  rejected(input({ fullchain: read('weak.pem') + read('intermediate.pem'), privateKey: read('weak.key') }));
  rejected(input({ privateKey: fixture.privateKey + fixture.privateKey }));
});
fixtureTest('expired, not-yet-valid and short-lived certificates fail', () => {
  const original = Date.now;
  try {
    Date.now = () => original() + 5 * 86400000;
    rejected(input());
    Date.now = () => original() - 86400000;
    rejected(input());
    Date.now = () => original() + 3 * 86400000 - 30 * 60000;
    rejected(input());
  } finally { Date.now = original; }
});
fixtureTest('chain order, duplicate certificates and issuer signatures are checked', () => {
  rejected(input({ fullchain: read('intermediate.pem') + read('leaf.pem') }));
  rejected(input({ fullchain: read('leaf.pem') + read('root.pem') }));
  rejected(input({ fullchain: fixture.fullchain + read('intermediate.pem') }));
  rejected(input({ fullchain: fixture.fullchain + read('rsa.pem') }));
});
fixtureTest('bounded PEM-only input rejects junk, controls, metadata, excessive chains and oversized keys', () => {
  for (const raw of [null, [], {}, { ...fixture, extra: 'no' }, { fullchain: fixture.fullchain }]) rejected(raw);
  for (const fullchain of ['not pem', 'prefix\n' + fixture.fullchain, fixture.fullchain + 'suffix', fixture.fullchain + '\0', ' '.repeat(65537), read('leaf.pem').repeat(11)]) rejected(input({ fullchain }));
  for (const privateKey of ['not pem', fixture.privateKey + '\0', ' '.repeat(16385), 'prefix\n' + fixture.privateKey]) rejected(input({ privateKey }));
});
fixtureTest('applying a different certificate or malformed planned fingerprint fails', () => {
  rejected(input(), 'meet.example.com', '0'.repeat(64));
  rejected(input(), 'meet.example.com', 'NOT A HASH');
});
