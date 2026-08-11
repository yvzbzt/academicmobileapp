# Akademik Takvim Reference Design Bible

Status: active production contract

Last updated: 11 August 2026

This document locks the visual language introduced from the supplied five-panel
reference board. It applies to every native route under `apps/mobile-native`.
When rules conflict, use this order:

1. Product behavior, accessibility, safe areas, and trustworthy academic data.
2. The supplied reference board.
3. This design bible.
4. Existing phase contracts in this directory.

The linked Taste Skill repository is used contextually. Its mobile design-bible,
redesign-audit, image-analysis, and anti-drift rules apply. Its web-only hero,
AIDA, GSAP, and large-section rules do not apply to this native product.

## Design read and dials

Akademik Takvim is a dependable daily student utility with a bright, friendly,
illustration-supported visual language. Information stays compact and calm.

- `DESIGN_VARIANCE: 4`
- `MOTION_INTENSITY: 3`
- `VISUAL_DENSITY: 6`

## Palette

Blue is the only interactive brand color. The other saturated colors encode
content categories or status and must not become competing CTA colors.

| Role | Value | Contract |
|---|---:|---|
| Primary blue | `#2563EB` | Primary actions, selected navigation, focus and exam emphasis |
| Teal | `#14B8A6` | Department, sync, positive category accents |
| Orange | `#F97316` | Faculty, warning and deadline accents |
| Yellow | `#EAB308` | Lesson and calendar category accents |
| Slate | `#64748B` | Secondary copy and metadata |
| Inactive slate | `#94A3B8` | Unselected navigation and quiet icons |
| Mist | `#F1F5F9` | Neutral chips and subtle groups |
| Border | `#E2E8F0` | Decorative separators and card outlines |
| White | `#FFFFFF` | Main canvas and readable surfaces |
| Navy | `#0B1739` | Primary light-theme text |

Low-contrast brand swatches are decorative. Text consumes the darker semantic
variants in `src/design-system/tokens.ts`. Destructive actions use accessible
red, never orange alone.

## Typography

Inter is bundled with the APK. Components consume the four registered faces:

- `Inter_400Regular`
- `Inter_500Medium`
- `Inter_600SemiBold`
- `Inter_700Bold`

The production scale remains responsive and supports system font scaling. Dates,
times, countdowns, and student numbers should use tabular figures wherever React
Native exposes that feature. Turkish copy must wrap without clipping.

## Geometry

- Phone gutter: 16 dp compact, 20 dp regular.
- Primary spacing rhythm: 8 dp; 4 dp sub-grid.
- Repeated row gap: 8-10 dp.
- Standard card/input radius: 12-14 dp.
- Prominent media/hero radius: 16-18 dp.
- Chips and primary buttons: pill.
- Bottom-sheet top radius: 24 dp.
- Touch targets: at least 48 dp in production primitives.
- Shadows: tinted, low-opacity, and reserved for real hierarchy.

Avoid nested card stacks. Prefer one coherent surface with internal spacing or
dividers.

## Authenticated shell

Phone navigation has four real route owners displayed in five visual slots:

`Ana Sayfa` · `Duyurular` · raised `+` · `Takvim` · `Profil`

The center action opens Calendar without adding a fifth route. Active items are
blue; inactive items are `#94A3B8`; selected icons may be filled. Root routes do
not render a second stack header. Pushed routes retain a compact back header.
Tablet navigation may use the existing rail adaptation.

## Root screens

### Home

Use the greeting/avatar row, blue academic-plan hero, at most three compact
upcoming-event rows, and a light-blue Google Calendar sync module. Preserve real
data states instead of substituting sample metrics.

### Announcements

Lead with one title and one horizontally scrollable scope-chip row. Feed cards
show scope color, source/time, title, a short excerpt, and an explicit affordance.
Search and advanced filters remain available without dominating the first view.
The list stays virtualized.

### Calendar

Lead with month/year, a filter control, a seven-day strip, and a compact timeline.
Time, event dot, title, category, and source form one row. A floating plus opens
the personal-exam editor. Full agenda/week/month capability and honest date-only
semantics remain intact.

### Profile

Use a blue identity hero, overlapping avatar treatment, compact academic summary,
and grouped 48 dp settings rows. Navigation chevrons appear only on rows that
navigate. Destructive account actions remain separated and red.

## Auth and secondary routes

Login uses the campus high-five artwork in a fixed portrait media frame with an
overlapping white form sheet. Register, verification, recovery, onboarding,
details, editors, settings, empty states, and failures inherit the same palette,
Inter hierarchy, radius taxonomy, fields, buttons, and restrained density.

Forms keep persistent labels, 48-52 dp controls, blue focus, inline accessible
errors, keyboard-safe scrolling, and first-invalid focus. Bottom sheets use a
navy scrim and native safe-area behavior.

## Motion and state

- Press feedback: scale approximately `0.98`; FAB approximately `0.96`.
- Navigation/state transitions: 120-220 ms using transform or opacity.
- No decorative loops, parallax, bounce, or content-card glass.
- Respect Reduce Motion and Reduce Transparency.
- Loading uses shape-matched skeletons; empty and error states preserve the same
  illustration and surface language.

## Pre-flight

- Compare at 360x800, 390x844, and 430x932 logical sizes.
- Check light/dark, 1.0x/1.3x text, 320 dp/2x text fallback, keyboard, and safe areas.
- Verify active navigation by icon, label, and color.
- Verify every CTA and field against WCAG AA contrast.
- Confirm blue is the only action accent and category colors always have labels.
- Confirm the four route owners remain unchanged.
- Run native TypeScript, Jest, focused root Vitest contracts, and a release APK build.
