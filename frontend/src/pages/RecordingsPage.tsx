import { useState } from "react";
import { Link } from "react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CirclePlay,
  ArrowUpRight,
  FileArchive,
  Play,
  Search,
  Users,
} from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
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
  playableRecordings,
  recordingDate,
  recordingDetailPath,
  recordingMediaFile,
  recordingPreviewFile,
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

/** RecordingCard показывает одну реальную готовую запись выбранной встречи.
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
  const preview = recordingPreviewFile(record);
  const file = recordingMediaFile(record);
  const path = recordingDetailPath(conference.id, record.uuid);
  const hasPreview = !!preview?.url && brokenPreview !== preview.url;
  const audioOnly = record.mode === "audio_only";
  const tracks = record.mode === "individual_tracks";
  const modeLabel = tracks
    ? "Аудиомикс и дорожки"
    : audioOnly
      ? "Аудиозапись"
      : "Видеозапись";
  return (
    <article className="recordings-row" data-testid="recordings-row">
      <Link
        to={path}
        className={`recordings-thumbnail${hasPreview ? "" : " recordings-thumbnail-placeholder"}${audioOnly ? " recordings-thumbnail-audio" : ""}${tracks ? " recordings-thumbnail-tracks" : ""}`}
        aria-label={`Смотреть запись: ${conference.title}`}
      >
        {hasPreview ? (
          <img
            src={preview!.url}
            alt=""
            loading="lazy"
            onError={() => setBrokenPreview(preview!.url!)}
          />
        ) : (
          <>
            <span className="recordings-thumbnail-label">{modeLabel}</span>
            {audioOnly ? (
              <span className="recordings-thumbnail-wave" aria-hidden="true">
                {Array.from({ length: 19 }, (_, index) => (
                  <i
                    key={index}
                    style={{ height: `${12 + ((index * 13) % 37)}px` }}
                  />
                ))}
              </span>
            ) : tracks ? (
              <span
                className="recordings-thumbnail-tracks-art"
                aria-hidden="true"
              >
                <FileArchive size={25} />
                <span>
                  {[0, 1, 2].map((row) => (
                    <i key={row}>
                      <b />
                      <b />
                      <b />
                      <b />
                      <b />
                      <b />
                    </i>
                  ))}
                </span>
              </span>
            ) : (
              <span className="recordings-thumbnail-tiles" aria-hidden="true">
                {[0, 1, 2, 3].map((tile) => (
                  <i key={tile}>
                    <Users size={19} strokeWidth={1.4} />
                  </i>
                ))}
              </span>
            )}
          </>
        )}
        <span className="recordings-thumbnail-play" aria-hidden="true">
          <Play size={19} />
        </span>
        {record.durationSec !== undefined && (
          <span className="recordings-thumbnail-duration">
            {formatRecordingDuration(record.durationSec)}
          </span>
        )}
      </Link>
      <div className="recordings-row-info">
        <Link to={path} className="recordings-row-title">
          {conference.title}
        </Link>
        <p className="recordings-meta">
          <time
            dateTime={record.startedAt || record.createdAt}
            title={recordingDate(record)}
          >
            {new Date(record.startedAt || record.createdAt).toLocaleDateString(
              "ru-RU",
              { day: "numeric", month: "long", year: "numeric" },
            )}
          </time>
          <span aria-hidden="true">·</span>
          {history ? (
            <span>{history.participantCount} участников</span>
          ) : (
            <span>{formatRecordingSize(file?.sizeBytes)}</span>
          )}
        </p>
        {history?.owner.displayName && (
          <p className="recordings-row-owner">
            Организатор: {history.owner.displayName}
            {history.owner.id === user?.id ? " (вы)" : ""}
          </p>
        )}
      </div>
      <div className="recordings-row-actions">
        <span className="recordings-row-type">{modeLabel}</span>
        <Link
          to={path}
          className="icon-button recordings-watch"
          aria-label={`Смотреть запись: ${conference.title}`}
        >
          <ArrowUpRight size={17} aria-hidden="true" />
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
      </div>
    </article>
  );
}

/** A flat catalogue using the same cards, toolbar and empty state as decs_maket. */
export function RecordingsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState<CollectionView>("grid");
  const library = useInfiniteQuery({
    queryKey: ["recording-library", user?.id],
    enabled: !!user,
    initialPageParam: { pending: [] } as RecordingLibraryCursor,
    queryFn: ({ pageParam, signal }) =>
      loadRecordingLibraryPage(
        {
          conferences: (cursor, signal) =>
            api.myConferences({ view: "past" }, cursor, signal),
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
  const ready = entries.filter(
    ({ record }) => playableRecordings([record]).length,
  );
  const countLabel = new Intl.PluralRules("ru-RU").select(ready.length);
  const visible = ready
    .filter((entry) =>
      entry.conference.title
        .toLocaleLowerCase("ru-RU")
        .includes(search.trim().toLocaleLowerCase("ru-RU")),
    )
    .sort(
      (a, b) =>
        Date.parse(b.record.startedAt || b.record.createdAt) -
        Date.parse(a.record.startedAt || a.record.createdAt),
    );
  const failed = library.data?.pages.some((page) => page.failed.length);
  return (
    <div className="recordings-page recordings-reference-library">
      <section className="page-heading recordings-heading">
        <h1>Записи встреч</h1>
        {library.isSuccess && (
          <span className="recordings-count">
            {ready.length}
            {library.hasNextPage ? "+" : ""}{" "}
            {countLabel === "one"
              ? "запись"
              : countLabel === "few"
                ? "записи"
                : "записей"}
          </span>
        )}
      </section>
      <section
        className="recordings-catalogue-toolbar"
        aria-label="Поиск и вид записей"
      >
        <label className="recordings-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label="Найти запись"
            placeholder="Найти запись"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <CollectionViewToggle
          value={layout}
          onChange={setLayout}
          label="Вид записей"
        />
      </section>
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
                  : search.trim()
                    ? "Записи не найдены"
                    : "Записей пока нет"}
              </h2>
              <p>
                {library.hasNextPage
                  ? "Загрузите ещё записи, чтобы продолжить поиск."
                  : search.trim()
                    ? "Попробуйте другое название встречи."
                    : "Здесь появятся доступные записи ваших встреч."}
              </p>
              {search.trim() ? (
                <Button variant="secondary" onClick={() => setSearch("")}>
                  Сбросить поиск
                </Button>
              ) : (
                <Link
                  className="button button-secondary"
                  to="/conferences?view=past"
                >
                  Завершённые встречи
                </Link>
              )}
            </section>
          )}
        </div>
      )}
      {library.hasNextPage && (
        <div className="recordings-load-more">
          {!!visible.length && !!search.trim() && (
            <p className="field-hint">
              Поиск выполнен по загруженным записям. Загрузите ещё, чтобы
              расширить список.
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
      <footer className="recordings-catalogue-footer">
        <Link to="/conferences?view=past">
          <ArrowLeft size={15} aria-hidden="true" />
          Завершённые встречи
        </Link>
      </footer>
    </div>
  );
}
