export type DisplayCaptureMode = "picker" | "portal" | "unavailable";

export interface DisplayCapturePolicyOptions {
  platform: NodeJS.Platform;
  electronVersion: string;
  chromiumVersion: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** Ozone chooses the app window backend, not WebRTC's portal predicate. */
  ozonePlatform?: string;
}

/**
 * Linux consent assumptions are pinned to Electron 44.7.1 / Chromium 152.
 * Chromium DEPS pins WebRTC 6f37672d358475cd17544121a12494da454d85fb:
 * desktop_capturer.cc CreateGenericCapturer requires allow_pipewire() and
 * IsRunningUnderWayland(), which reads raw XDG_SESSION_TYPE/WAYLAND_DISPLAY.
 * Chromium content/public/browser/desktop_capture.cc enables allow_pipewire.
 * Re-audit these predicates before allowing another Linux runtime version.
 * A single returned X11 source never constitutes portal consent.
 * Sources:
 * https://raw.githubusercontent.com/electron/electron/v44.7.1/shell/browser/api/electron_api_desktop_capturer.cc
 * https://raw.githubusercontent.com/chromium/chromium/152.0.7977.149/content/public/browser/desktop_capture.cc
 * https://webrtc.googlesource.com/src/+/6f37672d358475cd17544121a12494da454d85fb/modules/desktop_capture/desktop_capturer.cc
 */
export function displayCaptureMode(options: DisplayCapturePolicyOptions): DisplayCaptureMode {
  if (options.platform === "win32" || options.platform === "darwin") return "picker";
  if (options.platform !== "linux" || options.electronVersion !== "44.7.1" ||
    options.chromiumVersion !== "152.0.7977.149") return "unavailable";
  const env = options.env;
  // This is a conservative subset of WebRTC's raw, case-sensitive predicate.
  // Do not normalize values as the general desktop metadata adapter does.
  if (env?.XDG_SESSION_TYPE === "wayland" && env.WAYLAND_DISPLAY?.trim()) return "portal";
  if (env?.XDG_SESSION_TYPE === "x11" && env.DISPLAY?.trim() && env.WAYLAND_DISPLAY === undefined) return "picker";
  return "unavailable";
}
