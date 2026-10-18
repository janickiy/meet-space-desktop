const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomBytes, randomUUID, createCipheriv, createDecipheriv } = require("node:crypto");
const { normalizeServerOrigin, validateApiPath, redactCredentials, MAX_JSON } = require("../dist/network/policy.js");
const { CookieVault } = require("../dist/session/vault.js");
const { MeetSpaceBroker } = require("../dist/broker.js");
const USER = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
const SID = "a".repeat(32), SID2 = "b".repeat(32), SECRET = "A".repeat(43), SECRET2 = "B".repeat(43);
const JWT = "fixture-sensitive-token-" + "a".repeat(40);
const json = (status, value, headers = {}) => ({ status, headers: { "content-type": "application/json", ...headers }, body: new TextEncoder().encode(JSON.stringify(value)) });
const setCookie = (name, value, extra = "") => `${name}=${value}; Path=/api/v1/auth; Secure; HttpOnly; SameSite=Lax; Max-Age=3600${extra}`;
function cipher() {
  const key = randomBytes(32);
  return {
    isAvailable: () => true,
    encrypt(value) { const nonce = randomBytes(12), c = createCipheriv("aes-256-gcm", key, nonce); const bytes = Buffer.concat([c.update(value, "utf8"), c.final()]); return Buffer.concat([nonce, c.getAuthTag(), bytes]); },
    decrypt(value) { const raw = Buffer.from(value), c = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12)); c.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([c.update(raw.subarray(28)), c.final()]).toString("utf8"); },
  };
}
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-policy-")); t.after(() => fs.rm(dir, { force: true, recursive: true })); return dir; }
async function setup(t, options = {}) {
  const calls = [], events = [], sockets = [];
  const transport = { async request(request) {
    calls.push(request); const resource = new URL(request.url).pathname;
    if (options.handle) { const result = await options.handle(request, resource); if (result) return result; }
    if (resource === "/version") return json(200, { version: "v1.0.0-meeting.20261013-accounts.4", commit: "f".repeat(40), buildTime: "2026-10-13T16:27:13Z" });
    if (resource.endsWith("ws-ticket")) return json(201, { ticket: "t".repeat(43) });
    if (resource === "/api/v1/auth/login" || resource === "/api/v1/auth/refresh") return json(200, { accessToken: JWT, expiresIn: 3600, tokenType: "Bearer", user: { id: USER }, reflected: JWT }, { "set-cookie": [setCookie("meetrix_session", SECRET), setCookie(`meetrix_account_${USER}`, SECRET)] });
    if (resource === "/api/v1/capabilities" && request.headers.Authorization) return json(200, { capabilities: { liveCaptions: false, transcription: false, aiSummary: false, semanticSearch: false, meetingAnalytics: false, recordingModes: ["composite", "audio_only", "individual_tracks", "screen_focus"] } });
    if (resource === "/api/v1/auth/logout") return json(200, { status: "success" });
    return json(401, { status: "failed", message: "unauthorized" });
  } };
  const broker = new MeetSpaceBroker({ storageDir: await temp(t), cipher: options.cipher || cipher(), transport, emit: (event) => events.push(event), createSocket() { const socket = new EventEmitter(); socket.terminate = () => {}; socket.close = () => {}; sockets.push(socket); return socket; } });
  t.after(() => broker.dispose()); await broker.initialize();
  const state = await broker.addServer({ origin: "https://test.invalid", label: "Test" }); await broker.selectServer(state.items[0].id);
  const http = (resource, extras = {}) => broker.http({ id: randomUUID(), method: "POST", path: "/api/v1" + resource, responseType: "json", ...extras });
  const login = async () => (await http("/auth/login", { body: { email: "test@fixture.invalid", password: "fixture-password" } })).body.accessToken;
  return { broker, calls, events, sockets, http, login };
}

test("server origins canonicalize HTTPS only and reject authority/path confusion", () => {
  assert.equal(normalizeServerOrigin("https://EXAMPLE.com:443/"), "https://example.com");
  assert.equal(normalizeServerOrigin("https://127.0.0.1:8443"), "https://127.0.0.1:8443");
  for (const input of ["http://example.com", "https://u:p@example.com", "https://example.com/path", "https://example.com/?a=1", "https://example.com/#x", "https://example.com./", "https://example.com\\@evil.test", "https://example.com/%2e", " https://example.com", "https://example.com\n", null]) assert.throws(() => normalizeServerOrigin(input), /invalid_server/);
});

test("route policy rejects arbitrary URLs, tickets and credentials but permits real filter contracts", () => {
  for (const value of ["https://evil.test/api/v1/auth/login", "//evil.test/api/v1/auth/login", "/api/v1/../auth/login", "/api/v1/conversations/%2e%2e", "/api/v1/ws-ticket", "/api/v1/notifications/events", "/api/v1/auth/login?token=secret", "/api/v1/conferences?limit=1&limit=2", "/api/v1/conferences#fragment"]) assert.throws(() => validateApiPath("POST", value));
  assert.throws(() => validateApiPath("DELETE", "/api/v1/conferences"));
  assert.equal(validateApiPath("GET", "/api/v1/me/conferences?view=active&scope=owned&from=2026-10-01"), "/api/v1/me/conferences");
  assert.equal(validateApiPath("GET", "/api/v1/search?q=test&source=transcript&membership=owned&participantId=" + USER), "/api/v1/search");
  assert.equal(validateApiPath("PUT", `/api/v1/conversations/${USER}/attachments/${OTHER}/content`), `/api/v1/conversations/${USER}/attachments/${OTHER}/content`);
});

test("credential fields are removed recursively without rewriting signed resource URLs", () => {
  const url = "https://storage.fixture/file%20name?X-Amz-Credential=a%2Fb&X-Amz-Signature=opaque";
  assert.deepEqual(redactCredentials({ url, nested: [{ accessToken: "secret", ticket: "secret", text: "visible" }], cookie: "secret" }), { url, nested: [{ text: "visible" }] });
});

test("cookie vault accepts only host-only secure auth cookies and separates servers and paths", async (t) => {
  const vault = new CookieVault(await temp(t), cipher()); await vault.load();
  await vault.accept(SID, "/api/v1/auth/login", [setCookie("meetrix_session", SECRET), setCookie(`meetrix_account_${USER}`, SECRET), setCookie("unrelated", SECRET), setCookie(`meetrix_account_${OTHER}`, SECRET2, "; Domain=fixture.invalid")]);
  assert.equal(vault.header(SID, "/api/v1/auth/refresh"), `meetrix_session=${SECRET}; meetrix_account_${USER}=${SECRET}`);
  assert.equal(vault.header(SID2, "/api/v1/auth/refresh"), "");
  assert.equal(vault.header(SID, "/api/v1/conferences"), "");
  await vault.accept(SID, "/api/v1/conferences", setCookie(`meetrix_account_${OTHER}`, SECRET2));
  assert.doesNotMatch(vault.header(SID, "/api/v1/auth/refresh"), new RegExp(SECRET2));
});

test("logout removes all aliases of one account, preserves another, and persists an encrypted revocation queue", async (t) => {
  const directory = await temp(t), encryption = cipher(), vault = new CookieVault(directory, encryption);
  await vault.accept(SID, "/api/v1/auth/login", [setCookie("meetrix_session", SECRET), setCookie(`meetrix_account_${USER}`, SECRET), setCookie(`meetrix_account_${OTHER}`, SECRET2)]);
  await vault.logout(SID, USER, true);
  assert.equal(vault.header(SID, "/api/v1/auth/refresh"), `meetrix_account_${OTHER}=${SECRET2}`);
  const disk = await fs.readFile(path.join(directory, "sessions.encrypted")); assert.equal(disk.includes(SECRET), false); assert.equal(disk.includes(SECRET2), false);
  const restored = new CookieVault(directory, encryption); await restored.load(); assert.deepEqual(restored.pending(SID), [SECRET]); assert.equal(restored.header(SID, "/api/v1/auth/refresh"), `meetrix_account_${OTHER}=${SECRET2}`);
});

test("legacy primary-cookie-only logout cannot silently preserve the active account", async (t) => {
  const vault = new CookieVault(await temp(t), cipher()); await vault.accept(SID, "/api/v1/auth/login", setCookie("meetrix_session", SECRET));
  await vault.logout(SID, USER, true); assert.equal(vault.header(SID, "/api/v1/auth/refresh"), ""); assert.deepEqual(vault.pending(SID), [SECRET]);
});

test("unavailable OS encryption leaves server profiles usable and denies auth without a network request", async (t) => {
  const { broker, calls, login } = await setup(t, { cipher: { isAvailable: () => false, encrypt() { throw new Error(); }, decrypt() { throw new Error(); } } });
  assert.equal(broker.serversState().storageAvailable, false); const count = calls.length;
  await assert.rejects(login(), /secure_storage_unavailable/); assert.equal(calls.length, count);
});

test("IPC HTTP envelopes cannot inject headers, arbitrary URLs, oversized bodies or unbounded JSON nesting", async (t) => {
  const { broker, calls } = await setup(t); const count = calls.length;
  const basic = { id: "bad", method: "POST", path: "/api/v1/auth/login", responseType: "json" };
  await assert.rejects(broker.http({ ...basic, headers: { Origin: "https://evil.test" } }), /invalid_request/);
  await assert.rejects(broker.http({ ...basic, path: "https://evil.test/" }), /invalid_request/);
  await assert.rejects(broker.http({ ...basic, body: { text: "x".repeat(MAX_JSON) } }), /request_too_large/);
  let deep = {}; for (let n = 0; n < 35; n++) deep = { nested: deep };
  await assert.rejects(broker.http({ ...basic, body: deep }), /invalid_request/); assert.equal(calls.length, count);
});

test("auth exposes only an opaque marker even when a response reflects the access token in another field", async (t) => {
  const { http } = await setup(t); const response = await http("/auth/login", { body: {} });
  assert.match(response.body.accessToken, /^desktop-session:[0-9a-f-]{36}$/); assert.equal(response.body.reflected, "[redacted]"); assert.equal(JSON.stringify(response).includes(JWT), false);
});

test("auth and HTTP redact known credential literals in nested property names and allowed response headers", async (t) => {
  const reflected = { stable: "public", nested: [{ [`bearer:${JWT}`]: "key", [SECRET]: { reflected: JWT } }] };
  const headers = { "content-type": `application/json; reflected=${JWT}`, "retry-after": SECRET };
  const { http } = await setup(t, { handle: (_request, resource) => {
    if (resource === "/api/v1/auth/login") return json(200, { ...reflected, accessToken: JWT, expiresIn: 3600, user: { id: USER } },
      { ...headers, "set-cookie": setCookie("meetrix_session", SECRET) });
    if (resource === "/api/v1/conferences") return json(200, reflected, headers);
  } });
  const login = await http("/auth/login", { body: {} });
  assert.match(login.body.accessToken, /^desktop-session:/);
  const response = await http("/conferences", { method: "GET", token: login.body.accessToken });
  for (const item of [login, response]) {
    for (const secret of [JWT, SECRET]) assert.equal(JSON.stringify(item).includes(secret), false);
    assert.equal(item.body.stable, "public");
    assert.equal(item.body.nested[0]["bearer:[redacted]"], "key");
    assert.equal(item.headers["content-type"], "application/json; reflected=[redacted]");
    assert.equal(item.headers["retry-after"], "[redacted]");
  }
});

test("WebSocket and SSE redact known credentials in property names and SSE metadata", async (t) => {
  const ticket = "t".repeat(43);
  const body = { stable: "public", nested: { [JWT]: "bearer", [`cookie:${SECRET}`]: "cookie" } };
  const { broker, login, sockets, events } = await setup(t, { handle: async (request, resource) => {
    if (resource !== "/api/v1/notifications/events") return;
    request.onHeaders(200, { "content-type": `text/event-stream; reflected=${JWT}`, "retry-after": SECRET });
    await request.onChunk(Buffer.from(`data: ${JSON.stringify(body)}\n\n`));
    return { status: 200, headers: { "content-type": "text/event-stream" }, body: new Uint8Array() };
  } });
  const marker = await login();
  await broker.socketOpen({ id: "reflected-socket", kind: "account", token: marker });
  sockets.at(-1).emit("message", Buffer.from(JSON.stringify({ ...body, [ticket]: "ticket" })), false);
  const socket = events.findLast(event => event.kind === "socket" && event.type === "message");
  assert.ok(socket);
  for (const secret of [JWT, SECRET, ticket]) assert.equal(socket.data.includes(secret), false);
  assert.equal(JSON.parse(socket.data).stable, "public");
  await broker.streamOpen({ id: "reflected-stream", token: marker });
  await new Promise(resolve => setImmediate(resolve));
  const headers = events.findLast(event => event.kind === "stream" && event.type === "headers");
  const chunk = events.findLast(event => event.kind === "stream" && event.type === "chunk");
  assert.ok(headers && chunk);
  const data = Buffer.from(chunk.data).toString("utf8");
  for (const secret of [JWT, SECRET]) {
    assert.equal(JSON.stringify(headers).includes(secret), false);
    assert.equal(data.includes(secret), false);
  }
  assert.equal(JSON.parse(data.slice(6).trim()).stable, "public");
  assert.equal(headers.headers["content-type"], "text/event-stream; reflected=[redacted]");
});

test("binary attachments retain exact bytes while credential reflections are removed from metadata", async (t) => {
  const bytes = new Uint8Array([0, 255, ...Buffer.from(JWT), 0, ...Buffer.from(SECRET)]);
  const { http, login } = await setup(t, { handle: (_request, resource) => {
    if (resource === `/api/v1/conversations/${USER}/attachments/${OTHER}/content`) return {
      status: 200, body: bytes, headers: { "content-type": `application/octet-stream; reflected=${JWT}`, "retry-after": SECRET },
    };
  } });
  const marker = await login();
  const response = await http(`/conversations/${USER}/attachments/${OTHER}/content`, { method: "GET", responseType: "binary", token: marker });
  assert.deepEqual(response.body, bytes);
  for (const secret of [JWT, SECRET]) assert.equal(JSON.stringify(response.headers).includes(secret), false);
});

test("account deletion sanitizes response metadata before clearing native identity and cookies", async (t) => {
  const { http, login } = await setup(t, { handle: (request, resource) => {
    if (resource === "/api/v1/auth/me" && request.method === "DELETE") return json(200, { status: "success", [JWT]: SECRET },
      { "content-type": `application/json; reflected=${JWT}`, "retry-after": SECRET });
  } });
  const marker = await login();
  const response = await http("/auth/me", { method: "DELETE", token: marker });
  assert.equal(response.status, 200);
  for (const secret of [JWT, SECRET]) assert.equal(JSON.stringify(response).includes(secret), false);
  await assert.rejects(http("/conferences", { method: "GET", token: marker }), /authentication_required/);
});

test("logout fences a delayed login response before it can restore local credentials", async (t) => {
  let release, started;
  const ready = new Promise((resolve) => { started = resolve; });
  const { broker, http } = await setup(t, { handle: async (_request, resource) => {
    if (resource !== "/api/v1/auth/login") return;
    started(); await new Promise((resolve) => { release = resolve; });
    return json(200, { accessToken: JWT, expiresIn: 3600, user: { id: USER } }, { "set-cookie": [setCookie("meetrix_session", SECRET)] });
  } });
  const login = http("/auth/login", { body: {} }); const rejected = assert.rejects(login, /stale_request/); await ready;
  await http("/auth/logout", { body: {} }); release(); await rejected;
  await assert.rejects(broker.http({ id: "private", method: "GET", path: "/api/v1/conferences", responseType: "json", token: "desktop-session:old" }), /authentication_required/);
});

test("session-bootstrap 401 completes rather than waiting on its own auth queue", async (t) => {
  const { http, login } = await setup(t); const marker = await login();
  const result = await Promise.race([http("/auth/session", { token: marker, body: {} }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("auth deadlock")), 1000); timer.unref(); })]);
  assert.equal(result.status, 401);
});

test("transient WebSocket close reasons retain reconnect semantics and unknown detail is suppressed", async (t) => {
  const { broker, sockets, events, login } = await setup(t); const marker = await login();
  for (const reason of ["broker_unavailable", "state_unavailable", "authentication_unavailable", "authentication_expired", "secret backend URL https://internal.invalid/token"]) {
    const id = randomUUID(); await broker.socketOpen({ id, kind: "account", token: marker });
    sockets.at(-1).emit("close", 1008, Buffer.from(reason));
    const last = events.at(-1); assert.equal(last.type, "close"); assert.equal(last.code, 1008); assert.equal(last.reason, reason.startsWith("secret") ? "" : reason);
  }
});

test("logout clears main identity even if OS encryption becomes unavailable during the session", async (t) => {
  const encryption = cipher(); let available = true; encryption.isAvailable = () => available;
  const { broker, http, login } = await setup(t, { cipher: encryption }); const marker = await login(); available = false;
  await assert.rejects(http("/auth/logout", { body: { userId: USER } }), /secure_storage_unavailable/);
  assert.equal(broker.serversState().storageAvailable, false);
  await assert.rejects(broker.http({ id: "after-logout", method: "GET", path: "/api/v1/conferences", responseType: "json", token: marker }), /authentication_required/);
});

test("guest logout preserves a separately saved account cookie for explicit later restoration", async (t) => {
  const guestToken = "fixture-guest-token-" + "g".repeat(40);
  const { http, login, calls } = await setup(t, { handle: (_request, resource) => resource.endsWith("/guest") ? json(201, { accessToken: guestToken, expiresIn: 3600, user: { id: OTHER, isGuest: true }, item: { id: OTHER } }) : undefined });
  await login();
  const guest = await http(`/conference-invites/${"x".repeat(32)}/guest`, { body: { displayName: "Guest" } });
  assert.match(guest.body.accessToken, /^desktop-session:/);
  await http("/auth/logout", { body: { userId: OTHER } });
  const restored = await http("/auth/refresh", { body: { userId: USER } });
  assert.equal(restored.body.user.id, USER);
  const refreshRequest = calls.findLast((request) => request.url.endsWith("/auth/refresh"));
  assert.match(refreshRequest.headers.Cookie, new RegExp(SECRET));
  assert.equal(calls.filter((request) => request.url.endsWith("/auth/logout")).length, 0, "guest has no durable session to revoke");
});

test("Chromium native-only metadata filter removes Sec-Fetch while retaining main-owned auth headers", async () => {
  const { createElectronTransport } = require("../dist/network/transport.js");
  let listener, nativeRequest, sentHeaders;
  const session = { webRequest: { onBeforeSendHeaders(value) { listener = value; } } };
  const net = { request() {
    nativeRequest = new EventEmitter(); nativeRequest.setHeader = () => {}; nativeRequest.abort = () => {};
    nativeRequest.end = () => {};
    return nativeRequest;
  } };
  const transport = createElectronTransport(net, session);
  const controller = new AbortController();
  const pending = transport.request({ url: "https://native.fixture/api/v1/auth/accounts/list", method: "POST", headers: { Cookie: "main-owned", Authorization: "Bearer main-owned" }, signal: controller.signal, maxResponseBytes: 100 });
  const rejected = assert.rejects(pending, /request_cancelled/);
  const details = { method: "POST", url: "https://native.fixture/api/v1/auth/accounts/list", requestHeaders: { "Sec-Fetch-Site": "none", "sec-fetch-mode": "no-cors", "Sec-Fetch-Dest": "empty", Cookie: "main-owned", Authorization: "Bearer main-owned", "Content-Type": "application/json" } };
  listener(details, (result) => { sentHeaders = result; });
  assert.deepEqual(sentHeaders, { requestHeaders: { Cookie: "main-owned", Authorization: "Bearer main-owned", "Content-Type": "application/json" } });
  for (const changed of [{ webContentsId: 42 }, { webContents: {} }, { frame: {} }, { url: "https://other.fixture/api/v1/auth/accounts/list" }, { method: "DELETE" }, { requestHeaders: { Origin: "https://native.fixture" } }]) {
    listener({ ...details, ...changed }, (result) => assert.deepEqual(result, { cancel: true }));
  }
  controller.abort(); await rejected;
  listener(details, (result) => assert.deepEqual(result, { cancel: true }, "completed/cancelled requests cannot authorize new network traffic"));
});
