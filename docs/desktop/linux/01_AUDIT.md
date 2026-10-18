# MeetSpace Desktop Linux — этап 01: аудит и архитектура

Дата проверки: **18 октября 2026 года**, Europe/Moscow.

## 1. Результат и границы этапа

Linux нужно развивать **в существующем Electron + React + TypeScript проекте**.
Общий интерфейс, авторизация, REST, WebSocket/SSE, WebRTC и SSH-мастер уже
отделены от большей части системной интеграции. Отдельный Linux frontend,
копирование страниц или перенос на другой desktop framework не требуются.

**Linux Desktop пока не готов к выпуску.** Найдены конкретные задачи для
системных адаптеров, упаковки и приёмки. В ходе аудита также воспроизведена
исходная неисправность двух frontend-проверок, которые входят в Windows CI.
Она описана ниже и не скрыта общим успешным результатом Node-тестов.

На этом этапе добавлен только этот отчёт. Runtime, preload, общий frontend,
версии, lockfiles, Windows-пакеты и workflows не изменялись. Проверки создают
только игнорируемые результаты в `desktop/artifacts/linux-stage01-20261018/`
и штатный игнорируемый `desktop/dist`. Linux-пакеты не собирались, Linux GUI
и реальные Windows-клиенты в этом этапе не запускались. Переход к этапу 02
автоматически не выполняется.

## 2. Фактический checkout и версии

Аудит выполнен в `/Users/aleksandranickij/htdocs/meet_space_windows`, а не
в заново склонированном backend-репозитории из заголовка задания.

| Параметр | Проверенный результат |
| --- | --- |
| Git HEAD | `963cc020460f3177823a790eda36ea967c44ddb3` |
| Ветка | `codex/ssh-server-installer` |
| Состояние | Dirty: ранее подготовленные изменения SSH-мастера и версии сохранены |
| Версия desktop и frontend | `0.1.1-beta` |
| Fingerprint текущих входов desktop/frontend/CI | `2acaaf33c90c7edc3ad72ce068f3fe29746950e5c0c87ebe6a961501e215d583`, 355 файлов |
| Electron | `44.7.1`, закреплён в package/lock и подтверждён установленным runtime |
| Chromium внутри Electron | `152.0.7977.149` |
| Node внутри Electron | `24.21.0`; Node ABI `149` |
| Node для выполненных команд сборки/тестов | `24.19.0`; это другой runtime |
| React / TypeScript / Vite | `19.3.0` / `7.0.2` / `8.3.1` |
| electron-builder | `26.17.0` |
| Среда аудита | macOS, ARM64; запуск Linux ELF не выполнялся |

Версии получены из `desktop/package.json`, `frontend/package.json`, lockfiles
и `process.versions` фактически установленного Electron. Они согласуются с
[официальным release Electron 44.7.1](https://releases.electronjs.org/release/v44.7.1).
Требования к Node для разработки уже заданы в `engines`; изменение Electron,
React или нумерации продукта для одного аудита не требуется.

Fingerprint учитывает незакоммиченные файлы. Сам HEAD не описывает нынешний
SSH-мастер полностью. Нельзя подменять аудит текущего дерева аудитом одного
старого коммита. Исходное состояние сохранено; отчёт в `docs/` не входит в этот
fingerprint.

## 3. Реальная структура и переиспользование

```text
frontend/src/
  App.tsx, api.ts, auth.tsx, realtime.ts, personalRealtime.ts, media.ts
  components/desktop/       # подключение, SSH-мастер, native settings, picker
  platform/                # desktop/web adapter и общий IPC-контракт
desktop/src/
  main.ts, preload.ts, protocol.ts, security.ts
  broker.ts, network/, server/, session/
  media-permissions.ts, native-shell.ts, native-notifications.ts
  downloads.ts, updates*.ts, acceptance.ts, ssh/
desktop/scripts/            # общая сборка renderer + Windows package/release
desktop/tests/             # Node, Electron, HTTPS/WSS, Pion и native fixtures
.github/workflows/desktop-*.yml
```

| Область | Что уже реализовано | Решение для Linux |
| --- | --- | --- |
| React | `frontend/src/platform/index.ts:5` выбирает desktop/web; Vite имеет desktop mode | Сохранять те же страницы, маршруты, темы, состояния и дизайн |
| Main/preload | `desktop/src/main.ts:330`, `preload.ts:14`; sandbox, context isolation, фиксированный frozen bridge v5 | Переиспользовать; не открывать Node, файловую систему или произвольный shell renderer |
| IPC | `main.ts:193`, `main.ts:272` проверяют отправителя/main frame и число аргументов | Системные адаптеры остаются за теми же проверками |
| Контракты | `frontend/src/platform/desktop-contracts.d.ts`; `desktop/src/shared/contracts.ts` переэкспортирует декларации | Один источник типов для Windows и Linux |
| REST/auth | `broker.ts:75`, `broker.ts:319`, `api.ts:230`; реальные серверные запросы, refresh и cookies в main | Сохранить серверные контракты и opaque `desktop-session:` marker вместо JWT в renderer |
| WS/SSE | `broker.ts:454`, `frontend/src/platform/transport.ts:85`, `:202` | Сохранять native tickets, потоки, переподключение и очистку ресурсов |
| WebRTC | `frontend/src/media.ts:1125`, `:1662`; `getDisplayMedia`, `RTCPeerConnection`, ICE сервера | Сохранять signaling/Pion/SFU; менять только системный способ получения capture source |
| Чаты/группы/папки/записи | Общие страницы и API; native asset IDs, Save dialog, локальный защищённый media URL | Переиспользовать, проверить Linux dialogs, права, симлинки и имена файлов |
| Уведомления | `native-notifications.ts`; проверенные события broker и безопасные тексты | Сохранять правила и маршруты, проверять доставку/click через Linux desktop |
| SSH-мастер | `ssh/transport.ts`, `controller.ts`, подписанные ресурсы server-installer | Общая функция приложения; remote Ubuntu installer не является доказательством Linux Desktop |

Реальные API уже найдены в коде. Новый Linux REST backend, дублирование auth,
собственная реализация WebRTC или вымышленные endpoints не предлагаются.
REST использует Chromium `net.request`, WSS — Node `ws` с настроенным набором
CA (`network/transport.ts:141`, `broker.ts:469`). Работа обоих путей с Linux
proxy/VPN и корпоративным CA должна проверяться отдельно.

## 4. Electron, glibc и native dependencies

### 4.1 Проверка точных Linux-бинарников

Для аудита во временную папку загружены официальные архивы **той же версии
44.7.1**, проверены SHA-256 по upstream `SHASUMS256.txt` и закреплённому
`node_modules/electron/checksums.json`. Linux-бинарники не запускались.
Разобраны `.gnu.version_r` и `DT_NEEDED` всех шести ELF каждого архива.

| Архив | SHA-256 | ELF architecture | Максимальный требуемый versioned GLIBC import |
| --- | --- | --- | --- |
| `electron-v44.7.1-linux-x64.zip` | `fd4349ce666251f66acba2c88064ae6d65d5c61c0a44e68dd028d7c7f30eaa47` | `EM_X86_64`, 62 | `GLIBC_2.25` |
| `electron-v44.7.1-linux-arm64.zip` | `da048c2b8a4ece20dbb674a735af3ec61ef39922a96d18a075c3284522982fed` | `EM_AARCH64`, 183 | `GLIBC_2.25` |

Источники: [официальные release assets](https://github.com/electron/electron/releases/tag/v44.7.1),
[SHASUMS256.txt](https://github.com/electron/electron/releases/download/v44.7.1/SHASUMS256.txt).
Закреплённый [build sysroot](https://raw.githubusercontent.com/electron/electron/v44.7.1/script/sysroots.json)
для обеих архитектур — Debian Bullseye. Версия sysroot и максимальный
импортируемый GLIBC symbol — разные характеристики.

**Вывод для Ubuntu 22.04:** её glibc 2.35 выше найденного требования к versioned
импортам. По этой статической проверке препятствия нет. Это не утверждение
«Electron поддерживает любую glibc 2.25» и не результат запуска приложения.
Транзитивные библиотеки ОС, `dlopen`, sandbox, GTK, GPU, media и keyring этим
не проверены. Поддержка дистрибутива определяется также политикой
[Electron 44.7.1](https://raw.githubusercontent.com/electron/electron/v44.7.1/README.md)
и реальной приёмкой.

Локальные доказательства: `electron-linux-abi-evidence.json`,
`electron-linux-elf-x64.json`, `electron-linux-elf-arm64.json`,
`electron-v44.7.1-SHASUMS256.txt` в папке результатов этапа. Сами ZIP не добавлены
в Git, пакеты MeetSpace или ресурсы приложения.

### 4.2 Зависимости

Production dependency closure main-процесса: `ws`, `ssh2`, `asn1`, `bcrypt-pbkdf`,
`safer-buffer`, `tweetnacl`. `desktop/scripts/runtime-policy.cjs` исключает
optional `cpu-features`, `nan`, `buildcheck` и `.node` addons. Обязательный
JS/WASM fallback `ssh2/lib/protocol/crypto/poly1305.js` сохраняется.
Нужен тот же контроль при Linux-упаковке; отсутствие `.node` не означает
отсутствие native Electron или системных библиотек.

Существующая проверка извлечённого SSH runtime в `verify-artifacts.mjs:441`
использует `process.execPath`, то есть build-host Node. Она не проверяет этот
код внутри упакованного Electron с его Node/BoringSSL. Linux acceptance должен
проверять JS/WASM SSH-путь в самом native Electron-процессе.

ELF `DT_NEEDED` показывает семейства GTK3, GLib/GObject/GIO, NSS/NSPR,
ATK/AT-SPI, D-Bus, CUPS, Cairo/Pango, X11/XCB, GBM, xkbcommon, udev, ALSA,
Expat и базовые libc/libgcc. Точный dependency list DEB/RPM следует получить
из будущего пакета и проверить пакетным менеджером каждой системы; имена
пакетов и переход `t64` нельзя переносить из инструкции для одного Ubuntu
во все дистрибутивы.

Для системных интеграций нужна рабочая user D-Bus session; для сохранения
подключения и входа — доступный защищённый secret store. Без него GUI может
запуститься с заблокированным подключением. Для Wayland capture нужны
PipeWire и подходящий backend `xdg-desktop-portal`. AppImage имеет отдельные
[требования FUSE](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).
Сборка shared renderer не проверяет эти зависимости.

## 5. Обязательная Linux-матрица

Зафиксирован **Fedora Workstation 44 x64**, текущий стабильный вариант на дату
аудита по [официальной странице загрузки](https://www.fedoraproject.org/workstation/download/).
Fedora 45 beta не подменяет стабильную приёмочную систему.

| ОС | Архитектура | glibc семейство в дистрибутиве | Desktop/session для приёмки | Статус runtime |
| --- | --- | --- | --- | --- |
| Ubuntu 22.04 LTS | x64 | 2.35 | GNOME: X11 и native Wayland | NOT RUN |
| Ubuntu 24.04 LTS | x64 | 2.39 | GNOME: X11 и native Wayland | NOT RUN |
| Debian 12 | x64 | 2.36 | GNOME: X11 и native Wayland | NOT RUN |
| Debian 13 | x64 | 2.41 | GNOME: X11 и native Wayland | NOT RUN |
| Linux Mint 22 | x64 | 2.39, вывод из Ubuntu 24.04 base | Cinnamon X11; экспериментальный Wayland — отдельная проверка доступности/ограничений | NOT RUN |
| Fedora Workstation 44 | x64 | 2.43 | GNOME native Wayland; XWayland — дополнительный клиентский режим | NOT RUN |
| Ubuntu 24.04 LTS | **native ARM64** | 2.39 | GNOME native Wayland и X11, если сессия доступна в установленном образе | NOT RUN |

Источники glibc: [Ubuntu 22.04 libc6](https://packages.ubuntu.com/jammy/libc6),
[Ubuntu 24.04 release notes](https://documentation.ubuntu.com/release-notes/24.04/),
[Debian 12 libc6](https://packages.debian.org/bookworm/libc6),
[Debian 13 libc6](https://packages.debian.org/trixie/libc6),
[Mint 22 base](https://linuxmint.com/rel_wilma_whatsnew.php),
[Fedora 44 glibc](https://packages.fedoraproject.org/pkgs/glibc/glibc/fedora-44-updates.html).
Это семейства версий, а не выдуманные результаты `ldd` на ещё не проверенных VM.
При приёмке фиксируются фактические OS point release, package version, kernel,
desktop, compositor, portal/backend, PipeWire, GPU и тип сеанса.

GNOME X11 убран в Fedora начиная с 43:
[официальное изменение Fedora](https://fedoraproject.org/wiki/Changes/WaylandOnlyGNOME).
Поэтому нельзя обещать несуществующую GNOME X11 session в Fedora 44. XWayland
не считается проверкой native Wayland. Экспериментальная сессия Mint не получает
статус production support автоматически. Недоступный режим отмечается N/A
с причиной и конфигурацией, а не PASS.
Контекст экспериментального Wayland в Mint:
[официальное сообщение команды](https://blog.linuxmint.com/?p=5046).

ARM64 — отдельные сборка и запуск: проверяются `process.arch`, архитектура
host и ELF. Эмуляция x64/ARM64, контейнер на другой архитектуре или только имя
файла пакета не закрывают native ARM64 приёмку.

## 6. Найденные ограничения и риски

### L-01. Исходные frontend/Windows CI checks уже не проходят

В этом этапе воспроизведено:

- `check:desktop-foundation`: **8 PASS, 11 FAIL** из 19.
- `check:desktop-media`: **10 PASS, 1 FAIL** из 11.
- `check:desktop-assets`: **8 PASS**, ошибок нет.

Причина установлена в коде: `frontend/src/platform/desktop.ts:22` требует
`getSshInstallerState` и `sshInstaller`, но mock `bridge()` в
`frontend/scripts/check-desktop-foundation.mjs:225` и явный список методов
в `frontend/scripts/check-media-lifecycle.mjs:473` их не содержат. Проверка
останавливается с `Desktop bridge is unavailable` до целевого сценария.
Production preload содержит оба метода (`desktop/src/preload.ts:24`), поэтому
это доказанный дефект test fixtures, а не доказанное падение рабочего приложения.

Оба Windows build/candidate workflow запускают эти проверки. До начала
изменения платформ нужно обновить строгие fixtures, добавить отрицательные
случаи отсутствия каждого SSH-метода и восстановить все gates. Нельзя удалять
production validation или скрывать сбой через Proxy, возвращающий любую функцию.
На этапе 01 исправление намеренно не внесено: сохраняется наблюдаемый baseline.

### L-02. Wayland capture нельзя считать тем же picker, что Windows

`main.ts:84` запрашивает screens и windows. `media-permissions.ts:78` получает
источники для общего picker, а `:106` повторяет enumeration и требует прежний
native source ID (`:108`). Для PipeWire Electron 44.7.1 документирует один
источник, выбранный portal; при объединённом запросе он представляется window.
Повторный запрос может вызвать новый выбор или несовпадение ID — это риск,
выведенный из кода, а не наблюдавшееся Linux-падение.

Нужна отдельная Linux capture strategy: получить результат portal один раз,
сохранить его до разрешения текущего запроса и сохранить проверки owner/frame,
user gesture, cancellation и timeout. UI остаётся общим. Параметр
`useSystemPicker: true` из Electron session API относится к macOS 15+, поэтому
он не является готовым Linux-решением.
Источники: [закреплённый desktopCapturer](https://raw.githubusercontent.com/electron/electron/v44.7.1/docs/api/desktop-capturer.md),
[display media handler](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts),
[ScreenCast portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html).

Linux system audio сейчас **не поддержан**: `media-permissions.ts:73` включает
loopback только для Windows. На первом Linux этапе честно скрывать/отключать
эту возможность; не превращать микрофон в «системный звук». Проверки реальных
микрофона, камеры, смены устройства, RTP и TURN остаются отдельными.

### L-03. Keyring и локальные данные

`main.ts:474` уже отклоняет Linux `basic_text`; это правильное поведение.
Без защищённого backend broker сообщает `storageAvailable: false`, а общий
интерфейс блокирует сохранение подключения/вход. Нужно проверить unlocked,
locked и отсутствующий GNOME/libsecret/KWallet, восстановление после logout,
потерю D-Bus и restart. Нужны понятные инструкции восстановления keyring.
Не включать plaintext fallback ради зелёного CI.

Контракт `Cipher` и атомарная запись уже существуют в `session/vault.ts`;
приватные каталоги/файлы создаются с `0700/0600`. Сохранять Windows-путь
профиля и DPAPI-поведение. Разные install formats/channels должны иметь
стабильные desktop ID и userData, чтобы обновление не потеряло сессию.
Источник: [safeStorage версии 44.7.1](https://raw.githubusercontent.com/electron/electron/v44.7.1/docs/api/safe-storage.md).

### L-04. Tray, окна, автозапуск, notifications и deep links

`native-shell.ts:20` использует PNG вне Windows и обрабатывает ошибку Tray.
По умолчанию `closeToTray` выключен (`window-state.ts:8`), а при отсутствии
Tray окно завершает приложение. Это полезная общая логика. Однако наличие
объекта `Tray` не доказывает видимость индикатора в GNOME. Проверить desktop
с host-индикатором и без него; приложение не должно исчезать без способа возврата.
Wayland geometry/focus — best effort; нельзя требовать от compositor точного
восстановления глобальных координат или ослаблять Windows-тесты геометрии.
Источники: [Tray](https://www.electronjs.org/docs/latest/api/tray#platform-considerations),
[BrowserWindow 44.7.1](https://raw.githubusercontent.com/electron/electron/v44.7.1/docs/api/browser-window.md).

Автозапуск сейчас только packaged Windows (`native-shell.ts:75`); UI и ошибка
`startup_unavailable` явно называют Windows. Для Linux предлагается отдельный
opt-in XDG autostart adapter, работающий только с собственным desktop file,
без root и shell-интерполяции. Основа —
[XDG autostart](https://specifications.freedesktop.org/autostart/latest/) и
[правила Exec](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html).
До реализации capability должна возвращать unsupported и подходящий текст.

Notification API и логика безопасных событий остаются общими; нужны реальная
доставка, click, DND и возврат в нужный маршрут. Deep-link parser уже строгий
(`security.ts:91`), но Linux `.desktop`, MIME `x-scheme-handler/meetspace`,
регистрация, cold launch, second instance и результат регистрации
`main.ts:580` ещё не проверены.

### L-05. Packaging, updates и Linux security

Текущие `electron-builder.config.cjs`, `scripts/package.mjs` и
`verify-artifacts.mjs` рассчитаны на NSIS, `.exe`, PE/DLL и Windows naming.
`normalize-package.cjs` даже отклоняет symlinks с Windows-specific правилом.
Недостаточно добавить один `linux.target` в config: нужны собственные
проверки Linux layouts, разрешённых symlinks, ELF, desktop integration и прав.

Предлагаемые первичные форматы: **DEB x64/ARM64** для Debian/Ubuntu/Mint и
**RPM x64** для Fedora. AppImage — дополнительный формат после отдельной
проверки FUSE, sandbox, обновления и desktop integration. Flatpak/Snap не
считаются готовыми и не добавляются незаметно в текущий scope.

`updates.ts:87` отключает non-Windows, а `updates-policy.ts` и
`updates-signature.ts` требуют Windows feed, NSIS и Authenticode/PowerShell.
Сохранить этот путь. Начальное Linux-решение — явно описанное ручное обновление
пакета/пакетный менеджер; автоматическое обновление требует отдельного trust
и install design. Сам [Electron autoUpdater не поддерживает Linux](https://www.electronjs.org/docs/latest/api/auto-updater#platform-notices).

Сохранить sandbox, запрет renderer Node, CSP, sender/frame checks и TLS.
Не использовать `--no-sandbox`, запуск от root или глобальное ослабление
AppArmor/SELinux/user namespaces как нормальный способ установки. Sandbox
и права `chrome-sandbox` проверять для конкретного пакета и дистрибутива.
Особенно проверить ограничения user namespaces в Ubuntu 24.04:
[документация Canonical](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/).
Установленный builder уже содержит Linux AppArmor/install templates; их
наличие не заменяет проверку того, что попало в конечный пакет.

Отдельное различие: в Electron 44.7.1 runtime ASAR integrity поддержан на
macOS/Windows, не на Linux. Текущий verifier проверяет Windows PE integrity
resource. Нельзя объявить тот же уровень защиты Linux, просто включив
такой же fuse. Нужны Linux package/repository trust, контроль владения/прав,
подписи/хеши распространения и честное описание runtime границ.
Источник: [fuses закреплённой версии](https://raw.githubusercontent.com/electron/electron/v44.7.1/docs/tutorial/fuses.md).

## 7. Предлагаемая общая архитектура

Следующие имена — **планируемые интерфейсы**, а не существующие в checkout API.
Разместить main-process platform adapters в `desktop/src/platform/`, оставив
`frontend/src/platform/` общим web/desktop слоем.

| Интерфейс / ответственность | Общая часть | Windows provider | Linux provider |
| --- | --- | --- | --- |
| `HostCapabilities` | Безопасные значения для общего UI | Существующие Windows возможности | Desktop/session, capture, tray, storage/startup/update availability с причиной |
| `DisplayCaptureProvider` | Permission owner, lifecycle, cancellation | Текущий picker и loopback | X11 / PipeWire portal strategy; system audio unsupported до отдельной реализации |
| `SecureStorageProvider` | Существующий `Cipher`, vault и приватные файлы | Текущий safeStorage/DPAPI | safeStorage с отказом basic_text, статус и remediation keyring |
| `ShellIntegration` | Notices, close/quit, маршруты, bounds policy | Текущий NativeShell | Tray availability, Wayland best-effort bounds/focus, desktop notifications |
| `StartupProvider` | query/set boolean только для своего приложения | Существующий login item | Opt-in XDG autostart и стабильный executable/desktop ID |
| `ProtocolRegistration` | Общий allowlisted route parser/single instance | Существующая регистрация Windows | `.desktop`/MIME и проверенный статус регистрации |
| `UpdateProvider` | Общая модель состояния UI | Текущий подписанный NSIS updater | Сначала disabled/manual package update; отдельный будущий provider |
| Build `DesktopTarget` | os/arch/format/channel, provenance, notices | Существующие NSIS/PE gates | DEB/RPM, ELF и собственная package verification |

Выбор provider выполняется в доверенном main/build entry. Renderer не передаёт
команды, системные пути, update feed, backend secure storage или флаги sandbox.
`linux` не становится новым вариантом business frontend: `kind: desktop`
остаётся общим.

Текущий `DesktopRuntimeInfo.capabilities` содержит только serverConnection и
windowControls (`desktop-contracts.d.ts:7`); native settings имеют отдельные
boolean capability flags. Развивать этот единый контракт для нужных Linux
состояний, включая понятную причину unsupported. При обязательных изменениях
bridge-контракта обновлять его версию, preload, оба desktop targets и строгие
fixtures атомарно. На этапе 01 версия bridge остаётся 5.

## 8. План последующих этапов

1. **Восстановить baseline и выделить platform seams.** Исправить только
   устаревшие fixtures L-01, получить зелёные текущие gates; затем ввести
   providers и capabilities, сохранив поведение Windows и общий renderer.
2. **Довести запуск Linux.** UserData/keyring, общие ошибки, пути, immutable
   app resources, sandbox, lifecycle и старт из установленного desktop launcher.
   `main.ts:411` уже допускает Linux x64/ARM64; текст отказа при неподдерживаемой
   архитектуре пока называет только Windows. Исправить текст отдельно от
   сохранённого Windows support predicate.
3. **Проверить реальные серверные подключения.** Reuse auth/REST/WS/SSE,
   restart/logout/server switch, proxy/CA и отсутствие секретов в renderer.
4. **Довести media на X11/Wayland.** Сначала portal/capture прототип, затем
   camera/mic/device changes, отмены, два участника, RTP/TURN и cleanup.
5. **Довести native desktop integration.** Общие чаты/записи плюс dialogs,
   уведомления, tray/no-tray, deep links и opt-in autostart.
6. **Собрать и проверить пакеты/CI.** DEB/RPM и при необходимости AppImage;
   native ARM64, provenance, notices, права, обновление/удаление и trust policy.
7. **Выполнить полную Linux matrix и Windows regression.** Реальные desktop
   sessions, устройства/сети, утечки/нагрузка, обновления и приёмочные отчёты.

Это архитектурная последовательность, а не автоматический запуск этапов.
Их точные требования следует сверить с соответствующими будущими заданиями.

## 9. CI и критерии реальной приёмки

Существующие Windows workflows сохраняются: build на `windows-2025` x64 и
`windows-11-arm`; отдельный защищённый signed candidate и acceptance на
disposable interactive self-hosted Windows 10/11. Linux gates добавляются
рядом и не подменяют их.

Предлагается четыре уровня доказательств:

1. **PR checks:** locked dependencies, source fingerprint до/после,
   typecheck/frontend checks/Node tests на Ubuntu 22.04 x64, Ubuntu 24.04 x64
   и native `ubuntu-24.04-arm`. GitHub документирует эти
   [runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners);
   доступность для конкретного аккаунта проверяется при настройке. Не применять
   `ubuntu-latest` как фиксированную Linux-версию.
2. **Linux Electron fixtures:** отдельная D-Bus session, виртуальный display,
   управляемый keyring, sandbox без обходов. Запуск smoke, integration, headers,
   UI/product/assets, media/SFU/SSH и lifecycle. Адаптировать только
   platform-specific ожидания native-shell теста: существующий тест требует
   Tray и точных bounds, что неприменимо ко всем Wayland/GNOME окружениям.
   OpenSSL, Go/Pion fixture и FFmpeg нужны соответствующим тестам, а не
   предполагаются установленными у каждого пользователя.
3. **Package inspection:** actual archive/layout, ELF machine, loader/imports,
   dependencies, resources, подписи/хеши, desktop/MIME entries и корректные
   владельцы/права. Cross-build — результат упаковки, а не native приёмка.
4. **Trusted native desktop acceptance:** все семь строк матрицы из раздела 5,
   реальные доступные X11/Wayland sessions. PR-код не запускается на постоянных
   desktop runners; нужны изоляция, disposable user и проверка точных исходников.

Для каждой native desktop строки обязательны:

- установка, первый запуск, upgrade/reinstall и uninstall с сохранением
  пользовательских данных по принятой политике;
- auth/keyring restart/logout, server switch, отсутствие токенов/ключей в UI/log;
- launcher, deep link с cold launch и существующим процессом, single instance;
- notifications/click/DND, tray/no-tray, close/quit, Save/Open и кириллица в путях;
- реальные camera/mic, hot unplug/смена устройств, два peer с RTP, TURN relay;
- screen/window share, portal allow/deny/cancel/end, отсутствие самозапуска
  capture после resume, reconnect и очистка tracks;
- сон/пробуждение, смена сети, многократные звонки и playback, RSS/FD/process
  baseline, GPU/CPU с указанием реальных или виртуальных устройств.

Доказательство содержит ОС, arch процесса/host/ELF, session/backend, source
fingerprint и SHA-256 конкретного пакета. Xvfb, fake devices, loopback SSH,
контейнер и чтение ELF не маркируются как физическая/интерактивная приёмка.

## 10. Выполненные проверки и Windows regression

| Проверка этого этапа | Результат | Практическая граница |
| --- | --- | --- |
| Чтение текущего main/preload/renderer/API/media/package/CI | Выполнено | Source audit dirty checkout |
| `npm --prefix desktop test` | **153/153 PASS** | Node-тесты на macOS ARM64, включая build:main; не Windows/Linux runtime |
| `npm --prefix frontend run typecheck` | PASS | TypeScript; не запуск GUI |
| `check:desktop-foundation` | **8 PASS / 11 FAIL** | Исходный stale fixture, L-01 |
| `check:desktop-media` | **10 PASS / 1 FAIL** | Та же неполная bridge fixture в suspend-тесте |
| `check:desktop-assets` | **8/8 PASS** | Модель native asset операций |
| Linux Electron 44.7.1 ZIP x64/ARM64 | SHA-256 и ELF imports проверены | Статический upstream runtime, MeetSpace не упаковывался |
| Текущие Windows 0.1.1-beta manifests/installers | SHA-256, размеры и source fingerprint совпадают | Ранее собранные пакеты, `windowsRuntimeTested: false` |
| Linux install/uninstall/GUI/X11/Wayland/media | **NOT RUN** | Ни одна строка Linux matrix не получила PASS |
| Windows 10 22H2 x64 / Windows 11 x64 / Windows 11 native ARM64 | **NOT RUN в этапе 01** | Реальная Windows regression не заявляется |

Существующие Windows manifests не являются устаревшими только потому, что
checkout dirty: они совпадают с текущим fingerprint. Старые stage06/07
материалы относятся к другим baseline. Исторический UTM-отчёт с ARM64 OS,
AMD64 process и неинтерактивным SYSTEM/session 0 не заменяет native interactive
Windows 11 ARM64 приёмку.

Функция Windows support остаётся в `security.ts:153`: Windows 10 build 19045
x64 и Windows 11 build 22000+ x64/ARM64. При будущих изменениях сохранить
соответствующие tests, Windows Authenticode/feed, NSIS naming, профиль/сессии,
loopback audio, picker, geometry и трёхцелевой release gate.

Логи и проверенные ELF JSON находятся в
`desktop/artifacts/linux-stage01-20261018/`. До следующего этапа требуется
принять этот audit/plan и восстановить исходные failing fixtures. Linux
поддержка и новые версии пакетов на этапе 01 не объявлены готовыми.
