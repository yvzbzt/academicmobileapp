# Mobile Native Design System Contract

Status: Phase 4 semantic foundation implemented; full screen migration remains phased.
Last updated: 31 July 2026

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
6. compact actions that actually work: Save, Share, Add to Calendar, Open Official Source.

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

`app.json` now permits automatic system appearance through `expo-system-ui`, and the routed application is wrapped once in `ThemeProvider`. New route chrome and shared primitives contain no raw screen-meaning colors outside `tokens.ts`. The legacy screen body in `App.tsx` still contains its pre-Phase-4 hard-coded styles; migrating that body wholesale belongs to Phases 5–10 and is not represented as complete here.

### Tested state inventory

The isolated native component stack is Jest 29 + `jest-expo` 54 + React Native Testing Library 13.3. Tests use semantic roles/names and cover default, press feedback, disabled, busy/loading, success, error, selected, form validation, password visibility, feedback announcements, reduced-motion/busy skeleton semantics, empty/error actions, selector selection/empty/disabled states, sheet dismissal/locking/material, the preview inventory, light/dark resolution, 320 dp gutters, tablet rail selection, readable widths, reduced accessibility settings, eligible Liquid Glass, and opaque fallback. Pure Vitest tests separately cover token contrast and deterministic theme/platform resolution. No snapshot acceptance is used.

### Migration and rollback

This phase introduces no persistent design preference, database migration, backend behavior, or screen-data rewrite. A rollback removes the provider/surface/primitive imports and the new Expo modules/navigation packages while leaving every Phase 1–3 storage key and server contract intact. Until later screen phases migrate legacy body styles, removing this foundation returns those screens to their previous presentation without a data conversion.
