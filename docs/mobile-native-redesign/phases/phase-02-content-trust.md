# Phase 02 — Content Correctness and Trust

Status date: 2026-08-04
Status: Reconciled current through the trusted-date, outbound-network, parser-invariant, and content-identity repair. The original Phase 2 completion report remains below as historical provenance.

## Reconciled current state — 2026-08-04

The Phase 2 contract was revalidated from the accepted Phase 8 baseline `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9` and repaired in `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25` (`fix(api): complete trusted dates and notification delivery`).

- Academic dates now have an explicit date-only/timestamp temporal kind and preserve an optional inclusive range end through parser/PDF ingestion, Mongo persistence, shared API DTOs, Home/feed/detail rendering, Google Calendar transfer, and native-calendar mapping. A date-only value does not invent a clock time; timestamped records retain their real instant. The API-to-native regression exercises `Europe/Istanbul` so local academic dates do not shift across UTC day boundaries.
- All covered HTTP/PDF/OCR/source-discovery fetches use the shared safe outbound request boundary. Every initial and redirect hop revalidates scheme, hostname, DNS answers, and the actual connected remote address. Loopback, private, link-local, multicast, documentation, unspecified, and other forbidden destinations fail closed; mixed public/private DNS answers are rejected; DNS-selected addresses are pinned for the connection while TLS still uses the original hostname. Invalid TLS is rejected outside the explicit development-only policy.
- Source-specific YÖK and Ankara HTML adapters require their expected listing root and repeated valid row structure. One plausible link or card cannot make a changed/broken page layout healthy.
- Trusted content identity now includes a normalized content fingerprint within academic scope. Persistence merges canonical URL aliases and retains source relationships, so URL churn does not duplicate the same normalized item or discard its canonical/source/scope provenance.
- No production reconciliation, migration, provider call, or production-data access was run. The stored-content reconciliation command remains an operator-controlled runbook rather than evidence of a production mutation.

### Current provenance

| Scope | Commit | Reconciled meaning |
|---|---|---|
| Historical Phase 2 milestone | `d722f9092c1d500e0145214b2b57a08d1a8191d9` | Original senior re-audit milestone retained below |
| Accepted Phase 8 baseline | `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9` | Starting point for the bounded remediation |
| Phase 1 repair ancestor | `641d7bee8a1cd539179769069a22b5c3220e8a6d` | Preserved security boundary |
| Phase 2 repair | `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25` | Date/range correctness, safe outbound networking, parser invariants, fingerprint identity, and notification lifecycle repair |
| Phase 3 repair descendant | `2e3664546f628a19c6fa929b9ee9469e5322f9a8` | Preserves the repaired Phase 2 contract through the mobile reconciliation |

## Historical Phase 2 milestone record

**Historical snapshot boundary.** The remainder of this report is the original 31 July 2026 Phase 2 completion snapshot. Its original commit descriptions, commands, evidence limits, and handoff wording are retained; statements that Phase 3 was merely future work do not describe the reconciled 4 August repository.

## Summary

Phase 2 establishes one fail-closed trust path from source parsing through Mongo persistence, API presentation, and the existing native screens. Academic content is entity-decoded, stripped of navigation/chrome records, attributed to an explicit official source, timestamped without crawl-time fabrication, canonicalized, deduplicated, and withheld when rejected, quarantined, legacy-unclassified, source-less, unsafe, or unofficial.

No mobile UI redesign, navigation change, authentication/password-recovery/push change, Google OAuth/Calendar change, deployment, production-data access, or Phase 3 work is included.

## Repository checkpoint

- Branch: `agent/google-play-readiness-20260724`.
- Required starting commit: `18a93d4ecca5ef810ccd4f6f208cdb2774638afb`.
- Start verification: `HEAD` was exactly the required commit and therefore contained it.
- Completion: the single local scoped commit containing this report is the direct documented successor. A commit cannot embed its own final hash.
- Pre-existing unrelated untracked assets, source-coverage CSV/report files, redesign scaffolding for other phases, and `prompts/` were preserved and excluded from the scoped commit.

## Scope completed

- Decoded named, deeply nested, decimal, and hexadecimal HTML entities, including `&raquo;`, `&amp;`, `&nbsp;`, `&deg;`, and spacing entities. Residual entity syntax is removed from display text while the exact source title remains persistence-only audit evidence.
- Rejected navigation, compound pagination, menu, breadcrumb, sidebar, footer, arrow-only, and listing records. Pagination prefixes such as `6 of 10 --` are removed from otherwise valid titles without stripping legitimate four-digit academic-year prefixes.
- Separated source publication, source update, discovery, and fetch time. Only source-proven publication/update values can cross the trusted DTO; crawl time and arbitrary dates embedded in a title are never generic publication fallbacks. The known Selçuk listing convention retains its explicitly scoped leading-date adapter.
- Normalized malformed/unusable titles to safe display titles while retaining the exact captured, unmodified, untruncated persistence-only `rawTitle`, including original title markup and entities, for auditability.
- Enforced credential-free HTTP/HTTPS, official academic/government authority matching, redirect validation, private/link-local/loopback rejection, canonical tracking removal, path/query case preservation, and deterministic duplicate selection.
- Required explicit trusted item and explicit active trusted source state for Mongo/in-memory reads and presentation. Direct/legacy Mongoose inserts default to quarantine; rejected, quarantined, legacy-unclassified, mismatched, and source-less records cannot reach announcement or Summer School mobile responses.
- Added YÖK, Ankara University, and generic fallback parser fixtures and explicit auto-dispatch coverage.
- Added additive trusted collection endpoints for native failed-source/partial-state visibility while preserving legacy array endpoints. Summer School now exposes equivalent announcement source health; native refresh retains verified data and refreshes both Summer and calendar date ownership.
- Added a safe, documented, deterministic reconciliation command. Its real apply helper, preimage/`updatedAt` conflict paths, and runtime catalog authority builder are tested without a database. It was not run against any database.

## Senior re-audit corrections — 31 July 2026

The post-completion audit compared the implementation to every outcome in the execution prompt and found several edge cases that the first pass had not covered. The single Phase 2 commit was amended rather than creating a second phase commit.

- Closed compound/count-prefix pagination gaps (`1 / 10`, `Sayfa 2 / 10`, `6 of 10 --`) and added Turkish footer/menu variants.
- Prevented valid-but-unmapped and deeply nested entity syntax from leaking to API/native display text.
- Removed generic publication-time inference from title dates and kept only an explicit source-specific listing convention.
- Corrected `rawTitle` from normalized/truncated evidence to the exact source value.
- Made duplicate winner selection prefer source publication/update evidence over a later discovery/crawl observation.
- Made fresh-cache envelopes honor persisted degraded/failed source health; YÖK/static-source upserts no longer erase health history; Summer status counts explicit failed sources.
- Extended reconciliation so malformed items owned by missing/rejected/quarantined sources are still normalized and timestamp-repaired before remaining fail-closed.
- Replaced simulated-only reconciliation claims with direct tests of the executable apply helper and runtime authority builder, and added explicit generic fallback dispatch coverage.

## Files changed

- Shared/API contract: `packages/shared/src/contracts.ts`, `apps/api/src/contracts/endpoint-catalog.ts`.
- Trust, parsing, and ingestion: `announcement-content-trust.ts`, `announcement-parser.ts`, `announcement-ingestion.service.ts`, `announcements.types.ts`.
- API and persistence: `announcements.controller.ts`, `announcements.service.ts`, both announcement repositories, Mongoose schemas, collection indexes, and `calendar.service.ts`.
- Reconciliation: `announcement-content-reconciliation.ts`, `scripts/reconcile-announcement-content.ts`, the root package script, and workspace TypeScript inclusion.
- Native: `apps/mobile-native/src/content/content-trust.ts` and the existing `apps/mobile-native/App.tsx`; no navigation or visual redesign.
- Tests/fixtures: focused trust, reconciliation, API, ingestion, calendar/Summer, schema/index, native helper/source tests, and YÖK/Ankara/generic HTML fixtures.
- Documentation: this report, `DECISIONS.md`, `KNOWN_ISSUES.md`, and `TEST_MATRIX.md`.

## Design and architecture decisions

- The stored source record—not item-owned text—is authoritative for source identity, scope, official URL, and domain.
- Trust is explicit and fail-closed. Missing trust state is not equivalent to trusted.
- Canonical host identity is case-insensitive and `www`-equivalent; path and query semantics remain case-sensitive.
- Operational freshness is evaluated per selected source, so one recently fetched source cannot conceal another stale/failed source.
- Native clients use an additive collection envelope with `state`, `sourceCount`, and `failedSourceCount`; existing array routes remain compatible for current web consumers.
- MongoDB remains the only runtime database. Firestore persistence and runtime repository selection were not restored.

Full rationale is recorded as D-028 and D-029 in `DECISIONS.md`.

## API and data contract changes

`TrustedAcademicContentDto` now carries normalized source identity, official/canonical URLs, scope/content types, independently optional source publication/update/discovery/fetch timestamps, and freshness. Persistence-only `rawTitle`, trust reasons, duplicate links, and quarantine data are never serialized.

`TrustedAcademicContentCollectionDto` is additive and powers:

- `GET /announcements/my/trusted`
- `GET /announcements/yok/trusted`

It contains trusted `items`, `state`, `sourceCount`, and `failedSourceCount`. Existing `/announcements/my` and `/announcements/yok` array behavior remains available. `/calendar/summer-school/my` retains its existing arrays and adds `announcementStatus` with equivalent source-health fields.

Schemas/indexes persist canonical URLs, raw/display titles, trust state/reasons, timestamp provenance, discovery/fetch values, freshness, dedupe keys, and duplicate linkage. Mongo reads require exact trusted state for both source and item.

## Stored-content reconciliation runbook

The command is dry-run by default and must be operated only with explicit authorization:

1. Create and verify an external Mongo backup; test on an authorized non-production clone first.
2. Set `MONGODB_URI` without printing or committing it.
3. Run `npm.cmd run reconcile:content-trust`.
4. Review the reported database name and source/item summary counts.
5. Run `npm.cmd run reconcile:content-trust -- --apply --confirm-database=<exact-database-name> --batch-size=250` only after review.
6. Treat exit code 2 as a conflict/partial-apply condition. Stop concurrent writers as authorized, then rerun dry-run.
7. Repeat dry-run/apply until dry-run reports zero source and item mutations.

Apply mode checks a per-document preimage and `updatedAt`, skips all item writes after any source conflict, preserves explicit rejection/quarantine and raw audit titles, and plans around legacy unique indexes. It is not transactional, does not create a backup, and database-name confirmation does not prove an environment is non-production. Phase 2 connected to no database and repaired no live/stored records directly.

## Tests added or materially extended

- Entity decoding (including deep/residual cases), text sanitation, exact captured raw-title preservation, pagination-prefix removal, unusable-title normalization, and required navigation/footer rejection.
- Unsafe/unofficial URL rejection, redirects, credentials/ports/private hosts, canonical query/host behavior, path/query case, and duplicate winner selection.
- Publication-versus-update-versus-discovery/fetch semantics, arbitrary title-date rejection, source-scoped listing-date handling, invalid dates, update-only source markup, persisted failure state, and per-source freshness.
- YÖK, Ankara University, and generic fallback HTML fixtures plus JSON/RSS/Atom trust behavior.
- Trusted-only repository reads, quarantined schema defaults, source-authoritative DTOs, legacy contamination, missing/mismatched sources, Summer School suppression/status, and additive API envelopes.
- Reconciliation CLI validation, database URI parsing, timestamp storage shape, runtime catalog/YÖK authority, direct executable preimage/`updatedAt` conflict handling, missing/untrusted-source repair, manual trust preservation, source/item collision handling under legacy indexes, determinism, and idempotence.
- Native entity/timestamp/URL handling, canonical case semantics, partial/stale/empty/error states, retained refresh data, Summer dual refresh/status, and URL-less non-pressable cards.

## Exact commands and final results

| Command/check | Result |
|---|---|
| Focused eight-file Vitest command recorded in `TEST_MATRIX.md` | PASS, 8 files / 135 tests |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run typecheck:mobile:native` | PASS |
| `npm.cmd test -- --configLoader runner` | PASS, 36 files / 400 tests; above the 32 / 299 baseline |
| `npm.cmd run build:admin` | PASS, 1,742 modules; identical approved run outside restricted esbuild filesystem view |
| `npm.cmd run build:mobile` | PASS, 1,754 modules; identical approved run outside restricted esbuild filesystem view |
| `.\gradlew.bat --no-daemon app:assembleDebug -PreactNativeArchitectures=x86_64` from `apps/mobile-native/android` | PASS outside the restricted Android SDK view, `BUILD SUCCESSFUL` in 50 seconds; 174 tasks |
| Controlled invalid-argument reconciliation smoke | PASS: expected exit 1 / `CONTENT_RECONCILIATION_ARGUMENT_INVALID`; no environment lookup or database connection |
| Expanded sensitive-log scan | PASS: reconciliation logs only database name/count summaries and controlled errors; no URI, credential, token, password, authorization header, raw content, or payload logging |
| `git diff --check` and final cached-diff check | PASS; no whitespace errors, expected LF-to-CRLF notices only |

## Native screenshots and visual QA

The initial Phase 2 debug APK was installed on the existing accelerated `AcademicPhase1Low` AVD. An offline, local-only Metro server delivered that Phase 2 JavaScript bundle. Hydration settled to the signed-out Turkish Login surface; `uiautomator` exposed labelled Login/Register/Google/email/password/recovery controls, and the targeted fatal React/native log filter returned no fatal match. A temporary binary-safe screenshot was visually inspected at `C:\tmp\academic-phase2-native-login-adb.png`; it is not committed as content-screen evidence. The 31 July senior-hardening source was reassembled successfully, but no emulator was attached for another launch; no post-audit visual claim is added.

`VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED`

Representative authenticated content loading, empty, no-results, partial, stale, retry, long-title, and external-handoff screens could not be reached because this workspace had no authorized local authenticated API/session fixture. The phase explicitly prohibited production-data access, so no production account or content was used. Native content visual acceptance and screen-reader acceptance are not claimed; MN-032 records the rerun requirement.

## Accessibility checks

- The initial Phase 2 signed-out runtime hierarchy exposed semantic labels for primary authentication controls and visibility/recovery actions; the senior-hardening build passed assembly but was not relaunched.
- Content error/empty/partial/stale copy and link states are deterministic and covered by helper/source-contract tests.
- URL-less Summer records are no longer silent pressables.
- No TalkBack/content-screen or rendered component acceptance is claimed under the authenticated-fixture blocker. Existing MN-019 and MN-032 remain open evidence boundaries.

## Historical limitations recorded at the Phase 2 milestone

- Reconciliation was not executed against local, staging, or production data. Operational apply remains backup-first, optimistic, conflict-aware, and non-transactional.
- The new API tests exercise controller/service presentation with test repositories rather than a live deployed Nest/Mongo endpoint.
- Existing clients can continue using array routes; only native consumes failed-source envelopes in this phase.
- The current native compatibility normalizer tolerates an absent additive `officialSourceUrl`, while the trusted API always requires and emits source authority.
- No native lint script/component runner exists; Phase 4 owns that tooling decision.
- Authenticated native content visual/screen-reader evidence remains blocked as described above.

## Regressions checked

Agenda/Announcements, YÖK, Summer School, calendar source reads, source discovery, schema/index behavior, Mongo-only runtime wiring, authentication, password recovery, notification tests, native session integrity, Google Calendar sync, admin build, mobile web build, and native debug assembly all remain green. No authentication, FCM, Hosting, OAuth, Google Calendar, password recovery, navigation, or mobile visual-design source was intentionally changed outside the content-consumption boundary.

## Working-tree disposition

Only the Phase 2 files enumerated in this report belong to the local scoped commit. Pre-existing unrelated untracked logo assets, source-coverage exports/reports, redesign documents for other phases, and prompts remain preserved and uncommitted. No push, deploy, publish, or production-data operation occurred.

## Historical next-phase handoff

Phase 3 may consume the trusted content contract and the explicit MN-032 visual-evidence rerun requirement. It must not weaken source/timestamp/URL trust or reinterpret fetch time as publication time.

Phase 3 was not started. Authentication, password recovery, push delivery, Google OAuth/Calendar behavior, navigation, and mobile visual design remain outside this phase.
