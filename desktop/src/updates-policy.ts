import { createHash, createPublicKey, verify } from "node:crypto";

export type UpdateArchitecture = "x64" | "arm64";
export interface UpdateTrust {
  schemaVersion: 1;
  enabled: true;
  appId: "com.janickiy.meetspace.desktop";
  channel: "stable";
  feedBaseUrl: string;
  publisherNames: string[];
  signingCertThumbprints: string[];
  manifestPublicKeys: string[];
}
export interface UpdatePayload {
  schemaVersion: 1;
  appId: UpdateTrust["appId"];
  channel: "stable";
  arch: UpdateArchitecture;
  version: string;
  publishedAt: string;
  expiresAt: string;
  installer: { file: string; size: number; sha512: string };
}
export interface UpdateEnvelope { schemaVersion: 1; keyId: string; payload: string; signature: string }
export const MAX_UPDATE_BYTES = 2 * 1024 * 1024 * 1024;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error("update_manifest_invalid");
}
function strings(value: unknown, maximum: number, validate: (value: string) => boolean): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= maximum && new Set(value).size === value.length && value.every(item => typeof item === "string" && validate(item));
}
export function validUpdateVersion(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(value) && value.split(".").every(part => Number(part) <= 65535);
}
export function compareUpdateVersions(a: string, b: string): number {
  if (!validUpdateVersion(a) || !validUpdateVersion(b)) throw new Error("update_version_invalid");
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let n = 0; n < 3; n++) if (left[n] !== right[n]) return left[n] > right[n] ? 1 : -1;
  return 0;
}
export function updateKeyId(pem: string): string {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519" || pem.includes("PRIVATE KEY")) throw new Error("update_configuration_invalid");
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}
export function parseUpdateTrust(value: unknown): UpdateTrust | null {
  if (object(value) && Object.keys(value).length === 1 && value.enabled === false) return null;
  try {
    exact(value, ["schemaVersion", "enabled", "appId", "channel", "feedBaseUrl", "publisherNames", "signingCertThumbprints", "manifestPublicKeys"]);
    if (value.schemaVersion !== 1 || value.enabled !== true || value.appId !== "com.janickiy.meetspace.desktop" || value.channel !== "stable" ||
      typeof value.feedBaseUrl !== "string" || value.feedBaseUrl.length > 2048 || /[\u0000-\u0020\u007f\\%]/.test(value.feedBaseUrl)) throw new Error();
    const url = new URL(value.feedBaseUrl);
    if (url.protocol !== "https:" || !url.hostname || url.hostname.endsWith(".") || url.username || url.password || url.search || url.hash ||
      !url.pathname.endsWith("/") || url.href !== value.feedBaseUrl || url.pathname.includes("//")) throw new Error();
    if (!strings(value.publisherNames, 4, name => name.length <= 1024 && /^CN=.+/.test(name) && !/[\u0000-\u001f\u007f]/.test(name)) ||
      !strings(value.signingCertThumbprints, 4, thumb => /^[A-F0-9]{40}$/.test(thumb)) ||
      !strings(value.manifestPublicKeys, 4, pem => pem.length < 4096 && pem.startsWith("-----BEGIN PUBLIC KEY-----"))) throw new Error();
    const ids = value.manifestPublicKeys.map(updateKeyId);
    if (new Set(ids).size !== ids.length) throw new Error();
    return { ...value, publisherNames: [...value.publisherNames], signingCertThumbprints: [...value.signingCertThumbprints], manifestPublicKeys: [...value.manifestPublicKeys] } as unknown as UpdateTrust;
  } catch { throw new Error("update_configuration_invalid"); }
}
export function updateFeedUrl(trust: UpdateTrust, arch: UpdateArchitecture): string {
  if (!["x64", "arm64"].includes(arch)) throw new Error("update_architecture_invalid");
  return new URL(`stable/win-${arch}/latest.json`, trust.feedBaseUrl).href;
}
export function updateInstallerUrl(trust: UpdateTrust, payload: UpdatePayload): string {
  return new URL(payload.installer.file, updateFeedUrl(trust, payload.arch)).href;
}
function date(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) throw new Error("update_manifest_invalid");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) throw new Error("update_manifest_invalid");
  return time;
}
export function validateUpdatePayload(value: unknown, trust: UpdateTrust, arch: UpdateArchitecture, now = Date.now()): UpdatePayload {
  exact(value, ["schemaVersion", "appId", "channel", "arch", "version", "publishedAt", "expiresAt", "installer"]);
  exact(value.installer, ["file", "size", "sha512"]);
  if (value.schemaVersion !== 1 || value.appId !== trust.appId || value.channel !== trust.channel) throw new Error("update_manifest_invalid");
  if (value.arch !== arch) throw new Error("update_architecture_invalid");
  if (!validUpdateVersion(value.version)) throw new Error("update_version_invalid");
  const issued = date(value.publishedAt), expires = date(value.expiresAt);
  if (issued > now + 300000 || expires <= now || expires <= issued || expires - issued > 7 * 86400000) throw new Error("update_manifest_expired");
  if (value.installer.file !== `MeetSpace-${value.version}-win-${arch}-setup.exe` ||
    !Number.isSafeInteger(value.installer.size) || Number(value.installer.size) < 1 || Number(value.installer.size) > MAX_UPDATE_BYTES ||
    typeof value.installer.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value.installer.sha512) ||
    Buffer.from(value.installer.sha512, "base64").toString("base64") !== value.installer.sha512) throw new Error("update_manifest_invalid");
  return value as unknown as UpdatePayload;
}
/** Exact field order used by the signing tool; signatures cover the UTF-8 bytes. */
export function canonicalizeUpdatePayload(value: UpdatePayload): Buffer {
  return Buffer.from(JSON.stringify({ schemaVersion: value.schemaVersion, appId: value.appId, channel: value.channel, arch: value.arch,
    version: value.version, publishedAt: value.publishedAt, expiresAt: value.expiresAt,
    installer: { file: value.installer.file, size: value.installer.size, sha512: value.installer.sha512 } }), "utf8");
}
export function verifyUpdateManifest(bytes: Uint8Array, trust: UpdateTrust, arch: UpdateArchitecture, currentVersion: string, now = Date.now()): UpdatePayload {
  try {
    if (bytes.byteLength > 65536) throw new Error("update_manifest_invalid");
    const envelope: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    exact(envelope, ["schemaVersion", "keyId", "payload", "signature"]);
    if (envelope.schemaVersion !== 1 || typeof envelope.keyId !== "string" || !/^[a-f0-9]{64}$/.test(envelope.keyId) ||
      typeof envelope.payload !== "string" || envelope.payload.length > 32768 || typeof envelope.signature !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw new Error("update_manifest_invalid");
    const key = trust.manifestPublicKeys.find(key => updateKeyId(key) === envelope.keyId);
    const payload = Buffer.from(envelope.payload, "base64"), signature = Buffer.from(envelope.signature, "base64");
    if (!key || payload.toString("base64") !== envelope.payload || signature.toString("base64") !== envelope.signature ||
      !verify(null, payload, key, signature)) throw new Error("update_manifest_signature_invalid");
    const value = validateUpdatePayload(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)), trust, arch, now);
    if (!canonicalizeUpdatePayload(value).equals(payload)) throw new Error("update_manifest_invalid");
    if (compareUpdateVersions(value.version, currentVersion) < 0) throw new Error("update_rollback_denied");
    return value;
  } catch (error) {
    if (error instanceof Error && /^update_[a-z_]+$/.test(error.message)) throw error;
    throw new Error("update_manifest_invalid");
  }
}
