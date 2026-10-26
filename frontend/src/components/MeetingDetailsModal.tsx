import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CalendarClock,
  Clock,
  ShieldCheck,
  UserRound,
  Users,
  Video,
  Pencil,
  Trash2,
} from "lucide-react";
import { useAuth } from "../auth";
import { api } from "../api";
import { inviteCode, inviteLink } from "../utils";
import type { Conference } from "../types";
import { Button, Modal, StatusBadge } from "./ui";
import { ConferenceChatActions } from "./ConferenceChatActions";
import { EditSchedule } from "./ConferenceModals";
import { MeetingInvitationCard } from "./MeetingInvitationCard";
import "./meeting-modals.css";

/** Сведения из доступной пользователю записи сервера, без демонстрационных участников. */
export function MeetingDetailsModal({
  conference,
  onClose,
  onEdit,
  onCancel,
}: {
  conference: Conference;
  onClose: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const past = ["finished", "cancelled"].includes(conference.status);
  const listedCode =
    inviteCode(conference.inviteCode || "") ||
    inviteCode(conference.inviteUrl || "");
  const details = useQuery({
    queryKey: ["conference", user?.id, conference.id],
    queryFn: ({ signal }) => api.conference(conference.id, signal),
    enabled: !!user && !past && !listedCode && !editing,
    retry: false,
  });
  const code =
    listedCode ||
    inviteCode(details.data?.item.inviteCode || "") ||
    inviteCode(details.data?.item.inviteUrl || "");
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
      className={`meeting-reference-info ${active ? "meeting-reference-info-active" : past ? "meeting-reference-info-past" : ""}`}
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
        {!past &&
          (code ? (
            <MeetingInvitationCard link={inviteLink(code)} />
          ) : (
            <section
              className="meeting-info-invitation-status"
              aria-live="polite"
            >
              <p>
                {details.isFetching
                  ? "Загружаем ссылку-приглашение…"
                  : "Ссылка-приглашение пока недоступна."}
              </p>
              {!details.isFetching && (
                <Button
                  variant="secondary"
                  onClick={() => void details.refetch()}
                >
                  Повторить
                </Button>
              )}
            </section>
          ))}
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
              <Button
                variant="secondary"
                onClick={() => (onEdit ? onEdit() : setEditing(true))}
              >
                <Pencil size={15} aria-hidden="true" />
                Изменить расписание
              </Button>
            )}
          {owner &&
            onCancel &&
            ["created", "scheduled"].includes(conference.status) && (
              <button
                type="button"
                className="icon-button meeting-info-cancel-action"
                aria-label="Отменить встречу"
                onClick={onCancel}
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            )}
          <ConferenceChatActions conference={conference} />
        </div>
        <div className="meeting-info-navigation-actions">
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
          <Link
            className="button button-primary"
            to={
              past ? `/history/${conference.id}` : `/meetings/${conference.id}`
            }
            onClick={onClose}
          >
            {!past && <Video size={18} aria-hidden="true" />}
            {past ? "Материалы встречи" : "Открыть встречу"}
          </Link>
        </div>
      </footer>
    </Modal>
  );
}
