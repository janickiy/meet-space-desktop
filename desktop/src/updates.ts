import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { release } from "node:os";
import path from "node:path";
import type { NativeTransport } from "./network/transport";
import { isSupportedWindows } from "./security";
import { compareUpdateVersions, parseUpdateTrust, updateFeedUrl, updateInstallerUrl, validUpdateVersion, verifyUpdateManifest, type UpdateArchitecture, type UpdatePayload, type UpdateTrust } from "./updates-policy";
import { launchWindowsInstaller, verifyWindowsSignature } from "./updates-signature";

export interface NativeUpdateState {
  enabled: boolean;
  phase: "disabled" | "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  code?: string;
}
export interface NativeUpdatesOptions {
  trust: unknown;
  packaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  currentVersion: string;
  currentExecutable: string;
  cacheDir: string;
  transport: NativeTransport;
  emit(state: NativeUpdateState): void;
  beforeInstall?(): Promise<boolean>;
  onInstallerLaunched?(): void;
  /** Trusted host-test seams; never set from IPC, environment or user profiles. */
  osRelease?: string;
  autoCheck?: boolean;
  verifySignature?(filename: string, trust: UpdateTrust, signal: AbortSignal): Promise<void>;
  launchInstaller?(filename: string): Promise<void>;
}
interface Operation { epoch: number; controller: AbortController }
const code = (error: unknown) => {
  const value = error instanceof Error ? error.message : "";
  return /^(update_(configuration_invalid|signature_invalid|manifest_invalid|manifest_expired|manifest_signature_invalid|architecture_invalid|version_invalid|rollback_denied|integrity_invalid|changed|install_failed|disk_error|cancelled|busy)|tls_error|dns_error|network_timeout|network_unavailable|redirect_not_allowed)$/.test(value) ? value : "update_unavailable";
};
const head = (headers: Record<string, string | string[]>, key: string) => { const value = headers[key]; return Array.isArray(value) ? value[0] ?? "" : value ?? ""; };
const same = (a: UpdatePayload, b: UpdatePayload) => a.version === b.version && a.arch === b.arch && a.installer.file === b.installer.file && a.installer.size === b.installer.size && a.installer.sha512 === b.installer.sha512;

/** Signed release authority is fixed at build time and completely separate from backend profiles. */
export class NativeUpdates {
  private trust: UpdateTrust | null = null;
  private status: NativeUpdateState;
  private initialized = false;
  private disposed = false;
  private epoch = 0;
  private operation?: Operation;
  private running?: Promise<NativeUpdateState>;
  private runningKind?: string;
  private candidate?: UpdatePayload;
  private prepared?: { filename: string; payload: UpdatePayload };
  private ownedFiles = new Set<string>();
  private highestVersion: string;
  private timer?: NodeJS.Timeout;
  private initialization?: Promise<NativeUpdateState>;
  private cancellation?: Promise<NativeUpdateState>;
  constructor(private readonly options: NativeUpdatesOptions) {
    this.status = { enabled: false, phase: "disabled", currentVersion: options.currentVersion, code: "update_not_configured" };
    this.highestVersion = options.currentVersion;
  }
  state(): NativeUpdateState { return { ...this.status }; }
  private set(phase: NativeUpdateState["phase"], extra: Partial<NativeUpdateState> = {}): NativeUpdateState {
    this.status = { enabled: this.status.enabled, phase, currentVersion: this.options.currentVersion, ...extra };
    if (!this.disposed) { try { this.options.emit(this.state()); } catch { /* A UI listener is not update authority. */ } }
    return this.state();
  }
  private assert(operation: Operation): void {
    if (this.disposed || operation.epoch !== this.epoch || operation.controller.signal.aborted) throw new Error("update_cancelled");
  }
  private verify(filename: string, operation: Operation): Promise<void> {
    this.assert(operation);
    return (this.options.verifySignature ?? verifyWindowsSignature)(filename, this.trust!, operation.controller.signal);
  }
  initialize(): Promise<NativeUpdateState> {
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeOnce(); return this.initialization;
  }
  private async initializeOnce(): Promise<NativeUpdateState> {
    try {
      this.trust = parseUpdateTrust(this.options.trust);
      if (!this.trust) return this.set("disabled", { code: "update_not_configured" });
      if (!this.options.packaged) return this.set("disabled", { code: "update_untrusted_build" });
      if (this.options.platform !== "win32" || !isSupportedWindows(this.options.osRelease ?? release(), this.options.arch))
        return this.set("disabled", { code: "update_unsupported_platform" });
      if (!validUpdateVersion(this.options.currentVersion)) return this.set("disabled", { code: "update_version_invalid" });
      const operation: Operation = { epoch: this.epoch, controller: new AbortController() };
      this.operation = operation;
      await this.verify(this.options.currentExecutable, operation); this.assert(operation);
      await mkdir(this.options.cacheDir, { recursive: true, mode: 0o700 });
      const directory = await lstat(this.options.cacheDir);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("update_disk_error");
      for (const item of await readdir(this.options.cacheDir, { withFileTypes: true })) {
        if (/^meetspace-update-[a-f0-9-]{36}\.(part|exe)$/.test(item.name) && (item.isFile() || item.isSymbolicLink()))
          await rm(path.join(this.options.cacheDir, item.name), { force: true });
      }
      this.assert(operation); this.initialized = true;
      this.set("idle", { enabled: true });
      if (this.options.autoCheck !== false) this.schedule(1000);
      return this.state();
    } catch (error) { return this.set("disabled", { enabled: false, code: code(error) }); }
    finally { this.operation = undefined; }
  }
  private schedule(delay = 6 * 60 * 60000): void {
    clearTimeout(this.timer);
    if (this.disposed || !this.initialized || this.options.autoCheck === false) return;
    this.timer = setTimeout(() => {
      // Metadata checks never download or install an executable automatically.
      if (!this.running && this.status.phase !== "ready" && this.status.phase !== "installing") void this.check().catch(() => {});
      this.schedule();
    }, delay);
    this.timer.unref();
  }
  private run(kind: string, work: (operation: Operation) => Promise<NativeUpdateState>): Promise<NativeUpdateState> {
    if (this.disposed) return Promise.reject(new Error("update_cancelled"));
    if (!this.initialized || !this.status.enabled) return Promise.resolve(this.state());
    if (this.status.phase === "installing") return Promise.resolve(this.state());
    if (this.cancellation) return Promise.reject(new Error("update_busy"));
    if (this.running) return this.runningKind === kind ? this.running : Promise.reject(new Error("update_busy"));
    const operation: Operation = { epoch: this.epoch, controller: new AbortController() };
    this.operation = operation; this.runningKind = kind;
    const pending = Promise.resolve().then(() => work(operation)).catch(error => {
      if (operation.epoch !== this.epoch || this.disposed) return this.state();
      return this.set("error", { code: code(error) });
    }).finally(() => {
      if (this.operation === operation) this.operation = undefined;
      if (this.running === pending) { this.running = undefined; this.runningKind = undefined; }
    });
    this.running = pending; return pending;
  }
  private async metadata(operation: Operation): Promise<UpdatePayload> {
    await this.verify(this.options.currentExecutable, operation); this.assert(operation);
    const response = await this.options.transport.request({ url: updateFeedUrl(this.trust!, this.options.arch as UpdateArchitecture), method: "GET",
      headers: { Accept: "application/json" }, signal: operation.controller.signal, maxResponseBytes: 65536 });
    this.assert(operation);
    if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(head(response.headers, "content-type"))) throw new Error("update_manifest_invalid");
    const payload = verifyUpdateManifest(response.body, this.trust!, this.options.arch as UpdateArchitecture, this.options.currentVersion);
    if (compareUpdateVersions(payload.version, this.highestVersion) < 0) throw new Error("update_rollback_denied");
    this.highestVersion = payload.version; return payload;
  }
  private async clearFiles(): Promise<void> {
    this.prepared = undefined;
    await Promise.all([...this.ownedFiles].map(async filename => { await rm(filename, { force: true }).catch(() => {}); this.ownedFiles.delete(filename); }));
  }
  check(): Promise<NativeUpdateState> {
    return this.run("check", async operation => {
      if (this.status.phase === "installing") throw new Error("update_busy");
      await this.clearFiles(); this.candidate = undefined; this.assert(operation); this.set("checking");
      const candidate = await this.metadata(operation); this.assert(operation);
      if (compareUpdateVersions(candidate.version, this.options.currentVersion) === 0) return this.set("idle");
      this.candidate = candidate; return this.set("available", { availableVersion: candidate.version });
    });
  }
  download(): Promise<NativeUpdateState> {
    return this.run("download", async operation => {
      const candidate = this.candidate;
      if (!candidate || this.status.phase !== "available") throw new Error("update_changed");
      const fresh = await this.metadata(operation); this.assert(operation);
      if (!same(fresh, candidate)) { this.candidate = fresh; throw new Error("update_changed"); }
      await this.clearFiles(); this.assert(operation);
      this.set("downloading", { availableVersion: fresh.version, percent: 0 });
      const temporary = path.join(this.options.cacheDir, `meetspace-update-${randomUUID()}.part`);
      const file = await open(temporary, "wx", 0o600).catch(() => { throw new Error("update_disk_error"); });
      this.ownedFiles.add(temporary);
      let received = 0, lastProgress = 0, failure: string | undefined;
      const rejectDownload = (reason: string): never => { failure = reason; throw new Error(reason); };
      const hash = createHash("sha512");
      try {
        this.assert(operation);
        await this.options.transport.request({ url: updateInstallerUrl(this.trust!, fresh), method: "GET", headers: { Accept: "application/octet-stream" },
          signal: operation.controller.signal, maxResponseBytes: fresh.installer.size,
          onHeaders: (status, headers) => {
            this.assert(operation);
            const length = head(headers, "content-length"), encoding = head(headers, "content-encoding");
            if (status !== 200 || (encoding && encoding !== "identity") || !/^\d+$/.test(length) || Number(length) !== fresh.installer.size) rejectDownload("update_integrity_invalid");
          },
          onChunk: async bytes => {
            this.assert(operation); received += bytes.byteLength;
            if (received > fresh.installer.size) rejectDownload("update_integrity_invalid");
            hash.update(bytes);
            for (let offset = 0; offset < bytes.byteLength;) {
              const written = await file.write(bytes, offset, bytes.byteLength - offset).catch(() => rejectDownload("update_disk_error"));
              if (!written.bytesWritten) rejectDownload("update_disk_error"); offset += written.bytesWritten;
            }
            this.assert(operation);
            if (Date.now() - lastProgress > 100) { lastProgress = Date.now(); this.set("downloading", { availableVersion: fresh.version, percent: Math.min(99, Math.floor(100 * received / fresh.installer.size)) }); }
          },
        });
        this.assert(operation);
        if (received !== fresh.installer.size || hash.digest("base64") !== fresh.installer.sha512) throw new Error("update_integrity_invalid");
        await file.sync(); await file.close();
        const filename = temporary.replace(/\.part$/, ".exe");
        await rename(temporary, filename); this.ownedFiles.delete(temporary); this.ownedFiles.add(filename); this.assert(operation);
        await this.verify(filename, operation); this.assert(operation);
        this.prepared = { filename, payload: fresh }; this.candidate = fresh;
        return this.set("ready", { availableVersion: fresh.version, percent: 100 });
      } catch (error) { await file.close().catch(() => {}); await this.clearFiles(); throw failure ? new Error(failure) : error; }
    });
  }
  private async verifyPrepared(filename: string, payload: UpdatePayload, operation: Operation): Promise<void> {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== payload.installer.size) throw new Error("update_integrity_invalid");
    const file = await open(filename, "r");
    try {
      const hash = createHash("sha512");
      for await (const chunk of file.createReadStream({ autoClose: false })) { this.assert(operation); hash.update(chunk); }
      if (hash.digest("base64") !== payload.installer.sha512) throw new Error("update_integrity_invalid");
    } finally { await file.close(); }
    await this.verify(filename, operation); this.assert(operation);
  }
  install(): Promise<NativeUpdateState> {
    return this.run("install", async operation => {
      const prepared = this.prepared;
      if (!prepared || this.status.phase !== "ready") throw new Error("update_changed");
      if (this.options.beforeInstall && !await this.options.beforeInstall()) return this.state();
      this.assert(operation);
      const fresh = await this.metadata(operation); this.assert(operation);
      if (!same(fresh, prepared.payload)) { await this.clearFiles(); throw new Error("update_changed"); }
      await this.verifyPrepared(prepared.filename, fresh, operation); this.assert(operation);
      // Crossing this boundary commits the explicit user action. Cancelling or
      // checking again cannot remove the executable while Windows is starting it.
      this.set("installing", { availableVersion: fresh.version });
      await (this.options.launchInstaller ?? launchWindowsInstaller)(prepared.filename);
      this.ownedFiles.delete(prepared.filename); // The launched process owns its lifetime; next startup cleans it.
      try { this.options.onInstallerLaunched?.(); } catch { /* Installer has already started. */ }
      return this.state();
    });
  }
  cancel(): Promise<NativeUpdateState> {
    if (this.status.phase === "installing") return Promise.resolve(this.state());
    if (this.cancellation) return this.cancellation;
    const pending = this.cancelOnce().finally(() => { if (this.cancellation === pending) this.cancellation = undefined; });
    this.cancellation = pending; return pending;
  }
  private async cancelOnce(): Promise<NativeUpdateState> {
    this.epoch++; this.operation?.controller.abort();
    await this.running?.catch(() => {});
    await this.clearFiles(); this.candidate = undefined;
    return this.status.enabled ? this.set("idle") : this.state();
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true; clearTimeout(this.timer); this.epoch++; this.operation?.controller.abort();
    await this.running?.catch(() => {});
    if (this.status.phase !== "installing") await this.clearFiles();
  }
}
