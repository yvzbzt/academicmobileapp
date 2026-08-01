# Mobile Native Redesign Program

Status date: 2 August 2026

Product target: `apps/mobile-native`

Package manager: npm

Phase 1 closure-start baseline: branch `agent/google-play-readiness-20260724`, HEAD `cbd0067b03c3cf7286270df25164a556c55b55b9`; final checkpoint SHA is reported outside the self-containing commit
Current reconciliation HEAD: `f346d8556e19b95277b27f7ecfda3f162a8ad57f`; Phase 1–6 reconciliation is recorded in [`phase-01-06-reconciliation.md`](./phases/phase-01-06-reconciliation.md)

## Purpose

This directory is the permanent delivery contract for the native redesign. The work is incremental: preserve the existing product and backend contracts, first repair trust and session integrity, then establish the shared design foundation, and only then redesign screens.

The desired product is Turkish-first, content-first, and student-focused. Its feed hierarchy may learn from LinkedIn's information density, source identity, and scanning rhythm, but it must remain a distinct Academic Calendar / ANSSOFT product. It must not copy LinkedIn branding, trade dress, icons, or social mechanics.

## Binding delivery rules

- Run phases in numerical order and complete only one phase per request.
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
| 01 | Authentication and session integrity | Complete — five-checkpoint chain ending at `18a93d4`; open backend/evidence limitations remain explicit | [phase-01-auth-session-integrity.md](./phases/phase-01-auth-session-integrity.md) |
| 02 | Content correctness and trust | Complete at `d722f90`; authenticated content-screen native QA remains blocked by the documented fixture boundary | [phase-02-content-trust.md](./phases/phase-02-content-trust.md) |
| 03 | Google Calendar and notification integrations | Complete at `b74bdcc`; modern Android/iOS and live non-production provider acceptance remain open | [phase-03-integrations.md](./phases/phase-03-integrations.md) |
| 04 | Design tokens, components, theming, test foundation | Complete at `abbf1b7`; platform evidence limitations remain explicit | [phase-04-foundation.md](./phases/phase-04-foundation.md) |
| 05 | Four-destination native app shell | Complete at `abdf0cc`; iOS, predictive Back, TalkBack, and broader large-text acceptance remain open | [phase-05-app-shell.md](./phases/phase-05-app-shell.md) |
| 06 | Authentication and onboarding UI | Complete at `00e03ac`; installed live-account E2E and unavailable platform/provider checks remain unclaimed | [phase-06-auth-onboarding-ui.md](./phases/phase-06-auth-onboarding-ui.md) |
| 07 | Home | Present in pre-reconciliation history at `f346d85`; outside the Phase 1–6 reconciliation scope and not modified by it | [phase-07-home.md](./phases/phase-07-home.md) |
| 08 | Unified content feed | Not started | [phase-08-content-feed.md](./phases/phase-08-content-feed.md) |
| 09 | Calendar and planning | Not started | [phase-09-calendar.md](./phases/phase-09-calendar.md) |
| 10 | Profile and settings | Not started | [phase-10-profile-settings.md](./phases/phase-10-profile-settings.md) |
| 11 | Cross-platform quality and native visual QA | Not started | [phase-11-cross-platform-quality.md](./phases/phase-11-cross-platform-quality.md) |
| 12 | Final reconciliation and release evidence | Not started | [phase-12-final-reconciliation.md](./phases/phase-12-final-reconciliation.md) |

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

## Phase 1 delivery boundary

Phase 1 repairs authentication, cold-start hydration, session ownership, user-scoped local storage, destructive cleanup, and academic hierarchy integrity. It adds only the UI states needed to explain those repaired flows. The broad visual redesign and content-trust work have not started, no analytics SDK was added, and Phase 2 remains a separate approval gate.

The [test matrix](./TEST_MATRIX.md) separates the earlier integrity snapshot from the final password-recovery closure. Recovery implementation-stage checks passed 24/24 focused API/schema tests, 9/9 password-recovery tests, 2 native files/42 tests, and workspace/native TypeScript. Official Android Studio Stable, Emulator 36.6.11, WHPX, one API 24 Google APIs x86_64 image, and exactly one `AcademicPhase1Low` AVD now exist. Current x86_64 debug assembly/install, expected package/MainActivity startup, no-immediate-crash smoke, a visible 4.5-second Quick Boot, and signed-out no-Home-flash check passed.

Installed-app hydration, verification recovery/resend/error separation, verification-success→later-Login-failure, password recovery/visibility/Back/Cancel, reset/old-new Login, two-session revocation, two-account isolation, hierarchy replacement, logout staleness, 360/320 dp, and the full required six-surface 200%-font set passed. Home navigation labels visibly wrap/truncate and recovery placeholders truncate at 2.0. TalkBack is unavailable on the selected minimal Google APIs image; the exact package/service blocker is documented, so no screen-reader acceptance is claimed. Final TypeScript, focused and full regression tests, both web builds, Android/Hermes exports, sensitive-log scan, whitespace check, and resource cleanup passed. The scoped local checkpoint SHA is reported in the handoff because a commit cannot contain its own hash. Phase 2 remains prohibited.
