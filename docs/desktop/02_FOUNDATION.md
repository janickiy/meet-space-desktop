# MeetSpace для Windows — этап 02: Electron, React и сборка

Дата: 13 октября 2026, Europe/Moscow. Статус: **этап 02 завершён**. Исходный commit: `66e482c9701b6c13f58bc93aee8d9f5cf932dd34`. Рабочая папка: `/Users/aleksandranickij/htdocs/meet_space_windows`. Репозиторий скопирован в неё через локальный clone с сохранением Git-истории и HTTPS origin; отчёт этапа 01 сохранён. Серверные исходники не менялись.

## Реализовано

1. Отдельный `desktop/` package: Electron 44.7.1, TypeScript 7.0.2, electron-builder 26.17.0, закреплённый lockfile. Frontend остаётся самостоятельным React/Vite package, его исходники не копируются в независимый UI.
2. Main/preload, BrowserWindow, single-instance lock, native titlebar и минимальные window controls. Собственное native menu MeetSpace/Edit/View/Window содержит только безопасные role-команды, без стандартных внешних ссылок Electron. Windows runtime policy принимает Win10 22H2 x64 и Win11 x64/ARM64; x86 и Win10 ARM64 отклоняются.
3. Локальный `app://meetspace` для assets и допустимых React SPA routes: проверка authority, path traversal, symlink containment, MIME и security headers. Неизвестные файлы/маршруты не превращаются в успешный index fallback.
4. Изолированный sandboxed preload и типизированный bridge. Main принимает только известные операции, проверяет количество аргументов, sender и main frame. Electron/Node APIs не попадают в generic React-компоненты.
5. Platform adapter `web | desktop`, выбираемый при сборке. Канонические declarations находятся в frontend, чтобы Docker web build по-прежнему не требовал папку desktop; Electron импортирует их только как типы.
6. Desktop build `dist-desktop`, общий branding/components/styles/tokens и предварительный экран. AuthProvider/REST/WS/media пока не монтируются. Web build сохраняет прежний App/провайдеры и свой `/api` dev proxy.
7. Dev launcher: собственный loopback Vite, strict port, случайный nonce для scripts/styles, без arbitrary dev URL. Packaged build игнорирует dev-флаг и не загружает удалённый renderer.
8. Allowlist внешних HTTPS-ссылок, запрет popup/webview/foreign navigation, default-deny permissions/capture/downloads и отсутствие прямого renderer network traffic в foundation.
9. Безопасные OS deep links `meetspace://open/i/<32-character-code>`; pending route, подписка/отписка, сброс ready-state при reload. Установщик регистрирует схему, main проверяет каждый входящий адрес.
10. Guard against desktop JWT persistence: known session key очищается в обоих browser stores; `readSession/saveSession` в desktop не сохраняют credentials. Auth/session broker и OS secret storage остаются задачей этапа 03.
11. Отдельные unsigned NSIS test installers x64 и ARM64, иконки из существующего branding, тестовые metadata/shortcuts и SHA-256/JSON evidence. Release command заблокирован до настройки подписи и приёмки; автообновление не включено.

## Границы этапа

Это функциональный каркас оболочки и сборки, с честным предварительным экраном. Server onboarding, авторизация, REST/WebSocket/SSE и cross-server credentials принадлежат этапу 03. Desktop UI не показывает фиктивных участников/сообщений/медиа; пользователь может открыть текущую веб-версию в системном браузере.

Не выполнялись production deployment, запись данных на сервере, публикация GitHub release, подключение signing keys и установка в Windows. Полный Windows дизайн и продуктовые экраны будут работать поверх существующего React после подключения настоящих серверных контрактов. Native titlebar сохранена; декоративная рамка макета не заменяет управление окнами ОС.

## Файлы

| Область | Основные изменённые / новые файлы |
| --- | --- |
| Main/preload | `desktop/src/main.ts`, `preload.ts`, `security.ts`, `protocol.ts`, `shared/contracts.ts` |
| Упаковка/запуск | `desktop/package.json`, `package-lock.json`, `tsconfig.json`, `electron-builder.config.cjs`, `scripts/{build,dev,package,verify-artifacts,release}.mjs`, `resources/` |
| Общий frontend | `frontend/src/platform/`, `components/desktop/`, `main.tsx`, `utils.ts`, `vite.config.ts`, `package.json` |
| Проверки | `desktop/tests/security.test.cjs`, `electron-smoke.cjs`, `frontend/scripts/check-desktop-foundation.mjs` |
| Документация | `desktop/README.md`, этот отчёт; `01_AUDIT.md` сохранён из этапа 01 |
| Generated outputs | `frontend/dist-desktop`, `desktop/{dist,renderer,artifacts}` исключены через `.gitignore` |

Frontend lockfile/dependencies не изменялись. Для build-time `@electron/get` применён scoped override `global-agent@4.1.3`: он устраняет уязвимую цепочку sprintf-js, для которой нет исправленной версии. Проверены CJS bootstrap и forwarding через локальный test proxy; production runtime Node dependencies у приложения отсутствуют.

## Проверки и реальная матрица платформ

Проверки выполнены с Node 24.19.0 на macOS 27.0.1 ARM64. Реальный Electron 44.7.1 запускался в production local-renderer режиме и dev-режиме. Windows installers собраны на этой машине; cross-build не означает Windows runtime PASS.

| Проверка | Результат и граница |
| --- | --- |
| Desktop TypeScript / `build:main` | **PASS**, CommonJS main и sandbox-compatible self-contained preload |
| Frontend web build | **PASS**, финальные tsc + Vite 8.3.1, 2166 modules, 0 build warnings |
| Frontend desktop build | **PASS**, отдельный mode/output; shell/renderer metadata согласованы |
| Standalone frontend / Docker COPY scope | **PASS**, tsc и web build в копии без desktop tree; сам Docker daemon не запускался |
| Frontend lint | **PASS**, Prettier check |
| `check:desktop-foundation` | **8/8 PASS**, storage guards/web continuity, bridge/schema/routes, dev server nonce/501 boundary |
| `npm test` в desktop | **21/21 PASS**, real file/response fixtures, traversal/symlink, CSP, URL/deep links, sender/frame, Windows admission policy |
| Реальный Electron local-renderer smoke | **PASS**, sandbox/Node isolation, IPC, network/CSP/window-open/navigation denial, explicit API refusal, отсутствие session credentials в storage |
| Appearance/lifecycle в Electron | **PASS** на Mac: system light/dark change, page zoom 125/150/200% без horizontal overflow, deep link в ходе reload. Page zoom не является проверкой Windows DPI |
| Реальный dev Electron smoke | **PASS**, собственный loopback Vite и nonce, sandbox/CSP/IPC/theme/zoom/reload; после завершения порт освобождён |
| Dev invalid arguments / занятый порт | Аргументы валидируются; неизвестный аргумент **отклонён exit 1**. Busy-port guard есть в launcher; отдельный runtime busy-port прогон не выполнялся |
| Windows NSIS x64 / ARM64 | **PASS**, две отдельные сборки, без Wine; реальное содержимое установщиков извлечено и проверено |
| EXE/DLL architecture | **PASS**, x64 EXE + 6 DLL `0x8664`; ARM64 EXE + 6 DLL `0xaa64`; отсутствие runtime node_modules/native addons в ASAR |
| Artifact freshness/provenance | **PASS** после dev smoke: installer → payload → ASAR совпадают с текущими compiled/renderer/resources; frontend и shell metadata совпадают |
| npm audit desktop | **PASS**, 0 известных vulnerabilities всех уровней после scoped override |
| Чистый desktop `npm ci --ignore-scripts` | **PASS** в отдельном временном каталоге, 280 dependencies. Postinstall там не запускался; реальные официальные Electron archives были загружены и проверены для actual builds |
| Production release command | **PASS ожидаемый отказ**, exit 1; нет публикации, signing keys или активного updater |
| `git diff --check`, итоговые hashes | **PASS** |
| Windows install/uninstall/runtime, реальные Windows DPI/устройства | **NOT RUN**, Windows-среды нет |
| Backend tests / live auth/media/TURN | **NOT RUN** в этапе 02; backend unchanged, server integration deferred |

В stderr Mac smoke наблюдались ожидаемый отказ negative IPC (`Link is not allowed`) и сообщение native helper `sandbox_extension_issue_file ... Operation not permitted`. Приложение завершило smoke exit 0; заявленные настройки изоляции проверены в реальном webContents, все assertions прошли. Это не проверка Windows sandbox/runtime и не выпуск подписанного Mac-приложения.

| Платформа | Требование | Сборка | Установка/запуск |
| --- | --- | --- | --- |
| Windows 10 22H2 x64 | Required | **PASS x64 cross-build** | **NOT RUN** |
| Windows 11 x64 | Required | **PASS x64 cross-build** | **NOT RUN** |
| Windows 11 ARM64 native | Required | **PASS native ARM64 payload** | **NOT RUN** |
| macOS ARM64 | Среда разработки/проверки | PASS компиляция | **PASS Electron dev + local renderer smoke** |

NSIS launcher сам может быть x86; его архитектура не подменяет проверку установленного приложения. В ARM64 installer фактический Electron payload нативный ARM64, а не x64 с изменённым именем. Полная поддержка трёх Windows targets пока не заявляется.

## Готовые артефакты

| Файл в `desktop/artifacts/` | Размер | SHA-256 |
| --- | --- | --- |
| `MeetSpace-0.2.0-win-x64-test-setup.exe` | 123 743 611 bytes | `deb1868f98d6364652c376b25087cd025ed1d182ec29ddb179937afaa1bbfcd4` |
| `MeetSpace-0.2.0-win-arm64-test-setup.exe` | 118 484 433 bytes | `ceae231fe36876a02e70de38c5e5d62741be339c1823d779df3bee827558fbd4` |

Общий `app.asar` — 4 663 173 bytes, SHA-256 `79484ff79ad262e62c503bf37d8340ff902e826f9f03bd9c8d9f9c781d97c4df`. Соседние `.sha256` и `.json` содержат результат проверки embedded payload, DLL hashes, `signed:false`, `windowsRuntimeTested:false`.

Provenance: `buildVersion:0.2.0-test`, `sourceCommit:66e482c9701b6c13f58bc93aee8d9f5cf932dd34`, `sourceDirty:true`, `buildTime:2026-10-13T19:39:34Z` (22:39:34 MSK). Новые изменения этапа ещё не закоммичены: checkout одного base SHA не воспроизводит эти binaries. Это локальные test artifacts, не immutable signed release.

Просмотрены светлый и тёмный стартовые экраны, полученные из реального Electron. Скриншоты находятся в `desktop/artifacts/foundation-darwin-arm64-{light,dark}.png`; последние снимки сделаны в dev smoke. Вёрстка не имеет horizontal overflow в проверенном Mac window/page-zoom диапазоне.

## Риски и следующий шаг

- Неподписанные test installers не являются доверенным production release. Подпись/publisher/update feed и Windows CI выполняются этапом 06.
- Windows install/uninstall, native ARM64 runtime, DPI/scaling/multi-monitor и реальные устройства ещё требуют запуска на целевых системах.
- Same-origin web auth/cookies и два WebSocket требуют native transport/session adapter из аудита; нельзя включить существующий AuthProvider в app:// и заменить лишь API base URL.
- Постоянная сессия backend долгоживущая; её хранение должно быть OS-защищённым и разделённым по серверу/аккаунту, с logout/revoke/offline semantics. Нельзя возвращать JWT/cookie через общий IPC.
- Совместимость desktop/server следует привязать к реальным release metadata; в этапе 01 deployment SHA отличался от audited HEAD.

Следующий этап — 03: выбор/проверка HTTPS-сервера, авторизация и REST/WS/SSE через безопасный native broker. Этот этап автоматически не начат.

## Применённые официальные сведения

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [local protocols](https://www.electronjs.org/docs/latest/api/protocol) — ограничения renderer/main и secure scheme.
- [electron-builder v26 NSIS](https://www.electron.build/v26/docs/nsis/) — формат test installer; текущая версия API проверена по установленным types/code.
- [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), [global-agent v4](https://github.com/gajus/global-agent/releases/tag/v4.0.0) — основание scoped build-time override и совместимость bootstrap.

**Работа на этапе 02 остановлена.**
