#requires -Version 5.1
# Interactive, disposable Windows 11 ARM64 test VM only. This wrapper does not
# alter the existing acceptance helper or enable any application debug bypass.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedInstallerSha256,
  [Parameter(Mandatory = $true)][switch]$DisposableAccount
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$qaRoot = 'C:\MeetSpaceQA'

if (-not $DisposableAccount) { throw 'A disposable Windows VM/account is required.' }
if ($env:OS -ne 'Windows_NT') { throw 'Windows is required; no acceptance run was started.' }
$installer = Join-Path $qaRoot 'MeetSpace-0.7.0-win-arm64-test-setup.exe'
$helper = Join-Path $qaRoot 'windows-acceptance.ps1'
$launcher = [Diagnostics.Process]::GetCurrentProcess()
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not [Environment]::UserInteractive -or $launcher.SessionId -le 0 -or
    $identity.User.Value -in @('S-1-5-18','S-1-5-19','S-1-5-20')) {
  throw 'Open ordinary PowerShell in the logged-in Windows desktop; SYSTEM/session 0 is not allowed.'
}
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Use ordinary, non-elevated PowerShell. Do not run this launcher as administrator.'
}
if ([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') -ine $qaRoot) {
  throw 'Place this launcher and the reviewed files in C:\MeetSpaceQA.'
}
$qaItem = Get-Item -LiteralPath $qaRoot
if (-not $qaItem.PSIsContainer -or ($qaItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'The QA directory must be an ordinary local directory.'
}
foreach ($file in @($installer, ($installer + '.json'), $helper)) {
  $item = Get-Item -LiteralPath $file
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Only ordinary local installer, manifest and helper files are allowed.'
  }
}
$digest = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
if ($digest -cne $ExpectedInstallerSha256.ToLowerInvariant()) { throw 'Installer differs from the independently supplied host SHA256.' }
$manifest = Get-Content -LiteralPath ($installer + '.json') -Raw | ConvertFrom-Json
if ($manifest.buildVersion -cne '0.7.0-test' -or $manifest.arch -cne 'arm64' -or
    $manifest.releaseMode -cne 'test' -or $manifest.signed -ne $false -or $manifest.sha256 -cne $digest) {
  throw 'Expected the verified Stage 07 unsigned ARM64 test installer and its matching manifest.'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MeetSpaceStage07Native {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);
}
'@
function Get-NativeEvidence([Diagnostics.Process]$Process) {
  [UInt16]$processMachine = 0; [UInt16]$nativeMachine = 0
  if (-not [MeetSpaceStage07Native]::IsWow64Process2($Process.Handle, [ref]$processMachine, [ref]$nativeMachine)) {
    throw 'Cannot query native process architecture.'
  }
  $osArchitecture = switch ($nativeMachine) { 0xaa64 { 'arm64' }; 0x8664 { 'x64' }; default { 'unsupported' } }
  $processArchitecture = if ($processMachine -eq 0) { $osArchitecture } else {
    switch ($processMachine) { 0xaa64 { 'arm64' }; 0x8664 { 'x64' }; 0x14c { 'x86' }; default { 'unsupported' } }
  }
  return [ordered]@{ osArchitecture=$osArchitecture; processArchitecture=$processArchitecture;
    native=($processMachine -eq 0); processMachine=('0x{0:x4}' -f $processMachine); nativeMachine=('0x{0:x4}' -f $nativeMachine) }
}
function Write-Evidence([string]$File, $Value) {
  [IO.File]::WriteAllText($File, (($Value | ConvertTo-Json -Depth 10) + "`n"), (New-Object Text.UTF8Encoding($false)))
}

$os = Get-CimInstance Win32_OperatingSystem -Property Caption, Version, BuildNumber, ProductType
$computer = Get-CimInstance Win32_ComputerSystem -Property Manufacturer, Model
$native = Get-NativeEvidence $launcher
if ([int]$os.ProductType -ne 1 -or [int]$os.BuildNumber -lt 22000 -or $native.osArchitecture -cne 'arm64') {
  throw 'This launcher is only for Windows 11 client on an ARM64 OS, including build 26100.'
}
$windows = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$evidenceRoot = Join-Path $qaRoot ('evidence-stage07-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
# This also proves the ordinary user can write the transferred QA directory.
New-Item -ItemType Directory -Path $evidenceRoot | Out-Null
Write-Evidence (Join-Path $evidenceRoot 'preflight.json') ([ordered]@{
  schemaVersion=1; collectedAt=[DateTime]::UtcNow.ToString('o'); scope='preflight, not Windows acceptance';
  installerSha256=$digest; buildVersion=$manifest.buildVersion; sourceCommit=$manifest.sourceCommit;
  sourceTreeSha256=$manifest.sourceTreeSha256; osCaption=[string]$os.Caption; osVersion=[string]$os.Version;
  osBuild=[int]$os.BuildNumber; osProductType=[int]$os.ProductType; displayVersion=[string]$windows.DisplayVersion;
  updateBuildRevision=[int]$windows.UBR; manufacturer=[string]$computer.Manufacturer; model=[string]$computer.Model;
  sessionId=$launcher.SessionId; userInteractive=[Environment]::UserInteractive; elevated=$false; launcherArchitecture=$native;
  helperSha256=(Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant();
  launcherSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
})

# Same logged-in desktop/token, never the guest-agent SYSTEM token. Process-local
# ExecutionPolicy applies only to this reviewed local helper; registry policy,
# UAC, TLS, sandbox and application preferences are not changed.
$shell = $launcher.MainModule.FileName
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = $shell
$start.UseShellExecute = $false
$start.WorkingDirectory = $qaRoot
$start.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $helper +
  '" -Installer "' + $installer + '" -ExpectedArchitecture arm64 -ExpectedOS win11 -EvidenceDirectory "' + $evidenceRoot + '" -DisposableAccount'
$processes = @{}; $inaccessibleSamples = 0; $observedIds = @{}
$child = [Diagnostics.Process]::Start($start)
$deadline = [DateTime]::UtcNow.AddMinutes(15)
$launcherResult = 'FAIL'; $helperExit = $null
try {
  while (-not $child.HasExited) {
    if ([DateTime]::UtcNow -ge $deadline) {
      throw 'Acceptance exceeded its outer observation window. Inspect the VM; no process was forcibly killed by the launcher.'
    }
    # Read only executable path + PID/session, never command lines, environment,
    # server URLs, usernames, credentials, SDP or message content.
    foreach ($candidate in @(Get-CimInstance Win32_Process -Filter "Name='MeetSpace.exe'" -Property ProcessId, ParentProcessId, SessionId, ExecutablePath)) {
      $ownedPrefix = (Join-Path $env:LOCALAPPDATA 'MeetSpaceAcceptance') + '\'
      $exePath = [string]$candidate.ExecutablePath
      if ($candidate.SessionId -ne $launcher.SessionId -or -not $exePath.StartsWith($ownedPrefix, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $relative = $exePath.Substring($ownedPrefix.Length)
      if ($relative -notmatch '^[A-Za-z0-9_-]{43}\\app\\MeetSpace\.exe$') { continue }
      $key = [string]$candidate.ProcessId
      $observedIds[$key] = $true
      if ($processes.ContainsKey($key)) { continue }
      $running = $null
      try {
        $running = [Diagnostics.Process]::GetProcessById([int]$candidate.ProcessId)
        $machine = Get-NativeEvidence $running
        $processes[$key] = [ordered]@{ pid=[int]$candidate.ProcessId; parentPid=[int]$candidate.ParentProcessId;
          sessionId=[int]$candidate.SessionId; observedAt=[DateTime]::UtcNow.ToString('o'); architecture=$machine }
      } catch { $inaccessibleSamples++ }
      finally { if ($running) { $running.Dispose() } }
    }
    [void]$child.WaitForExit(250)
  }
  $helperExit = $child.ExitCode
  if ($helperExit -ne 0) { throw 'The unchanged Windows acceptance helper returned a failure; inspect its evidence before any retry.' }
  $report = Get-Content -LiteralPath (Join-Path $evidenceRoot 'windows-acceptance-win11-arm64.json') -Raw | ConvertFrom-Json
  if ($report.result -cne 'PASS' -or $report.installerSha256 -cne $digest -or $report.testBuild -ne $true -or
      $report.processArchitecture -cne 'arm64' -or $report.nativeArchitectureVerified -ne $true) {
    throw 'The acceptance result does not prove the expected unsigned native ARM64 artifact.'
  }
  $launcherResult = 'PASS'
} finally {
  Write-Evidence (Join-Path $evidenceRoot 'process-observations.json') ([ordered]@{
    schemaVersion=1; collectedAt=[DateTime]::UtcNow.ToString('o'); result=$launcherResult; helperExitCode=$helperExit;
    installerSha256=$digest; scope='best-effort native architecture samples; child roles and all transient children are not proven';
    observedProcessIds=@($observedIds.Keys | Sort-Object); inaccessibleSamples=$inaccessibleSamples;
    processes=@($processes.Values); allCapturedNativeArm64=($processes.Count -gt 0 -and @($processes.Values | Where-Object { -not $_.architecture.native -or $_.architecture.processArchitecture -cne 'arm64' }).Count -eq 0)
  })
  $child.Dispose()
  Write-Output ('Evidence directory: ' + $evidenceRoot)
}
Write-Output ('Stage 07 Windows ARM64 automated acceptance: ' + $launcherResult + '. Product/media/OS-shell/signing acceptance remains separate.')
