const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DIRECT, GROUP } = require("./fixtures/product-fixture.cjs");
const {
  USER_A,
  USER_B,
  CONFERENCE,
  PASSWORD,
} = require("./fixtures/https-fixture.cjs");

module.exports = async function checkMessageActions({
  execute,
  until,
  visible,
  click,
  clickText,
  field,
  route,
  fixture,
  window,
  checks,
  directory,
}) {
  const controls = fixture.product.controls;
  const now = new Date().toISOString();
  const items = [USER_A, USER_A, USER_B].map((id, index) => ({
    id: randomUUID(),
    sequence: String(index + 1),
    conversationId: DIRECT,
    senderId: id,
    senderName: id === USER_A ? "Product owner" : "Product peer",
    text: "Editable fixture " + (index + 1),
    attachments: index === 2 ? [fixture.product.attachment] : [],
    createdAt: now,
    updatedAt: now,
    editedAt: null,
    deletedAt: null,
    version: 1,
    important: false,
    replyTo: null,
  }));
  controls.actionThreads = new Map([
    [DIRECT, items],
    [GROUP, []],
    [
      CONFERENCE,
      [{ ...items[2], conferenceId: CONFERENCE, conversationId: undefined }],
    ],
  ]);
  controls.forwardReplay = new Map();
  controls.forwardAttempts = [];
  controls.deleteAttempts = [];
  const row = (id) => `[data-testid="chat-message-${id}"]`;
  const menu = async (item, action) => {
    await click(row(item.id) + " .item-actions > button");
    await clickText(action);
  };
  const screenshot = async (name) => {
    if (!directory) return;
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, name + ".png"),
      (await window.webContents.capturePage()).toPNG(),
    );
  };
  try {
    await route("/meetings");
    await route("/personal/" + DIRECT);
    await until(
      () => execute(`!!document.querySelector('${row(items[2].id)}')`),
      "Updated isolated message history is visible",
      22000,
    );
    await menu(items[2], "Выбрать");
    await click('[aria-label="Удалить выбранные сообщения"]');
    assert.equal(
      await execute("!!document.querySelector('.chat-delete-everywhere')"),
      false,
    );
    await clickText("Отмена");
    await screenshot("direct-message-selection");
    await clickText("Переслать");
    await until(
      () => execute("!!document.querySelector('.forward-recipient')"),
      "Forward recipient list loaded",
    );
    assert.equal(
      await execute("document.querySelectorAll('.forward-recipient').length"),
      1,
    );
    await screenshot("forward-attachment-destination");
    controls.loseForwardResponse = true;
    await click(".forward-recipient");
    await visible("Повторить пересылку");
    await clickText("Повторить пересылку");
    await until(
      () => execute("!document.querySelector('.forward-messages-dialog')"),
      "Forward retry closes after success",
    );
    assert.equal(controls.forwardAttempts.length, 2);
    const [body, retry] = controls.forwardAttempts;
    assert.deepEqual(body, retry);
    assert.deepEqual(Object.keys(body).sort(), [
      "clientRequestId",
      "messageIds",
      "sourceId",
      "sourceType",
    ]);
    assert.equal(body.sourceType, "conversation");
    assert.equal(body.sourceId, DIRECT);
    assert.deepEqual(body.messageIds, [items[2].id]);
    assert.equal(controls.actionThreads.get(GROUP).length, 1);
    await until(
      () => execute(`location.pathname === "/personal/${GROUP}"`),
      "Forward opens the destination",
    );
    await visible("Переслано от Product peer");
    await visible(fixture.product.attachment.filename);
    assert.ok(await execute("!!document.querySelector('.chat-file-download')"));
    await screenshot("group-forwarded-attachment");
    await until(
      () =>
        execute(
          "!!document.querySelector('.personal-peer-button:not(:disabled)')",
        ),
      "Destination group profile is loaded",
    );
    await click(".personal-peer-button");
    await until(
      () =>
        execute(
          "!!document.querySelector('.chat-info-page .group-members li')",
        ),
      "Group info loads its authorized members",
    );
    assert.equal(
      await execute(
        "getComputedStyle(document.querySelector('.personal-thread-surface')).display",
      ),
      "none",
    );
    assert.equal(
      await execute(
        "document.querySelector('.personal-sidebar').getBoundingClientRect().width > 0",
      ),
      true,
    );
    const photoCentered = await execute(`(() => {
      const button = document.querySelector('.chat-info-page .chat-group-photo');
      const preview = button.querySelector('.avatar-settings-image');
      const icon = preview.querySelector('svg').getBoundingClientRect();
      const circle = button.getBoundingClientRect();
      return preview.clientWidth === button.clientWidth &&
        preview.clientHeight === button.clientHeight &&
        Math.abs((icon.left + icon.right - circle.left - circle.right) / 2) < 1 &&
        Math.abs((icon.top + icon.bottom - circle.top - circle.bottom) / 2) < 1;
    })()`);
    assert.ok(
      photoCentered,
      "Default group icon is centered inside the entire avatar",
    );
    await screenshot("group-info-page");
    await click(".chat-info-heading button");
    await visible("Переслано от Product peer");
    await route("/personal/" + DIRECT);
    await visible(items[0].text);
    await menu(items[0], "Выбрать");
    await click(row(items[1].id) + " input[type=checkbox]");
    controls.refuseDelete = items[1].id;
    await click('[aria-label="Удалить выбранные сообщения"]');
    assert.equal(
      controls.deleteAttempts.length,
      0,
      "Selection alone cannot delete",
    );
    await clickText("Удалить для всех");
    await visible("Осталось: 1");
    assert.deepEqual(
      controls.deleteAttempts,
      items.slice(0, 2).map((item) => item.id),
    );
    assert.equal(
      await execute(
        "document.querySelectorAll('.chat-message-select input:checked').length",
      ),
      1,
    );
    assert.equal(
      await execute(
        `document.querySelector('${row(items[1].id)} input').checked`,
      ),
      true,
    );
    controls.refuseDelete = null;
    await click('[aria-label="Удалить выбранные сообщения"]');
    await clickText("Удалить для всех");
    await until(
      () => execute("!document.querySelector('.chat-panel.chat-selecting')"),
      "Successful retry clears selection",
    );
    assert.deepEqual(controls.deleteAttempts, [
      items[0].id,
      items[1].id,
      items[1].id,
    ]);
    assert.equal(
      await execute("document.querySelectorAll('.chat-text.muted').length"),
      2,
    );
    await menu(items[2], "Выбрать");
    await click('[aria-label="Удалить выбранные сообщения"]');
    await clickText("Удалить у меня (1)");
    await until(
      () => execute(`!document.querySelector('${row(items[2].id)}')`),
      "Incoming message hidden locally",
    );
    assert.equal(controls.actionThreads.get(DIRECT)[2].text, items[2].text);
    assert.equal(
      controls.deleteAttempts.length,
      3,
      "Local deletion does not call server DELETE",
    );
    await route("/meetings");
    await route("/personal/" + DIRECT);
    await until(
      () => execute(`!!document.querySelector('${row(items[0].id)}')`),
      "History reloaded",
    );
    assert.equal(
      await execute(`!!document.querySelector('${row(items[2].id)}')`),
      false,
    );

    await route("/conferences/" + CONFERENCE);
    await until(
      () => execute(`!!document.querySelector('${row(items[2].id)}')`),
      "Comment visible in meeting history independently of personal chat",
    );
    await menu(items[2], "Переслать");
    await until(
      () =>
        execute(
          `!!document.querySelector('.forward-recipient[aria-label*="Product group chat"]')`,
        ),
      "Group destination available",
    );
    await click('.forward-recipient[aria-label*="Product group chat"]');
    await until(
      () => controls.forwardAttempts.length === 3,
      "Conference forward submitted",
    );
    assert.equal(controls.forwardAttempts[2].sourceType, "conference");
    assert.equal(controls.forwardAttempts[2].sourceId, CONFERENCE);
    await until(
      () => execute("!document.querySelector('.forward-messages-dialog')"),
      "Conference forward completed",
    );
    await menu(items[2], "Выбрать");
    await click('[aria-label="Удалить выбранные сообщения"]');
    await clickText("Удалить у меня (1)");
    await until(
      () => execute(`!document.querySelector('${row(items[2].id)}')`),
      "Read-only conference comment hidden locally",
    );
    assert.equal(controls.deleteAttempts.length, 3);
    await screenshot("conference-local-delete");
    const loginAs = async (account) => {
      await route("/app/settings");
      await visible("Мой профиль");
      await clickText("Мой профиль");
      await until(
        () => execute("!!document.querySelector('#profile-settings')"),
        "Profile settings loaded",
      );
      await clickText("Выйти из аккаунта");
      await until(
        () => execute("!!document.querySelector('#email')"),
        "Login form after explicit logout",
      );
      await field("#email", account.email);
      await field("#password", PASSWORD);
      await click("#auth-form button[type=submit]");
      await until(
        () =>
          execute(
            "!!document.querySelector('.workspace') || !!document.querySelector('a[href=\"/personal\"]')",
          ),
        "Account opened",
      );
      await route("/personal/" + DIRECT);
      await until(
        () => execute(`!!document.querySelector('${row(items[0].id)}')`),
        "Account history opened",
      );
    };
    await loginAs(fixture.users[1]);
    assert.equal(
      await execute(`!!document.querySelector('${row(items[2].id)}')`),
      true,
      "Other account can still see the same incoming message",
    );
    await loginAs(fixture.users[0]);
    assert.equal(
      await execute(`!!document.querySelector('${row(items[2].id)}')`),
      false,
      "Local deletion persists after logout/login",
    );
    const localEntries = await execute(
      "Object.keys(localStorage).filter(key => key.startsWith('meetspace.hidden-messages.v1/')).map(key => [key, JSON.parse(localStorage.getItem(key))])",
    );
    assert.equal(localEntries.length, 2);
    for (const [key, ids] of localEntries) {
      assert.ok(
        key.startsWith(
          "meetspace.hidden-messages.v1/" +
            encodeURIComponent(fixture.origin) +
            "/" +
            USER_A +
            "/",
        ),
      );
      assert.deepEqual(ids, [items[2].id], "Only opaque IDs are retained");
    }
    checks.push(
      "Direct/group message forwarding replays one operation after a lost response, preserves the author and native attachment. Multi-delete confirms scope and retries only remaining messages after a partial failure. Local deletion also covers incoming and read-only conference comments, persists across reopening, and never calls DELETE. Conference forwarding preserves source scope.",
    );
  } finally {
    delete controls.actionThreads;
  }
};
