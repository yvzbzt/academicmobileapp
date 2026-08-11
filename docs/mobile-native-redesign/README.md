# Mobile Native Redesign Program

The current reference-led visual contract is documented in
[`REFERENCE_DESIGN_BIBLE.md`](./REFERENCE_DESIGN_BIBLE.md).

Status date: 11 August 2026

Product target: `apps/mobile-native`

Package manager: npm

Historical Phase 1 closure-start baseline: branch `agent/google-play-readiness-20260724`, HEAD `cbd0067b03c3cf7286270df25164a556c55b55b9`.

Accepted Phase 11 baseline and Phase 12 starting HEAD: `f50a45bddcd7d476c4f1797bede77da65fc4c6fc`. The complete milestone and repair ancestry is recorded in the [Phase 12 final reconciliation](./phases/phase-12-final-reconciliation.md). Earlier bounded reconciliation commits remain part of that ancestry and are historical evidence rather than the current release boundary.

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
| 01 | Authentication and session integrity | Complete — implementation through `18a93d4`; repairs `641d7bee` and `1dd36d1` | [phase-01-auth-session-integrity.md](./phases/phase-01-auth-session-integrity.md) |
| 02 | Content correctness and trust | Complete at `d722f90`; repairs `5a6ac1a4` and `1dd36d1` | [phase-02-content-trust.md](./phases/phase-02-content-trust.md) |
| 03 | Google Calendar and notification integrations | Complete at `b74bdcc`; repairs `5a6ac1a4` and `c5c4744` | [phase-03-integrations.md](./phases/phase-03-integrations.md) |
| 04 | Design tokens, components, theming, test foundation | Complete at `abbf1b7`; platform evidence limitations remain explicit | [phase-04-foundation.md](./phases/phase-04-foundation.md) |
| 05 | Four-destination native app shell | Complete at `abdf0cc`; integrated reselect/retention/inset coverage completed at `2e366454` | [phase-05-app-shell.md](./phases/phase-05-app-shell.md) |
| 06 | Authentication and onboarding UI | Complete at `00e03ac`; first-step marker and real first-invalid Login focus completed at `2e366454` | [phase-06-auth-onboarding-ui.md](./phases/phase-06-auth-onboarding-ui.md) |
| 07 | Home | Complete at `f346d85`, accepted reconciliation `d96dff5`; temporal and state/priority repairs completed at `5a6ac1a4` and `2e366454` | [phase-07-home.md](./phases/phase-07-home.md) |
| 08 | Unified content feed | Implemented at `7b64c9c`; temporal corrections and accepted release-performance evidence completed at `5a6ac1a4` and `2e366454` | [phase-08-content-feed.md](./phases/phase-08-content-feed.md) |
| 09 | Calendar and personal exams | Complete at `b8f77c8`; acceptance repair `2e8a77f` | [phase-09-calendar.md](./phases/phase-09-calendar.md) |
| 10 | Profile and settings | Complete at `8dbe5e1` | [phase-10-profile-settings.md](./phases/phase-10-profile-settings.md) |
| 11 | Cross-platform quality and native visual QA | Complete at `f50a45b` | [phase-11-cross-platform-quality.md](./phases/phase-11-cross-platform-quality.md) |
| 12 | Final reconciliation and release-readiness gate | Complete — local closure commit recorded by Git history | [phase-12-final-reconciliation.md](./phases/phase-12-final-reconciliation.md) |

## Reference-board implementation update

The post-Phase-12 visual milestone applies the supplied reference board across the native product without changing the four-route information architecture. It adds the fixed-height pre-login introduction, reference-led authentication and onboarding, the white/blue visual foundation, refreshed Home, Announcements, Calendar, and Profile screens, and the supporting backend contracts for trusted announcements and scoped calendar data.

Tracked application metadata is now version `0.1.3` with Android version code `14`. The checkpoint passed the full root and native test suites, both TypeScript checks, native Android visual/runtime review, and a locally signed release APK build. APKs, signing inputs, raw screenshots, UI hierarchy exports, and runtime logs remain local artifacts and are intentionally excluded from source control.

## Permanent documents

- [DECISIONS.md](./DECISIONS.md) — accepted decisions and explicitly deferred choices.
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — semantic visual and interaction contract.
- [PLATFORM_ADAPTATION.md](./PLATFORM_ADAPTATION.md) — shared behavior with distinct iOS/Android expression.
- [SCREEN_INVENTORY.md](./SCREEN_INVENTORY.md) — current views/states and target ownership.
- [TEST_MATRIX.md](./TEST_MATRIX.md) — baseline evidence and required coverage.
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — prioritized defects with ownership.

## Historical baseline reports

- [Historical pre-redesign native UI/UX audit at `cbd0067`](../19-mobile-native-current-state-ui-ux-audit.md)
- [Historical pre-redesign in-app activity report at `cbd0067`](../20-mobile-native-in-app-user-activity-report.md)

Those reports preserve the original six-tab, pre-Phase-1 baseline and do not describe the current application. Current architecture and behavior are defined by this README, the Phase 1–12 reports, and the current test matrix. Phase 11 Android evidence is the current representative visual matrix; Phase 12 reconciles and re-hashes it because no production UI source changed during the final security/configuration repair.

## Current Phase 1–12 reconciliation boundary

Historical Packages 1–3 closed the verified Phase 1–8 implementation gaps without recreating completed phases. Package 1 enforces credential generations across access, refresh, and recovery material; commits password reset through a standalone-Mongo compare-and-set boundary; makes recovery request work practically comparable; defines bounded proxy trust; and removes the legacy Firebase web-key fallback. The final blocker remediation makes every recent-authentication proof single-use and purpose-specific: it carries a random identifier, persists only its digest, and is atomically consumed for the matching owner and credential generation before one destructive action. A failed action does not restore the proof, so every retry obtains a fresh purpose-specific proof. MongoDB remains the only runtime database. Firestore database persistence is historical evidence only and was not restored.

Package 2 preserves date-only and inclusive date-range meaning through ingestion, Mongo, trusted DTOs, Home, feed/detail, and future Calendar compatibility. The final blocker remediation routes all remaining API transports through per-caller safe policies, requires valid TLS everywhere, and adds durable deterministic per-device notification attempts so an unconfirmed provider outcome remains fenced across retry and restart. The trusted delivery path still creates, dispatches, revalidates, retries only proven non-acceptance, and retires Mongo-backed notification jobs without external queue infrastructure. Package 3 adds bounded shell/auth/Home regression repairs and a repository-owned Android release feed measurement. The attempted `4/3/window 3/75 ms` plus clipping experiment worsened the SwiftShader run and was fully reverted; the original FlatList settings remain shipped.

That checkpoint's accepted performance run used `NODE_ENV=production`, a non-debuggable x86_64 release build, the deterministic 100-record fixture, and the API 24 emulator at 720×1280/320 dpi with the host Intel renderer. Five trials produced 600 valid frames, aggregate p90 `24.928167 ms`, p95 `35.777763 ms`, and zero frames at or above 700 ms; APK SHA-256 is `ce910347fbb1b663c1ec12b8b03b442533655e23a131093bd4abcbdeded17a26`. The Phase 12 report records the current run; neither run is production-device, modern-Android, or iOS performance acceptance.

The historical Phase 1–8 audit classification was:

- **Fixed now:** the Package 1 security gaps, Package 2 content/date/notification gaps, Package 3 shell/auth/Home/performance gaps, and current-state documentation drift.
- **Intentionally deferred at that checkpoint:** manual-exam edit/delete and native date picking were subsequently completed in Phase 9; predictive Back, complete iOS/TalkBack acceptance, native lint, installed native E2E, and broad `App.tsx` decomposition remain unavailable or separately scoped.
- **Evidence-only:** unavailable iOS/VoiceOver, modern Android notification/predictive-Back, live provider, authenticated-content fixture, TalkBack, and physical tablet/rail results are not relabelled as implementation failures or acceptance.
- **Unsupported by committed contracts:** raw article bodies, numeric parser scores, production reconciliation/migration, Firestore restoration, Redis/BullMQ/replica-set requirements, invented actions/badges/social mechanics, wholesale redesign, and a new native E2E framework were not implemented.

Phases 9–11 completed Calendar/personal exams, Profile/settings, and cross-platform quality without reopening the earlier contracts. Phase 12 found and repaired two release-blocking regressions at their narrowest boundaries: production access/calendar signing secrets now fail closed, use distinct values, and never cross-fallback, while tracked Expo configuration now applies SecureStore backup exclusions and deterministic notification metadata during native generation. Focused coverage was added for both repairs.

The current Android implementation and local release APK are validated for the recorded test environment. Store publication still depends on Play signing acceptance, store/privacy material completion, and final checks on supported production devices. iOS implementation and publication remain unverified because the required iOS identity, signing, APNs configuration, Xcode environment, and native evidence are not available. These external release limitations do not invalidate the tested product implementation.

MongoDB remains the runtime database; Firestore persistence remains absent. The authenticated shell still has exactly four primary routes. No fake social feature, production credential, provider secret, signing input, migration, or store upload is part of the redesign source change.
