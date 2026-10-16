# Этап 07 — проверка границ безопасности

Проверено 14 октября 2026, 05:24 UTC. В рассмотренной области новых воспроизводимых P0/P1 не обнаружено. Это результат ограниченного аудита и отрицательных тестов, а не утверждение об отсутствии всех уязвимостей или готовности Windows release.

## Область и baseline

- Репозиторий: `66e482c9701b6c13f58bc93aee8d9f5cf932dd34`, рабочее дерево содержит незакоммиченные изменения этапов 01–06.
- Существующая сборка: `0.6.0-test`, `sourceTreeSha256=f5c25c19070fa7bcf7404b44be2b9f71b89f233b6d4e0930f3fca55a68a9c5c4`.
- Перед тестированием SHA256 всех **21 файла `desktop/src`** совпали с `desktop/dist/source-inputs.json`. Тесты ниже использовали уже собранный `dist`, без запуска `npm test`/`pretest`, компиляции, Vite или packaging.
- Исполнение: Node **24.19.0**, macOS/Darwin **ARM64**. Electron установлен **44.7.1**. Запуск Electron в рамках этой отдельной проверки отложен, чтобы не исказить параллельные измерения CPU/памяти; его результаты фиксируются отдельно в общем QA-отчёте.
- Проверены `security.ts`, `protocol.ts`, `preload.ts`, `broker.ts`, `network/*`, `session/vault.ts`, `server/profiles.ts`, `updates*.ts`, import boundaries и зависимости. `main.ts` использован для сверки регистрации IPC; полный аудит main/lifecycle, downloads, native shell и медиаресурсов выполняется отдельными QA-проверками.
- Новых runtime-изменений по результатам этого аудита нет. Добавлены только `desktop/tests/security-boundaries.test.cjs` и этот документ. Production HTTP-запросы, изменение серверных данных и доступ к пользовательским паролям не выполнялись.

## Выполненные проверки

`PASS` в таблице относится только к указанному виду проверки. Отрицательный тест считается успешным, когда запрещённая операция отклонена.

| Проверка | Результат | Что действительно исполнялось |
| --- | --- | --- |
| `security.test.cjs` | **PASS 23/23** | URL/route/deep-link/CSP/sender policy; реальные временные файлы, traversal и symlink; mock sender objects, без Chromium |
| `broker-policy.test.cjs` | **PASS 15/15** | HTTP schema/allowlist, секреты/opaque marker, cookie scope, offline logout, поздний login, guest, native-only metadata filter; управляемые transport seams |
| `broker-network.test.cjs` | **PASS 8/8** | Реальные локальные HTTPS/WSS/SSE, два сервера, refresh, account/guest, revoke queue, abort/reset; временный доверенный CA и тестовый cipher |
| `transport-network.test.cjs` | **PASS 5/5** | Node HTTPS: недоверенный и wrong-host сертификаты, DNS, timeout, redirect, размер ответа, cancel; без отключения TLS |
| `updates-policy.test.cjs` | **PASS 6/6** | Настоящие Ed25519 signatures, canonical payload, version/arch/expiry/publisher pins; Windows verifier error seams |
| `updates-network.test.cjs` | **PASS 7/7** | Реальный локальный HTTPS, SHA512/Ed25519, повреждённый installer, replay, redirect, concurrent/cancel/dispose; Authenticode и запуск EXE заменены явно обозначенными тестовыми адаптерами |
| `release-policy.test.cjs` | **PASS 4/4** | Readiness/manifest gate на синтетических evidence reports, подпись настоящим временным ключом; без настоящего Windows signing |
| `security-boundaries.test.cjs` | **PASS 3/3** | Статический import scan 21 desktop + 127 shared frontend файлов; реальный скомпилированный preload в Node VM с IPC adapter |
| Общее число выбранных Node-тестов | **PASS 71/71** | 68 существующих + 3 новых; ни один runtime исходник для этого не менялся |
| Desktop runtime `npm audit --omit=dev --json` | **PASS**, 0 известных vulnerabilities | Проверка registry advisory database; единственная прямая runtime dependency — `ws@8.22.0` |
| Desktop full `npm audit --json` | **PASS**, 0 известных vulnerabilities | 301 dependency в metadata отчёта, включая build tooling |
| Frontend runtime и full `npm audit` | **PASS**, 0 известных vulnerabilities в обоих отчётах | 78 dependency в metadata полного отчёта |
| Baseline x64/ARM64 ASAR inventory | **PASS**, read-only | По 158 entries: нет `src`, `test(s)`, `fixture(s)`; trust `{enabled:false}` в обоих |
| Chromium sandbox/CSP, реальная доставка IPC и OS safeStorage | **NOT_RUN этим аудитором в этапе 07** | Не подменяется Node VM-тестом; отдельный последовательный Electron regression запускает координатор QA |
| Windows 10 x64 / Windows 11 x64 / Windows 11 ARM64 | **NOT_RUN** | Windows VM/device отсутствует; policy unit tests не доказывают совместимость ОС |
| Настоящая Authenticode verification/install/upgrade и signed ASAR enforcement | **NOT_RUN** | Нет Windows, сертификата, подписанного кандидата и настроенного release feed |

При первом запуске нового import-test была ошибка тестового инструмента: установленный native TypeScript 7 не предоставляет прежний JS parser API. Runtime код не участвовал в ошибке. Тест переведён на явную лексическую проверку используемых форм import/re-export/require, включая отдельные отрицательные примеры. Он не объявляется полноценным AST-анализатором. Итоговый повтор: 3/3 PASS.

Повторяемый запуск выбранных тестов из `desktop`, без build hooks:

```sh
node --test tests/security.test.cjs tests/broker-policy.test.cjs \
  tests/broker-network.test.cjs tests/transport-network.test.cjs \
  tests/updates-policy.test.cjs tests/updates-network.test.cjs \
  tests/release-policy.test.cjs tests/security-boundaries.test.cjs
```

## Проверенные решения и границы доказательств

**IPC и preload.** [security.ts:136](../../desktop/src/security.ts#L136) проверяет одновременно принадлежность `webContents` активному окну, точное равенство `senderFrame` текущему main frame, живое окно и допустимый origin. Одного совпадения origin недостаточно. `preload.ts` экспортирует замороженный набор операций; универсальные `ipcRenderer`, `invoke`, `send`, filesystem или shell API отсутствуют. Тест исполняет compiled preload и подтверждает: аргументы feed URL/EXE path не попадают в update IPC; обработчик события получает только payload, без привилегированного Electron event. После **100** subscribe/unsubscribe циклов каждого из трёх event APIs число listeners возвращается **0 → 1 → 0**. Это измерение адаптера EventEmitter, не heap/main-process measurement.

**Локальный renderer и deep links.** [security.ts:90](../../desktop/src/security.ts#L90) принимает только `meetspace://open/i/<32 ASCII chars>` и `meetspace://open/{meetings|conferences}/<UUID>/join`; URL не может задавать сервер, query, hash или команду. [protocol.ts](../../desktop/src/protocol.ts) отвергает raw/encoded traversal, чужой initiator, mutating methods и symlink за пределы renderer root. SPA fallback ограничен известными routes. CSP допускает bundled scripts/styles, запрещает remote executable code, inline scripts, `eval`, frames, objects и формы; dev nonce/loopback явно отделены от production. CSP ограничения HTTP/fetch **не являются запретом WebRTC ICE/RTP**: медиасоединения используют отдельный Chromium WebRTC стек.

**HTTPS, cookies и server isolation.** [network/policy.ts:66](../../desktop/src/network/policy.ts#L66) связывает метод с реальным API path и ограниченными query keys. Renderer не передаёт headers или произвольный URL. [broker.ts:372](../../desktop/src/broker.ts#L372) проверяет форму запроса, opaque marker и лимиты JSON 2 MiB / binary 10 MiB; epoch fence прекращает поздние ответы при смене identity/server и reset. JWT остаётся в main, persistent auth cookies — в OS-encrypted vault с host/profile и auth-path scope. Logout немедленно удаляет локальную identity, а offline revocation сохраняется в зашифрованной очереди. Guest resume и отдельная saved account cookie проверены отдельно.

[network/transport.ts:142](../../desktop/src/network/transport.ts#L142) использует отдельную native session, `credentials:'omit'`, `useSessionCookies:false`, `redirect:'error'`. Chromium автоматически добавляемые `Sec-Fetch-*` удаляются только для активного native request с совпавшими method/URL. Запросы renderer/frame, неактивный URL и любой `Origin` отклоняются. Origin сервера не подделывается. Node HTTPS использует `rejectUnauthorized:true`. Локальные TLS-тесты относятся к Node adapter; Chromium/system trust store на Windows в этом этапе не проверен. WSS использует `ws` с TLS verification, системными/default CA, запретом redirects/compression и fresh main-only ticket. Автоматическая поддержка корпоративного proxy у Node WSS не доказана и не приравнивается к Chromium HTTP proxy.

**Ограничение потоков.** В [broker.ts:115](../../desktop/src/broker.ts#L115) максимум 64 одновременных operations/streams/sockets. WSS inbound limit 256 KiB и 200 messages/s; outbound signaling — 64 KiB, 40/s и привязка к conference UUID/type. SSE имеет ограниченный pending buffer 256 KiB и event rate. Подписки удаляются при close/reset/dispose; долгосрочные CPU/heap/handle measurements приведены в отдельном профиле QA, здесь они **не измерены**.

**Обновления.** [updates-policy.ts](../../desktop/src/updates-policy.ts) и [updates.ts](../../desktop/src/updates.ts) принимают immutable build-time trust, отдельный от выбранного MeetSpace server. Feed нельзя изменить IPC-параметром. Unsigned/default/unpackaged/unsupported режимы не обращаются к update network и не создают cache. Signed-путь проверяет текущий EXE, Ed25519 metadata, app/channel/arch/version/expiry, exact filename/size/SHA512, затем Authenticode/publisher/certificate/timestamp. Перед install повторяются fresh metadata, hash и signature. Redirects, downgrade, неверный размер/hash, неверный сертификат и поздняя completion после cancel не приводят к запуску. Download/install требуют явного действия; автоматическая проверка только читает metadata. После spawn updater не удаляет запущенный installer при quit.

[updates-signature.ts](../../desktop/src/updates-signature.ts) использует фиксированный PowerShell command, `-LiteralPath` через отдельное environment поле, `shell:false`, ограничение времени и вывода. Missing PowerShell, stderr, invalid JSON или неполный signature report закрывают путь обновления. Это зависит от доверенной локальной Windows installation/environment (`SystemRoot`); настоящая проверка цепочки сертификатов и запуск NSIS не выполнены на macOS. Signed release fuses/ASAR integrity проверены **по исходникам и policy-тестам**, не на выпущенном signed EXE.

**Fixture separation и зависимости.** В production source imports отсутствуют зависимости на `tests/fixtures` и удалённые executable modules. В двух существующих test ASAR нет fixture/test/source файлов. `dist/acceptance.js` намеренно присутствует в unsigned diagnostic сборке; release build удаляет его, что проверено по исходникам build/verifier, без signed build. Native test transport factory остаётся кодом библиотеки, но test CA/fixture/credential данные не импортируются в приложение; packaged main не принимает host-test broker overrides. Version-pinned builder repair имеет отдельный exact SHA256 guard и описан в [06_NSIS_REPRODUCIBILITY_FIX.md](06_NSIS_REPRODUCIBILITY_FIX.md). Нулевой `npm audit` не проверяет всю поверхность Chromium/ОС и не заменяет обновление Electron.

## Актуальная карта routes / API / WS / ICE

Все API ниже — относительные пути **выбранного HTTPS server**, а не origin packaged UI. `{id}` обозначает UUID; `{code}` — 32 символа приглашения. Это сверка кода, не новые live-запросы.

| Сценарий UI | Фактический контракт | Desktop boundary / источник |
| --- | --- | --- |
| Выбор сервера, login/register/settings | `GET /version`; `GET /api/v1/{auth/me,capabilities}`; `POST /api/v1/auth/{register,login,refresh,session,accounts/list,accounts/switch,logout}`; `GET/PATCH/DELETE /api/v1/auth/me` | Probe ожидает version major 1 и 401 защищённых endpoints до login; main владеет cookies/JWT. `broker.ts:244`, `platform_routes.go:17` |
| `/i/{code}`, `/meetings/{id}/join`, `/conferences/{id}/join` | `GET /api/v1/conference-invites/{code}`; `POST …/{join,guest}`; `POST /api/v1/conferences/{id}/{join,leave}` | OS deep link несёт только allowlisted route. `security.ts:90`, `platform_routes.go:17`, `guest_routes.go` |
| Meetings/calendar/history/moderation | `GET/POST /api/v1/conferences`; `GET /api/v1/me/conferences`; `POST …/{start,finish,cancel}`; `PUT …/schedule`; `POST …/participants/{id}/{admission,moderation}`; `PUT …/participants/me/media` | Method/path allowlist + server authorization. `network/policy.ts:10`, `platform_routes.go:37` |
| Личные/конференц-чаты, folders, calls | `/api/v1/conversations`, `/{conversations|conferences}/{id}/messages`, `/folders`, `/folder-items`, `/calls/{id}/{accept,decline,cancel,end,heartbeat}` | Только перечисленные методы/UUID paths; renderer не получает универсальный proxy. `network/policy.ts:23` |
| Account realtime | `POST /api/v1/ws-ticket` → `WSS /api/v1/ws?ticket=…` | Ticket извлекает main; без Cookie/Bearer в handshake. Не доступен через generic HTTP renderer API. `broker.ts:454`, `websocket/user_handler.go:50` |
| Conference realtime/SFU signaling | `POST /api/v1/conferences/{id}/ws-ticket` → `WSS /api/v1/conferences/{id}/ws?ticket=…`, subprotocol `go-recorder.v1` | `media.join/offer/answer/ready/ice/leave/unpublish` и legacy `webrtc.offer/answer/ice`; привязка к conference. `broker.ts:497`, `websocket/handler.go:166` |
| Notifications | `GET /api/v1/notifications/events` (SSE); `GET /notifications`, `POST /notifications/{id}/read`, `GET/PUT /notifications/preferences` с общим `/api/v1` | `streamOpen({id,token})` фиксирует URL, не принимает произвольный stream path; парсит и ограничивает события. `broker.ts:514`, `notification_routes.go:14` |
| ICE / TURN | `GET /api/v1/webrtc/config`; событие `media.joined` содержит `iceServers`, `iceTransportPolicy`, `iceExpiresAt`; `media.offer/answer/ice` передаёт SDP/candidates | `frontend/src/media.ts:1483,1662`: Chromium `RTCPeerConnection`, `max-bundle`, policy `all|relay`; TURN short-lived credential намеренно передаётся Chromium и не является JWT/cookie. `internal/config/turn.go:66`; локальный controller forwarding fix `internal/usecase/media/controller.go:402` ещё требует отдельного deployment, deployment здесь не делался |
| Recordings/files | `GET /api/v1/conferences/{id}/recordings/{recordingId}`; `GET /api/v1/{conferences|conversations}/{id}/attachments/{attachmentId}/download`; authenticated conversation content endpoint | Native asset actions передают IDs; recording DTO `files[].url` удаляется. AuthorizeAsset получает fresh authority в main. Подробная download/playback QA — отдельная область, не заявлена проверенной этим аудитом |
| Обновление приложения | `<trusted-feed>/stable/win-{x64|arm64}/latest.json` и exact versioned installer filename | Полностью отдельная build-time authority; не `/api/v1`, не URL из server profile. `updates-policy.ts:74`, `updates.ts:134` |

## Electron / Chromium и матрица Windows

Официальный [release Electron 44.7.1](https://releases.electronjs.org/release/v44.7.1) опубликован 13 октября 2026 и содержит Chromium **152.0.7977.149**, Node **24.21.0**, V8 **15.2.124.37**. Это версии Electron runtime, отличные от Node 24.19.0, которым запускались локальные unit tests.

Tagged [README Electron 44.7.1](https://raw.githubusercontent.com/electron/electron/v44.7.1/README.md) указывает Windows 10 и новее, бинарные x64/ARM64. Текущие [требования Chrome](https://support.google.com/chrome/a/answer/7100626?hl=en) сохраняют Windows 10+ для Intel, Windows 11+ для ARM; прекращение поддержки Chrome для Windows 10 не запланировано. Эти документы подтверждают выбор baseline, но не запуск MeetSpace на каждом целевом устройстве.

[Политика Electron](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) поддерживает три последние stable major линии и актуальный minor в каждой. На дату проверки [schedule](https://releases.electronjs.org/schedule) показывает Electron 44 как поддерживаемый, с плановым EOL **2 марта 2027**; дата может измениться. Windows 10 22H2 остаётся в требуемой матрице приложения, однако обычная поддержка Microsoft Home/Pro закончилась **14 октября 2025** — это отдельный жизненный цикл ОС, не доказательство прекращения поддержки Chromium. Источник: [Microsoft lifecycle](https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro).

| Цель | Обоснование выбора runtime | Реальный запуск MeetSpace в этапе 07 |
| --- | --- | --- |
| Windows 10 22H2 x64 | Electron tagged support + Chrome Intel Win10 + app policy build 19045 | **NOT_RUN**, release blocker для полной acceptance |
| Windows 11 x64 | Electron/Chrome Windows support + app policy | **NOT_RUN**, release blocker |
| Windows 11 ARM64 native | Electron ARM64 binary + Chrome ARM Win11 + app policy | **NOT_RUN**, release blocker; cross-build PE/ASAR не заменяет native runtime |
| Windows 10 ARM64 / x86 | Вне согласованного объёма, app policy отклоняет | Не объявляются поддерживаемыми |

Аудит ориентирован на [официальные рекомендации Electron security](https://www.electronjs.org/docs/latest/tutorial/security): sender validation, минимальный preload, CSP, sandbox, TLS, local protocol, ограничение навигации и поддерживаемая версия. Усиление signed release через ASAR integrity и запрет загрузки вне ASAR соответствует [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses).

## Оставшиеся blockers и вывод

Для выпуска с заявленной полной матрицей остаются реальные Windows проверки трёх целей и подписанный release/update lifecycle. Пока отсутствуют signing identity/feed и signed evidence, updater корректно **disabled**; это не успешно проверенное автоматическое обновление. Корпоративный WSS proxy, реальные Windows trust store/DPAPI/PowerShell/NSIS и signed ASAR tamper enforcement — **NOT_RUN**.

В проверенной области нет подтверждённого основания для P0/P1 runtime patch. Дополнительные source-only выводы не повышены до runtime PASS. Общий результат этапа 07 должен учитывать отдельные media/product/lifecycle/leak тесты и сохранять перечисленные release blockers.
