import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, KeyRound, Server, ShieldCheck } from "lucide-react";
import { desktopBridge } from "../../platform/desktop";
import type {
  SshInstallerAction,
  SshInstallerCredentials,
  SshInstallerState,
} from "../../platform/desktop-contracts";
import { Button, ErrorNotice, Loading } from "../ui";
import "./desktop-ssh-installer.css";

const phases = [
  ["docker", "Подготовка Docker"],
  ["source", "Проверка исходного кода"],
  ["images", "Сборка компонентов"],
  ["configuration", "Настройка сервера"],
  ["dependencies", "Запуск базы данных"],
  ["backup", "Резервная копия"],
  ["migrations", "Подготовка базы данных"],
  ["https", "Сертификат HTTPS"],
  ["services", "Запуск MeetSpace"],
  ["readiness", "Проверка готовности"],
] as const;

function phaseGroup(phase: string): string {
  return phase.split(":", 1)[0];
}

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
}: {
  onBack: () => void;
  onConnect: (origin: string) => Promise<void>;
  canConnect: boolean;
}) {
  const [state, setState] = useState<SshInstallerState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("root");
  const [domain, setDomain] = useState("");
  const [publicIpv4, setPublicIpv4] = useState("");
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
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const clearCredentials = () => {
    setPassword("");
    setPrivateKey("");
    setPassphrase("");
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
    if (next.plan?.options.publicIpv4)
      setPublicIpv4(next.plan.options.publicIpv4);
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
        setBusy(false);
      }
    }
  };
  const actionRef = useRef(act);
  actionRef.current = act;

  useEffect(() => {
    if (
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
  }, [state, busy, error]);

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
  const disabled = busy || !!state?.busy;
  const identity = state?.identity;
  const plan = state?.plan;
  const ticket = state?.ticket;
  const status = state?.status;
  const expired = !!plan && plan.expiresAt * 1000 <= now;
  const needsDockerConsent =
    !!plan && (plan.installDocker || plan.installDockerPluginsOnly);
  const currentStep = !identity?.trusted ? 0 : ticket ? 3 : plan ? 2 : 1;
  const observedEndpointMatches =
    state?.endpoint?.host === host.trim() &&
    state.endpoint.port === Number(port) &&
    state.endpoint.user === user.trim();

  const credentialsForm = !state?.hasCredentials && (
    <fieldset className="desktop-ssh-auth" disabled={disabled}>
      <legend>Доступ по SSH</legend>
      <label htmlFor="desktop-ssh-auth-kind">Способ входа</label>
      <select
        id="desktop-ssh-auth-kind"
        value={authKind}
        onChange={(event) => {
          setAuthKind(event.target.value as "password" | "privateKey");
          clearCredentials();
        }}
      >
        <option value="password">Пароль</option>
        <option value="privateKey">Приватный ключ</option>
      </select>
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
    >
      <Button
        type="button"
        variant="secondary"
        className="desktop-ssh-back"
        onClick={onBack}
      >
        <ArrowLeft size={16} aria-hidden="true" />К подключению к серверу
      </Button>
      <div className="desktop-ssh-title-icon" aria-hidden="true">
        <Server size={24} />
      </div>
      <h1 id="desktop-ssh-title" ref={heading} tabIndex={-1}>
        Установить сервер по SSH
      </h1>
      <p className="desktop-foundation-description">
        Настроим MeetSpace на вашем Linux-хосте: проверим доступ, подготовим
        план и запустим установку после вашего подтверждения.
      </p>
      <ol className="desktop-ssh-steps" aria-label="Этапы установки">
        {["Хост", "Проверка", "План", "Установка"].map((label, index) => (
          <li
            key={label}
            aria-current={index === currentStep ? "step" : undefined}
            className={index < currentStep ? "is-complete" : ""}
          >
            <span aria-hidden="true">
              {index < currentStep ? <Check size={12} /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
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
      {state && !identity?.trusted && (
        <>
          {ticket && (
            <p className="desktop-ssh-note">
              Сохранена установка для <strong>{ticket.domain}</strong>.
              Подтвердите подключение к тому же хосту, чтобы продолжить.
            </p>
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
              Ubuntu 22.04 / 24.04, root или sudo без пароля. Пароль и ключ ещё
              не передаются.
            </p>
            <Button type="submit" busy={busy} disabled={disabled}>
              Проверить ключ хоста
            </Button>
          </form>
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
              className="desktop-ssh-form"
              onSubmit={(event) => {
                event.preventDefault();
                void act("preflight", {
                  domain: domain.trim(),
                  credentials: credentials(),
                });
              }}
            >
              <label htmlFor="desktop-ssh-domain">
                Домен будущего MeetSpace
              </label>
              <input
                id="desktop-ssh-domain"
                required
                maxLength={253}
                value={domain}
                disabled={disabled}
                placeholder="meet.example.com"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setDomain(event.target.value)}
              />
              <label htmlFor="desktop-ssh-public-ip">
                Публичный IPv4 хоста
              </label>
              <input
                id="desktop-ssh-public-ip"
                required
                maxLength={15}
                value={publicIpv4}
                disabled={disabled}
                placeholder="203.0.113.10"
                autoComplete="off"
                inputMode="decimal"
                onChange={(event) => setPublicIpv4(event.target.value)}
              />
              <p className="field-hint">
                A-запись домена должна вести прямо на этот IPv4. Для сертификата
                HTTPS нужны доступные порты 80 и 443.
              </p>
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
                disabled={disabled || !credentialReady}
              >
                Проверить готовность хоста
              </Button>
            </form>
          )}
          {state?.preflight && !ticket && (
            <div className="desktop-ssh-preflight">
              <h2>Проверка хоста</h2>
              <ul className="desktop-ssh-checks">
                {state.preflight.checks.map((check) => (
                  <li key={check.id} data-level={check.level}>
                    <div>
                      <strong>{check.title}</strong>
                      <span>{checkLabels[check.level]}</span>
                    </div>
                    <p>{check.detail}</p>
                  </li>
                ))}
              </ul>
              {!plan && (
                <Button
                  disabled={
                    disabled ||
                    !state.preflight.ready ||
                    state.preflight.domain !== domain.trim().toLowerCase() ||
                    !credentialReady ||
                    !publicIpv4.trim()
                  }
                  onClick={() =>
                    void act("plan", {
                      options: {
                        domain: domain.trim(),
                        publicIpv4: publicIpv4.trim(),
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
          {plan && (
            <div className="desktop-ssh-plan">
              <h2>{ticket ? "Сохранённый план" : "План установки"}</h2>
              <dl>
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
                  <dt>Commit</dt>
                  <dd>
                    <code>{plan.commit}</code>
                  </dd>
                </div>
                <div>
                  <dt>SHA-256 исходного кода</dt>
                  <dd>
                    <code>{plan.sourceSha256}</code>
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
              <p className="desktop-ssh-note">
                Установщик подготовит компоненты MeetSpace, базу данных и
                сертификат HTTPS. Существующие данные сохраняются. Изменения на
                хосте начнутся только после подтверждения.
              </p>
              {!ticket && (
                <>
                  {credentialsForm}
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
                        (needsDockerConsent && !dockerConsent)
                      }
                      onClick={() =>
                        void act("apply", {
                          confirmedPlanHash: plan.hash,
                          confirmDockerInstall: dockerConsent,
                          acceptAcmeTerms: acmeConsent,
                          credentials: credentials(),
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
            </div>
          )}
          {ticket && (
            <div className="desktop-ssh-progress">
              <h2 role="status" aria-live="polite">
                {status
                  ? statusLabels[status.state]
                  : "Проверим состояние установки"}
              </h2>
              <p className="field-hint">
                Установка выполняется на хосте и продолжится при закрытии
                приложения. Для следующего подключения понадобится снова ввести
                данные SSH.
              </p>
              {status?.state !== "completed" && credentialsForm}
              {!canConnect && status?.state === "completed" && (
                <ErrorNotice>
                  Защищённое хранилище недоступно. Перезапустите приложение,
                  затем подключитесь к установленному серверу.
                </ErrorNotice>
              )}
              {status && (
                <ol className="desktop-ssh-phases">
                  {phases.map(([id, label]) => (
                    <li
                      key={id}
                      className={
                        status.completedPhases.includes(id)
                          ? "is-complete"
                          : phaseGroup(status.phase) === id
                            ? "is-current"
                            : ""
                      }
                    >
                      <span aria-hidden="true">
                        {status.completedPhases.includes(id) ? (
                          <Check size={14} />
                        ) : (
                          ""
                        )}
                      </span>
                      {label}
                      {phaseGroup(status.phase) === id &&
                        status.state === "running" && (
                          <small>Выполняется</small>
                        )}
                    </li>
                  ))}
                </ol>
              )}
              {status?.errorCode && (
                <ErrorNotice>
                  Установщик остановился на этапе «
                  {phases.find(
                    ([id]) => id === phaseGroup(status.phase),
                  )?.[1] ?? "подготовка"}
                  ». Код: {status.errorCode}. Исправьте причину на хосте, затем
                  проверьте состояние.
                </ErrorNotice>
              )}
              {status?.state === "completed" && (
                <p className="desktop-ssh-note">
                  Сервер доступен по адресу{" "}
                  <strong>https://{ticket.domain}</strong>. Подключитесь и
                  войдите в аккаунт MeetSpace.
                </p>
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
                        .catch(() => {
                          if (alive.current)
                            setError(
                              "Сервер установлен, но HTTPS-подключение ещё недоступно. Проверьте DNS и сертификат, затем повторите попытку.",
                            );
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
                        {phases.find(
                          ([id]) => id === phaseGroup(event.phase),
                        )?.[1] ?? "Подготовка"}
                        : {statusLabels[event.state] ?? "Обновление состояния"}
                        {event.errorCode ? ` · ${event.errorCode}` : ""}
                      </li>
                    ))}
                  </ol>
                )}
              </details>
            </div>
          )}
        </>
      )}
      {(ticket || identity?.trusted) && (
        <div className="desktop-ssh-recovery">
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
                  setDomain("");
                  setPublicIpv4("");
                }
              });
            }}
          >
            {ticket ? "Удалить локальную карточку" : "Выбрать другой хост"}
          </Button>
        </div>
      )}
    </section>
  );
}
