import { Link } from "react-router";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  Circle,
  Link as LinkIcon,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  Square,
  Users,
  ShieldCheck,
} from "lucide-react";
import { RealtimePanel } from "../RealtimePanel";
import { RecordingNotice } from "../RecordingNotice";
import { RecordingPanel } from "../RecordingPanel";
import { ConferenceInvitationDialog } from "../ConferenceInvitations";
import { Button, ErrorNotice, Modal } from "../ui";
import { MeetingClock } from "./MeetingClock";
import { ConferenceRoomSidebar } from "./ConferenceRoomSidebar";
import { ConferenceControlButton } from "./ConferenceControlButton";
import type { ActiveConferenceViewProps } from "./types";
import { initials } from "../../utils";

/**
 * Отображает активную комнату: медиасвязь, верхнюю панель и диалоги записи/приглашения.
 * @args props — общие данные, команды и состояние интерфейса, созданные корневой страницей.
 * @return Представление раздела с прежними условиями доступа и монтирования панелей.
 */
export function ActiveConferenceRoom(props: ActiveConferenceViewProps) {
  const recordingOpener = useRef<HTMLElement | null>(null);
  const [controlsTarget, setControlsTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [reconnectTarget, setReconnectTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const { id } = props;
  const {
    user,
    self,
    conference,
    membership,
    people,
    onlinePeople,
    live,
    recordingAccess,
    recordingStatus,
    activeRecording,
    owner,
    canInvite,
  } = props.data;
  const { mutation, moderation, stopRecording } = props.commands;
  const {
    stagePanel,
    setStagePanel,
    panelOpen,
    setPanelOpen,
    panelTrigger,
    utility,
    setUtility,
    setInvitationBusy,
    confirm,
    setConfirm,
  } = props.controls;
  const recordingLabel =
    activeRecording?.status === "starting"
      ? "Запись запускается"
      : activeRecording?.status === "stopping"
        ? "Запись останавливается"
        : "Идёт запись";
  return (
    <div
      className={`conference-room-page call-reference-room ${panelOpen ? "room-panel-open" : "room-panel-closed"}`}
    >
      <header className="room-header">
        <Link
          className="icon-button room-back"
          to={user?.guestConferenceId ? "/" : "/conferences"}
          aria-label="К моим конференциям"
        >
          <ArrowLeft size={19} />
          <span>К встречам</span>
        </Link>
        <div className="room-title">
          <h1>{conference.title}</h1>
          <div className="room-title-meta">
            <MeetingClock startedAt={conference.startedAt} />
            <span>
              {live.state
                ? `В эфире · Участников: ${onlinePeople.length}`
                : "Подключаемся к встрече"}
            </span>
          </div>
        </div>
        <div className="room-header-actions">
          {activeRecording && (
            <span
              className="room-recording-status"
              role="status"
              data-testid="recording-indicator"
            >
              <Circle size={9} fill="currentColor" />
              {recordingLabel}
            </span>
          )}
          {activeRecording &&
            recordingAccess &&
            ((owner && membership.role === "owner") ||
              activeRecording.requestedBy === user?.id) && (
              <button
                type="button"
                className="room-header-action room-header-stop-recording"
                aria-label="Остановить запись"
                aria-busy={stopRecording.isPending || undefined}
                title={
                  stopRecording.isPending ||
                  activeRecording.status === "stopping"
                    ? "Запись останавливается"
                    : "Остановить запись"
                }
                disabled={
                  stopRecording.isPending ||
                  activeRecording.status === "stopping"
                }
                onClick={() => {
                  if (
                    !stopRecording.isPending &&
                    activeRecording.status !== "stopping"
                  )
                    stopRecording.mutate(activeRecording.uuid);
                }}
              >
                <Square size={17} fill="currentColor" aria-hidden="true" />
                <span>
                  {stopRecording.isPending ||
                  activeRecording.status === "stopping"
                    ? "Останавливаем…"
                    : "Остановить запись"}
                </span>
              </button>
            )}
          {recordingAccess && (
            <button
              className="room-header-action"
              onClick={(event) => {
                recordingOpener.current = event.currentTarget;
                setUtility("recording");
              }}
              aria-label="Записи конференции"
            >
              <Circle size={17} />
              <span>Запись</span>
            </button>
          )}
          <button
            className="room-header-action"
            aria-label="Пригласить"
            title="Пригласить"
            onClick={() => setUtility("invite")}
          >
            <LinkIcon size={17} />
            <span>Пригласить</span>
          </button>
          <div className="room-reconnect-slot" ref={setReconnectTarget} />
        </div>
      </header>
      <RecordingNotice
        conferenceId={id}
        ownerId={conference.ownerId}
        userId={user?.id}
        participants={
          people.some((person) => person.id === membership.id)
            ? people
            : [...people, membership]
        }
        recordings={
          recordingStatus.isSuccess && !recordingStatus.isError
            ? recordingStatus.data.items
            : undefined
        }
        subscribe={live.subscribe}
      />
      <div className="room-errors">
        <ErrorNotice
          error={
            stopRecording.error ||
            recordingStatus.error ||
            mutation.error ||
            moderation.error ||
            self.error
          }
        />
      </div>
      <section className="conference-stage" aria-label="Активная встреча">
        <div className="conference-stage-main">
          <RealtimePanel
            compactControls
            conferenceId={id}
            membership={membership}
            live={live}
            participants={people}
            controlsTarget={controlsTarget}
            reconnectTarget={reconnectTarget}
            endControls={
              <ConferenceControlButton
                danger
                busy={mutation.isPending}
                aria-label="Покинуть конференцию"
                onClick={() => setConfirm("leave")}
                icon={<LogOut size={24} />}
                label="Выйти"
              />
            }
            controls={
              <>
                <ConferenceControlButton
                  className="room-participants-control"
                  aria-expanded={panelOpen && stagePanel === "participants"}
                  onClick={(event) => {
                    panelTrigger.current = event.currentTarget;
                    setStagePanel("participants");
                    setPanelOpen(!(panelOpen && stagePanel === "participants"));
                  }}
                  icon={<Users size={24} />}
                  label="Участники"
                />
                <ConferenceControlButton
                  aria-keyshortcuts="C"
                  aria-expanded={panelOpen && stagePanel === "chat"}
                  onClick={(event) => {
                    panelTrigger.current = event.currentTarget;
                    setStagePanel("chat");
                    setPanelOpen(!(panelOpen && stagePanel === "chat"));
                  }}
                  icon={<MessageCircle size={24} />}
                  label="Чат"
                />
              </>
            }
          />
          <ul
            className="room-participant-filmstrip"
            aria-label="Участники демонстрации"
          >
            {onlinePeople.map((person) => (
              <li key={person.id}>
                <span className="room-filmstrip-avatar" aria-hidden="true">
                  {initials(person.displayName || "Участник")}
                </span>
                <div>
                  <span title={person.displayName || "Участник"}>
                    {person.displayName || "Участник"}
                    {person.id === membership.id ? " (вы)" : ""}
                  </span>
                  <span
                    aria-label={
                      person.microphoneEnabled
                        ? "Микрофон включён"
                        : "Микрофон выключен"
                    }
                  >
                    {person.microphoneEnabled ? (
                      <Mic size={16} />
                    ) : (
                      <MicOff size={16} />
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <ConferenceRoomSidebar {...props} />
      </section>
      <footer className="room-footer">
        <div ref={setControlsTarget} />
        {conference.waitingRoomEnabled === true && (
          <div className="room-footer-meta">
            <span>
              <ShieldCheck size={14} aria-hidden="true" />
              Доступно по приглашению
            </span>
          </div>
        )}
      </footer>
      {utility === "invite" && (
        <ConferenceInvitationDialog
          conference={conference}
          canInvite={canInvite}
          onClose={() => setUtility(null)}
          onBusyChange={setInvitationBusy}
        />
      )}
      {utility === "recording" && recordingAccess && (
        <Modal
          title="Записи конференции"
          onClose={() => setUtility(null)}
          returnFocus={() =>
            recordingOpener.current?.isConnected
              ? recordingOpener.current
              : document.querySelector<HTMLButtonElement>(
                  ".room-header-stop-recording, .room-header-action",
                )
          }
        >
          <RecordingPanel
            conference={conference}
            membership={membership}
            showHistory={false}
            onStarted={() => {
              recordingOpener.current = null;
              setUtility(null);
            }}
          />
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            confirm === "leave" ? "Выйти из встречи?" : "Завершить конференцию?"
          }
          onClose={() => {
            if (!mutation.isPending) setConfirm(null);
          }}
        >
          <p className="modal-description">
            {confirm === "leave"
              ? "Вы отключитесь от встречи. Остальные участники продолжат разговор."
              : "После завершения участники не смогут присоединиться. Текущая запись остановится и будет обработана в фоне."}
          </p>
          <ErrorNotice error={mutation.error} />
          <Button
            variant="danger"
            busy={mutation.isPending}
            onClick={() =>
              mutation.mutate(confirm === "leave" ? "leave" : "finish")
            }
          >
            {confirm === "leave" ? "Выйти" : "Да, завершить"}
          </Button>
          <Button
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => setConfirm(null)}
          >
            Вернуться к встрече
          </Button>
        </Modal>
      )}
    </div>
  );
}
