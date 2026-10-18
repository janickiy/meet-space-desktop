import type {
  DesktopBridge,
  DesktopRuntimeInfo,
  PlatformAdapter,
} from "./types";
import { desktopRoute, externalServiceURL } from "./urls";

export function desktopBridge(): DesktopBridge {
  const value = window.meetspaceDesktop;
  if (
    !value ||
    value.bridgeVersion !== 6 ||
    ![
      value.getRuntimeInfo,
      value.openExternal,
      value.onRoute,
      value.minimize,
      value.toggleMaximize,
      value.close,
      value.quit,
      value.getUpdateState,
      value.getSshInstallerState,
      value.sshInstaller,
      value.checkUpdates,
      value.downloadUpdate,
      value.cancelUpdate,
      value.installUpdate,
      value.getNativePreferences,
      value.setNativePreferences,
      value.setNotificationContext,
      value.saveAsset,
      value.openRecordingMedia,
      value.closeRecordingMedia,
      value.cancelAsset,
      value.listServers,
      value.probeServer,
      value.addServer,
      value.selectServer,
      value.removeServer,
      value.http,
      value.abortRequest,
      value.openStream,
      value.closeStream,
      value.openSocket,
      value.sendSocket,
      value.closeSocket,
      value.onTransportEvent,
      value.onDisplayCaptureEvent,
      value.selectDisplaySource,
      value.cancelDisplaySource,
    ].every((method) => typeof method === "function")
  )
    throw new Error("Desktop bridge is unavailable");
  return value;
}

function validHost(value: DesktopRuntimeInfo): boolean {
  const host = value.host;
  if (
    !host ||
    typeof host !== "object" ||
    !["x11", "wayland", "unknown", "not-applicable"].includes(host.session)
  )
    return false;
  if ((value.platform === "linux") === (host.session === "not-applicable"))
    return false;
  const storage = host.secureStorage;
  if (
    !storage ||
    typeof storage.available !== "boolean" ||
    ![
      "dpapi",
      "keychain",
      "gnome-libsecret",
      "kwallet",
      "kwallet5",
      "kwallet6",
      "basic_text",
      "unknown",
    ].includes(storage.backend) ||
    !["available", "unavailable", "insecure-backend"].includes(storage.reason)
  )
    return false;
  if (
    storage.available !== (storage.reason === "available") ||
    (storage.available &&
      ["basic_text", "unknown"].includes(storage.backend)) ||
    (storage.reason === "insecure-backend" && storage.backend !== "basic_text")
  )
    return false;
  const supports = host.supports;
  return (
    !!supports &&
    [
      supports.startup,
      supports.absoluteWindowPosition,
      supports.systemAudio,
    ].every((value) => typeof value === "boolean")
  );
}

function runtimeInfo(value: DesktopRuntimeInfo): DesktopRuntimeInfo {
  if (
    !value ||
    !["win32", "darwin", "linux"].includes(value.platform) ||
    !["x64", "arm64"].includes(value.arch) ||
    typeof value.appVersion !== "string" ||
    value.appVersion.length > 80 ||
    typeof value.isPackaged !== "boolean" ||
    value.capabilities?.serverConnection !== true ||
    value.capabilities?.windowControls !== true ||
    !validHost(value)
  )
    throw new Error("Unsupported desktop runtime");
  return value;
}

export const desktopPlatform: PlatformAdapter = {
  kind: "desktop",
  async getRuntimeInfo() {
    return runtimeInfo(await desktopBridge().getRuntimeInfo());
  },
  async openExternal(url) {
    await desktopBridge().openExternal(externalServiceURL(url));
  },
  onRoute(handler) {
    return desktopBridge().onRoute((value) => {
      const route = desktopRoute(value);
      if (route) handler(route);
    });
  },
  windowControls: {
    async minimize() {
      await desktopBridge().minimize();
    },
    async toggleMaximize() {
      await desktopBridge().toggleMaximize();
    },
    async close() {
      await desktopBridge().close();
    },
  },
};
