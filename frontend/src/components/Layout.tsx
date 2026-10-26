import { DesktopServerButton } from "./desktop/DesktopSessionGate";
import {
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  MessagesSquare,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { isDesktopBuild } from "../platform/build";
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
  Plus,
  Settings,
  ShieldCheck,
  Video,
  X,
} from "lucide-react";
import { useAuth } from "../auth";
import { initials } from "../utils";
import { Brand, Loading, Modal } from "./ui";
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
  const sectionTitle =
    [...items, { to: "/folders", label: "Папки" }, ...serviceItems].find(
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
        <div className="app-shell" inert={settingsOpen || helpOpen}>
          <a className="skip-link" href="#workspace-main">
            Перейти к содержимому
          </a>
          <div className="app-chrome">
            <div className="chrome-context">
              <img
                src={`/branding/meetspace-symbol-color.svg?v=${BRAND_ASSET_VERSION}`}
                alt=""
                width="17"
                height="17"
              />
              <span>{PRODUCT_NAME}</span>
            </div>
            <span className="chrome-workspace">Рабочее пространство</span>
          </div>
          <aside
            id="app-sidebar"
            ref={sidebar}
            className={`sidebar ${open ? "sidebar-open" : ""}`}
            role={open ? "dialog" : undefined}
            aria-modal={open || undefined}
            aria-label={open ? `Меню ${PRODUCT_NAME}` : undefined}
          >
            <div className="sidebar-head">
              <Link
                to="/conferences"
                className="workspace-brand"
                aria-label={`${PRODUCT_NAME} — встречи`}
              >
                <img
                  src={`/branding/meetspace-symbol-color.svg?v=${BRAND_ASSET_VERSION}`}
                  width="30"
                  height="30"
                  alt=""
                />
                <span>{PRODUCT_NAME}</span>
              </Link>
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
              <span>Мои папки</span>
              <Link
                to="/folders"
                aria-label="Управление папками"
                title="Управление папками"
              >
                <Plus size={16} />
              </Link>
            </div>
            <nav
              className="sidebar-nav sidebar-folders"
              aria-label="Личное пространство"
            >
              {(folders.data?.items || []).slice(0, 3).map((folder) => (
                <NavLink
                  key={folder.id}
                  to={`/folders/${folder.id}`}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    isActive ? "nav-item nav-active" : "nav-item"
                  }
                >
                  <span className="sidebar-folder-dot" aria-hidden="true" />
                  <span className="nav-label-text">{folder.name}</span>
                </NavLink>
              ))}
              <NavLink
                to="/folders"
                end
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  isActive ? "nav-item nav-active" : "nav-item"
                }
              >
                <Folder size={22} aria-hidden="true" />
                <span className="nav-label-text">Все папки</span>
              </NavLink>
            </nav>
            <nav
              className="sidebar-nav sidebar-service-nav"
              aria-label="Настройки приложения"
            >
              {serviceItems.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  aria-label={label}
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
              <button
                className="nav-item"
                aria-label="Помощь и сочетания"
                onClick={() => {
                  setOpen(false);
                  setHelpOpen(true);
                }}
              >
                <CircleHelp size={18} aria-hidden="true" />
                <span className="nav-label-text">Помощь и сочетания</span>
              </button>
            </nav>
            {isDesktopBuild && (
              <div className="sidebar-server-status">
                <DesktopServerButton compact />
              </div>
            )}
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
                <span className="avatar">
                  {initials(user?.displayName || user?.email || "")}
                </span>
                <div>
                  <strong>{user?.displayName || "Мой аккаунт"}</strong>
                  <span>Мой аккаунт</span>
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
              <div className="workspace-mobile-brand">
                <Brand to="/app" />
              </div>
              <div className="workspace-context">
                <span>Рабочее пространство</span>
                <ChevronRight size={13} aria-hidden="true" />
                <strong>{sectionTitle}</strong>
              </div>
              <div className="workspace-account">
                <WorkspaceSearch />
                <NotificationBell />
              </div>
            </header>
            <main id="workspace-main" className="workspace-main" tabIndex={-1}>
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
              <NavLink to="/recordings" aria-label="Записи — быстрая навигация">
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
        </div>
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
                  <kbd>Ctrl K</kbd>
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
                <p>
                  Версия {import.meta.env.VITE_BUILD_VERSION || "0.1.10-beta"}
                </p>
              </div>
            </section>
          </Modal>
        )}
      </DirectCallsProvider>
    </AccountSettingsContext.Provider>
  );
}
