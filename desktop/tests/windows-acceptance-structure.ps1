#requires -Version 5.1
# Cross-platform parser/PE-reader tests only: no installer, registry or Windows API is executed.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path $PSScriptRoot '..\scripts\windows-acceptance.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { $errors | ForEach-Object { Write-Error $_.ToString() }; throw 'Acceptance script syntax failed.' }
foreach ($name in @('Get-PeMachine','Write-Utf8Json')) {
  $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $function) { throw 'Pure helper function is missing.' }
  # Load only pure helpers from our checked-in source, not the acceptance entry point.
  Invoke-Expression $function.Extent.Text
}
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('meetspace-pe-reader-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($temporary)
try {
  $jsonFile = Join-Path $temporary 'evidence.json'
  $label = [string][char]0x041c
  Write-Utf8Json $jsonFile @{ schemaVersion=1; label=$label }
  $jsonBytes = [IO.File]::ReadAllBytes($jsonFile)
  if ($jsonBytes[0] -ne [byte][char]'{') { throw 'Evidence JSON must start with JSON, without a BOM.' }
  if (([IO.File]::ReadAllText($jsonFile, [Text.Encoding]::UTF8) | ConvertFrom-Json).label -cne $label) { throw 'Evidence JSON Unicode roundtrip failed.' }
  foreach ($machine in @(0x8664, 0xaa64)) {
    $data = New-Object byte[] 256
    [BitConverter]::GetBytes([UInt16]0x5a4d).CopyTo($data,0)
    [BitConverter]::GetBytes([UInt32]128).CopyTo($data,0x3c)
    [BitConverter]::GetBytes([UInt32]0x00004550).CopyTo($data,128)
    [BitConverter]::GetBytes([UInt16]$machine).CopyTo($data,132)
    $file = Join-Path $temporary 'fixture.exe'
    [IO.File]::WriteAllBytes($file,$data)
    if ((Get-PeMachine $file) -ne $machine) { throw 'Native architecture field was misread.' }
    foreach ($corruption in @('dos','offset','signature')) {
      $invalid = [byte[]]$data.Clone()
      switch ($corruption) {
        'dos' { $invalid[0] = 0 }
        'offset' { [BitConverter]::GetBytes([UInt32]4000).CopyTo($invalid,0x3c) }
        'signature' { $invalid[128] = 0 }
      }
      [IO.File]::WriteAllBytes($file,$invalid)
      $rejected = $false
      try { [void](Get-PeMachine $file) } catch { $rejected = $true }
      if (-not $rejected) { throw 'Malformed PE fixture was accepted.' }
    }
  }
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
Write-Output 'PASS: PowerShell syntax, BOM-free UTF-8 evidence and x64/ARM64 PE reader with malformed-header rejection. Windows installer/runtime checks NOT_RUN.'
