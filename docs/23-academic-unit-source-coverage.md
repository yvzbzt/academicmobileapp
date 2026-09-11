# Academic-unit source coverage contract

The discovery aggregate writes `academic-unit-source-coverage.jsonl`. It contains exactly one row for every faculty/school and department/program in the checked-in catalog (currently 2,932 faculty-level rows plus 14,428 department-level rows, 17,360 total).

Each row has explicit slots for:

- unit homepage;
- announcements;
- news;
- events;
- the university-wide academic calendar;
- course schedule;
- exam schedule.

Homepage, announcement, news, event, and inherited university calendar slots are required for both scope levels. Course and exam schedules are required for departments/programs; faculty-level schedule slots remain visible as `NOT_APPLICABLE_SCOPE` when no faculty source was found. A verified shared URL is not treated as a duplicate error: the row records `publicationScope` plus `inheritedFromScopeType`/`inheritedFromScopeId`. A university calendar is explicitly represented as `university_system` inheritance. Announcement/news/event sources are inherited only through explicit verified publication scope: a department may inherit a faculty source carrying `publicationScope: "faculty_shared"`, and a faculty or department may inherit a university source carrying `publicationScope: "university_system"`. The row records that provenance; a direct URL without the required scope evidence is not silently promoted or inherited.

Every missing required slot is copied to `unresolved-and-not-found.jsonl` as `required_academic_unit_source`. `summary.json.academicUnitSourceCoverage.bySourceType` reports required, verified, inherited, retryable, blocked, not-found, and review counts. `FULL_COVERAGE_GREEN` requires exactly 17,360 coverage rows and every required slot to be `VERIFIED_COMPLETE`, in addition to the existing university, course-schedule, exam-schedule, integrity, and zero-unresolved gates.

For announcement, news, and event listings, item counts and detail samples come only from the production parser's raw-response output. The exact parser input is stored separately and bound by `parserInputSha256`/`parserEvidencePath` whenever it differs from the primary rendered-DOM proof; HTML course/exam schedules use the same rule. A sample candidate must canonicalize to a distinct HTTPS detail URL inside the university authority; listing self-links, redirect-final self-links, origin roots, duplicates, and off-authority links are ineligible. Acceptance requires `min(2, parserItemCount)` eligible links and the same number of independently verified detail samples. Browser DOM links remain discovery/navigation input, not listing-item proof.

HTML evidence is encoded as canonical UTF-8 and deterministically gzipped before persistence. Both the canonical and stored artifact limits remain 25 MiB and are inclusive. Canonical overflow, gzip failure, or stored overflow rejects only that candidate with an explicit `html_evidence_*` reason and no hash/path; artifact-integrity persistence failures and document-evidence failures still fail the operation.

## Evidence-backed absence

`prepare` creates `not-found-attestations.json` once and never overwrites operator edits. `NOT_FOUND_VERIFIED` is accepted only for a deliberate record containing:

- the exact catalog university/scope/source identity;
- `decision: "NOT_FOUND_VERIFIED"`;
- reviewer, ISO review timestamp, and a substantive rationale;
- both `official_homepage_navigation` and `official_sitemap` search channels;
- at least one matching scope-homepage candidate ID whose verified evidence has an evidence path, SHA-256, and `finalRevalidatedAt`.

The university must be terminal, its official sitemap pass complete, and its candidate queue drained. An existing verified source or any unresolved transient failure for the same source rejects the attestation. Acceptance/rejection reasons are written to `not-found-attestation-audit.json`. An accepted absence remains in the unresolved list and therefore cannot make `FULL_COVERAGE_GREEN` pass; it records a truthful reviewed absence instead of inventing a URL.

## Retry and runtime update fences

Top-level `blocked` and `request_failed` labels are retryable only when their structured evidence identifies a transient failure. Retryable raw/browser statuses are 408, 425, 429, and 5xx. Without a raw status, only the allowlisted `raw_get_failed` DNS, connection, and request failures are retryable; parser errors after raw 2xx, other non-2xx responses, certificate/tunnel/client-policy failures, missing status alone, and `networkGuardReasons` alone are final review outcomes. Browser navigation timeouts, `ERR_ABORTED`, interrupted navigation, and the candidate deadline remain retryable after a successful raw response. A required detail-sample failure follows the same allowlist and makes its parent listing retryable only when the listing's own raw/browser channels are 2xx and its production parser succeeded. Only genuinely transient candidate records are cleared before the next pass; successful and permanent-failure evidence plus the candidate queue are retained. Legacy `rejected` records that satisfy the current structured transient rules are also requeued, while deterministic `html_evidence_*` rejections remain retained.

Incomplete sitemap discovery is retried only when its non-empty reason set consists solely of `sitemap_root_request_retryable`, and only until `maxAttempts`. A resumed target runs sitemap discovery when it was never attempted or that same sole retryable-root condition was recorded; semantic/traversal/limit failures are not repeatedly crawled.

An explicit partial `revalidate` may refresh its result artifacts, but it cannot mutate either checked-in runtime registry. `runtime-update-audit.json` records the skip reason. Registry mutation requires exact 208-university and 17,360-unit identities, a current result artifact for every terminal target, a full final pass whose passed/total counters agree with the canonical verified set, zero final-revalidation failures, and every verified record carrying a current-pass `finalRevalidatedAt`. Both registries are published as one recoverable transaction; release packaging independently verifies the final audit marker and both file digests.

## Runtime admin and schedule-ingestion boundary

`GET /admin/source-coverage` builds an artifact-independent read model from the deploy-bundled catalog, authorities, and strict runtime registry. It exposes 115,656 actionable homepage/announcement/news/event/academic-calendar/course/exam slots with bounded filtering and pagination. Every one of the 17,360 faculty/school and department/program rows has exactly one academic-calendar slot. That slot can become `verified` only by inheriting a university `calendarUrl` whose final evidence explicitly carries `publicationScope: "university_system"`; a scope-mismatched proof stays quarantined and a URL without final evidence stays `legacy_unverified`. Legacy URLs are never promoted to `verified` from health status alone. University-scoped administrators are forcibly restricted to their own university by the controller.

`POST /admin/calendars/schedule-sources/provision-registry` provisions only department course/exam URLs whose exact registry field carries valid schema/version, authority, final-URL, hash, evidence-path, and `finalRevalidatedAt` proof. Changed or evidence-less definitions disable the previous source. Fetching rechecks authority and every redirect through the shared SSRF boundary, persists provenance, and produces bounded PDF/XLSX/HTML candidates for human review. It never publishes schedule rows automatically; unsupported image/OCR, zero-row, fetch, parse, and scope failures remain explicit `review_required` outcomes.

Human approval stages selected rows through `materializing` to `staged`; it does not make them student-visible. The linked standard calendar must already be published before `POST /admin/calendars/schedule-sources/:id/publish`, and only a `super_admin` can publish. A `super_admin` may use `POST /admin/calendars/schedule-sources/:id/reopen-review` only while the source is `materializing` or `staged`; reopening archives the staged review events and returns the source to `review_required`. A published schedule is immutable and cannot be reopened.
