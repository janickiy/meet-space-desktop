/** Shared declarations only: the web build never imports the Electron package. */
export interface DesktopRuntimeInfo {
  platform: "win32" | "darwin" | "linux";
  arch: "x64" | "arm64";
  appVersion: string;
  isPackaged: boolean;
  capabilities: { serverConnection: true; windowControls: true };
  host: DesktopHostInfo;
}
export interface DesktopHostInfo {
  session: "x11" | "wayland" | "unknown" | "not-applicable";
  secureStorage: {
    available: boolean;
    backend:
      | "dpapi"
      | "keychain"
      | "gnome-libsecret"
      | "kwallet"
      | "kwallet5"
      | "kwallet6"
      | "basic_text"
      | "unknown";
    reason: "available" | "unavailable" | "insecure-backend";
  };
  supports: {
    startup: boolean;
    absoluteWindowPosition: boolean;
    systemAudio: boolean;
  };
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
  | {
      kind: "notification-sound";
      profileId: string;
      userId: string;
      id: string;
    }
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
  | { type: "portal"; requestId: string }
  | { type: "unavailable"; requestId: string }
  | { type: "denied"; requestId: string }
  | { type: "error"; requestId: string }
  | { type: "cancelled"; requestId: string };
export interface DesktopNativePreferences {
  closeToTray: boolean;
  nativeNotifications: boolean;
  startAtLogin: boolean;
  startupSupported: boolean;
  notificationsSupported: boolean;
  trayAvailable: boolean;
  trayStatus?: "checking" | "available" | "unavailable";
  startupReason?:
    "unpackaged" | "unavailable" | "conflict" | "approval-required";
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
/** Public SSH wizard metadata only. Credentials are never returned or persisted. */
export type SshInstallerAction =
  | "discover"
  | "acceptHostKey"
  | "preflight"
  | "plan"
  | "apply"
  | "status"
  | "cancel"
  | "resume"
  | "detach"
  | "forget";
export type SshInstallerCredentials =
  | { kind: "password"; password: string }
  | { kind: "privateKey"; privateKey: string; passphrase?: string };
export type SshInstallerImageMode = "images" | "source";
export type SshInstallerTlsMode = "letsencrypt" | "custom";
export interface SshInstallerState {
  busy: boolean;
  phase:
    | "idle"
    | "host-key"
    | "trusted"
    | "preflight"
    | "planned"
    | "running"
    | "completed"
    | "error";
  endpoint?: { host: string; port: number; user: string };
  identity?: {
    fingerprint: string;
    algorithm: string;
    previousFingerprint?: string;
    changed: boolean;
    trusted: boolean;
  };
  preflight?: {
    domain: string;
    publicIpv4?: string;
    ready: boolean;
    checkedAt: string;
    checks: Array<{
      id: string;
      title: string;
      level: "pass" | "warn" | "blocked" | "unknown";
      detail: string;
    }>;
  };
  plan?: {
    hash: string;
    version: string;
    commit: string;
    options: {
      domain: string;
      publicIpv4: string;
      acmeEmail?: string;
      tlsMode?: SshInstallerTlsMode;
      certificateSha256?: string;
      imageMode?: SshInstallerImageMode;
      imageRelease?: string;
      smtp?: {
        host: string;
        port: number;
        from: string;
        username: string;
        tlsMode: "starttls" | "tls";
      };
    };
    architecture: "amd64" | "arm64";
    installDocker: boolean;
    expiresAt: number;
    existingJobId?: string;
    existingPlanHash?: string;
    sourceSelection?: string;
    sourceSha256: string;
    resourceProfile?: "standard" | "compact-test";
    installDockerPluginsOnly: boolean;
    missingDockerPlugins: string[];
    actions: string[];
    imageMode: SshInstallerImageMode;
    imageArchiveSha256?: string;
    imageArchiveBytes?: number;
  };
  ticket?: {
    jobId: string;
    domain: string;
    host: string;
    port: number;
    user: string;
    planHash: string;
  };
  status?: {
    jobId: string;
    state:
      | "running"
      | "cancel_requested"
      | "cancelled"
      | "needs_recovery"
      | "failed"
      | "completed";
    phase: string;
    completedPhases: string[];
    events: Array<{
      sequence: number;
      phase: string;
      state:
        | "running"
        | "cancel_requested"
        | "cancelled"
        | "needs_recovery"
        | "failed"
        | "completed";
      errorCode?: string;
    }>;
    errorCode?: string;
    terminal: boolean;
  };
  error?: { code: string; message: string };
  hasCredentials: boolean;
}
export interface DesktopBridge {
  readonly bridgeVersion: 6;
  getRuntimeInfo(): Promise<DesktopRuntimeInfo>;
  openExternal(url: string): Promise<void>;
  onRoute(handler: (route: string) => void): () => void;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  quit(): Promise<void>;
  getUpdateState(): Promise<DesktopUpdateState>;
  getSshInstallerState(): Promise<SshInstallerState>;
  sshInstaller(
    action: SshInstallerAction,
    input?: unknown,
  ): Promise<SshInstallerState>;
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
