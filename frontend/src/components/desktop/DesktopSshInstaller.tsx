import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleCheck,
  CircleHelp,
  CircleX,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { desktopBridge } from "../../platform/desktop";
import type {
  SshInstallerAction,
  SshInstallerCredentials,
  SshInstallerImageMode,
  SshInstallerState,
} from "../../platform/desktop-contracts";
import { Button, ErrorNotice, Loading } from "../ui";
import { installedServerConnectionMessage } from "./installed-server-connection-message";
import { DesktopInstallProgress } from "./DesktopInstallProgress";
import { installPhaseLabel } from "./ssh-install-progress";
import "./desktop-ssh-installer.css";

const statusLabels: Record<string, string> = {
  running: "Установка выполняется",
  cancel_requested: "Останавливаем после текущего шага",
  cancelled: "Установка остановлена",
  needs_recovery: "Установка ждёт продолжения",
  failed: "Не удалось завершить установку",
  completed: "Сервер MeetSpace готов",
};

const checkLabels = {
  pass: "Готово",
  warn: "Обратите внимание",
  blocked: "Нужно исправить",
  unknown: "Не проверено",
};

const checkIcons = {
  pass: CircleCheck,
  warn: TriangleAlert,
  blocked: CircleX,
  unknown: CircleHelp,
};

function failureMessage(cause: unknown): string {
  const code =
    cause && typeof cause === "object" && "code" in cause ? cause.code : "";
  if (code === "ssh_installer_unavailable")
    return "Установщик недоступен в этой сборке. Перезапустите приложение.";
  return "Не удалось выполнить действие. Проверьте подключение и повторите попытку. Если установка уже запущена, сначала проверьте её состояние.";
}

export function DesktopSshInstaller({
  onBack,
  onConnect,
  canConnect,
  onCheckStorage,
}: {
  onBack: () => void;
  onConnect: (origin: string) => Promise<void>;
  canConnect: boolean;
  onCheckStorage: () => Promise<boolean>;
}) {
  const [state, setState] = useState<SshInstallerState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [storageRetryMessage, setStorageRetryMessage] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("root");
  const [domain, setDomain] = useState("");
  const [imageMode, setImageMode] = useState<SshInstallerImageMode>("images");
  const [imageRelease, setImageRelease] = useState("latest");
  const [acmeEmail, setAcmeEmail] = useState("");
  const [smtpEnabled, setSmtpEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpTlsMode, setSmtpTlsMode] = useState<"starttls" | "tls">(
    "starttls",
  );
  const [smtpPassword, setSmtpPassword] = useState("");
  const [authKind, setAuthKind] = useState<"password" | "privateKey">(
    "password",
  );
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [trustConfirmed, setTrustConfirmed] = useState(false);
  const [dockerConsent, setDockerConsent] = useState(false);
  const [acmeConsent, setAcmeConsent] = useState(false);
  const [planConfirmed, setPlanConfirmed] = useState(false);
  const [resumeConfirmed, setResumeConfirmed] = useState(false);
  const [forgetConfirmed, setForgetConfirmed] = useState(false);
  const [savedJobOpened, setSavedJobOpened] = useState(false);
  const [showNewInstall, setShowNewInstall] = useState(false);
  const [newInstallConfirmed, setNewInstallConfirmed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [lastStatusAt, setLastStatusAt] = useState<number | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const clearCredentials = () => {
    setPassword("");
    setPrivateKey("");
    setPassphrase("");
  };

  const resetWizardForm = () => {
    clearCredentials();
    setHost("");
    setPort("22");
    setUser("root");
    setDomain("");
    setImageMode("images");
    setImageRelease("latest");
    setAcmeEmail("");
    setSmtpEnabled(false);
    setSmtpHost("");
    setSmtpPort("587");
    setSmtpFrom("");
    setSmtpUsername("");
    setSmtpTlsMode("starttls");
    setSmtpPassword("");
    setAuthKind("password");
    setTrustConfirmed(false);
    setDockerConsent(false);
    setAcmeConsent(false);
    setPlanConfirmed(false);
    setResumeConfirmed(false);
    setForgetConfirmed(false);
    setSavedJobOpened(false);
    setShowNewInstall(false);
    setNewInstallConfirmed(false);
    setLastStatusAt(null);
    setStorageRetryMessage("");
    heading.current?.closest(".desktop-foundation-card")?.scrollTo({ top: 0 });
  };

  const acceptState = (next: SshInstallerState) => {
    if (!alive.current) return;
    setState(next);
    if (next.endpoint) {
      setHost(next.endpoint.host);
      setPort(String(next.endpoint.port));
      setUser(next.endpoint.user);
    }
    const nextDomain =
      next.plan?.options.domain ??
      next.ticket?.domain ??
      next.preflight?.domain;
    if (nextDomain) setDomain(nextDomain);
    if (next.plan) setImageMode(next.plan.imageMode ?? "source");
    if (next.plan?.options.imageRelease)
      setImageRelease(next.plan.options.imageRelease);
    if (next.ticket || next.status?.terminal) setSmtpPassword("");
    if (next.hasCredentials || next.status?.terminal) clearCredentials();
  };

  useEffect(() => {
    alive.current = true;
    heading.current?.focus();
    void desktopBridge()
      .getSshInstallerState()
      .then(acceptState)
      .catch((cause) => {
        if (alive.current) setError(failureMessage(cause));
      });
    return () => {
      alive.current = false;
      void desktopBridge()
        .sshInstaller("detach", {})
        .catch(() => {});
    };
  }, []);

  const act = async (action: SshInstallerAction, input: unknown = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await desktopBridge().sshInstaller(action, input);
      if (
        alive.current &&
        next.status &&
        !next.error &&
        ["apply", "status", "resume", "cancel"].includes(action)
      )
        setLastStatusAt(Date.now());
      if (alive.current && action === "forget") setLastStatusAt(null);
      if (alive.current && next.ticket && action !== "forget")
        setSavedJobOpened(true);
      acceptState(next);
      return next;
    } catch (cause) {
      if (alive.current) setError(failureMessage(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) {
        if (
          input &&
          typeof input === "object" &&
          "credentials" in input &&
          input.credentials !== undefined
        )
          clearCredentials();
        if (action === "apply" || action === "detach" || action === "forget")
          setSmtpPassword("");
        setBusy(false);
      }
    }
  };
  const actionRef = useRef(act);
  actionRef.current = act;

  useEffect(() => {
    if (
      !savedJobOpened ||
      !state?.hasCredentials ||
      !state.identity?.trusted ||
      !state.ticket ||
      state.error ||
      error ||
      busy ||
      (state.status &&
        !["running", "cancel_requested"].includes(state.status.state))
    )
      return;
    const timer = window.setTimeout(() => {
      void actionRef.current("status");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [state, busy, error, savedJobOpened]);

  useEffect(() => {
    setDockerConsent(false);
    setAcmeConsent(false);
    setPlanConfirmed(false);
  }, [state?.plan?.hash]);

  useEffect(() => {
    if (!state?.plan || state.ticket) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state?.plan?.hash, state?.ticket]);

  const credentials = (): SshInstallerCredentials | undefined => {
    if (state?.hasCredentials) return undefined;
    return authKind === "password"
      ? { kind: "password", password }
      : { kind: "privateKey", privateKey, passphrase };
  };
  const credentialReady =
    state?.hasCredentials ||
    (authKind === "password" ? password.length > 0 : privateKey.length >= 32);
  const imageReleaseValid =
    imageMode !== "images" ||
    /^(?:latest|v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?)$/.test(
      imageRelease.trim(),
    );
  const disabled = busy || !!state?.busy;
  const savedTicket = state?.ticket;
  const showSavedEntry = !!savedTicket && !savedJobOpened;
  const identity = showSavedEntry ? undefined : state?.identity;
  const plan = showSavedEntry ? undefined : state?.plan;
  const ticket = showSavedEntry ? undefined : state?.ticket;
  const status = showSavedEntry ? undefined : state?.status;
  const PlanContainer = ticket ? "details" : "div";
  const staleStatus =
    !!status &&
    ["running", "cancel_requested"].includes(status.state) &&
    (!!error || !!state?.error || !state?.hasCredentials);
  useEffect(() => {
    if (!ticket || !identity?.trusted) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest(".desktop-foundation-card")?.scrollTo({ top: 0 });
  }, [ticket?.jobId, identity?.trusted, status?.state === "completed"]);
  const expired = !!plan && plan.expiresAt * 1000 <= now;
  const needsDockerConsent =
    !!plan && (plan.installDocker || plan.installDockerPluginsOnly);
  const currentStep = !identity
    ? 0
    : !identity.trusted
      ? 1
      : ticket
        ? 4
        : plan
          ? 3
          : 2;
  const observedEndpointMatches =
    state?.endpoint?.host === host.trim() &&
    state.endpoint.port === Number(port) &&
    state.endpoint.user === user.trim();
  const completed = status?.state === "completed";
  const pageHeading = showSavedEntry
    ? {
        kicker: "СОБСТВЕННАЯ ИНФРАСТРУКТУРА",
        title: "Начнём с установки.",
        description:
          "Начните новую установку сервера или откройте сохранённое задание.",
      }
    : completed
      ? {
          kicker: "ГОТОВО К ОБЩЕНИЮ",
          title: "Ваше пространство готово.",
          description:
            "Установка завершена. Подключитесь и войдите в аккаунт вашего пространства.",
        }
      : ticket
        ? {
            kicker: "СОЗДАЁМ ПРОСТРАНСТВО",
            title: "Установка MeetSpace",
            description:
              "Настраиваем ваш сервер. Здесь видны текущий этап и подтверждённый прогресс установки.",
          }
        : plan
          ? {
              kicker: "ПЕРЕД УСТАНОВКОЙ",
              title: "Всё по плану.",
              description: "Проверьте параметры пространства и план установки.",
            }
          : identity?.trusted
            ? {
                kicker: "ДОСТУП ПО SSH",
                title: "Доступ к серверу.",
                description:
                  "Подтвердите доступ для проверки сервера перед установкой.",
              }
            : identity
              ? {
                  kicker: "ИДЕНТИЧНОСТЬ СЕРВЕРА",
                  title: "Проверим ключ сервера.",
                  description:
                    "При первом подключении нужно убедиться, что это именно ваш сервер.",
                }
              : {
                  kicker: "СОБСТВЕННАЯ ИНФРАСТРУКТУРА",
                  title: "Начнём с сервера.",
                  description:
                    "Укажите Linux-хост, на котором будет работать MeetSpace.",
                };
  const HostFormContainer =
    identity && observedEndpointMatches ? "details" : "div";
  const RecoveryContainer = ticket ? "details" : "div";

  const credentialsForm = !state?.hasCredentials && (
    <fieldset className="desktop-ssh-auth" disabled={disabled}>
      <legend>Доступ по SSH</legend>
      <div
        className="desktop-ssh-auth-tabs"
        role="group"
        aria-label="Способ входа по SSH"
      >
        {(["password", "privateKey"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={authKind === kind}
            onClick={() => {
              setAuthKind(kind);
              clearCredentials();
            }}
          >
            {kind === "password" ? (
              <LockKeyhole size={16} />
            ) : (
              <KeyRound size={16} />
            )}
            {kind === "password" ? "Пароль SSH" : "Приватный ключ"}
          </button>
        ))}
      </div>
      {authKind === "password" ? (
        <>
          <label htmlFor="desktop-ssh-password">Пароль SSH-пользователя</label>
          <input
            id="desktop-ssh-password"
            type="password"
            autoComplete="off"
            required
            maxLength={4096}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </>
      ) : (
        <>
          <label htmlFor="desktop-ssh-key-file">Файл приватного ключа</label>
          <input
            id="desktop-ssh-key-file"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > 64 * 1024) {
                setError("Размер ключа не должен превышать 64 КБ.");
                return;
              }
              void file.text().then(
                (value) => {
                  if (alive.current) {
                    setPrivateKey(value);
                    setError("");
                  }
                },
                () => {
                  if (alive.current)
                    setError("Не удалось прочитать файл ключа.");
                },
              );
            }}
          />
          <label htmlFor="desktop-ssh-key">Или вставьте приватный ключ</label>
          <textarea
            id="desktop-ssh-key"
            rows={4}
            required
            maxLength={65536}
            autoComplete="off"
            spellCheck={false}
            value={privateKey}
            onChange={(event) => setPrivateKey(event.target.value)}
          />
          <label htmlFor="desktop-ssh-passphrase">
            Парольная фраза ключа <span className="muted">(если задана)</span>
          </label>
          <input
            id="desktop-ssh-passphrase"
            type="password"
            autoComplete="off"
            maxLength={4096}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </>
      )}
      <p className="field-hint">
        Пароль и ключ используются только в этой сессии. При закрытии мастера
        они удаляются из памяти приложения.
      </p>
    </fieldset>
  );

  return (
    <section
      className="desktop-ssh-installer"
      aria-labelledby="desktop-ssh-title"
      data-state={status?.state ?? (ticket ? "unknown" : undefined)}
    >
      <div className="desktop-ssh-topbar">
        {!completed && (
          <Button
            type="button"
            variant="secondary"
            className="desktop-ssh-back"
            onClick={onBack}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {ticket ? "Закрыть мастер" : "Назад"}
          </Button>
        )}
        <button
          className="desktop-ssh-close"
          type="button"
          onClick={onBack}
          aria-label="Закрыть мастер установки"
        >
          <X size={20} />
        </button>
      </div>
      <div className="desktop-ssh-step-caption">
        <span>Подключение сервера</span>
        <strong>{String(currentStep + 1).padStart(2, "0")} / 05</strong>
      </div>
      <ol className="desktop-ssh-steps" aria-label="Этапы установки">
        {["Сервер", "Ключ сервера", "Доступ SSH", "План", "Установка"].map(
          (label, index) => (
            <li
              key={label}
              aria-current={
                index === currentStep && status?.state !== "completed"
                  ? "step"
                  : undefined
              }
              className={
                index < currentStep || status?.state === "completed"
                  ? "is-complete"
                  : ""
              }
            >
              <span aria-hidden="true">
                {index < currentStep || status?.state === "completed" ? (
                  <Check size={12} />
                ) : (
                  index + 1
                )}
              </span>
              <strong>{label}</strong>
            </li>
          ),
        )}
      </ol>
      <header className="desktop-ssh-heading">
        {completed && (
          <div className="desktop-ssh-state-icon is-success" aria-hidden="true">
            <Check size={30} />
          </div>
        )}
        <div>
          <span className="desktop-ssh-heading-kicker">
            {pageHeading.kicker}
          </span>
          <h1 id="desktop-ssh-title" ref={heading} tabIndex={-1}>
            {pageHeading.title}
          </h1>
          <p className="desktop-foundation-description">
            {pageHeading.description}
          </p>
        </div>
      </header>
      <ErrorNotice>{error || state?.error?.message || null}</ErrorNotice>
      {!state && !error && <Loading />}
      {!state && error && (
        <Button
          variant="secondary"
          onClick={() => {
            setError("");
            void desktopBridge()
              .getSshInstallerState()
              .then(acceptState)
              .catch((cause) => setError(failureMessage(cause)));
          }}
        >
          Повторить
        </Button>
      )}
      {showSavedEntry && savedTicket && (
        <div className="desktop-ssh-saved-entry">
          <h2>Сохранённая установка</h2>
          <p>
            Карточка сохранилась вместе с настройками приложения. Она не
            означает, что установка сейчас выполняется на сервере.
          </p>
          <strong>{savedTicket.domain}</strong>
          <small>
            {savedTicket.user}@{savedTicket.host}:{savedTicket.port}
          </small>
          <p>
            Откройте задание и подключитесь по SSH, чтобы узнать его состояние.
          </p>
          <div className="desktop-ssh-actions">
            <Button
              disabled={disabled}
              onClick={() => {
                setResumeConfirmed(false);
                setForgetConfirmed(false);
                setShowNewInstall(false);
                setNewInstallConfirmed(false);
                setSavedJobOpened(true);
              }}
            >
              Открыть сохранённую установку
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                setNewInstallConfirmed(false);
                setShowNewInstall(true);
              }}
            >
              Новая установка
            </Button>
          </div>
          {showNewInstall && (
            <div className="desktop-ssh-new-install-confirmation">
              <h3>Начать новую установку?</h3>
              <p>
                Удалится только карточка задания на этом устройстве. Сервер
                MeetSpace и его данные сохранятся; работа на сервере
                продолжится.
              </p>
              <label className="desktop-ssh-checkbox">
                <input
                  id="desktop-ssh-new-install-consent"
                  type="checkbox"
                  checked={newInstallConfirmed}
                  disabled={disabled}
                  onChange={(event) =>
                    setNewInstallConfirmed(event.target.checked)
                  }
                />
                <span>Удалить локальную карточку и начать с первого шага.</span>
              </label>
              <div className="desktop-ssh-actions">
                <Button
                  busy={busy}
                  disabled={disabled || !newInstallConfirmed}
                  onClick={() => {
                    void act("forget", { confirm: true }).then((next) => {
                      if (next && !next.error && alive.current)
                        resetWizardForm();
                    });
                  }}
                >
                  Начать с первого шага
                </Button>
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => {
                    setShowNewInstall(false);
                    setNewInstallConfirmed(false);
                  }}
                >
                  Отмена
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {state && !showSavedEntry && !identity?.trusted && (
        <>
          {ticket && (
            <p className="desktop-ssh-note">
              Сохранена установка для <strong>{ticket.domain}</strong>.
              Подтвердите подключение к тому же хосту, чтобы продолжить.
            </p>
          )}
          <HostFormContainer
            className={
              HostFormContainer === "details"
                ? "desktop-ssh-host-details"
                : "desktop-ssh-host-form"
            }
          >
            {HostFormContainer === "details" && (
              <summary>Параметры SSH-подключения</summary>
            )}
            <form
              className="desktop-ssh-form"
              onSubmit={(event) => {
                event.preventDefault();
                setTrustConfirmed(false);
                void act("discover", {
                  endpoint: {
                    host: host.trim(),
                    port: Number(port),
                    user: user.trim(),
                  },
                });
              }}
            >
              <div className="desktop-ssh-endpoint">
                <div>
                  <label htmlFor="desktop-ssh-host">SSH-адрес хоста</label>
                  <input
                    id="desktop-ssh-host"
                    required
                    maxLength={253}
                    value={host}
                    disabled={disabled || !!ticket}
                    placeholder="203.0.113.10 или server.example.com"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      setHost(event.target.value);
                      setTrustConfirmed(false);
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="desktop-ssh-port">Порт</label>
                  <input
                    id="desktop-ssh-port"
                    type="number"
                    required
                    min={1}
                    max={65535}
                    value={port}
                    disabled={disabled || !!ticket}
                    onChange={(event) => {
                      setPort(event.target.value);
                      setTrustConfirmed(false);
                    }}
                  />
                </div>
              </div>
              <label htmlFor="desktop-ssh-user">SSH-пользователь</label>
              <input
                id="desktop-ssh-user"
                required
                maxLength={64}
                value={user}
                disabled={disabled || !!ticket}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setUser(event.target.value);
                  setTrustConfirmed(false);
                }}
              />
              <p className="field-hint">
                Ubuntu 22.04 / 24.04, root или sudo без пароля. Пароль и ключ
                ещё не передаются.
              </p>
              <Button type="submit" busy={busy} disabled={disabled}>
                Проверить ключ хоста
              </Button>
            </form>
          </HostFormContainer>
          {identity &&
            observedEndpointMatches &&
            state.error?.code !== "HOST_KEY_CHANGED" && (
              <div className="desktop-ssh-trust">
                <h2>
                  <ShieldCheck size={18} aria-hidden="true" />
                  {identity.changed
                    ? "Ключ хоста изменился"
                    : "Подтвердите ключ хоста"}
                </h2>
                <p>
                  Сверьте отпечаток с консолью хостинга или администратором
                  сервера.
                </p>
                <dl>
                  <div>
                    <dt>Хост</dt>
                    <dd>
                      {state.endpoint?.host}:{state.endpoint?.port}
                    </dd>
                  </div>
                  <div>
                    <dt>Алгоритм</dt>
                    <dd>{identity.algorithm}</dd>
                  </div>
                  <div>
                    <dt>Отпечаток SHA-256</dt>
                    <dd>
                      <code>{identity.fingerprint}</code>
                    </dd>
                  </div>
                  {identity.previousFingerprint && (
                    <div>
                      <dt>Прежний отпечаток</dt>
                      <dd>
                        <code>{identity.previousFingerprint}</code>
                      </dd>
                    </div>
                  )}
                </dl>
                <label className="desktop-ssh-checkbox">
                  <input
                    id="desktop-ssh-trust-consent"
                    type="checkbox"
                    checked={trustConfirmed}
                    disabled={disabled}
                    onChange={(event) =>
                      setTrustConfirmed(event.target.checked)
                    }
                  />
                  <span>
                    {identity.changed
                      ? "Я проверил причину изменения и доверяю новому ключу этого хоста."
                      : "Я сверил отпечаток и доверяю этому хосту."}
                  </span>
                </label>
                <Button
                  disabled={disabled || !trustConfirmed}
                  onClick={() =>
                    void act("acceptHostKey", {
                      fingerprint: identity.fingerprint,
                      ...(identity.changed ? { replaceChanged: true } : {}),
                    })
                  }
                >
                  Доверять этому ключу
                </Button>
              </div>
            )}
        </>
      )}
      {identity?.trusted && (
        <>
          <div className="desktop-ssh-connected">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              {state?.endpoint?.user}@{state?.endpoint?.host}:
              {state?.endpoint?.port}
              <small>Ключ хоста подтверждён</small>
            </span>
          </div>
          {!ticket && !plan && (
            <form
              className="desktop-ssh-form desktop-ssh-setup-form"
              onSubmit={(event) => {
                event.preventDefault();
                void act("preflight", {
                  domain: domain.trim(),
                  credentials: credentials(),
                });
              }}
            >
              <fieldset
                className="desktop-ssh-auth desktop-ssh-network desktop-ssh-setup-group"
                disabled={disabled}
              >
                <legend>Адрес сервера</legend>
                <div className="desktop-ssh-setup-fields">
                  <div>
                    <label htmlFor="desktop-ssh-domain">Домен MeetSpace</label>
                    <input
                      id="desktop-ssh-domain"
                      required
                      maxLength={253}
                      value={domain}
                      placeholder="meet.example.com"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setDomain(event.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="desktop-ssh-acme-email">
                      Email для сертификата HTTPS{" "}
                      <span className="muted">(необязательно)</span>
                    </label>
                    <input
                      id="desktop-ssh-acme-email"
                      type="email"
                      maxLength={254}
                      value={acmeEmail}
                      autoComplete="email"
                      onChange={(event) => setAcmeEmail(event.target.value)}
                    />
                  </div>
                </div>
                <p className="field-hint">
                  Для сертификата HTTPS нужны доступные порты 80 и 443.
                </p>
              </fieldset>
              <fieldset
                className="desktop-ssh-install-source desktop-ssh-setup-group"
                disabled={disabled}
              >
                <legend>Способ установки</legend>
                <div
                  className="desktop-ssh-source-options"
                  role="radiogroup"
                  aria-label="Способ установки MeetSpace"
                >
                  {(
                    [
                      {
                        mode: "images",
                        title: "Готовые Docker-образы",
                        description:
                          "Загрузить и запустить готовый выпуск. Рекомендуется.",
                      },
                      {
                        mode: "source",
                        title: "Сборка из исходного кода",
                        description:
                          "Собрать компоненты на сервере. Занимает больше времени.",
                      },
                    ] as const
                  ).map(({ mode, title, description }) => (
                    <label
                      key={mode}
                      className="desktop-ssh-source-option"
                      data-selected={imageMode === mode}
                    >
                      <input
                        type="radio"
                        name="desktop-ssh-image-mode"
                        value={mode}
                        checked={imageMode === mode}
                        onChange={() => setImageMode(mode)}
                      />
                      <span>
                        <strong>{title}</strong>
                        <small>{description}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {imageMode === "images" && (
                  <div className="desktop-ssh-release-field">
                    <label htmlFor="desktop-ssh-image-release">
                      Версия Docker-образов
                    </label>
                    <input
                      id="desktop-ssh-image-release"
                      required
                      maxLength={64}
                      pattern="latest|v[0-9]+[.][0-9]+[.][0-9]+(?:-(?:[A-Za-z0-9.]|-)+)?"
                      value={imageRelease}
                      placeholder="latest"
                      autoComplete="off"
                      spellCheck={false}
                      aria-describedby="desktop-ssh-image-hint"
                      onChange={(event) => setImageRelease(event.target.value)}
                    />
                  </div>
                )}
                <p className="field-hint" id="desktop-ssh-image-hint">
                  {imageMode === "images"
                    ? "latest — последний готовый выпуск для архитектуры сервера, включая beta. Можно указать точную версию. Выпуск, размер и контрольные суммы покажем перед установкой."
                    : "Установщик загрузит исходный код выбранного выпуска и соберёт Docker-образы на вашем сервере."}
                </p>
              </fieldset>
              <fieldset
                className="desktop-ssh-auth desktop-ssh-setup-group"
                disabled={disabled}
              >
                <legend>Почтовые уведомления</legend>
                <label className="desktop-ssh-checkbox">
                  <input
                    id="desktop-smtp-enabled"
                    type="checkbox"
                    checked={smtpEnabled}
                    onChange={(event) => {
                      setSmtpEnabled(event.target.checked);
                      setSmtpPassword("");
                    }}
                  />
                  <span>Отправлять приглашения и напоминания по email</span>
                </label>
                {smtpEnabled ? (
                  <>
                    <div className="desktop-ssh-setup-fields desktop-ssh-smtp-fields">
                      <div>
                        <label htmlFor="desktop-smtp-host">SMTP-сервер</label>
                        <input
                          id="desktop-smtp-host"
                          required
                          maxLength={253}
                          value={smtpHost}
                          placeholder="smtp.example.com"
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) => setSmtpHost(event.target.value)}
                        />
                      </div>
                      <div>
                        <label htmlFor="desktop-smtp-port">Порт SMTP</label>
                        <input
                          id="desktop-smtp-port"
                          required
                          type="number"
                          min={1}
                          max={65535}
                          value={smtpPort}
                          onChange={(event) => setSmtpPort(event.target.value)}
                        />
                      </div>
                      <div className="desktop-ssh-field-wide">
                        <label htmlFor="desktop-smtp-tls">
                          Защищённое соединение
                        </label>
                        <select
                          id="desktop-smtp-tls"
                          value={smtpTlsMode}
                          onChange={(event) => {
                            const mode = event.target.value as
                              "starttls" | "tls";
                            setSmtpTlsMode(mode);
                            setSmtpPort(mode === "tls" ? "465" : "587");
                          }}
                        >
                          <option value="starttls">
                            STARTTLS (обычно порт 587)
                          </option>
                          <option value="tls">TLS (обычно порт 465)</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="desktop-smtp-from">
                          Email отправителя
                        </label>
                        <input
                          id="desktop-smtp-from"
                          required
                          type="email"
                          maxLength={254}
                          value={smtpFrom}
                          placeholder="meetings@example.com"
                          autoComplete="off"
                          onChange={(event) => setSmtpFrom(event.target.value)}
                        />
                      </div>
                      <div>
                        <label htmlFor="desktop-smtp-username">
                          Пользователь SMTP
                        </label>
                        <input
                          id="desktop-smtp-username"
                          required
                          maxLength={254}
                          value={smtpUsername}
                          autoComplete="off"
                          onChange={(event) =>
                            setSmtpUsername(event.target.value)
                          }
                        />
                      </div>
                    </div>
                    <p className="field-hint">
                      Пароль SMTP потребуется перед запуском установки.
                      Используйте данные вашего почтового провайдера.
                    </p>
                  </>
                ) : (
                  <p className="field-hint">
                    Настройка необязательна. Без SMTP приглашения и напоминания
                    по email не отправляются. Почту можно подключить позже через
                    файл настроек на сервере.
                  </p>
                )}
              </fieldset>
              {credentialsForm}
              {state?.hasCredentials && (
                <p className="desktop-ssh-memory">
                  <KeyRound size={14} aria-hidden="true" /> Доступ сохранён до
                  закрытия мастера
                </p>
              )}
              <Button
                type="submit"
                busy={busy}
                disabled={disabled || !credentialReady || !imageReleaseValid}
              >
                Проверить готовность хоста
              </Button>
            </form>
          )}
          {state?.preflight && !ticket && (
            <div className="desktop-ssh-preflight">
              <div className="desktop-ssh-section-heading">
                <h2>Проверка хоста</h2>
                <span>
                  Готово:{" "}
                  {
                    state.preflight.checks.filter(
                      (check) => check.level === "pass",
                    ).length
                  }{" "}
                  из {state.preflight.checks.length}
                </span>
              </div>
              <ul className="desktop-ssh-checks">
                {state.preflight.checks.map((check) => {
                  const StatusIcon = checkIcons[check.level];
                  return (
                    <li key={check.id} data-level={check.level}>
                      <div>
                        <strong>{check.title}</strong>
                        <span className="desktop-ssh-check-status">
                          <StatusIcon size={14} aria-hidden="true" />
                          {checkLabels[check.level]}
                        </span>
                      </div>
                      <p>{check.detail}</p>
                    </li>
                  );
                })}
              </ul>
              {!plan && (
                <Button
                  disabled={
                    disabled ||
                    !state.preflight.ready ||
                    state.preflight.domain !== domain.trim().toLowerCase() ||
                    !credentialReady ||
                    !imageReleaseValid ||
                    (smtpEnabled &&
                      (!smtpHost.trim() ||
                        !smtpFrom.trim() ||
                        !smtpUsername.trim() ||
                        !smtpPort))
                  }
                  onClick={() =>
                    void act("plan", {
                      options: {
                        domain: domain.trim(),
                        acmeEmail: acmeEmail.trim(),
                        imageMode,
                        ...(imageMode === "images"
                          ? { imageRelease: imageRelease.trim() }
                          : {}),
                        ...(smtpEnabled
                          ? {
                              smtp: {
                                host: smtpHost.trim(),
                                port: Number(smtpPort),
                                from: smtpFrom.trim(),
                                username: smtpUsername.trim(),
                                tlsMode: smtpTlsMode,
                              },
                            }
                          : {}),
                      },
                      credentials: credentials(),
                    })
                  }
                >
                  Подготовить план установки
                </Button>
              )}
            </div>
          )}
          {ticket && (
            <div className="desktop-ssh-progress" ref={progressRef}>
              <DesktopInstallProgress
                status={status}
                stale={staleStatus}
                checkedAt={lastStatusAt}
                imageMode={plan?.imageMode ?? "source"}
              />
              {status?.state !== "completed" && (
                <p className="field-hint desktop-ssh-background-note">
                  Установка на сервере не зависит от открытого окна. Для
                  проверки состояния после повторного открытия приложения
                  понадобятся данные SSH.
                </p>
              )}
              {status?.state !== "completed" && credentialsForm}
              {!canConnect && status?.state === "completed" && (
                <div className="desktop-storage-notice" role="status">
                  <strong>
                    Сервер установлен. Осталось подключить приложение.
                  </strong>
                  <p>
                    На этом устройстве недоступно защищённое хранилище паролей.
                    Разблокируйте его в системе, затем повторите проверку.
                  </p>
                  <Button
                    variant="secondary"
                    busy={busy}
                    disabled={disabled}
                    onClick={() => {
                      if (inFlight.current) return;
                      inFlight.current = true;
                      setBusy(true);
                      setStorageRetryMessage("");
                      void onCheckStorage()
                        .then((available) => {
                          if (alive.current && !available)
                            setStorageRetryMessage(
                              "Хранилище пока недоступно. Проверьте, что системное хранилище паролей разблокировано.",
                            );
                        })
                        .catch(() => {
                          if (alive.current)
                            setStorageRetryMessage(
                              "Не удалось проверить хранилище. Повторите попытку.",
                            );
                        })
                        .finally(() => {
                          inFlight.current = false;
                          if (alive.current) setBusy(false);
                        });
                    }}
                  >
                    Проверить хранилище
                  </Button>
                  {storageRetryMessage && <p>{storageRetryMessage}</p>}
                </div>
              )}
              {status?.errorCode && (
                <ErrorNotice>
                  Установщик остановился на этапе «
                  {installPhaseLabel(
                    status.phase.split(":", 1)[0],
                    plan?.imageMode,
                  )}
                  ». Код: {status.errorCode}. Исправьте причину на хосте, затем
                  проверьте состояние.
                </ErrorNotice>
              )}
              {status?.state === "completed" && (
                <div className="desktop-ssh-result-address">
                  <small>АДРЕС ВАШЕГО ПРОСТРАНСТВА</small>
                  <strong>https://{ticket.domain}</strong>
                  <span>
                    <CircleCheck size={15} aria-hidden="true" />
                    HTTPS · сервер готов к подключению
                  </span>
                </div>
              )}
              <div className="desktop-ssh-actions">
                {status?.state === "completed" && (
                  <Button
                    busy={busy}
                    disabled={disabled || !canConnect}
                    onClick={() => {
                      if (inFlight.current) return;
                      inFlight.current = true;
                      setBusy(true);
                      setError("");
                      void onConnect(`https://${ticket.domain}`)
                        .catch((cause) => {
                          if (alive.current)
                            setError(installedServerConnectionMessage(cause));
                        })
                        .finally(() => {
                          inFlight.current = false;
                          if (alive.current) setBusy(false);
                        });
                    }}
                  >
                    Подключиться к MeetSpace
                  </Button>
                )}
                {status?.state !== "completed" && (
                  <Button
                    variant="secondary"
                    busy={busy}
                    disabled={disabled || !credentialReady}
                    onClick={() =>
                      void act("status", { credentials: credentials() })
                    }
                  >
                    Проверить состояние
                  </Button>
                )}
                {status &&
                  ["running", "cancel_requested"].includes(status.state) && (
                    <Button
                      variant="secondary"
                      disabled={
                        disabled ||
                        !credentialReady ||
                        status.state === "cancel_requested"
                      }
                      onClick={() =>
                        void act("cancel", { credentials: credentials() })
                      }
                    >
                      Остановить установку
                    </Button>
                  )}
              </div>
              {status &&
                ["cancelled", "needs_recovery", "failed"].includes(
                  status.state,
                ) && (
                  <>
                    <label className="desktop-ssh-checkbox">
                      <input
                        id="desktop-ssh-resume-consent"
                        type="checkbox"
                        checked={resumeConfirmed}
                        disabled={disabled}
                        onChange={(event) =>
                          setResumeConfirmed(event.target.checked)
                        }
                      />
                      <span>
                        Продолжить установку по сохранённому плану. Установщик
                        проверит уже выполненные шаги.
                      </span>
                    </label>
                    <Button
                      disabled={
                        disabled || !credentialReady || !resumeConfirmed
                      }
                      onClick={() => {
                        setResumeConfirmed(false);
                        void act("resume", {
                          confirmedPlanHash: ticket.planHash,
                          credentials: credentials(),
                        });
                      }}
                    >
                      Возобновить установку
                    </Button>
                  </>
                )}
              <details className="desktop-ssh-events">
                <summary>Сведения об установке</summary>
                <dl>
                  <div>
                    <dt>Идентификатор</dt>
                    <dd>
                      <code>{ticket.jobId}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>SHA-256 плана</dt>
                    <dd>
                      <code>{ticket.planHash}</code>
                    </dd>
                  </div>
                </dl>
                {!!status?.events.length && (
                  <ol>
                    {status.events.slice(-20).map((event) => (
                      <li key={event.sequence}>
                        {installPhaseLabel(event.phase, plan?.imageMode)}:{" "}
                        {statusLabels[event.state] ?? "Обновление состояния"}
                        {event.errorCode ? ` · ${event.errorCode}` : ""}
                      </li>
                    ))}
                  </ol>
                )}
              </details>
            </div>
          )}
          {plan && (
            <PlanContainer
              className={`desktop-ssh-plan${ticket ? " desktop-ssh-saved-plan" : ""}`}
            >
              {ticket ? (
                <summary>Сохранённый план установки</summary>
              ) : (
                <h2>План установки</h2>
              )}
              <dl>
                <div>
                  <dt>Почтовые уведомления</dt>
                  <dd>
                    {plan.options.smtp
                      ? `${plan.options.smtp.from} · ${plan.options.smtp.host}:${plan.options.smtp.port} · ${plan.options.smtp.tlsMode.toUpperCase()}`
                      : "Не настроены"}
                  </dd>
                </div>
                <div>
                  <dt>Сервер</dt>
                  <dd>https://{plan.options.domain}</dd>
                </div>
                <div>
                  <dt>Публичный IPv4</dt>
                  <dd>{plan.options.publicIpv4}</dd>
                </div>
                <div>
                  <dt>Версия MeetSpace</dt>
                  <dd>{plan.version}</dd>
                </div>
                <div>
                  <dt>Источник</dt>
                  <dd>
                    janickiy/meet-space ·{" "}
                    {plan.sourceSelection ?? "зафиксированный исходный код"}
                  </dd>
                </div>
                <div>
                  <dt>Способ установки</dt>
                  <dd>
                    {plan.imageMode === "images"
                      ? "Готовые Docker-образы"
                      : "Сборка из исходного кода"}
                  </dd>
                </div>
                {plan.imageMode === "images" && (
                  <div>
                    <dt>Размер образов</dt>
                    <dd>
                      {plan.imageArchiveBytes === undefined
                        ? "Уточняется"
                        : `${(plan.imageArchiveBytes / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Commit</dt>
                  <dd>
                    <code>{plan.commit}</code>
                  </dd>
                </div>
                <div>
                  <dt>
                    {plan.imageMode === "images"
                      ? "SHA-256 архива образов"
                      : "SHA-256 исходного кода"}
                  </dt>
                  <dd>
                    <code>{plan.imageArchiveSha256 ?? plan.sourceSha256}</code>
                  </dd>
                </div>
                <div>
                  <dt>SHA-256 плана</dt>
                  <dd>
                    <code>{ticket?.planHash ?? plan.hash}</code>
                  </dd>
                </div>
                <div>
                  <dt>Архитектура</dt>
                  <dd>{plan.architecture === "arm64" ? "ARM64" : "x64"}</dd>
                </div>
                <div>
                  <dt>Режим</dt>
                  <dd>
                    {plan.resourceProfile === "compact-test"
                      ? "Компактный · от 2 CPU, 4 ГБ RAM и 18 ГБ диска"
                      : "Стандартный · от 4 CPU, 8 ГБ RAM и 30 ГБ диска"}
                  </dd>
                </div>
                <div>
                  <dt>Docker</dt>
                  <dd>
                    {plan.installDockerPluginsOnly
                      ? `Будут добавлены компоненты: ${plan.missingDockerPlugins.join(", ")}`
                      : plan.installDocker
                        ? "Будет установлен"
                        : "Используем установленный"}
                  </dd>
                </div>
                {!ticket && (
                  <div>
                    <dt>План действует до</dt>
                    <dd>
                      {new Date(plan.expiresAt * 1000).toLocaleTimeString(
                        "ru-RU",
                      )}
                    </dd>
                  </div>
                )}
              </dl>
              {!ticket && (
                <p className="desktop-ssh-note">
                  Установщик подготовит компоненты MeetSpace, базу данных и
                  сертификат HTTPS. Существующие данные сохраняются. Изменения
                  на хосте начнутся только после подтверждения.
                </p>
              )}
              {!ticket && (
                <>
                  {credentialsForm}
                  {plan.options.smtp?.username && (
                    <div className="desktop-ssh-form">
                      <label htmlFor="desktop-smtp-password">
                        Пароль SMTP — {plan.options.smtp.username}
                      </label>
                      <input
                        id="desktop-smtp-password"
                        type="password"
                        maxLength={4096}
                        value={smtpPassword}
                        disabled={disabled}
                        autoComplete="new-password"
                        onChange={(event) =>
                          setSmtpPassword(event.target.value)
                        }
                      />
                      <p className="field-hint">
                        Передаётся на сервер по SSH. В карточке задания и
                        настройках приложения пароль не сохраняется.
                      </p>
                    </div>
                  )}
                  {expired && (
                    <ErrorNotice>
                      Срок плана истёк. Подготовьте новый план и проверьте
                      изменения.
                    </ErrorNotice>
                  )}
                  {needsDockerConsent && (
                    <label className="desktop-ssh-checkbox">
                      <input
                        id="desktop-ssh-docker-consent"
                        type="checkbox"
                        checked={dockerConsent}
                        disabled={disabled}
                        onChange={(event) =>
                          setDockerConsent(event.target.checked)
                        }
                      />
                      <span>
                        Разрешаю{" "}
                        {plan.installDockerPluginsOnly
                          ? "установить недостающие компоненты Docker"
                          : "установить Docker"}{" "}
                        на этом хосте.
                      </span>
                    </label>
                  )}
                  <label className="desktop-ssh-checkbox">
                    <input
                      id="desktop-ssh-acme-consent"
                      type="checkbox"
                      checked={acmeConsent}
                      disabled={disabled}
                      onChange={(event) => setAcmeConsent(event.target.checked)}
                    />
                    <span>
                      Принимаю условия Let's Encrypt для выпуска сертификата
                      HTTPS.
                    </span>
                  </label>
                  <Button
                    className="desktop-ssh-terms"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => {
                      void desktopBridge()
                        .openExternal("https://letsencrypt.org/repository/")
                        .catch(() =>
                          setError(
                            "Не удалось открыть условия. Их можно прочитать по адресу https://letsencrypt.org/repository/.",
                          ),
                        );
                    }}
                  >
                    Прочитать условия Let's Encrypt
                  </Button>
                  <label className="desktop-ssh-checkbox">
                    <input
                      id="desktop-ssh-plan-consent"
                      type="checkbox"
                      checked={planConfirmed}
                      disabled={disabled}
                      onChange={(event) =>
                        setPlanConfirmed(event.target.checked)
                      }
                    />
                    <span>
                      Проверил хост, домен и план. Разрешаю установку этой
                      версии MeetSpace.
                    </span>
                  </label>
                  <div className="desktop-ssh-actions">
                    <Button
                      busy={busy}
                      disabled={
                        disabled ||
                        expired ||
                        !credentialReady ||
                        !planConfirmed ||
                        !acmeConsent ||
                        (!!plan.options.smtp?.username && !smtpPassword) ||
                        (needsDockerConsent && !dockerConsent)
                      }
                      onClick={() =>
                        void act("apply", {
                          confirmedPlanHash: plan.hash,
                          confirmDockerInstall: dockerConsent,
                          acceptAcmeTerms: acmeConsent,
                          credentials: credentials(),
                          smtpPassword,
                        })
                      }
                    >
                      Установить MeetSpace
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={disabled || !credentialReady}
                      onClick={() =>
                        void act("plan", {
                          options: plan.options,
                          credentials: credentials(),
                        })
                      }
                    >
                      Обновить план
                    </Button>
                  </div>
                </>
              )}
            </PlanContainer>
          )}
        </>
      )}
      {(ticket || identity?.trusted) && (
        <RecoveryContainer className="desktop-ssh-recovery">
          {ticket && (
            <summary>Управление локальной карточкой установки</summary>
          )}
          {ticket && (
            <label className="desktop-ssh-checkbox">
              <input
                id="desktop-ssh-forget-consent"
                type="checkbox"
                checked={forgetConfirmed}
                disabled={disabled}
                onChange={(event) => setForgetConfirmed(event.target.checked)}
              />
              <span>
                Удалить локальную карточку задания. Удалённая установка не будет
                остановлена или удалена. Для восстановления потребуется снова
                подключиться к этому хосту и получить план.
              </span>
            </label>
          )}
          <Button
            className="desktop-ssh-reset"
            variant="secondary"
            disabled={disabled || (!!ticket && !forgetConfirmed)}
            onClick={() => {
              clearCredentials();
              setTrustConfirmed(false);
              setResumeConfirmed(false);
              setForgetConfirmed(false);
              void act("forget", { confirm: true }).then((next) => {
                if (next && !next.error && alive.current) {
                  resetWizardForm();
                }
              });
            }}
          >
            {ticket ? "Удалить локальную карточку" : "Выбрать другой хост"}
          </Button>
        </RecoveryContainer>
      )}
      <p className="desktop-ssh-session-note">
        <LockKeyhole size={14} aria-hidden="true" />
        Данные доступа используются только в текущей сессии и удаляются из
        памяти при закрытии мастера.
      </p>
    </section>
  );
}
