$ErrorActionPreference = 'Stop'
# OpenSSL is used only by isolated local HTTPS fixtures. Do not install arbitrary
# packages or relax TLS when a runner image lacks this test prerequisite.
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
  foreach ($directory in @('C:\Program Files\Git\usr\bin', 'C:\Program Files\OpenSSL\bin')) {
    if (Test-Path -LiteralPath (Join-Path $directory 'openssl.exe') -PathType Leaf) {
      $env:PATH = $directory + [IO.Path]::PathSeparator + $env:PATH
      $directory | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
      break
    }
  }
}
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) { throw 'This runner must supply OpenSSL for the HTTPS fixtures.' }
& openssl version
if ($LASTEXITCODE) { throw 'OpenSSL fixture prerequisite failed.' }
