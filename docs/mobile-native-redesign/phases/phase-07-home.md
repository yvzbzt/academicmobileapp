# Phase 07 — Student daily-brief Home

Status: Complete as reconciled on 4 August 2026; the earlier validation and debug-evidence sections are historical records of their dated runs.
Date: 1 August 2026
Branch: `agent/google-play-readiness-20260724`
Original starting HEAD: `00e03ace0a05d9ee3dcdbfe8903cc5d6d34ebccb`
Original implementation commit: `f346d8556e19b95277b27f7ecfda3f162a8ad57f`
Accepted Phase 7 reconciliation commit: `d96dff5a3b1e6ac87ae095061946347285c0f44d`
Cross-phase date-semantics repair commit: `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25`
Completed-phase mobile reconciliation commit: `2e3664546f628a19c6fa929b9ee9469e5322f9a8`
Reconciled: 4 August 2026

## Authoritative reconciliation — 4 August 2026

Phase 7 was implemented in `f346d8556e19b95277b27f7ecfda3f162a8ad57f`, accepted after the focused repair in `d96dff5a3b1e6ac87ae095061946347285c0f44d`, and then received date correctness from `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25` plus the bounded Home behavior repair in `2e3664546f628a19c6fa929b9ee9469e5322f9a8`.

- **Important is explicit, not synonymous with newest.** Home normalizes the trusted announcement title and qualifies only deterministic academic-urgency signals: urgent/mandatory or cancellation/postponement wording, application deadlines, course-registration/add-drop dates, exam dates, and payment/fee deadlines. It selects the newest qualifying item. A generic newest item, crawler rank, or an unowned numeric priority cannot create an **Önemli duyuru** section.
- **Recent announcements remain independent.** Home orders trusted content by publication/source-update chronology, removes an item from the recent list only when that same item actually qualified as important, and otherwise retains the generic newest item among up to three recent announcements.
- **The integration prompt is not lost when it is the only actionable module.** A profile-backed Google Calendar or notification action remains visible alongside an otherwise empty/offline/partial/error Home; it is suppressed only for incomplete-profile and initial-loading states.
- **No-data states are mutually exclusive.** With no retained useful data, precedence is incomplete profile, initial loading, offline, partial-source, recoverable error, then genuine empty. With retained data, Home remains populated and communicates refresh/stale/partial/offline availability without replacing the content.
- **Calendar dates keep their meaning.** The `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25` temporal contract carries `temporalKind`, inclusive `endDate`, and `endTemporalKind` into Today/nearest/countdown selection. A date-only Istanbul calendar value remains a local calendar date without an invented clock or UTC day shift; inclusive ranges remain active through their end date, while true timestamped events retain their real time.
- The completed Phase 5 integration test in `2e3664546f628a19c6fa929b9ee9469e5322f9a8` mounts this real Home `FlatList`, proves scroll retention across tab switches, and proves selected-root reselect scroll-to-top. It remains component-level integration evidence rather than installed-device shell acceptance.

The ledgers below retain the original and 2 August results as historical provenance. Their test counts and “Phase 8 not started” handoff describe those earlier checkpoints, not the current completed Phase 1–8 repository.

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

## Historical Phase 7 validation ledger

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

## Historical native evidence and blockers

The preview contains synthetic records under `preview.edu.tr` and performs no API/storage/provider operation. Android evidence passed on the existing `AcademicPhase1Low` API 24/x86_64 target and is indexed in [`phase-07-native`](../evidence/phase-07-native/README.md). At that historical checkpoint, installed native Home-tab re-selection was blocked because the synthetic preview deliberately had no authenticated four-tab shell and no authorized authenticated fixture was supplied. The 4 August real-Home renderer integration now closes the component-level wiring gap without relabelling it installed-device acceptance. TalkBack, iOS, and predictive Back remain unavailable as documented in the evidence README.

## Historical handoff

Phase 8 was not started. The Announcements feed, Calendar design, and Profile screens remain their existing phased scope. Remaining release-wide issues continue under MN-019, MN-020, MN-024, MN-026–MN-034 as applicable.

## Historical acceptance reconciliation — 2 August 2026

The acceptance audit started from `ffde279964dfd67689eef469cbd3c7c1c755a00e` with the Phase 6 and candidate commits reachable and tracked/index state clean. It found and repaired three narrow Phase 7 gaps: explicit trust is now required again at the Home renderer boundary; date-only and multi-day academic periods are selected by the device local calendar day; and the initial-loading skeletons are truly decorative beneath one accessible busy region. The synthetic preview gained the missing loading fixture and reviewed Android PNG/XML evidence. No endpoint, DTO, schema, repository, persistence, authentication, integration lifecycle, production data, or Phase 8 feed file changed.

## Final Correctness Repair 2 reconciliation — 7 August 2026

`HomeDailyBrief` now admits every announcement through
`admitTrustedContentRecord`, the same production predicate used by the feed and
detail. A record marked trusted is insufficient by itself: Home rejects a
missing official source URL, generic substituted source name, missing source
ID, inactive or rejected source, rejected or quarantined item, unsafe or
mismatched authority, cross-scope relationship, and source-less record. The
positive production-shaped set covers university, faculty, department, YÖK,
and Summer School sources.

The focused native Home suite (13 tests) and shared native trust suite (35
tests) preserve the existing Phase 7 information hierarchy, timestamp meaning,
daily-brief priority, state exclusivity, virtualization, accessibility, and
platform adaptation. This repair changes no Home visual design, endpoint,
database record, migration, provider, analytics, or social behavior.
