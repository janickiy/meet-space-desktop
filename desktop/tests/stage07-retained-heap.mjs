// Offline analysis: never emit arbitrary heap strings, URLs, property names or secrets.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const constructors = new Set(['MeetSpaceBroker', 'NativeAssets', 'NativeUpdates', 'NativeShell',
  'NativeNotifications', 'RTCPeerConnection', 'MediaStream', 'MediaStreamTrack', 'WebSocket',
  'Timeout', 'AbortController', 'Query', 'QueryObserver', 'AudioContext', 'DOMTimer', 'ScheduledAction']);

// Cooper/Harvey/Kennedy fixed-point dominators over a rooted directed graph.
// CSR inputs make the analysis bounded by graph size instead of recursive JS call depth.
export function dominators(firstEdge, targets, sizes, root = 0) {
  const count = sizes.length;
  if (!count || firstEdge.length !== count + 1 || firstEdge[count] !== targets.length ||
      root < 0 || root >= count) throw new Error('Invalid graph');
  const firstPred = new Uint32Array(count + 1);
  for (const target of targets) {
    if (target >= count) throw new Error('Invalid edge target');
    firstPred[target + 1]++;
  }
  for (let i = 1; i <= count; i++) firstPred[i] += firstPred[i - 1];
  const preds = new Uint32Array(targets.length), cursor = firstPred.slice(0, count);
  for (let from = 0; from < count; from++) {
    if (firstEdge[from] > firstEdge[from + 1]) throw new Error('Invalid graph offsets');
    for (let e = firstEdge[from]; e < firstEdge[from + 1]; e++) preds[cursor[targets[e]]++] = from;
  }
  const visited = new Uint8Array(count), stack = new Uint32Array(count), next = firstEdge.slice(0, count);
  const post = [];
  let depth = 1;
  stack[0] = root; visited[root] = 1;
  while (depth) {
    const node = stack[depth - 1];
    if (next[node] < firstEdge[node + 1]) {
      const target = targets[next[node]++];
      if (!visited[target]) { visited[target] = 1; stack[depth++] = target; }
    } else { post.push(node); depth--; }
  }
  const order = Uint32Array.from(post.reverse()), rank = new Int32Array(count).fill(-1);
  for (let i = 0; i < order.length; i++) rank[order[i]] = i;
  const idom = new Int32Array(count).fill(-1);
  idom[root] = root;
  function intersect(a, b) {
    while (a !== b) {
      while (rank[a] > rank[b]) a = idom[a];
      while (rank[b] > rank[a]) b = idom[b];
    }
    return a;
  }
  let changed = true, passes = 0;
  while (changed) {
    if (++passes > count) throw new Error('Dominator convergence failure');
    changed = false;
    for (let i = 1; i < order.length; i++) {
      const node = order[i];
      let candidate = -1;
      for (let p = firstPred[node]; p < firstPred[node + 1]; p++) {
        const pred = preds[p];
        if (idom[pred] === -1) continue;
        candidate = candidate === -1 ? pred : intersect(candidate, pred);
      }
      if (candidate !== idom[node]) { idom[node] = candidate; changed = true; }
    }
  }
  const retained = Float64Array.from(sizes);
  for (let i = order.length - 1; i > 0; i--) retained[idom[order[i]]] += retained[order[i]];
  return { idom, order, retained, passes, reachable: order.length };
}

export async function summarizeRetainedHeap(filename) {
  const bytes = await readFile(filename), heap = JSON.parse(bytes.toString('utf8'));
  const nf = heap.snapshot.meta.node_fields, ef = heap.snapshot.meta.edge_fields;
  const ns = nf.length, es = ef.length, nodes = heap.nodes, edges = heap.edges;
  const nt = nf.indexOf('type'), nn = nf.indexOf('name'), sz = nf.indexOf('self_size'), ec = nf.indexOf('edge_count');
  const et = ef.indexOf('type'), en = ef.indexOf('name_or_index'), to = ef.indexOf('to_node');
  if ([nt, nn, sz, ec, et, en, to].some(i => i < 0) || nodes.length % ns || edges.length % es)
    throw new Error('Unsupported heap schema');
  const nodeTypes = heap.snapshot.meta.node_types[nt], edgeTypes = heap.snapshot.meta.edge_types[et];
  const count = nodes.length / ns, firstEdge = new Uint32Array(count + 1), sizes = new Float64Array(count);
  const groups = new Map();
  let position = 0, strongCount = 0, omittedWeak = 0;
  for (let node = 0; node < count; node++) {
    const offset = node * ns, type = nodeTypes[nodes[offset + nt]], name = heap.strings[nodes[offset + nn]];
    sizes[node] = nodes[offset + sz];
    firstEdge[node] = strongCount;
    const end = position + nodes[offset + ec] * es;
    let queryHash = false, observers = false;
    for (; position < end; position += es) {
      const edgeType = edgeTypes[edges[position + et]];
      if (edgeType === 'weak') omittedWeak++; else strongCount++;
      if (type === 'object' && edgeType === 'property') {
        const property = heap.strings[edges[position + en]];
        if (property === 'queryHash') queryHash = true;
        if (property === 'observers') observers = true;
      }
    }
    const group = queryHash && observers ? 'Query (property shape)' :
      ['object', 'native'].includes(type) && constructors.has(name) ? name : null;
    if (group) { if (!groups.has(group)) groups.set(group, []); groups.get(group).push(node); }
  }
  if (position !== edges.length) throw new Error('Heap edge count mismatch');
  firstEdge[count] = strongCount;
  const targets = new Uint32Array(strongCount);
  for (let edge = 0, i = 0; edge < edges.length; edge += es) {
    if (edgeTypes[edges[edge + et]] === 'weak') continue;
    const target = edges[edge + to] / ns;
    if (!Number.isInteger(target)) throw new Error('Misaligned heap edge');
    targets[i++] = target;
  }
  const root = (heap.snapshot.root_index ?? 0) / ns;
  const { idom, order, retained, passes, reachable } = dominators(firstEdge, targets, sizes, root);
  const results = {};
  for (const [name, members] of groups) {
    const selected = new Uint8Array(count), covered = new Uint8Array(count);
    for (const node of members) selected[node] = 1;
    let unionRetainedBytes = 0, reachableCount = 0, shallowBytes = 0, maxRetainedBytes = 0;
    // Retained subtrees can overlap. Count only selected nodes without a selected ancestor.
    for (const node of order) {
      const ancestorCovered = node !== root && covered[idom[node]];
      covered[node] = ancestorCovered || selected[node];
      if (!selected[node]) continue;
      reachableCount++; shallowBytes += sizes[node];
      maxRetainedBytes = Math.max(maxRetainedBytes, retained[node]);
      if (!ancestorCovered) unionRetainedBytes += retained[node];
    }
    results[name] = { count: members.length, reachableCount, shallowBytes, maxRetainedBytes, unionRetainedBytes };
  }
  return {
    file: path.basename(filename), sha256: createHash('sha256').update(bytes).digest('hex'),
    method: 'Immediate dominators of the raw snapshot graph, excluding weak edges; all other edge types retained',
    limitations: 'Conservative graph accounting, not Chrome DevTools page-ownership/shortcut/ephemeron heuristics. Not OS RSS. Per-group unions must not be summed across groups.',
    nodeCount: count, reachable, unreachable: count - reachable, strongEdges: strongCount, omittedWeak,
    passes, totalReachableSelfBytes: retained[root], groups: results,
  };
}

async function main() {
  const [output, ...inputs] = process.argv.slice(2);
  if (!output || !inputs.length) throw new Error('Usage: node stage07-retained-heap.mjs NEW_OUTPUT.json HEAP...');
  const results = [];
  for (const input of inputs) results.push(await summarizeRetainedHeap(input));
  await writeFile(output, JSON.stringify({ schema: 1, results }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ output, snapshots: results.length, status: 'PASS' }));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {
  // JSON.parse errors can include a heap-string excerpt. Do not print parser errors.
  console.error('Retained heap analysis failed; input and parser details omitted.');
  process.exitCode = 1;
});
