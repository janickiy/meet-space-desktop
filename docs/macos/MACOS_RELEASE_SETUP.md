# Настройка выпуска macOS в CI

Этот документ описывает подготовленный процесс. Добавление YAML не запускает GitHub Actions и не настраивает environment protection. Локально отсутствуют Developer ID и рабочий канал обновлений, поэтому текущие DMG — тестовые; подписанный выпуск не принят.

## Два независимых workflow

`desktop-macos-build.yml` собирает unsigned DMG при PR, push в main и вручную. У job только `contents: read`, checkout не сохраняет credentials, signing secrets отсутствуют. Используется frozen `npm ci` в обоих workspace, общие проверки, отдельная native-матрица и immutable каталоги артефактов.

`desktop-macos-candidate.yml` запускается только вручную из default branch и использует environment **`desktop-macos-signing`**. Владелец GitHub-репозитория должен настроить required reviewers, запрет self-review и deployment branch rules только для default branch. Это нельзя обеспечить одним условием YAML. Jobs не публикуют GitHub Release, DMG, feed или новую версию на лендинг. Успешная подпись и нотариализация создают candidate; приёмка установки, обновления и нативной матрицы остаётся отдельным gate. [Защита environments GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

В обоих workflow официальные runner labels зафиксированы как **`macos-15-intel` для x64** и **`macos-15` для ARM64**. `macos-latest` намеренно не используется. Доступность labels сверена с GitHub Docs и `actions/runner-images` 28 октября 2026 года. Доступ к hosted runners и расход минут зависят от аккаунта. Это конфигурация будущего CI, не результат уже выполненных jobs. [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [исходники runner images](https://github.com/actions/runner-images).

`collect-macos-build-evidence.mjs` проверяет фактические `process.platform/arch`, `uname`, hardware ARM64 и отсутствие Rosetta; отдельно читает Mach-O установленного Electron. Cross-build на ARM64 не принимается за native Intel. Он сравнивает clean source commit/fingerprint до и после сборки, записывает macOS build, Xcode, Node/npm/Electron/builder, runner image и четыре CycloneDX dependency inventory. SBOM npm не является полным перечнем встроенных Chromium/Apple компонентов; notices включаются в продукт отдельно.

После упаковки jobs независимо перечитывают `SHA256SUMS` и запускают `macos-dmg-lifecycle.mjs --disposable`. Эта проверка монтирует DMG read-only и копирует, заменяет, повторно устанавливает и удаляет `.app` только в своём временном каталоге; отдельный sentinel настроек должен сохраниться. Она не использует настоящую `/Applications`, Launch Services, существующий профиль, системный автозапуск или запуск приложения. Реальное обновление между версиями, Gatekeeper с quarantine, native runtime и сохранение данных реального аккаунта этим не подтверждаются.

## Данные environment

В environment `desktop-macos-signing` задать не секретную variable **`MACOS_RELEASE_CONFIG_JSON`**. Схема определяется `desktop/scripts/macos-release-policy.mjs`; пример ниже содержит placeholders и не проходит выпускной gate:

```json
{
  "schemaVersion": 1,
  "licenseReviewed": true,
  "signing": {
    "teamId": "ACTUAL_TEAM_ID",
    "certificateSha1": "ACTUAL_UPPERCASE_40_HEX_CERTIFICATE_SHA1"
  },
  "notarization": {
    "keychainProfile": "MeetSpaceNotaryCI"
  },
  "updateTrust": {
    "schemaVersion": 1,
    "enabled": false
  }
}
```

Team ID и SHA-1 берутся из настоящего **Developer ID Application** сертификата. Это не Apple Development, Apple Distribution или Developer ID Installer. Приватные ключи, пароли, base64 сертификата и App Store Connect API key не включаются в JSON, исходники или backend-профиль. Для текущего подготовленного candidate требуется явная стабильная версия `x.y.z` в `desktop/package.json`; текущий `0.2.1-beta` не превращается в stable автоматически.

Environment secrets:

| Имя | Назначение |
| --- | --- |
| `MACOS_DEVELOPER_ID_P12_BASE64` | Экспорт Developer ID Application вместе с приватным ключом, PKCS#12 в base64 |
| `MACOS_DEVELOPER_ID_P12_PASSWORD` | Пароль экспорта PKCS#12 |
| `MACOS_NOTARY_API_KEY_P8_BASE64` | Приватный `.p8` App Store Connect API key в base64 |
| `MACOS_NOTARY_API_KEY_ID` | Key ID для нотариализации |
| `MACOS_NOTARY_API_ISSUER_ID` | Issuer ID для нотариализации |

Секреты доступны только шагу подписи после установки зависимостей и проверок source. Внутри шага создаётся временный keychain в `RUNNER_TEMP`; сертификат импортируется с доступом codesign, notarytool сохраняет API credentials в профиль `MeetSpaceNotaryCI` того же keychain. В packager передаются только путь keychain и reviewed config. Приватные переменные удаляются из среды до запуска упаковщика. `trap cleanup EXIT` удаляет временные keychain, PKCS#12 и `.p8`, включая ошибку. Эти пути не включаются в artifacts upload. Эфемерный hosted runner дополнительно уничтожается GitHub после job. Нельзя переносить job на личный shared runner с сохранёнными ключами без отдельного проектирования изоляции.

Коды возврата подписи, проверки Hardened Runtime/identity, notarytool Accepted, stapler и Gatekeeper обязательны. Отсутствующие credentials, approval, ошибки сети Apple, невалидный сертификат или отказ Gatekeeper должны остановить candidate; замена результата на unsigned не допускается. [Apple: notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [Electron: code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing).

## Артефакты и воспроизводимые входы

Входы фиксируются по точным байтам `frontend/`, `desktop/`, `.github/workflows/`, включая оба lockfile. `SOURCE_DATE_EPOCH` берётся из проверенного commit time, timezone — UTC. Изменение source после capture блокирует evidence. Повторный build не должен незаметно перезаписывать опубликованные байты:

```text
desktop/artifacts/macos/<version>/<sourceTreeSha256>/<arch>/<test|release>/
  MeetSpace-<version>-darwin-<arch>[-test].dmg
  SHA256SUMS
  macos-artifacts.json
```

Публикация проверяет имя, размер, фактическую архитектуру внутри `.app`, source provenance, подпись и digest. Равенство версии и имени файла не гарантирует равенство сборок. Исходники и dependency locks воспроизводимы; побайтовая идентичность подписанных/нотариализованных DMG **не заявляется**: timestamp, notary ticket, файловая система DMG и обновляемый runner image влияют на байты. Каждая фактическая сборка получает собственные checksums и отчёт. JSON и hash не удостоверяют автора сами по себе; получатель должен проверять происхождение artifacts из доверенного job.

В CI нельзя принимать architecture label, cross-build или Rosetta за пройденную клиентскую матрицу. macOS 15 Intel/ARM64, macOS 26 ARM64 и macOS 27 ARM64, реальные разрешения/устройства, сохранение данных при обновлении и Gatekeeper с quarantine требуют собственных результатов. Artifact retention для test job — 14 дней, candidate — 30 дней. Это сроки хранения CI, не политика канала обновлений.

## Обновления

Текущий reviewed config допускает только выключенный update trust. Упаковка DMG, подпись и нотариализация сами по себе не включают безопасную доставку обновлений. В общую Windows updater-политику не добавляются macOS ZIP/DMG как `.exe` и не принимается адрес выбранного backend как издатель обновлений. Для включения macOS updater необходимы отдельно reviewed HTTPS authority, постоянная подписанная identity, формат native update artifact/feed и проверка Squirrel/или выбранного installer пути, подписи, подмены, rollback и сохранения данных. До такой приёмки режим остаётся отключённым.

Существующие Windows и Linux workflows в этом этапе не редактируются. Новые jobs используют отдельные имена и output root. Доступность signing/notary и действительная успешность CI должны проверяться отдельным запуском владельца после коммита и настройки environment.
