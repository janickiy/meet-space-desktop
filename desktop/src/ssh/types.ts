import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import type { InstallPlan, InstallStatus } from "./protocol";

export interface SshEndpoint { host: string; port: number; user: string }
export interface SshHostKey { fingerprint: string; algorithm: string; key: string }
export type SshCredentials = { kind: "password"; password: string } | { kind: "privateKey"; privateKey: string; passphrase?: string };
export type OwnedCredentials = { kind: "password"; password: Buffer } | { kind: "privateKey"; privateKey: Buffer; passphrase: Buffer };
export type SshAction = "discover" | "acceptHostKey" | "preflight" | "plan" | "apply" | "status" | "cancel" | "resume" | "detach" | "forget";
export interface PreflightCheck { id: string; title: string; level: "pass" | "warn" | "blocked" | "unknown"; detail: string }
export interface PreflightReport { domain: string; publicIpv4?: string; ready: boolean; checks: PreflightCheck[]; checkedAt: string }
export type PublicInstallPlan = Omit<InstallPlan, "json">;
export interface SshInstallerState {
  busy: boolean;
  phase: "idle" | "host-key" | "trusted" | "preflight" | "planned" | "running" | "completed" | "error";
  endpoint?: SshEndpoint;
  identity?: { fingerprint: string; algorithm: string; previousFingerprint?: string; changed: boolean; trusted: boolean };
  preflight?: PreflightReport;
  plan?: PublicInstallPlan;
  ticket?: { jobId: string; domain: string; host: string; port: number; user: string; planHash: string };
  status?: InstallStatus;
  error?: { code: string; message: string };
  hasCredentials: boolean;
}
export class SshError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "SshError"; }
}
export function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SshError("INPUT", "Некорректные параметры SSH.");
  return value as Record<string, unknown>;
}
function dnsName(raw: string): string {
  if (raw.length > 253 || /[\s\u0000-\u001f/\\:@?#\[\]$'"`()]/.test(raw) || raw.endsWith(".")) throw new SshError("INPUT", "Укажите имя хоста без адреса страницы, пути и порта.");
  const normalized = domainToASCII(raw).toLowerCase();
  if (!normalized || normalized.length > 253 || normalized.split(".").some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) throw new SshError("INPUT", "Некорректное доменное имя.");
  return normalized;
}
export function normalizeDomain(raw: unknown): string {
  if (typeof raw !== "string") throw new SshError("INPUT", "Укажите домен будущего сервера.");
  const domain = dnsName(raw.trim());
  if (!domain.includes(".") || /^[0-9.]+$/.test(domain)) throw new SshError("INPUT", "Для HTTPS требуется полное доменное имя.");
  return domain;
}
export function validateEndpoint(raw: unknown): SshEndpoint {
  const value = objectInput(raw);
  if (typeof value.host !== "string" || typeof value.user !== "string" || !Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535) throw new SshError("INPUT", "Проверьте SSH-адрес, пользователя и порт от 1 до 65535.");
  let host = value.host.trim();
  const user = value.user.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(user)) throw new SshError("INPUT", "Некорректное имя SSH-пользователя.");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.includes("%") || host.length > 253) throw new SshError("INPUT", "Некорректный SSH-адрес.");
  if (isIP(host)) host = host.toLowerCase();
  else if (host.includes(":") || /^[0-9.]+$/.test(host)) throw new SshError("INPUT", "Некорректный IP-адрес.");
  else host = dnsName(host);
  return { host, port: value.port as number, user };
}
export function ownCredentials(raw: unknown): OwnedCredentials {
  const value = objectInput(raw);
  if (value.kind === "password" && typeof value.password === "string" && Buffer.byteLength(value.password) >= 1 && Buffer.byteLength(value.password) <= 4096 && !value.password.includes("\0")) return { kind: "password", password: Buffer.from(value.password) };
  if (value.kind === "privateKey" && typeof value.privateKey === "string" && Buffer.byteLength(value.privateKey) >= 32 && Buffer.byteLength(value.privateKey) <= 256 * 1024 && (value.passphrase === undefined || (typeof value.passphrase === "string" && Buffer.byteLength(value.passphrase) <= 4096)) && /^-----BEGIN (OPENSSH |RSA |EC |ENCRYPTED )?PRIVATE KEY-----\r?\n/.test(value.privateKey)) return { kind: "privateKey", privateKey: Buffer.from(value.privateKey), passphrase: Buffer.from(value.passphrase as string ?? "") };
  throw new SshError("CREDENTIALS", "Введите пароль или приватный ключ OpenSSH/PEM и его парольную фразу.");
}
export function destroyCredentials(value: OwnedCredentials | undefined): void {
  if (!value) return;
  if (value.kind === "password") value.password.fill(0);
  else { value.privateKey.fill(0); value.passphrase.fill(0); }
}
