import { useState } from "react";
import { Link } from "react-router";
import {
  CalendarDays,
  CalendarClock,
  Clock,
  Link2,
  ShieldCheck,
  UserRound,
  Users,
  Video,
  Pencil,
} from "lucide-react";
import { useAuth } from "../auth";
import { inviteLink } from "../utils";
import type { Conference } from "../types";
import { Button, CopyLink, Modal, StatusBadge } from "./ui";
import { ConferenceChatActions } from "./ConferenceChatActions";
import { EditSchedule } from "./ConferenceModals";
import "./meeting-modals.css";

/** Сведения из доступной пользователю записи сервера, без демонстрационных участников. */
export function MeetingDetailsModal({
  conference,
  onClose,
}: {
  conference: Conference;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const past = ["finished", "cancelled"].includes(conference.status);
  const active = conference.status === "active";
  const owner = user?.id === conference.ownerId;
  const date = conference.startedAt || conference.scheduledAt;
  const time = date ? new Date(date) : null;
  const validDate = time && Number.isFinite(time.getTime());
  if (editing)
    return (
      <EditSchedule conference={conference} onClose={() => setEditing(false)} />
    );
  return (
    <Modal
      title={conference.title}
      className={`meeting-reference-info ${active ? "meeting-reference-info-active" : ""}`}
      onClose={onClose}
    >
      <header className="meeting-info-header">
        <span className="meeting-info-emblem">
          {active ? (
            <Video size={28} aria-hidden="true" />
          ) : (
            <CalendarClock size={28} aria-hidden="true" />
          )}
        </span>
        <div>
          <StatusBadge status={conference.status} />
          <h3>{conference.title}</h3>
        </div>
      </header>
      <div className="meeting-info-content">
        <dl className="meeting-info-facts">
          <div>
            <span className="meeting-fact-icon">
              <CalendarDays size={17} aria-hidden="true" />
            </span>
            <div>
              <dt>Дата встречи</dt>
              <dd>
                {validDate
                  ? time.toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  : "Без даты"}
                <small>
                  {validDate
                    ? time.toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Постоянная комната"}
                </small>
              </dd>
            </div>
          </div>
          <div>
            <span className="meeting-fact-icon">
              <Clock size={17} aria-hidden="true" />
            </span>
            <div>
              <dt>Длительность</dt>
              <dd>
                {conference.plannedDurationMin
                  ? `${conference.plannedDurationMin} минут`
                  : "Не указана"}
                <small>
                  Часовой пояс:{" "}
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </small>
              </dd>
            </div>
          </div>
          <div>
            <span className="meeting-fact-icon">
              <UserRound size={17} aria-hidden="true" />
            </span>
            <div>
              <dt>Ваша роль</dt>
              <dd>{owner ? "Организатор" : "Участник"}</dd>
            </div>
          </div>
          <div>
            <span className="meeting-fact-icon">
              <Users size={17} aria-hidden="true" />
            </span>
            <div>
              <dt>Участники</dt>
              <dd>
                {conference.participantCount === undefined
                  ? "Состав в комнате"
                  : conference.participantCount}
              </dd>
            </div>
          </div>
        </dl>
        {!past && (
          <section className="meeting-info-invitation">
            <h4>
              <Link2 size={16} aria-hidden="true" />
              Ссылка-приглашение
            </h4>
            <CopyLink value={inviteLink(conference.inviteCode)} />
            <p>Поделитесь ссылкой с теми, кого хотите пригласить.</p>
          </section>
        )}
        {conference.waitingRoomEnabled && (
          <p className="meeting-info-policy">
            <ShieldCheck size={17} aria-hidden="true" />
            Включён зал ожидания. Участники с действующим приглашением входят
            без ожидания.
          </p>
        )}
      </div>
      <footer className="meeting-info-footer">
        <div className="meeting-info-owner-actions">
          {owner &&
            (conference.status === "created" ||
              conference.status === "scheduled") && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil size={15} aria-hidden="true" />
                Изменить расписание
              </Button>
            )}
          <ConferenceChatActions conference={conference} />
        </div>
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
        <Link
          className="button button-primary"
          to={past ? `/history/${conference.id}` : `/meetings/${conference.id}`}
          onClick={onClose}
        >
          {past ? "Материалы встречи" : "Открыть встречу"}
        </Link>
      </footer>
    </Modal>
  );
}
