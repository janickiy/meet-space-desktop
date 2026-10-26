// Execute the real runner sources with disposable fixtures and a real Node child.
// Shortened clocks exercise termination and event-loop ownership without Electron.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

async function worker(runner, mode, root) {
  const state = { runner, mode, signals: [], fixtureClosed: 0, removed: false, unref: false, errors: [] };
  let child;
  const report = path.join(root, 'result.json');
  const fixture = () => ({ origin: 'https://127.0.0.1:1', users: [{ email: 'qa@fixture.invalid', id: 'one' }],
    sockets: new Set(), streams: new Set(), close: async () => { state.fixtureClosed++; } });
  const fakeFs = { ...fs,
    mkdtemp: async () => {
      state.directory = await fs.mkdtemp(path.join(root, 'owned-profile-'));
      return state.directory;
    },
    rm: async (target, options) => {
      if (target === state.directory) {
        assert.ok(child.exitCode !== null || child.signalCode !== null, 'profile deletion must follow child exit');
        state.removed = true;
      }
      return fs.rm(target, options);
    },
  };
  const source = await fs.readFile(path.join(__dirname, runner), 'utf8');
  process.argv = [process.execPath, runner, 'after'];
  await vm.runInNewContext(source, {
    __dirname, Buffer, process,
    console: { log: () => {}, error: (...args) => { state.errors.push(args.join(' ')); } },
    setTimeout: (callback, delay) => setTimeout(callback,
      delay === 30000 || delay === 240000 ? 80 : delay === 5000 ? 50 : delay === 10000 ? 100 : delay),
    clearTimeout,
    require: name => {
      if (name === 'node:fs/promises') return fakeFs;
      if (name === 'electron') return process.execPath;
      if (name === './fixtures/https-fixture.cjs') return {
        createCertificates: async () => ({ ca: Buffer.from('local-fixture'), close: async () => { state.fixtureClosed++; } }),
        createFixture: async () => fixture(), PASSWORD: 'disposable-only',
      };
      if (name === './fixtures/product-fixture.cjs') return { createProductFixture: async () => fixture() };
      if (name === 'node:child_process') return { spawn: (_file, _args, options) => {
        assert.equal('ELECTRON_RUN_AS_NODE' in options.env, false);
        child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        state.pid = child.pid;
        const kill = child.kill.bind(child), unref = child.unref.bind(child);
        child.unref = () => { state.unref = true; return unref(); };
        child.kill = signal => {
          state.signals.push(signal);
          if (mode === 'term' || mode === 'kill' && signal === 'SIGKILL') return kill(signal);
          if (mode === 'signal-error') queueMicrotask(() => child.emit('error', new Error('Controlled signal failure')));
          return false;
        };
        // Makes the owned child discoverable even if the runner itself stalls.
        require('node:fs').writeFileSync(report, JSON.stringify(state));
        return child;
      } };
      return require(name);
    },
  });
  state.completed = true;
  await fs.writeFile(report, JSON.stringify(state));
}

if (process.argv[2] === '--supervision-worker') {
  worker(...process.argv.slice(3)).catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { test } = require('node:test');
  for (const runner of ['integration-runner.cjs', 'stage07-profile-runner.cjs']) {
    for (const mode of ['term', 'kill', 'never', 'signal-error']) {
      test(`${runner}: ${mode} cleanup terminates the runner and respects profile ownership`, async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meetspace-supervision-'));
        let harness, state;
        try {
          harness = spawn(process.execPath, [__filename, '--supervision-worker', runner, mode, root], { stdio: 'ignore',
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
          const result = await new Promise((resolve, reject) => {
            const deadline = setTimeout(() => { harness.kill('SIGKILL'); reject(new Error('Runner retained its child/event loop')); }, 3000);
            harness.once('error', error => { clearTimeout(deadline); reject(error); });
            harness.once('exit', (code, signal) => { clearTimeout(deadline); resolve({ code, signal }); });
          });
          state = JSON.parse(await fs.readFile(path.join(root, 'result.json'), 'utf8'));
          assert.deepEqual(result, { code: 1, signal: null }, 'timeout must remain a failing run');
          assert.equal(state.completed, true);
          assert.equal(state.fixtureClosed, 3);
          const preserved = mode === 'never' || mode === 'signal-error';
          assert.equal(state.removed, !preserved);
          assert.equal(state.unref, preserved);
          assert.deepEqual(state.signals, mode === 'term' ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL']);
          if (preserved) {
            await fs.access(state.directory);
            process.kill(state.pid, 0); // A living child did not keep its parent runner alive.
            assert.ok(state.errors.some(message => message.includes('profile preserved')));
          } else await assert.rejects(fs.access(state.directory), { code: 'ENOENT' });
        } finally {
          if (!state) {
            try { state = JSON.parse(await fs.readFile(path.join(root, 'result.json'), 'utf8')); } catch {}
          }
          if (state?.pid) { try { process.kill(state.pid, 'SIGKILL'); } catch {} }
          if (harness && harness.exitCode === null && harness.signalCode === null) harness.kill('SIGKILL');
          await fs.rm(root, { recursive: true, force: true });
        }
      });
    }
  }
}
