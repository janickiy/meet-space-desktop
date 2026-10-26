# Дистрибутивы MeetSpace Desktop

Готовые пакеты Windows и Linux опубликованы через Git LFS. Linux: `source/linux/<версия>/<DEB|RPM|AppImage>/<пакет>`; Windows: `source/windows/<версия>/<пакет>`.

## Последние сборки 0.1.10 beta

Выпуск от 26 октября 2026 года включает обновлённую вёрстку чатов, встреч и библиотеки записей по макетам. Пакеты Windows и Linux используют одни и те же проверенные исходники интерфейса.

Все восемь пакетов собраны из одного чистого commit [f8088e773047](https://github.com/janickiy/meet-space-desktop/commit/f8088e77304771288ada94d9ebac2c1414a0af3c). SHA-256 460 входных файлов: `857f3e16a82f5b10597e15d8d84caf9265547ca7e008be379ff518b69dd7ee67`. Отчёты содержат `sourceDirty: false`; все входные файлы сверены с commit.

| Пакет | x64 | ARM64 |
|---|---|---|
| Windows — EXE | [x64](windows/0.1.10-beta/MeetSpace-0.1.10-beta-win-x64-test-setup.exe) | [ARM64](windows/0.1.10-beta/MeetSpace-0.1.10-beta-win-arm64-test-setup.exe) |
| Ubuntu/Debian — DEB | [x64](linux/0.1.10-beta/DEB/MeetSpace-0.1.10-beta-linux-amd64-test.deb) | [ARM64](linux/0.1.10-beta/DEB/MeetSpace-0.1.10-beta-linux-arm64-test.deb) |
| Fedora — RPM | [x64](linux/0.1.10-beta/RPM/MeetSpace-0.1.10-beta-linux-x86_64-test.rpm) | [ARM64](linux/0.1.10-beta/RPM/MeetSpace-0.1.10-beta-linux-aarch64-test.rpm) |
| Linux — AppImage | [x64](linux/0.1.10-beta/AppImage/MeetSpace-0.1.10-beta-linux-x86_64-test.AppImage) | [ARM64](linux/0.1.10-beta/AppImage/MeetSpace-0.1.10-beta-linux-arm64-test.AppImage) |

## Последние сборки каждой версии

В каталоге **66 пакетов**: восемь новых `0.1.10-beta` и 58 ранее опубликованных. Предыдущие версии и сопроводительные файлы сохранены без изменения байтов. Для каждой комбинации ОС, версии, формата и архитектуры хранится последняя опубликованная сборка.

Контрольные суммы — в [SHA256SUMS](SHA256SUMS), проверка запускается из `source/`. [catalog.json](catalog.json) содержит пакеты и метаданные их проверок.

| ОС | Версия | Формат / архитектура | Пакет |
|---|---|---|---|
| Linux | 0.1.1-beta | AppImage / arm64 | [MeetSpace-0.1.1-beta-linux-arm64-test.AppImage](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.1-beta | AppImage / x64 | [MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage](linux/0.1.1-beta/AppImage/MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.1-beta | DEB / arm64 | [MeetSpace-0.1.1-beta-linux-arm64-test.deb](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-arm64-test.deb) |
| Linux | 0.1.1-beta | DEB / x64 | [MeetSpace-0.1.1-beta-linux-amd64-test.deb](linux/0.1.1-beta/DEB/MeetSpace-0.1.1-beta-linux-amd64-test.deb) |
| Linux | 0.1.1-beta | RPM / arm64 | [MeetSpace-0.1.1-beta-linux-aarch64-test.rpm](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.1-beta | RPM / x64 | [MeetSpace-0.1.1-beta-linux-x86_64-test.rpm](linux/0.1.1-beta/RPM/MeetSpace-0.1.1-beta-linux-x86_64-test.rpm) |
| Linux | 0.1.2-beta | AppImage / arm64 | [MeetSpace-0.1.2-beta-linux-arm64-test.AppImage](linux/0.1.2-beta/AppImage/MeetSpace-0.1.2-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.2-beta | AppImage / x64 | [MeetSpace-0.1.2-beta-linux-x86_64-test.AppImage](linux/0.1.2-beta/AppImage/MeetSpace-0.1.2-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.2-beta | DEB / arm64 | [MeetSpace-0.1.2-beta-linux-arm64-test.deb](linux/0.1.2-beta/DEB/MeetSpace-0.1.2-beta-linux-arm64-test.deb) |
| Linux | 0.1.2-beta | DEB / x64 | [MeetSpace-0.1.2-beta-linux-amd64-test.deb](linux/0.1.2-beta/DEB/MeetSpace-0.1.2-beta-linux-amd64-test.deb) |
| Linux | 0.1.2-beta | RPM / arm64 | [MeetSpace-0.1.2-beta-linux-aarch64-test.rpm](linux/0.1.2-beta/RPM/MeetSpace-0.1.2-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.2-beta | RPM / x64 | [MeetSpace-0.1.2-beta-linux-x86_64-test.rpm](linux/0.1.2-beta/RPM/MeetSpace-0.1.2-beta-linux-x86_64-test.rpm) |
| Linux | 0.1.3-beta | AppImage / arm64 | [MeetSpace-0.1.3-beta-linux-arm64-test.AppImage](linux/0.1.3-beta/AppImage/MeetSpace-0.1.3-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.3-beta | AppImage / x64 | [MeetSpace-0.1.3-beta-linux-x86_64-test.AppImage](linux/0.1.3-beta/AppImage/MeetSpace-0.1.3-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.3-beta | DEB / arm64 | [MeetSpace-0.1.3-beta-linux-arm64-test.deb](linux/0.1.3-beta/DEB/MeetSpace-0.1.3-beta-linux-arm64-test.deb) |
| Linux | 0.1.3-beta | DEB / x64 | [MeetSpace-0.1.3-beta-linux-amd64-test.deb](linux/0.1.3-beta/DEB/MeetSpace-0.1.3-beta-linux-amd64-test.deb) |
| Linux | 0.1.3-beta | RPM / arm64 | [MeetSpace-0.1.3-beta-linux-aarch64-test.rpm](linux/0.1.3-beta/RPM/MeetSpace-0.1.3-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.3-beta | RPM / x64 | [MeetSpace-0.1.3-beta-linux-x86_64-test.rpm](linux/0.1.3-beta/RPM/MeetSpace-0.1.3-beta-linux-x86_64-test.rpm) |
| Linux | 0.1.4-beta | AppImage / arm64 | [MeetSpace-0.1.4-beta-linux-arm64-test.AppImage](linux/0.1.4-beta/AppImage/MeetSpace-0.1.4-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.4-beta | AppImage / x64 | [MeetSpace-0.1.4-beta-linux-x86_64-test.AppImage](linux/0.1.4-beta/AppImage/MeetSpace-0.1.4-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.4-beta | DEB / arm64 | [MeetSpace-0.1.4-beta-linux-arm64-test.deb](linux/0.1.4-beta/DEB/MeetSpace-0.1.4-beta-linux-arm64-test.deb) |
| Linux | 0.1.4-beta | DEB / x64 | [MeetSpace-0.1.4-beta-linux-amd64-test.deb](linux/0.1.4-beta/DEB/MeetSpace-0.1.4-beta-linux-amd64-test.deb) |
| Linux | 0.1.4-beta | RPM / arm64 | [MeetSpace-0.1.4-beta-linux-aarch64-test.rpm](linux/0.1.4-beta/RPM/MeetSpace-0.1.4-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.4-beta | RPM / x64 | [MeetSpace-0.1.4-beta-linux-x86_64-test.rpm](linux/0.1.4-beta/RPM/MeetSpace-0.1.4-beta-linux-x86_64-test.rpm) |
| Linux | 0.1.5-beta | AppImage / arm64 | [MeetSpace-0.1.5-beta-linux-arm64-test.AppImage](linux/0.1.5-beta/AppImage/MeetSpace-0.1.5-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.5-beta | AppImage / x64 | [MeetSpace-0.1.5-beta-linux-x86_64-test.AppImage](linux/0.1.5-beta/AppImage/MeetSpace-0.1.5-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.5-beta | DEB / arm64 | [MeetSpace-0.1.5-beta-linux-arm64-test.deb](linux/0.1.5-beta/DEB/MeetSpace-0.1.5-beta-linux-arm64-test.deb) |
| Linux | 0.1.5-beta | DEB / x64 | [MeetSpace-0.1.5-beta-linux-amd64-test.deb](linux/0.1.5-beta/DEB/MeetSpace-0.1.5-beta-linux-amd64-test.deb) |
| Linux | 0.1.5-beta | RPM / arm64 | [MeetSpace-0.1.5-beta-linux-aarch64-test.rpm](linux/0.1.5-beta/RPM/MeetSpace-0.1.5-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.5-beta | RPM / x64 | [MeetSpace-0.1.5-beta-linux-x86_64-test.rpm](linux/0.1.5-beta/RPM/MeetSpace-0.1.5-beta-linux-x86_64-test.rpm) |
| Linux | 0.1.6-beta | AppImage / arm64 | [MeetSpace-0.1.6-beta-linux-arm64-test.AppImage](linux/0.1.6-beta/AppImage/MeetSpace-0.1.6-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.6-beta | AppImage / x64 | [MeetSpace-0.1.6-beta-linux-x86_64-test.AppImage](linux/0.1.6-beta/AppImage/MeetSpace-0.1.6-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.6-beta | DEB / arm64 | [MeetSpace-0.1.6-beta-linux-arm64-test.deb](linux/0.1.6-beta/DEB/MeetSpace-0.1.6-beta-linux-arm64-test.deb) |
| Linux | 0.1.6-beta | DEB / x64 | [MeetSpace-0.1.6-beta-linux-amd64-test.deb](linux/0.1.6-beta/DEB/MeetSpace-0.1.6-beta-linux-amd64-test.deb) |
| Linux | 0.1.6-beta | RPM / arm64 | [MeetSpace-0.1.6-beta-linux-aarch64-test.rpm](linux/0.1.6-beta/RPM/MeetSpace-0.1.6-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.6-beta | RPM / x64 | [MeetSpace-0.1.6-beta-linux-x86_64-test.rpm](linux/0.1.6-beta/RPM/MeetSpace-0.1.6-beta-linux-x86_64-test.rpm) |
| Linux | 0.1.9-beta | AppImage / arm64 | [MeetSpace-0.1.9-beta-linux-arm64-test.AppImage](linux/0.1.9-beta/AppImage/MeetSpace-0.1.9-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.9-beta | AppImage / x64 | [MeetSpace-0.1.9-beta-linux-x86_64-test.AppImage](linux/0.1.9-beta/AppImage/MeetSpace-0.1.9-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.9-beta | DEB / arm64 | [MeetSpace-0.1.9-beta-linux-arm64-test.deb](linux/0.1.9-beta/DEB/MeetSpace-0.1.9-beta-linux-arm64-test.deb) |
| Linux | 0.1.9-beta | DEB / x64 | [MeetSpace-0.1.9-beta-linux-amd64-test.deb](linux/0.1.9-beta/DEB/MeetSpace-0.1.9-beta-linux-amd64-test.deb) |
| Linux | 0.1.9-beta | RPM / arm64 | [MeetSpace-0.1.9-beta-linux-aarch64-test.rpm](linux/0.1.9-beta/RPM/MeetSpace-0.1.9-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.9-beta | RPM / x64 | [MeetSpace-0.1.9-beta-linux-x86_64-test.rpm](linux/0.1.9-beta/RPM/MeetSpace-0.1.9-beta-linux-x86_64-test.rpm) |
| Linux | 0.1.10-beta | AppImage / arm64 | [MeetSpace-0.1.10-beta-linux-arm64-test.AppImage](linux/0.1.10-beta/AppImage/MeetSpace-0.1.10-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.10-beta | AppImage / x64 | [MeetSpace-0.1.10-beta-linux-x86_64-test.AppImage](linux/0.1.10-beta/AppImage/MeetSpace-0.1.10-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.10-beta | DEB / arm64 | [MeetSpace-0.1.10-beta-linux-arm64-test.deb](linux/0.1.10-beta/DEB/MeetSpace-0.1.10-beta-linux-arm64-test.deb) |
| Linux | 0.1.10-beta | DEB / x64 | [MeetSpace-0.1.10-beta-linux-amd64-test.deb](linux/0.1.10-beta/DEB/MeetSpace-0.1.10-beta-linux-amd64-test.deb) |
| Linux | 0.1.10-beta | RPM / arm64 | [MeetSpace-0.1.10-beta-linux-aarch64-test.rpm](linux/0.1.10-beta/RPM/MeetSpace-0.1.10-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.10-beta | RPM / x64 | [MeetSpace-0.1.10-beta-linux-x86_64-test.rpm](linux/0.1.10-beta/RPM/MeetSpace-0.1.10-beta-linux-x86_64-test.rpm) |
| Windows | 0.1.0-beta | NSIS / arm64 | [MeetSpace-0.1.0-beta-win-arm64-test-setup.exe](windows/0.1.0-beta/MeetSpace-0.1.0-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.0-beta | NSIS / x64 | [MeetSpace-0.1.0-beta-win-x64-test-setup.exe](windows/0.1.0-beta/MeetSpace-0.1.0-beta-win-x64-test-setup.exe) |
| Windows | 0.1.1-beta | NSIS / arm64 | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.1-beta | NSIS / x64 | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](windows/0.1.1-beta/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows | 0.1.2-beta | NSIS / arm64 | [MeetSpace-0.1.2-beta-win-arm64-test-setup.exe](windows/0.1.2-beta/MeetSpace-0.1.2-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.2-beta | NSIS / x64 | [MeetSpace-0.1.2-beta-win-x64-test-setup.exe](windows/0.1.2-beta/MeetSpace-0.1.2-beta-win-x64-test-setup.exe) |
| Windows | 0.1.3-beta | NSIS / arm64 | [MeetSpace-0.1.3-beta-win-arm64-test-setup.exe](windows/0.1.3-beta/MeetSpace-0.1.3-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.3-beta | NSIS / x64 | [MeetSpace-0.1.3-beta-win-x64-test-setup.exe](windows/0.1.3-beta/MeetSpace-0.1.3-beta-win-x64-test-setup.exe) |
| Windows | 0.1.4-beta | NSIS / arm64 | [MeetSpace-0.1.4-beta-win-arm64-test-setup.exe](windows/0.1.4-beta/MeetSpace-0.1.4-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.4-beta | NSIS / x64 | [MeetSpace-0.1.4-beta-win-x64-test-setup.exe](windows/0.1.4-beta/MeetSpace-0.1.4-beta-win-x64-test-setup.exe) |
| Windows | 0.1.5-beta | NSIS / arm64 | [MeetSpace-0.1.5-beta-win-arm64-test-setup.exe](windows/0.1.5-beta/MeetSpace-0.1.5-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.5-beta | NSIS / x64 | [MeetSpace-0.1.5-beta-win-x64-test-setup.exe](windows/0.1.5-beta/MeetSpace-0.1.5-beta-win-x64-test-setup.exe) |
| Windows | 0.1.6-beta | NSIS / arm64 | [MeetSpace-0.1.6-beta-win-arm64-test-setup.exe](windows/0.1.6-beta/MeetSpace-0.1.6-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.6-beta | NSIS / x64 | [MeetSpace-0.1.6-beta-win-x64-test-setup.exe](windows/0.1.6-beta/MeetSpace-0.1.6-beta-win-x64-test-setup.exe) |
| Windows | 0.1.9-beta | NSIS / arm64 | [MeetSpace-0.1.9-beta-win-arm64-test-setup.exe](windows/0.1.9-beta/MeetSpace-0.1.9-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.9-beta | NSIS / x64 | [MeetSpace-0.1.9-beta-win-x64-test-setup.exe](windows/0.1.9-beta/MeetSpace-0.1.9-beta-win-x64-test-setup.exe) |
| Windows | 0.1.10-beta | NSIS / arm64 | [MeetSpace-0.1.10-beta-win-arm64-test-setup.exe](windows/0.1.10-beta/MeetSpace-0.1.10-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.10-beta | NSIS / x64 | [MeetSpace-0.1.10-beta-win-x64-test-setup.exe](windows/0.1.10-beta/MeetSpace-0.1.10-beta-win-x64-test-setup.exe) |

## Область проверки

Пакеты тестовые, без цифровой подписи приложения; автоматическое обновление отключено. Встроенный SSH-установщик отдельно подписан доверенным ключом. Установщики Windows x64/ARM64 прошли статические проверки встроенного NSIS/PE/ASAR payload. Для Linux проверены метаданные, ELF/GLIBC, ASAR, install hooks и контрольные суммы. Эти проверки содержимого не подтверждают нативный запуск каждой ОС.

Успешно пройдены 28 модульных проверок и проверок безопасности. Подготовлены 132 снимка общего интерфейса на локальных тестовых данных. Проверки общего интерфейса не являются нативной приёмкой установщиков. Нативная проверка выполнена только на Ubuntu ARM64 в UTM после установки этого выпуска. Нативный запуск Windows, другие Linux-дистрибутивы, реальные SFU/SMTP и рабочие звонки в этом выпуске не подтверждены этими проверками.

Рабочие результаты сборки остаются в `desktop/artifacts/`; в `source/` размещены только проверенные пакеты, отчёты и контрольные суммы.
