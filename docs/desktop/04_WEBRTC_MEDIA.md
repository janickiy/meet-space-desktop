# MeetSpace Desktop — этап 04: WebRTC и демонстрация экрана

Дата проверки: 14 октября 2026. Исходный checkout: `66e482c9701b6c13f58bc93aee8d9f5cf932dd34` плюс незакоммиченные изменения этапов 01–04. Среда разработки: macOS ARM64, Electron 44.7.1, Node.js 24.19.0, Go 1.26.9.

## Реализация

Приложение использует существующий `ConferenceMediaClient` из общего React/TypeScript frontend. Отдельного desktop SFU-клиента и второй реализации экранов встречи нет. Chromium выполняет захват устройств, SDP, ICE и передачу RTP; разрешённый native broker передаёт существующие сообщения WebSocket через выбранный HTTPS/WSS сервер.

- Camera/microphone и выбор динамика разрешены только активному главному документу приложения. Чужие окна, subframes, чужие origins и остальные permissions отклоняются. CSP, sandbox, context isolation, запрет Node в renderer и строгая проверка TLS сохранены.
- `getDisplayMedia` требует пользовательского действия. Main получает список экранов и окон через `desktopCapturer`, выдаёт временные непрозрачные идентификаторы и миниатюры. Общий React показывает окно выбора. Автоматического выбора первого экрана нет.
- Перед разрешением захвата main проверяет, что выбранный источник всё ещё существует. Один запрос действует не дольше 60 секунд; закрытие окна, переход страницы, смена сервера/личности и сон отменяют запрос. Callback выполняется один раз, native IDs и thumbnails не сохраняются.
- Системный звук предлагается только на Windows, если запрошен audio stream, и выключен по умолчанию. Это loopback всех приложений, в том числе при выборе одного окна. Перехвата звука без явного выбора нет.
- Preload v3 добавляет только события выбора источника и операции выбора/отмены. Renderer не получает `desktopCapturer`, filesystem, Node или произвольный IPC.
- Остановка устройств, экрана и модераторский запрет освобождают захват независимо от очереди переговоров WebRTC. При завершении снимаются callbacks, останавливаются дорожки и закрывается PeerConnection. Поздние результаты permission/capture запросов проверяются перед использованием.
- Предпросмотр устройств освобождается при уходе со страницы и сне. Native suspend/resume закрывает текущие соединения с уведомлением общего reconnect механизма. Демонстрация экрана после сна автоматически не возобновляется.
- Настройки устройств и одноразовое намерение входа во встречу разделены по серверным профилям.

## Фактический SFU-контракт и исправление backend

Сигнализация использует `media.join → media.joined → media.offer → media.answer → media.ready → ack` с `negotiationId`, публикациями MID/source/trackId и trickle ICE. SFU разрешает четыре источника: microphone, camera, video/screen, audio/screen. Реальные кодеки движка — Opus 48 kHz stereo и VP8; общий клиент явно выбирает их и `max-bundle`.

В `internal/usecase/media/controller.go` найдена и исправлена потеря `iceTransportPolicy` и `iceExpiresAt`: worker возвращал эти поля, но `media.joined` их не передавал. Без поля `relay` клиент использовал свой default `all`. Новый Go regression test проверяет реальную точку входа Controller.Handle и опубликованный WS envelope для `relay`, `all` и legacy worker без опциональных полей.

**Исправление backend находится только в этом checkout. Сервер не развёртывался и его конфигурация не менялась.** Для применения серверного `TURN_FORCE_RELAY` требуется выпустить это исправление на backend. Проверка relay в тестовом harness не заменяет такой выпуск.

Waiting room, допуск, moderation/kick и ограничения источников остаются серверными: media команды проверяют сессию и право участия. Управление записью использует существующие REST-команды backend/FFmpeg. Локальный рекордер не добавлялся. Воспроизведение/скачивание файлов по внешним подписанным URL пока закрыто политикой renderer; расширение разрешений на произвольные URL не делалось.

## Проверки

| Проверка | Результат | Что подтверждено |
| --- | --- | --- |
| Desktop unit/network/security | PASS, 60 тестов | TLS, broker, IPC, permissions, отмена выбора, scope сессий, уведомление о suspend/reconnect |
| Общий frontend: foundation | PASS, 17 тестов | Desktop/web adapters, отсутствие сохранения JWT в renderer, REST/WSS/SSE |
| Общий frontend: media lifecycle | PASS, 11 тестов | Поздний capture, stop/moderation во время незавершённого replaceTrack, unplug, очистка receivers/callbacks, разделение профилей |
| Общий React UI в настоящем Electron | PASS, 8 сценариев | Вход/профили/ошибки/reconnect и выбор экрана: default без выбора/звука, выбор, отмена, Escape, ошибки, teardown; светлая/тёмная тема проверены визуально |
| Electron media policy runtime | PASS, 6 проверок | Production permission handlers и preload; отказ чужому WebContents, user gesture, opaque IDs, отмена; WSS/SSE после искусственного power event; реальный getDisplayMedia только своего синтетического окна |
| Локальный настоящий Pion SFU | PASS | Два существующих ConferenceMediaClient в Chromium, синтетические camera/mic, входящие Opus и декодированные VP8 у обоих |
| Локальный настоящий TURN forced relay | PASS | У обоих Chromium selected local ICE candidate `relay`, сервер TURN создал две allocations |
| Cleanup локального SFU | PASS | Все захваченные tracks ended, PeerConnections closed, SFU peers/tracks/subscriptions/rooms равны нулю |
| Go regression controller | PASS, 3 варианта | `relay`, `all`, legacy worker без optional fields; SFU/config/mediaworker также скомпилированы, собственных Go test-файлов у этих трёх пакетов нет |
| Electron security smoke: bundled и dev renderer | PASS | CSP/nonce, Node isolation, IPC v3, navigation/deep links, light/dark, zoom |
| Electron restart/storage integration | PASS | Два настоящих процесса, OS safeStorage, TLS fixtures, изоляция профилей, logout |
| Web/desktop build, lint, TypeScript | PASS | Общий frontend: 2170 модулей; web build без Electron runtime imports |
| Desktop dependency audit | PASS | 0 известных уязвимостей на момент проверки |
| Рабочий сервер: авторизация и сигнализация | PASS | После исправления пользователем адреса первого аккаунта оба аккаунта вошли через native HTTPS broker; два настоящих WSS соединения |
| Рабочий сервер: 2 участника, микрофон/камера | PASS | Два общих ConferenceMediaClient в sandboxed Electron; входящие Opus и декодированные VP8 у обоих |
| Рабочий сервер: mute/restore и повторный вход | PASS | После включения микрофона и REST leave/join с новым WSS проверен прирост RTP относительно отдельных baseline, а не старые накопленные счётчики |
| Рабочий сервер: демонстрация окна | PASS, синтетический источник | Свой анимированный Electron frame; у второго участника растут decoded VP8 frames именно живой дорожки `RemoteMedia.screen` |
| Рабочий сервер: модерация микрофона и камеры | PASS | REST запрет → WS policy → выключение источника → отказ повторного включения → снятие запрета → свежий входящий RTP |
| Рабочий сервер: forced TURN relay | PASS в последнем прогоне; один промежуточный FAIL | Последний прогон: actual policy `relay`, gathered local только `relay`, selected local `relay` и протокол UDP у обоих; промежуточный прогон дал `relay`/`prflx` и timeout строгой проверки |
| Рабочий сервер: waiting room/admission | NOT RUN | Публичный Join нового участника требует inviteCode, а валидная ссылка сразу допускает; тестовое waiting membership через этот API не создаётся |
| Рабочий сервер: запись, kick, запрет экрана | NOT RUN | Отдельные live-сценарии не выполнялись |
| Рабочий сервер: cleanup | PASS в пределах клиента/API | Захваченные tracks ended, PeerConnections closed, REST leave/finish и отзыв тестовых сессий успешны; production SFU metrics не доступны |
| Физические устройства, unplug, системные screens/windows, loopback, настоящий сон | NOT RUN | Синтетические устройства/события проверяют код, но не ОС/драйверы |

Рабочий сервер указан пользователем: `https://meeting.janickiy.com`, версия `v1.0.0-meeting.20261013-accounts.4`. Это предоставленный рабочий сервер, а не отдельное staging-развёртывание. Первоначальный HTTP 401 устранён исправлением адреса аккаунта пользователем. Live-проверки используют синтетические camera/microphone и только собственный тестовый frame, без доступа к физическим устройствам и пользовательскому рабочему столу. Сервер не обновлялся, его конфигурация не менялась. Credentials, SDP, IP-адреса и TURN secrets в отчёт не включены.

После уточнения аккаунта выполнены три прогона: базовый — PASS, расширенный — FAIL на строгом требовании двух selected local `relay`, расширенный с дополнительной диагностикой — PARTIAL только из-за непроверенного waiting/admission. Во всех трёх созданные тестом встречи завершены, участники вышли и тестовые сессии отозваны. История трёх встреч остаётся: backend не предоставляет DELETE конференции. Временный файл доступа удалён. Очистка production SFU по внутренним метрикам не проверялась; нулевые peers/tracks/subscriptions/rooms подтверждены только локальным SFU-тестом.

Последний forced relay использует **переопределение политики только в тестовом клиенте**. Production `media.joined` по-прежнему не содержит `iceTransportPolicy` (`defaultServerPolicies: ["missing"]`), что согласуется с найденной потерей поля в контроллере. При обычном входе фактическая policy клиента — `all`. После тестового override оба текущих PeerConnection имеют policy `relay`, выдают только relay candidates, выбирают local `relay`/UDP и принимают Opus/VP8. Это проверяет доступность TURN, но не применение серверного `TURN_FORCE_RELAY` до выпуска backend-исправления.

Промежуточный результат сохранён в [отдельном отчёте](../../desktop/artifacts/stage04-live-media-relay-inconclusive.jsonl): у одного клиента был selected local `prflx`, хотя оба продолжали получать медиаданные. Причина не установлена, исправление production-кода по этому наблюдению не делалось, критерий PASS не ослаблялся. Единичный успешный повтор не подтверждает стабильность TURN во всех сетевых условиях; повторить при Windows-приёмке и после выпуска backend-исправления. Значения политики сверены с [контрактом WebRTC W3C](https://www.w3.org/TR/webrtc/#dom-rtcicetransportpolicy).

Ограничение waiting room установлено по фактическому `ConferenceRepository.Join`: новый участник без inviteCode получает отказ, а с валидным кодом — `admitted` даже при включённом waiting room. Guest Join вызывает тот же путь. Допуск уже допущенного участника не считался проверкой очереди. Для настоящего сценария «waiting → admit» нужен отдельный staging fixture или поддерживаемый сервером способ создать ожидающее членство; политика допуска и production DB не менялись.

Реальная проверка Electron обнаружила два отличия от предположений по typings: display preflight использует media permission с пустым массивом `mediaTypes`, а отмена display request требует `callback(null)`. Оба случая исправлены и проверены настоящим Chromium, без fake-ui permission bypass. Runtime на macOS иногда печатает предупреждение sandbox helper при захвате собственной вкладки; тест завершается успешно. Это не подтверждает поведение helper на Windows.

Команды повторения локальных проверок:

```sh
npm --prefix frontend run check
npm --prefix frontend run check:desktop-foundation
npm --prefix frontend run check:desktop-media
npm --prefix desktop test
npm --prefix desktop run test:integration
npm --prefix desktop run test:ui
npm --prefix desktop run test:media
npm --prefix desktop run test:sfu
npm --prefix desktop run test:smoke
node desktop/scripts/dev.mjs --smoke
go test ./internal/usecase/media ./internal/infrastructure/sfu ./internal/config ./internal/transport/mediaworker
```

Opt-in live harness: `node desktop/tests/live-media-runner.cjs /absolute/path/to/private-input.json`. Внешний файл содержит `origin` и массив из двух `{email,password}`; не включайте его в repository, логи или installer. При успешном входе harness создаёт только свою уникальную тестовую комнату без записи и рассылок, затем завершает её, выходит участниками и отзывает созданные сессии. Backend не предоставляет DELETE комнаты, поэтому после успешного прогона её история останется. Forced relay при наличии TURN включается только в тестовом клиенте; конфигурация сервера не меняется.

## Поддержка Windows и приёмка

| Целевая система | Архитектура | Сборка и проверка payload | Запуск приложения/установщика |
| --- | --- | --- | --- |
| Windows 10 22H2, build 19045 | x64 | PASS, EXE и 6 DLL `0x8664` | NOT RUN — Windows-среда не предоставлена |
| Windows 11 | x64 | PASS, EXE и 6 DLL `0x8664` | NOT RUN — Windows-среда не предоставлена |
| Windows 11 | ARM64 native | PASS, EXE и 6 DLL `0xaa64` | NOT RUN — ARM64 Windows-среда не предоставлена |

Windows 10 ARM64 и 32-bit вне объёма. Сборка Windows на macOS и проверка PE headers подтверждают архитектуру payload, но не работоспособность на Windows. Все runtime результаты этого этапа относятся к macOS ARM64.

Перед Windows-приёмкой на каждой системе:

1. Установить соответствующий installer, запустить, проверить вход двумя тестовыми участниками.
2. В prejoin проверить разрешение/отказ камеры и микрофона, занятое/отсутствующее устройство, смену камеры, микрофона и динамика.
3. Проверить двусторонний Opus/VP8 через настоящий сервер; отдельно принудительный relay с выбранной ICE candidate `relay` у обоих участников.
4. Проверить выбор каждого экрана/окна, отмену выбора, закрытие выбранного окна, остановку пользователем и системной кнопкой, Windows loopback с включённым и выключенным checkbox.
5. Проверить waiting room, admission, запреты камеры/микрофона/экрана, kick и завершение встречи организатором.
6. Отключить USB-устройства во время звонка; убедиться, что индикаторы и список устройств обновились, захват не остался активным.
7. Проверить обрыв сети, VPN/proxy, восстановление сети, настоящий suspend/resume. Повторное подключение не должно автоматически начать демонстрацию экрана.
8. После выхода, logout, смены сервера и закрытия окна проверить отсутствие активных дорожек, PeerConnections, SFU peers и индикаторов захвата ОС.
9. При доступном recording worker проверить start/stop серверной записи своей тестовой встречи и её итоговый статус.

## Тестовые установщики 0.4.0

Финальная упаковка и независимый `verify:artifacts` — **PASS**. Build time `2026-10-14T02:32:41Z`, версия `0.4.0-test`, sourceDirty=true. Проверялись фактические EXE/DLL и ASAR, извлечённые из каждого NSIS installer, а не только имена файлов. После упаковки пересборка не выполнялась.

После live-проверок повторно сверены SHA-256 обоих installers, ASAR, EXE/DLL и manifests: совпадают. 115/115 файлов подготовленного production payload и 100/100 renderer-файлов совпадают с текущими compiled outputs; 16/16 сохранённых исходных хешей локального media-отчёта также совпадают. Повторное извлечение NSIS не выполнялось; связь с embedded payload опирается на неизменные хеши installers и предыдущую независимую проверку. В этом продолжении изменялись только test harness и отчёт, новая сборка приложения не требовалась.

| Installer | Размер, байты | SHA-256 |
| --- | ---: | --- |
| [Windows x64](../../desktop/artifacts/MeetSpace-0.4.0-win-x64-test-setup.exe) | 123799548 | `57ffa701a8139ffb35e5c33e8bd9284ba7ee8cef6665b42edd57e0e4e7032bdb` |
| [Windows 11 ARM64 native](../../desktop/artifacts/MeetSpace-0.4.0-win-arm64-test-setup.exe) | 118540393 | `71f13fedd8c51b9e44be0e27cd7781eb4d46df1ee65c7ad02e648ec0c43a9d01` |

Общий ASAR: 4959083 байта, SHA-256 `9aac3f9f3e130661c18704a500a082e8a02d90aa7475ec75ef2f303446fd4a00`. Единственная дополнительная runtime dependency — pure-JS `ws` 8.22.0. Native addons, исходники тестов и fixtures отсутствуют в пакете. Установщики не подписаны и не опубликованы; версии 0.2.0/0.3.0 сохранены отдельно.

Подробные evidence: [локальные media проверки](../../desktop/artifacts/Stage04-local-media-tests.json), [последняя live-проверка](../../desktop/artifacts/stage04-live-media.jsonl), [первая успешная live-проверка](../../desktop/artifacts/stage04-live-media-basic-pass.jsonl), [x64 manifest](../../desktop/artifacts/MeetSpace-0.4.0-win-x64-test-setup.exe.json), [ARM64 manifest](../../desktop/artifacts/MeetSpace-0.4.0-win-arm64-test-setup.exe.json). Внешний вид выбора источника: [светлая тема](../../desktop/artifacts/stage04-picker-light.png), [тёмная тема](../../desktop/artifacts/stage04-picker-dark.png); это синтетические UI fixtures без снимков пользовательских экранов.

## Основные файлы

- `desktop/src/media-permissions.ts`, `main.ts`, `preload.ts`, `broker.ts` — разрешения, источник захвата, IPC, suspend/reconnect.
- `frontend/src/platform/desktop-contracts.d.ts`, `desktop.ts`, `captureLifecycle.ts` — общий контракт и lifecycle.
- `frontend/src/components/desktop/DesktopScreenPicker.tsx`, `desktop-screen-picker.css`, `DesktopSessionGate.tsx` — выбор экрана и окна в существующей оболочке.
- `frontend/src/media.ts`, `useMedia.ts`, `useCallPreview.ts`, `prejoinDevices.ts`, `pages/PreJoinPage.tsx`, `components/DeviceSettings.tsx` — общий медиаклиент и освобождение устройств.
- `internal/usecase/media/controller.go`, `controller_desktop_test.go` — сохранение worker ICE policy в WS контракте.
- `desktop/tests/media-permissions.test.cjs`, `broker-network.test.cjs`, `sfu-*.cjs`, `fixtures/pion-sfu/main.go` — воспроизводимые проверки permissions, реального Pion и TURN.
- `desktop/tests/live-media-runner.cjs`, `live-media-electron.cjs` — отдельный opt-in live harness, безопасные отчёты, модерация и проверка нового входящего RTP; файлы не входят в installer.

## Ограничения и следующий шаг

Тестовые установщики не подписаны. Физические устройства, драйверы Windows, несколько мониторов, loopback audio, реальный сон и Windows 11 ARM64 требуют отдельного запуска на целевых машинах. Синтетические устройства и события в тестах отмечаются отдельно. Доступ к TURN зависит от конфигурации сервера и сети клиента.

Для завершения приёмки нужны выпуск небольшого backend-исправления, проверка waiting/admission на подходящем staging fixture и прогоны на трёх целевых Windows-системах, включая физические устройства, системный захват, запись и сетевые сценарии. Доступ обоих тестовых аккаунтов уже проверен. Этап 05 автоматически не начинается.

API Electron проверены по установленным typings 44.7.1 и официальным источникам: [session permissions/display media](https://www.electronjs.org/docs/latest/api/session), [desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer), [security](https://www.electronjs.org/docs/latest/tutorial/security).
