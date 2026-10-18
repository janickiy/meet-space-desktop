# Этап 05 — трей, уведомления, автозапуск и системная интеграция

Дата: 18 октября 2026. Версия продукта: 0.1.1-beta.

Статус: реализация выполнена в общем проекте; приёмка частичная.
Проверки доступных Ubuntu ARM64 и Windows 11 ARM64 в UTM выполнены;
непроверенные системы, package formats и login перечислены ниже.

## Аудит и план до кода

Работа продолжается в общем Electron/React/TypeScript проекте Windows/Linux.
Исходный checkout dirty, HEAD `963cc020460f3177823a790eda36ea967c44ddb3`;
предыдущие изменения сохраняются. Baseline этапа 04: 374 файла,
`329bcddf336481665c4ee9628bf0c2d85626f7d1a46c02e5a9b077459829ceab`.
Вложенный документ использован как требования этапа; самостоятельный
Linux frontend не создаётся.

Фактическая структура: `desktop/src/native-shell.ts` управляет Tray,
окном и локальными настройками; `native-notifications.ts` получает безопасные
события существующего broker; `main.ts` обслуживает typed IPC, single-instance,
deep links, внешние ссылки и Save As; `downloads.ts` сохраняет assets через
проверенные ID. React настройки общие: `DesktopNativeSettings.tsx`.

На старте Linux tray намеренно считался unverified, даже при успешном
конструкторе Tray. Close завершал приложение. Linux startup был недоступен,
а Windows использовал Electron login item API. Общая UI-подсказка при этом
обещала продолжение звонка даже без доступного трея и получала настройки
только один раз. Некоторые `_blank` ссылки блокировались без обратной связи.
URI parser, single-instance lock и защищённые native downloads уже были.
Builder конфигурация пока Windows-only: установка deb/rpm/AppImage не
предполагалась существующей.

План, выданный перед кодом: подтвердить собственную SNI регистрацию и host,
обеспечить recovery при потере трея; добавить opt-in XDG startup adapter
с постоянным executable и собственным файлом; актуализировать общий UI;
проверить существующие notification/link/download/quit пути в настоящей
Linux сессии. Оформить GNOME/KDE, package formats и Windows regression
отдельно, без выдачи сборки или mock-теста за OS приёмку.

## Источники API

- [Electron Tray, Linux platform considerations](https://www.electronjs.org/docs/latest/api/tray#platform-considerations)
- [StatusNotifierWatcher interface KDE](https://github.com/KDE/kstatusnotifieritem/blob/master/src/org.kde.StatusNotifierWatcher.xml)
- [XDG Autostart](https://specifications.freedesktop.org/autostart/latest/)
- [Desktop Entry Exec quoting](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html)
- [AppImage runtime environment](https://docs.appimage.org/packaging-guide/environment-variables.html)
- [Electron Linux external opener, pinned source](https://github.com/electron/electron/blob/v44.7.1/shell/common/platform_util_linux.cc)

## Изменения

### Трей и поведение окна

`platform/status-notifier.ts` читает session D-Bus через фиксированный
`/usr/bin/busctl`, без shell и npm/native D-Bus зависимости. Проверяются
StatusNotifierHost и зарегистрированный item, которому D-Bus приписывает
PID текущего main process. Один watcher или чужой значок недостаточны.
В KDE дополнительно нужен живой owner отдельного host bus name:
у KDE 5.27 свойство IsStatusNotifierHostRegistered всегда true, даже после
ухода plasmashell. GNOME AppIndicator 58 реализует host внутри Shell;
проверяется совпадение уникального owner watcher и org.gnome.Shell.
Owner host и watcher повторно проверяются в конце snapshot.
Объём/время ответа ограничены; несовместимый busctl, отсутствующая шина,
ошибка/неоднозначный ответ дают недоступность. Смена owner watcher во время
чтения отклоняет смешанный snapshot.

Проверка периодическая, с отменой при dispose. Только подтверждённый host
позволяет явное close-to-tray. При потере регистрации скрытое самим
приложением окно возвращается; обычное закрытие затем завершает приложение.
Сворачивание в taskbar остаётся обычным minimize. Меню содержит Open,
Hide и Quit; приложение повторно применяет Tray context menu после изменений.
Wayland focus остаётся запросом композитору, а не гарантией global focus.
Регистрация SNI доказывает протокол, а видимость значка проверяется отдельно.
GtkStatusIcon/XEmbed fallback не включает скрытие автоматически.

### XDG автозапуск

`platform/autostart.ts` включается существующим boolean IPC только по
действию пользователя. Конструктор и status не создают файлов. Dev-запуск
через Electron не регистрируется. Для установленного executable проверяются
постоянный путь, владельцы/разрешения и доступность запуска. AppImage требует
согласованных APPIMAGE/APPDIR/current executable; регистрируется исходный
образ. Временный mount executable и ephemeral targets отвергаются.

Единственный управляемый файл:
`$XDG_CONFIG_HOME/autostart/com.janickiy.meetspace.desktop[.test].desktop`,
по умолчанию `~/.config/autostart/`. Относительный XDG_CONFIG_HOME игнорируется
по спецификации. Строка Exec содержит один экранированный абсолютный путь,
без shell, аргументов, URL и произвольных field codes.
Путь с буквальным `%` отвергается: проверка в GLib/GIO 2.80 показала,
что loader ищет executable до раскрытия spec-correct `%%`. Это фиксирует
недоступность автозапуска, а не сохраняет заведомо неработающую запись.
Пробелы, кавычки, `$`, обратная кавычка, backslash и кириллица проверены
настоящим GIO запуском с нулём добавленных аргументов.
Файл имеет собственный marker и строгую грамматику. Чужие записи,
symlink/hardlink и небезопасные родительские каталоги дают отказ.
Linux операции закрепляют каталоги через fd; обновляется проверенный inode,
а не чужой replacement. Disable сохраняет собственную запись с Hidden=true,
чтобы не открыть system-wide fallback с тем же desktop ID.

Status сообщает о собственной конфигурации, а не гарантирует вход при
следующем login: рабочий стол может иметь отдельную startup policy.
При смене/перемещении portable executable требуется явное повторное включение.
Реальные package manager форматы не выводятся из имени каталога.

### Уведомления, ссылки, загрузки и общий UI

Существующий NativeNotifications сохраняет account/profile generation,
fixed generic bodies без текста сообщений, suppress открытого чата,
ограничения количества/возраста, silent setting и безопасный route при click.
Системный DND и разрешение управляются рабочим столом. Linux использует
настоящий Electron Notification, без собственной имитации уведомлений.

Deep links сохраняют строгие invitation/join routes без адреса сервера,
команд и токенов. Второй процесс передаёт ссылку первому экземпляру.
Linux запуск больше не вызывает setAsDefaultProtocolClient и не меняет
пользовательские MIME defaults: desktop entry и `%u` относятся к пакету.
Windows/macOS регистрация сохраняется.

ExternalLink в общих компонентах принимает доверенное действие пользователя,
вызывает existing main bridge и показывает фиксированную ошибку. Web href
сохраняется. Разрешены HTTPS выбранного сервера и две точные публичные ссылки:
homepage издателя и страница условий Let's Encrypt. Произвольные внешние
домены/локальные схемы не получают разрешения. Native download branches
сохраняют Save As/cancel/progress и ID-based запросы, renderer не задаёт
произвольный путь или executable.

Настройки обновляются при возврате фокуса и каждые 5 секунд, пока страница
видима. Операции сериализованы; устаревший read не отменяет новое действие.
Additive поля trayStatus/startupReason не раскрывают системные пути,
D-Bus names или команды. Подсказка о продолжении звонка появляется только
при доступном трее и включённом close-to-tray. Отказ IPC команды «Выход»
теперь попадает в существующий ErrorNotice вместо unhandled rejection.

## Проверки

Evidence хранится в `desktop/artifacts/linux-stage05-20261018/`.
Сводка Linux: `runtime/runtime-summary.json`; финальные GUI receipts:
`runtime/utm-arm64/integration/notifications.json` и `downloads.json`;
обычный запуск: `runtime/utm-arm64/normal-entry-launch.json`.
Windows: `windows-arm64/runtime-summary.json`. Скриншоты наблюдений
и подтверждение очистки команд UTM находятся в `gui/`.
Финальная production сборка выполнена с manifest из 384 исходных файлов:
`97f478eea481240f12adaa1558f81864679cde9b2e14209b4b4c89499939ba62`.
Manifest учитывает dirty checkout, а не только HEAD. Runtime-проверки
проверяют байты исходников и сохраняют build provenance. Native-код
main/preload/platform не менялся после snapshot `dfd0d228…`.
Snapshots `ec70ed8e…`, `0188a5ed…`, `b63e46ab…` отличаются только Linux
test harness. Snapshot `f7b5e5e…` дополнительно содержит одну строку
обработки отказа Quit в React, проверенную frontend typecheck/foundation.
Переход f7→97 меняет только readiness/telemetry уведомлений в тесте:
после ручной паузы fixture открывает свежий SSE и проверяет получение
события. Production main/preload/renderer байты f7 и 97 совпадают.
`source-audit-final.json` фиксирует точные четыре изменённых файла и
совпадение production native bytes с unit/runtime проверками.

| Проверка | Результат и граница |
| --- | --- |
| Общие desktop unit tests | 206 PASS, 1 SKIP из 207; SKIP — настоящий Linux GIO на macOS |
| Frontend foundation | 28/28 PASS; сериализация настроек, устаревшие ответы, lifecycle polling и внешние ссылки |
| TypeScript, форматирование frontend, web/desktop сборки | PASS |
| macOS ARM64 shared NativeShell | PASS: реальный Tray, hide/show, restart, bounds, single-instance, foreign sender, quit |
| macOS ARM64 production renderer smoke | PASS: общий React, sandbox/Node isolation, typed IPC, CSP, URL/network policy, отключённые updates |
| XDG adapter в Ubuntu ARM64 | 16/16 PASS с реальными filesystem/GIO; login не выполнялся |
| XDG adapter в Ubuntu x64 | 16/16 PASS с реальными filesystem/GIO; x64 CPU эмулируется |
| Ubuntu ARM64 baseline | PASS, настоящий exit 0: cold/warm links, вторичные процессы, malformed link, minimize/restore, no-watcher close/quit, foreign IPC |
| Ubuntu ARM64 external opener | PASS, настоящий exit 0: защищённое GNOME credential store, разрешённая ссылка дошла через xdg-open/GIO до отдельного тестового handler; MIME defaults пользователя не менялись |
| Ubuntu 22.04 x64 baseline/external | PASS на snapshot b63e46ab…, оба runner exit 0: реальные процессы Electron, Xvfb/Openbox и xdg-open/GIO; QEMU TCG, а не нативная x64 приёмка |
| KDE SNI functional | 8 checks PASS, настоящий Electron exit 0: own PID, экспорт меню, opt-in close/show/hide, реальный выход host при живом watcher, восстановление скрытого окна, отказ hide без host, close→quit, dispose снимает item |
| Ubuntu ARM64 copied packaged directory | PASS на f7b5e5e4… с production байтами финального 97, настоящий exit 0: app.isPackaged/identity, existing IPC startup opt-in/out, GIO desktop Exec→second-instance/restore, Quit, inspector port закрыт, собственный runtime/profile удалён |
| Ubuntu ARM64 GNOME tray GUI | 7 checks PASS, настоящий exit 0 на f7: настоящее меню GNOME Open/Hide/Quit, opt-in close, потеря host возвращает скрытое окно; исходные extension settings восстановлены |
| Ubuntu ARM64 GNOME notification GUI | PASS на 97, настоящий exit 0: системная карточка с общим текстом, фактическое нажатие, restore/show и правильный route встречи |
| Ubuntu ARM64 native Save As GUI | PASS на 97, настоящий exit 0: реальный GTK диалог, Cancel без чтения content, Save в уникальный тестовый файл, 262144 байта и SHA-256 совпадают |
| Windows 11 ARM64 interactive regression | PASS на f7 в пользовательской Session 1: четыре фазы с exit 0, shared NativeShell и production React smoke; запрещённые изменения login items/protocol API не вызывались |

Linux integration fixtures используют production main/preload/NativeShell
и настоящие Tray/Notification/dialog/D-Bus API. Для transport используется
локальный disposable HTTPS/SSE сервер и отдельные профили; production
аккаунты и сервер не затрагиваются. Управляющий renderer этих fixtures —
тестовая страница, поэтому результаты не обозначаются как визуальная
приёмка React настроек. Sandbox остаётся включён.

Первоначальные FAIL сохранены, включая несовпадающую warm-route assertion
и ошибочный observer packaged runtime. В x64 fixture обнаружена гонка:
повторный before-quit запускал renderer JavaScript уже при уничтожении
окна. Минимальный официальный Electron, Tray create/destroy и полный
production main с обычным renderer завершились с exit 0. Замена observer
на once устранила зависание в diagnostic; финальные canonical baseline
и external повторы завершились с настоящим exit 0. Принудительное
завершение не считается PASS.

Packaged-directory observer использует только собственный скопированный
runtime и bounded localhost Node inspector. Ранние попытки выявили
недоступный process.execPath в observer context и слишком ранний require
до окончания Electron/Node bootstrap; negative reports сохранены. Финальный
helper использует проверенный canonical executable и перед первым require
ждёт exact copied entry в Module cache с loaded=true под общим deadline.
Это не production hook, не отключение sandbox и не обещание обычного
entry без observer: эта последняя проверка отдельно NOT RUN. Настоящий
login, deb/rpm/AppImage из directory smoke не выводятся.

KDE functional использует официальный `plasmawindowed
org.kde.plasma.systemtray` 5.27.12 на отдельной private bus в nested KWin.
Это реальный SNI host, но не полноценная Plasma desktop session. Первый
запуск plasmashell выявил отсутствие desktop shell package, а первый
временный fixture — неверную передачу отрицательного GetLayout аргумента
и преждевременный window-all-closed; FAIL сохранены, исправлен только
fixture. Финальный component entry импортирует production NativeShell/
monitor; он sandboxed, но не проверяет main/preload/auth/React. Визуальная
видимость значка и клик меню не заявляются. Private session не имеет
подтверждённого secure credential store, поэтому auth-bound уведомления
и загрузки в ней NOT RUN; fallback basic_text не включался.

После разблокировки выполнены настоящие GUI проверки в GNOME 46 Wayland.
Трей управлялся клавиатурой через системную панель, без синтетических
D-Bus menu events. Временное выключение Ubuntu AppIndicator подтвердило
восстановление скрытого окна; raw настройки extension восстановлены точно
(оба ключа UNSET, extension ACTIVE в разблокированной сессии). Fixture
не содержит app resources по своему app.getAppPath, поэтому его значок
placeholder не считается визуальной приёмкой фирменной иконки.

Нативное уведомление действительно появилось в истории GNOME при выключенном
DND. Нажатие передало правильный route, восстановило окно; GNOME дополнительно
показал «application is ready», потребовав отдельного выбора окна для focus.
Это ограничение Wayland активации, а не обещание безусловного foreground.
Проверка не подтверждает delivery при DND или во всех desktop environments.

Первая notification попытка выявила timeout простаивающего SSE в fixture;
исправлен только тест. Вторая получила системное уведомление и верный route,
но истекла до ручного Finish — её exit 1 сохранён и не считается PASS.
Повтор на 97 завершён с exit 0. Для ручных tray/notification/download сценариев
использован ignored runner с бюджетом 900 секунд вместо 360; это отражено
в receipts, production и проверяемые native API не подменялись.

В 16:00 Ubuntu штатно перезагрузилась: журнал показывает запрос systemd-logind
и clean shutdown, но не называет инициатора. Возможное попадание клавиш
в фоновое окно обновления после deadline — неподтверждённая гипотеза.
Тестовые runner не содержат reboot/logout API. Повтор уведомлений выполнялся
после обычного входа пользователя в новую Wayland session.

### Границы package formats

| Способ запуска | Автозапуск / ссылки | Реальная проверка |
| --- | --- | --- |
| Dev Electron | Startup unavailable; URI передаётся argv/second-instance, defaults не регистрируются | Реальные Linux baseline и external opener |
| Стабильный каталог с official Electron и resources/app | app.isPackaged; opt-in XDG с реальным executable | Отдельный packaged-directory smoke; не эквивалент установщику |
| deb | Постоянный executable пакета; desktop ID, `%u`, MIME association и зависимости обязан установить пакет | NOT RUN: пакет этого этапа не создавался |
| rpm | Те же XDG правила; зависимости и desktop registration зависят от rpm/distro | NOT RUN |
| AppImage | Исходный APPIMAGE; mount executable не сохраняется; после переноса требуется повторный opt-in | Unit path/security проверки; настоящий AppImage runtime NOT RUN |

Для tray monitor необходим совместимый `/usr/bin/busctl` и пользовательская
D-Bus session. При их отсутствии приложение остаётся открываемым обычным
способом и не скрывается при close. Успешный конструктор Tray не доказывает
наличие AppIndicator extension в GNOME. Установка extension пользователю
автоматически не производится. Наличие deb/rpm/AppImage, XDG записи или
успешная сборка сами по себе не доказывают login, URI registration,
уведомления и отображение значка в каждой среде.

## Матрица приёмки

| Система | X11 | Wayland |
| --- | --- | --- |
| Ubuntu 24.04 LTS x64 | NOT RUN | NOT RUN |
| Ubuntu 22.04 LTS x64 | Частично: QEMU TCG / Xvfb/Openbox; native x64 desktop NOT RUN | NOT RUN |
| Debian 12 x64 | NOT RUN | NOT RUN |
| Debian 13 x64 | NOT RUN | NOT RUN |
| Linux Mint 22 x64 | NOT RUN | NOT RUN |
| Fedora Workstation 44 x64 | NOT RUN | NOT RUN |
| Ubuntu 24.04 LTS ARM64 | NOT RUN | Частично: native ARM UTM GNOME 46; private nested KDE functional отдельно |

Windows 10 22H2 x64, Windows 11 x64 и Windows 11 ARM64 остаются целями
общего проекта. В Windows 11 ARM64 UTM официальный Electron 44.7.1 ARM64
запущен через GUI в пользовательской Session 1 (UserInteractive=true).
Payload f7 имеет production байты финального 97. Четыре фазы завершились
с exit 0: NativeShell, restart, secondary instance и production renderer.
Проверены Tray object/programmatic handlers, hide/show, bounds/preferences,
передача deep link от второго процесса первому, sandbox, Node isolation, typed IPC
и Quit. Guards зафиксировали ноль вызовов изменения login items и protocol
registration. Отрицательная проверка чужого окна ожидаемо отклонена.

Это unpackaged smoke с отдельными TEMP профилями, не визуальное нажатие
Windows tray, OS notification, реальный OS protocol handler, installer,
подпись, обновления, media или проверка обычного пользователя без admin policy.
Установленное приложение, registry, login items, MIME handlers и
ExecutionPolicy не изменялись. Windows 10/11 x64 среды отсутствуют — NOT RUN.

## Среды и очистка

Private KDE bus/KWin/kded/systemtray и все собственные fixture процессы
завершены, временные профили удалены. Проверены сохранность GNOME session,
portal/default handlers и audio defaults. Для теста в Ubuntu были добавлены
официальные пакеты Plasma workspace/xdg-utils; полная Plasma desktop не
устанавливалась и login desktop не переключался. Эти пакеты остаются в VM.
В Ubuntu итоговый scan собственных тестовых процессов и copied package
каталогов пуст. Уникальный MP4 fixture после проверки удалён. Внешние
ссылки/autostart использовали отдельные XDG dirs; реальные пользовательские
MIME/autostart настройки не менялись. Временные три Send Key команды UTM
удалены через UI, сохранена исходная Ctrl+Alt+Delete; input capture выключен.

Windows UTM VM оставлена запущенной: после проверки присутствовали Edge,
OneDrive и службы синхронизации, отсутствие пользовательской работы
подтвердить нельзя. Собственные тестовые процессы/профили и временная
копия runtime удалены; подготовленный staging и receipts сохранены
в windows-arm64/. Принудительное выключение не выполнялось.

Собственная x64 QEMU VM выключена штатно; тестовых процессов до shutdown
нет, её process и SSH port после shutdown отсутствуют. Диск сохранён
для повторных проверок. Финальный source payload собран и побайтно проверен
в `/home/meetspace/meetspace-stage05` в Ubuntu UTM. Старый stage04 PID31720
закрыт через GUI после наблюдения onboarding без активного звонка; исходный
профиль сохранён. Обычный stage05 entry запущен как PID6693 через официальный
Electron без test/inspector/dev/fake media флагов и без тестового CA.
Через GUI подтверждены настоящее окно React и фирменный значок в панели
GNOME. После подключения к ранее указанному серверу отображается форма
входа с пустыми credentials; авторизация не выполнялась. Приложение
оставлено открытым для пользователя. Это dev Electron entry, а не deb/rpm
или визуальная приёмка всех страниц React.

Ручные GNOME notification/menu/download сценарии и доступная Windows ARM64
runtime regression завершены. Полная приёмка этапа по заданной матрице
требует реального login/package форматов, остальных Linux-систем,
полноценной Plasma desktop session и Windows 10/11 x64. Эти случаи NOT RUN;
имеющиеся PASS не распространяются на них.

Следующий этап автоматически не начинается. Версия продукта сохраняется;
commit, push и публикация не входят в текущую работу.
