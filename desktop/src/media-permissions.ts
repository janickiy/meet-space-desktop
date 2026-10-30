import { randomUUID } from "node:crypto";
import type { DesktopCapturerSource, DisplayMediaRequestHandlerHandlerRequest, Streams, WebContents, WebFrameMain } from "electron";
import type { DesktopDisplayCaptureEvent } from "./shared/contracts";
import { isTrustedRendererUrl } from "./security";
import type { DisplayCaptureMode } from "./platform/display-capture";
import type { MacOSMediaAccess, MacOSMediaKind } from "./platform/macos-media-access";
import type { MacOSScreenAccess } from "./platform/macos-screen-access";

interface Owner { contents: WebContents; frame: WebFrameMain }
interface MediaPermissionsOptions {
  owner(): Owner | null;
  development: boolean;
  platform: string;
  displayMode?(): DisplayCaptureMode;
  getSources(thumbnails: boolean): Promise<DesktopCapturerSource[]>;
  emit(event: DesktopDisplayCaptureEvent): void;
  timeoutMs?: number;
  mediaAccess?: Pick<MacOSMediaAccess, "check" | "ensure">;
  screenAccess?: Pick<MacOSScreenAccess, "canSelect">;
}
interface Pending {
  id: string;
  owner: Owner;
  callback(streams: Streams | null): void;
  sources: Map<string, DesktopCapturerSource>;
  audio: boolean;
  choosing: boolean;
  timer: ReturnType<typeof setTimeout>;
}

/** Permission grants are document-scoped. Source IDs never cross the preload boundary. */
export class MediaPermissions {
  private pending: Pending | null = null;
  // Electron deduplicates concurrent getSources calls. A cancelled portal
  // operation must settle before another document/request may enumerate.
  private enumerating = false;
  private permissionEpoch = 0;
  constructor(private readonly options: MediaPermissionsOptions) {}

  private trusted(contents: WebContents | null, url: unknown, mainFrame: boolean): boolean {
    const owner = this.options.owner();
    return Boolean(owner && contents === owner.contents && !contents.isDestroyed() &&
      mainFrame && typeof url === "string" && isTrustedRendererUrl(url, this.options.development) &&
      isTrustedRendererUrl(owner.frame.url, this.options.development));
  }
  check(contents: WebContents | null, permission: string, origin: string, details: {
    isMainFrame: boolean; requestingUrl?: string; securityOrigin?: string; embeddingOrigin?: string; mediaType?: string;
  }): boolean {
    if (!this.trusted(contents, details.requestingUrl, details.isMainFrame) ||
      !isTrustedRendererUrl(origin, this.options.development) ||
      (details.embeddingOrigin && !isTrustedRendererUrl(details.embeddingOrigin, this.options.development)) ||
      (details.securityOrigin && !isTrustedRendererUrl(details.securityOrigin, this.options.development))) return false;
    if (permission === "media") {
      if (!["audio", "video", "unknown"].includes(details.mediaType ?? "unknown")) return false;
      const kind = details.mediaType === "audio" ? "microphone" : details.mediaType === "video" ? "camera" : null;
      return !kind || !this.options.mediaAccess || this.options.mediaAccess.check([kind]);
    }
    // Copying invitation text needs write-only access; clipboard reads stay denied.
    if (permission === "clipboard-sanitized-write") return true;
    // Display capture is separately gated on a user gesture and an explicit source choice.
    return permission === "display-capture" || permission === "speaker-selection";
  }
  request(contents: WebContents, permission: string, details: {
    isMainFrame: boolean; requestingUrl: string; securityOrigin?: string; mediaTypes?: string[];
  }): boolean {
    if (!this.trusted(contents, details.requestingUrl, details.isMainFrame) ||
      (details.securityOrigin && !isTrustedRendererUrl(details.securityOrigin, this.options.development))) return false;
    // Electron 44 asks for `media` with [] before calling the display handler.
    // That handler still requires user activation and an explicit picker choice.
    if (permission === "media") return Array.isArray(details.mediaTypes) && details.mediaTypes.every(type => type === "audio" || type === "video");
    if (permission === "clipboard-sanitized-write") return true;
    return permission === "display-capture" || permission === "speaker-selection";
  }

  /** Native prompts may outlive their document. Never deliver a late grant to a replacement. */
  async authorize(contents: WebContents, permission: string, details: {
    isMainFrame: boolean; requestingUrl: string; securityOrigin?: string; mediaTypes?: string[];
  }): Promise<boolean> {
    if (!this.request(contents, permission, details)) return false;
    if (permission !== "media" || !details.mediaTypes?.length || !this.options.mediaAccess) return true;
    const owner = this.options.owner();
    const epoch = this.permissionEpoch;
    const types: MacOSMediaKind[] = details.mediaTypes.map(type => type === "audio" ? "microphone" : "camera");
    try {
      if (!await this.options.mediaAccess.ensure(types)) return false;
      const current = this.options.owner();
      return epoch === this.permissionEpoch && !!owner && current?.contents === owner.contents &&
        current.frame === owner.frame && this.request(contents, permission, details);
    } catch { return false; }
  }

  /** Final lease check and Electron callback share a synchronous turn. A promise
   * result alone can become stale before the caller's next microtask runs. */
  authorizeRequest(contents: WebContents, permission: string, details: {
    isMainFrame: boolean; requestingUrl: string; securityOrigin?: string; mediaTypes?: string[];
  }, callback: (allowed: boolean) => void): void {
    const owner = this.options.owner(), epoch = this.permissionEpoch;
    const complete = (allowed: boolean) => {
      let grant = false;
      try {
        const current = this.options.owner();
        grant = allowed && epoch === this.permissionEpoch && !!owner && current?.contents === owner.contents &&
          current.frame === owner.frame && this.request(contents, permission, details);
      } catch { /* Native ownership or the document may already be gone. */ }
      try { callback(grant); } catch { /* Electron can drop a request during navigation. */ }
    };
    void this.authorize(contents, permission, details).then(complete, () => complete(false));
  }

  private active(pending: Pending): boolean {
    const owner = this.options.owner();
    return this.pending === pending && owner?.contents === pending.owner.contents &&
      owner.frame === pending.owner.frame && !owner.contents.isDestroyed() &&
      isTrustedRendererUrl(owner.frame.url, this.options.development);
  }
  private async getSources(thumbnails: boolean): Promise<DesktopCapturerSource[]> {
    if (this.enumerating) throw new Error("capture_enumeration_pending");
    this.enumerating = true;
    try { return await this.options.getSources(thumbnails); }
    finally { this.enumerating = false; }
  }
  async display(request: DisplayMediaRequestHandlerHandlerRequest, callback: (streams: Streams | null) => void): Promise<void> {
    const owner = this.options.owner();
    if (!owner || this.pending || this.enumerating || !request.userGesture || !request.videoRequested ||
      request.frame !== owner.frame || !this.trusted(owner.contents, request.securityOrigin, true)) {
      try { callback(null); } catch { /* The requesting document may have disappeared. */ }
      return;
    }
    const mode = this.options.displayMode?.() ?? (this.options.platform === "linux" ? "unavailable" : "picker");
    if (mode === "unavailable") {
      try { this.options.emit({ type: "unavailable", requestId: randomUUID() }); } catch { /* The owner may be closing. */ }
      try { callback(null); } catch { /* The requesting document may have disappeared. */ }
      return;
    }
    const pending: Pending = {
      id: randomUUID(), owner, callback, sources: new Map(),
      audio: request.audioRequested && this.options.platform === "win32", choosing: false,
      timer: setTimeout(() => this.cancel(), this.options.timeoutMs ?? 60_000),
    };
    this.pending = pending;
    try {
      if (mode === "portal") this.options.emit({ type: "portal", requestId: pending.id });
      // Electron's macOS enumeration invokes CGRequestScreenCaptureAccess. A
      // preflight false can mean "not asked yet", so never block that first
      // explicit user request. Check consent after enumeration, before exposing
      // previews or granting a selected source.
      const sources = await this.getSources(mode === "picker");
      if (!this.active(pending)) { this.finish(pending, null); return; }
      if (this.options.screenAccess && !this.options.screenAccess.canSelect()) {
        this.finish(pending, null, "denied"); return;
      }
      if (mode === "portal") {
        // In the pinned Linux backend, getSources already presented the portal
        // and returned its consented source. Never enumerate again or substitute
        // an X11 first-source choice for system consent.
        if (sources.length !== 1 || !/^window:/.test(sources[0].id)) { this.cancel(); return; }
        this.finish(pending, { video: sources[0] });
        return;
      }
      const available = sources.filter(source => /^(screen|window):/.test(source.id)).slice(0, 100);
      if (!available.length) { this.finish(pending, null, "error"); return; }
      const publicSources = available.map(source => {
        const id = randomUUID(); pending.sources.set(id, source);
        const thumbnail = source.thumbnail.toDataURL();
        return { id, name: source.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180),
          kind: source.id.startsWith("screen:") ? "screen" as const : "window" as const,
          thumbnail: thumbnail.length <= 256 * 1024 && thumbnail.startsWith("data:image/png;base64,") ? thumbnail : "" };
      });
      this.options.emit({ type: "request", requestId: pending.id, sources: publicSources, systemAudioAvailable: pending.audio });
    } catch {
      if (this.pending === pending) this.finish(pending, null,
        this.active(pending) && this.options.screenAccess && !this.options.screenAccess.canSelect()
          ? "denied" : mode === "picker" && this.active(pending) ? "error" : "cancelled");
    }
  }
  async select(input: unknown): Promise<void> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_request");
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(key => !["requestId", "sourceId", "systemAudio"].includes(key)) ||
      typeof value.requestId !== "string" || !value.requestId || value.requestId.length > 80 ||
      typeof value.sourceId !== "string" || !value.sourceId || value.sourceId.length > 80 ||
      typeof value.systemAudio !== "boolean") throw new Error("invalid_request");
    const pending = this.pending;
    if (!pending || !this.active(pending) || value.requestId !== pending.id || pending.choosing) throw new Error("stale_request");
    const source = pending.sources.get(value.sourceId);
    if (!source || (value.systemAudio && !pending.audio)) throw new Error("operation_not_allowed");
    pending.choosing = true;
    try {
      if (this.options.screenAccess && !this.options.screenAccess.canSelect()) {
        this.finish(pending, null, "denied"); throw new Error("capture_source_unavailable");
      }
      // Windows may disappear while the picker is open; never substitute another source.
      const current = await this.getSources(false);
      if (!this.active(pending)) throw new Error("stale_request");
      if (this.options.screenAccess && !this.options.screenAccess.canSelect()) {
        this.finish(pending, null, "denied"); throw new Error("capture_source_unavailable");
      }
      const selected = current.find(item => item.id === source.id);
      if (!selected) throw new Error("capture_source_unavailable");
      this.finish(pending, { video: selected, ...(value.systemAudio ? { audio: "loopback" as const } : {}) });
    } catch (error) {
      if (this.pending === pending) this.finish(pending, null,
        this.active(pending) && this.options.screenAccess && !this.options.screenAccess.canSelect()
          ? "denied" : this.active(pending) ? "error" : "cancelled");
      throw error instanceof Error && ["stale_request", "capture_source_unavailable"].includes(error.message)
        ? error : new Error("capture_source_unavailable");
    }
  }
  cancelRequest(id: unknown): void {
    if (typeof id !== "string" || id.length > 80) throw new Error("invalid_request");
    if (this.pending?.id === id) this.cancel();
  }
  cancel(): void { this.permissionEpoch++; if (this.pending) this.finish(this.pending, null); }
  private finish(pending: Pending, streams: Streams | null, type: "cancelled" | "denied" | "error" = "cancelled"): void {
    if (this.pending !== pending) return;
    this.pending = null; clearTimeout(pending.timer); pending.sources.clear();
    try { pending.callback(streams); } catch { /* The document may already be gone. */ }
    try { this.options.emit({ type, requestId: pending.id }); } catch { /* The owner may be closing. */ }
  }
}
