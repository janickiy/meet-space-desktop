import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function compile(entry, desktop) {
  const result = await build({ configFile: false, root, logLevel: "silent", define: { __DESKTOP_BUILD__: JSON.stringify(desktop) },
    build: { write: false, minify: false, lib: { entry: resolve(root, entry), formats: ["es"] } } });
  const output = Array.isArray(result) ? result[0].output : result.output;
  return import("data:text/javascript;base64," + Buffer.from(output.find(item => item.type === "chunk" && item.isEntry).code).toString("base64"));
}
const native = await compile("src/platform/assets.ts", true);
const browser = await compile("src/platform/assets.ts", false);
const nativePresentation = await compile("src/recordingPresentation.ts", true);
const webPresentation = await compile("src/recordingPresentation.ts", false);
const utils = await compile("src/utils.ts", true);
const ID = "11111111-1111-4111-8111-111111111111";
const recording = { kind: "recording", conferenceId: ID, recordingId: ID, fileId: ID };
function bridge(overrides = {}) {
  const listeners = new Set();
  const calls = { cancel: [], close: [], save: [], open: [] };
  const value = { bridgeVersion: 6,
    getRuntimeInfo: async () => ({
      platform: "win32", arch: "x64", appVersion: "0.1.1-beta", isPackaged: true,
      capabilities: { serverConnection: true, windowControls: true },
      host: {
        session: "not-applicable",
        secureStorage: { available: true, backend: "dpapi", reason: "available" },
        supports: { startup: true, absoluteWindowPosition: true, systemAudio: true },
      },
    }),
    openExternal: async () => {}, onRoute: () => () => {},
    minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, quit: async () => {},
    getUpdateState: async () => ({}), checkUpdates: async () => ({}), downloadUpdate: async () => ({}), cancelUpdate: async () => ({}), installUpdate: async () => ({}),
    getSshInstallerState: async () => ({ busy: false, phase: "idle", hasCredentials: false }),
    sshInstaller: async () => ({ busy: false, phase: "idle", hasCredentials: false }),
    getNativePreferences: async () => ({}), setNativePreferences: async () => ({}), setNotificationContext: async () => {},
    listServers: async () => ({ items: [], selectedId: null, generation: 0, storageAvailable: true }),
    probeServer: async () => {}, addServer: async () => {}, selectServer: async () => {}, removeServer: async () => {},
    http: async () => ({ status: 200, headers: {}, body: null }), abortRequest: async () => {},
    openStream: async () => {}, closeStream: async () => {}, openSocket: async () => {}, sendSocket: async () => {}, closeSocket: async () => {},
    onDisplayCaptureEvent: () => () => {}, selectDisplaySource: async () => {}, cancelDisplaySource: async () => {},
    onTransportEvent: handler => { listeners.add(handler); return () => listeners.delete(handler); },
    saveAsset: async input => { calls.save.push(input); return { saved: true, cancelled: false }; },
    openRecordingMedia: async input => { calls.open.push(input); return { id: input.id, url: `app://meetspace/native-media/${"a".repeat(43)}`, mimeType: "video/mp4" }; },
    cancelAsset: async id => { calls.cancel.push(id); }, closeRecordingMedia: async id => { calls.close.push(id); },
    ...overrides,
  };
  globalThis.window = { meetspaceDesktop: value };
  return { calls, listeners, emit: event => { for (const listener of listeners) listener(event); } };
}

await test("asset operations reject incomplete bridges before starting native work", async () => {
  bridge();
  const methods = Object.keys(window.meetspaceDesktop).filter(key => typeof window.meetspaceDesktop[key] === "function");
  for (const method of methods) {
    const b = bridge({ [method]: undefined });
    await assert.rejects(native.nativeAssetRequest(recording, "opaque", "save", new AbortController().signal), /unavailable/, method);
    assert.equal(b.calls.save.length + b.calls.open.length, 0, method);
    assert.equal(b.listeners.size, 0, method);
  }
});

await test("save passes server IDs and opaque identity, never URLs or local paths", async () => {
  const b = bridge();
  assert.deepEqual(await native.nativeAssetRequest(recording, "opaque-identity", "save", new AbortController().signal), { saved: true, cancelled: false });
  assert.equal(b.calls.save.length, 1);
  assert.deepEqual(Object.keys(b.calls.save[0]).sort(), ["asset", "id", "token"]);
  assert.deepEqual(b.calls.save[0].asset, recording);
  assert.equal(b.calls.save[0].token, "opaque-identity");
  assert.match(b.calls.save[0].id, /^[a-f\d-]{36}$/);
  assert.equal(b.listeners.size, 0);
});
await test("progress is scoped, bounded and detached after completion", async () => {
  let finish, request; const updates = [];
  const b = bridge({ saveAsset: input => { request = input; return new Promise(resolve => { finish = resolve; }); } });
  const operation = native.nativeAssetRequest(recording, "opaque", "save", new AbortController().signal, v => updates.push(v));
  b.emit({ kind: "asset", id: "unrelated", type: "progress", received: 5 });
  b.emit({ kind: "asset", id: request.id, type: "progress", received: -1 });
  b.emit({ kind: "asset", id: request.id, type: "progress", received: 5, total: 20 });
  b.emit({ kind: "asset", id: request.id, type: "progress", received: 10, total: 2 });
  assert.deepEqual(updates, [{ received: 5, total: 20 }, { received: 10 }]);
  finish({ cancelled: true, saved: false });
  assert.deepEqual(await operation, { cancelled: true, saved: false });
  assert.equal(b.listeners.size, 0);
});
await test("cancel promptly rejects a pending save and notifies main", async () => {
  const controller = new AbortController();
  const b = bridge({ saveAsset: () => new Promise(() => {}) });
  const operation = native.nativeAssetRequest(recording, "opaque", "save", controller.signal);
  controller.abort();
  await assert.rejects(operation, { name: "AbortError" });
  assert.equal(b.calls.cancel.length, 1);
  assert.equal(b.listeners.size, 0);
});
await test("local media is revocable and rejects remote or mismatched results", async () => {
  const b = bridge();
  const media = await native.nativeAssetRequest(recording, "opaque", "play", new AbortController().signal);
  assert.match(media.url, /^app:\/\/meetspace\/native-media\/[a-z]{43}$/);
  media.close(); assert.equal(b.calls.close[0], b.calls.open[0].id);
  for (const result of [
    { url: "https://storage.invalid/file?signature=secret", mimeType: "video/mp4" },
    { url: `app://meetspace/native-media/${"a".repeat(43)}?secret=1`, mimeType: "video/mp4" },
    { url: `app://meetspace/native-media/${"a".repeat(43)}`, mimeType: "text/html" },
    { id: ID, url: `app://meetspace/native-media/${"a".repeat(43)}`, mimeType: "video/mp4" },
  ]) {
    const invalid = bridge({ openRecordingMedia: async input => ({ id: input.id, ...result }) });
    await assert.rejects(native.nativeAssetRequest(recording, "opaque", "play", new AbortController().signal), /invalid_asset_response/);
    assert.equal(invalid.calls.close.length, 1);
  }
});
await test("late playback completion after cancellation is revoked again", async () => {
  let finish, request;
  const controller = new AbortController();
  const b = bridge({ openRecordingMedia: input => { request = input; return new Promise(resolve => { finish = resolve; }); } });
  const operation = native.nativeAssetRequest(recording, "opaque", "play", controller.signal);
  controller.abort(); await assert.rejects(operation, { name: "AbortError" });
  finish({ id: request.id, url: `app://meetspace/native-media/${"a".repeat(43)}`, mimeType: "video/mp4" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(b.calls.close, [request.id, request.id]);
  assert.equal(b.listeners.size, 0);
});
await test("web build and missing identity cannot invoke native assets", async () => {
  const b = bridge();
  await assert.rejects(browser.nativeAssetRequest(recording, "opaque", "save", new AbortController().signal), /asset_unavailable/);
  await assert.rejects(native.nativeAssetRequest(recording, "", "save", new AbortController().signal), /asset_unavailable/);
  await assert.rejects(native.nativeAssetRequest({ kind: "attachment", scope: "conversation", scopeId: ID, attachmentId: ID }, "opaque", "play", new AbortController().signal), /asset_unavailable/);
  assert.equal(b.calls.save.length + b.calls.open.length, 0);
});
await test("desktop recording presentation needs UUID, web still needs a safe server URL", () => {
  const file = { fileType: "final_mp4", uuid: ID };
  const record = { uuid: ID, status: "ready", files: [file] };
  assert.equal(nativePresentation.recordingMediaFile(record), file);
  assert.equal(webPresentation.recordingMediaFile(record), undefined);
  assert.equal(nativePresentation.recordingMediaFile({ ...record, files: [{ fileType: "final_mp4", url: "https://storage.invalid/signed" }] }), undefined);
  assert.ok(webPresentation.recordingMediaFile({ ...record, files: [{ fileType: "final_mp4", url: "https://storage.invalid/signed" }] }));
  assert.equal(nativePresentation.recordingPreviewFile({ ...record, files: [{ fileType: "preview_jpg", uuid: ID, url: "https://storage.invalid/preview" }] }), undefined);
});
await test("auth return retains meeting, recording and conversation context without an external redirect", () => {
  for (const route of [`/meetings/${ID}/join`, `/conferences/${ID}/join`, `/recordings/${ID}?conference=${ID}`, `/personal/${ID}?filter=group`])
    assert.equal(utils.safeNext(route), route);
  for (const route of ["//evil.invalid", "/\\evil.invalid", "https://evil.invalid", "/login?next=/app", "/unknown", "/app\n"])
    assert.equal(utils.safeNext(route), "/app");
});
