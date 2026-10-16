const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomBytes, createCipheriv, createDecipheriv } = require("node:crypto");
const WebSocket = require("ws");
const { MeetSpaceBroker } = require("../dist/broker.js");
const { createNodeHttpsTransport } = require("../dist/network/transport.js");
const { createCertificates, createFixture, CONFERENCE, INVITE, PASSWORD } = require("./fixtures/https-fixture.cjs");

let certificates;
before(async () => { certificates = await createCertificates(); });
after(async () => certificates?.close());

async function until(predicate, description) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(predicate(), description);
}
function cipher() {
  // Unit-level disk protection is exercised with authenticated encryption.
  // The separate Electron restart test uses actual Electron safeStorage.
  const key = randomBytes(32);
  return {
    isAvailable: () => true,
    encrypt(value) {
      const nonce = randomBytes(12), encryptor = createCipheriv("aes-256-gcm", key, nonce);
      const ciphertext = Buffer.concat([encryptor.update(value, "utf8"), encryptor.final()]);
      return Buffer.concat([nonce, encryptor.getAuthTag(), ciphertext]);
    },
    decrypt(value) {
      const bytes = Buffer.from(value), decryptor = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decryptor.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decryptor.update(bytes.subarray(28)), decryptor.final()]).toString("utf8");
    },
  };
}
async function context(t) {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-broker-network-"));
  const alpha = await createFixture({ name: "alpha", certificates });
  const beta = await createFixture({ name: "beta", certificates });
  const events = [];
  const options = {
    storageDir, cipher: cipher(), emit: (event) => events.push(event),
    transport: createNodeHttpsTransport({ ca: certificates.ca, timeoutMs: 2000 }),
    createSocket: (url, protocols, socketOptions) => new WebSocket(url, protocols, {
      ...socketOptions, ca: certificates.ca, rejectUnauthorized: true,
    }),
  };
  let broker = new MeetSpaceBroker(options);
  await broker.initialize();
  t.after(async () => { broker.dispose(); await alpha.close(); await beta.close(); await fs.rm(storageDir, { recursive: true, force: true }); });
  let next = 0;
  const http = (method, resource, body, token) => broker.http({ id: `http-${++next}`, method, path: `/api/v1${resource}`, responseType: "json", ...(body === undefined ? {} : { body }), ...(token ? { token } : {}) });
  const login = async (server, index = 0) => {
    const result = await http("POST", "/auth/login", { email: server.users[index].email, password: PASSWORD });
    assert.equal(result.status, 200);
    assert.equal(result.body.user.id, server.users[index].id);
    assert.equal(typeof result.body.accessToken, "string");
    assert.equal(server.tokens.has(result.body.accessToken), false, "renderer receives a marker, not a bearer token");
    assert.equal(result.headers["set-cookie"], undefined);
    return result.body.accessToken;
  };
  await broker.addServer({ origin: alpha.origin, label: "Alpha fixture" });
  await broker.addServer({ origin: beta.origin, label: "Beta fixture" });
  const state = broker.serversState();
  const alphaId = state.items.find((item) => item.origin === alpha.origin).id;
  const betaId = state.items.find((item) => item.origin === beta.origin).id;
  await broker.selectServer(alphaId);
  return { alpha, beta, alphaId, betaId, events, storageDir, options, http, login,
    get broker() { return broker; },
    restart: async () => { broker.dispose(); broker = new MeetSpaceBroker(options); await broker.initialize(); },
  };
}

test("native auth keeps tokens and cookies out of renderer DTOs and restores two accounts from encrypted storage", async (t) => {
  const c = await context(t);
  await c.login(c.alpha);
  await c.login(c.alpha, 1);
  const accounts = await c.http("POST", "/auth/accounts/list", {});
  assert.deepEqual(accounts.body.items.map((user) => user.id).sort(), c.alpha.users.map((user) => user.id).sort());
  const switched = await c.http("POST", "/auth/accounts/switch", { userId: c.alpha.users[0].id });
  const marker = switched.body.accessToken;
  const current = await c.http("GET", "/auth/me", undefined, marker);
  assert.equal(current.body.user.id, c.alpha.users[0].id);
  const encrypted = await fs.readFile(path.join(c.storageDir, "sessions.encrypted"));
  for (const secret of [...c.alpha.tokens.keys(), ...c.alpha.sessions.keys(), PASSWORD]) {
    assert.equal(encrypted.includes(Buffer.from(secret)), false, "no plaintext credentials on disk");
    assert.equal(JSON.stringify([accounts, switched, current]).includes(secret), false, "no credential in public DTO");
  }
  const loginCount = c.alpha.requests.filter((entry) => entry.path === "/api/v1/auth/login").length;
  await c.restart();
  assert.equal(c.broker.serversState().selectedId, c.alphaId);
  const restored = await c.http("POST", "/auth/refresh", { userId: c.alpha.users[0].id });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.user.id, c.alpha.users[0].id);
  assert.equal(c.alpha.requests.filter((entry) => entry.path === "/api/v1/auth/login").length, loginCount);
  const domain = await c.http("GET", "/conferences", undefined, restored.body.accessToken);
  assert.equal(domain.body.fixtureServer, "alpha");
  const domainRequest = c.alpha.requests.findLast((entry) => entry.path === "/api/v1/conferences");
  assert.equal(domainRequest.headers.cookie, undefined, "auth cookies never enter domain endpoints");
  assert.match(domainRequest.headers.authorization, /^Bearer fixture-jwt-alpha-/);
  for (const entry of c.alpha.requests) {
    assert.equal(entry.headers.origin, undefined);
    assert.equal(entry.headers["sec-fetch-site"], undefined);
  }
});

test("one 401 obtains a fresh session, while native recording metadata omits signed storage capabilities", async (t) => {
  const c = await context(t);
  const marker = await c.login(c.alpha);
  c.alpha.controls.rejectTokenOnce = true;
  const response = await c.http("GET", "/conferences", undefined, marker);
  assert.equal(response.status, 200);
  assert.ok(c.alpha.requests.some((entry) => entry.path === "/api/v1/auth/refresh"));
  const recordings = await c.http("GET", `/conferences/${CONFERENCE}/recordings`, undefined, marker);
  assert.equal(recordings.status, 200);
  assert.equal(recordings.body.items[0].downloadUrl, undefined);
  assert.equal(c.alpha.requests.some((entry) => entry.path.startsWith("/storage/")), false, "reading metadata does not send bearer credentials to storage");
});

test("account and conference WSS use fresh native tickets; SSE and all in-flight work close on server switch", async (t) => {
  const c = await context(t);
  const marker = await c.login(c.alpha);
  await c.broker.socketOpen({ id: "account-one", kind: "account", token: marker });
  await c.broker.socketOpen({ id: "conference-one", kind: "conference", conferenceId: CONFERENCE, token: marker });
  await c.broker.streamOpen({ id: "notifications-one", token: marker });
  await until(() => c.events.filter((event) => event.kind === "socket" && event.type === "message").length >= 2 && c.alpha.streams.size === 1, "both TLS sockets and SSE are live");
  c.alpha.notify({ fixture: "notification-alpha" });
  await until(() => c.events.some((event) => event.kind === "stream" && event.type === "chunk" && Buffer.from(event.data).toString().includes("notification-alpha")), "SSE payload arrives through broker events");
  const upgrades = c.alpha.requests.filter((entry) => entry.method === "UPGRADE");
  assert.equal(upgrades.length, 2);
  assert.notEqual(upgrades[0].query, upgrades[1].query);
  for (const upgrade of upgrades) for (const header of ["authorization", "cookie", "origin", "sec-fetch-site"])
    assert.equal(upgrade.headers[header], undefined, `no ${header} on a ticket socket`);
  c.alpha.controls.holdConferences = true;
  const pending = c.http("GET", "/conferences", undefined, marker);
  const cancelled = assert.rejects(pending);
  await until(() => c.alpha.heldRequests.size === 1, "an authenticated request is actually in flight");
  await c.broker.selectServer(c.betaId);
  await cancelled;
  await until(() => c.alpha.sockets.size === 0 && c.alpha.streams.size === 0 && c.alpha.heldRequests.size === 0, "old server connections have closed");
  const betaMarker = await c.login(c.beta);
  const betaData = await c.http("GET", "/conferences", undefined, betaMarker);
  assert.equal(betaData.body.fixtureServer, "beta");
  const alphaSecrets = [...c.alpha.tokens.keys(), ...c.alpha.sessions.keys()];
  for (const entry of c.beta.requests) for (const secret of alphaSecrets)
    assert.equal(JSON.stringify(entry.headers).includes(secret), false, "server A credentials never reach B, even with the same user UUID");
  const stale = await c.http("GET", "/conferences", undefined, marker).catch(() => null);
  assert.ok(stale === null || stale.status !== 200, "a stale A identity marker cannot authorize B");
});

test("sleep/wake reset notifies live transports and permits fresh authenticated reconnect", async (t) => {
  const c = await context(t);
  const marker = await c.login(c.alpha);
  await c.broker.socketOpen({ id: "before-sleep", kind: "conference", conferenceId: CONFERENCE, token: marker });
  await c.broker.streamOpen({ id: "before-sleep-events", token: marker });
  await until(() => c.events.some(event => event.id === "before-sleep" && event.type === "open") && c.alpha.streams.size === 1, "live transports established");
  c.broker.resetConnections(true);
  assert.ok(c.events.some(event => event.kind === "socket" && event.id === "before-sleep" && event.type === "close" && event.code === 1012));
  assert.ok(c.events.some(event => event.kind === "stream" && event.id === "before-sleep-events" && event.type === "error"));
  await until(() => c.alpha.sockets.size === 0 && c.alpha.streams.size === 0, "suspended connections released");
  await c.broker.socketOpen({ id: "after-resume", kind: "conference", conferenceId: CONFERENCE, token: marker });
  await c.broker.streamOpen({ id: "after-resume-events", token: marker });
  await until(() => c.events.some(event => event.id === "after-resume" && event.type === "open") && c.alpha.streams.size === 1, "fresh transports reconnected with retained identity");
  const upgrades = c.alpha.requests.filter(entry => entry.method === "UPGRADE");
  assert.notEqual(upgrades[0].query, upgrades[1].query, "reconnect obtains a fresh one-use ticket");
});

test("offline logout removes local authorization and retries revocation without restoring that account", async (t) => {
  const c = await context(t);
  const marker = await c.login(c.alpha);
  c.alpha.controls.failLogout = true;
  await c.http("POST", "/auth/logout", { userId: c.alpha.users[0].id }, marker).catch(() => undefined);
  await c.restart();
  c.alpha.controls.failLogout = false;
  const restored = await c.http("POST", "/auth/refresh", { userId: c.alpha.users[0].id }).catch(() => null);
  assert.ok(restored === null || restored.status === 401, "offline logout cannot silently sign the account back in");
  await until(() => c.alpha.sessions.size === 0, "queued remote revocation was completed");
});

test("invalid server metadata is rejected before a profile is saved", async (t) => {
  const c = await context(t);
  const invalid = await createFixture({ name: "invalid", certificates, malformedVersion: true });
  const incompatible = await createFixture({ name: "future", certificates, version: "v9.0.0" });
  t.after(async () => { await invalid.close(); await incompatible.close(); });
  await assert.rejects(c.broker.addServer({ origin: invalid.origin }));
  await assert.rejects(c.broker.addServer({ origin: incompatible.origin }));
  assert.equal(c.broker.serversState().items.length, 2);
});

test("guest join intercepts credentials, resumes only the current guest, and never persists or refreshes its access token", async (t) => {
  const c = await context(t);
  const guestPath = `/conference-invites/${INVITE}/guest`;
  const first = await c.http("POST", guestPath, { displayName: "Offline fixture guest" });
  assert.equal(first.status, 200);
  assert.equal(first.body.user.guestConferenceId, CONFERENCE);
  assert.equal(first.body.item.conferenceId, CONFERENCE);
  assert.equal(first.body.accessToken.startsWith("desktop-session:"), true);
  const resumed = await c.http("POST", guestPath, { displayName: "Offline fixture guest" }, first.body.accessToken);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.user.id, first.body.user.id, "explicit guest rejoin resumes the server-side guest identity");
  const joins = c.alpha.requests.filter((entry) => entry.path.endsWith("/guest"));
  assert.equal(joins[0].headers.authorization, undefined);
  assert.match(joins[1].headers.authorization, /^Bearer fixture-jwt-alpha-/);
  for (const join of joins) assert.equal(join.headers.cookie, undefined);
  const guestSecrets = [...c.alpha.tokens.keys()];
  for (const secret of guestSecrets) assert.equal(JSON.stringify([first, resumed]).includes(secret), false);
  const refreshes = c.alpha.requests.filter((entry) => entry.path === "/api/v1/auth/refresh").length;
  c.alpha.controls.rejectTokenOnce = true;
  assert.equal((await c.http("GET", "/conferences", undefined, resumed.body.accessToken)).status, 401);
  assert.equal(c.alpha.requests.filter((entry) => entry.path === "/api/v1/auth/refresh").length, refreshes, "guest access has no persistent refresh");
  assert.equal(c.alpha.sessions.size, 0);
  const encrypted = await fs.readFile(path.join(c.storageDir, "sessions.encrypted")).catch((error) => {
    if (error.code !== "ENOENT") throw error; return Buffer.alloc(0);
  });
  for (const secret of guestSecrets) assert.equal(encrypted.includes(Buffer.from(secret)), false);
  await c.restart();
  await assert.rejects(c.http("GET", "/conferences", undefined, resumed.body.accessToken));
});

test("leaving a transient guest session preserves the separately saved account", async (t) => {
  const c = await context(t);
  await c.login(c.alpha);
  const accountSessions = [...c.alpha.sessions.keys()];
  const guest = await c.http("POST", `/conference-invites/${INVITE}/guest`, { displayName: "Transient fixture guest" });
  assert.equal(guest.status, 200);
  await c.http("POST", "/auth/logout", {}, guest.body.accessToken);
  assert.deepEqual([...c.alpha.sessions.keys()], accountSessions, "guest logout cannot revoke the saved account");
  const restored = await c.http("POST", "/auth/refresh", { userId: c.alpha.users[0].id });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.user.email, c.alpha.users[0].email);
});
