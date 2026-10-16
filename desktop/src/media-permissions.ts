import { randomUUID } from "node:crypto";
import type { DesktopCapturerSource, DisplayMediaRequestHandlerHandlerRequest, Streams, WebContents, WebFrameMain } from "electron";
import type { DesktopDisplayCaptureEvent } from "./shared/contracts";
import { isTrustedRendererUrl } from "./security";

interface Owner { contents: WebContents; frame: WebFrameMain }
interface MediaPermissionsOptions {
  owner(): Owner | null;
  development: boolean;
  platform: string;
  getSources(thumbnails: boolean): Promise<DesktopCapturerSource[]>;
  emit(event: DesktopDisplayCaptureEvent): void;
  timeoutMs?: number;
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
    if (permission === "media") return ["audio", "video", "unknown"].includes(details.mediaType ?? "unknown");
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
    return permission === "display-capture" || permission === "speaker-selection";
  }

  private active(pending: Pending): boolean {
    const owner = this.options.owner();
    return this.pending === pending && owner?.contents === pending.owner.contents &&
      owner.frame === pending.owner.frame && !owner.contents.isDestroyed() &&
      isTrustedRendererUrl(owner.frame.url, this.options.development);
  }
  async display(request: DisplayMediaRequestHandlerHandlerRequest, callback: (streams: Streams | null) => void): Promise<void> {
    const owner = this.options.owner();
    if (!owner || this.pending || !request.userGesture || !request.videoRequested ||
      request.frame !== owner.frame || !this.trusted(owner.contents, request.securityOrigin, true)) {
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
      const sources = await this.options.getSources(true);
      if (!this.active(pending)) return;
      const available = sources.filter(source => /^(screen|window):/.test(source.id)).slice(0, 100);
      if (!available.length) { this.cancel(); return; }
      const publicSources = available.map(source => {
        const id = randomUUID(); pending.sources.set(id, source);
        const thumbnail = source.thumbnail.toDataURL();
        return { id, name: source.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180),
          kind: source.id.startsWith("screen:") ? "screen" as const : "window" as const,
          thumbnail: thumbnail.length <= 256 * 1024 && thumbnail.startsWith("data:image/png;base64,") ? thumbnail : "" };
      });
      this.options.emit({ type: "request", requestId: pending.id, sources: publicSources, systemAudioAvailable: pending.audio });
    } catch { if (this.pending === pending) this.cancel(); }
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
      // Windows may disappear while the picker is open; never substitute another source.
      const current = await this.options.getSources(false);
      if (!this.active(pending)) throw new Error("stale_request");
      const selected = current.find(item => item.id === source.id);
      if (!selected) throw new Error("capture_source_unavailable");
      this.finish(pending, { video: selected, ...(value.systemAudio ? { audio: "loopback" as const } : {}) });
    } catch (error) {
      if (this.pending === pending) this.cancel();
      throw error instanceof Error && ["stale_request", "capture_source_unavailable"].includes(error.message)
        ? error : new Error("capture_source_unavailable");
    }
  }
  cancelRequest(id: unknown): void {
    if (typeof id !== "string" || id.length > 80) throw new Error("invalid_request");
    if (this.pending?.id === id) this.cancel();
  }
  cancel(): void { if (this.pending) this.finish(this.pending, null); }
  private finish(pending: Pending, streams: Streams | null): void {
    if (this.pending !== pending) return;
    this.pending = null; clearTimeout(pending.timer); pending.sources.clear();
    try { pending.callback(streams); } catch { /* The document may already be gone. */ }
    this.options.emit({ type: "cancelled", requestId: pending.id });
  }
}
