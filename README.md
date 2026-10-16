# MeetSpace for Windows

**Версия продукта: 0.1.0 beta.** Windows-приложение MeetSpace на Electron, React и TypeScript для Windows x64 и Windows 11 ARM64. С версии `0.1.0-beta` начинается новая нумерация выпусков.

Приложение подключается к существующему HTTPS-серверу MeetSpace, поддерживает авторизацию, встречи, видеозвонки, демонстрацию экрана, чаты, группы, папки, записи, системный трей и уведомления. Рабочий сервер: [meeting.janickiy.com](https://meeting.janickiy.com/).

- [Запуск, сборка установщиков и проверки Windows-приложения](desktop/README.md).
- [Архитектура Windows](docs/desktop/01_AUDIT.md), [дизайн интерфейса](docs/desktop/DESIGN_V2.md).
- [CI, подпись и выпуск](desktop/scripts/ci/README.md).

Для локального запуска нужны Node.js 24.15+ в ветке 24 либо поддерживаемая ветка 26+:

```sh
npm --prefix frontend ci
npm --prefix desktop ci
npm --prefix desktop run dev
```

Сборка тестовых установщиков x64 и ARM64:

```sh
npm --prefix desktop run pack:win
```

Результаты сохраняются в `desktop/artifacts/`. Тестовые сборки не подписаны; автоматические обновления пока отключены. Исходники общего интерфейса находятся в `frontend/`, оболочка приложения — в `desktop/`.

## Сервер и общие компоненты

В репозитории сохранены серверные компоненты и история исходного [janickiy/meet-space](https://github.com/janickiy/meet-space). Ниже — документация REST API сервиса на Go + Gin и его локального окружения.


