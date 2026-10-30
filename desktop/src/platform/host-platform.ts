/** Host policy is deliberately independent of Electron and never returns raw environment values. */
export type HostPlatformName = "win32" | "darwin" | "linux";
export type DesktopSession = "x11" | "wayland" | "unknown" | "not-applicable";
export type DesktopEnvironment = "gnome" | "kde" | "cinnamon" | "xfce" | "mate" | "lxqt" | "unknown" | "not-applicable";

export interface HostPlatform {
  readonly platform: HostPlatformName;
  readonly arch: "x64" | "arm64";
  readonly osRelease: string;
  readonly packaged: boolean;
  readonly desktopSession: DesktopSession;
  readonly desktopEnvironment: DesktopEnvironment;
  readonly nativeFeatures: Readonly<{
    startup: boolean;
    absoluteWindowPosition: boolean;
    /** A constructed Linux Tray is insufficient evidence that a desktop displays it. */
    tray: "native" | "unverified";
  }>;
  readonly capture: Readonly<{ systemAudio: boolean }>;
  readonly messages: Readonly<{
    startupUnavailable: string;
    systemAudioUnavailable: string;
    trayUnavailable: string;
  }>;
}

export interface HostPlatformOptions {
  platform: NodeJS.Platform;
  arch: string;
  osRelease: string;
  packaged: boolean;
  env?: Readonly<Record<string, string | undefined>>;
}

function linuxSession(env: HostPlatformOptions["env"]): DesktopSession {
  const session = env?.XDG_SESSION_TYPE?.trim().toLowerCase();
  if (session === "wayland" || session === "x11") return session;
  if (env?.WAYLAND_DISPLAY?.trim()) return "wayland";
  if (env?.DISPLAY?.trim()) return "x11";
  return "unknown";
}

function linuxDesktop(env: HostPlatformOptions["env"]): DesktopEnvironment {
  const desktops = `${env?.XDG_CURRENT_DESKTOP ?? ""}:${env?.XDG_SESSION_DESKTOP ?? ""}`
    .toLowerCase().split(/[:;\s]+/);
  if (desktops.some(value => value === "gnome" || value === "ubuntu")) return "gnome";
  if (desktops.some(value => value === "kde" || value === "plasma")) return "kde";
  if (desktops.some(value => value === "cinnamon" || value === "x-cinnamon")) return "cinnamon";
  if (desktops.some(value => value === "xfce" || value === "xfce4")) return "xfce";
  if (desktops.includes("mate")) return "mate";
  if (desktops.includes("lxqt")) return "lxqt";
  return "unknown";
}

export function createHostPlatform(options: HostPlatformOptions): HostPlatform {
  if (!["win32", "darwin", "linux"].includes(options.platform) || !["x64", "arm64"].includes(options.arch))
    throw new Error("unsupported_platform");
  const platform = options.platform as HostPlatformName;
  const desktopSession = platform === "linux" ? linuxSession(options.env) : "not-applicable";
  const osRelease = /^[A-Za-z0-9._+\-]{1,128}$/.test(options.osRelease) ? options.osRelease : "unknown";
  return Object.freeze({
    platform,
    arch: options.arch as "x64" | "arm64",
    osRelease,
    packaged: options.packaged,
    desktopSession,
    desktopEnvironment: platform === "linux" ? linuxDesktop(options.env) : "not-applicable",
    nativeFeatures: Object.freeze({
      startup: platform === "win32" && options.packaged,
      // Wayland compositors own global placement; an unknown session must remain conservative.
      absoluteWindowPosition: platform !== "linux" || (desktopSession === "x11" && !options.env?.WAYLAND_DISPLAY?.trim()),
      tray: platform === "linux" ? "unverified" : "native",
    }),
    capture: Object.freeze({ systemAudio: platform === "win32" }),
    messages: Object.freeze({
      startupUnavailable: platform === "linux"
        ? "Автозапуск доступен в установленном приложении Linux с постоянным путём запуска."
        : platform === "win32"
          ? "Автозапуск доступен в установленном приложении Windows. Проверьте настройки системы."
          : "Автозапуск доступен для MeetSpace в папке «Программы». Разрешение управляется в системных настройках macOS.",
      systemAudioUnavailable: platform === "linux"
        ? "Передача системного звука в Linux пока не поддерживается."
        : platform === "darwin" ? "Передача системного звука в macOS пока не поддерживается." : "Передача системного звука недоступна.",
      trayUnavailable: platform === "linux"
        ? "Системный трей Linux недоступен. Проверьте поддержку индикаторов в рабочем столе. Закрытие окна завершает приложение."
        : platform === "darwin" ? "Значок в строке меню недоступен. MeetSpace остаётся доступен через Dock."
        : "Системный трей недоступен. Закрытие окна завершает приложение.",
    }),
  });
}
