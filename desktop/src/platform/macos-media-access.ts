export type MacOSMediaKind = "camera" | "microphone";
export type MacOSMediaAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

/** The camera/microphone subset of Electron systemPreferences. */
export interface MacOSMediaAccessBridge {
  getMediaAccessStatus(kind: MacOSMediaKind): MacOSMediaAccessStatus;
  askForMediaAccess(kind: MacOSMediaKind): Promise<boolean>;
}

/** Native consent only; the caller must separately validate the requesting document. */
export class MacOSMediaAccess {
  private readonly pending = new Map<MacOSMediaKind, Promise<boolean>>();

  constructor(private readonly bridge: MacOSMediaAccessBridge) {}

  status(kind: MacOSMediaKind): MacOSMediaAccessStatus {
    if (kind !== "camera" && kind !== "microphone") return "unknown";
    try {
      const status = this.bridge.getMediaAccessStatus(kind);
      return ["not-determined", "granted", "denied", "restricted"].includes(status) ? status : "unknown";
    } catch { return "unknown"; }
  }

  /** A synchronous Chromium check must allow first use to reach the async request. */
  check(types: readonly MacOSMediaKind[]): boolean {
    const kinds = this.kinds(types);
    return kinds !== null && kinds.every(kind => {
      const status = this.status(kind);
      return status === "granted" || status === "not-determined";
    });
  }

  async ensure(types: readonly MacOSMediaKind[]): Promise<boolean> {
    const kinds = this.kinds(types);
    // Avoid asking for one device when another requested device is already blocked.
    if (kinds === null || !this.check(kinds)) return false;
    for (const kind of kinds) {
      if (!await this.ensureKind(kind)) return false;
    }
    // Do not cache consent: it may have changed while another prompt was open.
    return kinds.every(kind => this.status(kind) === "granted");
  }

  private kinds(types: readonly MacOSMediaKind[]): MacOSMediaKind[] | null {
    if (!Array.isArray(types) || types.some(kind => kind !== "camera" && kind !== "microphone")) return null;
    return [...new Set(types)];
  }

  private ensureKind(kind: MacOSMediaKind): Promise<boolean> {
    const existing = this.pending.get(kind);
    if (existing) return existing;
    const request = Promise.resolve().then(async () => {
      // Recheck after concurrent callers have registered their in-flight request.
      const status = this.status(kind);
      if (status === "granted") return true;
      if (status !== "not-determined") return false;
      try {
        return await this.bridge.askForMediaAccess(kind) === true && this.status(kind) === "granted";
      } catch { return false; }
    });
    this.pending.set(kind, request);
    void request.finally(() => {
      if (this.pending.get(kind) === request) this.pending.delete(kind);
    });
    return request;
  }
}
