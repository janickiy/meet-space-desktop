# Этап 06 — Windows installers, CI/CD и безопасные обновления

Обновлённая проверка текущих исходников и установщики 0.1.1-beta от
18 октября: [отдельный отчёт](06_WINDOWS_INSTALLERS_CURRENT.md).
Ниже сохранены исторические результаты 0.6.0 без переобозначения их версии.

Дата проверки: 2026-10-14. Выполнен только этап 06. Изменения этапов 01–05 сохранены; следующий этап не начат.

Текущий результат — **0.6.0-test**, unsigned NSIS installers для x64 и native ARM64, локально подготовленный Windows CI и проверяемый механизм signed updates. Пользователь подтвердил отсутствие publisher, сертификата, HTTPS update feed и Windows среды. Поэтому доверенный выпуск, реальная Windows приёмка и включение обновлений не выполнены. GitHub workflows не отправлялись и не запускались; публикации или развёртывания нет.

## Реализовано

1. NSIS per-user installer с иконкой, metadata/version, выбором каталога, uninstall и ярлыками. Elevation и автоматический запуск после установки выключены. Пользовательские данные сохраняются при uninstall. Автозапуск включается только явно в настройках установленного приложения. Versioned filename является документированным эквивалентом `MeetSpace-Setup-x64.exe` / `MeetSpace-Setup-arm64.exe`.
2. Два отдельных режима: тестовые `MeetSpace Test` / test appId, unsigned и update trust `{enabled:false}`; production candidate с отдельным appId, native Windows runner, чистыми committed исходниками, проверенной signing configuration и `forceCodeSigning:true`. Signed outputs изолированы по архитектурам. Private keys запрещены в checkout; PFX читается только из внешнего пути.
3. Exact source fingerprint, оба lockfile, source epoch и build host в provenance, совпадающие version/commit/time desktop и общего React renderer. Артефакт проверяется путём извлечения NSIS payload: PE machine EXE и каждой DLL, ASAR bytes, pinned pure-JS `ws`, отсутствие tests/src/native addons и неподтверждённых runtime dependencies. NSIS launcher может быть x86; архитектура установленного приложения определяется его payload.
4. Собственная лицензия приложения остаётся `UNLICENSED`, без выдуманного license grant. В установщик включены APP/TEST notices, полные third-party notices для 14 фактически установленных компонентов, license manifest с lock/hash и оригинальные Electron/Chromium материалы. Публикация требует отдельного подтверждения владельцем лицензии.
5. Три workflow: unsigned PR/push build x64/native ARM64; protected manual signed candidate; protected manual disposable Windows client acceptance. SHA actions закреплены, Node 24.19.0 и зависимости frozen, token read-only. PR/fork не получает signing environment, secrets или self-hosted acceptance. SBOM создаётся для production и полного build inventory обоих workspace. Настройка GitHub environments/reviewers остаётся за владельцем.
6. Main-owned updater в отдельной непостоянной network session: фиксированный HTTPS feed, Ed25519 signed manifest, architecture/appId/channel/version/expiry, SHA-512/size, точные certificate/publisher pins, действующая embedded Authenticode и timestamp. Redirect, downgrade, неподдерживаемая архитектура, повреждённые bytes и ошибка verifier блокируются. Metadata проверяется автоматически только в доверенной подписанной Windows сборке; download/install требуют явного действия. Renderer не задаёт URL, путь, executable или trust.
7. Preload v5 добавляет пять typed update операций без аргументов и ограниченные state events. Settings показывают disabled/checking/available/downloading/ready/error/installing. Установка явно предупреждает о завершении звонка и закрытии приложения. Завершение запуска установщика не выдаётся за успешное обновление; после NSIS нужен повторный запуск. Native cancel/dispose закрывает работу и убирает собственные partial files, не удаляя уже запущенный installer.
8. Production Electron fuses отключают RunAsNode/Node options/inspect и требуют embedded ASAR integrity и OnlyLoadAppFromAsar. Windows verifier проверяет фактические fuse bytes, signed PE integrity resource и совпадение ASAR header hash. Замена packaged trust в ASAR должна нарушать эту проверку. Реальное Windows исполнение этой защиты пока NOT_RUN.
9. Ограниченный installed-app diagnostic hook входит только в unsigned Windows test build. Он не принимает код/URL/путь, использует фиксированный временный каталог и одноразовый nonce. PowerShell acceptance helper проверяет fresh disposable account, OS client build, PE/DLL/native process, install/launch/single-instance/protocol registration/shortcuts/default startup/uninstall и сохраняет digest-bound evidence. Подписанный пакет исключает hook; unsigned evidence не может допустить signed release.
10. Offline release preparation сверяет source/config, оба signed installers и полную signed Windows матрицу до чтения Ed25519 key. Затем может подготовить локальный каталог `stable/win-{arch}/` с versioned EXE, checksums и signed `latest.json`. Скрипты ничего не публикуют. Неполная матрица, неверный hash, unsigned package или unconfigured trust блокируют выпуск.
11. NSIS даты временных файлов выключены, package mtimes нормализованы после EXE resource editing, copyright и compression inputs закреплены. Реальная проверка выявила гонку двух generated translation includes в builder 26.17.0: перестановка только этих includes воспроизвела оба разных installer SHA-256 точно, при одинаковом inner archive. Минимальное исправление устанавливает последовательную генерацию этих includes; точный upstream/patched hash и версия проверяются, неизвестный compiler блокируется. `builderPatch` входит в provenance. Обоснование и негативные тесты — в [отдельном документе](06_NSIS_REPRODUCIBILITY_FIX.md).

## Фактические проверки

Все исполняемые локальные проверки проведены на **macOS ARM64 / Electron 44.7.1 / Node 24.19.0**. Synthetic HTTPS/WebSocket fixtures и тестовые ключи не являются production trust. Рабочий сервер и пользовательские аккаунты в этапе 06 не использовались.

| Проверка | Результат | Практическое значение |
| --- | --- | --- |
| Desktop unit tests | PASS, 120/120 | Updater crypto/trust/lifecycle, release gates, deterministic compiler patch и regressions broker/media/files/notifications/security |
| Frontend foundation / media / assets | PASS, 19/19 + 11/11 + 8/8 | Typed bridge v5 и сохранение общих desktop/web contracts |
| Frontend lint + TypeScript + web build | PASS | Веб-версия собирается из общих исходников |
| Desktop TypeScript + renderer build | PASS | Полный локальный build |
| Actual Electron smoke | PASS | Sandbox/CSP/IPC, все пять disabled update operations, cache не создаётся |
| Actual shared product UI | PASS, 13 сценариев | Disabled status, явные download/cancel/install и signature-error UX; запуск installer заменён test seam |
| Actual Electron auth restart | PASS | SafeStorage, native HTTPS/WSS/SSE, server isolation и logout |
| Actual native shell | PASS | Tray, preferences/bounds/restart, single-instance deep link и quit cleanup |
| Actual native assets | PASS | HTTPS auth/TLS rejection, exact saved bytes, Range H.264/AAC, 36-second consumer pause/abort и отсутствие recording disk cache |
| PowerShell structure tests | PASS на portable PowerShell 7.6.7 macOS | Parser actual helper, UTF-8 JSON, x64/ARM64 PE reader и malformed header rejection; Win32 не выполнялся |
| Workflow YAML + verifier syntax | PASS | Локальная структурная проверка; GitHub jobs не запускались |
| npm runtime audit | PASS, 0 vulnerabilities в desktop и frontend | Результат registry audit на дату проверки; не заменяет security review Electron/Chromium |
| Unconfigured release CLI | EXPECTED REFUSAL, exit 1 | Без trust и полной матрицы нет release output или публикации |
| NSIS extraction / native binary verification | PASS, x64 и ARM64 | EXE и все 6 DLL каждой архитектуры, ASAR/provenance/licenses и disabled trust извлечены и сверены |
| Повторная сборка тех же исходников | PASS, обе архитектуры | После исправления две полные сборки дали идентичные installer, EXE и ASAR bytes на том же macOS ARM64 host |
| GitHub hosted CI | NOT_RUN | Workflows только локальные, нет push/dispatch |
| Реальный Authenticode / signed update install | NOT_RUN | Нет сертификата/feed/Windows; portable verifier tests используют process seam |

Отдельный тест криптографии создаёт настоящий Ed25519 keypair/envelope и проверяет roundtrip и отказ от подмены. Portable Authenticode tests проверяют разбор и ошибки процесса, а не подлинную Windows подпись. UI action seam проверяет прохождение кнопок через реальный preload; он не подтверждает установку NSIS. Локальные snapshots test entry могут показывать версию Electron host, тогда как packaged application metadata отдельно сверяется с 0.6.0.

## Windows support matrix

| Целевая система | Installer/payload | Реальный запуск / install / uninstall | Звонки, экран, устройства / updates |
| --- | --- | --- | --- |
| Windows 10 22H2 x64, build 19045 | PASS, x64 PE и DLL | NOT_RUN | NOT_RUN |
| Windows 11 x64, build 22000+ | Тот же x64 installer | NOT_RUN | NOT_RUN |
| Windows 11 ARM64 native, build 22000+ | PASS, ARM64 PE и DLL | NOT_RUN | NOT_RUN |

Полная поддержка **не подтверждена**. Cross-build и чтение PE не равны Windows runtime. `windows-2025` является build runner на Windows Server, не заменяет client acceptance. `windows-11-arm` предоставляет native ARM64 build; проверка физических устройств и системных сценариев остаётся отдельной. Windows 10 ARM64 и x86 вне объёма. Electron документирует Windows 10+ x64/ARM64 в [официальных исходниках версии 44.7.1](https://github.com/electron/electron/tree/v44.7.1); это заявленная upstream поддержка, не результат нашей приёмки.

## Изменённые файлы этапа 06

- Packaging/provenance: `desktop/package.json`, `package-lock.json`, `tsconfig.json`, оба `electron-builder*.cjs`, `scripts/build.mjs`, `build-context.mjs`, `package.mjs`, `normalize-package.cjs`, `prepare-builder.mjs`, `verify-artifacts.mjs`, `release.mjs`, `release-policy.mjs`, `sign-update-manifest.mjs` и resources notices/license manifest/NSIS include.
- Runtime/UI: `desktop/src/main.ts`, `preload.ts`, `updates.ts`, `updates-policy.ts`, `updates-signature.ts`, `acceptance.ts`; canonical `frontend/src/platform/desktop-contracts.d.ts`, adapter `desktop.ts`, `DesktopNativeSettings.tsx`, `DesktopUpdateSettings.tsx`, native settings CSS.
- CI/приёмка: `.github/workflows/desktop-build.yml`, `desktop-candidate.yml`, `desktop-acceptance.yml`; `desktop/scripts/ci/*`, `windows-acceptance.ps1`, license generator.
- Проверки: новые updater/policy/signature/build/source/license/acceptance tests, PowerShell structure tests; обновлённые bridge fixtures и реальный Electron smoke/product harness.
- Документация: этот отчёт, `desktop/README.md`, `scripts/ci/README.md`, `06_UPDATE_PROTOCOL.md`, `06_SIGNING_WINDOWS_ACCEPTANCE.md`.

Изменения предыдущих этапов уже присутствовали в рабочем каталоге. Они не сбрасывались; серверное исправление ICE из этапа 04 здесь не развёртывалось.

## Артефакты и воспроизводимость

| Установщик | Размер, bytes | SHA-256 |
| --- | ---: | --- |
| [MeetSpace-0.6.0-win-x64-test-setup.exe](../../desktop/artifacts/MeetSpace-0.6.0-win-x64-test-setup.exe) | 123889381 | `d15e8bcbc65ea84b2eb3c7086c50af871f3ee61fd7ff1c09fc622064f158d967` |
| [MeetSpace-0.6.0-win-arm64-test-setup.exe](../../desktop/artifacts/MeetSpace-0.6.0-win-arm64-test-setup.exe) | 118630227 | `53412be89a3dba1990d09fbdb314edaa0bb6175eab97bbe6647e6e65db277459` |

Для каждого EXE есть рядом `.sha256` и `.json` с SHA-512, source/provenance, native DLL и license hashes. Общий [SHA256SUMS](../../desktop/artifacts/MeetSpace-0.6.0-test-SHA256SUMS.txt). Оба пакета **unsigned**, `releaseMode:test`, `appId:com.janickiy.meetspace.desktop.test`, updates disabled.

Итоговый source fingerprint: `f5c25c19070fa7bcf7404b44be2b9f71b89f233b6d4e0930f3fca55a68a9c5c4`; HEAD `66e482c9701b6c13f58bc93aee8d9f5cf932dd34`; общий ASAR SHA-256 `62ada0361d3c0b52eb5b0acc1a94b7e2256f8e9c81eb5cb5ad8603288f16643f`. Source epoch `1791911263` / `2026-10-13T17:07:43Z`. Записанный compiler patch SHA-256 `12dd62260619425bd6bd981336db22ca2c04c62bc1219918ced7da053e3df455`.

Подтверждение: [local evidence](../../desktop/artifacts/stage06-local-evidence.json), [повторные сборки](../../desktop/artifacts/stage06-reproducibility.json), [причина первоначального расхождения](../../desktop/artifacts/stage06-nsis-order-investigation.json). Проверены две полные сборки одинаковых inputs на одном macOS ARM64 host; побайтовая идентичность между разными host OS/architectures и подписанными Windows выпусками не заявлена. Старые 0.2–0.5 EXE сохранены; unpacked staging предназначен для текущей сборки.

Исходники локально ещё не committed; `sourceDirty:true` явно сохраняется в manifests. HEAD сам по себе не описывает новый desktop код: exact `sourceTreeSha256` связывает артефакт с фактическими файлами. CI/signed build требует чистый checkout. `buildTime` задаётся source epoch и не является временем выполнения проверки; `collectedAt` в evidence содержит фактическую дату. Timestamped signatures не могут считаться детерминированными только из-за одинаковых исходников.

Первоначальное сравнение обнаружило ARM64 installer mismatch, хотя приложение и DLL совпали; исходный FAIL сохранён в `stage06-reproducibility-before-fix.json`. Причина затем подтверждена отдельной перекомпиляцией NSIS с единственным изменением порядка языковых includes. Итоговое сравнение после исправления приводится отдельно; прежний FAIL не выдаётся за прошедший тест.

## Оставшиеся шаги

Подготовить контролируемые Windows 10 x64, Windows 11 x64 и Windows 11 ARM64 среды и выполнить приёмку именно выданных installers. Когда владелец выберет лицензию, publisher, code-signing certificate/timestamp, отдельный HTTPS feed и manifest key, настроить protected environments и собрать signed candidates. Затем провести полную signed матрицу и реальное обновление между двумя подписанными версиями, проверить evidence и только после отдельного запроса опубликовать feed.

Инструкции: [Windows signing/acceptance](06_SIGNING_WINDOWS_ACCEPTANCE.md), [update protocol](06_UPDATE_PROTOCOL.md), [CI configuration](../../desktop/scripts/ci/README.md), [electron-builder v26 signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/), [NSIS v26](https://www.electron.build/v26/docs/nsis/).

В рамках этого запроса этап 07 не выполняется.
