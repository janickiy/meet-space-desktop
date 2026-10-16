import type { ReactNode } from "react";
import { MessageCircle, UserRound } from "lucide-react";
import type { PersonalPeer } from "../types";
import { initials } from "../utils";
import { DirectCallButton } from "./DirectCallButton";
import { Button, Modal } from "./ui";
import "./chat-profiles.css";

/** Общая карточка пользователя для личной переписки и списка участников группы. */
export function UserInfoModal({
  person,
  subtitle,
  online,
  presencePending = false,
  onClose,
  onCallStart = onClose,
  returnFocus,
  actions,
}: {
  person: PersonalPeer;
  subtitle: string;
  online?: boolean;
  presencePending?: boolean;
  onClose: () => void;
  onCallStart?: () => void;
  returnFocus?: () => HTMLElement | null;
  actions?: ReactNode;
}) {
  const statusText = presencePending
    ? "Проверяем статус…"
    : online === true
      ? "В сети"
      : online === false
        ? "Не в сети"
        : "Статус недоступен";
  return (
    <Modal
      title="Информация о пользователе"
      className="personal-info-modal"
      onClose={onClose}
      returnFocus={returnFocus}
    >
      <div className="personal-user-info">
        <div className="personal-profile-hero">
          <span
            className="personal-avatar group-avatar-large"
            aria-hidden="true"
          >
            {initials(person.displayName)}
            {online === true && (
              <span className="personal-profile-online-dot" />
            )}
          </span>
          <div className="personal-profile-copy">
            <h3>{person.displayName}</h3>
            <div className="personal-profile-subtitle">
              <span>{subtitle}</span>
              <p
                className={`personal-user-presence${online === true ? " personal-user-presence-online" : ""}`}
                role="status"
                aria-live="polite"
              >
                <span
                  className="personal-user-presence-dot"
                  aria-hidden="true"
                />
                {statusText}
              </p>
            </div>
          </div>
        </div>
        <div className="personal-profile-actions">
          {actions || (
            <Button onClick={onClose}>
              <MessageCircle size={18} aria-hidden="true" />
              Написать сообщение
            </Button>
          )}
          <DirectCallButton
            userId={person.id}
            name={person.displayName}
            label
            onStart={onCallStart}
          />
        </div>
        <div className="personal-profile-section-label">Профиль</div>
        <dl className="personal-profile-details">
          <div>
            <dt>
              <UserRound size={16} aria-hidden="true" />
              Имя и фамилия
            </dt>
            <dd>{person.displayName}</dd>
          </div>
          <div>
            <dt>
              <MessageCircle size={16} aria-hidden="true" />
              Переписка
            </dt>
            <dd>Личный чат</dd>
          </div>
          <div>
            <dt>Идентификатор пользователя</dt>
            <dd className="personal-user-id">{person.id}</dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
