export type MacOSScreenAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

/** Read-only subset of Electron systemPreferences; screen consent is requested by getSources. */
export interface MacOSScreenAccessBridge {
  getMediaAccessStatus(kind: "screen"): MacOSScreenAccessStatus;
}

export class MacOSScreenAccess {
  constructor(private readonly bridge: MacOSScreenAccessBridge) {}

  status(): MacOSScreenAccessStatus {
    try {
      const status = this.bridge.getMediaAccessStatus("screen");
      return ["not-determined", "granted", "denied", "restricted"].includes(status) ? status : "unknown";
    } catch { return "unknown"; }
  }

  /** Gate custom-picker selection after enumeration, not the initial getSources.
   * In Electron 44, screen status uses CGPreflightScreenCaptureAccess and can be
   * denied before first use. getSources calls CGRequestScreenCaptureAccess.
   * Read again at each selection boundary: consent must never be cached. */
  canSelect(): boolean {
    return this.status() === "granted";
  }
}
