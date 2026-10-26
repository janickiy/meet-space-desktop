import { useId, useState } from "react";
import { Link } from "react-router";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
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
/**
 * NotificationBell показывает непрочитанные уведомления, поддерживает страницы и отметку прочтения.
 *
 *
 * @returns JSX-представление компонента для текущих свойств и состояния.
 */
export function NotificationBell() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const unreadDescriptionId = useId();
  const query = useInfiniteQuery({
    queryKey: ["notifications", user?.id],
    initialPageParam: undefined as string | undefined,
    /**
     * queryFn загружает данные запроса с его сигналом отмены для кеша React Query.
     *
     * @args
     *   - объект параметров: pageParam — свойство текущего компонента; signal — сигнал отмены запроса или потока.
     *
     * @returns вычисленное значение: api.notifications(pageParam, signal).
     */
    queryFn: ({ pageParam, signal }) => api.notifications(pageParam, signal),
    /**
     * getNextPageParam извлекает курсор продолжения серверной страницы.
     *
     * @args
     *   - last — последняя загруженная страница, по которой определяется продолжение.
     *
     * @returns вычисленное значение: last.nextCursor || undefined.
     */
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 15000,
  });
  const read = useMutation({
    mutationFn: api.readNotification,
    /**
     * onSettled обрабатывает соответствующее событие интерфейса и изменяет состояние текущего действия.
     *
     *
     * @returns значение не возвращается; функция выполняет описанные действия и обновляет нужное состояние.
     */
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["notifications", user?.id] });
    },
  });
  const unread = query.data?.pages[0]?.unreadCount || 0;
  const rows = [
    ...new Map(
      (
        query.data?.pages.flatMap(
          /**
           * Обработчик flatMap преобразует текущий элемент в данные или представление результирующего списка.
           *
           * @args
           *   - page — изолированная страница Playwright.
           *
           * @returns преобразованное значение текущего элемента для результирующего набора.
           */ (page) => page.items,
        ) || []
      ).map(
        /**
         * Обработчик map преобразует текущий элемент в данные или представление результирующего списка.
         *
         * @args
         *   - item — элемент списка, который обрабатывает текущий шаг.
         *
         * @returns преобразованное значение текущего элемента для результирующего набора.
         */ (item) => [item.id, item],
      ),
    ).values(),
  ];
  return (
    <>
      <button
        type="button"
        className="icon-button notification-bell"
        aria-label="Уведомления"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={unread > 0 ? unreadDescriptionId : undefined}
        onClick={
          /**
           * onClick обрабатывает соответствующее событие интерфейса и изменяет состояние текущего действия.
           *
           *
           * @returns вычисленное значение: setOpen(true).
           */ () => setOpen(true)
        }
      >
        <span className="notification-bell-glyph" aria-hidden="true">
          <Bell size={22} strokeWidth={1.8} />
          {unread > 0 && <span className="notification-dot" />}
        </span>
        {unread > 0 && (
          <span id={unreadDescriptionId} className="sr-only">
            {unread} непрочитанных уведомлений
          </span>
        )}
      </button>
      {open && (
        <Modal
          title="Уведомления"
          className="notification-modal notification-center"
          onClose={() => setOpen(false)}
        >
          <header className="notification-center-header">
            <div className="notification-center-heading">
              <div className="notification-center-title">
                <h3>Уведомления</h3>
                {unread > 0 && (
                  <span className="notification-center-count">
                    Новых: {unread}
                  </span>
                )}
              </div>
            </div>
          </header>
          <div className="notification-center-content">
            <ErrorNotice error={query.error || read.error} />
            {query.isPending ? (
              <Loading />
            ) : (
              <>
                {!rows.length && !query.isError && (
                  <div className="notification-center-empty">
                    <span aria-hidden="true">
                      <Bell size={30} />
                    </span>
                    <h4>Пока нет уведомлений</h4>
                    <p>
                      Здесь появятся приглашения на встречи, новые сообщения и
                      готовые записи.
                    </p>
                  </div>
                )}
                {!!rows.length && (
                  <ul
                    className="notification-center-list"
                    aria-label="Последние уведомления"
                  >
                    {rows.map((item) => {
                      const Icon = notificationIcon(item);
                      return (
                        <li key={item.id}>
                          <article
                            className={`notification-center-item ${item.readAt ? "is-read" : "is-unread"}`}
                          >
                            <span
                              className="notification-center-item-icon"
                              aria-hidden="true"
                            >
                              <Icon size={20} />
                            </span>
                            <div className="notification-center-item-copy">
                              <div className="notification-center-item-title">
                                <h4>{notificationLabel(item)}</h4>
                                {!item.readAt && (
                                  <span
                                    className="notification-center-unread-dot"
                                    role="img"
                                    aria-label="Непрочитанное"
                                  />
                                )}
                              </div>
                              <time dateTime={item.createdAt}>
                                {formatDate(item.createdAt)}
                              </time>
                              {(item.payload.conferenceId ||
                                item.payload.conversationId) && (
                                <Link
                                  className="notification-center-destination"
                                  to={notificationLink(item)}
                                  onClick={() => {
                                    if (!item.readAt) read.mutate(item.id);
                                    setOpen(false);
                                  }}
                                >
                                  {item.payload.conversationId
                                    ? "Открыть чат"
                                    : item.type === "chat.message"
                                      ? "Открыть комментарий"
                                      : "Открыть встречу"}
                                  <ArrowRight size={16} aria-hidden="true" />
                                </Link>
                              )}
                            </div>
                            {!item.readAt && (
                              <Button
                                className="notification-center-read"
                                variant="outline"
                                busy={
                                  read.isPending && read.variables === item.id
                                }
                                disabled={read.isPending}
                                onClick={() => read.mutate(item.id)}
                                title="Отметить как прочитанное"
                                aria-label={`Отметить как прочитанное: ${notificationLabel(item)}`}
                              >
                                <Check size={18} aria-hidden="true" />
                              </Button>
                            )}
                          </article>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {query.hasNextPage && (
                  <Button
                    className="notification-center-more"
                    variant="outline"
                    busy={query.isFetchingNextPage}
                    onClick={() => void query.fetchNextPage()}
                  >
                    Ещё уведомления
                  </Button>
                )}
                {query.isError && (
                  <Button
                    className="notification-center-more"
                    variant="outline"
                    busy={query.isFetching}
                    onClick={() => void query.refetch()}
                  >
                    Попробовать снова
                  </Button>
                )}
              </>
            )}
          </div>
          <footer className="notification-center-footer">
            <Link to="/notifications" onClick={() => setOpen(false)}>
              Все уведомления <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Закрыть
            </Button>
          </footer>
        </Modal>
      )}
    </>
  );
}
