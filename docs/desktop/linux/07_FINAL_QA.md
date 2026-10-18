# Linux stage 7 — оптимизация, безопасность и итоговая QA

Дата начала: 19 октября 2026 (Europe/Moscow). Статус: **IN PROGRESS, не release-ready**. Версия продукта 0.1.1-beta.

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

`retained-heaps.json` анализирует четыре снимка по дереву dominators с исключением weak edges. Это консервативный raw graph, без специальных page-ownership/shortcut/ephemeron эвристик [Chrome DevTools](https://chromium.googlesource.com/devtools/devtools-frontend/+/e343bdfafbbee2aac647db0915cb766dcaf04122/front_end/entrypoints/heap_snapshot_worker/HeapSnapshot.ts), не идентичная DevTools оценка и не RSS. Алгоритм проверен против независимого removal oracle на 200 графах, включая циклы, глубокий граф, weak edges и пересечение retained subtrees. Отчёт использует только allowlisted классы, не выводит строки heap; parser errors также скрыты.

Результат: по одному Broker/Assets/Updates/Shell/Notifications до и после; WebSocket 2→2 (retained union 8664→8492 B), Timeout 9→9 (1408→1408 B), renderer Query 18→18 (6676→6660 B), DOMTimer 21→20. Рост общего графа не сопровождается ростом этих живых ресурсов; это ограниченный результат данного сценария, а не универсальное отсутствие утечек.

### Подтверждённое исправление безопасности

P2: буквальное отражение сервером известных JWT/cookie/ticket в именах JSON-полей и разрешённых HTTP/SSE headers проходило через broker в renderer. Repro использует только синтетические секреты: `security/reflected-credential-before.json`, 15 из 15 случаев воспроизведены. `broker.ts` теперь очищает имена полей и metadata; DELETE account очищает headers до сброса identity; бинарное тело остаётся byte-identical. After: 0 из 15; 19/19 broker tests PASS. Это согласованность границы конфиденциальности, не sandbox escape/захват аккаунта и не гарантия против произвольного кодирования злонамеренным сервером.

Четыре npm audit (desktop/frontend, prod/full): 0 advisories. Targeted security suite: 144 PASS, 1 Linux-only GIO SKIP на macOS, 0 FAIL. Подпись, публичный канал обновлений и remote CI не появились; test policy остаётся отключённой.

## Матрица текущего этапа

| Target | Среда | Install/auth/chat/call/screen/recording/tray/updates |
|---|---|---|
| Ubuntu 24.04 ARM64 | Native UTM, Wayland; own Xvfb component profile | IN PROGRESS |
| Ubuntu 22.04 x64 | Собственная QEMU TCG VM | NOT TESTED в этапе 7 |
| Ubuntu 24.04 x64 | Собственная QEMU TCG VM | NOT TESTED в этапе 7 |
| Debian 12 x64 | Собственная QEMU TCG VM | NOT TESTED в этапе 7 |
| Debian 13 x64 | Собственная QEMU TCG VM | NOT TESTED в этапе 7 |
| Mint 22.3 x64 | Подписанный Live ISO, persistence, QEMU TCG | NOT TESTED в этапе 7 |
| Fedora Workstation 44 x64 | Подписанный Live ISO, GNOME Wayland, QEMU TCG | NOT TESTED в этапе 7 |
| Windows 11 ARM64 | Существующая UTM пользовательская среда | NOT TESTED в этапе 7 |
| Windows 10 22H2 / Windows 11 x64 | Подтверждённой среды нет | NOT TESTED |

## Ограничения

Результаты эмуляции x64 не являются native performance acceptance. Xvfb, локальные TLS/Pion fixtures и fake media не подтверждают физические устройства, системный portal picker или реальный сервер. Подпись и публичные update feeds отсутствуют; test policy остаётся отключённой. Никакие старые PASS не заменяют проверку изменённого кандидата. После этого этапа переход автоматически не выполняется.
