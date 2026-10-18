# MeetSpace Desktop

Текущая версия продукта — **0.1.1 beta** (`0.1.1-beta` в package metadata и именах установщиков). Новая нумерация выпусков начинается с `0.1.0-beta`. Предыдущие сборки `0.7.x` относятся к прежней технической нумерации.

Electron 44.7.1, общий React/TypeScript/Vite из `../frontend`, Windows x64 и нативный ARM64. Это предварительная тестовая сборка. На первом запуске выберите HTTPS-сервер: приложение проверяет `/version`, `/api/v1/auth/me` и `/api/v1/capabilities`, затем открывает существующие страницы входа и регистрации. Встречи, чаты, группы, папки и настройки используют общий интерфейс и реальные REST/WebSocket/SSE-контракты. Камера, микрофон и звонки используют существующий Pion/SFU-клиент через Chromium. Добавлены системный трей, сохранение положения окна, системные уведомления, Save dialog и потоковый просмотр записей. При демонстрации приложение предлагает выбрать экран или окно; системный звук на Windows включается отдельно.

Linux x64/ARM64 использует тот же проект и интерфейс. Каркас Linux добавлен на этапе 02; полная совместимость дистрибутивов, интеграция рабочего стола и установочные пакеты ещё проходят отдельные этапы. [Аудит](../docs/desktop/linux/01_AUDIT.md), [адаптация платформы и результаты проверок](../docs/desktop/linux/02_PLATFORM.md).

## Установка собственного сервера

В окне выбора сервера нажмите «Установить сервер по SSH». Мастер проверяет отпечаток хоста, доступ, Ubuntu, ресурсы и порты, затем получает подписанный план установки. Запуск требует явного подтверждения плана, условий Let’s Encrypt и установки Docker, если он нужен. После отключения SSH задание продолжает работать на сервере; приложение сохраняет публичную карточку для проверки состояния и продолжения. Пароль, SSH-ключ и парольная фраза не записываются на диск.

Используется проверенный подписанный установщик из Android-репозитория. Поддерживаются Ubuntu 22.04/24.04, x64/ARM64, root или sudo без пароля и отдельный публичный домен с IPv4. [Протокол, источник и ограничения](../docs/desktop/SSH_INSTALLER_REFERENCE.md).

## Подготовка и запуск

Нужен Node.js 24.15+ в ветке 24 либо поддерживаемая ветка 26+. Из корня репозитория:

```sh
npm --prefix frontend ci
npm --prefix desktop ci
npm --prefix desktop run dev
```

Dev launcher запускает собственный Vite на `127.0.0.1:5173`, генерирует CSP nonce и затем открывает Electron. Занятый порт приводит к отказу; оболочка не подключается к произвольному существующему серверу. HTTP используется только для этого явно включённого локального режима разработки. Для обычного запуска:

```sh
npm --prefix desktop run build
npm --prefix desktop start
```

Production renderer обслуживается из `desktop/renderer` через `app://meetspace`; он собирается из тех же frontend-исходников. `frontend/dist` для веб-версии и `frontend/dist-desktop` независимы. Обычный web build:

```sh
npm --prefix frontend run build
```

### Запуск под Linux

Используйте обычного пользователя в графической сессии с системными зависимостями Electron и доступным GNOME Keyring либо KWallet. Хранилище ключей должно быть разблокировано. Если Electron выбирает `basic_text` или неизвестный backend, вход с сохранением сессии отклоняется; приложение не переходит к незашифрованному хранению. Настройка `--password-store=basic` не является поддерживаемым способом запуска.

Команды `ci`, `dev`, `build` и `start` выше одинаковы для Windows и Linux. На ARM64 устанавливайте зависимости с ARM64-версией Node.js; не переносите `node_modules` с x64 или macOS. Запускайте Electron с работающей системной песочницей, без `--no-sandbox` и других отключающих её флагов. Контейнер или Xvfb полезен для автоматических проверок, но не подтверждает работу конкретного Linux Desktop.

На Wayland приложение сохраняет размер окна, а размещением управляет композитор. Скрытие в трей Linux можно включить после регистрации значка MeetSpace в работающем StatusNotifier/AppIndicator host. Нужен `/usr/bin/busctl` для проверки регистрации. Если host недоступен, закрытие окна завершает приложение; при потере host скрытое окно возвращается. Поддержка одного GtkStatusIcon/XEmbed не считается проверенным треем.

Автозапуск Linux включается только пользователем в установленном приложении с постоянным executable. MeetSpace управляет только собственным XDG autostart desktop-файлом, не перезаписывает чужую настройку и не добавляет её при обычном запуске. Для AppImage используется исходный файл образа, а не временная точка монтирования; после перемещения файла настройку нужно проверить заново. Путь с символом `%` не регистрируется из-за ограничения системного запускателя GIO. В режиме разработки `electron .` автозапуск недоступен. [Изменения и результаты этапа 05](../docs/desktop/linux/05_INTEGRATION.md).

Захват системного звука при демонстрации и автоматические обновления Linux пока не включаются. Windows сохраняет существующие настройки трея, автозапуска и обновлений.

Камера, микрофон и воспроизведение звонка используют существующий Chromium/Pion-клиент и доступные устройства PipeWire/PulseAudio. Выбранный выход проверяется заново при изменении устройств; недоступная гарнитура не считается успешно выбранной только из-за результата `setSinkId`. После сна камера и микрофон в личном звонке требуют явного повторного включения. [Изменения и реальные результаты этапа 03](../docs/desktop/linux/03_MEDIA.md).

Локальный SFU-тест теперь проверяет 2, 3, 4 и 5 участников напрямую и через TURN, вход новых участников, leave/rejoin и cleanup. Нужны Go и системные зависимости Electron; тест использует синтетические camera/mic и не обращается к рабочему серверу. Отдельная Linux audio-проверка требует графической сессии, PipeWire/Pulse compatibility, WirePlumber 0.4 и `pulseaudio-utils`; создаёт временный изолированный audio server и проверяет настоящий PCM без физических устройств:

```sh
npm --prefix desktop run test:sfu
node desktop/tests/linux-audio-runner.cjs /absolute/path/to/audio-evidence
```

Сначала выполните обычную сборку проекта. Полная матрица ОС, Bluetooth, драйверы и качество звука не подтверждаются одной сборкой или виртуальными устройствами.

В X11 источник демонстрации выбирается в окне MeetSpace. В Wayland выбор выполняет системный портал через PipeWire; нужен работающий `xdg-desktop-portal` и ScreenCast backend рабочего стола (GNOME или KDE). Приложение использует результат этого выбора один раз. Если запрос отменён, его запоздалый результат не начинает демонстрацию. Системный диалог может потребовать отдельной отмены: Electron не предоставляет API для прерывания ожидающего `getSources`.

Определение Linux capture backend проверено для Electron 44.7.1 / Chromium 152.0.7977.149. При обновлении Electron необходимо заново проверить `src/platform/display-capture.ts`: неизвестный runtime или неоднозначный тип сессии не получает автоматический выбор источника. Наличие одного источника в X11 не считается согласием системного портала. [Реализация и результаты этапа 04](../docs/desktop/linux/04_SCREEN.md).

## Проверки и тестовые установщики

```sh
npm --prefix frontend run check:desktop-foundation
npm --prefix frontend run check:desktop-media
npm --prefix frontend run check:desktop-assets
npm --prefix desktop test
npm --prefix desktop run test:smoke
npm --prefix desktop run test:ssh
npm --prefix desktop run test:integration
npm --prefix desktop run test:platform
npm --prefix desktop run test:ui
npm --prefix desktop run test:headers
npm --prefix desktop run test:media
npm --prefix desktop run test:sfu
npm --prefix desktop run test:native
npm --prefix desktop run test:product
npm --prefix desktop run test:assets
node desktop/scripts/dev.mjs --smoke
npm --prefix desktop run pack:win
npm --prefix desktop run verify:artifacts
```

Также доступны `pack:win:x64` и `pack:win:arm64`. Установщики, JSON-проверки и SHA-256 лежат в `desktop/artifacts`:

- `MeetSpace-0.1.1-beta-win-x64-test-setup.exe`
- `MeetSpace-0.1.1-beta-win-arm64-test-setup.exe`

Установщики **не подписаны**, явно помечены `MeetSpace Test`, предназначены для внутренней проверки и не публикуются. Проверяется фактический PE payload и содержимое ASAR, извлечённые из установщика; имя файла само по себе не считается подтверждением ARM64. На macOS/Linux возможна cross-сборка; она не подтверждает install/uninstall и работу приложения на Windows.

`test:smoke` автоматически пересобирает renderer, поэтому упаковка выполняется после него. Dev smoke запускает/завершает собственный Vite и проверяет реальный Electron с nonce. Полный список результатов и платформ находится в отчёте.

`test:assets` требует FFmpeg для генерации своего синтетического H.264/AAC клипа и проверяет native HTTPS/app Range без обращения к рабочему серверу. Дополнительный `electron tests/assets-development-electron.cjs` проверяет этот поток через настоящий main/preload с собственным временным HTTP fixture на фиксированном dev-порту 5173; занятый порт приводит к отказу. Эти fixtures, тестовые CA и клипы не входят в installer.

Этап 06 добавляет три Windows workflows: unsigned x64/native ARM64 build, protected signed candidate и отдельную disposable Windows acceptance matrix. Они подготовлены локально; GitHub CI ещё не запускался. Упаковка использует закреплённые зависимости, fingerprint точных source bytes и `SOURCE_DATE_EPOCH` (по умолчанию время исходного commit). Build time в metadata означает выбранную source epoch, время фактической проверки записывается отдельно. Подпись с timestamp не заявляется побайтово воспроизводимой. Лицензия приложения пока `UNLICENSED`; third-party notices и Electron/Chromium лицензии входят в установщик и проверяются независимо.

Для unsigned повторяемости NSIS не сохраняет даты временных файлов, год copyright закреплён, даты package нормализованы, compression override окружения очищается. Найденная гонка порядка двух translation includes в builder 26.17.0 исправляется минимальным tracked transform при подготовке build. Полный hash upstream/patched файла и версия проверяются до изменения: другой compiler source приводит к отказу. Provenance содержит отдельное `builderPatch` evidence. Runtime Electron и зависимости приложения этим исправлением не меняются; обновление builder требует новой проверки patch. [Обоснование и эксперимент](../docs/desktop/06_NSIS_REPRODUCIBILITY_FIX.md).

Текущий update trust строго `{ "enabled": false }`: обновления не обращаются в сеть и явно отключены в настройках. Подписанный candidate собирается только нативно на Windows из чистого committed checkout с отдельно проверенной конфигурацией:

```sh
node desktop/scripts/package.mjs x64 --signed <absolute-reviewed-config.json>
node desktop/scripts/package.mjs arm64 --signed <absolute-reviewed-config.json>
```

Оба запуска выполняются на соответствующих native runners. Ключи находятся вне checkout; production fuses запрещают Node environment/inspect и требуют ASAR integrity. Main updater использует отдельный фиксированный HTTPS feed, Ed25519 manifest, SHA-512, точный publisher/certificate и Authenticode timestamp. Проверка metadata автоматическая; download/install явные. Установка завершает звонок, закрывает приложение и требует повторного запуска после завершения установщика. Ни выбранный backend, ни renderer не меняют доверие или feed.

`npm --prefix desktop run release` без настроенного доверия и полной приёмки завершается отказом. После проверки обоих signed installers и трёх реальных Windows targets `release.mjs` может подготовить подписанный feed только локально; публикации и remote deployment в скриптах нет. Форматы, команды и ограничения: [CI instructions](scripts/ci/README.md), [update protocol](../docs/desktop/06_UPDATE_PROTOCOL.md), [Windows signing/acceptance](../docs/desktop/06_SIGNING_WINDOWS_ACCEPTANCE.md).

## Linux: пакеты и обновления

Общий проект собирает внутренние тестовые DEB amd64/arm64, RPM x86_64 и
AppImage x86_64. Запускайте на Linux соответствующей архитектуры:

```sh
npm --prefix desktop run pack:linux:x64
npm --prefix desktop run pack:linux:arm64
```

Вывод: `desktop/artifacts/linux/<version>/<sourceTreeSha256>/<arch>/`.
Существующий итоговый каталог не перезаписывается. Verifier читает настоящие
архивы, проверяет ELF/GLIBC, ASAR, desktop entry, значки, лицензии, sandbox
и SHA-256/SHA-512. Сборка не подтверждает полную совместимость дистрибутивов.
Linux CI использует Ubuntu 22.04 x64 и native Ubuntu ARM64; отдельный Fedora
container job проверяет только пакетный install/reinstall/remove, без запуска
Electron в контейнере. Реальные запуски GitHub и результаты VM фиксируются
отдельно в [отчёте Linux этапа 06](../docs/desktop/linux/06_RELEASE.md).

DEB/RPM обновляются пакетным менеджером из проверенного локального файла;
репозиторий APT/DNF пока не настроен. Встроенное обновление AppImage выключено.
Launcher никогда не добавляет `--no-sandbox`: при невозможности изоляции
приложение завершится с ошибкой. Никаких изменений sysctl/AppArmor для запуска
не требуется и упаковщик их не выполняет. Номер версии приложения сохранён.

## Воспроизводимые проверки жизненного цикла

Сначала соберите текущее приложение. До изменения runtime сохраните baseline; после исправления и повторной сборки выполните тот же профиль с `after`:

```sh
npm --prefix desktop run build
npm --prefix desktop run test:profile -- baseline
npm --prefix desktop run test:lifecycle
npm --prefix desktop run test:media-lifecycle
# После изменения и повторной сборки:
npm --prefix desktop run test:profile -- after
node desktop/tests/stage07-heap-summary.mjs baseline
node desktop/tests/stage07-heap-summary.mjs after
```

`test:profile` проверяет 100 открытий/закрытий чата в общем React UI и 100 циклов native WSS/SSE, собирает main/renderer heap snapshots после GC, процессные метрики и macOS file descriptors. Fixture-сервер работает в отдельном процессе; реальные пользовательские аккаунты не используются. `test:lifecycle` проверяет 100 циклов native services с явно указанными адаптерами. `test:media-lifecycle` требует Go и проверяет настоящий локальный Pion/Chromium с синтетическими устройствами. Снимки памяти содержат тестовые идентификаторы и остаются только в ignored `artifacts`; отчёты не выводят их строки.

Профили нужно запускать последовательно, чтобы другие тестовые Electron-процессы не искажали CPU/память. Значения CPU зависят от нагрузки машины и не являются Windows benchmark. Наличие работающей Windows VM позволяет дополнить runtime matrix, но её устройства/GPU не заменяют физическую аппаратную приёмку. [Итоговый отчёт](../docs/desktop/07_FINAL_OPTIMIZATION_QA.md).

## Границы безопасности и ограничения выпуска

- Renderer: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `webSecurity:true`; локальная CSP без remote scripts, `unsafe-inline` и `unsafe-eval`.
- Preload v6 предоставляет ограниченный typed IPC: профили серверов, разрешённые REST-операции, два типа WebSocket, один фиксированный SSE endpoint, выбор источника демонстрации, локальные настройки, контекст уведомлений, операции файлов по серверным ID, мастер SSH и пять операций updater без аргументов. Сведения о платформе включают тип Linux-сессии, состояние защищённого хранилища и доступные возможности. Main проверяет аргументы, активное окно и главный frame. Общего filesystem/network/command IPC нет; renderer не задаёт произвольные URL, локальные пути, cookies, Authorization и заголовки для native операций.
- Native broker обращается только к выбранному HTTPS-origin. HTTP использует Chromium networking в отдельной непостоянной session; WSS использует pinned pure-JS `ws` с проверкой TLS и сертификатов системы. Redirect запрещён. Прямые запросы renderer к серверу закрыты, как и remote scripts, popup/webview и downloads.
- Access JWT и WS tickets остаются в main. Renderer получает только случайный временный маркер текущей личности. Persistent HttpOnly cookies хранятся отдельно для каждого origin в `sessions.encrypted`, зашифрованном Electron safeStorage (DPAPI на Windows); пароль не сохраняется. Plaintext fallback запрещён. Это защита хранения, а не защита от любого процесса того же пользователя.
- В `servers.json` сохраняются только адрес, название и метаданные версии. Смена сервера очищает активную личность, отменяет запросы и соединения, пересоздаёт React Query/AuthProvider. Кнопка выбора сервера доступна также на страницах входа и ошибки подключения. Выход сначала удаляет локальную авторизацию; при недоступном сервере отзыв persistent session ставится в зашифрованную очередь.
- Существующий backend принимает native запросы без Origin/Fetch Metadata. Private native session удаляет автоматически добавляемые Chromium `Sec-Fetch-*` только у активных main-запросов; renderer и неожиданный Origin блокируются. Подмена Origin, добавление `app://` в browser allowlist и ослабление CORS не нужны. Браузерные same-origin/WS проверки сохранены. `npm --prefix desktop run test:probe` отдельно проверяет рабочий сервер read-only GET/POST без входа и credentials; обычный test не зависит от него.
- `meetspace://open/i/<code>` принимает безопасный 32-символьный код приглашения; `meetspace://open/meetings/<UUID>/join` и `conferences` ведут на существующий prejoin. Single-instance открывает скрытое окно, маршрут сохраняется при загрузке renderer и входе; токенов/адресов серверов в deep link нет.
- Камера/микрофон разрешены только главному документу доверенного приложения. Захват экрана требует пользовательского действия и явного выбора источника; ID источников одноразовые, таймаут 60 секунд. При уходе, смене профиля и сне захват/ожидающие запросы освобождаются. Нет production mocks, фиктивных звонков и offline-встреч.
- При закрытии окно по умолчанию завершает приложение; опция сворачивания в трей включается во вкладке «Приложение». В трее есть явный выход. Системные уведомления получают только авторизованные события broker, учитывают category preferences, read/mute и текущий чат. Текст фиксированный, browser toast/sound не дублируется; logout/смена сервера закрывают старые уведомления.
- Файлы сохраняются через системный диалог по заново проверенным server IDs, с потоковой записью и пределом 2 ГиБ. Записи просматриваются через непрозрачный app URL и потоковый Range proxy; полной записи в кэше нет, доступ перепроверяется сервером. Отмена/logout/смена сервера/quit отзывают операции и URL. Поддержан S3 SigV4 HTTPS и authenticated conversation content по фактическому контракту.
- Автозапуск Windows включается только явно в установленном приложении. OAuth с возвратом в desktop остаётся отдельной работой; подписанный выпуск ждёт реальной подписи, feed и Windows приёмки. Управление серверной записью использует существующий REST API.
- Исправление backend сохраняет worker `iceTransportPolicy`/`iceExpiresAt` в событии `media.joined`; оно ещё не развёрнуто. Для серверного forced relay нужен выпуск исправления. Локальный `test:sfu` запускает настоящий Pion SFU и TURN с синтетическими устройствами, без DB/Redis и без обращения к рабочему серверу. Он требует установленный Go. Windows loopback, физические устройства и ARM64 Windows этим тестом не подтверждаются.
- HTTP и WSS используют разные сетевые реализации: поведение корпоративных proxy/VPN и доверенных CA необходимо отдельно проверить на Windows. Автоматическая авторизация на proxy в этой версии не реализована.

Обязательные targets: Windows 10 22H2 x64, Windows 11 x64, Windows 11 ARM64 native. Windows 10 ARM64, Windows 7/8/8.1 и x86 исключены из начального объёма. Runtime guard проверяет build/architecture; фактическая совместимость подтверждается только запуском на каждой целевой системе. Подробные результаты: [отчёт этапа 06](../docs/desktop/06_INSTALLERS_CI_RELEASE.md), [этап 05](../docs/desktop/05_PRODUCT_NATIVE.md), [этап 04](../docs/desktop/04_WEBRTC_MEDIA.md), [этап 03](../docs/desktop/03_SERVER_AUTH_REALTIME.md), [этап 02](../docs/desktop/02_FOUNDATION.md).

## Обновлённый дизайн 0.7.1

Общая React-оболочка адаптирована к макету из «Архив 2.zip»: светлая навигация, синяя палитра, встречи, чаты, папки, записи, календарь, настройки и звонки. Реальные API, авторизация и native bridge сохранены. Данные и JavaScript демонстрационного макета не входят в приложение.

Визуальная проверка production renderer с локальным HTTPS fixture: `node desktop/tests/design-v2-runner.cjs` после сборки, из корня репозитория. Снимки и результаты — `desktop/artifacts/design-v2/`.

## Фирменные значки 0.7.2

Все 17 индивидуальных SVG из предоставленного набора `MeetSpace-SVG` от 16 октября 2026 года находятся в `frontend/public/branding/`. Общие логотипы используют варианты для светлой и тёмной поверхности; шапка и боковая панель — цветной знак. Версия URL обновлена для сброса кэша изображений. Старые адреса значков сохраняются как копии новых файлов.

Синий `meetspace-app-blue.svg` используется для favicon, окна, трея, системных уведомлений, Windows EXE, установщика, удаления и ярлыков. `desktop/resources/icon.png` содержит изображение 512 × 512; `icon.ico` — размеры 16, 24, 32, 48, 64, 128 и 256 с прозрачностью. Происхождение и контрольные суммы записаны в `resources/icon-source.json`. Результаты проверки и предпросмотр — `artifacts/brand-20261016/`.
