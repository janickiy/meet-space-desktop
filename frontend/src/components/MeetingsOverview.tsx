import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import type { Conference } from "../types";
import { useConferences } from "../queries";
import { StatusBadge } from "./ui";

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** A local calendar marks only meetings already returned by the current list query. */
export function MeetingsOverview({ meetings }: { meetings: Conference[] }) {
  const [month, setMonth] = useState(() => new Date());
  const active = useConferences({ view: "active", scope: "all" });
  const activeMeetings =
    active.data?.pages
      .flatMap((page) => page.items)
      .filter((meeting) => meeting.status === "active") || [];
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = Array.from(
    { length: 42 },
    (_, offset) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset),
  );
  const scheduled = new Set(
    meetings
      .filter((meeting) => meeting.scheduledAt)
      .map((meeting) => dayKey(new Date(meeting.scheduledAt!))),
  );
  const today = dayKey(new Date());
  return (
    <aside
      className="meetings-overview"
      aria-label="Календарь и материалы встреч"
    >
      <section className="meetings-mini-calendar">
        <header>
          <h3>
            {month.toLocaleDateString("ru-RU", {
              month: "long",
              year: "numeric",
            })}
          </h3>
          <div>
            <button
              className="icon-button"
              aria-label="Предыдущий месяц"
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
              }
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Следующий месяц"
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
              }
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </header>
        <div className="meetings-mini-days">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
            <span key={day} className="meetings-mini-weekday">
              {day}
            </span>
          ))}
          {days.map((day) => (
            <Link
              key={dayKey(day)}
              to={`/calendar?date=${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`}
              aria-label={`Открыть календарь: ${day.toLocaleDateString("ru-RU")}${scheduled.has(dayKey(day)) ? ", есть загруженные встречи" : ""}`}
              aria-current={dayKey(day) === today ? "date" : undefined}
              className={`${day.getMonth() !== month.getMonth() ? "outside-month" : ""} ${scheduled.has(dayKey(day)) ? "has-meeting" : ""}`}
            >
              {day.getDate()}
            </Link>
          ))}
        </div>
        <p>Отмечены встречи из загруженного списка</p>
      </section>
      <section className="meetings-live-section" aria-label="Активные встречи">
        <h3>Сейчас в пространстве</h3>
        {activeMeetings.slice(0, 2).map((meeting) => (
          <Link
            className="meetings-live-card"
            key={meeting.id}
            to={`/meetings/${meeting.id}`}
          >
            <StatusBadge status={meeting.status} />
            <strong>{meeting.title}</strong>
            <span>
              {meeting.participantCount !== undefined
                ? `${meeting.participantCount} участников в комнате`
                : "Открыть встречу"}
              <ArrowRight size={15} aria-hidden="true" />
            </span>
          </Link>
        ))}
        {!activeMeetings.length && (
          <p>
            {active.isPending
              ? "Загрузка активных встреч…"
              : active.isError
                ? "Не удалось загрузить активные встречи"
                : "Активных встреч пока нет"}
          </p>
        )}
        {activeMeetings.length > 2 && (
          <Link className="text-link" to="/meetings?view=active">
            Все активные встречи
          </Link>
        )}
      </section>
      <div className="meetings-materials-note">
        <Sparkles size={21} aria-hidden="true" />
        <div>
          <strong>Всё важное останется с вами</strong>
          <p>Записи, расшифровки и итоги встреч — в одном пространстве.</p>
          <Link to="/recordings">
            Перейти к записям <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
