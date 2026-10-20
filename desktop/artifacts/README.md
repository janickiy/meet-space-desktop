# Дистрибутивы MeetSpace Desktop

## Последняя сборка 0.1.1 beta — архивы и документы

Пересборка от 20 октября 2026 года поддерживает 75 расширений вложений: ZIP, GZIP, BZIP2, 7z, RAR, TAR, XZ, Zstandard и другие архивы; Word, Excel, PowerPoint, OpenDocument, RTF, EPUB и текстовые документы. До 5 файлов в сообщении, до 10 МБ на файл. Для отправки новых типов сервер должен поддерживать соответствующие вложения.

Исходники: [`4d8d86631198`](https://github.com/janickiy/meet-space-win/commit/4d8d86631198b9ac2fb1a474347273a01c021c80). Полный хеш входных файлов: `e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4`. Все восемь пакетов содержат одну версию исходников.

| Пакет | x64 | ARM64 |
|---|---|---|
| Windows — установщик EXE | [x64](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) | [ARM64](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Ubuntu/Debian — DEB | [x64](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/DEB/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/x64/MeetSpace-0.1.1-beta-linux-amd64-test.deb) | [ARM64](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/DEB/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/arm64/MeetSpace-0.1.1-beta-linux-arm64-test.deb) |
| Fedora — RPM | [x64](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/RPM/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/x64/MeetSpace-0.1.1-beta-linux-x86_64-test.rpm) | [ARM64](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/RPM/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/arm64/MeetSpace-0.1.1-beta-linux-aarch64-test.rpm) |
| Linux — AppImage | [x64](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/AppImage/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/x64/MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage) | [ARM64](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/AppImage/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/arm64/MeetSpace-0.1.1-beta-linux-arm64-test.AppImage) |

Это тестовые пакеты без цифровой подписи; автообновление отключено. Windows-пакеты проверены по фактическому NSIS payload, PE/DLL-архитектурам и ASAR. Все Linux-пакеты прошли статическую проверку метаданных, ELF/GLIBC, ASAR, сценариев установки и контрольных сумм. ARM64 AppImage дополнительно прошла запуск в изолированной Ubuntu UTM с песочницей renderer; отчёт рядом с пакетом описывает точную область проверки. Linux x64 собран в контейнере amd64 на Mac ARM64. Публикация не означает полную повторную приёмку Windows/Linux или проверку реального сервера.

Последняя Windows x64 также доступна [в корне artifacts](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/MeetSpace-0.1.1-beta-win-x64-test-setup.exe). Основные пути `windows/0.1.1-beta/x64/` и `windows/0.1.1-beta/arm64/` обновлены на эту сборку.

## Размещение и предыдущие сборки

Windows: `windows/<версия>/<хеш>/<архитектура>/`. Linux: `linux/<DEB|RPM|AppImage>/<версия>/<хеш>/<архитектура>/`. Версия Linux — только `0.1.1-beta`; версии Windows — `0.1.0-beta` и `0.1.1-beta`. Прежние сборки той же версии сохранены с исходными хешами. Новая функция доступна в пакетах с хешем `e9c984f570a4…`.

Всего 32 дистрибутива, включая основные Windows-пути и сохранённые сборки; 30 разных бинарных файлов.

| ОС / архитектура | Версия | Сборка | Скачать |
|---|---|---|---|
| Linux x64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/AppImage/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/x64/MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage) |
| Linux ARM64 | 0.1.1-beta | `b57b2a30bccc` | [MeetSpace-0.1.1-beta-linux-arm64-test.AppImage](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/AppImage/0.1.1-beta/b57b2a30bccc4be09a91778a305cd7df0477650eb12fc8d408c66f0117c19150/arm64/MeetSpace-0.1.1-beta-linux-arm64-test.AppImage) |
| Linux ARM64 | 0.1.1-beta | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-arm64-test.AppImage](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/AppImage/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/arm64/MeetSpace-0.1.1-beta-linux-arm64-test.AppImage) |
| Linux x64 | 0.1.1-beta | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/AppImage/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/x64/MeetSpace-0.1.1-beta-linux-x86_64-test.AppImage) |
| Linux ARM64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-arm64-test.deb](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/DEB/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/arm64/MeetSpace-0.1.1-beta-linux-arm64-test.deb) |
| Linux x64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-amd64-test.deb](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/DEB/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/x64/MeetSpace-0.1.1-beta-linux-amd64-test.deb) |
| Linux ARM64 | 0.1.1-beta | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-arm64-test.deb](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/DEB/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/arm64/MeetSpace-0.1.1-beta-linux-arm64-test.deb) |
| Linux x64 | 0.1.1-beta | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-amd64-test.deb](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/DEB/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/x64/MeetSpace-0.1.1-beta-linux-amd64-test.deb) |
| Linux x64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-linux-x86_64-test.rpm](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/RPM/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/x64/MeetSpace-0.1.1-beta-linux-x86_64-test.rpm) |
| Linux ARM64 | 0.1.1-beta | `7a239414f69c` | [MeetSpace-0.1.1-beta-linux-aarch64-test.rpm](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/RPM/0.1.1-beta/7a239414f69c011064e9f193e226b570b2fdce9d64318d3b81cfd888b4ea3996/arm64/MeetSpace-0.1.1-beta-linux-aarch64-test.rpm) |
| Linux ARM64 | 0.1.1-beta | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-aarch64-test.rpm](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/RPM/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/arm64/MeetSpace-0.1.1-beta-linux-aarch64-test.rpm) |
| Linux x64 | 0.1.1-beta | `e9c984f570a4` | [MeetSpace-0.1.1-beta-linux-x86_64-test.rpm](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/linux/RPM/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/x64/MeetSpace-0.1.1-beta-linux-x86_64-test.rpm) |
| Windows ARM64 | 0.1.0-beta | `a129a27dbb01` | [MeetSpace-0.1.0-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.0-beta/arm64/MeetSpace-0.1.0-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.0-beta | `a129a27dbb01` | [MeetSpace-0.1.0-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.0-beta/x64/MeetSpace-0.1.0-beta-win-x64-test-setup.exe) |
| Windows ARM64 | 0.1.1-beta | `2837a51157fb` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/2837a51157fb7022d6d95cbcf611b85d535bd66731a87b068e6e7ff83632c995/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `2837a51157fb` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/2837a51157fb7022d6d95cbcf611b85d535bd66731a87b068e6e7ff83632c995/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows ARM64 | 0.1.1-beta | `2acaaf33c90c` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/2acaaf33c90c7edc3ad72ce068f3fe29746950e5c0c87ebe6a961501e215d583/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `2acaaf33c90c` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/2acaaf33c90c7edc3ad72ce068f3fe29746950e5c0c87ebe6a961501e215d583/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows ARM64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `441cb9713c16` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows ARM64 | 0.1.1-beta | `5ac958650ac2` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/5ac958650ac2ca7e975aa1e9b433a1baa7550efbcb52906bf352895fad6a5880/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `5ac958650ac2` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/5ac958650ac2ca7e975aa1e9b433a1baa7550efbcb52906bf352895fad6a5880/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows ARM64 | 0.1.1-beta | `97f478eea481` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/97f478eea481240f12adaa1558f81864679cde9b2e14209b4b4c89499939ba62/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `97f478eea481` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/97f478eea481240f12adaa1558f81864679cde9b2e14209b4b4c89499939ba62/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows ARM64 | 0.1.1-beta | `e9c984f570a4` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows ARM64 | 0.1.1-beta | `db0f4234207e` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/db0f4234207e80bab75a8050ede2cd9ab9aec21f0a116e39c9838b5816d2e902/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `db0f4234207e` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/db0f4234207e80bab75a8050ede2cd9ab9aec21f0a116e39c9838b5816d2e902/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows ARM64 | 0.1.1-beta | `e963d672cf94` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/e963d672cf94c5c22359d4dec671eb30c25005e924f346d195e68faeb66b0a12/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `e963d672cf94` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/e963d672cf94c5c22359d4dec671eb30c25005e924f346d195e68faeb66b0a12/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows ARM64 | 0.1.1-beta | `e9c984f570a4` | [MeetSpace-0.1.1-beta-win-arm64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/arm64/MeetSpace-0.1.1-beta-win-arm64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `e9c984f570a4` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/e9c984f570a4aa97bb3a52b79d8354fdd499eaee35a6d2940fc823cca5c411d4/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |
| Windows x64 | 0.1.1-beta | `e9c984f570a4` | [MeetSpace-0.1.1-beta-win-x64-test-setup.exe](https://github.com/janickiy/meet-space-win/raw/refs/heads/main/desktop/artifacts/windows/0.1.1-beta/x64/MeetSpace-0.1.1-beta-win-x64-test-setup.exe) |

## Загрузка и проверка

Бинарные файлы хранятся через Git LFS. Для получения всех пакетов после клонирования:

```sh
git lfs install
git lfs pull
```

Для одного пакета используйте ссылки выше или Download raw file в GitHub.

[SHA256SUMS](SHA256SUMS) содержит контрольные суммы дистрибутивов; [catalog.json](catalog.json) — полный каталог. Индивидуальные проверки и метаданные исходников лежат рядом с пакетами. Публикуемые файлы в artifacts исключены из fingerprint исходников.
