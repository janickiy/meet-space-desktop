import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CirclePlay,
  FolderPlus,
  Link as LinkIcon,
  LogOut,
  Pencil,
  PhoneOff,
  Video,
  X,
} from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { isAdmitted } from "../collaboration";
import { useConferenceCommands } from "../hooks/conference/useConferenceCommands";
import { useMembership } from "../queries";
import type { Conference, Participant } from "../types";
import { inviteCode } from "../utils";
import { ConferenceChatActions } from "./ConferenceChatActions";
import { ConferenceInvitationDialog } from "./ConferenceInvitations";
import { EditSchedule } from "./ConferenceModals";
import { FolderPicker } from "./FolderPicker";
import { Button, ErrorNotice, Modal, StatusBadge } from "./ui";
import "./meeting-modals.css";

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "longOffset",
});

function MeetingTime({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const formatted = dateFormat.format(date).replace(/GMT(?=[+-])/, "");
  return (
    <p>
      {label}: <time dateTime={value}>{formatted}</time>
    </p>
  );
}

function membershipLabel(member: Participant | null | undefined) {
  if (member?.status === "kicked" || member?.admissionState === "kicked")
    return "Организатор исключил вас из встречи";
  if (member?.status === "rejected" || member?.admissionState === "rejected")
    return "Запрос на вход отклонён";
  if (member?.status === "waiting" || member?.admissionState === "waiting")
    return "Ожидаете допуска";
  if (isAdmitted(member))
    return member?.status === "joined"
      ? "Допущен; членство активно"
      : "Допущен; вы не подключены";
  return null;
}

type DetailAction = "edit" | "invite" | "folder" | "leave" | "finish";

/** Сведения и доступные серверные действия для встречи из списка или календаря. */
export function MeetingDetailsModal({
  conference,
  onClose,
  onEdit,
  onCancel,
  returnFocus,
}: {
  conference: Conference;
  onClose: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const { user } = useAuth();
  const [action, setAction] = useState<DetailAction | null>(null);
  const { mutation } = useConferenceCommands(conference.id, onClose);
  const active = conference.status === "active";
  const past = ["finished", "cancelled"].includes(conference.status);
  const owner = !!user && user.id === conference.ownerId;
  const self = useMembership(conference.id, active ? 3000 : false, active);
  const membership = self.data;
  const admitted = isAdmitted(membership);
  const joined = admitted && membership?.status === "joined";
  const memberLabel = membershipLabel(membership);
  const canEdit = owner && ["created", "scheduled"].includes(conference.status);
  const canLeave = active && joined;
  const canFinish = active && owner;
  const room = `/meetings/${conference.id}`;
  const recordings = active
    ? `/recordings?view=active&meeting=${encodeURIComponent(conference.id)}`
    : `/history/${conference.id}`;
  const listedCode =
    inviteCode(conference.inviteCode || "") ||
    inviteCode(conference.inviteUrl || "");
  const details = useQuery({
    queryKey: ["conference", user?.id, conference.id],
    queryFn: ({ signal }) => api.conference(conference.id, signal),
    enabled: !!user && !past && !listedCode,
    retry: false,
  });
  const code =
    listedCode ||
    inviteCode(details.data?.item.inviteCode || "") ||
    inviteCode(details.data?.item.inviteUrl || "");
  const role = owner
    ? "организатор"
    : membership?.role === "co_host"
      ? "соорганизатор"
      : user?.guestConferenceId
        ? "гость"
        : "участник";
  function openAction(next: DetailAction, trigger: HTMLButtonElement) {
    trigger.focus();
    setAction(next);
  }
  const closeAction = () => {
    if (!mutation.isPending) {
      mutation.reset();
      setAction(null);
    }
  };

  return (
    <>
      <Modal
        title="О встрече"
        className="meeting-reference-info"
        onClose={onClose}
        returnFocus={returnFocus}
      >
        <div className="meeting-info-chat-tools">
          <ConferenceChatActions conference={conference} />
        </div>
        <div className="meeting-info-content">
          <header className="meeting-info-header">
            {active ? (
              <span className="status-badge status-active">Активна</span>
            ) : (
              <StatusBadge status={conference.status} />
            )}
            <h3>{conference.title}</h3>
            <p>Вы — {role}</p>
          </header>
          <div className="meeting-info-facts">
            <MeetingTime label="Запланирована" value={conference.scheduledAt} />
            <MeetingTime label="Началась" value={conference.startedAt} />
            <MeetingTime label="Завершилась" value={conference.finishedAt} />
            {!active && !!conference.plannedDurationMin && (
              <p>Плановая длительность: {conference.plannedDurationMin} мин</p>
            )}
            {conference.waitingRoomEnabled !== undefined && (
              <p>
                {conference.waitingRoomEnabled
                  ? "Зал ожидания включён."
                  : "Зал ожидания отключён."}
              </p>
            )}
          </div>
          {active && memberLabel && (
            <p className="meeting-info-membership">{memberLabel}</p>
          )}
          {active && self.isError && <ErrorNotice error={self.error} />}
          <div className="meeting-info-actions">
            {!past && (
              <>
                <Link
                  className="button button-primary"
                  to={
                    active && admitted && !joined && !user?.guestConferenceId
                      ? `${room}/join`
                      : room
                  }
                  onClick={onClose}
                >
                  <Video size={16} aria-hidden="true" />
                  {active && (admitted || !membership)
                    ? "Подключиться к звонку"
                    : "Открыть встречу"}
                </Link>
                <Button
                  type="button"
                  variant="secondary"
                  aria-haspopup="dialog"
                  disabled={!code}
                  onClick={(event) => openAction("invite", event.currentTarget)}
                >
                  <LinkIcon size={16} aria-hidden="true" />
                  Пригласить по ссылке
                </Button>
                {!code && (
                  <div className="meeting-info-invitation-status">
                    <p role="status">
                      {details.isFetching
                        ? "Загружаем ссылку-приглашение…"
                        : "Ссылка-приглашение пока недоступна."}
                    </p>
                    {!details.isFetching && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void details.refetch()}
                      >
                        Повторить
                      </Button>
                    )}
                  </div>
                )}
                {canLeave && (
                  <Button
                    type="button"
                    variant="secondary"
                    aria-haspopup="dialog"
                    onClick={(event) =>
                      openAction("leave", event.currentTarget)
                    }
                  >
                    <LogOut size={16} aria-hidden="true" />
                    Выйти из встречи
                  </Button>
                )}
                {!user?.guestConferenceId && (
                  <Button
                    type="button"
                    variant="secondary"
                    aria-haspopup="dialog"
                    onClick={(event) =>
                      openAction("folder", event.currentTarget)
                    }
                  >
                    <FolderPlus size={16} aria-hidden="true" />
                    Добавить в папку
                  </Button>
                )}
              </>
            )}
            {(active || past) && (
              <Link
                className={`button button-${past ? "primary" : "secondary"}`}
                to={recordings}
                onClick={onClose}
              >
                <CirclePlay size={16} aria-hidden="true" />
                Записи и материалы
              </Link>
            )}
            {canEdit && (
              <Button
                type="button"
                variant="secondary"
                aria-haspopup="dialog"
                onClick={(event) =>
                  onEdit ? onEdit() : openAction("edit", event.currentTarget)
                }
              >
                <Pencil size={16} aria-hidden="true" />
                Изменить расписание
              </Button>
            )}
            {canEdit && onCancel && (
              <Button
                type="button"
                variant="danger"
                className="meeting-info-destructive"
                aria-haspopup="dialog"
                onClick={onCancel}
              >
                <X size={16} aria-hidden="true" />
                Отменить встречу
              </Button>
            )}
            {canFinish && (
              <Button
                type="button"
                variant="danger"
                className="meeting-info-destructive"
                aria-haspopup="dialog"
                onClick={(event) => openAction("finish", event.currentTarget)}
              >
                <PhoneOff size={16} aria-hidden="true" />
                Завершить для всех
              </Button>
            )}
          </div>
        </div>
      </Modal>
      {action === "invite" && code && !past && (
        <ConferenceInvitationDialog
          conference={{ ...conference, inviteCode: code }}
          canInvite={
            !user?.guestConferenceId &&
            (owner || (active && joined && membership?.role === "co_host"))
          }
          onClose={closeAction}
        />
      )}
      {action === "folder" && (
        <FolderPicker
          target={{ type: "conference", id: conference.id }}
          onClose={closeAction}
        />
      )}
      {action === "edit" && (
        <EditSchedule conference={conference} onClose={closeAction} />
      )}
      {(action === "leave" || action === "finish") && (
        <Modal
          title={
            action === "leave"
              ? "Выйти из встречи?"
              : "Завершить встречу для всех?"
          }
          className="meeting-info-confirm"
          onClose={closeAction}
        >
          <p className="modal-description">
            {action === "leave"
              ? "Вы отключитесь от встречи. Остальные участники продолжат разговор."
              : "После завершения участники не смогут присоединиться. Текущая запись остановится и будет обработана в фоне."}
          </p>
          <ErrorNotice error={mutation.error} />
          <div className="meeting-info-confirm-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={closeAction}
              data-autofocus
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="danger"
              busy={mutation.isPending}
              disabled={action === "leave" ? !canLeave : !canFinish}
              onClick={() => mutation.mutate(action)}
            >
              {action === "leave" ? "Выйти" : "Завершить"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
