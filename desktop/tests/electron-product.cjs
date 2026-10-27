// Actual shared React UI and sandboxed preload, with disposable TLS API fixtures.
// Save/open IPC completion is controlled here to test UI races without an OS dialog.
// NativeAssets network, disk, Range and authorization are covered separately.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const WebSocket = require("ws");
const { app, ipcMain } = require("electron");
assert.ok(process.argv[2] && path.isAbsolute(process.argv[2]));
app.setPath("userData", process.argv[2]); app.setPath("sessionData", process.argv[2]);
const { startApp } = require("../dist/main.js");
const { createNodeHttpsTransport } = require("../dist/network/transport.js");
const { createCertificates, PASSWORD, CONFERENCE } = require("./fixtures/https-fixture.cjs");
const { createProductFixture, DIRECT, GROUP, FOLDER, RECORDING, FILE, ATTACHMENT } = require("./fixtures/product-fixture.cjs");

(async () => {
  let cert, fixture, window;
  const checks = [], saves = [], opens = [], closes = [], cancellations = [], contexts = [];
  const pending = new Map();
  let saveMode = "saved";
  const watchdog = setTimeout(() => { console.error("Product UI watchdog"); app.exit(1); }, 100000);
  try {
    cert = await createCertificates(); fixture = await createProductFixture(cert);
    window = await startApp({ show: false, userDataDir: process.argv[2], rendererRoot: path.resolve(__dirname, "../../frontend/dist-desktop"), brokerOptions: {
      transport: createNodeHttpsTransport({ ca: cert.ca, timeoutMs: 1200 }),
      createSocket: (url, protocols, options) => new WebSocket(url, protocols, { ...options, ca: cert.ca, rejectUnauthorized: true }),
    } });
    assert.ok(window);
    const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, async (event, value) => {
      assert.equal(event.sender, window.webContents); assert.equal(event.senderFrame, window.webContents.mainFrame);
      return { ok: true, value: await handler(value) };
    }); };
    replace("meetspace:asset:save", input => {
      saves.push(input);
      assert.deepEqual(Object.keys(input).sort(), ["asset", "id", "token"]);
      assert.match(input.token, /^desktop-session:/);
      assert.equal(Object.hasOwn(input.asset, "url"), false);
      return saveMode === "pending" ? new Promise(resolve => pending.set(input.id, resolve)) : { saved: true, cancelled: false };
    });
    replace("meetspace:asset:open", input => { opens.push(input); return new Promise(resolve => pending.set(input.id, resolve)); });
    replace("meetspace:asset:cancel", id => { cancellations.push(id); });
    replace("meetspace:asset:close", id => { closes.push(id); });
    replace("meetspace:native:notification-context", input => { contexts.push(input); });
    const execute = async code => { try { return await window.webContents.executeJavaScript(code, true); } catch (error) { throw new Error(error.message + "\nRenderer check: " + code); } };
    const until = async (predicate, label, timeout = 8000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 35)); }
      throw new Error(label);
    };
    const text = () => execute("document.body.innerText");
    const visible = value => until(async () => (await text()).includes(value), `Expected product UI: ${value}`);
    const click = selector => execute(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) throw new Error('Missing enabled product action'); element.click(); })()`);
    const clickText = value => execute(`(() => { const element = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(value)}); if (!element || element.disabled) throw new Error('Missing enabled named product action'); element.click(); })()`);
    const field = (selector, value) => execute(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', {bubbles:true})); element.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    const route = async value => { window.webContents.send("meetspace:route", value); await until(() => execute(`location.pathname + location.search === ${JSON.stringify(value)}`), "Product route applies"); };
    await execute("window.__productErrors=[]; window.addEventListener('error', event => window.__productErrors.push(event.message)); void 0");
    await visible("Начнём с подключения");
    await clickText("Продолжить");
    await visible("Подключиться к серверу");
    await field("#desktop-server-origin", fixture.origin);
    await click(".desktop-server-form button[type=submit]");
    await until(() => execute("location.pathname === '/login' && !!document.querySelector('#email')"), "Login after server onboarding");
    const recordingPath = `/recordings/${RECORDING}?conference=${CONFERENCE}`;
    window.webContents.send("meetspace:route", recordingPath);
    await until(() => execute(`location.pathname === '/login' && new URLSearchParams(location.search).get('next') === ${JSON.stringify(recordingPath)}`), "Auth return preserves recording context");
    await field("#email", fixture.users[0].email); await field("#password", PASSWORD); await click("#auth-form button[type=submit]");
    await visible("Открыть запись");
    assert.equal(await execute("location.pathname + location.search"), recordingPath);
    assert.equal(await execute("!!document.querySelector('video[src], audio[src]')"), false);
    assert.equal(opens.length + saves.length, 0, "Private files do not load before an explicit action");
    assert.equal(await execute("[...document.querySelectorAll('[src],a[href]')].some(e => (e.src || e.href || '').includes('must-not-load.fixture.invalid'))"), false);
    checks.push("real login keeps protected recording return route; ready server file UUID displays without remote media or auto download");

    await clickText("Скачать видеозапись"); await visible("Файл сохранён");
    assert.deepEqual(saves[0].asset, { kind: "recording", conferenceId: CONFERENCE, recordingId: RECORDING, fileId: FILE });
    await clickText("Открыть запись"); await until(() => opens.length === 1, "Recording playback passes IPC");
    const first = opens[0];
    window.webContents.send("meetspace:transport", { kind: "asset", id: first.id, type: "progress", received: 128, total: 1024 });
    await visible("Загружено"); await clickText("Отменить");
    await until(() => cancellations.includes(first.id), "Explicit playback cancel reaches main");
    pending.get(first.id)({ id: first.id, url: `app://meetspace/native-media/${"a".repeat(43)}`, mimeType: "video/mp4" });
    await until(() => closes.filter(id => id === first.id).length >= 2, "Late media is revoked again");
    assert.equal(await execute("!!document.querySelector('video[src],audio[src]')"), false);
    checks.push("actual React save reports confirmed result; playback progress/cancel and late IPC result cannot attach a stale player");

    await clickText("Открыть запись"); await until(() => opens.length === 2, "Second explicit playback request");
    await route("/personal"); await visible("Product direct private message"); await visible("Product group private message");
    await until(() => cancellations.includes(opens[1].id), "Navigation cancels pending media");
    pending.get(opens[1].id)({ id: opens[1].id, url: `app://meetspace/native-media/${"b".repeat(43)}`, mimeType: "video/mp4" });
    await clickText("Группы");
    await until(async () => (await text()).includes("Product group private message") && !(await text()).includes("Product direct private message"), "Group filter replaces all conversations");
    assert.equal((await text()).includes("Product direct private message"), false);
    assert.ok(fixture.requests.some(request => request.path === "/api/v1/conversations" && request.query.includes("type=group")));
    checks.push("existing direct/group list uses real type filter and navigation revokes pending recording media");

    await route(`/personal/${DIRECT}`); await visible("Product server message");
    const sendDraft = async value => {
      await execute(`(() => { const input = document.querySelector('.chat-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
      await until(() => execute("!!document.querySelector('.chat-composer button[type=submit]:not(:disabled)')"), "Chat send enabled");
      await click(".chat-composer button[type=submit]");
    };
    await sendDraft("Plain desktop message without reply");
    await until(() => fixture.product.controls.sentMessages.length === 1, "Plain chat message reaches HTTPS API through the production IPC broker");
    const plain = fixture.product.controls.sentMessages[0];
    assert.equal(plain.route, `/conversations/${DIRECT}/messages`);
    assert.equal(plain.body.text, "Plain desktop message without reply");
    assert.equal(Object.hasOwn(plain.body, "replyTo"), false, "Absent reply is omitted just like the web JSON request");
    assert.deepEqual(plain.body.attachmentIds, []);
    await until(() => execute("document.querySelector('.chat-composer textarea').value === '' && !document.querySelector('.chat-message-pending')"), "Confirmed message clears draft and pending state");
    await click(`[data-testid="chat-message-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] .item-actions > button`);
    await clickText("Ответить");
    await until(() => execute("!!document.querySelector('.chat-reply')"), "Reply preview selected");
    await sendDraft("Desktop reply with a quotation");
    await until(() => fixture.product.controls.sentMessages.length === 2, "Quoted reply reaches HTTPS API");
    assert.equal(fixture.product.controls.sentMessages[1].body.replyTo, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    await until(() => execute("document.querySelector('.chat-composer textarea').value === '' && !document.querySelector('.chat-reply')"), "Confirmed reply clears quotation");
    checks.push("actual chat form sends plain text and quoted replies through the production preload/broker to HTTPS; successful delivery clears the draft");
    const sendIconGeometry = await execute(`(()=>{const button=document.querySelector('.chat-send-button');const a=button.getBoundingClientRect(),b=button.querySelector('svg').getBoundingClientRect();return {dx:Math.abs(a.x+a.width/2-b.x-b.width/2),dy:Math.abs(a.y+a.height/2-b.y-b.height/2)}})()`);
    assert.ok(sendIconGeometry.dx < 1 && sendIconGeometry.dy < 1, 'Send icon is centered in its button on both axes');
    fixture.product.controls.messageNetworkFailure = true;
    await sendDraft('Offline draft one');
    await until(()=>execute("document.querySelectorAll('.chat-delivery-failed').length===1"), 'Network failure is indicated next to the message');
    assert.equal(await execute("document.querySelector('.chat-composer textarea').value"),'','Failed message stays in the thread, not the composer');
    const failedOne=await execute("document.querySelector('.chat-message-pending').dataset.testid.replace('chat-pending-','')");
    await sendDraft('Offline draft two');
    await until(()=>execute("document.querySelectorAll('.chat-delivery-failed:not(:disabled)').length===2"), 'A second failed message does not replace the first');
    const failedTwo=await execute("[...document.querySelectorAll('.chat-message-pending')].at(-1).dataset.testid.replace('chat-pending-','')");
    assert.notEqual(failedOne,failedTwo);
    assert.equal(await execute("document.querySelectorAll('.chat-panel .error-notice').length"),0,'No separate network-error banners');
    assert.equal(await execute("document.querySelector('.chat-panel').innerText.includes('Не отправлено')"),false,'Only an icon marks the failed message');
    await route(`/personal/${GROUP}`); await visible('Product group chat');
    assert.equal(await execute("document.querySelectorAll('.chat-message-pending').length"),0,'Another chat never receives this outbox');
    await route(`/personal/${DIRECT}`); await visible('Product direct peer');
    await until(()=>execute("document.querySelectorAll('.chat-delivery-failed:not(:disabled)').length===2"),'Returning to the chat preserves both failed messages and retry IDs');
    assert.equal(await execute(`!!document.querySelector('[data-testid="chat-pending-${failedOne}"]') && !!document.querySelector('[data-testid="chat-pending-${failedTwo}"]')`),true);
    fixture.product.controls.messageNetworkFailure = false;
    await click(`[data-testid="chat-pending-${failedOne}"] .chat-delivery-failed`);
    await until(()=>execute("document.querySelectorAll('.chat-delivery-failed:not(:disabled)').length===1"),'One retry only removes the successfully delivered item');
    assert.equal(fixture.product.controls.sentMessages.at(-1).body.clientRequestId,failedOne);
    fixture.product.controls.loseMessageResponse = true;
    await click(`[data-testid="chat-pending-${failedTwo}"] .chat-delivery-failed`);
    await until(()=>execute(`!!document.querySelector('[data-testid="chat-pending-${failedTwo}"] .chat-delivery-failed:not(:disabled)')`),'A lost response keeps the delivery warning');
    const deliveredCount=fixture.product.controls.sentMessages.length;
    await click(`[data-testid="chat-pending-${failedTwo}"] .chat-delivery-failed`);
    await until(()=>execute("!document.querySelector('.chat-message-pending')"),'Retry confirms delivery and removes the warning');
    assert.equal(fixture.product.controls.sentMessages.length,deliveredCount,'A retry after a lost response creates no duplicate');
    assert.equal(fixture.product.controls.sendAttempts.filter(attempt=>attempt.body.clientRequestId===failedTwo).length,3);
    assert.equal(await execute("document.querySelectorAll('.chat-panel .error-notice').length"),0);
    checks.push('centered send icon; offline sends remain as separate messages with warning icons and no banner; chat navigation preserves the session outbox; explicit per-message retry preserves request IDs and avoids duplicate delivery after a lost response');
    await click(`button[aria-label="Скачать файл: Product private attachment.txt"]`);
    await until(() => saves.length === 2, "Existing chat save action uses native path");
    assert.deepEqual(saves[1].asset, { kind: "attachment", scope: "conversation", scopeId: DIRECT, attachmentId: ATTACHMENT, filename: "Product private attachment.txt" });
    assert.equal(fixture.requests.some(request => request.path.includes("/download")), false, "Renderer does not resolve signed download URLs");
    checks.push("existing personal chat renders server message and downloads attachment by authorized IDs without renderer signed URL fetch");

    await route("/folders"); await visible("Product personal folder");
    await click(`a[href="/folders/${FOLDER}"]`); await visible("Product direct peer"); await visible("Product scheduled meeting");
    checks.push("existing personal folder list/detail combines authorized chat and meeting entries");
    await route("/conferences"); await until(() => execute("!!document.querySelector('.dashboard-all')"), "Existing meetings screen mounts"); await visible("Product scheduled meeting");
    await route("/calendar");
    await until(() => fixture.requests.some(request => request.path === "/api/v1/me/conferences" && request.query.includes("from=") && request.query.includes("to=")), "Calendar requests server range");
    await visible("Product scheduled meeting");
    await route("/history"); await visible("Product finished meeting");
    assert.ok(fixture.requests.some(request => request.path === "/api/v1/me/conferences" && request.query.includes("view=past")));
    checks.push("existing meetings/calendar/history render server entries and send calendar range/history filters");

    await route("/analytics"); await visible("Аналитика сейчас недоступна");
    assert.equal(await execute("!!document.querySelector('.sidebar-nav a[href=\"/analytics\"]')"), false);
    assert.equal(fixture.requests.some(request => /\/analytics(?:\?|$)/.test(request.path)), false);
    checks.push("server disabled analytics is absent in navigation and deep route fails closed without analytics request");
    await route("/app/settings"); await visible("Мой профиль");
    assert.equal(await execute("!!document.querySelector('.reference-settings-page [role=tablist]') && !document.querySelector('.account-settings-modal')"), true);
    const settingsLabels = await execute("[...document.querySelectorAll('.reference-settings-page [role=tab]')].map(e=>e.textContent)");
    assert.ok(settingsLabels.some(label => label.includes("Внешний вид")));
    assert.ok(settingsLabels.some(label => label.includes("Устройства")));
    assert.ok(settingsLabels.some(label => /Приложение|Компьютер|Windows/.test(label)), "Native settings are available on the settings page");
    assert.equal(await execute("[...document.querySelectorAll('.reference-settings-page button')].some(button=>button.textContent.trim()==='Выйти из аккаунта')"), true, "Account logout remains accessible on the profile page");
    await execute(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width=1200; canvas.height=600;
      const ctx=canvas.getContext('2d'); ctx.fillStyle='#e53'; ctx.fillRect(0,0,1200,600);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      const transfer=new DataTransfer(); transfer.items.add(new File([blob],'profile.png',{type:'image/png'}));
      const input=document.querySelector('.profile-avatar-editor input[type=file]'); input.files=transfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await visible("Сохранить фото");
    assert.equal(fixture.product.controls.avatarUploads || 0, 0, "selection only previews locally");
    await until(()=>execute("!!document.querySelector('.avatar-file-picker img')"), "Photo preview loads");
    await clickText("Сохранить фото"); await visible("Фото профиля сохранено.");
    assert.equal(fixture.product.controls.avatarUploads, 1);
    assert.equal(fixture.product.controls.avatar[0], 255); assert.equal(fixture.product.controls.avatar[1], 216);
    await until(()=>execute("!!document.querySelector('.sidebar .profile .user-avatar img')"), "Saved photo updates sidebar");
    const dimensions=await execute(`(async()=>{const image=document.querySelector('.sidebar .profile .user-avatar img'); await image.decode(); return [image.naturalWidth,image.naturalHeight]})()`);
    assert.deepEqual(dimensions,[512,512], "source is reduced and square cropped");
    await route('/conferences'); await visible('Product scheduled meeting');
    await route('/app/settings'); await visible('Удалить фото');
    await clickText('Удалить фото'); await visible('Фото удалено.');
    await until(()=>execute("!document.querySelector('.sidebar .profile .user-avatar img')"), "Deleted photo restores initials");
    await execute(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['<svg/>'],'unsafe.svg',{type:'image/svg+xml'}));const input=document.querySelector('.profile-avatar-editor input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await visible('Для аватара подходят PNG, JPEG и WebP.');
    assert.equal(fixture.product.controls.avatarUploads,1,"unsupported files cannot upload");
    checks.push('profile avatar preview, explicit upload, 512px JPEG normalization, sidebar refresh, navigation persistence, deletion and unsafe-file rejection through the actual native broker');
    const screenshotDirectory = path.resolve(__dirname, "../artifacts");
    await fs.mkdir(screenshotDirectory, { recursive: true });
    window.setSize(1280, 900);
    for (const theme of ["light", "dark"]) {
      await clickText("Внешний вид"); await click(`input[type=radio][value=${theme}]`);
      await until(() => execute(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`), "Existing appearance preference updates theme");
      await clickText("Приложение"); await visible("Запускать MeetSpace при входе в систему");
      const startup = await execute(`(async()=>{
        const [runtime,preferences]=await Promise.all([window.meetspaceDesktop.getRuntimeInfo(),window.meetspaceDesktop.getNativePreferences()]);
        const label=[...document.querySelectorAll('.desktop-native-toggle')].find(element=>element.querySelector('.preference-title')?.textContent.trim()==='Запускать MeetSpace при входе в систему');
        const checkbox=label?.querySelector('input[type=checkbox]');
        return {platform:runtime.platform,supported:preferences.startupSupported,reason:preferences.startupReason,enabled:preferences.startAtLogin,checked:checkbox?.checked,disabled:checkbox?.disabled};
      })()`);
      assert.equal(startup.platform,process.platform,"Native settings report the actual test host platform");
      assert.equal(startup.checked,startup.enabled,"Startup control reflects the native preference");
      assert.equal(startup.disabled,!startup.supported,"Startup control is gated by the actual platform capability");
      if(!startup.supported) await visible(startup.reason==='conflict'
        ? "Автозапуск уже настроен другим способом."
        : startup.platform==='linux' ? "Автозапуск можно включить в установленном приложении Linux"
        : startup.platform==='win32' ? "Автозапуск можно включить в установленном приложении Windows."
        : "Автозапуск в этой среде пока недоступен.");
      await visible("Издатель, подпись и канал выпуска ещё не настроены");
      assert.equal(await execute("!!document.querySelector('.desktop-native-updates button')"), false, "Disabled updater offers no release actions");
      await execute("Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations !== Infinity).map(a=>a.finished.catch(()=>{})))");
      await execute("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await new Promise(resolve => setTimeout(resolve, 120));
      await fs.writeFile(path.join(screenshotDirectory, `stage06-settings-${theme}.png`), (await window.webContents.capturePage()).toPNG());
    }
    checks.push("settings page keeps accessible tabs, profile logout and native settings, with combined devices and appearance sections");
    checks.push("actual settings shows disabled Stage06 updates and never claims a release is current or offers install");
    // Exercise UI transitions through the real typed preload and transport events.
    // Signature and installer execution are independent native tests; no OS install occurs here.
    let updateAction;
    const updateState = { enabled: true, phase: "available", currentVersion: "0.6.0", availableVersion: "0.6.1" };
    for (const [channel, phase] of [["check", "available"], ["download", "ready"], ["cancel", "idle"], ["install", "installing"]])
      replace(`meetspace:update:${channel}`, () => { updateAction = channel; return { ...updateState, phase }; });
    window.webContents.send("meetspace:transport", { kind: "update", state: updateState });
    await visible("Доступна версия 0.6.1"); await clickText("Скачать обновление");
    await visible("скачана и проверена"); await visible("завершит текущий звонок");
    assert.equal(updateAction, "download");
    await clickText("Отменить обновление"); await visible("Проверка выполняется автоматически");
    assert.equal(updateAction, "cancel");
    window.webContents.send("meetspace:transport", { kind: "update", state: { ...updateState, phase: "error", code: "update_signature_invalid" } });
    await visible("Подпись издателя не подтверждена");
    assert.equal(await execute("[...document.querySelectorAll('.desktop-native-updates button')].some(e=>e.textContent.includes('установить'))"), false);
    window.webContents.send("meetspace:transport", { kind: "update", state: { ...updateState, phase: "ready", percent: 100 } });
    await clickText("Закрыть MeetSpace и установить"); await visible("Запускаем установщик");
    assert.equal(updateAction, "install");
    checks.push("update UI uses typed IPC and live states for explicit download/cancel/install, warns of ending calls and blocks install after signature error (installer seam)");
    await route("/recordings"); await visible("Product finished meeting");
    await until(() => execute("document.querySelectorAll('[data-testid=recordings-row]').length === 1"), "Ready recording catalog row loads");
    checks.push("existing recordings catalog renders the server ready artifact with UUID-backed actions");

    await until(() => contexts.some(context => context.token && context.route.startsWith("/recordings") && typeof context.soundEnabled === "boolean"), "Shared layout publishes authenticated notification context");
    checks.push("actual shared layout supplies current authenticated route and sound preference to native notification context");
    await fixture.close();
    await route("/conferences?view=active&search=offline-test");
    await until(async () => (await text()).includes("Не удалось связаться с сервером"), "Offline product query displays its connection failure", 18000);
    assert.equal((await text()).includes("Встречи не найдены"), false, "Network failure is not an empty offline meeting list");
    assert.equal(await execute("!!document.querySelector('.desktop-server-button')"), true);
    await click(".desktop-server-button"); await visible("Подключение к серверу");
    assert.equal(await execute("!!document.querySelector('[role=dialog] #desktop-server-origin:not(:disabled)')"), true);
    checks.push("offline server failure stays an error with editable server settings instead of invented empty/offline meetings");
    assert.deepEqual(await execute("window.__productErrors"), []);
    const report = { ok: true, checks, platform: process.platform, arch: process.arch,
      nativeDialogsAndPlayback: "IPC completion seam; tested separately by native asset integration", windowsRuntimeTested: false };
    await fs.writeFile(path.join(screenshotDirectory, "stage06-product-ui.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    clearTimeout(watchdog); if (!window.isDestroyed()) window.destroy(); await fixture.close(); await cert.close(); app.exit(0);
  } catch (error) {
    console.error(error.message);
    clearTimeout(watchdog); if (window && !window.isDestroyed()) window.destroy();
    if (fixture) await fixture.close(); if (cert) await cert.close(); app.exit(1);
  }
})();
