import { subscribeCaptureRelease } from "../platform/captureLifecycle";
import { isDesktopBuild } from "../platform/build";
import { useDesktopRuntime } from "../platform/runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  Mic,
  Play,
  Square,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { UserAvatar } from "./UserAvatar";
import { useAuth } from "../auth";
import {
  availableDeviceId,
  captureErrorMessage,
  readDevicePreferences,
  signalGain,
  saveDevicePreferences,
  subscribeDevicePreferences,
} from "../prejoinDevices";
import type { DevicePreferences } from "../prejoinDevices";
import { playDeviceTone } from "../deviceSound";
import {
  captureWithDeviceFallback,
  inputTrackConstraints,
} from "../mediaDevices";
import "./device-settings.css";

function useSettings() {
  const { user } = useAuth();
  const userId = user?.id || "guest";
  const [preferences, setPreferences] = useState(() =>
    readDevicePreferences(userId),
  );
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState("");
  const mounted = useRef(false);
  const available = !!navigator.mediaDevices?.getUserMedia;
  const outputSupported = "setSinkId" in HTMLMediaElement.prototype;
  const refresh = useCallback(async () => {
    try {
      const found = await navigator.mediaDevices?.enumerateDevices();
      if (mounted.current && found) {
        setDevices(found);
        setDeviceError("");
      }
    } catch {
      if (mounted.current)
        setDeviceError(
          isDesktopBuild
            ? "Не удалось получить список устройств. Проверьте их подключение и разрешения системы для MeetSpace."
            : "Не удалось получить список устройств. Проверьте разрешения браузера.",
        );
    }
  }, []);
  useEffect(() => {
    setPreferences(readDevicePreferences(userId));
    return subscribeDevicePreferences(userId, setPreferences);
  }, [userId]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      mounted.current = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, [refresh]);
  function update(patch: Partial<DevicePreferences>) {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    saveDevicePreferences(userId, next);
  }
  return {
    preferences,
    devices,
    available,
    outputSupported,
    deviceError,
    refresh,
    update,
  };
}

/** Панель владеет предпросмотром: запоздавшие ответы разрешений останавливаются после закрытия или смены вкладки. */
function usePreview(
  kind: "audio" | "video",
  enabled: boolean,
  deviceId: string,
  noiseSuppression: boolean,
  refresh: () => Promise<void>,
) {
  const platform = useDesktopRuntime()?.platform;
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    let owned: MediaStream | null = null;
    setStream(null);
    setError("");
    setLoading(enabled);
    const ended = () => {
      if (!active) return;
      setStream(null);
      setError("Устройство отключено. Подключите его и повторите проверку.");
      void refresh();
    };
    const release = () => {
      active = false;
      owned?.getTracks().forEach((track) => {
        track.removeEventListener("ended", ended);
        track.stop();
      });
    };
    const unsubscribeRelease = subscribeCaptureRelease(() => {
      release();
      setStream(null);
      setLoading(false);
      if (enabled)
        setError("Предпросмотр остановлен. Повторите проверку устройства.");
    });
    if (enabled && typeof navigator.mediaDevices?.getUserMedia === "function") {
      const constraints = (id: string): MediaStreamConstraints => ({
        audio:
          kind === "audio" && inputTrackConstraints(kind, id, noiseSuppression),
        video:
          kind === "video" && inputTrackConstraints(kind, id, noiseSuppression),
      });
      void captureWithDeviceFallback(
        constraints(deviceId),
        deviceId ? constraints("") : undefined,
        () => active,
      )
        .then((captured) => {
          if (!captured) return;
          const next = captured.stream;
          if (!active) {
            next.getTracks().forEach((track) => track.stop());
            return;
          }
          owned = next;
          next
            .getTracks()
            .forEach((track) => track.addEventListener("ended", ended));
          setStream(next);
          setLoading(false);
          void refresh();
        })
        .catch((reason: unknown) => {
          if (active) {
            setError(captureErrorMessage(reason, kind, platform));
            setLoading(false);
          }
        });
    } else setLoading(false);
    return () => {
      release();
      unsubscribeRelease();
    };
  }, [kind, enabled, deviceId, noiseSuppression, refresh, retry, platform]);
  return {
    stream,
    error,
    loading,
    retry: () => setRetry((value) => value + 1),
  };
}

function LevelMeter({
  stream,
  playing = false,
  volume = 100,
  label,
}: {
  stream?: MediaStream | null;
  playing?: boolean;
  volume?: number;
  label: string;
}) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    setLevel(0);
    if (!stream || typeof AudioContext === "undefined") return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    void context.resume().catch(() => {});
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      const rms = Math.sqrt(
        data.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) /
          data.length,
      );
      setLevel(Math.min(12, Math.ceil((rms * 60 * volume) / 100)));
    }, 80);
    return () => {
      clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      void context.close().catch(() => {});
    };
  }, [stream, volume]);
  return (
    <span
      className={`device-level ${playing ? "device-level-playing" : ""}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={12}
      aria-valuenow={playing ? 12 : level}
    >
      {Array.from({ length: 12 }, (_, index) => (
        <i key={index} className={index < level ? "lit" : ""} />
      ))}
    </span>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="device-toggle-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="device-switch" aria-hidden="true" />
    </label>
  );
}

function DeviceSelect({
  devices,
  kind,
  value,
  onChange,
  label,
  disabled,
}: {
  devices: MediaDeviceInfo[];
  kind: MediaDeviceKind;
  value: string;
  onChange: (id: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const options = devices.filter(
    (device) =>
      device.kind === kind &&
      device.deviceId &&
      !["default", "communications"].includes(device.deviceId),
  );
  const defaultLabel = devices
    .find((device) => device.kind === kind && device.deviceId === "default")
    ?.label.replace(/^(default|по умолчанию)\s*[-–—]?\s*/i, "");
  const selected = availableDeviceId(devices, kind, value);
  return (
    <select
      className="device-select"
      aria-label={label}
      value={selected}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">
        По умолчанию{defaultLabel ? ` — ${defaultLabel}` : ""}
      </option>
      {selected && !options.some((item) => item.deviceId === selected) && (
        <option value={selected}>Выбранное устройство</option>
      )}
      {options.map((device, index) => (
        <option key={device.deviceId} value={device.deviceId}>
          {device.label || `${label} ${index + 1}`}
        </option>
      ))}
    </select>
  );
}

function SpeakerTest({
  sinkId,
  label,
  onPlaying,
  volume = 100,
  fullLabel = false,
}: {
  sinkId: string;
  label: string;
  onPlaying?: (value: boolean) => void;
  volume?: number;
  fullLabel?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const cancel = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      cancel.current?.();
      onPlaying?.(false);
    },
    [sinkId, onPlaying, volume],
  );
  function test() {
    if (cancel.current) {
      cancel.current();
      cancel.current = null;
      return;
    }
    setError("");
    setPlaying(true);
    onPlaying?.(true);
    cancel.current = playDeviceTone(
      sinkId,
      (reason) => {
        cancel.current = null;
        setPlaying(false);
        onPlaying?.(false);
        if (reason)
          setError(
            isDesktopBuild
              ? "Не удалось воспроизвести звук. Проверьте выбранный динамик и громкость системы."
              : "Не удалось воспроизвести звук. Проверьте выбранный динамик и разрешения браузера.",
          );
      },
      volume / 100,
    );
  }
  return (
    <>
      <button
        type="button"
        className="device-test"
        aria-label={playing ? `Остановить: ${label}` : `Проверить: ${label}`}
        onClick={test}
      >
        {playing ? (
          <Square size={16} />
        ) : fullLabel ? (
          <Volume2 size={16} />
        ) : (
          <Play size={16} />
        )}{" "}
        {playing ? "Остановить" : fullLabel ? "Проверить звук" : "Проверить"}
      </button>
      {error && (
        <p className="device-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Each tab owns only its active preview and releases capture when it closes. */
export function DeviceSettings({
  section = "audio",
}: {
  section?: "audio" | "video";
}) {
  const { user } = useAuth();
  const settings = useSettings();
  const { preferences, devices, update, available, outputSupported } = settings;
  const [cameraPreview, setCameraPreview] = useState(false);
  const [checking, setChecking] = useState(false);
  const [speakerPlaying, setSpeakerPlaying] = useState(false);
  const camera = usePreview(
    "video",
    section === "video" && available && cameraPreview,
    preferences.videoInputId,
    true,
    settings.refresh,
  );
  const microphone = usePreview(
    "audio",
    section === "audio" && checking,
    preferences.audioInputId,
    preferences.noiseSuppression,
    settings.refresh,
  );
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = camera.stream;
    if (camera.stream) void element.play().catch(() => {});
    return () => {
      element.srcObject = null;
    };
  }, [camera.stream]);
  const noiseSupported =
    !!navigator.mediaDevices?.getSupportedConstraints?.().noiseSuppression;
  const canChooseOutput = !!(
    navigator.mediaDevices as MediaDevices & { selectAudioOutput?: unknown }
  )?.selectAudioOutput;
  async function chooseOutput(field: "audioOutputId" | "notificationOutputId") {
    const media = navigator.mediaDevices as MediaDevices & {
      selectAudioOutput?: (options?: {
        deviceId: string;
      }) => Promise<MediaDeviceInfo>;
    };
    if (!media.selectAudioOutput) return;
    try {
      const chosen = await media.selectAudioOutput({
        deviceId: preferences[field],
      });
      update({ [field]: chosen.deviceId });
      await settings.refresh();
    } catch {
      /* Cancelling preserves the current selection. */
    }
  }
  const outputPicker = (field: "audioOutputId" | "notificationOutputId") =>
    canChooseOutput ? (
      <button
        type="button"
        className="device-output-picker"
        onClick={() => void chooseOutput(field)}
      >
        Выбрать другое устройство
      </button>
    ) : !outputSupported ? (
      <p className="device-hint">
        Устройство воспроизведения выбирается в настройках системы.
      </p>
    ) : null;
  return (
    <section
      className={`reference-devices reference-${section}`}
      id={`${section}-settings`}
      aria-labelledby="devices-heading"
    >
      <header className="settings-reference-heading">
        <h2 id="devices-heading">{section === "audio" ? "Аудио" : "Видео"}</h2>
        <p>
          {section === "audio"
            ? "Подготовьте звук к следующей встрече."
            : "Предпросмотр доступен только вам."}
        </p>
      </header>
      {!available && (
        <p className="device-error" role="status">
          Устройства недоступны. Проверьте разрешения системы и подключение.
        </p>
      )}
      {settings.deviceError && (
        <p className="device-error" role="alert">
          {settings.deviceError}
        </p>
      )}
      {section === "audio" ? (
        <div className="settings-audio-cards">
          <section
            className="settings-device-card"
            aria-labelledby="microphone-title"
          >
            <header>
              <Mic size={18} />
              <h3 id="microphone-title">Микрофон</h3>
              <LevelMeter
                stream={microphone.stream}
                volume={preferences.microphoneVolume}
                label="Уровень микрофона"
              />
            </header>
            <div className="device-select-row">
              <DeviceSelect
                devices={devices}
                kind="audioinput"
                label="Микрофон"
                value={preferences.audioInputId}
                onChange={(id) => update({ audioInputId: id })}
                disabled={!available}
              />
              <button
                type="button"
                className="device-test"
                disabled={!available || microphone.loading}
                onClick={() => {
                  if (microphone.error && checking) microphone.retry();
                  else setChecking(!checking);
                }}
              >
                {checking && !microphone.error ? (
                  <Square size={16} />
                ) : (
                  <Play size={16} />
                )}
                {checking && !microphone.error ? "Остановить" : "Проверить"}
              </button>
            </div>
            <p className="device-hint">
              {microphone.loading
                ? "Подключаем микрофон…"
                : microphone.stream
                  ? "Говорите — индикатор показывает уровень вашего голоса."
                  : "Проверьте микрофон перед встречей."}
            </p>
            {microphone.error && (
              <p className="device-error" role="alert">
                {microphone.error}
              </p>
            )}
            <Volume
              label="Громкость микрофона"
              value={preferences.microphoneVolume}
              onChange={(microphoneVolume) => update({ microphoneVolume })}
            />
            <div className="settings-device-toggles">
              <Toggle
                label="Подключаться с выключенным микрофоном"
                checked={!preferences.microphoneEnabled}
                onChange={(muted) => update({ microphoneEnabled: !muted })}
              />
              <Toggle
                label="Шумоподавление"
                hint={
                  noiseSupported
                    ? "Уменьшать фоновые звуки"
                    : "Недоступно в этой среде"
                }
                checked={preferences.noiseSuppression}
                disabled={!noiseSupported}
                onChange={(noiseSuppression) => update({ noiseSuppression })}
              />
            </div>
          </section>
          <section
            className="settings-device-card"
            aria-labelledby="speaker-title"
          >
            <header>
              <Volume2 size={18} />
              <h3 id="speaker-title">Динамик</h3>
              <LevelMeter
                playing={speakerPlaying && preferences.outputVolume > 0}
                label="Уровень динамика"
              />
            </header>
            <div className="device-select-row">
              <DeviceSelect
                devices={devices}
                kind="audiooutput"
                label="Динамик"
                value={preferences.audioOutputId}
                onChange={(audioOutputId) => update({ audioOutputId })}
                disabled={!outputSupported}
              />
              <SpeakerTest
                sinkId={preferences.audioOutputId}
                label="динамик"
                volume={preferences.outputVolume}
                onPlaying={setSpeakerPlaying}
              />
            </div>
            {outputPicker("audioOutputId")}
            <Volume
              label="Громкость динамика"
              value={preferences.outputVolume}
              onChange={(outputVolume) => update({ outputVolume })}
            />
          </section>
          <section
            className="settings-device-card"
            aria-labelledby="signals-title"
          >
            <header>
              <Bell size={18} />
              <h3 id="signals-title">Звонки и уведомления</h3>
            </header>
            <p className="device-hint">
              Громкость сигнала вызова и уведомлений о сообщениях, приглашениях
              и скором начале встречи.
            </p>
            <label className="settings-device-field">
              <span>Источник звука</span>
              <DeviceSelect
                devices={devices}
                kind="audiooutput"
                label="Источник звука"
                value={preferences.notificationOutputId}
                onChange={(notificationOutputId) =>
                  update({ notificationOutputId })
                }
                disabled={!outputSupported}
              />
            </label>
            {outputPicker("notificationOutputId")}
            <Volume
              label="Громкость сигналов"
              value={preferences.signalVolume}
              onChange={(signalVolume) => update({ signalVolume })}
            />
            <SpeakerTest
              sinkId={preferences.notificationOutputId}
              label="звонки и уведомления"
              volume={signalGain(preferences.signalVolume) * 100}
            />
          </section>
        </div>
      ) : (
        <section className="settings-device-card settings-video-card">
          <div
            className={`device-camera-preview settings-camera-preview ${camera.stream ? "has-stream" : ""}`}
          >
            <video
              ref={video}
              autoPlay
              muted
              playsInline
              aria-label="Предпросмотр камеры"
            />
            {!camera.stream && (
              <div className="settings-camera-placeholder">
                <UserAvatar
                  id={user?.id}
                  name={user?.displayName || user?.email || "Вы"}
                  version={user?.avatarVersion}
                  className="settings-preview-avatar"
                />
                <span>
                  {camera.loading
                    ? "Подключаем камеру…"
                    : "Предпросмотр камеры"}
                </span>
                <span className="settings-camera-status">
                  <VideoOff size={13} />
                  Камера выключена
                </span>
              </div>
            )}
            <button
              className="settings-camera-control"
              type="button"
              disabled={!available || camera.loading}
              onClick={() => {
                if (camera.error && cameraPreview) camera.retry();
                else setCameraPreview(!cameraPreview);
              }}
              aria-label={
                camera.stream
                  ? "Выключить предпросмотр камеры"
                  : "Включить предпросмотр камеры"
              }
            >
              {camera.stream ? <VideoOff size={16} /> : <Video size={16} />}
              {camera.stream
                ? "Выключить"
                : camera.error
                  ? "Повторить"
                  : "Включить"}
            </button>
          </div>
          {camera.error && (
            <p className="device-error" role="alert">
              {camera.error}
            </p>
          )}
          <label className="settings-device-field">
            <span>Камера</span>
            <DeviceSelect
              devices={devices}
              kind="videoinput"
              label="Камера"
              value={preferences.videoInputId}
              onChange={(videoInputId) => update({ videoInputId })}
              disabled={!available}
            />
          </label>
          <div className="settings-device-toggles">
            <Toggle
              label="Подключаться с выключенной камерой"
              checked={!preferences.cameraEnabled}
              onChange={(muted) => update({ cameraEnabled: !muted })}
            />
            <Toggle
              label="Видеть себя на звонке"
              hint="Ваше видео или аватар"
              checked={preferences.showSelf}
              onChange={(showSelf) => update({ showSelf })}
            />
            <Toggle
              label="Скрыть видео участников"
              hint="Снижает нагрузку на сеть. Звук сохраняется; видео и экраны скрываются."
              checked={preferences.hideParticipantVideo}
              onChange={(hideParticipantVideo) =>
                update({ hideParticipantVideo })
              }
            />
          </div>
        </section>
      )}
      <p className="settings-device-caption settings-autosave">
        Настройки сохраняются автоматически для этого аккаунта и сервера.
      </p>
    </section>
  );
}

function Volume({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-device-field settings-volume">
      <span>
        {label}
        <output>{value}%</output>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
