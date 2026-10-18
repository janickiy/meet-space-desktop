# Linux stage 6 — пакеты, обновления и CI/CD

Дата: 18 октября 2026. Версия продукта: **0.1.1-beta**. Выпуски этого этапа — внутренние тестовые пакеты **MeetSpace Test**. Пользователь подтвердил продолжение Linux с сохранением Windows и публичный контакт сопровождающего **janickiy@mail.ru**.

Итог: четыре Linux test-пакета готовы и проверены, контрольные Windows x64/ARM64 пересобраны. Полная приёмка **PARTIAL**: DNF операции Workstation и базовый обычный запуск прошли, но компонентные проверки повторно завершились по таймауту, а нормальный выход обычного запуска не подтверждён. Подпись, публичная публикация и автоматические обновления отключены. Общая сводка: `desktop/artifacts/linux-stage06-20261018/final-stage06-acceptance-summary-2837.json`.

## Область и исходный аудит

Используется существующий общий проект `desktop` (Electron/TypeScript) и `frontend` (React/TypeScript). Отдельный Linux frontend не создавался. До изменений проверены Windows builder, runtime policy, изоляция тестовой идентичности, механизмы обновлений и Linux-интеграция предыдущих этапов. Требовались отдельные Linux targets, зависимости, контролируемая упаковка, проверка содержимого и реальные испытания менеджеров пакетов. Существующая Windows-конфигурация не заменяется Linux-конфигурацией.

План этапа: отдельный Linux builder → статическая проверка всех четырёх форматов → установка/обновление/удаление в гостевых ОС → общий CI без публикации → контроль Windows. Обязательная матрица дистрибутивов рассматривается отдельно от факта сборки.

Рабочая ветка `codex/ssh-server-installer`, HEAD `963cc020460f3177823a790eda36ea967c44ddb3`. Checkout содержит сохранённые изменения предыдущих этапов; их не сбрасывали. Зафиксированы точные байты 399 файлов `frontend`, `desktop` и workflows, а не только HEAD. Контрольная сумма текущего кандидата:

`2837a51157fb7022d6d95cbcf611b85d535bd66731a87b068e6e7ff83632c995`

Манифест и журналы: `desktop/artifacts/linux-stage06-20261018/`. Исходники и результаты сборки сравниваются повторно перед выпуском в локальный каталог. Версию не повышали; commit, push, запуск GitHub Actions и публикация не выполнялись.

## Реализация

- `desktop/electron-builder.linux.config.cjs`: DEB amd64, DEB arm64, RPM x86_64, AppImage x86_64; maintainer `MeetSpace <janickiy@mail.ru>`, desktop entry, иконки, явные зависимости. База glibc для x64 — Ubuntu 22.04 (2.35).
- `desktop/scripts/package-linux.mjs`: только Linux-процесс соответствующей архитектуры, отдельная блокировка, уникальный staging и запрет перезаписи существующего каталога `artifacts/linux/<version>/<source-sha256>/<arch>/`. Публикация отключена.
- `desktop/scripts/normalize-linux-package.cjs`: контролируемые права и timestamps, отсутствие опасных типов файлов и внешних symlinks; единственный разрешённый SUID-файл — Chromium sandbox.
- `desktop/scripts/verify-linux-artifacts.mjs` и `linux-package-policy.mjs`: статическое чтение архивов без запуска их кода; пути, владельцы, права, scripts/triggers, зависимости, архитектуры всех ELF, GLIBC version needs, точные Electron/ASAR/runtime policy/source inputs, иконки и desktop entry. SHA256/SHA512 и отдельные отчёты создаются без перезаписи.
- `desktop/resources/linux/`: install/remove hooks только для своего sandbox и кешей desktop/icons; профили и автозапуск пользователя не удаляются. AppRun запускает приложение без обхода песочницы.
- Upstream AppImage launcher в закреплённом electron-builder автоматически добавлял `--no-sandbox` при недоступных user namespaces. Linux driver заменяет ровно проверенный участок app-builder-lib 26.17.0 собственным launcher, проверяя исходный и итоговый SHA256. Неизвестная версия/изменённый upstream отклоняются. Это преобразование не используется Windows driver.
- `desktop/tests/linux-installed-package-runner.cjs`: проверка именно установленного executable или исходного AppImage от обычного пользователя, изолированный временный профиль, загруженный packaged ASAR, renderer sandbox/contextIsolation, отсутствие Node в renderer и `no-sandbox`, запуск через desktop autostart и штатный Quit. Инспектор слушает только localhost и применяется только тестовым процессом.
- `desktop/scripts/ci/linux-deb-acceptance.sh`: установка, контролируемое повышение версии пакета, переустановка, удаление и сохранение маркера в собственном профиле. Требует явного `--disposable`, отказывается работать поверх существующей установки.

Идентичность Linux test: `com.janickiy.meetspace.desktop.test`; пакет `meetspace-desktop-test`; executable `/opt/meetspace-desktop-test/meetspace-test`. Отображаемое имя в package metadata и desktop entry — **MeetSpace Test**. Desktop ID использует суффикс `.test`, но URI-схема остаётся общей `meetspace:`. Пакет объявляет обработчик этой схемы и не назначает его принудительно пользовательским MIME default; состояние defaults проверяется отдельно. Ранее установленные приложения и пользовательские профили не используются как тестовые данные.

Сохранность defaults означает сравнение проверяемых конфигурационных файлов MIME/autostart до и после теста; отдельно сравниваются sysctl/AppArmor/SELinux. Это не полная проверка эффективного выбора обработчика URI во всех desktop environments: после регистрации приложения системный выбор при отсутствии явного пользовательского default может зависеть от окружения.

Реальная установка предварительного ARM64-пакета обнаружила SIGTRAP до старта main: `LaunchProcess: failed to execvp: /opt/MeetSpace`, zygote exit 127. У main были права root:root 0755, у sandbox — root:root 4755, обходов защиты не было. Симптом совпал с известной [ошибкой Electron при пробеле в SUID sandbox install path](https://github.com/electron/electron/issues/44414). Linux builder теперь использует технический `productName=meetspace-desktop-test` для файлового пути, а `extraMetadata.productName` и desktop `Name` сохраняют пользовательское имя. Это поддержанные настройки builder, Windows не менялся. Проверка через настоящий AppInfo и LinuxTargetHelper фиксирует безопасный путь, имя и аргументы запуска.

Ещё два расхождения выявлены настоящими пакетами: `${arch}` превращается в `amd64` для DEB и `x86_64` для RPM/AppImage; Electron `LICENSE` переименовывается builder в `LICENSE.electron.txt`. Проверяющий код теперь учитывает оба преобразования и сравнивает точные байты с исходным официальным файлом. Исправлена генерация AppImage Exec: наследуемый `%u` не должен дополнять автоматически добавленный `%U`. Настройки аргументов перенесены отдельно в DEB/RPM, фактический AppImage target проверяется внешним контрактным тестом.

Свежая Ubuntu 24.04 выявила отдельную настоящую ошибку зависимости: APT выбрал OSS shim, предоставляющий неверсионированный `libasound2`, и ELF завершился из-за отсутствующего `snd_device_name_get_hint` / `ALSA_0.9`. Исправлено на `libasound2t64 (>= 1.2.2) | libasound2 (>= 1.2.2)`. Контрольный APT probe без установки подтвердил выбор настоящей t64 на чистом состоянии; с уже установленным несовместимым OSS provider установка корректно отклоняется. Продукт не добавляет принудительный Conflict для удаления чужого звукового стека: такой случай требует ручного разрешения через менеджер пакетов. Сами probe-пакеты не устанавливались. Полные планы: `extra-distros/ubuntu24/alsa-provider-policy.log` и `e963-genuine-alsa-diagnostic.log`.

Сборка выполняется в собственном checkout с `umask 022`, без group/world write у проверяемых каталогов сборки, ресурсов и результатов. Перенос только файлов в первоначально созданные каталоги с Ubuntu `umask 002` дал `0775`; защитные проверки это отклонили. Исправлены права только собственных временных каталогов; байты исходников и проверки пакетов не ослаблялись. Первые неуспешные журналы сохранены. Медленная загрузка Electron повторена через зеркало, причём оба полных архива проверены по SHA256 из независимо полученного официального GitHub SHASUMS и npm electron/checksums.json; `electron-cache/verified-electron-downloads.json` фиксирует происхождение и точные суммы.

## Обновления и CI

DEB/RPM обновляются системным менеджером пакетов из локального проверенного файла. Публичного APT/DNF-репозитория и ключей подписи пока нет. AppImage заменяется вручную проверенным файлом; update information и автоматическое обновление отключены. В настройках Linux это явно указано. Windows-механизм доверия к подписанному каналу не менялся.

Runtime исходного AppImage подтверждён только на Ubuntu 22.04 x64 с FUSE. Это не подтверждение его запуска на всех перечисленных дистрибутивах: если системная политика не позволяет работающую песочницу, launcher завершает запуск, а не отключает защиту. Успех DEB/RPM с установленным root-owned SUID helper не переносится автоматически на AppImage.

`.github/workflows/desktop-linux-build.yml` добавлен отдельно от Windows workflows. Нативные архитектуры runner: Ubuntu 22.04 x64 и Ubuntu 24.04 ARM64, Node 24.19.0, зависимости из lockfiles, закреплённые SHA Actions, token только `contents: read`. Предусмотрены общие проверки, упаковка, DEB lifecycle и AppImage runtime через Xvfb/private DBus, source evidence и CycloneDX inventories. Fedora 44 container job проверяет только RPM install/reinstall/remove: Electron внутри контейнера не запускается, upgrade/full desktop этим job не подтверждаются. Фактический digest Fedora image записывается; тег образа не является неизменяемой фиксацией содержимого.

Структура YAML локально проверена. Исправлена проверка существующего RPM: `! rpm -q` не останавливает Bash с `-e`; теперь явный `if` прерывает сценарий. Обе ветви проверки отдельно выполнены, результат `workflow-rpm-preflight.json`. Минимальные Debian cloud образы выявили отсутствующий `/usr/bin/gio`, используемый именно тестом; `libglib2.0-bin` установлен как тестовая зависимость и явно добавлен в CI, без лишней зависимости продукта от CLI. Удалённые GitHub jobs **не запускались**; наличие workflow не является результатом CI. Подписанный выпуск, repository/environment protection и инфраструктура автообновлений не имитировались.

## Проверки и среды

Локально на macOS с Node 24.19.0: desktop build PASS; **226 desktop-тестов PASS, 1 Linux-тест SKIP**, failures 0; frontend type/build check PASS; frontend desktop foundation **28/28 PASS**; shell/Node syntax и `git diff --check` PASS. Linux-only проверка GIO не считается пройденной на macOS. Итоговые журналы зафиксированного кандидата: `desktop-unit-alsa-fixed.log`, `host-build-alsa-fixed.log`, `frontend-check-2837.log` и `frontend-foundation-2837.log`. Среди desktop-тестов — 20 проверок Linux packaging policy/readers/driver, включая контракты настоящего закреплённого builder.

Среды реального Linux userspace/kernel:

| Среда | Архитектура и ограничения | Назначение |
|---|---|---|
| Ubuntu 24.04.5 UTM | Нативная ARM64, HVF, glibc 2.39 | ARM64 DEB build/lifecycle/runtime |
| Ubuntu 22.04.5 QEMU | x86_64, CPU эмулирован TCG, glibc 2.35 | x64 build, DEB lifecycle, исходный AppImage через FUSE |
| Fedora 44 Cloud Base QEMU | x86_64, TCG, glibc 2.43, SELinux Enforcing | RPM lifecycle и Xvfb runtime в полной гостевой ОС |
| Ubuntu 24.04 x64 QEMU | x86_64, TCG, glibc 2.39, системный AppArmor/userns restriction сохранён | DEB lifecycle и Xvfb runtime |
| Debian 12 QEMU | x86_64, TCG, glibc 2.36 | DEB lifecycle и Xvfb runtime |
| Debian 13 QEMU | x86_64, TCG, glibc 2.41 | DEB lifecycle и Xvfb runtime |
| Linux Mint 22.3 Xfce Live QEMU | x86_64, TCG, glibc 2.39, официальный casper root и собственный ext4 persistence | DEB lifecycle и Xvfb; не установленная ОС и не обычная Xfce login-сессия |
| Fedora 44 Workstation Live QEMU | x86_64, TCG, настоящая GNOME Wayland-сессия liveuser UID1001, SELinux Enforcing | RPM lifecycle и Wayland; отдельный от Cloud Base образ |

В Fedora Workstation 44 нет штатной GNOME X11-сессии: её удаление принято для Fedora 43. X11-приложения остаются отдельным поддержанным случаем; отсутствие такой login-сессии не засчитывается как успешный X11-тест. Источник: [Fedora Wayland-only GNOME](https://fedoraproject.org/wiki/Changes/WaylandOnlyGNOME).

Fedora Cloud Base 44-1.7 получен из официального источника; CHECKSUM GPG-подпись проверена ключом Fedora 44 `36F612DCF27F7D1A48A835E4DBFCF71C6D9F90A6`. Образ SHA256 `28680fe5b371a5a82ebf43a31926e086a168e59949d03969c5093e7071f90b7f`. Это не Fedora Workstation GNOME. На Fedora сохранены SELinux и системный Node; тестовый Node 24.19 находится в собственном каталоге пользователя.

Дополнительно загружены и проверены настоящие Live ISO: Mint 22.3 Xfce, 3033710592 байт, SHA256 `45a835b5dddaf40e84d776549e0b19b3fbd49673b6cc6434ebddbfcd217df776`, подпись Mint `27DEB15644C6B3CF3BD7D291300F846BA25BAE09`; Fedora Workstation 44-1.7, 2851612672 байт, SHA256 `1620295f6a00c27c3208f0c00b8ece4eab1ec69b9002152d97488bf26a426ddf`, подпись указанным ключом Fedora. Подробности: `extra-distros/mint22/{image-verification,environment}.json` и `fedora44-workstation/{image-verification,guest-environment-retry}.json`. Подмена Ubuntu branding не использовалась. Mint загружается с vendor casper и собственным 24GB writable overlay; Workstation — с настоящим Live root, GNOME и отдельным 40GB диском для QA данных. Это полноценные гостевые ОС под TCG, но не проверка установленной на диск системы после login/reboot.

Подготовка этих Live VM потребовала отдельных исправлений окружения. На Fedora account liveuser создаётся после ранних boot services, а ISO9660 меняет длинные имена QA-файлов; исходные байты сверены и перенесены через свой SSH. На Mint CD-only APT source мешал первому update: bootstrap использовал per-command `Dir::Etc::sourcelist=/dev/null`, сохранив остальные штатные подписанные сетевые источники и исходные `/etc/apt` файлы. На Workstation первый upgrade штатно отказал из-за нехватки места RAM overlay; QA Node/source/RPM/cache перенесены на собственный ext4, не изменяя приложение. Первый baseline runtime прошёл, но этот отказ не засчитывается как успешный lifecycle. Следующие два чистых компонентных прогона завершились `bounded_inspector_timeout` до первого утверждения о React. Последний observer-only trace зафиксировал запрос `Runtime.evaluate` id10: синхронный snapshot `app.isPackaged`, имени/версии/путей и состояния `BrowserWindow.webContents`; ответа за прежние 8 секунд не было. Main находился в R/S/futex wait, load составлял около 5–5.7 на 4 TCG vCPU; конкретная причина, включая libsecret, не установлена. Отдельно через CUA обнаружен неактивный дисплей, он разбужен и проверен визуально; повтор с активным GNOME и штатным временным idle inhibitor также не прошёл. Таймауты, canonical observer, защита и приложение не изменялись. Все неуспешные журналы сохранены; единичный первый PASS не выдаётся за стабильную приёмку Workstation. Собственный временный sudoers rule Workstation разрешает только точные DNF операции с root-owned readonly тестовыми RPM; его создание/проверка/удаление относится к provisioning VM, а не к поведению установщика. Сохранность SELinux/AppArmor/sysctl рассматривается отдельно от такой подготовки тестового доступа.

## Артефакты

Окончательные пакеты из исходников `2837a511…` прошли формальную статическую проверку в Linux соответствующей архитектуры. Они находятся в неизменяемом локальном каталоге `desktop/artifacts/linux/0.1.1-beta/2837a51157fb7022d6d95cbcf611b85d535bd66731a87b068e6e7ff83632c995/{x64,arm64}/`. Манифест исходников, `linux-packaging-build.json`, `linux-artifact-verification.json`, `linux-publication.json` и суммы SHA256/SHA512 сохраняются рядом с пакетами. Промежуточные кандидаты, включая `e963d672…` до исправления ALSA, сохранены только для диагностики.

| Файл | Размер, байт | SHA256 |
|---|---:|---|
| `MeetSpace-0.1.1-beta-linux-amd64-test.deb` | 102804220 | `0529964039f2f4b1cc3efd61f5cb85f69269383aace744a07abbfbf7949f1b2a` |
| `MeetSpace-0.1.1-beta-linux-arm64-test.deb` | 98026724 | `2ac4337ff8662814ece7fb51cba5d3bea44d69ffa0655d9e57ee9dce89afa9ac` |
| `MeetSpace-0.1.1-beta-linux-x86_64-test.rpm` | 92434097 | `f29fdebcd2613a1aabc73d2f9ae7900831fa44e0d73cccc64c83660270339d4b` |
| `MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage` | 129253942 | `f94498eccc77a81a219656b446dce3ef67056f45c803de7621265440cf4d4a8d` |

Контакт сопровождающего проверен в настоящих DEB/RPM metadata. Максимальная иконка hicolor точно совпала с `resources/icon.png`, SHA256 `1ba6531d79b46cb160af407af6e6aec5f349abd9d1a0da669fa728c214f1a5fa`; размеры остальных PNG и внутренние icon symlinks также проверены.

После доставки на Mac независимо пересчитаны все четыре файла и обе checksum sidecar, сопоставлены размеры и суммы с Linux static receipts и точные манифесты всех 399 файлов. Результат PASS: `desktop/artifacts/linux-stage06-20261018/host-delivery-check-2837.json`. Это проверка целостности доставки; статическая проверка архивов выполнялась отдельно в Linux, runtime — отдельно в гостевых ОС. Независимая повторная сверка всех 399 исходных файлов, четырёх Linux и двух Windows binaries, сумм SHA256/SHA512, размеров, версий и email также PASS: `independent-final2837-readonly-audit-20261018T195312Z-scope-corrected.json` (519 утверждений аудитора, не 519 runtime-тестов). Workstation PARTIAL исключён из области этого PASS.

Для всех PASS-строк ниже проверялся именно окончательный кандидат с контрольной суммой из таблицы. Проверки полного рабочего стола и входа в ОС перечислены отдельно.

### Обязательная матрица приёмки

| ОС/сессия | Итог этапа |
|---|---|
| Ubuntu 22.04 x64, DEB/package/Xvfb | PASS — install/upgrade/reinstall/remove, runtime, сохранение контрольного файла профиля |
| Ubuntu 24.04 ARM64 native, DEB/package/Xvfb | PASS — install/upgrade/reinstall/remove, runtime, сохранение контрольного файла профиля |
| Fedora 44 Cloud Base, full OS/RPM/Xvfb | PASS — DNF install/upgrade/reinstall/remove, оба runtime, данные профиля; SELinux Enforcing сохранён |
| Ubuntu 24.04 x64, DEB/package/Xvfb | PASS — полный package lifecycle и оба runtime; настоящая ALSA выбрана автоматически |
| Debian 12 x64, DEB/package/Xvfb | PASS — полный package lifecycle и оба runtime |
| Debian 13 x64, DEB/package/Xvfb | PASS — полный package lifecycle и оба runtime |
| Ubuntu 22.04 x64, исходный AppImage/FUSE/Xvfb | PASS — настоящий FUSE mount, sandboxed renderer, GIO и Quit 0 |
| Ubuntu 24.04 native ARM64, установленный DEB на GNOME Wayland | PASS — компонентный тест на реальном compositor socket с явным `--ozone-platform=wayland`, без DISPLAY |
| Linux Mint 22.3 Xfce Live x64, persistent disk/package/Xvfb | PASS — APT install/upgrade/reinstall/remove, оба runtime и сохранение контрольного файла профиля; обычный Xfce GUI/login не проверялся |
| Fedora 44 Workstation Live x64, GNOME Wayland | PARTIAL — DNF install/upgrade/reinstall/remove и basic ordinary GIO visual startup PASS; один baseline runtime PASS, два следующих компонентных прогона FAIL по таймауту; полный suite не принят. Нормальный выход отдельного GIO запуска не подтверждён |
| Полная визуальная X11/Wayland-приёмка новых пакетов, звонки и физические устройства | NOT RUN в этом этапе |
| Реальный logout/login/reboot ОС с запуском приложения после входа | NOT RUN — проверялся GIO launch сформированного autostart entry, а не новая сессия ОС |

После последнего компонентного отказа отдельно выполнены настоящий DNF upgrade 0→1 и reinstall окончательного RPM. Проверки `rpm -V` после обеих операций, desktop entry, root-owned sandbox 4755, контрольного файла профиля и SELinux/sysctl прошли. Первый дополнительный `rpm -V` не смог прочитать унаследованный `/home/msqa` как liveuser; исправлен только cwd своего ignored helper, отказ сохранён. Затем DNF remove удалил пакет и desktop entry, сохранив собственный контрольный файл профиля. Три пустых root:root 0755 каталога очищены отдельно после фиксации результата. Временный узкий sudoers rule удалён с проверкой точного содержимого и `visudo`; общее sudo для liveuser по-прежнему отклоняется. Эти отдельные положительные результаты не превращают компонентный suite в PASS.

Отдельный обычный запуск установленного кандидата через штатный GIO desktop entry, без Inspector и `NODE_OPTIONS`, дал отрисованный экран «Подключиться к серверу» с логотипом, формами и кнопками. Это подтверждено настоящим CUA screenshot после пробуждения дисплея и Alt+Tab, а не только наличием PID. Базовый визуальный startup PASS; авторизация, звонки и полный GUI не проверялись. Единственный Ctrl+Q через VM не дал подтверждённого выхода: спустя 5 секунд окно оставалось видно; нормальный Quit/exit 0 для этого отдельного запуска не заявляется, собственный процесс завершён через явно отмеченный SIGTERM cleanup после проверки PID, UID, executable, startTicks и связи с собственным профилем. Активный профиль и private keyring удалены; exit code 0 не заявляется. Наблюдение: `fedora44-workstation/cua-ordinary-launch-observation.json`; кадры находятся в диалоге, локальный PNG не заявляется.

Итоговые Workstation evidence: `fedora44-workstation/{package-transactions,normal-launch-result,normal-forced-termination,final-owned-cleanup,final-source-environment-retry}.json`, raw-журналы — `workstation-final-evidence.tgz`. `package-transactions.json` фиксирует upgrade/reinstall до последующего удаления; окончательное отсутствие пакета и сохранность контрольного файла подтверждает отдельный cleanup receipt. Собственный административный provisioning rule 90 сохранён только внутри приватной VM для восстановления; временный narrow rule 91 liveuser удалён. Это не изменение политики продукта.

Workstation trace и отрицательный результат: `fedora44-workstation/{last-baseline-smoke,last-compositor-proof,last-keyring-isolation}.json` и `last-inspector-trace.ndjson`; предыдущие попытки сохранены отдельно. Запрос загрузки `app.asar` получил ответ, но из 10 Inspector requests вернулись только 9 responses. Это подтверждает точку остановки теста, но не диагноз зависания приложения или keyring. Исходный первый успешный baseline и последующие ошибки рассматриваются совместно как нестабильная компонентная проверка.

На Mint headless backend `basic_text` корректно отклонён политикой приложения; доступность защищённого хранилища и авторизация не считаются проверенными положительно. AppArmor и исходные sysctl не менялись: в vendor Mint `restrict_unprivileged_userns=0`, что не следует переносить на defaults Ubuntu. APT sources до и после совпали. Сводка: `extra-distros/mint22/acceptance-summary.json`; доказательства сохранности sources и выключения: `extra-distros/mint22/{apt-source-preservation,shutdown}.json`.

Контролируемый upgrade fixture имеет меньшую пакетную версию при **том же приложении и payload**, что кандидат. Для DEB fixture используется gzip level 1, для RPM — gzip; компрессия самого выдаваемого кандидата не меняется. Это сокращает ненужное повторное сжатие тестовой версии под TCG. Для RPM сравниваются полные карты путей, файловых хешей, прав, владельцев, symlinks и scripts; первые fixture с пропущенными декларациями каталогов build-id и ошибочным umask отклонены до установки и сохранены как диагностика. Версионный fixture проверяет действия менеджера пакетов и сохранение собственных данных, но не историческую миграцию продукта. Xvfb/Inspector smoke не заменяет обычную визуальную сессию, авторизацию или приёмку всего дистрибутива. TCG не подтверждает физическую производительность x64.

Для нативной Ubuntu GUI-сессии первая private-DBus попытка столкнулась с уже работающим GNOME keyring и блокировала инициализацию. Тест перенесён в собственные XDG runtime/config/data и собственный keyring с временным паролем только через stdin. Настоящий пользовательский keyring и обычный MeetSpace не останавливались. В отдельной попытке после успешного lifecycle остался собственный portal FUSE mount; ошибка очистки сохранена, отсоединён только этот mount и подтверждена восстановленная очистка. Это проблемы тестового окружения, отдельные от обнаруженных и исправленных ошибок пакета.

Перед окончательным Fedora-прогоном preflight корректно отказался от существующего пути: предыдущий тестовый RPM оставил только три пустых root:root 0755 каталога `/opt/meetspace-desktop-test`, `locales` и `resources`, без пакета, executable и desktop entry. Начальное отсутствие пути и принадлежность остатков своему предыдущему тесту подтверждены. Сохранён отказ `fedora44/2837-rpm-preflight-first-result.json`; удалены исключительно эти пустые каталоги через `rmdir`, после чего проверка прошла без изменения guard или приложения. Это также ограничение окончательного RPM uninstall: бинарные файлы и desktop entry удаляются, но эти три пустых каталога остаются. После фиксации результата тест удалил только собственные пустые остатки; подробности `fedora44/final-2837-rpm-lifecycle/post-remove-owned-cleanup.json`.

Итоговые отчёты ARM64: `final-2837-deb-lifecycle-isolated/deb-lifecycle.json`; Ubuntu 22.04 x64: `final-2837-deb-lifecycle/deb-lifecycle.json`; Fedora RPM: `fedora44/final-2837-rpm-lifecycle/rpm-lifecycle.json`; Wayland: `final-2837-wayland-smoke/runtime.json` и `compositor-proof-summary.json`; AppImage: `final-2837-appimage-smoke/runtime.json`. Сводка дополнительных Ubuntu/Debian: `extra-distros/acceptance-summary.json`, подробности — `extra-distros/<distro>/runtime-evidence/{deb-lifecycle,baseline-smoke,candidate-smoke}.json` и security/shutdown receipts в `extra-distros/<distro>/`. Сводка основных проверок и выключения: `final-2837-main-runtime-qa.json`, `final-2837-owned-vm-shutdown.json`. Семь итоговых собственных временных x64 VM (включая Mint и Workstation) штатно выключены; активные тестовые пакеты, профили и процессы удалены. Workstation сводка и выключение: `fedora44-workstation/{acceptance-summary,shutdown}.json`; перед poweroff проверены очистка пакета/профилей и удаление narrow sudoers, после — serial Powerdown, отсутствие PID/SSH listener и открытого qcow2. Ранний неуспешный boot Workstation пришлось завершить QMP quit; этот факт не смешивается со штатным poweroff итоговых VM. Диски и диагностика сохранены приватно. Исходные native Ubuntu и Windows не выключались, обычный MeetSpace и keyring на native Ubuntu сохранены. Полные пути отсчитываются от `desktop/artifacts/linux-stage06-20261018/`.

## Windows regression

Контрольные NSIS x64/ARM64 из тех же зафиксированных исходников `2837a511…` собраны существующим Windows driver: обе сборки и проверка встроенного payload **PASS**. Исходники после сборки не изменились. Подпись и автообновления остаются отключёнными для test builds. Историческая проверка предыдущей фиксации исходников сохранена в `docs/desktop/06_WINDOWS_INSTALLERS_CURRENT.md` и не выдаётся за приёмку текущих пакетов.

| Текущий Windows test installer | Размер, байт | SHA256 |
|---|---:|---|
| x64 | 124116917 | `6852f4530b5c3459ae4fe6e0ed72ec120942ac8e936a00555426b6f2ef0ed29f` |
| ARM64 | 118857877 | `2b3458661e878545b58131992f7acbce6d58b9ec535679712da2606a18ecbf8a` |

Отчёт и сохранённые копии: `desktop/artifacts/linux-stage06-20261018/windows-regression/verified-2837-summary.json` и `verified-artifacts/2837a511…/{x64,arm64}/`. Предыдущие установщики сохранены, одноимённые старые файлы не считаются текущими.

Windows 11 ARM64 в UTM содержит ранее установленную all-users MeetSpace Test 0.7.1 и рабочую пользовательскую сессию. Принудительная переустановка/удаление не выполнялись. Полный installer lifecycle Windows 10 22H2 x64, Windows 11 x64/ARM64 на чистых системах **NOT RUN**.

## Ограничения и остановка

Полная обязательная матрица ещё не подтверждена. Выпуск остаётся внутренним тестовым; новые публичные каналы, подпись и production installation не включены. Исходный ARM64 Ubuntu-процесс предыдущего этапа и его профиль сохраняются. Активные собственные тестовые установки/профили очищены; отрицательные результаты и приватные диагностические копии сохранены отдельно. Этап 7 автоматически не начинается.
