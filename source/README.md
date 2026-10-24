# Дистрибутивы MeetSpace Desktop

Готовые пакеты Windows и Linux хранятся в `source/` и опубликованы через Git LFS.

```text
source/
├── linux/
│   ├── 0.1.1-beta/
│   ├── 0.1.2-beta/
│   ├── 0.1.3-beta/
│   └── 0.1.4-beta/
│       ├── DEB/
│       ├── RPM/
│       └── AppImage/
└── windows/
    ├── 0.1.0-beta/
    ├── 0.1.1-beta/
    ├── 0.1.2-beta/
    ├── 0.1.3-beta/
    └── 0.1.4-beta/
```

DEB — Ubuntu/Debian, RPM — Fedora и совместимые системы, AppImage — переносимый Linux-пакет. В каждом формате есть x64 и ARM64. Windows-пакеты лежат непосредственно в папке версии.

## Последние сборки 0.1.4 beta

Выпуск `0.1.4-beta` от 24 октября 2026 года добавляет выбор установки сервера из готовых Docker-образов или из исходников. Подписанный установщик проверяет метаданные выпуска, контрольные суммы и соответствие архитектуре. Интерфейс установки приведён к макету. Сохранены восстановление защищённого хранилища, компактные элементы конференции, приглашение с QR-кодом без подписей и поддержка архивов и документов.

Исходники: [`abfb787c62ab`](https://github.com/janickiy/meet-space-desktop/commit/abfb787c62ab46da7ed57e74f3b2be421e5b803e). SHA-256 440 входных файлов: `7d3f51bd7c9b0387dfdffaa84655c192ea5890e31e0b1b7ac7424f7f2efb7184`. Все восемь пакетов собраны из одинаковых входных файлов, соответствующих этому commit. Windows- и Linux-отчёты сохраняют `sourceDirty: false`; список и байты всех 440 входных файлов дополнительно сверены с указанным commit.

| Пакет | x64 | ARM64 |
|---|---|---|
| Windows — EXE | [x64](windows/0.1.4-beta/MeetSpace-0.1.4-beta-win-x64-test-setup.exe) | [ARM64](windows/0.1.4-beta/MeetSpace-0.1.4-beta-win-arm64-test-setup.exe) |
| Ubuntu/Debian — DEB | [x64](linux/0.1.4-beta/DEB/MeetSpace-0.1.4-beta-linux-amd64-test.deb) | [ARM64](linux/0.1.4-beta/DEB/MeetSpace-0.1.4-beta-linux-arm64-test.deb) |
| Fedora — RPM | [x64](linux/0.1.4-beta/RPM/MeetSpace-0.1.4-beta-linux-x86_64-test.rpm) | [ARM64](linux/0.1.4-beta/RPM/MeetSpace-0.1.4-beta-linux-aarch64-test.rpm) |
| Linux — AppImage | [x64](linux/0.1.4-beta/AppImage/MeetSpace-0.1.4-beta-linux-x86_64-test.AppImage) | [ARM64](linux/0.1.4-beta/AppImage/MeetSpace-0.1.4-beta-linux-arm64-test.AppImage) |

## Последние сборки каждой версии

В каталоге **34 пакета**: восемь новых `0.1.4-beta` и 26 ранее опубликованных. Все прежние версии, включая `0.1.3-beta`, сохранены вместе с отчётами и контрольными суммами без изменения байтов. Для каждой комбинации ОС, версии, формата и архитектуры хранится последняя опубликованная сборка.

Контрольные суммы — в [SHA256SUMS](SHA256SUMS); проверку нужно запускать из `source/`. [catalog.json](catalog.json) содержит все пакеты и проверочные метаданные. Исторические пути сборки в отчётах сохранены.

| ОС | Версия | Формат / архитектура | Пакет |
|---|---|---|---|
| Linux | 0.1.1-beta | AppImage / arm64 | [MeetSpace-0.1.1-beta-linux-arm64-test.AppImage](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.1-beta | AppImage / x64 | [MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.1-beta | DEB / x64 | [MeetSpace-0.1.1-beta-linux-amd64-test.deb](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-amd64-test.deb) |
| Linux | 0.1.1-beta | DEB / arm64 | [MeetSpace-0.1.1-beta-linux-arm64-test.deb](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-arm64-test.deb) |
| Linux | 0.1.1-beta | RPM / arm64 | [MeetSpace-0.1.1-beta-linux-aarch64-test.rpm](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.1-beta | RPM / x64 | [MeetSpace-0.1.1-beta-linux-x86_64-test.rpm](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-x86_64-test.rpm) |
| Linux | 0.1.2-beta | AppImage / arm64 | [MeetSpace-0.1.2-beta-linux-arm64-test.AppImage](linux/0.1.2-beta/AppImage/MeetSpace-0.1.2-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.2-beta | AppImage / x64 | [MeetSpace-0.1.2-beta-linux-x86_64-test.AppImage](linux/0.1.2-beta/AppImage/MeetSpace-0.1.2-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.2-beta | DEB / x64 | [MeetSpace-0.1.2-beta-linux-amd64-test.deb](linux/0.1.2-beta/DEB/MeetSpace-0.1.2-beta-linux-amd64-test.deb) |
| Linux | 0.1.2-beta | DEB / arm64 | [MeetSpace-0.1.2-beta-linux-arm64-test.deb](linux/0.1.2-beta/DEB/MeetSpace-0.1.2-beta-linux-arm64-test.deb) |
| Linux | 0.1.2-beta | RPM / arm64 | [MeetSpace-0.1.2-beta-linux-aarch64-test.rpm](linux/0.1.2-beta/RPM/MeetSpace-0.1.2-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.2-beta | RPM / x64 | [MeetSpace-0.1.2-beta-linux-x86_64-test.rpm](linux/0.1.2-beta/RPM/MeetSpace-0.1.2-beta-linux-x86_64-test.rpm) |
| Linux | 0.1.3-beta | AppImage / arm64 | [MeetSpace-0.1.3-beta-linux-arm64-test.AppImage](linux/0.1.3-beta/AppImage/MeetSpace-0.1.3-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.3-beta | AppImage / x64 | [MeetSpace-0.1.3-beta-linux-x86_64-test.AppImage](linux/0.1.3-beta/AppImage/MeetSpace-0.1.3-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.3-beta | DEB / x64 | [MeetSpace-0.1.3-beta-linux-amd64-test.deb](linux/0.1.3-beta/DEB/MeetSpace-0.1.3-beta-linux-amd64-test.deb) |
| Linux | 0.1.3-beta | DEB / arm64 | [MeetSpace-0.1.3-beta-linux-arm64-test.deb](linux/0.1.3-beta/DEB/MeetSpace-0.1.3-beta-linux-arm64-test.deb) |
| Linux | 0.1.3-beta | RPM / arm64 | [MeetSpace-0.1.3-beta-linux-aarch64-test.rpm](linux/0.1.3-beta/RPM/MeetSpace-0.1.3-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.3-beta | RPM / x64 | [MeetSpace-0.1.3-beta-linux-x86_64-test.rpm](linux/0.1.3-beta/RPM/MeetSpace-0.1.3-beta-linux-x86_64-test.rpm) |
| Windows | 0.1.0-beta | NSIS / arm64 | [MeetSpace-0.1.0-beta-win-arm64-test-setup.exe](windows/0.1.0-beta/MeetSpace-0.1.0-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.0-beta | NSIS / x64 | [MeetSpace-0.1.0-beta-win-x64-test-setup.exe](windows/0.1.0-beta/MeetSpace-0.1.0-beta-win-x64-test-setup.exe) |
| Windows | 0.1.1-beta | NSIS / arm64 | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.1-beta | NSIS / x64 | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows | 0.1.2-beta | NSIS / arm64 | [MeetSpace-0.1.2-beta-win-arm64-test-setup.exe](windows/0.1.2-beta/MeetSpace-0.1.2-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.2-beta | NSIS / x64 | [MeetSpace-0.1.2-beta-win-x64-test-setup.exe](windows/0.1.2-beta/MeetSpace-0.1.2-beta-win-x64-test-setup.exe) |
| Windows | 0.1.3-beta | NSIS / arm64 | [MeetSpace-0.1.3-beta-win-arm64-test-setup.exe](windows/0.1.3-beta/MeetSpace-0.1.3-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.3-beta | NSIS / x64 | [MeetSpace-0.1.3-beta-win-x64-test-setup.exe](windows/0.1.3-beta/MeetSpace-0.1.3-beta-win-x64-test-setup.exe) |

## Область проверки

Пакеты тестовые, без цифровой подписи приложения; автоматическое обновление отключено. Встроенный SSH-установщик отдельно подписан доверенным ключом. Windows x64/ARM64 прошли проверку встроенного NSIS/PE/ASAR payload. Linux-пакеты прошли проверку метаданных, ELF/GLIBC, ASAR, install hooks и контрольных сумм. Для всех восьми пакетов повторно проверены SHA-256, размеры, успешные отчёты сборок и совпадение 440 входных файлов с commit исходников. Каталог дополнительно проверяет неизменность всех 26 исторических пакетов и их файлов сопровождения.

Текущий SSH-установщик прошёл 59 Node-тестов; runner seam включает 17 Python-регрессий готовых образов и UTC. Настоящие публичные планы amd64/ARM64 успешно проверены Python→TypeScript при запрещённых изменениях тестового хоста. В Electron проверены 17 сценариев и 37 записей раскладки, сделан 31 снимок: оба режима, восстановление, две темы, окна 1280×800, 1366×768 и 800×900, текст 150%. Данные проверки описаны в [SSH_INSTALLER_REFERENCE.md](../docs/desktop/SSH_INSTALLER_REFERENCE.md).

Эти проверки не являются полной приёмкой на каждой ОС, установкой готового выпуска на пользовательский сервер или проверкой реальных SFU/SMTP.

Скрипты сборки создают рабочие результаты в `desktop/artifacts/`; готовые дистрибутивы размещаются по структуре `source/linux/<версия>/<формат>/<пакет>` и `source/windows/<версия>/<пакет>`.
