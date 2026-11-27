import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Info,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { initials, passwordLength } from "../utils";
import { serviceOrigin } from "../platform/urls";
import { Button, ErrorNotice, Loading, PasswordInput } from "./ui";
import "./account-management.css";

const accountFieldErrors = {
  name: "Введите имя для встреч.",
  password: "Пароль должен содержать от 8 до 128 символов.",
  repeatPassword: "Пароли не совпадают.",
};

export function AccountManagement({ onBack }: { onBack: () => void }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const accounts = useQuery({
    queryKey: ["browser-accounts", auth.user?.id],
    queryFn: ({ signal }) => api.accounts(signal),
    staleTime: 0,
  });
  const [mode, setMode] = useState<"login" | "register" | "delete" | null>(
    null,
  );
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [invalidField, setInvalidField] = useState<
    keyof typeof accountFieldErrors | null
  >(null);
  const adding = mode === "login" || mode === "register";
  const heading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const wasAdding = useRef(false);
  const fieldId = useId();
  const server = serviceOrigin();
  useEffect(() => {
    if (adding) heading.current?.focus();
    else if (wasAdding.current) addButton.current?.focus();
    wasAdding.current = adding;
  }, [adding]);
  const items = accounts.data?.items || [];
  // Include the current identity even while a pre-existing cookie is being upgraded.
  const visible =
    auth.user && !items.some((item) => item.id === auth.user!.id)
      ? [auth.user, ...items]
      : items;
  function choose(next: typeof mode) {
    setMode(next);
    if (next === null) {
      setEmail("");
      setName("");
    }
    setPassword("");
    setRepeatPassword("");
    setError(undefined);
    setInvalidField(null);
    setConfirmed(false);
  }
  async function changeAccount(id: string) {
    setBusy(true);
    setError(undefined);
    try {
      await auth.switchAccount(id);
      navigate("/app/settings#accounts", { replace: true });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  function validateField(
    form: HTMLFormElement,
    field: keyof typeof accountFieldErrors,
  ) {
    setInvalidField(field);
    const input = form.elements.namedItem(field);
    if (input instanceof HTMLInputElement) input.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setInvalidField(null);
    if (mode === "register") {
      if (!name.trim()) return validateField(event.currentTarget, "name");
      const length = passwordLength(password);
      if (length < 8 || length > 128)
        return validateField(event.currentTarget, "password");
      if (password !== repeatPassword)
        return validateField(event.currentTarget, "repeatPassword");
    }
    if (mode === "delete" && !confirmed) return;
    setBusy(true);
    try {
      if (mode === "delete") await auth.deleteAccount(password);
      else {
        if (mode === "register")
          await api.register(email.trim(), password, name.trim());
        await auth.login(email.trim(), password);
      }
      choose(null);
      navigate("/app/settings#accounts", { replace: true });
    } catch (error) {
      setError(error);
      setPassword("");
      setRepeatPassword("");
    } finally {
      setBusy(false);
    }
  }
  if (adding) {
    const registering = mode === "register";
    return (
      <section
        className="account-management account-add"
        aria-labelledby="accounts-heading"
      >
        <button
          className="account-settings-back"
          type="button"
          disabled={busy}
          onClick={() => choose(null)}
        >
          <ArrowLeft size={18} aria-hidden="true" /> Аккаунты
        </button>
        <header className="account-management-heading">
          <h2 id="accounts-heading" ref={heading} tabIndex={-1}>
            Добавить аккаунт
          </h2>
          <p className="field-hint">
            {registering
              ? "Создайте аккаунт на подключённом сервере."
              : "Войдите в существующий аккаунт."}
          </p>
        </header>
        <div
          className="account-add-modes"
          role="group"
          aria-label="Способ добавления аккаунта"
        >
          <button
            type="button"
            aria-pressed={!registering}
            disabled={busy}
            onClick={() => {
              if (registering) choose("login");
            }}
          >
            Войти
          </button>
          <button
            type="button"
            aria-pressed={registering}
            disabled={busy}
            onClick={() => {
              if (!registering) choose("register");
            }}
          >
            Создать аккаунт
          </button>
        </div>
        <form
          className="account-add-form"
          onSubmit={(event) => void submit(event)}
          onChange={() => {
            setError(undefined);
            setInvalidField(null);
          }}
        >
          <label className="account-add-field account-add-server">
            <span>Адрес сервера</span>
            <input type="url" value={server} readOnly />
          </label>
          {registering && (
            <label className="account-add-field">
              <span>Имя для встреч</span>
              <input
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={invalidField === "name" || undefined}
                aria-describedby={
                  invalidField === "name" ? `${fieldId}-error` : undefined
                }
                placeholder="Как вас зовут"
                required
                maxLength={100}
                autoComplete="name"
                disabled={busy}
              />
            </label>
          )}
          <label className="account-add-field">
            <span>Электронная почта</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.ru"
              required
              maxLength={254}
              autoComplete="username"
              disabled={busy}
            />
          </label>
          <div className="account-add-field">
            <label htmlFor={`${fieldId}-password`}>Пароль</label>
            <PasswordInput
              key={mode}
              name="password"
              id={`${fieldId}-password`}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                registering ? "Минимум 8 символов" : "Введите пароль"
              }
              autoComplete={registering ? "new-password" : "current-password"}
              aria-invalid={invalidField === "password" || undefined}
              aria-describedby={
                invalidField === "password"
                  ? `${fieldId}-error`
                  : registering
                    ? `${fieldId}-password-hint`
                    : undefined
              }
              required
              maxLength={128}
              disabled={busy}
            />
            {registering && (
              <small id={`${fieldId}-password-hint`}>
                От 8 до 128 символов.
              </small>
            )}
          </div>
          {registering && (
            <div className="account-add-field">
              <label htmlFor={`${fieldId}-repeat`}>Повторите пароль</label>
              <PasswordInput
                id={`${fieldId}-repeat`}
                name="repeatPassword"
                aria-invalid={invalidField === "repeatPassword" || undefined}
                aria-describedby={
                  invalidField === "repeatPassword"
                    ? `${fieldId}-error`
                    : undefined
                }
                visibilityLabel="повтор пароля"
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
                placeholder="Повторите пароль"
                autoComplete="new-password"
                required
                maxLength={128}
                disabled={busy}
              />
            </div>
          )}
          {(Boolean(error) || invalidField) && (
            <div className="account-add-error" id={`${fieldId}-error`}>
              <ErrorNotice error={error}>
                {invalidField && accountFieldErrors[invalidField]}
              </ErrorNotice>
            </div>
          )}
          <Button type="submit" busy={busy}>
            {registering ? "Создать и добавить" : "Войти и добавить"}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => choose(null)}
          >
            Отмена
          </Button>
        </form>
      </section>
    );
  }

  return (
    <section className="account-management" aria-labelledby="accounts-heading">
      <button
        className="account-settings-back"
        type="button"
        disabled={busy}
        onClick={onBack}
      >
        <ArrowLeft size={18} aria-hidden="true" /> Все настройки
      </button>
      <header className="account-management-heading">
        <h2 id="accounts-heading">Аккаунты</h2>
        <p className="field-hint">Выберите аккаунт для встреч и общения.</p>
      </header>
      {accounts.isPending && <Loading />}
      <ErrorNotice error={accounts.error} />
      {accounts.isError && (
        <Button variant="secondary" onClick={() => void accounts.refetch()}>
          Повторить
        </Button>
      )}
      <ul className="connected-accounts">
        {visible.map((item) => (
          <li
            key={item.id}
            className={
              item.id === auth.user?.id ? "connected-account-current" : ""
            }
          >
            <span className="connected-account-avatar" aria-hidden="true">
              {initials(item.displayName || item.email)}
            </span>
            <span className="connected-account-name">
              <strong>{item.displayName || item.email}</strong>
              <small>{item.email}</small>
              <small className="connected-account-server">
                <Server size={13} aria-hidden="true" /> {new URL(server).host}
              </small>
            </span>
            {item.id === auth.user?.id ? (
              <span className="connected-account-active">
                <CircleCheck size={19} aria-hidden="true" /> Текущий
              </span>
            ) : (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void changeAccount(item.id)}
              >
                Переключиться
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!mode && (
        <button
          ref={addButton}
          type="button"
          className="button button-primary account-add-button"
          disabled={busy || visible.length >= 5}
          onClick={() => choose("login")}
        >
          <Plus size={17} aria-hidden="true" /> Добавить аккаунт
        </button>
      )}
      <p className="account-management-note">
        <Info size={15} aria-hidden="true" />
        <span>
          Можно подключить до 5 аккаунтов. Настройки в соседних разделах
          относятся к активному аккаунту.
        </span>
      </p>
      <ErrorNotice error={error} />
      {!mode && (
        <div className="account-management-actions">
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => choose("delete")}
          >
            <Trash2 size={18} aria-hidden="true" /> Удалить текущий аккаунт
          </Button>
        </div>
      )}
      {mode === "delete" && (
        <form
          className="account-management-form"
          onSubmit={(event) => void submit(event)}
        >
          <h3>Удалить аккаунт с сервера</h3>
          <p>
            Аккаунт <strong>{auth.user?.email}</strong> будет удалён. Данные
            входа и личные настройки будут очищены, все сессии завершены. Общая
            история встреч и переписки останется с именем «Удалённый аккаунт».
          </p>
          <p className="field-hint">
            Перед удалением передайте владение группами или удалите их,
            завершите или отмените созданные встречи и выйдите из звонков.
          </p>
          <label className="field">
            <span>Пароль текущего аккаунта</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              maxLength={128}
              autoComplete="current-password"
              disabled={busy}
            />
          </label>
          <label className="account-delete-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={busy}
            />
            Я понимаю, что удаление нельзя отменить
          </label>
          <div className="account-management-actions">
            <Button
              variant="danger"
              type="submit"
              busy={busy}
              disabled={!confirmed}
            >
              Удалить аккаунт навсегда
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => choose(null)}
            >
              Отмена
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
