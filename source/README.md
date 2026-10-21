# Дистрибутивы MeetSpace Desktop

Готовые пакеты Windows и Linux хранятся в `source/` и опубликованы через Git LFS.

```text
source/
├── linux/
│   └── 0.1.1-beta/
│       ├── DEB/
│       ├── RPM/
│       └── AppImage/
└── windows/
    ├── 0.1.0-beta/
    └── 0.1.1-beta/
```

DEB — Ubuntu/Debian, RPM — Fedora и совместимые системы, AppImage — переносимый Linux-пакет. В каждом формате есть x64 и ARM64; архитектура указана в имени файла. Windows-пакеты лежат непосредственно в папке версии.

## Последние сборки 0.1.1 beta

Сборки от 20 октября 2026 года поддерживают архивы и документы: 75 расширений, до 5 вложений в сообщении, до 10 МБ на файл. Сервер должен поддерживать соответствующие типы вложений.

Исходники: [`4d8d86631198`](https://github.com/janickiy/meet-space-desktop/commit/4d8d86631198b9ac2fb1a474347273a01c021c80). Полный хеш входных файлов: `e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4`.

| Пакет | x64 | ARM64 |
|---|---|---|
| Windows — EXE | [x64](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) | [ARM64](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Ubuntu/Debian — DEB | [x64](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-amd64-test.deb) | [ARM64](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-arm64-test.deb) |
| Fedora — RPM | [x64](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-x86_64-test.rpm) | [ARM64](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-aarch64-test.rpm) |
| Linux — AppImage | [x64](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage) | [ARM64](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-arm64-test.AppImage) |

## Последние сборки каждой версии

В каталоге оставлены **10 пакетов**: Windows `0.1.0-beta` и `0.1.1-beta` для x64 и ARM64; Linux `0.1.1-beta` — DEB, RPM и AppImage для x64 и ARM64. Для каждой комбинации ОС, версии, формата и архитектуры хранится только последняя сборка. Старые пакеты с хешами в именах и сопровождающие их файлы удалены.

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

Пакеты тестовые, без цифровой подписи; автоматическое обновление отключено. Windows-пакеты последней сборки проверены по фактическому NSIS payload, PE/DLL-архитектурам и ASAR. Все Linux-пакеты последней сборки прошли статическую проверку метаданных, ELF/GLIBC, ASAR, сценариев установки и контрольных сумм. ARM64 AppImage дополнительно запускалась в изолированной Ubuntu UTM с песочницей renderer. Linux x64 собран в контейнере amd64 на Mac ARM64. Это не полная повторная приёмка на всех целевых ОС. Пакеты Windows `0.1.0-beta` сохраняют область проверки, указанную в их исходных отчётах.

Скрипты сборки создают рабочие результаты в `desktop/artifacts/`; в репозитории готовые дистрибутивы размещаются по структуре `source/linux/<версия>/<формат>/<пакет>` и `source/windows/<версия>/<пакет>`.
