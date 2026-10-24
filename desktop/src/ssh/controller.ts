import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";
import { atomicWrite } from "../session/vault";
import { analyzePreflight } from "./preflight";
import { InstallerBundle, InstallFailure, assertTicketBinding, jsonObject, parseInstallerReply, parseInstallStatus, smtpOptions, type InstallOptions, type InstallPlan, type InstallTicket, type InstallerAction, type JsonObject } from "./protocol";
import { Ssh2Transport, validateHostKey, type SshTransport } from "./transport";
import { destroyCredentials, normalizeDomain, objectInput, ownCredentials, SshError, validateEndpoint, type OwnedCredentials, type SshAction, type SshEndpoint, type SshHostKey, type SshInstallerState } from "./types";

interface ControllerOptions { storageDir: string; bundleRoot: string; transport?: SshTransport; onChange?: (state: SshInstallerState) => void }
const actions: readonly string[] = ["discover", "acceptHostKey", "preflight", "plan", "apply", "status", "cancel", "resume", "detach", "forget"];
const pinId = (endpoint: SshEndpoint) => `[${endpoint.host}]:${endpoint.port}`;
function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof SshError) return { code: error.code, message: error.message };
  if (error instanceof InstallFailure) {
    const messages: Record<string, string> = {
      PLAN_EXPIRED: "Срок действия плана истёк. Получите новый план перед установкой.",
      PLAN_INVALID: "План сервера не прошёл проверку. Установка остановлена.",
      RELEASE_INVALID: "Подпись пакета установщика не прошла проверку.",
      TICKET_INVALID: "Задание не соответствует серверу или подтверждённому SSH-ключу.",
      INVALID_RESPONSE: "Ответ удалённого установщика не прошёл проверку.",
      RESPONSE_LIMIT: "Ответ удалённого установщика превысил допустимый размер.",
    };
    return { code: error.code, message: messages[error.code] ?? `Удалённый установщик сообщил: ${error.code}.` };
  }
  return { code: "INTERNAL", message: "Не удалось завершить действие SSH-установщика. Подключитесь снова и проверьте состояние задания." };
}
function installOptions(raw: unknown): InstallOptions {
  const value = objectInput(raw);
  const domain = normalizeDomain(value.domain);
  if (typeof value.publicIpv4 !== "string" || isIP(value.publicIpv4.trim()) !== 4) throw new SshError("INPUT", "Укажите внешний IPv4-адрес сервера.");
  const acmeEmail = typeof value.acmeEmail === "string" ? value.acmeEmail.trim() : "";
  if (acmeEmail.length > 254 || (acmeEmail && !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(acmeEmail))) throw new SshError("INPUT", "Проверьте email для сертификата HTTPS.");
  let smtp: InstallOptions["smtp"];
  if (value.smtp !== undefined) {
    try { smtp = smtpOptions(value.smtp); }
    catch { throw new SshError("INPUT", "Проверьте SMTP-сервер, порт, адрес отправителя и режим TLS."); }
  }
  return { domain, publicIpv4: value.publicIpv4.trim(), acmeEmail, ...(smtp ? { smtp } : {}) };
}
/** The renderer gets public state only; pins and recovery tickets are the only data written to disk. */
export class SshInstallerController {
  private current: SshInstallerState = { busy: false, phase: "idle", hasCredentials: false };
  private readonly pins = new Map<string, SshHostKey>();
  private readonly transport: SshTransport;
  private readonly bundle: InstallerBundle;
  private recoveryBundle?: InstallerBundle;
  private credentials?: OwnedCredentials;
  private observed?: SshHostKey;
  private plan?: InstallPlan;
  private ticket?: InstallTicket;
  private operation?: AbortController;
  private disposed = false;
  private generation = 0;
  constructor(private readonly options: ControllerOptions) {
    this.transport = options.transport ?? new Ssh2Transport();
    this.bundle = InstallerBundle.fromDirectory(options.bundleRoot);
  }
  state(): SshInstallerState { return structuredClone({ ...this.current, hasCredentials: Boolean(this.credentials) }); }
  private notify(): void { if (!this.disposed) this.options.onChange?.(this.state()); }
  private clearCredentials(): void { destroyCredentials(this.credentials); this.credentials = undefined; }
  private get pinsFile(): string { return path.join(this.options.storageDir, "ssh-host-pins.json"); }
  private get ticketFile(): string { return path.join(this.options.storageDir, "ssh-install-ticket.json"); }
  async load(): Promise<void> {
    try {
      const content = await readFile(this.pinsFile, "utf8");
      if (Buffer.byteLength(content) > 256 * 1024) throw new Error();
      const parsed = jsonObject(content);
      if (parsed.schema !== 1 || !Array.isArray(parsed.pins) || parsed.pins.length > 100) throw new Error();
      for (const raw of parsed.pins) {
        const item = objectInput(raw), endpoint = validateEndpoint(item.endpoint), pin = validateHostKey(item.identity);
        if (this.pins.has(pinId(endpoint))) throw new Error();
        this.pins.set(pinId(endpoint), pin);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { this.pins.clear(); this.current.error = { code: "STORAGE", message: "Не удалось прочитать SSH-ключи. Повторите проверку отпечатка сервера." }; }
    }
    try {
      const content = await readFile(this.ticketFile, "utf8");
      const saved = jsonObject(content);
      if (saved.schema !== 1) throw new Error();
      const rawPlan = objectInput(saved.plan);
      const recoveryBundle = InstallerBundle.forSavedPlan(this.options.bundleRoot, rawPlan);
      const endpoint = validateEndpoint(saved.endpoint), plan = recoveryBundle.parsePlan(rawPlan, { allowExpired: true });
      const ticket: InstallTicket = { endpoint, plan, jobId: saved.jobId as string, planHash: saved.planHash as string, hostFingerprint: saved.hostFingerprint as string };
      assertTicketBinding(ticket);
      this.recoveryBundle = recoveryBundle;
      this.ticket = ticket; this.plan = plan; this.current.endpoint = endpoint; this.current.phase = "planned";
      this.publishPlan(); this.publishTicket();
      const pin = this.pins.get(pinId(endpoint));
      if (pin) { this.observed = pin; this.current.identity = { fingerprint: pin.fingerprint, algorithm: pin.algorithm, changed: pin.fingerprint !== ticket.hostFingerprint, trusted: pin.fingerprint === ticket.hostFingerprint }; }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.current.error = { code: "STORAGE", message: "Не удалось восстановить сохранённое задание. Повторно подключитесь к серверу и получите план." };
    }
    this.notify();
  }
  dispose(): void {
    this.disposed = true; this.generation++; this.operation?.abort(); this.operation = undefined; this.transport.dispose(); this.clearCredentials(); this.current.busy = false;
  }
  private detach(): SshInstallerState {
    this.generation++; this.operation?.abort(); this.operation = undefined; this.transport.dispose(); this.clearCredentials(); this.current.busy = false; this.current.error = undefined;
    this.current.phase = this.ticket ? (this.current.status?.state === "completed" ? "completed" : "planned") : this.observed ? "host-key" : "idle";
    this.notify(); return this.state();
  }
  async invoke(actionInput: unknown, raw: unknown = {}): Promise<SshInstallerState> {
    const failure = (code: string, message: string) => ({ ...this.state(), error: { code, message } });
    if (this.disposed) return failure("DISPOSED", "SSH-установщик закрыт.");
    if (typeof actionInput !== "string" || !actions.includes(actionInput)) return failure("INPUT", "Неизвестное действие SSH-установщика.");
    const action = actionInput as SshAction;
    let input: Record<string, unknown>;
    try { input = objectInput(raw); } catch { return failure("INPUT", "Некорректные параметры SSH."); }
    if (action === "detach") return this.detach();
    if (this.current.busy) return failure("BUSY", "Дождитесь завершения текущей проверки.");
    const generation = ++this.generation;
    this.current.busy = true; this.current.error = undefined; this.operation = new AbortController(); this.notify();
    try {
      if (action === "forget") {
        if (input.confirm !== true) throw new SshError("CONFIRMATION", "Подтвердите удаление локальной карточки задания.");
        await rm(this.ticketFile, { force: true }); if (generation !== this.generation) return this.state(); this.ticket = undefined; this.plan = undefined; this.recoveryBundle = undefined; this.clearCredentials();
        this.current = { busy: true, phase: "idle", hasCredentials: false }; this.observed = undefined;
      } else if (action === "discover") {
        const endpoint = validateEndpoint(input.endpoint);
        if (this.ticket && (endpoint.host !== this.ticket.endpoint.host || endpoint.port !== this.ticket.endpoint.port || endpoint.user !== this.ticket.endpoint.user)) throw new SshError("PENDING_JOB", "Сначала завершите или удалите локальную карточку предыдущего задания.");
        if (!this.ticket) { this.plan = undefined; this.current.plan = undefined; this.current.status = undefined; }
        this.clearCredentials(); this.current.endpoint = endpoint; this.current.preflight = undefined; this.current.identity = undefined; this.observed = undefined;
        const identity = await this.transport.inspect(endpoint, this.operation.signal);
        if (generation !== this.generation) return this.state();
        this.observed = identity;
        const previous = this.pins.get(pinId(endpoint));
        this.current.identity = { fingerprint: identity.fingerprint, algorithm: identity.algorithm, previousFingerprint: previous?.fingerprint, changed: Boolean(previous && previous.fingerprint !== identity.fingerprint), trusted: previous?.key === identity.key };
        this.current.phase = this.current.identity.trusted ? "trusted" : "host-key";
      } else if (action === "acceptHostKey") {
        const endpoint = this.endpoint();
        if (!this.observed || input.fingerprint !== this.observed.fingerprint) throw new SshError("HOST_KEY", "Повторите проверку и подтвердите показанный отпечаток SSH-ключа.");
        if (this.current.identity?.changed && input.replaceChanged !== true) throw new SshError("HOST_KEY_CHANGED", "Ключ сервера изменился. Сверьте новый отпечаток и явно подтвердите замену.");
        if (!this.pins.has(pinId(endpoint)) && this.pins.size >= 100) throw new SshError("STORAGE", "Достигнут предел сохранённых SSH-серверов.");
        this.pins.set(pinId(endpoint), this.observed);
        await atomicWrite(this.pinsFile, JSON.stringify({ schema: 1, pins: [...this.pins].map(([id, identity]) => { const match = /^\[(.*)\]:(\d+)$/.exec(id)!; return { endpoint: { host: match[1], port: Number(match[2]), user: "pin" }, identity }; }) }));
        if (generation !== this.generation) return this.state();
        this.current.identity = { fingerprint: this.observed.fingerprint, algorithm: this.observed.algorithm, changed: false, trusted: true }; this.current.phase = "trusted";
      } else {
        const endpoint = this.endpoint(), pin = this.pin(endpoint);
        if (input.credentials !== undefined) { const owned = ownCredentials(input.credentials); this.clearCredentials(); this.credentials = owned; }
        if (!this.credentials) throw new SshError("CREDENTIALS", "Введите пароль или SSH-ключ для подключения.");
        if (action === "preflight") {
          const domain = normalizeDomain(input.domain);
          const result = await this.transport.probe(endpoint, this.credentials, pin, domain, this.operation.signal);
          if (generation !== this.generation) return this.state();
          this.current.preflight = analyzePreflight(domain, result); this.current.phase = "preflight";
          if (!this.ticket) { this.plan = undefined; this.current.plan = undefined; }
        } else if (action === "plan") {
          const options = installOptions(input.options);
          if (!this.current.preflight || this.current.preflight.domain !== options.domain || !this.current.preflight.ready) throw new SshError("PREFLIGHT_REQUIRED", "Сначала выполните проверку сервера и устраните блокирующие замечания.");
          if (this.ticket) throw new SshError("PENDING_JOB", "Сохранённое задание доступно через проверку состояния и продолжение. Для нового плана сначала удалите локальную карточку.");
          let result: JsonObject, selectedBundle = this.bundle;
          try {
            result = await this.request("plan", { options }, endpoint, pin);
          } catch (error) {
            if (generation !== this.generation) return this.state();
            if (!(error instanceof InstallFailure) || !["PLAN_CHANGED", "EXISTING_INSTALLATION"].includes(error.code)) throw error;
            // A different computer may have no local recovery ticket. Ask only
            // the one bundled legacy recipe to identify its existing job; this
            // read-only fallback must never create a fresh legacy installation.
            selectedBundle = InstallerBundle.legacyRecovery(this.options.bundleRoot);
            result = await this.request("plan", { options }, endpoint, pin, selectedBundle);
            if (generation !== this.generation) return this.state();
            const recovered = selectedBundle.parsePlan(result, { expectedOptions: options });
            if (!recovered.existingJobId || !recovered.existingPlanHash) throw new InstallFailure("PLAN_INVALID");
          }
          if (generation !== this.generation) return this.state();
          this.plan = selectedBundle.parsePlan(result, { expectedOptions: options }); this.publishPlan(); this.current.phase = "planned";
          if (this.plan.existingJobId) {
            this.recoveryBundle = selectedBundle; this.ticket = this.createTicket(endpoint, pin); await this.saveTicket();
            if (generation !== this.generation) return this.state();
            this.publishTicket();
          }
        } else if (action === "apply") {
          if (this.ticket) throw new SshError("PENDING_JOB", "Задание уже сохранено. Проверьте состояние и используйте продолжение вместо повторного запуска.");
          if (!this.plan || input.confirmedPlanHash !== this.plan.hash || input.acceptAcmeTerms !== true || (this.plan.installDocker && input.confirmDockerInstall !== true)) throw new SshError("CONFIRMATION", "Подтвердите показанный план, условия ACME и необходимые изменения Docker.");
          this.bundle.parsePlan(jsonObject(this.plan.json));
          const smtpPassword = input.smtpPassword ?? "";
          if (typeof smtpPassword !== "string" || Buffer.byteLength(smtpPassword) > 4096 || /[\r\n\x00]/.test(smtpPassword) ||
              (this.plan.options.smtp?.username ? !smtpPassword : Boolean(smtpPassword)))
            throw new SshError("INPUT", "Введите пароль SMTP для указанного пользователя.");
          if (this.plan.existingJobId) throw new SshError("PENDING_JOB", "На сервере уже есть задание. Проверьте его состояние и используйте продолжение.");
          this.ticket ??= this.createTicket(endpoint, pin);
          assertTicketBinding(this.ticket, endpoint, pin.fingerprint);
          await this.saveTicket(); this.publishTicket();
          if (generation !== this.generation) return this.state(); // Persist before the remote mutation, so disconnects are recoverable.
          const result = await this.request("apply", { plan: jsonObject(this.plan.json), jobId: this.ticket.jobId, confirmedPlanHash: this.plan.hash, confirmDockerInstall: input.confirmDockerInstall === true, acceptAcmeTerms: true, ...(this.plan.options.smtp ? { smtpPassword } : {}) }, endpoint, pin);
          if (generation !== this.generation) return this.state();
          this.publishStatus(result);
        } else {
          if (!this.ticket) throw new SshError("NO_JOB", "Нет сохранённого задания для этого сервера.");
          assertTicketBinding(this.ticket, endpoint, pin.fingerprint);
          if (action === "resume" && input.confirmedPlanHash !== this.ticket.planHash) throw new SshError("CONFIRMATION", "Подтвердите продолжение сохранённого плана установки.");
          const data: JsonObject = { jobId: this.ticket.jobId, planHash: this.ticket.planHash };
          if (action === "resume") data.confirmedPlanHash = this.ticket.planHash;
          const result = await this.request(action, data, endpoint, pin);
          if (generation !== this.generation) return this.state();
          this.publishStatus(result);
          if (action === "cancel") this.clearCredentials();
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.current.error = safeError(error); this.current.phase = "error";
        if (["AUTH", "KEY_FORMAT", "HOST_KEY_CHANGED", "ABORTED", "NETWORK", "TIMEOUT", "INVALID_RESPONSE", "RESPONSE_LIMIT", "REMOTE_COMMAND"].includes(this.current.error.code) || action === "cancel") this.clearCredentials();
        if (this.current.error.code === "HOST_KEY_CHANGED" && this.current.identity) { this.current.identity.trusted = false; this.current.identity.changed = true; this.observed = undefined; }
      }
    } finally {
      if (generation === this.generation) { this.current.busy = false; this.operation = undefined; this.notify(); }
    }
    return this.state();
  }
  private endpoint(): SshEndpoint { if (!this.current.endpoint) throw new SshError("INPUT", "Сначала укажите SSH-сервер."); return this.current.endpoint; }
  private pin(endpoint: SshEndpoint): SshHostKey {
    const pin = this.pins.get(pinId(endpoint));
    if (!pin || !this.current.identity?.trusted || pin.fingerprint !== this.current.identity.fingerprint) throw new SshError("UNTRUSTED_HOST", "Сначала проверьте и подтвердите SSH-ключ сервера.");
    return pin;
  }
  private async request(action: InstallerAction, data: JsonObject, endpoint: SshEndpoint, pin: SshHostKey, readOnlyPlanBundle?: InstallerBundle): Promise<JsonObject> {
    const bundle = action === "plan" && readOnlyPlanBundle ? readOnlyPlanBundle : ["status", "cancel", "resume"].includes(action) ? this.recoveryBundle ?? this.bundle : this.bundle;
    const payload = bundle.payload(action, data);
    try { return parseInstallerReply(await this.transport.installer(endpoint, this.credentials!, pin, payload, this.operation!.signal, action === "plan" ? 180_000 : 60_000)); }
    finally { payload.fill(0); }
  }
  private createTicket(endpoint: SshEndpoint, pin: SshHostKey): InstallTicket {
    return { endpoint: { ...endpoint }, hostFingerprint: pin.fingerprint, plan: this.plan!, jobId: this.plan!.existingJobId ?? randomUUID(), planHash: this.plan!.existingPlanHash ?? this.plan!.hash };
  }
  private async saveTicket(): Promise<void> {
    const ticket = this.ticket!;
    await atomicWrite(this.ticketFile, JSON.stringify({ schema: 1, endpoint: ticket.endpoint, hostFingerprint: ticket.hostFingerprint, jobId: ticket.jobId, planHash: ticket.planHash, plan: jsonObject(ticket.plan.json) }));
  }
  private publishPlan(): void { if (this.plan) { const { json: _json, ...publicPlan } = this.plan; this.current.plan = publicPlan; } }
  private publishTicket(): void { if (this.ticket) this.current.ticket = { jobId: this.ticket.jobId, domain: this.ticket.plan.options.domain, ...this.ticket.endpoint, planHash: this.ticket.planHash }; }
  private publishStatus(value: JsonObject): void { this.current.status = parseInstallStatus(value, this.ticket!); if (this.current.status.terminal) this.clearCredentials(); this.current.phase = this.current.status.state === "completed" ? "completed" : "running"; }
}
