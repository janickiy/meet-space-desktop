# Этап 05 — Dock, меню, уведомления и автозапуск macOS

Дата: **28 октября 2026 года**. Версия проекта: **0.2.1-beta**. Продолжение [этапа 04](04_SCREEN_PERMISSIONS.md). Реализация выполнена в общем Electron/React/TypeScript Desktop. Полная приёмка доставки уведомлений и запуска после входа остаётся открытой до проверки подписанного установленного приложения.

## Область и исходный аудит

Запрос пользователя — этап 5 macOS. Первоначально приложенный `CODEX_LINUX_06_RELEASE.md` описывает другую платформу и этап; требования сверены с фактическим `CODEX_MACOS_05_OS_INTEGRATION.md`, позднее приложенным пользователем. Переход к этапу 6 пользователь отдельно отменил. Макеты в `decs_maket` — существующий HTML/CSS/JS-прототип, включая `app.js`, `installer.js`, шрифты и SVG-иконки; системные API реализуются в текущем Electron main, отдельный frontend не создавался. Backend не менялся.

До изменений уже существовали native menu, ⌘W/⌘Q, скрытие окна с сохранением renderer, single-instance gate, строгий parser `meetspace://`, безопасные внутренние маршруты уведомлений и сброс состояния при смене identity. Отсутствовали меню Dock, Dock badge и macOS startup provider. Также найден отложенный маршрут уведомления, который мог сохраняться после смены identity.

План: добавить меню и badge через общую оболочку, изолировать macOS Login Items в отдельном адаптере, сохранить явное согласие, проверить lifecycle и границы аккаунтов через локальные fixtures, собрать `.app` и зафиксировать ограничения. Нативная проверка не требует производственного сервера.

## Реализованное поведение

- **Dock и строка меню.** Открыть, скрыть, выйти; menu bar использует существующее template image. Dock доступен и при отказе создания Tray. Повторное открытие проходит через общий `ensureMainWindow`: два вызова создают одно окно, включая случай уничтоженного предыдущего окна. Запоздалые callbacks после выхода игнорируются.
- **Закрытие и фон.** Красная кнопка и ⌘W скрывают окно. Фоновый renderer продолжает обработку событий; ⌘Q выполняет общий quit lifecycle и освобождение соединений. Скрытие отменяет ожидающий выбор экрана. Существующие проверки активного capture сохраняются.
- **Badge.** Только числовой агрегат непрочитанных текущей identity, ограниченный 9999. Выход из аккаунта, смена сервера и завершение приложения очищают badge. Анимация привлечения внимания не запускается. Отображение badge может зависеть от системного разрешения уведомлений. [Electron Dock API](https://www.electronjs.org/docs/latest/api/dock).
- **Автозапуск.** Новый `createMacOSAutostart` использует `mainAppService`. Конструктор и чтение статуса ничего не регистрируют. Включение только через явное изменение настройки. Проверяются packaged identity, канонические пути executable и `app.asar`, расположение `/Applications/MeetSpace.app` либо пользовательское `Applications/MeetSpace.app`. Временная, загруженная, translocated и dev-сборка не регистрируются.
- **Состояние системы.** После записи автозапуска требуется readback. `requires-approval` не отображается как включённый автозапуск; UI показывает путь к объектам входа macOS. Состояние перечитывается при возврате в настройки и каждые 5 секунд, пока страница видима. Параметры Windows `path/args/enabled` в macOS API не передаются. [Electron Login Items](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows).
- **Уведомления.** Переиспользован общий `NativeNotifications`: фиксированный текст без содержимого сообщений, authenticated broker events, bounded state, dedup, mute/category/focus suppression, identity-scoped звук и внутренние маршруты. Отказ OS не ломает in-app feed. Сброс identity теперь очищает также `pendingRoute`, чтобы старое отложенное уведомление не открывалось в новом аккаунте.
- **Ссылки.** Сохранён parser только для `meetspace://open/i/<32 символа>` и UUID join-маршрутов встреч. Запрещены произвольные серверы, credentials, query, fragment, encoded path и команды. Повторный процесс передаёт допустимый маршрут основному окну.

## Проверки и доказательства

Фактическая среда: **macOS 27.2.0 Golden Gate, ARM64**, Electron **44.9.3**, Chromium **152.0.7977.167**, Node **24.19.0**. Наименование macOS и источники проверены в [этапе 01](01_ARCHITECTURE_AUDIT.md). Intel и macOS 15/26 на доступном стенде отсутствуют.

| Проверка | Результат |
| --- | --- |
| Полная Desktop suite | **389 PASS, 0 FAIL, 1 SKIP** из 390; skip — Linux GIO на Mac; [лог](../../desktop/artifacts/macos-stage05/desktop-tests.log) |
| Frontend foundation | **30/30 PASS**; [лог](../../desktop/artifacts/macos-stage05/foundation.log) |
| Общая media lifecycle логика | **55/55 PASS**; [лог](../../desktop/artifacts/macos-stage05/media.log) |
| Общие native assets | **9/9 PASS**; [лог](../../desktop/artifacts/macos-stage05/assets.log) |
| Desktop build / TypeScript | **PASS**; [лог](../../desktop/artifacts/macos-stage05/final-build.log) |
| Web build / TypeScript | **PASS**; [лог](../../desktop/artifacts/macos-stage05/web-build.log) |
| Общий React UI в настоящем Chromium | **PASS**; [результат](../../desktop/artifacts/macos-stage05/ui/macos-ui.json), [лог](../../desktop/artifacts/macos-stage05/ui.log) |
| Нативная интеграция этапа 5 | **PASS**; [результат](../../desktop/artifacts/macos-stage05/native-final/macos-integration.json), [лог](../../desktop/artifacts/macos-stage05/native-final.log) |

В общей suite добавлены 7 тестов startup adapter, меню Dock и lifecycle/badge, а также проверка реального startup adapter через `NativeShell` с подставленной OS-границей. Проверяются opt-in true/false, внешнее изменение разрешения, удаление pending registration, противоречивый readback, невалидный ввод и отсутствие Windows API calls. Это проверки политики; запись в настоящие Login Items не выполнялась.

Нативный harness использует production main/preload/NativeShell, sandboxed renderer и два временных HTTPS-сервера с authenticated broker. Проверены:

1. Настоящее меню Dock, callbacks открытия/скрытия/выхода, красная кнопка, ⌘W, activate и один сохранённый экземпляр окна.
2. Настоящий второй процесс и single-instance lock, допустимые/недопустимые deep links, пересоздание одного уничтоженного окна при двойном открытии из Dock.
3. Authenticated HTTPS/SSE и входящий chat event при скрытом окне; счётчик **7 → 8 → очистка при смене сервера → 3 → очистка при logout**; старый stream закрывается, прежняя identity отклоняется.
4. Собственный synthetic canvas и настоящие локальные WebRTC PeerConnection: **5 декодированных кадров до скрытия → 10 после**, меняющиеся кадры, tracks живы, peers подключены. Явное завершение звонка закрывает оба потока и peers, освобождает video и таймер.
5. Второй активный локальный медиасеанс останавливается от production quit lifecycle до уничтожения окна; все 5 cleanup-проверок true, badge пустой.

Всего **19 локальных HTTP-запросов**, **0 production requests**, **0 физических capture**, **0 изменений Login Items**. Canvas не является проверкой камеры, микрофона, Screen Recording или Pion/SFU. Нативные capture-проверки остаются в отчётах предыдущих этапов.

Политика клика по уведомлению, статического текста и отзыва старых callbacks дополнительно проверена через явно обозначенные fake Notification handles. Реальный incoming event проходит через production SSE/broker. Нажатие человеком на доставленное OS-уведомление этим не подтверждается.

## Ограничение системных уведомлений

В установленном Electron 44 macOS использует UNNotification API и требует code signing для доставки. `Notification.isSupported()` сообщает наличие API, а не выданное разрешение или успешную доставку. В реальной попытке статического silent-уведомления получено **`failed`** под unsigned development identity. Результат записан как **`NOT_VERIFIED_UNSIGNED_DEVELOPMENT_IDENTITY`**. [Официальная документация Electron Notification](https://www.electronjs.org/docs/latest/api/notification).

Подпись, permission grant/deny, режим Focus, отображение badge и клики Notification Center под постоянной установленной identity требуют отдельной приёмки. Свойство `getBadge()` и сброс числового состояния проверены, визуальная видимость badge при отключённых разрешениях не обещается. В этом этапе защита macOS не отключалась, unsigned-доставка не подменялась успешным результатом.

## Тестовые приложения

Обе сборки **0.2.1-beta**, unsigned, без нотариализации и автоматического обновления. Это `.app` для проверки; DMG и публикация относятся к следующему этапу.

| Архитектура | Сборка |
| --- | --- |
| ARM64 | [MeetSpace.app](../../desktop/artifacts/macos-stage02-arm64-BIBZni/mac-arm64/MeetSpace.app), [receipt](../../desktop/artifacts/macos-stage02-arm64-BIBZni/macos-unpacked-verification.json), [лог](../../desktop/artifacts/macos-stage05/package-arm64.log) |
| x64 | [MeetSpace.app](../../desktop/artifacts/macos-stage02-x64-ztUuZM/mac/MeetSpace.app), [receipt](../../desktop/artifacts/macos-stage02-x64-ztUuZM/macos-unpacked-verification.json), [лог](../../desktop/artifacts/macos-stage05/package-x64.log) |

Проверены фактические Mach-O executable/framework/helpers, содержимое ASAR и privacy strings. ARM64 `.app` запущена через native UI: onboarding `app://meetspace/`, File menu, скрытие через ⌘W, восстановление через «Открыть MeetSpace», выход ⌘Q и отсутствие PID после выхода — [проверка](../../desktop/artifacts/macos-stage05/packaged-startup.json). Intel `.app` собрана cross-build; её runtime не проверен.

Обе `.app` и финальная нативная проверка используют source fingerprint **`93f6f16c1f334b1f7b46a9c681557c5ce0ff2e1792d33ef04b6a7b1a0c95b7c6`**; [manifest](../../desktop/artifacts/macos-stage05/final-source-inputs.json). Названия `macos-stage02-*` и receipt stage `02` унаследованы от упаковщика; содержимое собрано заново. Версия `44.9.3` в разделе обновлений dev UI fixture — версия Electron test entry; packaged metadata проверяется отдельно упаковщиком.

## Регрессия и оставшаяся приёмка

Windows/Linux ветки проверены общей suite: menu policy, tray availability/fallback, geometry, startup provider и Windows login arguments, native notifications, identity cleanup, deep-link validation, packaging/update policy. Linux продолжает использовать собственный startup provider, Windows — прежний native API. Общий React frontend успешно собран в web и desktop режимах. Проверки на настоящих Windows 10/11 и Linux Desktop в этом этапе не запускались; такую нативную регрессию нельзя считать закрытой по результатам Mac.

Для macOS 15 Sequoia x64/ARM64 и 26 Tahoe ARM64 нет тестовой среды. Реальный login/logout системы с автозапуском, approval/revocation, доставка уведомлений подписанной identity, холодный запуск по ссылке через Launch Services и OS notification click остаются открытыми. Нормальный выход и background проверены; принудительное завершение процесса не гарантирует graceful media.leave.

## Файлы этапа

- `desktop/src/platform/macos-autostart.ts` — новый macOS provider; `platform/autostart.ts` — дополнительная причина состояния.
- `desktop/src/native-shell.ts`, `platform/application-menu.ts` — Dock, badge, меню, lifecycle, общий startup provider.
- `desktop/src/main.ts`, `platform/host-platform.ts` — wiring provider, восстановление окна и сброс отложенного маршрута при identity invalidation.
- `frontend/src/components/desktop/DesktopNativeSettings.tsx`, `platform/desktop-contracts.d.ts` — пояснения автозапуска и состояние approval.
- `desktop/tests/macos-autostart.test.cjs`, `platform-native-shell.test.cjs`, `application-menu.test.cjs` — проверка политики и регрессии.
- `desktop/tests/macos-integration-runner.cjs`, `macos-integration-electron.cjs` — нативная acceptance fixture.
- `desktop/package.json`, `desktop/README.md`, `docs/README.md`, этот отчёт — команда проверки и документация.

Lockfile, зависимости, backend и предыдущие правки вложений сохранены. Коммит, публикация и установка на другие ОС в этот запрос не входили. **Работа остановлена после этапа 5; этап 6 не выполнялся.**
