// Uses the production file input/uploader, typed preload and authenticated TLS broker.
// The fixture records bytes without pretending to replace the Go content validator.
const assert = require("node:assert/strict");
const { gzipSync } = require("node:zlib");
const { CONFERENCE } = require("./fixtures/https-fixture.cjs");
const { DIRECT, GROUP } = require("./fixtures/product-fixture.cjs");

function zip(entries) {
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name), bytes = Buffer.from(content), crc = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, filename, bytes); central.push(directory, filename); offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

module.exports = async ({ execute, until, visible, click, route, fixture, saves, checks, sendDraft }) => {
  const docx = zip([
    ["[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ["word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>MeetSpace attachment</w:t></w:r></w:p></w:body></w:document>'],
  ]);
  // A valid empty TAR inside gzip: the sender must preserve these exact bytes.
  const cases = [
    { route: `/personal/${DIRECT}`, scope: `/conversations/${DIRECT}`, files: [
      { name: "Архив.ZIP", type: "", mime: "application/zip", bytes: zip([["notes.txt", "MeetSpace ZIP attachment"]]) },
      { name: "Документ.DOCX", type: "", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: docx },
    ] },
    { route: `/personal/${GROUP}`, scope: `/conversations/${GROUP}`, files: [
      { name: "backup.tar.gz", type: "application/octet-stream", mime: "application/gzip", bytes: gzipSync(Buffer.alloc(1024)) },
      { name: "settings.json", type: "application/octet-stream", mime: "application/json", bytes: Buffer.from('{"message":"MeetSpace attachment"}\n') },
    ] },
    { route: `/conferences/${CONFERENCE}?chat=1`, scope: `/conferences/${CONFERENCE}`, files: [
      { name: "drawing.djvu", type: "", mime: "image/vnd.djvu", bytes: Buffer.concat([Buffer.from("AT&TFORM"), Buffer.from([0, 0, 0, 4]), Buffer.from("DJVU")]) },
    ] },
  ];
  const selectFiles = files => execute(`(() => {
    const input = document.querySelector('.chat-panel input[type=file]');
    if (!input || input.disabled) throw new Error('Missing enabled production attachment input');
    const transfer = new DataTransfer();
    for (const file of ${JSON.stringify(files.map(file => ({ name: file.name, type: file.type, bytes: [...file.bytes], size: file.size })))} )
      transfer.items.add(new File([file.size ? new Uint8Array(file.size) : new Uint8Array(file.bytes)], file.name, { type: file.type }));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  for (const test of cases) {
    if (test.scope.startsWith("/conferences/")) fixture.product.controls.activeConference = true;
    await route(test.route);
    await until(() => execute(`(() => { const input = document.querySelector('.chat-panel input[type=file]:not(:disabled)'); return !!input && input.closest('.chat-panel').querySelector('textarea')?.id === ${JSON.stringify('chat-text-' + test.scope.split('/')[2])} && !input.parentElement.closest('[hidden]'); })()`), "Production chat attachment picker belongs to the requested visible conversation/conference");
    const initBefore = fixture.product.controls.attachmentEvents.filter(event => event.phase === "init").length;
    await selectFiles([{ name: "archive.zip.exe", type: "application/zip", bytes: Buffer.from("MZ-executable") }]);
    await visible("Можно прикрепить");
    await selectFiles([{ name: "oversize.zip", type: "application/zip", bytes: Buffer.alloc(0), size: 10 * 1024 * 1024 + 1 }]);
    await visible("Размер файла");
    assert.equal(fixture.product.controls.attachmentEvents.filter(event => event.phase === "init").length, initBefore, "Rejected extension and size never initialize an upload");
    await selectFiles(test.files);
    try {
      await until(() => test.files.every(file => [...fixture.product.controls.uploads.values()].some(upload => upload.scope === test.scope && upload.item.filename === file.name && upload.item.status === "ready")), "Every selected archive/document completes init, binary PUT and finalize");
    } catch (cause) {
      const ui = await execute("({ uploads: [...document.querySelectorAll('.upload-list li')].map(node => node.innerText), errors: [...document.querySelectorAll('.chat-panel .error-notice,.chat-panel .field-error')].map(node => node.innerText) })");
      const uploads = [...fixture.product.controls.uploads.values()].map(upload => ({ scope: upload.scope, item: upload.item, receivedBytes: upload.bytes?.length, contentType: upload.contentType }));
      const requests = fixture.requests.filter(request => request.path.includes('/attachments/')).map(request => ({ method: request.method, path: request.path, contentType: request.headers['content-type'] }));
      throw new Error(cause.message + '\nAttachment diagnostic: ' + JSON.stringify({ scope: test.scope, ui, uploads, requests }));
    }
    await until(() => execute(`document.querySelectorAll('.upload-list small').length === ${test.files.length} && [...document.querySelectorAll('.upload-list small')].every(node => node.textContent.includes('Готов к отправке'))`), "React shows each attachment ready to send");
    const uploaded = test.files.map(file => {
      const upload = [...fixture.product.controls.uploads.values()].find(upload => upload.scope === test.scope && upload.item.filename === file.name);
      assert.equal(upload.init.mimeType, file.mime, file.name + " canonical init MIME");
      assert.equal(upload.contentType, file.mime, file.name + " canonical PUT MIME despite OS hint");
      assert.deepEqual(upload.bytes, file.bytes, file.name + " bytes survive native IPC upload");
      assert.deepEqual(fixture.product.controls.attachmentEvents.filter(event => event.id === upload.item.id).map(event => event.phase), ["init", "content", "finalize"]);
      return upload.item;
    });
    const sentBefore = fixture.product.controls.sentMessages.length;
    await sendDraft("Archive/document upload from " + test.scope);
    await until(() => fixture.product.controls.sentMessages.length === sentBefore + 1, "Message with finalized attachment IDs reaches authenticated API");
    const message = fixture.product.controls.sentMessages.at(-1);
    assert.equal(message.route, test.scope + "/messages");
    assert.deepEqual(message.body.attachmentIds.slice().sort(), uploaded.map(file => file.id).sort());
    assert.equal(message.item.attachments.length, test.files.length);
    await until(() => execute(`!!document.querySelector('[data-testid="chat-message-${message.item.id}"]') && !document.querySelector('.chat-message-pending')`), "Confirmed attachment message renders in the actual chat thread");
    for (const file of uploaded) {
      const before = saves.length;
      await click(`[data-testid="chat-message-${message.item.id}"] button[aria-label=${JSON.stringify("Скачать файл: " + file.filename)}]`);
      await until(() => saves.length === before + 1, "Uploaded file save action passes scoped IDs to main");
      assert.deepEqual(saves.at(-1).asset, { kind: "attachment", scope: test.scope.startsWith("/conferences/") ? "conference" : "conversation", scopeId: test.scope.split("/")[2], attachmentId: file.id, filename: file.filename });
    }
  }
  await route(`/personal/${DIRECT}`);
  fixture.product.controls.activeConference = false;
  checks.push("archive and document files use the real React uploader through authenticated native TLS init→PUT→finalize→message in direct/group/conference chats; exact bytes, canonical MIME, IDs, filename rendering and scoped save verified; invalid extension and oversized files never upload");
};
