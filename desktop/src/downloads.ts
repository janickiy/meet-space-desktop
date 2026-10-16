import { randomBytes, randomUUID } from "node:crypto";
import { open, readdir, rename, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { mediaByteRange, validateAsset, type NativeAsset } from "./asset-policy";
import type { MeetSpaceBroker, NativeAssetLease } from "./broker";
import type { NativeTransport } from "./network/transport";
import { APP_ORIGIN, DEV_ORIGIN } from "./security";

export interface NativeAssetsOptions {
  broker: Pick<MeetSpaceBroker, "authorizeAsset" | "nativeIdentity" | "cancel">;
  /** Kept explicit for main integration; all authorized byte requests use the lease. */
  transport?: NativeTransport;
  cacheDir: string;
  /** Main-only development flag; never accepts a caller-selected origin. */
  development?: boolean;
  chooseSavePath(suggestedName: string): Promise<string | null>;
  emit(event: { kind: "asset"; id: string; type: "progress"; received: number; total?: number }): void;
}
interface Input { id: string; token: string; asset: NativeAsset }
interface Job { input: Input; cancelled: boolean; lease?: NativeAssetLease; partial?: string }
interface MediaEntry { job: Job; opaque: string; mimeType: string; expiresAt: number; timer: NodeJS.Timeout; requests: Map<string, () => void> }
const MAX_SAVE = 2 * 1024 * 1024 * 1024;
const head = (headers: Record<string, string | string[]>, name: string) => {
  const value = headers[name]; return Array.isArray(value) ? value[0] ?? "" : value ?? "";
};
const failure = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : "";
  return new Error(/^(asset_[a-z_]+|stale_request|stale_session|authentication_required|request_cancelled|tls_error|dns_error|network_timeout|network_unavailable|redirect_not_allowed|secure_storage_unavailable)$/.test(message) ? message : "asset_unavailable");
};

/** Native Save dialogs and private, session-scoped recording playback. No renderer URLs. */
export class NativeAssets {
  private jobs = new Map<string, Job>();
  private media = new Map<string, MediaEntry>();
  private disposed = false;
  constructor(private readonly options: NativeAssetsOptions) {}

  async initialize(): Promise<void> {
    // Remove media files left by older builds; new playback never writes a cache.
    const items = await readdir(this.options.cacheDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []; throw error;
    });
    for (const item of items) {
      if (/^meetspace-media-[a-f0-9-]{36}\.cache$/.test(item.name) && (item.isFile() || item.isSymbolicLink()))
        await rm(path.join(this.options.cacheDir, item.name), { force: true });
    }
  }
  private begin(input: unknown): Job {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_request");
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(key => !["id", "token", "asset"].includes(key)) || typeof value.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(value.id) || typeof value.token !== "string" || value.token.length > 100) throw new Error("invalid_request");
    const asset = validateAsset(value.asset);
    this.options.broker.nativeIdentity(value.token);
    if (this.disposed || this.jobs.has(value.id)) throw new Error("invalid_request");
    if (this.jobs.size >= 4) throw new Error("asset_limit");
    const job: Job = { input: { id: value.id, token: value.token, asset }, cancelled: false };
    this.jobs.set(value.id, job); return job;
  }
  private check(job: Job): void {
    if (this.disposed || job.cancelled || this.jobs.get(job.input.id) !== job) throw new Error("request_cancelled");
    this.options.broker.nativeIdentity(job.input.token);
    job.lease?.check();
  }
  private async authorize(job: Job): Promise<NativeAssetLease> {
    this.check(job);
    try { job.lease = await this.options.broker.authorizeAsset(job.input); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "asset_expired") throw error;
      this.check(job); job.lease = await this.options.broker.authorizeAsset(job.input);
    }
    this.check(job); return job.lease;
  }
  private async discard(job: Job): Promise<void> {
    job.cancelled = true;
    if (this.jobs.get(job.input.id) === job) this.jobs.delete(job.input.id);
    this.options.broker.cancel(job.input.id);
    job.lease?.release();
    if (job.partial) { const filename = job.partial; job.partial = undefined; await rm(filename, { force: true }).catch(() => {}); }
  }
  private touchMedia(entry: MediaEntry): void {
    clearTimeout(entry.timer);
    entry.expiresAt = Date.now() + 30 * 60000;
    entry.timer = setTimeout(() => {
      // Long recordings and deliberately paused active streams can outlive
      // thirty minutes. Only an unused opaque handle expires by time.
      if (entry.requests.size) this.touchMedia(entry);
      else this.close(entry.job.input.id);
    }, 30 * 60000);
    entry.timer.unref();
  }
  /** Stream into a private file with backpressure and strict count/length validation. */
  private async transfer(job: Job, filename: string): Promise<{ size: number; mimeType: string }> {
    const maximum = MAX_SAVE;
    const tooLarge = "asset_too_large";
    for (let attempt = 0; attempt < 2; attempt++) {
      this.check(job);
      const lease = job.lease ?? await this.authorize(job);
      if (lease.size !== undefined && lease.size > maximum) throw new Error(tooLarge);
      let handle: FileHandle | undefined, received = 0, declared: number | undefined, rejected: Error | undefined;
      let mimeType = lease.mimeType;
      let lastProgress = 0;
      try {
        handle = await open(filename, "wx", 0o600);
        job.partial = filename;
        await lease.request({
          onHeaders: (status, headers) => {
            if ([401, 403].includes(status)) { rejected = new Error("asset_expired"); throw rejected; }
            if (status !== 200) { rejected = new Error(status === 404 ? "asset_unavailable" : "asset_access_denied"); throw rejected; }
            const length = head(headers, "content-length");
            if (length) {
              if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) <= 0) { rejected = new Error("asset_unavailable"); throw rejected; }
              declared = Number(length);
              if (declared > maximum) { rejected = new Error(tooLarge); throw rejected; }
            }
            if (head(headers, "content-encoding") && head(headers, "content-encoding") !== "identity") { rejected = new Error("asset_unsupported"); throw rejected; }
          },
          onChunk: async (bytes) => {
            this.check(job);
            received += bytes.length;
            if (received > maximum || (declared !== undefined && received > declared)) { rejected = new Error(tooLarge); throw rejected; }
            try {
              let offset = 0;
              while (offset < bytes.length) {
                const written = await handle!.write(bytes, offset, bytes.length - offset);
                if (!written.bytesWritten) throw new Error();
                offset += written.bytesWritten;
              }
            } catch { rejected = new Error("asset_disk_error"); throw rejected; }
            this.check(job);
            if (Date.now() - lastProgress > 100) {
              lastProgress = Date.now();
              this.options.emit({ kind: "asset", id: job.input.id, type: "progress", received, total: declared ?? lease.size });
            }
          },
        });
        this.check(job);
        if (!received || (declared !== undefined && received !== declared) || (lease.size !== undefined && received !== lease.size)) throw new Error("asset_unavailable");
        await handle.sync(); await handle.close(); handle = undefined;
        this.check(job);
        this.options.emit({ kind: "asset", id: job.input.id, type: "progress", received, total: received });
        return { size: received, mimeType };
      } catch (error) {
        const problem = rejected ?? failure(error);
        await handle?.close().catch(() => {}); handle = undefined;
        await rm(filename, { force: true }).catch(() => {}); job.partial = undefined;
        if (problem.message === "asset_expired" && attempt === 0) {
          lease.release(); job.lease = undefined;
          await this.authorize(job); continue;
        }
        throw problem;
      } finally { await handle?.close().catch(() => {}); }
    }
    throw new Error("asset_expired");
  }
  async save(input: unknown): Promise<{ cancelled: boolean; saved: boolean }> {
    const job = this.begin(input);
    try {
      const lease = await this.authorize(job);
      const destination = await this.options.chooseSavePath(lease.filename);
      this.check(job);
      if (!destination) return { cancelled: true, saved: false };
      if (!path.isAbsolute(destination)) throw new Error("asset_disk_error");
      const temporary = path.join(path.dirname(destination), `.meetspace-${randomUUID()}.part`);
      await this.transfer(job, temporary);
      this.check(job);
      try { await rename(temporary, destination); } catch { throw new Error("asset_disk_error"); }
      job.partial = undefined;
      return { cancelled: false, saved: true };
    } catch (error) { throw failure(error); }
    finally { await this.discard(job); }
  }
  async open(input: unknown): Promise<{ id: string; url: string; mimeType: string }> {
    const job = this.begin(input);
    try {
      if (job.input.asset.kind !== "recording") throw new Error("asset_unsupported");
      const lease = await this.authorize(job);
      if (!lease.playable) throw new Error("asset_unsupported");
      this.check(job);
      const opaque = randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + 30 * 60000;
      const timer = setTimeout(() => this.close(job.input.id), Math.max(1, expiresAt - Date.now()));
      timer.unref();
      const entry: MediaEntry = { job, opaque, mimeType: lease.mimeType, expiresAt, timer, requests: new Map() };
      this.media.set(opaque, entry);
      this.touchMedia(entry);
      job.lease!.signal.addEventListener("abort", () => this.close(job.input.id), { once: true });
      return { id: job.input.id, url: `app://meetspace/native-media/${opaque}`, mimeType: lease.mimeType };
    } catch (error) { await this.discard(job); throw failure(error); }
  }
  close(id: unknown): void {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error("invalid_request");
    for (const [opaque, entry] of this.media) {
      if (entry.job.input.id === id) {
        this.media.delete(opaque); clearTimeout(entry.timer);
        for (const abort of [...entry.requests.values()]) abort();
      }
    }
    const job = this.jobs.get(id);
    if (job) void this.discard(job);
  }
  cancel(id: unknown): void { this.close(id); }
  reset(): void { for (const id of [...this.jobs.keys()]) this.close(id); }
  async dispose(): Promise<void> {
    this.disposed = true;
    // Detach before abort: a stream's finish/detach callback must not refresh
    // the expiry timer of an entry that is being disposed.
    const entries = [...this.media.values()];
    this.media.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      for (const abort of [...entry.requests.values()]) abort();
    }
    await Promise.all([...this.jobs.values()].map(job => this.discard(job)));
  }
  async handleMedia(request: Request): Promise<Response | null> {
    let url: URL;
    try { url = new URL(request.url); } catch { return null; }
    if (!url.pathname.startsWith("/native-media/")) return null;
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": "default-src 'none'",
      ...(this.options.development ? { "Cross-Origin-Resource-Policy": "cross-origin", "Access-Control-Allow-Origin": DEV_ORIGIN,
        "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges", Vary: "Origin" } : {}) };
    const denied = (status = 403) => new Response(null, { status, headers });
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== (this.options.development ? DEV_ORIGIN : APP_ORIGIN)) return denied();
    if (url.protocol !== "app:" || url.hostname !== "meetspace" || url.port || url.username || url.password || url.search || url.hash ||
      !/^\/native-media\/[A-Za-z0-9_-]{43}$/.test(url.pathname)) return denied();
    if (!["GET", "HEAD"].includes(request.method)) return denied(405);
    const entry = this.media.get(url.pathname.slice("/native-media/".length));
    if (!entry || (entry.expiresAt <= Date.now() && !entry.requests.size)) return denied(404);
    const rangeHeader = request.headers.get("range");
    if (rangeHeader !== null && (rangeHeader.length > 100 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(rangeHeader))) return denied(416);
    const proofId = randomUUID();
    let proof: NativeAssetLease | undefined, cancelled = false;
    let abort = () => { cancelled = true; this.options.broker.cancel(proofId); proof?.release(); };
    const stop = () => abort();
    entry.requests.set(proofId, stop);
    this.touchMedia(entry);
    request.signal.addEventListener("abort", stop, { once: true });
    const detach = () => {
      request.signal.removeEventListener("abort", stop); entry.requests.delete(proofId);
      if (this.media.get(entry.opaque) === entry) this.touchMedia(entry);
    };
    try {
      this.check(entry.job);
      if (request.signal.aborted) throw new Error("request_cancelled");
      // Every Range obtains a fresh authorized capability. Recording bytes go
      // straight from native HTTPS into a bounded stream; nothing is cached.
      proof = await this.options.broker.authorizeAsset({ ...entry.job.input, id: proofId });
      if (cancelled) throw new Error("request_cancelled");
      proof.check();
      this.check(entry.job);
      if (!proof.playable || proof.mimeType !== entry.mimeType) throw new Error("asset_unsupported");
      if (proof.size !== undefined && !mediaByteRange(rangeHeader, proof.size)) {
        const size = proof.size; detach(); proof.release();
        return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      }
      let controller: ReadableStreamDefaultController<Uint8Array>, wake: (() => void) | undefined;
      let ended = false, received = 0, length = 0, headersSeen = false;
      let resolveHeaders: (value: Response) => void, rejectHeaders: (error: Error) => void;
      const ready = new Promise<Response>((resolve, reject) => { resolveHeaders = resolve; rejectHeaders = reject; });
      const finish = (error?: Error) => {
        if (ended) return;
        ended = true; detach(); wake?.(); wake = undefined;
        try { if (error) controller.error(error); else controller.close(); } catch { /* Consumer already cancelled. */ }
        if (error && !headersSeen) rejectHeaders(error);
        proof?.release();
      };
      const stream = new ReadableStream<Uint8Array>({
        start(value) { controller = value; },
        pull() { wake?.(); wake = undefined; },
        cancel() { finish(new Error("request_cancelled")); },
      }, { highWaterMark: 65536, size: bytes => bytes.byteLength });
      abort = () => finish(new Error("request_cancelled"));
      // The signed URL is a GET capability. Local HEAD still performs GET and
      // aborts as soon as validated headers arrive, without exposing any body.
      void proof.request({ ...(rangeHeader ? { range: rangeHeader } : {}),
        onHeaders: (status, incoming) => {
          if (ended) throw new Error("request_cancelled");
          this.check(entry.job); proof!.check();
          if (status !== (rangeHeader ? 206 : 200)) throw new Error("asset_access_denied");
          const count = head(incoming, "content-length");
          if (!/^\d+$/.test(count) || !Number.isSafeInteger(Number(count)) || Number(count) <= 0) throw new Error("asset_unavailable");
          length = Number(count);
          const encoding = head(incoming, "content-encoding");
          const mime = head(incoming, "content-type").split(";", 1)[0].trim().toLowerCase();
          if ((encoding && encoding !== "identity") || (mime !== entry.mimeType && mime !== "application/octet-stream")) throw new Error("asset_unsupported");
          let total = length, contentRange: string | undefined;
          if (rangeHeader) {
            contentRange = head(incoming, "content-range");
            const parsed = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
            if (!parsed || parsed.slice(1).some(value => !Number.isSafeInteger(Number(value)))) throw new Error("asset_unavailable");
            const start = Number(parsed[1]), end = Number(parsed[2]); total = Number(parsed[3]);
            const expected = mediaByteRange(rangeHeader, total);
            if (!expected || start !== expected.start || end !== expected.end || length !== end - start + 1) throw new Error("asset_unavailable");
          } else if (head(incoming, "content-range")) throw new Error("asset_unavailable");
          if (proof!.size !== undefined && total !== proof!.size) throw new Error("asset_unavailable");
          const responseHeaders = { ...headers, "Content-Type": entry.mimeType, "Accept-Ranges": "bytes", "Content-Length": String(length),
            ...(contentRange ? { "Content-Range": contentRange } : {}) };
          headersSeen = true;
          resolveHeaders(new Response(request.method === "HEAD" ? null : stream, { status, headers: responseHeaders }));
          if (request.method === "HEAD") queueMicrotask(() => finish());
        },
        onChunk: async bytes => {
          if (ended) throw new Error("request_cancelled");
          this.check(entry.job); proof!.check();
          received += bytes.byteLength;
          if (received > length) throw new Error("asset_unavailable");
          while (!ended && controller.desiredSize !== null && controller.desiredSize <= 0)
            await new Promise<void>(resolve => { wake = resolve; });
          if (ended) throw new Error("request_cancelled");
          controller.enqueue(bytes);
        },
      }).then(() => {
        if (!ended) finish(received === length ? undefined : new Error("asset_unavailable"));
      }).catch(error => finish(failure(error)));
      return await ready;
    } catch {
      detach(); proof?.release();
      if (!cancelled && !request.signal.aborted) this.close(entry.job.input.id);
      return denied();
    }
  }
}
