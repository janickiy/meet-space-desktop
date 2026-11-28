import { useState } from "react";
import { Link } from "react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Circle,
  CirclePlay,
  FolderOpen,
  Info,
  Mic,
  Play,
  Search,
  UserRound,
  Users,
  Video,
} from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { isDesktopBuild } from "../platform/build";
import { initials } from "../utils";
import type {
  Conference,
  ConferenceHistory,
  ConferenceRecording,
} from "../types";
import { Button, ErrorNotice, Loading } from "../components/ui";
import { RecordingActions } from "../components/RecordingActions";
import {
  formatRecordingDuration,
  formatRecordingSize,
  recordingDate,
  recordingDetailPath,
  recordingHasMediaOrTracks,
  recordingMediaFile,
  recordingPreviewFile,
  recordingTracksFile,
} from "../recordingPresentation";
import "./recordings.css";
import "./collections-redesign.css";
import {
  CollectionViewToggle,
  type CollectionView,
} from "./CollectionViewToggle";

import {
  loadRecordingLibraryPage,
  type RecordingLibraryCursor,
} from "../recordingLibrary";
import "./recording-library-reference.css";

const modeLabels = {
  audio_only: "Аудиозапись",
  composite: "Видеозапись",
  screen_focus: "Видеозапись",
  individual_tracks: "Дорожки участников",
} as const;

const recordingParticipants = new Intl.PluralRules("ru-RU");
const participantLabels: Record<string, string> = {
  one: "участник",
  few: "участника",
  many: "участников",
  other: "участника",
};
const recordingDay = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
});
const recordingTime = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});
const waveHeights = Array.from(
  { length: 25 },
  (_, index) => 32 + ((index * 17) % 66),
);

function RecordingWave() {
  return (
    <span className="recordings-thumbnail-wave" aria-hidden="true">
      {waveHeights.map((height, index) => (
        <i key={index} style={{ height: `${height}%` }} />
      ))}
    </span>
  );
}

const recordingProgress: Partial<
  Record<ConferenceRecording["status"], string>
> = {
  starting: "Подготовка записи",
  recording: "Идёт запись",
  degraded: "Идёт запись с ограничениями",
  stopping: "Завершение записи",
  processing: "Запись обрабатывается",
};

/** RecordingCard показывает доступную запись или её текущее состояние.
 * @args record — запись; conference — встреча; history — доступная историческая сводка.
 * @return компактная строка с превью, метаданными и поддерживаемыми действиями.
 */
export function RecordingCard({
  record,
  conference,
  history,
}: {
  record: ConferenceRecording;
  conference: Conference;
  history?: ConferenceHistory;
}) {
  const { user } = useAuth();
  const [brokenPreview, setBrokenPreview] = useState<string | null>(null);
  const preview = recordingPreviewFile(record)?.url;
  const path = recordingDetailPath(conference.id, record.uuid);
  const hasPreview = !!preview && brokenPreview !== preview;
  const audioOnly = record.mode === "audio_only";
  const tracks = record.mode === "individual_tracks";
  const progress = recordingProgress[record.status];
  const ModeIcon = tracks ? Users : audioOnly ? Mic : Video;
  const CoverIcon = progress ? Circle : ModeIcon;
  const watchAction = tracks ? "Материалы" : audioOnly ? "Слушать" : "Смотреть";
  const file = tracks
    ? (recordingTracksFile(record) ?? recordingMediaFile(record))
    : recordingMediaFile(record);
  const startedAt = [record.startedAt, record.createdAt].find(
    (date) => date && Number.isFinite(Date.parse(date)),
  );
  const timestamp = startedAt ? new Date(startedAt) : undefined;
  const count = history?.participantCount ?? conference.participantCount;
  const participants =
    typeof count === "number"
      ? `${count} ${participantLabels[recordingParticipants.select(count)]}`
      : file?.sizeBytes !== undefined
        ? formatRecordingSize(file.sizeBytes)
        : undefined;
  const organizer = history?.owner;
  const ownMeeting = (organizer?.id ?? conference.ownerId) === user?.id;
  const owner = organizer?.displayName
    ? organizer.displayName + (ownMeeting ? " (вы)" : "")
    : ownMeeting
      ? "Вы"
      : undefined;
  const names =
    history?.participants?.map((person) => person.displayName) ?? [];
  const thumbnailClass = [
    "recordings-thumbnail",
    !hasPreview && "recordings-thumbnail-placeholder",
    audioOnly && "recordings-thumbnail-audio",
    tracks && "recordings-thumbnail-tracks",
  ]
    .filter(Boolean)
    .join(" ");
  const cover = (
    <>
      {hasPreview ? (
        <img
          src={preview}
          alt=""
          loading="lazy"
          onError={() => setBrokenPreview(preview)}
        />
      ) : audioOnly ? (
        <RecordingWave />
      ) : tracks ? (
        <span className="recordings-thumbnail-tracks-art" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <span className="recordings-thumbnail-track" key={row}>
              <span>
                {names[row] ? initials(names[row]) : <UserRound size={9} />}
              </span>
              <RecordingWave />
            </span>
          ))}
        </span>
      ) : (
        <span className="recordings-thumbnail-tiles" aria-hidden="true">
          {[0, 1, 2, 3].map((tile) => (
            <i key={tile}>
              <b>
                {names[tile] ? initials(names[tile]) : <UserRound size={11} />}
              </b>
            </i>
          ))}
        </span>
      )}
      <span className="recordings-thumbnail-play" aria-hidden="true">
        <CoverIcon size={19} />
      </span>
      {progress ? (
        <span className="recordings-thumbnail-duration recordings-thumbnail-live">
          В эфире
        </span>
      ) : record.durationSec !== undefined ? (
        <span className="recordings-thumbnail-duration">
          {formatRecordingDuration(record.durationSec)}
        </span>
      ) : null}
    </>
  );
  return (
    <article className="recordings-row" data-testid="recordings-row">
      {progress ? (
        <div className={thumbnailClass}>{cover}</div>
      ) : (
        <Link
          to={path}
          className={thumbnailClass}
          aria-label={`Открыть запись: ${conference.title}`}
        >
          {cover}
        </Link>
      )}
      <div className="recordings-row-info">
        <span className="recordings-kind">
          <ModeIcon size={13} aria-hidden="true" />
          {modeLabels[record.mode]}
          {progress && ` · ${progress}`}
        </span>
        {progress ? (
          <strong className="recordings-row-title">{conference.title}</strong>
        ) : (
          <Link to={path} className="recordings-row-title">
            {conference.title}
          </Link>
        )}
        <p className="recordings-meta">
          {timestamp ? (
            <time dateTime={startedAt} title={recordingDate(record)}>
              {recordingDay.format(timestamp)} ·{" "}
              {recordingTime.format(timestamp)}
            </time>
          ) : (
            "Дата не указана"
          )}
          {participants && <> · {participants}</>}
        </p>
        {owner && <p className="recordings-row-owner">Организатор: {owner}</p>}
      </div>
      <div className="recordings-row-actions">
        {progress ? (
          <span className="recordings-progress">В эфире</span>
        ) : (
          <>
            <Link
              to={path}
              className="button button-outline recordings-watch"
              aria-label={`${watchAction}: ${conference.title}`}
            >
              {tracks ? (
                <FolderOpen size={17} aria-hidden="true" />
              ) : (
                <Play size={17} aria-hidden="true" />
              )}
              <span>{watchAction}</span>
            </Link>
            <RecordingActions
              title={conference.title}
              path={path}
              downloadUrl={file?.url}
              asset={
                file?.uuid
                  ? {
                      kind: "recording",
                      conferenceId: conference.id,
                      recordingId: record.uuid,
                      fileId: file.uuid,
                    }
                  : undefined
              }
            />
          </>
        )}
      </div>
    </article>
  );
}

/** A flat catalogue using the same cards, toolbar and empty state as decs_maket. */
export function RecordingsPage() {
  const { user } = useAuth();
  const [view, setView] = useState<"past" | "active">("past");
  const [meeting, setMeeting] = useState("");
  const [days, setDays] = useState("");
  const [sort, setSort] = useState("newest");
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState<CollectionView>("list");
  const library = useInfiniteQuery({
    queryKey: ["recording-library", user?.id, view],
    refetchInterval: view === "active" ? 15000 : false,
    enabled: !!user,
    initialPageParam: { pending: [] } as RecordingLibraryCursor,
    queryFn: ({ pageParam, signal }) =>
      loadRecordingLibraryPage(
        {
          conferences: (cursor, signal) =>
            api.myConferences({ view }, cursor, signal),
          recordings: (id, offset, signal) =>
            api.recordings(id, signal, { limit: 20, offset }),
          history: (id, signal) => api.history(id, signal),
        },
        pageParam,
        signal,
      ),
    getNextPageParam: (page) => page.next,
    retry: false,
  });
  const entries = [
    ...new Map(
      (library.data?.pages.flatMap((page) => page.entries) || []).map(
        (entry) => [`${entry.conference.id}/${entry.record.uuid}`, entry],
      ),
    ).values(),
  ];
  const catalogue = entries.filter(
    ({ record, conference }) =>
      (view === "past" || conference.status === "active") &&
      (record.status === "ready"
        ? recordingHasMediaOrTracks(record)
        : view === "active" && !!recordingProgress[record.status]),
  );
  const meetings = new Map(
    catalogue.map(({ conference }) => [conference.id, conference.title]),
  );
  const term = search.trim().toLocaleLowerCase("ru-RU");
  const since = new Date();
  since.setDate(since.getDate() - Number(days));
  since.setHours(0, 0, 0, 0);
  const timestamp = (r: ConferenceRecording) =>
    Date.parse(r.startedAt || r.createdAt);
  const visible = catalogue
    .filter(({ conference, record, history }) => {
      const text = [
        conference.title,
        history?.owner.displayName,
        modeLabels[record.mode],
      ]
        .join(" ")
        .toLocaleLowerCase("ru-RU");
      return (
        (!meeting || conference.id === meeting) &&
        (!days || timestamp(record) >= since.getTime()) &&
        text.includes(term)
      );
    })
    .sort(
      (a, b) =>
        (timestamp(a.record) - timestamp(b.record)) *
        (sort === "oldest" ? 1 : -1),
    );
  const filtered = Boolean(term || days || meeting);
  const failed = library.data?.pages.some((page) => page.failed.length);
  return (
    <div className="recordings-page recordings-reference-library">
      <section className="recordings-library-intro">
        {!isDesktopBuild && <h1>Записи встреч</h1>}
        <span className="recordings-eyebrow">Библиотека встреч</span>
        <h2>Важное остаётся с вами</h2>
        <p>Видео, аудио и материалы ваших встреч.</p>
      </section>
      <div
        className="recordings-status-tabs"
        role="group"
        aria-label="Состояние встречи"
      >
        {(["past", "active"] as const).map((status) => (
          <button
            type="button"
            key={status}
            aria-pressed={view === status}
            onClick={() => {
              setView(status);
              setMeeting("");
            }}
          >
            {status === "past" ? (
              "Завершённые"
            ) : (
              <>
                В эфире
                <i aria-hidden="true" />
              </>
            )}
          </button>
        ))}
      </div>
      <section
        className="recordings-catalogue-toolbar"
        aria-label="Поиск записей"
      >
        <label className="recordings-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Найти запись встречи"
            placeholder="Найти запись встречи"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="recordings-meeting-filter">
          <span>Встреча</span>
          <select value={meeting} onChange={(e) => setMeeting(e.target.value)}>
            <option value="">Все встречи</option>
            {[...meetings].map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section
        className="recordings-list-toolbar"
        aria-label="Фильтры и вид записей"
      >
        <div className="recordings-period-sort">
          <select
            aria-label="Период записей"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            <option value="">Всё время</option>
            {["7", "30", "90"].map((n) => (
              <option key={n} value={n}>
                За {n} дней
              </option>
            ))}
          </select>
          <select
            aria-label="Сортировка записей"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала старые</option>
          </select>
        </div>
        <CollectionViewToggle
          value={layout}
          onChange={setLayout}
          label="Вид записей"
        />
      </section>
      {!library.isPending && !library.isError && (
        <p className="recordings-results-caption" role="status">
          Найдено: {visible.length}
          {library.hasNextPage ? " среди загруженных" : ""}
        </p>
      )}
      {(library.isError || failed) && (
        <div className="recordings-error">
          <ErrorNotice>
            {library.isError
              ? "Не удалось загрузить записи."
              : "Часть записей не удалось загрузить. Доступные записи показаны ниже."}
          </ErrorNotice>
          <Button variant="outline" onClick={() => void library.refetch()}>
            Повторить загрузку записей
          </Button>
        </div>
      )}
      {library.isPending ? (
        <Loading />
      ) : (
        <div className={`recordings-list recordings-layout-${layout}`}>
          {visible.map(({ record, conference, history }) => (
            <RecordingCard
              key={`${conference.id}/${record.uuid}`}
              record={record}
              conference={conference}
              history={history}
            />
          ))}
          {!visible.length && !library.isError && !failed && (
            <section className="recordings-empty">
              <CirclePlay size={36} aria-hidden="true" />
              <h2>
                {library.hasNextPage
                  ? "В загруженных записях ничего не найдено"
                  : filtered
                    ? "Записи не найдены"
                    : view === "active"
                      ? "Сейчас нет записей в эфире"
                      : "Записей пока нет"}
              </h2>
              <p>
                {library.hasNextPage
                  ? "Загрузите ещё записи, чтобы продолжить поиск."
                  : filtered
                    ? "Попробуйте другую встречу или измените условия поиска."
                    : view === "active"
                      ? "Здесь появятся записи текущих встреч."
                      : "Здесь появятся доступные записи ваших встреч."}
              </p>
              {filtered && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setDays("");
                    setMeeting("");
                  }}
                >
                  Сбросить фильтры
                </Button>
              )}
            </section>
          )}
        </div>
      )}
      {library.hasNextPage && (
        <div className="recordings-load-more">
          {(filtered || sort === "oldest") && (
            <p className="field-hint">
              Показаны загруженные записи. Загрузите ещё, чтобы расширить
              список.
            </p>
          )}
          <Button
            variant="outline"
            busy={library.isFetchingNextPage}
            onClick={() => void library.fetchNextPage()}
          >
            Ещё записи
          </Button>
        </div>
      )}
      <p className="recordings-retention">
        <Info size={16} aria-hidden="true" />
        Ссылку на запись могут открыть участники встречи с доступом.
      </p>
    </div>
  );
}
