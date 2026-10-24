// Shared production React, isolated TLS fixture and native-save IPC completion seam.
// No live account, private file URL, operating-system dialog or network download is used.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const WebSocket = require("ws");
const { app, ipcMain } = require("electron");
assert.ok(path.isAbsolute(process.argv[2]));
app.setPath("userData", process.argv[2]);
app.setPath("sessionData", process.argv[2]);
const { startApp } = require("../dist/main.js");
const { createNodeHttpsTransport } = require("../dist/network/transport.js");
const { createCertificates, createFixture, PASSWORD, USER_A, USER_B } = require("./fixtures/https-fixture.cjs");
const { DIRECT, GROUP, ATTACHMENT } = require("./fixtures/product-fixture.cjs");
const EARLIER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DELETED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const now = new Date().toISOString();
const attachment = (id, filename) => ({ id, filename, mimeType: "application/pdf", size: 1280, status: "ready" });
const visibleFile = attachment(ATTACHMENT, "Project brief.pdf");
const earlierFile = attachment(EARLIER, "Earlier report.pdf");
const deletedFile = attachment(DELETED, "Deleted confidential.pdf");
const direct = { id: DIRECT, type: "direct", peer: { id: USER_B, displayName: "Design peer" }, createdAt: now,
  lastMessageAt: now, lastMessageId: null, preview: "Authorized conversation", unreadCount: 0, notificationsEnabled: true, historyClearedThrough: 0 };
const group = { id: GROUP, type: "group", name: "Design group", description: "Authorized team", createdBy: USER_A,
  createdAt: now, updatedAt: now, lastMessageAt: now, lastMessageId: null, preview: "Authorized team conversation", unreadCount: 0,
  memberCount: 2, myRole: "owner", avatarVersion: null, lastSender: null };
const message = (conversationId, id, file, deletedAt = null) => ({ id, sequence: id === EARLIER ? "1" : "2", conversationId,
  senderId: USER_B, senderName: "Design peer", text: "Authorized message", attachments: [file],
  createdAt: now, updatedAt: now, editedAt: null, deletedAt, version: 1, important: false, replyTo: null });

(async () => {
  let cert, fixture, window;
  const saves = [], checks = [];
  const controls = { deny: 0, deniedConversation: DIRECT };
  const output = path.resolve(__dirname, "../artifacts/design-v2-chat-profiles");
  const watchdog = setTimeout(() => { console.error("Conversation files QA timeout"); app.exit(1); }, 90000);
  try {
    cert = await createCertificates();
    fixture = await createFixture({ name: "conversation-files", certificates: cert, ui: true,
      handleRequest: async ({ response, url, send }) => {
        const route = url.pathname.slice("/api/v1".length);
        const reply = (body, status = 200) => { send(response, status, { status: "success", ...body }); return true; };
        if (route === "/notifications/preferences") return reply({ invitation: true, reminder: true, recording: true, summary: true });
        if (route === "/conversations") return reply({ items: [direct, group], nextCursor: null, unreadCount: 0 });
        for (const item of [direct, group]) {
          if (route === `/conversations/${item.id}`) return reply({ item });
          if (route === `/conversations/${item.id}/members`) return reply({ items: [{ id: USER_A, displayName: "Design owner", role: "owner", online: false }, { id: USER_B, displayName: "Design peer", role: "member", online: false }] });
          if (route === `/conversations/${item.id}/peer-presence`) return reply({ item: { conversationId: item.id, peerId: USER_B, online: false } });
          if (/\/read$/.test(route) && route.startsWith(`/conversations/${item.id}/`)) return reply({ item: { conversationId: item.id, unreadCount: 0, lastReadSequence: "2", lastReadMessageId: ATTACHMENT } });
          if (route === `/conversations/${item.id}/messages`) {
            if (controls.deny && controls.deniedConversation === item.id) return reply({ status: "failed", message: "Conversation access removed" }, controls.deny);
            const earlier = url.searchParams.has("before");
            return reply({ items: earlier
              ? [message(item.id, EARLIER, earlierFile), message(item.id, ATTACHMENT, visibleFile)]
              : [message(item.id, ATTACHMENT, visibleFile), message(item.id, DELETED, deletedFile, now)],
            nextCursor: earlier ? null : "earlier-fixture-page", unreadCount: 0 });
          }
        }
        return false;
      },
    });
    window = await startApp({ show: false, userDataDir: process.argv[2], rendererRoot: path.resolve(__dirname, "../../frontend/dist-desktop"),
      brokerOptions: { transport: createNodeHttpsTransport({ ca: cert.ca, timeoutMs: 2000 }),
        createSocket: (url, protocols, options) => new WebSocket(url, protocols, { ...options, ca: cert.ca, rejectUnauthorized: true }) } });
    window.setContentSize(1440, 1000);
    ipcMain.removeHandler("meetspace:asset:save");
    ipcMain.handle("meetspace:asset:save", async (event, input) => {
      assert.equal(event.sender, window.webContents); assert.equal(event.senderFrame, window.webContents.mainFrame);
      saves.push(input);
      return { ok: true, value: { saved: true, cancelled: false } };
    });
    const execute = code => window.webContents.executeJavaScript(code, true);
    const until = async (predicate, label) => {
      const end = Date.now() + 10000;
      while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
      throw new Error(label);
    };
    const click = selector => execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw new Error('Missing enabled action: '+${JSON.stringify(selector)});e.click()})()`);
    const clickText = (label, within = "body") => execute(`(()=>{const e=[...document.querySelector(${JSON.stringify(within)}).querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e||e.disabled)throw new Error('Missing enabled action: '+${JSON.stringify(label)});e.click()})()`);
    const field = (selector, value) => execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    const profileFiles = () => execute("[...document.querySelectorAll('[role=dialog] .chat-profile-file-copy strong')].map(e=>e.textContent)");
    const capture = async name => {
      await execute("document.fonts.ready");
      await execute("Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))");
      await new Promise(resolve => setTimeout(resolve, 150));
      const metrics = await execute(`(()=>{const e=document.querySelector('[role=dialog]'),r=e?.getBoundingClientRect();return {visible:!!e,left:r?.left,top:r?.top,right:r?.right,bottom:r?.bottom,width:innerWidth,height:innerHeight,scrollWidth:e?.scrollWidth,clientWidth:e?.clientWidth}})()`);
      assert.ok(metrics.visible && metrics.left >= 0 && metrics.top >= 0 && metrics.right <= metrics.width && metrics.bottom <= metrics.height, name + " fits viewport");
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, name + " has no horizontal overflow");
      await fs.writeFile(path.join(output, name + ".png"), (await window.webContents.capturePage()).toPNG());
    };
    await fs.mkdir(output, { recursive: true });
    await execute("window.__profileErrors=[];window.addEventListener('error',e=>window.__profileErrors.push(e.message));void 0");
    await until(() => execute("!!document.querySelector('.reference-onboarding-intro .button')"), "Intro ready");
    await click(".reference-onboarding-intro .button");
    await until(() => execute("!!document.querySelector('#desktop-server-origin')"), "Server form ready");
    await field("#desktop-server-origin", fixture.origin); await click(".desktop-server-form button[type=submit]");
    await until(() => execute("!!document.querySelector('#email')"), "Login ready");
    await field("#email", fixture.users[0].email); await field("#password", PASSWORD); await click("#auth-form button[type=submit]");
    await until(() => execute("!!document.querySelector('.sidebar')"), "Authenticated workspace ready");
    for (const item of [direct, group]) {
      controls.deny = 0;
      window.webContents.send("meetspace:route", `/personal/${item.id}`);
      await until(() => execute(`location.pathname==='/personal/${item.id}' && !!document.querySelector('.personal-peer-button') && document.body.innerText.includes('Authorized message')`), "Conversation ready");
      const requestsBefore = fixture.requests.filter(r => r.path === `/api/v1/conversations/${item.id}/messages`).length;
      await click(".personal-peer-button");
      await until(() => execute("!!document.querySelector('[role=dialog] .group-profile-tabs')"), "Profile ready");
      await capture(item.type + "-profile");
      assert.equal(fixture.requests.filter(r => r.path === `/api/v1/conversations/${item.id}/messages`).length, requestsBefore, "Opening profile does not request file history");
      await clickText("Файлы", "[role=dialog]");
      await until(async () => (await profileFiles()).includes(visibleFile.filename), "Visible attachment is rendered");
      assert.deepEqual(await profileFiles(), [visibleFile.filename], "Deleted messages do not reveal their attachments");
      assert.equal(fixture.requests.some(r => r.path === `/api/v1/conversations/${item.id}/messages` && r.query.includes("before=")), false, "Older history is not prefetched");
      await capture(item.type + "-files");
      await click(`[role=dialog] button[aria-label="Скачать файл: ${visibleFile.filename}"]`);
      await until(() => saves.length === (item.type === "direct" ? 1 : 2), "Native save invoked");
      const saved = saves.at(-1);
      assert.deepEqual(saved.asset, { kind: "attachment", scope: "conversation", scopeId: item.id, attachmentId: ATTACHMENT, filename: visibleFile.filename });
      assert.match(saved.token, /^desktop-session:/);
      assert.equal(Object.hasOwn(saved.asset, "url"), false, "Native save carries IDs only");
      assert.equal(fixture.requests.some(r => r.path.endsWith("/download")), false, "Renderer does not fetch a signed URL");
      if (item.type === "direct") {
        await clickText("Загрузить более ранние сообщения", "[role=dialog]");
        await until(async () => (await profileFiles()).includes(earlierFile.filename), "Explicit pagination loads older file");
        assert.deepEqual((await profileFiles()).sort(), [visibleFile.filename, earlierFile.filename].sort(), "Repeated attachment IDs render once across pages");
        await capture("direct-files-paginated");
        await click('[role=dialog] button[aria-label="Закрыть окно"]');
        await until(() => execute("!document.querySelector('[role=dialog]')"), "Profile closed");
        controls.deny = 403; controls.deniedConversation = item.id;
        await click(".personal-peer-button");
        await until(() => execute("!!document.querySelector('[role=dialog] .group-profile-tabs')"), "Reopened profile ready");
        await clickText("Файлы", "[role=dialog]");
      } else {
        controls.deny = 404; controls.deniedConversation = item.id;
        await clickText("Загрузить более ранние сообщения", "[role=dialog]");
      }
      await until(() => execute("!document.querySelector('[role=dialog]')"), `${item.type} access loss closes profile`);
      assert.deepEqual(await profileFiles(), [], "No files remain visible after access loss");
      checks.push(`${item.type}: lazy authorized history, deleted attachments excluded, native save by IDs; ${controls.deny} closes profile and removes visible files`);
    }
    checks.push("Explicit pagination loads older attachments and deduplicates repeated IDs; no history prefetch or renderer signed URL request");
    assert.deepEqual(await execute("window.__profileErrors"), []);
    const report = { ok: true, checks, platform: process.platform, arch: process.arch, source: "Shared production React with disposable TLS data; native save completion is an IPC seam", windowsRuntimeTested: false };
    await fs.writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    clearTimeout(watchdog); window.destroy(); await fixture.close(); await cert.close(); app.exit(0);
  } catch (error) {
    console.error(error.stack); clearTimeout(watchdog);
    if (window && !window.isDestroyed()) window.destroy();
    if (fixture) await fixture.close(); if (cert) await cert.close(); app.exit(1);
  }
})();
