# Native Screen and State Inventory

Baseline: 29 July 2026, `apps/mobile-native/App.tsx` at HEAD `cbd0067b03c3cf7286270df25164a556c55b55b9`.

Phase 3 reconciliation: 31 July 2026 validated implementation based on `d722f9092c1d500e0145214b2b57a08d1a8191d9`. Final command and native evidence is recorded in `TEST_MATRIX.md`, the Phase 3 report, and [`evidence/phase-03-native`](./evidence/phase-03-native/README.md).

## Pre-Phase-4 rendering model (historical)

At the Phase 3 snapshot there was no navigation library or route tree. One mounted `App` component rendered logical views through `session`, `authMode`, `authStage`, and `activeTab`; six bottom-tab buttons directly set `activeTab`. Phase 4 supersedes that shell as recorded below while retaining these feature-state owners during migration.

## Ten Phase 3 logical views and Phase 4 ownership

| # | Current logical view | Current entry/state | Current primary task | Target replacement/owner |
|---:|---|---|---|---|
| 1 | Login | `!session`, `authStage=auth`, `authMode=login` | Email/password or Google sign-in; enter password recovery | Auth stack: focused Login with the implemented request/confirm recovery path |
| 2 | Registration | `!session`, `authStage=auth`, `authMode=register` | Create account identity | Auth stack: Registration with API-aligned validation |
| 3 | Verification | `!session`, `authStage=verify` | Enter code, resend, edit details | Auth stack: Verification and explicit recovery/resend states |
| 4 | Academic onboarding | `authStage=academic_onboarding` before or after safe session activation | Select and review university plus optional descendants, then save once | Onboarding stack: mandatory university, optional faculty/department/class, owner-safe final save |
| 5 | Home | `session`, `activeTab=home` | Read next academic items, shortcuts, add manual exam | **Home tab**: personalized next actions and compact trusted-content modules |
| 6 | Calendar | `session`, `activeTab=calendar` | Read dates and run Google sync | **Calendar tab**: timeline/planning, manual exams, event detail, integrations |
| 7 | Summer School | `session`, `activeTab=summer` | Read summer dates/requirements/options | **Announcements** source/filter and scoped detail; calendar dates also appear in Calendar |
| 8 | YÖK | `session`, `activeTab=yok` | Read/open YÖK announcements | **Announcements** source/filter; capability preserved, bottom tab removed |
| 9 | Agenda | `session`, `activeTab=announcements` | Filter announcements/news/events and open official links | **Announcements tab**: current trusted content retained; Phase 8 targets a unified virtualized feed with scope/source/type filters |
| 10 | Profile | `session`, `activeTab=profile` | Academic identity, notification permission/delivery, logout/deletion | **Profile tab**: grouped identity/settings/integrations/data controls |

## Shell migration mapping

```text
Phase 3: Home | Calendar | Summer School | YÖK | Agenda | Profile
Phase 4: Home | Announcements                    | Calendar | Profile
```

This is information-architecture consolidation, not feature deletion. Summer School and YÖK stay discoverable inside Announcements; Google sync/manual exams remain under Calendar; Profile retains academic and account settings.

## Phase 4 final route map

```text
Root native stack
├─ BootstrapLoading
├─ BootstrapError
├─ AuthFlow
│  ├─ Login
│  ├─ Register
│  ├─ Verification
│  ├─ PasswordRecoveryRequest
│  ├─ PasswordRecoveryCode
│  └─ PasswordRecoveryConfirm
├─ OnboardingFlow
│  └─ AcademicOnboarding
├─ Authenticated: four-tab navigator (`backBehavior="history"`)
│  ├─ HomeTab → Home
│  ├─ AnnouncementsTab
│  │  ├─ Announcements
│  │  ├─ SummerSchool
│  │  ├─ YokAnnouncements
│  │  └─ AnnouncementDetail({ announcementId })
│  ├─ CalendarTab
│  │  ├─ Calendar
│  │  └─ CalendarEventDetail({ eventId })
│  └─ ProfileTab
│     ├─ Profile
│     ├─ AcademicProfileSettings
│     ├─ NotificationSettings
│     ├─ GoogleCalendarSettings
│     └─ AccountDataSettings
└─ UnknownRoute (non-echoing safe fallback)
```

Phase 6 replaces the former identity-only confirmation leaf with `AcademicOnboarding` and splits recovery into three semantic screens. `academic_onboarding` is evaluated before the authenticated tab root, so an owner-safe session may exist while the incomplete profile remains outside tab history. University is the one required product field. Faculty, department, and class level are optional; changing a parent clears all descendants in the draft. Picker taps never mutate `/me/university`; `Kaydet ve devam et` sends one complete-replacement payload after a reviewed selection. A protected notification or deep-link request remains unacknowledged until onboarding completes and the authenticated navigator accepts it.

The email registration path is `Register → Verification → AcademicOnboarding → authenticated destination`. Verification never creates a session. Academic save obtains a session only when needed, activates the owner generation before the authenticated mutation, saves once, bootstraps the first meaningful authenticated state, and only then exposes the tab tree. An incomplete Google or restored session converges on the same onboarding leaf without adding onboarding to authenticated tab history. Recovery is `PasswordRecoveryRequest → PasswordRecoveryCode → PasswordRecoveryConfirm → Login`.

The root stack is auth/session guarded: hydration remains above all requests; protected requests wait until the authenticated tree exists; auth/onboarding never join tab history. Static links use an exact `academicpulse://` allowlist. Unknown or malformed destinations never echo raw input. Notification URLs retain the Phase 3 owner-bound exact-record check; their durable pending record is cleared only after the verified detail request has been accepted by the authenticated navigator. A verified notification wins over the default Home transition after login. General protected static links remain memory-pending until authentication and carry route IDs only—never tokens, secrets, or full records.

Route mechanics live in `src/navigation`; theme/platform hooks and primitives in `src/design-system`; and the first transitional shared screen component in `src/components/Section.tsx`. Existing Phase 1–3 auth, content, notification, Google, session, and dormant native-calendar modules remain the feature/service boundaries around the navigator. `App.tsx` still owns substantial orchestration and legacy screen JSX, so MN-010 is only partially reduced rather than closed.

The pure contracts name normalized roots `Hydration` and `Unknown`; `AppNavigator` adapts those to the concrete `BootstrapLoading`/`BootstrapError` and `UnknownRoute` screens. The legacy six-value `activeTab` remains only as a compatibility bridge for existing feature-loading ownership; it is not the visible four-destination shell. No navigation state is persisted.

Approved static URLs are exactly `academicpulse://tab/home`, `/announcements`, `/calendar`, `/profile`; `academicpulse://announcements/summer-school`, `/yok`; and `academicpulse://settings/academic-profile`, `/notifications`, `/google-calendar`, `/account-data` (with the full scheme/authority shown by the first item in each group). Extra queries, fragments, encoding tricks, detail paths, and non-`academicpulse` origins are rejected rather than normalized broadly.

## Phase 5 final app-shell map and behavior

The authenticated primary navigation is defined once and contains exactly these four destinations, in this order:

| Primary tab route | Product destination | Turkish label | Owned root |
|---|---|---|---|
| `HomeTab` | Home | Ana Sayfa | `Home` |
| `AnnouncementsTab` | Announcements | Duyurular | `Announcements` |
| `CalendarTab` | Calendar | Takvim | `Calendar` |
| `ProfileTab` | Profile | Profil | `Profile` |

`SummerSchool` and the YÖK procedures capability, concretely routed as `YokAnnouncements`, remain nested destinations in the Announcements stack. They retain their existing screens, protected-route ownership, and strict static-link reachability; neither is a fifth primary tab. Phase 5 changes shell presentation and navigation behavior only. It does not redesign the Home, Announcements, Calendar, Profile, Summer School, or YÖK screen bodies.

Every tab retains its own native stack while the tab navigator keeps most-recently-used history. Android Back first pops the active nested stack, then returns through tab history, and is left unhandled at the Home root so normal platform exit behavior remains available. Re-selecting an active tab while it is nested returns that tab to its root without pushing another route. Re-selecting an already-rooted tab scrolls its supported `Screen` scroll container to the top; repeated taps do not add route or tab-history entries. Protected deep-link and verified notification requests continue to enter the owning stack without discarding the other tabs' histories.

The reusable `AdaptiveTopBar` is the shell header contract. It accepts a title, optional subtitle or context, an optional leading action, and optional trailing action descriptors. It owns the top/side safe area in the phone shell and the top of its scene beside the Android large-width rail; routed content and the navigator split the remaining edges. It exposes toolbar/header/button semantics, explicit action labels and disabled state, and 48×48 logical-unit minimum action targets. Below 375 dp it uses compact title typography and moves trailing actions to a wrapping second row; at regular widths title and actions share a wrapping row. Title and context text remain scalable, uncapped, and untruncated.

Navigation and top-bar chrome use `NavigationSurface`: eligible iOS runtimes may select Liquid Glass only when its APIs are available and Reduce Transparency is off; unavailable/reduced-transparency iOS and Android use opaque tonal chrome. Android actions use native ripple; shell actions retain the 48×48 minimum on both platforms. Phone tab labels remain one line at 12 logical units on Android and 11 on iOS. The ordinary visual multiplier cap is 1.35; below 375 logical units, requested larger text uses a 1.20 compact cap, an 80 dp Android content bar plus bottom system inset, and the full Turkish accessible name. Selection also has selected accessibility state plus filled/outline icon differences, and Android adds a fixed tonal indicator, so it does not rely on color alone.

Pure and native-renderer tests cover the exact four-item map, Turkish labels, selected/unselected semantics, 320 dp compact and 200%-font fallback contracts, top-bar wrapping/actions/material selection, nested Back, tab re-selection, root scroll-to-top, repeated-tap deduplication, per-tab stack preservation, nested Summer School/YÖK reachability, and protected destination preservation. The reviewed [Phase 5 native evidence matrix](./evidence/phase-05-native/README.md) adds 13 PNG/UIAutomator XML pairs from the `AcademicPhase1Low` Android 7 / API 24 / x86_64 AVD: all four selected states at 360 dp; 320 dp at font scales 1.0 and 2.0; nested YÖK ordinary Back; selected nested-tab re-selection to root; selected root-tab re-selection from rows 7–10 back to the top; and an explicit development-only dark renderer. The initial font-2 capture exposed a roughly 49 dp bottom bar with `Ana Sayfa` ellipsized and label geometry entering the system-navigation area. The implementation was corrected to reserve 80 dp plus the bottom system inset and to use the 1.20 compact cap, then reloaded through Metro and recaptured; the final font-2 hierarchy contains all four full labels with no ellipsis, wrapping, clipping, or overlap. The filtered runtime log is clean, and font scale, display size/density, ADB reverse, app, Metro, and emulator state were restored and stopped. The API 24 system clock still clips at 200%, so this is bottom-navigation acceptance rather than full-screen large-text acceptance. The dark frame proves the native renderer under the explicit preview override, not OS theme switching.

## Major state inventory

| Area | Loading state | Empty state | Error state | Connected/special state | Current evidence/gap |
|---|---|---|---|---|---|
| App hydration | Dedicated loading root until device ID, refresh, owner storage, and bootstrap settle | N/A | Labelled recoverable hydration boundary | Ready resolves to Login or authenticated shell only after restoration | Phase 1 guard prevents Login/Home flashes and startup manual-exam writes before owner hydration |
| Login/Register | Button-level busy/disabled | Blank form | Controlled global auth errors plus recovery-local feedback | Google configuration notice; reachable forgot-password request/confirm states | Broader inline feedback and form visual redesign remain Phase 6 |
| Verification | Busy/disabled resend and confirmation | Blank code | Controlled invalid/expired/session outcomes | Restorable email/expiry/cooldown without password/code persistence | Resend uses the dedicated endpoint; verification success is separate from later Login |
| Home | Upcoming spinner | Zero/count cards and empty sections | Upcoming inline error; global manual-exam errors | Manual exams merged locally | Page counts can initially show zero; countdown lacks periodic refresh |
| Calendar | Calendar spinner; Google checking/authorizing/syncing progress | No dates / no source-authored transferable records | Calendar inline error; Google expired/error/partial outcomes | Disconnected, checking, connected, expired, syncing, partial, error; verified mapping summary | Live verification, preflight, safe partial deletion, account change, disconnect, remove-managed, and revoke actions now exist; rendered provider-account evidence remains blocked |
| Summer School | Payload spinner | Guidance/no requirements/no announcements/no options | Payload and source-health error/partial/stale states | University/faculty/department-scoped variants | Refresh reloads Summer and visible calendar ownership; URL-less records are non-pressable |
| YÖK | First-entry/manual spinner | No YÖK announcements | Visible load error | External-source handoff | No page-view/open telemetry |
| Agenda | Source spinner | No school or no matching content | Visible source error plus partial/stale retained-data states | Four local filters; grouped trusted scope sections | Source-authored timestamps and URL trust are enforced; whole feed still mounts in `ScrollView` until Phase 8 |
| Profile school picker | University/faculty/department loading | Explicit no-result states | University, faculty, and department errors rendered | Selected/saving/expanded states | Complete replacement contract clears omitted descendants; broader selector visual work remains Phase 10 |
| Notification settings | Permission inspection and device registration have checking/registering states | Preference defaults disabled | Denied, permanently denied, unavailable, token/registration/detach error | Master/mode/category drafts plus explicit delivery-active state and system-settings handoff | OS permission, FCM token rotation, backend registration/detach, and app-resume reconciliation are wired; API 33+/provider visual evidence remains blocked |
| Logout/deletion | Global busy; destructive alerts | N/A | Controlled cleanup card lists only failed targets | Logout retains Google remote events/grant; data-delete keeps account but attempts managed-event removal/revoke; account-delete returns to Login | Session, device registration, pending notification, Google remote/local, and server cleanup are observable and retryable; recent-auth backend gap remains |

## Phase 3 integration state additions

- A notification tap or strict `academicpulse://notification` URL carries only schema version, destination type, exact ID, and recipient owner. Signed-out receipt stores a non-secret pending target. Post-login resolution calls the corresponding exact trusted-record endpoint for that ID; it never searches a capped collection or falls back to another item. Wrong/stale owners are ignored and missing content produces an unavailable notice.
- Notification delivery is never inferred from the preference switch alone. The Profile surface separately exposes preference, permission, installation-registration, and effective-delivery state. Permission is prompted only from the explicit save/enable action.
- Google connection metadata is owner-scoped v3 data. Hydration shows `checking` until the current SDK account/token and Calendar API are verified. Stored metadata alone cannot render `connected`.
- Google sync performs profile/network/content preflight before provider UI. It displays partial source warnings, retains verified mappings, and refuses deletion for incomplete source families. Ordinary disconnect/revoke retains a disconnected ledger for later same-account deletion cleanup. The account-switch keep choice warns that its old-account ledger will be abandoned and those residual records require reconnecting that account. At the Phase 3 snapshot these controls did not change the six-tab shell; Phase 4 now routes them without changing their business behavior.
- The dormant `src/native-calendar` subsystem adds no screen or state. It remains unwired reference code with no platform dependency or permission request.

## Pre-Phase-4 user-flow outline (historical)

```text
Cold launch
├─ signed out → Login ↔ Registration → Verification → Profile confirmation → Home
├─ Google login → Home
└─ stored session → progressive profile/preferences/calendar/announcement bootstrap → Home

Home
├─ six bottom destinations
├─ four shortcuts
├─ upcoming refresh
└─ local manual-exam creation

Profile
├─ university → faculty → department immediate mutations
├─ notification preference draft/save
├─ logout
├─ delete app data
└─ delete account

Calendar
└─ Google account → Calendar scope → direct create/update/delete/verify → local summary

Agenda / YÖK / Summer
└─ external official-source handoff
```

For exhaustive tap/API/storage effects, use [the in-app activity report](../20-mobile-native-in-app-user-activity-report.md).

## Target navigation rules

- Each logical screen gets a stable route/screen identifier rather than relying solely on component state.
- Phone bottom navigation contains exactly four destinations and uses readable labels.
- Re-select behavior is deliberate: scroll to top or refresh only if specified and accessible.
- Android system back and predictive-back behavior are designed before enabling predictive back.
- Auth restoration has an explicit hydration boundary; protected content does not flash with another user's state.
- The strict notification destination handoff uses the declared `academicpulse` scheme with version, owner, exact-ID, and trusted-content revalidation. Phase 4 also implements an exact static tab/announcement/settings allowlist and safe unknown fallback; arbitrary path/query routing remains rejected.
- Tablet layouts preserve destination ownership even when navigation adapts to rail/sidebar.

## Required visual-state capture set for later phases

At minimum, capture on a real native renderer:

- Login default, keyboard visible, validation error, loading.
- Registration at 320 dp and large font scale.
- Verification default/error/resend/loading.
- Home loading/populated/empty/error.
- Announcements loading/populated/filtered/empty/error/long title.
- Calendar disconnected/authorizing/syncing/partial/success/error.
- Profile school selector loading/no-results/error/selected.
- Notification permission/default/denied states after they exist.
- Logout/data-delete/account-delete confirmations.
- Light/dark, Reduce Motion/Transparency where applicable, phone/tablet, iOS/Android.

Phase 0 did not capture these: `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED` because no Android device was attached, no Android emulator binary/AVD was available, and iOS simulation is unavailable on Windows.

Phase 3 native launch and strict signed-out notification-URL handoff passed on `AcademicPhase1Low`; the captured Login/Register surface and exact boundary are indexed in [`evidence/phase-03-native`](./evidence/phase-03-native/README.md). The sole authorized AVD is API 24, so it cannot demonstrate API 26+ notification channels or the API 33+ runtime permission prompt. iOS remains unavailable on Windows/Xcode and lacks an authorized `GoogleService-Info.plist`. No authorized non-production Firebase/APNs delivery credentials or Google account/calendar fixture were supplied, so real token delivery and provider chooser/mutation/revoke visuals are not claimed.

Phase 5 native shell acceptance and its exact commands, hashes, semantic assertions, clean-log scan, restoration proof, and unavailable-evidence boundaries are indexed in the [Phase 5 native evidence README](./evidence/phase-05-native/README.md). Windows/iOS runtime, predictive Back, API 33 notification permission, provider integrations, TalkBack, tablet/rail, and full-screen large-text acceptance remain unclaimed.

## Phase 7 Home inventory

| Surface | Final hierarchy | Primary states | Destinations |
|---|---|---|---|
| Home | Greeting + academic context → Today → next important item → important trusted announcement → up to 3 recent trusted announcements → optional actionable integration | Incomplete profile; initial loading; populated; genuine empty; recoverable error; retained refreshing/stale/partial/offline status | Academic Profile settings; trusted Announcement detail; Announcements tab; Calendar; notification/Google Calendar settings |

Removed from the reachable Home surface: untimed `Bugün / Sınav / Duyuru` counts, four duplicate destination shortcut cards, nested exam/event dashboard cards, large hero treatment, and the inline manual-exam form. The manual-exam form remains reachable on Calendar without changing its storage or API contract.
