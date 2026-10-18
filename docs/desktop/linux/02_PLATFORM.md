# Этап 02 — общий Electron/React-каркас для Linux

Дата проверки: 18 октября 2026 года. Версия продукта: **0.1.1-beta**.
Этап реализован в существующем Desktop-проекте, без отдельного Linux frontend.
Установочные пакеты и выпуск Linux не входят в этот этап.

## Объём и исходное состояние

Задание: `CODEX_LINUX_02_PLATFORM.md` из предоставленного набора.
Перед изменениями выполнен [аудит этапа 01](01_AUDIT.md), прочитан текущий
checkout и согласована последовательность: системные адаптеры, защищённый
контракт, общий интерфейс, восстановление fixtures, запуск и проверка границ.
Существующие изменения мастера установки сервера по SSH сохранены.

Основа: Electron **44.7.1**, Chromium **152.0.7977.149**, embedded Node
**24.21.0**, ABI **149**. Инструменты сборки: Node **24.19.0**.
Одна точка входа `desktop/src/entry.ts`, общий `desktop/src/main.ts`,
один preload, один React renderer из `frontend`.
Поддерживаемые архитектуры каркаса — x64 и ARM64; реальная совместимость
конкретных ОС подтверждается отдельно от компиляции и упаковки.

Проверяемый checkout: `963cc020460f3177823a790eda36ea967c44ddb3`, dirty.
Fingerprint 365 файлов точных исходных байтов после изменений этапа:
`1460283cd9f157586446fb4135707fb4535e38b5dddcb2cc9abfbc6c1c42aefa`.
`source-inputs.json` включает пофайловые хеши; чужие изменения checkout
не исключались из идентичности сборки. Это локальная работа, commit/push
и публикация не выполнялись.

## Реализованные изменения

### Системный адаптер

`desktop/src/platform/host-platform.ts` отделяет политику ОС от Electron UI:

- ограниченные значения платформы и архитектуры;
- Linux-сессия X11/Wayland/unknown и нормализованное desktop environment;
- доступность автозапуска, абсолютного размещения окна и системного звука;
- консервативная политика трея и фиксированные сообщения об ограничениях.

Значения окружения не передаются renderer как произвольные строки.
Windows сохраняет автозапуск только в установленном приложении, точную
геометрию окна и поддержку системного звука. Linux на этом этапе сообщает
отсутствие автозапуска и системного звука; их реализация не подменяется
успешными заглушками.

### Окно и завершение приложения

`NativeShell` получает адаптер из main. В Linux создание объекта Electron
`Tray` не считается доказательством видимого значка: `trayAvailable:false`,
включение `closeToTray` отклоняется, команда скрытия недоступна, обычное
закрытие завершает приложение через существующую последовательность cleanup.
Сохранённая ранее настройка скрытия не оставляет невидимый процесс.

В Wayland и неизвестной Linux-сессии восстанавливается размер окна без
принудительных координат. При изменении монитора приложение ограничивает
размер; размещение и максимизированное окно остаются под управлением
композитора. X11 сохраняет восстановление координат. Существующее поведение
Windows/macOS выделено отдельными проверками и сохранено.

### Защищённое хранилище

`desktop/src/platform/credential-store.ts` использует настоящий Electron
`safeStorage` и общий session vault. Windows продолжает использовать DPAPI,
macOS — Keychain. Linux допускает известные защищённые backend:
`gnome_libsecret`, `kwallet`, `kwallet5`, `kwallet6`.

`basic_text`, неизвестный backend и недоступный keyring дают отказ. Проверка
выполняется перед каждой операцией шифрования/расшифрования; plaintext
fallback отсутствует. Ошибки не раскрывают исходные исключения или секреты.
Незащищённые настройки окна и профилей остаются отдельными от cookie vault.

Общий экран выбора сервера получает состояние хранилища из main и объясняет
необходимость разблокировать GNOME Keyring/KWallet. Пароли и сессионные
cookies не передаются в runtime metadata.

### Preload, IPC и общий интерфейс

Канонический контракт — `frontend/src/platform/desktop-contracts.d.ts`,
используемый обеими частями приложения. Версия bridge повышена до **6**:
существующий `getRuntimeInfo()` возвращает ограниченный объект `host`
(сессия, статус хранилища, доступные возможности). Frontend проверяет его
форму и допустимые сочетания. Произвольных новых IPC-операций не добавлено.

Все привилегированные действия остаются в main. Проверяются главное окно,
главный frame, число и форма аргументов. Renderer не получает Node,
filesystem, shell, произвольный сетевой клиент или общий `invoke`.
Сохраняются `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`,
`webSecurity:true`, запрет webview/чужой навигации и строгая CSP. Dev-режим
использует фиксированный loopback URL и nonce; production — локальный
`app://meetspace`.

Сохранение файлов использует существующий системный диалог с владельцем —
главным окном. Renderer задаёт серверный идентификатор ресурса; локальный
путь выбирается системным диалогом. Внешние HTTPS-ссылки проверяются по
выбранному серверу перед передачей ОС. URL с чужим origin, credentials,
`file:`, `javascript:` и `data:` отклоняются.

Тексты настроек автозапуска, хранилища и обновлений адаптированы в том же
React UI. Linux-обновления остаются отключены. Windows updater, Authenticode,
feed trust и release gates не изменены.

### Обычная точка входа приложения

Проверка `electron .` после доверенных integration fixtures выявила реальную
ошибку запуска: Electron 44 динамически импортирует CommonJS package main,
при этом `require.main` остаётся модулем Electron. Старый guard
`require.main === module` не вызывал `startApp`: процесс работал, но окон
и renderer не было. Диагностика показала `app.isReady() === true`, загруженный
`dist/main.js` и пустой `BrowserWindow.getAllWindows()` спустя пять секунд.
Импортирующие `startApp` fixtures обходили эту ошибку; их успешное прохождение
не считалось доказательством обычного запуска.

Добавлен `src/entry.ts`, который без неоднозначного guard вызывает общий
`startApp()` с прежней безопасной обработкой ошибок. `main.ts` сохраняет
пассивные экспорты для fixtures. `package.json` указывает на `dist/entry.js`,
проверка установщика требует оба скомпилированных файла и правильную metadata.
Builder уже включает `dist/**/*.js`; dev/start используют каталог package.
Проверки IPC, CSP, sandbox, серверов и Windows OS guard не ослаблялись.
Три bootstrap unit tests проверяют несовпадающий `require.main`, однократный
запуск с production defaults, безопасную ошибку и согласованность package.
Нативные проверки обычного запуска выполняются отдельно от unit tests.

Второй дефект обнаружен уже после исправления package entry: в настоящем
Wayland `dom-ready` и `did-finish-load` проходили за 670 мс, но
`ready-to-show` не появлялся и спустя 10 секунд. Окно оставалось скрытым
при полностью загруженном локальном React UI. Только для Wayland после
успешной загрузки доверенного документа вызывается первоначальный показ;
ожидание первого кадра снимается. Обработчик проверяет запрошенный
`show`, текущее живое окно/webContents и отсутствие завершения приложения.
Windows/macOS/X11 сохраняют показ по `ready-to-show`.
Wayland smoke больше не вызывает `window.show()` вручную: он требует,
чтобы производственная функция уже показала окно.


### Тесты и запуск

- Восстановлены явные frontend bridge fixtures, включая ранее пропущенные
  методы SSH. Отсутствующий метод или некорректный runtime теперь проверяется
  как отказ, без разрешающего Proxy.
- Добавлены 13 Node-тестов системной политики, хранилища и окна, включая
  отдельную ветку Windows.
- Добавлен `test:platform`: настоящий main/preload, CSP, чужое окно,
  состояние хранилища, файлы и разрешённые внешние ссылки.
- Существующая native-shell проверка получила отдельную Linux-ветку:
  отсутствие скрытия, обычное закрытие/cleanup, single instance/deep link,
  настройки и размер после перезапуска. Строгие Windows/macOS ожидания
  сохранены; максимизация без реального window manager не выдаётся за PASS.
- Команды запуска и требования keyring описаны в `desktop/README.md`.
  Для ARM64 устанавливаются ARM64 Node/Electron и зависимости; x64
  `node_modules` не переносятся между архитектурами.

В full-system x64 VM обнаружены две гонки старого smoke fixture: ожидание
смены темы ровно 200 мс и dev reload/deep link ровно 300 мс. Диагностика
показала правильный `matchMedia` и обновление React dataset примерно через
1,5 с под TCG; маршрут после dev reload обновился через 1,16 с. Тест теперь
ждёт конкретное ожидаемое значение до 15 секунд и сохраняет исходные
проверки. Исходные FAIL и диагностические замеры сохранены;
production-код темы и маршрутизации не менялся.

## Доказательства и границы тестов

Логи, JSON и source manifest находятся в ignored каталоге
`desktop/artifacts/linux-stage02-20261018/`. Тесты используют временные
профили и локальные HTTPS fixtures; рабочие аккаунты и серверы не участвуют.
В `test:platform` только системный Save dialog и запуск внешнего браузера
заменены в доверенной тестовой точке входа. Проверяются фактические байты
файла и настоящий encrypted vault; визуальная работа диалога этим не доказана.

| Проверка | Результат | Граница доказательства |
| --- | --- | --- |
| Desktop TypeScript и production build | PASS | macOS ARM64, общий main/renderer |
| Desktop Node tests | **169/169 PASS** | Финальный fingerprint; 13 platform tests и 3 bootstrap tests; не Windows runtime |
| Frontend `check` | PASS | Форматирование, TypeScript, web build |
| Frontend foundation/media/assets | **23/23 + 11/11 + 9/9 PASS** | Детерминированные frontend fixtures |
| Production smoke на macOS ARM64 | PASS | Реальные Electron/CSP/IPC, темы, масштаб, reload/deep link |
| Session integration на macOS ARM64 | PASS, первый запуск и restart | Настоящий Keychain, native HTTPS/WSS/SSE, изоляция серверов, logout |
| Platform integration на macOS ARM64 | PASS | Настоящие main/preload/Keychain, отмена и сохранение 262 144 байт |
| Native window на macOS ARM64 | PASS, первый запуск и restart | Настоящий tray, close-to-tray, single instance, cleanup, bounds/maximize |
| Обычный package entry на macOS ARM64 | PASS | Финальный `1460283c…`, `electron .`, видимое окно, v6/Node isolation/CSP, graceful exit 0 |
| Host dev smoke | Guarded refusal | Порт 5173 занят существующим Docker workload; чужой сервер не используется |
| `git diff --check` | PASS | Исходники текущего checkout |

| Linux-проверка | Результат | Среда |
| --- | --- | --- |
| Source build x64 | PASS | Ubuntu 22.04 amd64 container через Rosetta; только сборка |
| Source build ARM64 | PASS | Ubuntu 22.04 ARM64 container; ARM64 зависимости |
| Platform integration x64 | PASS | Ubuntu 22.04, full-system QEMU TCG, kernel 5.15.0-1109-kvm, glibc 2.35, Xvfb, D-Bus, GNOME libsecret |
| Production shared-renderer smoke x64 | PASS | Та же полноценная гостевая ОС и x86-64 ELF; проверка UI без физического GPU |
| Development shared-renderer smoke x64 | PASS | Собственный Vite на loopback в гостевой ОС, nonce, настоящий Electron, reload/deep link |
| Native window x64, первый запуск и restart | PASS | X11/Xvfb: close/quit/cleanup, single instance, deep link, bounds и настройки; compositor maximize NOT TESTED |
| Linux sandbox x64 | PASS | Независимый syscall probe и реальные `/proc` renderer/browser в full-system VM |
| Linux sandbox ARM64 | PASS | Ubuntu 22.04 container / LinuxKit ARM64, Xvfb; не Ubuntu 24.04 Desktop |
| Native ARM64 production smoke | PASS | Ubuntu 24.04.5 UTM, настоящий GNOME Wayland, финальный `1460283c…`; окно показано производственной функцией |
| Native ARM64 platform/keyring/sandbox | PASS | Snapshot `82483a66…` до bootstrap-исправлений; настоящая Wayland-сессия, защищённый IPC и 262 144 байт |
| Native ARM64 системный Save dialog | PASS, показ и отмена | Отдельный trusted entry до bootstrap-исправлений; настоящий GNOME dialog без подмены, отмена через UI |
| Обычный production entry x64 | PASS | Финальный `1460283c…`, full-system QEMU; видимое окно `app://meetspace/` за 6,242 с |
| Обычный dev entry x64 | PASS | Финальный `1460283c…`, реальный `scripts/dev.mjs` без `--smoke`; видимое окно loopback за 10,129 с |
| Wayland `show:false` | PASS | Финальный `1460283c…`, отдельный профиль; загруженный документ остаётся скрытым, событий show нет |
| Обычный production entry ARM64 | PASS | Финальный `1460283c…`, чистый `electron .`; реальное окно лично проверено в UTM через CUA |

UTM Ubuntu 24.04 ARM64 проверяется отдельно в настоящей графической сессии;
результаты описаны ниже.

Полный x64-прогон описан в `runtime/runtime-summary.json`: все четыре
канонических suite завершились с кодом 0 на fingerprint
`82483a66ec3e758343ce2d6d443bdb1e1a647083f5fc53c4761f5f536f856352`.
Следующий snapshot
`0ec3e5b64ed99073b6f1ccfb7c1312fc8d27654132395190642f8f631448dd49`
отличался от него только `desktop/tests/electron-smoke.cjs`: добавлено
отображение окна в Wayland fixture; production-файлы тогда совпадали.
Финальный `1460283c…` дополнительно исправляет package entry, начальный
показ Wayland-окна и добавляет bootstrap tests. Прежний полный x64 suite
не выдаётся за прогон финального snapshot. Обычный запуск дополнительно
проверен после исправления. Среда —
QEMU 9.1.1 TCG, 4 vCPU, 4 ГиБ, Xvfb 1440×900 с Openbox и software graphics,
отдельная D-Bus session для каждого теста, обычный пользователь UID 1000.
Это полноценное x86_64-ядро, но эмуляция CPU, а не нативная x64 машина.
Временная VM корректно выключена, собственные тестовые контейнеры остановлены;
исходные Docker workloads сохранены.

После исправлений на финальном `1460283c…` отдельно прошли обычные
production и dev запуски x64 без `--smoke`: наблюдатель не импортировал
`startApp` и не показывал окно. Electron сам загрузил package entry,
приложение создало видимый UI с ожидаемым URL и bridge. В обоих renderer
подтверждены отсутствие Node, sandbox/contextIsolation, `NoNewPrivs:1`,
`Seccomp:2` с собственным фильтром и GNOME libsecret. Эти проверки дополняют
прежние канонические suite, а не заменяют их хеши. На macOS обычный entry
также прошёл на финальном snapshot с временным user-data-dir, штатным login
Keychain и graceful exit 0.

Для Linux-прогонов использован проверенный официальный Electron runtime с
системным `chrome-sandbox`, владельцем `root:root` и mode `4755`; ARM64 runtime
в UTM размещён в `/opt/electron`. Node/npm-зависимости установлены для
соответствующей архитектуры. Это явная подготовка тестовой среды:
`npm ci` сам по себе не наделяет распакованный файл владельцем root.
На машине разработчика администратор должен подготовить доверенный runtime
и работающую sandbox policy. Автоматического повышения привилегий или
изменения защиты из main/dev launcher не добавлено. Интеграция sandbox
в устанавливаемые DEB/RPM/AppImage остаётся задачей упаковки.

Снимки Xvfb — диагностические автоматические захваты. При software rendering
capture может отставать от уже проверенного DOM theme state на один кадр;
визуальная приёмка системной темы по ним не заявляется. В снимке обычного
x64 entry также сохранился начальный loading frame при уже успешно
проверенном onboarding DOM; он не выдаётся за визуальную приёмку.
Положительное визуальное доказательство обычного запуска — CUA-снимок
настоящего ARM64 GNOME desktop в UTM.

### Почему Rosetta не является проверкой системной песочницы

В Docker x64 на этом Mac используется Rosetta. Electron может сообщать
`sandbox:true` и скрывать Node, но независимый x64-вызов установки seccomp
возвращает `EINVAL (22)`. В renderer остаётся только внешний фильтр
контейнера. Такой запуск не доказывает Chromium kernel sandbox.

Для независимой проверки подготовлена временная full-system QEMU x64 VM с
Ubuntu 22.04 и настоящим гостевым x86_64-ядром. В ней тот же проверочный
бинарник устанавливает фильтр и получает ожидаемый `EPERM` на запрещённый
syscall. Настоящий Electron renderer имеет `NoNewPrivs:1`, `Seccomp:2`,
собственный фильтр и отдельные user/PID/network namespaces; browser остаётся
без seccomp. GNOME libsecret выполняет реальный encrypt/decrypt roundtrip.
Флаги отключения sandbox и ослабления гостевой системной политики не применялись.

Ubuntu 24.04 дополнительно ограничивает user namespaces через AppArmor.
При разработке и упаковке следует проверять реальную работу sandbox для
конкретного пути приложения и его системной интеграции. Глобальное
отключение этой защиты не является решением MeetSpace. Основание:
[официальные release notes Ubuntu 24.04](https://documentation.ubuntu.com/release-notes/24.04/#unprivileged-user-namespace-restrictions).

Отдельно подтверждён Chromium seccomp в ARM64-контейнере: у renderer два
фильтра против одного внешнего фильтра browser. Это Ubuntu 22.04 userspace
на LinuxKit ARM64, Xvfb и тестовый keyring; это не нативная приёмка Ubuntu
24.04 Desktop ARM64. Для тестового контейнера использован отдельный профиль
на основе Docker default с разрешением `clone`/`unshare`/`setns`, необходимым
для создания Chromium namespaces. Внешний seccomp сохранён; дополнительные
capabilities, privileged mode, изменение Docker daemon или host sysctl не
применялись. Это специальная fixture-среда, а не утверждение о запуске в
контейнере с неизменённым профилем Docker по умолчанию.

## Установка Ubuntu в UTM по дополнительному запросу

Создана отдельная VM **MeetSpace Ubuntu 24.04 ARM64**,
UUID `9A808836-3350-4AED-B499-89D451F7B541`, UTM **4.7.5**:
4 vCPU, 8 ГиБ RAM, диск 64 ГиБ. Ubuntu **24.04.5 LTS**, kernel
**6.8.0-147-generic**, `aarch64`, CPU vendor Apple; аппаратная виртуализация
ARM64. Это не x64-трансляция и не физическая машина. Установлены GNOME/GDM,
GNOME Keyring, терминал, SPICE agent, QEMU guest agent и NetworkManager.

Официальный Canonical cloud image проверен по SHA-256:
`50e24e1fb79e89116e939d90aa7738f7af48c442fa1bc2510131e0b39c50348e`.
Отчёт образа, исходный самостоятельный qcow2, seed и сведения о доступе
находятся вне репозитория в
`/Users/aleksandranickij/Virtual Machines/MeetSpace Ubuntu24.04/`.
Фактическая VM хранится в штатной библиотеке UTM.

Пользователь — `meetspace`, обычный парольный вход, автологин выключен.
Сгенерированный пароль сохранён только в локальном `private/credentials.json`
с правами 600; в исходниках/отчётах его нет. SSH использует отдельный ключ и
проверенный host key. Постоянный адрес доступа с Mac — loopback
`127.0.0.1:2224`; внешнего слушающего SSH-порта нет. Общие папки и clipboard
sharing отключены. Существующая Windows VM сохранена и не запускалась.

При установке устранены две реальные проблемы среды:

1. Shared vmnet NAT не давал гостю доступа к Ubuntu repositories, хотя
   прямой запрос с Mac работал. Только новая VM переведена в Emulated VLAN
   NAT; прямой HTTPS гостя заработал без временного proxy или туннеля.
2. Минимальная установка GNOME создала глобальный Netplan renderer
   NetworkManager, но опция `--no-install-recommends` оставила сам менеджер
   неустановленным. После reboot интерфейс оставался DOWN, networkd не имел
   сгенерированной конфигурации, wait-online ждал 120 секунд. Установлены
   стандартные NetworkManager/GUI-компоненты, проверены DHCP/default route
   и HTTPS, затем отключены неиспользуемый networkd и его wait-online.
   Прежняя задержка не была подтверждённым kernel hang.

Графический вход проверен: открыт рабочий стол Ubuntu, снимок —
`utm/ubuntu24-arm64-desktop.png`. CUA неустойчиво передавал короткие события
клавиатуры; существующий пароль успешно введён физическими клавишами с
удержанием 160 мс, Return — 200 мс. Пароль для обхода проблемы не менялся.

В этой пользовательской сессии подтверждён **настоящий Wayland**:
Electron использует `--ozone-platform=wayland`. Проверены sandbox,
contextIsolation, отсутствие Node в renderer, `NoNewPrivs:1`,
`Seccomp:2` с собственным фильтром renderer против отсутствия фильтра
browser, реальный GNOME libsecret encrypt/decrypt. AppArmor
`apparmor_restrict_unprivileged_userns=1` сохранён. Чтение namespace symlink
renderer обычным пользователем получает EACCES под SUID sandbox; это
ограничение сбора доказательств отмечено, а не заменено вымышленным выводом.

Канонический production smoke после адаптации Wayland fixture прошёл на
snapshot `0ec3e5b…` до исправления package entry; 363 файла перепроверены
в госте без несовпадений.
Platform harness также прошёл, включая запись 262 144 байт, отмену,
проверку encrypted vault и границы IPC. Доказательства находятся в
`runtime/utm-arm64/`; контрольная перезагрузка после исправления сети
также прошла. За 23,71 секунды автоматически появились SSH, GDM, QEMU guest
agent и подключение NetworkManager; boot ID изменился. Подтверждены DHCP
`10.0.2.15/24`, default route `10.0.2.2` и прямой HTTPS 200 без proxy.
Повторный графический вход открыл GNOME desktop с прежними credentials.
`systemctl --failed`, `dpkg --audit` — пустые, `apt-get check` — exit 0,
cloud-init — done без errors/recoverable errors. VM оставлена запущенной.
После повторного входа реальный GNOME libsecret расшифровал сохранённый
до reboot зашифрованный checkpoint в пределах двухсекундной проверки;
значение не выводилось в лог.

Настоящий GNOME Save dialog также проверен отдельно: показан над окном
MeetSpace, имя `MeetSpace-проверка.mp4`, затем отменён через UI; результат
`canceled:true`, файл не создан. Снимок — `utm/native-save-dialog.png`.
Этот доверенный временный entry использует реальный `dialog.showSaveDialog`
без подмены; полномочия renderer и фактическая запись байтов проверены
отдельным platform harness.

Первый Wayland production smoke обнаружил ограничение скрытого тестового
окна: без отображения compositor surface не доставлял смену native theme,
хотя документ сообщал `visibilityState:visible`. Отображение и фокус окна
дали правильные nativeDark/matchMedia/DOM/CSS значения за 284 мс (dark)
и 257 мс (light), и весь диагностический smoke прошёл. Канонический fixture
теперь отображает окно только в Linux Wayland; проверки темы не пропущены,
На тот момент production-код и Mac/Windows ветки не менялись, исходный
FAIL сохранён. Последующая проверка обычного запуска выявила описанный
выше дефект первого показа; финальный smoke больше не показывает окно
вручную и прошёл с требованием `isVisible() === true`. Отдельный
`show:false` entry с временным профилем подтвердил загруженный локальный
документ, отсутствие show events и скрытое окно спустя 1,2 секунды.

После финального исправления **обычный** `/opt/electron/electron .` в UTM
запущен без observer, fixture, dev environment и тестового CA, с обычным
профилем пользователя. Реальный экран «Подключиться к серверу» с логотипом,
адресом сервера и кнопками лично проверен через CUA. Снимок —
`utm/meetspace-ubuntu24-arm64-normal-launch.png`. Нормальный renderer
использует kernel sandbox; VM и приложение оставлены запущенными.
Idle screen lock Ubuntu оставлен штатным, повторное разблокирование
выполнено прежними credentials.

## Матрица и Windows regression

Полная обязательная матрица сохраняется из этапа 01:

| Целевая ОС | Статус полной desktop-приёмки этапа 02 |
| --- | --- |
| Ubuntu 24.04 LTS x64 | NOT RUN |
| Ubuntu 22.04 LTS x64 | Full-system x64 VM: отдельные автоматические проверки; не полная desktop-приёмка |
| Debian 12 x64 | NOT RUN |
| Debian 13 x64 | NOT RUN |
| Linux Mint 22 x64 | NOT RUN |
| Fedora Workstation 44 x64 | NOT RUN |
| Ubuntu 24.04 LTS ARM64 | Native ARM64 UTM, GNOME/Wayland: установленная ОС, графический вход, kernel sandbox/keyring PASS; не полная приёмка выпуска |

Остальные сочетания дистрибутивов и X11/Wayland, подтверждение реального Save
с выбором пути (отмена проверена), запуск браузера, KWallet, заблокированный
keyring после sleep, несколько мониторов, физический GPU и устройства
требуют дальнейшей проверки. GNOME Wayland в UTM проверен отдельно от
unit-тестов политики; compositor maximize и смена мониторов не проверены.
Автозапуск, tray integration, порталы захвата, media,
пакеты и update policy Linux остаются работой соответствующих этапов.

Для Windows сохранены guard Windows 10 22H2 x64 и Windows 11 x64/ARM64,
проверки DPAPI, геометрии, трея и login registration. Source tests проходят;
macOS runtime regressions перечислены выше. **Реальные Windows 10 x64,
Windows 11 x64 и native Windows 11 ARM64 в этапе 02 не запускались.**
Старые Windows test installers относятся к предыдущему fingerprint и не
считаются runtime-проверкой текущего кода. Новые установщики в этапе 02
не собирались, не публиковались и подпись не объявляется готовой.

## Статус этапа

Системные адаптеры и каркас реализованы в общем проекте. Проверены dev/prod
Linux x64 в полной гостевой ОС и production Linux ARM64 в настоящем
GNOME Wayland с аппаратной виртуализацией ARM64.
Полная поддержка матрицы и готовность Linux-выпуска не заявляются.
Автоматического перехода к следующему этапу нет.
