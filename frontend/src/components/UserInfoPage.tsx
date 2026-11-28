import type { ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import type { PersonalPeer } from "../types";
import { UserAvatar } from "./UserAvatar";
import { ChatInfoPage } from "./ChatInfoPage";
import { DirectCallButton } from "./DirectCallButton";
import { Button } from "./ui";
import { ConversationFiles } from "./ConversationFiles";
import "./chat-profiles.css";

export function UserInfoPage({
  person,
  subtitle,
  online,
  presencePending = false,
  onClose,
  onCallStart = onClose,
  returnFocus,
  actions,
  conversationId,
  groupName,
  onShowMessage,
}: {
  person: PersonalPeer;
  conversationId: string;
  groupName?: string;
  subtitle?: string;
  online?: boolean;
  presencePending?: boolean;
  onClose: () => void;
  onCallStart?: () => void;
  returnFocus?: () => HTMLElement | null;
  actions?: ReactNode;
  onShowMessage: (id: string) => void;
}) {
  const presence = presencePending
    ? "Проверяем статус…"
    : online === true
      ? "В сети"
      : online === false
        ? "Не в сети"
        : "Статус недоступен";
  return (
    <ChatInfoPage
      title="Информация о пользователе"
      onClose={onClose}
      returnFocus={returnFocus}
      backLabel={groupName ? "Назад к информации о группе" : undefined}
    >
      <section className="chat-info-profile" aria-label={person.displayName}>
        <UserAvatar
          id={person.id}
          name={person.displayName}
          className="chat-info-avatar"
        />
        <h3>{person.displayName}</h3>
        <p role="status">{subtitle || presence}</p>
        <div className="chat-info-actions">
          {actions || (
            <Button onClick={onClose} variant="outline">
              <MessageCircle size={17} />
              Сообщение
            </Button>
          )}
          <DirectCallButton
            userId={person.id}
            name={person.displayName}
            label
            onStart={onCallStart}
          />
        </div>
      </section>
      <section className="chat-info-card" aria-label="Данные пользователя">
        <dl className="chat-info-details">
          <div>
            <dt>Имя</dt>
            <dd>{person.displayName}</dd>
          </div>
          {person.about && (
            <div>
              <dt>О себе</dt>
              <dd>{person.about}</dd>
            </div>
          )}
          <div>
            <dt>Email</dt>
            <dd>{person.email || "Не указан"}</dd>
          </div>
        </dl>
      </section>
      <ConversationFiles
        conversationId={conversationId}
        requireAuthenticated={!!groupName}
        title={groupName ? `Материалы группы «${groupName}»` : undefined}
        onAccessDenied={onClose}
        onShowMessage={onShowMessage}
      />
    </ChatInfoPage>
  );
}
