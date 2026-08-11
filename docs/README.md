# Documentation Index

This index separates current operating guidance from dated evidence. Historical
reports remain traceable and must not be treated as the current runtime or
release contract.

## Current system and operating guidance

- Product scope and backlog: [product analysis](./01-product-analysis.md) and
  [MVP backlog](./03-mvp-backlog.md)
- Architecture and API: [technical architecture](./02-architecture.md),
  [endpoint catalog](../apps/api/src/contracts/endpoint-catalog.ts), and
  [shared contracts](../packages/shared/src/contracts.ts)
- Security: [security hardening](./04-security-hardening.md)
- Data: [MongoDB data model](./06-data-model.md),
  [cache and queue design](./07-cache-queue.md), and
  [PDF ingestion and alarms](./13-pdf-ingestion-and-alarm-model.md)
- Testing: [test strategy](./05-test-strategy.md)
- Deployment: [DevOps and deployment](./08-devops-deployment.md),
  [Firebase deployment](./15-firebase-deploy.md), and the
  [Hetzner deployment assets](../deploy/hetzner/)
- Product experience: [readiness report](./10-ui-ux-product-readiness-report.md),
  [implementation roadmap](./11-ui-ux-implementation-roadmap.md), and
  [optimization scenarios](./12-ui-ux-optimization-scenarios.md)
- Announcement scale: [announcement scaling](./14-announcement-scaling.md)

## Mobile-native redesign

- Program and phase navigation: [mobile-native redesign](./mobile-native-redesign/README.md)
- Architecture decisions: [DECISIONS](./mobile-native-redesign/DECISIONS.md)
- Current known issues: [KNOWN_ISSUES](./mobile-native-redesign/KNOWN_ISSUES.md)
- Test and evidence coverage: [TEST_MATRIX](./mobile-native-redesign/TEST_MATRIX.md)
- Design and platform contracts:
  [DESIGN_SYSTEM](./mobile-native-redesign/DESIGN_SYSTEM.md),
  [PLATFORM_ADAPTATION](./mobile-native-redesign/PLATFORM_ADAPTATION.md), and
  [SCREEN_INVENTORY](./mobile-native-redesign/SCREEN_INVENTORY.md)

The phase reports and their evidence directories are retained in place. Phase
11 and Phase 12 contain the current final-quality and reconciliation evidence;
earlier phase evidence remains historical and traceable.

## Historical and append-only evidence

- [Section approvals](./09-section-approvals.md) is a dated, append-only ledger.
- [Announcement ingestion report](./16-announcement-ingestion-report.md) is
  preserved at its tested path with explicit superseding notes.
- [Pre-redesign UI/UX audit](./19-mobile-native-current-state-ui-ux-audit.md)
  and [in-app activity report](./20-mobile-native-in-app-user-activity-report.md)
  are explicitly marked historical baselines and remain at their referenced
  paths.
- Earlier source-retrieval audits are in the [archive](./archive/README.md).

Untracked prompts, logos, missing-link reports, and missing-link CSV files are
user-owned working material. They are intentionally not classified as current
documentation or changed by repository cleanup.
