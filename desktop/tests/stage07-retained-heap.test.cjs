const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dominators, summarizeRetainedHeap } = require('./stage07-retained-heap.mjs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function graph(adj, sizes = adj.map(() => 1)) {
  const offsets = [0];
  for (const targets of adj) offsets.push(offsets.at(-1) + targets.length);
  return dominators(Uint32Array.from(offsets), Uint32Array.from(adj.flat()), sizes);
}

test('retained heap: chain, diamond, cycle and unreachable objects', () => {
  let result = graph([[1], [2], []], [2, 3, 5]);
  assert.deepEqual([...result.idom], [0, 0, 1]);
  assert.deepEqual([...result.retained], [10, 8, 5]);
  result = graph([[1, 2], [3], [3], []]);
  assert.deepEqual([...result.idom], [0, 0, 0, 0]);
  assert.deepEqual([...result.retained], [4, 1, 1, 1]);
  result = graph([[1], [2], [1, 3], [], [0]]);
  assert.deepEqual([...result.idom], [0, 0, 1, 2, -1]);
  assert.deepEqual([...result.retained], [4, 3, 2, 1, 1]);
  assert.equal(result.reachable, 4);
});

test('retained heap: compare random cyclic graphs against removal oracle', () => {
  let seed = 76543;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let run = 0; run < 200; run++) {
    const n = 2 + Math.floor(rand() * 25);
    const adj = Array.from({ length: n }, () => []);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (rand() < 0.13) adj[a].push(b);
    function reachableWithout(blocked) {
      const seen = new Set(), queue = blocked === 0 ? [] : [0];
      while (queue.length) {
        const node = queue.pop();
        if (node === blocked || seen.has(node)) continue;
        seen.add(node); queue.push(...adj[node]);
      }
      return seen;
    }
    const initial = reachableWithout(-1), result = graph(adj);
    for (const node of initial) {
      const after = reachableWithout(node);
      assert.equal(result.retained[node], initial.size - after.size, `run=${run} node=${node}`);
    }
  }
});

test('retained heap: deep graph does not depend on JS recursion limit', () => {
  const n = 30000, result = graph(Array.from({ length: n }, (_, i) => i + 1 < n ? [i + 1] : []));
  assert.equal(result.retained[0], n);
  assert.equal(result.idom[n - 1], n - 2);
});

test('retained heap: weak edges excluded and nested query groups not double counted', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-heap-test-'));
  try {
    const file = path.join(dir, 'synthetic.heapsnapshot');
    await fs.writeFile(file, JSON.stringify({
      snapshot: { meta: {
        node_fields: ['type', 'name', 'self_size', 'edge_count'],
        node_types: [['synthetic', 'object', 'string']],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['internal', 'weak', 'property']],
      } },
      strings: ['root', 'Query', 'queryHash', 'observers', 'private-synthetic-value'],
      nodes: [0,0,0,2, 1,1,10,3, 1,1,20,2, 1,1,30,0, 2,4,40,0],
      edges: [0,0,4, 1,0,12, 2,2,16, 2,3,16, 0,0,8, 2,2,16, 2,3,16],
    }));
    const result = await summarizeRetainedHeap(file);
    assert.equal(result.reachable, 4);
    assert.equal(result.omittedWeak, 1);
    assert.equal(result.totalReachableSelfBytes, 70);
    assert.deepEqual(result.groups['Query (property shape)'], {
      count: 2, reachableCount: 2, shallowBytes: 30, maxRetainedBytes: 70, unionRetainedBytes: 70,
    });
    assert.equal(result.groups.Query.reachableCount, 0);
    assert.equal(JSON.stringify(result).includes('private-synthetic-value'), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('retained heap: malformed snapshot never prints parser excerpts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-heap-test-'));
  try {
    const input = path.join(dir, 'malformed.heapsnapshot');
    await fs.writeFile(input, 'PRIVATE_QA_MARKER');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'stage07-retained-heap.mjs'), path.join(dir, 'output.json'), input], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal((result.stdout + result.stderr).includes('PRIVATE_QA_MARKER'), false);
    assert.match(result.stderr, /input and parser details omitted/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
