import { IconButton } from "./ui";
import { DesktopServerButton } from "./desktop/DesktopSessionGate";
import {
  Moon,
  Sun,
  Maximize2,
  Minimize2,
  ChevronsUpDown,
  CircleHelp,
  MessagesSquare,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { isDesktopBuild } from "../platform/build";
import { HeaderSlots } from "./WorkspaceHeader";
import { useAppearance } from "../appearance";
import { appBuild } from "../buildInfo";
import { useDesktopRuntime, useWorkspaceShortcut } from "../platform/runtime";
import { WorkspaceSearch } from "./WorkspaceSearch";
import { usePersonalRealtime } from "../personalRealtime";
import "../pages/personal.css";
import "./workspace-help.css";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  BarChart3,
  CalendarDays,
  Home,
  Folder,
  Ellipsis,
  Menu,
  CirclePlay,
  Settings,
  ShieldCheck,
  Video,
  X,
} from "lucide-react";
import { useAuth } from "../auth";
import { UserAvatar } from "./UserAvatar";
import { Loading, Modal } from "./ui";
import { NotificationBell } from "./NotificationBell";
import { UnreadMessageCount } from "./UnreadMessageCount";
import { useNotificationStream } from "../notifications";
import { useCapabilities } from "../useCapabilities";
import { BRAND_ASSET_VERSION, PRODUCT_NAME } from "../brand";
import { AccountSettingsModal } from "./AccountSettingsModal";
import { AccountSettingsContext } from "./AccountSettingsContext";
import { DirectCallsProvider } from "./DirectCalls";

/**
 * Layout объединяет навигацию, поиск и личный профиль, не управляя соединениями комнаты.
 * Мобильный drawer удерживает фокус и возвращает его кнопке после закрытия.
 * @return Общая оболочка с лениво загружаемым защищённым маршрутом.
 */
export function Layout() {
  const shortcut = useWorkspaceShortcut();
  const runtime = useDesktopRuntime();
  const appearance = useAppearance();
  const [focused, setFocused] = useState(false);
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const { user } = useAuth();
  useNotificationStream(user?.guestConferenceId ? undefined : user?.id);
  const personal = usePersonalRealtime(
    user?.guestConferenceId ? undefined : user?.id,
  );
  const capabilities = useCapabilities();
  const folders = useQuery({
    queryKey: ["folders", user?.id],
    queryFn: ({ signal }) => api.folders(undefined, signal),
    enabled: !!user && !user.guestConferenceId,
  });
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const bottomButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const showAccountSettings = useCallback((element: HTMLElement) => {
    settingsOpener.current = element;
    setSettingsOpen(true);
  }, []);
  const settingsDialog = settingsOpen && (
    <AccountSettingsModal
      onClose={() => setSettingsOpen(false)}
      returnFocus={() => settingsOpener.current}
    />
  );

  /** Открывает диалог обычным кликом, сохраняя текущую страницу и стандартное открытие ссылок в новой вкладке.
   * @args event — нажатие ссылки настроек в навигации.
   * @return Значение не возвращается; диалог получает фокус, мобильное меню закрывается.
   */
  function openSettings(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    setOpen(false);
    navigate("/app/settings");
  }
  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia("(min-width: 768px)");
    if (desktop.matches) {
      setOpen(false);
      return;
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const resize = () => {
      if (desktop.matches) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not(:disabled)",
        ) || [],
      );
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    desktop.addEventListener("change", resize);
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      desktop.removeEventListener("change", resize);
      document.removeEventListener("keydown", key);
      (opener.current || menuButton.current)?.focus();
    };
  }, [open]);

  if (user?.guestConferenceId)
    return (
      <AccountSettingsContext.Provider value={showAccountSettings}>
        <div className="guest-room-shell" inert={settingsOpen}>
          <a className="skip-link" href="#workspace-main">
            Перейти к встрече
          </a>
          <main id="workspace-main">
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
        {settingsDialog}
      </AccountSettingsContext.Provider>
    );
  const items = [
    ...(!isDesktopBuild
      ? [{ to: "/app", label: "Главная", Icon: Home, end: true }]
      : []),
    { to: "/conferences", label: "Встречи", Icon: Video },
    { to: "/personal", label: "Чаты", Icon: MessagesSquare },
    { to: "/calendar", label: "Календарь", Icon: CalendarDays },
    { to: "/recordings", label: "Записи", Icon: CirclePlay },
    ...(capabilities.isSuccess &&
    !capabilities.isError &&
    capabilities.data.capabilities.meetingAnalytics
      ? [{ to: "/analytics", label: "Аналитика", Icon: BarChart3 }]
      : []),
  ];
  const serviceItems = [
    { to: "/app/settings", label: "Настройки", Icon: Settings },
    ...(user?.isAdmin
      ? [{ to: "/admin", label: "Администрирование", Icon: ShieldCheck }]
      : []),
  ];
  const sectionTitle = location.pathname.startsWith("/recordings/")
    ? "Просмотр записи"
    : ["/recordings", "/app/recordings"].includes(location.pathname)
      ? "Записи встреч"
      : [...items, { to: "/folders", label: "Папки" }, ...serviceItems].find(
          (item) =>
            item.to === "/app"
              ? location.pathname === "/app"
              : location.pathname.startsWith(item.to),
        )?.label ||
        (location.pathname.startsWith("/history")
          ? "Материалы встречи"
          : location.pathname.startsWith("/notifications")
            ? "Уведомления"
            : "Встречи");
  return (
    <AccountSettingsContext.Provider value={showAccountSettings}>
      <DirectCallsProvider>
        {personal.notice && (
          <div className="personal-notice" role="status">
            <Link
              to={`/personal/${personal.notice.id}`}
              onClick={personal.dismiss}
            >
              <strong>{personal.notice.name}</strong>
              <span>{personal.notice.text}</span>
            </Link>
            <button
              className="icon-button"
              aria-label="Закрыть уведомление о сообщении"
              onClick={personal.dismiss}
            >
              <X size={18} />
            </button>
          </div>
        )}
        <HeaderSlots.Provider
          value={{ title: titleSlot, actions: actionsSlot }}
        >
          <div
            className="app-shell desktop-workbench"
            data-desktop={isDesktopBuild || undefined}
            data-focus={focused || undefined}
            inert={settingsOpen || helpOpen}
          >
            <a className="skip-link" href="#workspace-main">
              Перейти к содержимому
            </a>
            <header className="app-chrome desktop-titlebar">
              <Link
                to="/conferences"
                className="desktop-brand"
                aria-label="MeetSpace — встречи"
              >
                <img
                  src="/branding/desktop-brand-mark.svg"
                  width="26"
                  height="29"
                  alt=""
                />
                <strong>{PRODUCT_NAME}</strong>
              </Link>
              <WorkspaceSearch />
              <div className="desktop-title-actions">
                <IconButton
                  label={
                    appearance.resolvedTheme === "dark"
                      ? "Включить светлую тему"
                      : "Включить тёмную тему"
                  }
                  title="Переключить тему"
                  onClick={() =>
                    appearance.setTheme(
                      appearance.resolvedTheme === "dark" ? "light" : "dark",
                    )
                  }
                >
                  {appearance.resolvedTheme === "dark" ? <Sun /> : <Moon />}
                </IconButton>
                <IconButton
                  label="Справка и горячие клавиши"
                  title="Справка и горячие клавиши"
                  onClick={() => setHelpOpen(true)}
                >
                  <CircleHelp />
                </IconButton>
                <IconButton
                  label={
                    focused
                      ? "Вернуть боковое меню"
                      : "Развернуть рабочую область"
                  }
                  title={
                    focused
                      ? "Вернуть боковое меню"
                      : "Развернуть рабочую область"
                  }
                  aria-pressed={focused}
                  onClick={() => setFocused(!focused)}
                >
                  {focused ? <Minimize2 /> : <Maximize2 />}
                </IconButton>
              </div>
            </header>
            <aside
              id="app-sidebar"
              ref={sidebar}
              className={`sidebar ${open ? "sidebar-open" : ""}`}
              role={open ? "dialog" : undefined}
              aria-modal={open || undefined}
              aria-label={open ? `Меню ${PRODUCT_NAME}` : undefined}
            >
              <div className="sidebar-head">
                <button
                  className="icon-button mobile-only"
                  aria-label="Закрыть меню"
                  onClick={() => setOpen(false)}
                >
                  <X />
                </button>
              </div>
              <p className="sidebar-caption">Рабочее пространство</p>
              <nav className="sidebar-nav" aria-label="Основная навигация">
                {items.map(({ to, label, Icon, ...props }) => (
                  <NavLink
                    key={to}
                    aria-label={label}
                    title={label}
                    to={to}
                    {...props}
                    onClick={(event) =>
                      to === "/app/settings"
                        ? openSettings(event)
                        : setOpen(false)
                    }
                    className={({ isActive }) =>
                      isActive ||
                      (isDesktopBuild &&
                        to === "/conferences" &&
                        location.pathname === "/app")
                        ? "nav-item nav-active"
                        : "nav-item"
                    }
                  >
                    <Icon size={22} aria-hidden="true" />
                    <span className="nav-label-text">{label}</span>
                    {to === "/personal" && (
                      <UnreadMessageCount count={personal.unread} />
                    )}
                  </NavLink>
                ))}
              </nav>
              <div className="sidebar-caption sidebar-personal-caption">
                Личное пространство
              </div>
              <nav
                className="sidebar-nav sidebar-folders"
                aria-label="Личное пространство"
              >
                <NavLink
                  to="/folders"
                  aria-label="Папки"
                  title="Папки"
                  end
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    isActive ? "nav-item nav-active" : "nav-item"
                  }
                >
                  <Folder size={22} aria-hidden="true" />
                  <span className="nav-label-text">Папки</span>
                </NavLink>
                {Boolean(folders.data?.items.length) && (
                  <details className="desktop-folder-shortcuts">
                    <summary title="Мои папки" aria-label="Показать мои папки">
                      <ChevronsUpDown size={14} aria-hidden="true" />
                    </summary>
                    {(folders.data?.items || []).slice(0, 3).map((folder) => (
                      <NavLink
                        key={folder.id}
                        to={`/folders/${folder.id}`}
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          isActive ? "nav-item nav-active" : "nav-item"
                        }
                      >
                        <span
                          className="sidebar-folder-dot"
                          aria-hidden="true"
                        />
                        <span className="nav-label-text">{folder.name}</span>
                      </NavLink>
                    ))}
                  </details>
                )}
              </nav>
              <nav
                className="sidebar-nav sidebar-service-nav"
                aria-label="Настройки приложения"
              >
                <button
                  className="nav-item"
                  aria-label="Помощь и сочетания"
                  onClick={() => {
                    setOpen(false);
                    setHelpOpen(true);
                  }}
                >
                  <CircleHelp size={18} aria-hidden="true" />
                  <span className="nav-label-text">Помощь</span>
                </button>
                {serviceItems.map(({ to, label, Icon }) => (
                  <NavLink
                    key={to}
                    aria-label={label}
                    title={label}
                    to={to}
                    onClick={(event) =>
                      to === "/app/settings"
                        ? openSettings(event)
                        : setOpen(false)
                    }
                    className={({ isActive }) =>
                      isActive ? "nav-item nav-active" : "nav-item"
                    }
                  >
                    <Icon size={22} aria-hidden="true" />
                    <span className="nav-label-text">{label}</span>
                  </NavLink>
                ))}
              </nav>
              <div className="sidebar-bottom">
                <button
                  type="button"
                  className="profile profile-button"
                  aria-label="Открыть настройки аккаунта"
                  onClick={() => {
                    setOpen(false);
                    navigate("/app/settings#accounts");
                  }}
                >
                  <UserAvatar
                    id={user?.id}
                    name={user?.displayName || user?.email || ""}
                    version={user?.avatarVersion}
                  />
                  <div>
                    <strong>{user?.displayName || "Мой аккаунт"}</strong>
                    <span>{user?.email}</span>
                  </div>
                  <ChevronsUpDown
                    size={14}
                    className="profile-chevron"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </aside>
            {open && (
              <button
                className="sidebar-shade"
                aria-label="Скрыть меню"
                onClick={() => setOpen(false)}
              />
            )}
            <div className="workspace" inert={open}>
              <header className="workspace-top">
                <button
                  className="icon-button mobile-only"
                  aria-label="Открыть меню"
                  aria-controls="app-sidebar"
                  aria-expanded={open}
                  ref={menuButton}
                  onClick={() => {
                    opener.current = menuButton.current;
                    setOpen(true);
                  }}
                >
                  <Menu aria-hidden="true" />
                </button>
                <h1 className="workspace-page-title">
                  <span ref={setTitleSlot} />
                  <span className="workspace-default-title">
                    {sectionTitle}
                  </span>
                </h1>
                <div className="workspace-account">
                  <div
                    className="workspace-header-actions"
                    ref={setActionsSlot}
                  />
                  <NotificationBell />
                </div>
              </header>
              <main
                id="workspace-main"
                className="workspace-main"
                tabIndex={-1}
              >
                <Suspense fallback={<Loading />}>
                  <Outlet />
                </Suspense>
              </main>
              <nav className="mobile-bottom-nav" aria-label="Быстрая навигация">
                <NavLink to="/app" end aria-label="Главная — быстрая навигация">
                  <Home size={20} />
                  Главная
                </NavLink>
                <NavLink
                  to="/conferences"
                  aria-label="Встречи — быстрая навигация"
                >
                  <Video size={20} />
                  Встречи
                </NavLink>
                <NavLink
                  to="/personal"
                  aria-label={`Чаты — быстрая навигация${personal.unread ? `, непрочитанных: ${personal.unread}` : ""}`}
                >
                  <span className="mobile-nav-message-icon">
                    <MessagesSquare size={20} aria-hidden="true" />
                    <UnreadMessageCount count={personal.unread} />
                  </span>
                  Чаты
                </NavLink>
                <NavLink
                  to="/recordings"
                  aria-label="Записи — быстрая навигация"
                >
                  <CirclePlay size={20} />
                  Записи
                </NavLink>
                <button
                  ref={bottomButton}
                  aria-label="Все разделы"
                  aria-expanded={open}
                  aria-controls="app-sidebar"
                  onClick={() => {
                    opener.current = bottomButton.current;
                    setOpen(true);
                  }}
                >
                  <Ellipsis size={20} />
                  Ещё
                </button>
              </nav>
            </div>
            <footer className="desktop-status">
              <span>
                {isDesktopBuild ? (
                  <DesktopServerButton compact />
                ) : (
                  PRODUCT_NAME
                )}
              </span>
              <span>
                Быстрый переход <kbd>{shortcut.label}</kbd>
              </span>
              <span>
                {PRODUCT_NAME}
                {runtime &&
                  " · " +
                    { darwin: "macOS", linux: "Linux", win32: "Windows" }[
                      runtime.platform
                    ]}{" "}
                · {appBuild.version}
              </span>
            </footer>
          </div>
        </HeaderSlots.Provider>
        {settingsDialog}
        {helpOpen && (
          <Modal
            title="Помощь и сочетания клавиш"
            onClose={() => setHelpOpen(false)}
            className="workspace-help"
          >
            <p>Быстрый доступ к действиям в MeetSpace.</p>
            <dl>
              <div>
                <dt>Поиск в пространстве</dt>
                <dd>
                  <kbd>{shortcut.label}</kbd>
                </dd>
              </div>
              <div>
                <dt>Закрыть диалог</dt>
                <dd>
                  <kbd>Esc</kbd>
                </dd>
              </div>
              <div>
                <dt>Отправить сообщение</dt>
                <dd>
                  <kbd>Enter</kbd>
                </dd>
              </div>
              <div>
                <dt>Новая строка в сообщении</dt>
                <dd>
                  <kbd>Shift Enter</kbd>
                </dd>
              </div>
            </dl>
            <section className="workspace-help-brand" aria-label="О продукте">
              <img
                src={`/branding/meetspace-symbol-color.svg?v=${BRAND_ASSET_VERSION}`}
                width="38"
                height="38"
                alt=""
              />
              <div>
                <strong>{PRODUCT_NAME}</strong>
                <p>Версия {appBuild.version}</p>
              </div>
            </section>
          </Modal>
        )}
      </DirectCallsProvider>
    </AccountSettingsContext.Provider>
  );
}
