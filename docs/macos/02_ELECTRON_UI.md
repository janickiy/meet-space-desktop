# Этап 02 — Electron, React и интерфейс macOS

Дата: **28 октября 2026 года**. Версия исходников: **0.2.1-beta**. База: `88107709dd896a8839cd1ac59bee649240a18ae6` и рабочие изменения, перечисленные в [аудите](01_ARCHITECTURE_AUDIT.md). Этап не меняет номер продукта и не публикует выпуск.

## Результат

В существующий Desktop добавлен каркас macOS: политика окна, стандартное меню, восстановление одного окна, проверка минимальной ОС, иконки с Retina-ресурсами, подсказки React и команды dev/build для x64 и ARM64. Общие React, REST/WSS, авторизация и WebRTC сохранены. Создаётся распакованная тестовая `MeetSpace.app`; подпись Developer ID, notarization, DMG/ZIP и публикация относятся к этапу 06.

План перед реализацией: расширить имеющийся `NativeShell`, вынести платформенное меню, сохранить доверенный preload/IPC, использовать runtime metadata для React, отделить macOS packaging от Windows hooks и проверить реальные окна/вход на локальном Mac. Отдельный macOS frontend не создавался.

## Поведение приложения

| Область | Изменение |
| --- | --- |
| Красная кнопка / ⌘W | Окно скрывается, сессия и renderer продолжают работать; доступность значка menu bar не является условием |
| Выход / ⌘Q | Общий `requestQuit`: отмена ожидающего picker, завершение клиентов, соединений и загрузок, затем закрытие окна |
| Dock, повторный запуск, deep link, уведомление | Единый `ensureMainWindow` объединяет одновременные открытия; скрытое окно возвращается, уничтоженное пересоздаётся |
| Single instance | Сохранён нативный Electron lock; второй процесс возвращает существующее окно |
| Меню Mac | About, Services, Hide/Hide Others/Unhide, File/Close, Edit, View/Zoom/Fullscreen, Window; без произвольных внешних ссылок |
| Иконки | ICNS 1x/2x из утверждённого `resources/icon.svg`; монохромные `TrayTemplate.png` 18 px и `@2x` 36 px |
| Рамка и диалоги | Нативная рамка с системными кнопками; существующий Save dialog привязан к доверенному главному окну |
| React | Runtime-context из существующего bridge, `⌘ K` и `aria-keyshortcuts`; описание Dock вместо настройки close-to-tray на Mac |
| Минимальная ОС | macOS 15+, x64/ARM64; проверяется продуктовая версия `process.getSystemVersion()`, а не номер Darwin kernel |
| Темы / размеры | Общие CSS и системная тема, масштабирование Electron и сохранение геометрии; отдельные Mac-стили страниц не добавлялись |

В dev/test путь ресурсов определяется относительно скомпилированного main: Electron entry в `tests/` не должен искать иконки в `tests/resources`. В packaged-приложении используется штатный app path. Отсутствующая template-иконка не препятствует запуску и закрытию окна через Dock.

Скрытие окна отменяет ожидающий запрос выбора источника, но не уничтожает renderer. Автозапуск macOS и системный звук при демонстрации остаются выключенными, интерфейс отражает это. Полноценные TCC, Login Items и восстановление Keychain выполняются на следующих этапах.

## Макеты и безопасность

`/Users/aleksandranickij/htdocs/decs_maket` проверен на этапе 01: это статический интерактивный прототип, commit `857d9770117328b01f5d625cd7a64e3f080fdd26`. На этапе 02 используется существующая общая React-реализация его дизайна; демоавторизация, фиктивные звонки и таймеры установки из прототипа не переносятся. Сведения о лицензиях и происхождении сохранены в аудите.

`contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `webSecurity:true`, отключённый webview и замороженный bridge v6 сохранены. Новые операции IPC не добавлялись. Платформа поступает из проверенного `getRuntimeInfo`, а не user agent. Renderer не получает JWT или refresh cookies; TLS, CSP и ограничения URL не ослаблены. Backend не менялся.

## Команды и упаковка

```sh
npm --prefix desktop run dev:macos:arm64
npm --prefix desktop run dev:macos:x64
npm --prefix desktop run build:macos:arm64
npm --prefix desktop run build:macos:x64
npm --prefix desktop run test:macos
```

Dev требует совпадения архитектур текущих Node.js, Electron и команды. Он переиспользует общий launcher с собственным Vite, фиксированным localhost URL, nonce CSP и отказом при занятом порте. Build допускает упаковку другой архитектуры и явно отмечает её как cross-built. Это не нативная проверка второго типа Mac.

macOS config выбирает общий payload, но не наследует Windows normalizer, NSIS, afterPack/afterSign. Штатные symlink Electron Framework сохраняются. Подготовка NSIS перенесена из общего compile в Windows packaging driver; Windows provenance продолжает содержать проверенное свидетельство patch. Linux driver явно выбирает свой build target.

Mac driver ограничен `test`, `dir`, `.test` bundle identity, minimum macOS 15, disabled updates; исключает наследование signing credentials и публикацию. После упаковки проверяются plist, архитектура Mach-O основного executable/Framework/helpers, SHA-256 main/preload/renderer/provenance, tray/notices и отсутствие неожиданных native addons. Receipt фиксирует source hash, crossBuilt и `distributionReady:false`. Build сам не запускает приложение.

## Реальные проверки

Стенд: **macOS 27.2.0, ARM64**, Electron **44.9.3**; версия получена через Electron product-version API. Официальное имя macOS 27 — Golden Gate, ссылки и ограничения приведены в [матрице аудита](01_ARCHITECTURE_AUDIT.md). Наличие этого стенда не подтверждает совместимость Sequoia/Tahoe или Intel.

Логи и снимки хранятся локально в gitignored [desktop/artifacts/macos-stage02](../../desktop/artifacts/macos-stage02/).

| Проверка | Фактический результат |
| --- | --- |
| `npm --prefix desktop test` | **348 PASS, 0 FAIL, 1 SKIP** из 349; skip — Linux GIO Desktop Entry на Mac; [unit.log](../../desktop/artifacts/macos-stage02/unit.log) |
| `check:desktop-foundation` | **30/30 PASS**; [foundation.log](../../desktop/artifacts/macos-stage02/foundation.log) |
| `check:desktop-media` | **39/39 PASS**, подставные устройства; [media.log](../../desktop/artifacts/macos-stage02/media.log) |
| `check:desktop-assets` | **9/9 PASS**; [assets.log](../../desktop/artifacts/macos-stage02/assets.log) |
| Desktop build / web build | TypeScript и общий Vite renderer собираются; [ARM64 build log](../../desktop/artifacts/macos-stage02/package-arm64.log), [web-build.log](../../desktop/artifacts/macos-stage02/web-build.log) |
| Native main/preload platform harness | **PASS**, включая запрет IPC чужого окна, CSP/URL policy, отмену Save dialog и точное сохранение 262144 байт; [platform report](../../desktop/artifacts/macos-stage02/platform-darwin-arm64.json) |
| Новый macOS UI harness | **PASS**, реальный общий React + main/preload + локальный HTTPS/WSS; [macos-ui.json](../../desktop/artifacts/macos-stage02/macos-ui.json), [ui.log](../../desktop/artifacts/macos-stage02/ui.log) |

Scoped 28 build-policy и 16 window/menu тестов выполнялись при разработке; они входят в общую suite и не прибавляются к итоговым 348.

UI harness проверил:

- branded connection → существующая форма входа → авторизованный `/app`, настоящие REST и WSS локального fixture, отсутствие токенов в web storage;
- общий поиск: подпись `⌘ K`, ввод Meta+K через Chromium, открытие модального окна и закрытие Escape;
- маршруты чатов, настроек, записей и встреч; в приложении Mac показана подсказка Dock вместо close-to-tray;
- системные light/dark; снимок после fonts ready, двух animation frames и 350 ms для завершения перехода;
- размеры 1000×720 / 1440×900 и zoom 100/150/200% без горизонтального переполнения документа;
- close скрывает и сохраняет окно/маршрут; menu Cmd+W callback скрывает; Dock activate возвращает;
- настоящий второй процесс не получает lock и возвращает одно имеющееся окно;
- два одновременных activate после destroy создают одно новое окно и восстанавливают авторизованный UI;
- событие `open-url` возвращает скрытое окно и применяет разрешённый invite route;
- menu Cmd+Q callback проходит реальный cleanup до `will-quit`, уничтожает окно.

В тестах использовались временные userData/sessionData и локальные сертификаты fixture; обычная проверка сертификата не отключалась, запросы ограничены адресом fixture. Keychain был доступен, vault проверен на отсутствие открытых тестовых паролей/токенов. В системные аккаунты и рабочий backend вход не выполнялся. Результаты Save dialog в platform harness подставлены: проверены владелец/параметры/отмена/файл, а не ручное управление нативным диалогом.

Просмотрены [connection-light.png](../../desktop/artifacts/macos-stage02/connection-light.png), [connection-dark.png](../../desktop/artifacts/macos-stage02/connection-dark.png), [settings](../../desktop/artifacts/macos-stage02/route-app-settings.png). Обе темы отображаются согласованно, кнопки читаемы. Проблема ранних снимков этапа 01 не воспроизвелась после ожидания перерисовки; CSS темы не менялся. Эти снимки и overflow checks не являются попиксельной приёмкой всех состояний приложения.

## Границы приёмки и регрессия

Windows/Linux поведение close-to-tray, отказ при недоступном tray, геометрия, startup policy и системные capabilities покрыты общей suite. Отдельно проверены Windows NSIS/release policy и Linux package policy. Реальная повторная GUI-приёмка Windows 10/11, Ubuntu/Fedora, установка NSIS/DEB/RPM/AppImage в этом этапе не выполнялась.

Не проверены: Intel Mac runtime; macOS 15/26; реальные камера/микрофон/экран/системный звук; TCC Allow/Deny; длительные звонки и утечки; разрешение уведомлений и Focus; Login Items; recovery/upgrade подписанной Keychain identity; загрузка пакета из интернета и Gatekeeper/notarization. Синтетический `open-url` не доказывает холодный запуск схемы из внешнего приложения; menu callback не подменяет аппаратный тест соответствующей клавиши. Эти проверки остаются в следующих этапах.

## Изменённые файлы

- Main/platform: `desktop/src/main.ts`, `native-shell.ts`, `platform/application-menu.ts`, `platform/macos-version.ts`, `platform/host-platform.ts`.
- UI: `frontend/src/platform/runtime.tsx`, `components/Layout.tsx`, `WorkspaceSearch.tsx`, `IntegrationsSettings.tsx`, `components/desktop/DesktopSessionGate.tsx`, `DesktopNativeSettings.tsx`, `desktop-native-settings.css`.
- Build: `desktop/package.json`, `electron-builder.macos.config.cjs`, `scripts/dev-macos.mjs`, `package-macos.mjs`, `macos-package-policy.mjs`, `generate-macos-icons.mjs`, `build.mjs`, `package.mjs`, `package-linux.mjs`, `prepare-builder.mjs`, `resources/macos/*`.
- Tests: `desktop/tests/application-menu.test.cjs`, `macos-version.test.cjs`, `macos-package-policy.test.cjs`, `macos-ui.cjs`, `macos-ui-runner.cjs`, `platform-policy.test.cjs`, `platform-native-shell.test.cjs`, `native-lifecycle.cjs` (mock native image).
- Docs: `desktop/README.md`, `docs/README.md`, этот отчёт.

Прежние шесть изменений поддержки вложений, перечисленные в этапе 01, сохранены и не относятся к этой реализации. Изменения этапа 01 также остаются в рабочем дереве. Отчёт завершается результатами упаковки ниже; следующие этапы автоматически не запускаются.

## Итоговые тестовые приложения

| Архитектура | Результат | Локальный артефакт |
| --- | --- | --- |
| ARM64 | Упаковка и проверка payload/Mach-O/plist **PASS**; итоговая `.app` запущена нативно | [MeetSpace.app](../../desktop/artifacts/macos-stage02-arm64-Jw6MpW/mac-arm64/MeetSpace.app), [receipt](../../desktop/artifacts/macos-stage02-arm64-Jw6MpW/macos-unpacked-verification.json) |
| Intel x64 | Упаковка и структурная проверка **PASS**, cross-built на ARM64; запуск на Intel не проверен | [MeetSpace.app](../../desktop/artifacts/macos-stage02-x64-41HR3s/mac/MeetSpace.app), [receipt](../../desktop/artifacts/macos-stage02-x64-41HR3s/macos-unpacked-verification.json) |

Обе `.app` связаны с одним финальным source snapshot `bb9f3a4a6047df0c89b958c3991e73d86e5ef57edb65d5504598937f434eae4d`; ASAR SHA-256 одинаков: `c4c9b2185aee0dd51f7531e122de200a01eb2bfdadc4ac7e544bd2dc6630bb17`. После упаковки отдельно сверено совпадение receipt с текущими исходниками. Прежние файлы вложений также сверены с SHA-256 baseline этапа 01 — все шесть сохранены без изменений.

Итоговая ARM64 `.app` проверена через нативное управление macOS: видны начальный экран, стандартные кнопки окна и меню MeetSpace/Файл/Правка/Вид/Window; нажатие «Продолжить» открыло форму подключения; ⌘Q завершил процесс. [Отдельная запись наблюдения](../../desktop/artifacts/macos-stage02/packaged-ui.json). Вход в аккаунт проверялся отдельным unpackaged fixture harness выше. При обычном старте packaged-приложения действует существующая регистрация схемы `meetspace`; внешнее открытие этой схемы ещё требует приёмки.

Receipt упаковщика намеренно содержит `runtimeTest:not-performed`: сам упаковщик не запускает приложение. Нативная проверка ARM64 зафиксирована отдельной записью и не меняет статус `distributionReady:false`. Эти `.app` не подписаны Developer ID и не нотариализованы; проверка скачанного дистрибутива и защищённый выпуск остаются этапом 06.

**Этап 02 завершён. Следующие этапы не начинались.**
