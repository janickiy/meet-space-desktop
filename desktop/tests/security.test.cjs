"use strict";

const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { mkdtemp, mkdir, writeFile, symlink, rm } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  isAppUrl, isTrustedRendererUrl, isAllowedRoute, isAllowedNavigation,
  isAllowedExternalUrl, parseDeepLink, contentSecurityPolicy,
  isTrustedSender, isSupportedWindows,
} = require("../dist/security.js");
const { serveAppRequest } = require("../dist/protocol.js");

let temporary;
let rendererRoot;
const index = "<!doctype html><title>MeetSpace fixture</title><main>Local UI</main>";
const script = "globalThis.__meetspaceBundledFixture = true;";
const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "meetspace-security-"));
  rendererRoot = path.join(temporary, "renderer");
  await mkdir(path.join(rendererRoot, "assets"), { recursive: true });
  await writeFile(path.join(rendererRoot, "index.html"), index);
  await writeFile(path.join(rendererRoot, "assets", "app.js"), script);
  await writeFile(path.join(rendererRoot, "assets", "app.css"), "body { color: #111; }");
  await writeFile(path.join(rendererRoot, "assets", "font.woff2"), Buffer.from([1, 2, 3]));
  await writeFile(path.join(rendererRoot, "assets", "logo.png"), image);
  await writeFile(path.join(rendererRoot, "private.txt"), "not a permitted asset type");
  await writeFile(path.join(temporary, "outside.js"), "OUTSIDE_PRIVATE_FIXTURE");
});

after(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

// A raw request object deliberately preserves traversal syntax that Request/URL
// otherwise normalizes before it reaches the handler.
function request(url, method = "GET", extras = {}) {
  return serveAppRequest({ url, method, ...extras }, rendererRoot);
}

function rejectsAll(check, values) {
  for (const value of values) assert.equal(check(value), false, String(value));
}

test("local origin accepts only the exact registered application authority", () => {
  for (const url of ["app://meetspace", "app://meetspace/", "app://meetspace/assets/app.js"])
    assert.equal(isAppUrl(url), true, url);
  rejectsAll(isAppUrl, [
    null, undefined, 1, {}, "", "not a URL", "app:/meetspace/", "app://MEETSPACE/",
    "app://meetspace.evil/", "app://evil.meetspace/", "app://meetspace:443/",
    "app://user@meetspace/", "app://user:pass@meetspace/", "file:///index.html",
    "https://meetspace/", "app://meetspace\\evil/", "app://meetspace/\n",
    "app://meetspace/\u0000", " app://meetspace/", "app://meetspace/" + "a".repeat(2048),
  ]);
});

test("development renderer is opt-in and bound to one loopback origin", () => {
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5173/", true), true);
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5173/app?mode=desktop", true), true);
  rejectsAll((url) => isTrustedRendererUrl(url, true), [
    "app://meetspace/", "http://localhost:5173/", "http://127.0.0.1:5174/",
    "https://127.0.0.1:5173/", "http://127.0.0.1:5173.evil/",
    "http://127.0.0.1:5173@evil.example/", "http://user@127.0.0.1:5173/",
    "http://2130706433:5173/", "http://127.1:5173/", "http://[::1]:5173/",
  ]);
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5173/", false), false);
  assert.equal(isTrustedRendererUrl("app://meetspace/app", false), true);
});

test("SPA routing allows application destinations but not files or commands", () => {
  for (const route of [
    "/", "/login", "/register", "/register/success", "/app", "/app/settings",
    "/personal", "/personal/alice-123", "/folders/team_1", "/recordings/record-1",
    "/meetings", "/meetings/new", "/meetings/meeting-1/join", "/i/invite_A-2",
    "/app/settings/calendar/google/callback",
  ]) assert.equal(isAllowedRoute(route), true, route);
  rejectsAll(isAllowedRoute, [
    null, {}, "app", "//app", "/assets/app.js", "/api/v1/auth/login",
    "/unknown", "/app/../../etc", "/app%2fsettings", "/i/a/b", "/i/",
    "/app?token=secret", "/app#fragment", "/i/a\\b", "/i/a b", "/i/a\n",
    "/i/" + "a".repeat(161), "/app/settings/calendar/evil/callback",
  ]);
});

test("navigation requires a trusted origin and an allowed SPA route", () => {
  assert.equal(isAllowedNavigation("app://meetspace/app"), true);
  assert.equal(isAllowedNavigation("app://meetspace/i/code"), true);
  rejectsAll(isAllowedNavigation, [
    "app://meetspace/assets/app.js", "app://meetspace/unknown", "app://meetspace/api/v1/auth/me",
    "https://meeting.janickiy.com/app", "http://127.0.0.1:5173/app",
    "javascript:alert(1)", "data:text/html,example", "file:///tmp/index.html",
  ]);
  assert.equal(isAllowedNavigation("http://127.0.0.1:5173/app", true), true);
  assert.equal(isAllowedNavigation("http://127.0.0.1:5173/unknown", true), false);
  assert.equal(isAllowedNavigation("app://meetspace/app", true), false);
});

test("external links cannot change the trusted HTTPS authority or invoke local handlers", () => {
  for (const url of ["https://meeting.janickiy.com", "https://meeting.janickiy.com/", "https://meeting.janickiy.com/i/invite_A-2"])
    assert.equal(isAllowedExternalUrl(url), true, url);
  rejectsAll(isAllowedExternalUrl, [
    null, [], "https://meeting.janickiy.com.evil.example/", "https://evil.meeting.janickiy.com/",
    "https://meeting.janickiy.com@evil.example/", "https://user:pass@meeting.janickiy.com/",
    "https://meeting.janickiy.com:444/", "http://meeting.janickiy.com/",
    "https://meeting.janickiy.com./", "https://meeting.janickiy.com/encoded%2fpath",
    "https://meeting.janickiy.com/%2e%2e/app", "https://meeting.janickiy.com/./%2E./app",
    "https://meeting.janickiy.com/%252e%252e/app", "https://meeting.janickiy.com/%GG",
    "https://meeting.janickiy.com/#secret", "https://meeting.janickiy.com/\n",
    "https://meeting.janickiy.com\\evil.example/", "javascript:alert(1)",
    "file:///C:/Windows/System32/cmd.exe", "data:text/html,test", "mailto:test@example.invalid",
  ]);
});

test("external links are bound to the selected server origin including its port", () => {
  assert.equal(isAllowedExternalUrl("https://janickiy.com/"), true);
  for (const value of ["https://janickiy.com/extra", "https://janickiy.com/?token=x", "https://janickiy.com/#extra", "https://janickiy.com.evil/", "http://janickiy.com/"])
    assert.equal(isAllowedExternalUrl(value), false);
  assert.equal(isAllowedExternalUrl("https://letsencrypt.org/repository/"), true);
  for (const suffix of ["?next=https://evil.invalid", "#extra", "../", "extra"])
    assert.equal(isAllowedExternalUrl("https://letsencrypt.org/repository/" + suffix), false);
  const selected = "https://meet.example.com:8443";
  assert.equal(isAllowedExternalUrl(selected + "/i/invite_A-2", selected), true);
  assert.equal(isAllowedExternalUrl("https://meeting.janickiy.com/app", selected), false);
  assert.equal(isAllowedExternalUrl("https://meet.example.com/app", selected), false);
  assert.equal(isAllowedExternalUrl(selected + ".evil/app", selected), false);
  assert.equal(isAllowedExternalUrl(selected + "/%2e%2e/app", selected), false);
  assert.equal(isAllowedExternalUrl("http://meet.example.com/app", "http://meet.example.com"), false);
});

test("deep links contain only a bounded invitation route", () => {
  const mixedCode = "AbC_123-".repeat(4);
  assert.equal(parseDeepLink("meetspace://open/i/" + mixedCode), "/i/" + mixedCode);
  assert.equal(parseDeepLink("meetspace://open/i/" + "a".repeat(32)), "/i/" + "a".repeat(32));
  for (const value of [
    null, 3, {}, "", "meetspace://open/app", "meetspace://open/i/",
    "meetspace://open/i/" + "a".repeat(31), "meetspace://open/i/" + "a".repeat(33), "meetspace://evil/i/code",
    "meetspace://open:443/i/code", "meetspace://user@open/i/code",
    "meetspace://open/i/code?token=secret", "meetspace://open/i/code#fragment",
    "meetspace://open/i/a/b", "meetspace://open/i/a%2fb", "meetspace://open/i/%252e%252e",
    "meetspace://open/i/../app", "meetspace://open/i/code/", "meetspace://open/i/a b",
    "meetspace://open/i/a\n", "meetspace://open/i/a\\b", "https://open/i/code",
    "meetspace:open/i/code", "meetspace://open/i/code --inspect", "MEETSPACE://open/i/code",
  ]) assert.equal(parseDeepLink(value), null, String(value));
});

test("meeting deep links preserve prejoin destination and reject commands and parameters", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  for (const kind of ["meetings", "conferences"])
    assert.equal(parseDeepLink(`meetspace://open/${kind}/${id}/join`), `/${kind}/${id}/join`);
  for (const suffix of [`meetings/${id}`, `meetings/${id}/join?token=secret`, `meetings/${id}/join#secret`,
    `meetings/${id}/join/`, "meetings/not-an-id/join", `meetings/%31${id.slice(1)}/join`, `meetings/${id}/../join`])
    assert.equal(parseDeepLink(`meetspace://open/${suffix}`),null);
});

test("production CSP permits no remote executable code or development socket", () => {
  const policy = contentSecurityPolicy(false);
  const directives = new Map(policy.split("; ").map((item) => {
    const [name, ...values] = item.split(" "); return [name, values];
  }));
  for (const name of ["default-src", "object-src", "base-uri", "form-action", "frame-src", "frame-ancestors"])
    assert.deepEqual(directives.get(name), ["'none'"], name);
  for (const name of ["script-src", "style-src", "connect-src"])
    assert.deepEqual(directives.get(name), ["'self'"], name);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|https?:|wss?:|\*/);
});

test("development CSP requires a generated nonce without relaxing script policy", () => {
  for (const nonce of [undefined, "", "'unsafe-inline'", "a".repeat(47), "a".repeat(49), "z".repeat(48)])
    assert.throws(() => contentSecurityPolicy(true, nonce), /nonce/i);
  const nonce = "12ab".repeat(12);
  const policy = contentSecurityPolicy(true, nonce);
  assert.ok(policy.includes("script-src 'self' 'nonce-" + nonce + "'"));
  assert.ok(policy.includes("style-src 'self' 'nonce-" + nonce + "'"));
  assert.ok(policy.includes("connect-src 'self' ws://127.0.0.1:5173"));
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|\*/);
});

function senderFixture(url = "app://meetspace/") {
  const mainFrame = { url };
  const webContents = { mainFrame, isDestroyed: () => false };
  const window = { webContents, isDestroyed: () => false };
  return { window, event: { sender: webContents, senderFrame: mainFrame } };
}

test("IPC trusts only the active window main frame, not a same-origin iframe", () => {
  const { window, event } = senderFixture();
  assert.equal(isTrustedSender(event, window), true);
  assert.equal(isTrustedSender({ ...event, senderFrame: { url: "app://meetspace/" } }, window), false);
  assert.equal(isTrustedSender({ ...event, sender: {} }, window), false);
  assert.equal(isTrustedSender({ sender: event.sender }, window), false);
  assert.equal(isTrustedSender({ ...event, senderFrame: null }, window), false);
  assert.equal(isTrustedSender(event, null), false);
  const another = senderFixture();
  assert.equal(isTrustedSender(another.event, window), false);
});

test("IPC rejects destroyed windows and main-frame navigations outside the active mode", () => {
  const first = senderFixture();
  first.window.isDestroyed = () => true;
  assert.equal(isTrustedSender(first.event, first.window), false);
  const second = senderFixture();
  second.window.webContents.isDestroyed = () => true;
  assert.equal(isTrustedSender(second.event, second.window), false);
  for (const url of ["https://meeting.janickiy.com/", "file:///tmp/index.html", "http://127.0.0.1:5173/"]) {
    const { event, window } = senderFixture(url);
    assert.equal(isTrustedSender(event, window), false, url);
  }
  const dev = senderFixture("http://127.0.0.1:5173/");
  assert.equal(isTrustedSender(dev.event, dev.window, true), true);
  const local = senderFixture();
  assert.equal(isTrustedSender(local.event, local.window, true), false);
});

test("Windows admission preserves all required targets and rejects Win10 ARM64 and x86", () => {
  assert.equal(isSupportedWindows("10.0.19045", "x64"), true);
  assert.equal(isSupportedWindows("10.0.22000", "x64"), true);
  assert.equal(isSupportedWindows("10.0.26100", "arm64"), true);
  for (const [version, arch] of [
    ["10.0.19045", "arm64"], ["10.0.19044", "x64"], ["10.0.19045", "ia32"],
    ["10.0.26100", "ia32"], ["6.3.9600", "x64"], ["10.0.bad", "x64"],
    ["10.0.19045.extra", "x64"], ["10.0.26100", "unknown"],
  ]) assert.equal(isSupportedWindows(version, arch), false, `${version}/${arch}`);
});

test("protocol serves the bundled index only for allowed SPA routes", async () => {
  for (const route of ["/", "/app", "/personal/user-1", "/meetings/meeting-1/join", "/i/invite-code"]) {
    const response = await request("app://meetspace" + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("Content-Type"), /^text\/html/);
    assert.equal(await response.text(), index);
  }
  for (const route of ["/unknown", "/assets/missing.js", "/private.txt", "/missing.html"])
    assert.equal((await request("app://meetspace" + route)).status, 404, route);
});

test("protocol returns actual assets with explicit MIME and exact bytes", async () => {
  const expectations = [
    ["app.js", "text/javascript; charset=utf-8"], ["app.css", "text/css; charset=utf-8"],
    ["font.woff2", "font/woff2"], ["logo.png", "image/png"],
  ];
  for (const [name, mime] of expectations) {
    const response = await request("app://meetspace/assets/" + name);
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get("Content-Type"), mime);
    assert.ok(Number(response.headers.get("Content-Length")) > 0);
  }
  assert.equal(await (await request("app://meetspace/assets/app.js")).text(), script);
  assert.deepEqual(Buffer.from(await (await request("app://meetspace/assets/logo.png")).arrayBuffer()), image);
});

test("protocol applies protective response headers to success and rejection", async () => {
  for (const [url, method] of [["app://meetspace/", "GET"], ["app://meetspace/missing", "GET"], ["app://meetspace/", "POST"]]) {
    const response = await request(url, method);
    assert.equal(response.headers.get("Content-Security-Policy"), contentSecurityPolicy(false));
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("protocol HEAD retains metadata without returning asset bytes", async () => {
  for (const route of ["/app", "/assets/app.js"]) {
    const response = await request("app://meetspace" + route, "HEAD");
    assert.equal(response.status, 200);
    assert.ok(Number(response.headers.get("Content-Length")) > 0);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});

test("protocol denies mutable methods instead of treating requests as local reads", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT"])
    assert.equal((await request("app://meetspace/assets/app.js", method)).status, 405, method);
});

test("protocol rejects a foreign authority and explicit foreign initiators", async () => {
  for (const url of [
    "https://meeting.janickiy.com/", "file:///tmp/index.html", "app://evil/",
    "app://meetspace:443/", "app://user@meetspace/", "app://meetspace.evil/",
  ]) assert.equal((await request(url)).status, 403, url);
  assert.equal((await request("app://meetspace/", "GET", { initiatorOrigin: "app://meetspace" })).status, 200);
  for (const initiatorOrigin of ["https://evil.example", "null", "", "http://127.0.0.1:5173"])
    assert.equal((await request("app://meetspace/", "GET", { initiatorOrigin })).status, 403, initiatorOrigin);
});

test("protocol blocks raw, encoded, double-encoded and malformed traversal", async () => {
  for (const suffix of [
    "/../outside.js", "/assets/../../outside.js", "/./assets/app.js",
    "/%2e%2e/outside.js", "/%252e%252e/outside.js", "/assets%2fapp.js",
    "/assets/%5c..%5coutside.js", "/%00assets/app.js", "/assets/%", "/assets/%ZZ.js",
    "/assets\\..\\..\\outside.js",
  ]) {
    const response = await request("app://meetspace" + suffix);
    assert.ok([400, 403].includes(response.status), suffix + ": " + response.status);
    assert.doesNotMatch(await response.text(), /OUTSIDE_PRIVATE_FIXTURE/);
  }
});

test("protocol never follows an asset symlink outside the renderer root", async (t) => {
  try {
    await symlink(path.join(temporary, "outside.js"), path.join(rendererRoot, "assets", "escape.js"));
  } catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) {
      t.skip("Creating a symlink requires Windows developer mode or privileges"); return;
    }
    throw error;
  }
  const response = await request("app://meetspace/assets/escape.js");
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /OUTSIDE_PRIVATE_FIXTURE/);
});

test("protocol rejects directories even when they have an allowed extension", async () => {
  await mkdir(path.join(rendererRoot, "assets", "folder.js"));
  assert.equal((await request("app://meetspace/assets/folder.js")).status, 404);
});

test("local protocol API requests cannot bypass the native transport", async () => {
  for (const route of ["/api", "/api/v1/auth/me", "/api/v1/conferences"]) {
    const response = await request("app://meetspace" + route);
    assert.equal(response.status, 403, route);
    assert.match(response.headers.get("Content-Type"), /^application\/json/);
    assert.deepEqual(await response.json(), { status: "failed", message: "Use the validated desktop transport" });
  }
});
