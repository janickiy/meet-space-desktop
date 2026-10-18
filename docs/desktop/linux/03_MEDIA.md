# Этап 03 — WebRTC, камера, микрофон и аудиоустройства Linux

Дата: 18 октября 2026 года. Версия продукта: **0.1.1-beta**.

## Объём и аудит перед изменениями

Задание — предоставленный `CODEX_LINUX_03_MEDIA.md`. Работа выполняется
в том же Electron/React/TypeScript Desktop-проекте. Используется существующий
`ConferenceMediaClient` и настоящий Pion/SFU из репозитория; отдельный Linux
frontend или новый WebRTC-клиент не создаётся. Упаковка и Linux screen capture
через порталы не входят в этот этап.

Исходное состояние — dirty checkout
`963cc020460f3177823a790eda36ea967c44ddb3`, snapshot этапа 02
`1460283cd9f157586446fb4135707fb4535e38b5dddcb2cc9abfbc6c1c42aefa`.
Ранее сделанные изменения SSH-установщика и Linux-каркаса сохраняются.
Финальная source identity: **370 файлов**,
`8d266c85b06d3b3095e7e7453504ddd4afd62a8233175e54ba8c4d9400f3c200`.
Полный manifest — `desktop/artifacts/linux-stage03-20261018/source-inputs.json`,
он совпадает с `desktop/dist/source-inputs.json` production build.
Версия Electron — 44.7.1. Commit, push и публикация не выполняются.

Перед кодом проверены:

- `desktop/src/media-permissions.ts`, session handlers в `main.ts`,
  desktop suspend/resume и закрытие приложения;
- общий клиент `frontend/src/media.ts`, prejoin, previews, настройки
  устройств и воспроизведение входящего звука;
- существующие media/lifecycle fixtures, настоящий Pion и локальный TURN;
- фактические устройства и audio services установленной Ubuntu в UTM.

Разрешения Electron уже ограничены доверенным главным документом текущего
главного окна. Проверяются camera/microphone и speaker-selection; чужие
окна, iframe, удалённые origins и запросы вне документа отклоняются.
Linux не использует Windows/macOS-only API системных разрешений.
`unknown` media check и пустой `mediaTypes` для display preflight сохраняются:
их нельзя запрещать по неподтверждённым предположениям.

Существующая сигнализация передаёт SDP, ICE и TURN в общий клиент. Очередь
изменения источников, закрытие PeerConnection, остановка незавершённого
захвата, серверные ограничения и освобождение при suspend уже реализованы.
Пробелы обнаружены в гонках выбора аудиовыхода, обновлении после devicechange,
обработке отсутствующего выбранного устройства и раннем завершении дорожки
до ответа media.joined.

План перед реализацией: исправить подтверждённые ошибки в общем клиенте,
добавить focused negative/race tests, расширить реальные permission checks,
проверить Pion с 2–5 участниками, прямым ICE и forced TURN, leave/rejoin и
cleanup. Подтвердить программный Linux audio path отдельно от оборудования.

## Реализованные изменения

Общий `frontend/src/mediaDevices.ts` задаёт одни и те же ограниченные
capture constraints для существующего клиента, prejoin и previews.
Повторная попытка с system default допускается только для выбранного
недоступного устройства (`NotFoundError`/`OverconstrainedError`) в ещё
актуальном запросе. Отказ в доступе и занятое устройство не превращаются
в молчаливый retry. Combined camera+microphone initial capture policy
и серверные videoCapture limits сохраняются.

Камера/микрофон отслеживаются до `media.joined`. Если устройство отключается
при первоначальном входе либо во время ожидающего `replaceTrack`, завершающаяся
операция не публикует ended track: source/sender/local stream очищаются,
состояние становится выключенным, пользователь получает фиксированное
сообщение. Предпросмотр в настройках не начинает новый захват только из-за
обновления enumeration после unplug. Повторное включение требует действия
пользователя; mute, moderation и dispose остаются границами pending операций.

Маршрутизация звука сериализована отдельно для каждого HTMLMediaElement.
Старый pending `setSinkId` завершается до нового выбора, а его запоздалый
отказ не сбрасывает новый sink. `devicechange` повторно применяет текущий
выбор; недоступный выход даёт ограниченный fallback на default с сообщением
в UI и без перезаписи предпочтения. Неудавшийся тест конкретной гарнитуры
не воспроизводит тон на другом устройстве под видом успешной проверки.
Начальное воспроизведение remote stream также ждёт подтверждённого
выхода: новый `remotePlayback.ts` сначала mute/pause/attach, затем routing,
и только актуальный selected/fallback допускает unmute/play. Ручной retry
после autoplay-block не обходит незавершённый или неуспешный routing;
устаревшая операция/dispose не включает звук. Local preview остаётся muted.
Это предотвращает короткое воспроизведение через default до выбора гарнитуры.

Повторно используемый web notification player корректно возвращается
с явного sink на system default; смена предпочтения отменяет pending
воспроизведение на старом выходе. Desktop no-op для web notification sound
сохраняется.

В личных звонках найдена отдельная privacy regression: новый connectionId
автоматически запускал прежние desired camera/microphone после suspend.
`subscribeCaptureIntentRelease` использует существующие validated lifecycle
события и сбрасывает только эти два input intents при suspend/pagehide/quit.
Обычный сетевой reconnect сохраняет прежний mute, resume не включает capture,
а последующее явное включение пользователя работает. Regression test
использует настоящий ConferenceMediaClient с тем же preference/intent merge.

Расширены существующие media permission и runtime tests. Production
`MediaPermissions`, main/preload, SDP/ICE/signaling и backend SFU не менялись:
аудит не выявил основания расширять полномочия или писать Linux native addon.
В Electron 44 optional `navigator.permissions.query({name:'speaker-selection'})`
может дать TypeError unsupported; это записывается отдельно от работающего
`HTMLMediaElement.setSinkId`. Экспериментальные флаги для обхода этого
ограничения не включаются.

Два дополнительных дефекта найдены независимой проверкой с deferred
browser operations: unplug во время `replaceTrack` и смена output preference
во время подготовки notification. Исходные reproductions сохранены; после
исправления sender/local не удерживают ended track, transceiver становится
recvonly, а старое уведомление не воспроизводится. Это проверяет код гонок,
но не физическое отключение USB.

## Локальные проверки исходников

| Проверка | Результат | Граница |
| --- | --- | --- |
| Desktop Node tests | **171/171 PASS** | Включая Linux/Windows permission policy; не Windows runtime |
| Frontend format/TypeScript/web production build | PASS | Общий web/desktop исходный интерфейс |
| Frontend media lifecycle | **32/32 PASS** | Настоящий compiled client с управляемыми browser stand-ins и deferred race cases |
| Frontend foundation | **23/23 PASS** | Включая прежние web-notification и desktop contract checks |
| Frontend assets | **9/9 PASS** | Общие assets и media ownership |
| Go media usecase | PASS, cached | Другие выбранные backend packages не содержат unit tests; не SFU runtime proof |
| Media Electron на macOS ARM64 | PASS | Настоящие permission/session/IPC и synthetic capture; output API без физического playback |
| Финальный production build | PASS | Общий main/preload и desktop renderer, source `8d266c85…` |
| Финальный production smoke на macOS ARM64 | PASS | Source `8d266c85…`: sandbox/isolation, IPC, CSP, URL/network boundaries, theme/zoom/reload/deep link; не Windows runtime |

Логи находятся в ignored `desktop/artifacts/linux-stage03-20261018/`.
Итоговая source identity и Linux runtime результаты привязаны отдельно.
Frontend/node тесты не считаются проверкой
драйверов или системного аудиосервиса.

## Linux audio и границы среды

В Ubuntu 24.04 ARM64 UTM работают GNOME Wayland, PipeWire, pipewire-pulse и
WirePlumber. При исходной инвентаризации `/dev/snd` содержал только seq/timer,
ALSA PCM/control cards и `/dev/video*` отсутствовали. Физическая камера,
микрофон, динамики и Bluetooth-адаптер первоначально гостю не предоставлены.
Пользователь уточнил, что располагает встроенными устройствами MacBook,
а не USB-камерой/гарнитурой. UTM не захватывает встроенные Apple webcams
через USB sharing: [официальное ограничение UTM](https://docs.getutm.app/guest-support/sharing/usb/).

В host QEMU command line обнаружена уже настроенная `intel-hda` +
`hda-duplex` через SPICE. Guest PCI видит Intel ICH6 `[8086:2668]`, но
при исходном аудите драйвер `snd_hda_intel` отсутствовал: cloud image не
содержал соответствующий `linux-modules-extra` для текущего kernel.
Это отдельная проблема подготовки тестовой ОС, а не Electron permission
или доказательство отсутствия поддержки Linux audio. Установлен официальный matching
`linux-modules-extra-6.8.0-147-generic` версии **6.8.0-147.147**, модуль
`snd_hda_intel` загружен. ALSA card0 HDA Intel получила capture/playback PCM,
а общая desktop PipeWire-сессия — Built-in Audio Analog Stereo / Analog
Stereo Duplex. VM hardware, host defaults, privacy settings и sandbox policy
не менялись. Установка драйвера — подготовка этой VM, а не автоматическая
системная установка из приложения. Автоматическая загрузка драйвера после
отдельного следующего reboot в этом этапе не проверялась.

Приложение использует Chromium WebRTC и стандартные browser device API.
Вмешательство в системный audio backend не требуется: PipeWire предоставляет
[совместимый PulseAudio server](https://docs.pipewire.org/page_module_protocol_pulse.html).
Профили Bluetooth управляются ОС/BlueZ/WirePlumber; приложение не меняет
кодеки, A2DP/HFP profiles или системную конфигурацию. Основание:
[официальная документация WirePlumber](https://pipewire.pages.freedesktop.org/wireplumber/daemon/configuration/bluetooth.html).

Синтетические Chromium devices проверяют медиадвижок и клиент; виртуальные
PipeWire sources/sinks проверяют взаимодействие Chromium с audio service.
Ни один из этих способов не подтверждает драйверы, качество физического звука,
Bluetooth duplex, echo cancellation на реальной гарнитуре или USB hotplug.

## Linux runtime результаты

| Проверка | Результат | Среда и точная граница |
| --- | --- | --- |
| Pion/SFU 2, 3, 4, 5 peers, direct + forced TURN ARM64 | **8/8 PASS** | Ubuntu 24.04 ARM64 UTM, GNOME Wayland, synthetic Chromium camera/mic |
| Pion/SFU 2, 3, 4, 5 peers, direct + forced TURN x64 | **8/8 PASS** | Ubuntu 22.04 full-system QEMU TCG, X11/Xvfb, настоящий x86-64 kernel; CPU emulated |
| Каждый peer получает остальных n−1 | PASS | Opus bytes и decoded VP8 frames отдельно для каждого remote track |
| Late join, stop/leave/rejoin | PASS | Новый mediaPeerId/PeerConnection, свежий входящий RTP и рост счётчиков всех текущих streams |
| SFU/TURN cleanup | PASS | ended tracks, closed PCs, нулевые rooms/peers/tracks/subscriptions/allocations |
| Linux permission/lifecycle ARM64 и x64 | PASS | Настоящие main/preload/session, synthetic capture/stop, owned/foreign/subframe, native IPC suspend/resume и reconnect |
| Linux OS audio | PASS | Настоящий изолированный PipeWire/Pulse/WirePlumber, виртуальные source/sinks, без fake media flag |
| Remote playback controller и PCM | PASS | Настоящий HTMLAudioElement: pending route остаётся muted/paused, dispose исключает late playback, ack даёт реальный PCM |
| Встроенный микрофон через HDA/SPICE | PASS, сигнал | Exact HDA input, real capture без fake flags, bounded 20 с, только RMS/peak; качество речи не оценено |
| Однократный выходной test tone | API/ended и слышимость PASS | Production helper, volume 25%, play ровно один раз; пользователь подтвердил слышимость в динамиках MacBook |
| Финальная обычная сборка в UTM | PASS | Source `8d266c85…`, native ARM64 build, GNOME Wayland, визуально проверен экран подключения; без test flags и внутренних UI observers |

Оба полных SFU-прогона и Linux native media permission harness относятся к
snapshot `827da86ae56dd96ff12f686a169601aa2793f58d15cd42e1b5a69f7eb3ef0129`
(369 файлов). Сравнение с финальным snapshot: SFU `media.ts`, main/preload,
Go fixture и backend не изменились. Позднее менялись routing/controller,
notification/DirectCall lifecycle UI, audio tests, frontend tests и README.
Эти suite не выдаются за повтор всех тестов на финальном hash. Пофайловая
identity и case JSON сохраняются в `runtime/utm-arm64/sfu/`,
`runtime/qemu-x64/sfu/` и `runtime/qemu-x64/sfu-3-5/`. Backend driver связан с 265 исходными файлами,
`go.mod`/`go.sum` и production Pion; SHA
`a4d015350e6415573bd70f865607ea16c1b70d209b0f3cffa8b5cff1e736e564`.
Production backend при этом не менялся.

OS audio проверяется отдельным временным экземпляром установленных Ubuntu
PipeWire **1.0.5**, Pulse compatibility и WirePlumber **0.4.17**. Это не
подмена browser media API: настоящий Chromium захватывает точный виртуальный
source, а стандартный OS monitor измеряет PCM на выходах. Получены RMS
0,14088 на входе, 0,09344 на B, 0,06675 на C после переключения; на прежнем B
RMS 0 при 19 200 samples. После удаления выбранного C production helper
возвращает fallback и PCM снова поступает в B (RMS 0,04693).
Raw PCM не сохранялся — только ограниченные числовые агрегаты.

Дополнительный настоящий controller/PCM test подтвердил: пока inventory
ожидается, HTMLAudioElement muted/paused и RMS на B равен 0; dispose,
запоздавший inventory и retry не включают звук, srcObject detached и
output callbacks отсутствуют. Новый актуальный controller после route ack
unmute/play даёт PCM RMS 0,05068. Это проверка production controller и HTML
media element; полный React UI с физической гарнитурой не подменяется этим
результатом. Evidence — `os-audio-controller/`.

После установки HDA-драйвера отдельный capture использовал реальный exact
HDA/SPICE input при host default «Микрофон MacBook Pro». За 20 с получены
154 окна анализа, max RMS 0,0067795, max peak 0,0126801, пять окон с ненулевым
сигналом. 48 кГц, два канала, gain=0: акустического мониторинга/feedback,
сохранения записи и отправки аудио по сети не было. Tracks ended,
AudioContext закрыт, процесс и временный профиль удалены. Это подтверждает
живой input path, но не субъективную разборчивость, AEC или качество звонка.
Evidence — `physical-mic/`, драйвер/инвентарь — `os-hda/`.

Однократный local output probe вызвал production `playDeviceTone` на
существующем WAV длительностью 1 с при app volume 0,25. `play()` resolved,
получено ровно одно ended, callback без ошибки, src удалён, AudioElement
paused и временный процесс/профиль очищены. Defaults и системная громкость
не менялись. 18 октября 2026 года пользователь подтвердил: «Да, сигнал слышен»
в динамиках MacBook. Таким образом, помимо API/ended проверена слышимость
этого конкретного сигнала через Ubuntu HDA/SPICE/UTM. Повторное воспроизведение
не запускалось; качество речи, AEC и длительный разговор этим не проверяются.
Evidence — `physical-output/`.

Финальные исходники перенесены в `/home/meetspace/meetspace-stage03` и
собраны внутри Ubuntu ARM64. Manifest production build совпал с итоговыми
370 файлами без расхождений. Приложение запущено обычной командой Electron
с рабочим профилем, без fake media, test flags или внутренних observers.
Renderer использует Wayland, `--enable-sandbox`, `NoNewPrivs=1`, `Seccomp=2`;
helper остаётся `root:root 4755`, AppArmor userns restriction включён.
Визуально подтверждён полностью отрисованный экран подключения к серверу;
снимок — `final-meetspace-utm.png`, provenance и process/sandbox evidence —
`runtime/utm-arm64/*final*.json`. Приложение и Ubuntu оставлены запущенными.

Для изоляции не менялись default devices общей desktop audio-сессии;
сравниваются её inventory/default hashes до, во время и после теста.
Четыре собственных модуля выгружены, tracks ended, AudioContext закрыт,
playback detached, частные процессы и временные config/state/socket удалены.
Ранняя короткая проба общего PipeWire автоматически меняла default с
`auto_null`; собственный модуль сразу удалён, исходный default восстановился,
это наблюдение и отрицательные доказательства сохранены. Именно поэтому
основной PCM test использует отдельный audio server.
Runner пока требует WirePlumber 0.4 configuration и не заявляет поддержку
того же fixture на Fedora/WirePlumber 0.5. Проверка desktop audio policy,
Bluetooth, аппаратного echo cancellation и физического звука остаётся
отдельной приёмкой.

## Метод проверки

Используются локальные тестовые профили и локальные HTTPS fixtures.
Рабочие аккаунты, встречи и предоставленные ранее серверы не используются.
Pion driver импортирует production SFU без изменения его реализации;
аутентифицированная WS-доставка в engine fixture заменена ограниченным
stdin/stdout transport. Поэтому этот fixture доказывает SDP/ICE/RTP и SFU
fanout, но не полный production HTTP/WS/auth путь. Broker и разрешения
проверяются отдельным настоящим Electron integration harness.

Forced TURN проверяется по policy `relay`, выбранному local candidate каждого
текущего PeerConnection и настоящим TURN allocations. Получение RTP при policy
`all` не считается forced relay. После leave/rejoin требуются новые входящие
данные, а не оставшиеся счётчики старого соединения. Финальный cleanup требует
ended local tracks, closed PeerConnections и нулевые peers/tracks/subscriptions/
rooms в локальном SFU.

Отказы `setSinkId`, исчезновение выхода и default device обрабатываются на
уровне приложения: спецификация не обещает автоматический перенос звука
с отключённого выбранного sink. На настоящем Ubuntu Chromium воспроизведён
отдельный отрицательный случай: после удаления выбранного sink повторный
`setSinkId` с тем же ID возвращал успех, но PCM уже не поступал. Исправление
проверяет достоверный inventory внутри той же очереди и явно переключает
выход на default. Пустой, скрытый, недоступный или содержащий только aliases
список не считается доказанным отключением. Исходный FAIL сохранён в
`os-audio-negative-same-sink/`, положительный повтор — в `os-audio/`.
Основание:
[W3C Audio Output Devices API](https://www.w3.org/TR/audio-output/).
Разрешения сверяются с установленными Electron 44 typings и
[официальным session API](https://www.electronjs.org/docs/latest/api/session).

События `powerMonitor.emit('suspend'/'resume')` проверяют последовательность
cleanup/reconnect. Они не выдаются за настоящий сон VM/ноутбука. После
suspend, выхода или отключения устройства захват не включается автоматически.

## Обязательная матрица и непроверенные случаи

| Система | Полная приёмка media |
| --- | --- |
| Ubuntu 24.04 LTS x64 | NOT RUN |
| Ubuntu 22.04 LTS x64 | Full-system TCG/X11: 8 SFU cases + permissions/lifecycle PASS; физическая/full desktop приёмка NOT RUN |
| Debian 12 x64 | NOT RUN |
| Debian 13 x64 | NOT RUN |
| Linux Mint 22 x64 | NOT RUN |
| Fedora Workstation 44 x64 | NOT RUN |
| Ubuntu 24.04 LTS ARM64 | Native UTM/Wayland: 8 SFU cases, permissions, real OS PCM, HDA mic signal PASS; полная аппаратная приёмка NOT RUN |

Требуют отдельной проверки: физическая камера, субъективное качество микрофона/динамиков,
USB/Bluetooth unplug/replug, переключение A2DP/HFP во время звонка, занятое
устройство, системный запрет доступа, аппаратное шумоподавление, реальный
suspend/resume, смена сети/VPN, физический GPU и остальные X11/Wayland
сочетания матрицы. Программное моделирование не заменяет эти результаты.

Поддержка Windows 10 22H2 x64, Windows 11 x64 и Windows 11 ARM64 сохраняется
в общем проекте. Windows guard/адаптеры, native разрешения, preload/IPC,
подпись и установщики не менялись. Общие frontend исправления покрыты
regression tests; **Windows 10 x64, Windows 11 x64 и native Windows 11
ARM64 runtime в этом этапе NOT RUN**. Старые установщики не являются
доказательством работоспособности изменённых исходников.

Реализация этапа готова в общем проекте; ограничения матрицы и аппаратной
приёмки перечислены явно. Тесты не обращались к рабочим аккаунтам/серверам,
новые установщики не создавались. Временная x64 VM корректно выключена,
собственные media/audio процессы очищены; финальная обычная сборка обновлена
и визуально проверена в UTM. Следующий этап автоматически не начинается.
