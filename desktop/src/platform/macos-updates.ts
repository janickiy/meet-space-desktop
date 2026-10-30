import type { NativeUpdateState } from "../updates";
import { validUpdateVersion } from "../updates-policy";
import { parseMacOSUpdateTrust } from "./macos-updates-policy";

export interface MacOSUpdatesOptions {
  trust: unknown;
  packaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  currentVersion: string;
  emit(state: NativeUpdateState): void;
}

/** Deliberately closed release gate, not an operational Squirrel updater.
 * Electron's checkForUpdates automatically downloads and stages a ZIP which may
 * install at the next launch. It cannot be wired into the Windows metadata-only
 * check/cancel UI without a signed ZIP/feed and native update acceptance.
 * https://www.electronjs.org/docs/latest/api/auto-updater
 */
export class MacOSUpdates {
  private disposed = false;
  private initialized = false;
  private status: NativeUpdateState;
  constructor(private readonly options: MacOSUpdatesOptions) {
    this.status = { enabled: false, phase: "disabled", currentVersion: options.currentVersion, code: "update_not_configured" };
  }
  state(): NativeUpdateState { return { ...this.status }; }
  async initialize(): Promise<NativeUpdateState> {
    if (this.disposed) throw new Error("update_cancelled");
    if (!this.initialized) {
      this.initialized = true;
      let code = "update_not_configured";
      try {
        const trust = parseMacOSUpdateTrust(this.options.trust);
        if (trust) {
          code = this.options.platform !== "darwin" ? "update_unsupported_platform"
            : !["x64", "arm64"].includes(this.options.arch) ? "update_architecture_invalid"
            : !this.options.packaged ? "update_untrusted_build"
            : !validUpdateVersion(this.options.currentVersion) ? "update_version_invalid"
            : "update_macos_acceptance_required";
        }
      } catch { code = "update_configuration_invalid"; }
      this.status = { enabled: false, phase: "disabled", currentVersion: this.options.currentVersion, code };
      try { this.options.emit(this.state()); } catch { /* UI listeners cannot authorize an updater. */ }
    }
    return this.state();
  }
  private async disabled(): Promise<NativeUpdateState> {
    if (this.disposed) throw new Error("update_cancelled");
    return this.initialize();
  }
  check(): Promise<NativeUpdateState> { return this.disabled(); }
  download(): Promise<NativeUpdateState> { return this.disabled(); }
  install(): Promise<NativeUpdateState> { return this.disabled(); }
  cancel(): Promise<NativeUpdateState> { return this.disabled(); }
  async dispose(): Promise<void> { this.disposed = true; }
}
