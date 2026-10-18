import { execFile } from "node:child_process";

const WATCHER = "org.kde.StatusNotifierWatcher";
const WATCHER_PATH = "/StatusNotifierWatcher";
const DBUS = "org.freedesktop.DBus";
const DBUS_PATH = "/org/freedesktop/DBus";
const busName = /^(?::[0-9]+\.[0-9]+|[A-Za-z_][A-Za-z0-9_.-]{1,254})$/;
const itemPath = /^\/(?:[A-Za-z0-9_]+\/)*[A-Za-z0-9_]+$/;

export interface BusValue { type: string; data: unknown }
export type StatusNotifierQuery = (args: readonly string[], signal: AbortSignal) => Promise<BusValue>;
export interface TrayAvailabilityMonitor {
  available(): boolean;
  start(changed: (available: boolean) => void): void;
  dispose(): void;
}

/** Fixed executable, no shell, bounded output/time. Nothing from the renderer reaches D-Bus. */
export const queryStatusNotifier: StatusNotifierQuery = (args, signal) => new Promise((resolve, reject) => {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
  // AppImage library overrides must not load its bundled libraries into a host utility.
  delete env.LD_PRELOAD;
  delete env.LD_LIBRARY_PATH;
  execFile("/usr/bin/busctl", ["--user", "--json=short", "--timeout=1s", ...args],
    { encoding: "utf8", timeout: 1400, killSignal: "SIGKILL", maxBuffer: 64 * 1024, signal, env, windowsHide: true },
    (error, stdout) => {
      if (error) { reject(new Error("tray_unavailable")); return; }
      try {
        const value: unknown = JSON.parse(stdout);
        if (!value || typeof value !== "object" || Array.isArray(value) ||
          typeof (value as BusValue).type !== "string" || !Object.hasOwn(value, "data")) throw new Error();
        resolve(value as BusValue);
      } catch { reject(new Error("tray_unavailable")); }
    });
});

function call(query: StatusNotifierQuery, signal: AbortSignal, method: string, name: string) {
  return query(["call", DBUS, DBUS_PATH, DBUS, method, "s", name], signal);
}
function scalar(value: BusValue, type: string): unknown {
  if (value.type !== type) return undefined;
  // Method replies wrap their scalar in a one-element argument list; properties do not.
  return Array.isArray(value.data) ? value.data.length === 1 ? value.data[0] : undefined : value.data;
}

/** A watcher alone is insufficient: a host and an item owned by THIS main PID must be registered.
 * https://github.com/KDE/kstatusnotifieritem/blob/master/src/org.kde.StatusNotifierWatcher.xml
 * Registration does not prove a panel's visual layout; OS acceptance observes that separately.
 */
export async function statusNotifierRegistered(query: StatusNotifierQuery, pid: number, signal: AbortSignal): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || signal.aborted) return false;
  try {
    const owner = scalar(await call(query, signal, "GetNameOwner", WATCHER), "s");
    if (typeof owner !== "string" || !/^:[0-9]+\.[0-9]+$/.test(owner)) return false;
    const readOwner = async (name: string): Promise<string | null> => {
      try {
        const result = scalar(await call(query, signal, "GetNameOwner", name), "s");
        return typeof result === "string" && /^:[0-9]+\.[0-9]+$/.test(result) ? result : null;
      } catch { return null; }
    };
    const property = (name: string) => query(["get-property", WATCHER, WATCHER_PATH, WATCHER, name], signal);
    if (scalar(await property("IsStatusNotifierHostRegistered"), "b") !== true) return false;
    // GNOME AppIndicator58 implements the host inline on the Shell connection.
    // KDE5.27's watcher property is always true even after plasmashell exits;
    // require a separately owned host name there, not only that property.
    // https://github.com/ubuntu/gnome-shell-extension-appindicator/blob/v58/statusNotifierWatcher.js
    // https://github.com/KDE/plasma-workspace/blob/v5.27.12/applets/systemtray/statusnotifieritemhost.cpp
    let hostName = "org.gnome.Shell";
    let hostOwner = await readOwner(hostName);
    if (hostOwner !== owner) {
      const names = await query(["call", DBUS, DBUS_PATH, DBUS, "ListNames"], signal);
      if (names.type !== "as" || !Array.isArray(names.data) || names.data.length !== 1 ||
        !Array.isArray(names.data[0]) || names.data[0].length > 4096) return false;
      const hosts = names.data[0].filter((name: unknown): name is string => typeof name === "string" &&
        /^org\.kde\.StatusNotifierHost-[A-Za-z0-9_.-]{1,160}$/.test(name));
      if (hosts.length > 16) return false;
      hostOwner = null;
      for (const name of hosts) {
        if (signal.aborted) return false;
        const current = await readOwner(name);
        if (current) { hostName = name; hostOwner = current; break; }
      }
      if (!hostOwner) return false;
    }
    const items = await property("RegisteredStatusNotifierItems");
    if (items.type !== "as" || !Array.isArray(items.data) || items.data.length > 64 ||
      items.data.some(value => typeof value !== "string" || value.length > 512)) return false;
    const checked = new Map<string, unknown>();
    let ownItem = false;
    for (const item of items.data as string[]) {
      if (signal.aborted) return false;
      const slash = item.indexOf("/");
      const name = slash < 0 ? item : item.slice(0, slash);
      if (!busName.test(name) || (slash >= 0 && !itemPath.test(item.slice(slash)))) continue;
      if (!checked.has(name)) checked.set(name, scalar(await call(query, signal, "GetConnectionUnixProcessID", name), "u"));
      if (checked.get(name) === pid) { ownItem = true; break; }
    }
    if (!ownItem) return false;
    // Do not accept a snapshot assembled across a watcher replacement.
    const finalHostOwner = await readOwner(hostName);
    const finalWatcherOwner = scalar(await call(query, signal, "GetNameOwner", WATCHER), "s");
    return !signal.aborted && finalHostOwner === hostOwner && finalWatcherOwner === owner;
  } catch { return false; }
}

/** Polling also notices extension/host shutdown. No global desktop setting is changed. */
export class LinuxStatusNotifierMonitor implements TrayAvailabilityMonitor {
  private value = false;
  private disposed = false;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: AbortController | null = null;
  private sampledAt = 0;
  private notified = false;
  constructor(private readonly options: { pid?: number; query?: StatusNotifierQuery; intervalMs?: number; deadlineMs?: number } = {}) {}
  available(): boolean { return !this.disposed && this.value && Date.now() - this.sampledAt < 6500; }
  start(changed: (available: boolean) => void): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const probe = async () => {
      if (this.disposed) return;
      const controller = this.inFlight = new AbortController();
      let deadline: ReturnType<typeof setTimeout>;
      const timedOut = new Promise<false>(resolve => {
        deadline = setTimeout(() => { controller.abort(); resolve(false); }, this.options.deadlineMs ?? 2000);
        deadline.unref?.();
      });
      // A native child error or a non-settling adapter must not strand a hidden window.
      const value = await Promise.race([statusNotifierRegistered(this.options.query ?? queryStatusNotifier,
        this.options.pid ?? process.pid, controller.signal), timedOut]);
      clearTimeout(deadline!);
      if (this.inFlight === controller) this.inFlight = null;
      if (this.disposed) return;
      this.sampledAt = Date.now();
      if (!this.notified || value !== this.value) {
        this.value = value;
        this.notified = true;
        try { changed(value); } catch { /* Menu/window teardown must not stop monitoring. */ }
      }
      if (this.disposed) return;
      this.timer = setTimeout(() => { this.timer = null; void probe(); }, this.options.intervalMs ?? 3000);
      this.timer.unref?.();
    };
    void probe();
  }
  dispose(): void {
    this.disposed = true;
    this.value = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.inFlight?.abort();
    this.inFlight = null;
  }
}
