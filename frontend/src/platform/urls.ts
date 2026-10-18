import { isDesktopBuild } from "./build";

export let publicWebOrigin = "https://meeting.janickiy.com";
let selectedServerID: string | null = null;

/** Set only after the native broker confirms the selected public profile. */
export function setDesktopServer(
  profile: { id: string; origin: string } | null,
) {
  if (profile) {
    const url = new URL(profile.origin);
    if (
      url.protocol !== "https:" ||
      url.origin !== profile.origin ||
      url.username ||
      url.password
    )
      throw new Error("Unsupported server origin");
    publicWebOrigin = url.origin;
  }
  selectedServerID = profile?.id ?? null;
}

export function serviceOrigin(): string {
  return isDesktopBuild ? publicWebOrigin : window.location.origin;
}

export function desktopServerID(): string | null {
  return selectedServerID;
}

/** Keep fixed application links exact; all other links must use the selected service. */
export function externalServiceURL(value: string): string {
  if (
    value === "https://janickiy.com/" ||
    value === "https://letsencrypt.org/repository/"
  )
    return value;
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/u.test(value))
    throw new Error("Unsupported external address");
  const url = new URL(value);
  if (
    (!value.startsWith(`${publicWebOrigin}/`) &&
      value !== publicWebOrigin &&
      !value.startsWith(`${publicWebOrigin}?`)) ||
    url.origin !== publicWebOrigin ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    value.split(/[?#]/, 1)[0].includes("%") ||
    url.pathname.includes("%") ||
    url.hash
  )
    throw new Error("Unsupported external address");
  return url.href;
}

/** Renderer validation is additional defence; the main process also validates routes. */
export function desktopRoute(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\u0000-\u0020\u007f\\]/u.test(value)
  )
    return undefined;
  try {
    const url = new URL(value, publicWebOrigin);
    if (url.origin !== publicWebOrigin || url.hash) return undefined;
    const routes = [
      /^\/$/,
      /^\/(?:login|register(?:\/success)?)\/?$/,
      /^\/app(?:\/(?:settings|recordings))?\/?$/,
      /^\/(?:calendar|analytics|settings|notifications|admin)\/?$/,
      /^\/(?:meetings|conferences)(?:\/[A-Za-z0-9_-]+(?:\/join)?)?\/?$/,
      /^\/(?:recordings|history|folders)(?:\/[A-Za-z0-9_-]+)?\/?$/,
      /^\/personal(?:\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})?\/?$/,
      /^\/i\/[A-Za-z0-9_-]{32}\/?$/,
    ];
    if (!routes.some((route) => route.test(url.pathname))) return undefined;
    return url.pathname + url.search;
  } catch {
    return undefined;
  }
}
