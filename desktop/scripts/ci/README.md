# Windows CI и допуск к публикации

Workflows опубликованы в `.github/workflows`; результаты запусков проверяются в GitHub Actions. Готовые unsigned test installers Windows/Linux опубликованы через Git LFS в [каталоге дистрибутивов](../../../source/README.md). Рабочие результаты сборки остаются в `desktop/artifacts/`; в Git проверенные пакеты размещаются в `source/linux/<версия>/<формат>/` и `source/windows/<версия>/`. Для подписанного production-выпуска по-прежнему нужны сертификат, publisher, production feed и полная обязательная Windows-приёмка. Подписанный candidate и production-публикация остаются **NOT RUN / BLOCKED**; размещение тестовых пакетов не проходит этот release gate.

## Три отдельных процесса

| Workflow                 | Запуск                    | Результат и граница доверия                                                                                                                                                                                                                      |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `desktop-build.yml`      | PR, push в main, вручную  | Только unsigned test installers двух архитектур, точные source/lock hashes и npm SBOM. `contents: read`, без signing environment/secrets.                                                                                                        |
| `desktop-candidate.yml`  | Вручную на default branch | Только signed candidate. Protected environment `desktop-signing`, проверенная конфигурация, подпись и проверка installer + embedded EXE. Ничего не публикует.                                                                                    |
| `desktop-acceptance.yml` | Вручную на default branch | Устанавливает конкретный unsigned artifact в disposable Windows account, запускает и удаляет его. Проверяет GitHub run из `desktop-build.yml`: исходный репозиторий, default branch, точный текущий commit, успешный исход и доверенный trigger. |

Actions закреплены полными SHA официальных репозиториев; версии проверены 2026-10-14. Node закреплён на 24.19.0, устанавливается нативно для target architecture; используются оба lockfile и `npm ci`. Cache выключен. `core.autocrlf=false` сохраняет одинаковые source bytes между build runners. Self-hosted runner должен быть обновлён до версии, поддерживающей Node 24 actions; использовать актуальный runner, а не старую замороженную установку. [Официальная документация checkout](https://github.com/actions/checkout/blob/v7.0.1/README.md), [setup-node](https://github.com/actions/setup-node/blob/v7.1.0/README.md).

## Архитектуры и реальные Windows

Build matrix использует `windows-2025` для x64 и `windows-11-arm` для native ARM64. GitHub документирует оба labels; первый — Windows Server 2025, поэтому его результат **не является** проверкой Windows 10/11 desktop. Hosted ARM64 также не заменяет проверку микрофона, камеры, системных окон и энергосбережения на целевом устройстве. [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Runtime workflow требует отдельных интерактивных disposable runners с labels:

- `self-hosted, Windows, X64, meetspace-disposable, meetspace-win10-22h2` — Windows 10 22H2, build 19045.
- `self-hosted, Windows, X64, meetspace-disposable, meetspace-win11` — Windows 11 x64, build 22000+.
- `self-hosted, Windows, ARM64, meetspace-disposable, meetspace-win11-arm64` — Windows 11 ARM64, native ARM64 процесс.

Не назначать эти labels личной машине или runner с данными пользователя. Account должен быть чистым, временным, с интерактивным рабочим столом; script отказывается работать при найденной предыдущей установке, профиле, protocol/startup/shortcuts. Пересоздавать VM/account после job, даже при успешном uninstall. Runner group ограничить этим репозиторием и workflow, environment `desktop-windows-acceptance` — default branch и ручным review. PR никогда не запускает self-hosted job. `IsWow64Process2`, PE и DLL checks отделяют native ARM64 от x64 emulation; ProductType=1 отделяет Windows client от Server. Подробнее: `desktop/scripts/windows-acceptance.ps1` и Windows acceptance document.

## Воспроизводимые входы

`source-inputs.mjs` записывает HEAD, dirty flag и SHA-256 точных байтов всех исходных файлов `frontend/`, `desktop/`, `.github/workflows/`, найденных Git (включая ещё не committed файлы локального test build). Symlinks запрещены; обязательны оба lockfile. CI и signed build требуют чистый committed checkout. Игнорируемые `node_modules` и dist, а также весь каталог `desktop/artifacts/` не входят в fingerprint. Готовые пакеты в artifacts отслеживаются через Git LFS; промежуточные результаты сборок и QA остаются игнорируемыми. Итоговая sourceTreeSha256 — hash упорядоченного списка path/size/hash. Генерируемые tracked ресурсы должны быть закоммичены в точном виде.

`collect-build-evidence.mjs` повторно проверяет неизменность исходников, native Windows/architecture, записывает Node/npm, runner image и run id. CycloneDX inventories создаются для npm production dependencies и всех зависимостей обоих workspace. Electron объявлен devDependency, но поставляется как runtime: он отражён в полном desktop inventory; npm SBOM сам по себе не является полным перечнем встроенных Chromium/native компонентов. Их notices входят в продуктовые third-party материалы.

Проверяются pinned inputs и происхождение каждого artifact. Побайтовая воспроизводимость подписанного NSIS не заявлена: timestamping, toolchain image и упаковка могут менять байты. Каждый installer имеет собственные size, SHA-256, SHA-512 и embedded payload/ASAR/DLL metadata. NSIS launcher бывает x86: реальную архитектуру подтверждает извлечённый Electron EXE и DLL, а не название файла.

## Подготовка signed candidate владельцем

До включения environment требуется подтвердить лицензию приложения, выбрать точный Subject publisher, сертификат code signing и HTTPS timestamp server, отдельный HTTPS feed и Ed25519 manifest public key. Секреты запрещены в backend настройках, renderer storage и исходниках. Trust release встроен в пакет и не берётся с выбранного пользователем MeetSpace сервера.

В protected `desktop-signing` environment задать `DESKTOP_RELEASE_CONFIG_JSON` (не секрет):

```json
{
  "schemaVersion": 1,
  "licenseReviewed": true,
  "signing": {
    "mode": "pfx",
    "certificateSha1": "UPPERCASE_40_HEX_FROM_ACTUAL_CERTIFICATE",
    "timestampUrl": "https://REVIEWED_TIMESTAMP_SERVICE/"
  },
  "updateTrust": {
    "schemaVersion": 1,
    "enabled": true,
    "appId": "com.janickiy.meetspace.desktop",
    "channel": "stable",
    "feedBaseUrl": "https://REVIEWED_FEED_DIRECTORY/",
    "publisherNames": ["CN=ACTUAL_FULL_CERTIFICATE_SUBJECT"],
    "signingCertThumbprints": ["UPPERCASE_40_HEX_FROM_ACTUAL_CERTIFICATE"],
    "manifestPublicKeys": ["ACTUAL_ED25519_PUBLIC_KEY_PEM"]
  }
}
```

Это иллюстрация формата, **не действующая конфигурация**: placeholders отвергаются валидатором. Для PFX нужны environment secrets `DESKTOP_SIGNING_PFX_BASE64` и `DESKTOP_SIGNING_PFX_PASSWORD`; PFX временно создаётся вне checkout и удаляется в `finally`. Для `mode=store` нужен Windows signing runner, где выбранный сертификат доступен в certificate store; на обычном чистом hosted runner он отсутствует. Не хранить ключ в репозитории. Все секреты доступны только шагу подписи после проверок; environment reviewers должны проверять доверенный исходный commit. Repository/environment branch rules и required reviewers являются настройкой GitHub владельца, YAML не может их сам обеспечить. [Рекомендации GitHub по защите workflows](https://docs.github.com/en/actions/reference/security/secure-use).

## Почему signed candidate ещё не release

`release-policy.mjs` экспортирует `validateReleaseConfig`, `releaseConfigSha256`, `validateReleaseReadiness(report,{artifactRoot,config,now})`. Последний независимо читает фактические installers и требует:

- clean sourceCommit/sourceTreeSha256, одинаковые для x64 и ARM64, и digest отдельно переданной reviewed configuration;
- два production installers с точными filename/size/SHA-256/SHA-512, native payload machine, production appId, releaseMode=release;
- результаты **фактического** Windows Authenticode verifier для installer и payload: Valid, Authenticode, разрешённые publisher/certificate, присутствующий timestamp; одна лишь certificate table не принимается;
- фактические hardened Electron fuses и подписанный `INTEGRITY/ELECTRONASAR` PE resource, чей SHA-256 совпадает с заголовком поставленного `app.asar`; подпись одного EXE без защиты ASAR не достаточна;
- три signed Windows client acceptance reports не старше 30 дней, совпадающие с installer SHA-256/version/sourceCommit, с native OS/process architecture и всеми обязательными checks.

Автоматический unsigned diagnostic report содержит `testBuild:true` и **никогда не удовлетворяет** этому gate. Signed package исключает test-only diagnostic hook; его автоматический отчёт честно оставляет renderer/UI/OS ShellExecute проверки незавершёнными. Для signed readiness нужны отдельно проведённые и сохранённые witnessed проверки, включая `protocolShellLaunch` и `manualProductAcceptance`, а не простая замена false на true. Структура нормализованного readiness report определена в policy и его unit fixtures; это схема данных, не доказательство выполненного тестирования.

JSON отчёты сами по себе не криптографическая аттестация. Приёмщик должен получить их из доверенных protected jobs/контролируемого Windows теста, сохранить исходные файлы и проверить происхождение; произвольный загруженный report не даёт права на публикацию. SHA-256 связывает отчёт с конкретным installer, но не удостоверяет автора отчёта.

После успешного gate `sign-update-manifest.mjs` создаёт manifest **локально**, только затем читает отдельный Ed25519 private key вне checkout. Он сверяет private/public key и подписывает payload ровно того installer, который прошёл gate. Формат и команда описаны в `docs/desktop/06_UPDATE_PROTOCOL.md`. Неподписанный test artifact, другой hash/arch/version или незавершённая Windows матрица блокируют чтение signing key.

Feed разделён по архитектурам: `stable/win-x64/latest.json` и `stable/win-arm64/latest.json`, рядом соответствующий production installer. Общее `latest.yml` не используется. После отдельного разрешения на публикацию владелец сначала размещает installer с неизменным именем, проверяет hash, затем атомарно заменяет manifest только нужной архитектуры. Автоматической публикации, dispatch или активации feed в этом изменении нет. Пока сертификат, Windows evidence и feed отсутствуют, встроенный update trust остаётся `{ "enabled": false }`.

Опубликованные установщики в `desktop/artifacts/` исключены из исходного fingerprint и проверки чистоты source checkout. Полный бинарный файл Git LFS и его pointer дают одну идентичность исходников; пересборка пакетов не меняет source digest. Lock-файлы и все остальные исходники продолжают проверяться.
