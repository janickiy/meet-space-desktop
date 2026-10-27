const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const MAX_JSON = 2 * 1024 * 1024;
export const MAX_BINARY = 10 * 1024 * 1024;
export const validId = (value: unknown): value is string => typeof value === "string" && new RegExp(`^${ID}$`).test(value);
export const validRequestId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const rules: Array<[string, RegExp]> = [];
const allow = (methods: string, route: string) => rules.push([methods, new RegExp(`^/api/v1${route}$`)]);
allow("POST", "/auth/(register|login|refresh|session|logout|accounts/list|accounts/switch)");
allow("GET PATCH DELETE", "/auth/me");
allow("PUT DELETE", "/auth/me/avatar");
allow("GET", `/users/${ID}/avatar/content`);
allow("GET", "/(capabilities|webrtc/config|users|me/conferences|search|admin/summary)");
allow("GET POST", "/conferences");
allow("GET", `/conferences/${ID}`);
allow("POST", `/conferences/${ID}/(start|finish|cancel|join|leave|invitations|reactions)`);
allow("GET", `/conferences/${ID}/(participants|participants/me|history|invitation-users|calendar|analytics|captions/segments)`);
allow("PUT", `/conferences/${ID}/(schedule|participants/me/media)`);
allow("POST", `/conferences/${ID}/participants/${ID}/(admission|moderation)`);
allow("GET PUT", `/conferences/${ID}/captions`);
allow("GET POST", `/conferences/${ID}/recordings`);
allow("GET", `/conferences/${ID}/recordings/${ID}(/(transcript|transcript/segments|summary))?`);
allow("POST", `/conferences/${ID}/recordings/${ID}/(stop|transcript/retry|summary/regenerate|search/reindex)`);
allow("GET", "/conference-invites/[A-Za-z0-9_-]{32}");
allow("POST", "/conference-invites/[A-Za-z0-9_-]{32}/(join|guest)");
allow("GET", "/conversations");
allow("POST", "/conversations/(direct|group)");
allow("GET PATCH DELETE", `/conversations/${ID}`);
allow("GET", `/conversations/${ID}/(peer-presence|avatar/content)`);
allow("GET POST", `/conversations/${ID}/members`);
allow("PATCH DELETE", `/conversations/${ID}/members/${ID}`);
allow("PATCH", `/conversations/${ID}/preferences`);
allow("POST", `/conversations/${ID}/(clear-history|hide|leave|ownership|read)`);
allow("PUT DELETE", `/conversations/${ID}/avatar`);
allow("GET", `/conversations/${ID}/messages/(search|${ID}/context)`);
allow("GET POST", `/(conferences|conversations)/${ID}/messages`);
allow("PATCH DELETE", `/(conferences|conversations)/${ID}/messages/${ID}`);
allow("GET PUT", `/(conferences|conversations)/${ID}/chat/read`);
allow("POST", `/(conferences|conversations)/${ID}/attachments/init`);
allow("PUT", `/(conferences|conversations)/${ID}/attachments/${ID}/content`);
allow("GET", `/conversations/${ID}/attachments/${ID}/content`);
allow("POST", `/(conferences|conversations)/${ID}/attachments/${ID}/finalize`);
allow("GET", `/(conferences|conversations)/${ID}/attachments/${ID}/download`);
allow("GET", `/conferences/${ID}/chat/(info|members|preferences|messages/search|messages/${ID}/context|materials|pins)`);
allow("PATCH", `/conferences/${ID}/chat/info`);
allow("PUT", `/conferences/${ID}/chat/preferences`);
allow("DELETE", `/conferences/${ID}/chat/membership`);
allow("PUT DELETE", `/conferences/${ID}/chat/pins/${ID}`);
allow("GET POST", "/folders");
allow("PUT", "/folders/order");
allow("GET PATCH DELETE", `/folders/${ID}`);
allow("GET", `/(folder-items|folders/${ID}/items)`);
allow("PUT DELETE", `/folders/${ID}/items/(conference|conversation)/${ID}`);
allow("POST", "/calls");
allow("GET", `/calls/(active|${ID})`);
allow("POST", `/calls/${ID}/(accept|decline|cancel|end|heartbeat)`);
allow("GET", "/notifications");
allow("POST", `/notifications/${ID}/read`);
allow("GET PUT", "/notifications/preferences");
allow("GET POST", "/notifications/devices");
allow("DELETE", `/notifications/devices/${ID}`);
allow("GET", "/integrations/(capabilities|calendars)");
allow("POST", "/integrations/calendars/mock");
allow("GET", "/integrations/calendars/(generic|google|microsoft)/connect");
allow("POST", "/integrations/calendars/(generic|google|microsoft)/callback");
allow("DELETE", `/integrations/calendars/${ID}`);
const queryKeys = new Set(["limit", "offset", "before", "after", "cursor", "afterCursor", "type", "status", "kind", "mode", "query", "q", "search", "unreadOnly", "from", "to", "folderId", "itemId", "itemKind", "conferenceId", "recordingId", "membership", "participantId", "view", "scope", "source"]);

export function validateApiPath(method: string, raw: string): string {
  if (typeof raw !== "string" || raw.length > 4096 || /[\u0000-\u0020\u007f\\#]/.test(raw) || !raw.startsWith("/api/v1/")) throw new Error("invalid_request");
  const pathname = raw.split("?", 1)[0];
  if (pathname.includes("%") || pathname.split("/").some((part) => part === "." || part === "..")) throw new Error("invalid_request");
  if (!rules.some(([methods, pattern]) => methods.split(" ").includes(method) && pattern.test(pathname))) throw new Error("operation_not_allowed");
  const query = new URL(raw, "https://policy.invalid").searchParams;
  if ([...query].length > 20) throw new Error("invalid_request");
  const seen = new Set<string>();
  for (const [name, value] of query) {
    if (!queryKeys.has(name) || seen.has(name) || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("invalid_request");
    seen.add(name);
  }
  return pathname;
}

export function publicOperation(method: string, pathname: string): boolean {
  return (method === "POST" && /^\/api\/v1\/auth\/(register|login|refresh|accounts\/list|accounts\/switch|logout)$/.test(pathname)) ||
    /^\/api\/v1\/conference-invites\/[A-Za-z0-9_-]{32}(\/guest)?$/.test(pathname);
}
export const cookieOperation = (pathname: string) => pathname.startsWith("/api/v1/auth/");
export const authResponse = (pathname: string) => /^\/api\/v1\/auth\/(login|refresh|session|accounts\/switch)$/.test(pathname) || /\/conference-invites\/[A-Za-z0-9_-]{32}\/guest$/.test(pathname);
export const binaryPath = (method: string, pathname: string) => (method === "GET" && new RegExp(`^/api/v1/users/${ID}/avatar/content$`).test(pathname)) ||
  (method === "PUT" && pathname === "/api/v1/auth/me/avatar") ||
  (method === "GET" && /^\/api\/v1\/conversations\/[^/]+\/(avatar\/content|attachments\/[^/]+\/content)$/.test(pathname)) ||
  (method === "PUT" && /^\/api\/v1\/(conferences|conversations)\/[^/]+\/(avatar|attachments\/[^/]+\/content)$/.test(pathname));

export function normalizeServerOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || /[\u0000-\u0020\u007f\\%]/.test(value)) throw new Error("invalid_server");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("invalid_server"); }
  if (url.protocol !== "https:" || !url.hostname || url.hostname.endsWith(".") || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error("invalid_server");
  return url.origin;
}

/** No response can expose credentials even if a future backend field is added. */
export function redactCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(accessToken|refreshToken|sessionToken|password|passwordHash|password_hash|authorization|cookie|set-cookie|ticket|clientSecret)$/i.test(key)) continue;
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    output[key] = redactCredentials(item);
  }
  return output;
}
