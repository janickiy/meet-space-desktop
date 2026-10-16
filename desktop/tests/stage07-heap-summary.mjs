// Offline summaries deliberately omit heap strings, messages, URLs and credentials.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
export async function summarizeHeap(filename) {
  const heap = JSON.parse(await readFile(filename, 'utf8'));
  const fields = heap.snapshot.meta.node_fields, stride = fields.length;
  const types = heap.snapshot.meta.node_types[fields.indexOf('type')];
  const edgeFields = heap.snapshot.meta.edge_fields, edgeStride = edgeFields.length;
  const edgeTypes = heap.snapshot.meta.edge_types[edgeFields.indexOf('type')];
  const nodes = heap.nodes, strings = heap.strings;
  const index = name => fields.indexOf(name);
  const count = {}, selfBytes = {}, constructors = {}, queryCategories = {};
  let edge = 0;
  for (let offset = 0; offset < nodes.length; offset += stride) {
    const type = types[nodes[offset+index('type')]], name = strings[nodes[offset+index('name')]];
    count[type] = (count[type] ?? 0)+1; selfBytes[type] = (selfBytes[type] ?? 0)+nodes[offset+index('self_size')];
    if (['object','native'].includes(type) && ['MeetSpaceBroker','NativeAssets','NativeUpdates','NativeShell','NativeNotifications','DOMTimer','ScheduledAction',
      'RTCPeerConnection','MediaStream','MediaStreamTrack','WebSocket','Timeout','AbortController'].includes(name))
      constructors[name] = (constructors[name] ?? 0)+1;
    const end = edge + nodes[offset+index('edge_count')] * edgeStride;
    let queryCategory, hasObservers = false;
    for (; edge<end; edge+=edgeStride) {
      if (type !== 'object' || edgeTypes[heap.edges[edge+edgeFields.indexOf('type')]] !== 'property') continue;
      const property = strings[heap.edges[edge+edgeFields.indexOf('name_or_index')]];
      if (property === 'observers') hasObservers = true;
      if (property !== 'queryHash') continue;
      const target = heap.edges[edge+edgeFields.indexOf('to_node')];
      const hash = strings[nodes[target+index('name')]];
      const category = /^\["([a-z][a-z-]{0,60})"[,\]]/.exec(hash)?.[1] ?? '(other)';
      queryCategory = category;
    }
    if (queryCategory && hasObservers) queryCategories[queryCategory] = (queryCategories[queryCategory] ?? 0)+1;
  }
  return { filename: path.basename(filename), nodeCount: nodes.length/stride, count, selfBytes, constructors, queryCategories };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const phase = process.argv[2];
  if (!['baseline','after'].includes(phase)) throw new Error('Expected baseline or after');
  const results = [];
  for (const label of ['warmup','settled','cache-expired']) for (const target of ['main','renderer']) {
    const filename = path.join(artifacts, `stage07-${phase}-${label}-${target}.heapsnapshot`);
    try { results.push({ label, target, ...await summarizeHeap(filename) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (results.length < 4) throw new Error('Missing warmup/settled heap snapshots');
  await writeFile(path.join(artifacts, `stage07-heaps-${phase}.json`), JSON.stringify({ phase,
    note: 'Post-GC object counts and shallow self bytes, not dominator retained sizes; only synthetic test identities were used', results }, null, 2)+'\n');
  console.log(JSON.stringify(results.map(({label,target,constructors,queryCategories})=>({label,target,constructors,queryCategories})),null,2));
}
