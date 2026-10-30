# Этап 06 — DMG, подпись, нотариализация, CI/CD и обновления

Дата: **28 октября 2026 года**. Версия: **0.2.1-beta**. Продолжение [этапа 05](05_OS_INTEGRATION.md) в существующем Electron/React/TypeScript Desktop.

Подготовлены два проверенных **тестовых unsigned DMG**, сценарий подписанного кандидата и отдельные macOS workflows. Пользователь подтвердил отсутствие Developer ID и утверждённого канала обновлений и выбрал тестовые DMG. Настоящие подпись, нотариализация, положительная приёмка Gatekeeper и рабочий канал автообновления остаются открытыми. Это не публичный готовый релиз.

## Аудит и решения

В начале этапа `security find-identity -v -p codesigning` сообщил **0 valid identities**. `notarytool`, `stapler` и `hdiutil` доступны из Command Line Tools. Платформа — **macOS 27.2.0 Golden Gate ARM64**, Electron **44.9.3**, electron-builder **26.17.0**, Node **24.19.0**. Название macOS и ограничения матрицы зафиксированы в [этапе 01](01_ARCHITECTURE_AUDIT.md).

Существующий Mac driver создавал только unsigned `.app`. Windows имеет собственные Authenticode/update gates, Linux — свои пакеты и lifecycle. Они не заменялись общим Mac installer. `decs_maket` остаётся HTML/CSS/JS-макетом интерфейса; отдельного frontend или backend для упаковки не требуется.

План: сохранить прежние `.app` команды, добавить immutable DMG и readonly-проверку содержимого, выделить Mac signing policy, подготовить CI без автоматической публикации, проверить доступную часть lifecycle и явно оставить ненастроенный updater выключенным.

## Готовые DMG

| Цель | Файл | Размер |
| --- | --- | --- |
| Apple Silicon ARM64 | [MeetSpace-0.2.1-beta-darwin-arm64-test.dmg](../../desktop/artifacts/macos/0.2.1-beta/49e297ff4cbee96bf07cff65a0515eae159b7b3d28bdf055f15f935974e219c8/arm64/test/MeetSpace-0.2.1-beta-darwin-arm64-test.dmg) | 147 205 359 байт |
| Intel x64 | [MeetSpace-0.2.1-beta-darwin-x64-test.dmg](../../desktop/artifacts/macos/0.2.1-beta/49e297ff4cbee96bf07cff65a0515eae159b7b3d28bdf055f15f935974e219c8/x64/test/MeetSpace-0.2.1-beta-darwin-x64-test.dmg) | 152 287 125 байт |

Контрольные суммы SHA-256:

```text
518b23c2a871e9beddc630cec22c00cd01f3c6cfe76ace8397c7cda473cdb68a  MeetSpace-0.2.1-beta-darwin-arm64-test.dmg
170643b824ddf9b4a4b3e77a02c1aee144caa0e5f63a5e6703fe0ba1a0868cf3  MeetSpace-0.2.1-beta-darwin-x64-test.dmg
```

В каждом каталоге находятся `SHA256SUMS` и `macos-artifacts.json`: [ARM64 receipt](../../desktop/artifacts/macos/0.2.1-beta/49e297ff4cbee96bf07cff65a0515eae159b7b3d28bdf055f15f935974e219c8/arm64/test/macos-artifacts.json), [x64 receipt](../../desktop/artifacts/macos/0.2.1-beta/49e297ff4cbee96bf07cff65a0515eae159b7b3d28bdf055f15f935974e219c8/x64/test/macos-artifacts.json). Внутри образа — `MeetSpace.app`, ссылка `Applications` и инструкция. Существующий результат с той же версией/source hash/архитектурой/режимом не перезаписывается.

Оба образа прошли `hdiutil verify` и readonly mount. Проверены фактические thin Mach-O основного executable, framework и helpers, `.app` identity/version/минимальная macOS/Retina/privacy strings/URL scheme, ASAR относительно построенного payload и ссылка Applications. ASAR одинаков для двух архитектур: `b8b2d0e434246578ed9f137cd664cc3c21fdf4f2c0cd0680448118a7be714a25`.

Общий `sourceTreeSha256` — **`49e297ff4cbee96bf07cff65a0515eae159b7b3d28bdf055f15f935974e219c8`**; [source manifest](../../desktop/artifacts/macos-stage06/final-source-inputs.json). Режим `test`, `.test` bundle identity, `distributionReady:false`, `published:false`, `automaticUpdates:false`. Настоящий `spctl` assessment выполнен для обоих DMG и вернул **accepted:false**. Это ожидаемое ограничение unsigned-образов, не положительная Gatekeeper-приёмка. Защита macOS не отключалась.

Логи сборки: [ARM64](../../desktop/artifacts/macos-stage06/dmg-arm64-final.log), [x64](../../desktop/artifacts/macos-stage06/dmg-x64.log). Первоначальный [неуспешный прогон](../../desktop/artifacts/macos-stage06/dmg-arm64.log) и [диагностика](../../desktop/artifacts/macos-stage06/dmg-arm64-diagnostic.log) сохранены: mount path `/var/...` и возвращаемый macOS `/private/var/...` требовали канонического сравнения. После исправления оба образа проверены; флаг успешного mount устанавливается до разбора plist, чтобы ошибка разбора не оставляла подключённый образ.

## Подписанный кандидат

Добавлен отдельный `electron-builder.macos.release.config.cjs` и Mac release config, независимые от Windows. Сценарий требует чистые committed исходники, проверенные публичные параметры Team ID и SHA-1 сертификата Developer ID Application, проверку лицензии и имя notary keychain profile. Пример `resources/macos/release-config.example.json` намеренно содержит нерабочие значения и `licenseReviewed:false`.

Секреты не принимаются из renderer, профиля MeetSpace или URL сервера. CI использует secrets, временный keychain и удаляет P12/P8/keychain после работы. Непроверенная или отсутствующая конфигурация прекращает сценарий до подписи/загрузки. Инструкция и имена параметров: [MACOS_RELEASE_SETUP.md](MACOS_RELEASE_SETUP.md).

Подготовленный путь кандидата:

1. Чистый checkout, fixed dependency locks, source fingerprint, явная архитектура и Developer ID identity.
2. Подпись `.app` с **Hardened Runtime** и явными entitlements: JIT, камера, audio input. Исключения unsigned executable memory, disable library validation, get-task-allow и persistent screen capture не добавляются.
3. Production Electron fuses запрещают RunAsNode, NODE_OPTIONS/inspect и дополнительные file privileges; требуют ASAR integrity и загрузку только из ASAR. Проверяется фактическая fuse wire. В release удаляются test markers и acceptance hook.
4. Проверяются все физические Mach-O, включая dylibs/crashpad: thin architecture, подпись, exact leaf certificate SHA-1, Team ID и timestamp. Для main/helpers дополнительно Hardened Runtime и entitlements. Проверка ограничена по глубине/числу файлов и не следует symlink при обходе.
5. `.app` отправляется через `notarytool submit --wait`, принимается только `Accepted`, затем stapling, validation и Gatekeeper assessment. После этого создаётся DMG, подписывается, отдельно нотариализируется и проверяется.

Все эти gates реализованы, но **настоящая подписанная ветка не выполнялась**: сертификата и учётных данных Apple нет, checkout содержит изменения предыдущих этапов. Unit fixtures внешних tools не заменяют приёмку Developer ID/Apple service. Никаких ad-hoc/self-signed сертификатов вместо Developer ID не создавалось. [Electron signing requirements](https://www.electronjs.org/docs/latest/tutorial/code-signing), [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## CI/CD и воспроизводимость

Добавлены отдельные workflows:

- `.github/workflows/desktop-macos-build.yml`: test DMG без секретов для PR/push/manual; нативные x64 `macos-15-intel` и ARM64 `macos-15`.
- `.github/workflows/desktop-macos-candidate.yml`: только ручной запуск из default branch через protected environment `desktop-macos-signing`, explicit stable candidate version, ключи из CI secrets. Workflow сам ничего не публикует.

Runner labels проверены по официальной GitHub документации, action references закреплены полными SHA и сверены с официальными tags. Оба workflow прошли разбор YAML, **14 shell-блоков** — `bash -n`; 3 CI policy tests прошли. GitHub jobs в этом этапе **не запускались**; наличие workflow не является доказательством удалённой сборки. Настройка protected environment и secrets остаётся действием владельца репозитория. [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

CI проверяет Node/OS architecture, `uname`, sysctl Rosetta/hardware и Mach-O Electron, фиксирует toolchain, exact source до/после и четыре CycloneDX SBOM. Применяются `npm ci`, `SOURCE_DATE_EPOCH` из commit, source hash и checksums готовых файлов. Гарантируются проверяемые входы; **битовая воспроизводимость DMG, timestamped подписи и нотариализации не утверждается**. Образы/подписи содержат изменяемую служебную информацию Apple tools.

## Установка, замена и удаление

Для обеих архитектур выполнен ограниченный disposable file-copy lifecycle: readonly DMG → отдельная временная папка Applications → замена/reinstall → удаление только `.app`. SHA-256 ASAR сверяется на каждом шаге, sentinel тестовых пользовательских данных сохраняется. ARM64 replacement начинался с `.app` предыдущего этапа; содержимое заменено на новый payload той же версии.

Результаты: [ARM64 lifecycle](../../desktop/artifacts/macos-stage06/lifecycle-arm64.json), [x64 lifecycle](../../desktop/artifacts/macos-stage06/lifecycle-x64.json), оба **PASS**. Реальные `/Applications`, существующие пользовательские данные и Login Items не изменялись. Это проверка файлового lifecycle; **N → N+1 version upgrade, изменение Keychain/TCC и installed Launch Services не проверены**.

ARM64 `.app` скопирована непосредственно из readonly DMG в отдельную папку smoke-проверки и запущена через native UI. Видно onboarding `app://meetspace/`, версия `0.2.1-beta`, приложение завершается через ⌘Q. `sample` работающего процесса сообщил **Code Type: ARM64**, executable path сверен, Rosetta не использовалась: [native launch](../../desktop/artifacts/macos-stage06/dmg-arm64-smoke/native-launch.json). Локальный запуск без quarantine не является Gatekeeper acceptance скачанного релиза. Intel runtime, macOS 15/26 и полная клиентская матрица не проверены на этом Mac.

## Обновления

По подтверждённому решению пользователя автообновление **выключено**. Для macOS выделен отдельный `MacOSUpdates`, совместимый с IPC UI, но без вызова Windows installer и без автоматических сетевых запросов, таймеров, Squirrel download/install. Даже правдоподобная включённая trust config получает `update_macos_acceptance_required` и остаётся disabled. Release config этого этапа разрешает только `enabled:false`.

Подготовлена политика будущего канала: отдельный production app ID/Team ID, fixed HTTPS origin/path, Ed25519-подпись canonical manifest, архитектура ZIP, размер/digest, срок действия и запрет отката. Она покрыта тестами, но **не является работающим автообновлением**. Нужны утверждённые ключи/HTTPS feed, подписанный ZIP и проверка install/relaunch/rollback на подписанном приложении.

Причина отдельного этапа включения: Electron `autoUpdater.checkForUpdates` для Squirrel.Mac сразу скачивает и может применить обновление при следующем запуске. Его нельзя подставить под нынешние Windows metadata-only check/download/cancel без смены подтверждённой модели поведения. Пока UI macOS предлагает проверенный новый DMG и замену завершённого приложения с сохранением данных. [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater).

## Итог тестов и регрессия

| Проверка | Результат |
| --- | --- |
| Полная Desktop suite | **414 PASS, 0 FAIL, 1 SKIP** из 415; Linux GIO пропущен на Mac; [лог](../../desktop/artifacts/macos-stage06/desktop-tests-verified.log) |
| Frontend foundation | **30/30 PASS**; [лог](../../desktop/artifacts/macos-stage06/foundation.log) |
| Web / TypeScript build | **PASS**; [лог](../../desktop/artifacts/macos-stage06/web-build.log) |
| Desktop / shared renderer | **PASS** в обеих DMG-сборках; логи выше |
| DMG verification | ARM64/x64 **PASS**, hash/readonly payload/Mach-O/metadata |
| Disposable lifecycle | ARM64/x64 **PASS**, ограничения выше |
| Native launch | ARM64 **PASS**, Intel не запускался |
| Signing / notarization / CI execution / updater install | **Не выполнены**, prerequisites отсутствуют |

Новые тесты: 8 signing/release policy, 10 update gate/manifest, 3 CI policy, 3 DMG policy и 1 тест реальной fuse library с безопасным бинарным fixture. Signed tools/manifest fixtures не являются настоящей Apple acceptance.

Windows/Linux workflow/config/resources/lockfiles сверены с baseline и сохранены. Общий `build.mjs` выбирает Mac release policy только при `release + darwin`; Windows Authenticode policy остаётся отдельной. Общие tests покрывают Windows/Linux shell, startup, update trust, packaging и route/security логику. Настоящая Windows/Linux GUI regression в этом этапе не запускалась.

## Изменённые файлы

- `desktop/scripts/package-macos-dmg.mjs`, `macos-dmg-policy.mjs`, `package-macos.mjs`, `macos-package-policy.mjs`, `macos-builder-base.cjs`, `macos-fuses.cjs`, `build.mjs`; Mac builder configurations — DMG, source/payload verification и signing branch.
- `desktop/scripts/macos-release-policy.mjs`, `macos-signing.mjs`, `desktop/resources/macos/entitlements.*.plist`, `release-config.example.json` — политика подписи и нотариализации.
- `desktop/src/platform/macos-updates.ts`, `macos-updates-policy.ts`, `desktop/src/main.ts`, `frontend/src/components/desktop/DesktopUpdateSettings.tsx` — отдельный выключенный Mac updater и пояснения.
- Новые macOS workflow, `desktop/scripts/ci/collect-macos-build-evidence.mjs`, `macos-dmg-lifecycle.mjs` и соответствующие policy tests — CI/evidence/lifecycle.
- Новые `desktop/tests/macos-{dmg-policy,release-fuses,release-signing,ci-policy,updates,updates-policy}.test.cjs`, публичный certificate fixture — регрессионные проверки без приватных ключей.
- `desktop/package.json`, README и этот отчёт — команды и документация. Зависимости и lockfile не менялись.

Публикация, push, установка в реальные Applications и создание Apple credentials не выполнялись. Этап завершён в согласованном режиме тестовых DMG. **Работа остановлена перед этапом 7.**
