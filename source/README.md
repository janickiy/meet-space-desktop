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

Сборки от 22 октября 2026 года добавляют необязательную настройку SMTP в мастере установки сервера по SSH. По умолчанию почта выключена: можно установить приложение без SMTP и подключить почту позже через файл на сервере. Без SMTP приглашения и напоминания по email не отправляются. Пароль передаётся только при запуске установки и не входит в локальную карточку восстановления.

Общий подписанный Android/Desktop установщик использует кэши Go/npm и проверяет уже готовые образы перед продолжением, не собирая их повторно. Подписанный рецепт закрепляет backend commit `a7d037ea9c228590bcd482d5eba410318029c4dd` с поддержкой приглашений и напоминания за три часа. Первая холодная установка по-прежнему требует компиляции. Vite обновлён до 8.3.5; поддержка 75 расширений вложений сохранена.

Исходники: [`a6a5f9f1e80b`](https://github.com/janickiy/meet-space-desktop/commit/a6a5f9f1e80b367d5d01fd1abeafb0f910b6794c). Полный хеш входных файлов: `f4a494ba87b1189db74bb04e72b156b18608df25ca4b533a2bc74310d643affa`.

[Протокол, безопасность и позднее подключение SMTP](../docs/desktop/SSH_INSTALLER_REFERENCE.md).

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

Пакеты тестовые, без цифровой подписи самого приложения; автоматическое обновление отключено. Встроенный SSH-установщик отдельно подписан исходным доверенным RSA-ключом. Windows-пакеты последней сборки проверены по фактическому NSIS payload, PE/DLL-архитектурам, ASAR и SSH runtime. Все Linux-пакеты последней сборки прошли статическую проверку метаданных, ELF/GLIBC, ASAR, сценариев установки и контрольных сумм. Linux собран в изолированных контейнерах соответствующей архитектуры на Mac ARM64; x64 использует эмуляцию. Интерфейс мастера с SMTP проверен в настоящем Electron на macOS ARM64 с детерминированным транспортом. Установка новых пакетов и звонки на целевых Windows/Linux, а также доставка через реальный SMTP-провайдер отдельно не проверялись. Предыдущие пакеты сохраняют область проверки, указанную в их исходных отчётах.

Скрипты сборки создают рабочие результаты в `desktop/artifacts/`; в репозитории готовые дистрибутивы размещаются по структуре `source/linux/<версия>/<формат>/<пакет>` и `source/windows/<версия>/<пакет>`.
