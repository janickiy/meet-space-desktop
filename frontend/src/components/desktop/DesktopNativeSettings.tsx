import { useEffect, useState } from "react";
import { desktopBridge } from "../../platform/desktop";
import type { DesktopNativePreferences } from "../../platform/desktop-contracts";
import { Button, ErrorNotice, Loading } from "../ui";
import "./desktop-native-settings.css";
import { DesktopUpdateSettings } from "./DesktopUpdateSettings";

export function DesktopNativeSettings() {
  const [settings, setSettings] = useState<DesktopNativePreferences | null>(
    null,
  );
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void desktopBridge()
      .getNativePreferences()
      .then((value) => {
        if (alive) setSettings(value);
      })
      .catch((value) => {
        if (alive) setError(value);
      });
    return () => {
      alive = false;
    };
  }, []);
  const update = async (
    input: Parameters<
      ReturnType<typeof desktopBridge>["setNativePreferences"]
    >[0],
  ) => {
    setBusy(true);
    setError(undefined);
    try {
      setSettings(await desktopBridge().setNativePreferences(input));
    } catch (value) {
      setError(value);
    } finally {
      setBusy(false);
    }
  };
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
              disabled={busy || !settings.trayAvailable}
              onChange={(event) =>
                void update({ closeToTray: event.target.checked })
              }
            />
            <span>При закрытии окна сворачивать в трей</span>
          </label>
          <p className="field-hint">
            Звонок и получение сообщений продолжатся. Для полного закрытия
            выберите «Выход из MeetSpace» в меню трея или нажмите кнопку ниже.
          </p>
          {!settings.trayAvailable && (
            <p role="status">
              Системный трей недоступен. Закрытие окна завершает приложение.
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
            <span>Запускать MeetSpace при входе в Windows</span>
          </label>
          {!settings.startupSupported && (
            <p className="field-hint">
              Автозапуск можно включить в установленном приложении Windows.
            </p>
          )}
          <div className="desktop-native-exit">
            <Button
              variant="outline"
              onClick={() => void desktopBridge().quit()}
            >
              Выход из MeetSpace
            </Button>
          </div>
        </>
      )}
      <DesktopUpdateSettings />
    </section>
  );
}
