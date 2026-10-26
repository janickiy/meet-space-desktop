# Дистрибутивы MeetSpace Desktop

Готовые пакеты Windows и Linux опубликованы через Git LFS. Linux: `source/linux/<версия>/<DEB|RPM|AppImage>/<пакет>`; Windows: `source/windows/<версия>/<пакет>`.

## Последние сборки 0.1.9 beta

Выпуск от 26 октября 2026 года включает обновлённую вёрстку по макету: чаты, настройки, встречи, календарь, папки, записи и модальные окна. Сохранены рабочие действия, выбор устройств и настройка громкости. В выпуск также вошли ранее подготовленные выбор своего TLS-сертификата или Let's Encrypt, автоматический выбор latest для готовых Docker-образов и исправления звука уведомлений.

Все восемь пакетов собраны из одного чистого commit [ab82c66e47b8](https://github.com/janickiy/meet-space-desktop/commit/ab82c66e47b81cc319295ffa4c405ab99811d12f). SHA-256 457 входных файлов: `a569c4ca1c2cfe87e694eb0a69bad681bd590150dd5efc8ee163241218202911`. Отчёты содержат `sourceDirty: false`; все входные файлы сверены с commit.

| Пакет | x64 | ARM64 |
|---|---|---|
| Windows — EXE | [x64](windows/0.1.9-beta/MeetSpace-0.1.9-beta-win-x64-test-setup.exe) | [ARM64](windows/0.1.9-beta/MeetSpace-0.1.9-beta-win-arm64-test-setup.exe) |
| Ubuntu/Debian — DEB | [x64](linux/0.1.9-beta/DEB/MeetSpace-0.1.9-beta-linux-amd64-test.deb) | [ARM64](linux/0.1.9-beta/DEB/MeetSpace-0.1.9-beta-linux-arm64-test.deb) |
| Fedora — RPM | [x64](linux/0.1.9-beta/RPM/MeetSpace-0.1.9-beta-linux-x86_64-test.rpm) | [ARM64](linux/0.1.9-beta/RPM/MeetSpace-0.1.9-beta-linux-aarch64-test.rpm) |
| Linux — AppImage | [x64](linux/0.1.9-beta/AppImage/MeetSpace-0.1.9-beta-linux-x86_64-test.AppImage) | [ARM64](linux/0.1.9-beta/AppImage/MeetSpace-0.1.9-beta-linux-arm64-test.AppImage) |

## Последние сборки каждой версии

В каталоге **58 пакетов**: восемь новых `0.1.9-beta` и 50 ранее опубликованных. Предыдущие версии и сопроводительные файлы сохранены без изменения байтов. Для каждой комбинации ОС, версии, формата и архитектуры хранится последняя опубликованная сборка.

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

## Область проверки

Пакеты тестовые, без цифровой подписи приложения; автоматическое обновление отключено. Встроенный SSH-установщик отдельно подписан доверенным ключом. Windows x64/ARM64 прошли проверку встроенного NSIS/PE/ASAR payload. Linux-пакеты прошли проверку метаданных, ELF/GLIBC, ASAR, install hooks и контрольных сумм. ARM64 собран в Ubuntu UTM, x64 — процессом Linux x64 в Docker с эмуляцией на Mac ARM64.

Проверки приложения: 307 unit-проверок успешно, 1 пропущена; 39 проверок жизненного цикла медиа успешно. Интерфейс проверен на локальных тестовых данных в светлой и тёмной темах, при увеличенном шрифте и разных размерах окна. ARM64 AppImage установлен и запущен в Ubuntu UTM с включённой песочницей и сохранением профиля. Это не заменяет полную приёмку на каждой ОС: нативный запуск Windows, реальные SFU/SMTP и каждый Linux-дистрибутив в этом выпуске повторно не проверялись.

Рабочие результаты сборки остаются в `desktop/artifacts/`; в `source/` размещены только проверенные пакеты, отчёты и контрольные суммы.
