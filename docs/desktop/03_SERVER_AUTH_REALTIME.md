# MeetSpace Windows — этап 03: сервер, авторизация, REST и realtime

Дата: 14 октября 2026. Репозиторий: `https://github.com/janickiy/meet-space`.
Исходный commit: `66e482c9701b6c13f58bc93aee8d9f5cf932dd34`; изменения этапов 02–03 локальные, поэтому в сборке `sourceDirty: true`.
Задание: `CODEX_DESKTOP_03_03_SERVER_AUTH_REALTIME.md`. Выполнен только этап 03.

## Реализация

Собирается общий frontend React/TypeScript/Vite. После выбора сервера открывается существующий App с AuthProvider, React Query, страницами регистрации, входа, встреч, чатов и настроек. Отдельной копии продукта нет. Веб-сборка продолжает использовать свои same-origin fetch и WebSocket.

Первый запуск показывает бренд MeetSpace и «Подключиться к серверу». Адрес нормализуется до HTTPS-origin; пути, credentials, query/hash и управляющие символы отвергаются. Пользователь может проверить адрес, сохранить название профиля, выбрать другой профиль и удалить его. Адрес не привязан к localhost. Изменение выбранного сервера доступно на страницах входа, приглашения, предварительного подключения и ошибки восстановления.

Проверка сервера использует реальные endpoints:

| Endpoint | Проверка |
| --- | --- |
| `GET /version` | JSON `version`, `commit`, `buildTime`; поддерживаемая основная версия 1 |
| `GET /api/v1/auth/me` | Форма ответа API; 401 до входа ожидаем |
| `GET /api/v1/capabilities` | 401 до входа ожидаем; после входа проверяются реальные флаги и `recordingModes` |

В backend нет отдельного endpoint для версии схемы API. Здесь совместимость определяется опубликованной версией, доступностью маршрутов и формой capabilities, а не вымышленным `/health` или `/api/version`. TLS, DNS, таймаут, несовместимая версия и ошибочный ответ различаются. Серверный ответ 401 не считается сетевой недоступностью.

### Секреты и границы процессов

В main работает session/network broker; sandboxed preload v2 предоставляет ограниченные операции. IPC принимает путь из allowlist существующего `/api/v1`, метод, ограниченное JSON-тело или байты, тип ответа и временный маркер личности. Renderer не задаёт произвольные сетевые URL, Authorization, cookies, TLS options, Origin или filesystem paths. Проверяются активное окно и главный frame. Ответы IPC содержат только фиксированные сообщения об ошибках; сырые исключения с URL и секретами не передаются и не логируются.

Настоящий access JWT остаётся в памяти main. Существующая auth state machine получает случайный непродолжительный маркер вместо JWT; main сверяет его с выбранным сервером и текущей личностью. WS tickets также создаются и используются в main. Login/register сохраняют фактические email/password-контракты сервера. Пароль не сохраняется. Гостевой JWT обрабатывается через существующий `/conference-invites/:code/guest`, без превращения его в persistent account session.

Сервер использует persistent HttpOnly cookies, а не JSON refresh token: `meetrix_session` и `meetrix_account_<user UUID>`, host-only, Secure, SameSite=Lax, `Path=/api/v1/auth`. Broker принимает только эти cookies с ожидаемыми атрибутами и отправляет только на auth path того же server ID. Cookie vault сохраняется через атомарную запись в `sessions.encrypted`, зашифрованный Electron safeStorage. На Windows механизм опирается на DPAPI. Plaintext fallback отсутствует. Это защита хранения; она не предотвращает доступ любого процесса того же пользователя к расшифрованным данным. [Документация safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

`servers.json` содержит только публичные профили и метаданные версии. Browser localStorage/sessionStorage не хранит JWT, cookies или пароль. Несекретные маркеры выбранного аккаунта/выхода имеют отдельный ключ на каждый сервер. При переключении сервера broker отменяет запросы, SSE и WSS, очищает активный JWT и маркер; App/AuthProvider/React Query пересоздаются с новым поколением. Старые ответы не применяются к новому аккаунту/серверу.

Выход удаляет локальную авторизацию до сетевой попытки. При недоступном сервере отзыв persistent session остаётся в зашифрованной очереди и повторяется при последующем соединении. Старый cookie не восстанавливает вышедший аккаунт после перезапуска. Выход, смена сервера, reload/авария renderer и закрытие окна завершают активные соединения.

### HTTP, CORS/Origin и realtime

HTTP использует Electron `net.request` в отдельной непостоянной session: системное HTTPS, `credentials: omit`, собственные проверенные headers, без browser cookie jar, без HTTP cache и без следования redirect. `referrerPolicy: no-referrer` исключает отправку referrer. Node HTTPS с явно доверенным временным CA используется только в тестах. TLS bypass, `webSecurity:false` и production mocks отсутствуют. [Контракт ClientRequest](https://www.electronjs.org/docs/latest/api/client-request).

Реальная проверка native POST обнаружила автоматически добавляемые Chromium заголовки `Sec-Fetch-Site: none`, `Sec-Fetch-Mode: no-cors`, `Sec-Fetch-Dest: empty`: существующий сервер обоснованно отвергал POST без Origin, но с browser Fetch Metadata. Исправление установлено только на private native session: `onBeforeSendHeaders` удаляет `Sec-Fetch-*`, разрешая только активные URL/методы broker; запросы renderer, frame/webContents и неожиданный Origin отклоняются. Cookie/Authorization сохраняются. Origin адресом сервера не подменяется. Renderer session и серверная защита не меняются. После исправления настоящий read-only POST `/auth/accounts/list` без cookies/credentials возвращает 200 и пустой список; наблюдение `onSendHeaders` подтверждает отсутствие Origin/Fetch Metadata. [API WebRequest](https://www.electronjs.org/docs/latest/api/web-request#webrequestonbeforesendheadersfilter-listener).

Прямой renderer fetch к remote origin запрещён CSP и webRequest. Локальный `app://meetspace/api/...` возвращает явный 403; сетевой proxy в app protocol отсутствует. Renderer исполняет только локально собранные scripts. Сохраняются `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `webSecurity:true`.

Фактический backend допускает native запросы без Origin и Fetch Metadata: `internal/app/auth/sessions.go`, auth handlers и `internal/transport/websocket/handler.go`/`user_handler.go`. Browser запросы сохраняют same-origin проверку и browser WS allowlist. Desktop не добавляет `app://` в allowlist и не требует wildcard CORS. Сетевые полномочия native клиента ограничены проверенным IPC. Изменений серверных CORS/Auth/WS проверок не сделано.

Broker получает account ticket через `POST /api/v1/ws-ticket`, открывает WSS `/api/v1/ws?ticket=...`; conference ticket через `POST /api/v1/conferences/:id/ws-ticket`, открывает WSS с `go-recorder.v1`. Используются pinned pure-JS `ws` и проверка TLS; optional native addons не включены. В frontend сохранены существующие reconnect/backoff, получение нового ticket, обработка events/snapshots и восстановление состояния REST-запросами. Notifications SSE использует фиксированный `/api/v1/notifications/events`, bearer в main и ограниченные chunks через IPC в существующий parser.

REST адаптация сохраняет `api.ts`, обработку статусов, 401 recovery и отмену. Binary uploads ограничены фактическими 10 MiB; содержимое private group assets возвращается байтами, аватары отображаются через blob. Прогресс передачи не означает, что файл уже принят/обработан сервером. Приглашения и ссылки на материалы учитывают выбранный HTTPS-server.

## Изменённые области

- `desktop/src/main.ts`, `preload.ts`, `shared/contracts.ts`: безопасная привязка broker, bridge v2, lifecycle и проверка отправителя.
- `desktop/src/broker.ts`, `network/transport.ts`, `network/policy.ts`: HTTPS/probe, allowlist REST, identity fencing, WSS и SSE.
- `desktop/src/server/profiles.ts`, `session/vault.ts`: профили, OS encryption и очередь отзыва сессий.
- `desktop/src/security.ts`, `protocol.ts`: выбранный origin внешних ссылок, локальная CSP и запрет прямого API.
- `frontend/src/platform/*`, `components/desktop/DesktopSessionGate.tsx`: общие declarations, транспорт и выбор сервера.
- `frontend/src/api.ts`, `auth.tsx`, `main.tsx`, `utils.ts`, `realtime.ts`, `personalRealtime.ts`: подключение к общим контрактах и изоляция сессии.
- `frontend/src/App.tsx`, страницы входа/приглашения/предварительного подключения, Layout, компоненты ссылок и календаря: доступность смены сервера и корректные публичные адреса.
- `desktop/tests/*`, `frontend/scripts/check-desktop-foundation.mjs`, package/lock/config/scripts: TLS fixtures, IPC/restart проверки и упаковка тестового релиза 0.3.0.

## Проверки

Временные HTTPS fixtures — только тестовый стенд с проверкой доверенного CA/hostname, вне renderer/ASAR и вне production-кода. Отдельный тест сырых Electron headers использует loopback HTTP и фиктивные canaries, не вызывает production bridge и не меняет правило HTTPS для приложения.

| Проверка | Результат |
| --- | --- |
| Shared frontend: targeted tests | PASS 17/17 |
| Frontend lint/typecheck/web build | PASS, 2167 modules, без warnings |
| Frontend-only сборка в Docker COPY scope | PASS, без зависимости от desktop directory |
| Desktop frontend build | PASS, 2167 modules, без warnings |
| Desktop полный набор, итоговый прогон | PASS 49/49: security 22, policy/vault/races 15, broker network 7, transport network 5; 0 skipped |
| Native TLS/DNS/timeout/redirect/size/abort | PASS 5/5 |
| Electron Chromium HTTPS к рабочему серверу | PASS GET `/version` 200; `/auth/me` и `/capabilities` 401; read-only POST `/auth/accounts/list` 200 empty, без credentials/входа |
| Actual Electron headers/cookies | PASS manual Cookie/Bearer сохранены, Set-Cookie доступен; ambient cookies не отправляются и не сохраняются |
| Broker auth/account/server/guest/WSS/SSE | PASS 7/7 реальные локальные HTTPS/WSS/SSE; guest resume и сохранение обычного аккаунта после выхода гостя |
| Реальный Electron IPC + два запуска процесса + safeStorage | PASS вход, passwordless restore, WSS/SSE, изоляция серверов, logout revocation; macOS ARM64 |
| Общий React UI в Electron | PASS 7 сценариев: first-run/login, reconnect с новым ticket и REST refresh, SSE, modal settings, same-ID cache isolation, offline server switch, vault/storage isolation |
| Secure renderer smoke, production/dev | PASS sandbox/CSP/remote fetch и navigation denial, bridge v2, light/dark, zoom 125/150/200%, deep link при reload |
| Windows x64/ARM64 payload и установщики | PASS cross-build NSIS и независимый `verify:artifacts`; EXE + 6 DLL каждой архитектуры, ASAR, pinned ws и provenance |
| Авторизация/WSS с рабочим сервером | NOT RUN: тестовая учётная запись не предоставлена |
| Windows install/uninstall/runtime | NOT RUN: Windows environment отсутствует |
| npm audit desktop | PASS, 0 vulnerabilities |

Во время проверок исправлены также запоздалый login после logout, отказ secure storage во время выхода, повторный отзыв сессии после offline logout/restart, guest resume и сохранение отдельного обычного аккаунта. В main закрытие соединений перенесено с `did-start-loading` на замену главного документа (`did-start-navigation`, `!isSameDocument`): React Router pushState больше не обрывает SSE. Transient close reasons `broker_unavailable`, `state_unavailable`, `authentication_unavailable` сохраняются для существующей логики reconnect. В отрицательном smoke Electron выводит ожидаемый фиксированный отказ `Link is not allowed`; секретов в нём нет. В одном минимальном IPC прогоне macOS также дал sandbox resource diagnostic; assertions и exit code успешны.

Рабочий deployment на момент read-only проверки: `v1.0.0-meeting.20261013-accounts.4`, commit `a659c5c117bbf47367a8def63c13b43715bbc8ff`, buildTime `2026-10-13T16:27:13Z`. Он отличается от локального исходного commit; публичные endpoints и read-only accounts/list доступны по строгому HTTPS. Пользователи, пароли и данные на рабочем сервере в проверках не создавались и не изменялись.

## Тестовые установщики 0.3.0

Финальная сборка после исправления native POST: `0.3.0-test`, `2026-10-14T01:50:58Z`, исходный commit `66e482c9701b6c13f58bc93aee8d9f5cf932dd34`, `sourceDirty: true`, host macOS ARM64. Установщики не подписаны и не публикуются. Старые артефакты этапа 02 сохранены отдельно.

| Файл в `desktop/artifacts` | Байты | SHA-256 |
| --- | ---: | --- |
| `MeetSpace-0.3.0-win-x64-test-setup.exe` | 123795910 | `ec8357a6ea71ce102ef9cdcd5f3c64bda0f4ef3982d2b413f0ba91777426741c` |
| `MeetSpace-0.3.0-win-arm64-test-setup.exe` | 118536835 | `f47fc3f49e77d9475dc4c5bbc4ca8fc3531946fb420dd02f28ae7db3494d330b` |

Общий `app.asar`: 4941338 байт, SHA-256 `7ba778104fa212a378e9e4e4ec90fad3cdf6d0c638f928942fb0aeaba9d78668`. Проверены именно извлечённые payloads внутри NSIS: x64 EXE и 6 DLL имеют PE Machine `0x8664`, ARM64 EXE и 6 DLL — `0xaa64`. ASAR содержит общий renderer, main/preload и единственную pure-JS runtime зависимость `ws@8.22.0`; native addons, исходников и тестовых стендов в нём нет. JSON manifests и `.sha256` находятся рядом с EXE. После финальной упаковки source/renderer/dist не пересобирались.

## Матрица Windows

| Система | Сборка / payload | Фактический runtime |
| --- | --- | --- |
| Windows 10 22H2 x64, build 19045 | PASS x64, PE `0x8664` | NOT RUN |
| Windows 11 x64, build 22000+ | PASS x64, PE `0x8664` | NOT RUN |
| Windows 11 ARM64, build 22000+ | PASS native ARM64, PE `0xaa64` | NOT RUN |

Windows 10 ARM64 и x86 вне объёма. Cross-сборка, PE Machine и architecture guard подтверждают тип payload; они не заменяют запуск на Windows. Доступные Electron runtime проверки выполняются на macOS ARM64.

## Ограничения и следующий шаг

- Устройства, TURN/ICE/media worker и screen capture нельзя считать проверенными на этапе transport: системные media permissions пока закрыты. Существующий frontend показывает ошибки; offline-встречи не заявляются. Этап 04 должен открыть строго нужные permissions и проверить реальные звонки на трёх Windows targets.
- Прямое воспроизведение remote recording URLs и нативное сохранение файлов пока закрыты политикой renderer/download. Просроченные signed URLs обрабатываются существующими экранами, но успешное desktop playback/download ещё не заявляется. Нужен отдельный ограниченный media/download путь.
- OAuth календаря с возвратом в desktop пока отмечен недоступным; внешний переход не запускается. Приложение не подменяет browser OAuth callback.
- Chromium REST и Node WSS используют разные сетевые реализации. Системные CA учитываются в WSS, но корпоративные proxy с авторизацией, VPN и поведение Windows root store требуют реальной проверки; их совместимость пока не заявляется.
- Установщики тестовые, без подписи и автообновления. Production release остаётся заблокирован до этапа выпуска.
- До выпуска необходим authenticated smoke против рабочего backend с отдельной тестовой учётной записью, особенно при отличающемся deployment commit.

Следующий этап — устройства и media: камера/микрофон, выбор устройств, screen capture, WebRTC/TURN и настоящие звонки. Он автоматически не начат.
