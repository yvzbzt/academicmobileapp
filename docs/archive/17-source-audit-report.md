> [!WARNING]
> **HISTORICAL AUDIT — SUPERSEDED.** This report records the source state and
> deployment observations from 1 July 2026. Use the current
> [architecture](../02-architecture.md), [security guidance](../04-security-hardening.md),
> [deployment guidance](../08-devops-deployment.md), and source registries for
> current behavior.

# Source Audit Report - 2026-07-01

## PDF Calendar Row Issue

The duplicate-looking academic calendar rows were caused by line-based PDF parsing. Some PDFs expose a table row as separate text-layer lines, for example:

- title fragment
- date
- full title
- date
- trailing fragment such as a standalone "day" suffix
- date

The old parser treated every line containing a date as a standalone event. The parser now first builds logical candidate rows from adjacent lines, joins title/date-only rows, rejects dangling suffix fragments, and deduplicates same-date contained titles.

Regression coverage was added for the exact `24.07.2026` split-row case.

## Implemented Changes

- Fixed real-time announcement refresh:
  - student announcement requests now discover a university source on miss,
  - cached announcement items are refreshed after `ANNOUNCEMENT_CACHE_TTL_MS`,
  - scheduled ingestion no longer treats the static YOK source as proof that university sources already exist.
- Added a Node HTTP fallback, production `NODE_OPTIONS=--use-system-ca`, and the missing `Sectigo Public Server Authentication CA DV R36` intermediate certificate for public `.edu.tr` sites where Node cannot build the default certificate chain but browsers can.
- Filtered social/share anchors such as WhatsApp before source URLs containing announcement keywords can make them look like real announcement items.
- Announcement discovery now keeps searching after a weak/no-item homepage and avoids selecting individual detail pages as source pages.
- Added a bundled YOK Atlas catalog seed fallback with 205 universities, 2,924 faculties, and 14,424 departments for memory-mode Cloud Run restarts when the live YOK Atlas bootstrap call fails or returns empty.
- Made memory-mode catalog IDs deterministic from slugs so Cloud Run instances do not return random per-instance university/faculty/department IDs.
- Calendar scheduled discovery checks all active universities by default instead of only the first 25.
- Reintroduced a student-facing summer school screen in the mobile app.
- Added `GET /calendar/summer-school/my`.
- The endpoint returns:
  - the student's selected university/faculty/department profile,
  - summer-school requirement rows found in published academic calendar events,
  - same-department summer-school options only when the source text explicitly matches the selected department name.
- Expanded academic-calendar discovery paths and embedded-link/PDF extraction.
- Improved category mapping for summer school application, registration, and course-selection text.
- Added `npm run verify:sources` for all-university source auditing.

## Live Audit Result

Command:

```bash
npm run verify:sources
```

Output file:

```text
.tmp-test-run/university-source-audit.json
```

Summary:

| Area | Found | Missing | Checked |
| --- | ---: | ---: | ---: |
| University announcements | 176 | 29 | 205 |
| Academic calendar sources | 120 | 85 | 205 |
| Summer-school source pages | 117 | 88 | 205 |

The JSON report contains one row per university with announcement, calendar, and summer-school discovery status.

## Selcuk University Status

Selcuk University now resolves correctly in the crawler.

Observed result:

- Announcement source: `https://selcuk.edu.tr/icerik/ogrenciduyurulari`
- Parsed announcement items: 25
- Sample current student announcement date: `22.06.2026`
- Academic calendar PDF: `https://webadmin.selcuk.edu.tr/uploads/Contents/main/icerik/2468/2025-2026%20E%C4%9Fitim-%C3%96%C4%9Fretim%20Y%C4%B1l%C4%B1%20Genel%20Akademik%20Takvimi_638895488876249013.pdf`

Why it was not appearing:

- The crawler's Node `fetch` failed on Selcuk's site with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, while the site was reachable through a normal browser/PowerShell request. Selcuk serves the leaf certificate without the intermediate `Sectigo Public Server Authentication CA DV R36`, so the API container now includes that intermediate CA and keeps invalid TLS disabled.
- The scheduler could skip source discovery because the static YOK source already existed.
- The student endpoint returned cached data immediately and did not refresh on demand.
- Source ranking could choose a homepage/detail page instead of the real student announcements listing.

Deployed verification:

- Backend revision: `academic-calendar-api-00025-kil`
- Public API URL: `https://academic-calendar-api-qrld4semgq-ew.a.run.app`
- Catalog record ID: `selcuk-universitesi-konya`
- `GET /calendar/university/selcuk-universitesi-konya` now publishes the 2025-2026 calendar from the official Selcuk PDF with 111 events.

## ATU Status

Adana Alparslan Turkes Science and Technology University still does not have a current discoverable academic calendar in the crawler result.

Observed result:

- Homepage: `https://atu.edu.tr/`
- Announcement discovery: homepage loaded, but no parseable announcement items found.
- Calendar discovery: `source_not_found`.
- Summer-school discovery: fetch failed.

The live homepage returns client-rendered Angular placeholders such as `{{Dilliste.USTYAZI}}`, so the crawler cannot read navigation/calendar links from the static HTML. The previous ATU OData calendar adapter also exposes stale rows only, so current-year ingestion correctly refuses to publish old 2024-2025 or older data.

## Remaining Blocker

The application is now safer: it does not publish stale or empty calendars and it no longer displays broken PDF fragments as events. The deployed memory-mode API also has a deterministic catalog fallback after restarts. However, it is not yet complete for all universities because 85 academic calendar sources were not discoverable from public pages using the current crawler.

For production readiness, those 85 universities need either:

- manually verified `academicCalendarUrl` values in the catalog,
- per-university adapters for JavaScript/API-backed websites,
- or crawler support for each site's hidden API/search behavior.
