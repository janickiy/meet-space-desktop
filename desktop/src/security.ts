export const APP_ORIGIN = "app://meetspace";
export const DEV_ORIGIN = "http://127.0.0.1:5173";
export const PUBLIC_ORIGIN = "https://meeting.janickiy.com";
export const DEEP_LINK_SCHEME = "meetspace:";

const controls = /[\u0000-\u0020\u007f\\]/;
const identifier = "[A-Za-z0-9_-]{1,160}";
const routes = [
  /^\/$/,
  /^\/(login|register|register\/success|app|app\/settings|settings|calendar|analytics|admin|notifications|search|app\/search|app\/recordings)$/,
  new RegExp(`^/i/${identifier}$`),
  new RegExp(`^/(personal|folders|history|recordings)(/${identifier})?$`),
  new RegExp(`^/(meetings|conferences)(/(new|${identifier})(/join)?)?$`),
  /^\/app\/settings\/calendar\/(google|microsoft)\/callback$/,
];

function parseUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048 || controls.test(value))
    return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url;
  } catch {
    return null;
  }
}

export function isAppUrl(value: unknown): boolean {
  const url = parseUrl(value);
  return (
    !!url &&
    url.protocol === "app:" &&
    url.hostname === "meetspace" &&
    !url.port &&
    /^app:\/\/meetspace(?:\/|\?|$)/.test(value as string)
  );
}

export function isTrustedRendererUrl(
  value: unknown,
  development = false,
): boolean {
  const url = parseUrl(value);
  if (!url) return false;
  return development
    ? url.origin === DEV_ORIGIN &&
        /^http:\/\/127\.0\.0\.1:5173(?:\/|\?|$)/.test(value as string)
    : isAppUrl(value);
}

export function isAllowedRoute(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    controls.test(value) ||
    value.includes("%") ||
    value.includes("?") ||
    value.includes("#")
  )
    return false;
  return routes.some((route) => route.test(value));
}

export function isAllowedNavigation(
  value: unknown,
  development = false,
): boolean {
  const url = parseUrl(value);
  return (
    !!url &&
    isTrustedRendererUrl(value, development) &&
    isAllowedRoute(url.pathname)
  );
}

export function isAllowedExternalUrl(value: unknown, selectedOrigin = PUBLIC_ORIGIN): value is string {
  const url = parseUrl(value);
  const server = parseUrl(selectedOrigin);
  return (
    !!url &&
    !!server && server.protocol === "https:" &&
    url.protocol === "https:" && url.origin === server.origin &&
    ((value as string) === server.origin || (value as string).startsWith(`${server.origin}/`) || (value as string).startsWith(`${server.origin}?`)) &&
    !(value as string).split(/[?#]/, 1)[0].includes("%") &&
    !url.hash
  );
}

/** OS deep links carry one route, never server addresses, tokens, or commands. */
export function parseDeepLink(value: unknown): string | null {
  const url = parseUrl(value);
  if (
    !url ||
    url.protocol !== DEEP_LINK_SCHEME ||
    url.hostname !== "open" ||
    url.port ||
    url.search ||
    url.hash ||
    !/^meetspace:\/\/open\/(?:i\/[A-Za-z0-9_-]{32}|(?:meetings|conferences)\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/join)$/.test(value as string)
  )
    return null;
  return isAllowedRoute(url.pathname) ? url.pathname : null;
}

export function contentSecurityPolicy(
  development = false,
  nonce?: string,
): string {
  if (development && (!nonce || !/^[a-f0-9]{48}$/.test(nonce)))
    throw new Error("A generated development nonce is required");
  return [
    "default-src 'none'",
    `script-src 'self'${development ? ` 'nonce-${nonce}'` : ""}`,
    `style-src 'self'${development ? ` 'nonce-${nonce}'` : ""}`,
    `img-src 'self' data: blob:${development ? " app://meetspace/native-media/" : ""}`,
    "font-src 'self'",
    `media-src 'self' blob:${development ? " app://meetspace/native-media/" : ""}`,
    `connect-src 'self'${development ? " ws://127.0.0.1:5173 app://meetspace/native-media/" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export interface SenderContext {
  sender: unknown;
  senderFrame?: { url: string } | null;
}
export interface WindowContext {
  isDestroyed(): boolean;
  webContents: { mainFrame: { url: string }; isDestroyed(): boolean };
}

export function isTrustedSender(
  event: SenderContext,
  window: WindowContext | null,
  development = false,
): boolean {
  return (
    !!window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    isTrustedRendererUrl(event.senderFrame?.url, development)
  );
}

/** Application payload support; this is not proof of hardware compatibility. */
export function isSupportedWindows(release: string, arch: string): boolean {
  const match = /^10\.0\.(\d+)$/.exec(release);
  if (!match || !["x64", "arm64"].includes(arch)) return false;
  const build = Number(match[1]);
  return build >= 22000 || (build === 19045 && arch === "x64");
}
