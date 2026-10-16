import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  contentSecurityPolicy,
  isAllowedRoute,
  isAppUrl,
  APP_ORIGIN,
} from "./security";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

function response(
  body: BodyInit | null,
  status: number,
  type = "text/plain; charset=utf-8",
): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": type,
      "Content-Security-Policy": contentSecurityPolicy(),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}

/** Only bundled files and known SPA paths. There is deliberately no network proxy. */
export async function serveAppRequest(
  request: Request & { initiatorOrigin?: string },
  rendererRoot: string,
): Promise<Response> {
  if (
    !isAppUrl(request.url) ||
    (request.initiatorOrigin !== undefined &&
      request.initiatorOrigin !== APP_ORIGIN)
  )
    return response(null, 403);
  if (!["GET", "HEAD"].includes(request.method)) return response(null, 405);
  const url = new URL(request.url);
  // Reject escaped separators/traversal before any path resolution or filesystem access.
  const rawPath =
    request.url.slice(APP_ORIGIN.length).split(/[?#]/, 1)[0] || "/";
  if (
    rawPath.includes("%") ||
    rawPath.includes("\\") ||
    rawPath.split("/").some((part) => part === "." || part === "..")
  )
    return response(null, 400);
  if (url.pathname.startsWith("/api/") || url.pathname === "/api")
    return response(
      JSON.stringify({
        status: "failed",
        message: "Use the validated desktop transport",
      }),
      403,
      "application/json; charset=utf-8",
    );
  const route = isAllowedRoute(url.pathname);
  const relative = route ? "index.html" : url.pathname.slice(1);
  if (!relative || !mime[path.extname(relative)]) return response(null, 404);
  try {
    const root = await realpath(rendererRoot);
    const target = await realpath(path.resolve(root, relative));
    const distance = path.relative(root, target);
    if (!distance || distance.startsWith("..") || path.isAbsolute(distance))
      return response(null, 403);
    const info = await stat(target);
    if (!info.isFile()) return response(null, 404);
    const data =
      request.method === "HEAD" ? null : new Uint8Array(await readFile(target));
    const result = response(data, 200, mime[path.extname(target)]);
    result.headers.set("Content-Length", String(info.size));
    return result;
  } catch {
    return response(null, 404);
  }
}
