#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$ExpectedArchitecture,
  [Parameter(Mandatory = $true)][ValidateSet('win10-22h2', 'win11')][string]$ExpectedOS,
  [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
  [Parameter(Mandatory = $true)][switch]$DisposableAccount
)

# Run only in a new, disposable Windows client account/VM. Never on a real user's installation.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $DisposableAccount) { throw 'A disposable Windows account is required.' }
if ($env:OS -ne 'Windows_NT') { throw 'This acceptance script requires Windows; no Windows evidence was produced.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MeetSpaceAcceptanceNative {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);
}
'@

function Get-ProcessMachine([System.Diagnostics.Process]$Process) {
  [UInt16]$processMachine = 0; [UInt16]$nativeMachine = 0
  if (-not [MeetSpaceAcceptanceNative]::IsWow64Process2($Process.Handle, [ref]$processMachine, [ref]$nativeMachine)) {
    throw 'Cannot prove native process architecture.'
  }
  $native = switch ($nativeMachine) { 0x8664 { 'x64' }; 0xaa64 { 'arm64' }; default { 'unsupported' } }
  $actual = if ($processMachine -eq 0) { $native } else { switch ($processMachine) { 0x8664 { 'x64' }; 0xaa64 { 'arm64' }; default { 'unsupported' } } }
  return @{ os = $native; process = $actual; native = ($processMachine -eq 0) }
}

function Get-PeMachine([string]$File) {
  $stream = [IO.File]::OpenRead($File)
  try {
    $reader = New-Object IO.BinaryReader($stream)
    if ($reader.ReadUInt16() -ne 0x5a4d) { throw 'Missing executable DOS header.' }
    $stream.Position = 0x3c; $offset = $reader.ReadUInt32()
    if ($offset -gt ($stream.Length - 6)) { throw 'Invalid executable PE offset.' }
    $stream.Position = $offset
    if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Missing executable PE header.' }
    return $reader.ReadUInt16()
  } finally { $stream.Dispose() }
}

function Get-MeetSpaceRegistry {
  $found = @()
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      try {
        $uninstall = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall')
        if ($uninstall) {
          try { foreach ($name in $uninstall.GetSubKeyNames()) {
            $key = $uninstall.OpenSubKey($name)
            try {
              $display = [string]$key.GetValue('DisplayName', '')
              if ($display -match '(?i)MeetSpace') {
                $found += [PSCustomObject]@{ kind='uninstall'; hive=[string]$hive; view=[string]$view; key=$name; displayName=$display;
                  installLocation=[string]$key.GetValue('InstallLocation',''); uninstallString=[string]$key.GetValue('UninstallString','') }
              }
            } finally { $key.Dispose() }
          } } finally { $uninstall.Dispose() }
        }
        $protocol = $base.OpenSubKey('Software\Classes\meetspace')
        if ($protocol) {
          try {
            $command = $protocol.OpenSubKey('shell\open\command')
            try { $found += [PSCustomObject]@{ kind='protocol'; hive=[string]$hive; view=[string]$view;
              command=$(if ($command) { [string]$command.GetValue('','') } else { '' }); urlProtocol=($null -ne $protocol.GetValue('URL Protocol',$null)) } }
            finally { if ($command) { $command.Dispose() } }
          } finally { $protocol.Dispose() }
        }
        $run = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run')
        if ($run) {
          try { foreach ($name in $run.GetValueNames()) {
            if (($name + ' ' + [string]$run.GetValue($name)) -match '(?i)MeetSpace') {
              $found += [PSCustomObject]@{ kind='startup'; hive=[string]$hive; view=[string]$view }
            }
          } } finally { $run.Dispose() }
        }
      } finally { $base.Dispose() }
    }
  }
  return $found
}

function Get-MeetSpaceShortcuts {
  $folders = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'),
    [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms')) | Select-Object -Unique
  foreach ($folder in $folders) {
    if ($folder -and (Test-Path -LiteralPath $folder)) {
      Get-ChildItem -LiteralPath $folder -Filter '*MeetSpace*.lnk' -Recurse -File -ErrorAction Stop
    }
  }
}

function Wait-Json([string]$File, [System.Diagnostics.Process]$Process, [int]$Seconds = 50) {
  $until = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ([DateTime]::UtcNow -lt $until) {
    if (Test-Path -LiteralPath $File) { return Get-Content -LiteralPath $File -Raw | ConvertFrom-Json }
    if ($Process.HasExited) { throw 'Installed application exited before its acceptance result.' }
    Start-Sleep -Milliseconds 100
  }
  throw 'Installed application acceptance timed out.'
}

function Start-OwnedProcess([string]$File, [string]$Arguments) {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $File; $info.Arguments = $Arguments; $info.UseShellExecute = $false
  return [Diagnostics.Process]::Start($info)
}

function Wait-Success([System.Diagnostics.Process]$Process, [int]$Milliseconds) {
  if (-not $Process.WaitForExit($Milliseconds)) { throw 'Owned installer process timed out; inspect disposable VM before deleting it.' }
  if ($Process.ExitCode -ne 0) { throw 'Owned installer process returned a failure exit code.' }
}

function Assert-PlainDirectory([string]$Directory) {
  $item = Get-Item -LiteralPath $Directory
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Acceptance directory must be a local, ordinary directory.' }
}

function Write-Utf8Json([string]$File, $Value) {
  # Windows PowerShell 5.1 Set-Content -Encoding UTF8 adds a BOM, unlike PowerShell 7.
  # Evidence is UTF-8 without BOM on both, so the Node release gate reads identical JSON.
  $encoding = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($File, (($Value | ConvertTo-Json -Depth 12) + "`n"), $encoding)
}

$installerPath = (Resolve-Path -LiteralPath $Installer).ProviderPath
$manifestPath = $installerPath + '.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
foreach ($field in @('artifact','arch','sha256','sourceCommit','sourceTreeSha256','buildVersion','appAsarSHA256','payloadSHA256','releaseMode','signed','payloadDlls')) {
  if (-not $manifest.PSObject.Properties[$field]) { throw "Artifact manifest is missing $field." }
}
if ($manifest.releaseMode -notin @('test','release')) { throw 'Unknown artifact release mode.' }
$testBuild = $manifest.releaseMode -eq 'test'
$version = ([string]$manifest.buildVersion) -replace '-test$', ''
if (-not $testBuild -and $version -match '-') { throw 'The stable release channel requires a stable version.' }
if ($version -notmatch '^\d+\.\d+\.\d+(?:-beta(?:\.\d+)?)?$' -or $manifest.sourceCommit -notmatch '^[a-f0-9]{40}$' -or
    $manifest.sourceTreeSha256 -notmatch '^[a-f0-9]{64}$' -or $manifest.sha256 -notmatch '^[a-f0-9]{64}$' -or
    $manifest.arch -ne $ExpectedArchitecture -or $manifest.artifact -cne [IO.Path]::GetFileName($installerPath) -or
    (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.sha256) { throw 'Artifact identity/hash/target mismatch.' }
if (($testBuild -and ($manifest.signed -ne $false -or $manifest.buildVersion -notmatch '-test$')) -or
    (-not $testBuild -and ($manifest.signed -ne $true -or $manifest.buildVersion -match '-test$'))) { throw 'Artifact signing mode mismatch.' }
$signature = Get-AuthenticodeSignature -LiteralPath $installerPath
if (($testBuild -and $signature.Status -ne 'NotSigned') -or (-not $testBuild -and $signature.Status -ne 'Valid')) { throw 'Unexpected installer Authenticode state.' }

$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$hostMachine = Get-ProcessMachine ([Diagnostics.Process]::GetCurrentProcess())
if ([int]$os.ProductType -ne 1 -or $hostMachine.os -ne $ExpectedArchitecture -or
    ($ExpectedOS -eq 'win10-22h2' -and ([int]$os.BuildNumber -ne 19045 -or $ExpectedArchitecture -ne 'x64')) -or
    ($ExpectedOS -eq 'win11' -and [int]$os.BuildNumber -lt 22000)) { throw 'Requested target does not match the actual Windows client OS/native architecture.' }
if (@(Get-MeetSpaceRegistry).Count -or @(Get-MeetSpaceShortcuts).Count -or @(Get-Process -Name '*MeetSpace*' -ErrorAction SilentlyContinue).Count) {
  throw 'Existing MeetSpace installation, registration, shortcut, startup entry or process found; refusing to change it.'
}
foreach ($profileName in @('MeetSpace','MeetSpace Test','MeetSpaceTest','meetspace-desktop')) {
  if ((Test-Path -LiteralPath (Join-Path $env:APPDATA $profileName)) -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA $profileName))) {
    throw 'Existing MeetSpace profile found; use a new disposable Windows account.'
  }
}
if ($env:LOCALAPPDATA.StartsWith('\\') -or [IO.Path]::GetTempPath().StartsWith('\\')) { throw 'Use local disks; Chromium sandbox assets must not be on a network share.' }
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$nonce = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$ownedBase = Join-Path $env:LOCALAPPDATA 'MeetSpaceAcceptance'
$ownedRoot = Join-Path $ownedBase $nonce
$runtimeBase = Join-Path ([IO.Path]::GetTempPath()) 'MeetSpaceAcceptance'
$runtimeRoot = Join-Path $runtimeBase $nonce
$installDirectory = Join-Path $ownedRoot 'app'
foreach ($base in @($ownedBase,$runtimeBase)) {
  New-Item -ItemType Directory -Path $base -Force | Out-Null
  Assert-PlainDirectory $base
}
if ((Test-Path -LiteralPath $ownedRoot) -or (Test-Path -LiteralPath $runtimeRoot)) { throw 'Acceptance nonce directory already exists.' }
New-Item -ItemType Directory -Path $ownedRoot | Out-Null
New-Item -ItemType Directory -Path $runtimeRoot | Out-Null
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$evidenceRoot = (Resolve-Path -LiteralPath $EvidenceDirectory).ProviderPath
Assert-PlainDirectory $evidenceRoot
$target = "$ExpectedOS-$ExpectedArchitecture"
$reportFile = Join-Path $evidenceRoot "windows-acceptance-$target.json"
if (Test-Path -LiteralPath $reportFile) { throw 'Evidence file already exists; choose a fresh evidence directory.' }
$report = [ordered]@{ schemaVersion=1; reportId=$nonce; sourceCommit=$manifest.sourceCommit; sourceTreeSha256=$manifest.sourceTreeSha256;
  version=$version; installer=$manifest.artifact; installerSha256=$manifest.sha256; target=$target; platform='win32';
  osBuild=[int]$os.BuildNumber; osProductType=[int]$os.ProductType; osArchitecture=$hostMachine.os; processArchitecture=$null;
  nativeArchitectureVerified=$false; testBuild=$testBuild; result='FAIL'; collectedAt=$null;
  environment=@{ manufacturer=[string]$computer.Manufacturer; model=[string]$computer.Model; virtualization='Record guest host/emulator details in manual acceptance; model alone is not hardware proof' };
  authenticode=@{ status=[string]$signature.Status; signerThumbprint=$(if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }) };
  checks=[ordered]@{ install=$false; launch=$false; singleInstance=$false; uninstall=$false; sandboxBridgeCsp=$false; protocol=$false; shortcuts=$false; noAutomaticStartup=$false;
    protocolShellLaunch=$false; manualProductAcceptance=$false; optionalStartupOptIn=$false; realMediaDevices=$false };
  scope=@{ protocol='Registry command binding plus existing-instance CLI route, not OS ShellExecute';
    signedUi='Signed release never enables the test diagnostic hook; renderer and physical UI checks need separate witnessed evidence' } }
$application = $null; $installed = $false; $uninstaller = $null; $executable = Join-Path $installDirectory 'MeetSpace.exe'
try {
  # NSIS requires /D last and unquoted, including a directory containing spaces.
  if ($installDirectory -match '["\r\n]') { throw 'Unsafe installer destination.' }
  $setup = Start-OwnedProcess $installerPath "/S /currentuser /D=$installDirectory"
  Wait-Success $setup 180000
  $installed = $true
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Installed executable was not created in the owned directory.' }
  Assert-PlainDirectory $installDirectory
  if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.payloadSHA256 -or
      (Get-FileHash -LiteralPath (Join-Path $installDirectory 'resources\app.asar') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.appAsarSHA256) { throw 'Installed payload differs from the verified installer manifest.' }
  $machine = if ($ExpectedArchitecture -eq 'arm64') { 0xaa64 } else { 0x8664 }
  if ((Get-PeMachine $executable) -ne $machine) { throw 'Installed executable architecture mismatch.' }
  $installedDlls = @(Get-ChildItem -LiteralPath $installDirectory -Filter '*.dll' -File)
  if (-not $manifest.payloadDlls.Count -or $installedDlls.Count -ne $manifest.payloadDlls.Count) { throw 'Installed DLL inventory differs from the manifest.' }
  foreach ($dll in $manifest.payloadDlls) {
    if ($dll.file -notmatch '^[A-Za-z0-9_.-]+\.dll$' -or $dll.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid DLL manifest entry.' }
    $file = Join-Path $installDirectory $dll.file
    if ((Get-PeMachine $file) -ne $machine -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $dll.sha256) { throw 'Installed DLL identity/architecture mismatch.' }
  }
  $registrations = @(Get-MeetSpaceRegistry)
  $entries = @($registrations | Where-Object { $_.kind -eq 'uninstall' })
  if (-not $entries.Count -or @($entries | Where-Object { $_.hive -ne 'CurrentUser' }).Count) { throw 'Expected per-user uninstall registration was not found.' }
  foreach ($entry in $entries) {
    if ($entry.uninstallString -notmatch '^"([^"]+)"(?:\s+/currentuser)?$') { throw 'Unexpected uninstaller command.' }
    $candidate = [IO.Path]::GetFullPath($Matches[1])
    if ([IO.Path]::GetDirectoryName($candidate) -ine $installDirectory -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'Uninstaller is outside the owned installation.' }
    if ($uninstaller -and $uninstaller -ine $candidate) { throw 'Conflicting uninstall registrations.' }
    $uninstaller = $candidate
  }
  $report.checks.install = $true
  $shortcuts = @(Get-MeetSpaceShortcuts)
  $userDesktop = [Environment]::GetFolderPath('Desktop').TrimEnd('\') + '\'
  $userPrograms = [Environment]::GetFolderPath('Programs').TrimEnd('\') + '\'
  if (-not @($shortcuts | Where-Object { $_.FullName.StartsWith($userDesktop, [StringComparison]::OrdinalIgnoreCase) }).Count -or
      -not @($shortcuts | Where-Object { $_.FullName.StartsWith($userPrograms, [StringComparison]::OrdinalIgnoreCase) }).Count) {
    throw 'Current-user Desktop and Start Menu shortcuts were not both created.'
  }
  $wsh = New-Object -ComObject WScript.Shell
  try { foreach ($shortcut in $shortcuts) {
    if ($wsh.CreateShortcut($shortcut.FullName).TargetPath -ine $executable) { throw 'Shortcut does not target the installed executable.' }
  } } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wsh) }
  $report.checks.shortcuts = $true
  $arguments = if ($testBuild) { "--meetspace-desktop-acceptance=$nonce" } else { '' }
  $application = Start-OwnedProcess $executable $arguments
  if ($testBuild) {
    $ready = Wait-Json (Join-Path $runtimeRoot 'ready.json') $application
    if ($ready.pid -ne $application.Id -or $ready.sourceCommit -cne $manifest.sourceCommit -or $ready.version -cne $version -or $ready.testBuild -ne $true) { throw 'Runtime readiness identity mismatch.' }
  } else {
    # No debug switch or test entry is honored by release builds. Default data is confined to this disposable Windows account.
    $until = [DateTime]::UtcNow.AddSeconds(40)
    while ($application.MainWindowHandle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $until -and -not $application.HasExited) { Start-Sleep -Milliseconds 100; $application.Refresh() }
    if ($application.HasExited -or $application.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Signed application did not open its native window.' }
  }
  $actual = Get-ProcessMachine $application
  $report.processArchitecture = $actual.process
  $report.nativeArchitectureVerified = $actual.native -and $actual.os -eq $ExpectedArchitecture -and $actual.process -eq $ExpectedArchitecture
  if (-not $report.nativeArchitectureVerified) { throw 'Installed process uses emulation or the wrong native architecture.' }
  $report.checks.launch = $true
  $registrations = @(Get-MeetSpaceRegistry)
  $protocols = @($registrations | Where-Object { $_.kind -eq 'protocol' })
  $expectedCommand = '"' + $executable + '" "%1"'
  if (-not $protocols.Count -or @($protocols | Where-Object { $_.hive -ne 'CurrentUser' -or $_.command -ine $expectedCommand -or -not $_.urlProtocol }).Count) { throw 'Protocol registration does not bind only the installed executable and URL argument.' }
  $report.checks.noAutomaticStartup = @($registrations | Where-Object { $_.kind -eq 'startup' }).Count -eq 0
  $link = 'meetspace://open/meetings/33333333-3333-4333-8333-333333333333/join'
  $second = Start-OwnedProcess $executable (($arguments + ' ' + $link).Trim())
  Wait-Success $second 15000
  if ($testBuild) {
    $runtime = Wait-Json (Join-Path $runtimeRoot 'result.json') $application
    if ($runtime.pid -ne $application.Id -or $runtime.result -ne 'PASS' -or $runtime.sourceCommit -cne $manifest.sourceCommit -or
        $runtime.version -cne $version -or $runtime.processArchitecture -cne $ExpectedArchitecture -or $runtime.testBuild -ne $true) { throw 'Installed application acceptance failed or identity changed.' }
    $report.checks.sandboxBridgeCsp = $runtime.checks.sandbox -and $runtime.checks.bridge -and $runtime.checks.csp -and $runtime.checks.localApiDenied -and $runtime.checks.noServers
    $report.checks.singleInstance = $runtime.checks.singleInstance
    $report.checks.protocol = $runtime.checks.deepLinkDelivery
    $report.checks.noAutomaticStartup = $report.checks.noAutomaticStartup -and $runtime.checks.noAutomaticStartup
    Write-Utf8Json (Join-Path $evidenceRoot "runtime-$target.json") $runtime
    Wait-Success $application 15000
  } else {
    $report.checks.singleInstance = -not $application.HasExited
    $report.manualRequired = @('sandboxBridgeCsp','protocol route delivery','OS protocol ShellExecute','optional startup opt-in/opt-out','real devices and UI checklist')
    # This is only collection evidence, never an automatic signed-release PASS.
    $report.result = 'NOT_RUN'
  }
} catch {
  # Fixed errors contain no server/session information. Never dump process command lines or the entire environment.
  $report.failure = [string]$_.Exception.Message
  $report.result = 'FAIL'
} finally {
  if ($application -and -not $application.HasExited) {
    [void]$application.CloseMainWindow()
    if (-not $application.WaitForExit(3000)) { $application.Kill(); [void]$application.WaitForExit(10000) }
  }
  # Forced closure of a signed collection run can leave Chromium children. Stop only this owned executable path.
  if ($installed) {
    foreach ($remaining in @(Get-CimInstance Win32_Process -Filter "Name='MeetSpace.exe'")) {
      if ($remaining.ExecutablePath -and [string]$remaining.ExecutablePath -ieq $executable) {
        Stop-Process -Id $remaining.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
  }
  if ($installed -and $uninstaller) {
    try {
      # NSIS _?= keeps the original uninstaller process waitable; it must be last and unquoted.
      $remove = Start-OwnedProcess $uninstaller "/S /currentuser _?=$installDirectory"
      Wait-Success $remove 120000
      $report.checks.uninstall = -not (Test-Path -LiteralPath $executable) -and @(Get-MeetSpaceRegistry).Count -eq 0 -and @(Get-MeetSpaceShortcuts).Count -eq 0
      if (-not $report.checks.uninstall) { throw 'Owned install registrations or executable remained after uninstall.' }
    } catch { $report.cleanupFailure = [string]$_.Exception.Message; $report.result = 'FAIL' }
  }
  if ($testBuild -and -not $report.Contains('failure') -and @('install','launch','singleInstance','uninstall','sandboxBridgeCsp','protocol','shortcuts','noAutomaticStartup').Where({ -not $report.checks[$_] }).Count -eq 0) { $report.result = 'PASS' }
  $report.collectedAt = [DateTime]::UtcNow.ToString('o')
  Write-Utf8Json $reportFile $report
  (Get-FileHash -LiteralPath $reportFile -Algorithm SHA256).Hash.ToLowerInvariant() | Set-Content -LiteralPath ($reportFile + '.sha256') -Encoding ASCII
  # Only exact, newly-created nonce directories may be removed. Never remove normal application profiles.
  if ($report.checks.uninstall) {
    foreach ($directory in @($runtimeRoot, $ownedRoot)) {
      Assert-PlainDirectory $directory
      if ([IO.Path]::GetFileName($directory) -cne $nonce) { throw 'Cleanup ownership mismatch.' }
      Remove-Item -LiteralPath $directory -Recurse -Force
    }
  }
}
Write-Output ("Windows acceptance: " + $report.result + " (" + $target + ")")
if ($report.result -ne 'PASS') { exit 1 }
