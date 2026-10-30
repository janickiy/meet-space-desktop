import { useEffect, useRef, useState } from "react";
import { Monitor, AppWindow } from "lucide-react";
import { Button, ErrorNotice, Modal } from "../ui";
import { desktopBridge } from "../../platform/desktop";
import { useDesktopRuntime } from "../../platform/runtime";
import type { DesktopDisplayCaptureEvent } from "../../platform/desktop-contracts";
import "./desktop-screen-picker.css";

type CaptureRequest = Extract<
  DesktopDisplayCaptureEvent,
  { type: "request" | "portal" | "unavailable" | "denied" | "error" }
>;

function retireRequest(discarded: Set<string>, id: string) {
  discarded.add(id);
  if (discarded.size > 64) {
    const oldest = discarded.values().next().value;
    if (oldest) discarded.delete(oldest);
  }
}

/** A choice belongs to one pending native getDisplayMedia request only. */
export function DesktopScreenPicker() {
  const runtime = useDesktopRuntime();
  const [request, setRequest] = useState<CaptureRequest | null>(null);
  const [selected, setSelected] = useState("");
  const [systemAudio, setSystemAudio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<string | null>(null);
  const phase = useRef<CaptureRequest["type"] | null>(null);
  const discarded = useRef(new Set<string>());
  useEffect(() => {
    const bridge = desktopBridge();
    const unsubscribe = bridge.onDisplayCaptureEvent((event) => {
      // IPC can deliver a terminal event after its dialog was already closed.
      if (discarded.current.has(event.requestId)) return;
      if (event.type === "cancelled") {
        if (pending.current !== event.requestId) return;
        retireRequest(discarded.current, event.requestId);
        pending.current = null;
        phase.current = null;
        setRequest(null);
        return;
      }
      if (
        (event.type === "denied" || event.type === "error") &&
        pending.current &&
        pending.current !== event.requestId
      )
        return;
      if (pending.current && pending.current !== event.requestId)
        retireRequest(discarded.current, pending.current);
      pending.current = event.requestId;
      phase.current = event.type;
      setRequest(event);
      setSelected("");
      setSystemAudio(false);
      setBusy(false);
      setError("");
    });
    return () => {
      unsubscribe();
      const id = pending.current;
      pending.current = null;
      if (id) retireRequest(discarded.current, id);
      if (id) void bridge.cancelDisplaySource(id).catch(() => {});
    };
  }, []);
  if (!request) return null;
  function cancel() {
    const id = pending.current;
    if (id) retireRequest(discarded.current, id);
    pending.current = null;
    phase.current = null;
    setRequest(null);
    if (id)
      void desktopBridge()
        .cancelDisplaySource(id)
        .catch(() => {});
  }
  async function share() {
    if (!request || request.type !== "request" || !selected || busy) return;
    const id = request.requestId;
    setBusy(true);
    setError("");
    try {
      await desktopBridge().selectDisplaySource({
        requestId: id,
        sourceId: selected,
        systemAudio: request.systemAudioAvailable && systemAudio,
      });
      // A native terminal event can arrive before the selection promise settles.
      // Keep its permission guidance visible until the user closes it.
      if (pending.current === id && phase.current === "request") {
        retireRequest(discarded.current, id);
        pending.current = null;
        phase.current = null;
        setRequest(null);
      }
    } catch {
      if (pending.current === id && phase.current === "request") {
        setBusy(false);
        setError(
          "Не удалось начать демонстрацию. Выберите источник снова или закройте окно и повторите попытку.",
        );
      }
    }
  }
  return (
    <Modal
      title={
        request.type === "portal"
          ? "Выберите источник в системном диалоге"
          : request.type === "denied"
            ? "Разрешите запись экрана"
            : request.type === "unavailable" || request.type === "error"
              ? "Демонстрация экрана"
              : "Что показать участникам?"
      }
      onClose={cancel}
      className="desktop-capture-modal"
    >
      <p className="desktop-capture-description">
        {request.type === "portal"
          ? "Выберите экран или окно в системном диалоге. Если передумали, отмените выбор в нём."
          : request.type === "denied"
            ? "macOS не разрешила MeetSpace запись экрана. Откройте «Системные настройки» → «Конфиденциальность и безопасность» → «Запись экрана и системного аудио» (Screen Recording) и разрешите доступ для MeetSpace. После изменения разрешения может потребоваться закрыть MeetSpace через ⌘Q и открыть снова. Затем начните демонстрацию и выберите источник."
            : request.type === "error"
              ? "Не удалось получить выбранный экран или окно. Проверьте, что оно открыто, затем начните демонстрацию снова."
              : request.type === "unavailable"
                ? runtime?.platform === "darwin"
                  ? "Демонстрация экрана недоступна в этом сеансе. Откройте рабочий стол macOS и проверьте разрешение записи экрана для MeetSpace в системных настройках."
                  : "Демонстрация экрана недоступна в этом сеансе. Перезапустите MeetSpace в сеансе рабочего стола X11 или Wayland."
                : "Выберите экран или окно. Участники увидят всё содержимое выбранного источника."}
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {request.type === "portal" ? (
        <p className="desktop-capture-description" role="status">
          Ожидаем ваш выбор в системном диалоге. Передаётся изображение без
          звука компьютера.
        </p>
      ) : request.type !== "request" ? null : !request.sources.length ? (
        <ErrorNotice>
          Не удалось получить экраны и окна. Повторите выбор и проверьте
          системный диалог демонстрации.
        </ErrorNotice>
      ) : (
        <div
          className="desktop-capture-grid"
          role="group"
          aria-label="Экран или окно для демонстрации"
        >
          {request.sources.map((source) => (
            <button
              type="button"
              className="desktop-capture-source"
              key={source.id}
              aria-pressed={selected === source.id}
              disabled={busy}
              onClick={() => setSelected(source.id)}
            >
              {source.thumbnail ? (
                <img src={source.thumbnail} alt="" />
              ) : (
                <span className="desktop-capture-thumbnail" />
              )}
              <span>
                {source.kind === "screen" ? (
                  <Monitor size={18} aria-hidden="true" />
                ) : (
                  <AppWindow size={18} aria-hidden="true" />
                )}
                {source.name}
              </span>
            </button>
          ))}
        </div>
      )}
      {request.type === "request" && request.systemAudioAvailable && (
        <label className="desktop-capture-audio">
          <input
            type="checkbox"
            checked={systemAudio}
            disabled={busy}
            onChange={(event) => setSystemAudio(event.target.checked)}
          />
          <span>
            Передавать звук компьютера
            <small>
              Звук всех приложений, в том числе при выборе одного окна.
            </small>
          </span>
        </label>
      )}
      {request.type === "request" && !request.systemAudioAvailable && (
        <p className="desktop-capture-description">
          Передаётся изображение без звука компьютера.
        </p>
      )}
      <div className="desktop-capture-actions">
        <Button variant="secondary" onClick={cancel}>
          {request.type === "portal"
            ? "Отменить запрос"
            : request.type !== "request"
              ? "Закрыть"
              : "Отмена"}
        </Button>
        {request.type === "request" && (
          <Button disabled={!selected || busy} onClick={() => void share()}>
            {busy ? "Подключение…" : "Поделиться"}
          </Button>
        )}
      </div>
    </Modal>
  );
}
