const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateAsset, safeAssetFilename, dispositionFilename, signedAssetUrl, mediaByteRange } = require('../dist/asset-policy.js');
const uuid = '11111111-1111-4111-8111-111111111111';
const now = Date.UTC(2026, 9, 14, 12);
function signed(options = {}) {
  const url = new URL('https://storage.fixture.invalid/bucket/recording.mp4');
  const fields = { 'X-Amz-Algorithm':'AWS4-HMAC-SHA256', 'X-Amz-Credential':'test/20261014/us-east-1/s3/aws4_request',
    'X-Amz-Date':'20261014T120000Z', 'X-Amz-Expires':'300', 'X-Amz-SignedHeaders':'host', 'X-Amz-Signature':'a'.repeat(64), ...options };
  for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
  return url.href;
}

test('asset authority accepts strict IDs and rejects renderer destinations, paths, URLs, extra keys and malformed IDs', () => {
  const recording = {kind:'recording', conferenceId:uuid, recordingId:uuid, fileId:uuid};
  assert.deepEqual(validateAsset(recording), recording);
  const attachment = {kind:'attachment', scope:'conversation', scopeId:uuid, attachmentId:uuid, filename:'display-only.pdf'};
  assert.deepEqual(validateAsset(attachment), attachment);
  for (const value of [null, [], {...recording,url:'https://evil.invalid'}, {...recording,path:'C:\\secret'},
    {...recording,fileId:'../../secret'}, {...recording,fileId:undefined}, {...attachment,scope:'arbitrary'},
    {...attachment,filename:'x'.repeat(256)}, {...attachment,destination:'/tmp/override'}])
    assert.throws(() => validateAsset(value), /invalid_request/);
});

test('Save suggestions are basenames compatible with Windows, including reserved devices and Unicode control tricks', () => {
  assert.equal(safeAssetFilename('C:\\Users\\private\\report.pdf'), 'report.pdf');
  assert.equal(safeAssetFilename('../../report.pdf'), 'report.pdf');
  assert.equal(safeAssetFilename('CON.txt'), '_CON.txt');
  assert.equal(safeAssetFilename('nul'), '_nul');
  assert.equal(safeAssetFilename('CONIN$'), '_CONIN$');
  assert.equal(safeAssetFilename('conout$.txt'), '_conout$.txt');
  assert.equal(safeAssetFilename('file\u202etxt.exe\u0000'), 'file_txt.exe_');
  assert.equal(safeAssetFilename('..'), 'MeetSpace-file');
  assert.equal(safeAssetFilename('x'.repeat(159) + ' .suffix'), 'x'.repeat(159));
  assert.equal(dispositionFilename("attachment; filename*=UTF-8''%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C.mp4"), 'запись.mp4');
  assert.equal(dispositionFilename("attachment; filename*=UTF-8''%zz"), undefined);
});

test('S3 capability validation requires a fresh HTTPS SigV4 URL without credentials, duplicate controls or impossible dates', () => {
  assert.equal(signedAssetUrl(signed(), now).expiresAt, now + 300000);
  for (const url of [signed().replace('https:', 'http:'), signed().replace('https://', 'https://user:secret@'),
    signed() + '#fragment', signed() + '&X-Amz-Expires=300', signed({'X-Amz-SignedHeaders':'host;authorization'}),
    signed({'X-Amz-Signature':'bad'}), signed({'X-Amz-Credential':'arbitrary'}), signed({'X-Amz-Date':'20260230T120000Z'}),
    signed({'X-Amz-Date':'20261014T121000Z'}), signed({'X-Amz-Expires':'86401'}), signed().replace('/bucket/', '/buck\\et/')])
    assert.throws(() => signedAssetUrl(url, now), /asset_url_invalid/);
  assert.throws(() => signedAssetUrl(signed(), now + 301000), /asset_expired/);
});

test('single byte ranges support seek, suffix, HEAD sizing and reject overflow or multi-range requests', () => {
  assert.deepEqual(mediaByteRange(null, 100), {start:0,end:99,partial:false});
  assert.deepEqual(mediaByteRange('bytes=20-29',100), {start:20,end:29,partial:true});
  assert.deepEqual(mediaByteRange('bytes=90-',100), {start:90,end:99,partial:true});
  assert.deepEqual(mediaByteRange('bytes=-5',100), {start:95,end:99,partial:true});
  assert.deepEqual(mediaByteRange('bytes=90-200',100), {start:90,end:99,partial:true});
  for (const range of ['bytes=100-', 'bytes=2-1', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'bytes=9007199254740993-', 'items=0-1'])
    assert.equal(mediaByteRange(range,100), null);
});
