// Build the real React picker into a disposable fixture; never load the product profile.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");

const frontend = path.resolve(__dirname, "../../frontend");
const entryId = path.join(frontend, "__screen_picker_fixture__.tsx");

function fixtureSource() {
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DesktopScreenPicker } from ${JSON.stringify(path.join(frontend, "src/components/desktop/DesktopScreenPicker.tsx"))};
import { DesktopRuntimeProvider } from ${JSON.stringify(path.join(frontend, "src/platform/runtime.tsx"))};

const listeners = new Set();
const pending = new Map();
const selections = [], cancellations = [], unexpected = [], errors = [];
let subscriptions = 0, unsubscriptions = 0, platform = 'darwin';
const runtime = () => ({
  platform, arch: 'arm64', appVersion: 'fixture', isPackaged: false,
  capabilities: { serverConnection: true, windowControls: true },
  host: {
    session: platform === 'linux' ? 'wayland' : 'not-applicable',
    secureStorage: { available: false, backend: 'unknown', reason: 'unavailable' },
    supports: { startup: false, absoluteWindowPosition: false, systemAudio: platform === 'win32' },
  },
});
const bridge = { bridgeVersion: 6 };
for (const name of [
  'openExternal', 'onRoute', 'minimize', 'toggleMaximize', 'close', 'quit',
  'getUpdateState', 'getSshInstallerState', 'sshInstaller', 'checkUpdates',
  'downloadUpdate', 'cancelUpdate', 'installUpdate', 'getNativePreferences',
  'setNativePreferences', 'setNotificationContext', 'saveAsset', 'openRecordingMedia',
  'closeRecordingMedia', 'cancelAsset', 'listServers', 'probeServer', 'addServer',
  'selectServer', 'removeServer', 'http', 'abortRequest', 'openStream', 'closeStream',
  'openSocket', 'sendSocket', 'closeSocket', 'onTransportEvent',
]) bridge[name] = () => { unexpected.push(name); throw new Error('Forbidden fixture operation: ' + name); };
bridge.getRuntimeInfo = async () => runtime();
bridge.onDisplayCaptureEvent = listener => {
  listeners.add(listener); subscriptions++;
  return () => { if (listeners.delete(listener)) unsubscriptions++; };
};
bridge.selectDisplaySource = input => {
  selections.push({ ...input });
  if (pending.has(input.requestId)) throw new Error('Duplicate pending selection');
  return new Promise((resolve, reject) => pending.set(input.requestId, { resolve, reject }));
};
bridge.cancelDisplaySource = async id => { cancellations.push(id); };
Object.defineProperty(window, 'meetspaceDesktop', { value: Object.freeze(bridge), writable: false });
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const root = createRoot(document.getElementById('root'));
function mount(nextPlatform = 'darwin') {
  platform = nextPlatform;
  flushSync(() => root.render(<DesktopRuntimeProvider value={runtime()}><DesktopScreenPicker /></DesktopRuntimeProvider>));
}
window.__pickerFixture = Object.freeze({
  mount,
  unmount() { flushSync(() => root.render(null)); },
  emit(event) { flushSync(() => { for (const listener of listeners) listener(event); }); },
  settle(id, outcome) {
    const selection = pending.get(id);
    if (!selection) throw new Error('No pending selection: ' + id);
    pending.delete(id);
    outcome === 'resolve' ? selection.resolve() : selection.reject(new Error('Synthetic selection failure'));
  },
  snapshot() { return {
    listeners: listeners.size, subscriptions, unsubscriptions,
    selections: selections.map(item => ({ ...item })), cancellations: [...cancellations],
    pending: [...pending.keys()], unexpected: [...unexpected], errors: [...errors], platform,
  }; },
});
mount();
`;
}

async function buildFixture(renderer) {
  const { build } = await import(
    pathToFileURL(path.join(frontend, "node_modules/vite/dist/node/index.js"))
      .href
  );
  const { default: react } = await import(
    pathToFileURL(
      path.join(frontend, "node_modules/@vitejs/plugin-react/dist/index.js"),
    ).href
  );
  await build({
    configFile: false,
    root: frontend,
    publicDir: false,
    base: "./",
    plugins: [
      {
        name: "isolated-picker-fixture",
        resolveId(id) {
          if (id === entryId) return entryId;
        },
        load(id) {
          if (id === entryId) return fixtureSource();
        },
      },
      react(),
    ],
    define: {
      __DESKTOP_BUILD__: "true",
      __CLIENT_TELEMETRY_ENABLED__: "false",
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    build: {
      outDir: renderer,
      emptyOutDir: true,
      minify: false,
      cssCodeSplit: false,
      lib: {
        entry: entryId,
        name: "MeetSpacePickerFixture",
        formats: ["iife"],
        fileName: () => "fixture.js",
        cssFileName: "fixture",
      },
    },
  });
  await fs.writeFile(
    path.join(renderer, "index.html"),
    `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>MeetSpace isolated picker test</title><link rel="stylesheet" href="./fixture.css"></head><body><button id="focus-return">Fixture focus target</button><div id="root"></div><script src="./fixture.js"></script></body></html>`,
  );
}

(async () => {
  const buildOnly = process.argv.includes("--build-only");
  const outputArg = process.argv
    .slice(2)
    .find((value) => !value.startsWith("--"));
  const output = path.resolve(
    outputArg || path.join(__dirname, "../artifacts/macos-stage04"),
  );
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "meetspace-picker-ui-"),
  );
  const renderer = path.join(temporary, "renderer");
  try {
    await fs.mkdir(output, { recursive: true });
    await buildFixture(renderer);
    if (buildOnly) {
      console.log(
        "Actual DesktopScreenPicker fixture build PASS; Electron was not started.",
      );
      return;
    }
    const env = { ...process.env };
    for (const name of [
      "ELECTRON_RUN_AS_NODE",
      "MEETSPACE_DESKTOP_DEV",
      "MEETSPACE_DEV_CSP_NONCE",
    ])
      delete env[name];
    const log = await fs.open(path.join(output, "picker-ui.log"), "w");
    let logWrites = Promise.resolve();
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(
          require("electron"),
          [
            path.join(__dirname, "screen-picker-ui.cjs"),
            path.join(temporary, "profile"),
            renderer,
            output,
          ],
          { env, stdio: ["ignore", "pipe", "pipe"] },
        );
        let timeout = false;
        const timer = setTimeout(() => {
          timeout = true;
          child.kill("SIGKILL");
        }, 65000);
        for (const stream of [child.stdout, child.stderr])
          stream.on("data", (chunk) => {
            process.stdout.write(chunk);
            logWrites = logWrites.then(() => log.write(chunk));
          });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          code === 0 && !timeout
            ? resolve()
            : reject(
                new Error(
                  timeout
                    ? "Picker DOM UI timed out"
                    : "Picker DOM UI failed: " + code,
                ),
              );
        });
      });
    } finally {
      await logWrites;
      await log.close();
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
