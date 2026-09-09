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
- `status` (`active`, `inactive`)
- optional `fallbackItems`
- optional `priority`

A student request resolves persisted items for all followed university, faculty, and department scopes. A user may follow no university, one university, or several universities; an empty scope returns an empty feed instead of triggering ingestion.

## 2. Retrieval Strategy

Current flow:

1. The dedicated content worker resolves due sources.
2. It fetches each source with timeout, authority checks, and conditional validators.
3. It parses, normalizes, and deduplicates items into a complete staged snapshot.
4. It atomically activates that snapshot.
5. `GET /announcements/my` reads only the active persisted snapshot and performs no external fetch or ingestion write.

Run the worker separately with `npm run start:content-worker`. The Hetzner Compose file also defines a separate `content-worker` process. It uses the existing NestJS and MongoDB repositories; no queue or additional infrastructure is required.

Production ingestion flags default to `false`. Before enabling them, recover adequate disk headroom, deploy the worker while ingestion is disabled, and verify that it remains healthy. Start a canary with `ANNOUNCEMENT_INGEST_BATCH_SIZE=25` and `ANNOUNCEMENT_INGEST_CONCURRENCY=2`, review source-health and shadow-classification counts, then increase gradually to the documented defaults. Do not enable a full crawl on a nearly full host.

Scanned-PDF OCR additionally requires `OCR_PROVIDER=google_document_ai`, a Document AI processor name, and a service account referenced by `GOOGLE_APPLICATION_CREDENTIALS` with permission to invoke that processor. Mobile Google Sign-In credentials are unrelated to server-side OCR. The worker obtains and caches short-lived Google access tokens; no long-lived access token needs to be stored in the environment.

## 3. Scale Path (Recommended)

Background ingestion uses:

1. `ETag` and `Last-Modified` conditional requests where a source provides them.
2. A SHA-256 content hash fallback when validators are unavailable.
3. A processing-version marker so parser/rule changes can intentionally reprocess unchanged bytes.
4. Source health, consecutive failure, last-success, and item-count diagnostics.
5. A bounded source batch and same-host serialization so one cycle cannot send concurrent requests to the same university host.

Benefits:

- Faster response times.
- Better stability when source sites are slow.
- Better control of retries and failures.

## 4. Failure Tolerance

Per source resilience policy:

- timeout budget (for example 5-7 seconds),
- retain the last active trusted snapshot on timeout, parse failure, or activation failure,
- reject empty responses instead of treating them as authoritative deletion,
- mark degraded/failed source status for admin review,
- retry safely from the worker without exposing a staged or partial snapshot.

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

- Evaluate the deterministic `studentRelevance`, topic, audience, action, deadline, urgency, and evidence-span shadow report before allowing those fields to influence ranking or visibility.
- Per-scope max item quotas and pagination.
- Optional push notifications for critical announcement categories.
