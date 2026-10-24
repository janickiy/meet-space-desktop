const {test, before} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {stripTypeScriptTypes} = require('node:module');

let message;
before(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/desktop/installed-server-connection-message.ts'), 'utf8');
  const module = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
  message = module.installedServerConnectionMessage;
});

test('installed server incompatibility is not diagnosed as DNS or TLS failure', () => {
  for (const code of ['incompatible_server', 'INCOMPATIBLE_SERVER']) {
    const text = message({code, message:'https://secret:password@example.com/ untrusted response'});
    assert.match(text, /версия несовместима/);
    assert.doesNotMatch(text, /DNS|HTTPS|сертификат|сети|secret|password|untrusted/);
  }
});

test('native connection failure categories retain their distinct, actionable diagnoses', () => {
  for (const [code, expected] of [
    ['tls_error', /сертификат HTTPS/],
    ['dns_error', /DNS-записи/],
    ['network_timeout', /не ответил вовремя/],
    ['network_unavailable', /подключение к сети/],
    ['secure_storage_unavailable', /Защищённое хранилище системы недоступно/],
    ['STORAGE_UNAVAILABLE', /Защищённое хранилище системы недоступно/],
    ['secure_storage_corrupt', /восстановить сохранённую сессию/],
    ['invalid_server', /HTTPS-адрес без пути/],
    ['invalid_response', /некорректный ответ/],
    ['redirect_not_allowed', /перенаправил запрос/],
  ]) {
    const text = message({code, message:'UNTRUSTED_NATIVE_DETAIL'});
    assert.match(text, expected);
    assert.doesNotMatch(text, /UNTRUSTED_NATIVE_DETAIL/);
  }
});

test('unknown codes and raw messages use a neutral fallback without reflecting details', () => {
  const fallback = message(undefined);
  assert.match(fallback, /подключиться к нему не удалось/);
  assert.doesNotMatch(fallback, /DNS|HTTPS|сертификат|несовместим/);
  for (const error of [
    null, 'incompatible_server', new Error('tls_error'),
    {code:undefined, message:'private-url'}, {code:42},
    {code:{toString:()=>{throw new Error('must not coerce');}}},
    {code:'constructor'}, {code:'__proto__'}, {code:'unknown-secret', message:'private-url'},
  ]) assert.equal(message(error), fallback);
});
