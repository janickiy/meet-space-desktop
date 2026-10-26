import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  Notification,
  net,
  protocol,
  powerMonitor,
  safeStorage,
  session,
  shell,
} from "electron";
import type {
  IpcMainInvokeEvent,
  MenuItemConstructorOptions,
  Session,
} from "electron";
import path from "node:path";
import { readFileSync } from "node:fs";
import { release } from "node:os";
import {
  APP_ORIGIN,
  DEV_ORIGIN,
  contentSecurityPolicy,
  isAllowedExternalUrl,
  isAllowedRoute,
  isAllowedNavigation,
  isAppUrl,
  isSupportedWindows,
  isTrustedRendererUrl,
  isTrustedSender,
  parseDeepLink,
} from "./security";
import { serveAppRequest } from "./protocol";
import { MeetSpaceBroker } from "./broker";
import type { DesktopBrokerOptions } from "./broker";
import { createElectronTransport } from "./network/transport";
import type { DesktopRuntimeInfo } from "./shared/contracts";
import { MediaPermissions } from "./media-permissions";
import { NativeShell } from "./native-shell";
import { NativeNotifications } from "./native-notifications";
import { createLinuxAutostart } from "./platform/autostart";
import { NativeAssets } from "./downloads";
import { NativeUpdates } from "./updates";
import { SshInstallerController } from "./ssh/controller";
import type { AcceptanceBuild } from "./acceptance";
import { createHostPlatform, createCredentialStore, displayCaptureMode } from "./platform";
import type { HostPlatform, CredentialStore } from "./platform";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: false,
      allowServiceWorkers: false,
    },
  },
]);

const development =
  !app.isPackaged && process.env.MEETSPACE_DESKTOP_DEV === "1";
const nonce = development ? process.env.MEETSPACE_DEV_CSP_NONCE : undefined;
let mainWindow: BrowserWindow | null = null;
let pendingRoute: string | null = null;
let routeReady = false;
let broker: MeetSpaceBroker | null = null;
let nativeShell: NativeShell | null = null;
let notifications: NativeNotifications | null = null;
let assets: NativeAssets | null = null;
let updates: NativeUpdates | null = null;
let sshInstaller: SshInstallerController | null = null;
let hostPlatform: HostPlatform | null = null;
let credentialStore: CredentialStore | null = null;
let quitting = false;
let quitPrepared = false;
const mediaPermissions = new MediaPermissions({
  owner: () => mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()
    ? { contents: mainWindow.webContents, frame: mainWindow.webContents.mainFrame } : null,
  development,
  platform: process.platform,
  displayMode: () => displayCaptureMode({ platform: process.platform,
    electronVersion: process.versions.electron, chromiumVersion: process.versions.chrome,
    env: process.env, ozonePlatform: app.commandLine.getSwitchValue("ozone-platform") }),
  getSources: (thumbnails) => desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: thumbnails ? { width: 240, height: 135 } : { width: 0, height: 0 }, fetchWindowIcons: false }),
  emit: (event) => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
      mainWindow.webContents.send("meetspace:display-capture", event);
  },
});

// Only fixed messages cross IPC. Native failures may contain URLs, cookies or tokens.
const transportMessages: Record<string, string> = {
  invalid_server: "Введите адрес HTTPS-сервера без пути, пароля и параметров.",
  server_not_selected: "Выберите сервер MeetSpace.",
  server_not_found: "Сервер больше не сохранён.",
  server_limit: "Достигнут предел сохранённых серверов.",
  incompatible_server: "Версия сервера не поддерживается приложением.",
  invalid_response: "Сервер вернул некорректный ответ.",
  tls_error: "Не удалось проверить сертификат HTTPS-сервера.",
  dns_error: "Не удалось найти сервер. Проверьте адрес и подключение.",
  network_timeout: "Сервер не ответил вовремя. Повторите попытку.",
  network_unavailable: "Сервер недоступен. Проверьте подключение или выберите другой сервер.",
  secure_storage_unavailable: "Защищённое хранилище системы недоступно. Повторите запуск приложения.",
  secure_storage_corrupt: "Не удалось восстановить сохранённую сессию.",
  authentication_required: "Войдите в аккаунт на выбранном сервере.",
  stale_session: "Сессия изменилась. Повторите действие.",
  stale_request: "Подключение изменилось. Повторите действие.",
  request_aborted: "Запрос отменён.",
  request_cancelled: "Запрос отменён.",
  request_too_large: "Запрос превышает допустимый размер.",
  request_limit: "Слишком много запросов. Повторите действие позже.",
  socket_unavailable: "Соединение обновлений недоступно. Приложение повторит подключение.",
  stream_unavailable: "Поток уведомлений недоступен. Приложение повторит подключение.",
  request_not_allowed: "Этот запрос не разрешён приложением.",
  operation_not_allowed: "Это действие не разрешено приложением.",
  invalid_request: "Некорректный запрос.",
  response_too_large: "Ответ сервера превышает допустимый размер.",
  redirect_not_allowed: "Сервер перенаправил запрос. Проверьте его адрес.",
  capture_source_unavailable: "Выбранный экран или окно больше недоступны. Повторите выбор.",
  preferences_unavailable: "Не удалось сохранить настройки приложения. Повторите попытку.",
  startup_unavailable: "Автозапуск недоступен в этой среде. Проверьте настройки приложения и системы.",
  startup_conflict: "Файл автозапуска изменён вне MeetSpace. Проверьте настройки автозапуска системы.",
  tray_unavailable: "Системный трей недоступен. Закрытие окна завершает приложение.",
  asset_access_denied: "Доступ к файлу закрыт. Обновите страницу или обратитесь к организатору.",
  asset_unavailable: "Файл недоступен. Обновите страницу и повторите действие.",
  asset_unsupported: "Этот формат пока нельзя открыть в приложении. Сохраните файл для просмотра.",
  asset_url_invalid: "Сервер вернул неподдерживаемую ссылку на файл.",
  asset_expired: "Ссылка на файл истекла. Повторите действие для получения новой ссылки.",
  asset_too_large: "Файл превышает предел сохранения 2 ГиБ.",
  asset_disk_error: "Не удалось записать файл. Проверьте свободное место и доступ к папке.",
  asset_limit: "Уже открыто несколько файлов. Завершите одну из операций и повторите действие.",
  update_busy: "Дождитесь завершения проверки обновления.",
  update_cancelled: "Обновление отменено.",
};

// Trust is part of the built application. CLI, renderer, selected server and
// environment variables cannot supply a feed or change the signing policy.
function buildIdentity(): AcceptanceBuild & { appId: string; trust: unknown } {
  const fallback = { releaseMode: "test", trustedRelease: false, sourceCommit: "", version: app.getVersion(),
    appId: "com.janickiy.meetspace.desktop.test", trust: { enabled: false } };
  try {
    const value = JSON.parse(readFileSync(path.join(__dirname, "build-provenance.json"), "utf8"));
    if (value.schemaVersion !== 2 || !["test", "release"].includes(value.releaseMode) ||
      !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !/^[a-f0-9]{64}$/.test(value.sourceTreeSha256) ||
      typeof value.sourceDirty !== "boolean") throw new Error("Invalid build identity");
    const trustedRelease = value.releaseMode === "release";
    const appId = trustedRelease ? "com.janickiy.meetspace.desktop" : fallback.appId;
    if (value.appId !== appId || (app.isPackaged && value.buildVersion !== app.getVersion() + (trustedRelease ? "" : "-test")) ||
      (trustedRelease && (value.sourceDirty || !/^[a-f0-9]{64}$/.test(value.releaseConfigSha256)))) throw new Error("Invalid build identity");
    const trust = trustedRelease ? JSON.parse(readFileSync(path.join(__dirname, "update-trust.json"), "utf8")) : { enabled: false };
    return { releaseMode: value.releaseMode, trustedRelease, sourceCommit: value.sourceCommit, version: app.getVersion(), appId, trust };
  } catch {
    if (app.isPackaged) throw new Error("Invalid packaged build identity");
    return fallback;
  }
}

function safeTransportError(error: unknown): { code: string; message: string } {
  const candidate = error instanceof Error ? error.message : "";
  const code = Object.hasOwn(transportMessages, candidate) ? candidate : "network_unavailable";
  return { code, message: transportMessages[code] };
}

function queueDeepLink(value: unknown): void {
  const route = parseDeepLink(value);
  if (!route) return;
  pendingRoute = route;
  flushRoute();
}

function flushRoute(): void {
  if (pendingRoute && routeReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("meetspace:route", pendingRoute);
    pendingRoute = null;
  }
}

function requestQuit(): void { if (!quitting) app.quit(); }

function notificationContext(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).length !== 3 || Object.keys(input).some(key => !["token", "route", "soundEnabled"].includes(key)))
    throw new Error("invalid_request");
  const value = input as { token: unknown; route: unknown; soundEnabled: unknown };
  if (typeof value.route !== "string" || value.route.length > 2048 || !value.route.startsWith("/") ||
    value.route.startsWith("//") || /[\u0000-\u0020\u007f\\]/.test(value.route) || typeof value.soundEnabled !== "boolean")
    throw new Error("invalid_request");
  const route = new URL(value.route, APP_ORIGIN);
  if (route.hash || !isAllowedRoute(route.pathname)) throw new Error("invalid_request");
  if (value.token === null) { notifications?.setContext(null); return; }
  broker!.nativeIdentity(value.token);
  notifications?.setContext({ route: value.route, soundEnabled: value.soundEnabled });
}

function requireSender(
  event: IpcMainInvokeEvent,
  args: unknown[],
  count: number,
): BrowserWindow {
  if (args.length !== count || !isTrustedSender(event, mainWindow, development))
    throw new Error("Operation is not allowed");
  return mainWindow!;
}

function installIpc(): void {
  ipcMain.handle(
    "meetspace:runtime",
    (event, ...args: unknown[]): DesktopRuntimeInfo => {
      requireSender(event, args, 0);
      return {
        platform: process.platform as DesktopRuntimeInfo["platform"],
        arch: process.arch as DesktopRuntimeInfo["arch"],
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        capabilities: { serverConnection: true, windowControls: true },
        host: {
          session: hostPlatform!.desktopSession,
          secureStorage: (() => { const state = credentialStore!.status(); return { available: state.available, backend: state.provider, reason: state.reason }; })(),
          supports: {
            startup: nativeShell?.preferences().startupSupported ?? hostPlatform!.nativeFeatures.startup,
            absoluteWindowPosition: hostPlatform!.nativeFeatures.absoluteWindowPosition,
            systemAudio: hostPlatform!.capture.systemAudio,
          },
        },
      };
    },
  );
  ipcMain.handle("meetspace:external", async (event, ...args: unknown[]) => {
    requireSender(event, args, 1);
    const selected = broker?.serversState();
    const origin = selected?.items.find((profile) => profile.id === selected.selectedId)?.origin;
    if (!isAllowedExternalUrl(args[0], origin)) throw new Error("Link is not allowed");
    await shell.openExternal(args[0]);
  });
  for (const action of ["minimize", "maximize", "close"] as const) {
    ipcMain.handle(`meetspace:${action}`, (event, ...args: unknown[]) => {
      const window = requireSender(event, args, 0);
      if (action === "minimize") window.minimize();
      if (action === "maximize")
        window.isMaximized() ? window.unmaximize() : window.maximize();
      if (action === "close") window.close();
    });
  }
  ipcMain.handle("meetspace:quit", (event, ...args: unknown[]) => {
    requireSender(event, args, 0);
    requestQuit();
  });
  ipcMain.handle("meetspace:route-ready", (event, ...args: unknown[]) => {
    requireSender(event, args, 0);
    routeReady = true;
    flushRoute();
  });
  const endpoints: Array<[string, number, (...args: unknown[]) => unknown]> = [
    ["ssh:state", 0, () => sshInstaller!.state()],
    ["ssh:action", 2, (action, input) => sshInstaller!.invoke(action, input)],
    ["servers:list", 0, () => broker!.listServers()],
    ["servers:probe", 1, (origin) => broker!.probeServer(origin)],
    ["servers:add", 1, (input) => broker!.addServer(input)],
    ["servers:select", 1, (id) => broker!.selectServer(id)],
    ["servers:remove", 1, (id) => broker!.removeServer(id)],
    ["http", 1, (input) => broker!.http(input)],
    ["http:abort", 1, (id) => broker!.cancel(id)],
    ["stream:open", 1, (input) => broker!.streamOpen(input)],
    ["stream:close", 1, (id) => broker!.streamClose(id)],
    ["socket:open", 1, (input) => broker!.socketOpen(input)],
    ["socket:send", 2, (id, data) => broker!.socketSend(id, data)],
    ["socket:close", 1, (id) => broker!.socketClose(id)],
    ["display:select", 1, (input) => mediaPermissions.select(input)],
    ["display:cancel", 1, (id) => mediaPermissions.cancelRequest(id)],
    ["native:preferences", 0, () => nativeShell!.preferences()],
    ["native:preferences:set", 1, (input) => nativeShell!.updatePreferences(input)],
    ["native:notification-context", 1, notificationContext],
    ["asset:save", 1, (input) => { if (!assets) throw new Error("asset_unavailable"); return assets.save(input); }],
    ["asset:open", 1, (input) => { if (!assets) throw new Error("asset_unavailable"); return assets.open(input); }],
    ["asset:close", 1, (id) => assets?.close(id)],
    ["asset:cancel", 1, (id) => assets?.cancel(id)],
    ["update:state", 0, () => updates!.state()],
    ["update:check", 0, () => updates!.check()],
    ["update:download", 0, () => updates!.download()],
    ["update:cancel", 0, () => updates!.cancel()],
    ["update:install", 0, () => updates!.install()],
  ];
  for (const [channel, count, operation] of endpoints)
    ipcMain.handle(`meetspace:${channel}`, async (event, ...args: unknown[]) => {
      requireSender(event, args, count);
      try { return { ok: true, value: await operation(...args) }; }
      catch (error) { return { ok: false, error: safeTransportError(error) }; }
    });
}

function secureSession(browserSession: Session, rendererRoot: string): void {
  browserSession.setPermissionRequestHandler(
    (contents, permission, callback, details) => callback(mediaPermissions.request(contents, permission, details)),
  );
  browserSession.setPermissionCheckHandler((contents, permission, origin, details) => mediaPermissions.check(contents, permission, origin, details));
  browserSession.setDisplayMediaRequestHandler((request, callback) => { void mediaPermissions.display(request, callback); });
  browserSession.on("will-download", (event) => event.preventDefault());
  // Remote HTTP/WSS lives in the broker. The renderer receives no direct network permission.
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = isAppUrl(details.url);
    if (development) {
      allowed = isTrustedRendererUrl(details.url, true);
      if (/^app:\/\/meetspace\/native-media\/[A-Za-z0-9_-]{43}$/.test(details.url) &&
        ["media", "image", "xhr"].includes(details.resourceType))
        allowed = !!mainWindow && details.webContentsId === mainWindow.webContents.id && details.frame === mainWindow.webContents.mainFrame;
      if (details.resourceType === "webSocket") {
        try {
          allowed = new URL(details.url).origin === "ws://127.0.0.1:5173";
        } catch {
          allowed = false;
        }
      }
    }
    callback({ cancel: !allowed });
  });
  browserSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy(development, nonce)],
        "X-Content-Type-Options": ["nosniff"],
        "Referrer-Policy": ["no-referrer"],
      },
    });
  });
  browserSession.protocol.handle("app", async (request) =>
    await assets?.handleMedia(request) ?? serveAppRequest(request, rendererRoot),
  );
}

export async function createFoundationWindow(
  show = true,
  rendererRoot = path.join(app.getAppPath(), "renderer"),
): Promise<BrowserWindow> {
  const browserSession = session.fromPartition("persist:meetspace-foundation");
  if (!(await browserSession.protocol.isProtocolHandled("app")))
    secureSession(
      browserSession,
      app.isPackaged ? path.join(app.getAppPath(), "renderer") : rendererRoot,
    );
  const window = new BrowserWindow({
    ...(nativeShell?.windowOptions() ?? { width: 1280, height: 850, minWidth: 900, minHeight: 640 }),
    show: false,
    title: "MeetSpace",
    backgroundColor: "#f7f7fb",
    icon: path.join(app.getAppPath(), "resources", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      session: browserSession,
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });
  mainWindow = window;
  nativeShell?.configureWindow(window);
  window.on("focus", () => notifications?.refreshFocus());
  routeReady = false;
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame) mediaPermissions.cancel();
    // pushState/replaceState keep the same renderer and its live account streams.
    // Only replacing the main document invalidates its pending IPC operations.
    if (details.isMainFrame && !details.isSameDocument) {
      routeReady = false;
      assets?.reset();
      notifications?.setContext(null);
      broker?.resetConnections();
      void sshInstaller?.invoke("detach").catch(() => {});
    }
  });
  window.webContents.on("render-process-gone", () => {
    routeReady = false;
    mediaPermissions.cancel();
    assets?.reset();
    notifications?.setContext(null);
    broker?.resetConnections();
    void sshInstaller?.invoke("detach").catch(() => {});
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url, development)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isAllowedNavigation(url, development)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("closed", () => {
    mediaPermissions.cancel();
    if (mainWindow === window) mainWindow = null;
    routeReady = false;
    assets?.reset();
    notifications?.setContext(null);
    broker?.resetConnections();
    void sshInstaller?.invoke("detach").catch(() => {});
  });
  const showInitially = () => {
    if (show && !quitting && mainWindow === window && !window.isDestroyed() &&
      !window.webContents.isDestroyed() && !window.isVisible()) window.show();
  };
  window.once("ready-to-show", showInitially);
  await window.loadURL(development ? DEV_ORIGIN : `${APP_ORIGIN}/`);
  // An unmapped Wayland surface may never emit ready-to-show. A successfully
  // loaded trusted document can be mapped without waiting for its first frame.
  if (hostPlatform?.desktopSession === "wayland") {
    window.removeListener("ready-to-show", showInitially);
    showInitially();
  }
  return window;
}

export async function startApp(
  options: {
    show?: boolean;
    userDataDir?: string;
    rendererRoot?: string;
    /** Trusted test-entry injection only; never read from renderer, environment or CLI. */
    brokerOptions?: Partial<Pick<DesktopBrokerOptions, "transport" | "createSocket">>;
  } = {},
): Promise<BrowserWindow | null> {
  if (options.userDataDir && !app.isPackaged)
    app.setPath("userData", options.userDataDir);
  if (
    !["win32", "darwin", "linux"].includes(process.platform) ||
    !["x64", "arm64"].includes(process.arch) ||
    (process.platform === "win32" &&
      !isSupportedWindows(release(), process.arch))
  ) {
    await app.whenReady();
    dialog.showErrorBox(
      "MeetSpace",
      "Требуется Linux x64/ARM64, Windows 10 22H2 x64, Windows 11 x64 или Windows 11 ARM64.",
    );
    app.quit();
    return null;
  }
  contentSecurityPolicy(development, nonce); // Validate developer configuration before creating a window.
  const identity = buildIdentity();
  // Release packaging omits acceptance.js entirely. This hook has fixed tests,
  // a fixed temporary directory, and can run only in an unsigned Windows build.
  const acceptance = identity.releaseMode === "test"
    ? (require("./acceptance") as typeof import("./acceptance")).prepareWindowsAcceptance(identity) : null;
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return null;
  }
  app.setAppUserModelId(identity.appId);
  app.on("second-instance", (_event, argv) => {
    argv.filter((arg) => arg.startsWith("meetspace:")).forEach(queueDeepLink);
    if (mainWindow && !mainWindow.isDestroyed()) {
      nativeShell?.show();
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    queueDeepLink(url);
    if (parseDeepLink(url)) nativeShell?.show();
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
  process.argv
    .filter((arg) => arg.startsWith("meetspace:"))
    .forEach(queueDeepLink);
  await app.whenReady();
  hostPlatform = createHostPlatform({ platform: process.platform, arch: process.arch, osRelease: release(), packaged: app.isPackaged, env: process.env });
  credentialStore = createCredentialStore(safeStorage, { platform: process.platform });
  notifications = new NativeNotifications({
    create: (options) => new Notification({
      ...options,
      icon: path.join(app.getAppPath(), "resources", "icon.png"),
    }),
    supported: () => Notification.isSupported(),
    isFocused: () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused(),
    navigate: (route) => { if (quitting) return; pendingRoute = route; nativeShell?.show(); flushRoute(); },
    onUnread: (count) => nativeShell?.setUnread(count),
    onSound: (identity, id) => {
      if (!quitting && mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
        mainWindow.webContents.send("meetspace:transport", { kind: "notification-sound", ...identity, id });
    },
  });
  const overrides = !app.isPackaged ? options.brokerOptions : undefined;
  broker = new MeetSpaceBroker({
    storageDir: app.getPath("userData"),
    transport: overrides?.transport ?? createElectronTransport(net, session.fromPartition("meetspace-native-network")),
    createSocket: overrides?.createSocket,
    onIdentityInvalidated: () => { mediaPermissions.cancel(); assets?.reset(); },
    onIdentityChanged: (identity) => notifications?.setIdentity(identity),
    onNotificationEvent: (event) => notifications?.observe(event),
    onAccountEvent: (event) => notifications?.observeAccount(event),
    onNotificationPreferences: (value) => notifications?.setPreferences(value),
    onNotificationUnread: (count) => notifications?.setUnreadCount(count),
    cipher: credentialStore,
    emit: (event) => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
        mainWindow.webContents.send("meetspace:transport", event);
    },
  });
  await broker.initialize();
  sshInstaller = new SshInstallerController({
    storageDir: path.join(app.getPath("userData"), "ssh-installer"),
    bundleRoot: path.join(app.isPackaged ? app.getAppPath() : path.resolve(__dirname, ".."), "resources/server-installer/v1"),
  });
  await sshInstaller.load();
  updates = new NativeUpdates({ trust: identity.trust, packaged: app.isPackaged, platform: process.platform, arch: process.arch,
    currentVersion: app.getVersion(), currentExecutable: process.execPath, cacheDir: path.join(app.getPath("userData"), "updates"),
    transport: createElectronTransport(net, session.fromPartition("meetspace-update-network")),
    emit: (state) => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
        mainWindow.webContents.send("meetspace:transport", { kind: "update", state });
    }, beforeInstall: async () => !quitting, onInstallerLaunched: requestQuit });
  await updates.initialize();
  assets = new NativeAssets({ broker, development, cacheDir: path.join(app.getPath("userData"), "native-media-cache"),
    chooseSavePath: async (suggestedName) => {
      if (!mainWindow || mainWindow.isDestroyed() || quitting) return null;
      const result = await dialog.showSaveDialog(mainWindow, { title: "Сохранить файл MeetSpace", defaultPath: suggestedName,
        buttonLabel: "Сохранить", properties: ["showOverwriteConfirmation", "createDirectory"] });
      return result.canceled || quitting ? null : result.filePath ?? null;
    },
    emit: (event) => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
        mainWindow.webContents.send("meetspace:transport", event);
    },
  });
  try { await assets.initialize(); }
  catch { await assets.dispose(); assets = null; }
  nativeShell = new NativeShell({ hostPlatform, window: () => mainWindow, quit: requestQuit,
    startupProvider: process.platform === "linux" ? createLinuxAutostart({ packaged: app.isPackaged,
      appId: identity.appId, execPath: process.execPath, env: process.env, homeDir: app.getPath("home"), uid: process.getuid!() }) : undefined,
    hide: () => mediaPermissions.cancel(), preferencesChanged: (value) => {
      notifications?.setEnabled(value.nativeNotifications);
      const hideItem = Menu.getApplicationMenu()?.getMenuItemById("meetspace-hide-to-tray");
      if (hideItem) hideItem.enabled = value.trayAvailable;
    } });
  notifications.setEnabled(nativeShell.preferences().nativeNotifications);
  app.on("before-quit", (event) => {
    if (quitPrepared) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    nativeShell?.prepareQuit();
    mediaPermissions.cancel();
    assets?.reset();
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
      mainWindow.webContents.send("meetspace:transport", { kind: "lifecycle", type: "quit" });
    // Give the shared client a short turn to stop capture and send media.leave before closing native sockets.
    setTimeout(() => {
      broker?.dispose();
      sshInstaller?.dispose();
      notifications?.dispose();
      nativeShell?.dispose();
      const cleanup = Promise.allSettled([assets?.dispose(), updates?.dispose()]);
      void Promise.race([cleanup, new Promise(resolve => setTimeout(resolve, 1500))]).then(() => {
        quitPrepared = true;
        app.quit();
      });
    }, 350);
  });
  const powerChanged = (type: "suspend" | "resume") => {
    mediaPermissions.cancel();
    assets?.reset();
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
      mainWindow.webContents.send("meetspace:transport", { kind: "lifecycle", type });
    broker?.resetConnections(true);
  };
  powerMonitor.on("suspend", () => powerChanged("suspend"));
  powerMonitor.on("resume", () => powerChanged("resume"));
  const menu: MenuItemConstructorOptions[] = [
    { label: "MeetSpace", submenu: [
      { label: "Открыть MeetSpace", click: () => nativeShell?.show() },
      { id: "meetspace-hide-to-tray", label: "Скрыть в трей", enabled: nativeShell.preferences().trayAvailable, click: () => nativeShell?.hide() },
      { type: "separator" },
      { label: "Выход из MeetSpace", accelerator: "CommandOrControl+Q", click: requestQuit },
    ] },
    {
      label: "Правка",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  // Linux handlers belong to the installed package's desktop entry (%u), not a
  // process-start mutation of the user's MIME defaults. Direct argv links still work.
  if (app.isPackaged && process.platform !== "linux") app.setAsDefaultProtocolClient("meetspace");
  installIpc();
  const window = await createFoundationWindow(
    options.show !== false,
    options.rendererRoot,
  );
  void acceptance?.run(window).catch(() => app.quit());
  app.on("activate", () => {
    if (!mainWindow) void createFoundationWindow().catch(() => app.quit());
    else nativeShell?.show();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  return window;
}
