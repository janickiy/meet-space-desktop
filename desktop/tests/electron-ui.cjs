// Real shared React UI against disposable HTTPS fixtures. No test transport or
// fixture code is included in the packaged renderer or production entry point.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const WebSocket = require("ws");
const { app, safeStorage, ipcMain, nativeTheme } = require("electron");
// Configure Chromium's profile before app readiness; certificate creation is asynchronous.
if (process.argv[2] && path.isAbsolute(process.argv[2])) {
  app.setPath("userData", process.argv[2]);
  app.setPath("sessionData", process.argv[2]);
}
delete process.env.MEETSPACE_DESKTOP_DEV;
delete process.env.MEETSPACE_DEV_CSP_NONCE;
const { startApp } = require("../dist/main.js");
const { createNodeHttpsTransport } = require("../dist/network/transport.js");
const {
  createCertificates,
  createFixture,
  PASSWORD,
} = require("./fixtures/https-fixture.cjs");

(async () => {
  const directory = process.argv[2];
  assert.ok(
    directory && path.isAbsolute(directory),
    "Run through electron-ui-runner.cjs",
  );
  let certificates, alpha, beta, window;
  const checks = [];
  const watchdog = setTimeout(() => {
    console.error("Shared UI integration exceeded 60 seconds");
    app.exit(1);
  }, 60_000);
  try {
    certificates = await createCertificates();
    alpha = await createFixture({ name: "alpha", certificates, ui: true });
    beta = await createFixture({ name: "beta", certificates, ui: true });
    window = await startApp({
      show: false,
      userDataDir: directory,
      rendererRoot: path.resolve(__dirname, "../../frontend/dist-desktop"),
      brokerOptions: {
        transport: createNodeHttpsTransport({
          ca: certificates.ca,
          timeoutMs: 3000,
        }),
        createSocket: (url, protocols, options) =>
          new WebSocket(url, protocols, {
            ...options,
            ca: certificates.ca,
            rejectUnauthorized: true,
          }),
      },
    });
    assert.ok(window);
    const navigationEvents = [];
    window.webContents.on("did-start-loading", () =>
      navigationEvents.push({
        kind: "loading",
        url: window.webContents.getURL(),
      }),
    );
    window.webContents.on(
      "did-start-navigation",
      (_event, url, inPlace, isMainFrame) =>
        navigationEvents.push({
          kind: "navigation",
          url,
          inPlace,
          isMainFrame,
        }),
    );
    window.__testNavigationEvents = navigationEvents;
    assert.equal(safeStorage.isEncryptionAvailable(), true);
    const execute = (code) => window.webContents.executeJavaScript(code, true);
    const text = () => execute("document.body.innerText");
    const until = async (predicate, description, timeout = 7000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail(description);
    };
    const visible = (value) =>
      until(
        async () => (await text()).includes(value),
        `Expected visible UI: ${value}`,
      );
    const field = async (selector, value) => {
      await execute(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element || element.disabled) throw new Error('Expected enabled form field');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, ${JSON.stringify(value)});
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    };
    const click = (selector) =>
      execute(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) throw new Error('Expected enabled UI action');
      element.click();
    })()`);
    const openSettings = async () => {
      await click(".desktop-server-button");
      await visible("Подключение к серверу");
      assert.equal(
        await execute(
          "!!document.querySelector('[role=dialog] #desktop-server-origin')",
        ),
        true,
      );
    };
    const selectSaved = async (label) => {
      await execute(`(() => {
        const row = [...document.querySelectorAll('.desktop-server-row')].find(item => item.querySelector('strong')?.textContent === ${JSON.stringify(label)});
        const button = row && [...row.querySelectorAll('button')].find(item => item.textContent === 'Подключить');
        if (!button || button.disabled) throw new Error('Expected saved server switch');
        button.click();
      })()`);
    };
    const login = async (fixture) => {
      await until(
        () =>
          execute(
            "location.pathname === '/login' && !!document.querySelector('#email')",
          ),
        "Existing login page opens after profile selection",
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(
        await execute("location.pathname"),
        "/login",
        "Router bootstrap must not bounce the login route back to /app",
      );
      await field("#email", fixture.users[0].email);
      await field("#password", PASSWORD);
      await click("#auth-form button[type=submit]");
      await visible(fixture.users[0].displayName);
      assert.equal(await execute("location.pathname"), "/app");
    };
    const personal = async (fixture, revision = 1) => {
      await click('.sidebar-nav a[href="/personal"]');
      await visible(
        `${fixture === alpha ? "alpha" : "beta"} private preview ${revision}`,
      );
    };
    const requestCount = (fixture, resource) =>
      fixture.requests.filter((request) => request.path === resource).length;

    await execute(
      "window.__uiStreamEvents = []; window.meetspaceDesktop.onTransportEvent(e => { if (e.kind === 'stream') window.__uiStreamEvents.push({id:e.id,type:e.type,status:e.status,headers:e.headers, bytes:e.data?.byteLength, nativeArray:e.data instanceof Uint8Array}); }); window.__uiErrors=[]; window.addEventListener('error',e=>window.__uiErrors.push(e.message)); void 0",
    );
    await visible("Начнём с подключения");
    await click(".reference-onboarding-intro .button");
    await visible("Подключиться к серверу");
    assert.equal(
      await execute(
        "!!document.querySelector('.reference-welcome-brand img[src*=meetspace-symbol-color]')",
      ),
      true,
      "First run reuses the shipped brand",
    );
    await field("#desktop-server-origin", alpha.origin);
    await click(".desktop-server-form button[type=submit]");
    await login(alpha);
    checks.push(
      "actual branded first-run form, HTTPS probe, selected profile and existing login without router bounce",
    );
    await until(
      () => alpha.sockets.size > 0 && alpha.streams.size > 0,
      "Shared authenticated layout opens its account WSS and notifications SSE",
    );
    await personal(alpha);
    const ticketsBefore = requestCount(alpha, "/api/v1/ws-ticket");
    const listsBefore = requestCount(alpha, "/api/v1/conversations");
    alpha.controls.personalRevision = 2;
    for (const socket of alpha.sockets) socket.terminate();
    await visible("alpha private preview 2");
    assert.ok(
      requestCount(alpha, "/api/v1/ws-ticket") > ticketsBefore,
      "Reconnect obtains a fresh ticket in main",
    );
    assert.ok(
      requestCount(alpha, "/api/v1/conversations") > listsBefore,
      "Shared account hook refreshes REST snapshot after reconnect",
    );
    checks.push(
      "actual account WSS reconnect, fresh ticket and shared personal-list snapshot refresh",
    );

    await until(
      () => alpha.streams.size > 0,
      "SSE connection is ready for notification delivery",
    );
    const notificationsBefore = requestCount(alpha, "/api/v1/notifications");
    alpha.notify({
      version: 1,
      id: "ui-notification-read",
      type: "notification.read",
      data: { id: "fixture-notification" },
    });
    await until(
      () => requestCount(alpha, "/api/v1/notifications") > notificationsBefore,
      "Shared notification SSE parser invalidates its real query",
    );
    checks.push(
      "actual notifications hook consumes native SSE and refetches query",
    );
    await openSettings();
    await click('[role="dialog"] button[aria-label="Закрыть окно"]');
    assert.equal(
      await execute("!!document.querySelector('[role=dialog]')"),
      false,
    );
    assert.equal(await execute("location.pathname"), "/personal");
    checks.push(
      "server settings opens and closes without replacing the current screen",
    );

    // Synthetic source metadata exercises shipped React and the real preload.
    // Native source authorization is tested separately by the permission suite.
    const captureCalls = [];
    const cancelledCaptures = [];
    let rejectSelection = false;
    ipcMain.removeHandler("meetspace:display:select");
    ipcMain.removeHandler("meetspace:display:cancel");
    ipcMain.handle("meetspace:display:select", (_event, input) => {
      captureCalls.push(input);
      return rejectSelection
        ? {
            ok: false,
            error: {
              code: "capture_source_unavailable",
              message: "Fixture source closed",
            },
          }
        : { ok: true };
    });
    ipcMain.handle("meetspace:display:cancel", (_event, id) => {
      cancelledCaptures.push(id);
      return { ok: true };
    });
    const picker = async (id, audio = false) => {
      window.webContents.send("meetspace:display-capture", {
        type: "request",
        requestId: id,
        systemAudioAvailable: audio,
        sources: [
          {
            id: "screen:fixture:0",
            name: "Экран — тестовый источник",
            kind: "screen",
            thumbnail: "",
          },
          {
            id: "window:fixture:0",
            name: "Окно — тестовый источник",
            kind: "window",
            thumbnail: "",
          },
        ],
      });
      await visible("Что показать участникам?");
    };
    const pickerClosed = () =>
      until(
        () => execute("!document.querySelector('.desktop-capture-grid')"),
        "Picker closes",
      );
    await picker("fixture-share", true);
    assert.equal(
      await execute(
        "document.querySelector('.desktop-capture-actions button:last-child').disabled",
      ),
      true,
    );
    assert.equal(
      await execute(
        "document.querySelector('.desktop-capture-audio input').checked",
      ),
      false,
    );
    await click(".desktop-capture-source:last-child");
    await visible("Звук всех приложений, в том числе при выборе одного окна.");
    // This captures the fixture-only app window, never another app or OS screen.
    const screenshotDirectory = path.resolve(__dirname, "../artifacts");
    await fs.mkdir(screenshotDirectory, { recursive: true });
    for (const theme of ["light", "dark"]) {
      nativeTheme.themeSource = theme;
      await execute(
        `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`,
      );
      await execute(
        "Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))",
      );
      const screenshot = await window.webContents.capturePage();
      await fs.writeFile(
        path.join(screenshotDirectory, `stage04-picker-${theme}.png`),
        screenshot.toPNG(),
      );
    }
    await click(".desktop-capture-actions button:last-child");
    await pickerClosed();
    assert.deepEqual(captureCalls.at(-1), {
      requestId: "fixture-share",
      sourceId: "window:fixture:0",
      systemAudio: false,
    });
    await picker("fixture-audio", true);
    await click(".desktop-capture-source:first-child");
    await click(".desktop-capture-audio input");
    await click(".desktop-capture-actions button:last-child");
    await pickerClosed();
    assert.equal(captureCalls.at(-1).systemAudio, true);
    await picker("fixture-escape");
    assert.equal(
      await execute("!!document.querySelector('.desktop-capture-audio')"),
      false,
    );
    await execute(
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
    );
    await pickerClosed();
    await until(
      () => cancelledCaptures.includes("fixture-escape"),
      "Escape cancels native request",
    );
    await picker("fixture-cancel");
    await click(".desktop-capture-actions button:first-child");
    await pickerClosed();
    await until(
      () => cancelledCaptures.includes("fixture-cancel"),
      "Cancel sends native cancellation",
    );
    await picker("fixture-stale");
    window.webContents.send("meetspace:display-capture", {
      type: "cancelled",
      requestId: "older-request",
    });
    assert.equal(
      await execute("!!document.querySelector('.desktop-capture-grid')"),
      true,
    );
    window.webContents.send("meetspace:display-capture", {
      type: "cancelled",
      requestId: "fixture-stale",
    });
    await pickerClosed();
    rejectSelection = true;
    await picker("fixture-error");
    await click(".desktop-capture-source:first-child");
    await click(".desktop-capture-actions button:last-child");
    await visible("Не удалось начать демонстрацию.");
    assert.equal(
      await execute(
        "document.querySelector('.desktop-capture-actions button:last-child').disabled",
      ),
      false,
    );
    await click(".desktop-capture-actions button:first-child");
    await pickerClosed();
    rejectSelection = false;
    checks.push(
      "synthetic source picker in shared React/preload: explicit choice, default audio off, opt-in audio, platform gating, Escape/cancel, stale cancellation and error recovery; light/dark screenshots",
    );
    await picker("fixture-profile-change");
    // Open server settings underneath the fixture modal only in this harness.
    await openSettings();
    await field("#desktop-server-origin", beta.origin);
    await click(".desktop-server-form button[type=submit]");
    await until(
      () =>
        execute(
          "location.pathname === '/login' && !!document.querySelector('#email')",
        ),
      "New server requires its own authentication",
    );
    assert.equal((await text()).includes(alpha.users[0].displayName), false);
    assert.equal((await text()).includes("alpha private preview"), false);
    await pickerClosed();
    await until(
      () => cancelledCaptures.includes("fixture-profile-change"),
      "Profile teardown cancels picker",
    );
    await login(beta);
    await personal(beta);
    assert.equal(
      (await text()).includes("alpha private preview"),
      false,
      "Identical user/conversation UUIDs must not reuse another server's cached preview",
    );
    assert.equal((await text()).includes(alpha.users[0].displayName), false);
    await until(
      () => alpha.sockets.size === 0 && alpha.streams.size === 0,
      "Server switch closes old server's channels",
    );
    checks.push(
      "server switch clears identity, same-ID query cache and old connections",
    );

    await openSettings();
    await selectSaved(new URL(alpha.origin).host);
    await visible(alpha.users[0].displayName);
    assert.equal(
      requestCount(alpha, "/api/v1/auth/login"),
      1,
      "Switching back restores the selected server's native session without a password",
    );
    await alpha.close();
    window.webContents.reload();
    await visible("Не удалось проверить сессию");
    await openSettings();
    await selectSaved(new URL(beta.origin).host);
    await visible(beta.users[0].displayName);
    assert.equal(requestCount(beta, "/api/v1/auth/login"), 1);
    checks.push(
      "offline session error retains accessible server settings and can restore another saved server",
    );

    const rendererValues = await execute(
      "JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), cookie: document.cookie })",
    );
    const secrets = [
      PASSWORD,
      ...alpha.tokens.keys(),
      ...alpha.sessions.keys(),
      ...beta.tokens.keys(),
      ...beta.sessions.keys(),
    ];
    for (const secret of secrets)
      assert.equal(
        rendererValues.includes(secret),
        false,
        "Renderer browser storage contains no credential",
      );
    assert.equal(
      rendererValues.includes("desktop-session:"),
      false,
      "Opaque identity markers are not durable browser state",
    );
    const encrypted = await fs.readFile(
      path.join(directory, "sessions.encrypted"),
    );
    for (const secret of secrets)
      assert.equal(
        encrypted.includes(Buffer.from(secret)),
        false,
        "Real OS vault does not write plaintext credentials",
      );
    for (const request of beta.requests)
      for (const secret of [...alpha.tokens.keys(), ...alpha.sessions.keys()])
        assert.equal(
          JSON.stringify(request.headers).includes(secret),
          false,
          "Alpha credentials never reach Beta",
        );
    checks.push(
      "real safeStorage and renderer storage contain no plaintext credentials; server credentials remain isolated",
    );
    console.log(
      JSON.stringify({
        result: "PASS",
        suite: "shared-react-ui",
        checks,
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        windowsRuntimeTested: process.platform === "win32",
        conferenceMediaTested: false,
      }),
    );
  } catch (error) {
    console.error("Shared UI integration failed:", error.message);
    if (window && !window.isDestroyed()) {
      const state = await window.webContents
        .executeJavaScript(
          "({path:location.pathname,text:document.body.innerText.slice(0,1800)})",
        )
        .catch(() => null);
      console.error("UI state:", JSON.stringify(state));
      console.error(
        "Navigation diagnostics:",
        JSON.stringify(window.__testNavigationEvents),
      );
      console.error(
        "SSE diagnostics:",
        JSON.stringify({
          streams: alpha?.streams.size,
          requests: alpha?.requests.map((r) => r.path),
          events: await window.webContents
            .executeJavaScript(
              "({events:window.__uiStreamEvents,errors:window.__uiErrors})",
            )
            .catch(() => null),
        }),
      );
    }
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    if (window && !window.isDestroyed()) window.destroy();
    if (alpha) await alpha.close();
    if (beta) await beta.close();
    if (certificates) await certificates.close();
    app.exit(process.exitCode || 0);
  }
})().catch((error) => {
  console.error("Shared UI startup failed:", error.message);
  app.exit(1);
});
