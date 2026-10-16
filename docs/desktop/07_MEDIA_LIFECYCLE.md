# Этап 07: frontend media, chat и realtime lifecycle

Дата: 14 октября 2026. Среда этого отчета: macOS ARM64, Electron 44.7.1. Checkout `66e482c9701b6c13f58bc93aee8d9f5cf932dd34` содержит локальные изменения предыдущих этапов; один HEAD не описывает проверенное дерево. Production-аккаунты и production-сервер в этих прогонах не использовались.

## Вывод и изменение

В media lifecycle подтвержденных P0/P1 не обнаружено. До и после исправления realtime все 110 созданных `RTCPeerConnection` были закрыты, активных capture tracks и удерживаемых экземпляров `ConferenceMediaClient` после GC не осталось. Это 10 warmup + 100 измерительных циклов.

Найден и исправлен P1 в `frontend/src/personalRealtime.ts`: в declarative router функция `useNavigate()` меняла identity при смене маршрута. Она входила в зависимости эффекта account WebSocket, поэтому переходы между списком и чатом закрывали и снова открывали общий канал, запрашивали ticket и повторно обновляли snapshots. `navigateRef` хранит текущий callback для серверных событий; зависимости эффекта теперь ограничены `userId` и `QueryClient`. Смена аккаунта и размонтирование по-прежнему закрывают соединение. Других production-изменений frontend в этапе 07 не делалось.

В отдельном профиле полного интерфейса 100 открытий/закрытий чата создали **200 дополнительных WSS** до исправления и **0** после. Heap-анализ связывает рост с `personal-connection` Query и их отложенными GC-таймерами. Это подтверждение лишних переподключений и удержания объектов до GC, а не доказательство бесконечного роста памяти.

| Полный интерфейс, отдельный профиль | До | После |
|---|---:|---:|
| Дополнительные account WSS created / closed за 100 циклов | 200 / 200 | 0 / 0 |
| `personal-connection` Query objects, warmup → settled | 21 → 221 | 1 → 1 |
| `DOMTimer` objects, warmup → settled | 40 → 240 | 20 → 17 |

Источники этой таблицы: `desktop/artifacts/stage07-profile-{baseline,after}.json`, поле `chatReconnects`, и `desktop/artifacts/stage07-heaps-{baseline,after}.json`, renderer entries `warmup` / `settled`. Это отдельный полный UI-профиль; его число DOM-узлов, heap и reconnects нельзя подставлять вместо метрик изолированного harness ниже.

## Методика media/chat baseline и повторного прогона

Изолированный test renderer импортирует существующие `AuthProvider`, `MessageThread`, `usePersonalRealtime`, `ConferenceMediaClient` и общий transport. Работают настоящие React/Chromium, production main/preload/native broker, HTTP(S)/WSS через локальный backend fixture и Pion SFU из Go fixture. Disposable CA добавляется только к транспорту теста; проверка TLS не отключается. У теста отдельные временные userData/sessionData, renderer bundle и Go executable. Production `dist`, renderer и installers он не пересобирает.

Последовательность: 10 warmup media/chat циклов, затем 100 media join/leave, 100 mount/unmount общего chat component, пауза 3 секунды, полное размонтирование React/Auth и очистка QueryClient. Перед каждым checkpoint Chromium GC вызывается дважды через CDP. Сохраняются heap snapshots, `Runtime.getHeapUsage`, `Memory.getDOMCounters`, счетчики таймеров, слабые ссылки на PC/tracks/clients, состояние query cache, WSS и счетчики SFU. WeakRef instrumentation не удерживает проверяемые экземпляры сильной ссылкой.

Media-цикл дожидается реального ICE `connected` и завершения SDP / `media.ready` acknowledgement, затем вызывает обычный `stop()`. Это **один peer**, а signaling до Go SFU проходит через тестовый stdin adapter. Встроенные Chromium fake devices дают реальные browser tracks, но физические камера и микрофон не открываются. `packets=0`, `bytes=0` в обоих итоговых JSON: цикл заканчивается после подтвержденного подключения, поэтому он **не доказывает передачу или декодирование RTP**. Для двухсторонней передачи, TURN и качества медиа нужны отдельные SFU/media проверки; этот результат их не заменяет.

Chat-цикл монтирует настоящий `MessageThread` и account realtime hook, ожидает textarea, завершение загрузки и WSS, затем размонтирует и проверяет cleanup. Содержимое сообщений и ответы REST предоставлены локальным fixture; сообщения не отправляются. Это не навигация по полному приложению.

## Сравнимые результаты 100 циклов

Оба прогона завершились **PASS**. Числа ниже взяты из `checkpoints` в `desktop/artifacts/stage07-media-baseline/result.json` и `desktop/artifacts/stage07-media-after/result.json`.

| Renderer JS heap после GC, bytes | До | После |
|---|---:|---:|
| `warmup-10` | 3 477 084 | 3 480 356 |
| `media-100` | 3 516 484 | 3 521 516 |
| `chat-100` | 3 878 644 | 3 884 888 |
| `settled`, через 3 секунды | 3 879 296 | 3 881 468 |
| `teardown` | 3 766 112 | 3 772 432 |

Изолированный retained footprint практически одинаков. Heap растет после warmup в обоих процессах; один endpoint delta не позволяет отнести весь рост к утечке или, наоборот, доказать, что это только JIT. Эти числа не заявляются как выигрыш памяти от исправления account reconnects: в изолированном mount/unmount-профиле сам сценарий route-induced reconnect не выполняется.

| Счетчик в обоих прогонах | После warmup | После media100 / chat100 / settled | После teardown |
|---|---:|---:|---:|
| PC created / closed, накопительно | 10 / 10 | 110 / 110 | 110 / 110 |
| Успешные `getUserMedia`, накопительно | 10 | 110 | 110 |
| Live PC / live capture tracks / удерживаемые media clients | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Открытые account WSS | 0 | 0 | 0 |
| SFU peers / rooms / tracks / subscriptions | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Таймеры renderer | 5 | 5 | 0 |
| Cached queries / active observers / inflight queries | 3 / 0 / 0 | 3 / 0 / 0 | 0 / 0 / 0 |
| DOM documents / nodes / event listeners | 1 / 11 / 155 | 1 / 11 / 155 | 1 / 11 / 148 |

Пять таймеров при смонтированном AuthProvider — interval 30 секунд, timeout обновления сессии около 59 минут и три query-GC timeout по 300 000 ms. Это штатное idle-состояние данного harness. Уменьшение DOM listeners с 155 до 148 после teardown относится к снятым подпискам приложения; React root container и его делегированные listeners остаются в тестовом документе. Значение 148 не выдается за отсутствие любых browser/React listeners.

Heap constructor counts стабильны: `QueryObserver=3`, `InfiniteQueryObserver=2`, `MediaStream=1`, `MediaStreamTrack=1`. Это счета имен объектов снимка, включая прототипы/обертки, а не количество активных подписок или захватов. Live tracks измеряются отдельно через `readyState`; query observers — через QueryClient. Числа constructor counts не используются как утверждение об отсутствии всех объектов этих типов.

## Отдельные regression после исправления

После сравнимых checkpoint выполняется отдельная проверка маршрутов и смены аккаунта. Ее дополнительные операции не входят в heap-таблицу выше.

| Проверка | Фактический результат |
|---|---|
| Desktop, 100 смен маршрута при смонтированном hook | 0 дополнительных WSS и 0 дополнительных summary fetches |
| Desktop, `folder.deleted` после навигации | Переход использует актуальный callback и ведет в `/folders` |
| Desktop, вход во второй локальный fixture account | Старое keyed дерево AuthProvider и его socket закрыты; явно открытый chat нового аккаунта создает ровно один новый socket |
| Desktop, последующее размонтирование | Новый socket закрыт |
| Web mode, 100 смен маршрута | Сохраняются исходный socket и один ticket request |
| Web mode, событие / смена userId / размонтирование | Актуальная навигация; всего 2 socket creations и 2 closures, включая новый socket после смены identity |

Web regression исполняет настоящий React/router/realtime hook в Chromium, но **fetch и WebSocket заменены тестовыми stand-ins**. Это проверка общего lifecycle и callback, а не тест веб-развертывания или настоящего браузерного WSS.

После отдельной смены аккаунта наблюдаются **3 pending query-GC таймера по 300 000 ms**. Очистка QueryClient при еще наблюдаемых queries и keyed unmount могут оставить detached observers до стандартного GC timeout. Этот факт сохранен в `routeRegression.identityTeardownPendingQueryGcTimers` и не скрыт общим утверждением «таймеров 0»: ноль относится к сравнимому teardown до дополнительной смены аккаунта. Полное ожидание этих пяти минут в этом профиле не выполнялось; поэтому фактическое последующее освобождение здесь не заявляется как измеренное. Активных старых sockets и media tracks при этом нет.

Также повторно прошел существующий targeted media suite **11/11 PASS**: поздний capture после leave, moderation во время join/replacement, cleanup ожидающего sender, screen video/audio cleanup, unplug, поздний display picker, разрешенный fallback устройств и release при pagehide/suspend. Browser media API в этом Node suite являются тестовыми stand-ins; результаты не подменяют физический device test.

## Воспроизведение и доказательства

При заранее согласованной актуальной main compilation и установленных frontend/desktop dependencies:

```sh
node desktop/tests/stage07-media-runner.cjs desktop/artifacts/stage07-media-current
node frontend/scripts/check-media-lifecycle.mjs
```

Первый runner создает только временные test bundles / Go fixture и запускает отдельный скрытый Electron. По умолчанию пишет в `stage07-media-current`; сохраненные baseline/after нельзя перезаписывать при повторном запуске. Параметр `--regression-only` пропускает media/chat нагрузки и обозначает их количество как 0 — такой результат не заменяет полный 100-cycle прогон.

Файлы harness: `desktop/tests/stage07-media-runner.cjs`, `desktop/tests/stage07-media-electron.cjs`, `frontend/scripts/stage07-lifecycle-renderer.tsx`, `frontend/scripts/stage07-web-realtime.tsx`. В каждом каталоге доказательств — `result.json`, `checkpoints.json` и пять `.heapsnapshot`. After дополнительно содержит `source-files.json`: SHA-256 шести проверяемых production modules и обоих lockfiles; при финальной сверке они совпали с текущими файлами. Этот файл добавлен после первоначального baseline и не заявляется как contemporaneous fingerprint baseline.

Ранние неуспешные попытки самого harness были исправлены без дополнительных production-правок: ожидание только ICE без завершения ready/negotiation; ожидание открытого chat после намеренного keyed account teardown; чтение старого тестового `authenticated` до нового React mount. Окончательный before/after содержит полные успешные прогоны. Дополнительные route/web regression добавлены только в after, поэтому baseline их не подтверждает.

Raw heap snapshots могут содержать данные локальных fixture sessions. Они остаются в ignored artifacts; публиковать их как обезличенный отчет или выводить строки снимков нельзя. В документ перенесены только счетчики и агрегаты.

## Границы результата

В этом профиле **Windows runtime, физические camera/microphone, display capture, два peer с RTP, relay/TURN, аппаратный sleep/wake, OS handles, GPU allocations и Windows idle CPU — NOT_MEASURED**. `processMetrics` снимались во время нагрузки и не интерпретируются как idle CPU. Windows/UTM приемка и основной process/crash/reload профиль имеют отдельные доказательства; этот документ не присваивает им PASS или FAIL.

Результат относится к фактически выполненному локальному lifecycle-профилю и минимальному account reconnect fix. Он не является гарантией отсутствия любой утечки при длительных реальных встречах, смене физических устройств или многократной смене аккаунтов.
