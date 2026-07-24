# Announcement Ingestion Report

Date: 2026-07-01

## What was added

- Background announcement discovery and ingestion service for university announcement pages.
- Cached `announcement_sources` and `announcement_items` repositories for memory, Firestore, and Mongo implementations.
- Admin endpoints:
  - `GET /admin/announcements/sources`
  - `POST /admin/announcements/discover`
  - `POST /admin/announcements/ingest`
- Parser support for RSS/Atom, HTML announcement links, common Turkish announcement paths, embedded CMS links, and JSON-shaped announcement payloads.
- Live verification script: `npm run verify:announcements`.

## Deployment

- Cloud Run service: `academic-calendar-api`
- URL: `https://academic-calendar-api-qrld4semgq-ew.a.run.app`
- Revision deployed: `academic-calendar-api-00015-xed`
- Min instances: `1`
- Announcement ingestion enabled with a 30 minute interval.
- Invalid-TLS fallback is disabled in production: `ANNOUNCEMENT_ALLOW_INVALID_TLS=false`.

## Verification

Command:

```powershell
$env:ANNOUNCEMENT_VERIFY_LIMIT='205'
$env:ANNOUNCEMENT_VERIFY_CONCURRENCY='4'
$env:ANNOUNCEMENT_VERIFY_TIMEOUT_MS='12000'
$env:ANNOUNCEMENT_ALLOW_INVALID_TLS='false'
npm run verify:announcements
```

Result:

- Checked universities: 205
- Source found and parsed: 171
- Homepage found but no parseable announcement items: 12
- Homepage/source not reachable from server-side fetch: 22
- Parsed items during audit: 3789
- Full JSON report: `.tmp-test-run/announcement-discovery-report.json`

## Remaining Gaps

These need custom adapters, official feed URLs, Cloudflare/server allowlisting, or a decision to permit invalid-TLS fallback.

### Homepage Found But No Items

- `adana-alparslan-turkes-bilim-ve-teknoloji-universitesi`
- `ankara-haci-bayram-veli-universitesi`
- `ankara-universitesi`
- `bayburt-universitesi`
- `bingol-universitesi`
- `hatay-mustafa-kemal-universitesi`
- `istanbul-universitesi`
- `istanbul-universitesi-cerrahpasa`
- `kahramanmaras-istiklal-universitesi`
- `kirsehir-ahi-evran-universitesi`
- `kocaeli-universitesi`
- `selcuk-universitesi-konya`

### Homepage Not Found Or Blocked

- `afyonkarahisar-saglik-bilimleri-universitesi`
- `ankara-sosyal-bilimler-universitesi`
- `balikesir-universitesi`
- `bitlis-eren-universitesi`
- `bursa-teknik-universitesi`
- `demiroglu-bilim-universitesi-istanbul`
- `duzce-universitesi`
- `erzincan-binali-yildirim-universitesi`
- `inonu-universitesi-malatya`
- `istanbul-aydin-universitesi`
- `istanbul-rumeli-universitesi`
- `izmir-katip-celebi-universitesi`
- `izmir-kavram-meslek-yuksekokulu`
- `kirikkale-universitesi`
- `ordu-universitesi`
- `osmaniye-korkut-ata-universitesi`
- `ostim-teknik-universitesi-ankara`
- `sakarya-uygulamali-bilimler-universitesi`
- `sinop-universitesi`
- `turk-hava-kurumu-universitesi-ankara`
- `van-yuzuncu-yil-universitesi`
- `yasar-universitesi-izmir`

## Notes

- The production-safe audit intentionally disables invalid certificate fallback. Enabling it raises coverage for some universities, but it weakens crawler TLS validation and should be approved explicitly before use.
- Cloud Run min instances is set to `1`. If Google Cloud Console shows CPU throttling enabled, true timer-based continuous ingestion should be moved to Cloud Scheduler or CPU-always allocation should be enabled from the console.
