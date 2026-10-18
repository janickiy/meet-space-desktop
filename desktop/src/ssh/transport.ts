import { createHash, createPublicKey, timingSafeEqual } from "node:crypto";
import { Client, utils, type ConnectConfig } from "ssh2";
import { destroyCredentials, SshError, validateEndpoint, type OwnedCredentials, type SshEndpoint, type SshHostKey } from "./types";
import { PREFLIGHT_COMMAND } from "./preflight";

import { INSTALLER_COMMAND } from "./protocol";
export { INSTALLER_COMMAND } from "./protocol";
export interface SshTransport {
  inspect(endpoint: SshEndpoint, signal: AbortSignal): Promise<SshHostKey>;
  probe(endpoint: SshEndpoint, credentials: OwnedCredentials, pin: SshHostKey, domain: string, signal: AbortSignal): Promise<string>;
  installer(endpoint: SshEndpoint, credentials: OwnedCredentials, pin: SshHostKey, payload: Buffer, signal: AbortSignal, timeoutMs?: number): Promise<string>;
  dispose(): void;
}
const algorithms: ConnectConfig["algorithms"] = {
  serverHostKey: ["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "rsa-sha2-512", "rsa-sha2-256"],
  kex: ["curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group14-sha256", "diffie-hellman-group16-sha512", "diffie-hellman-group18-sha512"],
  cipher: ["aes128-gcm@openssh.com", "aes256-gcm@openssh.com", "aes128-ctr", "aes192-ctr", "aes256-ctr"],
  hmac: ["hmac-sha2-256-etm@openssh.com", "hmac-sha2-512-etm@openssh.com", "hmac-sha2-256", "hmac-sha2-512"],
  compress: ["none"],
};
export function hostKeyFromBytes(bytes: Buffer): SshHostKey {
  if (bytes.length < 8 || bytes.length > 16 * 1024) throw new SshError("HOST_KEY", "SSH-сервер вернул некорректный ключ.");
  const length = bytes.readUInt32BE(0);
  if (length < 1 || length > 64 || length + 4 >= bytes.length) throw new SshError("HOST_KEY", "SSH-сервер вернул некорректный ключ.");
  const algorithm = bytes.subarray(4, 4 + length).toString("ascii");
  if (!["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "ssh-rsa"].includes(algorithm)) throw new SshError("HOST_KEY", "Алгоритм ключа SSH-сервера не поддерживается.");
  return { algorithm, key: bytes.toString("base64"), fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}` };
}
export function validateHostKey(raw: unknown): SshHostKey {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SshError("HOST_KEY", "Некорректный сохранённый ключ SSH.");
  const pin = raw as SshHostKey;
  if (typeof pin.key !== "string" || pin.key.length > 24 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pin.key)) throw new SshError("HOST_KEY", "Некорректный сохранённый ключ SSH.");
  const actual = hostKeyFromBytes(Buffer.from(pin.key, "base64"));
  if (actual.key !== pin.key || actual.algorithm !== pin.algorithm || actual.fingerprint !== pin.fingerprint) throw new SshError("HOST_KEY", "Некорректный сохранённый ключ SSH.");
  return actual;
}
function safeTransportError(error: unknown): SshError {
  if (error instanceof SshError) return error;
  const value = error as { level?: string; code?: string };
  if (value?.level === "client-authentication") return new SshError("AUTH", "SSH-сервер отклонил пароль или ключ. Проверьте учётные данные.");
  if (value?.level === "client-timeout" || value?.code === "ETIMEDOUT") return new SshError("TIMEOUT", "SSH-сервер не ответил вовремя. Подключитесь снова, чтобы проверить задание.");
  return new SshError("NETWORK", "Не удалось подключиться к SSH-серверу. Проверьте адрес, порт и сеть.");
}
export class Ssh2Transport implements SshTransport {
  private clients = new Set<Client>();
  constructor(private readonly limits: { connectMs?: number; commandMs?: number } = {}) {}
  dispose(): void { for (const client of this.clients) client.destroy(); this.clients.clear(); }
  async inspect(endpoint: SshEndpoint, signal: AbortSignal): Promise<SshHostKey> {
    validateEndpoint(endpoint);
    return new Promise((resolve, reject) => {
      const client = new Client(); this.clients.add(client);
      let finished = false;
      let inspected: SshHostKey | undefined;
      const finish = (error?: unknown, identity?: SshHostKey) => {
        if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener("abort", abort); this.clients.delete(client); client.destroy();
        if (error) reject(safeTransportError(error)); else resolve(identity!);
      };
      const abort = () => finish(new SshError("ABORTED", "SSH-подключение закрыто."));
      const timer = setTimeout(() => finish(new SshError("TIMEOUT", "SSH-сервер не ответил вовремя.")), this.limits.connectMs ?? 15_000);
      signal.addEventListener("abort", abort, { once: true });
      client.on("error", (error) => inspected ? finish(undefined, inspected) : finish(error));
      client.on("close", () => { if (!finished) inspected ? finish(undefined, inspected) : finish(new SshError("NETWORK", "SSH-сервер закрыл соединение до проверки ключа.")); });
      client.on("ready", () => finish(new SshError("HOST_KEY", "Проверка SSH-ключа не завершилась безопасно.")));
      if (signal.aborted) return abort();
      try {
        client.connect({ host: endpoint.host, port: endpoint.port, username: endpoint.user, readyTimeout: this.limits.connectMs ?? 15_000,
          algorithms, authHandler: () => false,
          hostVerifier: (key: Buffer) => { try { inspected = hostKeyFromBytes(key); queueMicrotask(() => finish(undefined, inspected)); } catch (error) { queueMicrotask(() => finish(error)); } return false; },
        });
      } catch (error) { finish(error); }
    });
  }
  probe(endpoint: SshEndpoint, credentials: OwnedCredentials, pin: SshHostKey, domain: string, signal: AbortSignal): Promise<string> {
    return this.execute(endpoint, credentials, pin, PREFLIGHT_COMMAND, Buffer.from(JSON.stringify({ domain, host: endpoint.host })), signal, 64 * 1024, 60_000);
  }
  installer(endpoint: SshEndpoint, credentials: OwnedCredentials, pin: SshHostKey, payload: Buffer, signal: AbortSignal, timeoutMs = 60_000): Promise<string> {
    if (payload.length > 512 * 1024) return Promise.reject(new SshError("INPUT", "Пакет установщика слишком велик."));
    return this.execute(endpoint, credentials, pin, INSTALLER_COMMAND, payload, signal, 256 * 1024, timeoutMs);
  }
  private execute(endpoint: SshEndpoint, credentials: OwnedCredentials, pin: SshHostKey, command: string, input: Buffer, signal: AbortSignal, maximum: number, timeoutMs: number): Promise<string> {
    validateEndpoint(endpoint); validateHostKey(pin);
    const expected = Buffer.from(pin.key, "base64");
    const owned: OwnedCredentials = credentials.kind === "password" ? { kind: "password", password: Buffer.from(credentials.password) } : { kind: "privateKey", privateKey: Buffer.from(credentials.privateKey), passphrase: Buffer.from(credentials.passphrase) };
    return new Promise((resolve, reject) => {
      const client = new Client(); this.clients.add(client);
      let finished = false, verified = false, changed = false, outBytes = 0, errBytes = 0;
      const output: Buffer[] = [];
      const finish = (error?: unknown) => {
        if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener("abort", abort); this.clients.delete(client); client.destroy(); destroyCredentials(owned);
        if (changed) reject(new SshError("HOST_KEY_CHANGED", "Ключ SSH-сервера изменился. Повторно проверьте и подтвердите отпечаток."));
        else if (error) reject(safeTransportError(error)); else {
          try { resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(output))); }
          catch { reject(new SshError("INVALID_RESPONSE", "SSH-сервер вернул некорректный UTF-8.")); }
        }
        for (const chunk of output) chunk.fill(0); output.length = 0;
      };
      const abort = () => finish(new SshError("ABORTED", "SSH-подключение закрыто. Удалённое задание может продолжать работу."));
      const timer = setTimeout(() => finish(new SshError("TIMEOUT", "SSH-сервер не ответил вовремя. Проверьте состояние задания повторным подключением.")), this.limits.commandMs ?? timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      client.on("error", (error) => finish(error));
      client.on("close", () => { if (!finished) finish(new SshError("NETWORK", "SSH-соединение прервано. Проверьте состояние задания повторным подключением.")); });
      client.on("ready", () => {
        if (!verified) return finish(new SshError("HOST_KEY", "Ключ SSH-сервера не подтверждён."));
        client.exec(command, { pty: false }, (error, channel) => {
          if (error) return finish(error);
          if (finished) { channel.destroy(); return; }
          channel.on("error", (err: Error) => finish(err));
          channel.on("data", (chunk: Buffer) => { outBytes += chunk.length; if (outBytes > maximum) finish(new SshError("RESPONSE_LIMIT", "Ответ SSH-сервера превысил допустимый размер.")); else output.push(Buffer.from(chunk)); });
          channel.stderr.on("data", (chunk: Buffer) => { errBytes += chunk.length; if (errBytes > 16 * 1024) finish(new SshError("RESPONSE_LIMIT", "Ответ SSH-сервера превысил допустимый размер.")); });
          channel.on("close", (code: number | null) => finish(code === 0 ? undefined : new SshError("REMOTE_COMMAND", "Сервер не выполнил команду. Требуются Python 3 и root либо sudo без запроса пароля.")));
          channel.end(input);
        });
      });
      if (signal.aborted) return abort();
      const config: ConnectConfig = { host: endpoint.host, port: endpoint.port, username: endpoint.user, readyTimeout: this.limits.connectMs ?? 15_000,
        algorithms, keepaliveInterval: 10_000, keepaliveCountMax: 18,
        hostVerifier: (key: Buffer) => { verified = key.length === expected.length && timingSafeEqual(key, expected); changed = !verified; return verified; },
      };
      try {
        if (owned.kind === "password") { config.password = owned.password.toString("utf8"); config.authHandler = ["password"]; }
        else {
          const parsed = utils.parseKey(owned.privateKey, owned.passphrase.length ? owned.passphrase : undefined);
          if (parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey() || !["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "ssh-rsa"].includes(parsed.type)) throw new SshError("KEY_FORMAT", "Не удалось открыть приватный ключ. Проверьте формат и парольную фразу.");
          if (parsed.type === "ssh-rsa") { const bits = createPublicKey(parsed.getPublicPEM()).asymmetricKeyDetails?.modulusLength ?? 0; if (bits < 2048 || bits > 8192) throw new SshError("KEY_FORMAT", "Для RSA требуется ключ длиной от 2048 до 8192 бит."); }
          config.privateKey = owned.privateKey; config.passphrase = owned.passphrase.toString("utf8"); config.authHandler = ["publickey"];
        }
        client.connect(config);
      } catch (error) { finish(error); }
    });
  }
}
