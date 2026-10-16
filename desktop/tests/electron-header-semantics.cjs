// Raw Electron API semantics only. Local HTTP is deliberate: no TLS bypass,
// production bridge, production credentials, or remote service is involved.
const assert = require("node:assert/strict");
const http = require("node:http");
const { app, net, session } = require("electron");

(async () => {
  await app.whenReady();
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push(request.headers);
    request.resume();
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": "fixture_ambient=must-not-stick; Path=/; HttpOnly; SameSite=Lax",
    });
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/header-semantics`;
  const isolated = session.fromPartition("meetspace-header-semantics");
  await isolated.cookies.set({ url, name: "fixture_existing", value: "must-not-leak" });
  const request = (headers) => new Promise((resolve, reject) => {
    const outgoing = net.request({ url, method: "POST", session: isolated,
      credentials: "omit", useSessionCookies: false, cache: "no-store", redirect: "error" });
    for (const [name, value] of Object.entries(headers)) outgoing.setHeader(name, value);
    outgoing.once("error", reject);
    outgoing.once("response", (response) => {
      response.on("error", reject);
      response.resume();
      response.once("end", () => resolve(response));
    });
    outgoing.end("{}");
  });
  try {
    const response = await request({ "Content-Type": "application/json",
      Cookie: "fixture_manual=test-cookie-canary", Authorization: "Bearer test-bearer-canary" });
    assert.equal(response.statusCode, 200);
    assert.equal(seen[0].cookie, "fixture_manual=test-cookie-canary");
    assert.equal(seen[0].authorization, "Bearer test-bearer-canary");
    assert.ok(response.headers["set-cookie"], "manual cookie vault can inspect Set-Cookie");
    await request({ "Content-Type": "application/json" });
    assert.equal(seen[1].cookie, undefined, "session cookies must not be sent implicitly");
    assert.equal(seen[1].authorization, undefined, "authorization must not leak between requests");
    assert.equal((await isolated.cookies.get({ url })).some((cookie) => cookie.name === "fixture_ambient"), false,
      "response cookie must not enter Chromium's ambient jar");
    console.log(JSON.stringify({ result: "PASS", electron: process.versions.electron,
      manualCookiePreserved: true, manualBearerPreserved: true, setCookieVisible: true,
      ambientCookieSent: false, ambientCookieStored: false,
      automaticOrigin: seen[0].origin ?? null,
      automaticFetchMetadata: Object.fromEntries(Object.entries(seen[0]).filter(([name]) => name.startsWith("sec-fetch-"))),
    }));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  app.exit(0);
})().catch((error) => { console.error("Raw Electron header semantics failed:", error.message); app.exit(1); });
