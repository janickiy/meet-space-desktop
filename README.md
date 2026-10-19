# MeetSpace Desktop

MeetSpace для **Windows и Linux** на Electron, React и TypeScript. Текущая версия — **0.1.1 beta** (`0.1.1-beta`). Приложение подключается к HTTPS-серверу MeetSpace и поддерживает аккаунты, встречи, видеозвонки, демонстрацию экрана, чаты, группы, папки, записи и системную интеграцию.

Репозиторий содержит клиент: `desktop/` — Electron, безопасность, установщики и проверки; `frontend/` — общий React-интерфейс; `docs/desktop/` — архитектура и результаты приёмки. Сервер разрабатывается отдельно в [janickiy/meet-space](https://github.com/janickiy/meet-space).

## Запуск и сборка

Нужен Node.js 24.15+ в ветке 24 либо поддерживаемая ветка 26+. Устанавливайте зависимости на целевой платформе и архитектуре:

```sh
npm --prefix frontend ci
npm --prefix desktop ci
npm --prefix desktop run dev
```

Для сборки локального интерфейса и обычного запуска:

```sh
npm --prefix desktop run build
npm --prefix desktop start
```

На Linux запускайте приложение обычным пользователем в графической сессии с разблокированным GNOME Keyring или KWallet и работающей песочницей Electron. Подробные требования и ограничения — в [руководстве Desktop](desktop/README.md).

## Установочные пакеты

Windows x64 и ARM64:

```sh
npm --prefix desktop run pack:win
```

На Linux соответствующей архитектуры:

```sh
npm --prefix desktop run pack:linux:x64
npm --prefix desktop run pack:linux:arm64
```

Linux x64 выпускается в форматах DEB, RPM и AppImage, ARM64 — DEB. Результаты находятся в `desktop/artifacts/`; Linux-пакеты — в `linux/<version>/<sourceTreeSha256>/<arch>/`. Тестовые сборки не подписаны; автоматические обновления отключены. Сборка пакета не заменяет проверку на целевой ОС.

## Проверки

```sh
npm --prefix frontend run check
npm --prefix frontend run check:desktop-foundation
npm --prefix frontend run check:desktop-media
npm --prefix frontend run check:desktop-assets
npm --prefix desktop test
npm --prefix desktop run build
```

Отдельные проверки Electron, устройств, звонков, трея и установщиков описаны в [Desktop README](desktop/README.md). [CI и правила выпуска](desktop/scripts/ci/README.md), [аудит безопасности Windows](docs/desktop/07_SECURITY_AUDIT.md), [проверки медиаресурсов](docs/desktop/07_MEDIA_LIFECYCLE.md), [Linux QA](docs/desktop/linux/07_FINAL_QA.md) фиксируют объём проверок и открытые ограничения.

## Подключение и установка сервера

На первом запуске укажите адрес своего HTTPS-сервера. Рабочий сервер проекта: [meeting.janickiy.com](https://meeting.janickiy.com/).

Встроенный мастер «Установить сервер по SSH» получает серверные исходники из [janickiy/meet-space](https://github.com/janickiy/meet-space), фиксирует commit и контрольные суммы, затем устанавливает сервер на удалённую Ubuntu. Его проверенный подписанный комплект хранится в `desktop/resources/server-installer/`; локальная копия backend для работы мастера не нужна. [Протокол, источник и требования к хосту](docs/desktop/SSH_INSTALLER_REFERENCE.md).

Дополнительная документация: [индекс](docs/README.md), [архитектура Windows](docs/desktop/01_AUDIT.md), [архитектура Linux](docs/desktop/linux/01_AUDIT.md), [дизайн интерфейса](docs/desktop/DESIGN_V2.md).
