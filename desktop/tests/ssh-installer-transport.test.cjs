const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { Server, utils } = require('ssh2');
const { Ssh2Transport, hostKeyFromBytes, INSTALLER_COMMAND } = require('../dist/ssh/transport');
const { ownCredentials } = require('../dist/ssh/types');
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const hostKey = pair.privateKey.export({ type: 'pkcs1', format: 'pem' });
async function fixture(t, output = '{}', code = 0, authMode = 'password', commandMs = 2500) {
  const seen = { auth: [], commands: [], stdin: [] }, clients = new Set();
  const server = new Server({ hostKeys: [hostKey] }, client => {
    clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client));
    client.on('authentication', ctx => { seen.auth.push(ctx.method); const parsed = utils.parseKey(hostKey); if (authMode === 'password' && ctx.method === 'password' && ctx.password === 'fixture-secret') ctx.accept(); else if (authMode === 'publickey' && ctx.method === 'publickey' && ctx.key.data.equals(parsed.getPublicSSH()) && (!ctx.signature || parsed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true)) ctx.accept(); else ctx.reject(); });
    client.on('ready', () => client.on('session', accept => {
      const session = accept(); session.on('exec', (accept, reject, info) => {
        seen.commands.push(info.command); const stream = accept(), chunks = [];
        stream.on('data', data => chunks.push(data));
        stream.on('end', () => { seen.stdin.push(Buffer.concat(chunks).toString()); if (output !== null) { stream.write(output); stream.exit(code); stream.end(); } });
      });
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = { host: '127.0.0.1', port: server.address().port, user: 'root' };
  const transport = new Ssh2Transport({ connectMs: 1500, commandMs });
  t.after(() => { transport.dispose(); for (const client of clients) client.end(); server.close(); });
  return { transport, endpoint, seen };
}
const signal = () => new AbortController().signal;

test('SSH host-key discovery stops before any authentication request', async t => {
  const f = await fixture(t), pin = await f.transport.inspect(f.endpoint, signal());
  assert.match(pin.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(pin.algorithm, 'ssh-rsa'); assert.deepEqual(f.seen.auth, []);
});

test('every authenticated command pins exact SSH key and uses fixed command with stdin', async t => {
  const f = await fixture(t, '{"protocol":"MSI1"}'), pin = await f.transport.inspect(f.endpoint, signal());
  const result = await f.transport.installer(f.endpoint, ownCredentials({ kind: 'password', password: 'fixture-secret' }), pin, Buffer.from('fixture-data'), signal());
  assert.equal(result, '{"protocol":"MSI1"}'); assert.deepEqual(f.seen.auth, ['password']);
  assert.deepEqual(f.seen.commands, [INSTALLER_COMMAND]); assert.deepEqual(f.seen.stdin, ['fixture-data']);
});

test('changed pin blocks credentials and remote command before authentication', async t => {
  const f = await fixture(t), pin = await f.transport.inspect(f.endpoint, signal());
  const altered = Buffer.from(pin.key, 'base64'); altered[altered.length - 1] ^= 1;
  const changedPin = hostKeyFromBytes(altered);
  await assert.rejects(f.transport.installer(f.endpoint, ownCredentials({ kind: 'password', password: 'fixture-secret' }), changedPin, Buffer.from('data'), signal()), { code: 'HOST_KEY_CHANGED' });
  assert.deepEqual(f.seen.auth, []); assert.deepEqual(f.seen.commands, []);
});

test('password rejection is sanitized, output and nonzero exit are bounded', async t => {
  const f = await fixture(t, 'x'.repeat(262145)), pin = await f.transport.inspect(f.endpoint, signal());
  await assert.rejects(f.transport.installer(f.endpoint, ownCredentials({ kind: 'password', password: 'wrong-secret' }), pin, Buffer.from(''), signal()), error => error.code === 'AUTH' && !error.message.includes('wrong-secret'));
  await assert.rejects(f.transport.installer(f.endpoint, ownCredentials({ kind: 'password', password: 'fixture-secret' }), pin, Buffer.from(''), signal()), { code: 'RESPONSE_LIMIT' });
  const broken = await fixture(t, 'private stderr-like text', 1), brokenPin = await broken.transport.inspect(broken.endpoint, signal());
  await assert.rejects(broken.transport.installer(broken.endpoint, ownCredentials({ kind: 'password', password: 'fixture-secret' }), brokenPin, Buffer.from(''), signal()), { code: 'REMOTE_COMMAND' });
});

test('aborted operation closes SSH channel promptly and does not execute another command', async t => {
  const f = await fixture(t, null), pin = await f.transport.inspect(f.endpoint, signal()), abort = new AbortController();
  const pending = f.transport.installer(f.endpoint, ownCredentials({ kind: 'password', password: 'fixture-secret' }), pin, Buffer.from(''), abort.signal);
  setTimeout(() => abort.abort(), 30);
  await assert.rejects(pending, { code: 'ABORTED' }); assert.ok(f.seen.commands.length <= 1);
});


test('private key and passphrase authenticate from memory without password fallback or file paths', async t => {
  const f = await fixture(t, '{}', 0, 'publickey'), pin = await f.transport.inspect(f.endpoint, signal());
  const encrypted = pair.privateKey.export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'fixture-key-passphrase' });
  const credential = ownCredentials({ kind: 'privateKey', privateKey: encrypted, passphrase: 'fixture-key-passphrase' });
  assert.equal(await f.transport.installer(f.endpoint, credential, pin, Buffer.from('data'), signal()), '{}');
  assert.ok(f.seen.auth.length > 0 && f.seen.auth.every(method => method === 'publickey'));
  await assert.rejects(f.transport.installer(f.endpoint, ownCredentials({ kind: 'privateKey', privateKey: encrypted, passphrase: 'wrong' }), pin, Buffer.from('data'), signal()), { code: 'KEY_FORMAT' });
});

test('operation deadline and invalid UTF-8 fail with fixed safe errors', async t => {
  const slow = await fixture(t, null, 0, 'password', 80), pin = await slow.transport.inspect(slow.endpoint, signal());
  await assert.rejects(slow.transport.installer(slow.endpoint, ownCredentials({ kind: 'password', password: 'fixture-secret' }), pin, Buffer.from('data'), signal()), { code: 'TIMEOUT' });
  const invalid = await fixture(t, Buffer.from([0xff, 0xfe])), invalidPin = await invalid.transport.inspect(invalid.endpoint, signal());
  await assert.rejects(invalid.transport.installer(invalid.endpoint, ownCredentials({ kind: 'password', password: 'fixture-secret' }), invalidPin, Buffer.from('data'), signal()), { code: 'INVALID_RESPONSE' });
});
