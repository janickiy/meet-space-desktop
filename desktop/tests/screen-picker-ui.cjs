// Actual React/Modal DOM; synthetic sources and events only. No native capture or account.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { app, BrowserWindow, session } = require("electron");

const [profile, renderer, output] = process.argv.slice(2);
for (const value of [profile, renderer, output])
  assert.ok(path.isAbsolute(value));
app.setName("MeetSpace Picker Fixture");
app.setPath("userData", profile);
app.setPath("sessionData", profile);
const report = {
  result: "FAIL",
  fixtureOnly: true,
  actualComponent: "frontend/src/components/desktop/DesktopScreenPicker.tsx",
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  realScreenCaptured: false,
  authenticated: false,
  permissionsRequested: [],
  nativeCaptureRequests: 0,
  blockedRequests: [],
  rendererErrors: [],
  checks: [],
};
let window,
  stage = "initialize";
const watchdog = setTimeout(() => {
  console.error("Picker DOM UI timed out at " + stage);
  app.exit(1);
}, 60000);
const persist = () =>
  fs.writeFile(
    path.join(output, "picker-ui.json"),
    JSON.stringify(report, null, 2) + "\n",
  );

(async () => {
  try {
    await app.whenReady();
    const isolatedSession = session.fromPartition("picker-dom-fixture");
    isolatedSession.setPermissionCheckHandler(() => false);
    isolatedSession.setPermissionRequestHandler(
      (_contents, permission, callback) => {
        report.permissionsRequested.push(permission);
        callback(false);
      },
    );
    isolatedSession.setDisplayMediaRequestHandler((_request, callback) => {
      report.nativeCaptureRequests++;
      callback({});
    });
    isolatedSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try {
        const url = new URL(details.url);
        const relative =
          url.protocol === "file:"
            ? path.relative(renderer, fileURLToPath(url))
            : "../outside";
        allowed =
          relative !== ".." &&
          !relative.startsWith(".." + path.sep) &&
          !path.isAbsolute(relative);
      } catch {
        /* Any unexpected protocol is denied. */
      }
      if (!allowed) report.blockedRequests.push(details.url);
      callback({ cancel: !allowed });
    });
    window = new BrowserWindow({
      show: false,
      width: 1050,
      height: 800,
      webPreferences: {
        session: isolatedSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        backgroundThrottling: false,
      },
    });
    window.webContents.on("console-message", (details) => {
      if (details.level === "error")
        report.rendererErrors.push(details.message);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      report.rendererErrors.push("Renderer gone: " + details.reason);
    });
    await window.loadFile(path.join(renderer, "index.html"));
    const js = (source) => window.webContents.executeJavaScript(source, true);
    const pause = () => new Promise((resolve) => setTimeout(resolve, 35));
    const until = async (condition, description) => {
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        if (await condition()) return;
        await pause();
      }
      throw new Error(description);
    };
    const query = (selector) =>
      js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const snapshot = () => js("window.__pickerFixture.snapshot()");
    const emit = (event) =>
      js(`window.__pickerFixture.emit(${JSON.stringify(event)})`);
    const click = (selector) =>
      js(
        `(() => { const button = document.querySelector(${JSON.stringify(selector)}); if (!button || button.disabled) throw new Error('Missing enabled control: ' + ${JSON.stringify(selector)}); button.click(); })()`,
      );
    const title = (expected) =>
      until(
        () =>
          js(
            `document.querySelector('[role=dialog] h2')?.textContent === ${JSON.stringify(expected)}`,
          ),
        "Missing dialog title " + expected,
      );
    const closed = () =>
      until(
        async () => !(await query("[role=dialog]")),
        "Dialog should be closed",
      );
    const request = (id, systemAudioAvailable = false) =>
      emit({
        type: "request",
        requestId: id,
        systemAudioAvailable,
        sources: [
          {
            id: "screen:fixture",
            kind: "screen",
            name: "Synthetic screen",
            thumbnail: "",
          },
          {
            id: "window:fixture",
            kind: "window",
            name: "Synthetic window",
            thumbnail: "",
          },
        ],
      });
    const settle = (id, outcome) =>
      js(
        `window.__pickerFixture.settle(${JSON.stringify(id)}, ${JSON.stringify(outcome)})`,
      );
    const beginSelection = async (id) => {
      await request(id);
      await click(".desktop-capture-source:nth-child(2)");
      await until(
        () =>
          js(
            "!document.querySelector('.desktop-capture-actions .button-primary').disabled",
          ),
        "Selection should enable sharing",
      );
      await click(".desktop-capture-actions .button-primary");
      await until(
        async () => (await snapshot()).pending.includes(id),
        "Selection promise should be pending",
      );
    };
    const remount = async (platform) => {
      await js("window.__pickerFixture.unmount()");
      await js(`window.__pickerFixture.mount(${JSON.stringify(platform)})`);
      await until(
        async () => (await snapshot()).listeners === 1,
        "Picker should subscribe exactly once",
      );
    };
    const check = (message) => {
      report.checks.push(message);
      console.log("PASS " + message);
    };

    stage = "sandbox";
    await until(
      () =>
        js(
          "Boolean(window.__pickerFixture) && window.__pickerFixture.snapshot().listeners === 1",
        ),
      "Fixture mount",
    );
    for (const [key, expected] of Object.entries({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    }))
      assert.equal(window.webContents.getLastWebPreferences()[key], expected);
    assert.equal(app.commandLine.hasSwitch("no-sandbox"), false);
    assert.equal(
      await js(
        "typeof require === 'undefined' && typeof process === 'undefined' && Object.isFrozen(window.meetspaceDesktop)",
      ),
      true,
    );
    await closed();
    check(
      "Actual picker in sandboxed isolated renderer; no production profile, preload, network or auth",
    );

    stage = "explicit-selection";
    await js("document.getElementById('focus-return').focus()");
    await request("selection");
    await title("Что показать участникам?");
    assert.equal(
      await query('.desktop-capture-source[aria-pressed="true"]'),
      false,
    );
    assert.equal(
      await js(
        "document.querySelector('.desktop-capture-actions .button-primary').disabled",
      ),
      true,
    );
    assert.equal(await query('input[type="checkbox"]'), false);
    assert.equal(
      await js(
        "document.body.textContent.includes('Передаётся изображение без звука компьютера.')",
      ),
      true,
    );
    await click(".desktop-capture-source:nth-child(2)");
    await until(
      () => query('.desktop-capture-source:nth-child(2)[aria-pressed="true"]'),
      "Explicit second source selection",
    );
    await click(".desktop-capture-actions .button-primary");
    await until(
      async () => (await snapshot()).pending.includes("selection"),
      "Native selection pending",
    );
    assert.deepEqual((await snapshot()).selections.at(-1), {
      requestId: "selection",
      sourceId: "window:fixture",
      systemAudio: false,
    });
    assert.equal(
      await js(
        "[...document.querySelectorAll('.desktop-capture-source')].every(button => button.disabled) && document.querySelector('.desktop-capture-actions .button-primary').disabled",
      ),
      true,
    );
    await settle("selection", "resolve");
    await closed();
    assert.equal(await js("document.body.style.overflow"), "");
    assert.equal(await js("document.activeElement.id"), "focus-return");
    check(
      "No default source; Darwin contract exposes no system audio; explicit source only; busy lock and success cleanup",
    );

    for (const kind of ["denied", "error"]) {
      for (const outcome of ["reject", "resolve"]) {
        const id = kind + "-" + outcome;
        stage = id;
        await beginSelection(id);
        await emit({ type: kind, requestId: id });
        const expectedTitle =
          kind === "denied" ? "Разрешите запись экрана" : "Демонстрация экрана";
        await title(expectedTitle);
        await settle(id, outcome);
        await pause();
        await title(expectedTitle);
        assert.equal(
          await query(
            ".desktop-capture-source, .desktop-capture-actions .button-primary, [role=alert]",
          ),
          false,
        );
        if (kind === "denied")
          assert.equal(
            await js(
              "document.body.textContent.includes('Screen Recording') && document.body.textContent.includes('⌘Q')",
            ),
            true,
          );
        const before = (await snapshot()).cancellations.length;
        await click(".desktop-capture-actions .button-secondary");
        await closed();
        assert.deepEqual((await snapshot()).cancellations.slice(before), [id]);
        check(
          kind +
            " terminal instructions persist after selection promise " +
            outcome +
            "; explicit close cancels only that request",
        );
      }
    }

    stage = "selection-rejection";
    await beginSelection("ordinary-failure");
    await settle("ordinary-failure", "reject");
    await until(
      () => query("[role=alert]"),
      "Selection failure should show retry guidance",
    );
    assert.equal(
      await js(
        "document.querySelector('.desktop-capture-actions .button-primary').disabled",
      ),
      false,
    );
    await click(".desktop-capture-actions .button-secondary");
    await closed();
    check(
      "Ordinary selection rejection remains retryable and can be cancelled",
    );

    stage = "stale-events";
    await beginSelection("older");
    await request("newer");
    for (const type of ["cancelled", "denied", "error"])
      await emit({ type, requestId: "older" });
    await settle("older", "reject");
    await pause();
    await title("Что показать участникам?");
    assert.equal(
      await query('.desktop-capture-source[aria-pressed="true"], [role=alert]'),
      false,
    );
    assert.equal(
      await js(
        "document.querySelector('.desktop-capture-actions .button-primary').disabled",
      ),
      true,
    );
    const beforeNewerClose = (await snapshot()).cancellations.length;
    await click(".modal-close");
    await closed();
    assert.deepEqual((await snapshot()).cancellations.slice(beforeNewerClose), [
      "newer",
    ]);
    check(
      "Old cancellation/denial/error and rejected selection cannot mutate a newer request",
    );

    stage = "dismiss-and-cleanup";
    await request("escape");
    await js(
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
    );
    await closed();
    assert.equal((await snapshot()).cancellations.at(-1), "escape");
    await request("backdrop");
    await js(
      "document.querySelector('.modal-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))",
    );
    await closed();
    assert.equal((await snapshot()).cancellations.at(-1), "backdrop");
    await request("native-cancel");
    const beforeNative = (await snapshot()).cancellations.length;
    await emit({ type: "cancelled", requestId: "native-cancel" });
    await closed();
    assert.equal((await snapshot()).cancellations.length, beforeNative);
    assert.equal(await js("document.body.style.overflow"), "");
    check(
      "Escape/backdrop cancel the matching request; native cancellation closes without duplicate cancel; modal scroll restored",
    );

    stage = "unsubscribe";
    await beginSelection("unmounted");
    const beforeUnmount = await snapshot();
    await js("window.__pickerFixture.unmount()");
    await closed();
    let state = await snapshot();
    assert.equal(state.listeners, 0);
    assert.equal(state.unsubscriptions, beforeUnmount.unsubscriptions + 1);
    assert.deepEqual(
      state.cancellations.slice(beforeUnmount.cancellations.length),
      ["unmounted"],
    );
    await emit({ type: "denied", requestId: "unmounted" });
    await settle("unmounted", "reject");
    await pause();
    await closed();
    await js("window.__pickerFixture.mount('darwin')");
    await until(
      async () => (await snapshot()).listeners === 1,
      "Remount listener",
    );
    await request("remounted");
    assert.equal(
      await query('.desktop-capture-source[aria-pressed="true"], [role=alert]'),
      false,
    );
    await click(".modal-close");
    await closed();
    check(
      "Unmount unsubscribes, cancels pending request once and ignores its later settlement; remount starts clean",
    );

    stage = "windows-explicit-audio";
    await remount("win32");
    await request("windows-audio", true);
    assert.equal(
      await js("document.querySelector('input[type=checkbox]').checked"),
      false,
    );
    await click(".desktop-capture-source");
    await click("input[type=checkbox]");
    await click(".desktop-capture-actions .button-primary");
    await until(
      async () => (await snapshot()).pending.includes("windows-audio"),
      "Windows selection pending",
    );
    assert.deepEqual((await snapshot()).selections.at(-1), {
      requestId: "windows-audio",
      sourceId: "screen:fixture",
      systemAudio: true,
    });
    await settle("windows-audio", "resolve");
    await closed();
    await request("windows-new", true);
    assert.equal(
      await js("document.querySelector('input[type=checkbox]').checked"),
      false,
    );
    await click(".modal-close");
    await closed();
    check(
      "Windows available system audio requires explicit opt-in and resets for the next request",
    );

    stage = "portal-unavailable-early-denial";
    await remount("linux");
    await emit({ type: "portal", requestId: "portal" });
    await title("Выберите источник в системном диалоге");
    assert.equal(
      await query(
        ".desktop-capture-source, input[type=checkbox], .desktop-capture-actions .button-primary",
      ),
      false,
    );
    assert.equal(
      await js(
        "document.querySelector('[role=status]').textContent.includes('без')",
      ),
      true,
    );
    await click(".desktop-capture-actions .button-secondary");
    await closed();
    assert.equal((await snapshot()).cancellations.at(-1), "portal");
    await remount("darwin");
    await emit({ type: "unavailable", requestId: "unavailable" });
    await title("Демонстрация экрана");
    assert.equal(
      await js(
        "document.body.textContent.includes('рабочий стол macOS') && !document.body.textContent.includes('X11')",
      ),
      true,
    );
    await click(".modal-close");
    await closed();
    await emit({ type: "denied", requestId: "early-denial" });
    await title("Разрешите запись экрана");
    await click(".modal-close");
    await closed();
    check(
      "Linux portal cancellation remains separate; Darwin unavailable/early denial explains macOS permissions",
    );

    stage = "late-terminal-after-dismiss";
    for (const type of ["denied", "error", "request"]) {
      const id = "dismissed-late-" + type;
      await request(id);
      await click(".modal-close");
      await closed();
      if (type === "request") await request(id);
      else await emit({ type, requestId: id });
      assert.equal(
        await query("[role=dialog]"),
        false,
        "Dismissed request must not reopen on late " + type,
      );
    }
    await beginSelection("retired-success");
    await settle("retired-success", "resolve");
    await closed();
    await request("retired-native-cancel");
    await emit({ type: "cancelled", requestId: "retired-native-cancel" });
    await closed();
    await request("retired-superseded");
    await request("newest-request");
    await click(".modal-close");
    await closed();
    for (const id of [
      "retired-success",
      "retired-native-cancel",
      "retired-superseded",
    ]) {
      await emit({ type: "denied", requestId: id });
      assert.equal(
        await query("[role=dialog]"),
        false,
        "Completed/cancelled/superseded request must not reopen",
      );
    }
    await emit({ type: "denied", requestId: "fresh-early-denial" });
    await title("Разрешите запись экрана");
    await click(".modal-close");
    await closed();
    check(
      "Late terminal/request events cannot reopen a dismissed request; fresh early denial still opens permission guidance",
    );

    stage = "final-security-and-cleanup";
    await js("window.__pickerFixture.unmount()");
    state = await snapshot();
    assert.equal(state.listeners, 0);
    assert.equal(state.subscriptions, state.unsubscriptions);
    assert.deepEqual(state.pending, []);
    assert.deepEqual(state.unexpected, []);
    assert.deepEqual(state.errors, []);
    assert.deepEqual(report.permissionsRequested, []);
    assert.equal(report.nativeCaptureRequests, 0);
    assert.deepEqual(report.blockedRequests, []);
    assert.deepEqual(report.rendererErrors, []);
    report.finalFixture = state;
    check(
      "All promises/listeners cleaned up; zero native capture, permissions, network, auth and renderer errors",
    );
    report.result = "PASS";
  } catch (error) {
    report.failure = { stage, message: error.message, stack: error.stack };
    console.error(error.stack || error);
  } finally {
    clearTimeout(watchdog);
    if (window && !window.isDestroyed()) window.destroy();
    await persist();
    console.log(
      JSON.stringify({
        result: report.result,
        checks: report.checks.length,
        report: path.join(output, "picker-ui.json"),
      }),
    );
    app.exit(report.result === "PASS" ? 0 : 1);
  }
})();
