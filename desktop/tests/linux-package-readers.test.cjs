const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function tar(name = "opt/MeetSpace Test/meetspace-test", content = Buffer.from("fixture")) {
  const header = Buffer.alloc(512);
  header.write(name);
  const field = (value, offset, length) => header.write(value.toString(8).padStart(length - 1, "0") + "\0", offset, length);
  field(0o755, 100, 8); field(0, 108, 8); field(0, 116, 8); field(content.length, 124, 12); field(1, 136, 12);
  header.fill(32, 148, 156); header[156] = 48; header.write("ustar\0", 257);
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return Buffer.concat([header, content, Buffer.alloc(Math.ceil(content.length / 512) * 512 - content.length), Buffer.alloc(1024)]);
}
function cpioMember(name, content, mode = 0o100755, links = 1) {
  const values = [1, mode, 0, 0, links, 1, content.length, 0, 0, 0, 0, Buffer.byteLength(name) + 1, 0];
  const header = Buffer.from("070701" + values.map((value) => value.toString(16).padStart(8, "0")).join(""));
  const pre = Buffer.concat([header, Buffer.from(name + "\0")]);
  return Buffer.concat([pre, Buffer.alloc((4 - pre.length % 4) % 4), content, Buffer.alloc((4 - content.length % 4) % 4)]);
}
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-package-reader-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return async (bytes) => {
    const filename = path.join(root, `${Math.random().toString(16).slice(2)}.archive`);
    await fs.writeFile(filename, bytes);
    return filename;
  };
}
test("DEB tar reader inspects exact archive ownership and rejects damaged/traversing input", async (t) => {
  const { readTarEntries } = await import("../scripts/verify-linux-artifacts.mjs");
  const save = await temporary(t), entries = await readTarEntries(await save(tar()));
  assert.equal(entries[0].path, "opt/MeetSpace Test/meetspace-test");
  assert.equal(entries[0].uid, 0); assert.equal(entries[0].gid, 0); assert.equal(entries[0].mode, 0o755);
  await assert.rejects(readTarEntries(await save(tar("../outside"))), /unsafe/);
  await assert.rejects(readTarEntries(await save(tar().subarray(0, 1024))), /unterminated/);
  const damaged = tar(); damaged[100] ^= 1;
  await assert.rejects(readTarEntries(await save(damaged)), /checksum/);
});
test("RPM CPIO reader rejects hardlinks, escaping paths and incomplete archives", async (t) => {
  const { readCpioEntries } = await import("../scripts/verify-linux-artifacts.mjs");
  const save = await temporary(t), end = cpioMember("TRAILER!!!", Buffer.alloc(0));
  const valid = Buffer.concat([cpioMember("./opt/MeetSpace Test/chrome-sandbox", Buffer.from("fixture"), 0o104755), end]);
  const entries = await readCpioEntries(await save(valid));
  assert.equal(entries[0].path, "opt/MeetSpace Test/chrome-sandbox");
  assert.equal(entries[0].mode, 0o4755); assert.equal(entries[0].uid, 0);
  await assert.rejects(readCpioEntries(await save(Buffer.concat([cpioMember("../outside", Buffer.alloc(0)), end]))), /unsafe/);
  await assert.rejects(readCpioEntries(await save(Buffer.concat([cpioMember("normal", Buffer.alloc(0), 0o100644, 2), end]))), /hardlink/);
  await assert.rejects(readCpioEntries(await save(cpioMember("normal", Buffer.alloc(0)))), /unterminated/);
});
