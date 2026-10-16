const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { createNodeHttpsTransport } = require("../dist/network/transport.js");
const { createCertificates, createFixture } = require("./fixtures/https-fixture.cjs");

let certificates;
before(async () => {
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0", "TLS verification must remain enabled");
  certificates = await createCertificates();
});
after(async () => certificates?.close());

const request = (url, options = {}) => ({
  url, method: "GET", headers: {}, signal: new AbortController().signal, maxResponseBytes: 8192, ...options,
});
const fixture = async (t, options = {}) => {
  const value = await createFixture({ name: "transport", certificates, ...options });
  t.after(() => value.close());
  return value;
};

test("native HTTPS trusts only the explicitly supplied test CA and sends no browser metadata", async (t) => {
  const server = await fixture(t);
  const transport = createNodeHttpsTransport({ ca: certificates.ca });
  const response = await transport.request(request(`${server.origin}/version`));
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(Buffer.from(response.body)).version, "1.0.0");
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].headers.origin, undefined);
  assert.equal(server.requests[0].headers["sec-fetch-site"], undefined);
  assert.equal(server.requests[0].headers.cookie, undefined);
  assert.equal(server.requests[0].headers.authorization, undefined);
});

test("untrusted and wrong-host certificates fail before any HTTP request", async (t) => {
  const valid = await fixture(t);
  const wrongHost = await fixture(t, { certificates: certificates.wrongHost });
  await assert.rejects(createNodeHttpsTransport().request(request(`${valid.origin}/version`)), /tls_error/);
  await assert.rejects(createNodeHttpsTransport({ ca: certificates.ca }).request(request(`${wrongHost.origin}/version`)), /tls_error/);
  assert.equal(valid.requests.length, 0);
  assert.equal(wrongHost.requests.length, 0);
});

test("actual DNS failure and stalled HTTPS response terminate without retry or insecure fallback", async (t) => {
  const transport = createNodeHttpsTransport({ ca: certificates.ca, timeoutMs: 3000 });
  await assert.rejects(transport.request(request("https://meetspace-integration-test.invalid/version")), /dns_error/);
  const stalled = await fixture(t, { versionDelay: 120 });
  const bounded = createNodeHttpsTransport({ ca: certificates.ca, timeoutMs: 40 });
  await assert.rejects(bounded.request(request(`${stalled.origin}/version`)), /network_timeout/);
  assert.equal(stalled.requests.length, 1);
});

test("redirects never forward a secret header to another HTTPS origin", async (t) => {
  const first = await fixture(t, { name: "redirect-source" });
  const second = await fixture(t, { name: "redirect-target" });
  first.controls.versionRedirect = `${second.origin}/version`;
  const transport = createNodeHttpsTransport({ ca: certificates.ca });
  await assert.rejects(transport.request(request(`${first.origin}/version`, {
    headers: { Authorization: "Bearer fixture-only-redirect-canary" },
  })), /redirect_not_allowed/);
  assert.equal(first.requests.length, 1);
  assert.equal(second.requests.length, 0);
});

test("bounded native responses and an explicit abort release the HTTPS request", async (t) => {
  const large = await fixture(t, { version: "x".repeat(4096) });
  const transport = createNodeHttpsTransport({ ca: certificates.ca });
  await assert.rejects(transport.request(request(`${large.origin}/version`, { maxResponseBytes: 128 })), /response_too_large/);
  const stalled = await fixture(t, { versionDelay: 200 });
  const controller = new AbortController();
  const pending = transport.request(request(`${stalled.origin}/version`, { signal: controller.signal }));
  const cancelled = assert.rejects(pending, /request_cancelled/);
  const deadline = Date.now() + 2000;
  while (!stalled.requests.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await cancelled;
  assert.equal(stalled.requests.length, 1, "abort exercised an actual HTTPS request");
});
