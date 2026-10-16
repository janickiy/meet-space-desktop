import { useEffect, useRef, useState } from "react";
import { Monitor, AppWindow } from "lucide-react";
import { Button, ErrorNotice, Modal } from "../ui";
import { desktopBridge } from "../../platform/desktop";
import type { DesktopDisplayCaptureEvent } from "../../platform/desktop-contracts";
import "./desktop-screen-picker.css";

type CaptureRequest = Extract<DesktopDisplayCaptureEvent, { type: "request" }>;

/** A choice belongs to one pending native getDisplayMedia request only. */
export function DesktopScreenPicker() {
  const [request, setRequest] = useState<CaptureRequest | null>(null);
  const [selected, setSelected] = useState("");
  const [systemAudio, setSystemAudio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const bridge = desktopBridge();
    const unsubscribe = bridge.onDisplayCaptureEvent((event) => {
      if (event.type === "cancelled") {
        if (pending.current !== event.requestId) return;
        pending.current = null;
        setRequest(null);
        return;
      }
      pending.current = event.requestId;
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
      if (id) void bridge.cancelDisplaySource(id).catch(() => {});
    };
  }, []);
  if (!request) return null;
  function cancel() {
    const id = pending.current;
    pending.current = null;
    setRequest(null);
    if (id)
      void desktopBridge()
        .cancelDisplaySource(id)
        .catch(() => {});
  }
  async function share() {
    if (!request || !selected || busy) return;
    const id = request.requestId;
    setBusy(true);
    setError("");
    try {
      await desktopBridge().selectDisplaySource({
        requestId: id,
        sourceId: selected,
        systemAudio: request.systemAudioAvailable && systemAudio,
      });
      if (pending.current === id) {
        pending.current = null;
        setRequest(null);
      }
    } catch {
      if (pending.current === id) {
        setBusy(false);
        setError(
          "Не удалось начать демонстрацию. Выберите источник снова или закройте окно и повторите попытку.",
        );
      }
    }
  }
  return (
    <Modal
      title="Что показать участникам?"
      onClose={cancel}
      className="desktop-capture-modal"
    >
      <p className="desktop-capture-description">
        Выберите экран или окно. Участники увидят всё содержимое выбранного
        источника.
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {!request.sources.length ? (
        <ErrorNotice>
          Нет доступных экранов и окон. Проверьте разрешение на запись экрана в
          настройках системы и повторите попытку.
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
      {request.systemAudioAvailable && (
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
      <div className="desktop-capture-actions">
        <Button variant="secondary" onClick={cancel}>
          Отмена
        </Button>
        <Button disabled={!selected || busy} onClick={() => void share()}>
          {busy ? "Подключение…" : "Поделиться"}
        </Button>
      </div>
    </Modal>
  );
}
