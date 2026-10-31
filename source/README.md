# Дистрибутивы MeetSpace Desktop

Пакеты опубликованы через Git LFS: `source/windows/<версия>/`, `source/linux/<версия>/<DEB|RPM|AppImage>/`, `source/macos/<версия>/`.

## Последние сборки Windows/Linux 0.3.0 beta

Настройки аудио, видео и уведомлений приведены к макету. Добавлены отдельные уровни громкости микрофона, динамиков и сигналов. [Изменения и проверки](../docs/releases/0.3.0-beta.md).

Все восемь пакетов Windows/Linux собраны из чистого снимка исходников [470291bd86f715d02fac81f92de4ff374abf89b2](https://github.com/janickiy/meet-space-desktop/commit/470291bd86f715d02fac81f92de4ff374abf89b2). SHA-256 533 входных файлов: `ccb6739fe7a6a9ad548a2ba938b17895431128e3bbdb8ca6272f0229a93b4c5d`.

| Пакет | x64 | ARM64 |
|---|---|---|
| Windows — EXE | [x64](windows/0.3.0-beta/MeetSpace-0.3.0-beta-win-x64-test-setup.exe) | [ARM64](windows/0.3.0-beta/MeetSpace-0.3.0-beta-win-arm64-test-setup.exe) |
| Ubuntu/Debian — DEB | [x64](linux/0.3.0-beta/DEB/MeetSpace-0.3.0-beta-linux-amd64-test.deb) | [ARM64](linux/0.3.0-beta/DEB/MeetSpace-0.3.0-beta-linux-arm64-test.deb) |
| Fedora — RPM | [x64](linux/0.3.0-beta/RPM/MeetSpace-0.3.0-beta-linux-x86_64-test.rpm) | [ARM64](linux/0.3.0-beta/RPM/MeetSpace-0.3.0-beta-linux-aarch64-test.rpm) |
| Linux — AppImage | [x64](linux/0.3.0-beta/AppImage/MeetSpace-0.3.0-beta-linux-x86_64-test.AppImage) | [ARM64](linux/0.3.0-beta/AppImage/MeetSpace-0.3.0-beta-linux-arm64-test.AppImage) |

Пакеты тестовые, без цифровой подписи. DMG не нотариализованы Apple; Gatekeeper может блокировать запуск. Автообновление выключено.

## Последние сборки каждой версии

В каталоге **124 пакета**: восемь новых Windows/Linux `0.3.0-beta` и 116 ранее опубликованных. macOS остаётся на `0.2.3-beta`. Контрольные суммы — в [SHA256SUMS](SHA256SUMS), проверка запускается из `source/`. [catalog.json](catalog.json) содержит пакеты и результаты проверок.

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
| Linux | 0.1.12-beta | AppImage / arm64 | [MeetSpace-0.1.12-beta-linux-arm64-test.AppImage](linux/0.1.12-beta/AppImage/MeetSpace-0.1.12-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.12-beta | AppImage / x64 | [MeetSpace-0.1.12-beta-linux-x86_64-test.AppImage](linux/0.1.12-beta/AppImage/MeetSpace-0.1.12-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.12-beta | DEB / arm64 | [MeetSpace-0.1.12-beta-linux-arm64-test.deb](linux/0.1.12-beta/DEB/MeetSpace-0.1.12-beta-linux-arm64-test.deb) |
| Linux | 0.1.12-beta | DEB / x64 | [MeetSpace-0.1.12-beta-linux-amd64-test.deb](linux/0.1.12-beta/DEB/MeetSpace-0.1.12-beta-linux-amd64-test.deb) |
| Linux | 0.1.12-beta | RPM / arm64 | [MeetSpace-0.1.12-beta-linux-aarch64-test.rpm](linux/0.1.12-beta/RPM/MeetSpace-0.1.12-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.12-beta | RPM / x64 | [MeetSpace-0.1.12-beta-linux-x86_64-test.rpm](linux/0.1.12-beta/RPM/MeetSpace-0.1.12-beta-linux-x86_64-test.rpm) |
| Windows | 0.1.12-beta | NSIS / arm64 | [MeetSpace-0.1.12-beta-win-arm64-test-setup.exe](windows/0.1.12-beta/MeetSpace-0.1.12-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.12-beta | NSIS / x64 | [MeetSpace-0.1.12-beta-win-x64-test-setup.exe](windows/0.1.12-beta/MeetSpace-0.1.12-beta-win-x64-test-setup.exe) |

## Область проверки

Пакеты тестовые, без цифровой подписи приложения; автоматическое обновление отключено. Встроенный SSH-установщик отдельно подписан доверенным ключом. Для Windows x64/ARM64 проверены NSIS/PE/ASAR, архитектура и контрольные суммы. Для Linux проверены метаданные DEB/RPM/AppImage, ELF/GLIBC, ASAR, install hooks и контрольные суммы. Linux ARM64 собирается нативно в Ubuntu UTM, x64 — в контейнере через Rosetta; это не приёмка всех дистрибутивов.

[Аудит общего кода](../docs/desktop-audit/DESKTOP_TEST_REPORT.md): 329 модульных проверок пройдены, 0 ошибок, 1 платформенный пропуск. Проверены основные сценарии приложения и повторяющиеся циклы работы. Полная матрица ОС, оборудования, подписи и обновлений не завершена. Остаточные upstream advisories встроенных компонентов Electron перечислены в отчёте; этот beta-выпуск не означает производственную готовность.

Ubuntu 24.04 ARM64 в UTM обновлена до 0.1.12-beta: подтверждены версия работающего приложения, происхождение сборки, сохранение профиля и закрепление ярлыка. Windows 11 ARM64 в UTM также обновлена: установщик завершился успешно, установлена версия 0.1.12-beta в пользовательский каталог, подтверждены ARM64 PE и совпадение ASAR с опубликованным пакетом; приложение запущено в обычной пользовательской сессии. Это не заменяет полную проверку всех ОС.

Рабочие результаты сборки остаются в `desktop/artifacts/`; в `source/` размещены проверенные пакеты, отчёты и контрольные суммы. Предыдущие опубликованные пакеты сохранены.
| Linux | 0.1.14-beta | AppImage / arm64 | [MeetSpace-0.1.14-beta-linux-arm64-test.AppImage](linux/0.1.14-beta/AppImage/MeetSpace-0.1.14-beta-linux-arm64-test.AppImage) |
| Linux | 0.1.14-beta | AppImage / x64 | [MeetSpace-0.1.14-beta-linux-x86_64-test.AppImage](linux/0.1.14-beta/AppImage/MeetSpace-0.1.14-beta-linux-x86_64-test.AppImage) |
| Linux | 0.1.14-beta | DEB / arm64 | [MeetSpace-0.1.14-beta-linux-arm64-test.deb](linux/0.1.14-beta/DEB/MeetSpace-0.1.14-beta-linux-arm64-test.deb) |
| Linux | 0.1.14-beta | DEB / x64 | [MeetSpace-0.1.14-beta-linux-amd64-test.deb](linux/0.1.14-beta/DEB/MeetSpace-0.1.14-beta-linux-amd64-test.deb) |
| Linux | 0.1.14-beta | RPM / arm64 | [MeetSpace-0.1.14-beta-linux-aarch64-test.rpm](linux/0.1.14-beta/RPM/MeetSpace-0.1.14-beta-linux-aarch64-test.rpm) |
| Linux | 0.1.14-beta | RPM / x64 | [MeetSpace-0.1.14-beta-linux-x86_64-test.rpm](linux/0.1.14-beta/RPM/MeetSpace-0.1.14-beta-linux-x86_64-test.rpm) |
| Windows | 0.1.14-beta | NSIS / arm64 | [MeetSpace-0.1.14-beta-win-arm64-test-setup.exe](windows/0.1.14-beta/MeetSpace-0.1.14-beta-win-arm64-test-setup.exe) |
| Windows | 0.1.14-beta | NSIS / x64 | [MeetSpace-0.1.14-beta-win-x64-test-setup.exe](windows/0.1.14-beta/MeetSpace-0.1.14-beta-win-x64-test-setup.exe) |
| Linux | 0.2.0-beta | AppImage / arm64 | [MeetSpace-0.2.0-beta-linux-arm64-test.AppImage](linux/0.2.0-beta/AppImage/MeetSpace-0.2.0-beta-linux-arm64-test.AppImage) |
| Linux | 0.2.0-beta | AppImage / x64 | [MeetSpace-0.2.0-beta-linux-x86_64-test.AppImage](linux/0.2.0-beta/AppImage/MeetSpace-0.2.0-beta-linux-x86_64-test.AppImage) |
| Linux | 0.2.0-beta | DEB / arm64 | [MeetSpace-0.2.0-beta-linux-arm64-test.deb](linux/0.2.0-beta/DEB/MeetSpace-0.2.0-beta-linux-arm64-test.deb) |
| Linux | 0.2.0-beta | DEB / x64 | [MeetSpace-0.2.0-beta-linux-amd64-test.deb](linux/0.2.0-beta/DEB/MeetSpace-0.2.0-beta-linux-amd64-test.deb) |
| Linux | 0.2.0-beta | RPM / arm64 | [MeetSpace-0.2.0-beta-linux-aarch64-test.rpm](linux/0.2.0-beta/RPM/MeetSpace-0.2.0-beta-linux-aarch64-test.rpm) |
| Linux | 0.2.0-beta | RPM / x64 | [MeetSpace-0.2.0-beta-linux-x86_64-test.rpm](linux/0.2.0-beta/RPM/MeetSpace-0.2.0-beta-linux-x86_64-test.rpm) |
| Windows | 0.2.0-beta | NSIS / arm64 | [MeetSpace-0.2.0-beta-win-arm64-test-setup.exe](windows/0.2.0-beta/MeetSpace-0.2.0-beta-win-arm64-test-setup.exe) |
| Windows | 0.2.0-beta | NSIS / x64 | [MeetSpace-0.2.0-beta-win-x64-test-setup.exe](windows/0.2.0-beta/MeetSpace-0.2.0-beta-win-x64-test-setup.exe) |
| Linux | 0.2.1-beta | AppImage / arm64 | [MeetSpace-0.2.1-beta-linux-arm64-test.AppImage](linux/0.2.1-beta/AppImage/MeetSpace-0.2.1-beta-linux-arm64-test.AppImage) |
| Linux | 0.2.1-beta | AppImage / x64 | [MeetSpace-0.2.1-beta-linux-x86_64-test.AppImage](linux/0.2.1-beta/AppImage/MeetSpace-0.2.1-beta-linux-x86_64-test.AppImage) |
| Linux | 0.2.1-beta | DEB / arm64 | [MeetSpace-0.2.1-beta-linux-arm64-test.deb](linux/0.2.1-beta/DEB/MeetSpace-0.2.1-beta-linux-arm64-test.deb) |
| Linux | 0.2.1-beta | DEB / x64 | [MeetSpace-0.2.1-beta-linux-amd64-test.deb](linux/0.2.1-beta/DEB/MeetSpace-0.2.1-beta-linux-amd64-test.deb) |
| Linux | 0.2.1-beta | RPM / arm64 | [MeetSpace-0.2.1-beta-linux-aarch64-test.rpm](linux/0.2.1-beta/RPM/MeetSpace-0.2.1-beta-linux-aarch64-test.rpm) |
| Linux | 0.2.1-beta | RPM / x64 | [MeetSpace-0.2.1-beta-linux-x86_64-test.rpm](linux/0.2.1-beta/RPM/MeetSpace-0.2.1-beta-linux-x86_64-test.rpm) |
| Windows | 0.2.1-beta | NSIS / arm64 | [MeetSpace-0.2.1-beta-win-arm64-test-setup.exe](windows/0.2.1-beta/MeetSpace-0.2.1-beta-win-arm64-test-setup.exe) |
| Windows | 0.2.1-beta | NSIS / x64 | [MeetSpace-0.2.1-beta-win-x64-test-setup.exe](windows/0.2.1-beta/MeetSpace-0.2.1-beta-win-x64-test-setup.exe) |
| Windows | 0.2.2-beta | NSIS / x64 | [MeetSpace-0.2.2-beta-win-x64-test-setup.exe](windows/0.2.2-beta/MeetSpace-0.2.2-beta-win-x64-test-setup.exe) |
| Windows | 0.2.2-beta | NSIS / arm64 | [MeetSpace-0.2.2-beta-win-arm64-test-setup.exe](windows/0.2.2-beta/MeetSpace-0.2.2-beta-win-arm64-test-setup.exe) |
| Linux | 0.2.2-beta | DEB / x64 | [MeetSpace-0.2.2-beta-linux-amd64-test.deb](linux/0.2.2-beta/DEB/MeetSpace-0.2.2-beta-linux-amd64-test.deb) |
| Linux | 0.2.2-beta | RPM / x64 | [MeetSpace-0.2.2-beta-linux-x86_64-test.rpm](linux/0.2.2-beta/RPM/MeetSpace-0.2.2-beta-linux-x86_64-test.rpm) |
| Linux | 0.2.2-beta | AppImage / x64 | [MeetSpace-0.2.2-beta-linux-x86_64-test.AppImage](linux/0.2.2-beta/AppImage/MeetSpace-0.2.2-beta-linux-x86_64-test.AppImage) |
| Linux | 0.2.2-beta | DEB / arm64 | [MeetSpace-0.2.2-beta-linux-arm64-test.deb](linux/0.2.2-beta/DEB/MeetSpace-0.2.2-beta-linux-arm64-test.deb) |
| Linux | 0.2.2-beta | RPM / arm64 | [MeetSpace-0.2.2-beta-linux-aarch64-test.rpm](linux/0.2.2-beta/RPM/MeetSpace-0.2.2-beta-linux-aarch64-test.rpm) |
| Linux | 0.2.2-beta | AppImage / arm64 | [MeetSpace-0.2.2-beta-linux-arm64-test.AppImage](linux/0.2.2-beta/AppImage/MeetSpace-0.2.2-beta-linux-arm64-test.AppImage) |
| Windows | 0.2.3-beta | NSIS / x64 | [MeetSpace-0.2.3-beta-win-x64-test-setup.exe](windows/0.2.3-beta/MeetSpace-0.2.3-beta-win-x64-test-setup.exe) |
| Windows | 0.2.3-beta | NSIS / arm64 | [MeetSpace-0.2.3-beta-win-arm64-test-setup.exe](windows/0.2.3-beta/MeetSpace-0.2.3-beta-win-arm64-test-setup.exe) |
| Linux | 0.2.3-beta | DEB / x64 | [MeetSpace-0.2.3-beta-linux-amd64-test.deb](linux/0.2.3-beta/DEB/MeetSpace-0.2.3-beta-linux-amd64-test.deb) |
| Linux | 0.2.3-beta | RPM / x64 | [MeetSpace-0.2.3-beta-linux-x86_64-test.rpm](linux/0.2.3-beta/RPM/MeetSpace-0.2.3-beta-linux-x86_64-test.rpm) |
| Linux | 0.2.3-beta | AppImage / x64 | [MeetSpace-0.2.3-beta-linux-x86_64-test.AppImage](linux/0.2.3-beta/AppImage/MeetSpace-0.2.3-beta-linux-x86_64-test.AppImage) |
| Linux | 0.2.3-beta | DEB / arm64 | [MeetSpace-0.2.3-beta-linux-arm64-test.deb](linux/0.2.3-beta/DEB/MeetSpace-0.2.3-beta-linux-arm64-test.deb) |
| Linux | 0.2.3-beta | RPM / arm64 | [MeetSpace-0.2.3-beta-linux-aarch64-test.rpm](linux/0.2.3-beta/RPM/MeetSpace-0.2.3-beta-linux-aarch64-test.rpm) |
| Linux | 0.2.3-beta | AppImage / arm64 | [MeetSpace-0.2.3-beta-linux-arm64-test.AppImage](linux/0.2.3-beta/AppImage/MeetSpace-0.2.3-beta-linux-arm64-test.AppImage) |
| macOS | 0.2.3-beta | DMG / x64 | [MeetSpace-0.2.3-beta-darwin-x64-test.dmg](macos/0.2.3-beta/MeetSpace-0.2.3-beta-darwin-x64-test.dmg) |
| macOS | 0.2.3-beta | DMG / arm64 | [MeetSpace-0.2.3-beta-darwin-arm64-test.dmg](macos/0.2.3-beta/MeetSpace-0.2.3-beta-darwin-arm64-test.dmg) |
| Windows | 0.3.0-beta | NSIS / x64 | [MeetSpace-0.3.0-beta-win-x64-test-setup.exe](windows/0.3.0-beta/MeetSpace-0.3.0-beta-win-x64-test-setup.exe) |
| Windows | 0.3.0-beta | NSIS / arm64 | [MeetSpace-0.3.0-beta-win-arm64-test-setup.exe](windows/0.3.0-beta/MeetSpace-0.3.0-beta-win-arm64-test-setup.exe) |
| Linux | 0.3.0-beta | DEB / x64 | [MeetSpace-0.3.0-beta-linux-amd64-test.deb](linux/0.3.0-beta/DEB/MeetSpace-0.3.0-beta-linux-amd64-test.deb) |
| Linux | 0.3.0-beta | RPM / x64 | [MeetSpace-0.3.0-beta-linux-x86_64-test.rpm](linux/0.3.0-beta/RPM/MeetSpace-0.3.0-beta-linux-x86_64-test.rpm) |
| Linux | 0.3.0-beta | AppImage / x64 | [MeetSpace-0.3.0-beta-linux-x86_64-test.AppImage](linux/0.3.0-beta/AppImage/MeetSpace-0.3.0-beta-linux-x86_64-test.AppImage) |
| Linux | 0.3.0-beta | DEB / arm64 | [MeetSpace-0.3.0-beta-linux-arm64-test.deb](linux/0.3.0-beta/DEB/MeetSpace-0.3.0-beta-linux-arm64-test.deb) |
| Linux | 0.3.0-beta | RPM / arm64 | [MeetSpace-0.3.0-beta-linux-aarch64-test.rpm](linux/0.3.0-beta/RPM/MeetSpace-0.3.0-beta-linux-aarch64-test.rpm) |
| Linux | 0.3.0-beta | AppImage / arm64 | [MeetSpace-0.3.0-beta-linux-arm64-test.AppImage](linux/0.3.0-beta/AppImage/MeetSpace-0.3.0-beta-linux-arm64-test.AppImage) |
