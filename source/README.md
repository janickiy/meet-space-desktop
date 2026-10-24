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

Сборки от 24 октября 2026 года включают интерфейс по предоставленному макету для Windows и Linux, компактную панель конференции и двухшаговое окно приглашения со ссылкой, локальным QR-кодом и настоящей отправкой через сервер. В этой пересборке исправлена повторная проверка защищённого хранилища после разблокировки системной связки ключей. Успешная установка сервера теперь отображается отдельно от локальной ошибки хранилища; подключение можно продолжить без перезапуска и повторной установки. Завершающий экран и шаги мастера установки приведены к макету. Сохранено удаление двух подписей под QR-кодом; сам QR-код и ссылка сохранены. Сохранены исправления копирования в Electron, вставки списка email, блокировки формы при отправке и мастера установки по SSH, а также поддержка архивов и документов.

Исходники: [`dff6765b05f2`](https://github.com/janickiy/meet-space-desktop/commit/dff6765b05f252be83db65b1947b36d8efcc9c96). Полный SHA-256 433 входных файлов: `826ac2e7f34f6ef027139e8a00e7deb69ffaf071f283a6973f4e66e108f124ed`. Все восемь пакетов собраны из одинаковых входных файлов, соответствующих этому commit. Windows- и Linux-отчёты сохраняют `sourceDirty: false`; список и байты всех 433 входных файлов дополнительно сверены с указанным commit.

[Изменения и проверки предыдущего выпуска интерфейса](../docs/desktop/2026-10-24_INTERFACE.md), [SSH-установщик](../docs/desktop/SSH_INSTALLER_REFERENCE.md).

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

Пакеты тестовые, без цифровой подписи приложения; автоматическое обновление отключено. Встроенный SSH-установщик отдельно подписан доверенным ключом. Windows x64/ARM64 прошли проверку встроенного NSIS/PE/ASAR payload; запуск текущего выпуска в Windows отдельно не проверялся. Linux ARM64 собран в Ubuntu 24.04 UTM, Linux x64 — в Ubuntu 22.04 amd64-контейнере с эмуляцией на Mac ARM64. Все Linux-пакеты проверены статически: метаданные, ELF/GLIBC, ASAR, install hooks и контрольные суммы. Для всех восьми текущих пакетов повторно проверены SHA-256, размеры, успешные отчёты проверки и совпадение 433 входных файлов с commit исходников.

Текущие изменения прошли 66 проверок брокера, безопасности и платформы, сборку и проверку типов renderer, а также проверку настоящим Electron на macOS: 13 сценариев SSH-мастера, 23 снимка и 3 проверки раскладки с увеличенным до 150% текстом. Проверены обе темы, окна 800/1280/1440 и переход от недоступного хранилища к успешной повторной проверке. Предыдущий выпуск конференции и приглашений проходил отдельную проверку; эти результаты не выдаются за повторную полную приёмку всех ОС или реальных SFU/SMTP.

Скрипты сборки создают рабочие результаты в `desktop/artifacts/`; в репозитории готовые дистрибутивы размещаются по структуре `source/linux/<версия>/<формат>/<пакет>` и `source/windows/<версия>/<пакет>`.
