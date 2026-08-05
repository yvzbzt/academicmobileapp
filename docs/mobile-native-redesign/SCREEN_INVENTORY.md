# Native Screen and State Inventory

Current reconciliation: 4 August 2026. The accepted Phase 8 baseline is
`7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9`; remediation Packages 1-3 are
`641d7bee8a1cd539179769069a22b5c3220e8a6d`,
`5a6ac1a48101569b4a9061f995b0bdd4ba77dd25`, and
`2e3664546f628a19c6fa929b9ee9469e5322f9a8`. The baseline and Phase 3 sections
below are retained as explicitly historical inventory; Phases 4-8 and this
reconciliation describe the current reachable product.

Baseline: 29 July 2026, `apps/mobile-native/App.tsx` at HEAD `cbd0067b03c3cf7286270df25164a556c55b55b9`.

Phase 3 reconciliation: 31 July 2026 validated implementation based on `d722f9092c1d500e0145214b2b57a08d1a8191d9`. Final command and native evidence is recorded in `TEST_MATRIX.md`, the Phase 3 report, and [`evidence/phase-03-native`](./evidence/phase-03-native/README.md).

## Pre-Phase-4 rendering model (historical)

At the Phase 3 snapshot there was no navigation library or route tree. One mounted `App` component rendered logical views through `session`, `authMode`, `authStage`, and `activeTab`; six bottom-tab buttons directly set `activeTab`. Phase 4 supersedes that shell as recorded below while retaining these feature-state owners during migration.

## Ten Phase 3 logical views and Phase 4 ownership

| # | Phase 3 snapshot view | Historical entry/state | Historical primary task | Current replacement/owner |
|---:|---|---|---|---|
| 1 | Login | `!session`, `authStage=auth`, `authMode=login` | Email/password or Google sign-in; enter password recovery | Auth stack: focused Login with the implemented request/confirm recovery path |
| 2 | Registration | `!session`, `authStage=auth`, `authMode=register` | Create account identity | Auth stack: Registration with API-aligned validation |
| 3 | Verification | `!session`, `authStage=verify` | Enter code, resend, edit details | Auth stack: Verification and explicit recovery/resend states |
| 4 | Academic onboarding | `authStage=academic_onboarding` before or after safe session activation | Select and review university plus optional descendants, then save once | Onboarding stack: mandatory university, optional faculty/department/class, owner-safe final save |
| 5 | Home | `session`, `activeTab=home` | Read next academic items, shortcuts, add manual exam | **Home tab**: personalized next actions and compact trusted-content modules |
| 6 | Calendar | `session`, `activeTab=calendar` | Read dates and run Google sync | **Calendar tab**: timeline/planning, manual exams, event detail, integrations |
| 7 | Summer School | `session`, `activeTab=summer` | Read summer dates/requirements/options | **Announcements** source/filter and scoped detail; calendar dates also appear in Calendar |
| 8 | YÖK | `session`, `activeTab=yok` | Read/open YÖK announcements | **Announcements** source/filter; capability preserved, bottom tab removed |
| 9 | Agenda | `session`, `activeTab=announcements` | Filter announcements/news/events and open official links | **Announcements tab**: Phase 8 now supplies the unified virtualized feed with search plus scope/source/type filters |
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
| Login/Register | Button-level busy/disabled | Blank form | Controlled global auth errors plus recovery-local feedback | Google configuration notice; reachable forgot-password request/confirm states | Phase 6 presentation is implemented; Package 3 verifies visible onboarding progress and actual first-invalid Login input focus |
| Verification | Busy/disabled resend and confirmation | Blank code | Controlled invalid/expired/session outcomes | Restorable email/expiry/cooldown without password/code persistence | Resend uses the dedicated endpoint; verification success is separate from later Login |
| Home | One labelled initial loading state | Genuine empty, offline-no-data, and partial-source-no-data are distinct | Recoverable error; retained stale/partial/offline status when data exists | Explicitly qualifying important item, independent recents, next date, and integration-only action | Phase 7 `FlatList` is current; countdown refreshes while mounted and manual-exam creation remains on Calendar |
| Calendar | Calendar spinner; Google checking/authorizing/syncing progress | No dates / no source-authored transferable records | Calendar inline error; Google expired/error/partial outcomes | Disconnected, checking, connected, expired, syncing, partial, error; verified mapping summary | Live verification, preflight, safe partial deletion, account change, disconnect, remove-managed, and revoke actions now exist; rendered provider-account evidence remains blocked |
| Summer School | Payload spinner | Guidance/no requirements/no announcements/no options | Payload and source-health error/partial/stale states | University/faculty/department-scoped variants | Refresh reloads Summer and visible calendar ownership; URL-less records are non-pressable |
| YÖK | First-entry/manual spinner | No YÖK announcements | Visible load error | External-source handoff | No page-view/open telemetry |
| Announcements | One labelled initial busy surface; retained background refresh; pagination progress footer | Genuine empty after all sources attempt; distinct filtered no-results state | Recoverable first-load error; retained stale/partial/offline/pagination-failure feedback with retry | Debounced search; content-type and academic-source groups; YÖK/Yaz Okulu destinations; full-row in-app detail | One full-bleed `FlatList`, canonical stable keys, source-authored ordering, 20→100 controlled loading, and fail-closed Phase 2 presentation gate |
| Profile school picker | University/faculty/department loading | Explicit no-result states | University, faculty, and department errors rendered | Selected/saving/expanded states | Complete replacement contract clears omitted descendants; broader selector visual work remains Phase 10 |
| Notification settings | Permission inspection and device registration have checking/registering states | Preference defaults disabled | Denied, permanently denied, unavailable, token/registration/detach error | Master/mode/category drafts plus explicit delivery-active state and system-settings handoff | OS permission, FCM token rotation, backend registration/detach, and app-resume reconciliation are wired; API 33+/provider visual evidence remains blocked |
| Logout/deletion | Global busy; destructive alerts | N/A | Controlled cleanup card lists only failed targets | Logout retains Google remote events/grant; data-delete keeps account but attempts managed-event removal/revoke; account-delete returns to Login | Session, device registration, pending notification, Google remote/local, and server cleanup are observable and retryable; each destructive submission obtains a fresh owner/generation/purpose-bound proof whose random identifier digest is atomically consumed once before the controller action, and a failed action requires fresh reauthentication |

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

## Remaining visual-state capture set

The committed component and Android evidence covers bounded Phase 4-8 states.
The following broader cross-platform capture remains where an environment and
phase authorize it:

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
| Home | Greeting + academic context → Today → next important item → explicitly qualifying important trusted announcement → up to 3 independently selected recent trusted announcements → optional actionable integration | Incomplete profile; initial loading; populated; integration-only; genuine empty; offline-no-data; partial-source-no-data; recoverable error; retained refreshing/stale/partial/offline status | Academic Profile settings; trusted Announcement detail; Announcements tab; Calendar; notification/Google Calendar settings |

Removed from the reachable Home surface: untimed `Bugün / Sınav / Duyuru` counts, four duplicate destination shortcut cards, nested exam/event dashboard cards, large hero treatment, and the inline manual-exam form. The manual-exam form remains reachable on Calendar without changing its storage or API contract.

## Phase 8 Announcements inventory

The Phase 4/5 route ownership is retained; Phase 8 replaces the Announcements screen body and completes its existing detail route without adding a primary destination:

```text
AnnouncementsTab
├─ Announcements
│  ├─ Search: title, safe summary, official source name
│  ├─ Content type: Tümü | Duyurular | Haberler | Etkinlikler
│  ├─ Scope/source: Tüm kaynaklar | Üniversitem | Fakültem | Bölümüm | YÖK | Yaz Okulu
│  ├─ One chronological trusted FlatList
│  ├─ YÖK sayfasını aç → YokAnnouncements
│  └─ Yaz Okulu sayfasını aç → SummerSchool
├─ AnnouncementDetail({ announcementId })
├─ YokAnnouncements
└─ SummerSchool
```

| Surface | Final information hierarchy | Primary states/actions | Data and route boundary |
|---|---|---|---|
| Announcements | Title + available university/faculty/department context → labelled search → two wrapped filter groups → selected-filter/result summary → YÖK/Yaz Okulu nested destinations → availability → source-first rows → pagination footer | Initial loading; background refresh; populated; genuine empty; no-results; stale; partial; offline; recoverable error; pagination loading/failure; pull-to-refresh; retry; full-row detail | Phase 2 trusted academic and YÖK collection envelopes plus compatible trusted Summer School announcement arrays; canonical URL stable identity; no crawl/fetch ordering; 20/40/60/80/100 server limits for academic/YÖK collections |
| Announcement detail | Trusted type/scope → wrapping title → official source/domain → publication and update labels → safe summary → controlled result banner → Share / Open Official Source | Loading; invalid/unavailable trusted record; native share busy/failure; official-handoff busy/unsupported/failure; ordinary stack Back | Carries the already normalized `ContentFeedItem` in current application memory after an allowlisted route ID is requested; revalidates trusted identity and official authority; opens the specific canonical item URL, not an arbitrary or generic source URL |
| YÖK nested screen | Existing YÖK trusted collection and health presentation | Existing loading/empty/partial/stale/error and in-app detail entry | Remains `YokAnnouncements` inside Announcements and retains its exact protected deep link; it is also a feed source/filter, never a primary tab |
| Summer School nested screen | Existing profile, requirement, date, announcement, and option presentation | Existing Summer School refresh and source-health states; compatible announcement rows enter detail | Remains `SummerSchool` inside Announcements and retains its exact protected deep link. Only trusted announcement DTOs join the unified feed; requirement/option/calendar payloads remain on this nested screen |

Search is debounced by 300 ms and is held only in component memory. It is not logged, persisted, put in navigation params, or transmitted by the feed. Selecting a row pushes the in-app detail route; ordinary Android Back and iOS stack navigation return to the still-mounted feed, preserving its search/filter state. Selecting the dedicated YÖK or Yaz Okulu action enters the existing nested screen rather than reintroducing a bottom tab.

The Phase 2 DTO currently supplies identity, source/scope/type, normalized
title, optional safe summary, canonical and official URLs, source
publication/update times, freshness, and the date-only/inclusive-range contract
where academic dates apply. It does not supply a complete body, attachments,
durable Save/read state, or a feed-owned calendar mutation. Phase 8 therefore
renders no invented sections or disabled actions for those capabilities. Home,
Calendar, Profile, auth, onboarding, provider, and persistence ownership are
unchanged; Phase 9 is not started.

The development-only `ContentFeedPreview` scenarios are `populated`,
`search-results`, `no-results`, `active-filters`, `partial`, `stale`, `offline`,
`error`, `pagination-error`, `detail`, `yok`, `summer-school`,
`official-source-handoff`, `long-title`, and `long-feed`. They use synthetic
trusted records only. Native Android debug review is indexed separately in
[`evidence/phase-08-native`](./evidence/phase-08-native/README.md). Package 3
adds independent release evidence for the 100-record fixture: a fresh
`NODE_ENV=production`, x86_64, nondebuggable APK produced 600 valid frames on
the API 24 host-rendered AVD with aggregate p90 24.928167 ms, p95 35.777763 ms,
and zero frozen frames. Its unsuccessful SwiftShader tuning experiment was
fully reverted. iOS runtime, VoiceOver, TalkBack, modern Android, provider,
installed E2E, native tablet/rail, and mobile-native lint evidence remain
unavailable. Phase 9 was not started.

## Phase 9 Calendar inventory

The authenticated four-tab route map is unchanged; Phase 9 completes the existing Calendar stack:

```text
CalendarTab
├─ Calendar
│  ├─ Ajanda (default)
│  ├─ Hafta
│  ├─ Ay
│  ├─ Kişisel sınav ekle → native date/time picker sheet
│  └─ compact Google Calendar status → sync/manage lifecycle
└─ CalendarEventDetail({ calendarEventId })
   ├─ trusted academic source/date semantics
   └─ owner-matching personal exam → edit/delete
```

| Surface | Final hierarchy | States and actions | Boundary |
|---|---|---|---|
| Calendar / Agenda | Title/context → view radio group → add exam → availability → compact Google status → day headings and event rows | Loading, populated, empty, refreshing, stale, partial, offline, recoverable error; refresh; row detail | Current/future academic and owner-scoped personal records; Europe/Istanbul grouping; date-only/ranges remain untimed |
| Calendar / Week | Seven-day period label → day summaries → accessible event list | Previous/next week; selected view; empty period; detail | Same item identity and semantics as Agenda |
| Calendar / Month | Month label → 42 informational cells → accessible event list | Previous/next month; selected view; empty period; detail | Cells summarize type/icon/text without hiding actions inside a dense grid |
| Academic event detail | Classification/source → wrapping title → date meaning → description when supplied | Ordinary stack Back | Read-only trusted record; no edit/delete and no invented time |
| Personal exam detail/editor | Personal classification → title/date/time → edit/delete; sheet title input → native date → native time → cancel/save | Create, edit, delete confirmation; expanded, invalid, busy, error | Only active owner; existing SecureStore owner/generation persistence; stale operations rejected |
| Google status | Compact connection/sync/partial status → sync/manage | Existing connect, sync, switch, disconnect-retain, managed removal, revoke and partial outcomes | Phase 3 lifecycle; app-managed marker plus owner required; personal Google events untouched |

The synthetic preview scenarios are `populated`, `week`, `month`, `loading`, `refreshing`, `empty`, `stale`, `partial`, `offline`, `error`, `google-partial`, `detail-academic`, `detail-personal`, and `long-title`. They are development-only local fixtures and do not prove authentication, SecureStore, API, or provider behavior. Android evidence is indexed in [`evidence/phase-09-native`](./evidence/phase-09-native/README.md). Phase 10 was not started.

## Phase 10 Profile and settings inventory

This section supersedes only the earlier statements that Profile presentation and the final academic selector treatment remained later-phase work. The four-tab map and nested settings routes remain unchanged:

```text
ProfileTab
├─ Profile
│  ├─ real identity summary
│  ├─ personal information (read-only name and secondary email)
│  ├─ academic profile → AcademicProfileSettings
│  ├─ notifications → NotificationSettings
│  ├─ calendar connections → GoogleCalendarSettings
│  ├─ truthful app information (version/build)
│  └─ account management → AccountDataSettings
├─ AcademicProfileSettings
├─ NotificationSettings
├─ GoogleCalendarSettings
└─ AccountDataSettings
   └─ collapsed danger area
      ├─ delete app data
      └─ delete account
```

| Surface | Final hierarchy | States and actions | Boundary |
|---|---|---|---|
| Profile | Summary → personal information → academic row → notification row → calendar row → app information → account row | Complete/incomplete academic identity; route rows expose current text status | Current `/me` name/institution/email on Profile and the same authoritative email on Account; no invented Account name, image, student ID, social statistics, appearance row, or dead help/legal/support link |
| Academic profile | Current context → required university → optional faculty → optional department → optional class → one Save/Cancel action area | Search, virtualized results, loading, no results, error/retry, selected, expanded, invalid, dirty, saving, saved, save error, discard confirmation | Parent changes clear descendants in draft; no picker mutation; complete replacement saved once; returned server profile is authoritative; failure stays dirty/retryable; explicit Cancel uses the same leave guard; keyboard-safe route |
| Notifications | Effective delivery summary → OS permission → installation registration → stored preference → supported mode/categories → Save | Checking, not requested, granted, denied, permanently denied/settings-required, unavailable, registration transitions/errors, clean/dirty/saving/saved/error; duplicate-safe Open Settings busy/rejection | Active only when preference + permission + registration gates pass; stored preference remains explicitly Açık/Kapalı independent of save state; tokens and unsupported reminder/quiet-hours controls absent |
| Google Calendar | Compact lifecycle summary → connected account/last sync/current mapping count → partial or mapping warning → valid state actions | Disconnected, checking, connected, expired, syncing, partial, error; connect, sync, switch, disconnect-retain, managed removal, revoke; external busy | Existing Phase 3 owner/mapping/late-operation contract; a disconnected retained ledger keeps applicable actions; removal returns focus to a surviving heading when its launcher disappears; personal Google events are never changed |
| Account management | Authoritative `/me` identity → logout → danger disclosure → expanded consequences/actions → confirmation → recent-authentication proof → operation result | Collapsed/expanded, cancel, purpose-specific reauth, busy, retryable error, success/session transition; keyboard-safe route; one semantic route feedback surface | Logout, local/app-data deletion, and account deletion are distinct; no duplicate request, duplicate banner, or raw backend/provider error |

The Profile route does not duplicate controls owned by its nested routes. Appearance is omitted because system appearance is automatic and no persisted user choice exists. Help, privacy, terms, and support rows are omitted because the application has no real destinations. The only app metadata displayed is truthful configuration-backed version/build information.

The synthetic Phase 10 preview is development-only, dual-gated, and backed by reserved local fixtures. Its allowlisted scenarios are `profile-summary`, `profile-incomplete`, `academic-editor`, `notifications-active`, `notifications-denied`, `notifications-settings-required`, `notifications-registering`, `notifications-error`, `google-disconnected`, `google-connected`, `google-partial`, `google-expired`, `account-management`, `danger-expanded`, `data-confirm`, `data-error`, `account-confirm`, and `account-error`. Focused Phase 10 renderer/navigation/selector/auth validation passes 5 suites / 71 tests / 0 snapshots, including preview gate/URL/synthetic-boundary checks. The reviewed Android inventory in [`evidence/phase-10-native`](./evidence/phase-10-native/README.md) contains 44 original-resolution screenshots and 44 basename-matched hierarchies with 88 integrity-index rows. It covers phone light/dark, exact 320 dp at 200% text, simulated tablet width, reachable actions and 48 dp targets, and ordinary Back from Notifications to Profile in the same process. The dirty academic leave guard is covered by automated production-route tests, not claimed as a native dirty-Back smoke. TalkBack, iOS/VoiceOver/Liquid Glass, live providers, authenticated relaunch/account switching, and SecureStore remain outside this synthetic evidence. Phase 11 was not started.
