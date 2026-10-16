import { execFile, spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import type { UpdateTrust } from "./updates-policy";

export interface WindowsSignatureReport { path: string; status: "Valid"; signatureType: "Authenticode"; subject: string; thumbprint: string; timestamped: true }
/** Exported so CI/tests can apply the same strict report policy. No missing-field fallback. */
export function validateWindowsSignature(value: unknown, filename: string, trust: UpdateTrust): WindowsSignatureReport {
  const item = value as Partial<WindowsSignatureReport> | null;
  if (!item || typeof item !== "object" || Array.isArray(item) || item.status !== "Valid" || item.signatureType !== "Authenticode" ||
    typeof item.path !== "string" || path.win32.normalize(item.path).toLowerCase() !== path.win32.normalize(filename).toLowerCase() ||
    typeof item.subject !== "string" || !trust.publisherNames.includes(item.subject) || typeof item.thumbprint !== "string" ||
    !trust.signingCertThumbprints.includes(item.thumbprint.toUpperCase()) || item.timestamped !== true) throw new Error("update_signature_invalid");
  return item as WindowsSignatureReport;
}
// Paths are passed through a private environment field, never interpolated into
// PowerShell or a shell command. The command is constant and fails on every error.
export const WINDOWS_SIGNATURE_SCRIPT = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Set-StrictMode -Version Latest
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$s=Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:MEETSPACE_UPDATE_VERIFY_PATH -ErrorAction Stop
[pscustomobject]@{path=$s.Path;status=[string]$s.Status;signatureType=[string]$s.SignatureType;subject=$s.SignerCertificate.Subject;thumbprint=$s.SignerCertificate.Thumbprint;timestamped=($null -ne $s.TimeStamperCertificate)} | Microsoft.PowerShell.Utility\\ConvertTo-Json -Compress
`;
export function windowsSignatureCommand(filename: string, systemRoot: unknown): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (!path.win32.isAbsolute(filename) || /[\u0000-\u001f\u007f]/.test(filename) || typeof systemRoot !== "string" ||
    !/^[A-Za-z]:\\[^\u0000-\u001f\u007f]+$/.test(systemRoot) || systemRoot.includes("..")) throw new Error("update_signature_invalid");
  return { executable: path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-InputFormat", "None", "-EncodedCommand", Buffer.from(WINDOWS_SIGNATURE_SCRIPT, "utf16le").toString("base64")],
    env: { SystemRoot: systemRoot, WINDIR: systemRoot,
      PSModulePath: path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules"), MEETSPACE_UPDATE_VERIFY_PATH: filename } };
}
export async function readWindowsSignature(filename: string, trust: UpdateTrust, signal: AbortSignal): Promise<WindowsSignatureReport> {
  if (process.platform !== "win32" || signal.aborted || !path.win32.isAbsolute(filename)) throw new Error("update_signature_invalid");
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("update_signature_invalid");
  const command = windowsSignatureCommand(filename, process.env.SystemRoot);
  return new Promise<WindowsSignatureReport>((resolve, reject) => {
    execFile(command.executable, command.args, {
      shell: false, windowsHide: true, timeout: 20000, maxBuffer: 16384, encoding: "utf8", signal,
      env: command.env,
    }, (error, stdout, stderr) => {
      if (error || stderr.trim() || signal.aborted) { reject(new Error("update_signature_invalid")); return; }
      try { resolve(validateWindowsSignature(JSON.parse(stdout.replace(/^\uFEFF/, "")), filename, trust)); }
      catch { reject(new Error("update_signature_invalid")); }
    });
  });
}
export async function verifyWindowsSignature(filename: string, trust: UpdateTrust, signal: AbortSignal): Promise<void> {
  await readWindowsSignature(filename, trust, signal);
}

/** Explicit update action only. No shell, elevation helper or error fallback. */
export async function launchWindowsInstaller(filename: string): Promise<void> {
  if (process.platform !== "win32" || !path.win32.isAbsolute(filename)) throw new Error("update_install_failed");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(filename, ["--updated", "--force-run"], { detached: true, stdio: "ignore", shell: false, windowsHide: false });
    child.once("error", () => reject(new Error("update_install_failed")));
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}
