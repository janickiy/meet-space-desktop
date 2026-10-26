/** Native notices consume only authenticated broker events, never renderer text. */
export interface NativeNotificationIdentity {
  profileId: string;
  userId: string;
}
export interface NativeNotificationPreferences {
  invitation: boolean;
  reminder: boolean;
  recording: boolean;
  summary: boolean;
}
export interface NativeNotificationHandle {
  on(
    event: "click" | "close" | "failed",
    listener: (...args: unknown[]) => void,
  ): unknown;
  show(): void;
  close(): void;
}
export interface NativeNotificationOptions {
  create(options: {
    title: string;
    body: string;
    silent: boolean;
  }): NativeNotificationHandle;
  supported(): boolean;
  /** The owned window must be both visible and focused. */
  isFocused(): boolean;
  navigate(route: string): void;
  onUnread?(count: number): void;
  /** App-owned audio uses the selected output; suppress the OS tone to avoid duplicates. */
  onSound?(identity: NativeNotificationIdentity, noticeId: string): void;
  clock?(): number;
}
type Category = keyof NativeNotificationPreferences;
interface Notice {
  id: string;
  messageId?: string;
  target: string;
  route: string;
  body: string;
  category?: Category;
  createdAt: number;
}
interface VisibleNotice {
  notice: Notice;
  handle: NativeNotificationHandle;
  generation: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validID = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const MAX_SEEN = 512,
  MAX_VISIBLE = 8,
  MAX_TARGETS = 256,
  MAX_AGE = 5 * 60_000;

function parseNotice(value: unknown, userId: string): Notice | null {
  if (
    !record(value) ||
    !validID(value.id) ||
    value.userId !== userId ||
    value.version !== 1 ||
    value.readAt != null ||
    !record(value.payload) ||
    typeof value.createdAt !== "string"
  )
    return null;
  const createdAt = Date.parse(value.createdAt);
  if (!Number.isFinite(createdAt)) return null;
  const payload = value.payload;
  const base = { id: value.id, createdAt };
  if (value.type === "chat.message") {
    if (!validID(payload.messageId)) return null;
    if (payload.conversationId !== undefined && payload.conversationId !== "") {
      if (
        !validID(payload.conversationId) ||
        !["direct", "group"].includes(String(payload.conversationType))
      )
        return null;
      return {
        ...base,
        messageId: payload.messageId,
        target: `conversation:${payload.conversationId}`,
        route: `/personal/${payload.conversationId}?message=${payload.messageId}`,
        body:
          payload.conversationType === "group"
            ? "Новое сообщение в группе"
            : "Новое сообщение в личном чате",
      };
    }
    if (!validID(payload.conferenceId)) return null;
    return {
      ...base,
      messageId: payload.messageId,
      target: `conference:${payload.conferenceId}`,
      route: `/meetings/${payload.conferenceId}?chat=1&message=${payload.messageId}`,
      body: "Новое сообщение в чате встречи",
    };
  }
  if (!validID(payload.conferenceId)) return null;
  const target = `conference:${payload.conferenceId}`;
  const conference = `/conferences/${payload.conferenceId}`;
  switch (value.type) {
    case "conference.invited":
      if (payload.invitationId !== undefined && !validID(payload.invitationId))
        return null;
      return {
        ...base,
        target,
        route: `${conference}/join`,
        category: "invitation",
        body: "Вас пригласили на встречу",
      };
    case "conference.rescheduled":
      return {
        ...base,
        target,
        route: conference,
        category: "invitation",
        body: "Время встречи изменилось",
      };
    case "conference.cancelled":
      return {
        ...base,
        target,
        route: conference,
        category: "invitation",
        body: "Встреча отменена",
      };
    case "conference.soon":
      return {
        ...base,
        target,
        route: conference,
        category: "reminder",
        body: "Скоро начнётся встреча",
      };
    case "admission.decided":
      if (
        !["admitted", "rejected", "kicked"].includes(
          String(payload.admissionState),
        )
      )
        return null;
      return {
        ...base,
        target,
        route: conference,
        category: "invitation",
        body:
          payload.admissionState === "admitted"
            ? "Вас пригласили войти во встречу"
            : payload.admissionState === "rejected"
              ? "Запрос на вход отклонён"
              : "Вы исключены из встречи",
      };
    case "recording.ready":
      if (!validID(payload.recordingId)) return null;
      return {
        ...base,
        target,
        route: `/history/${payload.conferenceId}?recording=${payload.recordingId}&section=recording`,
        category: "recording",
        body: "Запись встречи готова",
      };
    case "transcript.ready":
    case "transcript.failed":
    case "summary.ready":
    case "summary.failed": {
      if (!validID(payload.recordingId)) return null;
      const section = value.type.startsWith("summary.")
        ? "summary"
        : "transcript";
      const failed = value.type.endsWith(".failed");
      return {
        ...base,
        target,
        route: `/history/${payload.conferenceId}?recording=${payload.recordingId}&tab=${section}&section=${section}`,
        category: "summary",
        body:
          section === "summary"
            ? failed
              ? "Не удалось подготовить итоги встречи"
              : "Итоги встречи готовы"
            : failed
              ? "Не удалось подготовить расшифровку"
              : "Расшифровка встречи готова",
      };
    }
    default:
      return null; // Unknown contracts stay in the existing in-app notification feed.
  }
}

/** Bounded, in-memory state is discarded on account/profile changes. */
export class NativeNotifications {
  private identity: NativeNotificationIdentity | null = null;
  private generation = 0;
  private activatedAt = 0;
  private enabled = true;
  private disposed = false;
  private preferences: NativeNotificationPreferences | null = null;
  private context: { route: string; soundEnabled: boolean } | null = null;
  private seen = new Map<string, number>();
  private visible = new Map<string, VisibleNotice>();
  private blocked = new Map<string, boolean>();
  private readThrough = new Map<string, number>();
  private unread = 0;
  private lastSoundAt = -Infinity;
  private now: () => number;
  constructor(private readonly options: NativeNotificationOptions) {
    this.now = options.clock ?? Date.now;
  }

  setIdentity(identity: NativeNotificationIdentity | null): void {
    if (this.disposed) return;
    if (
      identity &&
      (!/^[a-f0-9]{32}$/.test(identity.profileId) || !validID(identity.userId))
    )
      throw new Error("invalid_request");
    if (
      identity?.profileId === this.identity?.profileId &&
      identity?.userId === this.identity?.userId
    )
      return;
    this.clear();
    this.identity = identity ? { ...identity } : null;
    this.activatedAt = this.now();
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled === true;
    if (!this.enabled) this.closeVisible();
  }
  setContext(context: { route: string; soundEnabled: boolean } | null): void {
    if (this.disposed || !this.identity) return;
    if (context === null) {
      this.context = null;
      this.closeVisible();
      return;
    }
    if (
      !context ||
      typeof context.route !== "string" ||
      !context.route.startsWith("/") ||
      context.route.startsWith("//") ||
      context.route.length > 2048 ||
      /[\u0000-\u0020\u007f\\#]/.test(context.route) ||
      typeof context.soundEnabled !== "boolean"
    )
      throw new Error("invalid_request");
    this.context = { ...context };
    if (this.options.isFocused())
      for (const [id, entry] of this.visible)
        if (this.targetFocused(entry.notice.target)) this.close(id);
  }
  setPreferences(preferences: NativeNotificationPreferences): void {
    if (this.disposed || !this.identity) return;
    if (
      !preferences ||
      !["invitation", "reminder", "recording", "summary"].every(
        (key) => typeof preferences[key as Category] === "boolean",
      )
    )
      return;
    this.preferences = { ...preferences };
    for (const [id, entry] of this.visible)
      if (entry.notice.category && !preferences[entry.notice.category])
        this.close(id);
  }
  setUnreadCount(count: number): void {
    if (
      this.disposed ||
      !this.identity ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      return;
    const next = Math.min(count, 9999);
    if (this.unread !== next) {
      this.unread = next;
      this.options.onUnread?.(next);
    }
  }
  observe(event: unknown): void {
    if (
      this.disposed ||
      !this.identity ||
      !record(event) ||
      event.version !== 1 ||
      !validID(event.id) ||
      !record(event.data)
    )
      return;
    const now = this.now();
    this.prune(now);
    if (event.type === "notification.read") {
      if (!validID(event.data.id)) return;
      this.remember(`notice:${event.data.id}`, now);
      this.close(event.data.id);
      return;
    }
    if (event.type !== "notification.created") return;
    const notice = parseNotice(event.data.notification, this.identity.userId);
    if (
      !notice ||
      notice.id !== event.id ||
      notice.createdAt < this.activatedAt ||
      notice.createdAt < now - MAX_AGE ||
      notice.createdAt > now + 30_000
    )
      return;
    const key = `notice:${notice.id}`,
      messageKey = notice.messageId ? `message:${notice.messageId}` : undefined;
    if (this.seen.has(key) || (messageKey && this.seen.has(messageKey))) return;
    this.remember(key, now);
    if (messageKey) this.remember(messageKey, now);
    if (
      !this.enabled ||
      !this.context ||
      !this.preferences ||
      (notice.category && !this.preferences[notice.category]) ||
      this.blocked.get(notice.target) ||
      notice.createdAt <= (this.readThrough.get(notice.target) ?? 0) ||
      this.targetFocused(notice.target) ||
      !this.options.supported()
    )
      return;
    // Bursts remain bounded in the OS centre; text from users/server is never displayed.
    while (this.visible.size >= MAX_VISIBLE)
      this.close(this.visible.keys().next().value!);
    const generation = this.generation;
    try {
      const soundEnabled =
        this.context.soundEnabled && now - this.lastSoundAt >= 1000;
      const handle = this.options.create({
        title: "MeetSpace",
        body: notice.body,
        silent: !!this.options.onSound || !soundEnabled,
      });
      const entry = { notice, handle, generation };
      this.visible.set(notice.id, entry);
      const forget = () => {
        if (this.visible.get(notice.id) === entry)
          this.visible.delete(notice.id);
      };
      handle.on("click", () => {
        if (
          this.disposed ||
          this.generation !== generation ||
          this.visible.get(notice.id) !== entry ||
          this.blocked.get(notice.target)
        )
          return;
        this.close(notice.id);
        this.options.navigate(notice.route);
      });
      handle.on("close", forget);
      handle.on("failed", forget);
      handle.show();
      if (soundEnabled) {
        this.lastSoundAt = now;
        this.options.onSound?.({ ...this.identity }, notice.id);
      }
    } catch {
      this.close(
        notice.id,
      ); /* Unsupported/denied OS delivery never breaks the notification feed. */
    }
  }
  /** Current account socket lifecycle only; notification.created must arrive via guarded SSE. */
  observeAccount(event: unknown): void {
    if (
      this.disposed ||
      !this.identity ||
      !record(event) ||
      !record(event.data)
    )
      return;
    const data = event.data;
    if (
      !validID(data.conversationId) ||
      !["direct", "group"].includes(String(data.type))
    )
      return;
    const target = `conversation:${data.conversationId}`;
    if (
      event.type === "message.deleted" &&
      record(data.message) &&
      validID(data.message.id)
    ) {
      this.remember(`message:${data.message.id}`, this.now());
      for (const [id, entry] of this.visible)
        if (entry.notice.messageId === data.message.id) this.close(id);
      return;
    }
    if (event.type === "conversation.read.updated") {
      // This envelope is published to the reader's account channel; it has no userId.
      if (
        !record(data.state) ||
        !Number.isSafeInteger(data.state.unreadCount) ||
        Number(data.state.unreadCount) < 0
      )
        return;
      if (validID(data.state.lastReadMessageId)) {
        this.remember(`message:${data.state.lastReadMessageId}`, this.now());
        for (const [id, entry] of this.visible)
          if (entry.notice.messageId === data.state.lastReadMessageId)
            this.close(id);
      }
      if (data.state.unreadCount !== 0) return;
      const at =
        typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
      if (Number.isFinite(at) && at <= this.now() + 30_000) {
        this.readThrough.set(target, at);
        this.trim(this.readThrough, MAX_TARGETS);
      }
      for (const [id, entry] of this.visible)
        if (entry.notice.target === target) this.close(id);
      return;
    }
    if (
      typeof event.type === "string" &&
      event.type.startsWith("message.") &&
      typeof data.notificationsEnabled === "boolean"
    ) {
      this.blocked.set(target, !data.notificationsEnabled);
      this.trim(this.blocked, MAX_TARGETS);
      if (!data.notificationsEnabled)
        for (const [id, entry] of this.visible)
          if (entry.notice.target === target) this.close(id);
      return;
    }
    if (data.userId !== this.identity.userId) return;
    const mute =
      event.type === "conversation.preferences.updated" &&
      record(data.item) &&
      data.item.id === data.conversationId &&
      typeof data.item.notificationsEnabled === "boolean"
        ? !data.item.notificationsEnabled
        : undefined;
    if (mute !== undefined) {
      this.blocked.set(target, mute);
      this.trim(this.blocked, MAX_TARGETS);
      if (!mute) return;
    } else if (
      event.type === "conversation.member.removed" ||
      event.type === "conversation.hidden"
    ) {
      this.blocked.set(target, true);
      this.trim(this.blocked, MAX_TARGETS);
    } else if (event.type === "conversation.history.cleared") {
      const at =
        typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
      if (Number.isFinite(at) && at <= this.now() + 30_000) {
        this.readThrough.set(target, at);
        this.trim(this.readThrough, MAX_TARGETS);
      }
    } else if (event.type === "conversation.member.added") {
      this.blocked.delete(target);
      return;
    } else return;
    for (const [id, entry] of this.visible)
      if (entry.notice.target === target) this.close(id);
  }
  /** Call on window focus so a shown toast does not remain over its open conversation. */
  refreshFocus(): void {
    if (this.options.isFocused())
      for (const [id, entry] of this.visible)
        if (this.targetFocused(entry.notice.target)) this.close(id);
  }
  clear(): void {
    this.generation++;
    this.closeVisible();
    this.seen.clear();
    this.blocked.clear();
    this.readThrough.clear();
    this.identity = null;
    this.preferences = null;
    this.context = null;
    this.unread = 0;
    this.lastSoundAt = -Infinity;
    this.options.onUnread?.(0);
  }
  dispose(): void {
    this.clear();
    this.disposed = true;
  }
  private targetFocused(target: string): boolean {
    if (!this.context || !this.options.isFocused()) return false;
    const pathname = this.context.route.split("?", 1)[0].replace(/\/$/, "");
    const [kind, id] = target.split(":");
    return kind === "conversation"
      ? pathname === `/personal/${id}`
      : pathname === `/meetings/${id}` ||
          pathname === `/conferences/${id}` ||
          pathname === `/conferences/${id}/join`;
  }
  private close(id: string): void {
    const entry = this.visible.get(id);
    if (!entry) return;
    this.visible.delete(id);
    try {
      entry.handle.close();
    } catch {}
  }
  private closeVisible(): void {
    for (const id of this.visible.keys()) this.close(id);
  }
  private remember(key: string, at: number): void {
    this.seen.delete(key);
    this.seen.set(key, at);
    this.trim(this.seen, MAX_SEEN);
  }
  private trim<T>(map: Map<string, T>, limit: number): void {
    while (map.size > limit) map.delete(map.keys().next().value!);
  }
  private prune(now: number): void {
    for (const [key, at] of this.seen)
      if (at < now - MAX_AGE) this.seen.delete(key);
  }
}
