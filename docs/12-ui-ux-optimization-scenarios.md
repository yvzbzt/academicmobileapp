# UI/UX Optimization Scenarios (Web + Mobile)

## 1. Purpose

This document defines scenario-based optimization plans for protecting production-level UI/UX quality across performance, perceived speed, accessibility, and task-completion success.

## 2. Performance Budgets

Admin web budgets:

- Initial JS (gzip): <= 220KB
- Initial CSS (gzip): <= 70KB
- Total SVG on the critical path: <= 50KB
- LCP: <= 2.5s on desktop, <= 3.0s on 4G
- INP: < 200ms
- CLS: < 0.1

Mobile web budgets:

- Initial JS (gzip): <= 180KB
- Initial CSS (gzip): <= 55KB
- Total font payload (woff2): <= 120KB
- LCP: <= 2.8s on 4G, <= 4.0s on slow 4G
- INP: < 180ms
- CLS: < 0.08

## 3. Scenario Set

## Scenario A - Low-End Android + Weak Network

Risk:

- Auth and university-selection screens feel slow to respond.

Actions:

- Route-level code splitting.
- Skeleton-first render.
- Lazy-load the non-critical icon set.
- Run input validation with debounce.

Expected gain:

- First interactive state time improves by at least 25%.

## Scenario B - Slow API Responses (700ms+)

Risk:

- The user thinks the system is stuck after taking an action.

Actions:

- Optimistic UI patterns where endpoints allow them.
- Request state machine: idle, loading, success, error, retrying.
- Retry CTA and timeout fallback message.

Expected gain:

- Action abandonment drops by at least 20%.

## Scenario C - Large Data Table (Admin)

Risk:

- Table rendering and scroll performance degrade.

Actions:

- Row virtualization.
- Sticky column and simplified row layout.
- Server-side pagination with filter debounce.

Expected gain:

- Scroll jank leaves the critical range on datasets with 5,000+ rows.

## Scenario D - Notification Processing Peak

Risk:

- The notification panel looks stale and operators lose confidence.

Actions:

- Polling strategy: faster while the tab is focused, slower in the background.
- Incremental list updates.
- Deterministic status labels for action outcomes.

Expected gain:

- Action-result visibility improves and operator confidence increases.

## Scenario E - Accessibility For Critical Actions

Risk:

- Keyboard or screen-reader users cannot complete a critical task.

Actions:

- Focus-order map.
- Live region for error and success announcements.
- Icon + text instead of color-only signaling.

Expected gain:

- Critical WCAG 2.2 AA violations are reduced to zero.

## 4. Vector And Visual Optimization Rules

- All SVG assets must pass through the SVGO pipeline.
- Repeated icons should use a sprite or component-based reuse.
- When bitmap assets are required, use an AVIF -> WebP fallback strategy.
- Target illustration file size: <= 120KB.
- Target Lottie file size: <= 80KB gzip.
- Play at most one micro-animation on a page at a time to protect CPU usage.

## 5. CTA And Color Optimization Scenarios

## Scenario F - CTA Decision Fatigue

Actions:

- Require one primary CTA per panel.
- Reduce the visual weight of secondary and destructive buttons.

Metric:

- Mis-click rate <= 3%.

## Scenario G - Contrast And Night Usage

Actions:

- Automate text/background contrast scanning.
- Prepare a semantic token layer for future dark-mode support.

Metric:

- All primary text reaches at least 4.5:1 contrast.

## 6. Tooling And Automation

- Lighthouse CI: performance-budget gate.
- Axe-core: accessibility violation checks.
- Playwright: visual regression for critical flows.
- Bundle analyzer: route-level weight tracking.
- RUM telemetry: live tracking for LCP, INP, and CLS.

## 7. Test Matrix

Device segments:

- Low: 2 GB RAM Android
- Mid: 4 GB RAM Android / iOS
- High: modern desktop

Browser coverage:

- Chrome, Edge, Safari, Firefox (latest two major versions)

Network profiles:

- Wi-Fi
- 4G
- Slow 4G

## 8. Release Gate Criteria

A release candidate passes the UI/UX gate when:

- No performance budget is violated.
- No critical accessibility violation remains.
- Critical-flow E2E tests are green.
- Visual-regression differences are approved.
- CTA hierarchy checklist passes.

## 9. 30-60-90 Day Optimization Plan

First 30 days:

- Token migration and CTA standardization.
- Loading, empty, error, and success patterns on critical screens.

60 days:

- Table virtualization and reduced mobile-flow friction.
- SVG/Lottie budget enforcement.

90 days:

- RUM-based tuning.
- A second optimization pass based on UX KPI trends.

## 10. Expected Result

This optimization plan should:

- Increase operational speed and error resilience in the admin panel.
- Improve completion rates in the mobile web experience.
- Connect UI/UX quality to measurable gates in the release process.
