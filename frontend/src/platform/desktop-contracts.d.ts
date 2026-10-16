/** Shared declarations only: the web build never imports the Electron package. */
export interface DesktopRuntimeInfo {
  platform: "win32" | "darwin" | "linux";
  arch: "x64" | "arm64";
  appVersion: string;
  isPackaged: boolean;
  capabilities: { serverConnection: true; windowControls: true };
}
export interface DesktopServerProfile {
  id: string;
  origin: string;
  label: string;
  version?: string;
  commit?: string;
  lastCheckedAt?: string;
}
export interface DesktopServerState {
  items: DesktopServerProfile[];
  selectedId: string | null;
  generation: number;
  storageAvailable: boolean;
}
export interface DesktopProbeResult {
  origin: string;
  version: string;
  commit: string;
  buildTime: string;
  apiVersion: 1;
  authRequired: boolean;
}
export interface DesktopHttpRequest {
  id: string;
  method: string;
  path: string;
  body?: unknown;
  bytes?: Uint8Array;
  contentType?: string;
  responseType: "json" | "binary";
  /** Opaque, transient identity marker. Never an access token or credential. */
  token?: string | null;
}
export interface DesktopResponseHeaders {
  "content-type"?: string;
  "retry-after"?: string;
}
export interface DesktopHttpResponse {
  status: number;
  body: unknown | Uint8Array;
  headers: DesktopResponseHeaders;
}
export interface DesktopSocketRequest {
  id: string;
  kind: "account" | "conference";
  conferenceId?: string;
  clientId?: string;
  token?: string | null;
}
export type DesktopTransportEvent =
  | { kind: "update"; state: DesktopUpdateState }
  | { kind: "lifecycle"; type: "suspend" | "resume" | "quit" }
  | {
      kind: "asset";
      id: string;
      type: "progress";
      received: number;
      total?: number;
    }
  | {
      kind: "socket";
      id: string;
      type: "open" | "message" | "close" | "error";
      data?: string;
      code?: number;
      reason?: string;
    }
  | {
      kind: "stream";
      id: string;
      type: "headers" | "chunk" | "end" | "error";
      status?: number;
      headers?: DesktopResponseHeaders;
      data?: Uint8Array;
      error?: { code: string; message: string };
    }
  | { kind: "progress"; id: string; percent: number }
  | { kind: "servers"; type: "changed"; state: DesktopServerState };
export type DesktopDisplayCaptureEvent =
  | {
      type: "request";
      requestId: string;
      sources: Array<{
        id: string;
        name: string;
        kind: "screen" | "window";
        thumbnail: string;
      }>;
      systemAudioAvailable: boolean;
    }
  | { type: "cancelled"; requestId: string };
export interface DesktopNativePreferences {
  closeToTray: boolean;
  nativeNotifications: boolean;
  startAtLogin: boolean;
  startupSupported: boolean;
  notificationsSupported: boolean;
  trayAvailable: boolean;
}
export interface DesktopUpdateState {
  enabled: boolean;
  phase:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  code?: string;
}
export type DesktopAsset =
  | {
      kind: "recording";
      conferenceId: string;
      recordingId: string;
      fileId: string;
    }
  | {
      kind: "attachment";
      scope: "conference" | "conversation";
      scopeId: string;
      attachmentId: string;
      filename?: string;
    };
export interface DesktopAssetRequest {
  id: string;
  token: string;
  asset: DesktopAsset;
}
export interface DesktopBridge {
  readonly bridgeVersion: 5;
  getRuntimeInfo(): Promise<DesktopRuntimeInfo>;
  openExternal(url: string): Promise<void>;
  onRoute(handler: (route: string) => void): () => void;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  quit(): Promise<void>;
  getUpdateState(): Promise<DesktopUpdateState>;
  checkUpdates(): Promise<DesktopUpdateState>;
  downloadUpdate(): Promise<DesktopUpdateState>;
  cancelUpdate(): Promise<DesktopUpdateState>;
  installUpdate(): Promise<DesktopUpdateState>;
  getNativePreferences(): Promise<DesktopNativePreferences>;
  setNativePreferences(input: {
    closeToTray?: boolean;
    nativeNotifications?: boolean;
    startAtLogin?: boolean;
  }): Promise<DesktopNativePreferences>;
  setNotificationContext(input: {
    token: string | null;
    route: string;
    soundEnabled: boolean;
  }): Promise<void>;
  saveAsset(
    input: DesktopAssetRequest,
  ): Promise<{ cancelled: boolean; saved: boolean }>;
  openRecordingMedia(
    input: DesktopAssetRequest,
  ): Promise<{ id: string; url: string; mimeType: string }>;
  closeRecordingMedia(id: string): Promise<void>;
  cancelAsset(id: string): Promise<void>;
  listServers(): Promise<DesktopServerState>;
  probeServer(origin: string): Promise<DesktopProbeResult>;
  addServer(input: {
    origin: string;
    label?: string;
  }): Promise<DesktopServerState>;
  selectServer(id: string): Promise<DesktopServerState>;
  removeServer(id: string): Promise<DesktopServerState>;
  http(request: DesktopHttpRequest): Promise<DesktopHttpResponse>;
  abortRequest(id: string): Promise<void>;
  openStream(request: { id: string; token?: string | null }): Promise<void>;
  closeStream(id: string): Promise<void>;
  openSocket(request: DesktopSocketRequest): Promise<void>;
  sendSocket(id: string, data: string): Promise<void>;
  closeSocket(id: string): Promise<void>;
  onTransportEvent(handler: (event: DesktopTransportEvent) => void): () => void;
  onDisplayCaptureEvent(
    handler: (event: DesktopDisplayCaptureEvent) => void,
  ): () => void;
  selectDisplaySource(input: {
    requestId: string;
    sourceId: string;
    systemAudio: boolean;
  }): Promise<void>;
  cancelDisplaySource(requestId: string): Promise<void>;
}
