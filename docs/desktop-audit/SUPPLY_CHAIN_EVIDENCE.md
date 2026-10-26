# Зависимости, CI и целостность выпуска

Дата проверки: 26 октября 2026. Исходная точка: commit `0edb345`, MeetSpace `0.1.11-beta`. Проверен общий Electron-клиент Windows/Linux. Этот документ дополняет основной security/test report; не заменяет приёмку готовых пакетов на целевых ОС.

## Выполненные проверки и воспроизводимость

Локальные машинные результаты: `desktop/artifacts/audit-20261026/supply-chain/` (каталог игнорируется Git). Проверки запускались на macOS ARM64. npm запускался из установленного Codex runtime, без `--force`, без изменения frontend lockfile.

| Проверка | Исходный результат | После минимального исправления |
| --- | --- | --- |
| `cd frontend && npm audit --json` | PASS, 0 advisory | Frontend не изменялся |
| `cd desktop && npm audit --json` | FAIL: 2 High, 1 Moderate, 0 Critical; 3 имён пакетов | PASS, 0 advisory |
| `cd desktop && npm audit --omit=dev --json` | PASS, 0 advisory | Не заменяет полный audit: Electron находится в devDependencies, но поставляется пользователю |
| Проверка installed/locked versions | Ни одного несовпадения установленных пакетов | Electron, оба Undici и fast-uri совпадают с новым lockfile |
| `node --test desktop/tests/licenses.test.cjs` | PASS, 3/3 | PASS, повторно вместе с CI policy |
| `node --test desktop/tests/licenses.test.cjs desktop/tests/ci-run-policy.test.cjs` | — | PASS, 4/4, skip 0 |
| Heuristic secret scan tracked text | 808 файлов, 13 совпадений в отрицательных тестах/фикстурах; подтверждённых секретов в проверенных файлах нет | Исходные результаты сохранены без значений секретов |
| Сопоставление SHA Actions с официальными tags | PASS, все четыре совпадают | Версии Actions не менялись |
| `git diff --check` для dependency/CI patch | — | PASS |

Файлы доказательств: `frontend-audit.json`, `desktop-audit.json`, `desktop-prod-audit.json`, `desktop-after-audit.json`, `lock-inventory.json`, `after-versions.json`, `after-runtime-versions.json`, `license-inventory.json`, `license-tests.tap`, `after-policy-tests.tap`, `secret-scan.json`.

В исходных lockfiles: frontend — 78 записей зависимостей, 35 установленных совпадают, 43 отсутствуют; desktop — 312 записей, 293 установленных совпадают, 19 отсутствуют. Отсутствующие записи — platform/optional packages, а не произвольно удалённые runtime-зависимости. Все resolved tarballs в обоих lockfiles используют `https://registry.npmjs.org`; все имеют integrity. Lockfile не доказывает добросовестность самого издателя зависимости.

## Подтверждённые findings и исправления

### SC-01 — High: Electron без блокировки скомпрометированного промежуточного CA

Исходные `desktop/package.json:62` и `desktop/package-lock.json` закрепляли Electron **44.7.1**. Advisory **GHSA-jr5w-w6x2-84p9** затрагивает ветку 44 до **44.9.1**. Атакующий с сертификатом, выданным скомпрометированным промежуточным CA, и возможностью перехвата сети может выдать свой TLS endpoint за доверенный. Затронуты Windows и Linux; `rejectUnauthorized: true` не заменяет актуальный trust blocklist. Upstream не предлагает обходного исправления на уровне приложения. [Electron advisory](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9).

После снятия исходных измерений закреплён **Electron 44.9.3**, без перехода на другую major-ветку. Минимально исправляющая версия — 44.9.1; 44.9.3 дополнительно содержит backports безопасности из ANGLE, Chromium, PDFium, Skia и V8. [44.9.1](https://releases.electronjs.org/release/v44.9.1), [44.9.3](https://releases.electronjs.org/release/v44.9.3).

Верификация: package/lock/installed metadata совпали, полный npm audit после изменения чист. Это закрывает конкретный advisory, но не является сертификатом отсутствия всех уязвимостей embedded runtime. Изменение требует повторных Electron/runtime и native-platform проверок, перечисленных в основном test report. Обнаруженный точный gate Linux screen capture в `desktop/src/platform/display-capture.ts` передан отдельному владельцу: его нельзя просто ослабить при смене Electron.

### SC-02 — High: уязвимые HTTP-клиенты в инструментах сборки

Подтверждённые пути исходного lockfile:

- `electron → @electron/get → undici 7.30.0`;
- `electron-builder 26.17.0 → app-builder-lib → @electron/rebuild → node-gyp → undici 6.29.0`.

**GHSA-xjj6-f33q-929c**: специально сформированный ответ с цепочкой Content-Encoding может вызвать необработанную ошибку процесса. Для этих веток исправления — **7.30.1** и **6.29.1**. Другие advisory в audit: **GHSA-4qv8-2p9j-2685** (EventSource memory) и **GHSA-f72v-6w45-q472** (SRI). Это зависимости install/build tools, не дополнительные JavaScript-пакеты внутри production ASAR. [Undici advisory](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c).

Обновлены только две lockfile-записи в совместимых диапазонах; electron-builder сохранён на 26.17.0, новые overrides не введены. Верификация: реальные installed versions совпадают, advisory исчезли из полного npm audit. Атака на сторонние registry/серверы не проводилась.

### SC-03 — Moderate: fast-uri в build/schema closure

Путь: `electron-builder → app-builder-lib → ajv → fast-uri 3.1.8`. **GHSA-w74x-v6f9-j3xg** описывает неоднозначную обработку percent-encoded scheme; audit также перечислял host/scheme/path parsing advisory. Исправлено обновлением до **3.1.9** в существующем диапазоне `^3.0.1`. Сетевая эксплуатация через пользовательский renderer MeetSpace не подтверждена: это closure build/schema tooling. [fast-uri advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg).

### SC-04 — High upstream / ограниченная локальная поверхность: старый Node CI

Все четыре workflow использовали Node **24.19.0**. Отдельный Node **24.22.1** — официальный security release от 21 октября, включающий исправления TLS, DNS, Brotli и Undici 7.30.1. Пять `node-version` pins обновлены до **24.22.1**, текущая инструкция `desktop/scripts/ci/README.md` синхронизирована. Старые отчёты с фактически измеренным Node 24.19.0 не переписывались. Это обновляет будущий CI runtime; локальный host Node и исторические CI runs таким изменением не обновляются. [Node 24.22.1](https://nodejs.org/en/blog/release/v24.22.1).

### SC-05 — остаточный риск embedded Node, не покрываемый npm audit

Electron 44.9.3 официально встраивает **Node 24.22.0**, Chromium **152.0.7977.167**. Node 24.22.0 содержит Undici **7.29.1**, а не новый npm-пакет Undici из MeetSpace lockfile. Electron Node patch list содержит отдельную блокировку скомпрометированных публичных ключей, но не показывает backport всех исправлений следующего Node security release. [Electron DEPS](https://raw.githubusercontent.com/electron/electron/v44.9.3/DEPS), [Node dependency metadata](https://raw.githubusercontent.com/nodejs/node/v24.22.0/deps/undici/src/package.json), [Electron patches](https://raw.githubusercontent.com/electron/electron/v44.9.3/patches/node/.patches).

После штатной загрузки Electron binary реальные `process.versions` запущенного локального executable подтвердили все четыре версии. Результат сохранён в `after-runtime-versions.json`; это запуск в режиме Node, не проверка GUI/media или Linux/Windows совместимости.

Требуют сопоставления с использованием API: CVE-2026-105482 (DNS NUL), CVE-2026-105483/CVE-2026-106069/CVE-2026-106072 (необычные IP в TLS), CVE-2026-111497 (Brotli), CVE-2026-105481 (HTTP reuse), Undici advisory из SC-02. [Официальный Node security bulletin](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

Первичный source review ограничивает поверхность: HTTP broker и updater созданы через Chromium `net.request` (`desktop/src/main.ts:500`, `:522`); Node HTTPS transport — внедряемый helper для тестовых CA; в production main не найден сетевой Node `fetch`/`EventSource` или Node Brotli decode. WSS использует Node `ws` и TLS, поэтому проверка canonical URL/hostname остаётся обязательной и передана в основной security audit. Наличие уязвимого upstream-компонента нельзя объявить отсутствующим из-за чистого npm audit; подтверждённого exploit path приложения в этой дополнительной проверке нет. При доступности нового Electron с исправленным Node требуется повторная проверка, без произвольного major upgrade сейчас.

Независимый security review и probe реального Electron подтвердили canonicalization необычных IPv4 до transport/TLS identity и отклонение NUL; прямой exploit path не подтверждён. Это не доказывает безопасность всех внутренних Node Agent/runtime вариантов. Подробности: [Встроенный Node: остаточная уязвимая версия и достижимость](DESKTOP_SECURITY_AUDIT.md#встроенный-node-остаточная-уязвимая-версия-и-достижимость).

## Лицензии и секреты

Read-only вызов существующего `collectLicenseComponents` проверил реальные полные LICENSE/NOTICE тексты для **19** installed компонентов production closure/renderer helper. С дополнительным vendored Nayuki QR — **20**, столько же в существующем manifest; отсутствующих компонентов нет. Полученные метки: MIT, BSD-3-Clause, ISC, OFL-1.1, Unlicense и SEE LICENSE TEXT. Electron/Chromium notices поставляются отдельно. Генератор сохраняет SHA-256 текстов и обоих lockfiles; после dependency patch новые notices генерируются обычным build, а не ручной подменой контрольных сумм. Проверка состава и текста лицензий не является юридическим одобрением распространения proprietary branding: release policy по-прежнему требует `licenseReviewed`.

Secret scan был ограничен tracked working-tree UTF-8 текстом до 5 MiB. Проверялись формы GitHub/AWS/Slack токенов, PEM private key headers и URL с credentials. 98 binary/non-UTF8/крупных файлов пропущены; Git history и бинарные установщики не анализировались этой проверкой. Все 13 совпадений проверены как test fixtures: 12 URL с фиктивными credentials для rejection-тестов и один невалидный `UI-KEY-FIXTURE` вместо реального PEM key. Значения в evidence не сохранены. Нельзя расширять этот результат до утверждения «секретов нет во всём Git history/всех старых пакетах».

## CI, provenance и политика публикации

Все `uses` закреплены полными SHA; read-only `git ls-remote` подтвердил текущие официальные tags:

| Action | Tag | SHA |
| --- | --- | --- |
| actions/checkout | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| actions/upload-artifact | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| actions/download-artifact | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` |

- `contents: read`, checkout `persist-credentials: false`, оба lockfile через `npm ci`, cache выключен. Native architecture фиксируется build matrix и проверяется в процессе.
- PR/test jobs не получают signing environment. Signed candidate допускается вручную с default branch через `desktop-signing`; ключ ограничен signing step и удаляется в `finally`.
- Acceptance проверяет source workflow/run/commit/репозиторий/trigger перед загрузкой artifact (`desktop/scripts/ci/verify-run.mjs`). Self-hosted Windows acceptance предназначен для disposable client VM, не для произвольного fork job.
- Source input hashes, build provenance и CycloneDX inventory предусмотрены. Hash связывает байты, но самостоятельно не удостоверяет автора; это явно отражено в release policy.
- Workflow definitions не доказывают, что GitHub environment reviewers/runner protections действительно настроены. Это не было проверено через GitHub administration API.
- Остаточная воспроизводимость: Fedora CI использует изменяемый `fedora:44`, сохраняя фактический image inspection. Digest pin отсутствует. Полученная RPM container-проверка не подтверждает Fedora Workstation GUI/Wayland/media.
- В workflow пока отсутствуют обязательный полный dependency audit и secret scan. Рекомендуется добавить fail/report policy отдельно, чтобы новые advisories не ожидали ручного аудита. Текущие pinned Actions не обновлялись ради необязательной смены версий.

## Пакеты, signing и обновления

Windows test NSIS: `asInvoker`, per-user, `allowElevation: false`, `runAfterFinish: false`, отдельная test identity и `publish: null` (`desktop/electron-builder.config.cjs:37`). Неподписанный тестовый пакет не выдаётся за production signed installer.

Linux DEB/RPM/AppImage используют отдельную конфигурацию и native packaging driver (`desktop/electron-builder.linux.config.cjs:6`). Установка DEB/RPM системным менеджером требует root, само приложение запускается обычным пользователем. Postinstall проверяет ownership/path/symlink/hardlink прежде, чем выставить SUID только Chromium sandbox; запрещён обход `--no-sandbox`. AppImage использует фиксированный проверяемый runtime; на Ubuntu с AppArmor нужны разрешения для точного пользовательского пути. Автоматическое обновление Linux отключено.

Windows updater (`desktop/src/updates.ts`, `updates-policy.ts`, `updates-signature.ts`) выключен без отдельного build-time trust. Backend profiles не могут менять feed. Проверяются HTTPS без redirect, стабильная версия, архитектура, Ed25519 manifest, срок действия, отсутствие rollback, точные имя/размер/SHA-512. Installer и текущий executable требуют Windows Authenticode с разрешённой identity; подпись повторно проверяется перед запуском. Нет unattended download/install либо elevation helper. Linux и beta/test build не активируют production feed.

Release gate (`desktop/scripts/release-policy.mjs`) требует два native payload, одинаковые reviewed source inputs, реальные подписи и клиентскую Windows acceptance. Полученные JSON receipts не являются криптографической аттестацией сами по себе. В этом аудите signed release, upload, push, публикация и включение auto-update **не выполнялись**.

## Совместимость ОС: договор и доказательства

Официальный README закреплённого Electron указывает Windows 10+ x64/ARM64 и Linux x64/ARM64. Это upstream contract, не наша сертификация Windows 10 22H2 или конкретного Linux desktop. [Electron 44.9.3 README](https://github.com/electron/electron/blob/v44.9.3/README.md). Политика поддержки Electron требует актуального minor поддерживаемой major-ветки. [Electron timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).

Наш DEB объявляет `libc6 >= 2.35`; verifier читает ELF version requirements и отвергает GLIBC выше 2.35, неправильную архитектуру и Electron bytes, не совпадающие с закреплённым дистрибутивом (`desktop/scripts/verify-linux-artifacts.mjs`). Это проверяемая политика, а не основание считать свежий runtime уже совместимым со всеми target distributions. После Electron update необходима повторная проверка **новых** ELF/artifacts. Ubuntu 22.04/24.04, Debian 12/13, Mint 22, Fedora Workstation, Windows 10/11 x64/ARM64 получают PASS только по фактически выполненным тестам в основном отчёте; прежние пакеты и macOS запуск не заменяют матрицу.

## Дополнительная native-проверка Ubuntu ARM64

26 октября 2026 выполнены две изолированные сборки и runtime-проверки в UTM: Ubuntu 24.04.5 LTS ARM64, kernel `6.8.0-147-generic`, 4 vCPU, 8,304,300,032 bytes RAM. Использованы настоящий ARM64 Electron **44.9.3**, Chromium **152.0.7977.167**, встроенный Node **24.22.0**. Внешний build/test Node в VM — **24.19.0**, поэтому эта проверка не подтверждает выполнение CI под обновлённым Node 24.22.1. Установленный MeetSpace 0.1.11-beta, его профиль, системная связка Login и Dock пользователя не изменялись.

Исходники переносились точными байтами `sourceInputs` поверх shallow local clone того же HEAD; LFS-дистрибутивы не скачивались. Frontend dependencies переиспользованы только после побайтового сравнения lockfile; desktop dependencies каждый раз получены через `npm ci --no-fund --no-audit`. AppImage собирался штатной командой `node scripts/package-linux.mjs arm64 --formats AppImage`. HEAD `0edb3451cb90d402eb81979115373a3de7fddf8d`, `sourceDirty: true`; это внутренние audit-кандидаты, не публичный релиз.

| Snapshot | Source SHA-256 | AppImage SHA-256 | Результат |
| --- | --- | --- | --- |
| Initial, до исправления подготовки runtime | `9b373d498d09d74cb8b2a7b468f7415569c93c7e4ae23e4b48cb39233b89fef5` | `87e0ae537792cf4d649f995bb12e6330c3ac28abb83c74ce8107bc61af275c39` | Первый package FAIL; после отдельного bootstrap Electron build, package acceptance и lifecycle PASS |
| Final, 464 source inputs, после packaging/harness fixes | `056f3f41ce5a6f3f6979187cc4775c7502bfe87dc78726a27b4193bf41f31d48` | `7f37edee9dac271920e1051a9eb598d3d61a1ec16c78671d3566f6de2c77556a` | Чистый `npm ci` → штатный build/verifier → original AppImage acceptance → lifecycle PASS |

**Подтверждённый дефект и исправление.** После чистого `npm ci` Electron 44 не создавал `node_modules/electron/dist/chrome-sandbox` до ленивой загрузки runtime. electron-builder загружал свою копию, но verifier не находил локальный эталон и завершался `ENOENT`. Новый `desktop/scripts/prepare-linux-electron.mjs`, вызванный из `package-linux.mjs` перед build, явно запускает vendored installer для закреплённых Linux/arch с bundled checksums и проверяет версию/ELF architecture. Final native повтор подтвердил отсутствие `dist` и `path.txt` после `npm ci` и успешное завершение package **без ручного `require('electron')`**. Verifier остаётся read-only. Это дополнено 33 PASS packaging/regression tests в `desktop/artifacts/desktop-audit-20261026/security/linux-package-reference-tests.tap`.

Final AppImage имеет размер **119,391,532 bytes**. Статическая проверка подтвердила AArch64 ELF, соответствие pinned Electron bytes, provenance, update-disabled identity и лицензии. Максимальное обнаруженное GLIBC requirement самого Electron — `GLIBC_2.25`, остальных исследованных native компонентов — не выше установленного gate `2.35`. Это не проверка запуска на всех дистрибутивах. Native artifact находится только в VM: `/home/meetspace/releases/desktop-audit-20261026/source/desktop/artifacts/linux/AppImage/0.1.11-beta/056f3f41ce5a6f3f6979187cc4775c7502bfe87dc78726a27b4193bf41f31d48/arm64/MeetSpace-0.1.11-beta-linux-arm64-test.AppImage`.

**Фактический runtime.** Тест запускал исходный AppImage через FUSE, без распаковки payload для имитации запуска, обычным пользователем meetspace в отдельном Xvfb/X11, D-Bus и временном HOME/XDG. Для keyring использовался настоящий `gnome-keyring-daemon` с отдельной volatile session collection, назначенной default только на тестовой шине. `secureStorage.available=true`, backend `gnome-libsecret`. Создавалось временное AppArmor-разрешение `userns` лишь для двух точных audit paths. Глобальное `kernel.apparmor_restrict_unprivileged_userns=1` не менялось, `--no-sandbox` не использовался. AppImage runner подтвердил packaged ASAR/main/preload/shared React, `sandbox=true`, `contextIsolation=true`, `nodeIntegration=false`, отключённый updater, opt-in autostart в отдельном XDG, реальный `gio` second-instance, opt-out, штатный exit 0 и удаление собственного профиля (**PASS**, 1.53 s).

После этого `stage07-profile-runner.cjs after --visible` на final snapshot завершил **PASS за 61.56 s**: 10 warmup и 100 циклов открытия/закрытия реального React personal chat, ещё 100 typed IPC WSS/SSE open/close, synthetic suspend/resume, настоящий renderer crash/reload и переключение сервера. Транспорт направлен только в disposable parent-process HTTPS/WSS/SSE fixture; сообщения реальным пользователям не отправлялись. Собственные maps/listeners/socket/stream/timer counts возвращались к warmup; дополнительных chat reconnects — 0.

| Final runtime measurement | Warmup | Settled |
| --- | ---: | ---: |
| Main V8 used heap, bytes | 9,686,648 | 10,226,952 |
| Renderer used heap, bytes | 5,127,972 | 6,127,276 |
| DOM nodes / documents | 839 / 4 | 839 / 4 |
| DOM JS listeners | 236 | 237 |
| Process FD sum, 5 processes | 237 | 234 |
| Threads sum | 89 | 88 |
| Process RSS sum, KiB | 654,812 | 684,336 |

RSS sum учитывает shared pages несколько раз и не равен PSS. Измеренный heap прирост не равен доказанной утечке, но bounded run также не доказывает отсутствие долгосрочных утечек. Idle sample 5 s: main 0.8%, renderer 1.2% одного ядра, остальные 0%; main event-loop delay p95 25.49 ms, max 29.67 ms. Инструментированный mapped Xvfb renderer: 3,202 frames, 2 интервала >50 ms, max 133.4 ms, long tasks 0. В эти измерения входят forced GC, heap capture и software rendering; это не физическая плавность GUI и не uninstrumented latency SLO. Instrumented cached start → connection screen 201.92 ms не является cold boot. Сохранены четыре heap snapshots и renderer CPU profile.

**Сохранённые неудачи и cleanup.** Initial package `ENOENT` сохранён в `initial/build.log`. Первая попытка private session не имела подходящего keyring/default alias: AppImage acceptance прошёл с явно unavailable storage, lifecycle остановился на `Profile: login screen`. Вторая попытка заблокировалась на keyring prompt, package runner записал `bounded_inspector_timeout`, собственная группа теста была остановлена. Это ошибки настройки audit session, не PASS обычного пользовательского окружения. После финального успешного запуска обнаружен осиротевший Electron PID 73066 именно от этой ранней попытки; после проверки exact command/startTicks он завершён SIGTERM. Первоначальный cleanup receipt сохранён, новый подтверждает отсутствие собственных живых процессов, временных AppArmor profiles/file; global userns restriction остаётся 1. Пользовательские процессы не завершались.

Основная директория локальных доказательств — `desktop/artifacts/audit-20261026/linux-arm64/`:

- `final/summary.json` — краткий machine-readable итог; `final/final-build-status.json`, `final/final-source-inputs.json`, `final/final-clean-install-observation.json`, `final/final-build.log` — точная final сборка.
- `final/evidence-final/original-appimage.json`, `final/evidence-final/runtime-summary.json` и `final/evidence-final/lifecycle-after/stage07-profile-after.json` — actual runtime и измерения; snapshots/CPU profile рядом.
- `final/source/desktop/artifacts/linux/AppImage/0.1.11-beta/056f3f41ce5a6f3f6979187cc4775c7502bfe87dc78726a27b4193bf41f31d48/arm64/linux-artifact-verification.json` — static verifier receipt.
- `final/final-cleanup-verification.json`, `final/prior-harness-reap.json`, `final/post-cleanup-verification.json` — до/после точечной уборки старого audit процесса.
- `initial/` — исходный snapshot, build failures и отдельные failed/successful runtime attempts. `orchestration/` — использованные VM wrappers; `evidence-sha256.json` — hashes локального evidence. Ключи/пользовательские данные в архив не включались.

Final evidence archive SHA-256: `6522df096d85839ade2119ed333475ba235d09bd62edd2f9e4bf3ed6c6a1e71b` (12,493,857 bytes); последующие cleanup receipts лежат отдельно и входят в evidence index. Не проверялись обычная пользовательская Ubuntu session/визуальный интерфейс, реальный login, Wayland/PipeWire/portal, аппаратные camera/mic/speaker, physical sleep/wake/GPU, x64 Linux, DEB/RPM installation, Fedora Workstation и Windows. Эта дополнительная проверка не устанавливает приложение, не повышает версию, не публикует пакеты и не меняет эти пункты общей матрицы на PASS.
