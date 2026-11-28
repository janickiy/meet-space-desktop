import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "react-router";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ChevronRight,
  CheckCheck,
  Settings,
  Bell,
  CalendarClock,
  CircleAlert,
  FileText,
  MessageCircle,
  Video,
} from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { formatDate } from "../utils";
import { notificationLink } from "../intelligence";
import type { Notification } from "../types";
import { Button, ErrorNotice, Loading, Modal } from "./ui";
import "./notification-modal.css";

function notificationIcon(item: Notification) {
  if (item.type === "chat.message") return MessageCircle;
  if (item.type.endsWith(".failed")) return CircleAlert;
  if (/recording|transcript|summary/.test(item.type)) return FileText;
  if (["conference.soon", "conference.rescheduled"].includes(item.type))
    return CalendarClock;
  if (item.type === "conference.invited") return Video;
  return Bell;
}

/**
 * notificationLabel переводит тип и нагрузку уведомления в понятную подпись для списка.
 *
 * @args
 *   - item (Notification) — элемент списка, который обрабатывает текущий шаг.
 *
 * @returns string — вычисленное значение: "Запись встречи готова"; "Скоро начнётся встреча"; "Вас пригласили войти во встречу"; "Запрос на вход отклонён"; "Вы исключены из встречи"; "Обновление вашей конференции".
 */
export function notificationLabel(item: Notification): string {
  if (item.type === "chat.message") {
    const place = item.payload.conversationId
      ? item.payload.conversationType === "group"
        ? "в группе"
        : "в личном чате"
      : "в чате встречи";
    return item.payload.isReply
      ? `Ответ на ваше сообщение ${place}`
      : `Новое сообщение ${place}`;
  }
  if (item.type === "transcript.failed")
    return "Не удалось подготовить расшифровку";
  if (item.type === "summary.failed")
    return "Не удалось подготовить итоги встречи";
  if (item.type.includes("transcript")) return "Расшифровка встречи готова";
  if (item.type.includes("summary")) return "Итоги встречи готовы";
  if (item.type.includes("recording")) return "Запись встречи готова";
  if (item.type === "conference.soon") return "Скоро начнётся встреча";
  if (item.type === "conference.invited") return "Вас пригласили на встречу";
  if (item.type === "conference.rescheduled") return "Время встречи изменилось";
  if (item.type === "conference.cancelled") return "Встреча отменена";
  if (item.type === "processing.failed")
    return "Обработка материалов не завершена";
  if (item.payload.admissionState === "admitted")
    return "Вас пригласили войти во встречу";
  if (item.payload.admissionState === "rejected")
    return "Запрос на вход отклонён";
  if (item.payload.admissionState === "kicked")
    return "Вы исключены из встречи";
  return "Обновление вашей конференции";
}
function notificationCategory(item: Notification) {
  if (item.type === "chat.message") return "Сообщение";
  if (item.type === "conference.soon") return "Напоминание";
  if (item.type === "conference.invited") return "Приглашение";
  if (item.type.startsWith("recording.")) return "Запись";
  if (item.type.startsWith("transcript.")) return "Расшифровка";
  if (item.type.startsWith("summary.")) return "Итоги встречи";
  return "Встреча";
}

async function readAllNotifications(signal: AbortSignal) {
  const unreadIds = new Set<string>();
  const visited = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await api.notifications(cursor, signal);
    for (const row of page.items) {
      if (!row.readAt) unreadIds.add(row.id);
    }
    if (unreadIds.size >= page.unreadCount) break;
    cursor = page.nextCursor || undefined;
    if (cursor && visited.has(cursor))
      throw new Error("Не удалось загрузить все уведомления.");
    if (cursor) visited.add(cursor);
  } while (cursor);
  // Collect the snapshot before writes so changes to unread state cannot skip a page.
  for (const id of unreadIds) {
    signal.throwIfAborted();
    await api.readNotification(id, signal);
  }
}

export function NotificationBell() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const batch = useRef<AbortController | null>(null);
  const unreadDescriptionId = useId();
  const [position, setPosition] = useState({ top: 64, right: 12 });
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect)
        setPosition({
          top: Math.max(
            12,
            Math.min(rect.bottom + 8, window.innerHeight - 240),
          ),
          right: Math.max(
            12,
            Math.min(window.innerWidth - rect.right, window.innerWidth - 412),
          ),
        });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => () => batch.current?.abort(), [user?.id]);
  const queryKey = ["notifications", user?.id];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api.notifications(pageParam, signal),
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 15000,
  });
  const refresh = () => client.invalidateQueries({ queryKey });
  const read = useMutation({
    mutationFn: (id: string) => api.readNotification(id),
    onSettled: refresh,
  });
  const readAll = useMutation({
    mutationFn: () => {
      const controller = new AbortController();
      batch.current = controller;
      return readAllNotifications(controller.signal);
    },
    onSettled: refresh,
  });
  const unread = query.data?.pages[0]?.unreadCount ?? 0;
  const rows = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.items)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const visible = onlyUnread ? rows.filter((row) => !row.readAt) : rows;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groups = [
    {
      title: "Недавно",
      items: visible.filter((row) => Date.parse(row.createdAt) >= +today),
    },
    {
      title: "Ранее",
      items: visible.filter((row) => !(Date.parse(row.createdAt) >= +today)),
    },
  ];
  const hasUnseen = onlyUnread && unread > 0 && query.hasNextPage;
  const close = () => setOpen(false);
  const countForm = new Intl.PluralRules("ru").select(unread);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="icon-button notification-bell"
        aria-label="Уведомления"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={unread ? unreadDescriptionId : undefined}
        onClick={() => {
          setOnlyUnread(false);
          setOpen(true);
        }}
      >
        <span className="notification-bell-glyph" aria-hidden="true">
          <Bell size={22} strokeWidth={1.8} />
          {unread > 0 && (
            <span className="notification-count">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
        {unread > 0 && (
          <span id={unreadDescriptionId} className="sr-only">
            Непрочитанных уведомлений — {unread}
          </span>
        )}
      </button>
      {open && (
        <Modal
          title="Уведомления"
          className="notification-modal nt-panel"
          onClose={close}
          style={
            {
              "--nt-panel-top": position.top + "px",
              right: position.right,
            } as CSSProperties
          }
        >
          <header className="nt-heading">
            <h3>Уведомления</h3>
            <span className="nt-total" aria-live="polite">
              {query.isPending
                ? "…"
                : unread
                  ? unread + (countForm === "one" ? " новое" : " новых")
                  : "Всё прочитано"}
            </span>
          </header>
          <div className="nt-toolbar">
            <div
              className="nt-filters"
              role="group"
              aria-label="Фильтр уведомлений"
            >
              <button
                type="button"
                aria-pressed={!onlyUnread}
                onClick={() => setOnlyUnread(false)}
              >
                Все
              </button>
              <button
                type="button"
                aria-pressed={onlyUnread}
                onClick={() => setOnlyUnread(true)}
              >
                Непрочитанные
              </button>
            </div>
            <button
              type="button"
              className="nt-read-all"
              disabled={!unread || readAll.isPending}
              aria-label="Прочитать все уведомления"
              onClick={() => readAll.mutate()}
            >
              <CheckCheck aria-hidden="true" />
              Прочитать все
            </button>
          </div>
          <div
            className="nt-list"
            role="region"
            aria-label="Список уведомлений"
          >
            <ErrorNotice error={query.error || read.error || readAll.error} />
            {query.isPending ? (
              <Loading />
            ) : (
              <>
                {groups
                  .filter((group) => group.items.length > 0)
                  .map((group) => (
                    <section key={group.title}>
                      <h4 className="nt-date">{group.title}</h4>
                      {group.items.map((item) => {
                        const Icon = notificationIcon(item);
                        return (
                          <Link
                            key={item.id}
                            className={
                              "nt-event" + (item.readAt ? "" : " is-unread")
                            }
                            to={notificationLink(item)}
                            onClick={() => {
                              if (!item.readAt) read.mutate(item.id);
                              close();
                            }}
                          >
                            <span className="nt-event-icon">
                              <Icon aria-hidden="true" />
                            </span>
                            <span className="nt-event-copy">
                              <strong>{notificationLabel(item)}</strong>
                              {item.payload.scheduledAt && (
                                <span className="nt-event-description">
                                  {formatDate(item.payload.scheduledAt)}
                                </span>
                              )}
                              <span className="nt-event-meta">
                                <time dateTime={item.createdAt}>
                                  {formatDate(item.createdAt)}
                                </time>{" "}
                                · {notificationCategory(item)}
                              </span>
                            </span>
                            {!item.readAt && (
                              <span
                                className="nt-unread-dot"
                                role="img"
                                aria-label="Непрочитанное"
                              />
                            )}
                            <ChevronRight aria-hidden="true" />
                          </Link>
                        );
                      })}
                    </section>
                  ))}
                {!visible.length && !query.isError && !hasUnseen && (
                  <div className="nt-empty">
                    <CheckCheck aria-hidden="true" />
                    <h3>
                      {onlyUnread ? "Всё прочитано" : "Пока нет уведомлений"}
                    </h3>
                    <p>
                      {onlyUnread
                        ? "Все события доступны во вкладке «Все»."
                        : "Здесь появятся приглашения, новые сообщения и готовые записи."}
                    </p>
                  </div>
                )}
                {query.hasNextPage && (!onlyUnread || unread > 0) && (
                  <Button
                    variant="outline"
                    busy={query.isFetchingNextPage}
                    onClick={() => void query.fetchNextPage()}
                  >
                    Ещё уведомления
                  </Button>
                )}
                {query.isError && (
                  <Button
                    variant="outline"
                    onClick={() => void query.refetch()}
                  >
                    Попробовать снова
                  </Button>
                )}
              </>
            )}
          </div>
          <footer className="nt-footer">
            <Link to="/settings#notification-settings" onClick={close}>
              <Settings aria-hidden="true" />
              Настроить уведомления
              <ChevronRight aria-hidden="true" />
            </Link>
          </footer>
        </Modal>
      )}
    </>
  );
}
