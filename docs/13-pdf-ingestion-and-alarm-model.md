# PDF Ingestion And Alarm Model

## 1. Core Question

How does the system work when universities upload academic calendars, and how can students set alarms?

Short answer:

- Admin side ingests calendar data from PDF (text extraction/OCR fallback) or manual field corrections.
- Approved events are published to the university calendar timeline.
- Students can set alarms in two scopes:
  - All calendar alarms (all event categories for selected university)
  - Selected field alarms (specific categories only)

## 2. Data Ingestion Flow (Admin)

### Step A - Source Intake

The content worker or an admin creates a PDF source record with university and academic year. A publishable source is identified by the SHA-256 of the exact PDF bytes. Metadata-only legacy records remain readable for compatibility but cannot be used to publish a calendar.

For an official URL submitted through the admin API, the server downloads the allowlisted source and derives its text from those same verified bytes. Caller-supplied text is not used as evidence for that verified binary.

### Step B - Extraction

- If PDF has text layer: parser extracts rows and dates directly from the verified bytes.
- If no text layer: source is marked `ocr_required` for OCR path.
- A date that is not explicit in the source remains unknown; fetch time is never substituted as an event date.
- Reprocessing the same binary reuses its SHA-256 identity and active extracted-event snapshot.

### Step C - Normalization

Extracted rows are normalized into event candidates:

- category
- title
- start/end date
- academic year
- confidence score
- optional deterministic student-relevance metadata and exact evidence spans

### Step D - Manual Review

Admin reviews each extracted candidate and can:

- approve
- reject
- edit critical fields before approve

Only high-confidence candidates with explicit date evidence may be auto-approved by the worker. All other candidates stay in `pending_review`.

### Step E - Publish

Approved candidates are transformed into published academic events.

At publish time, the complete approved event set is activated before superseded data is retired. If ingestion or activation fails, the last usable published calendar remains visible and can be repaired by the next worker cycle. Notification scheduling is idempotently reconciled after publication.

## 3. Manual Entry Clarification

If fields are entered manually (or corrected manually), they still become standard academic events after approval.

This means manual and OCR-derived events are treated the same in downstream alarm logic.

## 4. Alarm Scopes For Students

## Scope 1 - All Calendar Alarm

Meaning:

- Student receives notifications for all enabled event categories in selected university calendar.

Implementation mapping:

- preferences `enabled = true`
- category map set to all `true`

## Scope 2 - Selected Field Alarm

Meaning:

- Student chooses only desired categories, for example:
  - course_registration
  - midterm_exam
  - final_exam

Implementation mapping:

- preferences `enabled = true`
- chosen categories `true`, non-chosen categories `false`

## Scope 3 - Global Off

Meaning:

- Student disables all alarm delivery.

Implementation mapping:

- preferences `enabled = false`

## 5. Time Rules

Each notification also follows time rules:

- reminder offsets (for example 7, 3, 1 days before event)
- quiet hours (for example 22:00-07:00)

If event time hits quiet hours, delivery is deferred.

## 6. End-to-End Example

1. Admin uploads PDF for University X, academic year 2026-2027.
2. System extracts events; admin approves/corrects fields.
3. Admin publishes calendar.
4. Student selects University X in profile.
5. Student sets alarm mode:
   - all calendar, or
   - selected fields only.
6. Scheduler creates due jobs based on offsets.
7. Worker filters by preferences and quiet hours.
8. Eligible notifications are delivered and logged.

## 7. React Native App Mapping

Native app screens support this model with:

- register/login
- university selection
- calendar + upcoming list
- alarm mode selector:
  - All Calendar
  - Selected Fields
- category switches for selected field mode
- save preferences and device registration

## 8. Business Rule Summary

- Calendar data source can be OCR or manual corrections; both converge to same event model.
- Alarm scope is always evaluated within selected university context.
- Student can subscribe broadly (all calendar) or narrowly (selected fields).
- Quiet hours and reminder offsets are applied after scope filtering.
