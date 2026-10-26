const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
let desktopRequest;
let sent;
before(async () => {
  const stub = 'data:text/javascript;base64,' + Buffer.from('export function desktopBridge(){return globalThis.__jsonRequestBridge;}').toString('base64');
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../../frontend/src/platform/transport.ts'), 'utf8')).replace('"./desktop"', JSON.stringify(stub));
  ({ desktopRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')));
  globalThis.__jsonRequestBridge = {
    async http(request) { sent = structuredClone(request); return { status: 200, headers: { 'content-type': 'application/json' }, body: { status: 'success' } }; },
    async abortRequest() {},
  };
});
const base = { method: 'POST', path: '/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages', responseType: 'json', token: 'desktop-session:fixture' };

test('ordinary chat draft omits the absent reply across desktop IPC', async () => {
  await desktopRequest({ ...base, body: { text: 'Hello', clientRequestId: 'fixture', replyTo: undefined, attachmentIds: [] } });
  assert.deepEqual(sent.body, { text: 'Hello', clientRequestId: 'fixture', attachmentIds: [] });
  assert.equal(Object.hasOwn(sent.body, 'replyTo'), false);
});

test('explicit replies, nested optional fields, nulls and array positions retain web JSON semantics', async () => {
  await desktopRequest({ ...base, body: { text: 'Reply', replyTo: '22222222-2222-4222-8222-222222222222', options: { absent: undefined, enabled: false, empty: null }, list: [1, undefined, 'last'] } });
  assert.deepEqual(sent.body, { text: 'Reply', replyTo: '22222222-2222-4222-8222-222222222222', options: { enabled: false, empty: null }, list: [1, null, 'last'] });
});

test('JSON preparation rejects unserializable bodies before the native bridge is called', async () => {
  sent = undefined;
  await assert.rejects(desktopRequest({ ...base, body: { value: 1n } }), TypeError);
  assert.equal(sent, undefined);
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(desktopRequest({ ...base, body: cyclic }), TypeError);
  assert.equal(sent, undefined);
});

test('binary uploads and requests without a JSON body remain distinct', async () => {
  await desktopRequest({ ...base, method: 'GET' });
  assert.equal(sent.body, undefined);
  await desktopRequest({ ...base, method: 'PUT', file: new Blob(['file bytes']), contentType: 'text/plain' });
  assert.equal(sent.body, undefined);
  assert.equal(new TextDecoder().decode(sent.bytes), 'file bytes');
});
