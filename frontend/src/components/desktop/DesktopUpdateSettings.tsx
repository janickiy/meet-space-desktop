import { useEffect, useState } from "react";
import { desktopBridge } from "../../platform/desktop";
import type {
  DesktopRuntimeInfo,
  DesktopUpdateState,
} from "../../platform/desktop-contracts";
import { Button, ErrorNotice, Loading } from "../ui";

const failures: Record<string, string> = {
  update_changed:
    "Обновление изменилось на сервере. Проверьте доступную версию ещё раз.",
  update_integrity_invalid:
    "Проверка целостности не пройдена. Файл не будет установлен.",
  update_signature_invalid:
    "Подпись издателя не подтверждена. Файл не будет установлен.",
  update_manifest_invalid: "Не удалось подтвердить сведения об обновлении.",
  update_rollback_denied:
    "Сервер предложил более старую версию. Установка заблокирована.",
  update_disk_error:
    "Не удалось сохранить обновление. Проверьте свободное место.",
  update_install_failed:
    "Не удалось запустить установщик. Повторите проверку обновления.",
};

export function DesktopUpdateSettings({
  hostPlatform,
}: {
  hostPlatform?: DesktopRuntimeInfo["platform"];
}) {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const bridge = desktopBridge();
    const unsubscribe = bridge.onTransportEvent((event) => {
      if (alive && event.kind === "update") setState(event.state);
    });
    void bridge
      .getUpdateState()
      .then((value) => {
        if (alive) setState(value);
      })
      .catch((value) => {
        if (alive) setError(value);
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  const action = async (
    operation:
      "checkUpdates" | "downloadUpdate" | "cancelUpdate" | "installUpdate",
  ) => {
    setBusy(true);
    setError(undefined);
    try {
      setState(await desktopBridge()[operation]());
    } catch (value) {
      setError(value);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="desktop-native-updates"
      aria-labelledby="desktop-update-heading"
    >
      <h3 id="desktop-update-heading">Обновления</h3>
      <ErrorNotice error={error} />
      {!state && !error && <Loading />}
      {state && (
        <>
          <p className="field-hint">
            Установленная версия:{" "}
            {state.currentVersion.replace(/-beta(?=\.|$)/, " beta")}
            {state.code === "update_not_configured" && " · тестовая сборка"}
          </p>
          <p role="status" aria-live="polite">
            {!state.enabled
              ? hostPlatform === "linux"
                ? "Автоматическое обновление Linux не настроено. Пакеты DEB/RPM обновляйте через системный менеджер пакетов. AppImage заменяйте новой проверенной версией."
                : state.code === "update_not_configured"
                  ? "Обновления недоступны в этой сборке. Издатель, подпись и канал выпуска ещё не настроены."
                  : "Обновления отключены: не удалось подтвердить доверие к приложению или эта среда не поддерживается."
              : state.phase === "idle"
                ? "Новых обновлений нет. Проверка выполняется автоматически."
                : state.phase === "checking"
                  ? "Проверяем обновления…"
                  : state.phase === "available"
                    ? `Доступна версия ${state.availableVersion}.`
                    : state.phase === "downloading"
                      ? `Скачиваем версию ${state.availableVersion}: ${state.percent ?? 0}%.`
                      : state.phase === "ready"
                        ? `Версия ${state.availableVersion} скачана и проверена.`
                        : state.phase === "installing"
                          ? "Запускаем установщик. MeetSpace закроется."
                          : (failures[state.code ?? ""] ??
                            "Не удалось проверить обновление. Повторите попытку позже.")}
          </p>
          {state.enabled && (
            <div className="desktop-native-exit">
              {["idle", "error", "available", "ready"].includes(
                state.phase,
              ) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void action("checkUpdates")}
                >
                  Проверить обновления
                </Button>
              )}
              {state.phase === "available" && (
                <Button
                  disabled={busy}
                  onClick={() => void action("downloadUpdate")}
                >
                  Скачать обновление
                </Button>
              )}
              {["checking", "downloading", "ready"].includes(state.phase) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void action("cancelUpdate")}
                >
                  Отменить обновление
                </Button>
              )}
              {state.phase === "ready" && (
                <>
                  <p className="field-hint">
                    Установка закроет приложение и завершит текущий звонок.
                    После установки запустите MeetSpace снова.
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() => void action("installUpdate")}
                  >
                    Закрыть MeetSpace и установить
                  </Button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
