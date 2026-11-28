import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  CalendarDays,
  Clock3,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { isDesktopBuild } from "../platform/build";
import { useConferences } from "../queries";
import { Button, ErrorNotice, Modal } from "../components/ui";
import { CreateConference, EditSchedule } from "../components/ConferenceModals";
import { MeetingDetailsModal } from "../components/MeetingDetailsModal";
import { MeetingSkeleton } from "../components/MeetingSkeleton";
import { formatDate } from "../utils";
import { toLocalInput, localTimeZoneLabel } from "../collaboration";
import type { Conference } from "../types";
import "./calendar.css";
import "./collections-redesign.css";
import "./calendar-agenda.css";

type CalendarView = "week" | "month";
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const weekdayNames = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];
const meetingPlurals = new Intl.PluralRules("ru-RU");
function meetingCount(count: number) {
  const form = meetingPlurals.select(count);
  return `${count} ${form === "one" ? "встреча" : form === "few" ? "встречи" : "встреч"}`;
}
const hours = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * calendarDayKey возвращает местную дату, не сдвигая день через преобразование в UTC.
 * @args date — дата в часовом поясе браузера.
 * @return Устойчивый ключ года, месяца и дня для группировки встреч.
 */
export function calendarDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * calendarRange считает локальные границы недели или полных недель выбранного месяца.
 * @args anchor — выбранная дата; view — неделя либо месяц.
 * @return Дни сетки и UTC-границы серверного запроса, учитывающие переходы часового пояса.
 */
export function calendarRange(anchor: Date, view: CalendarView) {
  const start = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    view === "month" ? 1 : anchor.getDate(),
  );
  const firstWeekday = (start.getDay() + 6) % 7;
  const daysInMonth = new Date(
    anchor.getFullYear(),
    anchor.getMonth() + 1,
    0,
  ).getDate();
  start.setDate(start.getDate() - firstWeekday);
  const count =
    view === "month" ? Math.ceil((firstWeekday + daysInMonth) / 7) * 7 : 7;
  const days = Array.from(
    { length: count },
    (_, offset) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset),
  );
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + count,
  );
  end.setMilliseconds(-1);
  return { days, from: start.toISOString(), to: end.toISOString() };
}

/**
 * scheduledMeetingDate отделяет встречи с настоящим расписанием от созданных без даты.
 * @args conference — строка серверного списка, которая может не иметь scheduledAt.
 * @return Корректная дата запланированного начала либо null без выдуманной замены на createdAt.
 */
export function scheduledMeetingDate(conference: Conference) {
  if (!conference.scheduledAt) return null;
  const date = new Date(conference.scheduledAt);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * CalendarMeeting показывает в сетке время и статус реальной встречи.
 * @args meeting — встреча сервера; onSelect — открытие её карточки.
 * @return Клавиатурно доступная кнопка с названием и полным временем встречи.
 */
function CalendarMeeting({
  meeting,
  onSelect,
  agenda,
}: {
  meeting: Conference;
  onSelect: (meeting: Conference) => void;
  agenda?: "owner" | "guest";
}) {
  const date = scheduledMeetingDate(meeting)!;
  const time = date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const end =
    agenda && meeting.plannedDurationMin && meeting.plannedDurationMin > 0
      ? new Date(date.getTime() + meeting.plannedDurationMin * 60_000)
      : null;
  return (
    <button
      type="button"
      className={`calendar-event calendar-event-${meeting.status}`}
      data-agenda-role={agenda}
      onClick={() => onSelect(meeting)}
      aria-label={`${meeting.title}, ${formatDate(date.toISOString())}`}
    >
      <strong>
        {!agenda && (
          <>
            <time dateTime={date.toISOString()}>{time}</time>{" "}
          </>
        )}
        {meeting.title}
      </strong>
      {agenda && (
        <span className="agenda-event-range">
          <time dateTime={date.toISOString()}>{time}</time>
          {end && (
            <>
              {" "}
              —{" "}
              <time dateTime={end.toISOString()}>
                {end.toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </>
          )}
          {" · "}
          {agenda === "owner" ? "Вы организатор" : "Вы участник"}
        </span>
      )}
      {meeting.status === "cancelled" && <span>Отменена</span>}
      {meeting.status === "active" && <span>Идёт сейчас</span>}
    </button>
  );
}

/**
 * CalendarMeetingDetails даёт владельцу реальные операции переноса и подтверждённой отмены.
 * @args meeting — выбранная встреча; onClose — закрытие карточки; onEdit — открытие существующей формы расписания.
 * @return Доступный диалог с серверной проверкой операции и без оптимистического успеха.
 */
function CalendarMeetingDetails({
  meeting,
  onClose,
  onEdit,
}: {
  meeting: Conference;
  onClose: () => void;
  onEdit: (meeting: Conference) => void;
}) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const canChange =
    meeting.ownerId === user?.id &&
    ["created", "scheduled"].includes(meeting.status);
  const cancellation = useMutation({
    mutationFn: () => api.transition(meeting.id, "cancel"),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["conferences"] });
      void client.invalidateQueries({ queryKey: ["conference"] });
      onClose();
    },
  });
  if (confirmCancel)
    return (
      <Modal
        title="Отменить встречу?"
        className="meeting-design-modal calendar-cancel-modal"
        onClose={() => {
          if (!cancellation.isPending) setConfirmCancel(false);
        }}
      >
        <p className="modal-description">
          Встреча «{meeting.title}» будет отменена для всех участников. Это
          действие нельзя отменить.
        </p>
        <ErrorNotice error={cancellation.error} />
        <footer className="meeting-dialog-footer">
          <Button
            variant="secondary"
            disabled={cancellation.isPending}
            onClick={() => setConfirmCancel(false)}
          >
            Оставить встречу
          </Button>
          <Button
            variant="danger"
            busy={cancellation.isPending}
            onClick={() => cancellation.mutate()}
          >
            Да, отменить встречу
          </Button>
        </footer>
      </Modal>
    );
  return (
    <MeetingDetailsModal
      conference={meeting}
      onClose={onClose}
      onEdit={() => onEdit(meeting)}
      onCancel={canChange ? () => setConfirmCancel(true) : undefined}
    />
  );
}

function DayAgenda({
  days,
  date,
  byDay,
  onDay,
  onMeeting,
  toolbar,
}: {
  toolbar: ReactNode;
  days: Date[];
  date: Date;
  byDay: Map<string, Conference[]>;
  onDay: (date: Date) => void;
  onMeeting: (meeting: Conference) => void;
}) {
  const { user } = useAuth();
  const dayKey = calendarDayKey(date);
  const meetings = byDay.get(dayKey) || [];
  const byHour = new Map<number, Conference[]>();
  for (const meeting of meetings) {
    const hour = scheduledMeetingDate(meeting)!.getHours();
    const group = byHour.get(hour);
    if (group) group.push(meeting);
    else byHour.set(hour, [meeting]);
  }
  const firstHour = Math.min(9, ...byHour.keys());
  const lastHour = Math.max(18, ...byHour.keys());
  const timeZone = localTimeZoneLabel(date);
  return (
    <div className="agenda-layout">
      <section className="agenda-day">
        {toolbar}
        <div className="agenda-week" role="group" aria-label="Дни недели">
          {days.map((day, index) => {
            const key = calendarDayKey(day);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={key === dayKey}
                aria-label={day.toLocaleDateString("ru-RU", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
                onClick={() => onDay(day)}
              >
                <small>{weekdays[index]}</small>
                <strong>{day.getDate()}</strong>
                <i aria-hidden="true" data-events={byDay.has(key)} />
              </button>
            );
          })}
        </div>
        <h3>
          {date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}{" "}
          <span>
            · {meetings.length ? meetingCount(meetings.length) : "Нет встреч"}
          </span>
        </h3>
        <div className="agenda-timeline">
          {hours
            .filter((hour) => hour >= firstHour && hour <= lastHour)
            .map((hour) => (
              <div className="agenda-time" key={hour}>
                <span>{String(hour).padStart(2, "0")}:00</span>
                <div>
                  {byHour.get(hour)?.map((meeting) => (
                    <CalendarMeeting
                      key={meeting.id}
                      meeting={meeting}
                      onSelect={onMeeting}
                      agenda={meeting.ownerId === user?.id ? "owner" : "guest"}
                    />
                  ))}
                </div>
              </div>
            ))}
        </div>
      </section>
      <aside className="agenda-summary">
        <header>
          <span className="agenda-eyebrow">На этой неделе</span>
          <h3>Хороший ритм</h3>
          <p>Все встречи команды в вашем часовом поясе.</p>
        </header>
        <ul aria-label="Обозначения встреч">
          <li>
            <i className="agenda-legend-mark" aria-hidden="true" />Я организую
          </li>
          <li>
            <i
              className="agenda-legend-mark"
              data-role="guest"
              aria-hidden="true"
            />
            Я участвую
          </li>
        </ul>
        <small>
          <Clock3 size={15} aria-hidden="true" />
          {timeZone}
        </small>
      </aside>
    </div>
  );
}

/**
 * CalendarPage показывает недельное расписание и месяц из того же API, что список встреч.
 * @return Адаптивный календарь с явной пагинацией, местным временем, созданием и управлением встречами.
 */
export function CalendarPage() {
  const [params] = useSearchParams();
  const [anchor, setAnchor] = useState(() => {
    const value = params.get("date");
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date();
    const parsed = new Date(`${value}T12:00:00`);
    return Number.isFinite(parsed.getTime()) && calendarDayKey(parsed) === value
      ? parsed
      : new Date();
  });
  const [view, setView] = useState<CalendarView | "agenda">("agenda");
  const [schedule, setSchedule] = useState<{ at?: string } | null>(null);
  const [selected, setSelected] = useState<Conference | null>(null);
  const [editing, setEditing] = useState<Conference | null>(null);
  const [agendaDay, setAgendaDay] = useState(() => calendarDayKey(new Date()));
  const scroll = useRef<HTMLDivElement>(null);
  const range = useMemo(
    () => calendarRange(anchor, view === "agenda" ? "week" : view),
    [anchor, view],
  );
  const query = useConferences({
    view: "upcoming",
    scope: "all",
    from: range.from,
    to: range.to,
  });
  const meetings = useMemo(() => {
    const unique = new Map<string, Conference>();
    for (const meeting of query.data?.pages.flatMap((page) => page.items) ||
      []) {
      const date = scheduledMeetingDate(meeting);
      if (
        date &&
        date.getTime() >= new Date(range.from).getTime() &&
        date.getTime() <= new Date(range.to).getTime()
      )
        unique.set(meeting.id, meeting);
    }
    return [...unique.values()].sort(
      (left, right) =>
        scheduledMeetingDate(left)!.getTime() -
        scheduledMeetingDate(right)!.getTime(),
    );
  }, [query.data, range.from, range.to]);
  const byDay = useMemo(() => {
    const grouped = new Map<string, Conference[]>();
    for (const meeting of meetings) {
      const key = calendarDayKey(scheduledMeetingDate(meeting)!);
      const group = grouped.get(key);
      if (group) group.push(meeting);
      else grouped.set(key, [meeting]);
    }
    return grouped;
  }, [meetings]);
  useEffect(() => {
    if (view === "week" && scroll.current) scroll.current.scrollTop = 52 * 8;
  }, [range.from, view, query.isPending]);

  /** @args direction — предыдущий или следующий период. Сохраняет локальные границы при смене месяца и DST. */
  function move(direction: number) {
    setAnchor((date) =>
      view !== "month"
        ? new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate() + direction * 7,
          )
        : new Date(date.getFullYear(), date.getMonth() + direction, 1),
    );
  }

  const label =
    view !== "week"
      ? `${anchor.toLocaleDateString("ru-RU", { month: "long" })} ${anchor.getFullYear()}`
      : `${range.days[0].toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} — ${range.days[6].toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })}`;
  const today = calendarDayKey(new Date());
  const agendaDate =
    range.days.find((day) => calendarDayKey(day) === agendaDay) ||
    range.days.find((day) => byDay.has(calendarDayKey(day))) ||
    range.days[0];
  const agendaDays =
    view === "week" ? range.days : calendarRange(agendaDate, "week").days;
  function planOn(date: Date) {
    const nextHour = new Date(Date.now() + 3_600_000);
    const start =
      calendarDayKey(date) === today
        ? nextHour
        : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9);
    setSchedule({ at: toLocalInput(start.toISOString()) });
  }

  const toolbar = (
    <div className="calendar-toolbar">
      <div className="agenda-view-select">
        <h2 className="calendar-period" aria-live="polite">
          {label}
        </h2>
        <ChevronDown size={14} aria-hidden="true" />
        <select
          aria-label="Вид календаря"
          value={view}
          onChange={(event) =>
            setView(event.target.value as CalendarView | "agenda")
          }
        >
          <option value="agenda">День</option>
          <option value="week">Неделя</option>
          <option value="month">Месяц</option>
        </select>
      </div>
      <div className="calendar-navigation">
        <Button variant="outline" onClick={() => setAnchor(new Date())}>
          Сегодня
        </Button>
        <button
          type="button"
          className="icon-button"
          aria-label="Предыдущий период"
          onClick={() => move(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Следующий период"
          onClick={() => move(1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="calendar-page agenda-page">
      <section className="page-heading">
        <div>
          {!isDesktopBuild && <h1>Календарь</h1>}
          <p>Время для важных разговоров.</p>
        </div>
        <button
          type="button"
          className="icon-button agenda-schedule"
          aria-label="Запланировать встречу"
          title="Запланировать встречу"
          onClick={() => planOn(anchor)}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </section>
      <section className="calendar-card" aria-label="Календарь встреч">
        {(view !== "agenda" || query.isPending) && toolbar}
        <ErrorNotice error={query.error} />
        {query.isError && (
          <Button variant="outline" onClick={() => void query.refetch()}>
            Повторить загрузку календаря
          </Button>
        )}
        {query.isPending ? (
          <MeetingSkeleton rows={4} label="Загрузка календаря" />
        ) : (
          <>
            {view === "agenda" ? (
              <DayAgenda
                toolbar={toolbar}
                days={range.days}
                date={anchor}
                byDay={byDay}
                onDay={setAnchor}
                onMeeting={setSelected}
              />
            ) : (
              <div
                className={`calendar-grid-scroll ${view === "week" ? "calendar-week-scroll" : ""}`}
                ref={scroll}
                tabIndex={0}
                role="region"
                aria-label={
                  view === "week"
                    ? "Расписание на неделю, прокрутка по времени"
                    : "Сетка месяца"
                }
              >
                {view === "week" ? (
                  <table className="calendar-week-table">
                    <caption className="sr-only">
                      Неделя {label}. Встречи сгруппированы по часу начала.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">
                          <span className="sr-only">Время</span>
                        </th>
                        {range.days.map((date, index) => (
                          <th
                            scope="col"
                            key={calendarDayKey(date)}
                            className={
                              calendarDayKey(date) === today
                                ? "calendar-today"
                                : ""
                            }
                          >
                            <span>{weekdays[index]}</span>
                            <strong>{date.getDate()}</strong>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {hours.map((hour) => (
                        <tr key={hour}>
                          <th scope="row">
                            {String(hour).padStart(2, "0")}:00
                          </th>
                          {range.days.map((date) => (
                            <td key={calendarDayKey(date)}>
                              {(byDay.get(calendarDayKey(date)) || [])
                                .filter(
                                  (meeting) =>
                                    scheduledMeetingDate(
                                      meeting,
                                    )!.getHours() === hour,
                                )
                                .map((meeting) => (
                                  <CalendarMeeting
                                    key={meeting.id}
                                    meeting={meeting}
                                    onSelect={setSelected}
                                  />
                                ))}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div
                    className="calendar-month-grid"
                    aria-label={`Месяц ${label}`}
                  >
                    {weekdays.map((day, index) => (
                      <div key={day} className="calendar-weekday">
                        <span className="calendar-weekday-full">
                          {weekdayNames[index]}
                        </span>
                        <span className="calendar-weekday-short">{day}</span>
                      </div>
                    ))}
                    {range.days.map((date) => {
                      const key = calendarDayKey(date);
                      return (
                        <section
                          key={key}
                          className={`calendar-month-day ${date.getMonth() !== anchor.getMonth() ? "calendar-outside-month" : ""} ${key === today ? "calendar-today" : ""}`}
                          aria-label={formatDate(date.toISOString())}
                        >
                          <div className="calendar-day-heading">
                            <button
                              type="button"
                              className="calendar-day-number"
                              aria-label={`Запланировать на ${date.toLocaleDateString("ru-RU")}`}
                              onClick={() => planOn(date)}
                            >
                              <time dateTime={key}>{date.getDate()}</time>
                            </button>
                          </div>
                          {(byDay.get(key) || []).map((meeting) => (
                            <CalendarMeeting
                              key={meeting.id}
                              meeting={meeting}
                              onSelect={setSelected}
                            />
                          ))}
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {view !== "agenda" && !!meetings.length && (
              <div
                className="calendar-mobile-agenda"
                aria-label="Встречи выбранного периода списком"
              >
                <div className="calendar-day-strip">
                  {agendaDays.map((day) => (
                    <button
                      type="button"
                      key={calendarDayKey(day)}
                      aria-pressed={
                        calendarDayKey(day) === calendarDayKey(agendaDate)
                      }
                      onClick={() => setAgendaDay(calendarDayKey(day))}
                    >
                      <span>
                        {day.toLocaleDateString("ru-RU", { weekday: "short" })}
                      </span>
                      <strong>{day.getDate()}</strong>
                    </button>
                  ))}
                </div>
                {[agendaDate].map((date) => (
                  <section key={calendarDayKey(date)}>
                    <h3>
                      {date.toLocaleDateString("ru-RU", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}
                    </h3>
                    {(byDay.get(calendarDayKey(date)) || []).map((meeting) => (
                      <CalendarMeeting
                        key={meeting.id}
                        meeting={meeting}
                        onSelect={setSelected}
                      />
                    ))}
                  </section>
                ))}
                {!byDay.has(calendarDayKey(agendaDate)) && (
                  <p className="field-hint">На этот день встреч пока нет.</p>
                )}
              </div>
            )}
            {view !== "agenda" && !meetings.length && !query.isError && (
              <div className="calendar-empty">
                <span>
                  <CalendarDays size={28} aria-hidden="true" />
                </span>
                <h3>В этом периоде пока свободно</h3>
                <p>Запланируйте встречу — она появится в календаре.</p>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => planOn(anchor)}
                >
                  <Plus size={18} />
                  Запланировать
                </button>
              </div>
            )}
            {query.hasNextPage && (
              <div className="calendar-pagination">
                <p>
                  Показана часть встреч периода. Загрузите продолжение, чтобы
                  увидеть остальные.
                </p>
                <Button
                  variant="outline"
                  busy={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  Загрузить ещё встречи
                </Button>
              </div>
            )}
          </>
        )}
        {selected && (
          <CalendarMeetingDetails
            key={selected.id}
            meeting={selected}
            onClose={() => setSelected(null)}
            onEdit={(meeting) => {
              setSelected(null);
              setEditing(meeting);
            }}
          />
        )}
      </section>
      {schedule && (
        <CreateConference
          schedule={schedule}
          onClose={() => setSchedule(null)}
        />
      )}
      {editing && (
        <EditSchedule conference={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
