# Mobile Native Redesign Program

Status date: 4 August 2026

Product target: `apps/mobile-native`

Package manager: npm

Historical Phase 1 closure-start baseline: branch `agent/google-play-readiness-20260724`, HEAD `cbd0067b03c3cf7286270df25164a556c55b55b9`.

Accepted Phase 8 baseline: `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9`. The bounded Phase 1–8 remediation commits are Package 1 `641d7bee8a1cd539179769069a22b5c3220e8a6d`, Package 2 `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25`, and Package 3 `2e3664546f628a19c6fa929b9ee9469e5322f9a8`. The documentation-only Package 4 commit is reported in the terminal handoff because a commit cannot contain its own SHA.

The earlier Phase 1–6 reconciliation at `f346d8556e19b95277b27f7ecfda3f162a8ad57f` remains historical evidence in [`phase-01-06-reconciliation.md`](./phases/phase-01-06-reconciliation.md); it is not the current implementation boundary.

## Purpose

This directory is the permanent delivery contract for the native redesign. The work is incremental: preserve the existing product and backend contracts, first repair trust and session integrity, then establish the shared design foundation, and only then redesign screens.

The desired product is Turkish-first, content-first, and student-focused. Its feed hierarchy may learn from LinkedIn's information density, source identity, and scanning rhythm, but it must remain a distinct Academic Calendar / ANSSOFT product. It must not copy LinkedIn branding, trade dress, icons, or social mechanics.

## Binding delivery rules

- Run phases in numerical order and complete only one phase per request unless the user explicitly authorizes a bounded cross-phase reconciliation such as the recorded Phase 1–8 remediation.
- Do not reset or discard the user's working tree.
- Do not push, deploy, publish, or modify production infrastructure.
- Do not silently remove Summer School, YÖK, Agenda, Google Calendar, notification preferences, account deletion, or any other existing capability.
- A phase is not accepted without its report, exact test evidence, known limitations, accessibility checks, and working-tree record.
- Expo Web is never native visual evidence.
- If no Android device/emulator or iOS simulator/device can be used, record `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED`.
- Keep content surfaces readable and mostly opaque. iOS glass is reserved for navigation/control chrome.
- Use shared semantic tokens and content models, with platform-specific presentation where native conventions differ.

## Target information architecture

The authenticated phone shell has four primary destinations:

1. **Ana Sayfa** — personalized next actions, upcoming dates, and compact trusted-content modules.
2. **Duyurular** — unified announcement/news/event feed; YÖK and Summer School remain available as sources/filters or scoped destinations rather than bottom tabs.
3. **Takvim** — academic timeline, exam planning, event detail, and calendar integrations.
4. **Profil** — academic identity, notification settings, integrations, data controls, and account controls.

Authentication, registration, verification, and onboarding live outside the authenticated tab shell.

## Phase status

| Phase | Scope | Status | Report |
|---:|---|---|---|
| 00 | Baseline, checkpoint, design contract, test inventory | Complete — 2026-07-29 | [phase-00-baseline.md](./phases/phase-00-baseline.md) |
| 01 | Authentication and session integrity | Complete — original checkpoint chain ended at `18a93d4`; verified security closure is `641d7bee` | [phase-01-auth-session-integrity.md](./phases/phase-01-auth-session-integrity.md) |
| 02 | Content correctness and trust | Complete at `d722f90`; date/range, outbound-fetch, layout, and identity hardening completed at `5a6ac1a4` | [phase-02-content-trust.md](./phases/phase-02-content-trust.md) |
| 03 | Google Calendar and notification integrations | Complete at `b74bdcc`; automatic notification production/dispatch and temporal correctness completed at `5a6ac1a4` | [phase-03-integrations.md](./phases/phase-03-integrations.md) |
| 04 | Design tokens, components, theming, test foundation | Complete at `abbf1b7`; platform evidence limitations remain explicit | [phase-04-foundation.md](./phases/phase-04-foundation.md) |
| 05 | Four-destination native app shell | Complete at `abdf0cc`; integrated reselect/retention/inset coverage completed at `2e366454` | [phase-05-app-shell.md](./phases/phase-05-app-shell.md) |
| 06 | Authentication and onboarding UI | Complete at `00e03ac`; first-step marker and real first-invalid Login focus completed at `2e366454` | [phase-06-auth-onboarding-ui.md](./phases/phase-06-auth-onboarding-ui.md) |
| 07 | Home | Complete at `f346d85`, accepted reconciliation `d96dff5`; temporal and state/priority repairs completed at `5a6ac1a4` and `2e366454` | [phase-07-home.md](./phases/phase-07-home.md) |
| 08 | Unified content feed | Implemented at `7b64c9c`; temporal corrections and accepted release-performance evidence completed at `5a6ac1a4` and `2e366454` | [phase-08-content-feed.md](./phases/phase-08-content-feed.md) |
| 09 | Calendar and planning | Not started | Planning file intentionally remains untracked |
| 10 | Profile and settings | Not started | Planning file intentionally remains untracked |
| 11 | Cross-platform quality and native visual QA | Not started | Planning file intentionally remains untracked |
| 12 | Final reconciliation and release evidence | Not started | Planning file intentionally remains untracked |

## Permanent documents

- [DECISIONS.md](./DECISIONS.md) — accepted decisions and explicitly deferred choices.
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — semantic visual and interaction contract.
- [PLATFORM_ADAPTATION.md](./PLATFORM_ADAPTATION.md) — shared behavior with distinct iOS/Android expression.
- [SCREEN_INVENTORY.md](./SCREEN_INVENTORY.md) — current views/states and target ownership.
- [TEST_MATRIX.md](./TEST_MATRIX.md) — baseline evidence and required coverage.
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — prioritized defects with ownership.

## Supporting current-state evidence

- [Current native UI/UX audit](../19-mobile-native-current-state-ui-ux-audit.md)
- [Current in-app activity report](../20-mobile-native-in-app-user-activity-report.md)

Those reports are source-derived. Native visual acceptance still requires emulator/device or simulator/device screenshots.

## Current Phase 1–8 remediation boundary

Packages 1–3 close the verified implementation gaps without recreating completed phases. Package 1 enforces credential generations across access, refresh, and recovery material; commits password reset through a standalone-Mongo compare-and-set boundary; adds owner-bound expiring recent-authentication proof; makes recovery request work practically comparable; defines bounded proxy trust; and removes the legacy Firebase web-key fallback. MongoDB remains the only runtime database. Firestore database persistence is historical evidence only and was not restored.

Package 2 preserves date-only and inclusive date-range meaning through ingestion, Mongo, trusted DTOs, Home, feed/detail, and future Calendar compatibility. It validates the actual outbound destination at every redirect, retains strict TLS, strengthens parser layout and content identity, and automatically creates, dispatches, revalidates, retries, and retires Mongo-backed notification jobs. Package 3 adds bounded shell/auth/Home regression repairs and a repository-owned Android release feed measurement. The attempted `4/3/window 3/75 ms` plus clipping experiment worsened the SwiftShader run and was fully reverted; the original FlatList settings remain shipped.

The accepted performance run used `NODE_ENV=production`, a non-debuggable x86_64 release build, the deterministic 100-record fixture, and the API 24 emulator at 720×1280/320 dpi with the host Intel renderer. Five trials produced 600 valid frames, aggregate p90 `24.928167 ms`, p95 `35.777763 ms`, and zero frames at or above 700 ms; APK SHA-256 is `ce910347fbb1b663c1ec12b8b03b442533655e23a131093bd4abcbdeded17a26`. This is bounded local release evidence, not production-device, modern-Android, or iOS performance acceptance.

Audit classification is explicit:

- **Fixed now:** the Package 1 security gaps, Package 2 content/date/notification gaps, Package 3 shell/auth/Home/performance gaps, and current-state documentation drift.
- **Intentionally deferred:** manual-exam edit/delete and native date picking remain Phase 9; predictive Back, complete iOS/TalkBack/tablet acceptance, native lint, installed native E2E, and broad `App.tsx` decomposition remain later work.
- **Evidence-only:** unavailable iOS/VoiceOver, modern Android notification/predictive-Back, live provider, authenticated-content fixture, TalkBack, and physical tablet/rail results are not relabelled as implementation failures or acceptance.
- **Unsupported by committed contracts:** raw article bodies, numeric parser scores, production reconciliation/migration, Firestore restoration, Redis/BullMQ/replica-set requirements, invented actions/badges/social mechanics, wholesale redesign, and a new native E2E framework were not implemented.

Phase 9 was not started. The untracked Phase 9–12 planning documents are not implementation and are excluded from the Phase 1–8 commits.
