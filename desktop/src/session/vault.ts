import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface Cipher {
  isAvailable(): boolean;
  encrypt(value: string): Uint8Array;
  decrypt(value: Uint8Array): string;
}
interface StoredCookie { value: string; expiresAt: number }
interface ServerCookies { cookies: Record<string, StoredCookie>; pending: string[] }
const cookieName = /^meetrix_(session|account_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const secret = /^[A-Za-z0-9_-]{43}$/;
const DAY400 = 400 * 24 * 60 * 60 * 1000;

export async function atomicWrite(filename: string, value: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, value, { mode: 0o600, flag: "wx" });
    await rename(temporary, filename);
  } finally { await rm(temporary, { force: true }); }
}

/** Host separation is the selected server ID; only the exact auth path receives cookies. */
export class CookieVault {
  private state: Record<string, ServerCookies> = {};
  private writes = Promise.resolve();
  private readonly filename: string;
  constructor(storageDir: string, private readonly cipher: Cipher) {
    this.filename = path.join(storageDir, "sessions.encrypted");
  }
  available(): boolean { return this.cipher.isAvailable(); }
  async load(): Promise<void> {
    let raw: Buffer;
    try { raw = await readFile(this.filename); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw new Error("secure_storage_unavailable"); }
    if (!this.available()) throw new Error("secure_storage_unavailable");
    try {
      if (raw.length > 512 * 1024) throw new Error();
      const parsed: unknown = JSON.parse(this.cipher.decrypt(raw));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      for (const [id, record] of Object.entries(parsed)) {
        if (!/^[a-f0-9]{32}$/.test(id) || !record || typeof record !== "object") throw new Error();
        const item = record as ServerCookies;
        if (!item.cookies || typeof item.cookies !== "object" || !Array.isArray(item.pending) || item.pending.length > 20) throw new Error();
        if (Object.keys(item.cookies).length > 12 || item.pending.some((value) => !secret.test(value))) throw new Error();
        for (const [name, cookie] of Object.entries(item.cookies))
          if (!cookieName.test(name) || !cookie || !secret.test(cookie.value) || !Number.isFinite(cookie.expiresAt)) throw new Error();
      }
      this.state = parsed as Record<string, ServerCookies>;
    } catch { throw new Error("secure_storage_corrupt"); }
  }
  private record(id: string): ServerCookies {
    return this.state[id] ??= { cookies: {}, pending: [] };
  }
  header(id: string, pathname: string): string {
    if (!pathname.startsWith("/api/v1/auth/")) return "";
    return Object.entries(this.record(id).cookies)
      .filter(([, value]) => value.expiresAt > Date.now())
      .map(([name, value]) => `${name}=${value.value}`).join("; ");
  }
  async accept(id: string, pathname: string, headers: string | string[] | undefined): Promise<void> {
    if (!pathname.startsWith("/api/v1/auth/") || !headers) return;
    if (!this.available()) throw new Error("secure_storage_unavailable");
    for (const raw of Array.isArray(headers) ? headers : [headers]) {
      if (raw.length > 2048) continue;
      const [pair, ...pieces] = raw.split(";");
      const equal = pair.indexOf("=");
      const name = pair.slice(0, equal).trim(), value = pair.slice(equal + 1).trim();
      if (equal < 1 || !cookieName.test(name)) continue;
      const attributes = new Map(pieces.map((part) => {
        const [key, ...rest] = part.trim().split("="); return [key.toLowerCase(), rest.join("=")];
      }));
      if (attributes.has("domain") || attributes.get("path") !== "/api/v1/auth" || !attributes.has("httponly") || !attributes.has("secure") || attributes.get("samesite")?.toLowerCase() !== "lax") continue;
      const maxAge = attributes.has("max-age") ? Number(attributes.get("max-age")) : undefined;
      if (value === "" || (maxAge !== undefined && maxAge <= 0)) {
        delete this.record(id).cookies[name]; continue;
      }
      if (!secret.test(value) || (maxAge !== undefined && !Number.isFinite(maxAge))) continue;
      const expires = attributes.get("expires") ? Date.parse(attributes.get("expires")!) : Date.now() + DAY400;
      const expiresAt = maxAge === undefined ? Math.min(expires, Date.now() + DAY400) : Date.now() + Math.min(maxAge * 1000, DAY400);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) continue;
      const cookies = this.record(id).cookies;
      for (const [key, stored] of Object.entries(cookies)) if (stored.expiresAt <= Date.now()) delete cookies[key];
      if (!(name in cookies) && Object.keys(cookies).length >= 12) continue;
      cookies[name] = { value, expiresAt };
    }
    await this.save();
  }
  /** Remove local authorization before attempting remote logout; retain only a revocation queue. */
  async logout(id: string, userId?: string, active = false): Promise<void> {
    const record = this.record(id);
    const names = userId ? [`meetrix_account_${userId}`] : ["meetrix_session"];
    const secrets = new Set(names.map((name) => record.cookies[name]?.value).filter((value): value is string => !!value));
    if ((!userId || (active && !secrets.size)) && record.cookies.meetrix_session) secrets.add(record.cookies.meetrix_session.value);
    for (const [name, cookie] of Object.entries(record.cookies)) if (secrets.has(cookie.value)) delete record.cookies[name];
    for (const value of secrets) if (!record.pending.includes(value)) record.pending.push(value);
    record.pending = record.pending.slice(-20);
    await this.save();
  }
  pending(id: string): string[] { return [...this.record(id).pending]; }
  async revoked(id: string, value: string): Promise<void> {
    this.record(id).pending = this.record(id).pending.filter((entry) => entry !== value);
    await this.save();
  }
  async remove(id: string): Promise<void> { delete this.state[id]; await this.save(); }
  private save(): Promise<void> {
    if (!this.available()) return Promise.reject(new Error("secure_storage_unavailable"));
    const snapshot = JSON.stringify(this.state);
    const next = this.writes.catch(() => {}).then(async () => {
      const encrypted = this.cipher.encrypt(snapshot);
      await atomicWrite(this.filename, encrypted);
    });
    this.writes = next;
    return next;
  }
}
