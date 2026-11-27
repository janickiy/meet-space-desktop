import { isDesktopBuild } from "../platform/build";
import { useState, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowUpRight,
  CalendarDays,
  UsersRound,
  X,
  Ellipsis,
  RotateCcw,
  Link2,
  Plus,
  MessageCircle,
  DoorOpen,
  Search,
  SlidersHorizontal,
  Video,
} from "lucide-react";
import { useAuth } from "../auth";
import { useConferences } from "../queries";
import { formatDate } from "../utils";
import { Button, ErrorNotice, StatusBadge } from "../components/ui";
import { CreateConference, JoinByLink } from "../components/ConferenceModals";
import { MeetingDetailsModal } from "../components/MeetingDetailsModal";
import { MeetingSkeleton } from "../components/MeetingSkeleton";
import { NewDirectChatModal } from "../components/NewDirectChatModal";
import type { Conference, ConferenceFilters } from "../types";
import { localDayEnd, localSchedule } from "../collaboration";
import "./dashboard.css";
import "./dashboard-home.css";
import "./collections-redesign.css";
import "./dashboard-reference.css";
import {
  CollectionViewToggle,
  type CollectionView,
} from "./CollectionViewToggle";

const participantsPlural = new Intl.PluralRules("ru-RU");
const participantsLabels: Record<string, string> = {
  one: "участник",
  few: "участника",
  many: "участников",
  other: "участника",
};

function localTimeZoneLabel() {
  const zone = (timeZoneName: "shortGeneric" | "shortOffset") =>
    new Intl.DateTimeFormat("ru-RU", { timeZoneName })
      .formatToParts()
      .find((part) => part.type === "timeZoneName")
      ?.value.replace("GMT", "UTC");
  return [...new Set([zone("shortGeneric"), zone("shortOffset")])]
    .filter(Boolean)
    .join(" · ");
}

const views: { id: NonNullable<ConferenceFilters["view"]>; label: string }[] = [
  { id: "upcoming", label: "Предстоящие" },
  { id: "active", label: "Активные" },
  { id: "past", label: "Завершённые" },
];

/** Открытие комнаты и сведения о встрече разделены, как в макете. */
function MeetingRow({ conference }: { conference: Conference }) {
  const { user } = useAuth();
  const [details, setDetails] = useState(false);
  const past = ["finished", "cancelled"].includes(conference.status);
  const timestamp =
    conference.finishedAt ||
    conference.startedAt ||
    conference.scheduledAt ||
    conference.createdAt;
  const date = new Date(timestamp);
  const target = past
    ? `/history/${conference.id}`
    : `/meetings/${conference.id}`;
  const content = (
    <>
      <span className="dashboard-meeting-time" aria-hidden="true">
        <strong>
          {conference.status !== "created" &&
          Number.isFinite(date.getTime()) ? (
            date.toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })
          ) : (
            <Video size={23} aria-hidden="true" />
          )}
        </strong>
        <small>
          {conference.status === "created"
            ? "Без даты"
            : Number.isFinite(date.getTime())
              ? date.toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "long",
                })
              : ""}
        </small>
      </span>
      <span className="conference-row-copy">
        <StatusBadge status={conference.status} />
        <strong className="dashboard-meeting-title">{conference.title}</strong>
        <span className="dashboard-meeting-meta">
          {conference.plannedDurationMin ? (
            <span>{conference.plannedDurationMin} мин · </span>
          ) : null}
          <span>
            {conference.ownerId === user?.id ? "Вы организатор" : "Вы участник"}
          </span>
          {conference.participantCount !== undefined && (
            <span className="meeting-attendees">
              <UsersRound size={13} aria-hidden="true" />
              {conference.participantCount}{" "}
              {
                participantsLabels[
                  participantsPlural.select(conference.participantCount)
                ]
              }
            </span>
          )}
          <span className="sr-only"> · {formatDate(timestamp)}</span>
        </span>
      </span>
    </>
  );
  return (
    <>
      <article
        className={`conference-row dashboard-meeting-row ${conference.status === "active" ? "dashboard-meeting-active" : ""}`}
      >
        {past ? (
          <button
            className="dashboard-meeting-open"
            type="button"
            onClick={() => setDetails(true)}
            aria-label={`Подробнее о завершённой встрече: ${conference.title}`}
            aria-haspopup="dialog"
          >
            {content}
          </button>
        ) : (
          <Link
            className="dashboard-meeting-open"
            to={target}
            aria-label={`Открыть встречу: ${conference.title}`}
          >
            {content}
          </Link>
        )}
        <div className="dashboard-meeting-action">
          <button
            className="icon-button meeting-info-trigger"
            type="button"
            onClick={() => setDetails(true)}
            aria-label={`Подробнее: ${conference.title}`}
            aria-haspopup="dialog"
          >
            <Ellipsis size={19} aria-hidden="true" />
          </button>
        </div>
      </article>
      {details && (
        <MeetingDetailsModal
          conference={conference}
          onClose={() => setDetails(false)}
        />
      )}
    </>
  );
}

/**
 * Dashboard разделяет главную с действиями и полный список встреч.
 * @args all — показывать полный список и фильтры; create — открыть форму создания поверх страницы.
 * @return Адаптивный кабинет со статусами загрузки, ошибки, пустого списка и пагинации.
 */
export function Dashboard({
  all = false,
  create = false,
}: {
  all?: boolean;
  create?: boolean;
}) {
  return all || isDesktopBuild ? (
    <ConferenceDashboard create={create} />
  ) : (
    <HomeDashboard create={create} />
  );
}

function ConferenceDashboard({ create = false }: { create?: boolean }) {
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [layout, setLayout] = useState<CollectionView>("list");
  const tab: NonNullable<ConferenceFilters["view"]> =
    params.get("view") === "active"
      ? "active"
      : params.get("view") === "past"
        ? "past"
        : "upcoming";
  const [scope, setScope] =
    useState<NonNullable<ConferenceFilters["scope"]>>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useConferences({
    view: tab,
    scope,
    from: from ? localSchedule(`${from}T00:00`) || undefined : undefined,
    to: to ? localDayEnd(to) || undefined : undefined,
  });
  const search = params.get("search") || "";
  const setSearch = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set("search", value);
        else next.delete("search");
        return next;
      },
      { replace: true },
    );
  const [filtersOpen, setFiltersOpen] = useState(false);

  /** @args view — серверная категория встреч. Сохраняет прочие параметры маршрута. */
  function selectView(view: NonNullable<ConferenceFilters["view"]>) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", view);
      return next;
    });
  }

  /** @args event — клавиатурное событие вкладки. Реализует стрелки, Home и End по шаблону ARIA. */
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const current = views.findIndex(
      (view) => view.id === event.currentTarget.dataset.view,
    );
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % views.length;
    else if (event.key === "ArrowLeft")
      next = (current - 1 + views.length) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    else return;
    event.preventDefault();
    selectView(views[next].id);
    document.getElementById(`tab-${views[next].id}`)?.focus();
  }

  const conferences = query.data?.pages.flatMap((page) => page.items) || [];
  const visible = conferences.filter((item) =>
    item.title.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")),
  );
  return (
    <div className="meetings-reference-page">
      {!isDesktopBuild && <h1>Встречи</h1>}
      <div
        className="meetings-quick-actions"
        aria-label="Действия со встречами"
      >
        <button
          type="button"
          className="meetings-quick-action meetings-quick-primary"
          onClick={() => setCreating(true)}
        >
          <span className="meetings-quick-symbol">
            <Video size={22} aria-hidden="true" />
          </span>
          <span>
            <strong>Новая встреча</strong>
            <small>Начать разговор сейчас</small>
          </span>
        </button>
        <Link className="meetings-quick-action" to="/meetings/new?scheduled=1">
          <span className="meetings-quick-symbol">
            <CalendarDays size={25} aria-hidden="true" />
          </span>
          <span>
            <strong>
              Запланировать
              <span className="meeting-desktop-word"> встречу</span>
            </strong>
            <small>Выбрать дату и время</small>
          </span>
        </Link>
        <button
          type="button"
          className="meetings-quick-action meetings-join-action"
          onClick={() => setJoining(true)}
        >
          <span className="meetings-quick-symbol">
            <Link2 size={22} aria-hidden="true" />
          </span>
          <span>Подключиться по ссылке</span>
        </button>
      </div>
      <section aria-label="Список встреч">
        <div className="meetings-section-heading">
          <h2>Мои встречи</h2>
          <span className="meeting-list-zone">{localTimeZoneLabel()}</span>
        </div>
        <div className="list-toolbar">
          <div className="tabs" role="tablist" aria-label="Статус конференций">
            {views.map((item) => (
              <button
                key={item.id}
                id={`tab-${item.id}`}
                data-view={item.id}
                className={tab === item.id ? "tab tab-active" : "tab"}
                role="tab"
                aria-selected={tab === item.id}
                aria-controls="conference-list"
                tabIndex={tab === item.id ? 0 : -1}
                onKeyDown={onTabKeyDown}
                onClick={() => selectView(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="dashboard-search-row">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label="Поиск конференции по названию"
                id="meeting-search"
                type="search"
                placeholder="Найти встречу"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {search && (
              <button
                type="button"
                className="meeting-search-clear"
                aria-label="Очистить поиск"
                onClick={() => {
                  setSearch("");
                  document.getElementById("meeting-search")?.focus();
                }}
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
            <Button
              variant="outline"
              className="dashboard-mobile-filter"
              aria-label="Фильтры встреч"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <SlidersHorizontal size={18} />
              Фильтры
            </Button>
          </div>
        </div>
        <div
          className={`conference-filters ${filtersOpen ? "conference-filters-open" : ""}`}
        >
          <label className="field">
            <span>Моё участие</span>
            <select
              aria-label="Моё участие"
              value={scope}
              onChange={(event) =>
                setScope(
                  event.target.value as NonNullable<ConferenceFilters["scope"]>,
                )
              }
            >
              <option value="all">Все мои встречи</option>
              <option value="owned">Я организатор</option>
              <option value="participating">Я участник</option>
            </select>
          </label>
          <label className="field">
            <span>С даты</span>
            <input
              type="date"
              aria-label="Встречи с даты"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="field">
            <span>По дату</span>
            <input
              type="date"
              aria-label="Встречи по дату"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            aria-label="Сбросить фильтры"
            title="Сбросить фильтры"
            onClick={() => {
              setFrom("");
              setTo("");
              setSearch("");
              setScope("all");
            }}
          >
            <RotateCcw size={18} aria-hidden="true" />
          </Button>
        </div>
        <p className="meeting-list-caption">
          {tab === "upcoming"
            ? "Предстоящие и без даты"
            : tab === "active"
              ? "Встречи в эфире"
              : "Завершённые и отменённые"}
          {query.isSuccess && (
            <>
              {" "}
              · {visible.length}
              {query.hasNextPage ? "+" : ""}
            </>
          )}
        </p>
        <ErrorNotice error={query.error} />
        {query.isError && (
          <Button variant="outline" onClick={() => void query.refetch()}>
            Попробовать снова
          </Button>
        )}
        <div
          id="conference-list"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          tabIndex={0}
        >
          {query.isPending ? (
            <MeetingSkeleton rows={4} />
          ) : visible.length ? (
            <div className={`conference-list meeting-layout-${layout}`}>
              {visible.map((meeting) => (
                <MeetingRow key={meeting.id} conference={meeting} />
              ))}
            </div>
          ) : (
            !query.isError && (
              <div className="empty-state">
                <span className="empty-icon">
                  <CalendarDays size={29} aria-hidden="true" />
                </span>
                <h3>
                  {search
                    ? "Встречи не найдены"
                    : tab === "upcoming"
                      ? "Самое время для первой встречи"
                      : tab === "active"
                        ? "Сейчас нет активных встреч"
                        : "Здесь будет история встреч"}
                </h3>
                <p>
                  {search
                    ? "Поиск работает по загруженным встречам. Попробуйте другое название или загрузите ещё."
                    : tab === "upcoming"
                      ? "Создайте конференцию и пригласите коллег по ссылке."
                      : "Конференции появятся здесь, когда изменится их статус."}
                </p>
                {tab === "upcoming" && !search && (
                  <button
                    type="button"
                    className="text-button text-link"
                    onClick={() => setCreating(true)}
                  >
                    <Plus size={16} aria-hidden="true" />
                    Создать конференцию
                  </button>
                )}
              </div>
            )
          )}
        </div>
        {visible.length > 0 && (
          <div className="meeting-view-options">
            <CollectionViewToggle
              value={layout}
              onChange={setLayout}
              label="Вид списка встреч"
            />
          </div>
        )}
        {query.hasNextPage && (
          <Button
            variant="outline"
            busy={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Загрузить ещё встречи
          </Button>
        )}
      </section>
      {create ? (
        <CreateConference />
      ) : (
        creating && <CreateConference onClose={() => setCreating(false)} />
      )}
      {joining && <JoinByLink onClose={() => setJoining(false)} />}
    </div>
  );
}

/** Главная содержит только лозунг и быстрые действия; списки встреч загружаются в их разделе. */
function HomeDashboard({ create = false }: { create?: boolean }) {
  const [joining, setJoining] = useState(false);
  const [newChat, setNewChat] = useState(false);
  return (
    <div className="dashboard-page dashboard-home">
      <section className="home-launchpad" aria-labelledby="home-slogan">
        <div className="home-intro">
          <h1 id="home-slogan">MeetSpace - чаты и видео звонки</h1>
        </div>
        <div className="home-action-grid" aria-label="Быстрые действия">
          <Link className="home-action-card" to="/conferences/new">
            <Video size={30} strokeWidth={1.7} aria-hidden="true" />
            <span>
              <strong>Новая встреча</strong>
              <small>Соберите команду и начните разговор</small>
            </span>
            <ArrowUpRight size={20} aria-hidden="true" />
          </Link>
          <button
            type="button"
            className="home-action-card"
            onClick={() => setNewChat(true)}
          >
            <MessageCircle size={30} strokeWidth={1.7} aria-hidden="true" />
            <span>
              <strong>Новый чат</strong>
              <small>Напишите коллеге личное сообщение</small>
            </span>
            <ArrowUpRight size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="home-action-card"
            onClick={() => setJoining(true)}
          >
            <DoorOpen size={30} strokeWidth={1.7} aria-hidden="true" />
            <span>
              <strong>Подключиться по ссылке</strong>
              <small>Присоединитесь к встрече по приглашению</small>
            </span>
            <ArrowUpRight size={20} aria-hidden="true" />
          </button>
          <Link className="home-action-card" to="/meetings/new?scheduled=1">
            <CalendarDays size={30} strokeWidth={1.7} aria-hidden="true" />
            <span>
              <strong>Запланировать встречу</strong>
              <small>Выберите удобное время для всех</small>
            </span>
            <ArrowUpRight size={20} aria-hidden="true" />
          </Link>
        </div>
      </section>
      {create && <CreateConference />}
      {joining && <JoinByLink onClose={() => setJoining(false)} />}
      {newChat && <NewDirectChatModal onClose={() => setNewChat(false)} />}
    </div>
  );
}
