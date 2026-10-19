# Дистрибутивы MeetSpace Desktop

Готовые установочные файлы сгруппированы по ОС, версии и архитектуре; Linux дополнительно разделён на DEB, RPM и AppImage. Разные сборки одной версии различаются полным хешем исходников в имени каталога. Всего 24 дистрибутива; контрольные суммы и метаданные находятся рядом с файлами.

## Последняя опубликованная сборка 0.1.1 beta

Это тестовые пакеты без цифровой подписи. Источник каждого пакета указан в каталоге и соседних JSON-отчётах. Публикация файлов не означает повторную приёмку всех ОС.

- [Windows x64 — установщик](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe)
- [Windows ARM64 — установщик](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe)
- [Ubuntu/Debian x64 — DEB](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/DEB/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/x64/MeetSpace-0.1.1-beta-linux-amd64-test.deb)
- [Ubuntu/Debian ARM64 — DEB](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/DEB/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/arm64/MeetSpace-0.1.1-beta-linux-arm64-test.deb)
- [Fedora x64 — RPM](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/RPM/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/x64/MeetSpace-0.1.1-beta-linux-x86_64-test.rpm)
- [Linux x64 — AppImage](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/AppImage/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/x64/MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage)

- [Fedora ARM64 — RPM (aarch64)](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/RPM/0.1.1-beta/7a239414f69c011064e9f193e226b570b2fdce9d64318d3b81cfd888b4ea3996/arm64/MeetSpace-0.1.1-beta-linux-aarch64-test.rpm)

- [Linux ARM64 — AppImage](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/AppImage/0.1.1-beta/b57b2a30bccc4be09a91778a305cd7df0477650eb12fc8d408c66f0117c19150/arm64/MeetSpace-0.1.1-beta-linux-arm64-test.AppImage)

Запрошенная копия Windows x64 также доступна [в корне artifacts](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/MeetSpace-0.1.1-beta-win-x64-test-setup.exe).

## Все версии

Для Linux доступны [DEB](linux/DEB/0.1.1-beta/) (x64 и ARM64), [RPM](linux/RPM/0.1.1-beta/) (x64 и ARM64) и [AppImage](linux/AppImage/0.1.1-beta/) (x64 и ARM64). Общие JSON-отчёты исходной проверки сохранены побайтно рядом с каждым форматом; они описывают весь набор пакетов исходной сборки и её прежнее размещение.

Папки `windows/<версия>/<архитектура>/` содержат основные Windows-пакеты, `windows/<версия>/<хеш>/<архитектура>/` — варианты сборок. Linux-пакеты находятся в `linux/<DEB|RPM|AppImage>/<версия>/<хеш>/<архитектура>/`. Для Linux доступна только версия `0.1.1-beta`; каждый формат и архитектура представлены последней опубликованной сборкой. Для Windows доступны только версии `0.1.0-beta` и `0.1.1-beta`.

| ОС / архитектура | Версия | Сборка | Скачать |
|---|---|---|---|
| Linux arm64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-arm64-test.deb](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/DEB/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/arm64/MeetSpace-0.1.1-beta-linux-arm64-test.deb) |
| Linux x64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-amd64-test.deb](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/DEB/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/x64/MeetSpace-0.1.1-beta-linux-amd64-test.deb) |
| Linux x64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/AppImage/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/x64/MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage) |
| Linux x64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-x86_64-test.rpm](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/RPM/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/x64/MeetSpace-0.1.1-beta-linux-x86_64-test.rpm) |
| Linux arm64 | 0.1.1-beta | `7a239414f69c` | [MeetSpace-0.1.1-beta-linux-aarch64-test.rpm](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/RPM/0.1.1-beta/7a239414f69c011064e9f193e226b570b2fdce9d64318d3b81cfd888b4ea3996/arm64/MeetSpace-0.1.1-beta-linux-aarch64-test.rpm) |
| Linux arm64 | 0.1.1-beta | `b57b2a30bccc` | [MeetSpace-0.1.1-beta-linux-arm64-test.AppImage](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/AppImage/0.1.1-beta/b57b2a30bccc4be09a91778a305cd7df0477650eb12fc8d408c66f0117c19150/arm64/MeetSpace-0.1.1-beta-linux-arm64-test.AppImage) |
| Windows arm64 | 0.1.0-beta | `a129a27dbb01` | [MeetSpace-0.1.0-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.0-beta/arm64/MeetSpace-0.1.0-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.0-beta | `a129a27dbb01` | [MeetSpace-0.1.0-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.0-beta/x64/MeetSpace-0.1.0-beta-win-x64-test-setup.exe) |
| Windows arm64 | 0.1.1-beta | `2837a51157fb` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/2837a51157fb7022d6d95cbcf611b85d535bd66731a87b068e6e7ff83632c995/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `2837a51157fb` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/2837a51157fb7022d6d95cbcf611b85d535bd66731a87b068e6e7ff83632c995/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows arm64 | 0.1.1-beta | `2acaaf33c90c` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/2acaaf33c90c7edc3ad72ce068f3fe29746950e5c0c87ebe6a961501e215d583/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `2acaaf33c90c` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/2acaaf33c90c7edc3ad72ce068f3fe29746950e5c0c87ebe6a961501e215d583/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows arm64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows arm64 | 0.1.1-beta | `5ac958650ac2` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/5ac958650ac2ca7e975aa1e9b433a1baa7550efbcb52906bf352895fad6a5880/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `5ac958650ac2` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/5ac958650ac2ca7e975aa1e9b433a1baa7550efbcb52906bf352895fad6a5880/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows arm64 | 0.1.1-beta | `97f478eea481` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/97f478eea481240f12adaa1558f81864679cde9b2e14209b4b4c89499939ba62/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `97f478eea481` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/97f478eea481240f12adaa1558f81864679cde9b2e14209b4b4c89499939ba62/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows arm64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows arm64 | 0.1.1-beta | `db0f4234207e` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/db0f4234207e80bab75a8050ede2cd9ab9aec21f0a116e39c9838b5816d2e902/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `db0f4234207e` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/db0f4234207e80bab75a8050ede2cd9ab9aec21f0a116e39c9838b5816d2e902/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows arm64 | 0.1.1-beta | `e963d672cf94` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/e963d672cf94c5c22359d4dec671eb30c25005e924f346d195e68faeb66b0a12/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `e963d672cf94` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/e963d672cf94c5c22359d4dec671eb30c25005e924f346d195e68faeb66b0a12/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |

RPM ARM64 прошёл DNF install/reinstall/remove в Fedora 44 ARM64. Исходный AppImage ARM64 прошёл проверку настоящего Electron/React и выхода с песочницей в Ubuntu 24.04 UTM через существующий профиль AppArmor `chrome`. Обычный запуск AppImage в этой Ubuntu блокируется системной политикой песочницы; нужен разрешающий пользовательские пространства имён профиль приложения. Защита ОС и Chromium не отключалась. Область проверок и ограничения записаны в соседнем `linux-runtime-verification.json`.

## Получение через Git

Бинарные файлы хранятся в Git LFS этого репозитория. Для загрузки всех дистрибутивов в clone установите Git LFS и выполните:

```sh
git lfs install
git lfs pull
```

Для скачивания одного пакета используйте ссылки выше или кнопку Download raw file на GitHub.

SHA-256 всех дистрибутивов: [SHA256SUMS](SHA256SUMS). Полный перечень файлов: [catalog.json](catalog.json).

Новые ARM64 RPM/AppImage собраны на нативной Linux ARM64 с чистыми исходниками. ARM64 AppImage использует закреплённый статический загрузчик `1.0.3`; исходный динамический загрузчик с зависимостью от `libz.so` не публикуется.

Публикуемые установщики исключены из source fingerprint сборки: наличие LFS-пакетов или pointer-файлов не меняет состав исходников приложения.
