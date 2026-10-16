// Stage 07: source import inspection and the actual compiled preload in an
// isolated VM. This is not a substitute for Chromium/Windows runtime testing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

async function sources(directory) {
  const result = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...await sources(filename));
    else if (/\.[cm]?[jt]sx?$/.test(item.name)) result.push(filename);
  }
  return result;
}

function imports(source, filename) {
  const result = [];
  // Read-only lexical inspection of the import forms used in these sources.
  // TypeScript 7's installed native compiler has no JavaScript parser API; no
  // compiler invocation, extra parser dependency or emitted file is needed.
  const declarations = /\b(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\*|\w+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s+from\s+(["'])([^"'\r\n]+)\1/g;
  for (const match of source.matchAll(declarations)) result.push({ index: match.index, value: match[2] });
  for (const match of source.matchAll(/\bimport\s*(["'])([^"'\r\n]+)\1/g)) result.push({ index: match.index, value: match[2] });
  for (const match of source.matchAll(/\b(?:require|import)\s*\(([^)]*)\)/g)) {
    const argument = /^\s*(["'])([^"'\r\n]+)\1\s*$/.exec(match[1]);
    assert.ok(argument, `production module loading cannot resolve an arbitrary runtime path: ${path.basename(filename)}`);
    result.push({ index: match.index, value: argument[2] });
  }
  return result.sort((a, b) => a.index - b.index).map(item => item.value);
}

test('production desktop and shared frontend imports have no fixture/test dependency or runtime-computed module path', async () => {
  const roots = [path.join(__dirname, '../src'), path.join(__dirname, '../../frontend/src')];
  const files = (await Promise.all(roots.map(sources))).flat();
  assert.ok(files.length > 50, 'both production trees were inspected');
  for (const filename of files) {
    for (const specifier of imports(await fs.readFile(filename, 'utf8'), filename)) {
      assert.doesNotMatch(specifier, /(?:^|[/\\])(?:__tests__|tests?|fixtures?)(?:[/\\]|$)|\.(?:test|spec)(?:\.|$)/i, path.relative(path.join(__dirname, '../..'), filename));
      assert.doesNotMatch(specifier, /^(?:https?:|data:|file:)/i, 'executable modules must be bundled locally');
    }
  }
  // Exercise each supported syntax so the inspection cannot silently ignore a
  // dynamic import, side-effect import or re-export of a fixture.
  assert.deepEqual(imports('import "./tests/a"; export * from "./fixtures/b"; require("./test/c"); import("./tests/d")', 'example.ts'),
    ['./tests/a', './fixtures/b', './test/c', './tests/d']);
  assert.throws(() => imports('require(userSuppliedPath)', 'example.ts'), /runtime path/);
});

async function preload() {
  const ipc = new EventEmitter(), calls = [];
  ipc.invoke = async (...args) => { calls.push(args); return { ok: true, value: 'result' }; };
  let bridge;
  const sandbox = {
    exports: {},
    require(name) {
      assert.equal(name, 'electron', 'sandboxed preload cannot load other Node modules');
      return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(key, value) {
        assert.equal(key, 'meetspaceDesktop'); bridge = value;
      } } };
    },
  };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../dist/preload.js'), 'utf8'), sandbox);
  return { bridge, ipc, calls };
}

test('compiled preload exposes fixed operations, drops update URL arguments and never exposes Electron events', async () => {
  const { bridge, ipc, calls } = await preload();
  assert.ok(Object.isFrozen(bridge));
  for (const forbidden of ['ipcRenderer', 'invoke', 'send', 'require', 'eval', 'openPath']) assert.equal(bridge[forbidden], undefined);
  for (const [method, channel] of Object.entries({ getUpdateState: 'state', checkUpdates: 'check', downloadUpdate: 'download', cancelUpdate: 'cancel', installUpdate: 'install' })) {
    await bridge[method]('https://untrusted.invalid/latest.json', { path: '/tmp/installer.exe' });
    assert.deepEqual(calls.at(-1), [`meetspace:update:${channel}`]);
  }
  const privileged = { sender: { executeJavaScript() { throw new Error('must not be exposed'); } } };
  const received = [];
  const unsubscribe = bridge.onTransportEvent((...args) => received.push(args));
  const payload = { kind: 'update', state: { enabled: false, phase: 'disabled' } };
  ipc.emit('meetspace:transport', privileged, payload);
  assert.deepEqual(received, [[payload]]);
  unsubscribe();
  ipc.emit('meetspace:transport', privileged, payload);
  assert.equal(received.length, 1);
});

test('100 compiled preload subscribe/unsubscribe cycles restore listener baseline on every exposed event', async () => {
  const { bridge, ipc } = await preload();
  for (const [method, channel, value] of [
    ['onTransportEvent', 'meetspace:transport', { kind: 'progress', id: 'test', percent: 0 }],
    ['onDisplayCaptureEvent', 'meetspace:display-capture', { type: 'cancelled', requestId: 'test' }],
    ['onRoute', 'meetspace:route', '/app'],
  ]) {
    let received = 0;
    const baseline = ipc.listenerCount(channel);
    for (let cycle = 0; cycle < 100; cycle++) {
      const unsubscribe = bridge[method]((...args) => { assert.equal(args.length, 1); received++; });
      assert.equal(ipc.listenerCount(channel), baseline + 1);
      ipc.emit(channel, { sender: 'privileged event' }, value);
      unsubscribe(); unsubscribe();
      assert.equal(ipc.listenerCount(channel), baseline);
    }
    assert.equal(received, 100);
  }
});
