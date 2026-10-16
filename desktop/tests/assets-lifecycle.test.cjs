"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const { randomUUID } = require("node:crypto");

test("disposing active playback cannot rearm an expiry timer while abort detaches the stream", async () => {
  const filename = path.join(__dirname, "../dist/downloads.js"), exports = {}, activeTimers = new Set(), leases = new Set();
  const localRequire = Module.createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module: { exports }, exports, require: localRequire,
    Error, URL, Request, Response, ReadableStream, queueMicrotask,
    setTimeout(callback, ms) { const timer = setTimeout(callback, ms); activeTimers.add(timer); return timer; },
    clearTimeout(timer) { activeTimers.delete(timer); clearTimeout(timer); },
  }, { filename });
  const broker = { nativeIdentity: () => ({}), cancel() {}, authorizeAsset: async () => {
    const controller = new AbortController(); let released = false;
    const lease = { signal: controller.signal, filename: "fixture.mp4", mimeType: "video/mp4", size: 131072, playable: true,
      check() { if (released) throw new Error("request_cancelled"); },
      release() { if (released) return; released = true; leases.delete(lease); controller.abort(); },
      async request(sinks) {
        sinks.onHeaders(200, { "content-type": "video/mp4", "content-length": "131072" });
        await sinks.onChunk(new Uint8Array(65536));
        await sinks.onChunk(new Uint8Array(65536));
      },
    };
    leases.add(lease); return lease;
  } };
  const assets = new exports.NativeAssets({ broker, cacheDir: "unused", chooseSavePath: async () => null, emit() {} });
  const input = () => ({ id: randomUUID(), token: "fixture-marker", asset: { kind: "recording", conferenceId: "11111111-1111-4111-8111-111111111111",
    recordingId: "22222222-2222-4222-8222-222222222222", fileId: "33333333-3333-4333-8333-333333333333" } });
  try {
    const responses = [];
    for (let index = 0; index < 4; index++) {
      const opened = await assets.open(input());
      responses.push(await assets.handleMedia(new Request(opened.url)));
    }
    assert.equal(activeTimers.size, 4);
    assert.equal(assets.media.size, 4);
    const errors = responses.map(response => assert.rejects(response.arrayBuffer()));
    await assets.dispose(); await Promise.all(errors); await assets.dispose();
    assert.equal(assets.jobs.size, 0); assert.equal(assets.media.size, 0); assert.equal(leases.size, 0);
    assert.equal(activeTimers.size, 0, "No 30-minute callback retains disposed entries after active stream abort");
  } finally { for (const timer of activeTimers) clearTimeout(timer); }
});
