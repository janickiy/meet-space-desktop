import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopTransportEvent, DesktopDisplayCaptureEvent } from "./shared/contracts";

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: Result<T> = await ipcRenderer.invoke(channel, ...args);
  if (!result || typeof result !== "object") throw new Error("Некорректный ответ приложения");
  if (result.ok) return result.value;
  const error = new Error(result.error.message) as Error & { code: string };
  error.code = result.error.code;
  throw error;
}

// Sandboxed preload is self-contained: only the Electron import exists at runtime.
const bridge: DesktopBridge = {
  bridgeVersion: 5,
  getRuntimeInfo: () => ipcRenderer.invoke("meetspace:runtime"),
  openExternal: (url) => ipcRenderer.invoke("meetspace:external", url),
  minimize: () => ipcRenderer.invoke("meetspace:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("meetspace:maximize"),
  close: () => ipcRenderer.invoke("meetspace:close"),
  quit: () => ipcRenderer.invoke("meetspace:quit"),
  getUpdateState: () => invoke("meetspace:update:state"),
  checkUpdates: () => invoke("meetspace:update:check"),
  downloadUpdate: () => invoke("meetspace:update:download"),
  cancelUpdate: () => invoke("meetspace:update:cancel"),
  installUpdate: () => invoke("meetspace:update:install"),
  getNativePreferences: () => invoke("meetspace:native:preferences"),
  setNativePreferences: (input) => invoke("meetspace:native:preferences:set", input),
  setNotificationContext: (input) => invoke("meetspace:native:notification-context", input),
  saveAsset: (input) => invoke("meetspace:asset:save", input),
  openRecordingMedia: (input) => invoke("meetspace:asset:open", input),
  closeRecordingMedia: (id) => invoke("meetspace:asset:close", id),
  cancelAsset: (id) => invoke("meetspace:asset:cancel", id),
  listServers: () => invoke("meetspace:servers:list"),
  probeServer: (origin) => invoke("meetspace:servers:probe", origin),
  addServer: (input) => invoke("meetspace:servers:add", input),
  selectServer: (id) => invoke("meetspace:servers:select", id),
  removeServer: (id) => invoke("meetspace:servers:remove", id),
  http: (request) => invoke("meetspace:http", request),
  abortRequest: (id) => invoke("meetspace:http:abort", id),
  openStream: (request) => invoke("meetspace:stream:open", request),
  closeStream: (id) => invoke("meetspace:stream:close", id),
  openSocket: (request) => invoke("meetspace:socket:open", request),
  sendSocket: (id, data) => invoke("meetspace:socket:send", id, data),
  closeSocket: (id) => invoke("meetspace:socket:close", id),
  selectDisplaySource: (input) => invoke("meetspace:display:select", input),
  cancelDisplaySource: (id) => invoke("meetspace:display:cancel", id),
  onDisplayCaptureEvent(handler) {
    if (typeof handler !== "function") throw new TypeError("A capture listener is required");
    const listener = (_event: unknown, value: DesktopDisplayCaptureEvent) => handler(value);
    ipcRenderer.on("meetspace:display-capture", listener);
    return () => ipcRenderer.removeListener("meetspace:display-capture", listener);
  },
  onTransportEvent(handler) {
    if (typeof handler !== "function") throw new TypeError("A transport listener is required");
    const listener = (_event: unknown, value: DesktopTransportEvent) => handler(value);
    ipcRenderer.on("meetspace:transport", listener);
    return () => ipcRenderer.removeListener("meetspace:transport", listener);
  },
  onRoute(handler) {
    if (typeof handler !== "function")
      throw new TypeError("A route listener is required");
    const listener = (_event: unknown, route: unknown) => {
      if (typeof route === "string" && route.length <= 512) handler(route);
    };
    ipcRenderer.on("meetspace:route", listener);
    void ipcRenderer.invoke("meetspace:route-ready").catch(() => {});
    return () => ipcRenderer.removeListener("meetspace:route", listener);
  },
};
contextBridge.exposeInMainWorld("meetspaceDesktop", Object.freeze(bridge));
