import { isDesktopBuild } from "./platform/build";
import { desktopServerID } from "./platform/urls";
import type { DesktopRuntimeInfo } from "./platform/desktop-contracts";

export interface DevicePreferences {
  audioInputId: string;
  videoInputId: string;
  audioOutputId: string;
  outputVolume: number;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  notificationOutputId: string;
  notificationSounds: boolean;
  noiseSuppression: boolean;
  showSelf: boolean;
  hideParticipantVideo: boolean;
}

// A single explicit Connect click may start media after admission. This intent
// lives only in this tab and is consumed once; reconnect never enables devices.
const mediaEntries = new Map<string, number>();
const scope = (value: string) =>
  isDesktopBuild ? `${desktopServerID() ?? "unselected"}:${value}` : value;
export function queueMediaEntry(conferenceId: string) {
  mediaEntries.set(scope(conferenceId), Date.now());
}
export function consumeMediaEntry(conferenceId: string): boolean {
  const requestedAt = mediaEntries.get(scope(conferenceId));
  mediaEntries.delete(scope(conferenceId));
  return requestedAt !== undefined && Date.now() - requestedAt < 60 * 60 * 1000;
}

const emptyPreferences: DevicePreferences = {
  audioInputId: "",
  videoInputId: "",
  audioOutputId: "",
  outputVolume: 100,
  microphoneEnabled: true,
  cameraEnabled: true,
  notificationOutputId: "",
  notificationSounds: true,
  noiseSuppression: true,
  showSelf: true,
  hideParticipantVideo: false,
};

const key = (userId: string) => `meet.devices.v1:${scope(userId)}`;
const safeId = (value: unknown) =>
  typeof value === "string" && value.length <= 512 ? value : "";

/** ID устройств используются только как предпочтения и не определяют личность участника. */
export function readDevicePreferences(userId: string): DevicePreferences {
  if (!userId) return { ...emptyPreferences };
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem(key(userId)) || "null",
    );
    if (!data || typeof data !== "object") return { ...emptyPreferences };
    const value = data as Record<string, unknown>;
    return {
      audioInputId: safeId(value.audioInputId),
      videoInputId: safeId(value.videoInputId),
      audioOutputId: safeId(value.audioOutputId),
      outputVolume:
        typeof value.outputVolume === "number" &&
        Number.isFinite(value.outputVolume)
          ? Math.min(100, Math.max(0, value.outputVolume))
          : 100,
      microphoneEnabled: value.microphoneEnabled === true,
      cameraEnabled: value.cameraEnabled === true,
      notificationOutputId: safeId(value.notificationOutputId),
      notificationSounds: value.notificationSounds !== false,
      noiseSuppression: value.noiseSuppression !== false,
      showSelf: value.showSelf !== false,
      hideParticipantVideo: value.hideParticipantVideo === true,
    };
  } catch {
    return { ...emptyPreferences };
  }
}

export function hasDevicePreferences(userId: string) {
  if (!userId) return false;
  try {
    return localStorage.getItem(key(userId)) !== null;
  } catch {
    return false;
  }
}

export function saveDevicePreferences(
  userId: string,
  preferences: DevicePreferences,
) {
  if (!userId) return;
  try {
    localStorage.setItem(key(userId), JSON.stringify(preferences));
  } catch {
    // Хранилище может быть отключено; встреча продолжает работать с устройствами по умолчанию.
  }
  window.dispatchEvent(
    new CustomEvent("meet:devices", { detail: { userId, preferences } }),
  );
}

/** Обновляет открытые настройки и встречу, в том числе в соседней вкладке. */
export function subscribeDevicePreferences(
  userId: string,
  listener: (preferences: DevicePreferences) => void,
) {
  const local = (event: Event) => {
    const detail = (
      event as CustomEvent<{ userId: string; preferences: DevicePreferences }>
    ).detail;
    if (detail.userId === userId) listener(detail.preferences);
  };
  const storage = (event: StorageEvent) => {
    if (event.key === key(userId) || event.key === null)
      listener(readDevicePreferences(userId));
  };
  window.addEventListener("meet:devices", local);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener("meet:devices", local);
    window.removeEventListener("storage", storage);
  };
}

/** Сохраняет непрозрачное предпочтение, пока браузер не предоставит реальные ID устройств. */
export function availableDeviceId(
  devices: MediaDeviceInfo[],
  kind: MediaDeviceKind,
  preferredId: string,
) {
  if (!preferredId) return "";
  const known = devices.filter(
    (device) =>
      device.kind === kind &&
      device.deviceId &&
      device.deviceId !== "default" &&
      device.deviceId !== "communications",
  );
  return known.length &&
    !known.some((device) => device.deviceId === preferredId)
    ? ""
    : preferredId;
}

export function capturePermissionMessage(
  kind: "audio" | "video" | "audio-video",
  platform?: DesktopRuntimeInfo["platform"],
) {
  const label =
    kind === "audio"
      ? "микрофон"
      : kind === "video"
        ? "камеру"
        : "камеру и микрофон";
  if (isDesktopBuild && platform === "darwin") {
    const section =
      kind === "audio"
        ? "«Микрофон»"
        : kind === "video"
          ? "«Камера»"
          : "«Камера» и «Микрофон»";
    return `Доступ к устройствам запрещён. В macOS откройте «Системные настройки» → «Конфиденциальность и безопасность» → ${section} и разрешите MeetSpace. Затем повторите попытку. Если доступ не появился, закройте MeetSpace через ⌘Q и откройте снова.`;
  }
  return isDesktopBuild
    ? `Доступ к устройству запрещён. Разрешите ${label} для MeetSpace в настройках конфиденциальности системы и повторите.`
    : `Доступ к устройству запрещён. Разрешите ${label} для этого сайта в настройках браузера и повторите.`;
}

export function captureErrorMessage(
  error: unknown,
  kind: "audio" | "video",
  platform?: DesktopRuntimeInfo["platform"],
) {
  const name =
    error &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : "";
  const label = kind === "audio" ? "микрофон" : "камеру";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return capturePermissionMessage(kind, platform);
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return `Устройство не найдено. Подключите ${label} или войдите без него.`;
  if (name === "NotReadableError" || name === "TrackStartError")
    return `Не удалось открыть ${label}. Возможно, устройство отключено или занято другим приложением.`;
  if (name === "OverconstrainedError")
    return `Выбранное устройство недоступно. Выберите другое или системное устройство.`;
  if (name === "SecurityError")
    return isDesktopBuild
      ? "Захват устройств недоступен. Перезапустите MeetSpace и проверьте разрешения системы."
      : "Браузер запретил доступ к устройствам. Откройте страницу по HTTPS или через localhost.";
  return `Не удалось включить ${label}. Проверьте разрешения и попробуйте снова.`;
}

/** Browser errors cannot distinguish a cancelled system picker from denied consent. */
export function screenCaptureErrorMessage(
  error: unknown,
  platform?: DesktopRuntimeInfo["platform"],
) {
  const name =
    error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return isDesktopBuild && platform === "darwin"
      ? "Демонстрация не началась: выбор отменён или macOS не разрешила доступ. Если вы не отменяли выбор, проверьте MeetSpace в «Системные настройки» → «Конфиденциальность и безопасность» → «Запись экрана и системного аудио» (Screen Recording). После изменения разрешения может потребоваться закрыть MeetSpace через ⌘Q и открыть снова."
      : "Демонстрация не началась: выбор отменён или система не разрешила доступ. Повторите выбор, когда будете готовы.";
  if (name === "NotSupportedError")
    return "Демонстрация экрана недоступна в этой среде. Проверьте поддержку системной демонстрации и повторите.";
  if (name === "InvalidStateError")
    return "Чтобы начать демонстрацию, вернитесь в окно MeetSpace и нажмите «Экран» ещё раз.";
  if (name === "NotFoundError")
    return "Не удалось получить экран или окно. Проверьте доступные источники и повторите выбор.";
  if (name === "NotReadableError" || name === "AbortError")
    return isDesktopBuild && platform === "darwin"
      ? "Не удалось захватить выбранный экран или окно. Проверьте, что окно открыто, а MeetSpace разрешена запись экрана в «Системные настройки» → «Конфиденциальность и безопасность». Затем выберите источник снова."
      : "Не удалось захватить выбранный экран или окно. Проверьте системный диалог демонстрации и повторите.";
  return "Демонстрация не началась. Выберите экран или окно и повторите попытку.";
}
