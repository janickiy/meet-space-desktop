const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const openssl = process.env.OPENSSL_BIN || 'openssl';
const hasOpenSSL = spawnSync(openssl, ['version'], { encoding: 'utf8' }).status === 0;

/** Generates test-only secrets in an isolated temporary directory; never stores
 * real certificates or private keys in repository fixtures. */
function createCertificateFixture(t) {
  assert.ok(hasOpenSSL, 'OpenSSL is required to generate ephemeral TLS fixtures');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'meetspace-certificate-test-'));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  if (t) t.after(cleanup);
  const read = name => readFileSync(path.join(directory, name), 'utf8');
  function run(args) {
    const result = spawnSync(openssl, args, { cwd: directory, encoding: 'utf8', timeout: 20000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, 'OpenSSL certificate fixture generation failed: ' + result.stderr);
  }
  function issue(name, issuer, extension, options = {}) {
    const algorithm = options.rsa ? ['-newkey', 'rsa:' + options.rsa] : ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1'];
    run(['req', '-new', '-nodes', ...algorithm, '-keyout', name + '.key', '-out', name + '.csr', '-subj', '/CN=meet.example.com']);
    writeFileSync(path.join(directory, name + '.ext'), extension);
    run(['x509', '-req', '-in', name + '.csr', '-CA', issuer + '.pem', '-CAkey', issuer + '.key', '-CAcreateserial', '-days', '3', '-sha256', '-extfile', name + '.ext', '-out', name + '.pem']);
  }
  try {
    run(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-days', '4', '-sha256', '-subj', '/CN=MeetSpace Test Root', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    issue('intermediate', 'root', 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n');
    const extensions = 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:meet.example.com,DNS:*.team.example.com\n';
    issue('leaf', 'intermediate', extensions);
    issue('rsa', 'intermediate', extensions, { rsa: 2048 });
    issue('weak', 'intermediate', extensions, { rsa: 1024 });
    issue('cnonly', 'intermediate', 'basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n');
    run(['pkcs8', '-topk8', '-in', 'leaf.key', '-out', 'encrypted.key', '-passout', 'pass:temporary-fixture-only', '-v2', 'aes-256-cbc']);
    return { fullchain: read('leaf.pem') + read('intermediate.pem'), privateKey: read('leaf.key'), domain: 'meet.example.com', root: read('root.pem'), leaf: read('leaf.pem'), read, directory, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

module.exports = { createCertificateFixture, hasOpenSSL };
