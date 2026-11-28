import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  FolderOpen,
  Image,
  Info,
  Mic,
  Play,
  Video,
  RefreshCw,
} from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { isDesktopBuild } from "../platform/build";
import { RecordingActions } from "../components/RecordingActions";
import {
  NativeAssetStatus,
  NativeSaveButton,
  useNativeAsset,
} from "../components/desktop/NativeAssets";
import { Button, ErrorNotice, Loading } from "../components/ui";
import {
  formatRecordingDuration,
  formatRecordingSize,
  recordingMediaFile,
  recordingFileAvailable,
  recordingPreviewFile,
  recordingTracksFile,
  recordingDetailPath,
  safeRecordingUrl,
} from "../recordingPresentation";
import type { ConferenceRecording } from "../types";
import { initials } from "../utils";
import "./recordings.css";
import "./recording-detail-reference.css";

const formats = {
  final_mp4: { title: "Видеозапись", extension: "MP4", Icon: Video },
  final_audio: { title: "Аудиозапись", extension: "M4A", Icon: Mic },
  preview_jpg: { title: "Превью записи", extension: "JPG", Icon: Image },
  tracks_archive: {
    title: "Архив дорожек",
    extension: "ZIP",
    Icon: FolderOpen,
  },
};
const modeLabels: Record<ConferenceRecording["mode"], string> = {
  composite: "Видеозапись",
  screen_focus: "Видеозапись",
  audio_only: "Аудиозапись",
  individual_tracks: "Дорожки участников",
};
const activeStatuses = new Set(["starting", "recording", "degraded"]);
const waveform = [
  18, 23, 34, 18, 29, 21, 33, 20, 24, 31, 20, 35, 27, 16, 34, 21, 28, 35, 18,
  23, 34, 18, 29, 21, 33,
];

function RecordingWaveform() {
  return (
    <span className="recording-preview-wave">
      {waveform.map((height, index) => (
        <i key={index} style={{ height: `${height * 2.4}%` }} />
      ))}
    </span>
  );
}

function RecordingDetailCover({
  mode,
  participants,
  poster,
}: {
  mode: ConferenceRecording["mode"];
  participants: string[];
  poster?: string;
}) {
  if (poster)
    return <img className="recording-preview-image" src={poster} alt="" />;
  return (
    <div
      className={`recording-preview recording-preview-${mode}`}
      aria-hidden="true"
    >
      {mode === "audio_only" ? (
        <RecordingWaveform />
      ) : mode === "individual_tracks" ? (
        <div className="recording-preview-tracks">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index}>
              <b>{participants[index] ? initials(participants[index]) : ""}</b>
              <RecordingWaveform />
            </div>
          ))}
        </div>
      ) : (
        <div className="recording-preview-participants">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index}>
              {participants[index] && <b>{initials(participants[index])}</b>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function participantLabel(count: number) {
  const form = new Intl.PluralRules("ru").select(count);
  return `${count} ${form === "one" ? "участник" : form === "few" ? "участника" : "участников"}`;
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(new Date(value))
    .replace(/\s*г\.$/, "");
}

/** RecordingDetailPage открывает приватную запись только в контексте указанной встречи.
 * Идентификатор записи сам по себе не даёт права доступа: все материалы подтверждает API.
 * @return страница просмотра либо безопасная подсказка, если ссылка неполная или пользователь не вошёл.
 */
export function RecordingDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const conferenceId = params.get("conference") || "";

  if (!id || !conferenceId)
    return (
      <section className="recording-detail-page recording-detail-unavailable">
        <Video size={36} aria-hidden="true" />
        <h1>Не удалось открыть запись</h1>
        <p>
          Откройте запись из списка записей встречи, чтобы перейти к её
          материалам.
        </p>
        <Link className="button button-primary" to="/recordings">
          К записям
        </Link>
      </section>
    );
  if (!user)
    return (
      <section className="recording-detail-page recording-detail-unavailable">
        <h1>Войдите, чтобы открыть запись</h1>
        <p>Материалы встречи доступны только авторизованным участникам.</p>
        <Link className="button button-primary" to="/login">
          Войти
        </Link>
      </section>
    );
  return (
    <RecordingDetailContent
      key={`${user.id}:${conferenceId}:${id}`}
      userId={user.id}
      conferenceId={conferenceId}
      recordingId={id}
    />
  );
}

/** RecordingDetailContent загружает запись и показывает только реальные файлы, разрешённые сервером.
 * Кеш разделён по пользователю, встрече и записи; ссылки обновляются исключительно по команде пользователя.
 * @args userId — текущая учётная запись; conferenceId — контекст встречи; recordingId — UUID записи.
 * @return видеоплеер либо аудиоплеер, доступные материалы и необязательная сводка завершённой встречи.
 */
function RecordingDetailContent({
  userId,
  conferenceId,
  recordingId,
}: {
  userId: string;
  conferenceId: string;
  recordingId: string;
}) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mediaRevision, setMediaRevision] = useState(0);
  const mounted = useRef(true);
  const native = useNativeAsset(`${userId}:${conferenceId}:${recordingId}`);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const conference = useQuery({
    queryKey: ["recording-detail-conference", userId, conferenceId],
    queryFn: ({ signal }) => api.conference(conferenceId, signal),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const conferenceMatches = conference.data?.item.id === conferenceId;
  const recording = useQuery({
    queryKey: ["recording-detail", userId, conferenceId, recordingId],
    queryFn: ({ signal }) => api.recording(conferenceId, recordingId, signal),
    enabled: conference.isSuccess && conferenceMatches,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const recordingMatches =
    recording.data?.item.uuid === recordingId &&
    recording.data?.item.conferenceId === conferenceId;
  const history = useQuery({
    queryKey: ["recording-detail-history", userId, conferenceId],
    queryFn: ({ signal }) => api.history(conferenceId, signal),
    enabled:
      conference.isSuccess &&
      conferenceMatches &&
      ["finished", "cancelled"].includes(conference.data?.item.status ?? "") &&
      recording.isSuccess &&
      recordingMatches,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const backPath = `/recordings?${new URLSearchParams({ conference: conferenceId })}`;

  /** refresh проверяет доступ заново и получает свежие серверные ссылки после ошибки воспроизведения.
   * Автоматических повторов и циклического продления ссылок нет; повторное нажатие блокируется до ответа.
   */
  async function refresh() {
    if (refreshing) return;
    if (isDesktopBuild) native.cancel();
    setRefreshing(true);
    try {
      const nextConference = await conference.refetch();
      if (
        !mounted.current ||
        !nextConference.isSuccess ||
        nextConference.data?.item.id !== conferenceId
      )
        return;
      const nextRecording = await recording.refetch();
      if (!mounted.current) return;
      if (
        nextRecording.isSuccess &&
        nextRecording.data?.item.uuid === recordingId &&
        nextRecording.data.item.conferenceId === conferenceId
      ) {
        setMediaFailed(false);
        setMediaRevision((value) => value + 1);
      }
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }

  const backLink = (
    <Link className="recording-detail-back" to={backPath}>
      <ArrowLeft size={18} aria-hidden="true" />
      Все записи
    </Link>
  );
  if (
    conference.isError ||
    (conference.isSuccess && !conferenceMatches) ||
    recording.isError ||
    (recording.isSuccess && !recordingMatches)
  )
    return (
      <div className="recording-detail-page">
        {backLink}
        <section className="recording-detail-unavailable">
          <Video size={36} aria-hidden="true" />
          <h1>Не удалось открыть запись</h1>
          <ErrorNotice>
            Запись недоступна. Проверьте доступ к встрече или попробуйте позже.
          </ErrorNotice>
          <Button
            variant="secondary"
            busy={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Попробовать снова
          </Button>
        </section>
      </div>
    );
  if (conference.isPending || recording.isPending)
    return (
      <div className="recording-detail-page">
        {backLink}
        <Loading />
      </div>
    );

  const meeting = conference.data.item;
  const item = recording.data.item;
  const media =
    item.mode === "audio_only"
      ? item.files.find(
          (file) =>
            file.fileType === "final_audio" && recordingFileAvailable(file),
        )
      : recordingMediaFile(item);
  const mediaUrl = isDesktopBuild
    ? native.source
    : safeRecordingUrl(media?.url);
  // Desktop must only open private files by object ID after explicit user action.
  const poster = isDesktopBuild
    ? undefined
    : safeRecordingUrl(recordingPreviewFile(item)?.url);
  const playable = item.status === "ready" && !!media;
  const mediaAsset = media?.uuid
    ? {
        kind: "recording" as const,
        conferenceId,
        recordingId,
        fileId: media.uuid,
      }
    : undefined;
  const audioOnly = media?.fileType === "final_audio";
  const materials =
    item.status === "ready"
      ? item.files.flatMap((file, index) => {
          const format = formats[file.fileType as keyof typeof formats];
          return Object.hasOwn(formats, file.fileType) &&
            recordingFileAvailable(file)
            ? [{ ...file, url: safeRecordingUrl(file.url), index, format }]
            : [];
        })
      : [];
  const meetingHistory =
    history.isSuccess && history.data.item.conference.id === conferenceId
      ? history.data.item
      : undefined;
  const participantCount =
    meetingHistory?.participantCount ?? meeting.participantCount;
  const participants =
    meetingHistory?.participants.map(
      (participant) => participant.displayName,
    ) ?? [];
  const date = [item.startedAt, item.createdAt].find(
    (value) => value && Number.isFinite(Date.parse(value)),
  );
  const dateLabel = date ? displayDate(date) : "Дата не указана";
  const recordedAt = date
    ? `${dateLabel} · ${new Intl.DateTimeFormat("ru-RU", { timeStyle: "short" }).format(new Date(date))}`
    : dateLabel;
  const active = activeStatuses.has(item.status);
  const processing = item.status === "processing" || item.status === "stopping";
  const duration = active
    ? "Идёт запись"
    : formatRecordingDuration(item.durationSec);
  const archive =
    item.status === "ready" ? recordingTracksFile(item) : undefined;
  const primaryFile = media ?? archive;
  const pendingPlay = playable && isDesktopBuild && !mediaUrl && !!mediaAsset;
  const showPlayer = playable && !!mediaUrl && !mediaFailed;
  const archiveOnly =
    item.mode === "individual_tracks" && !playable && !!archive;

  function openRecording() {
    if (!mediaAsset) return;
    setMediaFailed(false);
    void native.run(mediaAsset, "play");
  }

  return (
    <div className="recording-detail-page">
      {backLink}
      <header className="recording-detail-heading">
        <span className="recording-detail-kind">{modeLabels[item.mode]}</span>
        <h1>{meeting.title || "Запись встречи"}</h1>
        <p>
          {dateLabel}
          {typeof participantCount === "number" &&
            ` · ${participantLabel(participantCount)}`}
        </p>
      </header>

      <div className="recording-detail-layout">
        <div className="recording-detail-playback">
          <div
            className={`recording-detail-player${pendingPlay || (showPlayer && audioOnly) ? " has-controls" : ""}`}
          >
            <div className="recording-detail-stage">
              {(!showPlayer || audioOnly) && (
                <RecordingDetailCover
                  mode={item.mode}
                  participants={participants}
                  poster={poster}
                />
              )}
              {pendingPlay && !native.busy && !native.error && (
                <button
                  type="button"
                  className="recording-detail-center-play"
                  onClick={openRecording}
                  title="Открыть запись"
                >
                  <Play aria-hidden="true" />
                  <span className="sr-only">Открыть запись</span>
                </button>
              )}
              {pendingPlay && (native.busy || native.error) && (
                <div className="recording-detail-stage-message">
                  <NativeAssetStatus operation={native} />
                  {native.error && (
                    <Button variant="outline" onClick={openRecording}>
                      Повторить
                    </Button>
                  )}
                </div>
              )}
              {showPlayer && !audioOnly && (
                <video
                  key={mediaRevision}
                  aria-label="Видеозапись встречи"
                  controls
                  playsInline
                  autoPlay={isDesktopBuild}
                  preload="metadata"
                  src={mediaUrl}
                  poster={poster}
                  onError={() => setMediaFailed(true)}
                />
              )}
              {!pendingPlay && !showPlayer && (
                <div className="recording-detail-stage-message">
                  {archiveOnly ? (
                    <>
                      <strong>Отдельная дорожка каждого участника</strong>
                      <p>Скачайте архив в блоке «Материалы».</p>
                    </>
                  ) : (
                    <>
                      <strong>
                        {active
                          ? "Встреча ещё в эфире"
                          : processing
                            ? "Запись обрабатывается"
                            : "Запись пока недоступна"}
                      </strong>
                      <p>
                        {mediaFailed
                          ? "Не удалось воспроизвести запись. Обновите ссылку и попробуйте снова."
                          : active || processing
                            ? "Запись будет доступна после обработки."
                            : "Не удалось открыть материалы записи."}
                      </p>
                      <Button
                        variant="outline"
                        busy={refreshing}
                        onClick={() => void refresh()}
                      >
                        <RefreshCw size={16} aria-hidden="true" />
                        {mediaFailed ? "Обновить ссылку" : "Обновить запись"}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
            {pendingPlay && (
              <div className="recording-detail-controls">
                <button
                  type="button"
                  className="icon-button"
                  onClick={openRecording}
                  disabled={native.busy}
                  aria-label="Начать воспроизведение"
                >
                  <Play size={20} aria-hidden="true" />
                </button>
                <span>00:00</span>
                <span
                  className="recording-detail-timeline"
                  aria-hidden="true"
                />
                <span>{duration}</span>
              </div>
            )}
            {showPlayer && audioOnly && (
              <div className="recording-detail-controls">
                <audio
                  key={mediaRevision}
                  aria-label="Аудиозапись встречи"
                  controls
                  autoPlay={isDesktopBuild}
                  preload="metadata"
                  src={mediaUrl}
                  onError={() => setMediaFailed(true)}
                />
              </div>
            )}
          </div>
          <div className="recording-detail-access">
            <Info size={16} aria-hidden="true" />
            <p>Материалы записи доступны участникам встречи.</p>
            <RecordingActions
              title={meeting.title}
              path={recordingDetailPath(conferenceId, recordingId)}
            />
          </div>
        </div>

        <aside className="recording-detail-sidebar">
          <section
            className="recording-detail-card"
            aria-labelledby="recording-info-title"
          >
            <h2 id="recording-info-title">О записи</h2>
            <dl className="recording-detail-metadata">
              <div>
                <dt>Дата записи</dt>
                <dd>{recordedAt}</dd>
              </div>
              <div>
                <dt>Длительность</dt>
                <dd>{duration}</dd>
              </div>
              <div>
                <dt>Размер</dt>
                <dd>{formatRecordingSize(primaryFile?.sizeBytes)}</dd>
              </div>
              <div>
                <dt>Организатор</dt>
                <dd>
                  {meetingHistory?.owner.displayName ??
                    (meeting.ownerId === userId ? "Вы" : "—")}
                </dd>
              </div>
              <div>
                <dt>Участники</dt>
                <dd>{participantCount ?? "—"}</dd>
              </div>
              <div>
                <dt>Доступ</dt>
                <dd>Участники встречи</dd>
              </div>
            </dl>
          </section>
          <section
            className="recording-detail-card"
            aria-labelledby="recording-materials-title"
          >
            <h2 id="recording-materials-title">Материалы</h2>
            {materials.length ? (
              <ul className="recording-detail-material-list">
                {materials.map(
                  ({ uuid, fileType, sizeBytes, index, url, format }) => {
                    const label = `Скачать ${format.title.toLocaleLowerCase("ru-RU")}`;
                    return (
                      <li
                        key={uuid || `${fileType}:${index}`}
                        className="recording-detail-material"
                      >
                        <span className="recording-material-icon">
                          <format.Icon size={18} aria-hidden="true" />
                        </span>
                        <div className="recording-material-label">
                          <strong>{format.title}</strong>
                          <small>
                            {format.extension}
                            {typeof sizeBytes === "number" &&
                              ` · ${formatRecordingSize(sizeBytes)}`}
                          </small>
                        </div>
                        {isDesktopBuild && uuid ? (
                          <NativeSaveButton
                            asset={{
                              kind: "recording",
                              conferenceId,
                              recordingId,
                              fileId: uuid,
                            }}
                            className="icon-button recording-material-download"
                            title={label}
                          >
                            <Download size={18} aria-hidden="true" />
                            <span className="sr-only">{label}</span>
                          </NativeSaveButton>
                        ) : (
                          !isDesktopBuild && (
                            <a
                              className="icon-button recording-material-download"
                              href={url}
                              download
                              target="_blank"
                              rel="noreferrer"
                              aria-label={label}
                              title={label}
                            >
                              <Download size={18} aria-hidden="true" />
                            </a>
                          )
                        )}
                      </li>
                    );
                  },
                )}
              </ul>
            ) : (
              <p>Материалы пока не готовы.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
