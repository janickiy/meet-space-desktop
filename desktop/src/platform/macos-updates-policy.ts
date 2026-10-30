import { verify } from "node:crypto";
import { compareUpdateVersions, updateKeyId, validUpdateVersion } from "../updates-policy";

/** Future macOS feed policy. Passing it does not enable a native updater. */
export interface MacOSUpdateTrust {
  schemaVersion: 1;
  enabled: true;
  appId: "com.janickiy.meetspace.desktop";
  channel: "stable";
  teamId: string;
  feedBaseUrl: string;
  manifestPublicKeys: string[];
}
export interface MacOSUpdatePayload {
  schemaVersion: 1;
  appId: MacOSUpdateTrust["appId"];
  channel: "stable";
  platform: "darwin";
  arch: "x64" | "arm64";
  teamId: string;
  version: string;
  publishedAt: string;
  expiresAt: string;
  archive: { file: string; size: number; sha256: string };
}
const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))
    throw new Error("update_manifest_invalid");
}
function feed(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f\\%]/.test(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && !!url.hostname && !url.hostname.endsWith(".") && !url.username && !url.password &&
    !url.search && !url.hash && url.pathname.endsWith("/") && !url.pathname.includes("//") && url.href === value;
}
export function parseMacOSUpdateTrust(value: unknown): MacOSUpdateTrust | null {
  if (record(value) && value.enabled === false &&
      ((Object.keys(value).length === 1) || (Object.keys(value).length === 2 && value.schemaVersion === 1))) return null;
  try {
    exact(value, ["schemaVersion", "enabled", "appId", "channel", "teamId", "feedBaseUrl", "manifestPublicKeys"]);
    if (value.schemaVersion !== 1 || value.enabled !== true || value.appId !== "com.janickiy.meetspace.desktop" || value.channel !== "stable" ||
        typeof value.teamId !== "string" || !/^[A-Z0-9]{10}$/.test(value.teamId) || !feed(value.feedBaseUrl) ||
        !Array.isArray(value.manifestPublicKeys) || value.manifestPublicKeys.length < 1 || value.manifestPublicKeys.length > 4 ||
        value.manifestPublicKeys.some(key => typeof key !== "string" || key.length > 4096 || !key.startsWith("-----BEGIN PUBLIC KEY-----") || key.includes("PRIVATE KEY")))
      throw new Error();
    const keys = value.manifestPublicKeys as string[];
    if (new Set(keys.map(updateKeyId)).size !== keys.length) throw new Error();
    return { schemaVersion: 1, enabled: true, appId: value.appId, channel: "stable", teamId: value.teamId,
      feedBaseUrl: value.feedBaseUrl, manifestPublicKeys: [...keys] };
  } catch { throw new Error("update_configuration_invalid"); }
}
function iso(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) throw new Error("update_manifest_invalid");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z"))
    throw new Error("update_manifest_invalid");
  return time;
}
export function macOSUpdateFeedUrl(trust: MacOSUpdateTrust, arch: string): string {
  if (!["x64", "arm64"].includes(arch)) throw new Error("update_architecture_invalid");
  return new URL(`stable/darwin-${arch}/latest.json`, trust.feedBaseUrl).href;
}
export function macOSUpdateArchiveUrl(trust: MacOSUpdateTrust, payload: MacOSUpdatePayload, now = Date.now()): string {
  // Only already-validated payloads may resolve an artifact in the fixed feed namespace.
  const valid = validateMacOSUpdatePayload(payload, trust, payload.arch, now);
  return new URL(valid.archive.file, macOSUpdateFeedUrl(trust, valid.arch)).href;
}
export function validateMacOSUpdatePayload(value: unknown, trust: MacOSUpdateTrust, arch: string, now = Date.now()): MacOSUpdatePayload {
  exact(value, ["schemaVersion", "appId", "channel", "platform", "arch", "teamId", "version", "publishedAt", "expiresAt", "archive"]);
  exact(value.archive, ["file", "size", "sha256"]);
  if (!["x64", "arm64"].includes(arch) || value.arch !== arch) throw new Error("update_architecture_invalid");
  if (value.schemaVersion !== 1 || value.appId !== trust.appId || value.channel !== "stable" || value.platform !== "darwin" || value.teamId !== trust.teamId)
    throw new Error("update_manifest_invalid");
  if (!validUpdateVersion(value.version)) throw new Error("update_version_invalid");
  const issued = iso(value.publishedAt), expires = iso(value.expiresAt);
  if (issued > now + 300000 || expires <= now || expires <= issued || expires - issued > 7 * 86400000) throw new Error("update_manifest_expired");
  if (value.archive.file !== `MeetSpace-${value.version}-mac-${arch}.zip` ||
      !Number.isSafeInteger(value.archive.size) || Number(value.archive.size) < 1 || Number(value.archive.size) > MAX_ZIP_BYTES ||
      typeof value.archive.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.archive.sha256)) throw new Error("update_manifest_invalid");
  return value as unknown as MacOSUpdatePayload;
}
export function canonicalizeMacOSUpdatePayload(value: MacOSUpdatePayload): Buffer {
  return Buffer.from(JSON.stringify({ schemaVersion: value.schemaVersion, appId: value.appId, channel: value.channel, platform: value.platform,
    arch: value.arch, teamId: value.teamId, version: value.version, publishedAt: value.publishedAt, expiresAt: value.expiresAt,
    archive: { file: value.archive.file, size: value.archive.size, sha256: value.archive.sha256 } }), "utf8");
}
/** Manifest authority and native bundle signature are separate requirements. This
 * verifies only the former; no archive is fetched or installed by this module. */
export function verifyMacOSUpdateManifest(bytes: Uint8Array, trust: MacOSUpdateTrust, arch: string,
  currentVersion: string, highestSeenVersion = currentVersion, now = Date.now()): MacOSUpdatePayload {
  try {
    if (bytes.byteLength > 65536) throw new Error("update_manifest_invalid");
    const envelope: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    exact(envelope, ["schemaVersion", "keyId", "payload", "signature"]);
    if (envelope.schemaVersion !== 1 || typeof envelope.keyId !== "string" || !/^[a-f0-9]{64}$/.test(envelope.keyId) ||
        typeof envelope.payload !== "string" || envelope.payload.length > 32768 || typeof envelope.signature !== "string" ||
        !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw new Error("update_manifest_invalid");
    const key = trust.manifestPublicKeys.find(item => updateKeyId(item) === envelope.keyId);
    const payload = Buffer.from(envelope.payload, "base64"), signature = Buffer.from(envelope.signature, "base64");
    if (!key || payload.toString("base64") !== envelope.payload || signature.toString("base64") !== envelope.signature ||
        !verify(null, payload, key, signature)) throw new Error("update_manifest_signature_invalid");
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    const candidate = validateMacOSUpdatePayload(parsed, trust, arch, now);
    if (!canonicalizeMacOSUpdatePayload(candidate).equals(payload)) throw new Error("update_manifest_invalid");
    if (compareUpdateVersions(candidate.version, currentVersion) < 0 || compareUpdateVersions(candidate.version, highestSeenVersion) < 0)
      throw new Error("update_rollback_denied");
    return candidate;
  } catch (error) {
    if (error instanceof Error && /^update_[a-z_]+$/.test(error.message)) throw error;
    throw new Error("update_manifest_invalid");
  }
}
