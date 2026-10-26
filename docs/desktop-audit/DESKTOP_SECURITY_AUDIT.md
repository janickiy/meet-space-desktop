# Аудит безопасности MeetSpace Desktop

Дата: 26 октября 2026. Исходная точка: `0edb345`, MeetSpace `0.1.11-beta`. Проверены общий Electron main/preload и React renderer Windows/Linux. Изменения выполнялись после фиксации Phase A. Рабочие серверы, пользовательские сообщения и установленный профиль не использовались для этой проверки.

## Результат и границы

Подтверждён и исправлен **SEC-01: удаление профиля при заблокированном хранилище оставляло пригодные для повторного входа cookies**. Дополнительно проверен и обновлён точный Linux capture gate после обновления Electron. Целевой набор из **188 тестов прошёл, 0 ошибок, 0 пропусков** на macOS ARM64. Он использует локальные HTTPS/WSS/SSH fixtures, временные каталоги и внедряемые адаптеры; результат не заменяет проверку настоящих DPAPI/Secret Service, портала Wayland и подписанного установщика на целевой ОС.

Обновление npm-зависимостей закрывает найденные package advisories, но **не закрывает автоматически advisories встроенного Node 24.22.0**. Их достижимость рассмотрена ниже; подтверждённого пути эксплуатации через MeetSpace в этой проверке нет, отсутствие всех путей не доказано. Итоговую готовность выпуска и платформенную матрицу фиксирует `DESKTOP_TEST_REPORT.md`; этот документ не даёт самостоятельного разрешения на production release.

Модель угроз и исходные измерения: `BASELINE_AND_THREAT_MODEL.md`. Зависимости, лицензии, секреты, CI и пакеты: `SUPPLY_CHAIN_EVIDENCE.md`. Lifecycle/ресурсы: `DESKTOP_MEMORY_LEAK_AUDIT.md`.

## SEC-01 — Medium: credentials переживали удаление server profile

**Статус: воспроизведено до исправления, исправлено и проверено.** Код: `desktop/src/broker.ts`, `removeServer`; регрессии: `desktop/tests/broker-policy.test.cjs`.

Условие: ранее сохранён вход в сервер, затем приложение запускается с недоступной системной связкой ключей. Старый `removeServer` удалял карточку сервера, но пропускал `vault.remove`, если `storageReady` был false. ID профиля детерминирован от origin, поэтому добавление того же адреса после разблокировки могло снова использовать оставшиеся cookies. Это нарушение ожидания удаления локального доступа на устройстве; удалённая кража секрета из renderer не продемонстрирована.

Безопасное воспроизведение: временный профиль, зашифрованный fixture vault, фиктивный auth transport. До исправления получено `removedProfile: true`, `storedAuthRemains: true`. Первый новый regression ожидал отказ при заблокированном vault и не получил его. Второй показал несогласованное состояние при ошибке записи: профиль уже удалён, наружу выходит исходная ошибка fixture вместо фиксированного кода.

Исправление:

- Удаление требует доступного защищённого хранилища. Сначала удаляются и сохраняются credentials, затем карточка профиля.
- Ошибка стирания возвращает `secure_storage_unavailable`; профиль и выбор сервера сохраняются для повторной попытки. Активная identity инвалидируется до записи.
- Операция сериализована с login/refresh через существующую auth-очередь, чтобы поздний ответ входа не восстановил cookies после удаления. Новая очередь/публичный API не вводились.

Проверено три сценария: locked vault → unlock → повторное удаление; ошибка encrypt/write → сохранение карточки и сброс identity; пересечение удаления с двумя login-операциями → повторное добавление того же origin без старых cookies. После исправления `broker-policy.test.cjs`: **24/24 PASS**. При ошибке сохранения публичного profiles JSON credentials уже удалены: возможна сохранившаяся на диске карточка, но не восстановление сессии. Транзакция двух файлов не вводилась ради этого исправления.

## Проверенные границы доверия

| Граница | Реализация и проверка | Ограничение результата |
| --- | --- | --- |
| Renderer → ОС | `main.ts`: contextIsolation, sandbox и webSecurity включены; nodeIntegration, webview и mixed content выключены. `preload.ts`: замороженный список typed методов без raw IPC/shell/fs. `security.ts`: owned webContents, точный mainFrame и доверенный origin на IPC | Source review и compiled preload VM-тест; полноценный exploit Chromium sandbox не моделировался |
| Локальное приложение | `protocol.ts`: только GET/HEAD, фиксированный origin/SPA routes/MIME, realpath containment. Тесты raw/encoded/double traversal, foreign authority, symlink escape и API bypass | Проверены временные файлы; не сканировалась вся ОС |
| CSP, navigation, links | Production CSP запрещает удалённый исполняемый код, frames/objects/form submissions; navigation/window-open/webview ограничены. Deep link содержит только bounded invitation/meeting route. External links ограничены выбранным HTTPS origin и фиксированными публичными страницами | Deep link не может выбрать произвольный сервер; поведение стороннего системного браузера не проверялось |
| Renderer → backend | `network/policy.ts`, `broker.ts`: фиксированные методы/пути/query, лимиты JSON/binary/глубины, отсутствие caller-supplied headers/URL. JWT и cookies остаются в main; renderer получает opaque marker. Known-secret reflection и credential keys удаляются из DTO/событий | Содержимое сообщений остаётся пользовательскими данными; redaction не является универсальным DLP |
| TLS/сессии | Production `main.ts:500` использует Chromium `net.request` в отдельной session. Нет insecure fallback/redirect. WSS: `rejectUnauthorized: true`, fresh ticket, без redirects, payload 256 KiB, compression выключена. Cookie vault допускает host-only Secure/HttpOnly/SameSite auth cookies, разделяет profiles/accounts | Node HTTPS fixture проверяет TLS failure/redirect; все особенности Chromium/system CA на каждой ОС здесь не воспроизведены |
| Смена identity | Epoch/abort при logout, смене сервера, сбросе соединений; delayed login, guest isolation, SSE/WSS закрытие, revocation queue проверены. SEC-01 расширяет это на удаление профиля | Offline revocation требует последующего доступа к серверу; локальная авторизация снимается сразу |
| Хранение | `session/vault.ts`: OS encryption, bounded load, атомарная запись с mode 0600 в каталоге 0700. `platform/credential-store.ts`: Linux basic_text и неизвестный backend запрещены. Повреждённый vault не перезаписывается при retry | Реальные DPAPI/Keychain/Secret Service — отдельная native приёмка. Root/OS compromise вне границы защиты |
| Вложения/записи | `asset-policy.ts`, `downloads.ts`: opaque IDs/capabilities, fresh authorization, HTTPS signed URL bounds/TTL, очистка filenames, native Save dialog. До 4 задач/2 GiB, exclusive partial file, backpressure, sync/rename, cancel cleanup. Внешнее хранилище не получает bearer/cookies/Origin | Сохранённый файл не считается безопасным для ручного запуска пользователем; автоматического исполнения нет |
| Медиа/экран | Owned main document, permission scoping, explicit source selection, expiry/cancel и stale-result fencing. Один X11 source не считается согласием портала. Wayland ambiguous/late consent отклоняется | Policy tests не доказывают фактический физический захват/отзыв permission во всех DE |
| Обновления | `updates-policy.ts`, `updates.ts`, `updates-signature.ts`: immutable build trust; HTTPS, Ed25519 manifest, size/SHA-512/arch/version/expiry, anti-rollback; Authenticode текущего EXE и скачанного installer; повторная проверка перед явным запуском | Подпись проверялась адаптером/fixture. Нативный Windows signed update end-to-end в этом подаудите не выполнялся; beta/test/Linux auto-update выключен |

Дополнительно source scan renderer не обнаружил `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` или `document.write` в проверенном `frontend/src`. Это ограниченный поиск опасных sinks, не формальное доказательство отсутствия XSS. Production import test запрещает включение test/fixture modules и вычисляемых runtime import paths. 100 циклов всех preload event subscriptions вернули listener baseline.

## SSH-установщик

Проверены `desktop/src/ssh/{controller,transport,protocol,types,certificate,preflight}.ts` и поставляемый signed runner. SSH fingerprint предъявляется до передачи credentials; каждый authenticated connect закреплён за подтверждённым ключом. Изменившийся ключ не принимается автоматически. Команда фиксирована, параметры передаются данными через stdin; arbitrary shell/renderer path отсутствует. Ограничены размер ответа, время операции, формат UTF-8/JSON; при detach/abort закрываются channel/connection и очищаются принадлежащие операции credential buffers.

Trust root и SHA-256 ресурсов закреплены в приложении; RSA-подпись release/runner проверяется до исполнения. План связывает endpoint, fingerprint, domain, architecture, recipe, выбранный source/image archive и его hashes. Повторный apply требует отдельного подтверждения. Recovery использует исходный signed recipe и исходный plan hash, не подменяет старый job текущим latest. Последний готовый выпуск разрешается на этапе нового плана, затем применяется зафиксированный результат.

SSH password, private TLS key и SMTP password не записываются в public state/recovery tickets. TLS upload проверяет PEM bounds, пару ключ/сертификат, SAN, срок, цепочку/подписи; приватный ключ передаётся только при apply. Server runner применяет фиксированные argv без shell и OpenSSL validation, сохраняет приватные материалы с ограниченными правами. Это не означает гарантированного стирания всех копий JS strings/GC heap; обнуление возможно для контролируемых buffers.

Протокольные, transport и certificate тесты проверяют pin mismatch до auth, fake signing key/substituted bundle, plan tampering, command/path injection, секреты на диске/в DTO, cancel и stale responses. Ни одна проверка этого набора не устанавливала сервер на пользовательском хосте.

Остаточная цепочка доверия: подпись встроенного installer не подписывает автоматически все будущие backend Docker-образы. Release discovery доверяет разрешённому HTTPS publisher endpoint, дальнейшие archive hashes/image IDs фиксируются планом. Это защищает перенос/подмену после планирования, но не компрометацию аккаунта upstream publisher до планирования. Сборка из исходников также не полностью hermetic (дистрибутивные пакеты/сетевые источники). Изменять подписанный runner или объявлять существующие данные недоверенными без доказательства аудит не пытался.

## Встроенный Node: остаточная уязвимая версия и достижимость

Фактически запущенный новый Electron: **44.9.3 / Chromium 152.0.7977.167 / Node 24.22.0 / Undici 7.29.1**. Версии подтверждены `ELECTRON_RUN_AS_NODE` и upstream [Electron DEPS](https://raw.githubusercontent.com/electron/electron/v44.9.3/DEPS). Патчи npm Undici относятся к build tools, не заменяют этот встроенный модуль. См. SC-05 в `SUPPLY_CHAIN_EVIDENCE.md`.

Node выпустил исправления DNS/TLS/Brotli, HTTP reuse и snapshot entropy в 24.22.1. High: CVE-2026-105482, CVE-2026-105483, CVE-2026-106069, CVE-2026-111497. Medium: CVE-2026-105481, CVE-2026-106072, CVE-2026-106074. Low CVE-2026-106073 касается Node permission model. [Официальный bulletin](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

| Поверхность | Наблюдение по приложению | Вывод |
| --- | --- | --- |
| DNS NUL | Origin validator отвергает NUL/control/percent; прямых `dns.resolve*`/`dns.reverse` в app source не найдено; SSH endpoint отдельно валидируется | Указанный путь через эти API не обнаружен |
| TLS нестандартных IP | Broker сохраняет WHATWG canonical origin; WSS строится от него, `ws` снова разбирает URL и передаёт canonical hostname в TLS. Нет custom lookup/checkServerIdentity | 6 локальных vectors с fullwidth/octal/hex/short/integer IPv4 дают одинаковый canonical host перед соединением. Это снижает конкретный риск representation mismatch, не доказывает исправление встроенного TLS |
| Brotli / Undici | Production HTTP/update идут через Chromium net; прямых Node fetch/EventSource/Undici и Node Brotli decode в app source не найдено. Renderer fetch исполняется Chromium. WSS compression выключена; SSH compression — zlib inflate, не Brotli | Прямая доставка недоверенного Brotli в Node decoder не обнаружена. Chromium собственные CVE оцениваются отдельно |
| Node HTTP keep-alive | `ws` использует Node HTTPS upgrade. Успешное соединение переходит в WebSocket; обработка неуспешных handshake уничтожает запрос | Exploit повторного HTTP response не воспроизведён; безопасность всех вариантов Agent reuse не доказана |
| Snapshot/permission model | Приложение не собирает user-land Node startup snapshots/SEA и не полагается на Node `--permission` для renderer. Renderer защищается Electron sandbox | Указанные app-level условия не найдены; это не аудит всех внутренних snapshot-механизмов Electron |

Undici advisories требуют обновления встроенного runtime при появлении соответствующего Electron; наличие уязвимого компонента сохраняется даже при не найденном app path. [Undici advisory](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c). Не введены TLS bypass, произвольная замена Node внутри Electron или отключение sandbox как обход. До обновления embedded runtime нельзя заявлять «все HIGH зависимости устранены» только на основании npm audit.

## Проверка точного gate захвата Linux после обновления Electron

Старый gate разрешал только Electron 44.7.1 / Chromium 152.0.7977.149. Dependency update без изменения gate отключил бы screen capture на Linux. Сначала обновлены vectors: два ожидаемых Linux-сценария упали. После проверки исходников gate закреплён только за **44.9.3 / 152.0.7977.167**; произвольные и смешанные версии по-прежнему возвращают `unavailable`.

Проверено: Electron создаёт generic capturer с Chromium capture options, ждёт delegated source selection и обрабатывает dismissal; Chromium включает `allow_pipewire`; WebRTC требует `allow_pipewire && IsRunningUnderWayland`, читая raw `XDG_SESSION_TYPE` и наличие `WAYLAND_DISPLAY`. App допускает более узкий случай: строго `wayland` + непустой display, либо строго `x11` + DISPLAY без WAYLAND_DISPLAY. Xwayland app window сам по себе не отменяет portal. Источники: [Electron desktop capturer](https://raw.githubusercontent.com/electron/electron/v44.9.3/shell/browser/api/electron_api_desktop_capturer.cc), [Chromium options](https://raw.githubusercontent.com/chromium/chromium/152.0.7977.167/content/public/browser/desktop_capture.cc), [Chromium DEPS](https://raw.githubusercontent.com/chromium/chromium/152.0.7977.167/DEPS), [WebRTC e1991d7](https://webrtc.googlesource.com/src/+/e1991d7f7bd00eaa701dcdd8d6786b746c623c30/modules/desktop_capture/desktop_capturer.cc).

Файлы: `desktop/src/platform/display-capture.ts`, `desktop/tests/platform-display-capture.test.cjs`. Результат **5/5 PASS**; это source/policy verification, не PASS физического Wayland/PipeWire capture.

## Воспроизводимость

### Подготовка reference runtime при чистой Linux-сборке

В нативном изолированном каталоге Ubuntu после `npm ci` подтверждён сбой `verify-linux-artifacts.mjs`: `node_modules/electron/dist/chrome-sandbox` отсутствовал. Electron 44 использует lazy download: установка npm-пакета сама по себе не создаёт `dist`; electron-builder скачивает другой экземпляр для пакета. Ручной первый `require('electron')` устранял симптом, но не обеспечивал воспроизводимый pipeline.

`package-linux.mjs` теперь перед сборкой вызывает `prepare-linux-electron.mjs`: запускает installer закреплённого npm-пакета с явными Linux/architecture и встроенными checksums, затем проверяет версию и ELF architecture reference-файлов. Electron payload не запускается. Ошибка загрузки, несовпадение версии или архитектуры останавливают сборку. Статический verifier не получил сетевых побочных эффектов и продолжает сравнивать точные байты payload с reference.

Регрессии используют фактический vendor `install.js`; только сеть и распаковка заменены инертными адаптерами. Проверены отсутствующий dist для x64/ARM64, повторная подготовка без загрузки, неверные inherited target/override/checksum env, ошибка загрузки, несовпадение cached architecture и project pin. Вместе с существующими packaging-тестами: **33 PASS / 0 FAIL / 0 SKIP**. Native повтор чистой сборки учитывается отдельно в итоговом test report; локальные fixtures не выдаются за native package acceptance.

Результаты сохранены в игнорируемом Git каталоге `desktop/artifacts/desktop-audit-20261026/security/`:

- `focused-tests.tap` — 188 PASS, 0 FAIL, 0 SKIP, 715 ms; локальные fixtures и адаптеры.
- `origin-canonicalization.json` — actual embedded versions, 6 IP vectors, два варианта NUL отклонены. Сетевых соединений этот probe не открывает.
- `linux-package-reference-tests.tap` — 33 PASS: подготовка reference runtime и Linux packaging policies/readers/driver.

Сборка перед тестами: `cd desktop && npm run build:main`. Целевой набор:

```sh
node --test tests/security.test.cjs tests/security-boundaries.test.cjs \
  tests/broker-policy.test.cjs tests/broker-network.test.cjs tests/transport-network.test.cjs \
  tests/platform-credentials.test.cjs tests/assets-policy.test.cjs tests/assets-network.test.cjs \
  tests/updates-policy.test.cjs tests/updates-network.test.cjs \
  tests/ssh-installer-native.test.cjs tests/ssh-installer-protocol.test.cjs \
  tests/ssh-installer-certificate.test.cjs tests/ssh-installer-transport.test.cjs \
  tests/ssh-installer-preflight.test.cjs tests/media-permissions.test.cjs \
  tests/platform-display-capture.test.cjs
```

Не выполнялись в этом подаудите: атаки на production, удалённая установка/очистка, изменение пользовательской связки ключей, публикация, security exploitation сторонних серверов, реальный Authenticode upgrade, полный Git history/binary secret scan. Native runtime/media и полная ОС-матрица учитываются только по свежим результатам основного test report.
