import { validId } from "./network/policy";

export type NativeAsset =
  | { kind: "recording"; conferenceId: string; recordingId: string; fileId: string }
  | { kind: "attachment"; scope: "conference" | "conversation"; scopeId: string; attachmentId: string; filename?: string };

export function validateAsset(input: unknown): NativeAsset {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_request");
  const value = input as Record<string, unknown>;
  if (value.kind === "recording") {
    if (Object.keys(value).some(key => !["kind", "conferenceId", "recordingId", "fileId"].includes(key)) ||
      !validId(value.conferenceId) || !validId(value.recordingId) || !validId(value.fileId)) throw new Error("invalid_request");
  } else if (value.kind === "attachment") {
    if (Object.keys(value).some(key => !["kind", "scope", "scopeId", "attachmentId", "filename"].includes(key)) ||
      !["conference", "conversation"].includes(String(value.scope)) || !validId(value.scopeId) || !validId(value.attachmentId) ||
      (value.filename !== undefined && (typeof value.filename !== "string" || value.filename.length > 255))) throw new Error("invalid_request");
  } else throw new Error("invalid_request");
  return { ...value } as NativeAsset;
}

/** A suggested basename is never an authority to choose a local directory. */
export function safeAssetFilename(input: unknown, fallback = "MeetSpace-file"): string {
  let name = typeof input === "string" ? input.normalize("NFC").split(/[\\/]/).at(-1) ?? "" : "";
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, "_").slice(0, 160).replace(/[ .]+$/g, "");
  if (!name || name === "." || name === "..") name = fallback;
  if (/^(CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(name)) name = "_" + name;
  return name;
}

export function dispositionFilename(value: string): string | undefined {
  const extended = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (extended) { try { return decodeURIComponent(extended); } catch { return undefined; } }
  return /(?:^|;)\s*filename\s*=\s*"([^"\r\n]*)"/i.exec(value)?.[1] ?? /(?:^|;)\s*filename\s*=\s*([^;\r\n]+)/i.exec(value)?.[1]?.trim();
}

/** Only a fresh S3 SigV4 capability returned by the authorized API is accepted. */
export function signedAssetUrl(raw: unknown, now = Date.now()): { url: string; expiresAt: number; filename?: string } {
  if (typeof raw !== "string" || raw.length > 16384 || /[\u0000-\u0020\u007f\\]/.test(raw)) throw new Error("asset_url_invalid");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("asset_url_invalid"); }
  if (url.protocol !== "https:" || !url.hostname || url.hostname.endsWith(".") || url.username || url.password || url.hash || url.pathname === "/") throw new Error("asset_url_invalid");
  const q = url.searchParams;
  const names = ["X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-SignedHeaders", "X-Amz-Signature"];
  if (names.some(name => q.getAll(name).length !== 1) || q.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
    q.get("X-Amz-SignedHeaders") !== "host" || !/^[a-fA-F0-9]{64}$/.test(q.get("X-Amz-Signature") ?? "") ||
    !(q.get("X-Amz-Credential") ?? "").endsWith("/s3/aws4_request")) throw new Error("asset_url_invalid");
  const date = q.get("X-Amz-Date") ?? "", duration = q.get("X-Amz-Expires") ?? "";
  if (!/^\d{8}T\d{6}Z$/.test(date) || !/^\d{1,5}$/.test(duration) || Number(duration) < 1 || Number(duration) > 86400) throw new Error("asset_url_invalid");
  const issued = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
  const expiresAt = issued + Number(duration) * 1000;
  if (!Number.isFinite(issued) || new Date(issued).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z") !== date || issued > now + 5 * 60000) throw new Error("asset_url_invalid");
  if (expiresAt <= now + 1000) throw new Error("asset_expired");
  return { url: url.href, expiresAt, filename: dispositionFilename(q.get("response-content-disposition") ?? "") };
}

export function mediaByteRange(value: string | null, size: number): { start: number; end: number; partial: boolean } | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || (!match[1] && Number(match[2]) <= 0)) return null;
  return { start, end, partial: true };
}
