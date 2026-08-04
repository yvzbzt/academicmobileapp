# Mobile Native Design System Contract

Status: Phases 1-8 implemented and reconciled; later-phase work remains deferred.
Last updated: 4 August 2026

## Current reconciliation

The accepted Phase 8 baseline is `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9`.
The bounded remediation commits are Package 1
`641d7bee8a1cd539179769069a22b5c3220e8a6d`, Package 2
`5a6ac1a48101569b4a9061f995b0bdd4ba77dd25`, and Package 3
`2e3664546f628a19c6fa929b9ee9469e5322f9a8`. Sections that describe the
scope of an earlier phase remain historical scope statements; this section and
the later phase-specific contracts describe current behavior.

Current native acceptance is bounded to the committed component/contract tests
and an Android API 24 x86_64 AVD. Native iOS, VoiceOver, TalkBack, modern
Android/predictive Back, live provider flows, tablet/rail, and installed E2E
remain evidence limitations. Mobile-native lint is not claimed because the
repository has no native lint command or configuration.

## Principles

1. **Content establishes value.** Product chrome supports dates, sources, and decisions; it does not compete with them.
2. **Trust is visible.** Official source identity, timestamp meaning, link destination, sync scope, and destructive consequences are explicit.
3. **One primary task per screen.** Secondary actions remain compact and predictable.
4. **Platform-native expression.** Semantics are shared; iOS and Android controls need not be pixel-identical.
5. **Accessibility is a component constraint.** It is not a final audit pass.

## Semantic color contract

These values establish direction and contrast-safe defaults. Components consume semantic names, never raw palette values.

### Brand palette

| Token | Light value | Intended role |
|---|---:|---|
| `brand.50` | `#EEF2FF` | Low-emphasis selected/educational tint |
| `brand.100` | `#E0E7FF` | Tonal container |
| `brand.200` | `#C7D2FE` | Stronger border/indicator on neutral surfaces |
| `brand.500` | `#4F46E5` | Non-text decorative/accent role |
| `brand.600` | `#4338CA` | Primary action/background; white contrast 7.90:1 |
| `brand.700` | `#3730A3` | Pressed/strong emphasis; white contrast 9.93:1 |
| `brand.800` | `#312E81` | Deep brand surface |

This indigo family is intentionally distinct from LinkedIn blue. Do not introduce `#0A66C2` as the brand identity.

### Light semantic roles

| Semantic token | Value | Use |
|---|---:|---|
| `background.canvas` | `#F6F7FB` | App background |
| `background.surface` | `#FFFFFF` | Cards, forms, readable sheets |
| `background.subtle` | `#EEF1F7` | Grouping without nested cards |
| `text.primary` | `#172033` | Normal text; 16.27:1 on white |
| `text.secondary` | `#526079` | Metadata; 6.35:1 on white |
| `text.disabled` | `#758197` | Only with a non-color disabled cue |
| `border.default` | `#D7DEEA` | Dividers and component outlines |
| `action.primary` | `#4338CA` | Primary button/focus action |
| `action.primaryPressed` | `#3730A3` | Pressed state |
| `action.focus` | `#6D5CE7` | Focus indicator; 4.84:1 on white |
| `status.success` | `#137A4B` | Success text/icon; 5.37:1 on white |
| `status.warning` | `#8A5200` | Warning text/icon; 6.39:1 on white |
| `status.error` | `#B42318` | Error/destructive text; 6.57:1 on white |
| `status.info` | `#1D4ED8` | Informational text; 6.70:1 on white |

### Dark semantic direction

| Semantic token | Value | Use |
|---|---:|---|
| `background.canvas` | `#0E1321` | Dark canvas |
| `background.surface` | `#151C2E` | Opaque reading surface |
| `background.subtle` | `#1D263A` | Tonal grouping |
| `text.primary` | `#F8FAFC` | Primary text |
| `text.secondary` | `#CBD5E1` | Metadata |
| `border.default` | `#344158` | Dividers/outlines |
| `action.primary` | `#A5B4FC` | Primary control; 8.90:1 with `#111827` content |
| `action.onPrimary` | `#111827` | Text/icon on dark-mode primary |

Status colors in dark mode require component-level contrast checks before implementation. Do not mechanically reuse light status tints.

## Typography

Use the platform system font unless the brand later supplies a licensed, performant family with Turkish glyph coverage. All text must respond to system font scaling.

| Role | Size/line-height direction | Weight | Use |
|---|---|---|---|
| `display` | 28/34 | 700 | Rare onboarding/product title; never a giant hero |
| `screenTitle` | 24/30 | 700 | Primary screen heading |
| `sectionTitle` | 20/26 | 700 | Major content group |
| `cardTitle` | 17/23 | 600–700 | Feed/content title |
| `body` | 16/23 | 400 | Reading and form content |
| `bodyStrong` | 16/23 | 600 | Emphasized body/action |
| `label` | 14/19 | 600 | Field/control label |
| `meta` | 13/18 | 400–600 | Source/time/supporting metadata |
| `navLabel` | at least 11 pt iOS / 12 sp Android | 600 | Four-destination navigation; never 9 dp |

No critical information may rely on truncation. Allow titles and error text to wrap. At 200% text scale, primary tasks must remain reachable without overlapping fixed chrome.

## Spacing, size, and radius

- Spacing scale: `4, 8, 12, 16, 20, 24, 32, 40`.
- Phone horizontal gutter: 16 at 320–374 dp, 20 at common phone widths, 24 on large phones where space permits.
- Readable content width: target 680–720 dp maximum on tablets; use adaptive margins or columns rather than stretching text edge to edge.
- Radius scale: `6` small, `10` controls, `14` cards/sheets, `18` prominent containers, `999` pills only when pill semantics are intentional.
- iOS touch targets: minimum 44×44 pt.
- Android touch targets: minimum 48×48 dp.
- Icons may be optically smaller inside the required hit area.

## Component state contract

Every primary action must define:

- default,
- pressed/ripple,
- focus,
- disabled with non-color cue,
- loading with stable width and an accessible busy state,
- success when completion is meaningful,
- error with recovery guidance.

Do not use opacity alone for disabled state. Do not move the primary label when a spinner appears. Errors must remain visible long enough to read and be announced to assistive technology; a top-of-scroll 3.5-second banner is not sufficient.

## Feed-card anatomy

Order is stable across Home and Announcements:

1. source identity and scope,
2. real publication time, or an explicitly labeled retrieval/update time,
3. concise title with decoded/sanitized text,
4. optional summary or useful media,
5. academic metadata such as category/date when relevant,
6. compact actions that actually work under the committed capability contract;
   Phase 8 detail currently supports Share and Open Official Source.

Rules:

- One top-level surface per item; avoid nested cards.
- Prefer dividers or tonal grouping over repeated shadows.
- Show the official destination before an external handoff when trust is ambiguous.
- Never expose raw HTML entities or untrusted URI schemes.
- Never present crawler `fetchedAt` as publication time.
- Do not mount unbounded feeds in `ScrollView`; use a virtualized list with stable keys, empty/error/footer states, and measured impressions only if analytics is approved.
- Actions absent from product/backend capability remain absent, not disabled theater.

## Forms and selectors

- Persistent label plus optional supporting/error text; placeholder is an example, not the label.
- Password policy copy and client validation must match the API.
- Use keyboard and return-key behavior appropriate to the field and flow.
- Large university/faculty/department datasets use search plus a virtualized selector, preferably a platform-appropriate sheet/full-screen picker.
- Include loading, no-results, retry, selected, and validation states.
- Destructive actions are visually separated and require clear native confirmation.

## Card-use rules

Use a card when it represents one coherent item or a distinct actionable module. Do not wrap every heading, empty state, row, and child section in additional cards. Main settings screens should prefer grouped rows; feeds should prefer a consistent item surface; metrics should be used only when they lead to a student action.

## Motion

- Motion explains navigation, state, or hierarchy; it is not decorative reward.
- Respect Reduce Motion.
- Keep pressed feedback immediate; use restrained transition durations.
- Avoid parallax, looping gradients, bouncing dashboards, and 3D decoration.

## Prohibited patterns

- Six-tab phone bottom navigation.
- 9 dp navigation labels.
- Giant authentication hero.
- Nested empty-state cards.
- Raw HTML titles or crawler timestamps mislabeled as publication times.
- Glass content cards.
- Generic AI-dashboard visuals.
- Fake likes, comments, reposts, social counters, or connection mechanics.
- Exact LinkedIn blue, icons, layout, or trade dress.

## Phase 4 implementation contract

The executable foundation lives under `apps/mobile-native/src/design-system`:

- `tokens.ts` is the only palette-value boundary for new foundation code. It exports light/dark semantic colors, typography, spacing, radii, platform elevation/shadow, motion, safe-area, readable-width, and touch-target contracts plus deterministic theme and contrast helpers.
- `theme.tsx` resolves `system | light | dark`, observes system appearance, Reduce Motion, and Reduce Transparency, and fails safe with non-essential motion and translucent material disabled until accessibility state is known.
- `platform.ts` selects iOS highlight/44 pt behavior, Android ripple/48 dp behavior, phone bottom tabs, Android tablet navigation rail, adaptive gutters, and platform elevation without duplicating business logic.
- `surfaces.tsx` supplies a safe-area/readable-width `Screen` and navigation/control-only `NavigationSurface`. Opaque tonal chrome is the default fallback; Liquid Glass is eligible only on iOS when both the Liquid Glass component and runtime API report availability and Reduce Transparency is off.
- `primitives/` exports `Button`, `IconButton`, `TextField`, `PasswordField`, `SearchField`, `SelectField`, `Card`, `ListItem`, `Chip`, `SegmentedControl`, `Banner`, `Toast`, `Skeleton`, `EmptyState`, `ErrorState`, and `BottomSheet` with semantic state and accessibility props. Selector options use a virtualized list; the sheet owns modal, safe-area, dismiss, busy, Back, and platform-material boundaries.
- `src/components/Section.tsx` is the first transitional component boundary for unchanged Phase 1–3 screen content. It consumes semantic roles; it does not establish a Phase 5 visual redesign.
- `DesignSystemPreview.tsx` is a deterministic primitive-state inventory reachable only when both `__DEV__` and `EXPO_PUBLIC_PHASE4_DESIGN_PREVIEW=1` are true; production builds cannot select it.

`app.json` now permits automatic system appearance through `expo-system-ui`, and the routed application is wrapped once in `ThemeProvider`. New route chrome and shared primitives contain no raw screen-meaning colors outside `tokens.ts`. The legacy screen body in `App.tsx` still contains pre-Phase-4 hard-coded styles outside the bodies migrated by completed Phases 5-8. A wholesale `App.tsx` rewrite is neither complete nor required by the Phase 1-8 contract.

### Tested state inventory

The isolated native component stack is Jest 29 + `jest-expo` 54 + React Native Testing Library 13.3. Tests use semantic roles/names and cover default, press feedback, disabled, busy/loading, success, error, selected, form validation, password visibility, feedback announcements, reduced-motion/busy skeleton semantics, empty/error actions, selector selection/empty/disabled states, sheet dismissal/locking/material, the preview inventory, light/dark resolution, 320 dp gutters, tablet rail selection, readable widths, reduced accessibility settings, eligible Liquid Glass, and opaque fallback. Pure Vitest tests separately cover token contrast and deterministic theme/platform resolution. No snapshot acceptance is used.

### Migration and rollback

This phase introduces no persistent design preference, database migration, backend behavior, or screen-data rewrite. A rollback removes the provider/surface/primitive imports and the new Expo modules/navigation packages while leaving every Phase 1–3 storage key and server contract intact. Until later screen phases migrate legacy body styles, removing this foundation returns those screens to their previous presentation without a data conversion.

## Phase 5 app-shell presentation contract

At its original milestone, Phase 5 added the authenticated shell presentation around the Phase 4 route tree without claiming later screen bodies. Phase 6 now owns auth/onboarding, Phase 7 owns Home, and Phase 8 owns Announcements/detail; Calendar and Profile remain later-phase presentation work.

### Primary navigation ownership

- `src/navigation/app-shell.ts` is the single presentation source for the four primary destinations and their selected/unselected icons: `Ana Sayfa` → `Home`, `Duyurular` → `Announcements`, `Takvim` → `Calendar`, and `Profil` → `Profile`.
- `AppNavigator` builds the tab screens, visible labels, and full accessibility labels from that same ordered definition. Do not copy or independently rename the four tabs in screen code.
- Summer School and YÖK remain reachable inside the Announcements stack; they are not additional primary tabs.
- Each tab retains its own native-stack history. Reselecting a selected nested tab returns that stack to its root; reselecting a selected root scrolls the registered root scroll owner (`ScrollView` or the current production `FlatList`) to the top without pushing another route. Package 3 verifies this against the real Home list while preserving its offset across tab switches.

### Shared shell components and semantic styling

- `AdaptiveTopBar` is the reusable authenticated native-stack header. It accepts a wrapping title, optional subtitle/context, a named leading action, and named trailing actions; back behavior remains navigation-owned.
- App-shell text, borders, selected state, canvas, raised surface, spacing, radii, and elevation come from semantic theme roles. Shell components do not establish a second palette or use screen-meaning raw colors.
- `NavigationSurface` remains a navigation/control-chrome boundary. On eligible iOS runtimes it may render Liquid Glass only for that chrome. Reduce Transparency, missing component/runtime support, and every non-iOS platform select the opaque tonal semantic fallback. Content cards and reading surfaces do not become glass.
- Android expresses the same semantics with Material 3 tonal navigation surfaces, native ripple feedback, and a fixed selected-icon pill using `state.selected`; the unselected icon remains outline-only. Phone bottom navigation reserves 80 dp of Material content height plus the bottom system inset. Top-bar actions are at least 48×48 logical units, tab items are at least 48 high, and icons may remain optically smaller inside those targets.

### Insets, compact width, and large text

- In the authenticated phone shell, `AdaptiveTopBar` owns the top/left/right safe-area inset, routed `Screen` content owns left/right, and React Navigation's bottom tab bar owns the bottom inset. In the Android large-width rail layout, the rail owns the left navigation edge while routed content owns right/bottom; the header continues to own the top of its scene. Screen bodies must not add duplicate navigation-edge padding. Non-shell/auth surfaces continue to own all requested edges themselves.
- Android remains edge to edge, but drawing edge to edge does not transfer status-bar, navigation-bar, keyboard, or gesture-inset ownership to arbitrary content. The shell and navigator boundaries must continue to apply those insets deliberately.
- Widths below 375 logical units use compact top-bar density, the compact semantic title role, a 16-unit screen gutter, and wrapping action layout. Width 375 and above uses the regular contract; text is not clipped merely to preserve one row.
- Top-bar titles and supporting text scale and wrap. Navigation labels use one visual line at 11 pt on iOS or 12 sp on Android. The ordinary visual cap is 1.35; below 375 logical units, a requested scale above 1.35 selects the compact large-text cap of 1.20. That bounded label sits inside the 80 dp Android navigation content area while the tab control retains its exact full accessible name and selected state.

### Back and evidence boundary

- `backBehavior="history"`, nested native-stack Back, tab reselect, navigation locking, and strict one-shot protected requests remain behavioral contracts beneath this presentation. A navigation lock disables the custom top-bar Back action as well as gesture/hardware Back abandonment. Android currently supports ordinary system Back through those stacks.
- Phase 5 does not enable predictive Back. `predictiveBackGestureEnabled` remains false pending supported navigator behavior and API 33+ device validation.
- Renderer and pure-contract tests validate shell structure, semantics, adaptive decisions, and fallback selection. They are not evidence that Liquid Glass or the iOS shell ran natively on this Windows host.

## Phase 6 authentication and onboarding form contract

- Academic onboarding exposes all three visible progress markers, including
  `1 / 3 · Hesap`, while preserving `2 / 3` and `3 / 3`. Login validation
  focuses the actual first invalid native input, including Email before
  Password; Package 3 tests assert the input ref focus rather than text order.
- `src/auth/AuthScreens.tsx` is the shared presentation boundary for Login, Registration, Verification, the three password-recovery screens, and Academic Onboarding. It composes Phase 4 `TextField`, `PasswordField`, `SearchField`, `SelectField`, `Button`, `Banner`, and opaque `Card` primitives; it defines no local palette and does not own API, session, storage, provider, or persistence behavior. Migrated interactive primitives now floor their rendered target at 48×48 logical units on both platforms while retaining platform feedback and geometry.
- Auth identity is compact. A screen has one title and one supporting paragraph; the oversized welcome hero and combined “Giriş ve Kayıt” heading are not rendered. Login completion transitions directly to the first meaningful authenticated destination without a large success banner.
- Every editable value has a persistent label. Local errors are linked through `aria-invalid` and `aria-errormessage`, rendered as alert text, and never rely on color alone. Native input refs support first-invalid focus and IME Next/Done movement without transferring form ownership into the primitive.
- Password fields preserve the typed value while visibility changes and support both controlled and uncontrolled reveal state. Registration visibly and programmatically enforces the real minimum of 10 characters and matching confirmation. Backend validation remains authoritative and is mapped into controlled feedback rather than displayed raw.
- Verification uses a four-digit numeric one-time-code field, masked destination, expiry and resend timing, and separate resend/change-email actions. Recovery uses six digits and distinct request, code, and new-password surfaces. Codes and passwords remain in memory only; the renderer and preview never add persistence.
- Academic selectors pair a `SearchField` with the existing virtualized `SelectField` sheet. Loading, retry, no-result, expanded, disabled, selected, and optional-clear states retain the shared primitive semantics. University is required; optional descendants clear in the draft when a parent changes. Only the final review action may invoke the complete-replacement save.
- `Screen keyboardSafe` is opt-in and used by auth/onboarding routes. It wraps routed content in `KeyboardAvoidingView`, selects platform behavior, and enables automatic scroll keyboard insets. Form content uses the semantic `form` readable width, flexible rows, wrapping Turkish actions, and no horizontal scrolling at 320 logical units or 200% text scale.
- `AuthOnboardingPreview` is development-only synthetic evidence. It must remain dual-gated by `__DEV__` and `EXPO_PUBLIC_PHASE6_AUTH_PREVIEW=1`, use reserved `.invalid` identities, and import no API, SecureStore, Google/provider, notification, or persistence module.

## Phase 7 Home daily-brief contract

- `src/home/HomeDailyBrief.tsx` is the Home presentation boundary and `home-model.ts` owns deterministic selection/state policy. Home uses a single virtualized vertical list; it is not nested in the routed `ScrollView`.
- The fixed hierarchy is greeting/context, incomplete-profile action when applicable, Today, next important date, at most one explicitly qualifying important trusted announcement, at most three independently selected recent trusted announcements, and at most one compact actionable integration banner. Crawler priority and mere recency never manufacture importance.
- Dashboard counts and shortcut cards for the four primary tabs are not rendered. Personal exam creation remains reachable on Calendar through the existing owner-scoped manual-exam behavior.
- Reading surfaces are opaque semantic cards on both platforms. Eligible iOS Liquid Glass remains navigation/control chrome only. Android receives semantic tonal surfaces, ripple feedback through shared primitives, 48 dp targets, and edge-to-edge inset ownership through the shell.
- Loading, incomplete profile, populated, genuine empty, recoverable error, offline-with-no-data, and partial-source-with-no-data are mutually exclusive primary states. Background refresh keeps useful data visible. Integration-only content remains actionable rather than collapsing into empty. Partial, stale, offline, and refreshing status is explicit text plus semantics, never color alone.
- Dates use the device local calendar day and local-time formatting. Remaining-time text is recomputed every minute while mounted. Announcement ordering uses only valid publication or source-update timestamps; discovery/fetch timestamps are never presented as publication.
- Titles wrap without line caps. Headings, row labels, busy state, source/title/date/action order, 320 dp single-column gutters, 720 dp readable width, and 200% text growth are deterministic component contracts.

## Phase 8 trusted academic content-feed contract

- Date-only academic dates and inclusive ranges retain the Package 2 temporal
  contract through the trusted DTO and native rendering; they are not coerced
  through UTC instants that can move a civil day.
- `src/announcements/feed-model.ts` is the deterministic presentation boundary for the unified feed. It accepts only explicit Phase 2 trusted records with non-empty record, source, and scope identity; normalized source/title/summary text; credential-free official HTTP/HTTPS URLs; and matching item/source institutional authority. A source-less fallback, unsafe or mismatched URL, absent explicit trust, or rejected/quarantined record fails closed before a row is rendered.
- The Announcements hierarchy is screen title and academic context, labelled search, **İçerik türü**, **Akademik kapsam ve kaynak**, a selected-filter/result summary, nested YÖK/Yaz Okulu destinations, availability status, then trusted rows. The exact content-type choices are **Tümü**, **Duyurular**, **Haberler**, and **Etkinlikler**. The exact source choices are **Tüm kaynaklar**, **Üniversitem**, **Fakültem**, **Bölümüm**, **YÖK**, and **Yaz Okulu**.
- `AnnouncementsFeed` owns one vertical `FlatList`; the Announcements route is full-bleed so it is not nested in the transitional routed `ScrollView`. Rows use canonical official URL identity, deterministic deduplication, publication/source-update ordering, pull-to-refresh, and controlled server-limit expansion from 20 through 100. Pagination failure retains the already verified rows and offers an explicit retry.
- Search covers normalized title, safe summary, and official source name after a 300 ms debounce. Turkish dotted/dotless I and diacritics fold for matching. Search text remains component memory only and must not be logged, persisted, placed in route params, or sent to analytics without a separately approved privacy contract.
- A row presents official source, academic scope and trusted content type, publication or explicitly labelled source-update time, wrapping title, optional concise summary, and one full-row **Ayrıntıyı aç** affordance. Discovery/fetch time never supplies display order or a publication label. Rows have no per-item oversized open button, nested card, fake social action, or invented status.
- Primary feed states are mutually exclusive: initial loading, background refresh, populated, genuine empty, filtered no-results, stale retained data, partial source failure, offline, recoverable error, pagination loading, and pagination failure. Retained useful content remains visible beneath a labelled availability banner. Decorative skeletons are hidden from accessibility beneath one labelled busy region.
- `AnnouncementDetail` is an opaque in-app reading surface for announcement, news, event, YÖK, and compatible Summer School trusted records. It revalidates the selected record, shows normalized type/scope/source identity, the destination domain, separately labelled publication/update dates, and the safe summary currently supplied by the Phase 2 DTO. It supports the native share sheet and a controlled official-source handoff to the specific canonical item URL. Handoff failure stays on the current route with fixed non-raw feedback.
- The trusted DTO does not provide complete body, attachment, deadline/event-period, durable Save/read state, or a feed-owned calendar-mutation contract. Those sections and actions remain absent rather than being synthesized or displayed disabled. Summer School requirements, options, and dates that are not trusted-content DTO records remain on the existing nested Summer School surface.
- Feed rows, detail cards, text, banners, and long reading surfaces remain opaque on both platforms. Eligible iOS material remains restricted to Phase 5 navigation/control chrome. Android uses semantic tonal surfaces, native ripple through shared primitives, existing edge-to-edge ownership, and 48 dp targets.
- The feed stays one column with a 720-unit readable maximum, 16-unit gutters below 375 logical units, wrapped rather than horizontally scrolling filter groups, and no horizontal-clipping contract at 320 dp/200% text scale. Titles and institution names wrap; selected filters expose accessibility state as well as color, and source/time/title/summary/action follow logical reading order.
- `ContentFeedPreview` is synthetic evidence tooling only. It is gated by both `__DEV__` and `EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW=1`, uses reserved `preview.edu.tr`/YÖK fixtures, imports no API/storage/provider integration, and cannot be selected in a production bundle. Native evidence results remain separately indexed in `evidence/phase-08-native` and must not be inferred from component tests.

### Phase 8 release-performance acceptance

Package 3 adds a separate production bundle entry that renders the existing
deterministic 100-record fixture and a repository-owned Android `framestats`
runner. The final fresh x86_64, nondebuggable, `NODE_ENV=production` run on the
API 24 host-rendered AVD collected 600 valid frames: aggregate p90
24.928167 ms, p95 35.777763 ms, and zero frames at or above 700 ms. This passes
the declared limits of p90 <= 32 ms, p95 <= 50 ms, at least 100 frames in each
of five trials, and zero frozen frames. The APK SHA-256 was
`ce910347fbb1b663c1ec12b8b03b442533655e23a131093bd4abcbdeded17a26`.

A SwiftShader control failed, and an experimental smaller-batch FlatList
configuration made that software-renderer result worse. The experiment was
fully reverted. No unproven virtualization change is part of the current design
contract; the hardware-rendered unchanged feed passed. Exact method, rejected
controls, final trials, renderer, and cleanup proof live in
`apps/mobile-native/performance/`.
