# Desktop memory and resource lifecycle audit

Audit date: 2026-10-26. Initial source commit: `0edb3451cb90d402eb81979115373a3de7fddf8d` (`0.1.11-beta`). This report distinguishes reviewed ownership, local stand-in tests and actual Electron measurements. Passing a local adapter test does not certify Windows or Linux native drivers.

## Decision and scope

No new application resource leak was confirmed in the reviewed paths or completed lifecycle suites. No production cleanup change is justified by those results alone. The first actual Electron profile completed 100 chat navigation cycles but failed its strict resource-equality assertion because its silent SSE fixture repeatedly exceeded its own two-second idle timeout. The corrected fixture subsequently passed the complete profile on Electron 44.9.3. Separate real Chromium/Pion lifecycle and two-peer direct/TURN scenarios passed. Native media wrappers persisted temporarily after stop and declined across later snapshots; this is recorded below rather than being hidden by the narrower JS-object counters. The initial failing profile remains preserved and must not be labelled PASS.

Hardware capture release, long calls, physical suspend/resume and native Windows HANDLE behaviour require platform-specific verification. See [test matrix](DESKTOP_TEST_REPORT.md) and [performance report](DESKTOP_PERFORMANCE_REPORT.md) for the overall audit status and fresh Electron reruns.

Local evidence root: `desktop/artifacts/desktop-audit-20261026/` (ignored, not a release artifact). Heap snapshots are local evidence only; arbitrary heap strings can contain session data and should not be published. This audit used disposable fixture accounts, temporary profiles and local TLS servers, without accessing live user profiles or production servers.

## Reproduction and measurement method

Executed from the repository root with Node `v24.19.0` on macOS ARM64:

```sh
node --expose-gc desktop/tests/native-lifecycle.cjs
node frontend/scripts/check-media-lifecycle.mjs
```

The first command uses the already-built production desktop modules. It ran after the root audit's baseline build, without rebuilding concurrently. The native JSON records source and compiled-module SHA-256 values and the source commit. Reports/logs copied to `native-lifecycle.json`, `native-lifecycle.log`, and `media-unit-lifecycle.log` under the evidence root.

The native harness measures explicit owners and cleanup invariants after warm-up and 100 measured cycles. Weak-reference checks remove instrumentation's strong references and run GC across event-loop turns. Its TLS/file exercise performs real local HTTPS transport and disk writes; window, tray, notification and capture enumerator adapters are synthetic.

The media suite imports production media/output-routing modules through the existing script, using controlled track/stream/peer/device stand-ins to reproduce unresolved permissions, late sender promises and stale sink selection. These tests prove ownership decisions and race handling; they do not measure Chromium codecs, native capture sessions or an actual Pion SFU.

## Completed lifecycle checks

| Scenario | Warm-up / measured work | Before → after | Result |
| --- | --- | --- | --- |
| Native window geometry / tray disposal | 10 / 100 cycles; 20 resize/move events each | Geometry timers 0 → 0; screen listeners 0 → 0; live tray adapters 0; retained window adapters after GC 0 | PASS |
| Desktop picker consent / cancellation | 12 / 100 cycles | Pending request 0 → 0; timers 0 → 0; 25 selections, 75 cancellations, including 25 late enumerations and 25 timeouts | PASS |
| Native notification lifetime | 10 / 100 cycles × 20 messages, plus 600-message burst | Visible/dedup/active adapters 0 → 0; 2,600 created / 2,600 closed; retained adapters after GC 0; stale navigation callbacks 0 | PASS |
| Native private attachment streams / saves | 10 / 100 cycles | Jobs, media, timers, leases, broker operations all 0 → 0; 302 leases authorized / 302 released | PASS |
| Partial file / cache cleanup | Same attachment exercise | 50 successful ranges, 50 aborted streams, 50 successful saves, 50 cancelled saves, one extra active unread stream disposed; remaining partial files/cache directories/abort listeners all 0 | PASS |
| Media lifecycle and output routing races | 39 local tests | 39 passed, 0 failed, 0 skipped | PASS |

Observed bounded peaks: one geometry timer, two global screen listeners, one picker timer, eight visible native notifications and 512 notification dedup entries. The attachment workload had at most one active job, media lease, concurrent stream request and playback expiry timer at each relevant checkpoint. These are fixture workload observations, not maximum supported application concurrency claims.

The attachment fixture's whole Node-process heap after GC was **10,702,720 → 11,402,544 bytes** (+699,824). This includes TLS and test infrastructure. A single endpoint delta does not establish a retained-object leak, nor does it prove an improvement; application-owned cleanup counters returned to zero.

Media regression coverage includes:

- Leave while camera permission, screen consent or sender replacement is unresolved: late captures are stopped and cannot install a new peer/sender.
- Moderator revocation and unplug events during join or replacement; old input is released only after successful replacement and remains usable after a failed busy-device replacement.
- Screen stop releases both video and system-audio tracks before deferred signalling cleanup resolves; cancelled intent cannot be resumed by late consent.
- `pagehide` and desktop suspend release subscriptions/capture intent, and resume does not silently capture again.
- Remote audio remains muted until the selected sink is resolved. Old inventory, failed sink changes and late `play()` completion cannot override a newer selection or undo disposal.
- Test sounds honor output and volume; reused notification audio resets to system output after saved-device removal and rejects stale preference completions.

## Actual Electron profile: initial run and profiling fix

Evidence: `mac-baseline-v2/stage07-profile-baseline.json`, four `stage07-baseline-*.heapsnapshot` files, and `mac-baseline-v2/retained-heap-analysis.json`. Runtime: Electron **44.7.1**, Chromium **152.0.7977.149**, macOS ARM64. Source-tree digest: `b3be2f0a314e8bcdc95ca43b1a099b60de8cbb621d1652b948e6d2ac8039e5d2`. The harness runs real application main/preload/shared React with disposable HTTPS/WSS/SSE fixtures; the network transport is the repository's Node TLS adapter with a test CA. It is not a real server workload.

The run completed 10 warm-up and 100 measured personal-chat open/close cycles. Main and renderer GC preceded metric checkpoints. Heaps were captured after warm-up and settling. The hidden window makes frame-rate/jank measurement unavailable.

| Metric | Warm-up | Settled after 100 cycles |
| --- | ---: | ---: |
| Main V8 used heap | 9,424,952 B | 9,278,804 B |
| Renderer V8 used heap | 5,117,288 B | 5,872,036 B |
| DOM nodes | 839 | 839 |
| Documents | 4 | 4 |
| DOM event listeners | 236 | 237 |
| Numeric file descriptors across measured processes | 151 | 147 |
| Native account WebSockets | 1 | 1 |
| Additional account WebSockets during chat cycles | — | 0 created / 0 closed |
| Broker SSE streams / application main timers | 1 / 1 | 0 / 0 |
| Windows / tray | 1 / present | 1 / present |

Main process, window, webContents, IPC and power-monitor listener maps matched between endpoints. The strict resource equality assertion failed specifically on SSE streams and their main-process timeout. Execution stopped there, so the later shutdown, profile-switch, crash/reload and additional typed-IPC scenarios in this run were **not executed**.

### MEM-TEST-01 — unstable SSE baseline (confirmed, test reliability)

`desktop/tests/stage07-profile-electron.cjs` injects `createNodeHttpsTransport({ timeoutMs: 2000 })`. The previous `desktop/tests/fixtures/https-fixture.cjs` wrote only `: connected` and then stayed silent. `desktop/src/network/transport.ts` correctly expires an idle request, while `frontend/src/notifications.ts` reconnects after a one-second retry delay. A 2,500 ms settle or a 350 ms pause plus GC/snapshot work could therefore sample the retry gap. Samples alternated between one and zero streams; they did not accumulate streams.

Minimal fix: add an optional fixture heartbeat, default off, and enable a 250 ms SSE comment heartbeat only in `stage07-profile-runner.cjs` for both profile fixtures. Clear its interval on response close and on fixture shutdown. No production network timeout, retry rule or connection cleanup was relaxed. Existing quiet-stream fixtures continue testing timeout/reconnect behaviour.

Verification: `profile-heartbeat-check.log` records a real local HTTPS check that default fixtures remain silent, the opt-in heartbeat arrives, client disconnect removes the heartbeat interval, and fixture shutdown removes an active interval. All assertions passed. Syntax/import checks of all three modified harness files passed. Fresh profile results belong in the performance report and the follow-up section below; this initial failing result remains preserved.

### Retained-heap inspection of the initial run

Analysis command: `node desktop/tests/stage07-retained-heap.mjs <new-output.json> <warmup-main> <settled-main> <warmup-renderer> <settled-renderer>`. Output is deliberately restricted to known constructor groups and aggregate counts; it does not emit heap strings, URLs or property values.

The analyzer computes immediate dominators on raw snapshot edges excluding weak edges. It does **not** reproduce all DevTools page-ownership, shortcut or ephemeron heuristics; group unions overlap and must not be added across groups. These are retained graph accounting values, not RSS or guaranteed memory bounds.

| Retained group | Warm-up → settled count | Union retained bytes, warm-up → settled |
| --- | --- | --- |
| Main `MeetSpaceBroker` | 1 → 1 | 6,316 → 7,128 |
| Main `NativeAssets` | 1 → 1 | 956 → 956 |
| Main `NativeUpdates` | 1 → 1 | 2,740 → 2,740 |
| Main `NativeShell` | 1 → 1 | 1,600 → 1,600 |
| Main `NativeNotifications` | 1 → 1 | 2,084 → 2,084 |
| Main `WebSocket` objects | 2 → 2 | 8,396 → 8,224 |
| Main `Timeout` objects | 9 → 4 | 1,084 → 492 |
| Renderer query objects, identified by property shape | 17 → 17 | 6,548 → 6,464 |
| Renderer `DOMTimer` | 23 → 20 | 8,212 → 7,112 |

Renderer total reachable raw-graph self bytes changed from 9,411,289 to 10,106,969 (+695,680). With no growth in the sampled owner/query/DOM counts and only one workload run, this is not a confirmed leak. A repeated comparable stable profile is required before claiming either a regression or an improvement. RSS rose after heap capture; snapshot instrumentation itself materially changes process working sets, so that rise must not be attributed to an application leak.

## Ownership review

| Resource boundary | Verified cleanup in source | Evidence / limitation |
| --- | --- | --- |
| Main window and renderer | `desktop/src/main.ts`: full-document navigation, renderer crash and close cancel picker, reset assets, notification context and broker connections; same-document navigation preserves account transport. Shutdown disposes services after renderer grace period. | Source review; native window adapters tested. Fresh Electron profile passed crash/reload, switch and final transport release. |
| Tray and OS display listeners | `desktop/src/native-shell.ts`: window close clears debounce timer and removes screen listeners; `dispose()` destroys tray and monitor. `desktop/src/platform/status-notifier.ts`: cancels probe and poll timer on dispose, guards late completion. | 100 window/tray adapter cycles; no native Windows tray HANDLE certification. |
| IPC subscriptions | `desktop/src/preload.ts`: each event subscription returns `removeListener`; `frontend/src/platform/transport.ts`: socket finish removes transport and abort listeners. | Source review and media subscription tests. |
| HTTP / WebSocket / SSE | `desktop/src/broker.ts`: identity reset aborts operations, deletes and closes sockets/streams; stream completion removes ownership in `finally`. `desktop/src/network/transport.ts`: timeout and abort listener cleaned on terminal response/error. | 100 private asset cycles; initial Electron account WS stable across 100 chat cycles. SSE profile defect described above. |
| Account and meeting realtime | `frontend/src/personalRealtime.ts`, `realtime.ts`, `notifications.ts`: effect cleanup aborts, closes sockets/readers and clears retry/debounce timers. Personal socket uses a navigation ref rather than recreating on every route. | Source review plus real navigation cycles. Backend restart/reconnect storm under real network conditions not certified. |
| Auth and query cache | `frontend/src/auth.tsx`: identity generations fence stale completions; logout clears transport/auth and cancels/clears queries. `frontend/src/main.tsx`: application cleanup cancels/clears QueryClient. | Reviewed; intentionally cached query data is not itself a leak. Initial profile query count stable at 17. |
| Peer and capture tracks | `frontend/src/media.ts`: `stop()` clears negotiation/disconnect/readiness timers, detaches PC handlers, closes PC, stops owned local/screen/pending/remote tracks, clears sender/receiver/source/ICE state. Revision guards reject late capture results. | 39 controlled race tests; physical hardware release and codecs need native runs. |
| Capture lifecycle integration | `frontend/src/useMedia.ts`, `platform/captureLifecycle.ts`: unmount/connection change/pagehide/suspend/quit stop owned client and remove event subscriptions. | Local lifecycle tests; synthetic suspend is not physical sleep/wake. |
| Media playback and audio analysis | `RealtimePanel.tsx`, `remotePlayback.ts`: remove devicechange listener, pause/detach owned stream; `audioActivity.ts` and `useSpeakingParticipants.ts`: stop interval, disconnect nodes, remove track/document/context listeners, close shared room AudioContext on unmount. | Source review; sink-race disposal tests. Long native audio/decoder heap measurements not performed by this suite. |
| Audio notifications / test sound | `notificationSound.ts`, `deviceSound.ts`: dispose pauses audio, clears source, removes gesture/preferences/native listeners; generation guards reject stale output work. | Notification and sound routing tests passed. `recordingAnnouncement.ts` deliberately keeps one fixed-asset player for application lifetime, not one player per event. |
| Object URLs, downloads and observers | `ChatPanel.tsx`: abort download on unmount, revoke URL on replacement/expiry/unmount, disconnect IntersectionObserver and scroll/visibility listeners. `ConversationFiles.tsx`, `GroupChats.tsx`: abort downloads and revoke blob/avatar URLs, including late-response checks. `NativeAssets.tsx`: close native lease for late or unmounted results. | Source review; native lease/partial-file paths tested with real local transport/disk. |
| Polling and bounded queues | `CaptionsPanel.tsx`: abort request and clear recursive timer; `groupAvatarLoader.ts`: bounded six slots, aborted waiters removed and retry timers cancelled. Notification dedup and pending media-ready requests are bounded. | Source review; no unbounded resource owner confirmed. |

## Remaining verification boundaries

- Real Chromium/Pion 100 join/leave cycles and two-peer media packet/decoded-frame checks are recorded below. They use synthetic capture devices; they do not validate OS screen capture or replace the separately reported picker-adapter cycles.
- These measurements do not certify permission LEDs, physical device unplug, OS portal teardown, complete native allocator reclamation or long-duration calls. Direct/TURN checks use a local production Pion engine with a test signalling driver, not the deployed application API.
- Windows 10/11 x64/ARM64 and Ubuntu/Debian/Mint/Fedora x64 X11/Wayland still need their own executed runtime evidence. Fresh Ubuntu ARM64 Xvfb evidence is summarized below; it does not certify the physical desktop/portal. macOS measurements provide shared-code diagnostic evidence only.
- Main/renderer heap counters and constructor groups are useful evidence but do not replace native memory/handle analysis. File descriptor counts are point-in-time process snapshots, not Windows HANDLE counts.
- Previously documented fixes in `docs/desktop/07_MEDIA_LIFECYCLE.md` and `07_NATIVE_LIFECYCLE.md` (route-induced account socket churn and lease expiry timer rearm) predate this audit. Current tests revalidate those ownership paths; they are not claimed as new fixes or new measured improvements.

## Fresh profile follow-up

### Complete Electron profile — PASS

Evidence: `mac-after/stage07-profile-after.json`, four `stage07-after-*.heapsnapshot` files and `mac-after/retained-heap-analysis.json`. Runtime Electron **44.9.3**, Chromium **152.0.7977.167**, macOS ARM64; source digest `046039dc46e25b1e65ca7419d7c0a2caf7b9df7a3edb43b83f584a68a236dce2`. This measurement predates the later smoke/integration harness-only repairs described below.

The complete run passed 100 shared React chat navigation cycles after 10 warm-up cycles, 100 additional typed-IPC native WSS/SSE open/close cycles, synthetic suspend/resume, actual Chromium renderer crash/reload with auth and realtime restoration, server switch and fixture-transport release after application quit. It does not claim physical sleep/wake coverage.

After the 100 navigation cycles, application resource counts and all measured main/window/webContents/IPC/power listener maps exactly match warm-up: broker sockets **1 → 1**, SSE **1 → 1**, main application timer **1 → 1**, jobs/leases/pending operations **0 → 0**, one window and one tray. No route-induced account socket was created or closed. DOM nodes **839 → 839**, documents **4 → 4**, renderer DOM listener counter **236 → 237**. The one additional listener is not a repeated-per-cycle accumulation, but its exact native/React owner is not identified by the aggregate counter.

| Retained group | Warm-up → settled count | Union retained bytes, warm-up → settled |
| --- | --- | --- |
| Main `MeetSpaceBroker` | 1 → 1 | 6,316 → 6,736 |
| Main `NativeAssets` / `NativeUpdates` | 1 → 1 each | 956 → 956 / 2,740 → 2,740 |
| Main `NativeShell` / `NativeNotifications` | 1 → 1 each | 1,600 → 1,600 / 2,348 → 2,348 |
| Main `WebSocket` | 2 → 2 | 8,396 → 8,396 |
| Main `Timeout` | 6 → 6 | 792 → 792 |
| Renderer queries by property shape | 17 → 17 | 6,548 → 6,512 |
| Renderer `DOMTimer` | 23 → 20 | 8,212 → 7,132 |

Renderer used heap rose **5,100,732 → 6,068,320 B** (+967,588), and raw-graph reachable bytes rose **9,395,995 → 10,310,079 B**. Main V8 used heap changed **9,369,264 → 9,869,444 B**. Those endpoints include profiling allocations and caches; with stable owner counts they do not establish a leak or an optimization gain. The runtime and fixture changed between the original baseline and this run. Only equivalent completed workloads may be compared, and the incomplete baseline cannot substantiate improvement in scenarios it never reached. See the performance report for the limits of these single, non-comparable runs.

### Chromium/Pion media and chat lifecycle — PASS with native retention caveat

Evidence: `media-lifecycle/result.json`, `checkpoints.json`, five heap snapshots, `retained-heap-analysis.json`, fixture/source manifests and `electron-media-lifecycle.log`. Electron **44.9.3**, macOS ARM64. The test uses production `ConferenceMediaClient`, real Chromium PeerConnections and synthetic getUserMedia capture, local Pion, real WSS and the actual shared React message component. It does not navigate the whole application or authenticate to the deployed backend.

After **10 warm-up + 100 measured media join/leave cycles**, all **110 created PeerConnections were closed**. After another **100 measured chat mount/unmount cycles**, live peers, live tracks, retained media-client weak references, account sockets, active query fetches, query observers and SFU rooms/peers/tracks/subscriptions remained **zero** at the checkpoints. DOM nodes stayed **11**, documents **1**, listeners **155** until final teardown (**148**). The five expected auth/query-GC timers remained bounded and became **zero** on teardown; query cache **3 → 0** after explicit query-client clear.

Used renderer heap: warm-up **3,512,144 B**, after media **3,552,448 B**, after chat **3,917,948 B**, settled **3,909,088 B**, teardown **3,803,684 B**. These numbers are not a claim of complete native memory release.

The harness's `retainedObjects` field counts only snapshot nodes of type `object`, so the reported `MediaStream: 1` / `MediaStreamTrack: 1` excludes native wrapper nodes. Offline analysis includes both types:

| Raw snapshot group | Warm-up | After 100 media cycles | After 100 chat cycles | Settled | Teardown |
| --- | ---: | ---: | ---: | ---: | ---: |
| `MediaStream`, native + JS | 11 | 110 | 78 | 19 | 10 |
| `MediaStreamTrack`, native + JS | 21 | 219 | 155 | 37 | 19 |
| Stream union retained bytes | 36,176 | 394,160 | 278,448 | 65,104 | 32,560 |
| Track union retained bytes | 22,416 | 244,176 | 172,496 | 40,336 | 20,176 |

Thus ended native media objects outlive immediate stop/GC checkpoints but decline substantially and finish below the warm-up count. This is **transient native retention, not a confirmed monotonically growing application leak**. All capture tracks were ended at the resource checkpoints, which is distinct from their wrapper allocation being reclaimed. Longer stable-runtime soak and native allocator analysis are still needed before claiming bounded memory across hours of calls. Raw dominator caveats above apply; stream/track retained unions overlap and must not be added.

### Two-peer Opus/VP8 and forced TURN — PASS

Evidence: `sfu/2-direct.json` and `sfu/2-relay.json`. Both use real Chromium decoding and the production Pion engine, compiled locally from backend source digest `8f30fd659ea9f2dbd6c16da02ae60082ff28ed31d2057d37aad873b96d51fe4a`, with synthetic capture devices and a local test signalling driver.

Both runs verified incoming Opus packets/samples and decoded VP8 frames for both participants, late join, leave and a fresh-client rejoin with a new peer ID and growing counters. The forced relay run selected `relay` in Chromium and had **2 active TURN allocations**. On final teardown both runs had **0 peers, rooms, subscriptions, tracks and TURN allocations**; all **3 created peers** were closed, all **6 captured tracks** ended and **0 retained video elements** remained. These are short functional/release checks (roughly 2–3 seconds), not a long-call memory soak.

## Harness reliability follow-up

### Native Ubuntu ARM64 follow-up

The isolated Ubuntu 24.04.5 LTS ARM64 run passed 100 actual React chat navigation cycles, 100 additional WSS/SSE cycles, synthetic suspend/resume, renderer crash/reload and server switching. Source digest `9b373d498d09d74cb8b2a7b468f7415569c93c7e4ae23e4b48cb39233b89fef5`; evidence `desktop/artifacts/audit-20261026/linux-arm64/initial/evidence-volatile-keyring/lifecycle-after/stage07-profile-after.json`. Main V8 heap 9,685,600 → 10,211,264 B, renderer 5,130,460 → 6,119,444 B; DOM nodes/documents/listeners 839/4/236 unchanged, FD 225 → 222, threads 84 → 83. Owned resource maps returned to warm-up counts. These single-run endpoints do not establish a leak or an improvement. Separate Xvfb/DBus/private keyring was used; physical capture and the user's installed profile were not tested. Earlier private keyring fixture bootstrap failures remain in the evidence directories and are not presented as product success.

### Runner repairs

- **Smoke drift, confirmed and fixed:** the fresh app now starts with the welcome choices. `electron-smoke.cjs` previously asserted the connection page without navigating there. It now waits for “Начнём с подключения”, presses “Продолжить” and explicitly checks “Подключиться к серверу”, retaining all security, theme, zoom and deep-link assertions. `electron-smoke-after.log`: **PASS** on Electron 44.9.3.
- **Integration initial startup timeout, cause unconfirmed:** `electron-integration.log` preserves the first 30-second timeout and subsequent `ERR_FAILED`. The integration renderer is a minimal IPC fixture and does not use the welcome UI. An isolated rerun of the unchanged harness passed both phases (`electron-integration-isolated.log`), so a production startup defect is not established.
- **Integration timeout cleanup race, confirmed and fixed:** the runner previously rejected and deleted the temporary profile immediately after sending termination, without waiting for the child to exit. It now keeps the **same 30-second failure deadline**, awaits exit, escalates to SIGKILL after 5 seconds and preserves the private profile if no exit is observed by 10 seconds. It also removes inherited `ELECTRON_RUN_AS_NODE` from the child's environment. This fixes cleanup ownership, not the undiagnosed initial startup delay. `electron-integration-after.log`: **PASS** for process restart, real OS encryption, typed IPC/WSS/SSE, server credential isolation and logout revocation. `integration-reaping-check.log`: controlled timeout/exit, forced-kill and no-exit scenarios all **PASS**, including no profile deletion before exit and no remaining supervision timers.
- **Final supervisor review, fixed and verified:** a rejected Promise alone did not release Node's reference to a non-exiting child; a child `error` after spawn also cancelled termination supervision. Both `integration-runner.cjs` and `stage07-profile-runner.cjs` now keep their original failure deadlines, keep supervising signal failures until exit/deadline, and `unref()` a still-running child at the final reap deadline while preserving its private profile. `runner-supervision-after.log`: **8/8 PASS**. The regression executes each actual runner source with disposable fixture/filesystem data, shortened clocks and a real Node child: normal termination, forced kill, no exit and repeated signal errors. In the latter two cases it verifies that the runner process itself exits with failure while the child is still alive and the profile still exists; the outer test then kills its own child and removes its own temporary files. This verifies harness event-loop/profile ownership, not an observed Electron kill failure or production process behavior. The macOS measurements above predate this harness-only follow-up.
