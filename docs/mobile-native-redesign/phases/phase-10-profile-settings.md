# Phase 10 — Profile and Settings

Status: Implementation, automated validation, bounded Android native evidence, and documentation reconciliation passed. The scoped commit identity and post-documentation repository-state checks are reported in the final acceptance handoff.

> **Current provenance note — 6 August 2026.** The final scoped Phase 10 commit is `8dbe5e1efdb0c5fab665345188228ff66a0f84f6`. Statements below that Phase 11 was not started describe the Phase 10 checkpoint; Phase 11 is now complete at descendant `f50a45bddcd7d476c4f1797bede77da65fc4c6fc`.

Date: 5 August 2026

Accepted starting baseline: `2e8a77fe04f2b89c75d6c636a0dd7abfee4c60f5`

## Objective and scope completed

Phase 10 replaces the legacy Profile/settings presentation while preserving all accepted Phase 1–9 behavior. The implemented hierarchy is:

1. real identity and academic-completeness summary;
2. read-only personal information;
3. routed academic profile editing;
4. routed notification settings;
5. routed Google Calendar connections;
6. truthful app version/build information;
7. routed account management;
8. a collapsed danger area containing data and account deletion.

The summary uses the current authoritative `/me` full name, institution hierarchy, secondary email, and completeness state. Account receives the same authoritative `/me` email rather than a stale session or provider fallback; it does not invent a separate account name field. The presentation does not invent a photograph, student identifier, social identity, activity statistic, or engagement count. Appearance is omitted because the app follows system appearance and has no persisted theme choice. Help, privacy-policy, terms, and support rows are omitted because no real destination exists.

Academic settings reuse shared searchable and virtualized university/faculty/department controls, preserve optional class selection, clear incompatible descendants in the draft, and expose loading, no-result, error/retry, expanded, selected, invalid, dirty, saving, saved, and error states. Picker changes do not mutate the profile. One Save submits a complete replacement and adopts the returned server profile as authoritative. A failed save remains dirty and retryable. Dirty header Back, Android Back, navigation removal, and explicit Cancel all enter the same discard guard. Academic and Account routes use the shared keyboard-safe screen boundary.

Notification settings distinguish OS permission, installation registration, stored preference, and effective delivery. The stored preference always reads **Açık** or **Kapalı** independently of dirty, saving, saved, or failed-save state. Delivery is active only when preference, granted permission, and registration all agree. The existing supported mode/categories and native Settings handoff remain available; the handoff is duplicate-safe, exposes busy semantics, and converts rejection to fixed controlled feedback. Device tokens, provider credentials, and unsupported reminder or quiet-hours controls are not shown.

The Google route is compact but preserves Phase 3 connect, verification, sync, switch-account, disconnect-retain, managed-event removal, revoke, partial-success, ownership, mapping, cancellation, and late-operation behavior. It presents account, last sync, lifecycle, current managed-mapping count, and mapping/partial warnings without implying a guarantee. A retained ledger and its applicable actions remain available when the provider connection is disconnected. All actions honor the lifecycle coordinator's external busy state; successful managed-event removal returns focus to the surviving heading when its launcher disappears. Personal Google Calendar events remain outside every mutation path.

Account management keeps logout, delete app data, and delete account distinct. The danger area is collapsed by default. Destructive confirmations explain consequences, allow cancel, return focus, lock duplicate submissions, expose fixed non-raw error states, and use the existing purpose-bound, single-use recent-authentication proof. Profile/Account operation feedback is semantic and rendered only on its owning active route, preventing duplicate banners.

Phase 10 does not redesign Home, Announcements, Calendar, authentication, or onboarding. It does not alter an API, database schema, repository, persistence envelope, provider configuration, authentication/session rule, recent-authentication security contract, notification backend contract, or Google Calendar lifecycle. At the Phase 10 implementation checkpoint, Phase 11 was not started.

## Files changed

Final scoped source and test inventory:

- `apps/mobile-native/App.tsx`
- `apps/mobile-native/src/academic/AcademicProfileFields.tsx`
- `apps/mobile-native/src/auth/AuthScreens.tsx`
- `apps/mobile-native/src/auth/RecentAuthenticationPanel.tsx`
- `apps/mobile-native/src/design-system/primitives/BottomSheet.tsx`
- `apps/mobile-native/src/design-system/primitives/Button.tsx`
- `apps/mobile-native/src/design-system/primitives/Content.tsx`
- `apps/mobile-native/src/design-system/primitives/SelectField.tsx`
- `apps/mobile-native/src/navigation/AppNavigator.tsx`
- `apps/mobile-native/src/profile/index.ts`
- `apps/mobile-native/src/profile/profile-model.ts`
- `apps/mobile-native/src/profile/ProfileSettings.tsx`
- `apps/mobile-native/src/profile/ProfileSettingsPreview.tsx`
- `apps/mobile-native/tests/design-system/selection-sheet.test.tsx`
- `apps/mobile-native/tests/auth/RecentAuthenticationPanel.test.tsx`
- `apps/mobile-native/tests/navigation/AppNavigator.test.tsx`
- `apps/mobile-native/tests/profile/ProfileSettings.test.tsx`
- `apps/mobile-native/tests/profile/ProfileSettingsPreview.test.tsx`
- `tests/unit/mobile-native-profile-settings.test.ts`

Documentation updated by this phase:

- `docs/mobile-native-redesign/DESIGN_SYSTEM.md`
- `docs/mobile-native-redesign/PLATFORM_ADAPTATION.md`
- `docs/mobile-native-redesign/SCREEN_INVENTORY.md`
- `docs/mobile-native-redesign/DECISIONS.md`
- `docs/mobile-native-redesign/KNOWN_ISSUES.md`
- `docs/mobile-native-redesign/TEST_MATRIX.md`
- `docs/mobile-native-redesign/phases/phase-10-profile-settings.md`

Native evidence added by this phase:

- `docs/mobile-native-redesign/evidence/phase-10-native/README.md`
- 44 original-resolution PNG screenshots and 44 basename-matched UIAutomator XML exports
- `raw/integrity-index.csv` with 88 hashed artifact rows
- filtered/runtime assertions and restored-device-state records under `raw/`

## Design and architecture decisions

- Profile is a grouped settings index with dedicated control routes, not a nested-card dashboard.
- Shared pure profile policy resolves section order, academic completeness/commit behavior, notification truth, Google lifecycle presentation, and compact/large-text layout without taking ownership from the existing session, API, notification, or Google coordinators.
- Academic onboarding and settings share field presentation, while settings own their independent draft, one-save transaction, returned-server baseline, dirty retry, and one route-leave guard shared by Back/navigation removal/explicit Cancel.
- Profile uses authoritative `/me` identity and Account uses its authoritative `/me` email; form-bearing Academic and Account routes are keyboard-safe, and route feedback has one semantic owner.
- Android uses Material 3-compatible opaque tonal surfaces, ripple, native material/dialog boundaries, 48 dp targets, and edge-to-edge ownership. iOS Liquid Glass remains eligible only for supported navigation/control chrome; settings content is opaque.
- State and classification use text/icon plus semantics rather than color alone. Selected, busy, expanded/collapsed, invalid, dirty/saved, disabled, and error states are explicit.
- At 320 dp and 200% text, rows/actions stack or wrap and modal content scrolls. Tablet content stays within the readable-width contract.
- The Phase 10 preview is synthetic, dual development-gated, reserved-fixture-only, and isolated from API, SecureStore, authentication, notification-provider, and Google-provider modules.

## API and data contract changes

None. The existing complete-replacement academic profile request, notification preference contract, device-registration lifecycle, Google Calendar owner/mapping lifecycle, owner-scoped personal data, logout, deletion endpoints, and recent-authentication purposes are preserved.

No migration, deployment, production access, credential use, provider operation, or data repair is part of Phase 10.

## Tests and build results

| Validation | Result |
|---|---|
| Focused Phase 10 native renderer/navigation/selector/auth paths | PASS — 5 suites / 71 tests / 0 snapshots |
| Focused Phase 10 root model/lifecycle paths | PASS — 5 files / 80 tests |
| Complete native Jest | PASS — 23 suites / 206 tests / 0 snapshots |
| Complete API tests against the dedicated temporary `127.0.0.1` Mongo fixture | PASS — 45 files / 445 tests |
| Full root Vitest regression | PASS — 72 files / 841 tests |
| Workspace TypeScript | PASS |
| Mobile-native TypeScript | PASS |
| Admin build | PASS — 1,742 modules; JS 250.51 kB / 73.89 kB gzip; 5.14 s |
| Mobile-web build | PASS — 1,755 modules; JS 349.76 kB / 104.37 kB gzip; 7.92 s |
| Android x86_64 debug assembly | PASS — 1 m 11 s; 268 tasks (7 executed, 261 up-to-date) |
| Android debug APK | 56,804,991 bytes; SHA-256 `57DC2F1BDCD7D7C3B02429EF260DF29A3EEEBCC374C55B90D34334793FEFAAFD` |
| Fresh APK reinstall | PASS |

The Android build emitted only the already-known SDK XML/location, Gradle deprecation, and `NODE_ENV` warnings. The APK hash is unchanged because debug JavaScript is Metro-served. Final post-documentation repository hygiene passed: `git diff --check`; trailing-whitespace and NUL checks across 77 scoped text artifacts; sensitive-log, credential, runtime-secret, forbidden-test-modifier, snapshot, vacuous/empty-test, Firestore, fake-social, and production Phase 11 scans all reported zero prohibited matches. The Phase 11 wording retained in one test is the negative guard that asserts those markers are absent from production. `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact.

## Native screenshots and visual QA

Android x86_64 assembly, APK hashing, and a fresh reinstall passed as recorded above. [`evidence/phase-10-native`](../evidence/phase-10-native/README.md) indexes 44 original-resolution PNG screenshots, 44 basename-matched UIAutomator XML exports, and 88 integrity rows. Reviewed coverage includes phone light/dark, exact 320 dp at font scale 2.0, a temporary simulated-tablet viewport, reachable academic/notification/Google/destructive actions, measured 48 dp controls, and ordinary Android Back from Notifications to Profile in the same process.

The captured 772-line, 78,370-byte app-process log is accompanied by a final `NO_MATCHES` result for fatal/AndroidRuntime/React Native `TypeError`, `ReferenceError`, invariant, unhandled, and unable-to-load filters. Device size, density, and font scale were restored to 720 x 1280 / 320 / 1.0. Only synthetic local fixtures were used. Expo Web output is not native evidence.

## Accessibility checks

Implementation contracts cover logical reading order, 48 by 48 dp targets, selected/busy/expanded/collapsed/invalid/error semantics, non-color status, long institutional names, sheet/dialog focus return, dirty Back confirmation, exact 320 dp, tablet width, dark mode, and 200% text reachability.

Focused renderer/navigation/selector/auth assertions passed in 5 suites / 71 tests, including the Phase 10 component, focus-return, route-guard, selector, and preview contracts. Native hierarchy/layout review confirms measured 48 dp Back, Open Settings, and accessible switch targets plus nonzero reachable bounds for required actions at exact 320 dp and 200% font. The simulated tablet keeps principal settings rows inside the 720 dp readable-width cap. TalkBack traversal cannot be claimed because the authorized AVD reported accessibility disabled; Windows cannot provide VoiceOver or native iOS Dynamic Type acceptance. The dirty academic leave guard is covered by automated production-route tests and is not claimed as a native dirty-Back smoke.

## Known limitations

- No iOS/Xcode/VoiceOver/Liquid Glass runtime is available on this Windows host.
- The authorized Android API 24 AVD cannot prove Android 13 notification permission or predictive Back.
- No authorized non-production Google Calendar, FCM, or APNs account/provider fixture exists; no live chooser, provider mutation, revoke, or delivery is claimed.
- Synthetic preview evidence cannot prove an authenticated relaunch/account-switch journey or OS SecureStore behavior.
- The tablet evidence uses a temporary emulator `wm` override and is not a physical-tablet result.
- The native smoke proves ordinary clean Back in one process; it does not claim a native dirty academic-guard flow. Automated production-route tests cover that guard.
- `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact.

## Regressions checked

Automated regression passed: focused lifecycle/security coverage 5 files / 80 tests, complete API 45 / 445, full root 72 / 841, complete native Jest 23 / 206 / 0 snapshots, both TypeScript checks, both web builds, and Android x86_64 assembly. This covers the executable Phase 1 recent-authentication, Phase 3 notification/Google lifecycle, Phase 5 navigation, Phase 6 shared academic fields, and Phase 9 Calendar/personal-exam regressions represented by those suites. The bounded installed Android review passed as described above; no live provider, authenticated storage, production behavior, iOS behavior, or assistive-technology traversal is inferred.

## Historical next-phase handoff

The following statement is retained as the Phase 10 handoff checkpoint:

Stop after Phase 10. Phase 11 was not started. Its whole-app cross-platform acceptance boundary remains outside this implementation and evidence set.

## Historical Git state at report authoring

- Branch: `agent/google-play-readiness-20260724`
- Starting HEAD: `2e8a77fe04f2b89c75d6c636a0dd7abfee4c60f5`
- HEAD while this report is part of the uncommitted scoped diff: `2e8a77fe04f2b89c75d6c636a0dd7abfee4c60f5`; the exact final HEAD is reported in the acceptance handoff because this document is included in that commit.
- Required commit subject: `feat(mobile-native): redesign profile and settings experience`
- Unrelated untracked files remain preserved and outside the Phase 10 scoped commit.

## Historical exit gate

The final acceptance handoff must record the post-documentation hygiene/scope result, starting and final HEAD, and the single scoped local commit; confirm no push, deploy, publish, migration, production access, or live-provider access; and stop before Phase 11.
