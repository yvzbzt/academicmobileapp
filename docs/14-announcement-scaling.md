# Announcement Aggregation Scaling Plan

This document describes how to keep announcement ingestion reliable when the platform grows to many universities, faculties, and departments.

## 1. Source Registry By Scope

Store announcement sources in `announcement_sources` with these levels:

- `scopeType=university` for university-wide pages.
- `scopeType=faculty` for faculty-level pages.
- `scopeType=department` for department-level pages.

Every source has:

- `sourceUrl`
- `parser` (`auto`, `rss`, `html`)
- `status` (`active`, `paused`)
- optional `fallbackItems`
- optional `priority`

A student request resolves sources using university + faculty + department IDs and merges all active scopes.

## 2. Retrieval Strategy

Current request-time flow:

1. Resolve scoped source list.
2. Fetch each source with timeout and parser selection.
3. Parse and normalize into a common item shape.
4. Deduplicate by link.
5. Sort by `publishedAt` and return top N.

This is acceptable for MVP and low traffic.

## 3. Scale Path (Recommended)

Move from request-time scraping to background ingestion:

1. Scheduler enqueues source fetch jobs every few minutes.
2. Workers fetch/parse and write normalized items to `announcement_items`.
3. API `GET /announcements/my` becomes read-only over cached items.
4. Add TTL and retention rules for old announcements.

Benefits:

- Faster response times.
- Better stability when source sites are slow.
- Better control of retries and failures.

## 4. Failure Tolerance

Per source resilience policy:

- timeout budget (for example 5-7 seconds),
- retry with exponential backoff,
- circuit breaker after repeated failures,
- fallback to `fallbackItems` when fetch fails,
- mark unhealthy source status for admin review.

## 5. Multi-Tenant Safety

To avoid cross-tenant data leaks:

- keep strict scope filters in repository queries,
- enforce unique source constraints per scope,
- index by `(scopeType, scopeId, status)`,
- index `(sourceUrl, scopeType, scopeId)` as unique.

## 6. Admin Workflow

Add admin controls for source lifecycle:

- create/update/pause source,
- parser override (`rss` or `html`) when auto fails,
- source health panel (last success, fail count, latency),
- manual re-fetch action,
- preview normalized output before publishing source.

## 7. Future Enhancements

- Language-aware relevance scoring (`announcement`, `notice`, `bulletin`, etc.).
- Content fingerprint dedupe (title + date + semantic hash), not only link dedupe.
- Per-scope max item quotas and pagination.
- Optional push notifications for critical announcement categories.
