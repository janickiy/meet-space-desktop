import { app, Menu, nativeImage, Notification, screen, Tray } from "electron";
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import path from "node:path";
import { release } from "node:os";
import { DesktopLocalState, restoreWindowState } from "./window-state";
import type { DesktopNativePreferences } from "./shared/contracts";
import { createHostPlatform } from "./platform";
import type { HostPlatform } from "./platform";
import type { StartupProvider } from "./platform/autostart";
import { LinuxStatusNotifierMonitor } from "./platform/status-notifier";
import type { TrayAvailabilityMonitor } from "./platform/status-notifier";
import { createMacOSDockMenu } from "./platform/application-menu";

export class NativeShell {
  private readonly state = new DesktopLocalState(app.getPath("userData"));
  private tray: Tray | null = null;
  private unread = 0;
  private geometryTimer: ReturnType<typeof setTimeout> | null = null;
  private quitting = false;
  private disposed = false;
  private dockBadge: string | null = null;
  private maximized = new WeakMap<BrowserWindow, boolean>();
  private readonly hostPlatform: HostPlatform;
  private readonly trayMonitor: TrayAvailabilityMonitor | null;
  private trayChecked = false;
  private hiddenToTray = false;
  constructor(private readonly options: {
    window(): BrowserWindow | null;
    /** Recreate a destroyed window through the main-process single-window gate. */
    reopen?(): void;
    quit(): void;
    hide(): void;
    preferencesChanged(value: DesktopNativePreferences): void;
    hostPlatform?: HostPlatform;
    startupProvider?: StartupProvider;
    trayMonitor?: TrayAvailabilityMonitor;
  }) {
    this.hostPlatform = options.hostPlatform ?? createHostPlatform({ platform: process.platform, arch: process.arch,
      osRelease: release(), packaged: app.isPackaged, env: process.env });
    this.trayMonitor = this.hostPlatform.platform === "linux"
      ? options.trayMonitor ?? (process.platform === "linux" ? new LinuxStatusNotifierMonitor() : null) : null;
    try {
      const applicationRoot = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, "..");
      const icon = this.hostPlatform.platform === "darwin"
        ? nativeImage.createFromPath(path.join(applicationRoot, "resources/macos/TrayTemplate.png"))
        : this.hostPlatform.platform === "win32"
          ? path.join(applicationRoot, "resources/icon.ico")
          : nativeImage.createFromPath(path.join(applicationRoot, "resources/icon.png")).resize({ width: 18, height: 18 });
      if (this.hostPlatform.platform === "darwin" && typeof icon !== "string") {
        if (icon.isEmpty()) throw new Error("tray_image_unavailable");
        icon.setTemplateImage(true);
      }
      this.tray = new Tray(icon);
      this.tray.on("click", () => this.open());
      this.tray.on("double-click", () => this.open());
      this.updateTray();
    } catch { this.tray = null; }
    // The Dock remains useful when a menu bar icon cannot be created.
    this.updateDock();
    if (this.tray) this.trayMonitor?.start((available) => {
      this.trayChecked = true;
      if (!available && this.hiddenToTray && !this.quitting) this.show();
      this.updateTray();
      this.options.preferencesChanged(this.preferences());
    });
  }
  windowOptions(): Pick<BrowserWindowConstructorOptions, "x" | "y" | "width" | "height" | "minWidth" | "minHeight"> {
    const primary = screen.getPrimaryDisplay().workArea;
    const restored = restoreWindowState(this.state.windowState(), screen.getAllDisplays().map(display => display.workArea), primary);
    const bounds = this.hostPlatform.nativeFeatures.absoluteWindowPosition ? restored.bounds
      : { width: restored.bounds.width, height: restored.bounds.height };
    return { ...bounds, minWidth: Math.min(900, restored.bounds.width), minHeight: Math.min(640, restored.bounds.height) };
  }
  configureWindow(window: BrowserWindow): void {
    this.maximized.set(window, this.state.windowState()?.maximized === true);
    const remember = () => {
      if (this.geometryTimer) clearTimeout(this.geometryTimer);
      this.geometryTimer = setTimeout(() => { this.geometryTimer = null; this.remember(window); }, 150);
    };
    window.on("move", remember);
    window.on("resize", remember);
    window.on("maximize", () => { this.maximized.set(window, true); remember(); });
    window.on("unmaximize", () => { this.maximized.set(window, false); remember(); });
    window.on("show", () => { this.hiddenToTray = false; this.updateTray(); });
    window.on("hide", () => {
      // Native macOS Hide (Cmd+H) bypasses hide(). Cancel any pending picker,
      // without stopping active media or destroying the background renderer.
      if (this.hostPlatform.platform === "darwin" && !this.hiddenToTray) this.options.hide();
      this.updateTray();
    });
    window.on("close", (event) => {
      this.remember(window);
      if (this.quitting) return;
      event.preventDefault();
      // macOS keeps an application reachable from the Dock without a menu bar icon.
      if (this.hostPlatform.platform === "darwin" || (this.state.getPreferences().closeToTray && this.canHide())) this.hide();
      else this.options.quit();
    });
    const place = () => {
      if (window.isDestroyed() || window.isFullScreen()) return;
      const maximized = window.isMaximized();
      const requested = { bounds: window.getNormalBounds(), maximized };
      const bounds = restoreWindowState(requested, screen.getAllDisplays().map(display => display.workArea), screen.getPrimaryDisplay().workArea).bounds;
      window.setMinimumSize(Math.min(900, bounds.width), Math.min(640, bounds.height));
      if (!this.hostPlatform.nativeFeatures.absoluteWindowPosition) {
        if (!maximized && (bounds.width !== requested.bounds.width || bounds.height !== requested.bounds.height))
          window.setSize(bounds.width, bounds.height);
        return;
      }
      if (JSON.stringify(bounds) === JSON.stringify(requested.bounds)) return;
      if (maximized) window.unmaximize();
      window.setBounds(bounds);
      if (maximized) window.maximize();
    };
    screen.on("display-removed", place);
    screen.on("display-metrics-changed", place);
    window.once("closed", () => {
      screen.removeListener("display-removed", place);
      screen.removeListener("display-metrics-changed", place);
      if (this.geometryTimer) clearTimeout(this.geometryTimer);
      this.geometryTimer = null;
    });
    if (this.state.windowState()?.maximized) window.maximize();
  }
  preferences(): DesktopNativePreferences {
    const providerStartup = this.hostPlatform.platform !== "win32" ? this.options.startupProvider?.status() : undefined;
    const startupSupported = providerStartup?.supported ?? this.hostPlatform.nativeFeatures.startup;
    const startup = this.hostPlatform.platform === "win32" && startupSupported
      ? app.getLoginItemSettings({ path: process.execPath, args: [] }) : null;
    const startAtLogin = providerStartup?.enabled ?? (startup?.openAtLogin === true && startup.executableWillLaunchAtLogin === true);
    const local = this.state.getPreferences();
    const trayAvailable = this.canHide();
    return { ...local, closeToTray: trayAvailable && local.closeToTray,
      startAtLogin, startupSupported, startupReason: providerStartup?.reason ?? (this.hostPlatform.platform !== "win32" && !providerStartup ? "unpackaged" : undefined),
      notificationsSupported: Notification.isSupported(), trayAvailable,
      trayStatus: trayAvailable ? "available" : this.tray && this.trayMonitor && !this.trayChecked ? "checking" : "unavailable" };
  }
  updatePreferences(input: unknown): DesktopNativePreferences {
    if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length ||
      Object.keys(input).some(key => !["closeToTray", "nativeNotifications", "startAtLogin"].includes(key)) ||
      Object.values(input).some(value => typeof value !== "boolean")) throw new Error("invalid_request");
    const patch = input as Partial<{closeToTray:boolean; nativeNotifications:boolean; startAtLogin:boolean}>;
    if (patch.closeToTray === true && !this.canHide()) throw new Error("tray_unavailable");
    if (patch.startAtLogin !== undefined) {
      if (!this.preferences().startupSupported) throw new Error("startup_unavailable");
      if (this.hostPlatform.platform !== "win32") this.options.startupProvider!.setEnabled(patch.startAtLogin);
      else app.setLoginItemSettings({ openAtLogin: patch.startAtLogin, enabled: patch.startAtLogin, path: process.execPath, args: [] });
      if (this.preferences().startAtLogin !== patch.startAtLogin) throw new Error("startup_unavailable");
    }
    const local = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "startAtLogin"));
    if (Object.keys(local).length) this.state.updatePreferences(local);
    const preferences = this.preferences();
    this.options.preferencesChanged(preferences);
    return preferences;
  }
  show(): void {
    if (this.disposed || this.quitting) return;
    const window = this.options.window();
    if (!window || window.isDestroyed()) return;
    this.hiddenToTray = false;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  }
  hide(): void {
    if (this.disposed || this.quitting) return;
    if (this.hostPlatform.platform !== "darwin" && !this.canHide()) return;
    const window = this.options.window();
    if (!window || window.isDestroyed()) return;
    this.options.hide();
    this.hiddenToTray = true;
    window.hide();
  }
  setUnread(value: number): void {
    if (this.disposed || this.quitting) return;
    this.unread = Number.isSafeInteger(value) && value >= 0 ? Math.min(9999, value) : 0;
    this.updateTray();
  }
  prepareQuit(): void {
    this.quitting = true;
    this.unread = 0;
    this.updateDock();
    const window = this.options.window();
    if (window) this.remember(window);
    if (this.geometryTimer) clearTimeout(this.geometryTimer);
    this.geometryTimer = null;
  }
  dispose(): void {
    if (this.disposed) return;
    this.prepareQuit();
    this.disposed = true;
    this.trayMonitor?.dispose(); this.tray?.destroy(); this.tray = null;
    if (this.hostPlatform.platform === "darwin") {
      try { app.dock?.setMenu(Menu.buildFromTemplate([])); } catch { /* Quitting must continue if the native Dock is unavailable. */ }
    }
  }
  private remember(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    try { this.state.setWindow({ bounds: window.getNormalBounds(), maximized: window.isMinimized() ? this.maximized.get(window) === true : window.isMaximized() }); }
    catch { /* Geometry persistence failure must not prevent quit. */ }
  }
  private updateTray(): void {
    this.updateDock();
    if (!this.tray || this.tray.isDestroyed()) return;
    this.tray.setToolTip(this.unread ? `MeetSpace — ${this.unread} новых уведомлений` : "MeetSpace");
    this.tray.setContextMenu(Menu.buildFromTemplate(this.hostPlatform.platform === "darwin"
      ? this.macOSMenu() : [
      { label: "Открыть MeetSpace", click: () => this.show() },
      { label: "Скрыть в трей", click: () => this.hide(),
        enabled: this.canHide() && !!this.options.window()?.isVisible() },
      { type: "separator" },
      { label: "Выход из MeetSpace", click: () => this.options.quit() },
    ]));
  }
  private macOSMenu() {
    return createMacOSDockMenu({ show: () => this.open(), hide: () => this.hide(),
      quit: () => { if (!this.disposed && !this.quitting) this.options.quit(); },
      visible: !this.disposed && !this.quitting && this.options.window()?.isVisible() === true });
  }
  private open(): void {
    if (this.disposed || this.quitting) return;
    if (this.options.reopen) this.options.reopen();
    else this.show();
  }
  private updateDock(): void {
    if (this.hostPlatform.platform !== "darwin" || this.disposed || !app.dock) return;
    try {
      // Numeric aggregate only; account/profile changes call setUnread(0).
      // macOS may suppress badges when notification permission is disabled.
      const badge = !this.quitting && this.unread > 0 ? String(this.unread) : "";
      if (this.dockBadge !== badge) { app.dock.setBadge(badge); this.dockBadge = badge; }
      app.dock.setMenu(Menu.buildFromTemplate(this.quitting ? [] : this.macOSMenu()));
    } catch { /* A denied/unavailable native indicator must not block messages or quit. */ }
  }
  private canHide(): boolean {
    return !!this.tray && !this.tray.isDestroyed() && (this.hostPlatform.platform === "linux"
      ? this.trayMonitor?.available() === true : this.hostPlatform.nativeFeatures.tray === "native");
  }
}
