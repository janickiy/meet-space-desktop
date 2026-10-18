# Windows Installer, обновления и CI/CD — текущие исходники

Дата: 18 октября 2026. Версия приложения: **0.1.1-beta**.

Результат: актуальные unsigned NSIS установщики x64/ARM64 собраны и проверены;
существующие release/update/CI механизмы проверены на текущих исходниках.
Приёмка установки в Windows и доверенного выпуска остаётся частичной.

## Область и аудит перед работой

В прямом запросе указан Windows Installer. Во вложении указан Linux этап 05;
для уточнения платформы задан отдельный вопрос. До получения ответа эта
проверка следует прямому указанию Windows. Linux пакеты не создавались.

Общий Electron/React/TypeScript проект сохранён. Исходный checkout dirty,
HEAD `963cc020460f3177823a790eda36ea967c44ddb3`. Изменения предыдущих этапов
не сбрасывались, версия не менялась. Точная сборка описана 384 файлами:
`97f478eea481240f12adaa1558f81864679cde9b2e14209b4b4c89499939ba62`.

Аудит обнаружил уже существующие компоненты:

- `desktop/scripts/package.mjs` и два builder config: unsigned per-user NSIS
  с отдельным test appId; signed candidate только на native Windows runner.
- `verify-artifacts.mjs`: извлечение фактического NSIS payload, PE/DLL,
  ASAR, provenance, resources/licenses и runtime dependency policy.
- `NativeUpdates`: main-owned HTTPS transport, Ed25519 manifest, hash/size,
  версия/архитектура/expiry и реальный Authenticode verifier.
- Три Windows workflow: unsigned build; protected manual signed candidate;
  protected disposable Windows acceptance. Автоматической публикации нет.

План до сборки: сохранить прежние установщики, пересобрать обе архитектуры,
проверить извлечённое содержимое и существующие update/CI gates; проверить
готовность UTM для установки и отдельно записать ограничения. Изменять
работающий механизм выпуска без выявленной ошибки не потребовалось.

## Выполнено

Оба установщика собраны из текущих исходников на macOS ARM64 / Node 24.19.0 /
Electron 44.7.1 / electron-builder 26.17.0. Это cross-build. Проверены EXE и
все шесть DLL каждой архитектуры, одинаковый общий ASAR, точные source bytes,
лицензионные материалы, исключение исходников/тестов и неподтверждённых
native addons. Сохранены SHA-256, SHA-512 и JSON manifests.

Прежние установщики с тем же номером версии сохранены до сборки в
`desktop/artifacts/windows-stage06-20261018/prior-artifacts/` по их SHA-256.
Новые проверенные копии сохранены в отдельном каталоге
`verified-artifacts/<sourceTreeSha256>/<arch>/` с отказом при несовпадающей
повторной записи; это архив этой проверки, не новая гарантия поведения CLI.
Обычные пути `desktop/artifacts/MeetSpace-…` по-прежнему обновляются сборкой.

| Артефакт | Размер, bytes | SHA-256 |
| --- | ---: | --- |
| `MeetSpace-0.1.1-beta-win-x64-test-setup.exe` | 124115926 | `64ee38f9a1f1e394be6df93838dd5c090948ac8e3f90a59dd290643d682adac7` |
| `MeetSpace-0.1.1-beta-win-arm64-test-setup.exe` | 118856798 | `1def0912a2ab4cce04cb859473d264b0f2df09ca7a2d5e9b28b099e904e1c3b8` |

Оба файла unsigned, appId `com.janickiy.meetspace.desktop.test`,
buildVersion `0.1.1-beta-test`, `sourceDirty:true`. Общий ASAR SHA-256:
`ff5f1c133bf126421a924aca9f7ab1b499c02eddcbc4f40f2d6eef31a128da5f`.
Версия в названии и provenance сохранена без повышения.

## Обновления и CI/CD

В обоих пакетах update trust `{enabled:false}`. Включать его без выбранных
издателя, сертификата, timestamp service, HTTPS feed и manifest key нельзя.
Такие данные ранее не были предоставлены. Stable signed release также
требует stable version и clean committed checkout; текущая beta/dirty сборка
ему не соответствует. Эти ограничения не ослаблялись.

Проверены реальные Ed25519/hash операции и локальный TLS transport с отказом
от подмены/rollback/redirect и неполной release readiness. Authenticode и
запуск установщика в portable тестах используют process seams: настоящая
Windows подпись и обновление между двумя подписанными версиями NOT RUN.

Закреплённые SHA четырёх Actions сверены с официальными Git tags;
`action.yml` используют Node 24. Имена native Windows runners подтверждены
[документацией GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Сохраняются read-only token, отсутствие secrets у PR/fork, запрет брать
артефакты другого workflow/commit и protected manual signing/acceptance.
В YAML указаны signing/acceptance environments; их реальные required
reviewers и branch rules в GitHub не проверялись и требуют настройки
владельцем. Ссылка на environment сама по себе не доказывает такую защиту.
Workflow конфигурации уже существовали, в этой проверке не переписывались.
GitHub jobs, commit, push, dispatch, публикация и развёртывание не выполнялись.

## Фактические проверки

Evidence: `desktop/artifacts/windows-stage06-20261018/`.

| Проверка | Результат | Граница |
| --- | --- | --- |
| `package.mjs all` | PASS, actual exit 0 | Два unsigned cross-build; извлечение payload не равно установке |
| Release/update/CI/build/license/acceptance tests | 29/29 PASS, fail 0, skip 0, actual exit 0 | Node 24.19.0 macOS ARM64, test inputs до/после совпадают |
| Portable PowerShell structure | PASS, actual exit 0 | Реальный parser, UTF-8, x64/ARM64 PE reader и malformed rejection; Win32/PS5.1 не выполнялись |
| Action SHA/tag identity | 4/4 PASS | Проверены официальные repository bytes; GitHub jobs не запускались |
| Готовность Windows UTM для canonical installer acceptance | BLOCKED_EXISTING_USER_AND_MACHINE_STATE | Read-only проверка; ни install, ни uninstall не запускались |

Основные receipts: `verified-artifacts.json`, `package.log`,
`focused-tests.json`, `focused-tests.log`, `powershell-structure.json`,
`workflow-identities.json`, `readiness-summary.json`.

В предыдущем этапе действительно прошёл Windows 11 ARM64 interactive smoke
общего NativeShell и production React (source f7 с production bytes текущего
97). Он не подтверждает установку новых EXE; manifests новых установщиков
корректно сохраняют `windowsRuntimeTested:false`.

## Windows UTM и оставшиеся проверки

Read-only проверка Windows 11 ARM64 build 26100 обнаружила MeetSpace Test
**0.7.1**, установленный для всех пользователей, общие ярлыки, регистрацию
`meetspace:` и существующий профиль `meetspace-desktop`. Активны Edge и
OneDrive. Доступна только существующая учётная запись владельца.

`windows-acceptance.ps1` специально отказывается менять такое состояние.
Его условия preflight проверены по исходникам; сам скрипт в этой VM
не запускался, поэтому фактический negative run не заявляется.
Новая учётная запись сама по себе не устранит общесистемную установку.
Для install/upgrade/uninstall нужна отдельная чистая disposable Windows VM.
Проверка не удаляла прежнее приложение, не меняла аккаунты, registry,
ярлыки, профиль, startup или ExecutionPolicy; VM оставлена работающей.
Нумерация продукта ранее сброшена пользователем на 0.1.x; установленная
старая 0.7.1 относится к прежней последовательности. Переход 0.7.1→0.1.1
не проверен; обход защиты от downgrade не включался.

| Цель | Payload | Установка / обновление / удаление новых EXE |
| --- | --- | --- |
| Windows 10 22H2 x64 | PASS, native PE x64 | NOT RUN: среды нет |
| Windows 11 x64 | PASS, тот же x64 payload | NOT RUN: среды нет |
| Windows 11 ARM64 | PASS, native PE ARM64 | NOT RUN: существующая пользовательская установка |

Также NOT RUN: подпись, SmartScreen reputation, signed update install,
полная визуальная приёмка установленного приложения, физические устройства
и фактический GitHub CI. Новый Linux этап 06, deb/rpm/AppImage и Linux CI
не входят в выполненную Windows проверку и не объявляются готовыми.

Исторические результаты 0.6.0 от 14 октября остаются в
[исходном отчёте](06_INSTALLERS_CI_RELEASE.md). Они не заменены результатами
текущей 0.1.1-beta. Следующий этап автоматически не начат.
