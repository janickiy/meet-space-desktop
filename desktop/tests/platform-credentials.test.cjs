"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createCredentialStore } = require("../dist/platform");

function bridge(backend = "gnome_libsecret") {
  const state = { available: true, backend, encryptions: 0, decryptions: 0 };
  const safeStorage = {
    isEncryptionAvailable: () => state.available,
    getSelectedStorageBackend: () => state.backend,
    encryptString(value) { state.encryptions++; return Buffer.from(`encrypted:${value}`); },
    decryptString(value) { state.decryptions++; assert.ok(Buffer.isBuffer(value)); return value.toString().replace(/^encrypted:/, ""); },
  };
  return { state, safeStorage };
}

test("credential adapter uses existing Windows and macOS safeStorage without probing Linux backend", () => {
  for (const [platform, provider] of [["win32", "dpapi"], ["darwin", "keychain"]]) {
    const { state, safeStorage } = bridge();
    safeStorage.getSelectedStorageBackend = () => { throw new Error("must not query on this host"); };
    const store = createCredentialStore(safeStorage, { platform });
    assert.deepEqual(store.status(), { available: true, reason: "available", provider });
    assert.equal(store.decrypt(store.encrypt("value")), "value");
    state.available = false;
    assert.deepEqual(store.status(), { available: false, reason: "unavailable", provider });
    assert.throws(() => store.encrypt("value"), /secure_storage_unavailable/);
    assert.throws(() => store.decrypt(Buffer.from("value")), /secure_storage_unavailable/);
    assert.equal(state.encryptions, 1);
    assert.equal(state.decryptions, 1);
  }
});

test("Linux credential adapter accepts the bounded secure backend set", () => {
  for (const [backend, provider] of [["gnome_libsecret", "gnome-libsecret"], ["kwallet", "kwallet"], ["kwallet5", "kwallet5"], ["kwallet6", "kwallet6"]]) {
    const { safeStorage } = bridge(backend);
    const store = createCredentialStore(safeStorage, { platform: "linux" });
    assert.deepEqual(store.status(), { available: true, reason: "available", provider });
    assert.equal(store.decrypt(store.encrypt("value")), "value");
  }
});

test("Linux plaintext backend is rejected before any credential operation", () => {
  const { state, safeStorage } = bridge("basic_text");
  const store = createCredentialStore(safeStorage, { platform: "linux" });
  assert.deepEqual(store.status(), { available: false, reason: "insecure-backend", provider: "basic_text" });
  assert.equal(store.isAvailable(), false);
  assert.throws(() => store.encrypt("do-not-write"), /secure_storage_unavailable/);
  assert.throws(() => store.decrypt(Buffer.from("plaintext")), /secure_storage_unavailable/);
  assert.equal(state.encryptions + state.decryptions, 0);
  state.available = false;
  assert.equal(store.status().reason, "insecure-backend");
});

test("Linux unknown, missing, throwing and changing keyrings fail closed without leaking backend strings", () => {
  for (const backend of ["unknown", "", "__proto__", "/home/private-user/provider", "future-backend"]) {
    const { safeStorage } = bridge(backend);
    const store = createCredentialStore(safeStorage, { platform: "linux" });
    assert.deepEqual(store.status(), { available: false, reason: "unavailable", provider: "unknown" });
  }
  const { state, safeStorage } = bridge();
  const store = createCredentialStore(safeStorage, { platform: "linux" });
  assert.equal(store.isAvailable(), true);
  state.backend = "basic_text";
  assert.throws(() => store.encrypt("value"), /secure_storage_unavailable/);
  assert.equal(state.encryptions, 0);
  safeStorage.getSelectedStorageBackend = undefined;
  assert.equal(store.status().reason, "unavailable");
  safeStorage.getSelectedStorageBackend = () => { throw new Error("private keyring failure"); };
  assert.deepEqual(store.status(), { available: false, reason: "unavailable", provider: "unknown" });
});

test("safeStorage runtime errors become fixed errors and never enable a plaintext fallback", () => {
  const { safeStorage } = bridge();
  const store = createCredentialStore(safeStorage, { platform: "linux" });
  safeStorage.encryptString = () => { throw new Error("private backend details"); };
  safeStorage.decryptString = () => { throw new Error("private credential details"); };
  assert.throws(() => store.encrypt("value"), { message: "secure_storage_unavailable" });
  assert.throws(() => store.decrypt(Buffer.from("value")), { message: "secure_storage_unavailable" });
  safeStorage.isEncryptionAvailable = () => { throw new Error("private backend details"); };
  assert.equal(store.status().reason, "unavailable");
});
