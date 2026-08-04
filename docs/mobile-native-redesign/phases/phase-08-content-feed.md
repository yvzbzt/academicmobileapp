# Phase 08 — Unified trusted Announcements feed

Status: Complete as reconciled on 4 August 2026; the original debug/Metro evidence below is historical presentation evidence, not release-performance acceptance.
Date: 2 August 2026
Branch: `agent/google-play-readiness-20260724`
Original starting and pre-commit HEAD: `d96dff5a3b1e6ac87ae095061946347285c0f44d`
Original implementation commit: `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9`
Cross-phase trusted-date/API repair commit: `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25`
Completed-phase mobile/performance reconciliation commit: `2e3664546f628a19c6fa929b9ee9469e5322f9a8`
Reconciled: 4 August 2026

## Authoritative reconciliation — 4 August 2026

The unified trusted feed delivered by `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9` remains current. Commit `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25` preserves date-only publication meaning through the trusted API and native feed/detail—no clock or UTC day shift is invented—while true timestamped content retains its real time. Commit `2e3664546f628a19c6fa929b9ee9469e5322f9a8` adds the repository-owned release-performance harness and evidence without changing the shipped Phase 8 product design.

The accepted run used `npm.cmd run measure:mobile-native:feed-release`, `NODE_ENV=production`, a freshly assembled non-debuggable x86_64 release APK, the isolated `index.feed-performance.ts` entry, and the existing deterministic 100-record fixture. After a 15-second post-build settling interval, it performed one unmeasured warm-up and five measured warm-scroll trials. Android `framestats` rows with `Flags=0` were measured as `FrameCompleted - IntendedVsync`; aggregate percentiles use nearest rank. Acceptance requires at least 100 frames per trial, aggregate p90 ≤ 32 ms, aggregate p95 ≤ 50 ms, and zero frames ≥ 700 ms.

On the API 24 `AcademicPhase1Low` emulator at 720×1280, 320 dpi, font scale 1.0, and the host Intel renderer, the accepted five trials produced 600 valid frames: p90 `24.928167 ms`, p95 `35.777763 ms`, and zero frozen frames. The non-debuggable x86_64 APK SHA-256 is `ce910347fbb1b663c1ec12b8b03b442533655e23a131093bd4abcbdeded17a26`; the runtime marker proved 100 embedded records and startup required no Metro.

The renderer controls are intentionally disclosed. The initial SwiftShader baseline failed with 592 frames, p90 `70.649202 ms`, p95 `77.171868 ms`, and zero frozen frames; it measured the software renderer rather than a proven feed-code bottleneck. A subsequent experiment using `initialNumToRender=4`, `maxToRenderPerBatch=3`, `windowSize=3`, `updateCellsBatchingPeriod=75`, and clipping worsened the SwiftShader result to p90 `73.497194 ms` and p95 `82.665697 ms`. That experiment and its assertions were **fully reverted**. Those values are not shipped tuning, and the accepted host-rendered run uses the original production `FlatList` settings.

The authoritative method and machine-readable record are [`apps/mobile-native/performance/README.md`](../../../apps/mobile-native/performance/README.md) and [`release-evidence.json`](../../../apps/mobile-native/performance/release-evidence.json). The dated debug APK + Metro `gfxinfo` section below remains historical UI/runtime evidence only and must not be cited as release acceptance. Phase 9 was not started.

## Scope implemented

- Replaced the primary Announcements body with `AnnouncementsFeed`, one full-bleed virtualized feed that combines the authenticated academic trusted collection, public YÖK trusted collection, and compatible trusted Summer School announcements.
- Added `feed-model.ts` for deterministic fail-closed record admission, canonical identity/deduplication, chronological order, Turkish search folding, filters, one dominant availability state, controlled server limits, and responsive policy.
- Added `AnnouncementDetail` as the in-app route for trusted announcement, news, event, YÖK, and compatible Summer School records before external handoff.
- Preserved the existing `YokAnnouncements` and `SummerSchool` nested screens and exact protected deep links under Announcements. Neither became a primary bottom-navigation destination.
- Added a development-only synthetic content-feed preview and focused pure/native-renderer coverage. The harness uses no API, persistence, provider, account, credential, or production data.
- Added no Save/read state, likes, comments, reposts, connections, engagement metrics, backend short link, attachment theater, or calendar mutation. No Phase 9 Calendar redesign was started.

## Final feed information hierarchy

1. **Duyurular** screen heading.
2. Available university, faculty, and department context; otherwise a fixed trusted-source description.
3. Persistent **Duyurularda ara** search label and title/summary/source placeholder.
4. **İçerik türü** group: **Tümü**, **Duyurular**, **Haberler**, **Etkinlikler**.
5. **Akademik kapsam ve kaynak** group: **Tüm kaynaklar**, **Üniversitem**, **Fakültem**, **Bölümüm**, **YÖK**, **Yaz Okulu**.
6. Selected content/source labels, search-active status, and trusted result count.
7. Dedicated **YÖK sayfasını aç** and **Yaz Okulu sayfasını aç** nested-route actions.
8. Availability banner when useful retained content is refreshing, stale, partial, or offline.
9. One chronological `FlatList` of source-first trusted rows.
10. Controlled pagination loading/failure footer.

Each row uses one opaque outlined surface and communicates official institution/source identity, academic scope, trusted content type, publication or explicitly labelled source-update time, wrapping title, optional concise summary, and one full-row **Ayrıntıyı aç** affordance. It does not repeat a large open button or nest cards. The row's accessible name follows source, scope, type, time, title, summary, action.

## Search and filtering contract

- Search is client-side over normalized title, safe summary, and official source name. It waits 300 ms after input before recomputing the visible feed.
- Matching folds Turkish dotted/dotless I and combining diacritics and requires every normalized query token without coupling to input word order.
- The raw search string exists only in local component state. Phase 8 does not log, persist, route, send, or instrument it.
- Content-type and source/scope selections combine deterministically. Filter controls wrap within two labelled groups rather than forming one overcrowded horizontal strip.
- Every filter is a named button with explicit selected accessibility state, so selection is not communicated only by color.
- **Filtreleri temizle** clears search and both filter groups from the no-results state.

## Content-trust, identity, and ordering boundary

The feed consumes only records that already crossed the Phase 2 additive trusted DTO, then applies a stricter presentation gate. A rendered record requires:

- explicit `trustStatus: "trusted"` after native normalization;
- non-empty record ID, source ID, source name, scope type, and scope ID;
- a supported announcement/news/event content type;
- already normalized source name, title, and optional summary;
- credential-free official HTTP/HTTPS canonical, link, and source URLs;
- the canonical item/link identity and matching official institutional authority.

Absent trust, quarantine/rejection, a generic source fallback, raw markup/entities, missing ownership, unsafe URL, URL mismatch, or unofficial authority fails closed. Canonical official URL is the stable row key and duplicate identity. Equivalent records merge their academic/YÖK/Summer source-family labels deterministically. Publication time orders newest first; source-update time is the only display fallback. Discovery and crawler-fetch timestamps never determine display order, a duplicate winner, or publication copy.

## State and incremental-loading behavior

The deterministic resolver exposes one dominant state at a time:

- initial loading;
- background refresh with retained rows;
- populated;
- genuine empty after all three source families attempt;
- no search/filter results;
- stale retained data;
- partial source failure;
- offline;
- recoverable first-load error;
- pagination loading;
- pagination failure with retained rows.

Empty and error do not render together. One labelled progress region owns initial busy semantics; decorative skeletons are hidden from accessibility. Pull-to-refresh concurrently refreshes academic, YÖK, and Summer content while preserving valid data. The academic and YÖK APIs expose a `limit` rather than a cursor/offset/total contract, so controlled incremental loading requests 20, 40, 60, 80, then 100 records and stops at the endpoint ceiling. It requests only a source family that filled the current limit. A failed family leaves its previous verified rows in place, accepts any independently successful source result, and exposes an explicit retained-row retry footer. Summer School has no equivalent feed-pagination contract and remains at its trusted current payload.

## In-app detail and real actions

Selecting any feed row stores its normalized `ContentFeedItem` in current application memory and requests the allowlisted `AnnouncementDetail({ announcementId })` route. The route ID continues to carry only the record identifier; no full record, URL, query, token, or secret is persisted in navigation state. Any requested AnnouncementDetail ID is identity-bound to a matching cached trusted item or an exact `/announcements/my/trusted/:id` fetch. Direct and notification-origin routes both fail closed when that identity cannot be matched and revalidated; this is not a notification-only guard.

Detail revalidates explicit trust, source identity, the specific canonical item URL, and its match to the official source authority. It shows:

- trusted content type and academic/YÖK/Summer scope;
- wrapping normalized title;
- official source name and disclosed destination domain;
- separate publication and source-update labels when supplied;
- the complete safe summary supplied by the Phase 2 DTO, or fixed missing-summary copy;
- native **Paylaş**;
- **Resmî kaynağı aç · {domain}**.

Native Share receives only the normalized title and specific trusted canonical item URL. Official-source handoff canonicalizes the URL again, uses only supported HTTP/HTTPS destinations, checks platform support, catches failure, and keeps the detail route mounted with fixed controlled feedback. Returning from a successful external handoff preserves the native route. Ordinary Android Back returns to the still-mounted feed and its in-memory search/filter state.

The trusted DTO does not provide complete article body, attachments, a structured event/deadline period, durable Save/read persistence, or a feed-owned Add to Calendar mutation. Those sections/actions are omitted; Phase 8 does not infer them from title text, crawler metadata, Summer dates, or unrelated Calendar records.

## YÖK and Summer School integration

- YÖK trusted items are included chronologically, filterable by **YÖK**, and open in the same trusted in-app detail. **YÖK sayfasını aç** still enters `YokAnnouncements`, and its existing exact deep link remains unchanged.
- Compatible `ownAnnouncements` and `sameDepartmentAnnouncements` from the Summer payload are normalized, deduplicated, filterable by **Yaz Okulu**, and open in the same detail boundary.
- Summer requirements, same-department options, profile context, and calendar dates are not `TrustedAcademicContentDto` records. They remain on the existing `SummerSchool` nested screen instead of being coerced into feed items or detail fields.
- YÖK and Summer School remain nested Announcements capabilities, never fifth/sixth primary tabs.

## Platform, accessibility, and responsive behavior

- Announcements is one full-bleed `FlatList`; `AppNavigator` does not wrap Announcements or AnnouncementDetail in its transitional `ScrollView`. Detail owns one bounded opaque `ScrollView`.
- iOS feed/detail reading surfaces remain opaque. Liquid Glass eligibility remains restricted to supported Phase 5 navigation/control chrome and requires the existing runtime/Reduce Transparency gate.
- Android uses semantic Material-compatible tonal surfaces, native ripple through shared primitives, existing edge-to-edge/safe-area ownership, at least 48 dp interactive targets, and ordinary stack Back.
- Width below 375 logical units selects a 16-unit gutter. All widths remain one column with a 720-unit readable maximum. At 320 dp/200% font scale filter groups wrap/stack vertically and the contract prohibits horizontal clipping.
- Titles and institution names wrap without title line caps. Feed summaries may remain concise; the detail summary is not line-capped. Busy state, headings, search, filter selection, row names, destination domain, errors, and retries have explicit semantic labels/roles/state. Availability never depends on color alone.
- Windows cannot provide iOS runtime, Dynamic Type, Liquid Glass, native iOS Share, or VoiceOver acceptance. The authorized Android API 24 AVD cannot provide TalkBack or predictive-Back acceptance.

## Synthetic preview boundary

`ContentFeedPreview` is selected only when `__DEV__` and `EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW=1` are both true. Theme and scenario are selected through `EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_THEME` and `EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_SCENARIO`. Stable scenarios are `populated`, `search-results`, `no-results`, `active-filters`, `partial`, `stale`, `offline`, `error`, `pagination-error`, `detail`, `yok`, `summer-school`, `official-source-handoff`, `long-title`, and `long-feed`; long-feed contains 100 deterministic trusted records.

Fixtures use only reserved `preview.edu.tr` and official YÖK HTTPS URLs. The preview imports no API, SecureStore/AsyncStorage, network request, provider, Google, notification, account, or production-data module. Its official-handoff scenario is intentionally contained and does not open an external application. Preview/component behavior is not itself native visual acceptance.

## Files changed

- Native orchestration/navigation: `apps/mobile-native/App.tsx`, `apps/mobile-native/src/navigation/AppNavigator.tsx`.
- Native feed/detail/model/preview: `apps/mobile-native/src/announcements/AnnouncementsFeed.tsx`, `AnnouncementDetail.tsx`, `feed-model.ts`, `ContentFeedPreview.tsx`.
- Pure tests: `tests/unit/mobile-native-content-feed.test.ts` and the Phase 8 source-wiring regression update in `tests/unit/mobile-native-content-trust.test.ts`.
- Native renderer tests: `apps/mobile-native/tests/announcements/AnnouncementsFeed.test.tsx`, `AnnouncementDetail.test.tsx`, `ContentFeedPreview.test.tsx`.
- Documentation/evidence: `DESIGN_SYSTEM.md`, `PLATFORM_ADAPTATION.md`, `SCREEN_INVENTORY.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`, `TEST_MATRIX.md`, this Phase 8 report, `evidence/phase-08-native/README.md`, and the accepted `screenshots/`, `hierarchies/`, and `raw/` evidence records.

## API, persistence, security, and rollback

No endpoint, DTO, schema, repository, database, storage key/envelope, authentication/session generation, notification lifecycle, Google Calendar lifecycle, provider configuration, app permission, or backend persistence changed. Phase 8 uses the existing `/announcements/my/trusted?limit=…`, `/announcements/yok/trusted?limit=…`, and `/calendar/summer-school/my` contracts. No production data, account, provider, or credential may be accessed for evidence.

Rollback is code-only. Removing the Phase 8 feed/detail/model/preview and restoring the prior screen mapping leaves all Phase 1–7 persisted data, route identifiers, API contracts, and integration state compatible.

## Historical Phase 8 implementation validation ledger

These commands ran against the historical reconciled pre-commit worktree at `d96dff5a3b1e6ac87ae095061946347285c0f44d`.

| Exact command/check | Final result |
|---|---|
| `npm.cmd test -- tests/unit/mobile-native-content-feed.test.ts tests/unit/mobile-native-content-trust.test.ts tests/unit/mobile-native-route-foundation.test.ts --configLoader runner` | PASS, 3 files / 95 tests, 1.63 s |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/announcements/AnnouncementsFeed.test.tsx tests/announcements/AnnouncementDetail.test.tsx tests/announcements/ContentFeedPreview.test.tsx` | PASS, 3 suites / 51 tests / 0 snapshots, 30.306 s |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/announcements/AnnouncementsFeed.test.tsx tests/announcements/AnnouncementDetail.test.tsx tests/announcements/ContentFeedPreview.test.tsx tests/navigation/AppNavigator.test.tsx` | PASS, 4 suites / 65 tests / 0 snapshots, 30.378 s |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | PASS, 16 suites / 147 tests / 0 snapshots, 74.227 s |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS, 30 files / 310 tests, 28.69 s; existing non-failing Mongoose `new` deprecation warning only |
| `npm.cmd test -- --configLoader runner` | PASS, 47 files / 621 tests, 38.80 s; Phase 7 was 46/589 (+1 file / +32 tests) |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS |
| `npm.cmd run build:admin` | PASS, 1,742 modules; 250.51 kB main JS; 4.22 s |
| `npm.cmd run build:mobile` | PASS, 1,754 modules; 349.18 kB main JS; 7.94 s |
| `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon` from `apps/mobile-native/android` | PASS: installed evidence build in 1m48s, then final incremental verification after request-ownership fixes in 1m7s; both reported 245 tasks (7 executed / 238 up-to-date) and the same 56,804,991-byte APK with SHA-256 `72B5EB3EE7AE19777BF1CF1FB6D9E2929EE4C37B0A83076DDA95C2548992F4B7` |
| `adb install -r -d app-debug.apk` plus Android feed/detail smoke | PASS; install returned `Success`; 20 reviewed PNG/XML pairs and interaction/runtime/restoration evidence |
| `git diff --check` | PASS |
| Forbidden modifier, snapshot, vacuous-test, search log/persistence, credential/production literal, unsafe preview URL, raw diagnostic search, credential diagnostic, and fatal runtime scans | PASS, no prohibited match |
| Mobile-native lint | `MOBILE_NATIVE_LINT: NOT AVAILABLE`; no lint script/config/dependency exists |

## Historical debug/native evidence and remaining blockers

The Android evidence manifest is [`evidence/phase-08-native/README.md`](../evidence/phase-08-native/README.md). Native review passed on `emulator-5554` / `AcademicPhase1Low`, Android 7.0 / API 24 / x86_64, at 720×1280 physical pixels. Normal density 320 produced 360 dp at font scale 1.0; the exact compact case used density 360 for 320 dp at font scale 2.0.

The 20 visually reviewed original-resolution PNG/XML pairs cover light/dark populated feeds; search result, in-app detail, same-PID Android Back, and retained feed scroll; no-results; active filters; retained partial/stale banners; YÖK feed/detail; Summer School feed/detail; contained official handoff with the same PID and resumed app; compact dark long-title feed/detail with the clickable official-source action reachable; and the 100-record long feed at top and after scrolling to rows 023/024. Pairing and 720×1280 dimension audits passed, with hashes in `raw/integrity-index.txt`.

The live-Metro log scan passed. Two expected `Cannot connect to Metro` warnings emitted only after intentional development-server teardown are preserved separately and did not match the fatal-exception scan. Debug-emulator `gfxinfo` is disclosed as observational only: 547 total frames, 528 janky (96.53%), p50 26 ms, p90 42 ms, p95 46 ms, p99 61 ms; no threshold, release, or production-performance claim is made. Restoration passed at physical 720×1280, density 320, font scale 1.0, no ADB reverse/8081 listener/app PID, with the emulator retained.

Persistent platform limitations are exact: `accessibility_enabled=0` and TalkBack was unavailable on the authorized image; UIAutomator is not screen-reader acceptance. Windows has no iOS build/simulator/Xcode, VoiceOver, or native iOS material/share acceptance. API 24 cannot provide API 33+ predictive-Back evidence. The synthetic harness does not prove live API/session/provider behavior. Phase 8 changes no provider behavior and requires no provider fixture.

## Current handoff

Implementation commit `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9`, cross-phase repair `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25`, and mobile/performance reconciliation `2e3664546f628a19c6fa929b9ee9469e5322f9a8` are complete. The historical Android debug presentation review remains valid within its stated boundary; release performance acceptance is the separate 4 August harness record above. Phase 9 was not started: Calendar/manual-exam design, event detail, CRUD, native date interaction, and integration redesign remain Phase 9 scope.
