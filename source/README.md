# Дистрибутивы MeetSpace Desktop

Готовые пакеты Windows и Linux хранятся в `source/` и опубликованы через Git LFS.

```text
source/
├── linux/
│   ├── 0.1.1-beta/
│   └── 0.1.2-beta/
│       ├── DEB/
│       ├── RPM/
│       └── AppImage/
└── windows/
    ├── 0.1.0-beta/
    ├── 0.1.1-beta/
    └── 0.1.2-beta/
```

DEB — Ubuntu/Debian, RPM — Fedora и совместимые системы, AppImage — переносимый Linux-пакет. В каждом формате есть x64 и ARM64; архитектура указана в имени файла. Windows-пакеты лежат непосредственно в папке версии.

## Последние сборки 0.1.2 beta

Сборки от 24 октября 2026 года включают интерфейс по предоставленному макету для Windows и Linux, компактную панель конференции и двухшаговое окно приглашения со ссылкой, локальным QR-кодом и настоящей отправкой через сервер. Исправлены копирование в Electron, вставка списка email, блокировка формы при отправке и мастер установки по SSH. Сохранена поддержка архивов и документов.

Исходники: [`8bddf8f0210e`](https://github.com/janickiy/meet-space-desktop/commit/8bddf8f0210e5128357262a206f60bfaf5f327ee). Полный SHA-256 433 входных файлов: `07579126f9e501b8d8bffe0df1d99c6255abf6d03a98e5c5e6ff5023ab5d40ef`. Все восемь пакетов собраны из одинаковых файлов. Метаданные сборки сохраняют исходный HEAD `7c5840267ad2` и признак изменённого дерева; опубликованный commit содержит те же точные входные файлы.

[Изменения и проверки](../docs/desktop/2026-10-24_INTERFACE.md), [SSH-установщик](../docs/desktop/SSH_INSTALLER_REFERENCE.md).

| Пакет | x64 | ARM64 |
|---|---|---|
| Windows — EXE | [x64](windows/0.1.2-beta/MeetSpace-0.1.2-beta-win-x64-test-setup.exe) | [ARM64](windows/0.1.2-beta/MeetSpace-0.1.2-beta-win-arm64-test-setup.exe) |
| Ubuntu/Debian — DEB | [x64](linux/0.1.2-beta/DEB/MeetSpace-0.1.2-beta-linux-amd64-test.deb) | [ARM64](linux/0.1.2-beta/DEB/MeetSpace-0.1.2-beta-linux-arm64-test.deb) |
| Fedora — RPM | [x64](linux/0.1.2-beta/RPM/MeetSpace-0.1.2-beta-linux-x86_64-test.rpm) | [ARM64](linux/0.1.2-beta/RPM/MeetSpace-0.1.2-beta-linux-aarch64-test.rpm) |
| Linux — AppImage | [x64](linux/0.1.2-beta/AppImage/MeetSpace-0.1.2-beta-linux-x86_64-test.AppImage) | [ARM64](linux/0.1.2-beta/AppImage/MeetSpace-0.1.2-beta-linux-arm64-test.AppImage) |

## Последние сборки каждой версии

В каталоге **18 пакетов**: восемь новых `0.1.2-beta` и десять ранее опубликованных. Предыдущие версии сохранены без изменения байтов; их перечень ниже. Для каждой комбинации ОС, версии, формата и архитектуры хранится только последняя сборка.

Контрольные суммы — в [SHA256SUMS](SHA256SUMS); проверку нужно запускать из каталога `source/`. [catalog.json](catalog.json) содержит все оставленные пакеты, контрольные суммы и соответствие их прежних и текущих путей. Рядом с каждым пакетом сохранены исходные отчёты и контрольные суммы. В отчётах могут остаться первоначальные пути сборки. Содержимое установщиков не изменено.

| ОС | Версия | Формат / архитектура | Пакет |
|---|---|---|---|
| Linux | 0.1.1-beta | AppImage / arm64 | [MeetSpace-0.1.1-beta-linux-arm64-test.AppImage](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.1-beta | AppImage / x64 | [MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.1-beta | DEB / x64 | [MeetSpace-0.1.1-beta-linux-amd64-test.deb](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-amd64-test.deb) |
| Linux | 0.1.1-beta | DEB / arm64 | [MeetSpace-0.1.1-beta-linux-arm64-test.deb](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-arm64-test.deb) |
| Linux | 0.1.1-beta | RPM / arm64 | [MeetSpace-0.1.1-beta-linux-aarch64-test.rpm](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.1-beta | RPM / x64 | [MeetSpace-0.1.1-beta-linux-x86_64-test.rpm](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-x86_64-test.rpm) |
| Windows | 0.1.0-beta | NSIS / arm64 | [MeetSpace-0.1.0-beta-win-arm64-test-setup.exe](windows/0.1.0-beta/MeetSpace-0.1.0-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.0-beta | NSIS / x64 | [MeetSpace-0.1.0-beta-win-x64-test-setup.exe](windows/0.1.0-beta/MeetSpace-0.1.0-beta-win-x64-test-setup.exe) |
| Windows | 0.1.1-beta | NSIS / arm64 | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.1-beta | NSIS / x64 | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |

## Область проверки

Пакеты тестовые, без цифровой подписи приложения; автоматическое обновление отключено. Встроенный SSH-установщик отдельно подписан доверенным ключом. Windows x64/ARM64 прошли проверку встроенного NSIS/PE/ASAR payload; запуск текущего выпуска в Windows отдельно не проверялся. Linux ARM64 собран в Ubuntu 24.04 UTM, Linux x64 — в Ubuntu 22.04 amd64-контейнере с эмуляцией на Mac ARM64. Все Linux-пакеты проверены статически: метаданные, ELF/GLIBC, ASAR, install hooks и контрольные суммы. Общий интерфейс проверен настоящим Electron на macOS: 65 снимков, обе темы, узкие окна и увеличенный текст; API отправки — отдельный localhost-сервер. Это не является повторной полной приёмкой на всех ОС или проверкой реального SFU/SMTP. Предыдущие версии сохраняют исходную область проверки.

Скрипты сборки создают рабочие результаты в `desktop/artifacts/`; в репозитории готовые дистрибутивы размещаются по структуре `source/linux/<версия>/<формат>/<пакет>` и `source/windows/<версия>/<пакет>`.
