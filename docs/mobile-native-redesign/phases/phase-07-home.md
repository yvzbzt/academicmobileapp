# Phase 07 — Student daily-brief Home

Status: Complete.
Date: 1 August 2026
Branch: `agent/google-play-readiness-20260724`
Starting HEAD: `00e03ace0a05d9ee3dcdbfe8903cc5d6d34ebccb`

## Scope completed

- Replaced the reachable dashboard Home with `HomeDailyBrief`, a content-first, virtualized daily brief.
- Added deterministic local-day, nearest-item, announcement ordering, recent-limit, primary-state, retained-data, integration-action, responsive, and countdown rules in `src/home/home-model.ts`.
- Preserved Phase 1 owner-scoped personal exams and moved their existing creation entry to Calendar; Phase 9 still owns full Calendar/manual-exam redesign and edit/delete.
- Reused Phase 2 trusted-content normalization and timestamp labels. Home re-normalizes its input fail-closed before rendering.
- Added a development-only synthetic Home preview with incomplete, loading, populated, empty, stale, error, and long-title fixtures, plus light/dark theme selection and local detail navigation.
- Added focused pure and native-renderer coverage. No `.skip`, `.only`, snapshot acceptance, weakened assertion, API/schema, persistence, authentication, notification, Google Calendar, or production-data change was introduced.

## Final information hierarchy and data priority

1. Compact first-name greeting and available university/faculty/department context.
2. Incomplete-profile state with one primary action, taking precedence over every data state.
3. Today: academic events and owner-scoped personal exams selected by the device local calendar day.
4. Nearest future exam, registration/deadline, or academic event with local date/time and a minute-refreshed remaining-time label.
5. Newest trusted announcement with source, title, optional concise summary, truthful publication/update label, and full-row detail navigation.
6. At most three other recent trusted announcements plus one action to the Announcements tab.
7. At most one compact Phase 3-backed integration prompt, only when actionable.

Publication time, then source-update time, orders announcements. Discovery/crawl/fetch time is never shown as publication. Calendar/upcoming records are deduplicated by record ID before presentation. The UI does not render quarantined, rejected, unsafe, source-less, or unnormalized content.

## State behavior

- Initial loading has one accessible busy region and non-duplicated decorative skeleton children; no zero counts are shown.
- Populated data remains visible during background refresh. Refreshing, partial, stale, offline, and retained-after-error states are explicit labelled banners.
- Genuine empty is rendered only after both calendar and announcements have attempted and no useful item exists.
- Recoverable error is rendered only when no retained useful content exists; it cannot coexist with empty/loading.
- Incomplete academic profile supersedes all other Home states and routes to Academic Profile settings.

## Removed dashboard duplication

The reachable Home no longer includes the `Bugün / Sınav / Duyuru` statistic strip, four primary/nested-destination shortcut cards, oversized hero, nested exam/event dashboard modules, or large success banners. Calendar and Announcements remain the durable destinations. Home has no likes, comments, reposts, connections, or engagement metrics.

## Platform, accessibility, and responsive behavior

- iOS retains Liquid Glass eligibility only in Phase 5 navigation/control chrome. Daily-brief cards, lists, banners, and text surfaces are opaque.
- Android uses semantic Material-compatible tonal surfaces, native ripple through shared pressable primitives, 48 dp targets, and existing edge-to-edge inset ownership.
- Home is one `FlatList`, not a virtualized list inside a `ScrollView`; root tab re-selection registers its list for scroll-to-top.
- Widths below 375 use 16-unit gutters; all widths stay one column with a 720-unit readable maximum. Titles have no line cap and grow/wrap at 200% text scale.
- Greeting, section headings, row buttons, source/title/date/action order, busy state, and status wording have explicit semantic roles/labels/state. Status never depends on color alone.
- Windows cannot provide iOS runtime, Dynamic Type, Liquid Glass, or VoiceOver acceptance. The Android API 24 image cannot provide TalkBack or predictive-Back acceptance.

## Files changed

- Native: `apps/mobile-native/App.tsx`, `src/navigation/AppNavigator.tsx`, `src/home/HomeDailyBrief.tsx`, `home-model.ts`, and `HomeDailyBriefPreview.tsx`.
- Tests: `tests/unit/mobile-native-home.test.ts`, `apps/mobile-native/tests/home/HomeDailyBrief.test.tsx`, and `HomeDailyBriefPreview.test.tsx`.
- Documentation: Design System, Platform Adaptation, Screen Inventory, Decisions, Known Issues, Test Matrix, this Phase 7 report, and native-evidence index if captured.

## API, persistence, security, and rollback

No endpoint, DTO, schema, repository, storage key/envelope, authentication/session gate, content-trust rule, notification lifecycle, Google Calendar lifecycle, provider configuration, or platform permission changed. No production data/account/provider was accessed. Rollback is code-only; existing Phase 1–6 records remain compatible.

## Validation ledger

| Exact command/check | Final result |
|---|---|
| `npm.cmd test -- tests/unit/mobile-native-home.test.ts --configLoader runner` | PASS, 1 file / 8 tests |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/home/HomeDailyBrief.test.tsx` | PASS, 1 suite / 9 tests / 0 snapshots |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/home/HomeDailyBriefPreview.test.tsx` | PASS, 1 suite / 8 tests / 0 snapshots |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | Final PASS, 13 suites / 96 tests / 0 snapshots, 27.975 s |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS, 30 files / 310 tests, 21.24 s Vitest duration; existing non-failing Mongoose `new` deprecation warning |
| `npm.cmd run typecheck` | Final PASS |
| `npm.cmd --prefix apps/mobile-native run typecheck` | Final PASS |
| `npm.cmd test -- --configLoader runner` | Final PASS, 46 files / 589 tests, 22.43 s; current count remains above the 45/581 Phase 6 baseline |
| `npm.cmd run build:admin` | PASS, 1,742 modules, 250.51 kB main JS / 73.89 kB gzip |
| `npm.cmd run build:mobile` | PASS, 1,754 modules, 349.18 kB main JS / 104.25 kB gzip |
| `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon` | PASS, 46 s, 245 tasks (7 executed / 238 up-to-date); 56,804,991-byte APK; SHA-256 `72B5EB3EE7AE19777BF1CF1FB6D9E2929EE4C37B0A83076DDA95C2548992F4B7` |
| Android install/launch/Home smoke | PASS for debug install, Fabric/Metro launch, eight reviewed primary PNG/XML state pairs plus one complementary large-text pair, vertical scroll, and announcement-detail handoff |
| `git diff --check` | PASS; line-ending conversion notices only |
| Targeted source/evidence credential scans | PASS; no credential/log pattern found |
| Mobile-native lint | `MOBILE_NATIVE_LINT: NOT AVAILABLE`; no lint script/config/dependency exists |

## Native evidence and blockers

The preview contains synthetic records under `preview.edu.tr` and performs no API/storage/provider operation. Android evidence passed on the existing `AcademicPhase1Low` API 24/x86_64 target and is indexed in [`phase-07-native`](../evidence/phase-07-native/README.md). Native Home-tab re-selection remains blocked because the synthetic preview deliberately has no authenticated four-tab shell and no authorized authenticated fixture was supplied; deterministic navigator/root-tap and Home `useScrollToTop` registration tests cover the contract without relabelling it native acceptance. TalkBack, iOS, and predictive Back remain unavailable as documented in the evidence README.

## Handoff

Phase 8 was not started. The Announcements feed, Calendar design, and Profile screens remain their existing phased scope. Remaining release-wide issues continue under MN-019, MN-020, MN-024, MN-026–MN-034 as applicable.

## Acceptance reconciliation — 2 August 2026

The acceptance audit started from `ffde279964dfd67689eef469cbd3c7c1c755a00e` with the Phase 6 and candidate commits reachable and tracked/index state clean. It found and repaired three narrow Phase 7 gaps: explicit trust is now required again at the Home renderer boundary; date-only and multi-day academic periods are selected by the device local calendar day; and the initial-loading skeletons are truly decorative beneath one accessible busy region. The synthetic preview gained the missing loading fixture and reviewed Android PNG/XML evidence. No endpoint, DTO, schema, repository, persistence, authentication, integration lifecycle, production data, or Phase 8 feed file changed.
