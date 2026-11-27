import { useEffect, useId, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ChevronRight, Paperclip } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import type { ChatMessage, PersonalConversation, PersonalPeer } from "../types";
import { ConversationAvatar } from "./GroupChats";
import { UserAvatar } from "./UserAvatar";
import { Button, ErrorNotice, Modal } from "./ui";
import "./forward-messages-dialog.css";

interface ForwardMessagesDialogProps {
  sourceType: "conversation" | "conference";
  sourceId: string;
  messages: ChatMessage[];
  onClose: () => void;
  onForwarded: (target: PersonalConversation, count: number) => void;
}

type Recipient =
  | { kind: "conversation"; item: PersonalConversation }
  | { kind: "user"; item: PersonalPeer };

function recipientKey(recipient: Recipient) {
  return `${recipient.kind}:${recipient.item.id}`;
}

function recipientName(recipient: Recipient) {
  if (recipient.kind === "user") return recipient.item.displayName;
  return recipient.item.type === "group"
    ? recipient.item.name
    : recipient.item.peer.displayName;
}

function RecipientAvatar({ recipient }: { recipient: Recipient }) {
  return recipient.kind === "conversation" ? (
    <ConversationAvatar conversation={recipient.item} />
  ) : (
    <UserAvatar id={recipient.item.id} name={recipient.item.displayName} />
  );
}

/** A fresh context prevents a draft recipient from carrying over to another account or chat. */
export function ForwardMessagesDialog(props: ForwardMessagesDialogProps) {
  const { user } = useAuth();
  if (!user || user.guestConferenceId) return null;
  return (
    <ForwardMessagesForm
      key={`${user.id}:${props.sourceType}:${props.sourceId}:${props.messages.map((message) => message.id).join(",")}`}
      {...props}
      actorId={user.id}
    />
  );
}

function ForwardMessagesForm({
  sourceType,
  sourceId,
  messages,
  onClose,
  onForwarded,
  actorId,
}: ForwardMessagesDialogProps & { actorId: string }) {
  const client = useQueryClient();
  const searchId = useId();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [failedRecipient, setFailedRecipient] = useState<Recipient | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const controller = useRef<AbortController | null>(null);
  const retries = useRef(
    new Map<
      string,
      {
        clientRequestId: string;
        conversation?: PersonalConversation;
      }
    >(),
  );
  const messageIds = [...new Set(messages.map((message) => message.id))];
  const attachments = messages.flatMap((message) => message.attachments);
  const attachmentBytes = attachments.reduce(
    (sum, attachment) => sum + attachment.size,
    0,
  );
  const validation =
    !messageIds.length || messageIds.length > 30
      ? "Выберите от 1 до 30 сообщений для пересылки."
      : messages.some((message) => message.deletedAt || message.call)
        ? "Удалённые сообщения и историю звонков переслать нельзя."
        : attachments.length > 20
          ? "За один раз можно переслать не более 20 вложений. Выберите меньше сообщений."
          : attachmentBytes > 100 * 1024 * 1024
            ? "Общий размер вложений превышает 100 МБ. Выберите меньше сообщений и перешлите их отдельно."
            : "";
  const invalid = !!validation;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );

  const conversations = useInfiniteQuery({
    queryKey: ["forward-conversations", actorId, search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.personalConversations(pageParam, signal, 20, { search }),
    getNextPageParam: (last) => last.nextCursor || undefined,
    retry: false,
  });
  const users = useQuery({
    queryKey: ["forward-users", actorId, search],
    queryFn: ({ signal }) => api.searchPersonalUsers(search, signal),
    enabled: Array.from(search).length >= 2,
    retry: false,
  });
  const chats = [
    ...new Map(
      (conversations.data?.pages.flatMap((page) => page.items) || []).map(
        (conversation) => [conversation.id, conversation] as const,
      ),
    ).values(),
  ];
  const destinations = chats.filter(
    (chat) => sourceType !== "conversation" || chat.id !== sourceId,
  );
  const knownPeers = new Set(
    chats.flatMap((chat) => (chat.type === "direct" ? [chat.peer.id] : [])),
  );
  const people = (users.data?.items || []).filter(
    (person) => person.id !== actorId && !knownPeers.has(person.id),
  );
  const currentSearch = text.trim() === search;
  const searchingPeople = Array.from(search).length >= 2;
  const loading =
    !currentSearch ||
    conversations.isPending ||
    (searchingPeople && users.isPending);

  async function send(recipient: Recipient) {
    if (invalid || controller.current) return;
    const operation = new AbortController();
    controller.current = operation;
    setBusy(true);
    setError(null);
    setFailedRecipient(null);
    const key = recipientKey(recipient);
    let retry = retries.current.get(key);
    if (!retry) {
      retry = { clientRequestId: crypto.randomUUID() };
      retries.current.set(key, retry);
    }
    try {
      const conversation =
        recipient.kind === "conversation"
          ? recipient.item
          : retry.conversation ||
            (await api.createPersonalConversation(recipient.item.id)).item;
      if (operation.signal.aborted) return;
      retry.conversation = conversation;
      const result = await api.forwardMessages(
        conversation.id,
        {
          sourceType,
          sourceId,
          messageIds,
          clientRequestId: retry.clientRequestId,
        },
        operation.signal,
      );
      if (operation.signal.aborted) return;
      void client.invalidateQueries({
        queryKey: ["personal-chat", conversation.id, actorId],
      });
      void client.invalidateQueries({ queryKey: ["personal-list", actorId] });
      void client.invalidateQueries({
        queryKey: ["personal-summary", actorId],
      });
      onForwarded(conversation, result.items.length);
      onClose();
    } catch (caught) {
      if (!operation.signal.aborted) {
        setError(caught);
        setFailedRecipient(recipient);
      }
    } finally {
      if (!operation.signal.aborted && controller.current === operation) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  function recipientRow(recipient: Recipient) {
    const label = recipientName(recipient);
    const subtitle =
      recipient.kind === "user"
        ? "Пользователь"
        : recipient.item.type === "group"
          ? `Групповой чат`
          : "Личный чат";
    return (
      <button
        type="button"
        className="forward-recipient"
        key={recipientKey(recipient)}
        disabled={busy || invalid}
        aria-label={`Переслать в ${label}, ${subtitle}`}
        onClick={() => void send(recipient)}
      >
        <RecipientAvatar recipient={recipient} />
        <span className="forward-recipient-copy">
          <strong>{label}</strong>
          <small>{subtitle}</small>
        </span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    );
  }

  return (
    <Modal
      title={
        messages.length === 1 ? "Переслать сообщение" : "Переслать сообщения"
      }
      className="forward-messages-dialog"
      onClose={() => {
        if (!controller.current) onClose();
      }}
    >
      <label className="field forward-search" htmlFor={searchId}>
        Получатель
        <input
          data-autofocus
          id={searchId}
          type="search"
          placeholder="Найти чат или группу"
          autoComplete="off"
          maxLength={100}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <ol className="forward-preview-list" aria-label="Выбранные сообщения">
        {messages.map((message) => (
          <li key={message.id}>
            <strong>
              {message.forwardedFrom?.senderName || message.senderName}
            </strong>
            {message.text && <p>{message.text}</p>}
            {message.attachments.map((file) => (
              <span className="forward-preview-file" key={file.id}>
                <Paperclip size={14} aria-hidden="true" />
                {file.filename}
              </span>
            ))}
          </li>
        ))}
      </ol>
      <ErrorNotice>{validation || null}</ErrorNotice>
      <div
        className="forward-recipient-list"
        role="group"
        aria-label="Получатели"
        aria-busy={loading}
      >
        {loading && (
          <p className="forward-empty" role="status">
            Ищем получателей…
          </p>
        )}
        {currentSearch && (
          <>
            {destinations.map((item) =>
              recipientRow({ kind: "conversation", item }),
            )}
            <ErrorNotice error={conversations.error} />
            {conversations.isError && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void conversations.refetch()}
              >
                Повторить загрузку чатов
              </Button>
            )}
            {conversations.hasNextPage && (
              <Button
                variant="outline"
                disabled={busy}
                busy={conversations.isFetchingNextPage}
                onClick={() => void conversations.fetchNextPage()}
              >
                Ещё чаты
              </Button>
            )}
            {!!people.length && <h3>Пользователи</h3>}
            {people.map((item) => recipientRow({ kind: "user", item }))}
            {searchingPeople && <ErrorNotice error={users.error} />}
            {searchingPeople && users.isError && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void users.refetch()}
              >
                Повторить поиск пользователей
              </Button>
            )}
            {!loading &&
              !conversations.isError &&
              !users.isError &&
              !destinations.length &&
              !people.length && (
                <p className="forward-empty">
                  {search
                    ? "Получатели не найдены. Попробуйте другое имя."
                    : "Чатов пока нет. Найдите пользователя по имени."}
                </p>
              )}
          </>
        )}
      </div>
      <ErrorNotice error={error} />
      {failedRecipient && (
        <Button
          variant="outline"
          onClick={() => void send(failedRecipient)}
          disabled={busy}
        >
          Повторить пересылку
        </Button>
      )}
      {busy && (
        <p className="forward-empty" role="status">
          Пересылаем сообщения…
        </p>
      )}
    </Modal>
  );
}
