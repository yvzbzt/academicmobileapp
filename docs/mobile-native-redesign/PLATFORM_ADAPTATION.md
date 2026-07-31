# Platform Adaptation Contract

Last updated: 31 July 2026

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
- Each tab owns an independent nested history. A selected nested-tab reselect pops to its root; a selected root reselect scrolls its internal `ScrollView` to `{ y: 0, animated: true }` and does not create Back history.

### Safe-area and navigation ownership

- In the phone layout the top bar owns top/left/right safe-area insets, authenticated routed content owns left/right, and the bottom tab bar owns bottom. In the Android large-width layout the rail owns the left navigation edge, routed content owns right/bottom, and the header owns the top of its scene. This conditional split prevents duplicated or missing navigation-edge padding.
- Android edge-to-edge remains enabled. Status/navigation-bar, gesture, keyboard, and content insets stay deliberate shell/navigator responsibilities; edge-to-edge is not permission for arbitrary content to render under system controls.
- Ordinary Android system Back follows the current nested stack and then tab history. Navigation locks disable the custom top-bar Back action and continue to prevent gesture/hardware abandonment of an owning operation. Predictive Back remains disabled and is not claimed as API 33+ evidence.

### iOS presentation

- Liquid Glass is restricted to eligible `NavigationSurface` navigation/control chrome. It is selected only when the component and runtime API are available and Reduce Transparency is off.
- Missing eligibility or enabled Reduce Transparency produces the same hierarchy with an opaque tonal semantic surface and divider/elevation treatment. Feed, form, calendar, alert, and destructive content remains opaque.
- The shell uses native tab/stack conventions and platform icons/feedback while retaining the shared routes, semantic tokens, accessibility names, and behavior. Deterministic renderer tests on Windows validate selection and fallback logic only; no native iOS runtime or screenshot acceptance is claimed.

### Android presentation

- The phone shell uses Material 3 tonal navigation chrome, native ripple feedback, and a fixed 64×30 selected-icon pill colored from the semantic selected-state role. It reserves 80 dp for navigation content plus the bottom system inset so icon and bounded large-text label geometry cannot enter system navigation. Unselected icons use their outline variants; selected icons use their filled variants. Android top-bar actions and navigation items retain the 48 dp minimum target.
- The same four destinations move to the existing Material navigation rail policy at the documented large-width breakpoint without changing route ownership or accessibility names.
- Phase 5 renderer and pure-contract tests cover exact tabs and selected states, independent nested histories, tab reselect behavior, internal destinations, simulated ordinary hardware Back dispatch, and protected-request gating. They do not demonstrate predictive Back or API 33 behavior.

## Predictive-back compatibility boundary

React Native 0.81 exposes Android predictive-back plumbing, but the selected React Navigation 7 integration still documents predictive back as unsupported and requires `android:enableOnBackInvokedCallback="false"`. Phase 4 therefore deliberately retains `android.predictiveBackGestureEnabled: false`; the generated manifest has `android:enableOnBackInvokedCallback="false"`. This is the supported compatibility path, not a claim that a predictive animation ran. A pure immutable back-policy preview is tested so later enablement has one decision contract, while actual Android system-back and tab/stack history are tested independently. Enabling the OS predictive callback is gated on upstream navigator support plus API 33+ device validation in Phase 11.

## Phase 6 authentication and onboarding adaptation

Authentication and onboarding share routes, validation, hierarchy, and accessibility semantics while allowing platform-native expression:

- On both platforms, routed auth content uses an opaque form-width surface, a 48×48 logical-unit interactive-target floor, system text scaling, persistent labels, scroll reachability, automatic keyboard insets, and explicit busy/disabled/error semantics. The presentation has no horizontally scrolling form row and does not truncate Turkish action labels to force visual parity.
- iOS uses `KeyboardAvoidingView` padding behavior, native one-time-code metadata, native-stack transitions, and ordinary swipe-back on eligible auth children. Form cards remain opaque. Liquid Glass remains restricted to eligible navigation/control chrome; it is not applied to text fields, validation banners, academic review, or selector reading content. Windows component tests cover this selection contract only; no iOS build, keyboard, Dynamic Type, Liquid Glass runtime, or VoiceOver acceptance is claimed.
- Android relies on the existing edge-to-edge `adjustResize` boundary plus vertically scrollable form content; the shared keyboard wrapper does not add an iOS-style padding behavior. It uses 48 dp controls, native ripple feedback, tonal opaque cards, Material-compatible progress/busy indicators, modal selector sheets, ordinary hardware Back, and an alert before discarding a dirty onboarding draft. The retained API 24 AVD cannot validate predictive Back or API 33 animation behavior.
- Email IME Next moves to Password; registration progresses through name, email, password, and confirmation; Done invokes only a validation-gated action. Verification and recovery code screens request numeric keyboards and one-time-code metadata. A visible soft keyboard must not make the primary action unreachable because the form remains vertically scrollable.
- A width below 375 logical units selects compact gaps while retaining the same information order. At 200% font scale, fields, banners, review rows, and action groups grow or wrap; primary actions remain reachable by vertical scrolling. Navigation label caps from Phase 5 do not cap form or error text.
- Selector search and option virtualization are shared. iOS may present the shared sheet with eligible control material; Android uses the opaque tonal Material fallback and Back dismissal. Loading, no-result, error/retry, selected, expanded, and explicit clear semantics are identical.

## Remaining evidence and later-phase work

- iOS build/runtime and Liquid Glass screenshots remain unavailable on this Windows host; deterministic fallback selection is not native iOS visual acceptance.
- The authorized Android AVD is API 24, so it can verify ordinary system Back but not predictive-back callbacks/animations.
- Phase 4 supplies consistent pressed/ripple/focus behavior for shared primitives. The unchanged legacy screen body still has pre-foundation controls that later visual phases must migrate.
- The Phase 4 Android primitive matrix covers the development-only preview at a temporary 320 dp viewport; authenticated screens, tablet/rail, screen reader, full dark-theme screens, and iOS/Dynamic Type acceptance remain later gates.
- Phase 0's missing-native-environment statement is historical; `AcademicPhase1Low` now supplies the bounded Android launch target.

Each visual phase must capture equivalent iOS and Android states where the environment permits and record intentional differences rather than treating them as drift.
