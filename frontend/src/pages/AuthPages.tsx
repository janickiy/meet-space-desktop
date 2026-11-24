import { EntryFrame } from "../components/EntryFrame";
import { DesktopServerButton } from "../components/desktop/DesktopSessionGate";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { SubmitEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, ArrowRight, Link as LinkIcon } from "lucide-react";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import {
  Brand,
  Button,
  ErrorNotice,
  PasswordInput,
  SuccessMark,
} from "../components/ui";
import { passwordLength, safeNext, utf8Bytes } from "../utils";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "../brand";
import { WelcomePanel } from "../components/WelcomePanel";
import "./auth-pages.css";

/**
 * AuthPage показывает форму входа либо регистрации и обрабатывает проверку данных и ошибки API.
 *
 * @args
 *   - объект параметров: register — выбирает форму регистрации вместо входа.
 *
 * @returns JSX-представление компонента для текущих свойств и состояния.
 */
export function AuthPage({ register = false }: { register?: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const nextQuery = next === "/app" ? "" : `?next=${encodeURIComponent(next)}`;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const policy = useQuery({
    queryKey: ["auth-providers"],
    queryFn: ({ signal }) => api.authProviders(signal),
    retry: false,
  });
  const corporate = policy.data?.mode === "ldap";
  const [recoverySent, setRecoverySent] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const submitted = useRef(false);
  // Автоматический вход не должен прерывать переход на страницу успешной регистрации.
  if (auth.user && !auth.loading && !submitted.current)
    return <Navigate to={next} replace />;
  if (register && policy.data && !policy.data.registrationEnabled)
    return <Navigate to={`/login${nextQuery}`} replace />;
  /**
   * submit проверяет поля формы, отправляет изменение и показывает результат либо ошибку.
   *
   * @args
   *   - event (SubmitEvent<HTMLFormElement>) — событие отправки формы.
   *
   * @returns Promise, который после завершения операции возвращает: значение не возвращается; функция выполняет описанные действия и обновляет нужное состояние.
   */
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy.data || busy) return;
    setError("");
    if (
      !/^[^\s@]+@[^\s@]+$/.test(email.trim()) ||
      utf8Bytes(email.trim()) > 254
    ) {
      setError("Введите корректный email.");
      return;
    }
    if (recovery && !register && policy.data.passwordRecoveryEnabled) {
      setBusy(true);
      try {
        await api.recoverPassword(email.trim());
        setRecoverySent(true);
      } catch (error) {
        setError(errorMessage(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    const size = passwordLength(password);
    if (
      !password ||
      (corporate
        ? utf8Bytes(password) > 4096 || password.includes("\0")
        : size > 128) ||
      (register && size < 8)
    ) {
      setError(
        corporate
          ? "Введите пароль организации."
          : register
            ? "Пароль должен содержать от 8 до 128 символов."
            : "Введите пароль длиной не более 128 символов.",
      );
      return;
    }
    if (register && Array.from(name.trim()).length > 100) {
      setError("Имя не должно превышать 100 символов.");
      return;
    }
    submitted.current = true;
    setBusy(true);
    try {
      if (register) {
        await api.register(email.trim(), password, name);
        try {
          await auth.login(email.trim(), password);
        } catch {
          /* Регистрация успешна; страница результата при необходимости предложит войти. */
        }
        setPassword("");
        navigate(`/register/success${nextQuery}`, { replace: true });
      } else {
        await auth.login(email.trim(), password);
        setPassword("");
        navigate(next, { replace: true });
      }
    } catch (error) {
      submitted.current = false;
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <EntryFrame>
      <div className="auth-page auth-business-page">
        <a className="skip-link" href="#auth-form">
          Перейти к форме
        </a>
        <header className="auth-business-header">
          <Brand />
          <DesktopServerButton />
          <Link className="auth-back" to="/">
            <ArrowLeft size={16} aria-hidden="true" />
            На главную
          </Link>
        </header>
        <main className="auth-business-layout">
          <WelcomePanel />
          <section
            className={`auth-card ${register ? "register-card" : ""}`}
            id="auth-form"
            tabIndex={-1}
            aria-labelledby="auth-heading-title"
          >
            <p className="auth-tagline">ШАГ 2 ИЗ 2 · ПРОФИЛЬ</p>
            <div className="auth-heading">
              <h1 id="auth-heading-title">
                {register
                  ? "Рады знакомству"
                  : recovery
                    ? "Восстановление доступа"
                    : corporate
                      ? policy.data?.ldap.label || "Корпоративный вход"
                      : "С возвращением"}
              </h1>
              <p>
                {register
                  ? "Создайте аккаунт для встреч и общения с коллегами."
                  : recovery
                    ? "Укажите email вашего аккаунта."
                    : corporate
                      ? "Введите корпоративный email и пароль организации."
                      : "Войдите, чтобы продолжить работу с командой."}
              </p>
            </div>
            {policy.data?.registrationEnabled && (
              <nav
                className="reference-auth-tabs"
                aria-label="Вход и регистрация"
              >
                <Link
                  aria-current={!register ? "page" : undefined}
                  to={`/login${nextQuery}`}
                >
                  Войти
                </Link>
                <Link
                  aria-current={register ? "page" : undefined}
                  to={`/register${nextQuery}`}
                >
                  Создать аккаунт
                </Link>
              </nav>
            )}
            <ErrorNotice>
              {error ||
                (!register && auth.expired
                  ? "Сессия завершилась. Войдите снова, чтобы продолжить."
                  : null)}
            </ErrorNotice>
            {policy.isError && (
              <div role="alert">
                <p>Не удалось получить настройки входа.</p>
                <Button onClick={() => void policy.refetch()}>Повторить</Button>
              </div>
            )}
            {policy.isPending && (
              <p role="status">Загружаем настройки входа…</p>
            )}
            {policy.data && (
              <form onSubmit={submit} noValidate>
                <label className="field" htmlFor="email">
                  Email
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    placeholder="name@company.ru"
                    required
                    value={email}
                    onChange={
                      /**
                       * onChange обрабатывает соответствующее событие интерфейса и изменяет состояние текущего действия.
                       *
                       * @args
                       *   - event — проверенный конверт события комнаты.
                       *
                       * @returns вычисленное значение: setEmail(event.target.value).
                       */ (event) => setEmail(event.target.value)
                    }
                    disabled={busy}
                  />
                </label>
                {(!recovery || register) && (
                  <label className="field" htmlFor="password">
                    Пароль
                    <PasswordInput
                      id="password"
                      placeholder={
                        register ? "Минимум 8 символов" : "Введите пароль"
                      }
                      autoComplete={
                        register ? "new-password" : "current-password"
                      }
                      required
                      value={password}
                      onChange={
                        /**
                         * onChange обрабатывает соответствующее событие интерфейса и изменяет состояние текущего действия.
                         *
                         * @args
                         *   - event — проверенный конверт события комнаты.
                         *
                         * @returns вычисленное значение: setPassword(event.target.value).
                         */ (event) => setPassword(event.target.value)
                      }
                      disabled={busy}
                    />
                  </label>
                )}
                {register ? (
                  <>
                    <p className="field-hint password-hint">
                      От 8 до 128 символов. Цифры и спецсимволы необязательны.
                    </p>
                    <label className="field" htmlFor="displayName">
                      Ваше имя · необязательно
                      <input
                        id="displayName"
                        autoComplete="nickname"
                        placeholder="Как к вам обращаться?"
                        value={name}
                        onChange={
                          /**
                           * onChange обрабатывает соответствующее событие интерфейса и изменяет состояние текущего действия.
                           *
                           * @args
                           *   - event — проверенный конверт события комнаты.
                           *
                           * @returns вычисленное значение: setName(event.target.value).
                           */ (event) => setName(event.target.value)
                        }
                        disabled={busy}
                      />
                    </label>
                  </>
                ) : policy.data.passwordRecoveryEnabled ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setRecovery(!recovery);
                      setRecoverySent(false);
                      setPassword("");
                      setError("");
                    }}
                  >
                    {recovery ? "Вернуться ко входу" : "Забыли пароль?"}
                  </button>
                ) : null}
                {recoverySent && recovery && !register && (
                  <p role="status">
                    Если аккаунт с таким email существует, вы получите письмо с
                    инструкцией.
                  </p>
                )}
                <Button type="submit" busy={busy} className="full-width">
                  {register
                    ? "Зарегистрироваться"
                    : recovery
                      ? "Отправить письмо"
                      : "Войти"}
                  <ArrowRight size={17} aria-hidden="true" />
                </Button>
              </form>
            )}
            {policy.data?.registrationEnabled && (
              <p className="auth-switch">
                {register ? (
                  <>
                    Уже есть аккаунт?{" "}
                    <Link to={`/login${nextQuery}`}>Войти</Link>
                  </>
                ) : (
                  <>
                    Нет аккаунта?{" "}
                    <Link to={`/register${nextQuery}`}>Создать аккаунт</Link>
                  </>
                )}
              </p>
            )}
            <div className="auth-invitation-note">
              <LinkIcon size={17} aria-hidden="true" />
              <p>Присоединиться к встрече по приглашению можно без аккаунта.</p>
            </div>
          </section>
        </main>
        <footer className="auth-footer">
          <span>{PRODUCT_DESCRIPTION}</span>
        </footer>
      </div>
    </EntryFrame>
  );
}
/**
 * RegistrationSuccess показывает результат регистрации и переход в приложение.
 *
 *
 * @returns JSX-представление компонента для текущих свойств и состояния.
 */
export function RegistrationSuccess() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  return (
    <EntryFrame>
      <div className="auth-page auth-business-page auth-business-success">
        <header className="auth-business-header">
          <Brand />
          <DesktopServerButton />
          <Link className="auth-back" to="/">
            <ArrowLeft size={16} aria-hidden="true" /> На главную
          </Link>
        </header>
        <main className="auth-success-layout">
          <div className="auth-card registration-success">
            <SuccessMark />
            <span className="auth-tagline">
              ДОБРО ПОЖАЛОВАТЬ В {PRODUCT_NAME}
            </span>
            <h1>Аккаунт создан</h1>
            <p>
              Теперь можно планировать встречи и продолжать общение с командой в
              чатах.
            </p>
            <Link
              className="button button-primary full-width"
              to={user ? next : `/login?next=${encodeURIComponent(next)}`}
            >
              {user ? "Перейти в приложение" : "Войти в аккаунт"}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </main>
      </div>
    </EntryFrame>
  );
}
