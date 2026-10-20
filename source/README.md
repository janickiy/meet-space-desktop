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

## Все сохранённые сборки

Перенесены все **30 разных пакетов**: 18 Windows и 12 Linux. Версии Windows: `0.1.0-beta` и `0.1.1-beta`; Linux: `0.1.1-beta`. Идентичные копии прежних путей объединены. Разные сборки одной версии сохранены: у прежних файлов к имени добавлен `-build-<короткий хеш исходников>`. Последние сборки используют обычное имя файла.

Контрольные суммы — в [SHA256SUMS](SHA256SUMS); запускать проверку нужно из каталога `source/`. [catalog.json](catalog.json) содержит все пакеты, контрольные суммы и соответствие старых и новых путей. Рядом с каждым пакетом сохранены исходные отчёты и контрольные суммы; в исторических отчётах могут остаться первоначальные имена файлов и пути сборки. Содержимое самих установщиков не изменено.

| ОС | Версия | Формат / архитектура | Хеш исходников | Пакет |
|---|---|---|---|---|
| Linux | 0.1.1-beta | AppImage / arm64 | `b57b2a30bccc` | [MeetSpace-0.1.1-beta-linux-arm64-test-build-b57b2a30bccc.AppImage](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-arm64-test-build-b57b2a30bccc.AppImage) |
| Linux | 0.1.1-beta | AppImage / arm64 | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-arm64-test.AppImage](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.1-beta | AppImage / x64 | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-x86_64-test-build-441cb9713c16.AppImage](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-x86_64-test-build-441cb9713c16.AppImage) |
| Linux | 0.1.1-beta | AppImage / x64 | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.1-beta | DEB / x64 | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-amd64-test-build-441cb9713c16.deb](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-amd64-test-build-441cb9713c16.deb) |
| Linux | 0.1.1-beta | DEB / x64 | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-amd64-test.deb](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-amd64-test.deb) |
| Linux | 0.1.1-beta | DEB / arm64 | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-arm64-test-build-441cb9713c16.deb](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-arm64-test-build-441cb9713c16.deb) |
| Linux | 0.1.1-beta | DEB / arm64 | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-arm64-test.deb](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-arm64-test.deb) |
| Linux | 0.1.1-beta | RPM / arm64 | `7a239414f69c` | [MeetSpace-0.1.1-beta-linux-aarch64-test-build-7a239414f69c.rpm](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-aarch64-test-build-7a239414f69c.rpm) |
| Linux | 0.1.1-beta | RPM / arm64 | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-aarch64-test.rpm](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.1-beta | RPM / x64 | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-x86_64-test-build-441cb9713c16.rpm](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-x86_64-test-build-441cb9713c16.rpm) |
| Linux | 0.1.1-beta | RPM / x64 | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-x86_64-test.rpm](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-x86_64-test.rpm) |
| Windows | 0.1.0-beta | NSIS / arm64 | `a129a27dbb01` | [MeetSpace-0.1.0-beta-win-arm64-test-setup.exe](windows/0.1.0-beta/MeetSpace-0.1.0-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.0-beta | NSIS / x64 | `a129a27dbb01` | [MeetSpace-0.1.0-beta-win-x64-test-setup.exe](windows/0.1.0-beta/MeetSpace-0.1.0-beta-win-x64-test-setup.exe) |
| Windows | 0.1.1-beta | NSIS / arm64 | `2837a51157fb` | [MeetSpace-0.1.1-beta-win-arm64-test-setup-build-2837a51157fb.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup-build-2837a51157fb.exe) |
| Windows | 0.1.1-beta | NSIS / arm64 | `2acaaf33c90c` | [MeetSpace-0.1.1-beta-win-arm64-test-setup-build-2acaaf33c90c.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup-build-2acaaf33c90c.exe) |
| Windows | 0.1.1-beta | NSIS / arm64 | `441cb9713c16` | [MeetSpace-0.1.1-beta-win-arm64-test-setup-build-441cb9713c16.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup-build-441cb9713c16.exe) |
| Windows | 0.1.1-beta | NSIS / arm64 | `5ac958650ac2` | [MeetSpace-0.1.1-beta-win-arm64-test-setup-build-5ac958650ac2.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup-build-5ac958650ac2.exe) |
| Windows | 0.1.1-beta | NSIS / arm64 | `97f478eea481` | [MeetSpace-0.1.1-beta-win-arm64-test-setup-build-97f478eea481.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup-build-97f478eea481.exe) |
| Windows | 0.1.1-beta | NSIS / arm64 | `db0f4234207e` | [MeetSpace-0.1.1-beta-win-arm64-test-setup-build-db0f4234207e.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup-build-db0f4234207e.exe) |
| Windows | 0.1.1-beta | NSIS / arm64 | `e963d672cf94` | [MeetSpace-0.1.1-beta-win-arm64-test-setup-build-e963d672cf94.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup-build-e963d672cf94.exe) |
| Windows | 0.1.1-beta | NSIS / arm64 | `e9c984f570a4` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.1-beta | NSIS / x64 | `2837a51157fb` | [MeetSpace-0.1.1-beta-win-x64-test-setup-build-2837a51157fb.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup-build-2837a51157fb.exe) |
| Windows | 0.1.1-beta | NSIS / x64 | `2acaaf33c90c` | [MeetSpace-0.1.1-beta-win-x64-test-setup-build-2acaaf33c90c.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup-build-2acaaf33c90c.exe) |
| Windows | 0.1.1-beta | NSIS / x64 | `441cb9713c16` | [MeetSpace-0.1.1-beta-win-x64-test-setup-build-441cb9713c16.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup-build-441cb9713c16.exe) |
| Windows | 0.1.1-beta | NSIS / x64 | `5ac958650ac2` | [MeetSpace-0.1.1-beta-win-x64-test-setup-build-5ac958650ac2.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup-build-5ac958650ac2.exe) |
| Windows | 0.1.1-beta | NSIS / x64 | `97f478eea481` | [MeetSpace-0.1.1-beta-win-x64-test-setup-build-97f478eea481.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup-build-97f478eea481.exe) |
| Windows | 0.1.1-beta | NSIS / x64 | `db0f4234207e` | [MeetSpace-0.1.1-beta-win-x64-test-setup-build-db0f4234207e.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup-build-db0f4234207e.exe) |
| Windows | 0.1.1-beta | NSIS / x64 | `e963d672cf94` | [MeetSpace-0.1.1-beta-win-x64-test-setup-build-e963d672cf94.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup-build-e963d672cf94.exe) |
| Windows | 0.1.1-beta | NSIS / x64 | `e9c984f570a4` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |

## Область проверки

Пакеты тестовые, без цифровой подписи; автоматическое обновление отключено. Windows-пакеты последней сборки проверены по фактическому NSIS payload, PE/DLL-архитектурам и ASAR. Все Linux-пакеты последней сборки прошли статическую проверку метаданных, ELF/GLIBC, ASAR, сценариев установки и контрольных сумм. ARM64 AppImage дополнительно запускалась в изолированной Ubuntu UTM с песочницей renderer. Linux x64 собран в контейнере amd64 на Mac ARM64. Это не полная повторная приёмка на всех целевых ОС. Исторические пакеты сохраняют область проверки, указанную в их исходных отчётах.

Скрипты сборки создают рабочие результаты в `desktop/artifacts/`; в репозитории готовые дистрибутивы размещаются по структуре `source/linux/<версия>/<формат>/<пакет>` и `source/windows/<версия>/<пакет>`.
