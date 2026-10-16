# Pinned NSIS language-order repair

The first Stage 06 repeated ARM64 packaging comparison failed even though the exact application source, ASAR, Electron EXE and DLL bytes matched. Changing only the order of the two generated NSIS language includes reproduced both complete installer hashes exactly:

| Declaration order | Installer bytes | SHA-256 |
| --- | ---: | --- |
| `messages.yml`, then `assistedMessages.yml` | 118630246 | `7f9016f9ce24e0544b6d8a1fdfdfb23291b59ce51a9f0f5161af93550aed2b15` |
| `assistedMessages.yml`, then `messages.yml` | 118630322 | `6817beb33e7bf4bfa607c87d7abeaa9fd451490688b595dd23e2c0f96de663fd` |

This investigation ran the installed builder 26.17.0 and cached NSIS 3.0.4.1 compiler in a private temporary directory. It reused the identical extracted application archive and reconstructed the builder's actual definitions, options and script. Only the generated translation include order changed. No application was installed or executed. The compiler also produced different uninstallers because NSIS assigns declaration-dependent string-table offsets. The result rules out payload compression as the cause of this recorded mismatch. The initial failed comparison is retained as historical evidence.

`app-builder-lib/out/targets/nsis/NsisTarget.js` starts both language-generation promises concurrently and each appends its include after asynchronous reading/writing completes. `desktop/scripts/prepare-builder.mjs` changes exactly those two calls to sequential `await` calls, in the original declared order: main messages first, assisted-installer messages second. Every translation, compression option, plugin, installer script, architecture and signing step is unchanged. Other queued helper work still completes through the existing task manager. Language-generation errors reject the build immediately.

The helper accepts only package version **26.17.0** and these exact whole-file SHA-256 values:

- Upstream: `fa6d32306dc6eb12d656c4c821aad691f0efa47508df100ef046364d409c521f`
- Patched: `12dd62260619425bd6bd981336db22ca2c04c62bc1219918ced7da053e3df455`

Unknown versions or byte changes stop packaging; this is not a best-effort text patch. The build applies the tracked transform atomically to the installed development dependency before loading the builder and records `builderPatch` in provenance. Repeated preparation is idempotent. `readBuilderEvidence()` never modifies files and rejects an unprepared installation, allowing artifact verification to compare the actual installed tool to its recorded evidence. `npm ci` restores the upstream dependency; the next reviewed build reapplies the same guarded change. A dependency upgrade requires source review, new exact hashes and renewed reproducibility evidence.

Focused tests execute the actual pinned method body using its real task manager, language configuration and script emitter, with controlled filesystem/network seams. They reproduce reversed includes in upstream, verify the fixed order, reject unknown versions/tampering, check idempotence and verify read-only evidence behavior. These portable tests do not establish Windows installation, code-signing or cross-host reproducibility. Signed installers also contain external timestamp-service data; byte identity of signed releases is not claimed.
