# Signed Windows update protocol

The Stage 06 test application contains `{ "enabled": false }` in its packaged `dist/update-trust.json`. It makes no update requests and cannot download or launch an update. Signing keys, publisher identity, a production feed and real Windows acceptance evidence have not been supplied. This document describes the implemented, gated release path; it is not evidence that a signed Windows update has been exercised.

The update service reads build-time trust only. Server profiles, login responses, the renderer, URL parameters and runtime environment variables cannot replace its feed or keys. An enabled configuration has exactly these fields:

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "appId": "com.janickiy.meetspace.desktop",
  "channel": "stable",
  "feedBaseUrl": "https://updates.example.invalid/meetspace/",
  "publisherNames": ["CN=Exact complete Windows certificate Subject, O=Publisher, C=XX"],
  "signingCertThumbprints": ["UPPERCASE_40_HEX_CERTIFICATE_THUMBPRINT"],
  "manifestPublicKeys": ["PEM-ENCODED ED25519 PUBLIC KEY"]
}
```

The example is deliberately invalid placeholder data. Use only a reviewed real publisher and feed. The HTTPS URL must be canonical, end in `/`, and contain no credentials, query, fragment or encoded path. Each trust array contains one to four distinct entries. Publisher matching uses the complete Subject reported by Windows, plus the pinned certificate thumbprint; a matching common name alone is insufficient. Key rotation requires a release that embeds both old and new trust anchors before using the new key exclusively.

Each architecture has an independent endpoint: `stable/win-x64/latest.json` or `stable/win-arm64/latest.json`, relative to the fixed base. An envelope has exactly `schemaVersion: 1`, `keyId`, `payload` and `signature`. `keyId` is lower-case SHA-256 hex of the Ed25519 public key's SPKI DER bytes. `payload` is canonical standard base64 of UTF-8 JSON. `signature` is standard base64 of the 64-byte Ed25519 signature over those exact decoded payload bytes. Unknown keys, noncanonical base64, extra fields, invalid signatures and oversized envelopes fail closed before an installer request.

The signed payload's field order is fixed:

```json
{"schemaVersion":1,"appId":"com.janickiy.meetspace.desktop","channel":"stable","arch":"x64","version":"1.0.0","publishedAt":"2026-10-14T00:00:00Z","expiresAt":"2026-10-20T00:00:00Z","installer":{"file":"MeetSpace-1.0.0-win-x64-setup.exe","size":123456789,"sha512":"BASE64_SHA512_OF_COMPLETE_SIGNED_INSTALLER"}}
```

All fields, including timestamps, architecture, filename, size and SHA-512, are signed. Versions contain exactly three nonnegative integers, each at most 65535; prereleases and downgrades are rejected. A manifest can live for at most seven days and cannot be issued more than five minutes in the future. The installer basename is fixed by version and architecture; no absolute URLs, paths or redirects are accepted. Installers are limited to 2 GiB. The signed manifest binds an architecture to exact bytes. Because an NSIS launcher is not itself a reliable indicator of its embedded application's architecture, release validation must inspect the embedded payload and verify the required real Windows matrix before signing this manifest.

An enabled updater additionally requires a packaged, supported Windows application and a valid Authenticode signature on the running executable. Windows must report `Valid`, an embedded `Authenticode` signature, the exact requested path, the configured publisher and certificate thumbprint, and a timestamp certificate. Missing PowerShell, malformed output, timeout, verification failure or unsupported platform disables updates. The verifier runs a fixed encoded command without a shell or profile; paths are passed as literal data. It resolves PowerShell from the validated absolute OS-provided `SystemRoot`, not `PATH`. This assumes a trusted local launch environment; resistance to a malicious replacement of the OS directory or its verifier is not claimed. No error path skips verification.

The application may check metadata at startup and every six hours after these gates pass. Download and installation each require an explicit UI action. Download refreshes the signed metadata, streams to a private temporary file, verifies exact size and SHA-512, and validates Authenticode before reporting `ready`. Installation refreshes metadata again and rechecks the cached bytes and signature before starting the exact local NSIS executable with `--updated --force-run`. There is no elevation or shell fallback, automatic install, or silent `/S` flag. The main application then follows its orderly quit path. No cached update is executed automatically after a restart.

Cancellation and shutdown abort pending network/file work and remove owned incomplete files. Startup removes abandoned owned update files. State events expose only fixed status codes, versions and bounded progress, never feed URLs, file paths, certificate details or raw errors. Existing backend credentials are never used for update requests. HTTPS, redirect rejection and backpressure use the same strict native transport as other main-owned requests, in an isolated network session.

`desktop/scripts/sign-update-manifest.mjs` creates an envelope locally. It first validates the independently reviewed release configuration, both actual artifact hashes, signature reports and exact-artifact Windows acceptance evidence using `release-policy.mjs`. It then checks the payload against that report and reads an external Ed25519 private key whose public key is already trusted. It rejects keys within the repository and never publishes. Upload the validated installer first and promote its manifest only after the release gates have passed. Replacing the default trust file alone does not constitute release approval or Windows validation.

The implementation deliberately does not use electron-updater 6.8.10: inspection found permissive fallback paths for missing publisher metadata and unavailable PowerShell JSON support. The application-owned verifier has no such fallback. The default electron.build website currently describes unreleased v27 signed-manifest features; they were not assumed to exist in the pinned builder 26.17.0. Primary references: [electron-updater 6.8.10 package](https://www.npmjs.com/package/electron-updater/v/6.8.10), [current signed-manifest documentation and version notice](https://www.electron.build/docs/features/signed-update-manifests/), [Microsoft Get-AuthenticodeSignature](https://learn.microsoft.com/powershell/module/microsoft.powershell.security/get-authenticodesignature), [timestamp certificate property](https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.signature.timestampercertificate).
