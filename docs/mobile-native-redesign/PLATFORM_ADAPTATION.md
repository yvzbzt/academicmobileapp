# Platform Adaptation Contract

Last updated: 6 August 2026

Current provenance: Phase 12 preserves the accepted Phase 1-11 platform
contracts, exactly four authenticated primary tabs, and every existing route.
It adds or redesigns no production screen. Earlier phase sections remain
historical checkpoint records where their wording is explicitly time-bound;
the Phase 11 contract plus the Phase 12 reconciliation at the end describe the
current cross-platform boundary.

## Shared product semantics

iOS and Android share:

- the four-destination information architecture,
- screen/content models and backend contracts,
- semantic color/type/spacing tokens,
- accessible names, roles, values, and validation meaning,
- loading/empty/error/success definitions,
- content trust rules,
- analytics event meaning if instrumentation is separately approved.

They do not need pixel-identical navigation bars, sheets, switches, press feedback, spacing adjustments, or motion.

## iOS expression

- Use native navigation and tab conventions with safe-area-aware chrome.
- On supported systems, navigation/control chrome may use a Liquid Glass-inspired system material. Do not imitate glass with heavy gradients or translucent content cards.
- Main feed, forms, alerts, calendars, and destructive areas remain opaque and readable.
- When Reduce Transparency is enabled—or native material is unavailable—replace translucent chrome with an opaque tonal surface and clear divider; retain hierarchy and contrast.
- Respect Reduce Motion and Prefer Cross-Fade Transitions where exposed by the platform.
- Minimum target is 44×44 pt.
- Prefer native sheets, menus, date interaction, share sheet, and confirmation patterns when behavior fits.
- Dynamic Type must preserve task order and allow wrapping; do not cap text solely to protect a screenshot.
- iPad layouts use readable-width content and may adapt four destinations to a sidebar only after native validation.

## Android expression

- Follow Material 3 Expressive principles without turning every surface into a bright container.
- Keep edge-to-edge layout; apply status/navigation bar insets intentionally.
- Use tonal surfaces and roles derived from shared semantic tokens.
- Minimum target is 48×48 dp with ripple/pressed feedback.
- Use platform-appropriate modal/full-screen bottom sheets for selectors and focused tasks.
- Navigation and overlays must be compatible with Android back behavior. Predictive back is currently disabled in `app.json`; enable it only after the new navigation stack is tested end to end.
- Use restrained shared-axis/container transitions where they explain hierarchy, with reduced-motion fallback.
- Android tablets/foldables may use a navigation rail while preserving the same four destinations and content ownership.

## Adaptation matrix

| Concern | Shared contract | iOS | Android |
|---|---|---|---|
| Primary navigation | Four destinations | Native tab/navigation chrome; optional supported material | Material bottom navigation; rail on justified large layouts |
| Press feedback | Immediate and perceivable | Highlight/scale only if native and restrained | Ripple/tonal pressed state |
| Selectors | Search, loading, empty, retry, selected states | Sheet or pushed picker | Modal/full-screen bottom sheet |
| Destructive confirmation | Explicit action/consequence | Native alert or sheet per HIG | Material alert/dialog |
| Transient result | Accessible and recoverable | Banner/toast pattern that remains readable | Snackbar with appropriate action/duration |
| Calendar handoff | Explicit destination and result | Native share/calendar affordance where supported | Intent/sheet integration where supported |
| Content surface | Opaque, readable, semantic | Minimal shadow/divider | Tonal elevation/divider |
| Motion | Purposeful; reduced-motion fallback | System transition/material response | Reduced-motion-aware transitions; ordinary stack/tab Back now, predictive animation disabled pending supported navigator/API 33+ validation |

## File-architecture rule

Start shared. Introduce platform files only where behavior or chrome genuinely differs:

```text
Component.tsx
Component.ios.tsx
Component.android.tsx
```

Do not duplicate business/data logic in platform files. Platform wrappers receive semantic props and expose the same accessibility contract.

## Phase 4 implemented adaptation

- `userInterfaceStyle` is `automatic`; `expo-system-ui` and the semantic `ThemeProvider` resolve light/dark system appearance.
- React Navigation 7 native stacks own auth, onboarding, announcement detail, calendar detail, and settings history. Bottom tabs own exactly Home, Announcements, Calendar, and Profile with `backBehavior="history"`.
- Native-stack gestures remain enabled on ordinary child routes and are disabled while an owning operation is locked, preserving iOS swipe-back without allowing an in-flight form/integration action to be abandoned silently.
- Android receives 48 dp minimum targets, native ripple feedback, edge-to-edge insets, tonal opaque fallback surfaces, ordinary system-back handling, four phone destinations, and a Material navigation rail at the documented large-width threshold.
- iOS receives 44 pt targets, highlight feedback, safe-area/readable-width layout, and Liquid Glass only through `NavigationSurface` for eligible navigation/control chrome. Runtime component/API availability and Reduce Transparency must all allow it; otherwise the same semantic surface is opaque.
- `BottomSheet` owns modal semantics, safe-area placement, dismiss/Back locking, reduced-motion animation, and iOS/Android shape/elevation treatment. `SelectField` presents accessible radio options through that boundary and virtualizes long option sets with `FlatList`.
- `DesignSystemPreview` supplies a deterministic primitive matrix behind the dual `__DEV__` plus `EXPO_PUBLIC_PHASE4_DESIGN_PREVIEW=1` gate; it is evidence tooling, not a product route or Phase 5 screen.
- Reduce Motion, Reduce Transparency, system appearance, 320 dp gutters, tablet width, and material selection have deterministic tests. Native renderer tests cover route/back/tab behavior and primitive semantics.

## Phase 5 implemented app-shell adaptation

Phase 5 presents the existing route mechanics through one centralized four-destination shell. `src/navigation/app-shell.ts` owns the exact order, Turkish visible/accessibility labels, root-route mapping, and selected/unselected icons for `Ana Sayfa`, `Duyurular`, `Takvim`, and `Profil`. Summer School and YÖK remain nested under Announcements rather than becoming extra tabs.

### Shared layout and accessibility

- `AdaptiveTopBar` is the reusable native-stack header. Titles and optional supporting text scale and wrap; leading/trailing actions expose full accessible names and minimum 48×48 logical-unit targets.
- Below 375 logical units the header uses compact density, the compact title role, a 16-unit gutter, and a wrapping action layout. At 375 and above it uses the regular contract.
- Tab items are at least 48 logical units high. Visible navigation labels remain one line at 11 pt on iOS or 12 sp on Android. Their ordinary multiplier cap is 1.35; below 375 logical units, a requested scale above 1.35 selects a 1.20 compact cap while the tab control continues to expose the exact full accessible name and selected state.
- Each tab owns an independent nested history. A selected nested-tab reselect
  pops to its root; a selected root reselect scrolls its registered root owner
  (`ScrollView` or production `FlatList`) to the top and does not create Back
  history. Package 3 mounts the real Home `FlatList` to verify that offset 276
  survives a switch away/back and that only root reselect scrolls to offset 0.

### Safe-area and navigation ownership

- In the phone layout the top bar owns top/left/right safe-area insets, authenticated routed content owns left/right, and the bottom tab bar owns bottom. In the Android large-width layout the rail owns the left navigation edge, routed content owns right/bottom, and the header owns the top of its scene. This conditional split prevents duplicated or missing navigation-edge padding.
- Android edge-to-edge remains enabled. Status/navigation-bar, gesture, keyboard, and content insets stay deliberate shell/navigator responsibilities; edge-to-edge is not permission for arbitrary content to render under system controls.
- Ordinary Android system Back follows the current nested stack and then tab history. Navigation locks disable the custom top-bar Back action and continue to prevent gesture/hardware abandonment of an owning operation. Predictive Back remains disabled and is not claimed as API 33+ evidence.

### iOS presentation

- Liquid Glass is restricted to eligible `NavigationSurface` navigation/control chrome. It is selected only when the component and runtime API are available and Reduce Transparency is off.
- Missing eligibility or enabled Reduce Transparency produces the same hierarchy with an opaque tonal semantic surface and divider/elevation treatment. Feed, form, calendar, alert, and destructive content remains opaque.
- The shell uses native tab/stack conventions and platform icons/feedback while retaining the shared routes, semantic tokens, accessibility names, and behavior. Deterministic renderer tests on Windows validate selection and fallback logic only; no native iOS runtime or screenshot acceptance is claimed.

### Android presentation

- The phone shell uses Material 3 tonal navigation chrome, native ripple feedback, and a fixed 64×30 selected-icon pill colored from the semantic selected-state role. It reserves 80 dp for navigation content plus the bottom system inset so icon and bounded large-text label geometry cannot enter system navigation; Package 3 verifies a 34 dp inset produces a 114 dp bar. The tab bar becomes non-interactive while the keyboard is shown and returns when it hides. Unselected icons use their outline variants; selected icons use their filled variants. Android top-bar actions and navigation items retain the 48 dp minimum target.
- The same four destinations move to the existing Material navigation rail policy at the documented large-width breakpoint without changing route ownership or accessibility names.
- Phase 5 renderer and pure-contract tests cover exact tabs and selected states, independent nested histories, tab reselect behavior, internal destinations, simulated ordinary hardware Back dispatch, and protected-request gating. They do not demonstrate predictive Back or API 33 behavior.

## Predictive-back compatibility boundary

React Native 0.81 exposes Android predictive-back plumbing, but the selected React Navigation 7 integration still documents predictive back as unsupported and requires `android:enableOnBackInvokedCallback="false"`. Phase 4 therefore deliberately retains `android.predictiveBackGestureEnabled: false`; the generated manifest has `android:enableOnBackInvokedCallback="false"`. This is the supported compatibility path, not a claim that a predictive animation ran. A pure immutable back-policy preview is tested so later enablement has one decision contract, while actual Android system-back and tab/stack history are tested independently. Phase 11 does not override that compatibility requirement: enabling the OS predictive callback remains gated on upstream navigator support plus API 33+ device validation.

## Phase 6 authentication and onboarding adaptation

Authentication and onboarding share routes, validation, hierarchy, and accessibility semantics while allowing platform-native expression:

- On both platforms, routed auth content uses an opaque form-width surface, a 48×48 logical-unit interactive-target floor, system text scaling, persistent labels, scroll reachability, automatic keyboard insets, and explicit busy/disabled/error semantics. The presentation has no horizontally scrolling form row and does not truncate Turkish action labels to force visual parity.
- iOS uses `KeyboardAvoidingView` padding behavior, native one-time-code metadata, native-stack transitions, and ordinary swipe-back on eligible auth children. Form cards remain opaque. Liquid Glass remains restricted to eligible navigation/control chrome; it is not applied to text fields, validation banners, academic review, or selector reading content. Windows component tests cover this selection contract only; no iOS build, keyboard, Dynamic Type, Liquid Glass runtime, or VoiceOver acceptance is claimed.
- Android relies on the existing edge-to-edge `adjustResize` boundary plus vertically scrollable form content; the shared keyboard wrapper does not add an iOS-style padding behavior. It uses 48 dp controls, native ripple feedback, tonal opaque cards, Material-compatible progress/busy indicators, modal selector sheets, ordinary hardware Back, and an alert before discarding a dirty onboarding draft. The retained API 24 AVD cannot validate predictive Back or API 33 animation behavior.
- Email IME Next moves to Password; registration progresses through name, email, password, and confirmation; Done invokes only a validation-gated action. Verification and recovery code screens request numeric keyboards and one-time-code metadata. A visible soft keyboard must not make the primary action unreachable because the form remains vertically scrollable.
- A width below 375 logical units selects compact gaps while retaining the same information order. At 200% font scale, fields, banners, review rows, and action groups grow or wrap; primary actions remain reachable by vertical scrolling. Navigation label caps from Phase 5 do not cap form or error text.
- Selector search and option virtualization are shared. iOS may present the shared sheet with eligible control material; Android uses the opaque tonal Material fallback and Back dismissal. Loading, no-result, error/retry, selected, expanded, and explicit clear semantics are identical.

## Phase 6 checkpoint evidence and later-phase work (historical)

- iOS build/runtime and Liquid Glass screenshots remain unavailable on this Windows host; deterministic fallback selection is not native iOS visual acceptance.
- The authorized Android AVD is API 24, so it can verify ordinary system Back but not predictive-back callbacks/animations.
- Phase 4 supplies consistent pressed/ripple/focus behavior for shared
  primitives. Phases 6-8 migrated auth/onboarding, Home, and Announcements;
  remaining legacy Calendar/Profile presentation stays later-phase work.
- The Phase 4 Android primitive matrix covers the development-only preview at a temporary 320 dp viewport; authenticated screens, tablet/rail, screen reader, full dark-theme screens, and iOS/Dynamic Type acceptance remain later gates.
- Phase 0's missing-native-environment statement is historical; `AcademicPhase1Low` now supplies the bounded Android launch target.

Each visual phase must capture equivalent iOS and Android states where the environment permits and record intentional differences rather than treating them as drift.

## Phase 7 Home adaptation

- Home is one `FlatList` with shell-owned insets and a 720 logical-unit readable maximum. At widths below 375 it uses a 16-unit gutter; content remains one column at 320 dp and 200% text scale.
- iOS Home content is always opaque. Liquid Glass eligibility remains confined to the Phase 5 top/bottom navigation chrome, with Reduce Transparency selecting the existing opaque fallback.
- Android uses the shared Material-compatible tonal hierarchy, native ripple on actionable cards/buttons, 48 dp targets, and deliberate edge-to-edge safe-area ownership. It does not imitate iOS glass.
- Tab re-selection continues to use React Navigation's root scroll-to-top registration on the Home virtualized list. Ordinary Android Back and independent tab stacks are unchanged.
- Package 3 integration coverage uses that real list rather than a synthetic
  scroll stand-in and proves tab-retained offset plus root reselect behavior.
- Windows renderer tests prove adaptation selection and semantics, not iOS runtime, Dynamic Type, VoiceOver, or Liquid Glass visual acceptance.

## Phase 8 Announcements and detail adaptation

- Announcements owns one full-bleed `FlatList` under the existing Announcements stack. The shell continues to own navigation insets and root re-selection; the list owns its vertical content, pull-to-refresh, incremental loading, and scroll-to-top registration. Announcement detail owns one bounded opaque `ScrollView`. Neither surface is nested in the transitional routed `ScrollView`.
- Shared semantics are source-first rows, truthful source timestamps, wrapping title/summary, two labelled filter groups, selected-filter state, full-row detail navigation, native Share, and safe official-source handoff. Search/filter/state policy remains shared rather than being duplicated in platform files.
- On iOS, feed rows, detail metadata, summary, banners, errors, and reading surfaces stay opaque. Liquid Glass remains eligible only for supported Phase 5 navigation/control chrome when runtime APIs allow it and Reduce Transparency is off. Windows renderer selection cannot establish iOS runtime, Dynamic Type, VoiceOver, share-sheet, external-handoff, or Liquid Glass acceptance.
- On Android, shared semantic cards resolve to Material-compatible tonal opaque surfaces, actionable rows and buttons use native ripple, targets remain at least 48 dp, and the existing edge-to-edge/safe-area split remains in force. Ordinary stack Back returns from detail to the mounted feed and its in-memory search/filter state; predictive Back remains disabled and unclaimed.
- Below 375 logical units the feed uses a 16-unit gutter and stacked/wrapped filter controls; at 200% font scale it retains one column and permits vertical growth. Filter choices never use a horizontally scrolling strip. Source names and Turkish titles wrap without a title line cap; the concise feed summary may be line-bounded while the detail summary remains fully readable.
- Availability is textual and semantic on both platforms: one exclusive initial busy surface; retained background-refresh, stale, partial, and offline banners; independent no-results/empty/error surfaces; and a retained-row pagination footer. Decorative skeletons are hidden from accessibility.
- `ContentFeedPreview` provides deterministic synthetic Android evidence scenarios behind the dual development gate. Its fixtures do not contact an API, persistence layer, provider, production account, or production data. The reviewed native result and any unresolved Android limitations belong in `evidence/phase-08-native`; no iOS result may be inferred on this Windows host.
- Release acceptance uses the separate 100-record production entry, not the
  debug preview. On the API 24 x86_64 AVD with the Intel host renderer, the
  final `NODE_ENV=production` run collected 600 frames with aggregate p90
  24.928167 ms, p95 35.777763 ms, and zero frozen frames. SwiftShader controls
  are retained as rejected environment evidence. The attempted smaller-batch
  FlatList tuning worsened that control and was fully reverted, so no unproven
  platform-specific virtualization behavior is shipped.

Native iOS/VoiceOver, TalkBack, modern Android/predictive Back, live provider
flows, installed E2E, and native tablet/rail acceptance remain unavailable.
The repository also has no mobile-native lint command/configuration. These are
evidence or later-phase limitations, not claims that Phase 1-8 code ran in
those environments.

## Phase 9 Calendar adaptation

- Shared semantics own Agenda/Week/Month periods, trusted date-only/range labels, event classification, dominant availability, personal-exam validation, and owner identity. Platform adaptation does not reinterpret these values.
- Android uses opaque Material-compatible tonal cards, native ripple, edge-to-edge shell ownership, a bottom-sheet editor, native Material date/time dialogs, and 48 dp minimum targets. Ordinary native-stack Back returns from event detail to the mounted Calendar view.
- iOS keeps event cards, grids, detail, and editor content opaque. Only eligible navigation/control chrome may use the established Liquid Glass wrapper when the runtime supports it and Reduce Transparency is off; otherwise it uses the opaque semantic fallback. The native iOS picker and runtime appearance remain unverified on this Windows host.
- Below 375 logical units or at large text, the Agenda/Week/Month control becomes a vertical radio group. The month grid stays informational and is followed by a readable event list. Bottom-sheet content scrolls so date/time launch and actions remain reachable at 320 dp and 200% font scale.
- Availability uses text and semantics on both platforms: exclusive initial loading/empty/error surfaces and retained refreshing/stale/partial/offline banners. Google partial state cannot be described as fully synchronized.
- Phase 9 native Android evidence covers 360 dp light/dark, exact 320 dp at font scale 2.0, and a temporary approximately 853 dp tablet viewport. TalkBack, iOS/VoiceOver/Liquid Glass, live provider mutation, and API 33+ predictive Back remain unclaimed.

## Phase 10 Profile and settings adaptation

- Profile, academic editing, notification settings, Google Calendar settings, and account management share one semantic state model. Platform adaptation changes presentation and native handoff only; it does not reinterpret profile completeness, hierarchy ownership, notification activation, provider ownership, or recent-authentication purpose.
- Android uses Material 3-compatible opaque tonal groups, native ripple, 48 dp minimum targets, edge-to-edge inset ownership, native-stack routing, modal sheets/dialogs, and ordinary system Back. Academic and Account use the shared keyboard-safe scroll boundary so inputs and actions remain reachable. The academic dirty guard intercepts header Back, gesture/navigation removal, Android Back, and the explicit Cancel action before any draft is discarded; failed saves stay dirty and retryable.
- iOS keeps settings rows, forms, status cards, confirmations, and destructive content opaque. Liquid Glass is eligible only on supported navigation/control chrome when Reduce Transparency is off; unsupported runtimes and accessibility settings use the semantic opaque fallback. Native iOS, VoiceOver, Dynamic Type, and Liquid Glass remain evidence limitations on this Windows host.
- Searchable academic selectors use the shared virtualized option sheet. The launch control exposes expanded state and receives focus again after selection, cancellation, or dismissal. Required-invalid and load/retry errors are announced without relying on border color. A parent change clears descendants in the draft before the next selector becomes available.
- Notification presentation keeps OS permission, installation registration, stored preference, and effective delivery status visibly separate. The stored preference always reads **Açık** or **Kapalı**, independent of dirty/saving/error presentation. Android can hand off to native app-notification settings when permission is permanently denied or settings are otherwise required; iOS uses its corresponding native settings handoff. The handoff is duplicate-safe, carries an explicit busy state, and presents a controlled rejection. No platform presents “active” unless all three activation gates are true.
- Provider and destructive confirmation actions use scrollable modal material, explicit cancel, busy locking, and focus return. Google controls also honor externally owned lifecycle busy state. Remove-managed-events and revoke remain distinct actions, and a disconnected connection with a retained managed ledger keeps its current mapping count and applicable actions. If successful removal eliminates the launching control, focus moves to the surviving screen heading. Data deletion and account deletion remain distinct recent-authentication purposes; neither platform caches or displays proof material.
- Below 375 logical units or under large text, status/action rows and choice controls stack vertically. Long names and email addresses wrap, forms remain one column, and sheet/dialog action areas remain reachable at exact 320 dp and 200% font scale. Tablet content stays within the established readable-width boundary rather than stretching settings rows edge to edge.
- Accessibility state names selected, busy, expanded/collapsed, invalid, dirty, saved, disabled, and error conditions. Classification and status always include text and/or icon as well as semantic color. Profile uses authoritative `/me` identity and Account uses the same authoritative `/me` email, while operation feedback is rendered once on the owning active route with the correct semantic tone. Native screenshots and hierarchy dumps can support layout/label review, but do not replace TalkBack or VoiceOver traversal acceptance.
- The Phase 10 preview is dual development-gated and synthetic. It may exercise profile, academic draft, notification truth combinations, Google lifecycle presentation, account danger expansion, confirmations, error, light/dark, compact, large-text, and tablet layouts; it must not call a live API, account, calendar, notification provider, SecureStore owner, or production dataset.
- Automated platform-facing checks pass: the focused native Phase 10 group records 5 suites / 71 tests / 0 snapshots, complete native Jest records 23 / 206 / 0, native TypeScript passes, and Android x86_64 debug assembly passes in 1 m 11 s with 268 tasks (7 executed, 261 up-to-date). The 56,804,991-byte APK has SHA-256 `57DC2F1BDCD7D7C3B02429EF260DF29A3EEEBCC374C55B90D34334793FEFAAFD`; the unchanged hash is expected because debug JavaScript is Metro-served. Only the known SDK XML/location, Gradle deprecation, and `NODE_ENV` warnings were emitted. The reviewed native set contains 44 PNG/XML pairs and an 88-row integrity index covering phone light/dark, exact 320 dp at font scale 2.0, a simulated tablet, reachable 48 dp controls, and ordinary Back to Profile in the same process. Its filtered runtime scan has no fatal/AndroidRuntime/React Native `TypeError`, `ReferenceError`, invariant, unhandled, or unable-to-load match, and device size/density/font settings were restored. TalkBack was disabled; API 24 cannot prove Android 13 notification permission or predictive Back; native iOS/VoiceOver/Liquid Glass, live providers, authenticated relaunch/account switching, and SecureStore remain unclaimed.

## Phase 11 cross-platform quality reconciliation

Phase 11 keeps the same routes, data ownership, and four-destination
information architecture. It reconciles semantic behavior at shared
boundaries, so platform differences remain deliberate expression rather than
duplicated feature logic.

### Shared adaptive and accessibility behavior

- The tested policy matrix covers widths 320, 360, 393, 430, and 853 at font
  scales 1.3, 1.5, and 2.0. Forms, long text, feeds, Calendar content, and
  settings remain vertically reachable with no horizontal-scroll dependency.
  Phone layouts use compact or regular gutters; tablet-style content stays
  within the 720-unit readable maximum. The existing Android rail is the only
  alternate primary-navigation presentation.
- Authenticated native-stack focus enters the real `AdaptiveTopBar` title.
  Headerless auth/onboarding/bootstrap/fallback routes announce their fixed
  route name. Shared sheets focus their title on entry and accept a launcher ref
  for focus restoration; selectors and date/time controls return focus after
  dismissal. Validation sends focus to the first invalid login/recovery,
  academic-profile, or personal-exam control.
- Operation banners remain persistent semantic alerts on one owning route.
  Announcement filter/search counts and Calendar view/period changes use an
  Android polite live region and an explicit iOS announcement. Selection,
  checked, disabled, busy, expanded, invalid, error, and destructive states are
  exposed programmatically and through text/icon shape, never color alone.
- The reachable YÖK route now owns one semantic `FlatList`; Summer School owns
  one semantic `SectionList` across dates, requirements, trusted announcements,
  and matching university options. These routes use opaque semantic surfaces,
  source-specific loading/retained/empty/stale/partial/offline/error states,
  safe official-link handoff, and existing date-only/range semantics. Their
  full-bleed route ownership prevents virtualized collections from being nested
  in the transitional routed scroller.

### Android expression

- Android keeps Material 3-compatible tonal opaque content, native ripple,
  48 dp minimum targets, native modal/date/time boundaries, edge-to-edge inset
  ownership, and ordinary native-stack/tab Back. Corrected semantic outline and
  disabled colors meet the shared non-text and text contrast contracts in light
  and dark themes.
- A runtime light/dark probe found that Android's ripple-backed primary Button
  could retain its previous native fill while its label adopted the new theme.
  The shared Button now remounts its native control on semantic mode changes;
  final pixel evidence verifies light `#4338CA` and dark `#A5B4FC` fills with
  their tested on-primary roles.
- Compact and large-text decisions stack controls and allow vertical growth;
  they do not truncate meaningful Turkish labels to preserve a one-row image.
  Temporary display/density/font overrides on `AcademicPhase1Low` may provide
  compact and tablet-style evidence, but they do not turn the phone AVD into a
  physical tablet/foldable result.
- The authorized image is Android 7 / API 24. It cannot establish Android 13
  notification permission or API 33+ predictive Back. The navigator callback
  therefore stays disabled under the supported compatibility policy.

### iOS expression and reduced effects

- iOS continues to use the 44 pt platform minimum where an iOS-specific target
  is permitted; shared migrated controls retain the stricter 48-unit floor.
  Forms, feeds, settings groups, Calendar cells/details, YÖK/Summer content,
  alerts, and destructive surfaces stay opaque. Liquid Glass eligibility is
  restricted to navigation/control `NavigationSurface` chrome.
- Reduce Transparency or missing material support selects the same readable
  opaque tonal chrome. Reduce Motion removes or simplifies nonessential shared
  sheet and toast transitions; no continuous decorative animation or Three.js
  path exists. These policy selections are deterministic, but Windows renderer
  coverage is not a native iOS runtime result.

### Current evidence limits

The Phase 11 report and [native-evidence index](./evidence/phase-11-native/README.md)
are authoritative for the exact
Android settings, captures, hashes, and performance trials actually completed.
This Windows environment cannot build or run iOS, VoiceOver, Dynamic Type,
native swipe-back, or Liquid Glass. TalkBack traversal is unavailable on the
authorized AVD; UIAutomator hierarchy output is not a screen reader. Bold-text
and Reduce Transparency runtime behavior are not inferred where the platform or
image exposes no controllable setting. No production or live Google Calendar,
Firebase/APNs, account, calendar, provider, or content fixture is used. Installed
authenticated E2E and automated native screenshot regression remain absent, and
the repository still provides no mobile-native lint command/configuration.

### Phase 12 current status

Production UI source is unchanged in Phase 12, so the current-source native
record remains the [Phase 11 evidence index](./evidence/phase-11-native/README.md).
Phase 12 re-hashes and reconciles that set instead of treating unchanged
captures as new platform acceptance. Its Android 7 / API 24 evidence covers the
recorded Material rendering, ordinary Back behavior, native pickers,
light/dark transitions, and compact, large-text, and temporary tablet-style
profiles. It cannot verify API 33+ notification permission or predictive Back;
the predictive callback remains disabled under the supported navigator policy.
TalkBack traversal is unverified, UIAutomator is not a screen reader, native
iOS and VoiceOver remain unavailable on this Windows host, and installed
authenticated E2E remains absent.
