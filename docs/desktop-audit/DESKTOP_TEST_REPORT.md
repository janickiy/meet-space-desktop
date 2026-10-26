# MeetSpace Desktop — итог проверки

Дата: 26 октября 2026. Исходный commit `0edb3451cb90d402eb81979115373a3de7fddf8d`, версия `0.1.11-beta`. Проверяется одна общая кодовая база Electron + React для Windows/Linux.

## Решение о готовности

**Общий выпуск по обязательной матрице: BLOCKED.** Проверки, реально выполненные на доступных средах, перечислены ниже; непроверенные ОС не сертифицированы. Новых подтверждённых Critical уязвимостей или утечек приложения в выполненных сценариях нет. Исправлены ошибка удаления credentials, применимые dependency advisories и дефекты воспроизводимости тестов. Чистый npm audit не покрывает все встроенные компоненты Electron.

Блокеры полной приёмки:

1. Нет свежих native результатов Windows 10/11 x64, Windows 11 ARM64 и шести Linux x64 целей; Windows signing/update acceptance не выполнялась.
2. Реальные камеры/микрофоны, длительные звонки, физический suspend/resume, multi-monitor, Wayland/PipeWire/XDG Portal и KDE не прошли свежую проверку. Synthetic media/power events не заменяют её.
3. Electron 44.9.3 содержит Node 24.22.0 и Undici 7.29.1 с остаточными upstream advisories. Достижимый exploit path в используемых приложением API не подтверждён, но риск не закрыт нулевым npm audit. Нужна версия Electron с исправленным embedded runtime либо документированное решение о принятии остаточного риска.
4. Начальный integration timeout не воспроизвёлся изолированно; исправлена доказанная гонка очистки теста, но причина задержки не установлена. Требуется наблюдение на целевой CI/OS матрице.

Публикация, push, включение обновлений, замена обычного приложения в UTM и изменения production backend в рамках аудита не выполнялись. Отдельные audit-пакеты не являются новым пользовательским выпуском.

## Матрица целевых ОС

`NOT TESTED` означает отсутствие свежего результата этой ОС/архитектуры; данные старых релизов и cross-build не засчитываются. `PARTIAL` означает только перечисленные локальные проверки, а не полную приёмку платформы.

| ОС / архитектура | Сеанс | Build / package | Install / runtime | Media / chat | Screen capture | Updates |
| --- | --- | --- | --- | --- | --- | --- |
| Windows 10 22H2 x64 | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Windows 11 x64 | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Windows 11 ARM64, native | NOT TESTED; найденная UTM выключена | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Ubuntu 24.04 LTS x64 | X11/Wayland NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Ubuntu 22.04 LTS x64 | X11/Wayland NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Debian 12 x64 | X11/Wayland NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Debian 13 x64 | X11/Wayland NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Linux Mint 22 x64 | X11/Wayland NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Fedora Workstation x64 | NOT TESTED; точная версия Workstation не тестировалась | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Ubuntu 24.04.5 LTS ARM64, native UTM | Изолированный Xvfb/DBus; пользовательский GNOME не тестируется | PASS clean build + AppImage; DEB/RPM NOT TESTED | PARTIAL: original AppImage/preload/sandbox/quit/GIO PASS | 100 React chat + 100 WSS/SSE cycles PASS; physical media NOT TESTED | Реальный portal NOT TESTED | Disabled policy PASS; actual update NOT TESTED |

Fedora 44 в CI container definition не является выполненным тестом Fedora Workstation. Поддержка Windows 10+ и x64/ARM64 заявлена самим закреплённым Electron; это upstream compatibility contract, не наш PASS. Для Linux verifier проверяет фактический ELF/GLIBC и архитектуру; декларация DEB `libc6 >= 2.35` сама по себе не доказывает совместимость дистрибутива. См. [supply chain](SUPPLY_CHAIN_EVIDENCE.md).

### Native Ubuntu ARM64

Проверка выполнена в отдельном каталоге `/home/meetspace/releases/desktop-audit-20261026`, с временным профилем и отдельной связкой ключей Secret Service. Пользовательская установка и её данные сохранены. Kernel 6.8.0-147-generic, aarch64, 4 vCPU, около 7.73 GiB RAM, Xvfb/software graphics. Это настоящий native Linux процесс, но не визуальная приёмка рабочего стола GNOME/Wayland.

Итоговый source-tree SHA-256: `056f3f41ce5a6f3f6979187cc4775c7502bfe87dc78726a27b4193bf41f31d48` (464 inputs, dirty audit snapshot от исходного commit). Локальный код и переданный VM snapshot совпадают. Audit AppImage 0.1.11-beta: **119 391 532 bytes**, SHA-256 `7f37edee9dac271920e1051a9eb598d3d61a1ec16c78671d3566f6de2c77556a`.

Evidence root: `desktop/artifacts/audit-20261026/linux-arm64/final/`:

| Сценарий | Результат | Квитанция |
| --- | --- | --- |
| Clean npm ci → native package driver → ELF/runtime verifier | PASS; до driver нет Electron dist/path.txt, ручного require не было | `final-clean-install-observation.json`, `final-build-status.json`, `final-build.log`, вложенный `linux-artifact-verification.json` |
| Исходный AppImage, настоящий main/preload/sandboxed React | PASS; packaged ARM64 44.9.3, private gnome-libsecret доступен, updates disabled | `evidence-final/original-appimage.json` |
| Opt-in autostart / GIO second instance / opt-out / actual quit | PASS; собственный app process завершился exit 0, временный профиль удалён | Та же квитанция; пользовательские defaults не изменялись |
| 100 React chat cycles + 100 typed WSS/SSE cycles | PASS, 61.56 s полного сценария | `evidence-final/lifecycle-after/stage07-profile-after.json` |
| Synthetic suspend/resume, actual renderer crash/reload, server switch | PASS; app-owned resource maps возвращаются к warmup | Та же квитанция |

В итоговом native lifecycle main V8 heap 9 686 648 → 10 226 952 B, renderer 5 127 972 → 6 127 276 B; DOM 839 nodes / 4 documents неизменны, listeners 236 → 237, FD 237 → 234, threads 89 → 88. Это короткий instrumented after-only прогон, не доказательство ускорения и не длительный soak. Числа первого native snapshot отдельно сохранены в memory/performance reports; они не смешиваются с итоговым пакетом.

Сохранены исходные отрицательные результаты: первый clean package упал из-за lazy Electron reference; первые private-keyring harness старты — из-за отсутствующего default Secret Service collection. Исправлен packaging driver, а тестовый keyring bootstrap изолирован от пользовательской связки. Эти неудачи не объявляются PASS. AppArmor restriction не отключалась; разрешение для точного audit executable было временным и удалено после проверки. DEB/RPM install/uninstall, обычный пользовательский запуск, физические устройства и portal остаются NOT TESTED.

## Выполненные проверки общего кода на macOS ARM64

macOS — диагностический хост, а не одна из требуемых целей выпуска. Electron 44.9.3 / Chromium 152.0.7977.167. Команды запускаются из указанного каталога с локальной pinned toolchain. Для прямого вызова Electron удалён `ELECTRON_RUN_AS_NODE`. Сборка выполнена перед прямыми тестами, поэтому npm pretest не повторяется для каждого runner.

| Команда / каталог | Результат | Evidence в `desktop/artifacts/desktop-audit-20261026/` |
| --- | --- | --- |
| `npm run build`, desktop | PASS до и после fixes; main TypeScript + desktop React bundle | `build-baseline.log`, `build-after.log` |
| `npm run build`, frontend | PASS, `tsc --noEmit && vite build` обычного web frontend | `frontend-web-build.log` |
| `npm run lint`, frontend | FAIL исходно на форматировании четырёх файлов; PASS после formatting-only правки | `frontend-lint-after.log` |
| `node --test tests/*.test.cjs`, desktop | Итоговые 330 tests: **329 PASS, 0 FAIL, 1 SKIP**; первоначальная регрессия — 317/318 PASS с тем же SKIP | `final-unit.log`, `desktop-unit.log`; первоначальные 42 файла в `local-checks.json` |
| `npm run typecheck`, desktop | PASS на итоговом коде | `final-typecheck.log` |
| `npm run check:desktop-foundation`, frontend | 30/30 PASS | `frontend-foundation.log` |
| `npm run check:desktop-media`, frontend | 39/39 PASS | `frontend-media.log` |
| `npm run check:desktop-assets`, frontend | 9/9 PASS | `frontend-assets.log` |
| `electron tests/electron-smoke.cjs`, desktop | Исходно FAIL; после welcome navigation fix PASS | `electron-smoke.log`, `electron-smoke-after.log` |
| `node tests/integration-runner.cjs`, desktop | Первый запуск FAIL timeout; unchanged isolated rerun PASS; после cleanup fix PASS | `electron-integration.log`, `electron-integration-isolated.log`, `electron-integration-after.log` |
| `node tests/electron-ui-runner.cjs`, desktop | PASS | `electron-ui.log` |
| `node tests/native-shell-runner.cjs`, desktop | PASS first/restart | `electron-native.log` |
| `node tests/electron-product-runner.cjs`, desktop | PASS | `electron-product.log` |
| `electron tests/assets-electron.cjs`, desktop | PASS | `electron-assets.log` |
| `node tests/electron-ssh-runner.cjs`, desktop | PASS; deterministic native IPC fixture, нет remote apply | `electron-ssh.log` |
| `node tests/electron-ssh-tls-runner.cjs`, desktop | PASS exit 0; no stdout; это вызов реально существующего runner | `electron-ssh-tls.log`, `local-checks.json` |
| `node tests/media-runner.cjs`, desktop | PASS; fake devices + synthetic picker; результат runner — stdout | `electron-media.log` |
| `node tests/sfu-runner.cjs <evidence> --peers=2 --routes=direct,relay`, desktop | PASS обоих маршрутов | `sfu/2-direct.json`, `sfu/2-relay.json` |
| `node --expose-gc tests/native-lifecycle.cjs`, desktop | PASS 100 cycles | `native-lifecycle.json`, `native-lifecycle.log` |
| `node tests/stage07-media-runner.cjs <evidence>`, desktop | PASS 100 media + 100 chat cycles | `media-lifecycle/result.json` |
| `node tests/stage07-profile-runner.cjs after --evidence=<dir>`, desktop | PASS полный сценарий | `mac-after/stage07-profile-after.json` |

Единственный SKIP в Node suite — фактический запуск Desktop Entry через GIO: Linux-only проверка недоступна на macOS. Это не скрытый PASS. Целевой security набор 188/188 — подмножество/перекрытие общей проверки, его нельзя прибавлять к 330 как уникальные тесты.

`npm audit` до patch: Electron/Undici HIGH, fast-uri MODERATE. После точечных lockfile обновлений full desktop и frontend audit — 0 advisories на момент запроса. Лицензии и release/CI policy 4/4 PASS; подробности и точные источники в [SUPPLY_CHAIN_EVIDENCE.md](SUPPLY_CHAIN_EVIDENCE.md). Secret scan проверил tracked UTF-8 working tree до 5 MiB; бинарные артефакты/полная Git history не покрыты.

## Функциональные и отрицательные сценарии: фактическая глубина

| Область | Выполнено и результат | Не покрыто этим результатом |
| --- | --- | --- |
| Подключение/auth | Реальная React форма, probe HTTPS, native safeStorage, login/restart/logout, разделение credentials между серверами — PASS | Реальный пользовательский keyring каждой ОС |
| IPC/CSP/navigation | Sandbox, renderer без Node, typed bridge, foreign sender/payload, запрет window.open/navigation/direct renderer API, external URL и CSP inline — PASS | Полноценный внешний pentest |
| Realtime/resilience | WSS reconnect со свежим ticket, SSE notification refetch, server switch/old identity cleanup, offline error, synthetic suspend/resume, renderer crash/reload — PASS | Production backend restart, длительная сеть с потерями/reconnect storm |
| Личные/групповые чаты | Реальные filter/navigation, plain text и quoted replies через preload/broker/HTTPS, очистка draft, attachment by authorized ID — PASS | Нагрузка многих аккаунтов/серверных реплик |
| Папки/календарь/встречи | Folder list/detail, meeting/calendar/history rendering и range filters — PASS | Полная create/edit/delete матрица реального backend |
| Camera/mic/prejoin | Реальный Chromium enumerate/getUserMedia fake-device path, выбор sink, missing-output rejection, чужой frame/window отказ — PASS | Физические устройства/слышимый сигнал/driver unplug на Windows/Linux |
| Pion/relay | Два synthetic peers, Opus/VP8 packets/decoded frames, late join/rejoin, принудительный TURN relay и cleanup — PASS | Длительный реальный звонок, WAN, TURN outage на целевой ОС |
| Screen sharing | Picker consent/cancel/stale result и user activation/origin ограничения; synthetic own-tab getDisplayMedia cleanup — PASS | Desktop pixels, реальный portal denial, X11/Wayland/multi-monitor 100-cycle capture |
| Записи/файлы | Каталог и UUID-backed actions; auth/range playback H264/AAC, save bytes, cancel/abort, 36 s paused sink, untrusted TLS rejection, отсутствие recording disk cache — PASS | Запуск настоящей серверной записи/транскрибации |
| Tray/deep links | Настоящий macOS tray, close/show/hide, single-instance deep link, bounds/maximize/restart/quit — PASS | Windows tray, GNOME/KDE tray UX |
| Уведомления | Native context route/sound prefs; 2600/2600 synthetic notifications закрыты, очередь ограничена; OS adapters/policy — PASS | Физически слышимое уведомление / DND UI каждой ОС |
| SSH installer | План/fingerprint/consents, latest/prebuilt/source, stale/ambiguous state, certificate contract, recovery и local keyring error — PASS | Реальная повторная установка на рабочий SSH-хост не запускалась |
| Updates | Test feed disabled; подпись manifest, TLS/redirect, arch/version/rollback/hash и install IPC seam — PASS | Реальный подписанный Windows installer/update и rollback на VM |

Серверный Go код не менялся. Pion fixture с checksum-locked backend source был скомпилирован и использован; `go test ./...`, `go test -race ./...`, `go vet ./...` **не выполнялись** и не выдаются за PASS affected backend regression.

## Подтверждённые исправления и повторные проверки

- **SEC-01, Medium:** удаление профиля при locked vault больше не оставляет пригодный к восстановлению вход. Vault erase выполняется до удаления карточки; операции сериализованы. Три regression scenarios; исходно две падали, после исправления все проходят. [Подробности](DESKTOP_SECURITY_AUDIT.md).
- **Dependency hardening:** Electron 44.7.1 → 44.9.3, Undici 7.30.0 → 7.30.1 / nested 6.29.0 → 6.29.1, fast-uri 3.1.8 → 3.1.9; будущий CI Node 24.22.1. Linux display-capture exact-version gate проверен на upstream и обновлён строго для 44.9.3/152.0.7977.167; неизвестные сочетания по-прежнему отвергаются.
- **MEM-TEST-01:** opt-in SSE heartbeat только в profiler fixture устраняет измерение timeout/retry gap вместо стабильного baseline. Production retry/timeouts не ослаблены.
- **Smoke drift:** явно пройден новый welcome экран, прежние security assertions сохранены.
- **Integration/profile cleanup:** неизменные deadlines; ожидается exit перед удалением профиля, bounded kill/escalation, при отсутствии exit профиль сохраняется, а ссылка runner на child освобождается. Ошибка сигнала не снимает supervision. Первые три timeout cleanup проверки PASS, итоговые восемь проверок с реальным дочерним Node-процессом PASS (`runner-supervision-after.log`). Причина самого первого integration timeout не доказана.
- **Linux packaging:** после чистого `npm ci` отсутствовал reference runtime Electron для verifier. Добавлена явная подготовка закреплённого runtime с проверкой bundled checksums, версии и ELF architecture; verifier остаётся read-only. 33 целевые packaging проверки PASS. Native повтор учитывается в разделе Ubuntu.
- **Formatting:** четыре файла приведены к установленному Prettier без изменения поведения.

Память/RSS не оптимизировались без подтверждённой причины. Наблюдаемые ресурсы после циклов стабильны; transient native media retention и границы выводов сохранены в [memory report](DESKTOP_MEMORY_LEAK_AUDIT.md). Нет доказанного comparable performance improvement — [измерения](DESKTOP_PERFORMANCE_REPORT.md).

## Доказательства и дальнейшая приёмка

Raw logs/profiles локальны и исключены из Git. [EVIDENCE_SUMMARY.json](EVIDENCE_SUMMARY.json) связывает безопасные сводные результаты с SHA-256 evidence. Полные logs/heap доступны владельцу рабочей копии; это не подписанная независимая аттестация. Source hashes прогонов различаются из-за последующих harness/packaging исправлений; чужой build и старые packages к этим PASS не приравниваются.

Перед выпуском нужны свежие VM receipts каждой строки матрицы с точной версией ОС, native архитектурой, подписью/хешем конкретного installer, install/launch/uninstall, OS integration/media/screen checks. Для Windows — реальные Authenticode checks обоих payload и explicit update сценарии. Для Linux — отдельно DEB/RPM/AppImage, X11 и Wayland, GNOME/KDE где доступны. До этого общий статус остаётся **BLOCKED**, даже при успешной локальной регрессии.
