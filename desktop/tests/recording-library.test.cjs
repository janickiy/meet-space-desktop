const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const path = require('node:path');
let load;
before(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/recordingLibrary.ts'), 'utf8');
  ({ loadRecordingLibraryPage: load } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`));
});
const conf = id => ({ id, title: id, status: 'finished' });
const record = (id, uuid = id) => ({ conferenceId: id, uuid, status: 'ready' });

test('flat library preserves conference cursors and all offsets with bounded concurrency', async () => {
  let active = 0, peak = 0;
  const offsets = [], cursors = [];
  const source = {
    conferences: async cursor => { cursors.push(cursor); return { items: cursor ? [conf('last')] : Array.from({ length: 8 }, (_, i) => conf(String(i))), nextCursor: cursor ? null : 'next' }; },
    recordings: async (id, offset) => {
      active++; peak = Math.max(peak, active); offsets.push(`${id}:${offset}`);
      await new Promise(resolve => setTimeout(resolve, 2)); active--;
      return { items: id === '0' && !offset ? Array.from({ length: 20 }, (_, i) => record(id, `${id}-${i}`)) : [record(id, `${id}-${offset}`)] };
    },
    history: async id => ({ item: { conference: conf(id) } }),
  };
  let cursor = { pending: [] }, items = [];
  for (let pages = 0; cursor && pages < 8; pages++) {
    const page = await load(source, cursor, new AbortController().signal);
    items.push(...page.entries); cursor = page.next;
  }
  assert.equal(cursor, undefined);
  assert.equal(peak, 3);
  assert.deepEqual(cursors, [undefined, 'next']);
  assert.ok(offsets.includes('0:20'));
  assert.equal(new Set(offsets).size, offsets.length);
  assert.equal(items.length, 29);
});

test('one unavailable meeting does not hide other recordings or invent empty success', async () => {
  const page = await load({
    conferences: async () => ({ items: [conf('ok'), conf('denied')], nextCursor: null }),
    recordings: async id => { if (id === 'denied') throw new Error('403'); return { items: [record(id), record('unrelated')] }; },
    history: async () => { throw new Error('optional history unavailable'); },
  }, { pending: [] }, new AbortController().signal);
  assert.deepEqual(page.failed, ['denied']);
  assert.deepEqual(page.entries.map(e => e.record.uuid), ['ok']);
  assert.equal(page.entries[0].history, undefined);
  assert.equal(page.next, undefined);
});

test('cancelled catalogue work stops before issuing more requests', async () => {
  const controller = new AbortController();
  let started = 0;
  const source = {
    conferences: async () => ({ items: Array.from({ length: 20 }, (_, i) => conf(String(i))), nextCursor: null }),
    recordings: async () => { started++; controller.abort(); return { items: [] }; },
    history: async () => { throw new Error('must not load history'); },
  };
  await assert.rejects(load(source, { pending: [] }, controller.signal), { name: 'AbortError' });
  assert.equal(started, 1);
});
