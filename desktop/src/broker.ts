import { randomUUID } from "node:crypto";
import tls from "node:tls";
import "./network/ws-runtime";
import WebSocket from "ws";
import type { DesktopHttpRequest, DesktopHttpResponse, DesktopProbeResult, DesktopResponseHeaders, DesktopServerState, DesktopSocketRequest, DesktopTransportEvent } from "./shared/contracts";
import type { NativeRequest, NativeResponse, NativeTransport, ResponseHeaders } from "./network/transport";
import { MAX_BINARY, MAX_JSON, authResponse, binaryPath, cookieOperation, normalizeServerOrigin, publicOperation, redactCredentials, validId, validRequestId, validateApiPath } from "./network/policy";
import { CookieVault, type Cipher } from "./session/vault";
import { safeAssetFilename, signedAssetUrl, validateAsset, type NativeAsset } from "./asset-policy";

export interface NativeIdentity { profileId: string; origin: string; userId: string; marker: string; generation: number; guest: boolean }
export interface NativeAssetLease {
  signal: AbortSignal;
  filename: string;
  mimeType: string;
  size?: number;
  expiresAt: number;
  playable: boolean;
  check(): void;
  release(): void;
  request(options: Pick<NativeRequest, "onHeaders" | "onChunk"> & { range?: string }): Promise<NativeResponse>;
}
type NotificationPreferences = { invitation: boolean; reminder: boolean; recording: boolean; summary: boolean };
import { ServerProfiles } from "./server/profiles";

export interface DesktopBrokerOptions {
  onIdentityInvalidated?(): void;
  onIdentityChanged?(identity: { profileId: string; userId: string } | null): void;
  onNotificationEvent?(event: unknown): void;
  onAccountEvent?(event: unknown): void;
  onNotificationPreferences?(preferences: NotificationPreferences): void;
  onNotificationUnread?(count: number): void;
  transport: NativeTransport;
  cipher: Cipher;
  storageDir: string;
  emit(event: DesktopTransportEvent): void;
  createSocket?: (url: string, protocols: string[], options: WebSocket.ClientOptions) => WebSocket;
}
interface Operation { controller: AbortController; epoch: number }
interface SocketRecord extends Operation { socket?: WebSocket; conferenceId?: string; messages: number; window: number; incoming: number; incomingWindow: number }
interface Identity { jwt: string; userId: string; marker: string; guest: boolean }
const AUTH = "/api/v1/auth/";
const encoder = new TextEncoder();
const allowedTypes = new Set(["webrtc.offer", "webrtc.answer", "webrtc.ice", "media.join", "media.offer", "media.answer", "media.ready", "media.ice", "media.leave", "media.unpublish"]);
const safeReasons = new Set(["authentication_expired", "authentication_revoked", "broker_unavailable", "state_unavailable", "authentication_unavailable", "slow_client", "server_shutdown", "replaced", "forbidden", "page_closed"]);
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function keys(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("invalid_request");
}
function assertJSON(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error("invalid_request");
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) { for (const item of value) assertJSON(item, depth + 1); return; }
  if (!record(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("invalid_request");
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("invalid_request");
    assertJSON(item, depth + 1);
  }
}
function jsonBody(value: unknown): Uint8Array { assertJSON(value); const bytes = encoder.encode(JSON.stringify(value)); if (bytes.length > MAX_JSON) throw new Error("request_too_large"); return bytes; }
function header(headers: ResponseHeaders, name: string): string { const value = headers[name]; return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function publicHeaders(headers: ResponseHeaders): DesktopResponseHeaders {
  const result: DesktopResponseHeaders = {};
  for (const key of ["content-type", "retry-after"] as const) { const value = header(headers, key); if (value && value.length <= 200 && !/[\r\n]/.test(value)) result[key] = value; }
  return result;
}
function decodeJSON(response: NativeResponse): unknown {
  if (!response.body.length && response.status === 204) return null;
  if (!/^application\/json(?:\s*;|$)/i.test(header(response.headers, "content-type"))) throw new Error("invalid_response");
  try { const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)); assertJSON(value); return value; }
  catch { throw new Error("invalid_response"); }
}
function successful(status: number): boolean { return status >= 200 && status < 300; }

/** Selected-server authority and credentials live here, never in the renderer. */
export class MeetSpaceBroker {
  private readonly profiles: ServerProfiles;
  private readonly vault: CookieVault;
  private storageReady = false;
  private identity: Identity | null = null;
  private epoch = 0;
  private generation = 0;
  private disposed = false;
  private operations = new Map<string, Operation>();
  private sockets = new Map<string, SocketRecord>();
  private streams = new Map<string, Operation>();
  private refreshPromise: Promise<boolean> | null = null;
  private authQueue: Promise<unknown> = Promise.resolve();
  private profileQueue: Promise<unknown> = Promise.resolve();
  private revoking = new Set<string>();
  private preferencesInFlight = new Set<string>();
  constructor(private readonly options: DesktopBrokerOptions) {
    this.profiles = new ServerProfiles(options.storageDir);
    this.vault = new CookieVault(options.storageDir, options.cipher);
  }
  async initialize(): Promise<void> {
    await this.profiles.load();
    try { await this.vault.load(); this.storageReady = this.vault.available(); }
    catch { this.storageReady = false; }
    if (this.profiles.selectedId) void this.flushRevocations(this.profiles.selectedId);
  }
  serversState(): DesktopServerState { return { items: this.profiles.items.map((item) => ({ ...item })), selectedId: this.profiles.selectedId, generation: this.generation, storageAvailable: this.storageReady && this.vault.available() }; }
  /** Recheck local encryption on an explicit UI refresh, without losing sessions. */
  listServers(): Promise<DesktopServerState> {
    return this.ordered("auth", async () => {
      if (this.disposed) throw new Error("stale_request");
      const wasAvailable = this.serversState().storageAvailable;
      if (!this.storageReady) {
        try { await this.vault.recover(); this.storageReady = this.vault.available(); }
        catch { this.storageReady = false; }
      }
      const state = this.serversState();
      if (state.storageAvailable !== wasAvailable) this.emit({ kind: "servers", type: "changed", state });
      return state;
    });
  }
  private emit(event: DesktopTransportEvent): void { if (!this.disposed) this.options.emit(event); }
  private sanitize(value: unknown, extraSecrets: string[] = []): unknown {
    const secrets = [...extraSecrets, this.identity?.jwt ?? "", ...this.vault.header(this.profiles.selectedId ?? "", AUTH + "refresh").split("; ").map((cookie) => cookie.slice(cookie.indexOf("=") + 1))].filter((secret) => secret.length >= 32);
    const redact = (text: string): string => {
      for (const secret of secrets) text = text.replaceAll(secret, "[redacted]");
      return text;
    };
    const replace = (item: unknown): unknown => {
      if (typeof item === "string") return redact(item);
      if (Array.isArray(item)) return item.map(replace);
      if (record(item)) return Object.fromEntries(Object.entries(item).map(([key, nested]) => [redact(key), replace(nested)]));
      return item;
    };
    return replace(redactCredentials(value));
  }
  private check(operation: Operation): void { if (this.disposed || operation.controller.signal.aborted || operation.epoch !== this.epoch) throw new Error("stale_request"); }
  private begin(id: unknown): Operation {
    if (!validRequestId(id) || this.disposed) throw new Error("invalid_request");
    if (this.operations.has(id) || this.sockets.has(id) || this.streams.has(id) || this.operations.size + this.sockets.size + this.streams.size >= 64) throw new Error("request_limit");
    const operation = { controller: new AbortController(), epoch: this.epoch };
    this.operations.set(id, operation); return operation;
  }
  private demandStorage(): void { if (!this.storageReady || !this.vault.available()) throw new Error("secure_storage_unavailable"); }
  private demandIdentity(marker: unknown): Identity {
    if (!this.identity) throw new Error("authentication_required");
    if (marker !== this.identity.marker) throw new Error("stale_session");
    return this.identity;
  }
  nativeIdentity(marker: unknown): NativeIdentity {
    const identity = this.demandIdentity(marker), profile = this.profiles.selected();
    return { profileId: profile.id, origin: profile.origin, userId: identity.userId,
      marker: identity.marker, generation: this.generation, guest: identity.guest };
  }
  private observeNotificationResponse(pathname: string, value: unknown): void {
    if (!record(value)) return;
    try {
      if (pathname === "/api/v1/notifications/preferences" &&
        ["invitation", "reminder", "recording", "summary"].every(key => typeof value[key] === "boolean")) {
        this.options.onNotificationPreferences?.({ invitation: value.invitation as boolean, reminder: value.reminder as boolean,
          recording: value.recording as boolean, summary: value.summary as boolean });
      }
      if (pathname === "/api/v1/notifications" && Number.isSafeInteger(value.unreadCount) && Number(value.unreadCount) >= 0)
        this.options.onNotificationUnread?.(Number(value.unreadCount));
    } catch { /* Native UI observers cannot change HTTP/session semantics. */ }
  }
  private async loadNotificationPreferences(): Promise<void> {
    if (!this.options.onNotificationPreferences || !this.identity || this.identity.guest) return;
    const marker = this.identity.marker;
    if (this.preferencesInFlight.has(marker)) return;
    this.preferencesInFlight.add(marker);
    const id = randomUUID();
    let operation: Operation | undefined;
    try {
      operation = this.begin(id);
      const response = await this.authenticatedRequest("/api/v1/notifications/preferences", operation);
      if (successful(response.status)) this.observeNotificationResponse("/api/v1/notifications/preferences", decodeJSON(response));
    } catch { /* Preferences remain disabled until an authoritative response arrives. */ }
    finally {
      this.preferencesInFlight.delete(marker);
      if (operation && this.operations.get(id) === operation) this.operations.delete(id);
    }
  }

  /** Native-only capability. The renderer supplies IDs, never the destination URL or headers. */
  async authorizeAsset(input: { id: string; token: string; asset: NativeAsset }): Promise<NativeAssetLease> {
    const asset = validateAsset(input.asset), identity = this.nativeIdentity(input.token);
    const operation = this.begin(input.id);
    let released = false;
    const check = () => { this.check(operation); if (released || this.identity?.marker !== identity.marker) throw new Error("stale_session"); };
    const release = () => {
      if (released) return;
      released = true;
      if (this.operations.get(input.id) === operation) this.operations.delete(input.id);
      operation.controller.abort();
    };
    try {
      const endpoint = asset.kind === "recording"
        ? `/api/v1/conferences/${asset.conferenceId}/recordings/${asset.recordingId}`
        : `/api/v1/${asset.scope === "conference" ? "conferences" : "conversations"}/${asset.scopeId}/attachments/${asset.attachmentId}/download`;
      const response = await this.authenticatedRequest(endpoint, operation);
      if ([401, 403, 404].includes(response.status)) throw new Error("asset_access_denied");
      if (!successful(response.status)) throw new Error("asset_unavailable");
      const value = decodeJSON(response);
      let url: string, expiresAt: number, filename: string, size: number | undefined;
      let mimeType = "application/octet-stream", playable = false, authenticatedPath: string | undefined;
      if (asset.kind === "recording") {
        const item = record(value) && record(value.item) ? value.item : null;
        if (!item || item.uuid !== asset.recordingId || item.conferenceId !== asset.conferenceId || item.status !== "ready" || !Array.isArray(item.files)) throw new Error("asset_unavailable");
        const file = item.files.find(file => record(file) && file.uuid === asset.fileId);
        if (!record(file) || typeof file.fileType !== "string") throw new Error("asset_access_denied");
        const formats: Record<string, [string, string, boolean]> = {
          final_mp4: ["video/mp4", "mp4", true], final_audio: ["audio/mp4", "m4a", true],
          preview_jpg: ["image/jpeg", "jpg", true], tracks_archive: ["application/zip", "zip", false],
        };
        const format = Object.hasOwn(formats, file.fileType) ? formats[file.fileType] : undefined;
        if (!format) throw new Error("asset_unsupported");
        const signed = signedAssetUrl(file.url);
        url = signed.url; expiresAt = signed.expiresAt; mimeType = format[0]; playable = format[2];
        filename = safeAssetFilename(file.fileName, `MeetSpace-recording.${format[1]}`);
        if (typeof file.mimeType === "string" && ["video/mp4", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/webm", "image/jpeg"].includes(file.mimeType)) mimeType = file.mimeType;
        if (file.sizeBytes !== undefined && file.sizeBytes !== null) {
          if (!Number.isSafeInteger(file.sizeBytes) || Number(file.sizeBytes) <= 0) throw new Error("asset_unavailable");
          size = Number(file.sizeBytes);
        }
      } else {
        if (!record(value) || typeof value.url !== "string" || typeof value.expiresAt !== "string") throw new Error("invalid_response");
        expiresAt = Date.parse(value.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 1000 || expiresAt > Date.now() + 6 * 60000) throw new Error("asset_expired");
        if (value.authenticated === true) {
          if (asset.scope !== "conversation") throw new Error("asset_url_invalid");
          authenticatedPath = `/api/v1/conversations/${asset.scopeId}/attachments/${asset.attachmentId}/content`;
          const target = new URL(value.url, identity.origin);
          if (target.href !== identity.origin + authenticatedPath) throw new Error("asset_url_invalid");
          url = target.href;
          filename = safeAssetFilename(asset.filename, "MeetSpace-attachment");
        } else {
          const signed = signedAssetUrl(value.url);
          url = signed.url; expiresAt = Math.min(expiresAt, signed.expiresAt);
          filename = safeAssetFilename(signed.filename ?? asset.filename, "MeetSpace-attachment");
        }
      }
      check();
      return { signal: operation.controller.signal, filename, mimeType, size, expiresAt, playable, check, release,
        request: async (callbacks) => {
          check();
          if (expiresAt <= Date.now() + 1000) throw new Error("asset_expired");
          const { range, ...sinks } = callbacks;
          if (range !== undefined && (range.length > 100 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))) throw new Error("invalid_request");
          const options = { ...sinks, method: "GET", headers: { Accept: "*/*", ...(range ? { Range: range } : {}) }, maxResponseBytes: 2 * 1024 * 1024 * 1024 };
          const result = authenticatedPath ? await this.authenticatedRequest(authenticatedPath, operation, options)
            : await this.options.transport.request({ ...options, url, signal: operation.controller.signal });
          check(); return result;
        } };
    } catch (error) { release(); throw error; }
  }
  private ordered<T>(kind: "auth" | "profile", work: () => Promise<T>): Promise<T> {
    const next = (kind === "auth" ? this.authQueue : this.profileQueue).catch(() => {}).then(work);
    if (kind === "auth") this.authQueue = next; else this.profileQueue = next;
    return next;
  }
  private async request(origin: string, pathname: string, operation: Operation, options: Partial<NativeRequest> & { method?: string } = {}): Promise<NativeResponse> {
    this.check(operation);
    const response = await this.options.transport.request({ url: origin + pathname, method: options.method ?? "GET", headers: { Accept: "application/json", ...options.headers }, signal: operation.controller.signal, maxResponseBytes: MAX_JSON, ...options });
    this.check(operation); return response;
  }
  async probeServer(value: unknown): Promise<DesktopProbeResult> {
    const origin = normalizeServerOrigin(value), id = randomUUID(), operation = this.begin(id);
    try {
      const response = await this.request(origin, "/version", operation);
      const version = decodeJSON(response);
      // The official 0.4.0 source release implements API v1 too; its product
      // version must not be mistaken for the API contract's major version.
      if (!successful(response.status) || !record(version) || typeof version.version !== "string" || !/^v?(?:0\.4\.0|1\.\d+\.\d+)(?:[-+.][A-Za-z0-9_.+-]+)?$/.test(version.version) || version.version.length > 100 || typeof version.commit !== "string" || !/^[a-f0-9]{7,40}$/.test(version.commit) || typeof version.buildTime !== "string" || !Number.isFinite(Date.parse(version.buildTime))) throw new Error("incompatible_server");
      for (const path of [AUTH + "me", "/api/v1/capabilities"]) {
        const probe = await this.request(origin, path, operation);
        const data = decodeJSON(probe);
        if (probe.status !== 401 || !record(data)) throw new Error("incompatible_server");
      }
      return { origin, version: version.version, commit: version.commit, buildTime: version.buildTime, apiVersion: 1, authRequired: true };
    } finally { if (this.operations.get(id) === operation) this.operations.delete(id); }
  }
  addServer(input: unknown): Promise<DesktopServerState> {
    keys(input, ["origin", "label"]);
    const origin = normalizeServerOrigin(input.origin);
    const label = input.label === undefined ? new URL(origin).host : input.label;
    if (typeof label !== "string" || !label.trim() || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) return Promise.reject(new Error("invalid_server"));
    return this.ordered("profile", async () => {
      const probe = await this.probeServer(origin), id = this.profiles.id(origin);
      const existing = this.profiles.items.find((item) => item.id === id);
      if (!existing && this.profiles.items.length >= 20) throw new Error("server_limit");
      const profile = { id, origin, label: label.trim(), version: probe.version, commit: probe.commit, lastCheckedAt: new Date().toISOString() };
      if (existing) Object.assign(existing, profile); else this.profiles.items.push(profile);
      await this.profiles.save(); this.emit({ kind: "servers", type: "changed", state: this.serversState() }); return this.serversState();
    });
  }
  selectServer(id: unknown): Promise<DesktopServerState> {
    return this.ordered("profile", async () => {
      if (typeof id !== "string" || !this.profiles.items.some((item) => item.id === id)) throw new Error("server_not_found");
      if (this.profiles.selectedId !== id) {
        this.invalidateIdentity(); this.generation++; this.profiles.selectedId = id; await this.profiles.save();
        this.emit({ kind: "servers", type: "changed", state: this.serversState() });
      }
      void this.flushRevocations(id); return this.serversState();
    });
  }
  removeServer(id: unknown): Promise<DesktopServerState> {
    return this.ordered("profile", () => this.ordered("auth", async () => {
      if (typeof id !== "string" || !this.profiles.items.some((item) => item.id === id)) throw new Error("server_not_found");
      // Erase persisted credentials before forgetting the deterministic server ID.
      // Serialize with login/refresh so they cannot restore a removed profile's cookies.
      this.demandStorage();
      const selected = id === this.profiles.selectedId;
      if (selected) this.invalidateIdentity();
      try { await this.vault.remove(id); }
      catch { this.storageReady = false; throw new Error("secure_storage_unavailable"); }
      if (selected) { this.generation++; this.profiles.selectedId = null; }
      this.profiles.items = this.profiles.items.filter((item) => item.id !== id);
      await this.profiles.save(); this.emit({ kind: "servers", type: "changed", state: this.serversState() }); return this.serversState();
    }));
  }
  resetConnections(notify = false): void {
    this.epoch++;
    for (const operation of this.operations.values()) operation.controller.abort();
    this.operations.clear();
    for (const id of [...this.sockets.keys()]) {
      this.socketClose(id);
      if (notify) this.emit({ kind: "socket", id, type: "close", code: 1012, reason: "" });
    }
    for (const id of [...this.streams.keys()]) {
      this.streamClose(id);
      if (notify) this.emit({ kind: "stream", id, type: "error", error: { code: "stream_unavailable", message: "Подключение обновляется после сна." } });
    }
    this.refreshPromise = null;
  }
  private invalidateIdentity(except?: Operation): void {
    this.options.onIdentityInvalidated?.();
    try { this.options.onIdentityChanged?.(null); } catch { /* Native observer only. */ }
    this.epoch++;
    for (const [id, operation] of this.operations) if (operation !== except) { operation.controller.abort(); this.operations.delete(id); }
    for (const id of [...this.sockets.keys()]) this.socketClose(id);
    for (const id of [...this.streams.keys()]) this.streamClose(id);
    if (except) except.epoch = this.epoch;
    this.identity = null; this.refreshPromise = null;
  }
  cancel(id: unknown): void {
    if (!validRequestId(id)) throw new Error("invalid_request");
    this.operations.get(id)?.controller.abort();
  }
  private credentials(profileId: string, pathname: string, bearer: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (bearer && this.identity) headers.Authorization = `Bearer ${this.identity.jwt}`;
    if (cookieOperation(pathname) && this.storageReady) { const cookie = this.vault.header(profileId, pathname); if (cookie) headers.Cookie = cookie; }
    return headers;
  }
  private async acceptIdentity(value: unknown, response: NativeResponse, profileId: string, pathname: string, operation: Operation): Promise<unknown> {
    this.check(operation); this.demandStorage();
    if (!record(value) || typeof value.accessToken !== "string" || !value.accessToken || value.accessToken.length > 8192 || /[\s\u0000-\u001f\u007f]/.test(value.accessToken) || !record(value.user) || !validId(value.user.id) || typeof value.expiresIn !== "number" || value.expiresIn <= 0 || value.expiresIn > 86400) throw new Error("invalid_response");
    const guest = pathname.endsWith("/guest");
    if (!guest) {
      const capabilityResponse = await this.request(this.profiles.selected().origin, "/api/v1/capabilities", operation, { headers: { Authorization: `Bearer ${value.accessToken}` } });
      const info = decodeJSON(capabilityResponse);
      const capabilities = record(info) && info.capabilities;
      if (!successful(capabilityResponse.status) || !record(capabilities) || ["liveCaptions", "transcription", "aiSummary", "semanticSearch", "meetingAnalytics"].some((key) => typeof capabilities[key] !== "boolean") || !Array.isArray(capabilities.recordingModes) || !capabilities.recordingModes.length || !capabilities.recordingModes.every((mode) => ["composite", "audio_only", "individual_tracks", "screen_focus"].includes(String(mode)))) throw new Error("incompatible_server");
    }
    this.check(operation);
    try { await this.vault.accept(profileId, pathname, response.headers["set-cookie"]); }
    catch { this.storageReady = false; throw new Error("secure_storage_unavailable"); }
    this.check(operation);
    const same = this.identity?.userId === value.user.id && this.identity.guest === guest;
    const marker = same ? this.identity!.marker : `desktop-session:${randomUUID()}`;
    if (!same) this.invalidateIdentity(operation);
    this.identity = { jwt: value.accessToken, userId: value.user.id, marker, guest };
    if (!same) {
      try { this.options.onIdentityChanged?.(guest ? null : { profileId, userId: value.user.id }); } catch { /* Native observer only. */ }
      void this.loadNotificationPreferences().catch(() => {});
    }
    return { ...(this.sanitize(value) as object), accessToken: marker };
  }
  private async refresh(operation: Operation): Promise<boolean> {
    if (this.identity?.guest) return false;
    this.demandStorage();
    if (!this.refreshPromise) {
      const epoch = this.epoch;
      this.refreshPromise = this.ordered("auth", async () => {
        this.check(operation);
        const profile = this.profiles.selected();
        const response = await this.request(profile.origin, AUTH + "refresh", operation, { method: "POST", headers: { ...this.credentials(profile.id, AUTH + "refresh", false), "Content-Type": "application/json" }, body: jsonBody(this.identity ? { userId: this.identity.userId } : {}) });
        const value = decodeJSON(response);
        if (!successful(response.status)) return false;
        await this.acceptIdentity(value, response, profile.id, AUTH + "refresh", operation); return true;
      }).finally(() => { if (this.epoch === epoch) this.refreshPromise = null; });
    }
    const result = await this.refreshPromise; this.check(operation); return result;
  }
  private async authenticatedRequest(pathname: string, operation: Operation, options: Partial<NativeRequest> = {}): Promise<NativeResponse> {
    const profile = this.profiles.selected();
    if (pathname !== AUTH + "logout") void this.flushRevocations(profile.id);
    let response = await this.request(profile.origin, pathname, operation, { ...options, headers: { ...options.headers, Authorization: `Bearer ${this.identity!.jwt}` } });
    if (response.status === 401 && await this.refresh(operation)) response = await this.request(profile.origin, pathname, operation, { ...options, headers: { ...options.headers, Authorization: `Bearer ${this.identity!.jwt}` } });
    return response;
  }
  async http(input: unknown): Promise<DesktopHttpResponse> {
    keys(input, ["id", "method", "path", "body", "bytes", "contentType", "responseType", "token"]);
    if (typeof input.method !== "string" || typeof input.path !== "string" || !["json", "binary"].includes(String(input.responseType))) throw new Error("invalid_request");
    const request = input as unknown as DesktopHttpRequest;
    const pathname = validateApiPath(request.method, request.path);
    const publicRequest = publicOperation(request.method, pathname);
    if (!publicRequest) this.demandIdentity(request.token);
    else if (request.token != null && request.token !== this.identity?.marker) throw new Error("stale_session");
    const profile = this.profiles.selected();
    if (pathname !== AUTH + "logout" && (cookieOperation(pathname) || authResponse(pathname))) this.demandStorage();
    let body: Uint8Array | undefined;
    if (request.bytes !== undefined) {
      if (!(request.bytes instanceof Uint8Array) || request.body !== undefined || !binaryPath(request.method, pathname) || request.bytes.length > MAX_BINARY || typeof request.contentType !== "string" || request.contentType.length > 150 || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(request.contentType)) throw new Error("invalid_request");
      body = request.bytes;
    } else if (request.contentType !== undefined) throw new Error("invalid_request");
    else if (request.body !== undefined) body = jsonBody(request.body);
    if ((request.method === "GET" && body) || (request.responseType === "binary" && !binaryPath("GET", pathname))) throw new Error("invalid_request");
    const operation = this.begin(request.id);
    if (pathname !== AUTH + "logout") void this.flushRevocations(profile.id);
    try {
      if (pathname === AUTH + "logout") {
        const userId = record(request.body) ? request.body.userId : undefined;
        if (userId !== undefined && !validId(userId)) throw new Error("invalid_request");
        const active = !userId || userId === this.identity?.userId;
        const guestLogout = active && this.identity?.guest === true;
        if (active) this.invalidateIdentity(operation);
        try { if (!guestLogout) await this.vault.logout(profile.id, userId as string | undefined, active); }
        catch { this.storageReady = false; throw new Error("secure_storage_unavailable"); }
        this.check(operation);
        void this.flushRevocations(profile.id);
        return { status: 200, body: { status: "success" }, headers: { "content-type": "application/json" } };
      }
      const execute = async (): Promise<DesktopHttpResponse> => {
        this.check(operation);
        const guestResume = pathname.endsWith("/guest") && request.token != null;
        const headers = { ...this.credentials(profile.id, pathname, !publicRequest || guestResume), ...(body ? { "Content-Type": request.contentType ?? "application/json" } : {}) };
        const options: Partial<NativeRequest> = { method: request.method, headers, body, maxResponseBytes: request.responseType === "binary" ? MAX_BINARY : MAX_JSON, onUploadProgress: request.bytes ? (loaded, total) => this.emit({ kind: "progress", id: request.id, percent: total ? Math.round(loaded * 100 / total) : 0 }) : undefined };
        let response = await this.request(profile.origin, request.path, operation, options);
        if (!publicRequest && !authResponse(pathname) && response.status === 401 && await this.refresh(operation)) response = await this.request(profile.origin, request.path, operation, { ...options, headers: { ...headers, Authorization: `Bearer ${this.identity!.jwt}` } });
        if (request.responseType === "binary" && successful(response.status)) return { status: response.status, body: response.body, headers: this.sanitize(publicHeaders(response.headers)) as DesktopResponseHeaders };
        let value = decodeJSON(response);
        if (authResponse(pathname) && successful(response.status)) value = await this.acceptIdentity(value, response, profile.id, pathname, operation);
        else {
          try { await this.vault.accept(profile.id, pathname, response.headers["set-cookie"]); }
          catch { this.storageReady = false; throw new Error("secure_storage_unavailable"); }
          this.check(operation);
          value = this.sanitize(value);
        }
        if (successful(response.status)) this.observeNotificationResponse(pathname, value);
        if (/^\/api\/v1\/conferences\/[^/]+\/recordings(?:\/[^/]+)?$/.test(pathname) && record(value)) {
          // Native recording actions resolve fresh capabilities by file UUID.
          // The shared web API continues to receive its normal URLs directly.
          const strip = (item: unknown) => {
            if (!record(item)) return;
            delete item.downloadUrl;
            if (Array.isArray(item.files)) for (const file of item.files) if (record(file)) delete file.url;
          };
          strip(value.item);
          if (Array.isArray(value.items)) value.items.forEach(strip);
        }
        // Metadata can reflect credentials too. Sanitize before account deletion
        // clears the identity/cookies; downloaded file bytes remain untouched.
        const responseHeaders = this.sanitize(publicHeaders(response.headers)) as DesktopResponseHeaders;
        if (request.method === "DELETE" && pathname === AUTH + "me" && successful(response.status)) { await this.vault.logout(profile.id, this.identity?.userId); this.invalidateIdentity(operation); }
        return { status: response.status, body: value, headers: responseHeaders };
      };
      const identityMutation = authResponse(pathname);
      return await (identityMutation ? this.ordered("auth", execute) : execute());
    } finally { if (this.operations.get(request.id) === operation) this.operations.delete(request.id); }
  }
  private async flushRevocations(id: string): Promise<void> {
    if (this.revoking.has(id) || !this.storageReady || this.disposed) return;
    const profile = this.profiles.items.find((item) => item.id === id);
    if (!profile || !this.vault.pending(id).length) return;
    this.revoking.add(id);
    const requestId = randomUUID();
    try {
      const operation = this.begin(requestId);
      for (const secret of this.vault.pending(id)) {
        const response = await this.request(profile.origin, AUTH + "logout", operation, { method: "POST", headers: { Cookie: `meetrix_session=${secret}`, "Content-Type": "application/json" }, body: jsonBody({}) });
        if (successful(response.status) || response.status === 401) await this.vault.revoked(id, secret); else break;
      }
    } catch { /* The encrypted queue survives an offline logout and retries on selection. */ }
    finally { this.operations.delete(requestId); this.revoking.delete(id); }
  }
  async socketOpen(input: unknown): Promise<void> {
    keys(input, ["id", "kind", "conferenceId", "clientId", "token"]);
    const request = input as unknown as DesktopSocketRequest;
    if (!["conference", "account"].includes(request.kind) || (request.kind === "conference" ? !validId(request.conferenceId) : request.conferenceId !== undefined || request.clientId !== undefined) || (request.clientId !== undefined && !validId(request.clientId))) throw new Error("invalid_request");
    this.demandIdentity(request.token);
    const operation = this.begin(request.id);
    const current: SocketRecord = { ...operation, conferenceId: request.conferenceId, messages: 0, window: Date.now(), incoming: 0, incomingWindow: Date.now() };
    this.operations.delete(request.id); this.sockets.set(request.id, current);
    try {
      const path = request.kind === "conference" ? `/api/v1/conferences/${request.conferenceId}/ws` : "/api/v1/ws";
      const ticketResponse = await this.authenticatedRequest(path + "-ticket", current, { method: "POST", headers: { "Content-Type": "application/json" }, body: jsonBody(request.clientId ? { clientId: request.clientId } : {}) });
      const data = decodeJSON(ticketResponse);
      if (ticketResponse.status === 401) throw new Error("authentication_required");
      if (!successful(ticketResponse.status) || !record(data) || typeof data.ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.ticket)) throw new Error("invalid_response");
      this.check(current);
      const url = new URL(path, this.profiles.selected().origin); url.protocol = "wss:"; url.searchParams.set("ticket", data.ticket);
      const ca = [...new Set([...tls.rootCertificates, ...tls.getCACertificates("system")])];
      const create = this.options.createSocket ?? ((address, protocols, options) => new WebSocket(address, protocols, options));
      const socket = create(url.href, request.kind === "conference" ? ["go-recorder.v1"] : [], { rejectUnauthorized: true, ca, followRedirects: false, perMessageDeflate: false, maxPayload: 256 * 1024, handshakeTimeout: 10000 });
      current.socket = socket;
      socket.on("open", () => { if (this.sockets.get(request.id) === current) this.emit({ kind: "socket", id: request.id, type: "open" }); });
      socket.on("message", (bytes, binary) => {
        if (this.sockets.get(request.id) !== current) return;
        try {
          if (binary || Buffer.byteLength(bytes as Buffer) > 256 * 1024) throw new Error();
          if (Date.now() - current.incomingWindow >= 1000) { current.incomingWindow = Date.now(); current.incoming = 0; }
          if (++current.incoming > 200) throw new Error();
          const parsed: unknown = JSON.parse(bytes.toString()); assertJSON(parsed);
          if (!record(parsed)) throw new Error();
          const safe = this.sanitize(parsed, [data.ticket as string]);
          if (request.kind === "account") { try { this.options.onAccountEvent?.(safe); } catch { /* Native observer only. */ } }
          this.emit({ kind: "socket", id: request.id, type: "message", data: JSON.stringify(safe) });
        } catch { socket.close(1009, "invalid_message"); }
      });
      socket.on("error", () => { if (this.sockets.get(request.id) === current) this.emit({ kind: "socket", id: request.id, type: "error" }); });
      socket.on("close", (code, reason) => {
        if (this.sockets.get(request.id) !== current) return;
        this.sockets.delete(request.id);
        const safeReason = safeReasons.has(reason.toString()) ? reason.toString() : "";
        this.emit({ kind: "socket", id: request.id, type: "close", code, reason: safeReason });
      });
    } catch (error) { if (this.sockets.get(request.id) === current) this.sockets.delete(request.id); current.controller.abort(); throw error; }
  }
  socketSend(id: unknown, data: unknown): void {
    if (!validRequestId(id) || typeof data !== "string" || Buffer.byteLength(data) > 65536) throw new Error("invalid_request");
    const current = this.sockets.get(id);
    if (!current || !current.conferenceId || current.socket?.readyState !== WebSocket.OPEN || current.socket.bufferedAmount > 131072) throw new Error("socket_unavailable");
    this.check(current);
    let message: unknown; try { message = JSON.parse(data); assertJSON(message); } catch { throw new Error("invalid_request"); }
    if (!record(message) || message.version !== 1 || !validId(message.id) || message.conferenceId !== current.conferenceId || typeof message.type !== "string" || !allowedTypes.has(message.type) || typeof message.timestamp !== "string" || !Number.isFinite(Date.parse(message.timestamp))) throw new Error("invalid_request");
    if (Date.now() - current.window >= 1000) { current.window = Date.now(); current.messages = 0; }
    if (++current.messages > 40) throw new Error("request_limit");
    current.socket.send(data, (error) => { if (error) this.emit({ kind: "socket", id, type: "error" }); });
  }
  socketClose(id: unknown): void {
    if (!validRequestId(id)) throw new Error("invalid_request");
    const current = this.sockets.get(id); if (!current) return;
    this.sockets.delete(id); current.controller.abort();
    if (current.socket) { current.socket.on("error", () => {}); current.socket.terminate(); }
  }
  async streamOpen(input: unknown): Promise<void> {
    keys(input, ["id", "token"]);
    this.demandIdentity(input.token);
    const operation = this.begin(input.id);
    const id = input.id as string;
    this.operations.delete(id); this.streams.set(id, operation);
    void this.runStream(id, operation);
  }
  private async runStream(id: string, operation: Operation): Promise<void> {
    let status = 0;
    const run = async () => {
      let pending = "";
      let events = 0, eventWindow = Date.now();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const profile = this.profiles.selected();
      await this.request(profile.origin, "/api/v1/notifications/events", operation, { headers: { Authorization: `Bearer ${this.identity!.jwt}`, Accept: "text/event-stream" }, onHeaders: (code, headers) => {
        status = code;
        if (code !== 200 || !/^text\/event-stream(?:\s*;|$)/i.test(header(headers, "content-type"))) throw new Error();
        // A reconnect recovers the initial preference read after a temporary outage.
        void this.loadNotificationPreferences().catch(() => {});
        this.emit({ kind: "stream", id, type: "headers", status, headers: this.sanitize(publicHeaders(headers)) as DesktopResponseHeaders });
      }, onChunk: (chunk) => {
        this.check(operation);
        pending = (pending + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, "\n");
        if (Buffer.byteLength(pending) > 256 * 1024) throw new Error();
        let end: number;
        while ((end = pending.indexOf("\n\n")) >= 0) {
          const frame = pending.slice(0, end); pending = pending.slice(end + 2);
          const lines = frame.split("\n");
          const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          if (Date.now() - eventWindow >= 1000) { eventWindow = Date.now(); events = 0; }
          if (++events > 200) throw new Error();
          const parsed: unknown = JSON.parse(data); assertJSON(parsed);
          const sanitized = this.sanitize(parsed);
          try { this.options.onNotificationEvent?.(sanitized); } catch { /* Native observer only. */ }
          const safe = encoder.encode(`data: ${JSON.stringify(sanitized)}\n\n`);
          this.emit({ kind: "stream", id, type: "chunk", data: safe });
        }
      } });
    };
    try {
      try { await run(); }
      catch (error) { if (status !== 401 || !await this.refresh(operation)) throw error; await run(); }
      if (this.streams.get(id) === operation) this.emit({ kind: "stream", id, type: "end" });
    } catch { if (this.streams.get(id) === operation && !operation.controller.signal.aborted) this.emit({ kind: "stream", id, type: "error", error: { code: status === 401 ? "authentication_required" : "stream_unavailable", message: "Поток уведомлений недоступен." } }); }
    finally { if (this.streams.get(id) === operation) this.streams.delete(id); }
  }
  streamClose(id: unknown): void {
    if (!validRequestId(id)) throw new Error("invalid_request");
    const operation = this.streams.get(id); this.streams.delete(id); operation?.controller.abort();
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.resetConnections(); this.identity = null; }
}
