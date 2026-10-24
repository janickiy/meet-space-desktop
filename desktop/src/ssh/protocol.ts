import { createHash, createPublicKey, verify } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isIP } from "node:net";

export type JsonObject = Record<string, unknown>;
export type InstallerAction = "plan" | "apply" | "status" | "cancel" | "resume";
export type InstallState = "running" | "cancel_requested" | "cancelled" | "needs_recovery" | "failed" | "completed";
export interface SmtpOptions { host: string; port: number; from: string; username: string; tlsMode: "starttls" | "tls" }
export interface InstallOptions { domain: string; publicIpv4: string; acmeEmail?: string; smtp?: SmtpOptions }
export interface InstallEndpoint { host: string; port: number; user: string }
export interface InstallPlan {
  json: string; hash: string; version: string; commit: string; options: InstallOptions;
  architecture: "amd64" | "arm64"; installDocker: boolean; expiresAt: number;
  existingJobId?: string; existingPlanHash?: string; sourceSelection?: string; sourceSha256: string;
  resourceProfile?: "standard" | "compact-test"; installDockerPluginsOnly: boolean;
  missingDockerPlugins: string[]; actions: string[];
}
export interface InstallTicket {
  endpoint: InstallEndpoint; hostFingerprint: string; plan: InstallPlan; jobId: string; planHash: string;
}
export interface InstallEvent { sequence: number; phase: string; state: InstallState; errorCode?: string }
export interface InstallStatus {
  jobId: string; state: InstallState; phase: string; completedPhases: string[];
  events: InstallEvent[]; errorCode?: string; terminal: boolean;
}
export interface PlanValidation { expectedOptions?: InstallOptions; now?: number; allowExpired?: boolean }

export const MAX_INSTALLER_REPLY_BYTES = 256 * 1024;
export const MAX_INSTALLER_PAYLOAD_BYTES = 512 * 1024;
export const INSTALLER_COMMAND = 'if [ "$(id -u)" = 0 ]; then exec /usr/bin/python3 -; else exec sudo -n /usr/bin/python3 -; fi';
export const installPhases = ["docker", "source", "images", "configuration", "dependencies", "backup", "migrations", "https", "services", "readiness"] as const;
export const installerBundleNames = ["runner.py", "trust-root.pem", "release.json", "release.sig", "docker.asc"] as const;
export const INSTALLER_TRUST_ROOT_SHA256 = "9f16201125cd17dc9fb90a7579e78589c76ecbfdb1ee80df3428ee34d6b90dfc";
// Recovery is limited to this exact previously shipped, still signed recipe.
// Never derive a resource path from a server response or a saved ticket.
export const LEGACY_INSTALLER_RELEASE_SHA256 = "f385643e8019e89cf38bea29c15477cde6baddbe74bcab0f94a18d696e5b637a";
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const STATES: readonly string[] = ["running", "cancel_requested", "cancelled", "needs_recovery", "failed", "completed"];
const ACTIONS = ["fetch-verified-source", "build-and-pin-images", "generate-secrets", "private-volumes", "backup-and-migrate", "acme-https-wss", "authenticated-turn", "readiness"];

export class InstallFailure extends Error {
  constructor(readonly code: string) { super(`Установщик: ${code}`); this.name = "InstallFailure"; }
}
function requireValue(value: unknown): asserts value { if (!value) throw new Error("invalid installer metadata"); }
function object(value: unknown): JsonObject {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}
function string(value: unknown): string { requireValue(typeof value === "string"); return value; }
function integer(value: unknown): number { requireValue(typeof value === "number" && Number.isSafeInteger(value)); return value; }
function boolean(value: unknown): boolean { requireValue(typeof value === "boolean"); return value; }
function optionalString(value: unknown): string | undefined { return value == null ? undefined : string(value); }
function sameKeys(value: JsonObject, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
export function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }

/** Validate public SMTP settings; credentials are sent only with apply, never in a plan. */
export function smtpOptions(raw: unknown): SmtpOptions {
  const value = object(raw);
  requireValue(sameKeys(value, ["host", "port", "from", "username", "tlsMode"]));
  const host = string(value.host), from = string(value.from), username = string(value.username);
  const port = integer(value.port), tlsMode = string(value.tlsMode);
  requireValue(host.length <= 253 && (isIP(host) !== 0 || host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))));
  requireValue(port > 0 && port <= 65535 && ["starttls", "tls"].includes(tlsMode));
  requireValue(from.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(from));
  requireValue(Buffer.byteLength(username) > 0 && Buffer.byteLength(username) <= 254 && !/[\r\n\x00]/.test(username));
  return { host, port, from, username, tlsMode: tlsMode as SmtpOptions["tlsMode"] };
}

// Match runner.py's ensure_ascii=True canonical JSON, including escaped UTF-16 pairs.
export function canonicalJson(value: unknown): string {
  function encode(input: unknown, depth: number): string {
    requireValue(depth <= 32);
    if (input === null) return "null";
    if (typeof input === "string") return JSON.stringify(input).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
    if (typeof input === "boolean") return String(input);
    if (typeof input === "number") { requireValue(Number.isSafeInteger(input)); return String(input); }
    if (Array.isArray(input)) return `[${input.map(item => encode(item, depth + 1)).join(",")}]`;
    const record = object(input);
    return `{${Object.keys(record).sort().map(key => `${encode(key, depth + 1)}:${encode(record[key], depth + 1)}`).join(",")}}`;
  }
  return encode(value, 0);
}

/** Bounded, strict JSON: duplicate keys, unsafe integers and deep nesting fail closed. */
export function jsonObject(raw: string | Buffer): JsonObject {
  if (Buffer.byteLength(raw) > MAX_INSTALLER_REPLY_BYTES) throw new InstallFailure("RESPONSE_LIMIT");
  try {
    const source = typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw);
    let offset = 0;
    const whitespace = () => { while (/[\x20\t\r\n]/.test(source[offset] ?? "!") && offset < source.length) offset++; };
    function tokenString(): string {
      const start = offset++;
      while (offset < source.length) {
        const char = source[offset++];
        if (char === "\\") offset++;
        else if (char === '"') return string(JSON.parse(source.slice(start, offset)));
      }
      throw new Error("unterminated string");
    }
    function parse(depth: number): unknown {
      requireValue(depth <= 32); whitespace();
      if (source[offset] === '"') return tokenString();
      if (source[offset] === "{") {
        offset++; whitespace(); const result = Object.create(null) as JsonObject;
        if (source[offset] === "}") { offset++; return result; }
        while (offset < source.length) {
          requireValue(source[offset] === '"'); const key = tokenString();
          requireValue(!Object.hasOwn(result, key)); whitespace(); requireValue(source[offset++] === ":");
          result[key] = parse(depth + 1); whitespace(); const char = source[offset++];
          if (char === "}") return result;
          requireValue(char === ","); whitespace();
        }
      } else if (source[offset] === "[") {
        offset++; whitespace(); const result: unknown[] = [];
        if (source[offset] === "]") { offset++; return result; }
        while (offset < source.length) {
          result.push(parse(depth + 1)); whitespace(); const char = source[offset++];
          if (char === "]") return result;
          requireValue(char === ",");
        }
      } else {
        const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(offset));
        requireValue(match); offset += match[0].length; const result: unknown = JSON.parse(match[0]);
        if (typeof result === "number") integer(result);
        return result;
      }
      throw new Error("incomplete JSON");
    }
    const result = object(parse(0)); whitespace(); requireValue(offset === source.length); return result;
  } catch { throw new InstallFailure("INVALID_RESPONSE"); }
}

export class InstallerBundle {
  readonly manifest: JsonObject;
  private readonly files: Record<string, Buffer>;

  constructor(files: Record<string, Buffer>) {
    try {
      requireValue(sameKeys(files, installerBundleNames));
      requireValue(Object.values(files).every(file => Buffer.isBuffer(file) && file.length <= MAX_INSTALLER_REPLY_BYTES));
      requireValue(sha256(files["trust-root.pem"]) === INSTALLER_TRUST_ROOT_SHA256);
      const key = createPublicKey(files["trust-root.pem"]);
      requireValue(key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 3072);
      requireValue(verify("RSA-SHA256", files["release.json"], key, files["release.sig"]));
      this.manifest = jsonObject(files["release.json"]);
      requireValue(this.manifest.schema === 1 && this.manifest.installerVersion === "1.0.0" && this.manifest.profile === "source-v1");
      requireValue(this.manifest.runnerSha256 === sha256(files["runner.py"]) && this.manifest.dockerKeySha256 === sha256(files["docker.asc"]));
      requireValue(this.manifest.sourcePolicy === undefined || this.manifest.sourcePolicy === "github-latest-stable-v1");
      this.files = Object.fromEntries(installerBundleNames.map(name => [name, Buffer.from(files[name])]));
      deepFreeze(this.manifest);
    } catch { throw new InstallFailure("RELEASE_INVALID"); }
  }

  static fromDirectory(directory: string): InstallerBundle {
    try {
      requireValue(sameKeys(Object.fromEntries(readdirSync(directory).map(name => [name, true])), installerBundleNames));
      const files = Object.fromEntries(installerBundleNames.map(name => {
        const path = join(directory, name); const stat = lstatSync(path);
        requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_INSTALLER_REPLY_BYTES);
        return [name, readFileSync(path)];
      }));
      return new InstallerBundle(files);
    } catch { throw new InstallFailure("RELEASE_INVALID"); }
  }

  static forSavedPlan(directory: string, plan: JsonObject): InstallerBundle {
    const current = InstallerBundle.fromDirectory(directory);
    const recipeHash = plan.sourceLock === undefined ? plan.releaseSha256 : plan.recipeSha256;
    let selected = current;
    if (recipeHash !== sha256(canonicalJson(current.manifest))) {
      if (recipeHash !== LEGACY_INSTALLER_RELEASE_SHA256) throw new InstallFailure("PLAN_INVALID");
      selected = InstallerBundle.legacyRecovery(directory);
    }
    // The hash is only a selector; every binding and the original plan hash must
    // still validate against the selected signed bundle, with no plan rewriting.
    selected.parsePlan(plan, { allowExpired: true });
    return selected;
  }

  static legacyRecovery(directory: string): InstallerBundle {
    const legacy = InstallerBundle.fromDirectory(join(directory, "..", "legacy", LEGACY_INSTALLER_RELEASE_SHA256));
    if (sha256(canonicalJson(legacy.manifest)) !== LEGACY_INSTALLER_RELEASE_SHA256) throw new InstallFailure("RELEASE_INVALID");
    return legacy;
  }

  payload(action: InstallerAction, request: JsonObject): Buffer {
    try {
      requireValue(["plan", "apply", "status", "cancel", "resume"].includes(action));
      const requestText = canonicalJson(object(request));
      requireValue(Buffer.byteLength(requestText) <= MAX_INSTALLER_REPLY_BYTES);
      const bundle = Object.fromEntries(installerBundleNames.map(name => [name, this.files[name].toString("base64")]));
      const encoded = Buffer.from(JSON.stringify({ bundle, action, request: jsonObject(requestText) })).toString("base64");
      const payload = Buffer.from("import base64,json\n_d=json.loads(base64.b64decode('" + encoded + "'))\n" +
        "_b={k:base64.b64decode(v) for k,v in _d['bundle'].items()}\n" +
        "_g={'__name__':'meetspace_bootstrap','BOOTSTRAP_BUNDLE':_b}\n" +
        "exec(compile(_b['runner.py'],'meetspace-signed-installer','exec'),_g)\n" +
        "_g['entry'](_d['action'],_d['request'])\n");
      requireValue(payload.length <= MAX_INSTALLER_PAYLOAD_BYTES); return payload;
    } catch { throw new InstallFailure("INVALID_REQUEST"); }
  }

  parsePlan(input: JsonObject, validation: PlanValidation = {}): InstallPlan {
    try {
      // Reparse into owned bounded data, so callers cannot mutate verified contents.
      const value = jsonObject(canonicalJson(input));
      const hash = string(value.hash); requireValue(HASH.test(hash));
      requireValue(sha256(canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "hash")))) === hash);
      requireValue(value.schema === 1 && value.installerVersion === "1.0.0");
      const release = this.effectiveManifest(value);
      requireValue(value.releaseSha256 === sha256(canonicalJson(release)));
      requireValue(value.commit === release.commit && value.releaseVersion === release.version && value.runnerSha256 === release.runnerSha256);
      requireValue(value.root === "/opt/meetspace" && value.project === "meetspace");
      const optionsObject = object(value.options);
      const optionKeys = ["domain", "publicIpv4", ...(optionsObject.acmeEmail === undefined ? [] : ["acmeEmail"]), ...(optionsObject.smtp === undefined ? [] : ["smtp"])];
      requireValue(sameKeys(optionsObject, optionKeys));
      const options: InstallOptions = { domain: string(optionsObject.domain), publicIpv4: string(optionsObject.publicIpv4), acmeEmail: optionalString(optionsObject.acmeEmail) ?? "" };
      if (optionsObject.smtp !== undefined) options.smtp = smtpOptions(optionsObject.smtp);
      requireValue(validDomain(options.domain) && isIP(options.publicIpv4) === 4);
      requireValue((options.acmeEmail?.length ?? 0) <= 254 && !/[\r\n\x00]/.test(options.acmeEmail ?? ""));
      if (validation.expectedOptions) {
        requireValue(options.domain === validation.expectedOptions.domain && options.publicIpv4 === validation.expectedOptions.publicIpv4);
        requireValue(options.acmeEmail === (validation.expectedOptions.acmeEmail ?? ""));
        requireValue(canonicalJson(options.smtp ?? null) === canonicalJson(validation.expectedOptions.smtp ?? null));
      }
      const issuedAt = integer(value.issuedAt); const expiresAt = integer(value.expiresAt);
      requireValue(issuedAt > 0 && expiresAt === issuedAt + 900);
      if (!validation.allowExpired) {
        const now = validation.now ?? Math.floor(Date.now() / 1000);
        if (issuedAt > now + 30 || now > expiresAt) throw new InstallFailure("PLAN_EXPIRED");
      }
      const platform = object(value.platform); const arch = string(platform.arch);
      requireValue(platform.os === "ubuntu" && ["22.04", "24.04"].includes(string(platform.osVersion)) && ["amd64", "arm64"].includes(arch));
      const packageMatrix = object(object(release.dockerPackagesByUbuntu)[string(platform.osVersion)]);
      requireValue(canonicalJson(value.dockerPackages) === canonicalJson(packageMatrix[arch]));
      const docker = object(value.docker); const installed = boolean(docker.installed);
      const compose = docker.installCompose === undefined ? false : boolean(docker.installCompose);
      const buildx = docker.installBuildx === undefined ? false : boolean(docker.installBuildx);
      const missingDockerPlugins = [...(compose ? ["Compose"] : []), ...(buildx ? ["Buildx"] : [])];
      const resourceProfile = optionalString(value.resourceProfile);
      requireValue(!resourceProfile || ["standard", "compact-test"].includes(resourceProfile));
      const existingJobId = optionalString(value.existingJobId); const existingPlanHash = optionalString(value.existingPlanHash);
      requireValue((!existingJobId && !existingPlanHash) || (existingJobId && UUID.test(existingJobId) && existingPlanHash && HASH.test(existingPlanHash)));
      const dockerActions = installed ? [...(compose ? ["install-compose"] : []), ...(buildx ? ["install-buildx"] : [])] : ["install-docker"];
      if (!dockerActions.length) dockerActions.push("reuse-docker");
      const actions = [...dockerActions, ...ACTIONS]; requireValue(canonicalJson(value.actions) === canonicalJson(actions));
      const lock = value.sourceLock === undefined ? undefined : object(value.sourceLock);
      return {
        json: canonicalJson(value), hash, version: string(value.releaseVersion), commit: string(value.commit), options,
        architecture: arch as "amd64" | "arm64", installDocker: !installed || missingDockerPlugins.length > 0,
        expiresAt, existingJobId, existingPlanHash, sourceSelection: lock ? `${string(lock.channel)}: ${string(lock.ref)}` : undefined,
        sourceSha256: string(release.sourceSha256), resourceProfile: resourceProfile as InstallPlan["resourceProfile"],
        installDockerPluginsOnly: installed && missingDockerPlugins.length > 0, missingDockerPlugins, actions,
      };
    } catch (error) {
      if (error instanceof InstallFailure && error.code === "PLAN_EXPIRED") throw error;
      throw new InstallFailure("PLAN_INVALID");
    }
  }

  private effectiveManifest(plan: JsonObject): JsonObject {
    if (plan.sourceLock === undefined) return this.manifest;
    requireValue(this.manifest.sourcePolicy === "github-latest-stable-v1");
    const lock = object(plan.sourceLock);
    requireValue(plan.recipeSha256 === sha256(canonicalJson(this.manifest)));
    requireValue(sameKeys(lock, ["repository", "channel", "ref", "version", "commit", "builtAt", "sourceUrl", "sourceSha256", "sourceFiles"]));
    requireValue(lock.repository === "janickiy/meet-space");
    const commit = string(lock.commit); const version = string(lock.version); const ref = string(lock.ref);
    requireValue(/^[a-f0-9]{40}$/.test(commit) && HASH.test(string(lock.sourceSha256)));
    requireValue(lock.sourceUrl === `https://codeload.github.com/janickiy/meet-space/tar.gz/${commit}`);
    requireValue(version.length <= 64 && /^v?[0-9]+\.[0-9]+\.[0-9]+(?:[+-][A-Za-z0-9.-]+)?$/.test(version));
    requireValue(/^[A-Za-z0-9][A-Za-z0-9._/+-]{0,199}$/.test(ref));
    requireValue(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(string(lock.builtAt)));
    requireValue((lock.channel === "release" && version === ref) || (lock.channel === "default-branch" && version === `0.0.0-source.${commit.slice(0, 12)}`));
    const hashes = object(lock.sourceFiles);
    requireValue(sameKeys(hashes, Object.keys(object(this.manifest.sourceFiles))) && Object.values(hashes).every(hash => typeof hash === "string" && HASH.test(hash)));
    const effective: JsonObject = { ...this.manifest, backendTag: lock.channel === "release" ? ref : null };
    for (const key of ["version", "commit", "builtAt", "sourceUrl", "sourceSha256", "sourceFiles"]) effective[key] = lock[key];
    effective.dockerfiles = Object.fromEntries(Object.entries(object(this.manifest.dockerfiles)).map(([name, raw]) => {
      const file = object(raw); return [name, { ...file, sha256: hashes[string(file.path)] }];
    }));
    return effective;
  }
}

function deepFreeze(value: unknown): void {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
}
function validDomain(domain: string): boolean {
  return domain.length <= 253 && isIP(domain) === 0 && domain.includes(".") && domain.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function parseInstallerReply(raw: string | Buffer): JsonObject {
  const response = jsonObject(raw);
  try {
    requireValue(response.protocol === "MSI1");
    if (!boolean(response.ok)) {
      const code = string(response.errorCode);
      throw new InstallFailure(/^[A-Z_]{1,64}$/.test(code) ? code : "INVALID_RESPONSE");
    }
    return object(response.result);
  } catch (error) {
    if (error instanceof InstallFailure) throw error;
    throw new InstallFailure("INVALID_RESPONSE");
  }
}

/** Public tickets bind retries/recovery to the endpoint and the accepted SSH key. */
export function assertTicketBinding(ticket: InstallTicket, endpoint?: InstallEndpoint, hostFingerprint?: string): void {
  try {
    requireValue(UUID.test(ticket.jobId));
    requireValue(HASH.test(ticket.planHash) && ticket.planHash === (ticket.plan.existingPlanHash ?? ticket.plan.hash));
    requireValue(ticket.plan.existingJobId === undefined || ticket.plan.existingJobId === ticket.jobId);
    requireValue(/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(ticket.hostFingerprint));
    requireValue(typeof ticket.endpoint.host === "string" && ticket.endpoint.host.length > 0 && ticket.endpoint.host.length <= 253 && !/[\s\x00]/.test(ticket.endpoint.host));
    requireValue(Number.isInteger(ticket.endpoint.port) && ticket.endpoint.port > 0 && ticket.endpoint.port <= 65535);
    requireValue(/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(ticket.endpoint.user));
    if (endpoint) requireValue(endpoint.host === ticket.endpoint.host && endpoint.port === ticket.endpoint.port && endpoint.user === ticket.endpoint.user);
    if (hostFingerprint) requireValue(hostFingerprint === ticket.hostFingerprint);
  } catch { throw new InstallFailure("TICKET_INVALID"); }
}

export function parseInstallStatus(input: JsonObject, ticket: InstallTicket): InstallStatus {
  try {
    assertTicketBinding(ticket);
    const value = jsonObject(canonicalJson(input));
    requireValue(value.jobId === ticket.jobId && value.planHash === ticket.planHash);
    requireValue(value.commit === ticket.plan.commit && value.domain === ticket.plan.options.domain && value.releaseVersion === ticket.plan.version);
    const state = string(value.state); requireValue(STATES.includes(state));
    const phase = (record: JsonObject): string => { const result = optionalString(record.phase) ?? "queued"; requireValue(/^[a-z:-]{1,64}$/.test(result)); return result; };
    const errorCode = (record: JsonObject): string | undefined => { const result = optionalString(record.errorCode); requireValue(result === undefined || /^[A-Z_]{1,64}$/.test(result)); return result; };
    requireValue(Array.isArray(value.completedPhases)); const completedPhases = value.completedPhases.map(string);
    requireValue(completedPhases.length <= installPhases.length && completedPhases.every((item, index) => item === installPhases[index]));
    if (state === "completed") requireValue(completedPhases.length === installPhases.length);
    requireValue(Array.isArray(value.events) && value.events.length <= 64);
    let lastSequence = 0;
    const events: InstallEvent[] = value.events.map(raw => {
      const event = object(raw); const eventState = string(event.state); requireValue(STATES.includes(eventState));
      const sequence = integer(event.sequence); requireValue(sequence > lastSequence); lastSequence = sequence;
      return { sequence, phase: phase(event), state: eventState as InstallState, errorCode: errorCode(event) };
    });
    return { jobId: ticket.jobId, state: state as InstallState, phase: phase(value), completedPhases, events, errorCode: errorCode(value), terminal: ["completed", "cancelled", "needs_recovery", "failed"].includes(state) };
  } catch { throw new InstallFailure("INVALID_RESPONSE"); }
}
