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

## Predictive-back compatibility boundary

React Native 0.81 exposes Android predictive-back plumbing, but the selected React Navigation 7 integration still documents predictive back as unsupported and requires `android:enableOnBackInvokedCallback="false"`. Phase 4 therefore deliberately retains `android.predictiveBackGestureEnabled: false`; the generated manifest has `android:enableOnBackInvokedCallback="false"`. This is the supported compatibility path, not a claim that a predictive animation ran. A pure immutable back-policy preview is tested so later enablement has one decision contract, while actual Android system-back and tab/stack history are tested independently. Enabling the OS predictive callback is gated on upstream navigator support plus API 33+ device validation in Phase 11.

## Remaining evidence and later-phase work

- iOS build/runtime and Liquid Glass screenshots remain unavailable on this Windows host; deterministic fallback selection is not native iOS visual acceptance.
- The authorized Android AVD is API 24, so it can verify ordinary system Back but not predictive-back callbacks/animations.
- Phase 4 supplies consistent pressed/ripple/focus behavior for shared primitives. The unchanged legacy screen body still has pre-foundation controls that later visual phases must migrate.
- The Phase 4 Android primitive matrix covers the development-only preview at a temporary 320 dp viewport; authenticated screens, tablet/rail, screen reader, full dark-theme screens, and iOS/Dynamic Type acceptance remain later gates.
- Phase 0's missing-native-environment statement is historical; `AcademicPhase1Low` now supplies the bounded Android launch target.

Each visual phase must capture equivalent iOS and Android states where the environment permits and record intentional differences rather than treating them as drift.
