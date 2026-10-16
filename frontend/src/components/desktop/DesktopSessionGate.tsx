import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { Server } from "lucide-react";
import { Brand, Button, ErrorNotice, Loading, Modal } from "../ui";
import { configureAuth } from "../../api";
import { platform } from "../../platform";
import { desktopBridge } from "../../platform/desktop";
import type {
  DesktopProbeResult,
  DesktopServerProfile,
  DesktopServerState,
} from "../../platform/desktop-contracts";
import { desktopRoute, setDesktopServer } from "../../platform/urls";
import { saveSession } from "../../utils";
import "./desktop-foundation.css";
import { DesktopScreenPicker } from "./DesktopScreenPicker";
import { AuthTeamVisual } from "../AuthTeamVisual";

const ServerContext = createContext<{
  profile: DesktopServerProfile;
  open: () => void;
} | null>(null);

export function DesktopServerButton({
  className = "",
}: {
  className?: string;
}) {
  const context = useContext(ServerContext);
  if (!context) return null;
  return (
    <button
      type="button"
      className={`button button-secondary desktop-server-button ${className}`}
      onClick={context.open}
      title={context.profile.origin}
    >
      <Server size={18} aria-hidden="true" />
      <span>Сервер: {context.profile.label}</span>
    </button>
  );
}

/** No account providers run before a native-validated HTTPS profile is selected. */
export function DesktopSessionGate({
  children,
}: {
  children: (key: string) => ReactNode;
}) {
  const [state, setState] = useState<DesktopServerState | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const activeKey = useRef("");
  const latestGeneration = useRef(-1);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const location = useLocation();
  const initialPath = useRef(location.pathname + location.search);

  function apply(next: DesktopServerState) {
    if (next.generation < latestGeneration.current) return;
    latestGeneration.current = next.generation;
    const profile =
      next.items.find((item) => item.id === next.selectedId) ?? null;
    const key = profile ? `${profile.id}:${next.generation}` : "";
    if (activeKey.current !== key) {
      configureAuth(null);
      saveSession(null);
      activeKey.current = key;
    }
    setDesktopServer(profile);
    setState(next);
  }

  useEffect(() => {
    let alive = true;
    let offRoute = () => {};
    let offState = () => {};
    setError(false);
    void (async () => {
      await platform.getRuntimeInfo();
      if (!alive) return;
      offRoute = platform.onRoute((route) => {
        initialPath.current = route;
        navigateRef.current(route, { replace: true });
      });
      const bridge = desktopBridge();
      offState = bridge.onTransportEvent((event) => {
        if (alive && event.kind === "servers") apply(event.state);
      });
      const next = await bridge.listServers();
      if (alive) {
        apply(next);
        if (next.selectedId && initialPath.current === "/")
          navigateRef.current("/app", { replace: true });
      }
    })().catch(() => {
      if (alive) setError(true);
    });
    return () => {
      alive = false;
      offRoute();
      offState();
    };
  }, [attempt]);

  const profile = state?.items.find((item) => item.id === state.selectedId);
  const connected = (next: DesktopServerState) => {
    const switching =
      !!state?.selectedId && next.selectedId !== state.selectedId;
    apply(next);
    setEditing(false);
    if (switching || location.pathname === "/")
      navigate("/app", { replace: true });
    else if (!desktopRoute(location.pathname + location.search))
      navigate("/app", { replace: true });
  };
  if (!state || error)
    return (
      <main className="page-center desktop-foundation">
        <section className="content-card desktop-foundation-card">
          <Brand />
          {error ? (
            <>
              <ErrorNotice>
                Не удалось связаться с приложением. Повторите попытку или
                перезапустите MeetSpace.
              </ErrorNotice>
              <Button onClick={() => setAttempt(attempt + 1)}>
                Попробовать снова
              </Button>
            </>
          ) : (
            <Loading />
          )}
        </section>
      </main>
    );
  if (!profile)
    return (
      <ServerSettings state={state} onState={apply} onConnected={connected} />
    );
  return (
    <ServerContext.Provider value={{ profile, open: () => setEditing(true) }}>
      {children(`${profile.id}:${state.generation}`)}
      <DesktopScreenPicker key={`capture:${profile.id}:${state.generation}`} />
      {editing && (
        <Modal title="Подключение к серверу" onClose={() => setEditing(false)}>
          <ServerSettings
            state={state}
            onState={apply}
            onConnected={connected}
            embedded
          />
        </Modal>
      )}
    </ServerContext.Provider>
  );
}

function useSystemTheme(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const previous = {
      theme: root.dataset.theme,
      textSize: root.dataset.textSize,
      largeText: root.dataset.largeText,
    };
    const previousScale = root.style.getPropertyValue("--text-scale");
    const update = () => {
      root.dataset.theme = scheme.matches ? "dark" : "light";
      root.dataset.textSize = "100";
      root.dataset.largeText = "false";
      root.style.setProperty("--text-scale", "1");
    };
    update();
    scheme.addEventListener("change", update);
    return () => {
      scheme.removeEventListener("change", update);
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete root.dataset[key];
        else root.dataset[key] = value;
      }
      if (previousScale) root.style.setProperty("--text-scale", previousScale);
      else root.style.removeProperty("--text-scale");
    };
  }, [enabled]);
}

function connectionMessage(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : "";
  if (code === "INVALID_SERVER" || code === "invalid_server")
    return "Введите адрес сервера с HTTPS без пути, пароля и параметров.";
  if (code === "INCOMPATIBLE_SERVER" || code === "incompatible_server")
    return "На этом адресе не найден совместимый сервер MeetSpace.";
  if (code === "STORAGE_UNAVAILABLE" || code === "storage_unavailable")
    return "Защищённое хранилище недоступно. Перезапустите приложение и повторите попытку.";
  return "Не удалось подключиться. Проверьте адрес, подключение к сети и сертификат сервера.";
}

function ServerSettings({
  state,
  onState,
  onConnected,
  embedded = false,
}: {
  state: DesktopServerState;
  onState: (state: DesktopServerState) => void;
  onConnected: (state: DesktopServerState) => void;
  embedded?: boolean;
}) {
  useSystemTheme(!embedded);
  const selected = state.items.find((item) => item.id === state.selectedId);
  const [origin, setOrigin] = useState(
    selected?.origin ?? "https://meeting.janickiy.com",
  );
  const [label, setLabel] = useState(selected?.label ?? "");
  const [probe, setProbe] = useState<DesktopProbeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (active.current) setError(connectionMessage(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const content = (
    <>
      {!embedded && (
        <>
          <Brand />
          <h1 id="desktop-title">Подключиться к серверу</h1>
          <p className="desktop-foundation-description">
            Укажите адрес вашего MeetSpace. Затем войдите в аккаунт этого
            сервера.
          </p>
        </>
      )}
      {!state.storageAvailable && (
        <ErrorNotice>
          Защищённое хранилище недоступно. Сохранение подключения и вход сейчас
          недоступны.
        </ErrorNotice>
      )}
      {state.items.length > 0 && (
        <div className="desktop-server-list" aria-label="Сохранённые серверы">
          {state.items.map((profile) => (
            <div key={profile.id} className="desktop-server-row">
              <div>
                <strong>{profile.label}</strong>
                <span>{profile.origin}</span>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || profile.id === state.selectedId}
                onClick={() =>
                  void run(async () =>
                    onConnected(await desktopBridge().selectServer(profile.id)),
                  )
                }
              >
                {profile.id === state.selectedId ? "Подключён" : "Подключить"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setOrigin(profile.origin);
                  setLabel(profile.label);
                  setProbe(null);
                  setError("");
                }}
              >
                Изменить
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    onState(await desktopBridge().removeServer(profile.id)),
                  )
                }
              >
                Удалить
              </Button>
            </div>
          ))}
        </div>
      )}
      <form
        className="desktop-server-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const checked = await desktopBridge().probeServer(origin.trim());
            if (active.current) setProbe(checked);
            const saved = await desktopBridge().addServer({
              origin: checked.origin,
              label: label.trim() || undefined,
            });
            const profile = saved.items.find(
              (item) => item.origin === checked.origin,
            );
            if (!profile) throw new Error("server_missing");
            onConnected(await desktopBridge().selectServer(profile.id));
          });
        }}
      >
        <label htmlFor="desktop-server-origin">Адрес сервера</label>
        <input
          id="desktop-server-origin"
          type="url"
          required
          maxLength={2048}
          value={origin}
          disabled={busy}
          placeholder="https://meeting.janickiy.com"
          autoComplete="url"
          spellCheck={false}
          onChange={(event) => {
            setOrigin(event.target.value);
            setProbe(null);
          }}
        />
        <label htmlFor="desktop-server-label">
          Название <span className="muted">(необязательно)</span>
        </label>
        <input
          id="desktop-server-label"
          maxLength={80}
          value={label}
          disabled={busy}
          placeholder="Рабочий сервер"
          onChange={(event) => setLabel(event.target.value)}
        />
        <ErrorNotice>{error || null}</ErrorNotice>
        {probe && <p role="status">Сервер доступен · версия {probe.version}</p>}
        <div className="desktop-server-actions">
          <Button type="submit" busy={busy} disabled={!state.storageAvailable}>
            Подключиться
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await desktopBridge().probeServer(origin.trim());
                if (active.current) setProbe(result);
              })
            }
          >
            Проверить адрес
          </Button>
        </div>
      </form>
      {selected && (
        <p className="desktop-foundation-description">
          При смене сервера текущие звонки и соединения будут закрыты. Аккаунты
          сохраняются отдельно для каждого сервера.
        </p>
      )}
    </>
  );
  return embedded ? (
    <div className="desktop-server-settings">{content}</div>
  ) : (
    <main className="page-center desktop-foundation">
      <aside
        className="desktop-welcome"
        aria-label="Добро пожаловать в MeetSpace"
      >
        <span>ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</span>
        <h2>
          В одной команде.
          <br />
          На одной волне.
        </h2>
        <p>Встречи, чаты и совместная работа — в одном пространстве.</p>
        <AuthTeamVisual />
      </aside>
      <section
        className="content-card desktop-foundation-card"
        aria-labelledby="desktop-title"
      >
        {content}
      </section>
    </main>
  );
}
