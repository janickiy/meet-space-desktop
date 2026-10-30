import fs from "node:fs";
import path from "node:path";
import type { StartupProvider } from "./autostart";

export interface MacOSLoginItemBridge {
  getLoginItemSettings(options: { type: "mainAppService" }): { openAtLogin: boolean; status: string };
  setLoginItemSettings(options: { openAtLogin: boolean; type: "mainAppService" }): void;
}

export interface MacOSAutostartOptions {
  platform: NodeJS.Platform;
  packaged: boolean;
  appId: string;
  execPath: string;
  appPath: string;
  homeDir: string;
  bridge: MacOSLoginItemBridge;
  /** Read-only filesystem boundary for tests. Never supplied by renderer or IPC. */
  canonicalPath?(filename: string): string;
}

const ids = new Set(["com.janickiy.meetspace.desktop", "com.janickiy.meetspace.desktop.test"]);
const unavailable = () => new Error("startup_unavailable");
const validPath = (value: string): boolean => typeof value === "string" && path.posix.isAbsolute(value) &&
  value.length <= 4096 && !/[\u0000-\u001f\u007f\\]/.test(value) && path.posix.normalize(value) === value;

/** The main app service registers the running bundle, never a renderer-supplied command.
 * Only installed Applications bundles are persistent candidates. DMG, translocated,
 * downloaded, development and unpacked artifact paths stay disabled.
 */
function installed(options: MacOSAutostartOptions): boolean {
  if (options.platform !== "darwin" || !options.packaged || !ids.has(options.appId) ||
      ![options.execPath, options.appPath, options.homeDir].every(validPath)) return false;
  const canonical = options.canonicalPath ?? (filename => fs.realpathSync(filename));
  const home = canonical(options.homeDir), executable = canonical(options.execPath), application = canonical(options.appPath);
  if (!validPath(home) || executable !== options.execPath || application !== options.appPath) return false;
  return ["/Applications/MeetSpace.app", path.posix.join(home, "Applications/MeetSpace.app")].some(bundle =>
    executable === path.posix.join(bundle, "Contents/MacOS/MeetSpace") &&
    application === path.posix.join(bundle, "Contents/Resources/app.asar"));
}

/** Construction/status never register or unregister a login item. Native state is
 * read on every call so Settings changes made outside MeetSpace remain authoritative.
 * https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows
 */
export function createMacOSAutostart(options: MacOSAutostartOptions): StartupProvider {
  const status: StartupProvider["status"] = () => {
    if (!options.packaged) return { supported: false, enabled: false, reason: "unpackaged" };
    try {
      if (!installed(options)) return { supported: false, enabled: false, reason: "unavailable" };
      const native = options.bridge.getLoginItemSettings({ type: "mainAppService" });
      if (typeof native?.openAtLogin !== "boolean") throw unavailable();
      if (native.status === "requires-approval") return { supported: true, enabled: false, reason: "approval-required" };
      if (native.status === "enabled" && native.openAtLogin) return { supported: true, enabled: true };
      if (native.status === "not-registered" && !native.openAtLogin) return { supported: true, enabled: false };
      // Missing, unexpected or contradictory native states must not promise startup.
      return { supported: false, enabled: false, reason: "unavailable" };
    } catch { return { supported: false, enabled: false, reason: "unavailable" }; }
  };
  return {
    status,
    setEnabled(enabled) {
      if (typeof enabled !== "boolean") throw new Error("invalid_request");
      const before = status();
      if (!before.supported || (enabled && before.reason === "approval-required")) throw unavailable();
      if (before.enabled === enabled && before.reason !== "approval-required") return;
      try {
        // macOS uses SMAppService; path/args/enabled are Windows-only settings.
        options.bridge.setLoginItemSettings({ type: "mainAppService", openAtLogin: enabled });
        const after = status();
        if (!after.supported || after.enabled !== enabled || after.reason === "approval-required") throw unavailable();
      } catch { throw unavailable(); }
    },
  };
}
