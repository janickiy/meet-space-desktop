# MeetSpace Desktop — исходное состояние и модель угроз

Дата аудита: 26 октября 2026 (Europe/Moscow). Исходная точка: `0edb345` (main), рабочее дерево до аудита чистое; версия обоих package.json — `0.1.11-beta`. Область — существующий общий Electron + React/TypeScript клиент Windows/Linux; backend не переносится в этот репозиторий.

## План, зафиксированный до изменений продукта

1. Инвентаризация main/preload/renderer, границ доверия, lockfiles, CI и имеющихся тестов.
2. Сборка исходного состояния; воспроизводимый профиль с отдельным аккаунтом локального HTTPS/WSS/SSE fixture, 10 прогревочных и 100 рабочих циклов чата, 100 открытий/закрытий WSS/SSE. Снимки heap после GC, карты ресурсов, DOM, CPU, FD.
3. Проверки media/Pion и Node lifecycle, security/IPC/TLS, функциональные сценарии и supply chain. Нативный Ubuntu ARM64 — отдельный тестовый профиль, без удаления установленного приложения и его данных.
4. Только подтверждённые дефекты: тест воспроизведения → минимальное исправление → те же проверки и повторные измерения. Новая архитектура и публичные API не вводятся.
5. Итоговые пять отчётов с точными границами проверок. Ни старый PASS, ни cross-build не являются подтверждением текущей ОС/сборки.

Первый профиль остановился до измерений: сценарий ожидал экран подключения, но теперь перед ним есть экран «Начнём с подключения». Это подтверждённое устаревание теста, не падение приложения. Отрицательный результат сохранён в `desktop/artifacts/desktop-audit-20261026/mac-baseline/`. Тестовый сценарий был обновлён до следующего baseline; продукт в этот момент не менялся.

## Среда

Хост: macOS 27.0.1 (26A434), ARM64, Apple M5 Pro, 18 логических CPU, 48 GiB RAM. Исходный Electron 44.7.1, Chromium 152.0.7977.149. Версии исполняемых Node/V8 фиксируются в результатах тестов. GPU/энергопотребление/физические устройства нельзя заключать из программного fixture.

Доступная Ubuntu UTM: Ubuntu 24.04.5 LTS, native aarch64, около 7.73 GiB RAM, 23 GiB свободного диска на старте. Пользовательский desktop сеанс открыт. Для компонентных тестов — отдельные Xvfb/DBus/keyring; он не подтверждает физический Wayland capture. Windows 11 ARM64 VM обнаружена, но выключена на старте. Остальные целевые ОС в свежем аудите пока не выполнены. Старые отчёты `docs/desktop/linux/07_FINAL_QA.md` учитываются только как история.

Сеть измерений: localhost HTTPS/WSS/SSE, тестовый CA; никакого отключения проверки TLS. Pion fixture привязан к backend commit `66e482c9701b6c13f58bc93aee8d9f5cf932dd34` через checksum-locked Go module (`desktop/tests/fixtures/pion-source-inputs.cjs`). Это не подтверждение текущего production backend. Рабочие серверы, реальные аккаунты и сообщения не используются.

## Архитектура и границы доверия

| Компонент | Код | Доверие / внешние входы |
|---|---|---|
| Electron entry/main | `desktop/src/entry.ts`, `main.ts` | Привилегированный процесс: жизненный цикл окна, IPC, permissions, ОС. CLI/deep links и IPC — недоверенные входы |
| Preload | `desktop/src/preload.ts`, `shared/contracts.ts` | Узкий typed bridge; renderer не получает Node, shell или произвольный доступ к файлам |
| Shared renderer | `frontend/src`, `frontend/src/platform/transport.ts` | React, содержимое backend/чатов и пользовательские файлы считаются недоверенными; локальный app:// protocol/CSP |
| Auth/network broker | `desktop/src/broker.ts`, `network/{policy,transport,ws-runtime}.ts` | Активный server profile, endpoint allowlist, HTTPS/WSS/SSE; abort и epoch при смене сервера |
| Persisted state | `server/profiles.ts`, `session/vault.ts`, `window-state.ts`, `platform/credential-store.ts` | Публичные профили/настройки на диске; сессии через native safeStorage, basic_text запрещён |
| Media | `frontend/src/media.ts`, `useMedia.ts`, `desktop/src/media-permissions.ts`, `platform/display-capture.ts` | Pion signaling/TURN/Chromium, permissions, выбор источника, Linux portal; жизненный цикл tracks/PC |
| Files | `desktop/src/downloads.ts`, `asset-policy.ts`, `protocol.ts` | Серверные IDs/URLs и filenames, диалоги, локальные назначения, лимиты и временные файлы |
| ОС | `native-shell.ts`, `native-notifications.ts`, `platform/{autostart,status-notifier}.ts` | Tray/уведомления, автозапуск, single-instance, power events, native dialogs |
| SSH installer | `desktop/src/ssh/*`, ресурсы installer | Отдельная привилегированная операция на явно выбранном хосте; SSH fingerprint, подписанный runtime/план, transient credentials |
| Updates/release | `updates*.ts`, `scripts/{build,release,package,package-linux}.mjs`, `.github/workflows/desktop-*.yml` | Build-time trust, подпись manifest/installer, checksum, архитектура; test builds не включают unattended updates |

## Активы и угрозы

Защищаем auth/refresh tokens, SSH/private certificate keys, приватные чаты/записи, локальные файлы пользователя, целостность обновления, удалённого хоста и sandbox. Рассматриваем вредоносный self-hosted backend/сообщение/вложение, скомпрометированный renderer, поддельный deep link/redirect/TLS endpoint, смену профиля во время запроса, изменения локального файла и supply-chain compromise.

Потеря прав пользователя/root, физический доступ и компрометация самой ОС не устраняются клиентом. Renderer не считается доверенным даже при локальной загрузке. Недоступная связка ключей должна приводить к отказу сохранения секретов, не к plaintext fallback.

## Приоритеты и статус доказательств

Подтверждено исходным просмотром: sandbox/contextIsolation включены, Node в renderer выключен; CSP и IPC sender guards присутствуют. Это ещё не полная динамическая проверка. Подтверждено воспроизведением: удаление профиля при недоступной связке ключей оставляет старые credentials в vault — разбирается отдельным regression-тестом. Dependency audit сообщил HIGH для Electron 44.7.1 — до обновления требуется сопоставить advisory с фактической версией.

Гипотезы, а не найденные уязвимости: накопление media/WS/listeners при циклах; проблемы package compatibility на непроверенных ОС; физический portal/TURN/device recovery. Их результаты отражаются отдельно в отчётах, без утверждения «утечка» по одному RSS.

Приоритет: P0 подтверждённые критические ошибки/падения; P1 применимые HIGH advisories и session isolation; затем измеримые lifecycle/performance проблемы. Полная платформа-матрица и решение о выпуске — в `DESKTOP_TEST_REPORT.md`.

## Закрытие исходного плана

Формулировки выше фиксируют исходное состояние, а не текущую готовность выпуска. SEC-01 исправлен regression-тестами, Electron обновлён до 44.9.3; остаточные риски embedded Node отражены в [отчёте безопасности](DESKTOP_SECURITY_AUDIT.md). Завершены локальные lifecycle/media и изолированные native Ubuntu ARM64 проверки; результаты и непроверенные ОС перечислены в [итоговом отчёте](DESKTOP_TEST_REPORT.md). Performance baseline был неполным, поэтому ускорение по нему не заявляется. Общий выпуск по обязательной матрице остаётся BLOCKED.
