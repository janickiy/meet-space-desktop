import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { SubmitEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Mail, Search, X } from "lucide-react";
import { api } from "../api";
import type { Conference, InvitationUser } from "../types";
import { inviteLink } from "../utils";
import { qrCodePath } from "../vendor/qr-code.js";
import { Button, CopyLink, ErrorNotice, Modal } from "./ui";
import "./conference-invitations.css";

const maxRecipients = 20;

/** Sharing and server invitations use the same two-step dialog in every meeting entry point. */
export function ConferenceInvitationDialog({
  conference,
  canInvite,
  onClose,
  onBack,
  returnFocus,
  onBusyChange,
}: {
  conference: Conference;
  canInvite: boolean;
  onClose: () => void;
  onBack?: () => void;
  returnFocus?: () => HTMLElement | null;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [step, setStep] = useState<"share" | "invite">("share");
  const [busy, setBusy] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    content.current?.closest('[role="dialog"]')?.scrollTo(0, 0);
    content.current
      ?.querySelector<HTMLElement>(
        step === "invite" ? "[data-autofocus]" : ".call-share-invite-button",
      )
      ?.focus();
  }, [step]);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const link = inviteLink(conference.inviteCode);
  const invitationText = `Приглашаю на встречу «${conference.title}».\n\nПодключиться к встрече: ${link}`;
  return (
    <Modal
      title={step === "share" ? "Поделиться встречей" : "Пригласить участников"}
      className={step === "share" ? "call-share-modal" : "call-invite-modal"}
      returnFocus={returnFocus}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div ref={content}>
        {step === "share" ? (
          <div className="call-share-dialog">
            <p className="call-share-title">{conference.title}</p>
            <div className="call-share-card">
              <div className="call-share-copy">
                <h3>Ссылка на встречу</h3>
                <p>
                  Поделитесь ссылкой или отсканируйте QR-код, чтобы открыть
                  встречу.
                </p>
                <CopyLink value={link} />
                <p className="call-share-local-note">
                  По ссылке можно присоединиться без аккаунта.
                </p>
              </div>
              <aside className="call-share-qr">
                <MeetingQrCode link={link} />
                <strong>QR-код встречи</strong>
                <p>Отсканируйте, чтобы открыть ссылку</p>
              </aside>
            </div>
            {(canInvite || onBack) && (
              <div className="call-share-footer">
                {onBack && (
                  <Button variant="secondary" onClick={onBack}>
                    Назад
                  </Button>
                )}
                {canInvite && (
                  <Button
                    className="call-share-invite-button"
                    onClick={() => setStep("invite")}
                  >
                    <Mail size={18} aria-hidden="true" /> Пригласить участников
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <ConferenceInvitationForm
            key={conference.id}
            conferenceId={conference.id}
            canInvite={canInvite}
            invitationText={invitationText}
            onBack={() => setStep("share")}
            onBusyChange={setBusy}
          />
        )}
      </div>
    </Modal>
  );
}

function MeetingQrCode({ link }: { link: string }) {
  let qr;
  try {
    qr = qrCodePath(link);
  } catch {
    /* The usable URL remains visible if encoding fails. */
  }
  return (
    <div
      className="call-share-qr-code"
      role="img"
      aria-label="QR-код ссылки на встречу"
    >
      {qr ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          aria-hidden="true"
          shapeRendering="crispEdges"
        >
          <rect width={qr.size} height={qr.size} fill="#fff" />
          <path d={qr.path} fill="#111927" />
        </svg>
      ) : (
        <span>QR-код недоступен. Используйте ссылку на встречу.</span>
      )}
    </div>
  );
}

function CopyInvitation({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  return (
    <div className="call-invite-copy">
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          try {
            if (!navigator.clipboard) throw new Error("Clipboard unavailable");
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("error");
          }
        }}
      >
        {state === "copied" ? (
          <Check size={16} aria-hidden="true" />
        ) : (
          <Copy size={16} aria-hidden="true" />
        )}
        {state === "copied" ? "Скопировано" : "Копировать приглашение"}
      </Button>
      <span role="status">
        {state === "error"
          ? "Не удалось скопировать. Выделите текст и скопируйте вручную."
          : state === "copied"
            ? "Приглашение скопировано."
            : ""}
      </span>
    </div>
  );
}

/** Сохраняет введённых получателей, пока сервер не подтвердит постановку приглашений в очередь. */
export function ConferenceInvitationForm({
  conferenceId,
  canInvite,
  onBusyChange,
  invitationText,
  onBack,
}: {
  conferenceId: string;
  canInvite: boolean;
  onBusyChange?: (busy: boolean) => void;
  invitationText?: string;
  onBack?: () => void;
}) {
  const id = useId();
  const [emailsText, setEmailsText] = useState("");
  const [queryText, setQueryText] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<InvitationUser[]>([]);
  const [validation, setValidation] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(queryText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [queryText]);
  const query = useQuery({
    queryKey: ["invitation-users", conferenceId, search],
    queryFn: ({ signal }) => api.invitationUsers(conferenceId, search, signal),
    enabled: canInvite && Array.from(search).length >= 2,
    retry: false,
    staleTime: 30_000,
  });
  const invitation = useMutation({
    mutationFn: (recipients: { emails: string[]; userIds: string[] }) =>
      api.inviteParticipants(conferenceId, recipients),
    onSuccess: () => {
      setEmailsText("");
      setSelected([]);
      setQueryText("");
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  useLayoutEffect(() => {
    if (!invitation.isPending) return;
    const dialog = form.current?.closest<HTMLElement>('[role="dialog"]');
    // Disabling the submitting control must not move keyboard focus to the background.
    dialog?.focus({ preventScroll: true });
    // Chromium can finish blurring a newly disabled control after the layout effect.
    const frame = window.requestAnimationFrame(() => {
      if (dialog?.isConnected && !dialog.contains(document.activeElement))
        dialog.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [invitation.isPending]);
  useEffect(() => {
    onBusyChange?.(invitation.isPending);
    return () => onBusyChange?.(false);
  }, [invitation.isPending, onBusyChange]);

  function edit() {
    setValidation("");
    if (!invitation.isPending) invitation.reset();
  }

  function toggle(user: InvitationUser) {
    edit();
    if (selected.some((item) => item.id === user.id)) {
      setSelected(selected.filter((item) => item.id !== user.id));
      return;
    }
    if (selected.length >= maxRecipients) {
      setValidation(
        `За один раз можно пригласить не больше ${maxRecipients} человек.`,
      );
      return;
    }
    setSelected([...selected, user]);
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !canInvite) return;
    setValidation("");
    invitation.reset();
    const entered = [
      ...new Set(
        emailsText
          .split(/[\s,;]+/)
          .filter(Boolean)
          .map((email) => email.toLowerCase()),
      ),
    ];
    if (
      entered.some(
        (email) =>
          email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      )
    ) {
      setValidation("Проверьте адреса email. Например: colleague@example.com.");
      return;
    }
    const selectedEmails = new Set(
      selected.map((user) => user.email.toLowerCase()),
    );
    const emails = entered.filter((email) => !selectedEmails.has(email));
    const total = emails.length + selected.length;
    if (!total) {
      setValidation("Укажите email или выберите пользователя системы.");
      return;
    }
    if (total > maxRecipients) {
      setValidation(
        `За один раз можно пригласить не больше ${maxRecipients} человек.`,
      );
      return;
    }
    submitting.current = true;
    invitation.mutate({ emails, userIds: selected.map((user) => user.id) });
  }

  const currentSearch = queryText.trim() === search;
  const hasSearch = Array.from(queryText.trim()).length >= 2;
  return (
    <form
      ref={form}
      className="conference-invitation-form"
      onSubmit={submit}
      noValidate
      aria-busy={invitation.isPending}
    >
      {!canInvite && (
        <ErrorNotice>
          Право приглашать участников изменилось. Поделиться ссылкой на встречу
          можно на предыдущем шаге.
        </ErrorNotice>
      )}
      {invitationText && (
        <p className="modal-description">
          Отправьте приглашение участникам или скопируйте текст со ссылкой на
          встречу.
        </p>
      )}
      <label className="field" htmlFor={`${id}-emails`}>
        Электронная почта участников
        <input
          id={`${id}-emails`}
          type="text"
          inputMode="email"
          data-autofocus
          placeholder="anna@company.ru, max@company.ru"
          autoComplete="off"
          maxLength={6000}
          value={emailsText}
          disabled={invitation.isPending || !canInvite}
          aria-describedby={`${id}-email-hint`}
          onChange={(event) => {
            edit();
            setEmailsText(event.target.value);
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text/plain");
            if (!/[\r\n]/.test(pasted)) return;
            event.preventDefault();
            const input = event.currentTarget;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? start;
            const inserted = pasted
              .replace(/\r\n?|\n/g, ", ")
              .slice(0, 6000 - input.value.length + end - start);
            edit();
            setEmailsText(
              input.value.slice(0, start) + inserted + input.value.slice(end),
            );
            window.requestAnimationFrame(() => {
              if (input.isConnected)
                input.setSelectionRange(
                  start + inserted.length,
                  start + inserted.length,
                );
            });
          }}
        />
      </label>
      <p className="field-hint" id={`${id}-email-hint`}>
        Несколько адресов разделяйте запятой или новой строкой. До{" "}
        {maxRecipients} получателей за один раз.
      </p>
      {invitationText && (
        <>
          <label className="field" htmlFor={`${id}-text`}>
            Текст приглашения
            <textarea
              id={`${id}-text`}
              readOnly
              rows={5}
              value={invitationText}
            />
          </label>
          <CopyInvitation text={invitationText} />
        </>
      )}
      <label className="field" htmlFor={`${id}-search`}>
        Добавить пользователей системы
        <span className="invitation-search-field">
          <Search size={17} aria-hidden="true" />
          <input
            id={`${id}-search`}
            type="search"
            placeholder="Имя или email"
            autoComplete="off"
            maxLength={100}
            value={queryText}
            disabled={invitation.isPending || !canInvite}
            aria-describedby={`${id}-search-hint`}
            onChange={(event) => setQueryText(event.target.value)}
          />
        </span>
      </label>
      <p className="field-hint" id={`${id}-search-hint`}>
        Введите минимум 2 символа имени или email.
      </p>
      {selected.length > 0 && (
        <ul className="invitation-selected" aria-label="Выбранные пользователи">
          {selected.map((user) => (
            <li key={user.id}>
              <span>{user.displayName || user.email}</span>
              <button
                type="button"
                aria-label={`Убрать ${user.email}`}
                disabled={invitation.isPending || !canInvite}
                onClick={() => toggle(user)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {hasSearch && (!currentSearch || query.isFetching) && (
        <p className="field-hint" role="status">
          Ищем пользователей…
        </p>
      )}
      {hasSearch && currentSearch && query.isError && (
        <div className="invitation-search-error">
          <ErrorNotice error={query.error} />
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Повторить поиск
          </Button>
        </div>
      )}
      {hasSearch &&
        currentSearch &&
        query.isSuccess &&
        !query.isFetching &&
        (query.data.items.length ? (
          <ul
            className="invitation-user-results"
            aria-label="Пользователи системы"
          >
            {query.data.items.map((user) => (
              <li key={user.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={
                      user.displayName
                        ? `${user.displayName}, ${user.email}`
                        : user.email
                    }
                    checked={selected.some((item) => item.id === user.id)}
                    disabled={invitation.isPending || !canInvite}
                    onChange={() => toggle(user)}
                  />
                  <span>
                    <strong>{user.displayName || user.email}</strong>
                    {user.displayName && <small>{user.email}</small>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-hint" role="status">
            Пользователи не найдены. Можно указать email выше.
          </p>
        ))}
      <p className="field-hint">
        Получатели получат письмо со ссылкой на встречу. У зарегистрированных
        пользователей приглашение появится и в личном кабинете.
      </p>
      <ErrorNotice error={invitation.error}>{validation || null}</ErrorNotice>
      {invitation.data && (
        <div className="invitation-result" role="status" aria-live="polite">
          <ul>
            {invitation.data.items.map((item) => (
              <li key={item.id}>
                <strong>{item.email}</strong>
                <span>
                  {item.status === "queued"
                    ? "Приглашение поставлено в очередь"
                    : item.status === "left_chat"
                      ? "Пользователь покинул чат. Он может вернуться по ссылке на встречу."
                      : "Приглашение уже отправлялось"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="call-invite-actions">
        {onBack && (
          <Button
            type="button"
            variant="secondary"
            className="call-invite-back"
            disabled={invitation.isPending}
            onClick={onBack}
          >
            Назад
          </Button>
        )}
        <Button type="submit" busy={invitation.isPending} disabled={!canInvite}>
          <Mail size={18} aria-hidden="true" />
          Отправить приглашения
        </Button>
      </div>
    </form>
  );
}
