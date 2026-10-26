# MeetSpace Desktop — измерения производительности

Дата: 26 октября 2026. Исходный commit `0edb345`; приложение `0.1.11-beta`. Итог: **измеримого основания для архитектурной оптимизации не обнаружено**. Обнаруженные security и test-harness дефекты исправлены отдельно. Этот аудит не доказывает ускорение приложения на Windows/Linux.

## Метод и воспроизводимость

Измерялся настоящий main/preload/shared React renderer, а не отдельная демонстрационная страница. Backend — отдельный процесс с localhost HTTPS/WSS/SSE fixture и доверенным тестовым CA. Рабочие аккаунты не использовались. Хост: macOS 27.0.1 (26A434), Apple M5 Pro ARM64, 18 логических CPU, 48 GiB RAM. `os.release` внутри Electron сообщает 27.0.0; это версия kernel, не ProductVersion. Хостовая Node toolchain 24.19.0; встроенная Node после обновления — 24.22.0, V8 15.2.124.43-electron.0.

Команда: `node desktop/tests/stage07-profile-runner.cjs after --evidence=<absolute-directory>`, с удалённым `ELECTRON_RUN_AS_NODE` из окружения. До этого выполнена `npm --prefix desktop run build`. 10 прогревочных циклов → 100 открытий/закрытий личного чата → cooldown/GC. В checkpoints собирались V8/CDP heap, DOM, Electron process metrics и `lsof` FD. Затем проверялись 100 WSS/SSE циклов, synthetic suspend/resume, настоящий crash renderer/reload и смена server profile. Подробности retained objects — в [отчёте памяти](DESKTOP_MEMORY_LEAK_AUDIT.md).

Raw evidence находится в `desktop/artifacts/desktop-audit-20261026/` (локальные, игнорируемые Git артефакты). Переносимый индекс и сводка — [EVIDENCE_SUMMARY.json](EVIDENCE_SUMMARY.json). Heap snapshots не публикуются как обычные документы: в общем случае они могут содержать данные приложения.

| Прогон | Source-tree SHA-256 | Runtime | Результат и граница |
| --- | --- | --- | --- |
| `mac-baseline` | исходная сборка: `d7eb354a5f54f15467709e4824c0694232a44be018b3fdb3a61422f42a560c66` | Electron 44.7.1 | FAIL до измерений: устаревшее ожидание welcome screen |
| `mac-baseline-v2` | `b3be2f0a314e8bcdc95ca43b1a099b60de8cbb621d1652b948e6d2ac8039e5d2` | Electron 44.7.1 / Chromium 152.0.7977.149 | 100 chat cycles выполнены; затем FAIL: quiet SSE fixture попадал в timeout/retry, поэтому resource assertion не прошёл |
| `mac-after` | `046039dc46e25b1e65ca7419d7c0a2caf7b9df7a3edb43b83f584a68a236dce2` | Electron 44.9.3 / Chromium 152.0.7977.167 | PASS всего сценария после исправления fixture heartbeat |

**Это не контролируемый A/B эксперимент:** baseline неполный, heartbeat и instrumentation различаются, по одному запуску, системные кеши прогреты. Таблица ниже сохраняет реальные числа, но не позволяет приписать разницу обновлению Electron или исправлению broker. Source hash включает тестовые inputs и меняется при правках harness; каждый результат привязан к собственному hash.

## Память и ресурсы: прогрев → после 100 chat cycles и cooldown

| Метрика | Baseline 44.7.1 | After 44.9.3 |
| --- | --- | --- |
| Main JS heapUsed, байты | 9 434 756 → 9 279 216 | 9 379 076 → 9 869 856 |
| Renderer JS usedSize, байты | 5 117 288 → 5 872 036 | 5 100 732 → 6 068 320 |
| Main RSS, байты | 210 911 232 → 501 039 104 | 210 403 328 → 508 788 736 |
| Renderer working set, KiB | 159 472 → 343 200 | 158 288 → 348 304 |
| GPU process working set, KiB | 101 968 → 102 496 | 101 536 → 101 696 |
| DOM nodes / documents | 839 / 4 → 839 / 4 | 839 / 4 → 839 / 4 |
| DOM JS listeners | 236 → 237 | 236 → 237 |
| Открытые FD по процессам Electron, сумма | 151 → 147 | 150 → 148 |
| Число процессов Electron | 5 → 5 | 5 → 5 |

Рабочий набор/RSS включает стоимость heap snapshots, profiler и аллокаторов. Скачок RSS совпадает с наблюдением heap; он **не доказывает утечку** и не является оценкой обычного потребления пользователя. В after owned maps/listeners вернулись к warmup: один account socket, один SSE stream, один app timer, одно окно, один tray; operations/assets/media leases/notifications — ноль. Увеличение renderer heap на 967 588 байт за один прогон требует оценки retained references, а не объявления бесконечного роста. Такой разбор выполнен отдельно.

## Startup, CPU и event loop

| Метрика | Baseline | After | Ограничение |
| --- | --- | --- | --- |
| Instrumented main → welcome, ms | 540.838 | 232.264 | Однократный запуск с filesystem cache; не cold boot |
| Instrumented main → connection screen, ms | 546.972 | 292.451 | То же; не доказанное ускорение |
| Idle main CPU, % одного ядра | NOT MEASURED | 0.30648 | 5 s после stress, hidden window, локальный fixture |
| Idle renderer CPU, % одного ядра | NOT MEASURED | 0.96494 | То же |
| Idle GPU-process CPU, % одного ядра | NOT MEASURED | 0.00178 | CPU процесса GPU, **не GPU utilization** |
| Main event-loop delay p50 / p95 / max, ms | NOT MEASURED | 21.070 / 21.217 / 77.267 | Sampling resolution 20 ms; включает GC/checkpoints; не production latency SLO |

Event-loop min 19.022 ms, mean 20.941 ms. Нельзя трактовать resolution 20 ms как 21 ms дополнительной задержки каждого действия. GPU compositing/rasterization/video encode/decode доступны по `app.getGPUFeatureStatus`; это не измерение загрузки GPU и не подтверждение аппаратного codec path на целевых ОС.

## Renderer CPU profile

`mac-after/stage07-after-renderer.cpuprofile`: 31 942 samples, около 39.956 s elapsed; суммарные sample deltas 39 955.215 ms. Сводка в `mac-after/cpu-profile-summary.json`:

- `(idle)`: 38 214.755 ms, 95.644% sample time;
- `(program)`: 432.935 ms, 1.084%;
- GC: 185.056 ms, 0.463%;
- крупнейший app self-frame, anonymous в production ChatPanel bundle: 163.621 ms, 0.410%.

Это sampling production bundle, а не React Profiler commit/recomposition count. По этому сценарию нет доказанного React hotspot, оправдывающего memoization или переписывание состояния. Минифицированные имена и инструментирование ограничивают причинную интерпретацию.

## Media и сеть

Pion fixture использует backend commit `66e482c9701b6c13f58bc93aee8d9f5cf932dd34`, source tree `8f30fd659ea9f2dbd6c16da02ae60082ff28ed31d2057d37aad873b96d51fe4a`, checksum-locked Go dependency. Это не production server. Свежий native macOS тест двух synthetic peers подтвердил двусторонний Opus/VP8 decode, late join, leave/rejoin и cleanup:

| Маршрут | Время сценария | Конечные counters fixture |
| --- | --- | --- |
| Direct | 3 054 ms | 61 603 bytes / 228 packets |
| TURN relay | 2 057 ms | 73 384 bytes / 271 packets; две активные TURN allocations до teardown |

Это функциональные счётчики коротких сценариев, **не** throughput, качество связи, WAN latency или сравнение скорости direct/relay. Отдельный media lifecycle выполнил 100 media и 100 chat cycles после прогрева; быстрый teardown не измеряет длительную нагрузку кодеков.

## Дополнительный native Ubuntu ARM64 прогон

Ubuntu 24.04.5 LTS UTM, kernel 6.8.0-147-generic, 4 vCPU, 8 304 300 032 B RAM; Electron 44.9.3, ARM64. Отдельные Xvfb/software graphics, DBus и временная связка ключей. Snapshot `9b373d498d09d74cb8b2a7b468f7415569c93c7e4ae23e4b48cb39233b89fef5`. Evidence: `desktop/artifacts/audit-20261026/linux-arm64/initial/evidence-volatile-keyring/lifecycle-after/stage07-profile-after.json`. Это отдельный after-only прогон, не before/after сравнение с macOS и не performance acceptance физического рабочего стола.

100 chat cycles и 100 дополнительных WSS/SSE cycles — PASS. После warmup → settled: main V8 heap 9 685 600 → 10 211 264 B, renderer heap 5 130 460 → 6 119 444 B; DOM 839 nodes / 4 documents / 236 listeners остаётся неизменным. Procfs: FD 225 → 222, threads 84 → 83, процессов 5. Main RSS 196 521 984 → 207 310 848 B; renderer RSS 158 732 → 177 120 KiB. RSS суммы процессов включают общие страницы и не являются PSS.

Однократный instrumented startup: welcome 221.103 ms, connection screen 224.049 ms. Idle 5 s: main 1.2%, renderer 2.0% одного ядра. Event-loop p50/p95/max 20.152/22.823/24.740 ms при resolution 20 ms. В mapped Xvfb renderer зарегистрировано 3184 RAF callbacks, два интервала >50 ms, max 150 ms; включены GC и heap capture. Это измерение искусственного display backend, **не** физической плавности или dropped video frames. GPU utilization, слышимый звук и реальный capture этим прогоном не подтверждены.

## Не измерено и что остаётся для performance acceptance

Cold startup после перезагрузки, серия warm startup с медианой/p95, sustained call/screen-share CPU, GPU utilization/VRAM, frame drops/visible jank, физическая camera/mic/screen нагрузка, Windows HANDLE/threads, power use и WAN traffic — **NOT MEASURED**. Hidden-window RAF throttled: поле `jank` явно `NOT_MEASURED`, нулевые dropped frames не выдуманы. Xvfb не заменяет физический Wayland/multi-monitor display. Новые Ubuntu package checks подтверждают только описанную в [тестовом отчёте](DESKTOP_TEST_REPORT.md) область, не заполняют эти performance поля.

Следующий релизный замер: выделенная целевая машина без heap snapshots, одинаковый fixture/backend/размер окна, минимум несколько warm/cold запусков, видимый UI и фиксированные media маршруты, до/после одной правки. Текущие данные оправдывают сохранение архитектуры; обещать снижение RAM/CPU или ускорение запуска по этому аудиту нельзя.
