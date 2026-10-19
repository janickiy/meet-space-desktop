# Документация MeetSpace Desktop

- [Запуск, сборка и системные требования](../desktop/README.md).
- Windows: [архитектура](desktop/01_AUDIT.md), [авторизация и транспорт](desktop/03_SERVER_AUTH_REALTIME.md), [медиа](desktop/04_WEBRTC_MEDIA.md), [системная интеграция](desktop/05_PRODUCT_NATIVE.md), [установщики и выпуск](desktop/06_INSTALLERS_CI_RELEASE.md), [безопасность](desktop/07_SECURITY_AUDIT.md), [жизненный цикл медиаресурсов](desktop/07_MEDIA_LIFECYCLE.md), [системные ресурсы](desktop/07_NATIVE_LIFECYCLE.md).
- Linux: [аудит](desktop/linux/01_AUDIT.md), [платформа](desktop/linux/02_PLATFORM.md), [медиа](desktop/linux/03_MEDIA.md), [демонстрация экрана](desktop/linux/04_SCREEN.md), [системная интеграция](desktop/linux/05_INTEGRATION.md), [пакеты и CI](desktop/linux/06_RELEASE.md), [QA](desktop/linux/07_FINAL_QA.md).
- [Мастер установки сервера по SSH](desktop/SSH_INSTALLER_REFERENCE.md), [дизайн](desktop/DESIGN_V2.md), [CI и правила выпуска](../desktop/scripts/ci/README.md).

Отчёты этапов сохраняют исторические результаты. Актуальное состояние проверяйте по последним QA-отчётам и исходному коду.

Серверная документация ведётся отдельно: [репозиторий backend](https://github.com/janickiy/meet-space), [API и протоколы](https://github.com/janickiy/meet-space/blob/main/docs/API.md), [развёртывание](https://github.com/janickiy/meet-space/blob/main/docs/DEPLOYMENT.md).

При очистке 19 октября 2026 года прежние локальные сборки и QA-материалы для исходников `441cb9713c16dc03d7a580894e61f39dd42ed5fc98351fe35b533c843e79f059`, старые макеты и сторонние документы перенесены за пределы checkout: `/Users/aleksandranickij/htdocs/meetspace-desktop-archive/2026-10-19-cleanup/`. Это архив предыдущих результатов; он не подтверждает сборку текущих очищенных исходников.

После очистки заново прошли сборка React/Electron, 28 проверок frontend foundation, 38 media и 9 assets. Модульные тесты Desktop: 237 PASS, 1 platform SKIP, 0 FAIL. Отдельный Go-модуль тестов собирается без локального backend; проверены прямой и TURN-звонок с синтетическими устройствами и оба режима media fixture. Логи текущей проверки находятся в подкаталоге `validation-after-cleanup/` указанного архива.
