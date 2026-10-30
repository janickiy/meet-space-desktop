// Offline integration fixture only. This deliberately small server models the
// repository's native-client contracts; it is not a substitute for Go API E2E.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const https = require("node:https");
const { execFileSync } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const { WebSocketServer } = require("ws");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const CONFERENCE = "33333333-3333-4333-8333-333333333333";
const INVITE = "a".repeat(32);
const PASSWORD = "test-fixture-password-only";

async function createCertificates() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meetspace-test-ca-"));
  const openssl = (...args) => execFileSync("openssl", args, { cwd: directory, stdio: "pipe" });
  try {
    await fs.writeFile(path.join(directory, "ca.cnf"),
      "[req]\ndistinguished_name=dn\nx509_extensions=ca\nprompt=no\n[dn]\nCN=MeetSpace disposable integration CA\n[ca]\nbasicConstraints=critical,CA:true\nkeyUsage=critical,keyCertSign,cRLSign\n");
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-sha256",
      "-config", "ca.cnf", "-keyout", "ca.key", "-out", "ca.pem");
    for (const [name, san] of [["server", "DNS:localhost,IP:127.0.0.1"], ["wrong-host", "DNS:wrong-host.invalid"]]) {
      openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256", "-subj", "/CN=MeetSpace disposable fixture",
        "-keyout", `${name}.key`, "-out", `${name}.csr`);
      await fs.writeFile(path.join(directory, `${name}.ext`),
        `basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
      openssl("x509", "-req", "-in", `${name}.csr`, "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
        "-out", `${name}.pem`, "-days", "2", "-sha256", "-extfile", `${name}.ext`);
    }
    const read = (file) => fs.readFile(path.join(directory, file));
    return {
      ca: await read("ca.pem"), key: await read("server.key"), cert: await read("server.pem"),
      wrongHost: { key: await read("wrong-host.key"), cert: await read("wrong-host.pem") },
      close: () => fs.rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function createFixture({ name, certificates, version = "1.0.0", malformedVersion = false, versionDelay = 0, ui = false, notifyOnConnect = false, notificationHeartbeatMs = 0, handleRequest }) {
  const requests = [];
  const sessions = new Map();
  const tokens = new Map();
  const guestUsers = new Map();
  const tickets = new Map();
  const sockets = new Set();
  const networkSockets = new Set();
  const streams = new Set();
  const heartbeatTimers = new Set();
  const heldRequests = new Set();
  const controls = { rejectTokenOnce: false, redirectNext: null, versionRedirect: null, holdConferences: false, failLogout: false, personalRevision: 1 };
  const users = [USER_A, USER_B].map((id, index) => ({
    id, email: `${name}-${index + 1}@fixture.invalid`, displayName: `${name} fixture ${index + 1}`, isAdmin: false,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  }));
  let origin;
  let closed = false;
  const send = (response, status, body, headers = {}) => {
    if (response.destroyed) return;
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    response.end(JSON.stringify(body));
  };
  const failure = (response, status = 401) => send(response, status, { status: "failed", message: status === 401 ? "unauthorized" : "fixture unavailable" });
  const cookieMap = (request) => Object.fromEntries((request.headers.cookie || "").split(/;\s*/).filter(Boolean).map((part) => {
    const i = part.indexOf("="); return [part.slice(0, i), part.slice(i + 1)];
  }));
  const cookie = (key, value) => `${key}=${value}; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${value ? 34560000 : 0}`;
  const loginResponse = (user, sessionToken) => {
    const accessToken = `fixture-jwt-${name}-${randomBytes(24).toString("hex")}`;
    tokens.set(accessToken, user.id);
    return { status: "success", accessToken, tokenType: "Bearer", expiresIn: 3600, user, sessionToken };
  };
  const issue = (response, user, existing) => {
    const sessionToken = existing || randomBytes(32).toString("base64url");
    sessions.set(sessionToken, user.id);
    const { sessionToken: omitted, ...body } = loginResponse(user, sessionToken);
    send(response, 200, body, { "Set-Cookie": [cookie("meetrix_session", sessionToken), cookie(`meetrix_account_${user.id}`, sessionToken)] });
  };
  const accountFromCookie = (request, userId) => {
    const jar = cookieMap(request);
    const raw = (userId && jar[`meetrix_account_${userId}`]) || jar.meetrix_session;
    const user = users.find((candidate) => candidate.id === sessions.get(raw));
    return { raw, user: user && (!userId || userId === user.id) ? user : undefined };
  };
  const http = https.createServer({ key: certificates.key, cert: certificates.cert }, async (request, response) => {
    const url = new URL(request.url, origin);
    requests.push({ method: request.method, path: url.pathname, query: url.search, headers: { ...request.headers } });
    let body = {};
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const attachmentUpload = request.method === "PUT" && /^\/api\/v1\/(conferences|conversations)\/[^/]+\/attachments\/[^/]+\/content$/.test(url.pathname);
      if (chunks.length) body = attachmentUpload || /^image\//.test(request.headers["content-type"] || "") ? Buffer.concat(chunks) : JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { return failure(response, 400); }
    if (request.headers.origin || request.headers["sec-fetch-site"]) return failure(response, 403);
    if (["/version", "/version.json"].includes(url.pathname)) {
      if (controls.versionRedirect) { response.writeHead(302, { Location: controls.versionRedirect }); return response.end(); }
      if (versionDelay) await new Promise((resolve) => setTimeout(resolve, versionDelay));
      return send(response, 200, malformedVersion ? { arbitrary: true } : { version, commit: "f".repeat(40), buildTime: "2026-01-01T00:00:00Z" });
    }
    if (url.pathname === "/api/v1/auth/login" && request.method === "POST") {
      const user = users.find((candidate) => candidate.email === body.email);
      return user && body.password === PASSWORD ? issue(response, user) : failure(response);
    }
    if (url.pathname === `/api/v1/conference-invites/${INVITE}/guest` && request.method === "POST") {
      const bearer = request.headers.authorization?.replace(/^Bearer /, "");
      let user = bearer ? guestUsers.get(tokens.get(bearer)) : undefined;
      if (bearer && !user) return failure(response, 403);
      if (!user) {
        user = { ...users[0], id: randomUUID(), email: "", displayName: body.displayName, guestConferenceId: CONFERENCE };
        guestUsers.set(user.id, user);
      }
      const { sessionToken: omitted, ...login } = loginResponse(user);
      return send(response, 200, { ...login, item: {
        id: "66666666-6666-4666-8666-666666666666", conferenceId: CONFERENCE, userId: user.id,
        displayName: user.displayName, role: "participant", status: "joined", joinedAt: "2026-01-01T00:00:00Z", leftAt: null,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", microphoneEnabled: false, cameraEnabled: false,
        screenSharing: false, microphoneBlocked: false, cameraBlocked: false, screenBlocked: false, mediaPolicyVersion: 1,
        admissionState: "admitted", admissionDecidedAt: null, admissionVersion: 1,
      } });
    }
    if (["/api/v1/auth/refresh", "/api/v1/auth/session", "/api/v1/auth/accounts/switch"].includes(url.pathname)) {
      const { raw, user } = accountFromCookie(request, body.userId);
      return user ? issue(response, user, raw) : failure(response);
    }
    if (url.pathname === "/api/v1/auth/accounts/list") {
      const ids = new Set(Object.values(cookieMap(request)).map((raw) => sessions.get(raw)));
      return send(response, 200, { status: "success", items: users.filter((user) => ids.has(user.id)) });
    }
    if (url.pathname === "/api/v1/auth/logout") {
      if (controls.failLogout) return failure(response, 503);
      const { raw, user } = accountFromCookie(request, body.userId);
      sessions.delete(raw);
      if (user) for (const [token, id] of tokens) if (id === user.id) tokens.delete(token);
      return send(response, 200, { status: "success" }, { "Set-Cookie": [cookie("meetrix_session", ""), ...(user ? [cookie(`meetrix_account_${user.id}`, "")] : [])] });
    }
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    const user = users.find((candidate) => candidate.id === tokens.get(token)) || guestUsers.get(tokens.get(token));
    if (!user) return failure(response);
    if (controls.rejectTokenOnce) { controls.rejectTokenOnce = false; tokens.delete(token); return failure(response); }
    if (controls.redirectNext) {
      const destination = controls.redirectNext; controls.redirectNext = null;
      response.writeHead(302, { Location: destination }); return response.end();
    }
    if (url.pathname === "/api/v1/auth/me") return send(response, 200, { user });
    if (handleRequest && await handleRequest({ request, response, url, body, user, send })) return;
    if (url.pathname === "/api/v1/capabilities") return send(response, 200, { status: "success", capabilities: {
      liveCaptions: false, transcription: false, aiSummary: false, semanticSearch: false,
      meetingAnalytics: false, recordingModes: ["composite"],
    }, buildVersion: version });
    if (url.pathname === "/api/v1/ws-ticket" || url.pathname === `/api/v1/conferences/${CONFERENCE}/ws-ticket`) {
      const ticket = randomBytes(32).toString("base64url");
      tickets.set(ticket, { userId: user.id, type: url.pathname === "/api/v1/ws-ticket" ? "account" : "conference" });
      return send(response, 201, { ticket, expiresAt: new Date(Date.now() + 45000).toISOString() });
    }
    if (url.pathname === "/api/v1/notifications/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      response.write(": connected\n\n");
      streams.add(response); response.once("close", () => streams.delete(response));
      // Profiles compare steady connected states. Other fixtures deliberately stay
      // quiet to exercise the client's idle timeout and reconnect behavior.
      if (notificationHeartbeatMs > 0) {
        const timer = setInterval(() => {
          if (!response.destroyed && !response.writableEnded) response.write(": heartbeat\n\n");
        }, notificationHeartbeatMs);
        timer.unref();
        heartbeatTimers.add(timer);
        response.once("close", () => { clearInterval(timer); heartbeatTimers.delete(timer); });
      }
      if (notifyOnConnect) response.write(`data: ${JSON.stringify({ id: `fixture-${name}-notification`, fixture: name })}\n\n`);
      return;
    }
    if (ui && url.pathname === "/api/v1/conversations") return send(response, 200, {
      status: "success", items: [{
        id: "55555555-5555-4555-8555-555555555555", type: "direct",
        peer: { id: USER_B, displayName: `${name} peer ${controls.personalRevision}` },
        createdAt: "2026-01-01T00:00:00Z", lastMessageAt: null, lastMessageId: null,
        preview: `${name} private preview ${controls.personalRevision}`, unreadCount: 0,
        notificationsEnabled: true, historyClearedThrough: 0,
      }], nextCursor: null, unreadCount: 0,
    });
    if (ui && url.pathname === "/api/v1/notifications") return send(response, 200, { items: [], nextCursor: null, unreadCount: 0 });
    if (ui && url.pathname === "/api/v1/calls/active") return send(response, 200, { item: null });
    if (ui && url.pathname === "/api/v1/folders") return send(response, 200, { items: [] });
    if (ui && url.pathname === "/api/v1/me/conferences") return send(response, 200, { items: [], nextCursor: null });
    if (url.pathname === `/api/v1/conferences/${CONFERENCE}/recordings`) {
      return send(response, 200, { status: "success", items: [{ id: "44444444-4444-4444-8444-444444444444", downloadUrl: `${origin}/storage/test%20fixture.webm?X-Amz-Signature=fixture-signature&X-Amz-Credential=a%2Fb` }] });
    }
    if (url.pathname === "/api/v1/conferences") {
      if (controls.holdConferences) { heldRequests.add(response); response.once("close", () => heldRequests.delete(response)); return; }
      return send(response, 200, { status: "success", items: [], fixtureServer: name, fixtureUser: user.id });
    }
    return failure(response, 404);
  });
  http.on("connection", (socket) => { networkSockets.add(socket); socket.once("close", () => networkSockets.delete(socket)); });
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  http.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, origin);
    requests.push({ method: "UPGRADE", path: url.pathname, query: url.search, headers: { ...request.headers } });
    const ticket = tickets.get(url.searchParams.get("ticket"));
    tickets.delete(url.searchParams.get("ticket"));
    const conference = url.pathname === `/api/v1/conferences/${CONFERENCE}/ws`;
    if (!ticket || request.headers.authorization || request.headers.cookie || request.headers.origin ||
        request.headers["sec-fetch-site"] || url.searchParams.size !== 1 ||
        (conference ? ticket.type !== "conference" || request.headers["sec-websocket-protocol"] !== "go-recorder.v1" : url.pathname !== "/api/v1/ws" || ticket.type !== "account")) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      sockets.add(client); client.once("close", () => sockets.delete(client));
      client.on("message", (message) => client.send(message));
      client.send(JSON.stringify({ id: `fixture-${name}`, version: 1, type: "fixture.ready", userId: ticket.userId,
        ...(conference ? { conferenceId: CONFERENCE } : {}), timestamp: new Date().toISOString(), data: {} }));
    });
  });
  await new Promise((resolve, reject) => { http.once("error", reject); http.listen(0, "127.0.0.1", resolve); });
  origin = `https://127.0.0.1:${http.address().port}`;
  return {
    origin, users, requests, sessions, tokens, tickets, controls, sockets, streams, heldRequests,
    notify: (data) => { for (const stream of streams) stream.write(`data: ${JSON.stringify(data)}\n\n`); },
    close: async () => {
      if (closed) return;
      closed = true;
      for (const timer of heartbeatTimers) clearInterval(timer);
      heartbeatTimers.clear();
      for (const stream of streams) stream.destroy();
      for (const socket of sockets) socket.terminate();
      for (const socket of networkSockets) socket.destroy();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => http.close(resolve));
    },
  };
}

module.exports = { createCertificates, createFixture, USER_A, USER_B, CONFERENCE, INVITE, PASSWORD };
