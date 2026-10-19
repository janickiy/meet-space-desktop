# Linux stage 7 — оптимизация, безопасность и итоговая QA

Материалы этого отчёта относятся к проверенной сборке441cb971. После очистки Desktop-репозитория 19.10.2026 прежний каталог `desktop/artifacts/` перенесён в [архив QA и установщиков](/Users/aleksandranickij/htdocs/meetspace-desktop-archive/2026-10-19-cleanup/artifacts); пути evidence ниже указаны относительно его `linux-stage07-20261019/`.

Дата начала: 19 октября 2026 (Europe/Moscow). Статус: **PARTIAL — доступные проверки завершены, полная приёмка не закрыта; не release-ready**. Версия продукта 0.1.1-beta.

Подтверждённый P2-дефект передачи отражённых credentials в renderer исправлен:15 воспроизведений →0. На native Ubuntu ARM64 прошли236/236 модульных тестов; 100+ lifecycle/media сценарии, локальные SFU direct/TURN и проверка входа на настоящий сервер имеют отдельные подтверждённые scopes. Финальные пакеты проверены в семи Linux-средах; Windows x64/ARM64 сборка сохранена, runtime ARM64 проверен отдельно.

Полная готовность к релизу не заявляется. Native identity memory test сохраняет **FAIL:2 Query после TTL**; физические устройства, полная desktop/media матрица, подпись и реальный канал обновлений остаются открытыми. Ни один отрицательный результат не заменён неподходящим PASS.

## Исходный аудит и план до изменений

Работа продолжается в общем Electron/React/TypeScript проекте `desktop` и `frontend`, с сохранением Windows. Ветка `codex/ssh-server-installer`, HEAD `963cc020460f3177823a790eda36ea967c44ddb3`; изменения предыдущих этапов сохранены. Перед правками сверены 399 исходных файлов кандидата этапа 6: `2837a51157fb7022d6d95cbcf611b85d535bd66731a87b068e6e7ff83632c995`. Начальное состояние: `desktop/artifacts/linux-stage07-20261019/initial-source-state.json`.

Изучены существующие `stage07-profile-*`, `stage07-media-*`, native lifecycle проверки, Linux platform/security код и отчёты этапов 3–6. Старые результаты Windows/macOS не переносятся на Linux. Выявлены ограничения измерителя: FD только через macOS lsof, жёсткие имена evidence, отсутствующие Linux threads/startup/jank и неполный анализ retained heap. Существующий media lifecycle проверяет жизненный цикл PeerConnection, но это само по себе не доказательство передачи RTP или физического screen capture.

План до исправлений:

1. Зафиксировать baseline CPU/RAM, heap после GC и удержание объектов, `/proc` FD/threads, startup и frame/long-task timing на native Ubuntu 24.04 ARM64. Измерение выполняется в собственном профиле и isolated DBus/keyring, без остановки пользовательского приложения.
2. Проверить 100+ циклов join/leave/reconnect, capture start/stop, device replacement, logout/server switch/tray. Использовать реальные production modules и существующие Pion/TLS fixtures; явно различать программные устройства, реальные Linux services и физическое оборудование.
3. Исправлять только подтверждённые дефекты; сохранять отрицательный baseline и сопоставимый after. Не объявлять уменьшение heap endpoint доказанной оптимизацией без анализа удержания.
4. Проверить sandbox, IPC allowlist, CSP/XSS, токены, URI, downloads, SSH installer, зависимости и обновления. Сохранить безопасное отключение недоступных release-функций.
5. Выполнить доступную семиплатформенную Linux матрицу и Windows regression; повторно исследовать Fedora Workstation timeout этапа 6. Отдельно обозначить full desktop/login/физические устройства и непроведённые проверки.

Предыдущий этап: 4 Linux пакета и 2 Windows установщика прошли проверку содержимого. Fedora Workstation 44 Live под x64 TCG — PARTIAL: пакетные операции и обычный визуальный startup прошли, компонентные проверки завершались по таймауту; нормальный Quit отдельного запуска не подтверждён. Это открытая проверка, причина не установлена. Исходные VM и профили пользователя сохраняются.

## Baseline и результаты

Новые evidence сохраняются отдельно в `desktop/artifacts/linux-stage07-20261019/`; старые Windows и Linux stage 6 результаты не перезаписываются. Продуктовых изменений до baseline не было. Native baseline v1/v2 выполнены на неизменённом `2837…`, в отдельном профиле/DBus/keyring; обычное приложение пользователя и его keyring сохранены.

### Native Ubuntu ARM64 baseline

Основной v2: `baseline-native-arm64/v2/stage07-profile-baseline.json`, observer hashes в `instrumentation-manifest.json`. Electron 44.7.1, production main/preload/renderer, локальные TLS/WSS/SSE fixtures, Xvfb; 10 warmup + 100 циклов чата и отдельно 100 открытий/закрытий WSS/SSE. Ресурсы и обработчики возвращаются к warmup. Suspend/resume синтетические; renderer crash/reload фактический. Sandbox включён.

| Метрика | Warmup | Settled | Область измерения |
|---|---:|---:|---|
| Main JS heap после GC | 9 641 700 B | 9 576 320 B | Принудительная GC, instrumented run |
| Renderer JS heap после GC | 5 084 056 B | 5 851 312 B | +767 256 B; само по себе не доказательство утечки |
| Сумма RSS четырёх процессов | 600 548 KiB | 616 132 KiB | Shared pages учитываются в каждом процессе; это не PSS |
| Потоки четырёх процессов | 78 | 76 | `/proc/status`, полное покрытие |
| DOM nodes / listeners | 843 / 229 | 843 / 229 | Одинаковое состояние UI |
| Полные FD четырёх процессов | NOT MEASURED | 201 | chat75=201, chat100=202; ранний observer guard отклонил warmup |

Частичное непривилегированное FD-покрытие: 169→166; доступ к FD sandbox renderer закономерно закрыт. Отдельный read-only collector проверял UID/exe/startTicks/ancestry собственных процессов и не менял sandbox. Просроченные early snapshots явно исключены из сравнения.

Instrumented warm startup v2: 591 ms (v1: 968 ms), не cold-start percentile. За 5 секунд v2 CPU: 2,8% одного ядра, при работающем RAF observer; это не чистый idle benchmark. Xvfb RAF: 1904 кадра, 621 интервал >50 ms, max 683 ms, включая forced GC и heap snapshots. **Оценка физической плавности NOT MEASURED**, такой прогон не подходит для performance acceptance.

`retained-heaps.json` анализирует четыре снимка по дереву dominators с исключением weak edges. Это raw graph с указанной моделью рёбер, без специальных page-ownership/shortcut/ephemeron эвристик [Chrome DevTools](https://chromium.googlesource.com/devtools/devtools-frontend/+/e343bdfafbbee2aac647db0915cb766dcaf04122/front_end/entrypoints/heap_snapshot_worker/HeapSnapshot.ts), не идентичная DevTools оценка, не гарантированная верхняя/нижняя граница и не RSS. Алгоритм проверен против независимого removal oracle на 200 графах, включая циклы, глубокий граф, weak edges и пересечение retained subtrees. Отчёт использует только allowlisted классы, не выводит строки heap; parser errors также скрыты.

Результат: по одному Broker/Assets/Updates/Shell/Notifications до и после; WebSocket 2→2 (retained union 8664→8492 B), Timeout 9→9 (1408→1408 B), renderer Query 18→18 (6676→6660 B), DOMTimer 21→20. Рост общего графа не сопровождается ростом этих живых ресурсов; это ограниченный результат данного сценария, а не универсальное отсутствие утечек.

### Подтверждённое исправление безопасности

P2: буквальное отражение сервером известных JWT/cookie/ticket в именах JSON-полей и разрешённых HTTP/SSE headers проходило через broker в renderer. Repro использует только синтетические секреты: `security/reflected-credential-before.json`, 15 из 15 случаев воспроизведены. `broker.ts` теперь очищает имена полей и metadata; DELETE account очищает headers до сброса identity; бинарное тело остаётся byte-identical. After: 0 из 15; 19/19 broker tests PASS. Это согласованность границы конфиденциальности, не sandbox escape/захват аккаунта и не гарантия против произвольного кодирования злонамеренным сервером.

Четыре npm audit (desktop/frontend, prod/full): 0 advisories. Targeted security suite: 144 PASS, 1 Linux-only GIO SKIP на macOS, 0 FAIL. Подпись, публичный канал обновлений и remote CI не появились; test policy остаётся отключённой.

### Lifecycle и media

На исходном `2837…` в native Ubuntu ARM64:

- 100 join/leave +100 chat cycles: все 110 PeerConnection (включая warmup) закрыты, live tracks/clients/peers и SFU resources после teardown — 0. Этот короткий lifecycle имеет RTP=0 и сам по себе не доказывает доставку медиа. Первый прогон сохранён как FAIL из-за строгого равенства DOM listeners при их снижении 303→155; observer-only rerun проверяет отсутствие роста и все исходные zero-resource assertions, PASS.
- Отдельный SFU suite: 8/8 PASS, 2/3/4/5 участников напрямую и через TURN, фактические RTP/Opus/VP8 decode checks; SFU peers/rooms/tracks/subscriptions/TURN allocations после stop — 0. Heap этого suite не используется как доказательство утечек: harness намеренно хранит массивы объектов для проверок.
- 100 camera replacements +100 microphone replacements +100 synthetic display start/stop: PASS, 301 capture, все tracks/clients/PeerConnection освобождены. Это Chromium fake devices + Pion, не реальный portal picker или физическая камера.
- 100 server switch и 100 account WebSocket reconnect: PASS; reconnect Query count остаётся 4. На первом after-кандидате `21e365…` 100 account replacements +100 logout/login также прошли функционально; повторный TTL wait в этом прогоне явно пропущен.

Actual AuthProvider baseline: после 100 account changes и 100 logout/login Query objects 4→304→604; после teardown 603 detached Query /603 GC timers, active observers — 0, WebSocket 201 создан/201 закрыт. Через **фактические 301 секунду** timers 603→0, queries 603→2, JS heap 6 019 652→3 920 544 B. Строгая проверка `retainedQueries===0` **FAIL**, сохранена; это нельзя назвать полным PASS или доказанной бесконечной утечкой.

Два оставшихся Query имеют shallow 152 B и retained union 408 B по raw graph; два QueryObserver — union 10 780 B. Кратчайший путь удержания проходит через V8 FeedbackVector/AllocationSite/DescriptorArray/AccessorPair/getter context, а не активный GC timer. Путь сам по себе не доказывает безопасное плато. Evidence: `baseline-native-arm64/identity-100/{result,retained-heaps,after-gc-retainer-paths-engine-labels}.json`. Auth lifecycle не менялся ради неподтверждённой причины. Открытый пункт: повторная длительная проверка/разбор двух остаточных объектов.

Дополнительный независимый разбор (`security/query-retainer-diagnosis/diagnosis.json`) сопоставил getter с `addSignalProperty` закреплённого TanStack Query5.104.0; второй Query достигается через production `MessageThread.queryFn`/QueryObserver. В отдельном Chromium152/Electron44.7.1 isolate на macOS, без React/MeetSpace/WeakRef/подмены таймеров, обычный `fetchQuery` оставил0 объектов, `fetchInfiniteQuery` —1 после10/100/200/500 циклов и ещё3 s/GC; путь удержания совпадает. Это воспроизводит взаимодействие библиотеки и движка и исключает необходимость нашего instrumentation для первичного удержания. Такой короткий host repro **не заменяет native identity тест и не доказывает универсальное плато**. Продукт и зависимости по этому предположению не изменялись; исходный FAIL остаётся открытым.

Host native services100 и Linux StatusNotifier disposal110 PASS, late callbacks/retained monitors — 0; DBus adapter здесь синтетический, реальный panel/tray этим не подтверждается. Дополнительно frontend media38/38 и targeted native58/58 PASS.

### Финальный кандидат и воспроизводимость

Полная сборка main + общей React frontend PASS. Финальный source digest **`441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059`**, 410 точных файлов, версия сохранена **0.1.1-beta**. Freeze manifest/archive: `final-v2-source-inputs.json`, `final-v2-source-overlay.tar.gz`. Единственное продуктовое изменение этого этапа — `desktop/src/broker.ts`; прочие изменения — QA instrumentation/tests. Native after использует отдельную копию, baseline не перезаписан.

Первый after кандидат `21e365…` отличается от финального только двумя test files: исправлением Linux-path negative fixture и уточнением ограничения raw heap graph. Native полный suite сначала выявил ошибку самого теста: `path.join(..., '..', ...)` нормализовал запрещённый путь до вызова проверяемой функции; macOS случайно отклоняла его из-за `/var` symlink. Теперь отдельно проверяются настоящий directory symlink, raw noncanonical path и допустимый canonical path. Native результат после исправления: 236/236 PASS, без skips.

Во время работы checkout получил внешний commit `334315c788917f65ae054233c765063eaa1f007b` (`linux`); агент не создавал и не переписывал его. Финальный manifest использует этот HEAD. Исходная логика продукта совпадает с after21, однако VITE commit/time metadata меняет байты renderer. Поэтому final packages требуют полного совпадения manifest (commit + dirty state + 410 file hashes), отдельной сборки на HEAD334 и короткой проверки actual final renderer. Промежуточные сборки со старым HEAD сохранены отдельно и не считаются финальными.

Полный desktop unit suite: **235 PASS, 1 platform SKIP, 0 FAIL** (236 tests); frontend foundation PASS. Offline analyzer5/5 PASS. Profile watchdog отдельно проверен с delayed SIGTERM и forced SIGKILL: временный профиль удаляется только после подтверждённого завершения собственного дочернего процесса; отрицательные probes сохранены.

Новые повторяемые harness: `linux-lifecycle-runner.cjs` (identity/server/reconnect), `linux-media-lifecycle-runner.cjs` (camera/mic/synthetic display), `linux-native-lifecycle-runner.cjs` (services/SNI), `stage07-retained-heap.mjs` (offline dominators). Каталоги evidence создаются эксклюзивно; Electron override проверяется против pinned runtime, prebuilt Pion fixture — по platform/arch/source/SHA. Instrumented profile поддерживает отдельный output path, Linux FD/threads/RSS, startup и RAF observer; missing/denied metrics сохраняются как partial, sandbox не ослабляется.

### Сопоставимый before/after

`paired-native-profile-comparison.json`: один парный прогон на native Ubuntu ARM64, одинаковый observer и Xvfb, RAF выключен перед CPU interval. Baseline2837 и after21 оба PASS; продуктовый source после after21 не менялся. Тестовые x64 VM на время измерений остановлены/paused, обычное приложение пользователя оставлено в одинаковом состоянии.

| Метрика | Before2837 | After21 |
|---|---:|---:|
| CPU за 5 s, % одного ядра | 1,0 | 1,0 |
| Warm instrumented startup | 897 ms | 791 ms |
| Settled main JS heap | 9 585 732 B | 9 533 936 B |
| Settled renderer JS heap | 5 810 224 B | 5 806 000 B |
| Settled RSS sum | 617 176 KiB | 619 136 KiB |
| Settled threads | 75 | 73 |
| Settled FD, 3/4 processes | 168 | 169 |

Это **не доказательство ускорения**: один warm instrumented sample и Xvfb не дают значимого percentile/cold-start/physical-jank вывода. После 100+100 циклов ресурсы возвращаются к warmup. В восьми paired snapshots (`paired-retained-heaps.json`) Broker1→1, WebSocket2→2, renderer Query16→16/retained union5212 B в обоих прогонах, DOMTimer22→20; main Timeout after11→11. Подтверждённый результат исправления — 15→0 отражений секретов без выявленной регрессии этих lifecycle метрик.

### Финальный Ubuntu ARM64 пакет

`native-evidence-handoff.json` и `final-native-arm64/`: final HEAD334 / digest441 / все410 файлов подтверждены до сборки и после acceptance; полный native suite **236/236 PASS, 0 SKIP**. DEB98027384 bytes, SHA256 `bd69998620d0d193570145f6f8f72d464c844111d0b39502848efd1bc236d69d`. Статическая проверка и package-manager install → controlled lower-version upgrade → reinstall → remove PASS; marker отдельного тестового профиля сохранён. Lower-version fixture проверяет механизм обновления, не миграцию исторических пользовательских данных.

Actual final installed main/preload/shared React, sandbox/contextIsolation, private libsecret, opt-in autostart → GIO second-instance → opt-out и quit exit0 PASS (`final-native-arm64/package-lifecycle-v2/candidate-smoke.json`). Собственный профиль/keyring удалён, обычные MeetSpace PID6693 и keyring PID2245 сохранены, policy snapshots до/после идентичны. Это Xvfb component acceptance, а не физическая Wayland/media/tray проверка.

### Ubuntu 22.04 x64: проверка компонентов

На final HEAD334 / digest441 в собственной QEMU TCG VM прошли sandbox/preload/IPC проверки, отклонение чужого IPC sender и небезопасных URL, single-instance/deep links, minimize/quit cleanup и opt-in/GIO автозапуск. Evidence: `x64-matrix/ubuntu22/component-{baseline-v3,autostart}/`. Предыдущий запуск без разблокированного отдельного keyring остановился на системном запросе; его FAIL сохранён. Финальный прогон использовал свой ephemeral keyring и проверил cleanup.

Дополнительные два SFU сценария — direct и TURN relay — PASS, фактические RTP288/315 packets, Opus receive и VP8 decode, повторное подключение с новым mediaPeerId и ростом counters. В каждом случае закрыты3 PeerConnection/6 tracks, SFU peers/rooms/tracks/subscriptions/TURN allocations после teardown0 (`component-sfu-v2/evidence/`). Это fake capture и реальные локальные Pion/TURN transports; слышимость звука и физические устройства в headless VM не проверены.

### Fedora и Windows

Fedora Workstation44, GNOME Wayland, SELinux Enforcing, x64 TCG: диагностический запуск старого пакета2837 прошёл actual packaged main/preload/React, sandbox, private libsecret, GIO opt-in/second-instance/opt-out, quit exit0. Observer использует синхронное чтение синхронных полей и прежние 7/8 s deadlines. Async constant probe тоже ответил (88 ms), поэтому первопричина предыдущего timeout **не установлена**. Это новый PASS в его точной области, не замена старых FAIL; финальный441 проверен отдельно ниже. Первый observer-stage07 запуск отказал из-за устаревшего пути evidence; собственный оставшийся процесс и профиль удалены, receipt сохранён.

Финальный RPM441 затем прошёл **DNF install → upgrade → reinstall → remove**, сохранение тестового профиля и actual packaged main/preload/React/GIO/quit0. Установленный app.asar SHA совпал с canonical static receipt (`fc68156b…`). Evidence: `fedora44-workstation/final-lifecycle-v5/{rpm-lifecycle,candidate}.json`. Проверка выполнена обычным liveuser с отдельными DBus/keyring, пакетные операции — существующим QA-admin, SELinux Enforcing сохранён. Lower Release0 fixture — контролируемый stage06 payload, не историческая миграция данных.

Отрицательные попытки сохранены: первоначально собственный RPM с mode0600 был недоступен liveuser; затем старый helper ошибочно ожидал у liveuser sudo, а Live ISO root не вместил временный объём обновления. Использована отдельная readable копия того же RPM, пакетный менеджер вынесен в существующий admin-сеанс, пустой `/opt` подключён к собственному persistent QA-диску. Защита ОС не менялась. После ручной разблокировки Mac выполнен отдельный обычный GIO launch без inspector: видна страница подключения MeetSpace, окно закрыто через штатные controls/Alt+F4, процесс завершился без forced termination, свой профиль/keyring удалён. Снимки `final-normal-visible.png`, `final-normal-closed.png`, receipt `visual-acceptance.json`. Exit code detached GIO child недоступен и не заявляется; подтверждённый exit0 выше относится к inspector запуску. Полная media/portal/tray приемка из этого не следует.

Windows11 ARM64 UTM: after21 и отдельный **финальный441/HEAD334** actual shared main/preload/React + production native-shell regression PASS (создание Tray и вызов callbacks/close/show, single instance/deep link, bounds/preferences restart, quit cleanup, external URL rejection). Это unpackaged/hidden React runtime и программные callbacks; физические клики по системному tray и media acceptance здесь не проверяются. Отдельный профиль, системные регистрации запрещены test guards, старое приложение не менялось. Одноразовая задача запускалась в Session1 с InteractiveToken и Limited RunLevel, но фактическая текущая сессия оставалась high-integrity/administrator; **standard-user security acceptance NOT TESTED**. Собственные процессы/task/profile удалены; task exit0. Receipt: `security/windows-arm64-final-v2/final-report.json`.

Финальные Windows x64/ARM64 installers441/HEAD334 собраны и статически проверены, без установки в пользовательскую VM. Immutable outputs: `desktop/artifacts/windows/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/`. x64 SHA256 `c9caed1cd7a6dd0dc900ed830d4a9505160d3966a637ba3444ca3b2e832a05fe`; ARM64 `899c301d…` (полный digest в `windows-installers/final-v2-verification.json`). Оба unsigned/test, updates disabled, `windowsRuntimeTested:false` именно для installer lifecycle. Runtime proof выше относится к unpackaged exact payload, не к установке этих exe.

### Проверка настоящего сервера

`security/live-auth-native/{result,final-cleanup}.json`: final334/441 production broker + Electron Chromium transport + собственный native `gnome_libsecret` на Ubuntu ARM64 успешно подключился к `https://meeting.janickiy.com/`. Одна попытка POST login —200; GET capabilities/me —200, соответствие текущего пользователя проверено только boolean; logout своей сессии —200. Неавторизованные401 до входа ожидаемы. Сервер сообщил `v1.0.0-meeting.20261016-group-notifications.1`.

Это **auth/network-layer проверка без main/preload/React UI**, без сообщений, комнат, звонков и записи. Пароль и native diagnostics не печатались, временные credential input, профиль/keyring и процессы удалены; обычное приложение и keyring сохранены. UI-auth и реальный media round-trip к этому серверу в этапе7 не проверены.

### Финальные установочные файлы

Все пакеты находятся в `desktop/artifacts/linux/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/`. Независимая сверка SHA256/SHA512 четырёх Linux файлов и полных source manifests — PASS (`independent-final-linux-artifacts.json`). Завершающая parent-проверка всех410 исходных файлов и SHA256/размера двух Windows EXE также PASS (`parent-final-source-verification.json`). Переданный в Fedora RPM побайтно совпадает с финальным; AppImage соответствует хешу фактического запуска через FUSE в Ubuntu22.

| Архитектура | Форматы | Статическая проверка | Запуск формата |
|---|---|---|---|
| x64 | DEB, RPM, AppImage | PASS, final334/441 | AppImage Ubuntu22 PASS; DEB Ubuntu22/24, Debian12/13, Mint22.3 PASS; RPM Fedora44 PASS |
| ARM64 | DEB | PASS, final334/441 | Установленный DEB PASS, Ubuntu24 native UTM |

AppImage запускался исходным файлом через FUSE, с включённой песочницей; shared React/main/preload, GIO second-instance, updates disabled, quit0 и cleanup PASS. Это Xvfb component runtime, не обычный GUI/login/physical capture (`x64-matrix/ubuntu22/appimage-runtime/`).

## Матрица текущего этапа

| Target | Среда | Install/auth/chat/call/screen/recording/tray/updates |
|---|---|---|
| Ubuntu 24.04 ARM64 | Native UTM, own Xvfb component profile | Final441 package lifecycle/runtime/GIO + live-server broker auth PASS; UI-auth/physical media/portal/tray NOT TESTED |
| Ubuntu 22.04 x64 | Собственная QEMU TCG VM | Final441 DEB lifecycle/runtime/GIO + security + 2 SFU cases PASS; full GUI/actual server/physical devices NOT TESTED |
| Ubuntu 24.04 x64 | Собственная QEMU TCG VM, Xvfb | Final441 DEB lifecycle/runtime/GIO PASS; full GUI/actual server/physical devices NOT TESTED |
| Debian 12 x64 | Собственная QEMU TCG VM, Xvfb | Final441 DEB lifecycle/runtime/GIO PASS; full GUI/actual server/physical devices NOT TESTED |
| Debian 13 x64 | Собственная QEMU TCG VM, Xvfb | Final441 DEB lifecycle/runtime/GIO PASS; full GUI/actual server/physical devices NOT TESTED |
| Mint 22.3 x64 | Подписанный Live ISO, persistence, QEMU TCG, Xvfb | Final441 DEB lifecycle/runtime/GIO PASS; full GUI/auth/physical devices NOT TESTED |
| Fedora Workstation 44 x64 | Подписанный Live ISO, GNOME Wayland, QEMU TCG | Final441 RPM lifecycle/runtime/GIO PASS; ordinary visible startup/normal close PASS; actual server/physical devices NOT TESTED |
| Windows 11 ARM64 | UTM, final441 unpackaged, actual Session1 high-integrity account | Bounded runtime PASS; installer/auth/call/screen/physical tray NOT TESTED |
| Windows 10 22H2 / Windows 11 x64 | Подтверждённой среды нет | NOT TESTED |

Ubuntu22 packaged smoke использует отдельный разблокированный `gnome-libsecret`. В headless Ubuntu24 x64, Debian12/13 и Mint22.3 secure storage сообщает `unavailable/basic_text` (`insecure-backend`) и корректно отказывает в небезопасном хранении; package/bootstrap/sandbox/GIO PASS в этих строках **не означает успешную авторизацию или хранение credentials**. Реальный live-server login проверен отдельно на native Ubuntu ARM64 с libsecret. В Mint Live исходный `apparmor_restrict_unprivileged_userns=0` сохранён; это описание конкретного образа, не утверждение о стандартной политике установленного Mint.

## Сохранность среды и проверяемые границы

Временные Linux/Windows профили, credential inputs, private keyrings, созданные процессы и одноразовая Windows task удалены по ownership-проверкам. Пользовательские native Ubuntu и Windows установки сохранены. Собственная Fedora VM штатно выключена, SSH port закрыт; тестовый пакет и `/opt` bind удалены, SELinux остаётся Enforcing (`fedora44-workstation/{stage07-fedora-final-cleanup,final-vm-shutdown}.json`). Диски и отрицательные QA evidence сохранены для повторяемости. Результаты сохранности и штатного выключения пяти собственных x64 distro clones находятся в `x64-matrix/<distro>/{cleanup-inspection,shutdown}.json`; исходные stage6 диски не менялись.

Открытые пункты для полного завершения приёмки:

- Native identity lifecycle после фактического TTL оставляет2 Query: strict FAIL сохранён. Независимый малый repro объясняет первичный путь, но повторные длительные native batches и проверка безопасного исправления ещё нужны.
- Полная матрица X11/Wayland, реальные camera/mic/audio-device hotplug, portal picker/screen sharing, recording и физические tray/notifications не выполнены на всех семи ОС в этом этапе.
- UI-auth и многопользовательский звонок к настоящему серверу в этом этапе не проверены; локальные SFU direct/TURN tests и live broker auth имеют отдельные scopes.
- Native x64 performance, cold-start percentiles и физическая плавность NOT MEASURED; одиночное paired Xvfb измерение не доказывает ускорение.
- Windows10/Windows11 x64 runtime, установка финальных Windows EXE и standard-user Windows11 ARM64 security acceptance NOT TESTED.
- Подписанный production release, реальный update feed/upgrade chain и remote CI run NOT TESTED; тестовые сборки намеренно отключают updater.

## Ограничения

Результаты эмуляции x64 не являются native performance acceptance. Xvfb, локальные TLS/Pion fixtures и fake media не подтверждают физические устройства, системный portal picker или реальный сервер. Подпись и публичные update feeds отсутствуют; test policy остаётся отключённой. Никакие старые PASS не заменяют проверку изменённого кандидата. После этого этапа переход автоматически не выполняется.
