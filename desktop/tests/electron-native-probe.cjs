// Explicit read-only live check of the production Chromium network adapter.
// This is separate from the offline integration suite and sends no credentials.
const assert = require("node:assert/strict");
const { app, net, session } = require("electron");
const { createElectronTransport } = require("../dist/network/transport.js");
(async () => {
  await app.whenReady();
  const browserSession = session.fromPartition("meetspace-public-probe");
  let metadata = null;
  // Observe the final headers without replacing the production policy listener.
  browserSession.webRequest.onSendHeaders((details) => {
    if (new URL(details.url).pathname === "/api/v1/auth/accounts/list")
      metadata = Object.fromEntries(Object.entries(details.requestHeaders)
        .filter(([name]) => /^(origin|sec-fetch-[a-z-]+)$/i.test(name)));
  });
  const transport = createElectronTransport(net, browserSession);
  for (const [resource, expected] of [["/version", 200], ["/api/v1/auth/me", 401], ["/api/v1/capabilities", 401]]) {
    const response = await transport.request({ url: `https://meeting.janickiy.com${resource}`, method: "GET",
      headers: { Accept: "application/json" }, signal: new AbortController().signal, maxResponseBytes: 8192 });
    assert.equal(response.status, expected);
    const data = JSON.parse(Buffer.from(response.body).toString("utf8"));
    console.log(JSON.stringify({ resource, status: response.status, ...(resource === "/version" ? { version: data.version, commit: data.commit } : {}) }));
  }
  // Accounts/list is a read-only POST. With no cookies it must return no accounts;
  // it exercises the backend's Origin/Fetch Metadata guard without a sign-in attempt.
  const accounts = await transport.request({
    url: "https://meeting.janickiy.com/api/v1/auth/accounts/list", method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: Buffer.from("{}"), signal: new AbortController().signal, maxResponseBytes: 8192,
  });
  assert.equal(accounts.status, 200);
  assert.deepEqual(JSON.parse(Buffer.from(accounts.body).toString("utf8")).items, []);
  assert.deepEqual(metadata, {}, "production native-session policy removes browser metadata without forging Origin");
  console.log(JSON.stringify({ resource: "/api/v1/auth/accounts/list", method: "POST", status: accounts.status, accounts: 0 }));
  console.log("PASS: actual Electron Chromium transport, system TLS validation, read-only GET/POSTs without credentials or sign-in attempts.");
  app.exit(0);
})().catch((error) => { console.error("Native public probe failed:", error.message); app.exit(1); });
