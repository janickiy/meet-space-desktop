# Этап 07: жизненный цикл нативных сервисов

Дата: 14 октября 2026. Checkout: `66e482c9701b6c13f58bc93aee8d9f5cf932dd34` с локальными изменениями. Аудит охватывает `native-shell.ts`, `native-notifications.ts`, `media-permissions.ts`, `downloads.ts`. SHA-256 каждого исходного и скомпилированного файла сохранен в JSON evidence; один HEAD не описывает локальное дерево целиком.

Среда измерения этого отчета: macOS ARM64, Node 24.19.0, `--expose-gc`. Electron main/renderer heap, реальные OS handles и CPU измеряются отдельным профилем итогового отчета. Здесь не запускаются Electron, Windows, production-сервер или реальные устройства. Настоящий broker/HTTPS/file I/O используется только с локальными TLS fixtures и их локальным доверенным CA; TLS validation не отключается.

## Воспроизводимый baseline до правок

Сначала прочитаны исходники и существующие тесты. На первоначальном `desktop/dist` прошли **40/40** тестов: asset policy/network, native notifications, media permissions и window state. Затем новый измерительный harness выполнил warmup и 100 циклов каждого сервиса. Он обнаружил оставшийся таймер только в отдельном активном `NativeAssets.dispose()`; обычные Range close/reset и отмены Save завершались без оставшихся операций.

Команды из корня checkout, без скрытой пересборки:

```sh
node --test desktop/tests/native-notifications.test.cjs desktop/tests/media-permissions.test.cjs desktop/tests/assets-policy.test.cjs desktop/tests/assets-network.test.cjs desktop/tests/window-state.test.cjs
node --expose-gc desktop/tests/native-lifecycle.cjs
node --test desktop/tests/assets-lifecycle.test.cjs
```

Harness требует явно включенного GC; без него завершится ошибкой, а не выдаст фиктивные GC-метрики. Он исполняет существующий `dist`, поэтому после изменения TypeScript сначала нужна согласованная компиляция main. Сам harness исходники и `dist` не изменяет. Производственные modules загружаются из `dist`; перечисленные ниже OS adapters и instrumentation существуют только в `desktop/tests`.

До исправления сохранен `desktop/artifacts/stage07-native-lifecycle-before.json`: общий результат **FAIL** из-за одного оставшегося таймера. Отдельный regression с четырьмя одновременно открытыми recording streams также воспроизводимо **FAIL: 4 timers вместо 0**. Это наблюдение записано до изменения production-кода.

## Подтвержденный дефект и минимальное исправление

`NativeAssets.dispose()` снимал `entry.timer`, затем прерывал активный поток. Прерывание синхронно проходило через `finish()` → `detach()`. В этот момент запись еще находилась в `this.media`, поэтому `detach()` снова вызывал `touchMedia()` и заводил новый 30-минутный таймер. Последующий `media.clear()` уже не снимал этот таймер, который удерживал запись и ее callback до истечения срока или завершения процесса.

Исправление в `desktop/src/downloads.ts`, метод `dispose`: сначала взять небольшой snapshot записей и очистить `media`, затем снимать таймеры и прерывать потоки. Теперь `detach()` не может повторно активировать disposed entry. `close/reset`, сеть, правила авторизации, UI, TLS и ограничения файлов не менялись.

Классификация: **P2 cleanup defect**, не P1 и не доказанная утечка данных. В текущем main обычный выход сначала вызывает `assets.reset()`, а завершение процесса тоже освобождает таймеры. Тем не менее контракт `dispose()` оставлял удерживаемый объект при активном потоке; исправление обосновано воспроизводимым before/after, а не предположением об оптимизации. Других подтвержденных P0/P1 в четырех проверенных сервисах не найдено.

## Счетчики до и после нагрузки

| Профиль | Нагрузка после warmup | Baseline/endpoints |
|---|---|---|
| NativeShell | 100 `configureWindow`/`closed`, по 20 move/resize событий; warmup 10 | geometry timers `0 → 0`, максимум 1; глобальные screen listeners `0 → 0`, максимум 2; удерживаемые после GC тестовые окна 0; Tray adapter после dispose 0 |
| MediaPermissions | 100 запросов; warmup 12 | 25 успешных явных выборов, 75 отмен, включая 25 поздних enumeration и 25 timeouts; каждый callback ровно один раз; pending `0 → 0`, timers `0 → 0`, максимум 1 |
| NativeNotifications | 100 смен контекста/identity по 20 событий + burst 600; warmup 10 | созданы/закрыты 2600/2600 adapters; максимум видимых 8, dedup keys 512; после clear/dispose visible/dedup/active adapters 0; stale click navigations 0; удерживаемые тестовые handles после GC 0 |
| NativeAssets normal lifecycle | 100 playback/save циклов; warmup 10 | 50 завершенных Range, 50 отмененных streams; 50 завершенных Save, 50 отмененных Save после первого progress; после каждого цикла jobs/media/таймеры/leases/broker operations 0; `.part` 0, cache directories 0 |
| NativeAssets active dispose | Дополнительно один активный unread stream | до исправления **1** оставшийся timer, после **0**; отдельный regression с 4 streams: **4 → 0** |

После согласованной компиляции main повторный профиль прошел **PASS**, а targeted suite с новым regression — **41/41 PASS** (0,74 s на этой машине). Ни `native-shell.ts`, ни `native-notifications.ts`, ни `media-permissions.ts` не потребовали production-правок; их счетчики воспроизвелись без изменения. Доказательство сохранено отдельно: `desktop/artifacts/stage07-native-lifecycle-before.json` (**FAIL**, 05:23:34 UTC) и `desktop/artifacts/stage07-native-lifecycle-after.json` (**PASS**, 05:28:50 UTC). `stage07-native-lifecycle.json` содержит последний прогон. Исходный baseline не перезаписан.

`downloads.ts`: SHA-256 до `a85f10b117d768969edb69e4a7f9db9a52af638c9e524f66a6bf217a5c221713`, после `8f21b344edfa8dd759f33c8a8530c6db6f0a0d543a17288868cbe078841cceb4`; хэши соответствующего `dist/downloads.js` также записаны в обоих JSON. Изменение production-кода ограничено порядком очистки в `dispose()`.

## Что именно измеряется

NativeShell использует `EventEmitter` adapters окна/screen/Tray и реальные production state/persistence методы. Счетчики показывают, что `closed` снимает обе глобальные screen-подписки и debounce timer, а тестовые window objects доступны GC. Они не измеряют Windows Tray resource handles. `dispose` вызывается после цикла закрытия окна; removal screen listeners привязан к `closed`, как в коде.

MediaPermissions использует синтетическое перечисление источников и callbacks. Проверены select, cancel, смена owner frame, позднее завершение enumeration и timeout. Это очистка **ожидающего picker**, а не счетчик реально работающих Chromium capture tracks. Аудио/видео tracks и PeerConnection относятся к отдельному frontend/Electron media профилю.

NativeNotifications проверяется с EventEmitter adapters вместо показа 2800 уведомлений в реальном центре ОС (200 warmup + 2600 измерительных). Проверены bounded maps, закрытие, сброс identity/context и отказ устаревшего click callback. Собственные map-коллекции сервиса очищаются; закрытые JS adapters собираются GC. Реальные Notification wrappers/Windows notification center handles в этом профиле **NOT_MEASURED**.

NativeAssets использует настоящий broker, Node HTTPS transport, два локальных HTTPS сервера и реальные временные файлы. Recording input — 256 KiB, тестовый Range — 32 KiB. В измерительной фазе, включая дополнительный dispose, получены и освобождены **302/302** authorized leases; максимум jobs/media/playback timers/concurrent request в основном последовательном профиле — по 1. Дополнительный regression проверяет одновременные 4 media entries. `abort` listener удаляется с локального Request, backpressured stream завершается ошибкой при reset/dispose, сохраняемый пользовательский файл не подменяется частичным. Секреты/URL/cookies локального fixture не выводятся в JSON.

До GC очищаются диагностические request histories fixture. WeakRef instrumentation хранит только слабые ссылки; временные strong references измерителя очищены до GC. Ранние ошибки самого harness из-за его временной ссылки на последний adapter не записывались как defect продукта.

## Heap и ограничения измерения

Baseline Node harness heap после warmup + GC: **10 627 872 bytes**; после нагрузки + GC: **11 310 712 bytes**, delta **+682 840 bytes**. Это суммарный heap Node-процесса с VM instrumentation, TLS fixtures, assertion/WeakRef bookkeeping и production services. Это **не Electron main/renderer** и не показатель Windows памяти. Один endpoint delta не доказывает линейную утечку; количественное подтверждение исправления — счетчик таймеров `1/4 → 0`, а не обещание уменьшить память на разность этих двух чисел.

В повторном процессе после исправления соответствующие числа — **10 628 024 → 11 301 040 bytes**, delta **+673 016 bytes**. Разница между двумя heap deltas не интерпретируется как выигрыш приложения: процессы включают fixture/VM/V8 allocation noise и разные runtime состояния. Для утверждения о main/renderer heap или CPU нужен отдельный фактический Electron профиль, а для Windows — соответствующая ОС.

Windows Process Explorer/PerfMon, physical handles/FDs, idle CPU на Windows, GPU allocations, camera/microphone device lifetime и notification center wrappers: **NOT_MEASURED** в этой среде. Настоящий hardware sleep/wake и renderer crash/Electron process restart не имитируются через утверждение об успехе: service-level reset/context/identity/cancel проверены здесь, соответствующие main event paths и реальные Electron процессы описаны отдельным QA-профилем. Долгая (>30 минут) физическая запись/пауза на Windows тоже не запускалась.

## Windows и возможная UTM VM

Финальные цели остаются Windows 10 22H2 x64, Windows 11 x64 и Windows 11 native ARM64. На всех трех реальные runtime проверки пока **NOT_RUN**. Подробная итоговая матрица установки/UI/WebRTC/notification/tray/deep-link/uninstall и 100-cycle OS measurement добавлена в `06_SIGNING_WINDOWS_ACCEPTANCE.md`.

Windows 11 ARM64 в UTM на Apple Silicon можно использовать для VM-приемки установленного native ARM64 EXE: UI/сеть/tray/deep links/установка/удаление. Этот Node-профиль UTM не запускает; в момент записи отчета VM находится на первоначальном экране подготовки Windows, доказательства запуска MeetSpace в ней еще нет. Это **не PASS**. Эмуляция x64 не подменяет ARM64 target; Windows GPU 3D acceleration в UTM отсутствует. [UTM](https://mac.getutm.app/). Встроенная Apple webcam через USB passthrough не передается; внешние устройства требуют отдельной проверки совместимости. [USB support](https://docs.getutm.app/guest-support/sharing/usb/). Даже успешная VM-приемка не закрывает физические драйверы, аппаратное ускорение, реальные media devices, энергосбережение и производительность Windows hardware.
