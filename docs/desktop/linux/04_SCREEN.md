# Этап 04 — демонстрация экрана X11 / Wayland / PipeWire

Дата начала: 18 октября 2026 года. Версия продукта: 0.1.1-beta.

## Аудит и план до изменения кода

Работа выполняется в общем Electron/React/TypeScript проекте Windows/Linux.
Исходное состояние — dirty checkout `963cc020460f3177823a790eda36ea967c44ddb3`
с завершёнными предыдущими этапами. Source identity этапа 03:
`8d266c85b06d3b3095e7e7453504ddd4afd62a8233175e54ba8c4d9400f3c200`, 370 файлов.
Ранее внесённые изменения сохраняются; новый frontend или WebRTC-клиент
не создаётся. Commit, push, упаковка и следующий этап не входят в эту работу.

Фактический путь: `ConferenceMediaClient.startScreen()` вызывает
`getDisplayMedia`; main устанавливает `setDisplayMediaRequestHandler`,
`MediaPermissions` проверяет главное доверенное окно и user gesture,
вызывает `desktopCapturer.getSources`, отправляет renderer opaque IDs и
после выбора повторяет enumeration. Приложение уже освобождает capture
при pagehide/suspend/quit и не даёт Linux loopback audio.

Главный риск для Wayland — повторная enumeration после системного consent.
Electron сообщает, что PipeWire возвращает один выбранный источник;
совместный запрос screen/window обозначает его как window. Второй запрос
не является надёжной проверкой ранее выбранного окна. `useSystemPicker`
в Electron 44 документирован для macOS 15+, поэтому не принимается за Linux API.

План: адаптировать фактический portal путь, сохранив проверки владельца,
user gesture, отмены и актуальности запроса; оставить явный picker X11 и
Windows. Проверить lifecycle экрана в существующем клиенте, ошибки и раннее
завершение дорожки. Добавить точечные regression tests и выполнить реальные
capture проверки на доступных GNOME Wayland ARM64 и X11 x64. Отдельно
отразить GNOME/KDE, multimonitor/DPI, cancel/deny/stop и границы тестовой среды.
Portal security не обходится; системный выбор остаётся частью согласия.

## Источники API

- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [Electron session display handler](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts)
- [XDG ScreenCast portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html)

## Статус

Реализация и production build готовы. Реальные capture проверки прошли на
GNOME Wayland ARM64 и X11 x64 в описанных ниже виртуальных средах.
**Полная матрица приёмки ещё не закрыта**: KDE capture и остальные
дистрибутивы/физические конфигурации не подтверждены.
Финальный snapshot: **374 файла**,
`329bcddf336481665c4ee9628bf0c2d85626f7d1a46c02e5a9b077459829ceab`.
Первый X11 прогон был на `7bdc9a20…`; затем в harness добавлена фиксация
живых настроек дорожки, production код не менялся.
Успешные результаты предыдущего этапа не являются проверкой демонстрации
реального экрана. Evidence сохраняется в ignored
`desktop/artifacts/linux-stage04-20261018/`.

## Изменения

`desktop/src/platform/display-capture.ts` выделяет проверенный путь выбора
для зафиксированных Electron 44.7.1 / Chromium 152.0.7977.149. Условия
сверены с WebRTC `6f37672d358475cd17544121a12494da454d85fb`:
[CreateGenericCapturer и IsRunningUnderWayland](https://webrtc.googlesource.com/src/+/6f37672d358475cd17544121a12494da454d85fb/modules/desktop_capture/desktop_capturer.cc),
[Chromium capture options](https://raw.githubusercontent.com/chromium/chromium/152.0.7977.149/content/public/browser/desktop_capture.cc).
Адаптер принимает консервативное подмножество фактических условий backend:
канонический Wayland с непустым WAYLAND_DISPLAY либо X11 с DISPLAY и без
WAYLAND_DISPLAY. Принудительное Ozone X11 внутри Wayland не превращает
WebRTC в X11 capturer. Неоднозначная среда или другая версия Linux runtime
даёт отказ с сообщением; при обновлении Electron этот адаптер нужно
проверить заново. Windows/macOS сохраняют прежний picker.

В Wayland `MediaPermissions` один раз вызывает настоящий `getSources`
без thumbnails и передаёт выбранный системным порталом источник в callback.
Не принимается произвольный первый X11 источник: путь выбран заранее
по проверенной платформенной политике, результат должен содержать ровно
один ожидаемый window-source. Source IDs и системные названия не передаются
в renderer для повторного выбора. Сохраняются trusted main frame, owner,
user gesture, граница документа и запрет Linux loopback audio.

Отмена, истечение срока, навигация и смена владельца не дают запоздалому
результату начать захват. Незавершённая enumeration удерживает отдельный
внутренний флаг до окончания Promise: Electron объединяет совпадающие
параллельные getSources, поэтому новый запрос не должен получить старое
согласие. Public API Electron не принимает AbortSignal; кнопка отмены
приложения отклоняет его запрос, но закрытие системного диалога может
потребоваться отдельно. Успешный callback(null) сам по себе не доказывает
закрытие portal session; это проверяется отдельно в runtime.

Общий React picker показывает ожидание системного выбора или сообщение
о недоступном сеансе. X11/Windows сохраняют список экранов и окон с opaque
IDs, явный выбор и повторную проверку существования выбранного источника.
Исчезнувшее окно не заменяется другим. Системный звук на Linux не запрашивается
у native capture; интерфейс сообщает, что передаётся изображение.

В существующем ConferenceMediaClient добавлена актуальность screen intent.
Stop, завершение клиента или запрет screen/camera навсегда отменяют старую
незавершённую попытку, даже если позднее запрет снят. Отдельная ревизия для
screen audio не допускает возврат отозванного звука вместе с разрешённым
видео. Проверки стоят после consent и ожидающих операций отправителей;
устаревшие дорожки останавливаются. Новое явное действие создаёт новый запрос.
Кнопка остановки активной демонстрации доступна и при другой ожидающей
операции устройства. Если видео уже завершилось, сообщение не утверждает,
что изображение продолжает передаваться.

## Локальные проверки

| Проверка | Результат | Граница |
| --- | --- | --- |
| Desktop Node suite | **182/182 PASS** | Включая pinned backend policy, portal/cancel/late result и Windows picker policy |
| Frontend media lifecycle | **38/38 PASS** | Compiled ConferenceMediaClient, controlled deferred operations; не OS capture |
| Frontend foundation / assets | **23/23 и 9/9 PASS** | Общие web/desktop contracts; результат до последнего исправления текста screen-ended |
| Форматирование / TypeScript / web production build | PASS | После последнего frontend исправления |
| Общий desktop production build | PASS | Snapshot `329bcddf…`, main/preload + общий React renderer |
| macOS synthetic media/permission integration | PASS | Тестовые источники существующего harness; не Linux portal |

Файловые логи: `native/unit.log`, `native/mac-media-observed-output.json` (транскрипция результата инструмента,
исходный stdout не сохранялся),
`frontend/media-lifecycle.log`, `frontend/check.log`, `production-build.log`, `production-build-final.log`,
`production-macos-smoke.log`. Mac production smoke на `7bdc9a20…` также PASS:
локальный renderer, sandbox/Node isolation, typed IPC, CSP, запрет прямого
внешнего доступа/навигации и отключённые обновления. Последующее изменение
затронуло только evidence harness.
Точные hashes целевых исходников сохранены в `native/source-files-unit.json`
и `frontend/source-hashes.json`. Foundation/assets ранее выводились только
в результаты инструментов, отдельные файлы логов для них не создавались.

## Метод реальных capture проверок

`linux-screen-runner.cjs` / `linux-screen-electron.cjs` запускают production
main/preload с отдельным тестовым профилем и безопасным движущимся изображением.
DesktopCapturer, getDisplayMedia и portal не подменяются; fake capture/UI
и отключение песочницы не используются. В Wayland оператор выбирает источник
через настоящий диалог. Получение кадров проверяется по размерам, изменению
числовых отпечатков, цветам известного изображения и счётчикам. Настоящие
локальные RTCPeerConnection дополнительно кодируют/декодируют поток.
Это проверка capture/RTC, без SFU и production HTTP/WS/auth; ранее проверенный
Pion backend не изменяется. Видеозаписи и сырые кадры не сохраняются.
Fixture использует собственный HTML picker и напрямую вызывает
`getDisplayMedia`/`RTCPeerConnection`; он не исполняет production
`ConferenceMediaClient.startScreen()` и React `DesktopScreenPicker`.
Их новые intent/UI gates проверены compiled lifecycle/contract тестами,
а не сквозным OS звонком в этом этапе.

Тип portal источника отмечается по реальному действию в диалоге;
`displaySurface=window` не доказывает выбор окна: Electron/PipeWire может
так обозначать и монитор. После stop проверяются ended tracks, закрытые
PeerConnection, отсоединённые media elements и отдельно исчезновение
системного индикатора. Виртуальные дисплеи и CPU emulation указываются явно.

## Реальные результаты

Все девять завершённых сценариев ниже использовали финальный snapshot
`329bcddf…`, 374 файла, Electron 44.7.1 / Chromium 152.0.7977.149.
Сводка и пути к каждому JSON: `runtime/runtime-summary.json`.

### Ubuntu 24.04.5 ARM64, GNOME 46 / Wayland

UTM 4.7.5 с нативной ARM64 виртуализацией, kernel 6.8.0-147-generic,
виртуальный дисплей 1280×800; PipeWire 1.0.5, WirePlumber 0.4.17,
xdg-desktop-portal 1.18.4 и GNOME backend 46.2.

| Сценарий | Результат | Наблюдение |
| --- | --- | --- |
| Выбор окна → остановка в приложении | PASS | Выбрано тестовое окно в настоящем GNOME диалоге; меняющиеся кадры и RTC decode, корректное освобождение |
| Выбор полного экрана → остановка в приложении | PASS | Выбран Entire Screen; меняющиеся кадры виртуального экрана и RTC decode |
| Cancel в системном диалоге | PASS | AbortError, ни разрешённого потока, ни кадров |
| Отмена в приложении → поздний Share в системном диалоге | PASS | Результат отвергнут; поток и кадры в renderer не появились, системный сеанс завершился |
| Закрытие демонстрируемого окна | PASS | Настоящий `track.ended`, освобождение треков/RTC; остановка в приложении не нажималась |

Для положительных сценариев проверены local/remote ended tracks, закрытые
PeerConnection и снятые `srcObject`. Public portal session namespace
возвращался из 3 узлов к исходному 1 с совпадающим hash; оператор отдельно
наблюдал исчезновение системного индикатора. При Cancel namespace не рос.
Это совокупность наблюдений, а не вывод только из `callback(null)`.

При позднем Share оранжевый индикатор кратко появлялся. Примерно через
7 секунд public namespace уже совпал с baseline; позднее визуально
подтверждено исчезновение индикатора, приложение так и не получило поток.
GNOME 46 держит индикатор минимум 5 секунд после появления, даже если
захват быстро завершился. Установленный код и ссылки сохранены в
`kde-nested/gnome-indicator-source-notes.json`.

Скриншоты `gnome-*-consent.png`, `gnome-*-stopped.png`,
`gnome-cancelled.png` и `gnome-late-*.png` дополняют JSON в
`runtime/utm-arm64/gnome/`. Отмена диалога не выдаётся за отдельную проверку
постоянного запрета разрешения. Нажатие Stop в верхней панели GNOME
**NOT RUN**: используемый CUA возвращал `noWindowsAvailable` для координатных
нажатий, а обработчик этого индикатора в GNOME 46 требует мышь/касание.
Клавиатура позволила независимо проверить закрытие источника и `ended`.

### Ubuntu 22.04.5 x64, X11

Полносистемный QEMU 9.1.1 TCG, x86_64 kernel 5.15.0-1109-kvm,
glibc 2.35, Xvfb/Openbox. Это настоящие Linux kernel/userspace и X11 capture,
но CPU эмулируется на ARM Mac; результат не заменяет нативный x64 ПК.

Четыре сценария **PASS**: окно и экран при X server DPI 96 и 144.
DesktopCapturer перечислил два screen и два window источника. Выбранное
окно дало реальные кадры 1000×720, выбранный первый виртуальный монитор —
1440×900; проверены изменение изображения, четыре цвета, RTC encode/decode
и очистка. Логи: `runtime/qemu-x64/final-329/x11-two-monitors-*dpi/`.

RandR перечисляет два виртуальных монитора, но Electron `getAllDisplays`
возвращает один объединённый 2880×900 и `scaleFactor=1`. Первоначальные
track settings также могут показывать объединённую ширину, поэтому размер
проверялся по полученным video frames. DPI 144 здесь не означает проверку
физического масштабирования 150%, смешанного DPI или второго выбранного
монитора. Эти случаи остаются открытыми.

### KDE / Wayland

**Capture NOT RUN: ограничение тестовой графики.** Для ограниченной проверки
установлены официальные Ubuntu пакеты KWin 5.27.11, portal-kde 5.27.11 и
Qt Wayland 5.15.13. Полная Plasma не устанавливалась. Nested KWin и portal
работали с отдельными D-Bus/config/runtime каталогами, GNOME login/session
не заменялись.

Штатный nested Wayland OpenGL упёрся в отказ GBM scanout; вариант через
родительское X11 окно — в отсутствие поддержки привязки pixmaps к EGLImages.
Оба приводили к QPainter, тогда как этот KWin ScreenCast требует OpenGL.
Само наличие portal API v5/sourceTypes3 не принято за работающий capture.
Разрешения DRM, настройки VM GPU и защита не ослаблялись; consent/capture
в неподходящем окружении не запускались.

Доказательства: `kde-nested/nested-kde-result.json`, версии/происхождение
пакетов, ошибки compositor и `final-cleanup.json`. Все собственные nested
процессы и временные каталоги убраны; исходные процессы GNOME portal,
его bus owner, ScreenCast v5/sourceTypes7 и HDA defaults сохранены.
Установленные официальные зависимости остаются в VM.

### Песочница и уборка

Для ARM64 и x64 во время захвата отдельно сохранены kernel observations:
renderer `NoNewPrivs=1`, `Seccomp=2`, фильтр активен. Проверены
`sandbox=true`, `contextIsolation=true`, `nodeIntegration=false`,
`webSecurity=true` и отсутствие `--no-sandbox`.
Metadata-only наблюдение не подменяет kernel проверку.

Тестовые профили и capture процессы завершены; отдельный x64 QEMU штатно
выключен после копирования evidence. Ubuntu в UTM остаётся запущенной.
История подготовительных неудач сохранена: macOS AppleDouble sidecars
сначала помешали allowlist проверке installer bundle; они убраны из
staging, архивирование исправлено и все исходные bytes повторно сверены.
Этот сбой не был успешной capture проверкой.

## Приложение в UTM

После проверок обычный MeetSpace обновлён на финальный snapshot и запущен
из `/home/meetspace/meetspace-stage04/desktop` через `/opt/electron/electron .`.
Все 374 исходных файла совпали с manifest; повторная локальная сверка
сохранена в `final-host-source-verification.json`. Старый stage03 процесс
завершён только после визуальной проверки стартового экрана и отсутствия
активного звонка. Его каталог и история результатов сохранены.

Новый запуск использует обычный профиль, без dev/fake/debug/CA и private
audio overrides. Стартовый экран «Подключиться к серверу» проверен через
CUA: `utm-stage04-normal-app.png`. Отдельные тестовые окна и capture
индикатор отсутствуют. `runtime/utm-arm64/normal-final-entry.json` и
`final-cleanup-inventory.json` фиксируют запуск и отсутствие собственных
fixture/probe процессов. Это запуск из собранного checkout; новый Linux
установочный пакет на этом этапе не создавался.

## Повторение проверок

В уже собранном Linux checkout, из `desktop/`, с Node 24 и установленным
Electron нужной архитектуры:

```sh
node tests/linux-screen-runner.cjs artifacts/screen-acceptance window-app-stop
```

Wayland требует реальных действий оператора: Start, выбор тестового окна
в системном диалоге, Share, достаточные меняющиеся кадры, Stop, наблюдение
исчезновения индикатора, Operator, Finish. Для полного экрана используйте
`monitor-app-stop`, для остальных сценариев — `cancel`, `late-choice`,
`window-source-gone`. В последнем закрывается именно окно Pattern.
Таймаут одного сценария 240 секунд. X11 fixture допускает `--auto-x11`
только в настоящем X11 окружении без WAYLAND_DISPLAY и выбирает безопасный
источник своего тестового окружения. Песочницу и portal consent отключать
не нужно. Полные environment wrappers сохранены рядом с runtime evidence.

## Матрица приёмки

| Система | X11 | Wayland |
| --- | --- | --- |
| Ubuntu 24.04 LTS x64 | NOT RUN | NOT RUN |
| Ubuntu 22.04 LTS x64 | PASS в full-system QEMU TCG + Xvfb/Openbox; физический ПК NOT RUN | NOT RUN |
| Debian 12 x64 | NOT RUN | NOT RUN |
| Debian 13 x64 | NOT RUN | NOT RUN |
| Linux Mint 22 x64 | NOT RUN | NOT RUN |
| Fedora Workstation 44 x64 | NOT RUN | NOT RUN |
| Ubuntu 24.04 LTS ARM64 | NOT RUN | GNOME 46 PASS в UTM native ARM64; KDE capture NOT RUN |

Windows 10 22H2 x64, Windows 11 x64 и Windows 11 ARM64 остаются целями
общего проекта. Их native runtime в этом этапе **NOT RUN**;
unit проверки Windows policy не подменяют запуск Windows. В общем коде
сохранены Windows picker и revalidation, а изменения screen lifecycle
покрыты общими regression тестами. Windows VM и её установка не менялись.

## Остаточные риски и границы

- Нужны рабочий KDE Wayland desktop и оставшиеся ОС матрицы; отсутствие
  готовой графической среды не означает дефект или совместимость приложения.
- Не проверены физические несколько мониторов, выбор второго монитора,
  mixed/fractional DPI, hotplug/rotation и разные GPU/драйверы.
- Реальный постоянный permission deny, Stop через системную панель и
  длительные циклы start/stop остаются отдельной приёмкой. Unit tests
  cancellation/denial не считаются OS проверкой.
- Linux демонстрация передаёт изображение; системный loopback audio
  намеренно недоступен. Микрофон звонка остаётся отдельной дорожкой.
- Linux backend policy привязана к проверенному runtime. Обновление
  Electron требует повторного аудита; иначе capture будет недоступен.
- Отмена приложения не может принудительно закрыть ожидающий системный
  диалог через public Electron API. Позднее согласие отвергается, следующий
  запрос ждёт завершения предыдущей enumeration. Upstream restore token
  может оставаться в памяти процесса; приложение не передаёт его renderer
  и не сохраняет. Это не доказательство скрытого продолжающегося захвата.
- Реальные screen тесты проверяют capture и локальное RTC кодирование,
  а не текущий сквозной звонок через Pion/SFU. Production backend и аккаунты
  в этих тестах не использовались.

Следующий этап автоматически не начинается. Новая версия/установщик,
commit и публикация не выполнялись.
