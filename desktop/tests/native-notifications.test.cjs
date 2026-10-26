const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { NativeNotifications } = require("../dist/native-notifications.js");
const user = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const conversation = "20000000-0000-4000-8000-000000000001";
const conference = "30000000-0000-4000-8000-000000000001";
const profile = "a".repeat(32);
const preferences = {
  invitation: true,
  reminder: true,
  recording: true,
  summary: true,
};
function fixture(options = {}) {
  let time = Date.parse("2026-10-14T08:00:00Z"),
    focused = false;
  const shown = [],
    routes = [],
    unread = [];
  const notifier = new NativeNotifications({
    create: (value) => {
      const handle = new EventEmitter();
      handle.options = value;
      handle.closed = false;
      handle.show = () => {
        shown.push(handle);
      };
      handle.close = () => {
        handle.closed = true;
        handle.emit("close");
      };
      return handle;
    },
    supported: () => true,
    isFocused: () => focused,
    navigate: (route) => routes.push(route),
    onUnread: (count) => unread.push(count),
    clock: () => time,
    ...options,
  });
  notifier.setIdentity({ profileId: profile, userId: user });
  notifier.setPreferences(preferences);
  notifier.setContext({ route: "/personal", soundEnabled: true });
  const notice = (changes = {}, payload = {}) => {
    const id = randomUUID();
    return {
      version: 1,
      id,
      type: "notification.created",
      data: {
        notification: {
          id,
          userId: user,
          version: 1,
          type: "chat.message",
          createdAt: new Date(time).toISOString(),
          readAt: null,
          payload: {
            conversationId: conversation,
            conversationType: "direct",
            messageId: randomUUID(),
            ...payload,
          },
          ...changes,
        },
      },
    };
  };
  const account = (type, data = {}) => ({
    version: 1,
    id: randomUUID(),
    timestamp: new Date(time).toISOString(),
    type,
    data: { conversationId: conversation, type: "direct", ...data },
  });
  return {
    notifier,
    notice,
    account,
    shown,
    routes,
    unread,
    setFocused: (value) => {
      focused = value;
    },
    advance: (value) => {
      time += value;
    },
  };
}

test("native messages use static text, current identity and generated internal routes", () => {
  const f = fixture();
  const event = f.notice({
    text: "PRIVATE",
    title: "malicious",
    url: "https://evil.invalid",
  });
  f.notifier.observe(event);
  assert.deepEqual(f.shown[0].options, {
    title: "MeetSpace",
    body: "Новое сообщение в личном чате",
    silent: false,
  });
  f.shown[0].emit("click");
  assert.equal(
    f.routes[0],
    `/personal/${conversation}?message=${event.data.notification.payload.messageId}`,
  );
  assert.equal(f.shown[0].closed, true);
  f.shown[0].emit("click");
  assert.equal(f.routes.length, 1);
});

test("focused matching conversation is suppressed while another route or hidden window can notify", () => {
  const f = fixture();
  f.setFocused(true);
  f.notifier.setContext({
    route: `/personal/${conversation}?message=old`,
    soundEnabled: false,
  });
  f.notifier.observe(f.notice());
  assert.equal(f.shown.length, 0);
  f.setFocused(false);
  f.notifier.observe(f.notice());
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].options.silent, true);
  f.setFocused(true);
  f.notifier.refreshFocus();
  assert.equal(f.shown[0].closed, true);
  f.notifier.setContext({ route: "/app", soundEnabled: true });
  f.notifier.observe(f.notice());
  assert.equal(f.shown.length, 2);
});

test("notification ID and message ID dedup survive reconnect and reject old/future/read/malformed notices", () => {
  const f = fixture();
  const event = f.notice();
  f.notifier.observe(event);
  f.notifier.observe(event);
  const replay = f.notice(
    {},
    { messageId: event.data.notification.payload.messageId },
  );
  f.notifier.observe(replay);
  for (const change of [
    { userId: other },
    { readAt: new Date().toISOString() },
    { version: 2 },
    { createdAt: "invalid" },
    { createdAt: "2026-10-14T07:59:59Z" },
    { createdAt: "2026-10-14T08:01:00Z" },
    { type: "invented.invitation" },
  ])
    f.notifier.observe(f.notice(change));
  f.notifier.observe(f.notice({}, { conversationId: "../escape" }));
  f.notifier.observe(f.notice({}, { messageId: "https://evil.invalid" }));
  assert.equal(f.shown.length, 1);
});

test("native toggle and loaded authoritative category preferences gate invitation delivery", () => {
  const f = fixture();
  const invitation = () =>
    f.notice(
      { type: "conference.invited" },
      {
        conversationId: undefined,
        conferenceId: conference,
        invitationId: randomUUID(),
      },
    );
  f.notifier.setPreferences({ ...preferences, invitation: false });
  f.notifier.observe(invitation());
  assert.equal(f.shown.length, 0);
  f.notifier.setPreferences(preferences);
  f.notifier.observe(invitation());
  assert.equal(f.shown.length, 1);
  f.shown[0].emit("click");
  assert.equal(f.routes[0], `/conferences/${conference}/join`);
  f.notifier.setEnabled(false);
  f.notifier.observe(invitation());
  assert.equal(f.shown.length, 1);
  f.notifier.setEnabled(true);
  f.notifier.setIdentity({ profileId: "b".repeat(32), userId: user });
  f.notifier.setContext({ route: "/app", soundEnabled: true });
  f.notifier.observe(invitation());
  assert.equal(f.shown.length, 1, "unknown preferences fail closed");
});

test("logout/profile change closes native notices, clears unread, and invalidates old click callbacks", () => {
  const f = fixture();
  f.notifier.observe(f.notice());
  const old = f.shown[0];
  f.notifier.setUnreadCount(18);
  f.notifier.setIdentity(null);
  assert.equal(old.closed, true);
  assert.equal(f.unread.at(-1), 0);
  old.emit("click");
  assert.equal(f.routes.length, 0);
  f.notifier.setIdentity({ profileId: "b".repeat(32), userId: user });
  f.notifier.setPreferences(preferences);
  f.notifier.setContext({ route: "/app", soundEnabled: false });
  f.notifier.observe(f.notice());
  assert.equal(f.shown.length, 2);
  assert.equal(f.shown[1].options.silent, true);
  f.notifier.dispose();
  f.notifier.observe(f.notice());
  assert.equal(f.shown.length, 2);
  assert.equal(f.shown[1].closed, true);
});

test("null renderer context closes notices without discarding authoritative identity and category preferences", () => {
  const f = fixture();
  const old = f.notice();
  f.notifier.observe(old);
  f.notifier.setUnreadCount(9);
  f.notifier.setContext(null);
  assert.equal(f.shown[0].closed, true);
  const paused = f.notice();
  f.notifier.observe(paused);
  assert.equal(f.shown.length, 1);
  f.shown[0].emit("click");
  assert.equal(f.routes.length, 0);
  f.notifier.setContext({ route: "/app", soundEnabled: true });
  f.notifier.observe(old);
  f.notifier.observe(paused);
  assert.equal(
    f.shown.length,
    1,
    "suppressed events are never replayed on remount",
  );
  f.notifier.observe(f.notice());
  assert.equal(
    f.shown.length,
    2,
    "restored context retains category preferences",
  );
  assert.equal(f.unread.at(-1), 9);
});

test("read notifications and current account read receipts close native notices, including delayed replay", () => {
  const f = fixture();
  const event = f.notice();
  f.notifier.observe(event);
  f.notifier.observe({
    version: 1,
    id: randomUUID(),
    type: "notification.read",
    data: { id: event.id },
  });
  assert.equal(f.shown[0].closed, true);
  f.notifier.observe(event);
  assert.equal(f.shown.length, 1);
  const unread = f.notice();
  f.notifier.observe(unread);
  f.advance(10);
  f.notifier.observeAccount(
    f.account("conversation.read.updated", {
      state: {
        lastReadMessageId: unread.data.notification.payload.messageId,
        unreadCount: 0,
      },
    }),
  );
  assert.equal(f.shown[1].closed, true);
  f.notifier.observe(f.notice({ createdAt: "2026-10-14T08:00:00Z" }));
  assert.equal(f.shown.length, 2);
  f.advance(10);
  f.notifier.observe(f.notice());
  assert.equal(f.shown.length, 3);
});

test("mute, removal and deletion invalidate notices without processing arbitrary account notification payloads", () => {
  const f = fixture();
  f.notifier.observeAccount(f.notice());
  assert.equal(f.shown.length, 0);
  const first = f.notice();
  f.notifier.observe(first);
  f.notifier.observeAccount(
    f.account("conversation.preferences.updated", {
      userId: user,
      item: { id: conversation, notificationsEnabled: false },
    }),
  );
  assert.equal(f.shown[0].closed, true);
  f.notifier.observe(f.notice());
  assert.equal(f.shown.length, 1);
  f.notifier.observeAccount(
    f.account("conversation.preferences.updated", {
      userId: user,
      item: { id: conversation, notificationsEnabled: true },
    }),
  );
  const next = f.notice();
  f.notifier.observe(next);
  assert.equal(f.shown.length, 2);
  f.notifier.observeAccount(
    f.account("message.deleted", {
      message: { id: next.data.notification.payload.messageId },
    }),
  );
  assert.equal(f.shown[1].closed, true);
  f.notifier.observe(f.notice());
  f.notifier.observeAccount(
    f.account("conversation.member.removed", { userId: user }),
  );
  assert.equal(f.shown.at(-1).closed, true);
  f.notifier.observe(f.notice());
  assert.equal(f.shown.length, 3);
});

test("unsupported or failed OS notifications leave feed processing safe", () => {
  const unsupported = fixture({ supported: () => false });
  assert.doesNotThrow(() => unsupported.notifier.observe(unsupported.notice()));
  assert.equal(unsupported.shown.length, 0);
  const denied = fixture({
    create: () => {
      throw new Error("OS denied");
    },
  });
  assert.doesNotThrow(() => denied.notifier.observe(denied.notice()));
  const failed = fixture();
  failed.notifier.observe(failed.notice());
  failed.shown[0].emit("failed", {}, "OS denied");
  failed.shown[0].emit("click");
  assert.equal(failed.routes.length, 0);
});

test("notification bursts and unread snapshots stay bounded; malformed counts cannot alter state", () => {
  const f = fixture();
  for (let index = 0; index < 600; index++) f.notifier.observe(f.notice());
  assert.ok(f.shown.filter((handle) => !handle.closed).length <= 8);
  assert.ok(f.notifier.seen.size <= 512);
  assert.equal(
    f.shown.filter((handle) => !handle.options.silent).length,
    1,
    "bursts produce only one OS sound",
  );
  f.advance(1000);
  f.notifier.observe(f.notice());
  assert.equal(f.shown.at(-1).options.silent, false);
  f.notifier.setUnreadCount(1e8);
  assert.equal(f.unread.at(-1), 9999);
  for (const value of [-1, NaN, Infinity, 1.5, "7"])
    f.notifier.setUnreadCount(value);
  assert.equal(f.unread.at(-1), 9999);
  f.notifier.setUnreadCount(0);
  assert.equal(f.unread.at(-1), 0);
});

test("supported recording/summary events route by validated IDs and categories", () => {
  const f = fixture();
  const recordingId = randomUUID();
  for (const type of [
    "recording.ready",
    "transcript.ready",
    "summary.ready",
    "transcript.failed",
    "summary.failed",
  ])
    f.notifier.observe(
      f.notice(
        { type },
        { conferenceId: conference, recordingId, conversationId: undefined },
      ),
    );
  assert.equal(f.shown.length, 5);
  f.shown[2].emit("click");
  assert.equal(
    f.routes[0],
    `/history/${conference}?recording=${recordingId}&tab=summary&section=summary`,
  );
  f.notifier.setPreferences({
    ...preferences,
    recording: false,
    summary: false,
  });
  assert.ok(f.shown.every((handle) => handle.closed));
});

test("app sound replaces the OS tone, is identity scoped and coalesces duplicate/burst delivery", () => {
  const sounds = [];
  const f = fixture({ onSound: (identity, id) => sounds.push({ ...identity, id }) });
  const first = f.notice();
  f.notifier.observe(first);
  f.notifier.observe(first);
  f.notifier.observe(f.notice());
  assert.deepEqual(sounds, [{ profileId: profile, userId: user, id: first.id }]);
  assert.ok(f.shown.every(handle => handle.options.silent), "never play both OS and app sound");
  f.advance(1000);
  f.notifier.observe(f.notice());
  assert.equal(sounds.length, 2);
  f.notifier.setContext({ route: "/app", soundEnabled: false });
  f.advance(1000);
  f.notifier.observe(f.notice());
  assert.equal(f.shown.length, 4, "toast still arrives when sound is disabled");
  assert.equal(sounds.length, 2);
});

test("app sound obeys active-chat, mute, category, stale-event and logout suppression", () => {
  const sounds = [];
  const f = fixture({ onSound: (_, id) => sounds.push(id) });
  f.setFocused(true);
  f.notifier.setContext({ route: `/personal/${conversation}`, soundEnabled: true });
  f.notifier.observe(f.notice());
  f.setFocused(false);
  f.notifier.observeAccount(f.account("conversation.preferences.updated", {
    userId: user, item: { id: conversation, notificationsEnabled: false },
  }));
  f.notifier.observe(f.notice());
  f.notifier.setPreferences({ ...preferences, invitation: false });
  f.notifier.observe(f.notice({ type: "conference.invited" }, { conferenceId: conference, conversationId: undefined }));
  f.notifier.observe(f.notice({ createdAt: "2026-10-14T07:59:59Z" }));
  f.notifier.setIdentity(null);
  f.notifier.observe(f.notice());
  assert.deepEqual(sounds, []);
  assert.equal(f.shown.length, 0);
});
