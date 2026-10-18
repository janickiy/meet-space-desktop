import { useEffect, useRef, useState } from "react";
import { desktopBridge } from "../../platform/desktop";
import { platform } from "../../platform";
import type {
  DesktopRuntimeInfo,
  DesktopNativePreferences,
} from "../../platform/desktop-contracts";
import { Button, ErrorNotice, Loading } from "../ui";
import "./desktop-native-settings.css";
import { DesktopUpdateSettings } from "./DesktopUpdateSettings";
import {
  createNativePreferencesController,
  watchNativePreferences,
} from "../../platform/nativePreferences";

export function DesktopNativeSettings() {
  const [settings, setSettings] = useState<DesktopNativePreferences | null>(
    null,
  );
  const [runtime, setRuntime] = useState<DesktopRuntimeInfo | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const controller = useRef<ReturnType<
    typeof createNativePreferencesController
  > | null>(null);
  useEffect(() => {
    let alive = true;
    const current = createNativePreferencesController(desktopBridge(), {
      value(value) {
        setSettings(value);
        setError(undefined);
      },
      error: setError,
      busy: setBusy,
    });
    controller.current = current;
    const stopWatching = watchNativePreferences(
      current.refresh,
      document,
      window,
    );
    void platform
      .getRuntimeInfo()
      .then((host) => {
        if (alive) setRuntime(host);
      })
      .catch((value) => {
        if (alive) setError(value);
      });
    return () => {
      alive = false;
      stopWatching();
      current.dispose();
      controller.current = null;
    };
  }, []);
  const update = (
    input: Parameters<
      ReturnType<typeof desktopBridge>["setNativePreferences"]
    >[0],
  ) => {
    setError(undefined);
    controller.current?.update(input);
  };
  const trayStatus =
    settings?.trayStatus ??
    (settings?.trayAvailable ? "available" : "unavailable");
  const trayAvailable = trayStatus === "available" && settings?.trayAvailable;
  return (
    <section
      className="content-card desktop-native-settings"
      aria-labelledby="desktop-native-heading"
    >
      <h2 id="desktop-native-heading">Приложение</h2>
      <p className="field-hint">Настройки MeetSpace на этом компьютере.</p>
      <ErrorNotice error={error} />
      {!settings && !error && <Loading />}
      {settings && (
        <>
          <label className="desktop-native-toggle">
            <input
              type="checkbox"
              checked={settings.closeToTray}
              disabled={busy || !trayAvailable}
              onChange={(event) =>
                void update({ closeToTray: event.target.checked })
              }
            />
            <span>При закрытии окна сворачивать в трей</span>
          </label>
          <p className="field-hint">
            {trayAvailable && settings.closeToTray
              ? "Звонок и получение сообщений продолжатся. Для полного закрытия выберите «Выход из MeetSpace» в меню трея или нажмите кнопку ниже."
              : "Закрытие окна завершает приложение. Для полного закрытия также можно нажать кнопку ниже."}
          </p>
          {!trayAvailable && (
            <p role="status">
              {trayStatus === "checking"
                ? "Проверяем доступность системного трея. Пока проверка не завершена, закрытие окна завершает приложение."
                : "Системный трей недоступен в текущем сеансе."}
            </p>
          )}
          <label className="desktop-native-toggle">
            <input
              type="checkbox"
              checked={settings.nativeNotifications}
              disabled={busy || !settings.notificationsSupported}
              onChange={(event) =>
                void update({ nativeNotifications: event.target.checked })
              }
            />
            <span>Системные уведомления</span>
          </label>
          <p className="field-hint">
            Учитываются настройки уведомлений аккаунта. Разрешение и режим «Не
            беспокоить» управляются системой.
          </p>
          {!settings.notificationsSupported && (
            <p role="status">Системные уведомления недоступны в этой среде.</p>
          )}
          <label className="desktop-native-toggle">
            <input
              type="checkbox"
              checked={settings.startAtLogin}
              disabled={busy || !settings.startupSupported}
              onChange={(event) =>
                void update({ startAtLogin: event.target.checked })
              }
            />
            <span>Запускать MeetSpace при входе в систему</span>
          </label>
          {!settings.startupSupported && (
            <p className="field-hint">
              {settings.startupReason === "conflict"
                ? "Автозапуск уже настроен другим способом. Измените существующую настройку автозапуска в системе."
                : runtime?.platform === "linux"
                  ? "Автозапуск можно включить в установленном приложении Linux, если он доступен в текущем сеансе. Пока открывайте MeetSpace через меню приложений."
                  : runtime?.platform === "win32"
                    ? "Автозапуск можно включить в установленном приложении Windows."
                    : "Автозапуск в этой среде пока недоступен."}
            </p>
          )}
          <div className="desktop-native-exit">
            <Button
              variant="outline"
              onClick={() => void desktopBridge().quit().catch(setError)}
            >
              Выход из MeetSpace
            </Button>
          </div>
        </>
      )}
      <DesktopUpdateSettings hostPlatform={runtime?.platform} />
    </section>
  );
}
