# MeetSpace Desktop — этап 05: продукт и интеграции Windows

Дата: 14 октября 2026. Checkout `66e482c9701b6c13f58bc93aee8d9f5cf932dd34` плюс незакоммиченные изменения этапов 01–05. Runtime проверяется на macOS ARM64, Electron 44.7.1, Node.js 24.19.0. Windows runtime ещё не предоставлен.

## Общий продукт

Повторно используются существующие React/TypeScript экраны: личные и групповые чаты, файлы чата, папки и их содержимое, встречи/календарь, история, записи, устройства и настройки аккаунта. Независимых desktop-копий этих страниц нет. Core маршруты соответствуют фактическим HTTP API personal/folders/platform и проверкам доступа backend.

Capabilities сервера содержат `liveCaptions`, `transcription`, `aiSummary`, `semanticSearch`, `meetingAnalytics`, `recordingModes`. Фиктивные flags для чатов или папок не добавлялись. Исправлен gate RecordingPanel: устаревшие recordingModes из кеша больше не разрешают начало записи после ошибки обновления capabilities. Встроенный календарь работает через существующий API; возврат внешнего calendar OAuth в desktop остаётся отдельной интеграцией.

## Окно и системный трей

- Сохраняются нормальные bounds и maximized state. Геометрия использует DIP, учитывает отрицательные координаты мониторов, work area и удаление/смену масштаба дисплея. Недоступное положение переносится на основной монитор; окно помещается в доступную рабочую область.
- Minimum size — 900×640 DIP, с уменьшением до рабочей области маленького дисплея. Используется стандартная рамка окна с системными minimize/maximize/restore и клавиатурными средствами ОС.
- В трее и меню приложения: «Открыть MeetSpace», «Скрыть в трей», «Выход из MeetSpace». Tooltip отражает подтверждённый сервером unread count. При недоступном трее приложение не скрывает окно без возможности вернуть его.
- По умолчанию закрытие завершает приложение. Опция «При закрытии окна сворачивать в трей» включается явно во вкладке «Приложение» существующих настроек. При скрытии звонок и обновления продолжаются; полный выход доступен отдельно.
- Перед quit общий renderer получает lifecycle `quit` для остановки устройств/медиа; после короткого окна освобождения закрываются native соединения, операции файлов, уведомления и трей.
- В `desktop-state.json` сохраняются только геометрия и локальные toggles. Сессии, маршруты, сообщения и идентификаторы аккаунтов туда не записываются.

## Системные уведомления

Показ нативного уведомления инициируется только событием авторизованного SSE broker; account WebSocket также служит для read/mute/removal cleanup. Renderer не может отправить произвольный текст, заголовок или команду уведомления. Начальные и обновлённые category preferences загружаются через реальный API. До получения настроек доставка закрыта.

Поддержаны сообщения личных/групповых чатов и встреч, приглашения/изменения встречи, напоминания, admission, `recording.ready`, `transcript.ready`, `summary.ready`. Неизвестные события, включая серверный `processing.failed`, остаются в существующей ленте. Текст системных уведомлений фиксированный, без содержимого сообщения и секретов. Click открывает существующую страницу по проверенным UUID; вход/допуск выполняется обычным интерфейсом.

Дедупликация ID уведомления/сообщения, ограничения возраста/количества, учёт focused conversation, read/mute/removal/delete и очистка при logout/смене сервера предотвращают повторы и устаревшие действия. Системные уведомления можно выключить отдельно. Desktop browser toast/sound для тех же событий отключён; bell и лента остаются. Звук учитывает локальное предпочтение аккаунта и настройки ОС. Выбор динамика приложения не управляет устройством вывода системного звука Windows.

## Ссылки, сохранение и просмотр файлов

`meetspace://open/i/<32-character-code>` и `meetspace://open/meetings/<UUID>/join` (также `conferences`) содержат только безопасный маршрут. Query/hash, токены, адрес сервера и команды не принимаются. Single-instance доставляет ссылку уже запущенному процессу, открывает скрытое окно и сохраняет prejoin destination через обычный auth redirect. Ссылка использует выбранный сервер и не включает устройства автоматически.

Новый bridge v4 принимает только ID записи/файла/чата и временный маркер текущей личности. Main заново получает разрешённую карточку/ссылку через серверный API, проверяет формат/срок действия и TLS, затем использует системный Save dialog либо выдаёт непрозрачный локальный `app://meetspace/native-media/...` URL. Прямой remote network renderer и обычные downloads остаются закрыты. Старые signed URLs не становятся authority для native операций.

Сохранение выполняется потоком с backpressure во временный файл рядом с выбранным пользователем назначением, после успешного завершения — атомарная замена. Предел — 2 ГиБ; отмена и смена сессии удаляют незавершённый файл. Записи доступны как MP4/audio/JPEG и archive download по фактическим server file UUID. Старый сервер без UUID не получает вымышленную возможность сохранения.

Просмотр использует потоковый Range proxy с повторной серверной проверкой доступа. Полная запись не сохраняется в кэш приложения. Истёкшая ссылка обновляется через авторизованный API; ошибки доступа/сети остаются видимыми. Logout, смена сервера, остановка, уход со страницы и quit отменяют текущие операции и отзывают URL.

Порог backpressure медиапотока — 64 КиБ; последний chunk до 32 КиБ может оказаться поверх этого порога, native input chunk отдельно ограничен 2 МиБ. Сетевой idle timeout не идёт, пока потребитель намеренно приостановил чтение; явная отмена остаётся доступна. URL отзывается через 30 минут бездействия, активный поток продлевает срок. Предел 2 ГиБ относится к сохранению, полного предварительного скачивания перед просмотром нет. После аварийного завершения процесса/ОС возможен незавершённый `.meetspace-<UUID>.part` в выбранной пользователем папке; при обычной отмене/logout/quit он удаляется. Startup не обходит пользовательские папки для удаления таких файлов.

Native recording DTO больше не содержит `files[].url`/`downloadUrl`; renderer выбирает файлы по UUID. Общая веб-версия получает свои обычные API ответы. Другие существующие DTO могут содержать URLs как данные, но они не принимаются в новых asset IPC как разрешение на запрос. Поддерживаются фактические S3 SigV4 HTTPS ссылки и точный authenticated conversation content route. Redirect, HTTP, чужие credentials и произвольные renderer destinations отклоняются.

В явно включённом dev-режиме локальный медиаканал разрешает CORS/CORP только для точного `http://127.0.0.1:5173`. Main request guard требует owned mainWindow/mainFrame, media/image/xhr resource type и непрозрачный native-media path; CSP разрешает только этот фиксированный локальный медиаканал. Production сохраняет same-origin без CORS. Прямые remote запросы и другие окна не получают такое разрешение.

## Автозапуск, медиа и ошибки

Автозапуск доступен только для packaged Windows-сборки (`win32 && app.isPackaged`) и меняется только после явного выбора пользователя; код отдельно не проверяет факт установки NSIS. Приложение читает как регистрацию, так и startup approval ОС; само при запуске не включает эту опцию. Автообновление по-прежнему закрыто до подписи, release feed и проверки целостности.

Настройки camera/mic/speaker, screen sharing, отключение устройств и suspend/reconnect переиспользуют этап 04. Добавлена остановка захвата перед quit. Offline-встречи не объявляются доступными; сетевые/TLS/старый сервер/медиа/файловые ошибки обрабатываются существующими экранами с возможностью сменить сервер. Credentials и пользовательские данные между профилями не смешиваются.

## Проверки

| Проверка | Результат | Фактический объём |
| --- | --- | --- |
| Desktop unit/network/security | PASS, 91/91 | Включая 15 asset policy/network, 11 native notification, 4 window state; TLS, credentials, scoped broker, cancel/logout, signed expiry, redirects, Range/HEAD и backpressure |
| Frontend foundation | PASS, 19/19 | Desktop/web adapters, bridge v4, transports, отсутствие browser JWT, отсутствие дублирующего native/browser audio |
| Frontend media lifecycle | PASS, 11/11 | Scope устройств, поздний capture/replacement, cleanup; lifecycle quit освобождает захват |
| Frontend native assets | PASS, 8/8 | ID-only bridge, прогресс, отмена/поздний ответ, безопасный media URL/MIME, сохранение web branches и auth-return |
| Общий React product UI в настоящем Electron | PASS, 11/11 | Чаты direct/group и фильтры, вложение, папки, встречи/календарь/история, capabilities, каталог записей, настройки, notification context, недоступный TLS fixture |
| Предыдущий shared UI regression | PASS, 8/8 | Профили/auth, WSS/SSE, reconnect, screen picker, server isolation, offline/server settings, safeStorage |
| Native shell в настоящем Electron | PASS | Настоящий Tray, show/hide/close-to-tray, typed preferences, запрет чужому окну, второй процесс/single-instance meeting link, quit cleanup signal; перезапуск восстанавливает prefs/bounds, maximize/restore |
| Native asset runtime, production | PASS | Настоящий Electron net HTTPS, negative TLS, exact saved bytes, renderer app Range, декодирование синтетического H.264/AAC, consumer pause 36 сек при network timeout 35 сек, abort paused sink, no media disk cache |
| Native asset runtime, dev | PASS | Настоящие main/preload/IPC, собственный fixed `127.0.0.1:5173` fixture, app Range/H.264/AAC; чужое same-origin окно отклоняется по сети и IPC, прямой remote fetch остаётся закрыт |
| Electron restart/auth integration | PASS | Два процесса, настоящий OS safeStorage, trusted fixture CA, account WSS/SSE, изоляция двух серверов и отзыв сессии |
| Security smoke: bundled и dev | PASS | Node/sandbox/IPC, navigation, remote fetch/CSP/nonce, deep link во время reload, тема и масштаб |
| Media permission runtime | PASS, 6 проверок | Production handlers, synthetic own-frame display, forged IDs/activation, power-event cleanup/reconnect; physical capture не выполнялся |
| Локальный Pion SFU, direct и forced relay | PASS | Два shared клиента; входящие Opus/VP8, selected local relay у обоих в relay-прогоне, 2 TURN allocations, tracks ended/PC closed/SFU peers 0 |
| Frontend lint/TypeScript/web и desktop build | PASS | 2174 modules в web/desktop, общий frontend сохранён |
| Runtime npm audit | PASS | 0 известных vulnerabilities для production dependencies на момент проверки |
| Рабочий сервер, новые stage05 CRUD/recording/OS notifications | NOT RUN | В этом этапе сеть ограничена disposable локальными fixtures; реальные сообщения/приглашения не отправлялись |
| Физический Save dialog и OS toast/Action Center | NOT RUN | Callback выбора/отмены заменён только в тесте; реальный file network/byte pipeline проверен отдельно. Notification factory/click/close проверены unit-тестами; визуальная доставка ОС не заявляется |
| Windows runtime, startup approval, multiple-monitor/high-DPI hardware, device unplug/sleep | NOT RUN | macOS и synthetic events не подтверждают целевые Windows-системы |

Product UI использует тестовый IPC completion seam для результата Save/play/cancel/close и notification context. Он подтверждает payload/поведение общего интерфейса, а не OS dialog или production main validation контекста. Настоящее app:// Range и native byte pipeline проверяет отдельный asset runtime harness; dev harness дополнительно использует полный main/preload. Test CA доверяется только disposable fixture session/transport с проверкой конкретного сертификата; глобальное trust store и production TLS не менялись. Все account inputs/media в новых прогонах синтетические. В отдельных macOS тестах был diagnostic Electron Helper sandbox extension; итоговые проверки завершаются PASS. Это не подтверждает helper behavior на Windows.

Evidence: [shared product UI](../../desktop/artifacts/stage05-product-ui.json), [native assets](../../desktop/artifacts/stage05-native-assets.jsonl), [полный dev main/preload media](../../desktop/artifacts/stage05-development-assets.jsonl), [светлая тема настроек](../../desktop/artifacts/stage05-settings-light.png), [тёмная тема](../../desktop/artifacts/stage05-settings-dark.png). Скриншоты — только synthetic fixture интерфейс.

Повторение из repository с поддерживаемым Node.js:

```sh
npm --prefix frontend run check
npm --prefix frontend run check:desktop-foundation
npm --prefix frontend run check:desktop-media
npm --prefix frontend run check:desktop-assets
npm --prefix desktop test
npm --prefix desktop run test:native
npm --prefix desktop run test:assets
npm --prefix desktop run test:product
npm --prefix desktop run test:integration
npm --prefix desktop run test:ui
npm --prefix desktop run test:media
npm --prefix desktop run test:sfu
npm --prefix desktop run test:smoke
node desktop/scripts/dev.mjs --smoke
desktop/node_modules/.bin/electron desktop/tests/assets-development-electron.cjs
npm --prefix desktop run pack:win
npm --prefix desktop run verify:artifacts
```

Assets runtime требует FFmpeg, SFU runtime — Go. UI/test commands, которые пересобирают renderer, выполняются перед финальной упаковкой.

## Windows support matrix

| Система | Архитектура | Payload/installer | Runtime |
| --- | --- | --- | --- |
| Windows 10 22H2, build 19045 | x64 | PASS, EXE и 6 DLL `0x8664` | NOT RUN |
| Windows 11 | x64 | PASS, EXE и 6 DLL `0x8664` | NOT RUN |
| Windows 11 | ARM64 native | PASS, EXE и 6 DLL `0xaa64` | NOT RUN |

Windows 10 ARM64 и x86 вне объёма. Cross-build и PE headers не подтверждают Windows runtime. Проверка установщика, реальных toast/Action Center, startup approval, нескольких мониторов/масштабов, устройств/сна и Windows ARM64 нужна на целевых машинах.

## Тестовые установщики 0.5.0

Упаковка и независимое повторное извлечение payload — **PASS**. Версия `0.5.0-test`, build time `2026-10-14T03:55:18Z`, sourceDirty=true. Проверяются реальный EXE и DLL внутри NSIS, общий ASAR, совпадение packaged main/renderer/resources с подготовленными outputs, отсутствие тестов/fixtures/native addons. Установщики не подписаны и не опубликованы, update feed отсутствует.

| Installer | Байты | SHA-256 |
| --- | ---: | --- |
| [Windows x64](../../desktop/artifacts/MeetSpace-0.5.0-win-x64-test-setup.exe) | 123846427 | `6d591663b79f3c4f97a0bbde2453f86391a43f5fc52d57223d4fc94e848e1f23` |
| [Windows 11 ARM64 native](../../desktop/artifacts/MeetSpace-0.5.0-win-arm64-test-setup.exe) | 118587355 | `fcf00c970e88cc405392fd98fefc7d52f1b69072f9b0a96bea6adf22f800f78a` |

Общий ASAR: 5076989 байт, SHA-256 `929deea654368def3f6f4683022505fe555525584f12aa31fc91c057964cbbb2`. Рядом с каждым installer сохранены manifest и `.sha256`; старые 0.2/0.3/0.4 installers сохранены. [x64 manifest](../../desktop/artifacts/MeetSpace-0.5.0-win-x64-test-setup.exe.json), [ARM64 manifest](../../desktop/artifacts/MeetSpace-0.5.0-win-arm64-test-setup.exe.json), [local verification и 185 source hashes](../../desktop/artifacts/Stage05-local-native-tests.json).

Следующий шаг — приёмка установщиков на трёх Windows targets с двумя аккаунтами: chat/group/folders, запись/Save/seek/expired access, click/read/mute/logout для toast, close-to-tray/exit, ручной opt-in автозапуска, мониторы/scaling и hardware media/network/sleep. Открытые ограничения этапа 04 (backend ICE policy fix ещё не развёрнут, waiting/admission fixture) остаются в его отчёте. Сборка клиентского этапа 05 их не заменяет.

## Основные изменения

- `desktop/src/main.ts`, `preload.ts`, `native-shell.ts`, `window-state.ts`, `security.ts`: окно, трей, предпочтения, quit и deep links.
- `desktop/src/native-notifications.ts`, `broker.ts`: системные уведомления из авторизованных событий и область личности.
- `desktop/src/downloads.ts`, `asset-policy.ts`, `network/transport.ts`: ID-authorized сохранение/просмотр, signed capabilities и потоковая передача.
- `frontend/src/platform/desktop-contracts.d.ts`, `desktop.ts`, `assets.ts`, `captureLifecycle.ts`: bridge v4, native asset helpers и quit.
- `frontend/src/components/desktop/DesktopNativeSettings.tsx`, `NativeAssets.tsx`, `pages/AccountPages.tsx`: существующие настройки и доступные file actions.
- `RecordingActions`, `RecordingPanel`, `RecordingInsights`, `RecordingDetailPage`, `RecordingsPage`, `ChatPanel`, `ConferenceChatInfo`, `recordingPresentation`, `types`: общий product UI и файлы.
- `notifications`, `notificationSound`, `personalRealtime`, `IntegrationsSettings`: context/предпочтения и отсутствие дублирующих сигналов desktop.
- Desktop/frontend tests и package scripts: проверки окна/перезапуска/ссылок/файлов/уведомлений и shared UI.

API сверены с установленными typings Electron 44.7.1 и официальной документацией: [Tray](https://www.electronjs.org/docs/latest/api/tray), [Notification](https://www.electronjs.org/docs/latest/api/notification), [window geometry](https://www.electronjs.org/docs/latest/api/browser-window), [login item settings](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings).

Этап 06 автоматически не начинается. Backend и рабочий сервер в этом этапе не развёртываются.
