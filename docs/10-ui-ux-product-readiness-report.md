# UI/UX Product Readiness Report (Web + Mobile)

## 1. Purpose

This report defines the design principles, design-system standards, and practical UX decisions needed to move the current admin web and student mobile web interfaces from MVP quality to production quality.

Scope:

- Admin web operations experience
- Student mobile web experience
- CTA strategy
- Color system
- Vector and icon standards
- Accessibility
- Performance and perceived-speed improvements

## 2. Current State Summary

Observed strengths:

- Core workflows are functional: catalog, PDF, review, publish, notification, and audit.
- The mobile side has completed baseline onboarding and calendar flows.
- Basic CSS and responsive breakpoints are reasonably consistent.

Observed critical gaps:

- The design-token architecture is not formally defined for color, spacing, radius, and state.
- CTA hierarchy is still limited to a mostly uniform button appearance.
- Typography and brand identity do not yet feel distinct enough.
- Empty, error, loading, and success states are not standardized.
- Visual asset standards for SVG, illustration, and animation are missing.
- Performance budgets and UI quality-gate metrics are not yet formalized.

## 3. Target UX Outcome

The product experience should be standardized around four principles:

1. Clarity: The primary task is clear at a glance on every screen.
2. Confidence: Critical actions are resilient, recoverable, and easy to verify.
3. Speed: Interactions remain smooth on lower-end mobile devices.
4. Trust: Color, copy, feedback, and accessibility are consistent.

## 4. Design System V1.0 Decisions

### 4.1 Token Layers

- Primitive tokens: raw color, spacing, radius, shadow, and type values.
- Semantic tokens: meaningful names such as `surface.default`, `text.primary`, and `cta.primary.bg`.
- Component tokens: component-specific names such as `button.primary.bg`, `input.error.border`, and `badge.warning.bg`.

### 4.2 Typography

Recommended font strategy:

- Admin web: "Manrope Variable" with "Noto Sans" fallback.
- Mobile web: "Plus Jakarta Sans Variable" with "Noto Sans" fallback.

Typography scale:

- Display: 40/48
- H1: 32/40
- H2: 24/32
- H3: 20/28
- Body L: 18/28
- Body M: 16/24
- Body S: 14/20
- Caption: 12/16

### 4.3 Spacing And Grid

- 8pt spacing system: 4, 8, 12, 16, 24, 32, 40, 48, 64.
- Admin web: 12-column desktop grid with 24px gutters.
- Mobile web: 4-column fluid grid with 16px horizontal padding.

### 4.4 Radius, Border, Shadow

- Radius: 6, 10, 14, 20.
- Border: 1px neutral-300 by default, 2px for focus states.
- Shadow layers: elevation-1, elevation-2, elevation-3.

## 5. CTA Strategy

### 5.1 CTA Levels

1. Primary CTA: The main goal of a screen.
2. Secondary CTA: Actions that support the main goal.
3. Tertiary CTA: Low-priority, text-weight actions.
4. Destructive CTA: Delete, archive, or hard-to-undo actions.

### 5.2 CTA Color And State Rules

- Primary: brand-600 background with white text.
- Secondary: white background with brand-700 border/text.
- Tertiary: text-link style.
- Destructive: danger-600 background with white text.

Required states for every CTA:

- default
- hover on web
- pressed
- focus-visible
- disabled
- loading

### 5.3 Screen-Level CTA Map

Critical admin web CTAs:

- Publish Calendar: Primary
- Approve Extracted Event: Primary
- Process Due Notifications: Primary
- Retry Failed Job: Secondary
- Archive University: Destructive
- Export Audit: Secondary

Critical mobile web CTAs:

- Continue Login/Register: Primary
- Select University: Primary
- Save Preferences: Primary
- Register Device: Secondary
- Refresh Upcoming: Tertiary

### 5.4 CTA Copy Rules

- Use a verb + object pattern, such as "Publish Calendar" or "Approve Event".
- Keep the ideal length to 2-4 words.
- Prefer outcome-focused copy over technical jargon.

## 6. Color System (AA Compatible)

### 6.1 Proposed Base Palette

Brand:

- brand-900: #062F42
- brand-700: #0B4F6C
- brand-600: #146C94
- brand-500: #1C87B8
- brand-100: #D9EEF8

Neutral:

- neutral-950: #0E141B
- neutral-800: #1E2A36
- neutral-700: #334155
- neutral-500: #64748B
- neutral-300: #CBD5E1
- neutral-200: #E2E8F0
- neutral-100: #F1F5F9
- neutral-50: #F8FAFC

State:

- success-600: #127A4E
- warning-600: #A15C00
- danger-600: #B42318
- info-600: #0C5DD6

### 6.2 Semantic Mapping

- canvas.bg -> neutral-50
- surface.bg -> #FFFFFF
- text.primary -> neutral-800
- text.secondary -> neutral-500
- border.default -> neutral-300
- cta.primary.bg -> brand-600
- cta.primary.text -> #FFFFFF
- cta.destructive.bg -> danger-600
- focus.ring -> info-600

### 6.3 Contrast Rules

- Normal text contrast must be at least 4.5:1.
- Large text contrast must be at least 3:1.
- Critical text and data tables should target 7:1.
- State communication must not rely on color alone; support it with text or icons.

## 7. Vector, Icon, And Illustration Standards

### 7.1 Icon System

- Primary icon library: Lucide.
- Stroke width: standardized at 1.75.
- Sizes: 16, 20, 24.
- Minimum spacing between icon and text: 8px.

### 7.2 SVG Production Rules

- All custom icons are stored as SVG.
- SVG files are automatically optimized with SVGO.
- Prefer stroke-based, simple geometry instead of heavy fill shapes.
- Use inline SVG or sprites; do not embed base64 icons.

### 7.3 Illustration And Micro-Animation

- Use lightweight vector illustrations for empty states and onboarding.
- Use Lottie only in high-value moments, such as onboarding success.
- Maximum single animation file size: 80KB gzip.
- Reduced animation through `prefers-reduced-motion` is required.

## 8. UX Flow And Interaction Standards

### 8.1 Form UX

- Inline validation with field-level error text.
- Required-field summary before submit.
- Optimistic feedback after submit with undo when appropriate.

### 8.2 State Screens

Each critical section needs reusable patterns for these four states:

- Loading: skeleton with a contextual label
- Empty: clear guidance text with a CTA
- Error: reason, recovery step, and retry CTA
- Success: result copy and next-step CTA

### 8.3 Information Architecture

Admin information architecture:

- Catalog
- PDF Operations
- Review Queue
- Calendar Publish
- Notifications
- Audit

Mobile information architecture:

- Auth
- University Selection
- Calendar
- Upcoming
- Preferences

## 9. Accessibility Standard

Target standard: WCAG 2.2 AA.

Required items:

- Full keyboard navigation
- Visible focus ring
- Minimum touch target of 44x44
- Landmarks and correct heading hierarchy
- Correct `label` and `aria-describedby` relationships in forms
- Screen-reader-friendly error announcements

## 10. Success Metrics (UX KPI)

Admin KPI:

- Calendar publish task completion >= 95%
- Average publish time <= 3 minutes
- Critical form error rate <= 2%

Mobile KPI:

- Login + university selection completion >= 90%
- Upcoming events first paint <= 2.5 seconds on 4G
- Preferences save success >= 98%

General quality KPI:

- Lighthouse Performance >= 90
- Lighthouse Accessibility >= 95
- INP < 200ms
- CLS < 0.1

## 11. Output Artifacts

Artifacts that should be produced from this report:

- Design-token JSON/CSS variable set
- UI component spec files for button, input, table, card, toast, and modal
- CTA copy guideline
- Icon and SVG governance document
- UX acceptance checklist

## 12. Approval Criteria

This plan can be considered the production-ready UI/UX baseline when:

- All critical screens are refactored with design-system tokens.
- CTA hierarchy follows one standard across all screens.
- Accessibility checklist and performance budgets become CI gates.
- Target KPIs are met in admin and mobile task-based usability tests.
